// js/export/menu.js — Menu thả xuống Export và các nút xuất file.

import {
    btnExport,
    exportDocBtn,
    exportHtmlBtn,
    exportMdBtn,
    exportMenu,
    exportPdfBtn,
    exportWrap
} from '../core/dom.js';
import { exportDoc } from './doc.js';
import { exportHtml } from './html.js';
import { exportMarkdown } from './markdown.js';
import { exportPdf } from './pdf.js';

export function closeExportMenu() {
    exportMenu.classList.add('hidden');
    exportWrap.classList.remove('open');
    btnExport.setAttribute('aria-expanded', 'false');
}

export function initExportMenu() {
    // KHÔNG stopPropagation: listener document bên dưới cần thấy click để đóng menu khác (format/view) đang
    // mở; stopPropagation ở đây (và ở btnView) làm hai dropdown mở chồng lên nhau.
    btnExport.addEventListener('click', () => {
        const isHidden = exportMenu.classList.toggle('hidden');
        exportWrap.classList.toggle('open', !isHidden);
        btnExport.setAttribute('aria-expanded', String(!isHidden));
    });

    document.addEventListener('click', (e) => {
        if (!exportMenu.classList.contains('hidden') && !exportWrap.contains(e.target)) {
            closeExportMenu();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeExportMenu();
    });

    exportMdBtn.addEventListener('click', () => { closeExportMenu(); exportMarkdown(); });

    exportHtmlBtn.addEventListener('click', () => { closeExportMenu(); exportHtml(); });

    exportDocBtn.addEventListener('click', () => { closeExportMenu(); exportDoc(); });

    exportPdfBtn.addEventListener('click', () => { closeExportMenu(); exportPdf(); });
}
