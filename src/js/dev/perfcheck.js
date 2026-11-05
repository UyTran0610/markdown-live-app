// js/dev/perfcheck.js — Số đo hiệu năng cơ bản: render preview, tô màu editor, cuộn, gõ phím,
// kéo divider. Một bảng số trung bình theo kích thước tài liệu, mở app với ?perf.

import { editorHighlightCode, markdownInput, paneResizer, previewOutput, viewItems, workspace } from '../core/dom.js';
import { showToast } from '../core/toast.js';
import { cancelScheduledEditorHighlight, updateEditorHighlight } from '../editor/highlight.js';
import { renderDelayFor } from '../editor/sync.js';
import { closeTab, getActiveTab, newTab, switchTab, saveSession } from '../io/documents.js';
import { whenSessionWritten } from '../io/session-store.js';
import { editorHistory } from '../editor/history.js';
import { renderMarkdown, whenMermaidIdle } from '../preview/render.js';

// 400k vượt ngưỡng 300k nên đo luôn nhánh preview lớn (bỏ hljs). Sửa danh sách để đo mức khác.
const DOC_SIZES = [20000, 100000, 200000, 400000];
// 5 lượt để số trung bình bớt nhiễu so với 3.
const RUNS = 5;
const DRAG_STEPS = 40;
// Phải khớp @media (max-width: 768px) trong layout.css / view-mode.js.
const VERTICAL_LAYOUT_MQ = '(max-width: 768px)';

// shortcut: corpus cố định, không Mermaid/ảnh (async hoặc cache, khó so sánh); có công thức
// để số render tính cả chi phí KaTeX.
const PARAGRAPH = 'Markdown Live xử lý mọi thứ trên máy: phân tích cú pháp, lọc HTML, tô màu cú pháp và vẽ sơ đồ. '
    + 'Đoạn văn dài giữ cho chi phí layout chiếm tỉ lệ giống tài liệu thật. ';

function buildSection(n) {
    return `## Mục ${n}\n\n${PARAGRAPH.repeat(3)}\n\n`
        + '- Mục một có `inline code` và **đậm**\n- Mục hai\n- [ ] Việc cần làm\n- [x] Việc đã xong\n\n'
        + `> Trích dẫn phần ${n}: **quan trọng** và *nhấn mạnh*.\n\n`
        + '| Cột A | Cột B | Cột C |\n| --- | --- | --- |\n'
        + `| ${n} | \`x\` | [link](https://example.com/${n}) |\n\n`
        + '```js\nfunction probe(n) {\n    return [1, 2, 3].map((v) => v * n);\n}\n```\n\n'
        + `$$\\int_0^1 x_n^2 \\, dx = \\tfrac{1}{2n+1}$$\n\n`
        + `Công thức nội tuyến $x_n^2 + y_n^2$ của phần ${n}.\n\n`;
}

// Ghép nguyên section (có thể vượt mục tiêu) để không mở fence dở dang; độ dài thật in ở cột chars.
function buildDoc(targetChars) {
    const parts = [];
    let length = 0;
    for (let n = 1; length < targetChars; n++) {
        const section = buildSection(n);
        parts.push(section);
        length += section.length;
    }
    return parts.join('');
}

function avg(values) {
    return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}

