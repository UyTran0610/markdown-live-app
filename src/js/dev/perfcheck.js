// js/dev/perfcheck.js — Đo hiệu năng render preview, tô màu editor, cuộn, gõ phím, kéo divider,
// tách giai đoạn render, cô lập layout/paint và bắt khung dài, mở app với ?perf.

import { editorHighlight, editorHighlightCode, markdownInput, paneResizer, previewOutput, viewItems, workspace } from '../core/dom.js';
import { showToast } from '../core/toast.js';
import { cancelScheduledEditorHighlight, highlightPerf, updateEditorHighlight } from '../editor/highlight.js';
import { closeTab, getActiveTab, newTab, switchTab } from '../io/documents.js';
import { renderMarkdown, whenMermaidIdle } from '../preview/render.js';

// 400k vượt ngưỡng 300k nên đo luôn nhánh preview lớn (bỏ hljs). Sửa danh sách để đo mức khác.
const DOC_SIZES = [20000, 100000, 200000, 400000];
const RUNS = 3;
const DRAG_STEPS = 40;
// Phải khớp @media (max-width: 768px) trong layout.css / view-mode.js.
const VERTICAL_LAYOUT_MQ = '(max-width: 768px)';

// A/B đường tô màu: sửa lô tăng dần (editLayer) và ép dựng lại cả lớp.
const MODES = [
    { label: 'incremental', force: false },
    { label: 'forced', force: true }
];

// content-visibility: hidden bỏ style/layout/paint của subtree nhưng GIỮ hộp layout;
// display:none đổi layout nên không dùng. Cấu hình cuối còn lại chi phí textarea.
const ISOLATIONS = [
    { label: 'full', preview: false, highlight: false },
    { label: 'no-preview', preview: true, highlight: false },
    { label: 'no-highlight', preview: false, highlight: true },
    { label: 'textarea-only', preview: true, highlight: true }
];

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

// Ẩn subtree bằng content-visibility để giữ nguyên layout của pane; ép style/layout ngay
// để lượt đo đầu không trả nợ cho lần đổi cấu hình.
function setIsolation({ preview, highlight }) {
    previewOutput.style.contentVisibility = preview ? 'hidden' : '';
    editorHighlight.style.contentVisibility = highlight ? 'hidden' : '';
    void previewOutput.offsetHeight;
    void editorHighlight.offsetHeight;
}

// Một phím gõ thật, tách 3 tầng: native (setRangeText + ép layout), handler app (chỉ 'input'),
// callback tô màu trong rAF. render = style + layout + paint sau callback đó.
async function measureKeystroke(pos, force) {
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
    // Handler vừa xếp rAF tô màu của app; hủy để tự chạy updateEditorHighlight trong rAF và đo bằng mark.
    cancelScheduledEditorHighlight();
    let highlightMs = 0;
    const { tailMs } = await measureFrame(() => {
        performance.mark('perf-highlight-start');
        updateEditorHighlight(force);
        performance.mark('perf-highlight-end');
        highlightMs = performance.measure('perf-highlight', 'perf-highlight-start', 'perf-highlight-end').duration;
        // Scroll event của bước đặt scrollTop xếp thêm một rAF tô màu trùng (app thật đã gộp vào rAF input);
        // bỏ để tail chỉ còn layout/paint.
        cancelScheduledEditorHighlight();
    });
    return {
        nativeMs,
        handlerMs,
        highlightMs,
        renderMs: tailMs,
        totalMs: nativeMs + handlerMs + highlightMs + tailMs
    };
}

function resetCounters() {
    highlightPerf.build = 0;
    highlightPerf.edited = 0;
    highlightPerf.editFailed = 0;
    highlightPerf.paintCalls = 0;
    highlightPerf.paintedChunks = 0;
    highlightPerf.chunks = 0;
}

function snapshotCounters(rows, scenario, mode) {
    rows.push({
        chars: markdownInput.value.length,
        scenario,
        mode,
        build: highlightPerf.build,
        'edit ok': highlightPerf.edited,
        'edit false': highlightPerf.editFailed,
        'paint calls': highlightPerf.paintCalls,
        chunks: highlightPerf.chunks,
        'painted/call': highlightPerf.paintCalls ? round1(highlightPerf.paintedChunks / highlightPerf.paintCalls) : 0
    });
}

