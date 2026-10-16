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

// Lưu session: không dùng debounce cố định vì tài liệu lớn phải stringify + ghi cả tài liệu, và ở
// 400 ms thì một file 5 MB bị ghi lại liên tục trong lúc gõ. Giãn nhịp theo kích thước (400 ms +
// 200 ms mỗi 250k ký tự, tối đa 1.5 s) — đủ nhanh để không mất chữ khi crash, đủ chậm để không
// đốt CPU vào việc ghi lại đúng thứ đã nằm trong IDB.
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

// Mọi thay đổi qua applyEditorChange (Enter, Tab, nút format, hộp thoại, phím tắt) đều đi qua đây nên
// lưu bộ nhớ tạm ngay, không chỉ nhờ 'input'; nếu không chỉ ghi khi ẩn cửa sổ và crash / kill cứng
// là mất.
export function syncEditorAfterChange() {
    charCounter.textContent = `${markdownInput.value.length} characters`;
    scheduleEditorHighlight();
    updateActiveContent(markdownInput.value);
    debouncedRender();
    scheduleSessionSave();
}