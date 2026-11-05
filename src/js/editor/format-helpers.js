// js/editor/format-helpers.js — Hàm thuần dùng cho thanh định dạng (heading, list, bảng, link, thẻ HTML, fence).

export function getHeadingLevel(line) {
    // 0-3 khoảng trắng/tab, 1-6 dấu #, rồi khoảng trắng hoặc hết dòng
    const m = line.match(/^[ \t]{0,3}(#{1,6})(?:[ \t]+|$)/);
    return m ? m[1].length : 0;
}

// level = 0 nghĩa là gỡ heading. Trả về { line, delta }, hoặc null nếu không có gì thay đổi.
export function setHeadingLevel(line, level) {
    // Như getHeadingLevel nhưng tách riêng phần thụt lề và khoảng trắng sau #.
    const m = line.match(/^([ \t]{0,3})(#{1,6})([ \t]+|$)/);
    const indent = m ? m[1] : (line.match(/^[ \t]*/) || [''])[0];
    const rest = m ? line.slice(m[0].length) : line.slice(indent.length);
    if (!m && level === 0) return null;
    const newLine = indent + (level > 0 ? '#'.repeat(level) + ' ' : '') + rest;
    if (newLine === line) return null;
    return { line: newLine, delta: newLine.length - line.length };
}

// Trả { indent, marker, kind, rest } (bullet | numbered | task | quote), hoặc null nếu không phải list.
export function parseListLine(line) {
    // thụt lề, marker (-, *, +, 1. / 1) hoặc >), khoảng trắng, checkbox tuỳ chọn, phần còn lại.
    const m = line.match(/^([ \t]*)([-*+]|\d+[.)]|>)([ \t]+)(\[[ xX]\][ \t]+)?(.*)$/);
    if (!m) return null;
    const [, indent, mark, sp, checkbox, rest] = m;
    const kind = checkbox ? 'task' : (mark === '>' ? 'quote' : (/^\d/.test(mark) ? 'numbered' : 'bullet'));
    return { indent, marker: mark + sp + (checkbox || ''), kind, rest };
}

// rows = số dòng THÂN bảng (tối thiểu 1). ponytail: header để trống cho người dùng điền;
// nâng cấp sau: điền tên cột từ vùng chọn hiện tại.
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
    // Đã có scheme, anchor # hoặc // thì giữ nguyên.
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url) || url.startsWith('#') || url.startsWith('//')) return url;
    return 'https://' + url;
}

export function escapeLinkText(text) {
    return text.replace(/([\[\]])/g, '\\$1');
}

// ponytail: toggle theo cặp thẻ trọn vẹn (như wrapOrToggleFormat với **), không xử lý thẻ lồng nhau;
// nâng cấp sau: parse DOM thật nếu cần.
// Trả { from, to, insert, selStart, selEnd }: thay đoạn [from, to] bằng `insert` rồi chọn [selStart, selEnd].
export function wrapHtmlTag(text, selStart, selEnd, tag) {
    const open = '<' + tag + '>';
    const close = '</' + tag + '>';
    const oLen = open.length;
    const cLen = close.length;
    const selected = text.substring(selStart, selEnd);

    if (selected.length >= oLen + cLen && selected.startsWith(open) && selected.endsWith(close)) {
        const unwrapped = selected.substring(oLen, selected.length - cLen);
        return { from: selStart, to: selEnd, insert: unwrapped, selStart, selEnd: selStart + unwrapped.length };
    }
    if (selStart >= oLen && selEnd + cLen <= text.length
        && text.substring(selStart - oLen, selStart) === open
        && text.substring(selEnd, selEnd + cLen) === close) {
        return {
            from: selStart - oLen,
            to: selEnd + cLen,
            insert: selected,
            selStart: selStart - oLen,
            selEnd: selEnd - oLen
        };
    }
    if (selStart === selEnd) {
        const placeholder = 'text';
        return {
            from: selStart,
            to: selEnd,
            insert: open + placeholder + close,
            selStart: selStart + oLen,
            selEnd: selStart + oLen + placeholder.length
        };
    }
    return {
        from: selStart,
        to: selEnd,
        insert: open + selected + close,
        selStart: selStart + oLen,
        selEnd: selEnd + oLen
    };
}

export function buildBlockFence(kind, body) {
    // Chỉ thay placeholder khi body rỗng; nội dung vùng chọn đã được indent sẵn.
    const hasBody = body != null && String(body).trim() !== '';
    if (kind === 'math') {
        return '$$\n' + (hasBody ? body : 'f(x) = \\int_{-\\infty}^{\\infty} e^{-x^2} dx') + '\n$$';
    }
    const lang = kind === 'mermaid' ? 'mermaid' : 'js';
    const fallback = kind === 'mermaid' ? 'graph TD\n    A[Start] --> B[End]' : '// code here';
    return '```' + lang + '\n' + (hasBody ? body : fallback) + '\n```';
}