async function measureTyping(typingRows, counterRows) {
    for (const mode of MODES) {
        resetCounters();
        for (const isolation of ISOLATIONS) {
            setIsolation(isolation);
            for (const [label, at] of [['mid', () => Math.floor(markdownInput.value.length / 2)], ['end', () => markdownInput.value.length]]) {
                const samples = [];
                for (let run = 0; run < RUNS; run++) {
                    samples.push(await measureKeystroke(at(), mode.force));
                    await settle(50); // đủ cho rAF tô màu thừa của phím trước
                }
                typingRows.push({
                    chars: markdownInput.value.length,
                    mode: mode.label,
                    isolation: isolation.label,
                    pos: label,
                    'native (ms)': round1(median(samples.map((s) => s.nativeMs))),
                    'handler (ms)': round1(median(samples.map((s) => s.handlerMs))),
                    'highlight (ms)': round1(median(samples.map((s) => s.highlightMs))),
                    'render (ms)': round1(median(samples.map((s) => s.renderMs))),
                    'total (ms)': round1(median(samples.map((s) => s.totalMs)))
                });
            }
        }
        // Trả full trước khi chờ: render 300ms của phím cuối phải chạy đủ layout/paint cho LoAF thấy.
        setIsolation(ISOLATIONS[0]);
        snapshotCounters(counterRows, 'typing', mode.label);
        // Render 300ms + lưu phiên 400-600ms của phím cuối xong trước mode kế.
        await settle(800);
    }
}

let dragSkippedWarned = false;

// Kéo divider bằng PointerEvent như người dùng. Mỗi pointermove đổi --split-size; ResizeObserver
// xếp tô màu cho khung KẾ, nên frameMs của khung đó gồm highlight + layout + paint của lượt trước.
async function measureDividerDrag(force) {
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
        // Force: bỏ highlight tăng dần RO xếp cho lượt trước, dựng lại cả lớp trong khung đo
        // (đọc clientWidth ép layout theo bề rộng mới).
        if (force) cancelScheduledEditorHighlight();
        const { frameMs } = await measureFrame(force ? () => updateEditorHighlight(true) : null);
        frames.push(frameMs);
    }
    paneResizer.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
    if (force) cancelScheduledEditorHighlight();
    // Khung cuối chạy nốt highlight mà RO xếp cho pointermove cuối (đường tăng dần).
    else frames.push((await measureFrame(null)).frameMs);
    return frames;
}

async function measureDragMatrix(dragRows, counterRows) {
    for (const mode of MODES) {
        resetCounters();
        for (const isolation of ISOLATIONS) {
            setIsolation(isolation);
            const frames = await measureDividerDrag(mode.force);
            dragRows.push({
                chars: markdownInput.value.length,
                mode: mode.label,
                isolation: isolation.label,
                'frame median (ms)': frames ? round1(median(frames)) : 'skipped',
                'frame max (ms)': frames ? round1(Math.max(...frames)) : 'skipped',
                'frames >32ms': frames ? frames.filter((ms) => ms > 32).length : 'skipped'
            });
        }
        snapshotCounters(counterRows, 'drag', mode.label);
    }
    setIsolation(ISOLATIONS[0]);
}

// Long animation frame chỉ có ở khung >50ms: đủ để thấy render 300ms và lưu session,
// không thấy khung nhanh. Entry có invoker của từng script (vd. TimerHandler:setTimeout).
function startLoafObserver(entries) {
    if (typeof PerformanceObserver === 'undefined'
        || !PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame')) {
        console.warn('Perf: long-animation-frame không được hỗ trợ, bỏ phần chẩn đoán khung dài.');
        return null;
    }
    const observer = new PerformanceObserver((list) => entries.push(...list.getEntries()));
    observer.observe({ type: 'long-animation-frame' });
    return observer;
}

