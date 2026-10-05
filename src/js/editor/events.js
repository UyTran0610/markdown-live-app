// js/editor/events.js — Sự kiện bàn phím (phím tắt, auto-close ngoặc) và sự kiện nhập liệu của editor.

import { charCounter, markdownInput } from '../core/dom.js';
import {
    applyEditorChange,
    handleEditorDuplicate,
    handleEditorEnter,
    handleEditorLink,
    handleEditorTab,
    wrapOrToggleFormat
} from './edit.js';
import { scheduleEditorHighlight } from './highlight.js';
import { editorHistory } from './history.js';
import { debouncedRender, debouncedSaveContent } from './sync.js';

export function initEditorEvents() {
    markdownInput.addEventListener('keydown', (e) => {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const isCmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
        const key = e.key;

        if (isCmdOrCtrl) {
            const lowerKey = key.toLowerCase();

            if (lowerKey === 'z' && !e.shiftKey) {
                e.preventDefault();
                editorHistory.undo(markdownInput);
                return;
            }

            if (lowerKey === 'y' || (lowerKey === 'z' && e.shiftKey)) {
                e.preventDefault();
                editorHistory.redo(markdownInput);
                return;
            }

            if (lowerKey === 'b') {
                e.preventDefault();
                wrapOrToggleFormat('**');
                return;
            }

            if (lowerKey === 'i') {
                e.preventDefault();
                wrapOrToggleFormat('*');
                return;
            }

            if (lowerKey === 'k') {
                e.preventDefault();
                handleEditorLink();
                return;
            }

            if (lowerKey === 'e' || key === '`') {
                e.preventDefault();
                wrapOrToggleFormat('`');
                return;
            }

            if (e.shiftKey && lowerKey === 'x') {
                e.preventDefault();
                wrapOrToggleFormat('~~');
                return;
            }

            if (lowerKey === 'd') {
                e.preventDefault();
                handleEditorDuplicate();
                return;
            }
        }

        if (key === 'Tab') {
            handleEditorTab(e);
            return;
        }

        if (key === 'Enter' && !e.shiftKey && !e.altKey && !isCmdOrCtrl) {
            handleEditorEnter(e);
            return;
        }

        const val = markdownInput.value;
        const selStart = markdownInput.selectionStart;
        const selEnd = markdownInput.selectionEnd;

        const wrapPairs = {
            '(': ')',
            '[': ']',
            '{': '}',
            '"': '"',
            "'": "'",
            '`': '`',
            '*': '*',
            '_': '_',
            '~': '~',
            '$': '$'
        };

        if (selStart !== selEnd && wrapPairs[key]) {
            e.preventDefault();
            const openChar = key;
            const closeChar = wrapPairs[key];
            const selected = val.substring(selStart, selEnd);
            const newText = val.substring(0, selStart) + openChar + selected + closeChar + val.substring(selEnd);
            applyEditorChange(newText, selStart + 1, selEnd + 1);
            return;
        }

        const autoClosePairs = {
            '(': ')',
            '[': ']',
            '{': '}',
            '"': '"',
            "'": "'",
            '`': '`'
        };

        if (selStart === selEnd && autoClosePairs[key]) {
            // Không tự đóng nháy đơn sau ký tự chữ/số (don't, it's, user's).
            if (key === "'") {
                const charBefore = selStart > 0 ? val[selStart - 1] : '';
                // \w: có chữ/số/_ ngay trước nháy đơn -> nháy trong từ, không tự đóng
                if (/\w/.test(charBefore)) {
                    return;
                }
            }
            e.preventDefault();
            const openChar = key;
            const closeChar = autoClosePairs[key];
            const newText = val.substring(0, selStart) + openChar + closeChar + val.substring(selEnd);
            applyEditorChange(newText, selStart + 1, selStart + 1);
            return;
        }

        const closers = [')', ']', '}', '"', "'", '`'];
        if (selStart === selEnd && closers.includes(key) && selStart < val.length && val[selStart] === key) {
            e.preventDefault();
            markdownInput.setSelectionRange(selStart + 1, selStart + 1);
            return;
        }

        if (key === 'Backspace' && selStart === selEnd && selStart > 0 && selStart < val.length) {
            const charBefore = val[selStart - 1];
            const charAfter = val[selStart];
            if (autoClosePairs[charBefore] === charAfter) {
                e.preventDefault();
                const newText = val.substring(0, selStart - 1) + val.substring(selStart + 1);
                applyEditorChange(newText, selStart - 1, selStart - 1);
            }
        }
    });

    markdownInput.addEventListener('input', (e) => {
        charCounter.textContent = `${markdownInput.value.length} characters`;
        scheduleEditorHighlight();
        debouncedRender();
        debouncedSaveContent();

        clearTimeout(editorHistory.typingTimer);
        const inputType = e.inputType || '';
        if (inputType.includes('Space') || inputType.includes('Line') || inputType.includes('history')) {
            editorHistory.saveCurrentState(markdownInput);
        } else {
            editorHistory.typingTimer = setTimeout(() => {
                editorHistory.saveCurrentState(markdownInput);
            }, 400);
        }
    });
}
