// js/theme/theme.js — Theme Sáng / Tối: áp dụng, lưu lựa chọn, theo theme hệ thống.

import { btnTheme, themeCssLinks } from '../core/dom.js';
import { showToast } from '../core/toast.js';
import { invalidatePreviewCaches } from '../io/documents.js';
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

    // Bật/tắt media của link theme đã nạp sẵn: đồng bộ, không fetch, nên Preview đổi màu cùng lúc.
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

// Đổi màu cả trang bằng MỘT cross-fade (View Transitions) thay vì mỗi phần tử transition riêng;
// applyTheme đồng bộ nên ảnh trước/sau đều đúng màu. WebView2 cũ thì rơi về transition của body/header.
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
            // Xoá cache vì SVG mang màu theme cũ. Render nằm NGOÀI startViewTransition (chờ mermaid
            // xong mới chụp sẽ đứng cả trang) nhưng PHẢI sau applyTheme.
            clearMermaidCache();
            invalidatePreviewCaches();
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
                invalidatePreviewCaches();
                if (typeof renderMarkdown === 'function') renderMarkdown();
            }
        });
    }
}
