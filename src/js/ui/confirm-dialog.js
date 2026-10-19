// js/ui/confirm-dialog.js — Hộp thoại hỏi cho quyết định không thể đảo ngược (đóng tab chưa lưu,
// file ngoài đã sửa, ghi đè file tab khác). Thay confirm() vì cần nút Lưu.
// Trả Promise: id nút được chọn, hoặc null khi huỷ. Chỉ một hộp thoại tại một thời điểm.

import {
    confirmCancelBtn,
    confirmDialog,
    confirmMessage,
    confirmPrimaryBtn,
    confirmSecondaryBtn,
    confirmTitle
} from '../core/dom.js';

// Thứ tự primary | secondary | cancel; Cancel cuối để Tab kết thúc ở nút an toàn.
let settle = null;
let returnFocus = null;

export function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (ch) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
}

function closeWith(value) {
    const done = settle;
    settle = null;
    confirmDialog.classList.add('hidden');
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
    returnFocus = null;
    if (done) done(value);
}

function fill(btn, action) {
    btn.textContent = action.label;
    btn.dataset.action = action.id;
    btn.hidden = false;
}

// Tối đa 2 nút quyết định + Cancel luôn có; trả null nếu Esc hoặc bấm ra ngoài.
export function confirmAction({ title, message, actions, cancelLabel = 'Cancel' }) {
    if (settle) closeWith(null);

    confirmTitle.textContent = title;
    // innerHTML để câu hỏi xuống dòng được; tên file đều qua escapeHtml.
    confirmMessage.innerHTML = escapeHtml(message).replace(/\n/g, '<br>');

    const [primary, secondary] = actions;
    fill(confirmPrimaryBtn, primary);
    if (secondary) {
        fill(confirmSecondaryBtn, secondary);
    } else {
        confirmSecondaryBtn.hidden = true;
        delete confirmSecondaryBtn.dataset.action;
    }
    confirmCancelBtn.textContent = cancelLabel;

    returnFocus = document.activeElement;
    confirmDialog.classList.remove('hidden');
    confirmPrimaryBtn.focus();

    return new Promise((resolve) => {
        settle = resolve;
    });
}

export function initConfirmDialog() {
    [confirmPrimaryBtn, confirmSecondaryBtn].forEach((btn) => {
        btn.addEventListener('click', () => closeWith(btn.dataset.action || null));
    });
    confirmCancelBtn.addEventListener('click', () => closeWith(null));

    confirmDialog.addEventListener('mousedown', (e) => {
        if (e.target === confirmDialog) closeWith(null);
    });

    // Enter = primary, Esc = huỷ, Tab giữ vòng focus; chặn phím tắt toàn cục lọt xuống.
    confirmDialog.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
            e.preventDefault();
            closeWith(null);
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            if (!confirmPrimaryBtn.hidden) confirmPrimaryBtn.click();
            return;
        }
        if (e.key !== 'Tab') return;
        e.preventDefault();
        const focusables = Array.from(confirmDialog.querySelectorAll('button')).filter((b) => !b.hidden);
        if (!focusables.length) return;
        const idx = focusables.indexOf(document.activeElement);
        const next = e.shiftKey
            ? focusables[(idx - 1 + focusables.length) % focusables.length]
            : focusables[(idx + 1) % focusables.length];
        if (next) next.focus();
    });
}