function round1(value) {
    return Math.round(value * 10) / 10;
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// rAF -> setTimeout: timeout chạy sau bước render nên chênh lệch là style + layout + paint
// (main thread) của khung. work chạy trong callback và được đo riêng.
function measureFrame(work) {
    return new Promise((resolve) => {
        requestAnimationFrame((frameStart) => {
            let workMs = 0;
            let tailStart = frameStart;
            if (work) {
                const t0 = performance.now();
                work();
                workMs = performance.now() - t0;
                tailStart = performance.now();
            }
            setTimeout(() => {
                const end = performance.now();
                resolve({ frameMs: end - frameStart, tailMs: end - tailStart, workMs });
            }, 0);
        });
    });
}

// Một phím gõ thật: native (setRangeText + ép layout), handler app (chỉ 'input'),
// tô màu trong rAF, rồi style + layout + paint của khung. Trả breakdown để in từng cột riêng.
async function measureKeystroke(pos) {
    markdownInput.setSelectionRange(pos, pos);
    const scrollable = Math.max(markdownInput.scrollHeight - markdownInput.clientHeight, 0);
    markdownInput.scrollTop = pos >= markdownInput.value.length
        ? scrollable
        : Math.round((pos / markdownInput.value.length) * scrollable);
    // Hủy rAF tô màu đang treo (scroll/RO của lượt trước) rồi tô đồng bộ: giờ đo bắt đầu không còn rAF pending.
    cancelScheduledEditorHighlight();
    updateEditorHighlight();
    void editorHighlightCode.offsetHeight; // trả nợ layout của prep trước khi đo
    let t = performance.now();
    markdownInput.setRangeText('x', pos, pos, 'end');
    void markdownInput.offsetHeight; // ép layout ngay, không để khung sau trả nợ
    const nativeMs = performance.now() - t;
    t = performance.now();
    markdownInput.dispatchEvent(new InputEvent('input', { data: 'x', inputType: 'insertText', bubbles: true }));
    const handlerMs = performance.now() - t;
    // Nội dung đã đổi (setRangeText vừa chèn 'x') nên push chạy nhánh thật, không rơi nhánh dedup.
    t = performance.now();
    editorHistory.saveCurrentState(markdownInput);
    const historyMs = performance.now() - t;
    // Handler vừa xếp rAF tô màu của app; hủy để tự chạy updateEditorHighlight trong rAF.
    cancelScheduledEditorHighlight();
    let highlightMs = 0;
    const { tailMs } = await measureFrame(() => {
        const t1 = performance.now();
        updateEditorHighlight();
        highlightMs = performance.now() - t1;
        // Scroll event của bước đặt scrollTop xếp thêm một rAF tô màu trùng; bỏ để tail chỉ còn layout/paint.
        cancelScheduledEditorHighlight();
    });
    return { total: nativeMs + handlerMs + highlightMs + tailMs, handlerMs, historyMs };
}

let dragSkippedWarned = false;

// Kéo divider bằng PointerEvent như người dùng. Mỗi pointermove đổi --split-size; ResizeObserver
// xếp tô màu cho khung KẾ, nên frameMs của khung đó gồm highlight + layout + paint của lượt trước.
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
    cancelScheduledEditorHighlight();
    paneResizer.dispatchEvent(new PointerEvent('pointerdown', { clientX: centerX, clientY: centerY, pointerId: 1, bubbles: true }));
    await nextFrame();
    const frames = [];
    for (let step = 0; step < DRAG_STEPS; step++) {
        // sin đủ chu kỳ: 50% -> 90% -> 50% -> 10% -> 50%, luôn trong vùng split (2%..98%), không đổi view mode.
        const frac = 0.5 + 0.5 * Math.sin((step / (DRAG_STEPS - 1)) * Math.PI * 2);
        paneResizer.dispatchEvent(new PointerEvent('pointermove', {
            clientX: rect.left + rect.width * (0.1 + 0.8 * frac),
            clientY: centerY,
            pointerId: 1,
            bubbles: true
        }));
        const { frameMs } = await measureFrame(null);
        frames.push(frameMs);
    }
    paneResizer.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
    // Khung cuối chạy nốt highlight mà RO xếp cho pointermove cuối (đường tăng dần).
    frames.push((await measureFrame(null)).frameMs);
    return frames;
}

