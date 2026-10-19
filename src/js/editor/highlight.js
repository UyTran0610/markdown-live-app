// js/editor/highlight.js — Lớp tô màu cú pháp phía sau textarea (cập nhật theo từng khung hình).

import { editorHighlightCode, markdownInput } from '../core/dom.js';
import { highlightMarkdown } from './syntax/block.js';

// ponytail: quá ngưỡng thì dùng text thô thay vì ~24 regex/dòng mỗi frame; KHÔNG bỏ hẳn lớp này
// vì #markdown-input có color:transparent. nâng cấp sau: highlight lười (chỉ vùng nhìn thấy).
const EDITOR_HIGHLIGHT_MAX_CHARS = 300000;

export function updateEditorHighlight() {
    const text = markdownInput.value;
    if (text.length > EDITOR_HIGHLIGHT_MAX_CHARS) {
        editorHighlightCode.textContent = text + '\n';
        return;
    }
    editorHighlightCode.innerHTML = highlightMarkdown(text) + '\n';
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
