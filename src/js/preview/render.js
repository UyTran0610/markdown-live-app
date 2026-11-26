// js/preview/render.js — Render Markdown theo khối: marked.lexer tách token → hash → cache HTML
// theo khối → chỉ patch khối đổi. KaTeX/Mermaid/hljs chỉ chạy khi khối vào viewport.

import { previewOutput, setCharCount } from '../core/dom.js';
import { getDocLength, getDocText } from '../editor/cm.js';
import { slugifyText } from '../core/utils.js';
import { processGFMAlerts } from './alerts.js';
import { cacheMermaidResult, mermaidCache } from './mermaid-cache.js';
import { MERMAID_SANITIZE_CONFIG } from './sanitize.js';
import { cyrb53, findBlockHtml, storeBlockHtml, patchBlocks, resetBlocks, snapshotBlocks } from './blocks.js';

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

// Extension thay markedKatex (đã gỡ khỏi vendor vì bản này không hỗ trợ hoãn render):
// parse ra placeholder, KaTeX chỉ render khi khối vào viewport (hoặc khi export flush).
// Regex copy từ marked-katex-extension (MIT), giữ nguyên ngữ nghĩa (gồm dấu câu toàn kỳ CJK).
const INLINE_MATH = /^(\${1,2})(?!\$)((?:\\.|[^\\\n])*?(?:\\.|[^\\\n\$]))\1(?=[\s?!\.,:？！。，：]|$)/;
const BLOCK_MATH = /^(\${1,2})\n((?:\\[^]|[^\\])+?)\n\1(?:\n|$)/;

function escapeHtmlText(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function createLazyMathExtension() {
    // `start` bắt buộc: viên nhận inline nuốt cả $...$ vào text token nếu không có nó.
    // Trả absolute index trong src; undefined = không có math (marked bỏ qua extension).
    const mathStart = (src) => {
        for (const m of src.matchAll(/\$/g)) {
            const i = m.index;
            if (i === 0 || src.charAt(i - 1) === ' ') {
                if (INLINE_MATH.test(src.substring(i))) return i;
            }
        }
        return undefined;
    };
    return {
        extensions: [
            {
                name: 'inlineKatexLazy',
                level: 'inline',
                start: mathStart,
                tokenizer(src) {
                    const match = src.match(INLINE_MATH);
                    if (match) {
                        return { type: 'inlineKatexLazy', raw: match[0], text: match[2].trim(), displayMode: match[1].length === 2 };
                    }
                    return undefined;
                },
                renderer(token) {
                    return `<span class="math-slot" data-display="${token.displayMode ? 1 : 0}">${escapeHtmlText(token.text)}</span>`;
                }
            },
            {
                name: 'blockKatexLazy',
                level: 'block',
                tokenizer(src) {
                    const match = src.match(BLOCK_MATH);
                    if (match) {
                        return { type: 'blockKatexLazy', raw: match[0], text: match[2].trim(), displayMode: match[1].length === 2 };
                    }
                    return undefined;
                },
                renderer(token) {
                    return `<div class="math-slot" data-display="1">${escapeHtmlText(token.text)}</div>\n`;
                }
            }
        ]
    };
}

// Render một khối (miss cache): marked.parser → DOMPurify → alerts → HTML cache.
function renderBlockHtml(token) {
    const dirty = marked.parser([token]);
    // Fail-closed: chưa có DOMPurify thì trả placeholder text (gần như không xảy ra, sanitizer
    // luôn init trước render).
    if (typeof DOMPurify === 'undefined') return { html: '', failed: 'purify-missing' };
    const clean = DOMPurify.sanitize(dirty, {
        USE_PROFILES: { html: true, mathMl: true, svg: true },
        ADD_ATTR: ['target', 'rel'],
        // Chỉ cho http(s)/mailto/tel/callto/ftp hoặc URL tương đối (chặn javascript:...).
        ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|callto|ftp):|[^a-zA-Z]|[a-zA-Z+.\-]+(?:[^a-zA-Z+.:]|$))/i,
        // CSS trong Markdown áp lên cả app: <style> làm trắng cửa sổ, style= che bằng overlay.
        // <form> giữ lại thì bấm nút submit làm cửa sổ tải lại/trắng; <input> phải giữ cho task list.
        FORBID_TAGS: ['style', 'form'],
        FORBID_ATTR: ['style']
    });
    const tpl = document.createElement('template');
    tpl.innerHTML = clean;
    processGFMAlerts(tpl.content);
    return { html: tpl.innerHTML };
}

