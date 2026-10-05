// js/core/toast.js — Thông báo nhỏ (toast) ở góc màn hình.

import { toast } from './dom.js';

let toastTimer = null;

export function showToast(message) {
    toast.textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.classList.add('hidden');
    }, 2500);
}
