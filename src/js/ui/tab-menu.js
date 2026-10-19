// js/ui/tab-menu.js — Menu chuột phải của tab + Recent + danh sách toàn bộ tab.

import { btnRecent, tabStrip } from '../core/dom.js';
import { showToast } from '../core/toast.js';
import {
    clearRecentPaths,
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
import { confirmAction } from './confirm-dialog.js';
import { openPopupMenu } from './popup-menu.js';

const canRevealInExplorer = () => !!(window.__TAURI__ && window.__TAURI__.opener?.revealItemInDir);

function revealInExplorer(path) {
    // opener:default đã kèm allow-reveal-item-in-dir nên không cần thêm quyền.
    window.__TAURI__.opener.revealItemInDir(path).catch((err) => console.warn('[tab-menu] reveal failed', err));
}

function copyPath(path) {
    navigator.clipboard.writeText(path).catch((err) => console.warn('[tab-menu] clipboard failed', err));
}

// Đóng nhiều tab: một hộp thoại cho cả nhóm rồi xử lý tuần tự; confirmAction chỉ có một hộp thoại nên
// forEach không await sẽ huỷ lần hỏi trước và bỏ sót tab dirty.
async function closeClosable(filter) {
    const targets = getTabs().filter((t) => !t.pinned && filter(t));
    if (!targets.length) return;
    const dirty = targets.filter(isTabDirty);
    let saveThem = false;
    if (dirty.length) {
        const choice = await confirmAction({
            title: targets.length === 1 ? 'Close tab' : `Close ${targets.length} tabs`,
            message: dirty.length === 1
                ? `"${dirty[0].name}" has unsaved changes.`
                : `${dirty.length} of them have unsaved changes.`,
            actions: [{ id: 'save', label: 'Save all' }, { id: 'discard', label: "Don't save" }]
        });
        if (!choice) return;
        saveThem = choice === 'save';
    }

    let closed = 0;
    for (const tab of targets) {
        // Chỉ 'saved' và 'discard' mới đóng tab; huỷ Save As hoặc ghi hỏng thì tab ở lại.
        const result = saveThem && isTabDirty(tab) ? await saveTab(tab) : 'saved';
        if (result !== 'saved' && result !== 'discard') continue;
        // force: câu hỏi đã được trả lời ở trên, không hỏi lại từng tab.
        await closeTab(tab.id, { force: true });
        closed++;
    }
    if (closed < targets.length) showToast(`Closed ${closed} of ${targets.length} tabs.`);
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

// Mục đã xoá khỏi đĩa vẫn hiện: openPaths sẽ báo lỗi, kiểm tồn tại tốn một stat cho mỗi mục.
// Có mục xoá cả danh sách.
export function openRecentMenu(anchor) {
    const recent = getRecentPaths().filter(isMarkdownPath);
    if (!recent.length) return false;
    const rect = anchor.getBoundingClientRect();
    openPopupMenu([
        ...recent.map((path) => ({
            label: path,
            onClick: () => openPaths([path])
        })),
        { separator: true },
        { label: 'Clear Recent Files', onClick: () => clearRecentPaths() }
    ], rect.left, rect.bottom);
    return true;
}

// Dải tab tràn thì menu liệt kê tất cả, kèm dấu chưa-lưu và cảnh báo lỗi.
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
    // Recent ẩn khi chưa mở file nào: nút không có gì để bấm là rác.
    subscribe(() => { btnRecent.hidden = getRecentPaths().length === 0; });
    btnRecent.addEventListener('click', () => { openRecentMenu(btnRecent); });

    // Chặn menu mặc định của WebView CHỈ trên dải tab; editor giữ menu gốc để còn dán chuột phải.
    tabStrip.addEventListener('contextmenu', (e) => {
        const tab = tabFromEvent(e);
        if (!tab) return;
        e.preventDefault();
        openTabMenu(tab, e.clientX, e.clientY);
    });

    // ContextMenu key / Shift+F10 mở menu tại tab đang focus để bàn phím cũng tới được.
    tabStrip.addEventListener('keydown', (e) => {
        if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
        const tab = tabFromEvent(e);
        if (!tab) return;
        e.preventDefault();
        const rect = e.target.closest('.tab').getBoundingClientRect();
        openTabMenu(tab, rect.left, rect.bottom);
    });
}