// js/preview/render.js — Render Markdown -> HTML (marked + DOMPurify + hljs + Mermaid + KaTeX) và giữ vị trí cuộn.

import { charCounter, markdownInput, previewOutput } from '../core/dom.js';
import { processGFMAlerts } from './alerts.js';
import { assignHeadingIds } from './headings.js';
import { cacheMermaidResult, mermaidCache } from './mermaid-cache.js';
import { MERMAID_SANITIZE_CONFIG } from './sanitize.js';

let mermaidTimeout = null;

let mermaidScheduled = false;

let pendingMermaidJobs = 0;

// Export chờ Mermaid vẽ xong thay vì đoán mốc 200ms.
export function whenMermaidIdle(timeoutMs = 8000) {
    return new Promise((resolve) => {
        const start = Date.now();
        const tick = () => {
            if (pendingMermaidJobs <= 0 || Date.now() - start > timeoutMs) resolve();
            else setTimeout(tick, 100);
        };
        tick();
    });
}

// Đánh số mỗi lượt renderMarkdown(). Mermaid vẽ bất đồng bộ nên lượt cũ (đã lỗi thời) có thể
// ghi đè scrollTop sau khi lượt mới đã khôi phục đúng; so renderVersion để lượt cũ bỏ qua.
let renderVersion = 0;

