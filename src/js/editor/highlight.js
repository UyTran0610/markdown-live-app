// js/editor/highlight.js — Lớp tô màu cú pháp phía sau textarea (chỉ tô vùng nhìn thấy).

import { editorHighlight, editorHighlightCode, markdownInput } from '../core/dom.js';
import { highlightMarkdown } from './syntax/block.js';

// Phải khớp #markdown-input / #editor-highlight trong css/editor.css.
const LINE_HEIGHT = 26;
const PAD_Y = 20;
// Tô thêm mỗi phía chừng này viewport: cuộn thường không phải dựng lại mà vẫn có màu sẵn.
const OVERSCAN = 1.5;

// Vùng đang được tô (px, tính từ đỉnh dòng đầu) để bỏ qua lượt không cần dựng lại.
let lastText = null;
let lastWidth = 0;
let coveredFrom = 0;
let coveredTo = 0;

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

// Offset ký tự của dòng thứ index (index === lines.length là hết tài liệu).
function offsetOf(lines, index) {
    let offset = 0;
    for (let i = 0; i < index; i++) offset += lines[i].length + 1;
    return offset;
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

export function updateEditorHighlight(force = false) {
    const text = markdownInput.value;
    const width = markdownInput.clientWidth;
    // Pane ẩn (chế độ Preview): mọi số đo bằng 0, ResizeObserver gọi lại khi pane hiện.
    if (!width) return;
    const scrollTop = markdownInput.scrollTop;
    const viewHeight = markdownInput.clientHeight;
    const top = scrollTop - PAD_Y;
    const bottom = top + viewHeight;
    if (!force && text === lastText && width === lastWidth && coveredFrom <= top && coveredTo >= bottom) return;

    const lines = text.split('\n');
    const totalRows = Math.max(1, Math.round((markdownInput.scrollHeight - PAD_Y * 2) / LINE_HEIGHT));
    const tops = lineTops(lines, totalRows);
    const overscan = viewHeight * OVERSCAN;
    const from = lineAt(tops, top - overscan, lines.length);
    const to = lineAt(tops, bottom + overscan, lines.length);
    const start = offsetOf(lines, from);
    // Cửa sổ gồm các dòng nguyên: bỏ '\n' cuối, trừ khi đó là dòng cuối tài liệu.
    const end = to + 1 < lines.length ? offsetOf(lines, to + 1) - 1 : text.length;

    const painted = document.createElement('span');
    painted.innerHTML = highlightMarkdown(text.slice(start, end), from > 0 ? blockStateBefore(text, start) : undefined);
    // Ngoài cửa sổ là text thô nhưng đủ và đúng thứ tự: wrap và vị trí caret luôn khớp textarea.
    editorHighlightCode.replaceChildren(
        document.createTextNode(text.slice(0, start)),
        painted,
        document.createTextNode(text.slice(end) + '\n')
    );
    // Thay nội dung làm lớp này mất vị trí cuộn; textarea là chân lý.
    editorHighlight.scrollTop = scrollTop;
    editorHighlight.scrollLeft = markdownInput.scrollLeft;

    lastText = text;
    lastWidth = width;
    // Cửa sổ chạm đầu/cuối tài liệu thì coi như phủ vô cực, nếu không mép tài liệu sẽ dựng lại mỗi frame.
    coveredFrom = from === 0 ? -Infinity : tops[from];
    coveredTo = to + 1 < lines.length ? tops[to + 1] : Infinity;
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

export function initEditorHighlight() {
    // Cuộn không đổi nội dung thì cửa sổ tô màu phải trôi theo; guard trong update lo phần bỏ qua.
    markdownInput.addEventListener('scroll', scheduleEditorHighlight);
    // Đổi bề rộng (kéo divider, đổi view, maximize) là đổi chỗ wrap của cả hai lớp.
    new ResizeObserver(scheduleEditorHighlight).observe(markdownInput);
}
