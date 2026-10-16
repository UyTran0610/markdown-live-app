// js/editor/sync.js — Đồng bộ sau mỗi thay đổi editor: đếm ký tự, tô màu, render preview, ghi vào store, lưu phiên.

import { charCounter, markdownInput } from '../core/dom.js';
import { debounce } from '../core/utils.js';
import { cacheActivePreview, saveSession, updateActiveContent } from '../io/documents.js';
import { scheduleEditorHighlight } from './highlight.js';
import { renderMarkdown } from '../preview/render.js';

// Chế độ Editor ẩn hẳn preview-pane (layout.css): render lúc đó là việc vô ích, mỗi lần gõ đều
// parse lại cả tài liệu cho một thứ không ai nhìn thấy. Lúc chuyển sang chế độ có preview,
// view-mode gọi renderActivePreview() để bù.
function renderAndCache() {
    if (document.body.classList.contains('view-editor')) return;
    renderMarkdown();
    cacheActivePreview();
}

const debouncedRender = debounce(renderAndCache, 300);

const debouncedSaveSession = debounce(saveSession, 400);

// Mọi thay đổi qua applyEditorChange (Enter, Tab, nút format, hộp thoại, phím tắt) đều đi qua đây nên
// lưu bộ nhớ tạm ngay, không chỉ nhờ 'input'; nếu không chỉ ghi khi ẩn cửa sổ và crash / kill cứng
// là mất.
export function syncEditorAfterChange() {
    charCounter.textContent = `${markdownInput.value.length} characters`;
    scheduleEditorHighlight();
    updateActiveContent(markdownInput.value);
    debouncedRender();
    debouncedSaveSession();
}