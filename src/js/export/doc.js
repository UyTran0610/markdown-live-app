// js/export/doc.js — Xuất file Word (.doc) từ HTML của preview.

import { previewOutput } from '../core/dom.js';
import { getDocText } from '../editor/cm.js';
import { showToast } from '../core/toast.js';
import { convertQuotesForDoc, stripUnusedHeadingIds, styleDataTablesForDoc } from './doc-transform.js';
import { deriveExportBaseName, saveTextFile } from './file-save.js';
import {
    convertMermaidToImages,
    prepareDocImages
} from './images.js';
import { convertKatexToImagesForDoc } from './math-image.js';
import { renderMarkdown, whenMermaidIdle, flushLazyRenders } from '../preview/render.js';

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
    const text = getDocText();
    if (!text.trim()) {
        showToast("Content is empty, nothing to export.");
        return;
    }
    showToast("Generating DOC file...");

    renderMarkdown({ force: true });
    flushLazyRenders();
    await whenMermaidIdle(8000);
    const clone = previewOutput.cloneNode(true);

    stripUnusedHeadingIds(clone);

    clone.querySelectorAll('svg').forEach((el) => el.remove());
    clone.querySelectorAll('input[type="checkbox"]').forEach((el) => {
        el.replaceWith(document.createTextNode(el.checked ? '\u2611 ' : '\u2610 '));
    });

    // Ảnh về đúng kích thước hiển thị (SVG -> PNG), Mermaid -> PNG.
    await prepareDocImages(previewOutput, clone, { withStyle: true });
    await convertMermaidToImages(previewOutput, clone, { withStyle: true });

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
