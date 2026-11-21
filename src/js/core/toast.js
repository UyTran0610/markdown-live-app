// js/core/toast.js — Thông báo nhỏ (toast) ở góc màn hình.

import { toast } from './dom.js';

let toastTimer = null;

// Tin ngắn giữ 2,5 s như cũ; tin dài (đường dẫn file .md-live.tmp, cảnh báo file hỏng)
// cần lâu hơn để người dùng kịp đọc và tìm file cứu.
const TOAST_MIN_MS = 2500;
const TOAST_MS_PER_CHAR = 60;
const TOAST_MAX_MS = 25000;

export function toastDuration(message, length = String(message || '').length) {
    return Math.min(TOAST_MAX_MS, Math.max(TOAST_MIN_MS, length * TOAST_MS_PER_CHAR));
}

export function showToast(message) {
    const text = String(message || '');
    toast.textContent = text;
    toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.classList.add('hidden');
    }, toastDuration(text));
}
