// js/io/import.js — Nhập file Markdown từ máy vào editor.

import { btnImport, importFileInput, markdownInput } from '../core/dom.js';
import { showToast } from '../core/toast.js';
import { applyContent } from '../editor/content.js';
import { saveContentToStorage } from '../editor/storage.js';

const IMPORTABLE_EXTS = ['md', 'markdown', 'mdown', 'mkd', 'txt'];

export function isImportableFile(file) {
    const name = String(file && file.name || '').toLowerCase();
    const ext = name.includes('.') ? name.split('.').pop() : '';
    if (IMPORTABLE_EXTS.includes(ext)) return true;
    if (ext !== '') return false; // known non-markdown extension (even with empty MIME)
    const type = file ? (file.type || '') : '';
    return type === '' || type.startsWith('text/');
}

export function initImport() {
    btnImport.addEventListener('click', () => importFileInput.click());

    importFileInput.addEventListener('change', () => {
        const file = importFileInput.files[0];
        importFileInput.value = ''; // cho phép chọn lại cùng một file ở lần kế tiếp
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) {
            showToast("File is too large (5MB max).");
            return;
        }

        if (!isImportableFile(file)) {
            showToast('Only Markdown files can be imported (.md, .markdown, .txt).');
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            const text = String(reader.result);
            if (!text.trim()) {
                showToast("File is empty or its content could not be read.");
                return;
            }
            if (markdownInput.value.trim() && !confirm("Importing a file will overwrite the current content. Continue?")) {
                return;
            }
            applyContent(text);
            saveContentToStorage();
            showToast(`Imported "${file.name}" into the editor!`);
        };
        reader.onerror = () => showToast("An error occurred while reading the file.");
        reader.readAsText(file, 'utf-8');
    });
}
