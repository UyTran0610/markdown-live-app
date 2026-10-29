// js/dev/perfcheck.js — Đo hiệu năng render preview + tô màu editor + cuộn trang, mở app với ?perf.

import { editorHighlight, editorHighlightCode, markdownInput, previewOutput, viewItems } from '../core/dom.js';
import { showToast } from '../core/toast.js';
import { editorHistory } from '../editor/history.js';
import { updateEditorHighlight } from '../editor/highlight.js';
import { syncEditorAfterChange } from '../editor/sync.js';
import { renderMarkdown, whenMermaidIdle } from '../preview/render.js';

// 400k vượt ngưỡng 300k nên đo luôn nhánh preview lớn (bỏ hljs). Sửa danh sách để đo mức khác.
const DOC_SIZES = [20000, 100000, 200000, 400000];
const RUNS = 3;

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

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

function round1(value) {
    return Math.round(value * 10) / 10;
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

            // Cuộn: cả stack thật của một bước cuộn phải dựng lại cửa sổ tô màu.
            // force: nếu tài liệu chưa đủ cao để nhảy ra ngoài vùng phủ thì cache sẽ bỏ qua lượt đo.
            const scrollable = markdownInput.scrollHeight - markdownInput.clientHeight;
            const scrollTimes = [];
            for (let run = 0; run < RUNS; run++) {
                let start = performance.now();
                markdownInput.scrollTop = Math.round(scrollable * (run % 2 === 0 ? 0.85 : 0.15));
                editorHighlight.scrollTop = markdownInput.scrollTop;
                updateEditorHighlight(true);
                void editorHighlightCode.offsetHeight;
                scrollTimes.push(performance.now() - start);
                await new Promise((resolve) => setTimeout(resolve, 0));
            }

            rows.push({
                chars: markdownInput.value.length,
                'render median (ms)': round1(median(renderTimes)),
                'render max (ms)': round1(Math.max(...renderTimes)),
                'highlight median (ms)': round1(median(highlightTimes)),
                'scroll median (ms)': round1(median(scrollTimes)),
                'scroll max (ms)': round1(Math.max(...scrollTimes))
            });
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
    showToast(`Perf: ${DOC_SIZES.length} sizes measured (see console.table)`);
}