export async function runPerfCheck() {
    const viewBefore = viewItems.find((item) => item.classList.contains('active'))?.dataset.view || 'split';
    const activeBefore = getActiveTab();
    const rows = [];

    // Tab tạm: nội dung đo không bao giờ chạm tab thật, không cần snapshot/restore.
    const temp = newTab();
    markdownInput.readOnly = true;

    try {
        // Pane ẩn thì mọi phép đo layout = 0; ép Split để số liệu của mọi lần chạy giống nhau.
        if (viewBefore !== 'split') {
            viewItems.find((item) => item.dataset.view === 'split').click();
        }
        // Diagram đang vẽ dở sẽ chen vào lượt đo.
        await whenMermaidIdle();

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
                // force: nội dung không đổi nên lượt sau sẽ bỏ qua nếu không ép dựng lại.
                updateEditorHighlight(true);
                void editorHighlightCode.offsetHeight;
                highlightTimes.push(performance.now() - start);

                // Nhường một nhịp cho frame và GC, tránh dồn mọi lượt đo vào một khung hình.
                await settle(0);
            }

            // Cuộn: đo đúng đường cuộn thật — chỉ lô ở hai mép được tô lại.
            // Không force: force dựng lại cả lớp nên con số sẽ là đường sửa văn bản, không phải đường cuộn.
            const scrollable = markdownInput.scrollHeight - markdownInput.clientHeight;
            const scrollTimes = [];
            for (let run = 0; run < RUNS; run++) {
                const start = performance.now();
                markdownInput.scrollTop = Math.round(scrollable * (run % 2 === 0 ? 0.85 : 0.15));
                updateEditorHighlight();
                void editorHighlightCode.offsetHeight;
                scrollTimes.push(performance.now() - start);
                await settle(0);
            }

            // Gõ: sửa giữa tài liệu (lệt vùng tô màu phải nối lô) là ca nhất.
            const typeTimes = [];
            const handlerTimes = [];
            const historyTimes = [];
            for (let run = 0; run < RUNS; run++) {
                const keystroke = await measureKeystroke(Math.floor(markdownInput.value.length / 2));
                typeTimes.push(keystroke.total);
                handlerTimes.push(keystroke.handlerMs);
                historyTimes.push(keystroke.historyMs);
                await settle(50); // đủ cho rAF tô màu thừa của phím trước
            }

            // Mỗi phím gõ xếp render preview theo debounce và lưu phiên; phần nền đó cướy main
            // thread nên phải xong trước khi đo kéo divider, nếu không số khung bị nhiễu.
            await settle(renderDelayFor(markdownInput.value.length) + avg(renderTimes) + 500);

            const frames = await measureDividerDrag();

            // saveSession: content giữ nguyên nên lượt 2+ bỏ qua ghi IDB, chỉ còn hash + fingerprint — đúng trạng thái gõ bình thường.
            await whenSessionWritten();
            const saveTimes = [];
            for (let run = 0; run < RUNS; run++) {
                const start = performance.now();
                await saveSession();
                saveTimes.push(performance.now() - start);
                await settle(0);
            }

            rows.push({
                chars: markdownInput.value.length,
                'render (ms)': round1(avg(renderTimes)),
                'highlight (ms)': round1(avg(highlightTimes)),
                'scroll (ms)': round1(avg(scrollTimes)),
                'typing (ms)': round1(avg(typeTimes)),
                'handler (ms)': round1(avg(handlerTimes)),
                'history (ms)': round1(avg(historyTimes)),
                'saveSession (ms)': round1(avg(saveTimes)),
                'drag frame (ms)': frames ? round1(avg(frames)) : 'skipped'
            });
        }
    } catch (err) {
        console.error('Perf check failed:', err);
        showToast(`Perf check failed: ${err && err.message ? err.message : err}`);
        return;
    } finally {
        markdownInput.readOnly = false;
        // remember: false để tab đo không lọt vào Ctrl+Shift+T.
        await closeTab(temp.id, { force: true, remember: false });
        if (activeBefore) switchTab(activeBefore.id);
        // Trả view sau khi đã về tab thật để preview render đúng nội dung người dùng.
        if (viewBefore !== 'split') {
            viewItems.find((item) => item.dataset.view === viewBefore).click();
        }
    }

    // Số trung bình để đánh giá cơ bản; không đặt ngưỡng PASS/FAIL vì ms phụ thuộc máy.
    console.log(`Perf check: ${DOC_SIZES.length} document sizes, ${RUNS} runs each (trung bình).`);
    console.log('typing = độ trễ một phím gõ (native + handler + tô màu + layout/paint); handler = chỉ handler input (không render); history = editorHistory.saveCurrentState; saveSession = saveSession kể cả hash; drag frame = đầu khung rAF -> sau paint.');
    console.table(rows);
    showToast(`Perf: ${DOC_SIZES.length} sizes × ${RUNS} runs (see console.table)`);
}
