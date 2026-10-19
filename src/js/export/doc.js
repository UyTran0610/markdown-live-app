// js/export/doc.js — Xuất file Word (.doc) từ HTML của preview.

import { markdownInput, previewOutput } from '../core/dom.js';
import { showToast } from '../core/toast.js';
import { convertQuotesForDoc, stripUnusedHeadingIds, styleDataTablesForDoc } from './doc-transform.js';
import { deriveExportBaseName, saveTextFile } from './file-save.js';
import {
    fitDocImageSize,
    getDocImageSize,
    isSvgImageSrc,
    svgImageToPngDataUrl,
    svgToPngDataUrl,
    waitForImageLoad
} from './images.js';
import { convertKatexToImagesForDoc } from './math-image.js';
import { renderMarkdown, whenMermaidIdle } from '../preview/render.js';

// CSS tối giản nhúng trong DOC: Word không đọc stylesheet của app, và không áp selector hậu duệ
// xuống ô con nên viền bảng/quote phải inline.
const DOC_STYLES = `
    body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.5; }
    h1 { font-size: 20pt; } h2 { font-size: 16pt; } h3 { font-size: 14pt; }
    h4 { font-size: 12pt; } h5 { font-size: 11pt; } h6 { font-size: 10pt; color: #57606a; }
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

// Ảnh URL remote giữ nguyên <img src>, Word tự tải.
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

    // Ánh xạ theo chính node pre (không theo chỉ số svg): mermaid lỗi làm lệch chỉ số và xuất nhầm ảnh.
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

    // Công thức -> PNG như Mermaid; công thức lỗi tự rơi về MathML trong hàm này.
    await convertKatexToImagesForDoc(previewOutput, clone);

    // Chạy cuối: convertQuotesForDoc() chỉ dời node nên thứ tự tài liệu không đổi.
    // Viền bảng phải gắn TRƯỚC khung quote, để ô của bảng khung chỉ còn viền trái.
    styleDataTablesForDoc(clone);
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
