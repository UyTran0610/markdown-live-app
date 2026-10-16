// js/ui/confirm-dialog.js — Hộp thoại hỏi cho quyết định không thể đảo ngược: đóng tab chưa lưu,
// file bên ngoài đã sửa, file bị xoá khỏi đĩa, ghi đè file của tab khác.
//
// Thay confirm() của WebView vì nó không có nút "Lưu" (người dùng phải hủy, lưu, rồi đóng lại) và
// trông như hộp thoại trình duyệt. Trả Promise: id của nút được chọn, hoặc null khi hủy.
//
// Một hộp thoại duy nhất cho mọi câu hỏi: gọi lồng nhau sẽ lấy đè câu trả lời của câu trước.

import {
    confirmCancelBtn,
    confirmDialog,
    confirmMessage,
    confirmPrimaryBtn,
    confirmSecondaryBtn,
    confirmTitle
} from '../core/dom.js';

// Đổi 3 nút cho đúng câu hỏi. Thứ tự trên màn hình: primary | secondary | cancel, và Cancel luôn
// cuối để Tab-traverse (mũi tên phải là next) kết thúc ở nút thoát an toàn.
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

// `actions`: tối đa 2 nút quyết định + Cancel luôn có sẵn. primary = `.dialog-btn.primary`,
// secondary = nút thường. Trả null nếu người dùng đóng bằng Esc / bấm ra ngoài.
export function confirmAction({ title, message, actions, cancelLabel = 'Cancel' }) {
    if (settle) closeWith(null);

    confirmTitle.textContent = title;
    // Chỉ nội dung app tự dựng (tên file do người dùng đặt cũng đi qua escapeHtml): innerHTML cho
    // phép xuống dòng trong câu hỏi dài mà textContent không có.
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

    // Enter = primary, Esc = hủy, Tab = khoá vòng focus. stopPropagation chặn phím tắt toàn cục
    // của editor lọt xuống dưới hộp thoại (giống dialogs.js).
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