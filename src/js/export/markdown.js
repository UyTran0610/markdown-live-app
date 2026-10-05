// js/export/markdown.js — Xuất file .md.

import { markdownInput } from '../core/dom.js';
import { showToast } from '../core/toast.js';
import { deriveExportBaseName, saveTextFile } from './file-save.js';

export async function exportMarkdown() {
    const text = markdownInput.value;
    if (!text.trim()) {
        showToast("Content is empty, nothing to export.");
        return;
    }
    try {
        const saved = await saveTextFile(text, deriveExportBaseName(text), 'md', 'text/markdown;charset=utf-8');
        if (saved) showToast("Markdown file exported!");
    } catch (err) {
        console.error('Markdown export failed:', err);
        showToast("An error occurred while exporting the Markdown file.");
    }
}