// Vân tay của một khối. PHẢI trộn cả định nghĩa link: marked nuốt dòng `[d]: https://…`
// nên token.raw không đổi khi đổi địa chỉ, và khối cũ sẽ được dùng lại với link sai.
// Hàm này export để self-check băm y hệt cách render băm (lệch công thức là test sai).
export function blockFingerprint(linksKey, token) {
    return cyrb53(linksKey + token.raw);
}

// Tách tài liệu thành block {hash, html}; hash của raw section quyết định cache.
// Block lỗi chỉ tệ đi thành văn bản thô, không kéo theo cả preview (lexer lỗi mới rơi về catch ngoài).
function lexAndRender(rawText) {
    const tokens = marked.lexer(rawText);
    // Link reference ([docs][d]) lấy địa chỉ từ dòng định nghĩa ở chỗ khác -> trộn links
    // vào vân tay của MỌI khối, không chỉ khối chứa dòng định nghĩa.
    const linksKey = JSON.stringify(tokens.links || {});
    return tokens.map((token) => {
        const hash = blockFingerprint(linksKey, token);
        const cached = findBlockHtml(hash);
        if (cached !== undefined) return { hash, html: cached };
        let html;
        // Lỗi tạm thời không được cache: bản raw-text sẽ dính mãi tới khi đuổi LRU.
        let cacheable = true;
        try {
            const { html: rendered, failed } = renderBlockHtml(token);
            if (failed) throw new Error(failed);
            html = rendered;
        } catch (err) {
            console.warn('Block render failed, showing raw text for the block:', err);
            cacheable = false;
            html = `<p>${escapeHtmlText(token.raw)}</p>`;
        }
        if (cacheable) storeBlockHtml(hash, html);
        return { hash, html };
    });
}

// Biến đổi <pre><code class="language-mermaid"> thành <pre class="mermaid"> TRƯỚC khi
// chèn vào DOM (node gốc của khối là top-level nên phải đúng ngay từ đầu).
function prepareMermaidFragment(fragment) {
    fragment.querySelectorAll('pre code.language-mermaid').forEach((code) => {
        const pre = code.parentElement;
        if (!pre) return;
        const newPre = document.createElement('pre');
        newPre.className = 'mermaid';
        newPre.textContent = code.textContent;
        pre.replaceWith(newPre);
    });
}

// --- Enhancement lười (KaTeX / hljs / Mermaid) chỉ khi khối vào viewport ---

const pendingEnhance = new Map(); // el -> 'math' | 'hljs' | 'mermaid'

const io = typeof IntersectionObserver === 'undefined'
    ? null
    : new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const el = entry.target;
            const kind = pendingEnhance.get(el);
            if (!kind) { io.unobserve(el); continue; }
            pendingEnhance.delete(el);
            io.unobserve(el);
            enhanceNode(el, kind);
        }
    }, { root: previewOutput, rootMargin: '400px 0px' });

function enhanceKindsOf(el) {
    const kinds = [];
    const root = el.nodeType === 1 ? [el] : [];
    const all = root.concat(el.querySelectorAll ? [...el.querySelectorAll('.math-slot, pre.mermaid, pre code[class*="language-"]')] : []);
    for (const node of all) {
        if (node.nodeType !== 1) continue;
        if (node.classList.contains('math-slot')) kinds.push(['math', node]);
        else if (node.tagName === 'PRE' && node.classList.contains('mermaid')) kinds.push(['mermaid', node]);
        else if (node.tagName === 'CODE') {
            const hasLang = [...node.classList].some((cls) => cls.startsWith('language-'));
            if (hasLang && !node.classList.contains('language-mermaid') && !node.classList.contains('hljs')) {
                kinds.push(['hljs', node]);
            }
        }
    }
    return kinds;
}

function registerEnhance(nodes) {
    for (const node of nodes) {
        for (const [kind, el] of enhanceKindsOf(node)) {
            if (pendingEnhance.has(el)) continue;
            pendingEnhance.set(el, kind);
            if (io) io.observe(el);
            else { const k = pendingEnhance.get(el); pendingEnhance.delete(el); enhanceNode(el, k); }
        }
    }
}

// Bỏ phần tử không còn trong DOM (khối bị thay/huỷ).
function sweepEnhance() {
    for (const el of pendingEnhance.keys()) {
        if (!el.isConnected) {
            pendingEnhance.delete(el);
            if (io) io.unobserve(el);
        }
    }
}

const mermaidQueue = new Set();
let mermaidDebounce = null;

function queueMermaid(el) {
    mermaidQueue.add(el);
    clearTimeout(mermaidDebounce);
    mermaidDebounce = setTimeout(flushMermaidRun, 150);
}

