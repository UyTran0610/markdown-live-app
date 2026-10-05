// js/preview/sanitize.js — Cấu hình và hook DOMPurify (chặn scheme nguy hiểm, mở link ngoài an toàn).

// DOMPurify mặc định bỏ <foreignObject>, mà nhãn Mermaid (htmlLabels) nằm trong đó
// -> thiếu ADD_TAGS này thì chữ trong flowchart biến mất.
export const MERMAID_SANITIZE_CONFIG = {
    USE_PROFILES: { html: true, svg: true },
    ADD_ATTR: ['target', 'rel'],
    ADD_TAGS: ['foreignObject'],
    // Chỉ cho scheme http(s)/mailto/tel/callto/ftp hoặc URL tương đối (chặn scheme lạ như javascript:)
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|callto|ftp):|[^a-zA-Z]|[a-zA-Z+.\-]+(?:[^a-zA-Z+.:]|$))/i
};

export function initSanitizer() {
    if (typeof DOMPurify !== 'undefined') {
        DOMPurify.addHook('afterSanitizeAttributes', (node) => {
            const tag = (node.tagName || '').toUpperCase();
            // SVG <a> có tagName viết thường + xlink:href: chặn trên mọi phần tử.
            const url = node.getAttribute
                ? (node.getAttribute('href') || node.getAttribute('xlink:href')) : null;
            // Chặn scheme nguy hiểm: javascript:, data:, vbscript:
            if (url != null && /^\s*(javascript|data|vbscript):/i.test(url)) {
                node.removeAttribute('href');
                node.removeAttribute('xlink:href');
                return;
            }
            // Form/iframe không có chỗ trong preview: bỏ thuộc tính điều hướng.
            node.removeAttribute('formaction');
            if (tag === 'FORM') node.removeAttribute('action');
            if (tag === 'IFRAME') node.removeAttribute('srcdoc');
            if (tag === 'A' && node.hasAttribute('href')) {
                const href = node.getAttribute('href') || '';
                // Chặn scheme nguy hiểm trên thẻ <a>
                if (/^\s*(javascript|data|vbscript):/i.test(href)) {
                    node.removeAttribute('href');
                    return;
                }
                if (href.startsWith('#')) {
                    node.removeAttribute('target');
                    node.removeAttribute('rel');
                } else {
                    node.setAttribute('target', '_blank');
                    node.setAttribute('rel', 'noopener noreferrer nofollow');
                }
            }
        });
    }
}
