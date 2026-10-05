// js/core/utils.js — Hàm tiện ích dùng chung: debounce, kiểm tra URL ngoài an toàn.

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
