// js/ui/window-controls.js — Nút cửa sổ tự vẽ; khung native đã tắt (decorations: false).

import { btnWinClose, btnWinMax, btnWinMin, titlebar } from '../core/dom.js';
import { showToast } from '../core/toast.js';
import { checkActiveTabDisk, flushSession, freezeSession, getTabs, needsSave, saveAllTabs } from '../io/documents.js';
import { confirmAction } from './confirm-dialog.js';

// Bản trình duyệt không có __TAURI__: nút vẫn hiện cho đúng layout nhưng bấm không làm gì.
function currentWindow() {
    try {
        return (window.__TAURI__ && window.__TAURI__.window)
            ? window.__TAURI__.window.getCurrentWindow()
            : null;
    } catch (e) {
        return null;
    }
}

// onResized bắt cả maximize, kéo viền và double-click titlebar nên chỉ cần một nguồn sự kiện.
function syncMaximizedState(win) {
    win.isMaximized()
        .then((isMaximized) => titlebar.classList.toggle('is-maximized', isMaximized))
        .catch(() => {});
}

// Lỗi ACL không được nuốt im lặng: thiếu quyền thì nút chết mà không ai biết vì sao.
function run(action) {
    Promise.resolve(action()).catch((err) => console.warn('[window-controls]', err));
}

export function initWindowControls() {
    const win = currentWindow();
    if (!win) return;

    btnWinMin.addEventListener('click', () => run(() => win.minimize()));
    btnWinMax.addEventListener('click', () => run(() => win.toggleMaximize()));
    btnWinClose.addEventListener('click', () => run(() => win.close()));

    // beforeunload không đáng tin trong Tauri (WebView bị huỷ cùng cửa sổ), nên chặn ở
    // onCloseRequested, flushSession() rồi mới destroy. Ghi hỏng thì giữ cửa sổ + toast:
    // destroy lúc đó là mất bản nháp của mọi tab.
    let closing = false;
    run(() => win.onCloseRequested(async (event) => {
        event.preventDefault();
        if (closing) return;
        closing = true;
        try {
            let discard = false;
            const dirty = getTabs().filter(needsSave);
            if (dirty.length) {
                // "Don't save" phải xoá bản nháp khỏi session, nếu không lần mở sau vẫn thấy đồ đang dở.
                const choice = await confirmAction({
                    title: 'Unsaved changes',
                    message: `${dirty.length} tab${dirty.length === 1 ? ' has' : 's have'} unsaved changes.\nIf you don't save, the app will reopen the last saved version.`,
                    actions: [{ id: 'save', label: 'Save all' }, { id: 'discard', label: "Don't save" }]
                });
                if (!choice) return;
                if (choice === 'save') {
                    await saveAllTabs();
                    // Huỷ Save As ở giữa chừng: vẫn còn tab chưa lưu thì không được đóng.
                    if (getTabs().some(needsSave)) {
                        showToast('Some tabs are still unsaved, so the window stays open.');
                        return;
                    }
                } else {
                    discard = true;
                }
            }
            // Khoá writer khác trước khi ghi snapshot cuối: visibilitychange lúc destroy sẽ
            // gọi saveSession() với tab còn draft và ghi đè snapshot vừa ghi.
            freezeSession(true);
            const ok = await flushSession({ discardUnsaved: discard });
            if (ok) await win.destroy();
            else showToast('Could not save this session, so the window stays open. Close again to retry.');
        } finally {
            freezeSession(false);
            closing = false;
        }
    }));

    syncMaximizedState(win);
    run(() => win.onResized(() => syncMaximizedState(win)));

    // Focus lại là lúc file ngoài dễ bị đụng; chỉ hỏi khi thật sự lệch, tab sạch tự tải lại.
    run(() => win.onFocusChanged(({ payload: focused }) => {
        if (focused) checkActiveTabDisk();
    }));
}
