// js/editor/sync.js — Đồng bộ sau mỗi thay đổi editor: đếm ký tự, tô màu, render preview, lưu nháp.

import { charCounter, markdownInput } from '../core/dom.js';
import { debounce } from '../core/utils.js';
import { scheduleEditorHighlight } from './highlight.js';
import { saveContentToStorage } from './storage.js';
import { renderMarkdown } from '../preview/render.js';

// Mọi thay đổi qua applyEditorChange (Enter, Tab, nút format, hộp thoại, phím tắt) đều đi qua đây nên
// lưu bộ nhớ tạm ngay, không chỉ nhờ 'input'; nếu không chỉ ghi khi beforeunload/visibilitychange và
// crash / kill cứng là mất.
export function syncEditorAfterChange() {
    charCounter.textContent = `${markdownInput.value.length} characters`;
    scheduleEditorHighlight();
    debouncedRender();
    debouncedSaveContent();
}

export const debouncedRender = debounce(renderMarkdown, 300);

export const debouncedSaveContent = debounce(saveContentToStorage, 400);
