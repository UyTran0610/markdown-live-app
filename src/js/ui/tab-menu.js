// js/ui/tab-menu.js — Menu ngữ cảnh của dải tab: mọi thao tác lên MỘT tab (Save As, Close Others,
// Copy path, Reveal in Explorer, Pin), cộng danh sách file vừa mở và danh sách toàn bộ tab khi tràn.

import { btnRecent, tabStrip } from '../core/dom.js';
import {
    closeTab,
    getRecentPaths,
    getTabs,
    isMarkdownPath,
    isTabDirty,
    openPaths,
    saveTab,
    subscribe,
    switchTab,
    updateTabPin
} from '../io/documents.js';
import { openPopupMenu } from './popup-menu.js';

const canRevealInExplorer = () => !!(window.__TAURI__ && window.__TAURI__.opener?.revealItemInDir);

function revealInExplorer(path) {
    // opener:default đã kèm allow-reveal-item-in-dir nên không cần thêm quyền cho mục này.
    window.__TAURI__.opener.revealItemInDir(path).catch((err) => console.warn('[tab-menu] reveal failed', err));
}

function copyPath(path) {
    navigator.clipboard.writeText(path).catch((err) => console.warn('[tab-menu] clipboard failed', err));
}

function closeClosable(filter) {
    getTabs().filter((t) => !t.pinned && filter(t)).forEach((t) => closeTab(t.id));
}

export function openTabMenu(tab, x, y) {
    const index = getTabs().findIndex((t) => t.id === tab.id);
    const others = getTabs().filter((t) => t.id !== tab.id);
    const rightSide = index < 0 ? [] : getTabs().slice(index + 1);

    openPopupMenu([
        { label: 'Save', disabled: !isTabDirty(tab), onClick: () => saveTab(tab) },
        { label: 'Save As...', onClick: () => saveTab(tab, { as: true }) },
        { separator: true },
        { label: 'Close', onClick: () => closeTab(tab.id) },
        { label: 'Close Others', disabled: !others.some((t) => !t.pinned), onClick: () => closeClosable((t) => t.id !== tab.id) },
        { label: 'Close to the Right', disabled: !rightSide.some((t) => !t.pinned), onClick: () => closeClosable((t) => rightSide.includes(t)) },
        { label: 'Close Saved Tabs', disabled: !others.some((t) => !t.pinned && !isTabDirty(t)), onClick: () => closeClosable((t) => t.id !== tab.id && !isTabDirty(t)) },
        { separator: true },
        { label: tab.pinned ? 'Unpin Tab' : 'Pin Tab', onClick: () => updateTabPin(tab.id) },
        { label: 'Copy Path', disabled: !tab.path, onClick: () => copyPath(tab.path) },
        { label: 'Reveal in Explorer', disabled: !tab.path || !canRevealInExplorer(), onClick: () => revealInExplorer(tab.path) }
    ], x, y);
}

// Danh sách file vừa mở. Mục đã xoá khỏi đĩa vẫn hiện: openPaths -> readTextFile sẽ báo lỗi, không
// cần kiểm tra tồn tại trước (và kiểm tra thì tốn một stat cho mỗi mục mỗi lần mở menu).
export function openRecentMenu(anchor) {
    const recent = getRecentPaths().filter(isMarkdownPath);
    if (!recent.length) return false;
    const rect = anchor.getBoundingClientRect();
    openPopupMenu(recent.map((path) => ({
        label: path,
        onClick: () => openPaths([path])
    })), rect.left, rect.bottom);
    return true;
}

// Dải tab tràn quá nhiều thì tab bị khuất rất khó tìm: menu này liệt kê tất cả, kèm dấu chưa-lưu và
// cảnh báo lỗi để không mở nhầm.
export function openAllTabsMenu(anchor) {
    const rect = anchor.getBoundingClientRect();
    openPopupMenu(getTabs().map((tab) => ({
        label: `${isTabDirty(tab) ? '* ' : ''}${tab.name}${tab.status !== 'ok' ? '  [!]' : ''}`,
        onClick: () => switchTab(tab.id)
    })), rect.left, rect.bottom);
}

function tabFromEvent(e) {
    const el = e.target.closest('.tab');
    if (!el) return null;
    return getTabs().find((t) => t.id === Number(el.dataset.tabId)) || null;
}

export function initTabMenu() {
    // Recent ẩn khi chưa mở file nào: một nút luôn bấm được nhưng không có gì để bấm là rác.
    subscribe(() => { btnRecent.hidden = getRecentPaths().length === 0; });
    btnRecent.addEventListener('click', () => { openRecentMenu(btnRecent); });

    // Chặn menu mặc định của WebView CHỈ trên dải tab. Editor giữ menu gốc (Cut/Copy/Paste/Undo)
    // vì đó là thứ người dùng cần ở textarea; chặn ở đó là mất quyền dán bằng chuột phải.
    tabStrip.addEventListener('contextmenu', (e) => {
        const tab = tabFromEvent(e);
        if (!tab) return;
        e.preventDefault();
        openTabMenu(tab, e.clientX, e.clientY);
    });

    // ContextMenu key / Shift+F10 mở menu tại vị trí tab đang focus, để bàn phím cũng tới được.
    tabStrip.addEventListener('keydown', (e) => {
        if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
        const tab = tabFromEvent(e);
        if (!tab) return;
        e.preventDefault();
        const rect = e.target.closest('.tab').getBoundingClientRect();
        openTabMenu(tab, rect.left, rect.bottom);
    });
}