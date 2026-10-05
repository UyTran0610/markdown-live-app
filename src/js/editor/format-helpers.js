// js/editor/format-helpers.js — Hàm thuần dùng cho thanh định dạng (heading, list, bảng, link, thẻ HTML, fence).

export function getHeadingLevel(line) {
    // 0-3 khoảng trắng/tab, 1-6 dấu #, rồi khoảng trắng hoặc hết dòng
    const m = line.match(/^[ \t]{0,3}(#{1,6})(?:[ \t]+|$)/);
    return m ? m[1].length : 0;
}

// level = 0 nghĩa là gỡ heading. Trả về { line, delta }, hoặc null nếu không có gì thay đổi.
export function setHeadingLevel(line, level) {
    // Như getHeadingLevel nhưng tách riêng phần thụt lề và khoảng trắng sau #
    const m = line.match(/^([ \t]{0,3})(#{1,6})([ \t]+|$)/);
    // Dòng thường: lấy phần thụt lề đầu dòng
    const indent = m ? m[1] : (line.match(/^[ \t]*/) || [''])[0];
    const rest = m ? line.slice(m[0].length) : line.slice(indent.length);
    if (!m && level === 0) return null;
    const newLine = indent + (level > 0 ? '#'.repeat(level) + ' ' : '') + rest;
    if (newLine === line) return null;
    return { line: newLine, delta: newLine.length - line.length };
}

// Trả về { indent, marker, kind, rest } (kind: bullet | numbered | task | quote),
// hoặc null nếu không phải dòng danh sách.
export function parseListLine(line) {
    // thụt lề, marker (-, *, +, 1. / 1) hoặc >), khoảng trắng, checkbox tuỳ chọn, phần còn lại
    const m = line.match(/^([ \t]*)([-*+]|\d+[.)]|>)([ \t]+)(\[[ xX]\][ \t]+)?(.*)$/);
    if (!m) return null;
    const [, indent, mark, sp, checkbox, rest] = m;
    // Marker bắt đầu bằng chữ số -> danh sách có thứ tự
    const kind = checkbox ? 'task' : (mark === '>' ? 'quote' : (/^\d/.test(mark) ? 'numbered' : 'bullet'));
    return { indent, marker: mark + sp + (checkbox || ''), kind, rest };
}

// rows = số dòng THÂN bảng (tối thiểu 1, để luôn có ô để gõ). ponytail: header để trống cho người dùng điền;
// nâng cấp sau: điền tên cột từ vùng chọn hiện tại nếu có.
export function buildTableMarkdown(rows, cols) {
    const r = Math.max(1, Math.min(99, rows | 0));
    const c = Math.max(1, Math.min(99, cols | 0));
    const out = ['|' + ' Head |'.repeat(c), '|' + ' --- |'.repeat(c)];
    for (let i = 0; i < r; i++) out.push('|' + '  |'.repeat(c));
    return out.join('\n');
}

// ponytail: kiểm tra scheme bằng regex đơn giản, đủ cho anchor/email/relative
export function normalizeLinkUrl(raw) {
    const url = String(raw || '').trim();
    if (!url) return '';
    // Đã có scheme (http:, mailto:, ...), anchor # hoặc protocol-relative // thì giữ nguyên
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url) || url.startsWith('#') || url.startsWith('//')) return url;
    return 'https://' + url;
}

export function escapeLinkText(text) {
    // Thêm \ trước [ và ]
    return text.replace(/([\[\]])/g, '\\$1');
}

// ponytail: toggle theo cặp thẻ trọn vẹn (như wrapOrToggleFormat với **), không xử lý thẻ lồng nhau;
// nâng cấp sau: parse DOM thật nếu cần.
export function wrapHtmlTag(val, selStart, selEnd, tag) {
    const open = '<' + tag + '>';
    const close = '</' + tag + '>';
    const oLen = open.length;
    const cLen = close.length;
    const selected = val.substring(selStart, selEnd);

    if (selected.length >= oLen + cLen && selected.startsWith(open) && selected.endsWith(close)) {
        const unwrapped = selected.substring(oLen, selected.length - cLen);
        return { text: val.substring(0, selStart) + unwrapped + val.substring(selEnd), selStart, selEnd: selStart + unwrapped.length };
    }
    if (selStart >= oLen && selEnd + cLen <= val.length
        && val.substring(selStart - oLen, selStart) === open
        && val.substring(selEnd, selEnd + cLen) === close) {
        return {
            text: val.substring(0, selStart - oLen) + selected + val.substring(selEnd + cLen),
            selStart: selStart - oLen,
            selEnd: selEnd - oLen
        };
    }
    if (selStart === selEnd) {
        const placeholder = 'text';
        const insert = open + placeholder + close;
        return { text: val.substring(0, selStart) + insert + val.substring(selEnd), selStart: selStart + oLen, selEnd: selStart + oLen + placeholder.length };
    }
    return {
        text: val.substring(0, selStart) + open + selected + close + val.substring(selEnd),
        selStart: selStart + oLen,
        selEnd: selEnd + oLen
    };
}

export function buildBlockFence(kind, body) {
    // Chỉ thay placeholder khi body rỗng/toàn khoảng trắng; giữ nguyên nội dung (kể cả thụt lề) vì vùng chọn
    // đưa vào code block đã được indent sẵn.
    const hasBody = body != null && String(body).trim() !== '';
    if (kind === 'math') {
        return '$$\n' + (hasBody ? body : 'f(x) = \\int_{-\\infty}^{\\infty} e^{-x^2} dx') + '\n$$';
    }
    const lang = kind === 'mermaid' ? 'mermaid' : 'js';
    const fallback = kind === 'mermaid' ? 'graph TD\n    A[Start] --> B[End]' : '// code here';
    return '```' + lang + '\n' + (hasBody ? body : fallback) + '\n```';
}
