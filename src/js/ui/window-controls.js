// js/ui/window-controls.js — Nút cửa sổ tự vẽ. Khung native đã tắt (tauri.conf.json
// "decorations": false) nên đây là cách duy nhất để thu nhỏ / phóng to / đóng cửa sổ.

import { btnWinClose, btnWinMax, btnWinMin, titlebar } from '../core/dom.js';

// Bản chạy trong trình duyệt (không có __TAURI__) không có cửa sổ để điều khiển:
// nút vẫn hiện để layout đúng nhưng bấm không làm gì.
function currentWindow() {
    try {
        return (window.__TAURI__ && window.__TAURI__.window)
            ? window.__TAURI__.window.getCurrentWindow()
            : null;
    } catch (e) {
        return null;
    }
}

// Phóng to / khôi phục, kéo viền và double-click titlebar đều phát onResized, nên chỉ cần
// một nguồn sự kiện này để đổi glyph nút giữa.
function syncMaximizedState(win) {
    win.isMaximized()
        .then((isMaximized) => titlebar.classList.toggle('is-maximized', isMaximized))
        .catch(() => {});
}

// Lỗi quyền ACL không được nuốt im lặng: thiếu quyền thì nút chết mà không ai biết vì sao.
function run(action) {
    Promise.resolve(action()).catch((err) => console.warn('[window-controls]', err));
}

export function initWindowControls() {
    const win = currentWindow();
    if (!win) return;

    btnWinMin.addEventListener('click', () => run(() => win.minimize()));
    btnWinMax.addEventListener('click', () => run(() => win.toggleMaximize()));
    btnWinClose.addEventListener('click', () => run(() => win.close()));

    syncMaximizedState(win);
    run(() => win.onResized(() => syncMaximizedState(win)));
}
