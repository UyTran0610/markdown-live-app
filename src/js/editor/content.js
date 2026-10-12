// js/editor/content.js — Nút Copy.

import { btnCopy, markdownInput } from '../core/dom.js';
import { showToast } from '../core/toast.js';

export function initContentActions() {
    btnCopy.addEventListener('click', () => {
        const textToCopy = markdownInput.value;
        const copyPromise = (window.__TAURI__ && window.__TAURI__.clipboardManager)
            ? window.__TAURI__.clipboardManager.writeText(textToCopy)
            : navigator.clipboard.writeText(textToCopy);

        copyPromise
            .then(() => showToast("Markdown copied to clipboard!"))
            .catch(() => showToast("An error occurred while copying."));
    });
}