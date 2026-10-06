// js/export/html.js — Xuất file .html độc lập.

import { markdownInput, previewOutput } from '../core/dom.js';
import { showToast } from '../core/toast.js';
import { deriveDocumentTitle, deriveExportBaseName, saveTextFile } from './file-save.js';
import { convertKatexForDoc } from './katex.js';
import { renderMarkdown, whenMermaidIdle } from '../preview/render.js';

// CSS tối giản nhúng trong file HTML (trình duyệt không đọc được stylesheet của app). Phải kèm cả
// sup/sub/kbd/mark/details, canh lề checkbox task list và canh giữa Mermaid: app lấy các rule này từ vendor CSS.
const HTML_STYLES = `
    body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.6; max-width: 800px; margin: 2rem auto; padding: 0 1rem; color: #1f2328; background: #fff; }
    h1 { font-size: 2em; } h2 { font-size: 1.5em; } h3 { font-size: 1.25em; }
    h4 { font-size: 1em; } h5 { font-size: .875em; } h6 { font-size: .85em; color: #59636e; }
    table { border-collapse: collapse; width: 100%; margin: 10px 0; }
    th, td { border: 1px solid #d1d9e0; padding: 6px 13px; text-align: left; }
    th { background: #f6f8fa; font-weight: bold; }
    pre { background: #f6f8fa; border-radius: 6px; padding: 12px; overflow-x: auto; font-family: Consolas, "Courier New", monospace; font-size: 85%; }
    code { font-family: Consolas, "Courier New", monospace; background: #f6f8fa; padding: .2em .4em; border-radius: 6px; font-size: 85%; }
    pre code { background: none; padding: 0; font-size: 100%; }
    blockquote { border-left: 4px solid #d1d9e0; margin-left: 0; padding-left: 12px; color: #59636e; }
    img { max-width: 100%; height: auto; }
    a { color: #0969da; }
    hr { border: none; border-top: 1px solid #d1d9e0; }
    .markdown-alert { border-left: 4px solid #0969da; background: #f6f8fa; padding: 8px 12px; }
    .markdown-alert-title { font-weight: bold; }
    .markdown-alert-tip { border-left-color: #1a7f37; }
    .markdown-alert-important { border-left-color: #8250df; }
    .markdown-alert-warning { border-left-color: #9a6700; }
    .markdown-alert-caution { border-left-color: #d1242f; }
    svg { max-width: 100%; height: auto; }
    .mermaid { display: flex; justify-content: center; align-items: center; background: transparent; border: none; }
    sup, sub { font-size: .75em; }
    kbd { font-family: Consolas, "Courier New", monospace; font-size: 85%; background: #f6f8fa; border: 1px solid #d1d9e0; border-bottom-width: 2px; border-radius: 6px; padding: .15em .4em; }
    mark { background: #fff3bf; color: #24292f; padding: .1em .2em; }
    details { border: 1px solid #d1d9e0; border-radius: 6px; padding: 8px 12px; margin: 10px 0; }
    summary { font-weight: bold; cursor: pointer; }
    li:has(> input[type="checkbox"]) { list-style-type: none; margin-left: -1.2em; }
    li > input[type="checkbox"] { margin: 0 0.4em 0.2em 0; vertical-align: middle; }
`;

export function buildStandaloneHtml(bodyHtml, title) {
    // Escape & < > để title không bẻ gãy thẻ <title>
    const safeTitle = String(title || 'Document')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n'
        + '<meta charset="UTF-8">\n'
        + '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
        + '<title>' + safeTitle + '</title>\n'
        + '<style>' + HTML_STYLES + '</style>\n</head>\n<body>\n' + bodyHtml + '\n</body>\n</html>';
}

// Gỡ icon Lucide của GFM alert (trình duyệt ngoài không có lib để vẽ lại); chỉ xoá đúng class lucide để
// KHÔNG đụng SVG Mermaid, vì file HTML cần giữ nguyên SVG đó. Checkbox task list giữ nguyên.
function stripLucideIcons(container) {
    container.querySelectorAll('svg.lucide').forEach((el) => el.remove());
}

export async function exportHtml() {
    const text = markdownInput.value;
    if (!text.trim()) {
        showToast("Content is empty, nothing to export.");
        return;
    }
    showToast("Generating HTML file...");

    // Clone Preview đã render xong (như exportDoc nhưng giữ nguyên SVG Mermaid, không cần chuyển sang PNG).
    renderMarkdown();
    await whenMermaidIdle(8000);
    const clone = previewOutput.cloneNode(true);

    stripLucideIcons(clone);

    // KaTeX -> MathML thuần: file không mang CSS của KaTeX nên phải thay span.katex bằng <math>.
    convertKatexForDoc(clone);

    const html = buildStandaloneHtml(clone.innerHTML, deriveDocumentTitle(text));
    try {
        const saved = await saveTextFile(html, deriveExportBaseName(text), 'html', 'text/html;charset=utf-8');
        if (saved) showToast("HTML file exported!");
    } catch (err) {
        console.error('HTML export failed:', err);
        showToast("An error occurred while exporting the HTML file.");
    }
}
