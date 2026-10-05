// js/editor/storage.js — Lưu / khôi phục nội dung editor vào localStorage.

import { markdownInput } from '../core/dom.js';
import { showToast } from '../core/toast.js';

export const CONTENT_STORAGE_KEY = 'markdown-live-content';

let quotaWarnedAt = 0;

export function saveContentToStorage() {
    try {
        localStorage.setItem(CONTENT_STORAGE_KEY, markdownInput.value);
    } catch (e) {
        const isQuota = e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014);
        const now = Date.now();
        if (isQuota && now - quotaWarnedAt > 10000) {
            quotaWarnedAt = now;
            showToast('Storage is full, new content may be lost when the app closes.');
        }
    }
}

export function initContentPersistence() {
    // Lưu ngay (không debounce) khi cửa sổ sắp đóng để không mất nội dung gõ cuối cùng.
    window.addEventListener('beforeunload', saveContentToStorage);

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            saveContentToStorage();
        }
    });
}
