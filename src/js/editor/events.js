// js/editor/events.js — Phím tắt toàn cục của app (gắn trên window, không phụ thuộc editor có focus).

import { findBtn } from '../core/dom.js';
import { openFindDialog } from './find.js';
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

// Hộp thoại đang mở nuốt phím tắt (Enter/Esc/Tab do chính nó xử lý).
function insideOpenDialog(e) {
    return e.target instanceof Element && !!e.target.closest('.dialog-overlay:not(.hidden)');
}

// Phím tắt gắn trên window, bắt ở pha capture: bắt trước keymap của CodeMirror
// (ví dụ PageUp phải đổi tab chứ không cuộn editor) và sau đó chặn luôn editor.
function handleGlobalShortcut(e) {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const isCmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
    if (!isCmdOrCtrl) return;
    if (insideOpenDialog(e)) return;

    const key = e.key;
    const lowerKey = key.toLowerCase();

    // Chuyển tab phải bắt TRƯỚC nhánh Tab thường, nếu không Tab sẽ chèn khoảng trắng.
    if (key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        cycleTab(e.shiftKey ? -1 : 1);
        return;
    }

    // Ctrl+Alt+S = Save All phải đứng TRƯỚC Ctrl+S thường, nếu không không bao giờ tới được.
    if (lowerKey === 's' && e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        saveAllTabs();
        return;
    }

    if (lowerKey === 's') {
        e.preventDefault();
        e.stopPropagation();
        saveActiveDoc(e.shiftKey ? { as: true } : undefined);
        return;
    }

    if (lowerKey === 'o') {
        e.preventDefault();
        e.stopPropagation();
        openFiles();
        return;
    }

    if (lowerKey === 't') {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) reopenClosedTab();
        else newTab();
        return;
    }

    if (lowerKey === 'w') {
        const active = getActiveTab();
        if (!active) return;
        e.preventDefault();
        e.stopPropagation();
        closeTab(active.id);
        return;
    }

    if (key === 'PageDown' || key === 'PageUp') {
        e.preventDefault();
        e.stopPropagation();
        cycleTab(key === 'PageDown' ? 1 : -1);
        return;
    }

    // Tìm kiếm trong Editor: chặn trình tìm của trình duyệt, dùng hộp thoại của app.
    if (lowerKey === 'f') {
        e.preventDefault();
        e.stopPropagation();
        openFindDialog({ focus: 'find' });
        return;
    }

    if (lowerKey === 'h') {
        e.preventDefault();
        e.stopPropagation();
        openFindDialog({ focus: 'replace' });
        return;
    }

    if (switchToTabByNumber(e)) {
        e.stopPropagation();
    }
}

export function initEditorEvents() {
    window.addEventListener('keydown', handleGlobalShortcut, true);

    findBtn.addEventListener('click', () => {
        openFindDialog({ focus: 'find' });
    });
}
