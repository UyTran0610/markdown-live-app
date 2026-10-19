// js/editor/sync.js — Đồng bộ sau mỗi thay đổi editor: đếm ký tự, tô màu, render preview, ghi vào store, lưu phiên.

import { charCounter, markdownInput } from '../core/dom.js';
import { debounce } from '../core/utils.js';
import { cacheActivePreview, saveSession, updateActiveContent } from '../io/documents.js';
import { scheduleEditorHighlight } from './highlight.js';
import { renderMarkdown } from '../preview/render.js';

// Editor ẩn preview nên bỏ render; view-mode gọi renderActivePreview() khi chuyển sang có preview.
function renderAndCache() {
    if (document.body.classList.contains('view-editor')) return;
    renderMarkdown();
    cacheActivePreview();
}

const debouncedRender = debounce(renderAndCache, 300);

// Giãn nhịp lưu session theo kích thước (400ms + 200ms/250k, tối đa 1.5s): 5MB ghi lại ở 400ms là quá đắt.
const SESSION_BASE_DELAY = 400;
const SESSION_SIZE_STEP = 250000;
const SESSION_MAX_DELAY = 1500;
let sessionSaveTimer = null;

function scheduleSessionSave() {
    const delay = Math.min(
        SESSION_BASE_DELAY + Math.floor(markdownInput.value.length / SESSION_SIZE_STEP) * 200,
        SESSION_MAX_DELAY
    );
    clearTimeout(sessionSaveTimer);
    sessionSaveTimer = setTimeout(() => { sessionSaveTimer = null; saveSession(); }, delay);
}

// Mọi đường sửa đều qua đây nên lưu nháp ngay, không chỉ nhờ 'input'; crash là mất.
export function syncEditorAfterChange() {
    charCounter.textContent = `${markdownInput.value.length} characters`;
    scheduleEditorHighlight();
    updateActiveContent(markdownInput.value);
    debouncedRender();
    scheduleSessionSave();
}