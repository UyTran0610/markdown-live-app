// js/ui/dialogs.js — Hộp thoại chèn Link và chọn kích thước bảng.

import {
    btnLink,
    linkCancelBtn,
    linkDialog,
    linkInsertBtn,
    linkTextInput,
    linkUrlInput,
    markdownInput,
    tableCancelBtn,
    tableColsInput,
    tableDialog,
    tableInsertBtn,
    tableRowsInput
} from '../core/dom.js';
import { applyEditorChange } from '../editor/edit.js';
import { insertTableBlock } from '../editor/format-actions.js';
import { escapeLinkText, normalizeLinkUrl } from '../editor/format-helpers.js';

let dialogReturnFocus = null;

function openDialog(overlay, focusTarget) {
    dialogReturnFocus = document.activeElement;
    overlay.classList.remove('hidden');
    focusTarget.focus();
    if (focusTarget.select) focusTarget.select();
}

export function closeDialogs() {
    linkDialog.classList.add('hidden');
    tableDialog.classList.add('hidden');
    linkTextInput.value = '';
    linkUrlInput.value = '';
    linkInsertBtn.disabled = true;
    if (dialogReturnFocus && document.contains(dialogReturnFocus)) dialogReturnFocus.focus();
    dialogReturnFocus = null;
}

function openLinkDialog() {
    const selStart = markdownInput.selectionStart;
    const selEnd = markdownInput.selectionEnd;
    const selected = selStart !== selEnd ? markdownInput.value.substring(selStart, selEnd) : '';
    linkTextInput.value = '';
    linkUrlInput.value = '';
    linkInsertBtn.disabled = true;
    if (selected) linkTextInput.value = selected;
    openDialog(linkDialog, selected ? linkUrlInput : linkTextInput);
}

export function openTableDialog() {
    openDialog(tableDialog, tableColsInput);
}

function insertLinkFromDialog() {
    const url = normalizeLinkUrl(linkUrlInput.value);
    if (!url) return;
    const text = linkTextInput.value.trim();
    const val = markdownInput.value;
    const selStart = markdownInput.selectionStart;
    const selEnd = markdownInput.selectionEnd;
    const label = text || (selStart !== selEnd ? val.substring(selStart, selEnd) : url);
    // URL chứa khoảng trắng phải bọc trong < > theo cú pháp GFM
    const urlPart = /\s/.test(url) ? '<' + url + '>' : url;
    const insert = '[' + escapeLinkText(label) + '](' + urlPart + ')';
    applyEditorChange(val.substring(0, selStart) + insert + val.substring(selEnd), selStart + insert.length, selStart + insert.length);
    closeDialogs();
    markdownInput.focus();
}

function insertTableFromDialog() {
    const cols = Math.max(1, Math.min(99, parseInt(tableColsInput.value, 10) || 3));
    const rows = Math.max(1, Math.min(99, parseInt(tableRowsInput.value, 10) || 3));
    closeDialogs();
    markdownInput.focus();
    insertTableBlock(cols, rows);
}

export function initDialogs() {
    btnLink.addEventListener('click', openLinkDialog);

    linkUrlInput.addEventListener('input', () => {
        linkInsertBtn.disabled = linkUrlInput.value.trim() === '';
    });

    linkInsertBtn.addEventListener('click', insertLinkFromDialog);

    linkCancelBtn.addEventListener('click', closeDialogs);

    tableInsertBtn.addEventListener('click', insertTableFromDialog);

    tableCancelBtn.addEventListener('click', closeDialogs);

    [linkDialog, tableDialog].forEach((overlay) => {
        overlay.addEventListener('mousedown', (e) => {
            if (e.target === overlay) closeDialogs();
        });
    });

    // Enter = nút chính, Esc = đóng, Tab giữ vòng focus; chặn mọi phím khác lọt xuống editor bên dưới.
    [linkDialog, tableDialog].forEach((overlay) => {
        overlay.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
                e.preventDefault();
                const primary = overlay.querySelector('.dialog-btn.primary');
                if (primary && !primary.disabled) primary.click();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeDialogs();
            } else if (e.key === 'Tab') {
                e.preventDefault();
                const focusables = Array.from(overlay.querySelectorAll('input, button'));
                const idx = focusables.indexOf(document.activeElement);
                const next = e.shiftKey
                    ? focusables[(idx - 1 + focusables.length) % focusables.length]
                    : focusables[(idx + 1) % focusables.length];
                if (next) next.focus();
            }
        });
    });
}
