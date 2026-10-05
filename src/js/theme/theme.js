// js/theme/theme.js — Theme Sáng / Tối: áp dụng, lưu lựa chọn, theo theme hệ thống.

import { btnTheme, hljsThemeLink, markdownThemeLink } from '../core/dom.js';
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

    if (markdownThemeLink) {
        markdownThemeLink.href = theme === 'dark'
            ? 'vendor/github-markdown-dark.css'
            : 'vendor/github-markdown-light.css';
    }
    if (hljsThemeLink) {
        hljsThemeLink.href = theme === 'dark'
            ? 'vendor/hljs-github-dark.min.css'
            : 'vendor/hljs-github.min.css';
    }
    if (typeof mermaid !== 'undefined') {
        mermaid.initialize({ startOnLoad: false, theme: theme === 'dark' ? 'dark' : 'default' });
    }

    if (persist) {
        try {
            localStorage.setItem(THEME_STORAGE_KEY, theme);
        } catch (e) {
            // Bỏ qua nếu localStorage bị chặn
        }
    }
}

export function initTheme() {
    syncWindowTheme(getCurrentTheme());

    if (btnTheme) {
        btnTheme.addEventListener('click', () => {
            const nextTheme = getCurrentTheme() === 'dark' ? 'light' : 'dark';
            applyTheme(nextTheme, true);
            // Xoá cache: SVG cũ mang màu của theme trước
            clearMermaidCache();
            if (typeof renderMarkdown === 'function') renderMarkdown();
            showToast(nextTheme === 'dark' ? "Switched to Dark theme" : "Switched to Light theme");
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
                applyTheme(event.matches ? 'dark' : 'light', false);
                clearMermaidCache();
                if (typeof renderMarkdown === 'function') renderMarkdown();
            }
        });
    }
}
