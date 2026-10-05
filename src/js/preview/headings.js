// js/preview/headings.js — Gán id (slug) cho heading để link neo [mục](#muc) hoạt động.

// Slug kiểu GitHub (chữ thường, bỏ dấu câu, khoảng trắng -> '-'). marked v14 bỏ tuỳ chọn headerIds nên
// tiêu đề không có id và liên kết neo [mục](#muc-luc) không tìm thấy đích.
export function slugifyHeading(text) {
    // Bỏ ký tự không phải chữ/số/khoảng trắng/'-' (hỗ trợ Unicode), rồi đổi khoảng trắng thành '-'
    return String(text).trim().toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .replace(/\s+/g, '-');
}

// id phải duy nhất (tiêu đề trùng thêm hậu tố -1, -2). Chỉ đọc textContent rồi gán .id,
// không parse HTML nên không mở thêm đường XSS.
export function assignHeadingIds(container) {
    const used = new Set();
    container.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
        const base = slugifyHeading(h.textContent);
        if (!base) return;
        let id = base;
        let n = 1;
        while (used.has(id)) id = base + '-' + n++;
        used.add(id);
        h.id = id;
    });
}
