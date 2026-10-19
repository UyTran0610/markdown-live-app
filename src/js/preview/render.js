// js/preview/render.js — Render Markdown -> HTML (marked + DOMPurify + hljs + Mermaid + KaTeX), gán id heading và giữ vị trí cuộn.

import { charCounter, markdownInput, previewOutput } from '../core/dom.js';
import { slugifyText } from '../core/utils.js';
import { processGFMAlerts } from './alerts.js';
import { cacheMermaidResult, mermaidCache } from './mermaid-cache.js';
import { MERMAID_SANITIZE_CONFIG } from './sanitize.js';

// Gán id slug cho heading để link neo [mục](#muc) hoạt động; marked v14 bỏ headerIds.
// id phải duy nhất; chỉ đọc textContent nên không thêm đường XSS.
export function assignHeadingIds(container) {
    const used = new Set();
    container.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
        const base = slugifyText(h.textContent);
        if (!base) return;
        let id = base;
        let n = 1;
        while (used.has(id)) id = base + '-' + n++;
        used.add(id);
        h.id = id;
    });
}

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

// Mermaid vẽ bất đồng bộ nên lượt cũ có thể ghi đè scrollTop; so renderVersion để bỏ qua.
let renderVersion = 0;

export function renderMarkdown() {
    const myRenderVersion = ++renderVersion;

    const rawText = markdownInput.value;

    const previousPreviewScrollTop = previewOutput.scrollTop;

    // try/catch quanh marked.parse: vendor chưa tải xong thì hiện văn bản thô, không đụng innerHTML.
    let dirtyHtml;
    try {
        dirtyHtml = marked.parse(rawText);
    } catch (err) {
        console.error('Markdown parse failed, showing raw text:', err);
        previewOutput.textContent = rawText;
        charCounter.textContent = `${rawText.length} characters`;
        restorePreviewScrollTop(previousPreviewScrollTop);
        return;
    }

    // Fail-closed: chưa có DOMPurify thì hiện văn bản thuần, không bao giờ innerHTML HTML chưa lọc.
    if (typeof DOMPurify === 'undefined') {
        previewOutput.textContent = rawText;
        charCounter.textContent = `${rawText.length} characters`;
        restorePreviewScrollTop(previousPreviewScrollTop);
        return;
    }
    const cleanHtml = DOMPurify.sanitize(dirtyHtml, {
        USE_PROFILES: { html: true, mathMl: true, svg: true },
        ADD_ATTR: ['target', 'rel'],
        // Chỉ cho http(s)/mailto/tel/callto/ftp hoặc URL tương đối (chặn javascript:...).
        ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|callto|ftp):|[^a-zA-Z]|[a-zA-Z+.\-]+(?:[^a-zA-Z+.:]|$))/i
    });

    previewOutput.innerHTML = cleanHtml;
    // Gán id SAU sanitize: id là thuộc tính DOM, không qua HTML parser.
    assignHeadingIds(previewOutput);
    charCounter.textContent = `${rawText.length} characters`;

    // Chỉ khôi phục scrollTop MỘT lần ở cuối: các bước sau còn đổi chiều cao preview.

    processGFMAlerts();

    // ponytail: bỏ highlight khi preview >300k ký tự (O(blocks x size) mỗi lần gõ);
    // nâng cấp sau: highlight riêng khối đổi hoặc dùng worker.
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
                // Ghi scrollTop NGAY TRƯỚC khi thay nội dung: Mermaid làm khối cao hơn nhiều.
                const scrollTopBeforeMermaid = previewOutput.scrollTop;
                const scrollGenBeforeMermaid = previewScrollGen;

                mermaid.run({
                    nodes: nodesToRender,
                    suppressErrors: true
                }).then(() => {
                    nodesToRender.forEach((node) => {
                        // Mermaid sinh SVG chưa qua lọc: lọc lại trước khi tin và cache.
                        if (typeof DOMPurify !== 'undefined' && node.innerHTML) {
                            node.innerHTML = DOMPurify.sanitize(node.innerHTML, MERMAID_SANITIZE_CONFIG);
                        }
                        const code = codeByNode.get(node);
                        if (code && node.innerHTML) {
                            cacheMermaidResult(code, node.innerHTML);
                        }
                    });
                    notifyPreviewChanged();
                    // Lượt render mới hơn đã chạy: bỏ qua khôi phục scroll để không ghi đè vị trí mới.
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

    // Khôi phục scroll một lần, sau khi mọi thay đổi chiều cao đồng bộ đã xong.
    restorePreviewScrollTop(previousPreviewScrollTop);
}

function restorePreviewScrollTop(desiredScrollTop) {
    const maxPreviewScrollTop = Math.max(previewOutput.scrollHeight - previewOutput.clientHeight, 0);
    previewOutput.scrollTop = Math.min(desiredScrollTop, maxPreviewScrollTop);
}

let previewScrollGen = 0;

// HTML preview đã qua pipeline, dùng dựng lại preview của tab đã xem mà không chạy lại.
export function currentPreviewHtml() {
    return previewOutput.innerHTML;
}

// Dựng lại từ cache nhưng vẫn tăng renderVersion và huỷ Mermaid đang bay, nếu không lượt cũ ghi
// scrollTop vào tab mới. Không chạy lại hljs/mermaid (sẽ bọc span hai lần).
export function renderCachedHtml(html, scrollTop) {
    renderVersion++;
    clearTimeout(mermaidTimeout);
    if (mermaidScheduled) {
        mermaidScheduled = false;
        pendingMermaidJobs--;
    }
    previewOutput.innerHTML = html;
    charCounter.textContent = `${markdownInput.value.length} characters`;
    restorePreviewScrollTop(scrollTop);
}

// Báo preview đổi ngoài dự kiến để cache bị bỏ: Mermaid vẽ xong sau khi hàm đã trả về.
const previewChangedListeners = [];

export function onPreviewChanged(fn) {
    previewChangedListeners.push(fn);
}

function notifyPreviewChanged() {
    previewChangedListeners.forEach((fn) => fn());
}

// scroll-sync gọi khi người dùng cuộn: renderMarkdown dùng để biết có ghi đè scroll hay không.
export function notifyPreviewScrolled() {
    previewScrollGen++;
}
