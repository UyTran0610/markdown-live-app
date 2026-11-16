// js/export/docx.js — Xuất file Word thật (.docx) từ DOM của Preview.
//
// DOCX là gói ZIP theo chuẩn OPC: docx-xml.js dựng XML, docx-zip.js đóng gói,
// docx-build.js dựng mô hình tài liệu từ DOM. Module này lo phần chuẩn bị Preview.

import { previewOutput } from '../core/dom.js';
import { getDocText } from '../editor/cm.js';
import { showToast } from '../core/toast.js';
import { deriveDocumentTitle, deriveExportBaseName, saveBinaryFile } from './file-save.js';
import { renderMarkdown, whenMermaidIdle, flushLazyRenders } from '../preview/render.js';
import {
    convertMermaidToImages,
    prepareDocImages
} from './images.js';
import { CONTENT_WIDTH_TWIP } from './docx-xml.js';
import { buildDocxModel, buildDocxPackage, DOCX_MIME } from './docx-build.js';

// Bề rộng cột bảng: bảng markdown rộng theo nội dung, nên tỉ lệ cột đo ở Preview là tỉ lệ thật.
// Clone chưa vào DOM nên phải đo trên bảng gốc rồi quy đổi sang twip.
function measureTableWidths(origTable) {
    const rows = origTable.rows;
    if (!rows || !rows.length) return null;
    // Bám theo quy tắc của builder: hàng đầu tiên có ô mới quyết định số cột.
    const firstRow = Array.from(rows).find((r) => r.cells.length);
    if (!firstRow) return null;
    const columns = firstRow.cells.length;
    const widths = new Array(columns).fill(0);
    for (const row of rows) {
        for (let i = 0; i < columns; i++) {
            const cell = row.cells[i];
            if (!cell) continue;
            widths[i] = Math.max(widths[i], cell.getBoundingClientRect().width);
        }
    }
    const total = widths.reduce((sum, w) => sum + w, 0);
    if (!(total > 0)) return null;
    // Tổng đúng bằng khung nội dung để bảng không tràn lề.
    const twips = widths.map((w) => Math.max(1, Math.round((w / total) * CONTENT_WIDTH_TWIP)));
    const drift = CONTENT_WIDTH_TWIP - twips.reduce((sum, w) => sum + w, 0);
    twips[twips.length - 1] = Math.max(1, twips[twips.length - 1] + drift);
    return twips;
}

// Ánh xạ bảng trong clone sang bề rộng cột đã đo (WeakMap theo chính node).
function collectTableWidths(origRoot, clone) {
    const map = new WeakMap();
    const origTables = origRoot.querySelectorAll('table');
    const cloneTables = clone.querySelectorAll('table');
    for (let i = 0; i < cloneTables.length; i++) {
        const orig = origTables[i];
        if (!orig) continue;
        const widths = measureTableWidths(orig);
        if (widths) map.set(cloneTables[i], widths);
    }
    return map;
}

export async function exportDocx() {
    const text = getDocText();
    if (!text.trim()) {
        showToast("Content is empty, nothing to export.");
        return;
    }
    showToast("Generating DOCX file...");

    renderMarkdown({ force: true });
    flushLazyRenders();
    await whenMermaidIdle(8000);

    const clone = previewOutput.cloneNode(true);
    clone.querySelectorAll('svg').forEach((el) => el.remove());

    await prepareDocImages(previewOutput, clone);
    await convertMermaidToImages(previewOutput, clone);

    // Công thức: giữ nguyên MathML của KaTeX để chuyển sang OMML (công thức native Word).
    // Ảnh PNG chỉ dùng khi chuyển OMML thất bại, nên cần phần tử gốc đang nằm trong DOM.
    const origKatex = previewOutput.querySelectorAll('span.katex');
    const cloneKatex = clone.querySelectorAll('span.katex');
    const mathOriginals = new Map();
    cloneKatex.forEach((el, i) => {
        if (origKatex[i]) mathOriginals.set(el, origKatex[i]);
    });

    const model = await buildDocxModel(clone, deriveDocumentTitle(text), {
        mathOriginal: (el) => mathOriginals.get(el) || null,
        tableWidths: collectTableWidths(previewOutput, clone)
    });
    const bytes = buildDocxPackage(model);
    try {
        const saved = await saveBinaryFile(bytes, deriveExportBaseName(text), 'docx', DOCX_MIME, 'Word file');
        if (saved) showToast("DOCX file exported!");
    } catch (err) {
        console.error('DOCX export failed:', err);
        showToast("An error occurred while exporting the DOCX file.");
    }
}
