// js/dev/perfcheck.js — Đo hiệu năng render preview, tô màu editor, cuộn, gõ 1 phím, kéo divider và tách giai đoạn render, mở app với ?perf.

import { editorHighlight, editorHighlightCode, markdownInput, paneResizer, previewOutput, viewItems, workspace } from '../core/dom.js';
import { showToast } from '../core/toast.js';
import { editorHistory } from '../editor/history.js';
import { cancelScheduledEditorHighlight, updateEditorHighlight } from '../editor/highlight.js';
import { syncEditorAfterChange } from '../editor/sync.js';
import { renderMarkdown, whenMermaidIdle } from '../preview/render.js';

// 400k vượt ngưỡng 300k nên đo luôn nhánh preview lớn (bỏ hljs). Sửa danh sách để đo mức khác.
const DOC_SIZES = [20000, 100000, 200000, 400000];
const RUNS = 3;
const DRAG_STEPS = 40;
// Phải khớp @media (max-width: 768px) trong layout.css / view-mode.js.
const VERTICAL_LAYOUT_MQ = '(max-width: 768px)';

// shortcut: corpus cố định, không Mermaid/KaTeX/ảnh (async hoặc cache, khó so sánh); thêm loại khối khi cần đo.
const PARAGRAPH = 'Markdown Live xử lý mọi thứ trên máy: phân tích cú pháp, lọc HTML, tô màu cú pháp và vẽ sơ đồ. '
    + 'Đoạn văn dài giữ cho chi phí layout chiếm tỉ lệ giống tài liệu thật. ';

function buildSection(n) {
    return `## Mục ${n}\n\n${PARAGRAPH.repeat(3)}\n\n`
        + '- Mục một có `inline code` và **đậm**\n- Mục hai\n- [ ] Việc cần làm\n- [x] Việc đã xong\n\n'
        + `> Trích dẫn phần ${n}: **quan trọng** và *nhấn mạnh*.\n\n`
        + '| Cột A | Cột B | Cột C |\n| --- | --- | --- |\n'
        + `| ${n} | \`x\` | [link](https://example.com/${n}) |\n\n`
        + '```js\nfunction probe(n) {\n    return [1, 2, 3].map((v) => v * n);\n}\n```\n\n';
}

// Corpus riêng cho kịch bản tách giai đoạn: mỗi mục thêm một công thức để cột KaTeX đo được chi phí thật.
function buildMathSection(n) {
    return buildSection(n)
        + `$$\\int_0^1 x_n^2 \\, dx = \\tfrac{1}{2n+1}$$\n\n`
        + `Công thức nội tuyến $x_n^2 + y_n^2$ của phần ${n}.\n\n`;
}

// Ghép nguyên section (có thể vượt mục tiêu) để không mở fence dở dang; độ dài thật in ở cột chars.
function buildDoc(targetChars, sectionBuilder = buildSection) {
    const parts = [];
    let length = 0;
    for (let n = 1; length < targetChars; n++) {
        const section = sectionBuilder(n);
        parts.push(section);
        length += section.length;
    }
    return parts.join('');
}

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

