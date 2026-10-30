// js/editor/highlight.js — Lớp tô màu cú pháp phía sau textarea (chỉ tô vùng nhìn thấy).

import { editorHighlight, editorHighlightCode, markdownInput } from '../core/dom.js';
import { highlightMarkdown } from './syntax/block.js';

// Phải khớp #markdown-input / #editor-highlight trong css/editor.css.
const LINE_HEIGHT = 26;
const PAD_Y = 20;
// Tô thêm mỗi phía chừng này viewport: cuộn thường không phải dựng lại mà vẫn có màu sẵn.
const OVERSCAN = 1.5;
// Lớp chia lô theo dòng, mỗi lô một block (xem #editor-highlight-code > span trong css/editor.css):
// đổi cửa sổ chỉ layout lại lô ở hai mép, không ngắt dòng lại cả tài liệu (phần lớn độ trễ cuộn).
const CHUNK_LINES = 128;

// Đỉnh từng dòng và các lô hiện tại; chỉ dựng lại khi text hoặc bề rộng đổi.
let lastText = null;
let lastWidth = 0;
let tops = [];
let lineCount = 0;
let chunks = [];
// Khoảng lô đang được tô; -1 = chưa tô gì.
let paintedFrom = -1;
let paintedTo = -1;

// Đỉnh từng dòng (px) suy từ số dòng hiển thị thật của textarea; phần tử cuối là đáy tài liệu.
// Chỉ dùng để CHỌN cửa sổ: ước lượng lệch thì thiếu màu chứ không lệch chữ, vì ngoài cửa sổ là text thô.
function lineTops(lines, totalRows) {
    let chars = 0;
    for (const line of lines) chars += line.length;
    // Một dòng hiển thị chứa trung bình wrapWidth ký tự; dòng ngắn vẫn chiếm trọn 1 dòng hiển thị.
    const wrapWidth = Math.max(chars / Math.max(totalRows - lines.length / 2, 1), 1);
    let rows = 0;
    for (const line of lines) rows += Math.ceil(Math.max(line.length, 1) / wrapWidth);
    const rowHeight = (totalRows / Math.max(rows, 1)) * LINE_HEIGHT;
    const tops = new Array(lines.length + 1);
    let y = 0;
    for (let i = 0; i < lines.length; i++) {
        tops[i] = y;
        y += Math.ceil(Math.max(lines[i].length, 1) / wrapWidth) * rowHeight;
    }
    tops[lines.length] = y;
    return tops;
}

