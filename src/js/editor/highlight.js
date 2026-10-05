// js/editor/highlight.js — Lớp tô màu cú pháp phía sau textarea (cập nhật theo từng khung hình).

import { editorHighlightCode, markdownInput } from '../core/dom.js';
import { highlightMarkdown } from './syntax/block.js';

// ponytail: quá ngưỡng thì dùng text thô (1 text node) thay vì ~24 regex/dòng mỗi khung hình. KHÔNG được
// bỏ hẳn lớp này vì #markdown-input có color:transparent (không có highlight thì chữ biến mất).
// nâng cấp sau: highlight lười (chỉ vùng nhìn thấy) thay vì cả tài liệu.
const EDITOR_HIGHLIGHT_MAX_CHARS = 300000;

export function updateEditorHighlight() {
    const text = markdownInput.value;
    if (text.length > EDITOR_HIGHLIGHT_MAX_CHARS) {
        editorHighlightCode.textContent = text + '\n';
        return;
    }
    editorHighlightCode.innerHTML = highlightMarkdown(text) + '\n';
}

// Gộp các lần gọi liên tiếp (gõ nhanh) thành 1 lần tô màu mỗi khung hình, không chặn handler 'input'.
let editorHighlightRAF = null;

export function scheduleEditorHighlight() {
    if (editorHighlightRAF !== null) return;
    editorHighlightRAF = requestAnimationFrame(() => {
        editorHighlightRAF = null;
        updateEditorHighlight();
    });
}
