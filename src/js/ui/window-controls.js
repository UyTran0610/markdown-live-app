// js/ui/window-controls.js — Nút cửa sổ tự vẽ; khung native đã tắt (decorations: false).

import { btnWinClose, btnWinMax, btnWinMin, titlebar } from '../core/dom.js';
import { showToast } from '../core/toast.js';
import { checkActiveTabDisk, flushSession } from '../io/documents.js';

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
    run(() => win.onCloseRequested(async (event) => {
        event.preventDefault();
        const ok = await flushSession();
        if (ok) await win.destroy();
        else showToast('Could not save this session, so the window stays open. Close again to retry.');
    }));

    syncMaximizedState(win);
    run(() => win.onResized(() => syncMaximizedState(win)));

    // Focus lại là lúc file ngoài dễ bị đụng; chỉ hỏi khi thật sự lệch, tab sạch tự tải lại.
    run(() => win.onFocusChanged(({ payload: focused }) => {
        if (focused) checkActiveTabDisk();
    }));
}
