// js/export/doc.js — Xuất file Word (.doc) từ HTML của preview.

import { markdownInput, previewOutput } from '../core/dom.js';
import { showToast } from '../core/toast.js';
import { convertQuotesForDoc, stripUnusedHeadingIds } from './doc-transform.js';
import { deriveExportBaseName, saveTextFile } from './file-save.js';
import {
    fitDocImageSize,
    getDocImageSize,
    isSvgImageSrc,
    svgImageToPngDataUrl,
    svgToPngDataUrl,
    waitForImageLoad
} from './images.js';
import { convertKatexToImagesForDoc } from './katex.js';
import { renderMarkdown, whenMermaidIdle } from '../preview/render.js';

// CSS tối giản nhúng trong file DOC: Word không đọc được stylesheet của app nên phải tự mang theo định dạng cốt lõi.
const DOC_STYLES = `
    body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.5; }
    h1 { font-size: 20pt; } h2 { font-size: 16pt; } h3 { font-size: 14pt; }
    h4 { font-size: 12pt; } h5 { font-size: 11pt; } h6 { font-size: 10pt; color: #57606a; }
    /* Chỉ bảng dữ liệu (đã gắn class doc-data-table trong exportDoc) mới có viền ô. Bảng dùng làm khung quote/alert
       KHÔNG nhận luật này: Word coi "border: none" inline là "chưa khai báo" và rơi về viền của stylesheet,
       khiến quote bị viền bao quanh. */
    table.doc-data-table { border-collapse: collapse; width: 100%; margin: 10px 0; }
    .doc-data-table th, .doc-data-table td { border: 1px solid #d0d7de; padding: 6px 10px; text-align: left; }
    .doc-data-table th { background: #f6f8fa; font-weight: bold; }
    pre { background: #f6f8fa; border: 1px solid #d0d7de; padding: 10px; font-family: Consolas, "Courier New", monospace; font-size: 9.5pt; white-space: pre-wrap; }
    code { font-family: Consolas, "Courier New", monospace; }
    blockquote { border-left: 4px solid #d0d7de; margin-left: 0; padding-left: 12px; color: #57606a; }
    img { border: 0; }
    a { color: #0969da; }
    hr { border: none; border-top: 1px solid #d0d7de; }
    .markdown-alert { border-left: 4px solid #0969da; background: #f6f8fa; padding: 8px 12px; }
    .markdown-alert-title { font-weight: bold; }
    .markdown-alert-tip { border-left-color: #1a7f37; }
    .markdown-alert-important { border-left-color: #8250df; }
    .markdown-alert-warning { border-left-color: #9a6700; }
    .markdown-alert-caution { border-left-color: #d1242f; }
`;

export function buildWordHtml(bodyHtml) {
    return '<html xmlns:o="urn:schemas-microsoft-com:office:office" '
        + 'xmlns:w="urn:schemas-microsoft-com:office:word" '
        + 'xmlns="http://www.w3.org/TR/REC-html40">\n<head>\n'
        + '<meta charset="UTF-8">\n'
        + '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->\n'
        + '<style>' + DOC_STYLES + '</style>\n</head>\n<body>\n' + bodyHtml + '\n</body>\n</html>';
}

// Ảnh với URL remote giữ nguyên <img src> (Word tự tải).
export async function exportDoc() {
    const text = markdownInput.value;
    if (!text.trim()) {
        showToast("Content is empty, nothing to export.");
        return;
    }
    showToast("Generating DOC file...");

    renderMarkdown();
    await whenMermaidIdle(8000);
    const clone = previewOutput.cloneNode(true);

    stripUnusedHeadingIds(clone);

    clone.querySelectorAll('svg').forEach((el) => el.remove());
    clone.querySelectorAll('input[type="checkbox"]').forEach((el) => {
        el.replaceWith(document.createTextNode(el.checked ? '\u2611 ' : '\u2610 '));
    });

    // Clone chưa vào DOM nên đo kích thước từ ảnh gốc trong Preview theo chỉ số.
    const origImgs = previewOutput.querySelectorAll('img');
    const cloneImgs = clone.querySelectorAll('img');
    for (let idx = 0; idx < cloneImgs.length; idx++) {
        const img = cloneImgs[idx];
        const orig = origImgs[idx];
        if (!orig) continue;
        await waitForImageLoad(orig);
        const size = getDocImageSize(orig);
        const fit = fitDocImageSize(size.width, size.height);
        if (!(fit.width > 0 && fit.height > 0)) continue;

        const src = orig.currentSrc || orig.getAttribute('src') || '';
        if (isSvgImageSrc(src)) {
            try {
                img.src = await svgImageToPngDataUrl(src, fit.width, fit.height);
                img.removeAttribute('srcset');
            } catch (e) {
                console.warn('Could not convert the SVG image to PNG, keeping the original URL:', src, e);
            }
        }
        img.setAttribute('width', fit.width);
        img.setAttribute('height', fit.height);
        img.style.width = fit.width + 'px';
        img.style.height = fit.height + 'px';
    }

    // Ánh xạ theo CHÍNH node pre (pre[i] -> svg con) chứ không theo chỉ số trong danh sách svg: nếu có biểu đồ
    // không có <svg> (mermaid lỗi, DOMPurify dọn rỗng, whenMermaidIdle timeout) thì chỉ số lệch và biểu đồ
    // sau đó xuất nhầm ảnh của biểu đồ khác.
    const cloneMers = clone.querySelectorAll('pre.mermaid');
    const origPres = previewOutput.querySelectorAll('pre.mermaid');
    for (let i = 0; i < cloneMers.length; i++) {
        const svg = origPres[i] && origPres[i].querySelector('svg');
        if (!svg) {
            console.warn('Mermaid diagram has no SVG yet, skipping image conversion:', i);
            continue;
        }
        try {
            const { dataUrl, width, height } = await svgToPngDataUrl(svg);
            const img = document.createElement('img');
            img.src = dataUrl;
            img.alt = 'Mermaid diagram';
            // PNG vẽ ở 2x mà Word bỏ qua max-width: luôn gắn kích thước hiển thị tường minh.
            const fit = fitDocImageSize(width, height);
            if (fit.width > 0 && fit.height > 0) {
                img.setAttribute('width', fit.width);
                img.setAttribute('height', fit.height);
                img.style.width = fit.width + 'px';
                img.style.height = 'auto';
            }
            cloneMers[i].replaceWith(img);
        } catch (e) {
            console.warn('Could not convert the Mermaid diagram to an image, keeping the source code:', e);
        }
    }

    // Công thức -> PNG như Mermaid; công thức nào vẽ lỗi sẽ tự rơi về MathML bên trong hàm này.
    await convertKatexToImagesForDoc(previewOutput, clone);

    // Chạy cuối: các bước trên ghép ảnh/biểu đồ/công thức theo chỉ số trong clone, mà việc đổi blockquote
    // thành bảng chỉ dời node chứ không đổi thứ tự tài liệu, nên để sau cùng cho chắc.
    // Đánh dấu bảng dữ liệu thật TRƯỚC khi convertQuotesForDoc() tạo thêm bảng khung quote (không có class này).
    clone.querySelectorAll('table').forEach((t) => t.classList.add('doc-data-table'));
    convertQuotesForDoc(clone);

    const html = buildWordHtml(clone.innerHTML);
    try {
        const saved = await saveTextFile('\ufeff' + html, deriveExportBaseName(text), 'doc', 'application/msword');
        if (saved) showToast("DOC file exported!");
    } catch (err) {
        console.error('DOC export failed:', err);
        showToast("An error occurred while exporting the DOC file.");
    }
}
