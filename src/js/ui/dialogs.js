// js/ui/dialogs.js — Hộp thoại chèn Link và chọn kích thước bảng.

import {
    btnLink,
    linkCancelBtn,
    linkDialog,
    linkInsertBtn,
    linkTextInput,
    linkUrlInput,
    tableCancelBtn,
    tableColsInput,
    tableDialog,
    tableInsertBtn,
    tableRowsInput
} from '../core/dom.js';
import { focusEditor, getDocText, getView, replaceRange } from '../editor/cm.js';
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
    const v = getView();
    const sel = v.state.selection.main;
    const selected = sel.from !== sel.to ? v.state.sliceDoc(sel.from, sel.to) : '';
    linkTextInput.value = '';
    linkUrlInput.value = '';
    linkInsertBtn.disabled = true;
    if (selected) linkTextInput.value = selected;
    openDialog(linkDialog, selected ? linkUrlInput : linkTextInput);
}

export function openTableDialog() {
    // Luôn mở với 3x3, không giữ số của lần trước (dễ chèn nhầm kích thước cũ).
    tableColsInput.value = '3';
    tableRowsInput.value = '3';
    openDialog(tableDialog, tableColsInput);
}

function insertLinkFromDialog() {
    const url = normalizeLinkUrl(linkUrlInput.value);
    if (!url) return;
    const text = linkTextInput.value.trim();
    const v = getView();
    const sel = v.state.selection.main;
    const label = text || (sel.from !== sel.to ? v.state.sliceDoc(sel.from, sel.to) : url);
    // URL chứa khoảng trắng phải bọc trong < > theo cú pháp GFM.
    const urlPart = /\s/.test(url) ? '<' + url + '>' : url;
    const insert = '[' + escapeLinkText(label) + '](' + urlPart + ')';
    const caret = sel.from + insert.length;
    replaceRange(sel.from, sel.to, insert, caret, caret);
    closeDialogs();
    focusEditor();
}

function insertTableFromDialog() {
    const cols = Math.max(1, Math.min(99, parseInt(tableColsInput.value, 10) || 3));
    const rows = Math.max(1, Math.min(99, parseInt(tableRowsInput.value, 10) || 3));
    closeDialogs();
    focusEditor();
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

    // Enter = nút chính, Esc = đóng, Tab giữ vòng focus; chặn phím khác lọt xuống editor.
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
