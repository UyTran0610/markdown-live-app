// js/core/utils.js — debounce, kiểm tra URL ngoài, slug dùng chung cho heading và tên file.

// delay có thể là số hoặc hàm: tài liệu lớn cần chờ lâu hơn trước khi render preview.
export function debounce(func, delay = 300) {
    let timeoutId;
    return function (...args) {
        clearTimeout(timeoutId);
        const wait = typeof delay === 'function' ? delay() : delay;
        timeoutId = setTimeout(() => {
            func.apply(this, args);
        }, wait);
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
    // \p{M} = dấu thanh tổ hợp: bỏ nó thì tiêu đề NFD (Việt/Hindi/Thái) mất dấu và neo lệch.
    return s.trim().toLowerCase()
        .replace(/[^\p{L}\p{N}\p{M}\s-]/gu, '')
        .replace(/\s+/g, '-');
}

// Ký tự tính vào từ: chữ cái, số, và mọi chữ ngoài ASCII (Latin mở rộng ệ ộ ữ, Cyrillic, CJK...).
// Các khối ký hiệu (gạch dài, ngoặc kép cong, mũi tên, emoji) bị loại để không tính thành từ.
function isWordChar(code) {
    if (code >= 97 && code <= 122) return true;        // a-z
    if (code >= 65 && code <= 90) return true;         // A-Z
    if (code >= 48 && code <= 57) return true;         // 0-9
    if (code < 0x00c0) return false;                   // ASCII còn lại: dấu câu, khoảng trắng
    if (code >= 0x2000 && code <= 0x206f) return false; // General Punctuation: – — “ ” …
    if (code >= 0x20a0 && code <= 0x20cf) return false; // Currency
    if (code >= 0x2100 && code <= 0x2bff) return false; // Letterlike, mũi tên, toán học
    if (code >= 0x1f000) return false;                 // Emoji
    return true;
}

// Số từ: quét một lượt ký tự (nhanh hơn regex trên tài liệu lớn).
// Dấu markdown (#, *, |) không tính là từ; dấu nháy và gạch nối chỉ giữ từ khi nằm giữa hai chữ.
export function countWords(text) {
    if (!text) return 0;
    let count = 0;
    let inWord = false;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (isWordChar(code)) {
            if (!inWord) {
                count++;
                inWord = true;
            }
            continue;
        }
        if (inWord && (code === 39 || code === 45 || code === 0x2019) && isWordChar(text.charCodeAt(i + 1))) continue;
        inWord = false;
    }
    return count;
}