// js/editor/content.js — Nạp / thay nội dung editor (mẫu, import, khôi phục) và nút Reset / Copy.

import { btnCopy, btnReset, editorHighlight, markdownInput, previewOutput } from '../core/dom.js';
import { showToast } from '../core/toast.js';
import { defaultMarkdown } from './default-markdown.js';
import { updateEditorHighlight } from './highlight.js';
import { editorHistory } from './history.js';
import { CONTENT_STORAGE_KEY, saveContentToStorage } from './storage.js';
import { renderMarkdown } from '../preview/render.js';

export function applyContent(text) {
    markdownInput.value = text;
    editorHistory.stack = [];
    editorHistory.index = -1;
    editorHistory.saveCurrentState(markdownInput);
    updateEditorHighlight();
    renderMarkdown();
    markdownInput.scrollTop = 0;
    previewOutput.scrollTop = 0;
    editorHighlight.scrollTop = 0;
}

function loadDefaultContent() {
    applyContent(defaultMarkdown);
    // Ghi đè luôn bộ nhớ tạm để thoát app ngay sau Reset vẫn mở lại bản mẫu chứ không phải nội dung cũ.
    saveContentToStorage();
}

export function loadInitialContent() {
    let savedContent = null;
    try {
        savedContent = localStorage.getItem(CONTENT_STORAGE_KEY);
    } catch (e) {
        // Bỏ qua nếu localStorage bị chặn
    }

    if (savedContent) {
        applyContent(savedContent);
    } else {
        applyContent(defaultMarkdown);
    }
}

export function initContentActions() {
    btnReset.addEventListener('click', () => {
        if (confirm("Are you sure you want to restore the sample text? This will overwrite your current content.")) {
            loadDefaultContent();
            showToast("Sample content restored!");
        }
    });

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
