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

// Phím tắt toàn cục: gắn trên window chứ không gắn trên textarea, vì ở chế độ Preview cả
// .editor-pane bị display:none (layout.css) nên phím bấm trong textarea không bắn được, và sau khi
// bấm vào toolbar thì con trỏ cũng không còn trong textarea. Ctrl+S/Ctrl+B chết đúng lúc người
// dùng đang nhìn preview là lỗi nặng nhất của kiểu gắn vào phần tử.
function handleGlobalShortcut(e) {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const isCmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
    if (!isCmdOrCtrl) return;

    const key = e.key;
    const lowerKey = key.toLowerCase();

    // Chuyển tab phải bắt TRƯỚC nhánh Tab thường bên dưới, nếu không Tab sẽ chèn khoảng trắng.
    if (key === 'Tab') {
        e.preventDefault();
        cycleTab(e.shiftKey ? -1 : 1);
        return;
    }

    // Ctrl+Alt+S = Save All. Phải đứng TRƯỚC nhánh Ctrl+S thường, nếu không nó rơi vào Save và
    // không bao giờ tới được Save All. (Bản cũ bắt Ctrl+Alt+A trong khi tooltip trên nút ghi
    // Ctrl+Alt+S, nên tổ hợp được quảng cáo là tổ hợp chết.)
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

        // Phím đã xử lý ở tầng toàn cục thì không chạy lại ở đây: mọi tổ hợp có Ctrl/Cmd hoặc Alt
        // đều thuộc tầng đó (Ctrl+Alt+S = Save All nằm trong số này).
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
        // Nhảy qua ký tự đóng phải ĐỨNG TRƯỚC auto-close. Với cặp đối xứng (" ` ') hai nhánh cùng
        // khớp nên thứ tự ngược lại khiến nhánh này chết: gõ " mở ra "abc"| rồi gõ " lần nữa thì
        // auto-close chèn thêm một cặp -> "abc"|"" thay vì nhảy qua dấu đóng đã có.
        // Thứ tự này không đổi gì với ) ] } vì chúng vốn không nằm trong autoClosePairs.
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
        // Đếm ký tự + tô màu + render + lưu nháp: dùng chung với applyEditorChange, không lặp lại 4 dòng.
        syncEditorAfterChange();

        clearTimeout(editorHistory.typingTimer);
        const inputType = e.inputType || '';
        // Nhấn dấu cách sinh inputType === 'insertText' (chuỗi 'Space' không bao giờ xuất hiện), nên phải nhận
        // diện qua e.data. Thiếu nhánh này thì cả cụm "hello world" gộp thành một mục lịch sử và Undo lùi
        // hết cụm thay vì từng từ.
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
