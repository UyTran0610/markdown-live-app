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

// Render preview tốn 1.1–2.2s với tài liệu 200k–400k ký tự: chạy giữa lúc gõ sẽ cướp hết
// main thread và các phím gõ sau đó bị đơ. Giãn debounce theo độ dài tài liệu.
const RENDER_BASE_DELAY = 300;
const RENDER_SIZE_STEP = 100000;
const RENDER_STEP_DELAY = 150;
const RENDER_MAX_DELAY = 1000;

export function renderDelayFor(chars) {
    return Math.min(
        RENDER_BASE_DELAY + Math.floor(Math.max(chars, 0) / RENDER_SIZE_STEP) * RENDER_STEP_DELAY,
        RENDER_MAX_DELAY
    );
}

const debouncedRender = debounce(renderAndCache, () => renderDelayFor(markdownInput.value.length));

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