// js/editor/events.js — Sự kiện bàn phím (phím tắt, auto-close ngoặc) và sự kiện nhập liệu của editor.

import { markdownInput } from '../core/dom.js';
import {
    applyEditorChange,
    handleEditorDuplicate,
    handleEditorEnter,
    handleEditorLink,
    handleEditorTab,
    wrapOrToggleFormat
} from './edit.js';
import { editorHistory } from './history.js';
import { syncEditorAfterChange } from './sync.js';
import { closeTab, cycleTab, getActiveTab, getTabs, newTab, openFiles, reopenClosedTab, saveActiveDoc, saveAllTabs, switchTab } from '../io/documents.js';

// Ctrl+1..9 -> tab thứ N. Nằm ngoài handler vì cần ngưỡng (Ctrl+0 / Ctrl+9 khi có ít tab là hợp lệ).
function switchToTabByNumber(e) {
    const digit = Number(e.key.slice(1));
    if (!Number.isInteger(digit) || digit < 1 || digit > 9) return false;
    const target = getTabs()[digit - 1];
    if (!target) return true;
    e.preventDefault();
    switchTab(target.id);
    return true;
}

// Phím tắt gắn trên window, không trên textarea: ở Preview .editor-pane là display:none và
// sau khi bấm toolbar con trỏ không còn trong textarea.
function handleGlobalShortcut(e) {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const isCmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
    if (!isCmdOrCtrl) return;

    const key = e.key;
    const lowerKey = key.toLowerCase();

    // Chuyển tab phải bắt TRƯỚC nhánh Tab thường, nếu không Tab sẽ chèn khoảng trắng.
    if (key === 'Tab') {
        e.preventDefault();
        cycleTab(e.shiftKey ? -1 : 1);
        return;
    }

    // Ctrl+Alt+S = Save All phải đứng TRƯỚC Ctrl+S thường, nếu không không bao giờ tới được.
    if (lowerKey === 's' && e.altKey) {
        e.preventDefault();
        saveAllTabs();
        return;
    }

    if (lowerKey === 's') {
        e.preventDefault();
        saveActiveDoc(e.shiftKey ? { as: true } : undefined);
        return;
    }

    if (lowerKey === 'o') {
        e.preventDefault();
        openFiles();
        return;
    }

    if (lowerKey === 't') {
        e.preventDefault();
        if (e.shiftKey) reopenClosedTab();
        else newTab();
        return;
    }

    if (lowerKey === 'w') {
        const active = getActiveTab();
        if (!active) return;
        e.preventDefault();
        closeTab(active.id);
        return;
    }

    if (key === 'PageDown' || key === 'PageUp') {
        e.preventDefault();
        cycleTab(key === 'PageDown' ? 1 : -1);
        return;
    }

    if (switchToTabByNumber(e)) return;

    // Dưới đây là phím chỉ có nghĩa khi con trỏ đang ở trong editor.
    if (e.target !== markdownInput) return;

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
    }
}

export function initEditorEvents() {
    window.addEventListener('keydown', handleGlobalShortcut);

    markdownInput.addEventListener('keydown', (e) => {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const isCmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
        const key = e.key;

        // Tổ hợp Ctrl/Cmd hoặc Alt đã xử lý ở tầng toàn cục, không chạy lại ở đây.
        if (isCmdOrCtrl || e.altKey) return;

        if (key === 'Tab') {
            handleEditorTab(e);
            return;
        }

        if (key === 'Enter' && !e.shiftKey) {
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

        const closers = [')', ']', '}', '"', "'", '`'];
        // Nhảy qua ký tự đóng phải ĐỨNG TRƯỚC auto-close: với " ` ' hai nhánh cùng khớp, thứ tự
        // ngược lại sẽ chèn thêm cặp thay vì nhảy qua dấu đóng.
        if (selStart === selEnd && closers.includes(key) && selStart < val.length && val[selStart] === key) {
            e.preventDefault();
            markdownInput.setSelectionRange(selStart + 1, selStart + 1);
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
        // Đếm ký tự + tô màu + render + lưu nháp: dùng chung với applyEditorChange.
        syncEditorAfterChange();

        clearTimeout(editorHistory.typingTimer);
        const inputType = e.inputType || '';
        // Dấu cách là inputType 'insertText', nhận qua e.data để mỗi từ là một mốc lịch sử.
        if ((inputType === 'insertText' && e.data === ' ')
            || inputType.includes('Line')
            || inputType.includes('history')) {
            editorHistory.saveCurrentState(markdownInput);
        } else {
            editorHistory.typingTimer = setTimeout(() => {
                editorHistory.saveCurrentState(markdownInput);
            }, 400);
        }
    });
}
