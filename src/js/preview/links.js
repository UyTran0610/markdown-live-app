// js/preview/links.js — Bắt click link trong preview và mở bằng trình duyệt hệ thống.

import { previewOutput } from '../core/dom.js';
import { isSafeExternalUrl } from '../core/utils.js';

export function initPreviewLinks() {
    // Chặn click liên kết ngoài và mở bằng trình duyệt hệ thống để tránh lỗi điều hướng của WebView (app desktop).
    previewOutput.addEventListener('click', async (e) => {
        const link = e.target.closest('a');
        if (link && link.getAttribute('href')) {
            const href = link.getAttribute('href');
            if (!href.startsWith('#')) {
                e.preventDefault();
                if (!isSafeExternalUrl(href)) return;
            
                if (window.__TAURI__ && window.__TAURI__.opener) {
                    try {
                        await window.__TAURI__.opener.openUrl(href);
                    } catch (err) {
                        console.warn('Failed to open URL via Tauri opener:', err);
                        window.open(href, '_blank', 'noopener,noreferrer');
                    }
                } else {
                    window.open(href, '_blank', 'noopener,noreferrer');
                }
            }
        }
    });
}