// Dòng chứa pixel y (kẹp trong [0, count - 1]).
function lineAt(tops, y, count) {
    let lo = 0;
    let hi = count - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (tops[mid + 1] <= y) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

// Cửa sổ có thể bắt đầu giữa fence / HTML comment / khối toán nên phải biết trạng thái khối ở đầu cửa sổ.
// Thứ tự ưu tiên giống vòng lặp trong highlightMarkdown: comment -> fence -> toán.
const BLOCK_MARK = /^[ \t]{0,3}(`{3,}|~{3,})|(<!--)|(-->)|^[ \t]*(\$\$)[ \t]*$/gm;

// shortcut: bỏ qua indented code và fence thụt bằng tab ở đầu cửa sổ; lệch thì chỉ sai màu vài dòng.
function blockStateBefore(text, offset) {
    const state = { inFence: false, inHtmlComment: false, inMathBlock: false };
    BLOCK_MARK.lastIndex = 0;
    let mark;
    while ((mark = BLOCK_MARK.exec(text)) !== null && mark.index < offset) {
        if (mark[1]) {
            if (!state.inHtmlComment) state.inFence = !state.inFence;
        } else if (mark[2]) {
            if (!state.inFence && !state.inMathBlock) state.inHtmlComment = true;
        } else if (mark[3]) {
            state.inHtmlComment = false;
        } else if (!state.inFence && !state.inHtmlComment) {
            state.inMathBlock = !state.inMathBlock;
        }
    }
    return state;
}

// Toàn bộ tài liệu vẫn nằm trong lớp (đúng thứ tự) để wrap và caret khớp textarea;
// chỉ có lô quanh viewport là HTML đã tô, phần còn lại là text thô.
function buildLayer(text) {
    const lines = text.split('\n');
    const totalRows = Math.max(1, Math.round((markdownInput.scrollHeight - PAD_Y * 2) / LINE_HEIGHT));
    tops = lineTops(lines, totalRows);
    lineCount = lines.length;
    chunks = [];
    let start = 0;
    for (let i = 0; i < lines.length; i += CHUNK_LINES) {
        // '\n' cuối lô kết thúc dòng cuối của lô; block kế tiếp bắt đầu dòng mới nên không thêm dòng trống.
        const body = lines.slice(i, i + CHUNK_LINES).join('\n') + '\n';
        const el = document.createElement('span');
        el.textContent = body;
        chunks.push({ el, body, start });
        start += body.length;
    }
    editorHighlightCode.replaceChildren(...chunks.map((chunk) => chunk.el));
    paintedFrom = -1;
    paintedTo = -1;
}

// Tô các lô trong [from, to], trả các lô rời vùng về text thô. Chỉ lô đổi trạng thái mới bị layout lại.
function paint(text, from, to) {
    for (let i = Math.max(paintedFrom, 0); i <= paintedTo; i++) {
        if (i < from || i > to) chunks[i].el.textContent = chunks[i].body;
    }
    for (let i = from; i <= to; i++) {
        if (i < paintedFrom || i > paintedTo) {
            chunks[i].el.innerHTML = highlightMarkdown(
                chunks[i].body,
                chunks[i].start > 0 ? blockStateBefore(text, chunks[i].start) : undefined
            );
        }
    }
    paintedFrom = from;
    paintedTo = to;
}

export function updateEditorHighlight(force = false) {
    const text = markdownInput.value;
    const width = markdownInput.clientWidth;
    // Pane ẩn (chế độ Preview): mọi số đo bằng 0, ResizeObserver gọi lại khi pane hiện.
    if (!width) return;
    // Text hoặc bề rộng đổi thì wrap đổi; chỉ cuộn thì giữ nguyên các lô đã dựng.
    if (force || text !== lastText || width !== lastWidth) {
        lastText = text;
        lastWidth = width;
        buildLayer(text);
    }

    const scrollTop = markdownInput.scrollTop;
    const viewHeight = markdownInput.clientHeight;
    const top = scrollTop - PAD_Y;
    const overscan = viewHeight * OVERSCAN;
    const from = Math.floor(lineAt(tops, top - overscan, lineCount) / CHUNK_LINES);
    const to = Math.min(Math.floor(lineAt(tops, top + viewHeight + overscan, lineCount) / CHUNK_LINES), chunks.length - 1);
    // Khoảng lô không đổi thì không đụng DOM: cuộn trong cùng vài lô là miễn phí.
    if (from !== paintedFrom || to !== paintedTo) paint(text, from, to);

    // Thay nội dung làm lớp này mất vị trí cuộn; textarea là chân lý.
    editorHighlight.scrollTop = scrollTop;
    editorHighlight.scrollLeft = markdownInput.scrollLeft;
}

// Gộp các lần gọi liên tiếp thành 1 lần tô màu mỗi khung hình, không chặn handler input.
let editorHighlightRAF = null;

export function scheduleEditorHighlight() {
    if (editorHighlightRAF !== null) return;
    editorHighlightRAF = requestAnimationFrame(() => {
        editorHighlightRAF = null;
        updateEditorHighlight();
    });
}

// Perfcheck dùng: hủy rAF đang treo để giờ đo bắt đầu rỗng rAF, không bị guard nuốt mất tô màu.
export function cancelScheduledEditorHighlight() {
    if (editorHighlightRAF === null) return;
    cancelAnimationFrame(editorHighlightRAF);
    editorHighlightRAF = null;
}

export function initEditorHighlight() {
    // Cuộn không đổi nội dung thì cửa sổ tô màu phải trôi theo; guard trong update lo phần bỏ qua.
    markdownInput.addEventListener('scroll', scheduleEditorHighlight);
    // Đổi bề rộng (kéo divider, đổi view, maximize) là đổi chỗ wrap của cả hai lớp.
    new ResizeObserver(scheduleEditorHighlight).observe(markdownInput);
}
