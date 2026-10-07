// js/core/utils.js — Hàm tiện ích dùng chung: debounce, kiểm tra URL ngoài an toàn, slug.

export function debounce(func, delay = 300) {
    let timeoutId;
    return function (...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
}

// Chỉ mở http(s)/mailto/tel ra trình duyệt hệ thống; chặn javascript:/data:/file:/blob: kể cả khi sanitizer bị lọt.
// ponytail: không mở `ftp:` vì ACL của plugin opener (gen/schemas/acl-manifests.json) chỉ chấp nhận
// mailto/tel/http/https; nâng cấp sau: thêm sms:/geo:/... khi biết ACL chấp nhận gì.
export function isSafeExternalUrl(href) {
    const url = String(href || '').trim();
    // http(s)://... hoặc mailto:/tel:...
    return /^(https?):\/\/\S/i.test(url) || /^(mailto|tel):\S/i.test(url);
}

// Slug dùng chung cho id heading (neo trong trang) và tên file xuất, để hai nơi cùng một bộ ký tự.
// Mặc định kiểu GitHub: chữ thường, bỏ dấu câu (giữ chữ/số mọi thứ tự + '-'), khoảng trắng -> '-'; dấu thanh giữ
// nguyên vì liên kết neo [mục](#tiêu-đề) phải khớp id. fold: true (tên file) bỏ thêm dấu phụ/đ -> ASCII dễ
// gõ và an toàn cho hệ thống file. \p{L}\p{N} giữ chữ/số của mọi thứ tự (CJK, Cyrillic...); ký tự cấm trong tên
// file (\ / : * ? " < > |) nằm ngoài tập này nên bị loại cùng lúc.
export function slugifyText(text, { fold = false } = {}) {
    let s = String(text);
    if (fold) {
        s = s.normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')   // bỏ dấu thanh/dấu phụ sau khi tách NFD
            .replace(/đ/gi, 'd');               // đ không bị tách trong NFD nên phải thay riêng
    }
    return s.trim().toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .replace(/\s+/g, '-');
}