function collectLongFrames(chars, rows, entries, observer) {
    if (!observer) return;
    entries.push(...observer.takeRecords());
    for (const entry of entries) {
        const beforeRenderMs = entry.renderStart ? entry.renderStart - entry.startTime : 0;
        const rafMs = entry.renderStart && entry.styleAndLayoutStart
            ? entry.styleAndLayoutStart - entry.renderStart
            : 0;
        const scripts = entry.scripts || [];
        const longest = scripts.length ? scripts.reduce((a, b) => (b.duration > a.duration ? b : a)) : null;
        rows.push({
            chars,
            'start (ms)': round1(entry.startTime),
            'duration (ms)': round1(entry.duration),
            'before render (ms)': round1(beforeRenderMs),
            'rAF->style/layout (ms)': round1(rafMs),
            'style/layout+paint (ms)': round1(Math.max(entry.duration - beforeRenderMs - rafMs, 0)),
            'blocking (ms)': round1(entry.blockingDuration || 0),
            'longest script': longest ? `${round1(longest.duration)} ${longest.invoker}` : ''
        });
    }
    entries.length = 0;
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
    const viewBefore = viewItems.find((item) => item.classList.contains('active'))?.dataset.view || 'split';
    const activeBefore = getActiveTab();
    const rows = [];
    const phaseRows = [];
    const typingRows = [];
    const dragRows = [];
    const counterRows = [];
    const loafRows = [];
    const loafEntries = [];
    let loafObserver = null;

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
        highlightPerf.enabled = true;
        loafObserver = startLoafObserver(loafEntries);

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
                await settle(0);
            }

            // Cuộn: đo đúng đường cuộn thật — chỉ lô ở hai mép được tô lại.
            // Không force: force dựng lại cả lớp nên con số sẽ là đường sửa văn bản, không phải đường cuộn.
            const scrollable = markdownInput.scrollHeight - markdownInput.clientHeight;
            const scrollTimes = [];
            for (let run = 0; run < RUNS; run++) {
                const start = performance.now();
                markdownInput.scrollTop = Math.round(scrollable * (run % 2 === 0 ? 0.85 : 0.15));
                editorHighlight.scrollTop = markdownInput.scrollTop;
                updateEditorHighlight();
                void editorHighlightCode.offsetHeight;
                scrollTimes.push(performance.now() - start);
                await settle(0);
            }

            rows.push({
                chars: markdownInput.value.length,
                'render median (ms)': round1(median(renderTimes)),
                'render max (ms)': round1(Math.max(...renderTimes)),
                'highlight median (ms)': round1(median(highlightTimes)),
                'scroll median (ms)': round1(median(scrollTimes)),
                'scroll max (ms)': round1(Math.max(...scrollTimes))
            });

            await measureTyping(typingRows, counterRows);
            await measureDragMatrix(dragRows, counterRows);
            await measurePhases(size, phaseRows);
            collectLongFrames(size, loafRows, loafEntries, loafObserver);
        }
    } catch (err) {
        console.error('Perf check failed:', err);
        showToast(`Perf check failed: ${err && err.message ? err.message : err}`);
        return;
    } finally {
        highlightPerf.enabled = false;
        if (loafObserver) {
            loafEntries.push(...loafObserver.takeRecords());
            loafObserver.disconnect();
        }
        setIsolation(ISOLATIONS[0]);
        markdownInput.readOnly = false;
        // remember: false để tab đo không lọt vào Ctrl+Shift+T.
        await closeTab(temp.id, { force: true, remember: false });
        if (activeBefore) switchTab(activeBefore.id);
        // Trả view sau khi đã về tab thật để preview render đúng nội dung người dùng.
        if (viewBefore !== 'split') {
            viewItems.find((item) => item.dataset.view === viewBefore).click();
        }
    }

    // Median là số chính; max cho thấy mức tệ nhất. Không đặt ngưỡng PASS/FAIL vì ms phụ thuộc máy.
    console.log(`Perf check: ${DOC_SIZES.length} document sizes, ${RUNS} runs each (median).`);
    console.table(rows);
    console.log('Typing: native = setRangeText + ép layout, handler = listener input, highlight = callback trong rAF, render = style+layout+paint sau callback:');
    console.table(typingRows);
    console.log('Divider drag: frame = đầu khung rAF -> sau paint (gồm highlight + layout + paint):');
    console.table(dragRows);
    console.log('Highlight layer counters:');
    console.table(counterRows);
    console.log('Phases inside renderMarkdown (cột marked.parse đã trừ KaTeX):');
    console.table(phaseRows);
    if (loafRows.length) {
        console.log('Long animation frames (>50ms): before render = renderStart - startTime; rAF->style/layout = styleAndLayoutStart - renderStart:');
        console.table(loafRows);
    } else {
        console.log('Long animation frames (>50ms): none.');
    }
    showToast(`Perf: ${DOC_SIZES.length} sizes × ${ISOLATIONS.length} configs (see console.table)`);
}
