// js/export/pdf.js — Xuất PDF qua hộp thoại In.

import { showToast } from '../core/toast.js';
import { renderMarkdown, whenMermaidIdle } from '../preview/render.js';

export async function exportPdf() {
    showToast("Preparing the print page / exporting PDF...");
    renderMarkdown();
    try {
        await Promise.all([
            whenMermaidIdle(8000),
            (document.fonts ? document.fonts.ready : Promise.resolve())
        ]);
    } catch (e) {}
    window.print();
}
