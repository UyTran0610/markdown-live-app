// js/theme/theme.js — Theme Sáng / Tối: áp dụng, lưu lựa chọn, theo theme hệ thống.

import { btnTheme, themeCssLinks } from '../core/dom.js';
import { showToast } from '../core/toast.js';
import { clearMermaidCache } from '../preview/mermaid-cache.js';
import { renderMarkdown } from '../preview/render.js';

const THEME_STORAGE_KEY = 'markdown-live-theme';

export function getCurrentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function syncWindowTheme(theme) {
    try {
        if (window.__TAURI__ && window.__TAURI__.window) window.__TAURI__.window.getCurrentWindow().setTheme(theme).catch(() => {});
    } catch (e) {}
}

function applyTheme(theme, persist) {
    document.documentElement.setAttribute('data-theme', theme);
    syncWindowTheme(theme);

    // Bật/tắt media của các link theme đã nạp sẵn: thuần đồng bộ, không có fetch nào,
    // nên Preview đổi màu đúng lúc data-theme đổi (xem switchTheme bên dưới).
    for (const link of themeCssLinks) {
        link.media = link.getAttribute('data-theme-css') === theme ? 'all' : 'not all';
    }

    const dark = theme === 'dark';
    if (typeof mermaid !== 'undefined') {
        mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default' });
    }

    if (persist) {
        try {
            localStorage.setItem(THEME_STORAGE_KEY, theme);
        } catch (e) {
            // Bỏ qua nếu localStorage bị chặn
        }
    }
}

// Cả trang đổi màu bằng MỘT lần cross-fade của toàn trang (View Transitions) thay vì mỗi phần
// tử tự transition riêng — cách sau rất nặng vì Preview có hàng trăm span KaTeX/hljs/Mermaid.
// applyTheme giờ thuần đồng bộ, nên ảnh "cũ" được chụp trước khi đổi (mọi thứ còn màu cũ) và
// ảnh "sau" sau khi đổi (mọi thứ đã cùng màu) → không còn thành phần nào nhảy sớm.
// Không có API (WebView2 cũ) thì rơi về transition màu sẵn có của body/header/pane.
function switchTheme(theme, persist) {
    const reducedMotion = window.matchMedia
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!document.startViewTransition || reducedMotion) {
        applyTheme(theme, persist);
        return;
    }
    document.startViewTransition(() => applyTheme(theme, persist));
}

export function initTheme() {
    syncWindowTheme(getCurrentTheme());

    if (btnTheme) {
        btnTheme.addEventListener('click', () => {
            const nextTheme = getCurrentTheme() === 'dark' ? 'light' : 'dark';
            showToast(nextTheme === 'dark' ? "Switched to Dark theme" : "Switched to Light theme");
            switchTheme(nextTheme, true);
            // Xoá cache: SVG cũ mang màu của theme trước. Render ĐỪNG nằm trong
            // startViewTransition (mermaid.render là việc nặng, chờ nó xong mới chụp
            // ảnh "sau" sẽ đứng yên cả trang rồi mới fade — đó là cảm giác lag),
            // nhưng PHẢI sau applyTheme, không thì Mermaid vẽ ra màu theme cũ.
            clearMermaidCache();
            if (typeof renderMarkdown === 'function') renderMarkdown();
        });
    }

    if (window.matchMedia) {
        const darkSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
        darkSchemeQuery.addEventListener('change', (event) => {
            let hasManualPreference = false;
            try {
                hasManualPreference = localStorage.getItem(THEME_STORAGE_KEY) !== null;
            } catch (e) {}

            if (!hasManualPreference) {
                switchTheme(event.matches ? 'dark' : 'light', false);
                clearMermaidCache();
                if (typeof renderMarkdown === 'function') renderMarkdown();
            }
        });
    }
}