function enhanceNode(el, kind) {
    if (!el.isConnected) return;
    if (kind === 'math') {
        if (typeof katex !== 'undefined') {
            try {
                katex.render(el.textContent || '', el, {
                    throwOnError: false,
                    displayMode: el.dataset.display === '1'
                });
            } catch (err) {
                console.warn('KaTeX render failed:', err);
            }
        }
        return;
    }
    if (kind === 'hljs') {
        if (typeof hljs !== 'undefined' && !el.classList.contains('hljs')) hljs.highlightElement(el);
        return;
    }
    if (kind === 'mermaid') {
        const cached = mermaidCache.get(el.textContent);
        if (cached) {
            el.innerHTML = cached;
            el.dataset.mermaidCached = 'true';
            return;
        }
        queueMermaid(el);
    }
}

function flushMermaidRun() {
    clearTimeout(mermaidDebounce);
    mermaidDebounce = null;
    const nodes = [...mermaidQueue].filter((n) => n.isConnected);
    mermaidQueue.clear();
    // Fail-closed: thiếu DOMPurify thì giữ pre.mermaid dạng text thô, không vẽ SVG chưa lọc.
    if (!nodes.length || typeof mermaid === 'undefined' || typeof DOMPurify === 'undefined') {
        if (nodes.length && typeof DOMPurify === 'undefined') console.warn('Mermaid skipped: DOMPurify missing.');
        return;
    }
    const scrollTopBefore = previewOutput.scrollTop;
    const genBefore = previewScrollGen;
    const versionBefore = renderVersion;
    pendingMermaidJobs++;
    // Mermaid thay source bằng SVG: chụp source TRƯỚC khi vẽ, nếu không khoá cache
    // lại là chính text của SVG và lần sau không bao giờ trúng cache.
    const sources = nodes.map((node) => node.textContent || '');
    mermaid.run({ nodes, suppressErrors: true }).then(() => {
        nodes.forEach((node, i) => {
            // Mermaid sinh SVG chưa qua lọc: lọc lại trước khi tin và cache.
            node.innerHTML = DOMPurify.sanitize(node.innerHTML, MERMAID_SANITIZE_CONFIG);
            const code = sources[i];
            if (code && node.innerHTML) cacheMermaidResult(code, node.innerHTML);
        });
        // Tab preview cache giữ block HTML (không kèm SVG Mermaid) nên không cần bỏ khi vẽ xong;
        // lần dựng lại sau lấy SVG tức thì từ mermaidCache.
        // Lượt render mới hơn đã chạy: bỏ qua khôi phục scroll để không ghi đè vị trí mới.
        if (versionBefore !== renderVersion) return;
        // Người dùng đã cuộn trong lúc vẽ: giữ vị trí mới, không ghi đè.
        if (genBefore !== previewScrollGen) return;
        restorePreviewScrollTop(scrollTopBefore);
    }).catch((err) => {
        console.warn('Mermaid render error (diagram is still being drafted):', err);
    }).finally(() => {
        pendingMermaidJobs--;
    });
}

// Export (DOC/HTML/PDF/print) cần DOM đầy đủ: enhance hết phần còn chờ IO.
export function flushLazyRenders() {
    const entries = [...pendingEnhance];
    for (const [el, kind] of entries) {
        pendingEnhance.delete(el);
        if (io) io.unobserve(el);
        enhanceNode(el, kind);
    }
    // KaTeX/hljs chạy đồng bộ ở trên; Mermaid chạy ngay, không chờ debounce.
    flushMermaidRun();
}

// Fix mọi đường render: marked.lexer + băm block vẫn O(doc) trên main thread, dù khối không đổi.
// Trên ngưỡng này chỉ Editor view khả thi; export ép render đầy đủ qua force.
export const PREVIEW_MAX_CHARS = 1_000_000;

// Lời nhắc trong khung preview; dùng textContent vì tên file là dữ liệu người dùng.
// Còn sửa được, chỉ preview là nhường chỗ — dùng Editor view để đọc nguồn.
function showTooLargeNotice(chars) {
    resetBlocks();
    previewOutput.textContent = '';
    sweepEnhance();
    const box = document.createElement('div');
    box.className = 'preview-too-large';
    const line = document.createElement('p');
    const charsFormatted = chars.toLocaleString('en-US');
    line.textContent = `Too large to preview (${charsFormatted} characters) - switch to Editor view to read the source.`;
    box.appendChild(line);
    previewOutput.appendChild(box);
}