export function renderMarkdown() {
    const myRenderVersion = ++renderVersion;

    const rawText = markdownInput.value;

    const previousPreviewScrollTop = previewOutput.scrollTop;
    
    const dirtyHtml = marked.parse(rawText);

    // Fail-closed: chưa tải được DOMPurify thì hiển thị văn bản thuần, không bao giờ innerHTML HTML chưa lọc.
    if (typeof DOMPurify === 'undefined') {
        previewOutput.textContent = rawText;
        charCounter.textContent = `${rawText.length} characters`;
        restorePreviewScrollTop(previousPreviewScrollTop);
        return;
    }
    const cleanHtml = DOMPurify.sanitize(dirtyHtml, {
        USE_PROFILES: { html: true, mathMl: true, svg: true },
        ADD_ATTR: ['target', 'rel'],
        // Chỉ cho scheme http(s)/mailto/tel/callto/ftp hoặc URL tương đối (chặn scheme lạ như javascript:)
        ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|callto|ftp):|[^a-zA-Z]|[a-zA-Z+.\-]+(?:[^a-zA-Z+.:]|$))/i
    });

    previewOutput.innerHTML = cleanHtml;
    // Gán id SAU khi sanitize: id là thuộc tính DOM, không đi qua HTML parser.
    assignHeadingIds(previewOutput);
    charCounter.textContent = `${rawText.length} characters`;

    // KHÔNG khôi phục scrollTop ở đây: các bước sau (GFM alerts, hljs, mermaid, lucide) còn đổi chiều cao;
    // nếu chèn thêm chiều cao phía TRÊN vị trí đang xem thì preview bị đẩy lệch, trông như "cuộn dần lên"
    // sau mỗi lần gõ. Chỉ khôi phục MỘT lần ở cuối hàm (restorePreviewScrollTop).

    processGFMAlerts();

    // ponytail: bỏ highlight khi preview >300k ký tự (O(blocks x size) mỗi lần gõ); nâng cấp sau: highlight
    // riêng từng khối thay đổi hoặc dùng worker. Đo bằng cleanHtml (đã có sẵn trong RAM) vì đọc textContent
    // phải serialize lại cả cây DOM.
    const isHugePreview = cleanHtml.length > 300000;
    if (typeof hljs !== 'undefined' && !isHugePreview) {
        previewOutput.querySelectorAll('pre code').forEach((block) => {
            const hasLanguage = Array.from(block.classList).some(cls => cls.startsWith('language-'));
            if (hasLanguage && !block.classList.contains('language-mermaid')) {
                hljs.highlightElement(block);
            }
        });
    }
    
    if (typeof mermaid !== 'undefined') {
        const mermaidBlocks = previewOutput.querySelectorAll('pre code.language-mermaid');
        const nodesToRender = [];
        const codeByNode = new Map();

        mermaidBlocks.forEach((block) => {
            const code = block.textContent;
            const pre = block.parentElement;

            const newPre = document.createElement('pre');
            newPre.className = 'mermaid';

            const cachedSvg = mermaidCache.get(code);
            if (cachedSvg) {
                newPre.innerHTML = cachedSvg;
                newPre.dataset.mermaidCached = 'true';
            } else {
                newPre.textContent = code;
                nodesToRender.push(newPre);
                codeByNode.set(newPre, code);
            }

            pre.replaceWith(newPre);
        });

        clearTimeout(mermaidTimeout);
        if (mermaidScheduled) { mermaidScheduled = false; pendingMermaidJobs--; }
        if (nodesToRender.length > 0) {
            mermaidScheduled = true;
            pendingMermaidJobs++;
            mermaidTimeout = setTimeout(() => {
                mermaidScheduled = false;
                // Mermaid có thể làm khối cao hơn nhiều so với code chữ ban đầu: ghi scrollTop NGAY TRƯỚC khi thay
                // nội dung để khôi phục đúng vị trí đang xem sau khi vẽ xong (tránh preview bị nhảy/trôi lên).
                const scrollTopBeforeMermaid = previewOutput.scrollTop;
                const scrollGenBeforeMermaid = previewScrollGen;

                mermaid.run({
                    nodes: nodesToRender,
                    suppressErrors: true
                }).then(() => {
                    nodesToRender.forEach((node) => {
                        // Mermaid sinh SVG chưa qua lọc (click/href javascript:): lọc lại trước khi tin và cache.
                        if (typeof DOMPurify !== 'undefined' && node.innerHTML) {
                            node.innerHTML = DOMPurify.sanitize(node.innerHTML, MERMAID_SANITIZE_CONFIG);
                        }
                        const code = codeByNode.get(node);
                        if (code && node.innerHTML) {
                            cacheMermaidResult(code, node.innerHTML);
                        }
                    });
                    // Có lượt renderMarkdown() mới hơn chạy trong lúc Mermaid vẽ (vd người dùng gõ tiếp): lượt này đã lỗi
                    // thời, scrollTopBeforeMermaid không còn đúng. Bỏ qua khôi phục scroll để khỏi ghi đè vị trí của lượt mới.
                    if (myRenderVersion !== renderVersion) return;
                    // Người dùng đã cuộn trong lúc vẽ: giữ vị trí mới, không ghi đè.
                    if (scrollGenBeforeMermaid !== previewScrollGen) return;
                    restorePreviewScrollTop(scrollTopBeforeMermaid);
                }).catch((err) => {
                    console.warn("Mermaid render error (diagram is still being drafted):", err);
                }).finally(() => {
                    pendingMermaidJobs--;
                });
            }, 300);
        }
    }

    if (typeof lucide !== 'undefined') {
        lucide.createIcons({ root: previewOutput });
    }

    // Khôi phục scroll một lần, sau khi mọi thay đổi chiều cao đồng bộ ở trên đã xong.
    restorePreviewScrollTop(previousPreviewScrollTop);
}

function restorePreviewScrollTop(desiredScrollTop) {
    const maxPreviewScrollTop = Math.max(previewOutput.scrollHeight - previewOutput.clientHeight, 0);
    previewOutput.scrollTop = Math.min(desiredScrollTop, maxPreviewScrollTop);
}

let previewScrollGen = 0;

// Được gọi từ scroll-sync mỗi khi người dùng cuộn Preview: renderMarkdown dùng số này để biết
// người dùng đã cuộn trong lúc Mermaid vẽ (giữ vị trí mới, không ghi đè bằng vị trí cũ).
export function notifyPreviewScrolled() {
    previewScrollGen++;
}