function round1(value) {
    return Math.round(value * 10) / 10;
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Một phím gõ thật: sửa value rồi bắn 'input' như browser, listener chạy syncEditorAfterChange.
// scrollTop đặt trong cùng task để khung đo tô đúng vùng quanh con trỏ; scroll event tới sau lượt đo.
async function measureKeystroke(pos) {
    markdownInput.setSelectionRange(pos, pos);
    const scrollable = Math.max(markdownInput.scrollHeight - markdownInput.clientHeight, 0);
    markdownInput.scrollTop = pos >= markdownInput.value.length
        ? scrollable
        : Math.round((pos / markdownInput.value.length) * scrollable);
    // Hủy rAF tô màu đang treo (scroll/RO của lượt trước) rồi tô đồng bộ: giờ đo bắt đầu không còn rAF pending.
    cancelScheduledEditorHighlight();
    updateEditorHighlight();
    const t0 = performance.now();
    markdownInput.setRangeText('x', pos, pos, 'end');
    markdownInput.dispatchEvent(new InputEvent('input', { data: 'x', inputType: 'insertText', bubbles: true }));
    const syncMs = performance.now() - t0;
    await nextFrame(); // rAF plan trước (tô màu) chạy trước rAF của ta, lượt đo luôn gồm cả tô màu
    return { syncMs, totalMs: performance.now() - t0 };
}

// Gõ nhanh liên tục: render 300ms / lưu phiên 400-600ms / lịch sử bị reset mỗi phím nên không lọt khung đo;
// typingTimer hủy để lịch sử không push nội dung giả; flush cuối >= 300 + 600ms để job dồn của phím cuối xong.
async function measureTyping(row) {
    const len = markdownInput.value.length;
    for (const [label, pos] of [['mid', Math.floor(len / 2)], ['end', len]]) {
        const syncTimes = [];
        const totalTimes = [];
        for (let run = 0; run < RUNS; run++) {
            const { syncMs, totalMs } = await measureKeystroke(pos);
            syncTimes.push(syncMs);
            totalTimes.push(totalMs);
            clearTimeout(editorHistory.typingTimer);
            editorHistory.typingTimer = null;
            await settle(50); // đủ cho rAF tô màu thừa của phím trước, trước khi xếp lượt đo mới
        }
        row[`keystroke ${label} sync median (ms)`] = round1(median(syncTimes));
        row[`keystroke ${label} total median (ms)`] = round1(median(totalTimes));
        row[`keystroke ${label} total max (ms)`] = round1(Math.max(...totalTimes));
    }
    await settle(800);
}

let dragSkippedWarned = false;

// Kéo divider bằng PointerEvent như người dùng: mỗi pointermove đổi --split-size, ResizeObserver schedule
// tô màu khung KẾ nên delta giữa hai mốc rAF là chi phí trọn một khung (relayout + tô màu + vẽ).
async function measureDividerDrag() {
    if (window.matchMedia(VERTICAL_LAYOUT_MQ).matches) {
        if (!dragSkippedWarned) {
            console.warn('Perf: kéo divider bị bỏ (bố cục dọc <=768px, trục đo ngang vô nghĩa).');
            dragSkippedWarned = true;
        }
        return null;
    }
    const rect = workspace.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    paneResizer.dispatchEvent(new PointerEvent('pointerdown', { clientX: centerX, clientY: centerY, pointerId: 1, bubbles: true }));
    let prevTs = await nextFrame();
    const deltas = [];
    for (let step = 0; step < DRAG_STEPS; step++) {
        // sin đủ chu kỳ: 50% -> 90% -> 50% -> 10% -> 50%, luôn trong vùng split (2%..98%), không đổi view mode.
        const frac = 0.5 + 0.5 * Math.sin((step / (DRAG_STEPS - 1)) * Math.PI * 2);
        paneResizer.dispatchEvent(new PointerEvent('pointermove', {
            clientX: rect.left + rect.width * (0.1 + 0.8 * frac),
            clientY: centerY,
            pointerId: 1,
            bubbles: true
        }));
        const ts = await nextFrame();
        deltas.push(ts - prevTs);
        prevTs = ts;
    }
    paneResizer.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
    await nextFrame(); // rAF tô màu của bề rộng cuối chạy hết trước kịch bản kế
    return deltas;
}

// Bọc tạm để cộng dồn thời gian từng giai đoạn vào state; hàm trả về luôn khôi phục từng chỗ đã bọc.
function instrumentRenderPhases(state) {
    const restoreFns = [];
    const wrapFn = (holder, key, slot) => {
        const orig = holder[key];
        if (typeof orig !== 'function') return;
        const timed = function (...args) {
            const t0 = performance.now();
            const out = orig.apply(this, args);
            state[slot] += performance.now() - t0;
            return out;
        };
        let shadow = null;
        try {
            holder[key] = timed;
        } catch (err) {
            // getter-only trên namespace UMD: định nghĩa property riêng tại proxy, khôi phục bằng delete.
            try {
                Object.defineProperty(holder, key, { value: timed, writable: true, enumerable: true, configurable: true });
                shadow = true;
            } catch (err2) {
                console.warn(`Perf phase: không bọc được ${slot} (${err2 && err2.message ? err2.message : err2})`);
                return;
            }
        }
        restoreFns.push(shadow ? () => { delete holder[key]; } : () => { holder[key] = orig; });
    };
    // marked.parse là getter-only trên namespace UMD, nên thay binding window bằng proxy kế thừa nguyên bản,
    // chỉ bọc riêng parse; render.js đọc binding này mỗi lần gọi nên cùng khung đo luôn chạy qua wrapper.
    if (typeof marked !== 'undefined' && marked.parse) {
        const origMarked = marked;
        const proxyMarked = Object.create(origMarked);
        // KaTeX extension gọi katex.renderToString BÊN TRONG parse nên cột parse là tổng thô (chưa trừ KaTeX).
        wrapFn(proxyMarked, 'parse', 'parse');
        try {
            window.marked = proxyMarked;
        } catch (err) {
            console.warn(`Perf phase: không thay được marked (${err && err.message ? err.message : err})`);
        }
        restoreFns.push(() => { window.marked = origMarked; });
    }
    if (typeof DOMPurify !== 'undefined' && DOMPurify.sanitize) wrapFn(DOMPurify, 'sanitize', 'purify');
    if (typeof katex !== 'undefined' && katex.renderToString) wrapFn(katex, 'renderToString', 'katex');
    if (typeof hljs !== 'undefined' && hljs.highlightElement) wrapFn(hljs, 'highlightElement', 'hljs');
    // Ghi riêng innerHTML của previewOutput: alerts/mermaid chỉ innerHTML phần tử con, không dính cột này.
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    if (desc && desc.get && desc.set) {
        Object.defineProperty(previewOutput, 'innerHTML', {
            configurable: true,
            get() { return desc.get.call(previewOutput); },
            set(value) {
                const t0 = performance.now();
                desc.set.call(previewOutput, value);
                state.dom += performance.now() - t0;
            }
        });
        restoreFns.push(() => { delete previewOutput.innerHTML; });
    }
    return () => restoreFns.forEach((fn) => fn());
}

// Tách chi phí bên trong renderMarkdown; KaTeX chạy BÊN TRONG marked.parse nên cột parse đã trừ phần KaTeX,
// other gồm assignHeadingIds + alert + lucide + layout ép; preview >300k bỏ hljs nên cột hljs = 0 ở 400k.
async function measurePhases(size, phaseRows) {
    markdownInput.value = buildDoc(size, buildMathSection);
    renderMarkdown(); // warm-up không tính
    void previewOutput.offsetHeight;
    const phases = [];
    for (let run = 0; run < RUNS; run++) {
        const state = { parse: 0, katex: 0, purify: 0, dom: 0, hljs: 0, total: 0 };
        const restore = instrumentRenderPhases(state);
        try {
            const t0 = performance.now();
            renderMarkdown();
            void previewOutput.offsetHeight; // như kịch bản render: total gồm cả layout ép
            state.total = performance.now() - t0;
        } finally {
            restore();
        }
        phases.push(state);
        await settle(0);
    }
    const med = (key) => round1(median(phases.map((s) => s[key])));
    phaseRows.push({
        chars: markdownInput.value.length,
        'marked.parse (ms)': round1(median(phases.map((s) => s.parse - s.katex))),
        'KaTeX (ms)': med('katex'),
        'DOMPurify (ms)': med('purify'),
        'innerHTML (ms)': med('dom'),
        'hljs (ms)': med('hljs'),
        'other (ms)': round1(median(phases.map((s) => Math.max(s.total - s.parse - s.purify - s.dom - s.hljs, 0)))),
        'render total (ms)': med('total')
    });
}

export async function runPerfCheck() {
    const snapshot = {
        value: markdownInput.value,
        selStart: markdownInput.selectionStart,
        selEnd: markdownInput.selectionEnd,
        scrollTop: markdownInput.scrollTop,
        previewScrollTop: previewOutput.scrollTop,
        stack: editorHistory.stack,
        index: editorHistory.index,
        readOnly: markdownInput.readOnly
    };
    const viewBefore = viewItems.find((item) => item.classList.contains('active'))?.dataset.view || 'split';

    const rows = [];
    const phaseRows = [];
    try {
        // Pane ẩn thì mọi phép đo layout = 0; ép Split để số liệu của mọi lần chạy giống nhau.
        if (viewBefore !== 'split') {
            viewItems.find((item) => item.dataset.view === 'split').click();
        }
        // Diagram đang vẽ dở sẽ chen vào lượt đo.
        await whenMermaidIdle();

        // Timer gõ còn treo sẽ push nội dung giả vào lịch sử Undo.
        clearTimeout(editorHistory.typingTimer);
        editorHistory.typingTimer = null;
        editorHistory.stack = [];
        editorHistory.index = -1;
        // Gõ trong lúc đo sẽ vào nội dung giả rồi bị khôi phục đè mất.
        markdownInput.readOnly = true;

        for (const size of DOC_SIZES) {
            markdownInput.value = buildDoc(size);

            // Warm-up không tính: lượt đầu còn cấp phát DOM và bộ nhớ đệm của engine.
            renderMarkdown();
            updateEditorHighlight();
            // Ép layout cho cả hai lớp, nếu không lượt đo đầu tiên phải trả nợ layout của warm-up.
            void previewOutput.offsetHeight;
            void editorHighlightCode.offsetHeight;

            const renderTimes = [];
            const highlightTimes = [];
            for (let run = 0; run < RUNS; run++) {
                let start = performance.now();
                renderMarkdown();
                void previewOutput.offsetHeight; // ép layout, nếu không số đo bỏ qua phần đắt nhất
                renderTimes.push(performance.now() - start);

                start = performance.now();
                // force: nội dung không đổi nên lượt 2-3 sẽ bỏ qua nếu không ép dựng lại.
                updateEditorHighlight(true);
                void editorHighlightCode.offsetHeight;
                highlightTimes.push(performance.now() - start);

                // Nhường một nhịp cho frame và GC, tránh dồn mọi lượt đo vào một khung hình.
                await new Promise((resolve) => setTimeout(resolve, 0));
            }

            // Cuộn: đo đúng đường cuộn thật — chỉ lô ở hai mép được tô lại.
            // Không force: force dựng lại cả lớp nên con số sẽ là đường sửa văn bản, không phải đường cuộn.
            const scrollable = markdownInput.scrollHeight - markdownInput.clientHeight;
            const scrollTimes = [];
            for (let run = 0; run < RUNS; run++) {
                let start = performance.now();
                markdownInput.scrollTop = Math.round(scrollable * (run % 2 === 0 ? 0.85 : 0.15));
                editorHighlight.scrollTop = markdownInput.scrollTop;
                updateEditorHighlight();
                void editorHighlightCode.offsetHeight;
                scrollTimes.push(performance.now() - start);
                await new Promise((resolve) => setTimeout(resolve, 0));
            }

            const row = {
                chars: markdownInput.value.length,
                'render median (ms)': round1(median(renderTimes)),
                'render max (ms)': round1(Math.max(...renderTimes)),
                'highlight median (ms)': round1(median(highlightTimes)),
                'scroll median (ms)': round1(median(scrollTimes)),
                'scroll max (ms)': round1(Math.max(...scrollTimes))
            };
            await measureTyping(row);

            const dragDeltas = await measureDividerDrag();
            row['drag median (ms)'] = dragDeltas ? round1(median(dragDeltas)) : 'skipped';
            row['drag max (ms)'] = dragDeltas ? round1(Math.max(...dragDeltas)) : 'skipped';
            row['drag frames >32ms'] = dragDeltas ? dragDeltas.filter((t) => t > 32).length : 'skipped';
            rows.push(row);

            await measurePhases(size, phaseRows);
        }
    } catch (err) {
        console.error('Perf check failed:', err);
        showToast(`Perf check failed: ${err && err.message ? err.message : err}`);
        return;
    } finally {
        clearTimeout(editorHistory.typingTimer);
        editorHistory.typingTimer = null;
        editorHistory.stack = snapshot.stack;
        editorHistory.index = snapshot.index;
        markdownInput.readOnly = snapshot.readOnly;
        markdownInput.value = snapshot.value;
        markdownInput.setSelectionRange(snapshot.selStart, snapshot.selEnd);
        markdownInput.scrollTop = snapshot.scrollTop;
        // Trả view trước khi render lại để preview khôi phục đúng nội dung người dùng.
        if (viewBefore !== 'split') {
            viewItems.find((item) => item.dataset.view === viewBefore).click();
        }
        previewOutput.scrollTop = snapshot.previewScrollTop;
        // Dựng lại char counter, highlight, preview, tab và nháp phiên từ nội dung thật.
        syncEditorAfterChange();
    }

    // Median là số chính; max cho thấy mức tệ nhất. Không đặt ngưỡng PASS/FAIL vì ms phụ thuộc máy.
    console.log(`Perf check: ${DOC_SIZES.length} document sizes, ${RUNS} runs each (median).`);
    console.table(rows);
    console.log('Phases inside renderMarkdown (cột marked.parse đã trừ KaTeX):');
    console.table(phaseRows);
    showToast(`Perf: ${DOC_SIZES.length} sizes measured (see console.table)`);
}
