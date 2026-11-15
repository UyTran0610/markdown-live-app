// js/editor/sync.js — Đồng bộ sau mỗi thay đổi editor: đếm ký tự, render preview, ghi vào store, lưu phiên.

import { setCharCount } from '../core/dom.js';
import { debounce } from '../core/utils.js';
import { cacheActivePreview, saveSession, updateActiveContent } from '../io/documents.js';
import { renderMarkdown } from '../preview/render.js';
import { getDocLength, setChangeHandler } from './cm.js';
import { refreshFindResults } from './find.js';

// Editor ẩn preview nên bỏ render; view-mode gọi renderActivePreview() khi chuyển sang có preview.
function renderAndCache() {
    if (document.body.classList.contains('view-editor')) return;
    renderMarkdown();
    cacheActivePreview();
}

// Preview của tài liệu lớn tốn hàng trăm ms (phần lớn là layout của preview, không phải
// lexer), nên giãn debounce theo độ dài: gõ liên tục không render, chỉ render sau khi ngừng.
const RENDER_BASE_DELAY = 300;
const RENDER_SIZE_STEP = 100000;
const RENDER_STEP_DELAY = 50;
const RENDER_MAX_DELAY = 600;

export function renderDelayFor(chars) {
    return Math.min(
        RENDER_BASE_DELAY + Math.floor(Math.max(chars, 0) / RENDER_SIZE_STEP) * RENDER_STEP_DELAY,
        RENDER_MAX_DELAY
    );
}

const debouncedRender = debounce(renderAndCache, () => renderDelayFor(getDocLength()));

// Dừng gõ 2s mới lưu: gõ liên tục không ghi, browser rảnh mới ghi để không cướp frame.
const SESSION_IDLE_DELAY = 2000;
const SESSION_IDLE_TIMEOUT = 5000;
let sessionIdleTimer = null;
let sessionIdleHandle = null;

function scheduleSessionSave() {
    if (sessionIdleTimer !== null) clearTimeout(sessionIdleTimer), sessionIdleTimer = null;
    if (sessionIdleHandle !== null && window.cancelIdleCallback) window.cancelIdleCallback(sessionIdleHandle), sessionIdleHandle = null;
    sessionIdleTimer = setTimeout(() => {
        sessionIdleTimer = null;
        const save = () => { sessionIdleHandle = null; saveSession(); };
        if (window.requestIdleCallback) sessionIdleHandle = window.requestIdleCallback(save, { timeout: SESSION_IDLE_TIMEOUT });
        else save();
    }, SESSION_IDLE_DELAY);
}

// Mọi đường sửa đều đi qua updateListener của CodeMirror nên đều xếp lưu nháp, không chỉ nhờ phím gõ.
// Chỉ đọc doc.length (O(1)); chuỗi dựng lười ở các điểm cần.
export function handleEditorChange(update) {
    setCharCount(update.state.doc.length);
    updateActiveContent(update.state);
    // Hộp thoại tìm đang mở: kết quả cũ hỏng theo nội dung mới.
    refreshFindResults();
    debouncedRender();
    scheduleSessionSave();
}

export function initEditorSync() {
    setChangeHandler(handleEditorChange);
}
