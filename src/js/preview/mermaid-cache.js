// js/preview/mermaid-cache.js — Cache SVG Mermaid theo mã nguồn để khỏi vẽ lại.

// Cache SVG Mermaid theo mã nguồn: khối không đổi thì dùng lại, khỏi chạy mermaid.run() (50-200ms/biểu đồ).
// Xoá khi đổi theme vì màu SVG gắn với theme lúc vẽ.
export const mermaidCache = new Map();

// ponytail: giới hạn theo số mục + tổng ký tự để tránh phình bộ nhớ; nâng cấp sau: LRU theo bytes thực tế.
const MERMAID_CACHE_LIMIT = 60;

const MERMAID_CACHE_MAX_CHARS = 600000;

let mermaidCacheChars = 0;

export function cacheMermaidResult(code, html) {
    const prev = mermaidCache.get(code);
    if (prev !== undefined) {
        mermaidCacheChars -= code.length + prev.length;
        mermaidCache.delete(code);
    }
    mermaidCache.set(code, html);
    mermaidCacheChars += code.length + html.length;
    while (mermaidCache.size > MERMAID_CACHE_LIMIT || mermaidCacheChars > MERMAID_CACHE_MAX_CHARS) {
        const oldest = mermaidCache.keys().next().value;
        const oldHtml = mermaidCache.get(oldest);
        mermaidCacheChars -= oldest.length + (oldHtml ? oldHtml.length : 0);
        mermaidCache.delete(oldest);
    }
}

export function clearMermaidCache() {
    mermaidCache.clear();
    mermaidCacheChars = 0;
}
