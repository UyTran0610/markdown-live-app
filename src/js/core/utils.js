// js/core/utils.js — debounce, kiểm tra URL ngoài, slug dùng chung cho heading và tên file.

export function debounce(func, delay = 300) {
    let timeoutId;
    return function (...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
}

// Chỉ mở http(s)/mailto/tel ra hệ thống; chặn javascript:/data:/file:/blob: kể cả khi sanitizer lọt.
// ponytail: chưa mở ftp:/sms:/geo: vì ACL của plugin opener chỉ nhận 4 scheme trên.
export function isSafeExternalUrl(href) {
    const url = String(href || '').trim();
    return /^(https?):\/\/\S/i.test(url) || /^(mailto|tel):\S/i.test(url);
}

// Slug chung cho id heading và tên file xuất; fold: true bỏ dấu phụ/đ để tên file ra ASCII.
// Giữ chữ/số mọi hệ và tự loại ký tự cấm trong tên file.
export function slugifyText(text, { fold = false } = {}) {
    let s = String(text);
    if (fold) {
        s = s.normalize('NFD')
            // Chỉ bỏ dấu phụ sau chữ Latin; Cyrillic/kana/Hangul giữ nguyên chữ.
            .replace(/(\p{Script=Latin})[\u0300-\u036f]+/gu, '$1')
            .replace(/đ/gi, 'd')                // đ không bị tách trong NFD nên phải thay riêng
            .normalize('NFC');
    }
    return s.trim().toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .replace(/\s+/g, '-');
}