// lucide.createIcons() tốn ~0,4ms mỗi lần gọi (Object.values trên ~2100 icon) nên gọi
// theo từng node là rất tốn khi preview có nhiều khối. Chỉ gọi cho khối có [data-lucide]
// và chỉ truyền đúng icon đang dùng để phần overhead này gần như bằng 0.
function drawIcons(inserted) {
    if (typeof lucide === 'undefined' || !inserted.length) return 0;
    const names = new Set();
    for (const rec of inserted) {
        const html = rec.html || '';
        if (!html.includes('data-lucide')) continue;
        for (const m of html.matchAll(/data-lucide=["']([^"']+)["']/g)) names.add(m[1]);
    }
    if (!names.size) return 0;
    const full = lucide.icons || lucide;
    const icons = {};
    for (const name of names) {
        const key = name.split(/[-_\s]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
        if (full[key]) icons[key] = full[key];
    }
    if (!Object.keys(icons).length) return 0;
    let calls = 0;
    for (const rec of inserted) {
        if (!(rec.html || '').includes('data-lucide')) continue;
        for (const n of rec.nodes) {
            if (n.nodeType !== 1) continue;
            lucide.createIcons({ root: n, icons });
            calls++;
        }
    }
    return calls;
}

export function renderMarkdown({ force = false } = {}) {
    renderVersion++;

    // Độ dài đọc O(1); getDocText() dựng lại cả văn bản nên chỉ gọi khi thật sự cần.
    const docLength = getDocLength();
    const previousPreviewScrollTop = previewOutput.scrollTop;

    if (!force && docLength > PREVIEW_MAX_CHARS) {
        showTooLargeNotice(docLength);
        setCharCount(docLength);
        return;
    }

    const rawText = getDocText();
    // try/catch quanh marked.parse: vendor chưa tải xong thì hiện văn bản thô, không đụng innerHTML.
    let blocks;
    try {
        blocks = lexAndRender(rawText);
    } catch (err) {
        console.error('Markdown parse failed, showing raw text:', err);
        resetBlocks();
        previewOutput.textContent = rawText;
        sweepEnhance();
        setCharCount(rawText.length);
        restorePreviewScrollTop(previousPreviewScrollTop);
        return;
    }
    const { inserted } = patchBlocks(previewOutput, blocks, prepareMermaidFragment);
    sweepEnhance();

    // Gán id SAU sanitize: id là thuộc tính DOM, không qua HTML parser.
    assignHeadingIds(previewOutput);
    setCharCount(rawText.length);
    registerEnhance(inserted.flatMap((rec) => rec.nodes));
    drawIcons(inserted);

    // Khôi phục scroll một lần, sau khi mọi thay đổi chiều cao đồng bộ đã xong.
    restorePreviewScrollTop(previousPreviewScrollTop);
}

function restorePreviewScrollTop(desiredScrollTop) {
    const maxPreviewScrollTop = Math.max(previewOutput.scrollHeight - previewOutput.clientHeight, 0);
    previewOutput.scrollTop = Math.min(desiredScrollTop, maxPreviewScrollTop);
}

let previewScrollGen = 0;

// Mô tả khối cho tab cache (hash + html, không giữ node).
export function snapshotPreviewBlocks() {
    return snapshotBlocks();
}

// Dựng lại preview tab đã xem từ snapshot block; không chạy lại marked/sanitize.
// renderVersion tăng để lượt Mermaid đang bay không ghi đè scroll sang tab mới.
// KHÔNG đụng mermaidQueue: flushMermaidRun tự lọc node đã bị detach.
export function renderCachedHtml(blocks, scrollTop) {
    renderVersion++;
    if (getDocLength() > PREVIEW_MAX_CHARS) {
        showTooLargeNotice(getDocLength());
        setCharCount(getDocLength());
        return;
    }
    const { inserted } = patchBlocks(previewOutput, blocks || [], prepareMermaidFragment);
    sweepEnhance();
    assignHeadingIds(previewOutput);
    setCharCount(getDocLength());
    registerEnhance(inserted.flatMap((rec) => rec.nodes));
    // Cache block giữ <i data-lucide> thô: dựng lại từ cache thì phải thay bằng SVG.
    drawIcons(inserted);
    restorePreviewScrollTop(scrollTop);
}

// scroll-sync gọi khi người dùng cuộn (wheel/keydown/touchstart trên preview):
// renderMarkdown dùng để biết có ghi đè scroll hay không. Cuộn lập trình (app tự
// set scrollTop) KHÔNG bump — nếu không, lượt restore sau Mermaid chết non.
export function notifyPreviewScrolled() {
    previewScrollGen++;
}
