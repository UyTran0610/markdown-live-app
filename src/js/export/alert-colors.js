// js/export/alert-colors.js — Màu và kiểu của GFM Alert, dùng chung cho .doc và .docx.
//
// Một nguồn duy nhất: thêm loại alert mới thì sửa ở đây, không sửa ở hai file xuất.

// Màu viền theo loại alert (dạng CSS, có dấu #).
export const ALERT_COLORS = {
    note: '#0969da',
    tip: '#1a7f37',
    important: '#8250df',
    warning: '#9a6700',
    caution: '#d1242f'
};

// Cùng màu nhưng không dấu # và viết hoa: ghép thẳng vào thuộc tính XML của OOXML.
export const ALERT_COLORS_XML = Object.fromEntries(
    Object.entries(ALERT_COLORS).map(([name, color]) => [name, color.slice(1).toUpperCase()])
);

const ALERT_TYPE_RE = /^markdown-alert-(note|tip|important|warning|caution)$/;

// Loại alert của một khối blockquote; '' nếu blockquote đó không phải alert.
export function alertTypeOf(el) {
    const cls = Array.from(el.classList).find((c) => ALERT_TYPE_RE.test(c));
    return cls ? cls.replace('markdown-alert-', '') : '';
}
