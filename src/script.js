const defaultMarkdown = `# Markdown Live Editor

Welcome to **Markdown Live**! This app lets you write and preview Markdown content in real time.

## Key features:
- **Sync Scroll**: Scrolls the editor and preview panes together.
- **Copy**: Quickly copy the Markdown source.
- **Import**: Import a Markdown file from your device into the app.
- **Export**: Export your content as **Markdown**, **DOC** (Mermaid diagrams are converted to images), or **PDF** with **selectable text**.
- **Reset**: Restore this original sample text at any time.

---

## Advanced professional features:

### 1. Special callout boxes (GFM Alerts / Callouts)
> [!NOTE]
> This is an important note to help readers catch key information quickly.

> [!TIP]
> A tip for working more efficiently, or a small useful trick.

> [!IMPORTANT]
> This is critical information that shouldn't be overlooked.

> [!WARNING]
> A warning about a risk that could cause errors if handled incorrectly.

> [!CAUTION]
> A caution about a serious risk of data loss or damage.

---

### 2. Task List
- [x] Integrated DOMPurify to prevent XSS attacks
- [x] Improved the editor's syntax highlighter (Escape, Footnote, Reference Link, Tasklist)
- [ ] Try creating your own Markdown document

---

### 3. Math formulas (LaTeX/Math)
- Inline: $E = mc^2$ or the triangle's hypotenuse $c = \\sqrt{a^2 + b^2}$.
- Centered block display:
$$
f(x) = \\int_{-\\infty}^{\\infty} e^{-x^2} dx
$$

---

### 4. Visual diagrams (Mermaid Diagrams)
\`\`\`mermaid
graph TD
    A[Start] --> B(Write Markdown)
    B --> C{Preview?}
    C -- Yes --> D[Render HTML]
    C -- No --> E[Keep writing]
    D --> F[Export PDF]
\`\`\`

---

### 5. Syntax Highlighting
\`\`\`javascript
// A simple JavaScript snippet
function helloWorld() {
    console.log("Hello from Markdown Live!");
}
helloWorld();
\`\`\`

---

### 6. Escaping characters, reference links
- Escape special characters so they aren't formatted: \\*not italic\\*, \\# not a heading.
- Autolinks: <https://github.com> or an email <support@example.com>.
- Reference links: Search on [Google][google-ref] or read the [Markdown Guide][md-guide].

[google-ref]: https://www.google.com "Google search engine"
[md-guide]: https://www.markdownguide.org "Official Markdown documentation"

---

### 7. Table

| Tool | Feature | Status |
| :--- | :--- | :--- |
| Marked JS | Markdown conversion | Integrated |
| DOMPurify | XSS protection | Integrated |
| Lucide | Minimalist icon set | Integrated |

### 8. Blockquote
> "Simplicity is the ultimate sophistication." — *Leonardo da Vinci*

---
Try editing the content in the left pane and watch it update instantly on the right!
`;

const markdownInput = document.getElementById('markdown-input');
const previewOutput = document.getElementById('preview-output');
const charCounter = document.getElementById('char-counter');
const editorHighlight = document.getElementById('editor-highlight');
const editorHighlightCode = document.getElementById('editor-highlight-code');

const btnSync = document.getElementById('btn-sync');
const btnReset = document.getElementById('btn-reset');
const btnCopy = document.getElementById('btn-copy');
const btnImport = document.getElementById('btn-import');
const importFileInput = document.getElementById('import-file');
const btnExport = document.getElementById('btn-export');
const exportWrap = document.querySelector('.export-wrap');
const exportMenu = document.getElementById('export-menu');
const exportMdBtn = document.getElementById('export-md');
const exportHtmlBtn = document.getElementById('export-html');
const exportDocBtn = document.getElementById('export-doc');
const exportPdfBtn = document.getElementById('export-pdf');
const btnTheme = document.getElementById('btn-theme');
const toast = document.getElementById('toast');

const markdownThemeLink = document.getElementById('theme-markdown-css');
const hljsThemeLink = document.getElementById('theme-hljs-css');
const THEME_STORAGE_KEY = 'markdown-live-theme';
const CONTENT_STORAGE_KEY = 'markdown-live-content';

let isSyncScrollEnabled = true;
let activeScrollSource = null;
let mermaidTimeout = null;
let mermaidScheduled = false;
let pendingMermaidJobs = 0;
// Export chờ Mermaid vẽ xong thay vì đoán mốc 200ms.
function whenMermaidIdle(timeoutMs = 8000) {
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

// Cache SVG Mermaid theo mã nguồn: khối không đổi thì dùng lại, khỏi chạy mermaid.run() (50-200ms/biểu đồ).
// Xoá khi đổi theme vì màu SVG gắn với theme lúc vẽ.
const mermaidCache = new Map();
// ponytail: giới hạn theo số mục + tổng ký tự để tránh phình bộ nhớ; nâng cấp sau: LRU theo bytes thực tế.
const MERMAID_CACHE_LIMIT = 60;
const MERMAID_CACHE_MAX_CHARS = 600000;
let mermaidCacheChars = 0;
function cacheMermaidResult(code, html) {
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
function clearMermaidCache() {
    mermaidCache.clear();
    mermaidCacheChars = 0;
}
// DOMPurify mặc định bỏ <foreignObject>, mà nhãn Mermaid (htmlLabels) nằm trong đó
// -> thiếu ADD_TAGS này thì chữ trong flowchart biến mất.
const MERMAID_SANITIZE_CONFIG = {
    USE_PROFILES: { html: true, svg: true },
    ADD_ATTR: ['target', 'rel'],
    ADD_TAGS: ['foreignObject'],
    // Chỉ cho scheme http(s)/mailto/tel/callto/ftp hoặc URL tương đối (chặn scheme lạ như javascript:)
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|callto|ftp):|[^a-zA-Z]|[a-zA-Z+.\-]+(?:[^a-zA-Z+.:]|$))/i
};

function getCurrentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function syncWindowTheme(theme) {
    try {
        if (window.__TAURI__ && window.__TAURI__.window) window.__TAURI__.window.getCurrentWindow().setTheme(theme).catch(() => {});
    } catch (e) {}
}

function applyTheme(theme, persist) {
    document.documentElement.setAttribute('data-theme', theme);
    syncWindowTheme(theme);

    if (markdownThemeLink) {
        markdownThemeLink.href = theme === 'dark'
            ? 'vendor/github-markdown-dark.css'
            : 'vendor/github-markdown-light.css';
    }
    if (hljsThemeLink) {
        hljsThemeLink.href = theme === 'dark'
            ? 'vendor/hljs-github-dark.min.css'
            : 'vendor/hljs-github.min.css';
    }
    if (typeof mermaid !== 'undefined') {
        mermaid.initialize({ startOnLoad: false, theme: theme === 'dark' ? 'dark' : 'default' });
    }

    if (persist) {
        try {
            localStorage.setItem(THEME_STORAGE_KEY, theme);
        } catch (e) {
            // Bỏ qua nếu localStorage bị chặn
        }
    }
}

syncWindowTheme(getCurrentTheme());

if (btnTheme) {
    btnTheme.addEventListener('click', () => {
        const nextTheme = getCurrentTheme() === 'dark' ? 'light' : 'dark';
        applyTheme(nextTheme, true);
        // Xoá cache: SVG cũ mang màu của theme trước
        clearMermaidCache();
        if (typeof renderMarkdown === 'function') renderMarkdown();
        showToast(nextTheme === 'dark' ? "Switched to Dark theme" : "Switched to Light theme");
    });
}

if (window.matchMedia) {
    const darkSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
    darkSchemeQuery.addEventListener('change', (event) => {
        let hasManualPreference = false;
        try {
            hasManualPreference = localStorage.getItem(THEME_STORAGE_KEY) !== null;
        } catch (e) {}

        if (!hasManualPreference) {
            applyTheme(event.matches ? 'dark' : 'light', false);
            clearMermaidCache();
            if (typeof renderMarkdown === 'function') renderMarkdown();
        }
    });
}

const alertHighlightColors = {
    NOTE: 'var(--alert-note-color)',
    TIP: 'var(--alert-tip-color)',
    IMPORTANT: 'var(--alert-important-color)',
    WARNING: 'var(--alert-warning-color)',
    CAUTION: 'var(--alert-caution-color)'
};

function escapeHtml(str) {
    // Escape & trước, nếu không các &lt; &gt; vừa tạo sẽ bị escape lặp
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function highlightInline(text) {
    const store = [];
    // Cất HTML đã tô vào store và trả về token; rule sau không đụng lại, cuối hàm mới khôi phục.
    const protect = (html) => {
        const token = `\u0000T${store.length}\u0000`;
        store.push(html);
        return token;
    };

    // Thứ tự rule quan trọng: kết quả mỗi rule được protect() thành token nên rule sau không đụng lại;
    // rule đặc thù/dài phải đứng trước (vd *** trước ** và *).
    // Ký tự thoát: \* \_ \[ \] \$ \~ \# ...
    // (&lt; &gt; &amp; liệt kê riêng vì text đã được escape HTML từ trước, nên \< thành \&lt;)
    text = text.replace(/\\(&lt;|&gt;|&amp;|[\\`*_{}\[\]()#+\-.!~$~|^])/g, (m, char) =>
        protect(`<span class="md-escape">\\${char}</span>`));

    // Code inline: `code` (dấu ` mở và đóng phải cùng độ dài)
    text = text.replace(/(`+)([^`]+?)\1/g, (m, ticks, content) =>
        protect(`<span class="md-code-inline">${ticks}${content}${ticks}</span>`));

    // Công thức dạng khối trên 1 dòng: $$...$$
    text = text.replace(/(\$\$)([^$\n]+?)\1/g, (m, d, c) =>
        protect(`<span class="md-math">${d}${c}${d}</span>`));

    // Công thức inline: $...$
    text = text.replace(/(\$)([^$\n]+?)\1/g, (m, d, c) =>
        protect(`<span class="md-math">${d}${c}${d}</span>`));

    // Tham chiếu footnote: [^id]
    text = text.replace(/(\[\^)([^\]]+?)(\])/g, (m, ob, id, cb) =>
        protect(`<span class="md-footnote-ref"><span class="md-footnote-marker">${ob}</span><span class="md-footnote-id">${id}</span><span class="md-footnote-marker">${cb}</span></span>`));

    // Ảnh: ![alt](url)
    text = text.replace(/(!)(\[)([^\]]*)(\])(\()([^)]*)(\))/g, (m, bang, ob, alt, cb, op, url, cp) =>
        protect(`<span class="md-link-marker">${bang}${ob}</span><span class="md-link-text">${alt}</span><span class="md-link-marker">${cb}${op}</span><span class="md-link-url">${url}</span><span class="md-link-marker">${cp}</span>`));

    // Reference link: [text][id] hoặc [text][]
    text = text.replace(/(\[)([^\]]+?)(\])(\s*)(\[)([^\]]*?)(\])/g, (m, ob1, txt, cb1, sp, ob2, id, cb2) =>
        protect(`<span class="md-link-marker">${ob1}</span><span class="md-link-text">${txt}</span><span class="md-link-marker">${cb1}${sp}${ob2}</span><span class="md-ref-id">${id}</span><span class="md-link-marker">${cb2}</span>`));

    // Liên kết thường: [text](url)
    text = text.replace(/(\[)([^\]]*)(\])(\()([^)]*)(\))/g, (m, ob, t, cb, op, url, cp) =>
        protect(`<span class="md-link-marker">${ob}</span><span class="md-link-text">${t}</span><span class="md-link-marker">${cb}${op}</span><span class="md-link-url">${url}</span><span class="md-link-marker">${cp}</span>`));

    // Autolink trong ngoặc nhọn: <https://...> hoặc <email@example.com>
    text = text.replace(/(&lt;)(https?:\/\/[^\s&]+|mailto:[^\s&]+|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(&gt;)/gi, (m, ob, link, cb) =>
        protect(`<span class="md-link-marker">${ob}</span><span class="md-autolink">${link}</span><span class="md-link-marker">${cb}</span>`));

    // Autolink URL trần: https://...
    text = text.replace(/\b(https?:\/\/[^\s<>()"']+)/gi, (m, url) =>
        protect(`<span class="md-autolink">${url}</span>`));

    // In đậm + nghiêng: ***text*** hoặc ___text___
    text = text.replace(/(\*\*\*|___)([^*_\n]+?)\1/g, (m, d, c) =>
        protect(`<span class="md-bolditalic">${d}${c}${d}</span>`));

    // Emphasis lồng nhau: content cho phép delimiter đơn bên trong và được xử lý italic đệ quy
    // trước khi bọc span ngoài (tránh token che mất phần trong).
    // Mẫu nội dung (?:[^*\n]|\*(?!\*))+? = ký tự bất kỳ trừ * và xuống dòng, hoặc một * đơn (không đi liền *);
    // dấu + ? để khớp lười, dừng ở delimiter đóng gần nhất. Bản _ tương tự: (?:[^_\n]|_(?!_))+?
    // underItalicOnce: _text_ (cần word boundary)
    const underItalicOnce = (s) => s.replace(/\b(_)((?:[^_\n]|_(?!_))+?)\1\b/g, (m2, d2, c2) =>
        protect(`<span class="md-italic">${d2}${c2}${d2}</span>`));
    // starItalicOnce: *text* (cho phép _text_ lồng bên trong)
    const starItalicOnce = (s) => s.replace(/(\*)((?:[^*\n]|\*(?!\*))+?)\1/g, (m2, d2, c2) =>
        protect(`<span class="md-italic">${d2}${underItalicOnce(c2)}${d2}</span>`));

    // In đậm: **text** (cho phép * đơn bên trong để lồng italic)
    text = text.replace(/(\*\*)((?:[^*\n]|\*(?!\*))+?)\1/g, (m, d, c) =>
        protect(`<span class="md-bold">${d}${underItalicOnce(starItalicOnce(c))}${d}</span>`));

    // In đậm: __text__ (cho phép _ đơn bên trong, cần word boundary)
    text = text.replace(/\b(__)((?:[^_\n]|_(?!_))+?)\1\b/g, (m, d, c) =>
        protect(`<span class="md-bold">${d}${underItalicOnce(starItalicOnce(c))}${d}</span>`));

    // In nghiêng: *text* (chạy sau bold nên ** đã thành token)
    text = starItalicOnce(text);

    // In nghiêng: _text_ (cần word boundary nên không khớp giữa snake_case)
    text = underItalicOnce(text);

    // Gạch ngang: ~~text~~
    text = text.replace(/(~~)([^~\n]+?)\1/g, (m, d, c) =>
        protect(`<span class="md-strikethrough">${d}${c}${d}</span>`));

    // Thẻ HTML inline <kbd>, <mark>, <sup>, <sub>: tô riêng thẻ và nội dung
    // Nội dung ([^&]+) không chứa '&' (text đã escape) nên không khớp khi bên trong còn thẻ/entity khác.
    text = text.replace(/(&lt;)(kbd&gt;)([^&]+)(&lt;\/)(kbd&gt;)/gi, (m, ob1, tagOpen, content, cb1, tagClose) =>
        protect(`<span class="md-kbd-marker">${ob1}${tagOpen}</span><span class="md-kbd">${content}</span><span class="md-kbd-marker">${cb1}${tagClose}</span>`));

    text = text.replace(/(&lt;)(mark&gt;)([^&]+)(&lt;\/)(mark&gt;)/gi, (m, ob1, tagOpen, content, cb1, tagClose) =>
        protect(`<span class="md-mark-marker">${ob1}${tagOpen}</span><span class="md-mark">${content}</span><span class="md-mark-marker">${cb1}${tagClose}</span>`));

    text = text.replace(/(&lt;)(sup&gt;)([^&]+)(&lt;\/)(sup&gt;)/gi, (m, ob1, tagOpen, content, cb1, tagClose) =>
        protect(`<span class="md-sup-marker">${ob1}${tagOpen}</span><span class="md-sup">${content}</span><span class="md-sup-marker">${cb1}${tagClose}</span>`));

    text = text.replace(/(&lt;)(sub&gt;)([^&]+)(&lt;\/)(sub&gt;)/gi, (m, ob1, tagOpen, content, cb1, tagClose) =>
        protect(`<span class="md-sub-marker">${ob1}${tagOpen}</span><span class="md-sub">${content}</span><span class="md-sub-marker">${cb1}${tagClose}</span>`));

    // <details> / <summary>: chỉ tô riêng thẻ mở/đóng, phần chữ bên trong xử lý như văn bản thường
    text = text.replace(/(&lt;details&gt;)/gi, 
        protect(`<span class="md-details-marker">&lt;details&gt;</span>`));
    text = text.replace(/(&lt;\/details&gt;)/gi, 
        protect(`<span class="md-details-marker">&lt;/details&gt;</span>`));
    text = text.replace(/(&lt;summary&gt;)/gi, 
        protect(`<span class="md-summary-marker">&lt;summary&gt;</span>`));
    text = text.replace(/(&lt;\/summary&gt;)/gi, 
        protect(`<span class="md-summary-marker">&lt;/summary&gt;</span>`));

    // HTML comment trên 1 dòng: <!-- ... -->
    text = text.replace(/(&lt;!--)([\s\S]*?)(--&gt;)/g, (m) =>
        protect(`<span class="md-html-comment">${m}</span>`));

    // Mẫu thuộc tính HTML dùng lặp ở các rule thẻ bên dưới: (?:\s+tên(?:\s*=\s*giá trị)?)*
    // với giá trị là "...", '...' hoặc không nháy (không chứa khoảng trắng, nháy, < >).
    // Thẻ <a href="...">text</a>: href -> md-link-url, nội dung -> md-link-text
    text = text.replace(/(&lt;)(a)((?:\s+[a-zA-Z-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))?)*)(&gt;)([\s\S]*?)(&lt;\/)(a)(&gt;)/gi,
        (m, ob, tag, attrs, cb, content, cb2, tag2, cb3) => {
            // Tô href="..." (giá trị có nháy kép, nháy đơn hoặc không nháy)
            const hlAttrs = attrs.replace(/(^|\s)(href)(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'<>]+)/i,
                `$1<span class="md-link-marker">$2$3</span><span class="md-link-url">$4</span>`);
            return protect(`<span class="md-link-marker">${ob}${tag}${hlAttrs}${cb}</span><span class="md-link-text">${content}</span><span class="md-link-marker">${cb2}${tag2}${cb3}</span>`);
        });

    // Thẻ <img src="..." alt="...">: src -> md-link-url, alt -> md-link-text (thuộc tính theo thứ tự bất kỳ)
    text = text.replace(/(&lt;)(img)((?:\s+[a-zA-Z-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))?)*)(\s*\/?)(&gt;)/gi,
        (m, ob, tag, attrs, slash, cb) => {
            // Tô src giống href ở trên
            let hlAttrs = attrs.replace(/(^|\s)(src)(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'<>]+)/i,
                `$1<span class="md-link-marker">$2$3</span><span class="md-link-url">$4</span>`);
            // Tô alt như văn bản liên kết
            hlAttrs = hlAttrs.replace(/(^|\s)(alt)(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'<>]+)/i,
                `$1<span class="md-link-marker">$2$3</span><span class="md-link-text">$4</span>`);
            return protect(`<span class="md-html-tag-marker">${ob}${tag}${hlAttrs}${slash}${cb}</span>`);
        });

    // Void tag: <br>, <hr>, <input ...> (thuộc tính theo mẫu trên, có thể tự đóng '/>')
    text = text.replace(/(&lt;)(br|hr|input)((?:\s+[a-zA-Z-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))?)*)(\s*\/?)(&gt;)/gi, (m) =>
        protect(`<span class="md-html-void">${m}</span>`));

    // Cặp thẻ có nội dung trên cùng 1 dòng: <div>…</div>, <table>, <b>, <code>, ... (thuộc tính theo mẫu trên)
    text = text.replace(/(&lt;)(div|span|p|table|tr|td|th|thead|tbody|b|strong|i|em|u|code|small)((?:\s+[a-zA-Z-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))?)*)(&gt;)([\s\S]*?)(&lt;\/)(\2)(\s*)(&gt;)/gi,
        (m, ob, tag, attrs, cb, content, cb2, tag2, sp, cb3) =>
            protect(`<span class="md-html-tag-marker">${ob}${tag}${attrs}${cb}</span><span class="md-html-tag-content">${content}</span><span class="md-html-tag-marker">${cb2}${tag2}${sp}${cb3}</span>`));

    // Thẻ khối lẻ không có cặp trên cùng dòng: <div align="center">, </div>, <table>, ... (thuộc tính theo mẫu trên)
    text = text.replace(/(&lt;\/?(?:div|span|p|table|tr|td|th|thead|tbody)(?:\s+[a-zA-Z-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))?)*\s*\/?&gt;)/gi, (m) =>
        protect(`<span class="md-html-tag-marker">${m}</span>`));

    // Trả token về HTML thật. Lặp vì token có thể lồng nhau (span ngoài chứa token của span trong).
    let previous;
    do {
        previous = text;
        // Token do protect() tạo có dạng \u0000T<số>\u0000
        text = text.replace(/\u0000T(\d+)\u0000/g, (m, idx) => store[Number(idx)]);
    } while (text !== previous);

    return text;
}

function highlightMarkdownLine(line) {
    // Đường kẻ ngang: 3 ký tự - * _ trở lên cùng loại (cho phép xen khoảng trắng)
    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
        return `<span class="md-hr">${escapeHtml(line)}</span>`;
    }

    // Định nghĩa footnote: [^id]: nội dung
    let m = line.match(/^(\s{0,3})(\[\^)([^\]]+)(\]:)(\s*)(.*)$/);
    if (m) {
        const [, indent, ob, fnId, cb, space, content] = m;
        return `${escapeHtml(indent)}<span class="md-footnote-marker">${ob}</span><span class="md-footnote-id">${escapeHtml(fnId)}</span><span class="md-footnote-marker">${cb}</span>${escapeHtml(space)}${highlightInline(escapeHtml(content))}`;
    }

    // Định nghĩa reference link: [id]: url "title" (id không chứa ^ để khỏi nhầm footnote)
    m = line.match(/^(\s{0,3})(\[)([^\]^]+)(\])(:)(\s*)(\S+)(?:(\s+)(.*))?$/);
    if (m) {
        const [, indent, ob, id, cb, colon, sp1, url, sp2 = '', title = ''] = m;
        return `${escapeHtml(indent)}<span class="md-link-marker">${ob}</span><span class="md-ref-id">${escapeHtml(id)}</span><span class="md-link-marker">${cb}${colon}</span>${escapeHtml(sp1)}<span class="md-link-url">${escapeHtml(url)}</span>${escapeHtml(sp2)}${title ? `<span class="md-ref-title">${escapeHtml(title)}</span>` : ''}`;
    }

    // Tiêu đề ATX: 1-6 dấu # rồi khoảng trắng
    m = line.match(/^(\s{0,3})(#{1,6})(\s+)(.*)$/);
    if (m) {
        const [, indent, hashes, space, content] = m;
        const level = hashes.length;
        return `${escapeHtml(indent)}<span class="md-header-marker">${hashes}</span>${escapeHtml(space)}<span class="md-header md-header-${level}">${highlightInline(escapeHtml(content))}</span>`;
    }

    // Trích dẫn: một hoặc nhiều dấu >
    m = line.match(/^(\s{0,3}>+\s?)(.*)$/);
    if (m) {
        const [, marker, rest] = m;
        // GFM alert: [!NOTE] | [!TIP] | [!IMPORTANT] | [!WARNING] | [!CAUTION]
        const alertMatch = rest.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](.*)$/i);
        if (alertMatch) {
            const type = alertMatch[1].toUpperCase();
            const color = alertHighlightColors[type] || '#0969da';
            return `<span class="md-quote-marker">${escapeHtml(marker)}</span><span class="md-alert-tag" style="color:${color}">[!${type}]</span><span class="md-quote-text">${highlightInline(escapeHtml(alertMatch[2]))}</span>`;
        }
        return `<span class="md-quote-marker">${escapeHtml(marker)}</span><span class="md-quote-text">${highlightInline(escapeHtml(rest))}</span>`;
    }

    // Task list: marker danh sách + [ ] hoặc [x]
    m = line.match(/^(\s*)([-*+]|\d+[.)])(\s+)(\[(?: |x|X)\])(\s+)(.*)$/);
    if (m) {
        const [, indent, marker, sp1, checkbox, sp2, content] = m;
        const isChecked = checkbox.toLowerCase().includes('x');
        const checkClass = isChecked ? 'md-task-checked' : 'md-task-unchecked';
        return `${escapeHtml(indent)}<span class="md-list-marker">${escapeHtml(marker)}</span>${escapeHtml(sp1)}<span class="md-task-checkbox ${checkClass}">${escapeHtml(checkbox)}</span>${escapeHtml(sp2)}${highlightInline(escapeHtml(content))}`;
    }

    // List item: -, *, + hoặc số kèm . / )
    m = line.match(/^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/);
    if (m) {
        const [, indent, marker, space, content] = m;
        return `${escapeHtml(indent)}<span class="md-list-marker">${escapeHtml(marker)}</span>${escapeHtml(space)}${highlightInline(escapeHtml(content))}`;
    }

    if (line.includes('|')) {
        // Dòng phân tách bảng: |---|:---:|---:|
        if (/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line)) {
            // Thay | bằng placeholder để chỉ tô phần gạch/dấu :, rồi trả | về đã tô riêng ở cuối
            return escapeHtml(line)
                .replace(/\|/g, '\u0000P\u0000')  // | -> placeholder
                .replace(/:?-+:?/g, '<span class="md-table-separator">$&</span>')  // phần gạch kèm dấu : căn lề tuỳ chọn
                .split('\u0000P\u0000').join('<span class="md-table-pipe">|</span>');
        }
        // Token hoá inline code trước để dấu | trong code không bị tô như dấu bảng.
        const codeStore = [];
        let escapedLine = escapeHtml(line);
        
        // Tách inline code (`...`) ra token để dấu | trong code không bị tô
        escapedLine = escapedLine.replace(/(`+)([^`]+?)\1/g, (m, ticks, content) => {
            const token = `\u0000CODE_${codeStore.length}\u0000`;
            codeStore.push(`${ticks}${content}${ticks}`);
            return token;
        });
        
        // Tô các dấu | của bảng
        escapedLine = escapedLine.replace(/\|/g, '<span class="md-table-pipe">|</span>');
        
        // Trả token inline code về lại
        escapedLine = escapedLine.replace(/\u0000CODE_(\d+)\u0000/g, (m, idx) => {
            return `<span class="md-code-inline">${codeStore[Number(idx)]}</span>`;
        });
        
        return highlightInline(escapedLine);
    }

    return highlightInline(escapeHtml(line));
}

function highlightMarkdown(text) {
    const lines = text.split('\n');
    let inFence = false;
    let inMathBlock = false;
    let inHtmlComment = false;
    let inIndentedCode = false;

    const isPlainPara = (s) => {
        if (!s || !s.trim()) return false;
        if (/^\s{0,3}(=+|-+)\s*$/.test(s)) return false;               // gạch dưới setext
        if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(s)) return false;  // đường kẻ ngang
        if (/^\s{0,3}#{1,6}\s+/.test(s)) return false;                 // tiêu đề ATX
        if (/^\s{0,3}>/.test(s)) return false;                         // trích dẫn
        if (/^\s*([-*+]|\d+[.)])\s+/.test(s)) return false;            // danh sách
        if (/^\s{0,3}\[\^/.test(s)) return false;                      // định nghĩa footnote
        if (/^\s{0,3}\[[^\]^]+\]:/.test(s)) return false;              // định nghĩa reference link
        if (/^\s{0,3}(`{3,}|~{3,})/.test(s)) return false;             // fence code
        if (/^\s*\$\$/.test(s)) return false;                          // khối toán $$
        if (/^(    |\t)/.test(s)) return false;                        // indented code
        if (s.includes('|')) return false;
        if (s.includes('<!--') || s.includes('-->')) return false;
        return true;
    };

    const outputLines = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Đặt trước fence để ``` nằm trong HTML comment vẫn là comment.
        if (inHtmlComment) {
            outputLines.push(`<span class="md-html-comment">${escapeHtml(line)}</span>`);
            if (line.includes('-->')) inHtmlComment = false;
            continue;
        }

        // Fence code: ``` hoặc ~~~ (từ 3 ký tự), phần còn lại là info string
        const fenceMatch = line.match(/^(\s{0,3})(`{3,}|~{3,})(.*)$/);
        if (fenceMatch) {
            inIndentedCode = false;
            if (!inFence) {
                inFence = true;
                const [, indent, marker, lang] = fenceMatch;
                outputLines.push(`${escapeHtml(indent)}<span class="md-fence-marker">${escapeHtml(marker)}</span><span class="md-fence-lang">${escapeHtml(lang)}</span>`);
            } else {
                inFence = false;
                const [, indent, marker] = fenceMatch;
                outputLines.push(`${escapeHtml(indent)}<span class="md-fence-marker">${escapeHtml(marker)}</span>`);
            }
            continue;
        }

        if (inFence) {
            outputLines.push(`<span class="md-code-block">${escapeHtml(line)}</span>`);
            continue;
        }

        if (inMathBlock) {
            // Dòng đóng khối toán: chỉ có $$ hoặc kết thúc bằng $$
            if (/^\s*\$\$\s*$/.test(line) || line.trim().endsWith('$$')) {
                inMathBlock = false;
            }
            outputLines.push(`<span class="md-math">${escapeHtml(line)}</span>`);
            continue;
        }

        // Indented code chỉ mở sau dòng trắng/đầu file (không chen giữa paragraph/list);
        // dòng trắng không kết thúc block.
        if (/^(    |\t)/.test(line)) {
            if (inIndentedCode || i === 0 || !lines[i - 1].trim()) {
                inIndentedCode = true;
                outputLines.push(`<span class="md-code-block">${escapeHtml(line)}</span>`);
                continue;
            }
        } else if (!line.trim()) {
            outputLines.push(escapeHtml(line));
            continue;
        } else {
            inIndentedCode = false;
        }

        if (line.includes('<!--') && !line.includes('-->')) {
            inHtmlComment = true;
            outputLines.push(`<span class="md-html-comment">${escapeHtml(line)}</span>`);
            continue;
        }

        // Mở khối toán nhiều dòng: bắt đầu bằng $$ nhưng không đóng ngay trên cùng dòng
        if (/^\s*\$\$/.test(line) && !/^\s*\$\$.+\$\$\s*$/.test(line)) {
            inMathBlock = true;
            outputLines.push(`<span class="md-math">${escapeHtml(line)}</span>`);
            continue;
        }

        // Setext heading: đặt trước highlightMarkdownLine để --- sau paragraph thành H2 chứ không phải <hr>.
        const setextMatch = line.match(/^\s{0,3}(=+|-+)\s*$/);
        // Loại trường hợp chỉ có đúng 1 dấu '-' (không coi là gạch dưới setext)
        if (setextMatch && i > 0 && isPlainPara(lines[i - 1]) && !/^\s{0,3}-\s*$/.test(line)) {
            const level = setextMatch[1][0] === '=' ? 1 : 2;
            outputLines[i - 1] = `<span class="md-header md-header-${level}">${outputLines[i - 1]}</span>`;
            outputLines.push(`<span class="md-header-marker">${escapeHtml(line)}</span>`);
            continue;
        }

        outputLines.push(highlightMarkdownLine(line));
    }

    return outputLines.join('\n');
}

// ponytail: quá ngưỡng thì dùng text thô (1 text node) thay vì ~24 regex/dòng mỗi khung hình. KHÔNG được
// bỏ hẳn lớp này vì #markdown-input có color:transparent (không có highlight thì chữ biến mất).
// nâng cấp sau: highlight lười (chỉ vùng nhìn thấy) thay vì cả tài liệu.
const EDITOR_HIGHLIGHT_MAX_CHARS = 300000;
function updateEditorHighlight() {
    const text = markdownInput.value;
    if (text.length > EDITOR_HIGHLIGHT_MAX_CHARS) {
        editorHighlightCode.textContent = text + '\n';
        return;
    }
    editorHighlightCode.innerHTML = highlightMarkdown(text) + '\n';
}

// Gộp các lần gọi liên tiếp (gõ nhanh) thành 1 lần tô màu mỗi khung hình, không chặn handler 'input'.
let editorHighlightRAF = null;
function scheduleEditorHighlight() {
    if (editorHighlightRAF !== null) return;
    editorHighlightRAF = requestAnimationFrame(() => {
        editorHighlightRAF = null;
        updateEditorHighlight();
    });
}

let toastTimer = null;
function showToast(message) {
    toast.textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.classList.add('hidden');
    }, 2500);
}

function getAlertIcon(type) {
    switch (type) {
        case 'NOTE': return 'info';
        case 'TIP': return 'lightbulb';
        case 'IMPORTANT': return 'alert-circle';
        case 'WARNING': return 'alert-triangle';
        case 'CAUTION': return 'ban';
        default: return 'info';
    }
}

function getAlertTitle(type) {
    switch (type) {
        case 'NOTE': return 'Note';
        case 'TIP': return 'Tip';
        case 'IMPORTANT': return 'Important';
        case 'WARNING': return 'Warning';
        case 'CAUTION': return 'Caution';
        default: return type;
    }
}

function processGFMAlerts() {
    previewOutput.querySelectorAll('blockquote').forEach((bq) => {
        const firstP = bq.querySelector('p');
        if (firstP) {
            const htmlContent = firstP.innerHTML.trim();
            // Marker [!TYPE] ở đầu đoạn (có thể kèm <br> theo sau)
            const match = htmlContent.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br\s*\/?>)?\s*/i);
            
            if (match) {
                const type = match[1].toUpperCase();
                // Gỡ marker [!TYPE] khỏi nội dung
                firstP.innerHTML = firstP.innerHTML.replace(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br\s*\/?>)?\s*/i, '');
                bq.classList.add('markdown-alert', `markdown-alert-${type.toLowerCase()}`);
                
                if (!bq.querySelector('.markdown-alert-title')) {
                    const titleP = document.createElement('p');
                    titleP.className = 'markdown-alert-title';
                    titleP.innerHTML = `<i data-lucide="${getAlertIcon(type)}"></i>${getAlertTitle(type)}`;
                    bq.insertBefore(titleP, bq.firstChild);
                }
            }
        }
    });
}

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

// Slug kiểu GitHub (chữ thường, bỏ dấu câu, khoảng trắng -> '-'). marked v14 bỏ tuỳ chọn headerIds nên
// tiêu đề không có id và liên kết neo [mục](#muc-luc) không tìm thấy đích.
function slugifyHeading(text) {
    // Bỏ ký tự không phải chữ/số/khoảng trắng/'-' (hỗ trợ Unicode), rồi đổi khoảng trắng thành '-'
    return String(text).trim().toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .replace(/\s+/g, '-');
}

// id phải duy nhất (tiêu đề trùng thêm hậu tố -1, -2). Chỉ đọc textContent rồi gán .id,
// không parse HTML nên không mở thêm đường XSS.
function assignHeadingIds(container) {
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

function renderMarkdown() {
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

const TAB_SIZE = 4;
const TAB_SPACES = ' '.repeat(TAB_SIZE);

const editorHistory = {
    stack: [],
    index: -1,
    maxSize: 150,
    typingTimer: null,

    push(val, start, end) {
        if (this.index < this.stack.length - 1) {
            this.stack = this.stack.slice(0, this.index + 1);
        }
        if (this.stack.length > 0 && this.stack[this.stack.length - 1].val === val) {
            this.stack[this.stack.length - 1].start = start;
            this.stack[this.stack.length - 1].end = end;
            return;
        }
        this.stack.push({ val, start, end });
        if (this.stack.length > this.maxSize) {
            this.stack.shift();
        } else {
            this.index++;
        }
    },

    saveCurrentState(el) {
        this.push(el.value, el.selectionStart, el.selectionEnd);
    },

    undo(el) {
        if (this.index <= 0 && this.stack.length <= 1) return;
        // Lưu nội dung chưa kịp vào lịch sử trước khi lùi. push() đã tự tăng this.index nên KHÔNG giảm thêm,
        // nếu không Undo sẽ lùi 2 bước thay vì 1.
        if (this.stack[this.index] && this.stack[this.index].val !== el.value) {
            this.push(el.value, el.selectionStart, el.selectionEnd);
        }
        if (this.index > 0) {
            this.index--;
            const state = this.stack[this.index];
            el.value = state.val;
            el.setSelectionRange(state.start, state.end);
            syncEditorAfterChange();
        }
    },

    redo(el) {
        if (this.index < this.stack.length - 1) {
            this.index++;
            const state = this.stack[this.index];
            el.value = state.val;
            el.setSelectionRange(state.start, state.end);
            syncEditorAfterChange();
        }
    }
};

// Mọi thay đổi qua applyEditorChange (Enter, Tab, nút format, hộp thoại, phím tắt) đều đi qua đây nên
// lưu bộ nhớ tạm ngay, không chỉ nhờ 'input'; nếu không chỉ ghi khi beforeunload/visibilitychange và
// crash / kill cứng là mất.
function syncEditorAfterChange() {
    charCounter.textContent = `${markdownInput.value.length} characters`;
    scheduleEditorHighlight();
    debouncedRender();
    debouncedSaveContent();
}

function applyEditorChange(newText, newStart, newEnd) {
    editorHistory.saveCurrentState(markdownInput);
    markdownInput.value = newText;
    markdownInput.setSelectionRange(newStart, newEnd !== undefined ? newEnd : newStart);
    editorHistory.saveCurrentState(markdownInput);
    syncEditorAfterChange();
}

function handleEditorTab(e) {
    e.preventDefault();
    const val = markdownInput.value;
    const selStart = markdownInput.selectionStart;
    const selEnd = markdownInput.selectionEnd;

    if (selStart === selEnd && !e.shiftKey) {
        const newText = val.substring(0, selStart) + TAB_SPACES + val.substring(selEnd);
        applyEditorChange(newText, selStart + TAB_SIZE, selStart + TAB_SIZE);
        return;
    }

    const lineStart = val.lastIndexOf('\n', selStart - 1) + 1;
    let lineEnd = val.indexOf('\n', selEnd);
    if (lineEnd === -1) lineEnd = val.length;

    const selectedBlock = val.substring(lineStart, lineEnd);
    const lines = selectedBlock.split('\n');

    let firstLineDelta = 0;
    let totalDelta = 0;
    const newLines = lines.map((line, idx) => {
        let delta = 0;
        let newLine = line;

        if (!e.shiftKey) {
            newLine = TAB_SPACES + line;
            delta = TAB_SIZE;
        } else {
            if (line.startsWith(TAB_SPACES)) {
                newLine = line.substring(TAB_SIZE);
                delta = -TAB_SIZE;
            } else if (line.startsWith('\t')) {
                newLine = line.substring(1);
                delta = -1;
            } else {
                // Tối đa 4 khoảng trắng đầu dòng
                const spaces = line.match(/^ {1,4}/);
                if (spaces) {
                    newLine = line.substring(spaces[0].length);
                    delta = -spaces[0].length;
                }
            }
        }

        if (idx === 0) firstLineDelta = delta;
        totalDelta += delta;
        return newLine;
    });

    const replacedText = newLines.join('\n');
    const newText = val.substring(0, lineStart) + replacedText + val.substring(lineEnd);
    const newSelStart = Math.max(lineStart, selStart + (selStart > lineStart ? firstLineDelta : 0));
    const newSelEnd = Math.max(newSelStart, selEnd + totalDelta);

    applyEditorChange(newText, newSelStart, newSelEnd);
}

function handleEditorEnter(e) {
    const val = markdownInput.value;
    const selStart = markdownInput.selectionStart;
    const selEnd = markdownInput.selectionEnd;

    const lineStart = val.lastIndexOf('\n', selStart - 1) + 1;
    const currentLine = val.substring(lineStart, selStart);

    // Dòng task list rỗng: - [ ]
    const emptyTaskMatch = currentLine.match(/^(\s*[-*+]\s+\[[ xX]\]\s*)$/);
    // Dòng bullet rỗng: -, *, +
    const emptyUlMatch = currentLine.match(/^(\s*[-*+]\s*)$/);
    // Dòng số thứ tự rỗng: 1. hoặc 1)
    const emptyOlMatch = currentLine.match(/^(\s*\d+[.)]\s*)$/);
    // Dòng trích dẫn rỗng: >
    const emptyBqMatch = currentLine.match(/^(\s*>+\s*)$/);

    if (emptyTaskMatch || emptyUlMatch || emptyOlMatch || emptyBqMatch) {
        e.preventDefault();
        const newText = val.substring(0, lineStart) + val.substring(selEnd);
        applyEditorChange(newText, lineStart, lineStart);
        return;
    }

    // Task list có nội dung: marker + [ ]/[x] + chữ
    const taskMatch = currentLine.match(/^(\s*)([-*+]|\d+[.)])(\s+\[[ xX]\]\s+)(.*)$/);
    if (taskMatch) {
        e.preventDefault();
        const [, indent, bullet, marker] = taskMatch;
        // Dòng mới luôn bắt đầu với checkbox chưa tick
        const cleanMarker = marker.replace(/\[[xX]\]/, '[ ]');
        const insert = '\n' + indent + bullet + cleanMarker;
        const newText = val.substring(0, selStart) + insert + val.substring(selEnd);
        applyEditorChange(newText, selStart + insert.length, selStart + insert.length);
        return;
    }

    // Bullet: -, *, +
    const ulMatch = currentLine.match(/^(\s*)([-*+]\s+)(.*)$/);
    if (ulMatch) {
        e.preventDefault();
        const [, indent, marker] = ulMatch;
        const insert = '\n' + indent + marker;
        const newText = val.substring(0, selStart) + insert + val.substring(selEnd);
        applyEditorChange(newText, selStart + insert.length, selStart + insert.length);
        return;
    }

    // Số thứ tự: 1. hoặc 1)
    const olMatch = currentLine.match(/^(\s*)(\d+)([.)]\s+)(.*)$/);
    if (olMatch) {
        e.preventDefault();
        const [, indent, num, delim] = olMatch;
        const nextNum = parseInt(num, 10) + 1;
        const insert = '\n' + indent + nextNum + delim;
        const newText = val.substring(0, selStart) + insert + val.substring(selEnd);
        applyEditorChange(newText, selStart + insert.length, selStart + insert.length);
        return;
    }

    // Trích dẫn: > (có thể nhiều cấp)
    const bqMatch = currentLine.match(/^(\s*>+\s*)(.*)$/);
    if (bqMatch) {
        e.preventDefault();
        const insert = '\n' + bqMatch[1];
        const newText = val.substring(0, selStart) + insert + val.substring(selEnd);
        applyEditorChange(newText, selStart + insert.length, selStart + insert.length);
        return;
    }

    // Phần thụt lề đầu dòng
    const indentMatch = currentLine.match(/^(\s+)/);
    if (indentMatch) {
        e.preventDefault();
        const insert = '\n' + indentMatch[1];
        const newText = val.substring(0, selStart) + insert + val.substring(selEnd);
        applyEditorChange(newText, selStart + insert.length, selStart + insert.length);
    }
}

function wrapOrToggleFormat(wrapper, placeholder = '') {
    const val = markdownInput.value;
    const selStart = markdownInput.selectionStart;
    const selEnd = markdownInput.selectionEnd;
    const selected = val.substring(selStart, selEnd);
    const wLen = wrapper.length;

    if (selected.length >= 2 * wLen && selected.startsWith(wrapper) && selected.endsWith(wrapper)) {
        const unwrapped = selected.substring(wLen, selected.length - wLen);
        const newText = val.substring(0, selStart) + unwrapped + val.substring(selEnd);
        applyEditorChange(newText, selStart, selStart + unwrapped.length);
        return;
    }

    if (selStart >= wLen && selEnd + wLen <= val.length) {
        const before = val.substring(selStart - wLen, selStart);
        const after = val.substring(selEnd, selEnd + wLen);
        // Cặp ký hiệu tìm được không được là MỘT PHẦN của cặp dài hơn (vd '*' trong '**' của bold không phải
        // wrapper '*' của italic): xem thêm 1 ký tự ngoài before/after, nếu trùng wrapper thì chuỗi dấu dài hơn.
        const extraBefore = selStart - wLen - 1 >= 0 ? val[selStart - wLen - 1] : '';
        const extraAfter = selEnd + wLen < val.length ? val[selEnd + wLen] : '';
        const isPartOfLongerWrapper = extraBefore === wrapper[wrapper.length - 1] || extraAfter === wrapper[0];
        if (before === wrapper && after === wrapper && !isPartOfLongerWrapper) {
            const newText = val.substring(0, selStart - wLen) + selected + val.substring(selEnd + wLen);
            applyEditorChange(newText, selStart - wLen, selStart - wLen + selected.length);
            return;
        }
    }

    if (selStart === selEnd) {
        const insert = wrapper + placeholder + wrapper;
        const newText = val.substring(0, selStart) + insert + val.substring(selEnd);
        const newPos = selStart + wLen + (placeholder ? placeholder.length : 0);
        applyEditorChange(newText, selStart + wLen, newPos);
    } else {
        const insert = wrapper + selected + wrapper;
        const newText = val.substring(0, selStart) + insert + val.substring(selEnd);
        applyEditorChange(newText, selStart + wLen, selStart + wLen + selected.length);
    }
}

function handleEditorLink() {
    const val = markdownInput.value;
    const selStart = markdownInput.selectionStart;
    const selEnd = markdownInput.selectionEnd;
    const selected = val.substring(selStart, selEnd);

    if (selStart === selEnd) {
        const insert = '[link](url)';
        const newText = val.substring(0, selStart) + insert + val.substring(selEnd);
        // Chọn sẵn chữ "url" (vị trí 7-10 trong "[link](url)") để người dùng dán link đè lên.
        applyEditorChange(newText, selStart + 7, selStart + 10);
    } else {
        const insert = `[${selected}](url)`;
        const newText = val.substring(0, selStart) + insert + val.substring(selEnd);
        const urlStart = selStart + selected.length + 3;
        applyEditorChange(newText, urlStart, urlStart + 3);
    }
}

function handleEditorDuplicate() {
    const val = markdownInput.value;
    const selStart = markdownInput.selectionStart;
    const selEnd = markdownInput.selectionEnd;

    if (selStart !== selEnd) {
        const selected = val.substring(selStart, selEnd);
        const newText = val.substring(0, selEnd) + selected + val.substring(selEnd);
        applyEditorChange(newText, selEnd, selEnd + selected.length);
    } else {
        const lineStart = val.lastIndexOf('\n', selStart - 1) + 1;
        let lineEnd = val.indexOf('\n', selStart);
        if (lineEnd === -1) lineEnd = val.length;

        const currentLine = val.substring(lineStart, lineEnd);
        const insert = '\n' + currentLine;
        const newText = val.substring(0, lineEnd) + insert + val.substring(lineEnd);
        const offset = selStart - lineStart;
        applyEditorChange(newText, lineEnd + 1 + offset, lineEnd + 1 + offset);
    }
}

markdownInput.addEventListener('keydown', (e) => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const isCmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
    const key = e.key;

    if (isCmdOrCtrl) {
        const lowerKey = key.toLowerCase();

        if (lowerKey === 'z' && !e.shiftKey) {
            e.preventDefault();
            editorHistory.undo(markdownInput);
            return;
        }

        if (lowerKey === 'y' || (lowerKey === 'z' && e.shiftKey)) {
            e.preventDefault();
            editorHistory.redo(markdownInput);
            return;
        }

        if (lowerKey === 'b') {
            e.preventDefault();
            wrapOrToggleFormat('**');
            return;
        }

        if (lowerKey === 'i') {
            e.preventDefault();
            wrapOrToggleFormat('*');
            return;
        }

        if (lowerKey === 'k') {
            e.preventDefault();
            handleEditorLink();
            return;
        }

        if (lowerKey === 'e' || key === '`') {
            e.preventDefault();
            wrapOrToggleFormat('`');
            return;
        }

        if (e.shiftKey && lowerKey === 'x') {
            e.preventDefault();
            wrapOrToggleFormat('~~');
            return;
        }

        if (lowerKey === 'd') {
            e.preventDefault();
            handleEditorDuplicate();
            return;
        }
    }

    if (key === 'Tab') {
        handleEditorTab(e);
        return;
    }

    if (key === 'Enter' && !e.shiftKey && !e.altKey && !isCmdOrCtrl) {
        handleEditorEnter(e);
        return;
    }

    const val = markdownInput.value;
    const selStart = markdownInput.selectionStart;
    const selEnd = markdownInput.selectionEnd;

    const wrapPairs = {
        '(': ')',
        '[': ']',
        '{': '}',
        '"': '"',
        "'": "'",
        '`': '`',
        '*': '*',
        '_': '_',
        '~': '~',
        '$': '$'
    };

    if (selStart !== selEnd && wrapPairs[key]) {
        e.preventDefault();
        const openChar = key;
        const closeChar = wrapPairs[key];
        const selected = val.substring(selStart, selEnd);
        const newText = val.substring(0, selStart) + openChar + selected + closeChar + val.substring(selEnd);
        applyEditorChange(newText, selStart + 1, selEnd + 1);
        return;
    }

    const autoClosePairs = {
        '(': ')',
        '[': ']',
        '{': '}',
        '"': '"',
        "'": "'",
        '`': '`'
    };

    if (selStart === selEnd && autoClosePairs[key]) {
        // Không tự đóng nháy đơn sau ký tự chữ/số (don't, it's, user's).
        if (key === "'") {
            const charBefore = selStart > 0 ? val[selStart - 1] : '';
            // \w: có chữ/số/_ ngay trước nháy đơn -> nháy trong từ, không tự đóng
            if (/\w/.test(charBefore)) {
                return;
            }
        }
        e.preventDefault();
        const openChar = key;
        const closeChar = autoClosePairs[key];
        const newText = val.substring(0, selStart) + openChar + closeChar + val.substring(selEnd);
        applyEditorChange(newText, selStart + 1, selStart + 1);
        return;
    }

    const closers = [')', ']', '}', '"', "'", '`'];
    if (selStart === selEnd && closers.includes(key) && selStart < val.length && val[selStart] === key) {
        e.preventDefault();
        markdownInput.setSelectionRange(selStart + 1, selStart + 1);
        return;
    }

    if (key === 'Backspace' && selStart === selEnd && selStart > 0 && selStart < val.length) {
        const charBefore = val[selStart - 1];
        const charAfter = val[selStart];
        if (autoClosePairs[charBefore] === charAfter) {
            e.preventDefault();
            const newText = val.substring(0, selStart - 1) + val.substring(selStart + 1);
            applyEditorChange(newText, selStart - 1, selStart - 1);
        }
    }
});

function applyContent(text) {
    markdownInput.value = text;
    editorHistory.stack = [];
    editorHistory.index = -1;
    editorHistory.saveCurrentState(markdownInput);
    updateEditorHighlight();
    renderMarkdown();
    markdownInput.scrollTop = 0;
    previewOutput.scrollTop = 0;
    editorHighlight.scrollTop = 0;
}

function loadDefaultContent() {
    applyContent(defaultMarkdown);
    // Ghi đè luôn bộ nhớ tạm để thoát app ngay sau Reset vẫn mở lại bản mẫu chứ không phải nội dung cũ.
    saveContentToStorage();
}

let quotaWarnedAt = 0;
function saveContentToStorage() {
    try {
        localStorage.setItem(CONTENT_STORAGE_KEY, markdownInput.value);
    } catch (e) {
        const isQuota = e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014);
        const now = Date.now();
        if (isQuota && now - quotaWarnedAt > 10000) {
            quotaWarnedAt = now;
            showToast('Storage is full, new content may be lost when the app closes.');
        }
    }
}

function loadInitialContent() {
    let savedContent = null;
    try {
        savedContent = localStorage.getItem(CONTENT_STORAGE_KEY);
    } catch (e) {
        // Bỏ qua nếu localStorage bị chặn
    }

    if (savedContent) {
        applyContent(savedContent);
    } else {
        applyContent(defaultMarkdown);
    }
}

function debounce(func, delay = 300) {
    let timeoutId;
    return function (...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
}

const debouncedRender = debounce(renderMarkdown, 300);
const debouncedSaveContent = debounce(saveContentToStorage, 400);

markdownInput.addEventListener('input', (e) => {
    charCounter.textContent = `${markdownInput.value.length} characters`;
    scheduleEditorHighlight();
    debouncedRender();
    debouncedSaveContent();

    clearTimeout(editorHistory.typingTimer);
    const inputType = e.inputType || '';
    if (inputType.includes('Space') || inputType.includes('Line') || inputType.includes('history')) {
        editorHistory.saveCurrentState(markdownInput);
    } else {
        editorHistory.typingTimer = setTimeout(() => {
            editorHistory.saveCurrentState(markdownInput);
        }, 400);
    }
});

function handleScroll(source, target) {
    if (!isSyncScrollEnabled || activeScrollSource !== source) return;

    const sourceScrollable = source.scrollHeight - source.clientHeight;
    if (sourceScrollable <= 0) return;

    const targetScrollable = target.scrollHeight - target.clientHeight;
    const scrollPercentage = source.scrollTop / sourceScrollable;
    target.scrollTop = scrollPercentage * Math.max(targetScrollable, 0);
}

markdownInput.addEventListener('mouseenter', () => activeScrollSource = markdownInput);
previewOutput.addEventListener('mouseenter', () => activeScrollSource = previewOutput);

markdownInput.addEventListener('focus', () => activeScrollSource = markdownInput);
previewOutput.addEventListener('focus', () => activeScrollSource = previewOutput);

markdownInput.addEventListener('wheel', () => activeScrollSource = markdownInput, { passive: true });
previewOutput.addEventListener('wheel', () => activeScrollSource = previewOutput, { passive: true });

markdownInput.addEventListener('keydown', () => activeScrollSource = markdownInput);
previewOutput.addEventListener('keydown', () => activeScrollSource = previewOutput);

markdownInput.addEventListener('touchstart', () => activeScrollSource = markdownInput, { passive: true });
previewOutput.addEventListener('touchstart', () => activeScrollSource = previewOutput, { passive: true });

// Gộp scroll-sync theo khung hình (rAF) để tránh đọc scrollHeight/scrollTop (ép tính lại layout) trên
// từng sự kiện scroll dồn dập.
let editorScrollTicking = false;
let previewScrollTicking = false;
let previewScrollGen = 0;

markdownInput.addEventListener('scroll', () => {
    // Lớp tô màu cú pháp phải bám sát tuyệt đối theo pixel nên đồng bộ ngay, không qua rAF
    editorHighlight.scrollTop = markdownInput.scrollTop;
    editorHighlight.scrollLeft = markdownInput.scrollLeft;

    if (editorScrollTicking) return;
    editorScrollTicking = true;
    requestAnimationFrame(() => {
        editorScrollTicking = false;
        handleScroll(markdownInput, previewOutput);
    });
});

previewOutput.addEventListener('scroll', () => {
    previewScrollGen++;
    if (previewScrollTicking) return;
    previewScrollTicking = true;
    requestAnimationFrame(() => {
        previewScrollTicking = false;
        handleScroll(previewOutput, markdownInput);
    });
});

// Chặn click liên kết ngoài và mở bằng trình duyệt hệ thống để tránh lỗi điều hướng của WebView (app desktop).
previewOutput.addEventListener('click', async (e) => {
    const link = e.target.closest('a');
    if (link && link.getAttribute('href')) {
        const href = link.getAttribute('href');
        if (!href.startsWith('#')) {
            e.preventDefault();
            if (!isSafeExternalUrl(href)) return;
            
            if (window.__TAURI__ && window.__TAURI__.opener) {
                try {
                    await window.__TAURI__.opener.openUrl(href);
                } catch (err) {
                    console.warn('Failed to open URL via Tauri opener:', err);
                    window.open(href, '_blank', 'noopener,noreferrer');
                }
            } else {
                window.open(href, '_blank', 'noopener,noreferrer');
            }
        }
    }
});

btnSync.addEventListener('click', () => {
    isSyncScrollEnabled = !isSyncScrollEnabled;
    btnSync.classList.toggle('active', isSyncScrollEnabled);
    // aria theo class .active: nếu không set, màn hình đọc luôn "pressed".
    btnSync.setAttribute('aria-pressed', String(isSyncScrollEnabled));
    showToast(isSyncScrollEnabled ? "Sync scroll enabled" : "Sync scroll disabled");
});

const VIEW_STORAGE_KEY = 'markdown-live-view';
const DEFAULT_VIEW_MODE = 'split';
const workspace = document.querySelector('.workspace');
const paneResizer = document.getElementById('pane-resizer');
const viewWrap = document.querySelector('.view-wrap');
const btnView = document.getElementById('btn-view');
const viewMenu = document.getElementById('view-menu');
const viewItems = Array.from(document.querySelectorAll('.view-item'));

// Phải khớp @media (max-width: 768px) trong style.css.
const VERTICAL_LAYOUT_MQ = '(max-width: 768px)';

const SPLIT_MIN_PERCENT = 20;
const SPLIT_MAX_PERCENT = 80;
const VIEW_EDGE_PREVIEW_PERCENT = 2;
const VIEW_EDGE_EDITOR_PERCENT = 98;

function computeSplitPercent(pointerX, workspaceWidth) {
    if (!(workspaceWidth > 0)) return 50;
    const percent = (pointerX / workspaceWidth) * 100;
    return Math.min(SPLIT_MAX_PERCENT, Math.max(SPLIT_MIN_PERCENT, percent));
}

function computeViewModeFromPercent(percent) {
    if (percent < VIEW_EDGE_PREVIEW_PERCENT) return 'preview';
    if (percent > VIEW_EDGE_EDITOR_PERCENT) return 'editor';
    return 'split';
}

function getCurrentViewMode() {
    return document.body.classList.contains('view-editor') ? 'editor'
        : document.body.classList.contains('view-preview') ? 'preview'
        : 'split';
}

function applyViewMode(mode, persist = true) {
    if (mode !== 'editor' && mode !== 'split' && mode !== 'preview') return;
    document.body.classList.toggle('view-editor', mode === 'editor');
    document.body.classList.toggle('view-split', mode === 'split');
    document.body.classList.toggle('view-preview', mode === 'preview');
    viewItems.forEach((item) => {
        item.classList.toggle('active', item.dataset.view === mode);
    });
    if (persist) {
        try {
            localStorage.setItem(VIEW_STORAGE_KEY, mode);
        } catch (e) {
            // Bỏ qua nếu localStorage bị chặn
        }
    }
}

function closeViewMenu() {
    viewMenu.classList.add('hidden');
    viewWrap.classList.remove('open');
    btnView.setAttribute('aria-expanded', 'false');
}

btnView.addEventListener('click', () => {
    const isHidden = viewMenu.classList.toggle('hidden');
    viewWrap.classList.toggle('open', !isHidden);
    btnView.setAttribute('aria-expanded', String(!isHidden));
});

document.addEventListener('click', (e) => {
    if (!viewMenu.classList.contains('hidden') && !viewWrap.contains(e.target)) {
        closeViewMenu();
    }
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeViewMenu();
});

viewItems.forEach((item) => {
    item.addEventListener('click', () => {
        applyViewMode(item.dataset.view);
        closeViewMenu();
    });
});

let isDraggingResizer = false;

function endResizerDrag() {
    if (!isDraggingResizer) return;
    isDraggingResizer = false;
    paneResizer.classList.remove('dragging');
    document.body.classList.remove('resizing');
}

paneResizer.addEventListener('pointerdown', (e) => {
    if (getCurrentViewMode() !== 'split') return;
    isDraggingResizer = true;
    paneResizer.classList.add('dragging');
    document.body.classList.add('resizing');
    // setPointerCapture có thể ném NotFoundError với pointer giả (automation)
    try {
        paneResizer.setPointerCapture(e.pointerId);
    } catch (err) {
        // Không giữ capture: vẫn kéo được, chỉ là PointerEvent đi lạc ngoài resizer
    }
    e.preventDefault();
});

paneResizer.addEventListener('pointermove', (e) => {
    if (!isDraggingResizer) return;
    const rect = workspace.getBoundingClientRect();
    // Chọn trục theo layout hiện tại (dọc khi màn hình nhỏ), kiểm mỗi lần move để kéo vắt qua ngưỡng
    // resize cửa sổ cũng không lỗi.
    const vertical = window.matchMedia(VERTICAL_LAYOUT_MQ).matches;
    const size = vertical ? rect.height : rect.width;
    if (!(size > 0)) return;
    const point = vertical ? e.clientY - rect.top : e.clientX - rect.left;
    // Xét ngưỡng biên theo percent THÔ (chưa clamp); clamp trước thì không bao giờ chạm 2%/98%.
    const rawPercent = (point / size) * 100;
    const mode = computeViewModeFromPercent(rawPercent);
    if (mode !== 'split') {
        endResizerDrag();
        applyViewMode(mode);
        return;
    }
    workspace.style.setProperty('--split-size', computeSplitPercent(point, size) + '%');
});

paneResizer.addEventListener('pointerup', endResizerDrag);
paneResizer.addEventListener('pointercancel', endResizerDrag);

// Chỉ nhớ chế độ xem, không nhớ vị trí splitter (luôn mở 50/50). Chạy ngay vì script dùng `defer`.
(function initViewModel() {
    let saved = null;
    try {
        saved = localStorage.getItem(VIEW_STORAGE_KEY);
    } catch (e) {
        // Bỏ qua nếu localStorage bị chặn
    }
    applyViewMode(saved || DEFAULT_VIEW_MODE, false);
})();

btnReset.addEventListener('click', () => {
    if (confirm("Are you sure you want to restore the sample text? This will overwrite your current content.")) {
        loadDefaultContent();
        showToast("Sample content restored!");
    }
});

btnCopy.addEventListener('click', () => {
    const textToCopy = markdownInput.value;
    const copyPromise = (window.__TAURI__ && window.__TAURI__.clipboardManager)
        ? window.__TAURI__.clipboardManager.writeText(textToCopy)
        : navigator.clipboard.writeText(textToCopy);

    copyPromise
        .then(() => showToast("Markdown copied to clipboard!"))
        .catch(() => showToast("An error occurred while copying."));
});

function deriveExportBaseName(markdown) {
    // Heading cấp 1 đầu tiên (cờ m: tìm ở bất kỳ dòng nào)
    const heading = markdown.match(/^\s{0,3}#\s+(.+?)\s*$/m);
    const raw = heading ? heading[1] : '';
    const slug = raw
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')   // bỏ dấu thanh/dấu phụ sau khi tách NFD
        .replace(/đ/gi, 'd')               // đ không bị tách trong NFD nên phải thay riêng
        .replace(/[^\w\s-]/g, '')          // bỏ ký tự đặc biệt (giữ chữ/số/_/khoảng trắng/-)
        .trim()
        .replace(/\s+/g, '-')              // khoảng trắng -> '-'
        .replace(/-{2,}/g, '-')            // gộp nhiều '-' liên tiếp
        .replace(/^-+|-+$/g, '')           // bỏ '-' ở đầu/cuối
        .toLowerCase();
    return (slug || 'document').slice(0, 80);
}

// Tải Blob qua <a download> (fallback khi chạy ngoài Tauri). Lưu ý: WebView của Tauri CHẶN cơ chế này
// (wry không có download delegate), nên trong app phải dùng saveTextFile() bên dưới.
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Chỉ mở http(s)/mailto/tel ra trình duyệt hệ thống; chặn javascript:/data:/file:/blob: kể cả khi sanitizer bị lọt.
// ponytail: không mở `ftp:` vì ACL của plugin opener (gen/schemas/acl-manifests.json) chỉ chấp nhận
// mailto/tel/http/https; nâng cấp sau: thêm sms:/geo:/... khi biết ACL chấp nhận gì.
function isSafeExternalUrl(href) {
    const url = String(href || '').trim();
    // http(s)://... hoặc mailto:/tel:...
    return /^(https?):\/\/\S/i.test(url) || /^(mailto|tel):\S/i.test(url);
}
const tauriDialogPlugin = () => (window.__TAURI__ ? window.__TAURI__.dialog : undefined);
const tauriFsPlugin = () => (window.__TAURI__ ? window.__TAURI__.fs : undefined);
const hasTauriBridge = () => !!(tauriDialogPlugin()?.save && tauriFsPlugin()?.writeTextFile);
// KHÔNG đặt tên isTauri: Tauri core đã inject global isTauri vào WebView (withGlobalTauri),
// trùng tên gây SyntaxError làm chết cả file script.
const isTauriRuntime = () => !!window.__TAURI__;

// Lưu văn bản: trong Tauri dùng hộp thoại Save As (plugin dialog) + ghi file (plugin fs); ngoài Tauri
// fallback <a download>. Trả về true nếu đã lưu, false nếu người dùng bấm Cancel.
async function saveTextFile(contents, baseName, ext, mimeType) {
    if (hasTauriBridge()) {
        const path = await window.__TAURI__.dialog.save({
            defaultPath: baseName + '.' + ext,
            filters: [{ name: ext.toUpperCase() + ' file', extensions: [ext] }]
        });
        if (!path) return false;
        try {
            await window.__TAURI__.fs.writeTextFile(path, contents);
        } catch (err) {
            // ACL plugin fs chỉ cho ghi trong $HOME (src-tauri/capabilities/default.json) mà hộp thoại Save As hiện cả
            // ổ đĩa/mạng/USB -> chọn ngoài $HOME bị từ chối. Báo rõ nguyên nhân thay vì lỗi chung chung.
            console.error('Write failed:', err);
            showToast('Could not write there. This build can only save inside your home folder - pick another location.');
            return false;
        }
        return true;
    }

    // Fallback trình duyệt. Trong WebView Tauri mà thiếu dialog/fs thì <a download> không chạy:
    // báo rõ thay vì im lặng "thành công".
    if (isTauriRuntime()) {
        showToast('Could not save the file: the app\'s file-saving plugin is missing.');
        return false;
    }
    downloadBlob(new Blob([contents], { type: mimeType }), baseName + '.' + ext);
    return true;
}

async function exportMarkdown() {
    const text = markdownInput.value;
    if (!text.trim()) {
        showToast("Content is empty, nothing to export.");
        return;
    }
    try {
        const saved = await saveTextFile(text, deriveExportBaseName(text), 'md', 'text/markdown;charset=utf-8');
        if (saved) showToast("Markdown file exported!");
    } catch (err) {
        console.error('Markdown export failed:', err);
        showToast("An error occurred while exporting the Markdown file.");
    }
}

// CSS tối giản nhúng trong file HTML (trình duyệt không đọc được stylesheet của app). Phải kèm cả
// sup/sub/kbd/mark/details, canh lề checkbox task list và canh giữa Mermaid: app lấy các rule này từ vendor CSS.
const HTML_STYLES = `
    body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.6; max-width: 800px; margin: 2rem auto; padding: 0 1rem; color: #1f2328; background: #fff; }
    h1 { font-size: 2em; } h2 { font-size: 1.5em; } h3 { font-size: 1.25em; }
    h4 { font-size: 1em; } h5 { font-size: .875em; } h6 { font-size: .85em; color: #59636e; }
    table { border-collapse: collapse; width: 100%; margin: 10px 0; }
    th, td { border: 1px solid #d1d9e0; padding: 6px 13px; text-align: left; }
    th { background: #f6f8fa; font-weight: bold; }
    pre { background: #f6f8fa; border-radius: 6px; padding: 12px; overflow-x: auto; font-family: Consolas, "Courier New", monospace; font-size: 85%; }
    code { font-family: Consolas, "Courier New", monospace; background: #f6f8fa; padding: .2em .4em; border-radius: 6px; font-size: 85%; }
    pre code { background: none; padding: 0; font-size: 100%; }
    blockquote { border-left: 4px solid #d1d9e0; margin-left: 0; padding-left: 12px; color: #59636e; }
    img { max-width: 100%; height: auto; }
    a { color: #0969da; }
    hr { border: none; border-top: 1px solid #d1d9e0; }
    .markdown-alert { border-left: 4px solid #0969da; background: #f6f8fa; padding: 8px 12px; }
    .markdown-alert-title { font-weight: bold; }
    .markdown-alert-tip { border-left-color: #1a7f37; }
    .markdown-alert-important { border-left-color: #8250df; }
    .markdown-alert-warning { border-left-color: #9a6700; }
    .markdown-alert-caution { border-left-color: #d1242f; }
    svg { max-width: 100%; height: auto; }
    .mermaid { display: flex; justify-content: center; align-items: center; background: transparent; border: none; }
    sup, sub { font-size: .75em; }
    kbd { font-family: Consolas, "Courier New", monospace; font-size: 85%; background: #f6f8fa; border: 1px solid #d1d9e0; border-bottom-width: 2px; border-radius: 6px; padding: .15em .4em; }
    mark { background: #fff3bf; color: #24292f; padding: .1em .2em; }
    details { border: 1px solid #d1d9e0; border-radius: 6px; padding: 8px 12px; margin: 10px 0; }
    summary { font-weight: bold; cursor: pointer; }
    li:has(> input[type="checkbox"]) { list-style-type: none; margin-left: -1.2em; }
    li > input[type="checkbox"] { margin: 0 0.4em 0.2em 0; vertical-align: middle; }
`;

function buildStandaloneHtml(bodyHtml, title) {
    // Escape & < > để title không bẻ gãy thẻ <title>
    const safeTitle = String(title || 'Document')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n'
        + '<meta charset="UTF-8">\n'
        + '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
        + '<title>' + safeTitle + '</title>\n'
        + '<style>' + HTML_STYLES + '</style>\n</head>\n<body>\n' + bodyHtml + '\n</body>\n</html>';
}

function deriveDocumentTitle(markdown) {
    // Heading cấp 1 đầu tiên (cờ m: tìm ở bất kỳ dòng nào)
    const heading = markdown.match(/^\s{0,3}#\s+(.+?)\s*$/m);
    return (heading ? heading[1] : '').trim() || 'Document';
}

// Gỡ icon Lucide của GFM alert (trình duyệt ngoài không có lib để vẽ lại); chỉ xoá đúng class lucide để
// KHÔNG đụng SVG Mermaid, vì file HTML cần giữ nguyên SVG đó. Checkbox task list giữ nguyên.
function stripLucideIcons(container) {
    container.querySelectorAll('svg.lucide').forEach((el) => el.remove());
}

async function exportHtml() {
    const text = markdownInput.value;
    if (!text.trim()) {
        showToast("Content is empty, nothing to export.");
        return;
    }
    showToast("Generating HTML file...");

    // Clone Preview đã render xong (như exportDoc nhưng giữ nguyên SVG Mermaid, không cần chuyển sang PNG).
    renderMarkdown();
    await whenMermaidIdle(8000);
    const clone = previewOutput.cloneNode(true);

    stripLucideIcons(clone);

    // KaTeX -> MathML thuần: file không mang CSS của KaTeX nên phải thay span.katex bằng <math>.
    convertKatexForDoc(clone);

    const html = buildStandaloneHtml(clone.innerHTML, deriveDocumentTitle(text));
    try {
        const saved = await saveTextFile(html, deriveExportBaseName(text), 'html', 'text/html;charset=utf-8');
        if (saved) showToast("HTML file exported!");
    } catch (err) {
        console.error('HTML export failed:', err);
        showToast("An error occurred while exporting the HTML file.");
    }
}

// Chuyển <foreignObject> (nhãn HTML của Mermaid) trong SVG clone thành <text> thuần SVG, vì canvas
// không vẽ được foreignObject (nhãn sẽ biến mất). ponytail: mất đậm/nghiêng, chỉ giữ chữ, màu, cỡ font;
// nâng cấp sau: dựng text theo kích thước/toạ độ từng span con.
function flattenForeignObjects(svgClone, fallbackColor, fallbackFontSize) {
    const NS = 'http://www.w3.org/2000/svg';
    svgClone.querySelectorAll('foreignObject').forEach((fo) => {
        const div = fo.querySelector('div, span, p');
        const lines = (div ? div.textContent : fo.textContent).split('\n').map(s => s.trim()).filter(Boolean);
        if (!lines.length) {
            fo.remove();
            return;
        }
        const x = parseFloat(fo.getAttribute('x')) || 0;
        const y = parseFloat(fo.getAttribute('y')) || 0;
        const w = parseFloat(fo.getAttribute('width')) || 100;
        const h = parseFloat(fo.getAttribute('height')) || 40;
        const fontSize = (div && div.style.fontSize) || fallbackFontSize || '16px';
        const lineH = (parseFloat(fontSize) || 16) * 1.25;
        const text = document.createElementNS(NS, 'text');
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'middle');
        text.setAttribute('fill', (div && div.style.color) || fallbackColor || '#000');
        text.setAttribute('font-size', fontSize);
        // Mỗi dòng là một tspan căn giữa theo foreignObject; vị trí tuyệt đối do transform
        // của phần tử cha (được giữ nguyên) quyết định.
        const startY = y + h / 2 - ((lines.length - 1) * lineH) / 2;
        lines.forEach((line, i) => {
            const tspan = document.createElementNS(NS, 'tspan');
            tspan.setAttribute('x', x + w / 2);
            tspan.setAttribute('y', startY + i * lineH);
            tspan.textContent = line;
            text.appendChild(tspan);
        });
        fo.replaceWith(text);
    });
}

// Vẽ SVG (sơ đồ Mermaid) lên canvas 2x rồi trả data-URL PNG (Word không hỗ trợ SVG inline), kèm
// kích thước hiển thị (px) để exportDoc thu ảnh vừa trang Word.
async function svgToPngDataUrl(svg, scale = 2) {
    // viewBox dạng 'x y w h' (ngăn cách bằng khoảng trắng hoặc dấu phẩy)
    const viewBox = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    const rect = svg.getBoundingClientRect();
    const w = rect.width > 0 ? rect.width : (viewBox.length === 4 && viewBox[2] > 0 ? viewBox[2] : 800);
    const h = rect.height > 0 ? rect.height : (viewBox.length === 4 && viewBox[3] > 0 ? viewBox[3] : 600);

    const svgStyle = window.getComputedStyle(svg);
    const clone = svg.cloneNode(true);
    flattenForeignObjects(clone, svgStyle.color, svgStyle.fontSize);
    clone.setAttribute('width', w);
    clone.setAttribute('height', h);

    const img = new Image();
    await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
    });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, w, h);
    return { dataUrl: canvas.toDataURL('image/png'), width: w, height: h };
}

// Word bỏ qua CSS max-width nên PNG 2x lớn hơn trang sẽ tràn lề: giữ ảnh nhỏ, thu ảnh lớn về vừa trang
// (rộng 650px / cao 900px, nhỏ hơn A4 trừ lề 15mm trong style.css) theo tỉ lệ, kèm width/height tường minh.
const DOC_IMG_MAX_WIDTH_PX = 650;
const DOC_IMG_MAX_HEIGHT_PX = 900;
function fitDocImageSize(w, h, maxW = DOC_IMG_MAX_WIDTH_PX, maxH = DOC_IMG_MAX_HEIGHT_PX) {
    w = Math.round(Number(w));
    h = Math.round(Number(h));
    if (!(w > 0) || !(h > 0)) return { width: w, height: h };
    const s = Math.min(1, maxW / w, maxH / h);
    return { width: Math.round(w * s), height: Math.round(h * s) };
}

// Badge (shields.io...) là SVG remote, <img> không có width/height tường minh nên Word tự đoán và kéo dãn.
// Xử lý: (1) luôn gắn width/height px tường minh cho MỌI ảnh, (2) đổi ảnh SVG sang PNG data-URL
// (Word xử lý PNG ổn định hơn SVG).
// Các host chuyên phục vụ badge (luôn trả SVG)
const DOC_SVG_HOSTS = /^https?:\/\/(?:img\.shields\.io|flat\.badgen\.net|badgen\.net|badge\.fury\.io|camo\.githubusercontent\.com)\//i;

// URL này có thể trả về SVG? (shields.io trả SVG dù URL không có đuôi .svg)
function isSvgImageSrc(src) {
    src = String(src || '');
    // data:image/svg, đuôi .svg (có thể kèm ?query/#hash), hoặc host badge
    return /^data:image\/svg/i.test(src) || /\.svg(?:[?#]|$)/i.test(src) || DOC_SVG_HOSTS.test(src);
}

// Kích thước hiển thị (px) của ảnh gốc trong Preview: ưu tiên width/height người dùng ghi (bỏ qua dạng %),
// rồi tới kích thước tự nhiên, cuối cùng là khung đang vẽ.
function getDocImageSize(orig) {
    // Bỏ qua giá trị dạng % (không quy ra px được)
    const px = (v) => (v && !/%\s*$/.test(v)) ? (parseFloat(v) || 0) : 0;
    let w = px(orig.getAttribute('width'));
    let h = px(orig.getAttribute('height'));
    const natW = orig.naturalWidth || 0;
    const natH = orig.naturalHeight || 0;
    const ratio = natW > 0 && natH > 0 ? natW / natH : 0;
    if (w > 0 && !(h > 0) && ratio) h = w / ratio;
    else if (h > 0 && !(w > 0) && ratio) w = h * ratio;
    else if (!(w > 0) || !(h > 0)) { w = natW; h = natH; }
    if (!(w > 0) || !(h > 0)) {
        const r = orig.getBoundingClientRect();
        w = r.width;
        h = r.height;
    }
    return { width: w, height: h };
}

function waitForImageLoad(img, timeoutMs = 4000) {
    if (img.complete) return Promise.resolve();
    return new Promise((resolve) => {
        const done = () => { clearTimeout(t); img.removeEventListener('load', done); img.removeEventListener('error', done); resolve(); };
        const t = setTimeout(done, timeoutMs);
        img.addEventListener('load', done);
        img.addEventListener('error', done);
    });
}

// Vẽ ảnh SVG (remote hoặc data:) lên canvas 2x -> data-URL PNG. Cần crossOrigin='anonymous' (shields.io có
// gửi CORS); nếu server không cho phép, toDataURL() ném lỗi và nơi gọi giữ nguyên URL gốc (kèm kích thước).
async function svgImageToPngDataUrl(src, w, h, scale = 2) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('image load timeout')), 6000);
        img.onload = () => { clearTimeout(t); resolve(); };
        img.onerror = () => { clearTimeout(t); reject(new Error('image load failed')); };
        img.src = src;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
}

// CSS tối giản nhúng trong file DOC: Word không đọc được stylesheet của app nên phải tự mang theo định dạng cốt lõi.
const DOC_STYLES = `
    body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.5; }
    h1 { font-size: 20pt; } h2 { font-size: 16pt; } h3 { font-size: 14pt; }
    h4 { font-size: 12pt; } h5 { font-size: 11pt; } h6 { font-size: 10pt; color: #57606a; }
    /* Chỉ bảng dữ liệu (đã gắn class doc-data-table trong exportDoc) mới có viền ô. Bảng dùng làm khung quote/alert
       KHÔNG nhận luật này: Word coi "border: none" inline là "chưa khai báo" và rơi về viền của stylesheet,
       khiến quote bị viền bao quanh. */
    table.doc-data-table { border-collapse: collapse; width: 100%; margin: 10px 0; }
    .doc-data-table th, .doc-data-table td { border: 1px solid #d0d7de; padding: 6px 10px; text-align: left; }
    .doc-data-table th { background: #f6f8fa; font-weight: bold; }
    pre { background: #f6f8fa; border: 1px solid #d0d7de; padding: 10px; font-family: Consolas, "Courier New", monospace; font-size: 9.5pt; white-space: pre-wrap; }
    code { font-family: Consolas, "Courier New", monospace; }
    blockquote { border-left: 4px solid #d0d7de; margin-left: 0; padding-left: 12px; color: #57606a; }
    img { border: 0; }
    a { color: #0969da; }
    hr { border: none; border-top: 1px solid #d0d7de; }
    .markdown-alert { border-left: 4px solid #0969da; background: #f6f8fa; padding: 8px 12px; }
    .markdown-alert-title { font-weight: bold; }
    .markdown-alert-tip { border-left-color: #1a7f37; }
    .markdown-alert-important { border-left-color: #8250df; }
    .markdown-alert-warning { border-left-color: #9a6700; }
    .markdown-alert-caution { border-left-color: #d1242f; }
`;

function buildWordHtml(bodyHtml) {
    return '<html xmlns:o="urn:schemas-microsoft-com:office:office" '
        + 'xmlns:w="urn:schemas-microsoft-com:office:word" '
        + 'xmlns="http://www.w3.org/TR/REC-html40">\n<head>\n'
        + '<meta charset="UTF-8">\n'
        + '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->\n'
        + '<style>' + DOC_STYLES + '</style>\n</head>\n<body>\n' + bodyHtml + '\n</body>\n</html>';
}

// KaTeX render mỗi công thức thành 2 lớp (.katex-mathml và .katex-html); file DOC không mang CSS KaTeX nên
// Word in cả hai ra chữ rác -> thay span.katex bằng <math> thuần. Khối nhiều dòng (aligned/bmatrix): MathML
// mặc định chỉ có mrow nên render lại từ LaTeX nguồn (annotation x-tex) với output:'mathml' để có mtable.
function convertKatexForDoc(container) {
    container.querySelectorAll('span.katex').forEach((el) => {
        let math = el.querySelector('.katex-mathml > math')
            // output:'mathml' của KaTeX không có wrapper .katex-mathml, <math> là con trực tiếp.
            || el.querySelector(':scope > math');
        const annotation = el.querySelector('annotation[encoding="application/x-tex"]');
        const tex = annotation ? annotation.textContent : '';
        // Có \\ (xuống dòng) hoặc môi trường nhiều dòng (aligned, matrix, cases, ...)
        if (tex && /\\\\|\\begin\{(aligned|align|gather|cases|matrix|bmatrix|pmatrix|vmatrix|array)\}/.test(tex)
            && typeof katex !== 'undefined') {
            try {
                const tmp = document.createElement('div');
                tmp.innerHTML = katex.renderToString(tex, { throwOnError: false, displayMode: true, output: 'mathml' });
                const rendered = tmp.querySelector('math');
                if (rendered) math = rendered;
            } catch (e) { /* giữ math mặc định bên dưới */ }
        }
        if (math) {
            // Word không hiểu <annotation>; bỏ annotation và mọi text node trần (DOMPurify ở preview có thể đã gỡ
            // annotation nhưng chừa lại text của nó).
            math.querySelectorAll('annotation').forEach((a) => a.remove());
            Array.from(math.childNodes)
                .filter(n => n.nodeType === 3 && n.textContent.trim())
                .forEach(n => n.remove());
            const wrapper = document.createElement('span');
            wrapper.style.fontFamily = "'Cambria Math', 'Times New Roman', serif";
            wrapper.innerHTML = typeof DOMPurify !== 'undefined'
                ? DOMPurify.sanitize(math.outerHTML, { USE_PROFILES: { mathMl: true } })
                : math.outerHTML;
            el.replaceWith(wrapper);
        } else {
            // Không có MathML (KaTeX lỗi/không tải): giữ LaTeX nguồn thay vì chữ rác.
            el.replaceWith(document.createTextNode(el.textContent));
        }
    });
}

// ---- KaTeX -> PNG cho file DOC (giống cách xử lý Mermaid) ----
// Clone span.katex gốc từ Preview, nhúng CSS KaTeX + đúng các font đang dùng (base64) vào SVG <foreignObject>,
// vẽ lên canvas rồi xuất PNG. Công thức nào vẽ lỗi / ra ảnh trống thì giữ nguyên để convertKatexForDoc()
// chuyển sang MathML như cũ (xem convertKatexToImagesForDoc).
const KATEX_IMG_SCALE = 3;
const KATEX_IMG_PAD = 2;
let katexAssetsPromise = null;

// Khoá font: family|style|weight đã chuẩn hoá, để khớp @font-face trong CSS với computed style của từng phần tử.
function katexFontKey(family, style, weight) {
    const w = weight === 'bold' ? 700 : (weight === 'normal' ? 400 : parseInt(weight, 10));
    return String(family).replace(/["']/g, '').trim()
        + '|' + (/italic|oblique/i.test(style) ? 'italic' : 'normal')
        + '|' + (w >= 600 ? '700' : '400');
}

// Trả về Map(khoá font -> url woff2 tương đối). Chỉ lấy woff2 để SVG không phải mang cả woff/ttf.
function parseKatexFontFaces(css) {
    const faces = new Map();
    const re = /@font-face\s*\{([^}]*)\}/gi;
    let m;
    while ((m = re.exec(css))) {
        const block = m[1];
        const fam = block.match(/font-family\s*:\s*["']?([^;"']+?)["']?\s*(?:;|$)/i);
        const url = block.match(/url\(\s*["']?([^"')]+?\.woff2)(?:\?[^"')]*)?["']?\s*\)/i);
        if (!fam || !url) continue;
        const style = (block.match(/font-style\s*:\s*(\w+)/i) || ['', 'normal'])[1];
        const weight = (block.match(/font-weight\s*:\s*(\w+)/i) || ['', '400'])[1].toLowerCase();
        faces.set(katexFontKey(fam[1], style, weight), url[1]);
    }
    return faces;
}

// Tải CSS KaTeX một lần (cache). Lỗi thì xoá cache để lần xuất sau thử lại.
function getKatexAssets() {
    if (!katexAssetsPromise) {
        katexAssetsPromise = (async () => {
            const link = document.querySelector('link[rel="stylesheet"][href*="katex"]');
            if (!link) throw new Error('KaTeX stylesheet not found');
            const cssUrl = link.href;
            const resp = await fetch(cssUrl);
            if (!resp.ok) throw new Error('Cannot fetch KaTeX CSS: ' + resp.status);
            const css = await resp.text();
            return {
                cssUrl,
                baseCss: css.replace(/@font-face\s*\{[^}]*\}/gi, ''),
                faces: parseKatexFontFaces(css),
                dataUris: new Map()
            };
        })();
        katexAssetsPromise.catch(() => { katexAssetsPromise = null; });
    }
    return katexAssetsPromise;
}

async function getKatexFontDataUri(assets, key) {
    if (assets.dataUris.has(key)) return assets.dataUris.get(key);
    const rel = assets.faces.get(key);
    if (!rel) return null;
    const resp = await fetch(new URL(rel, assets.cssUrl).href);
    if (!resp.ok) throw new Error('Cannot fetch KaTeX font: ' + rel);
    const blob = new Blob([await resp.arrayBuffer()], { type: 'font/woff2' });
    const dataUri = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
    assets.dataUris.set(key, dataUri);
    return dataUri;
}

// Các font KaTeX_* thật sự dùng trong công thức (theo computed style), để chỉ nhúng đúng những font cần.
function collectKatexFontKeys(root) {
    const keys = new Set();
    const nodes = [root, ...root.querySelectorAll('*')];
    for (const n of nodes) {
        const cs = getComputedStyle(n);
        for (const fam of cs.fontFamily.split(',')) {
            const name = fam.replace(/["']/g, '').trim();
            if (name.startsWith('KaTeX_')) keys.add(katexFontKey(name, cs.fontStyle, cs.fontWeight));
        }
    }
    return keys;
}

// Vẽ MỘT công thức (span.katex trong Preview) thành PNG. Trả { dataUrl, width, height, descent } (px, chưa nhân scale);
// descent = khoảng cách từ baseline xuống đáy ảnh, dùng để canh ảnh inline cho thẳng hàng chữ.
// Ném lỗi nếu canvas bị taint hoặc ảnh trống (WebView không vẽ được foreignObject) -> nơi gọi dùng MathML.
async function renderKatexToPng(origKatex, scale = KATEX_IMG_SCALE) {
    const assets = await getKatexAssets();

    const clone = origKatex.cloneNode(true);
    // Lớp MathML ẩn không cần cho ảnh (và làm XHTML khó serialize hơn).
    clone.querySelectorAll('.katex-mathml').forEach((n) => n.remove());

    // Giữ cỡ chữ/độ đậm của ngữ cảnh trong Preview; ép màu đen vì file Word nền trắng (Preview có thể đang ở Dark).
    const pcs = getComputedStyle(origKatex.parentElement || previewOutput);
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:inline-block;margin:0;padding:' + KATEX_IMG_PAD + 'px;white-space:nowrap;'
        + 'line-height:normal;background:transparent;color:#000;'
        + 'font-size:' + pcs.fontSize + ';font-weight:' + pcs.fontWeight + ';';
    wrap.appendChild(clone);

    // Đo ngoài màn hình: cùng document nên CSS KaTeX trang đang dùng áp dụng đúng.
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;';
    host.appendChild(wrap);
    document.body.appendChild(host);
    try {
        const rect = wrap.getBoundingClientRect();
        const width = Math.max(1, Math.ceil(rect.width));
        const height = Math.max(1, Math.ceil(rect.height));

        // Probe rộng 0 cao 0 nằm trên baseline dòng: đáy của nó chính là baseline.
        const probe = document.createElement('span');
        probe.style.cssText = 'display:inline-block;width:0;height:0;';
        wrap.appendChild(probe);
        const baseline = probe.getBoundingClientRect().bottom - rect.top;
        probe.remove();
        const descent = Math.max(0, height - baseline);

        let fontCss = '';
        for (const key of collectKatexFontKeys(wrap)) {
            const uri = await getKatexFontDataUri(assets, key);
            if (!uri) continue;
            const [family, style, weight] = key.split('|');
            fontCss += '@font-face{font-family:' + family + ';font-style:' + style + ';font-weight:' + weight
                + ';src:url(' + uri + ') format("woff2");}';
        }

        const xhtml = new XMLSerializer().serializeToString(wrap);
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height
            + '" viewBox="0 0 ' + width + ' ' + height + '">'
            + '<style><![CDATA[' + fontCss + assets.baseCss + ']]></style>'
            + '<foreignObject x="0" y="0" width="' + width + '" height="' + height + '">' + xhtml + '</foreignObject></svg>';

        const img = new Image();
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = () => reject(new Error('KaTeX SVG failed to load'));
            img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        });

        // Công thức rất rộng: hạ scale để canvas không vượt giới hạn kích thước của trình duyệt.
        const s = Math.max(1, Math.min(scale, 6000 / Math.max(width, height)));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width * s);
        canvas.height = Math.round(height * s);
        const ctx = canvas.getContext('2d');
        const draw = () => {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.scale(s, s);
            ctx.drawImage(img, 0, 0, width, height);
        };
        draw();
        // Font nhúng trong SVG có thể được giải mã trễ sau onload: chờ một nhịp rồi vẽ lại cho chắc.
        await new Promise((r) => setTimeout(r, 60));
        draw();

        // getImageData ném SecurityError nếu canvas bị taint; ảnh không có pixel nào thì WebView đã bỏ qua foreignObject.
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let inked = false;
        for (let i = 3; i < data.length; i += 4) {
            if (data[i] !== 0) { inked = true; break; }
        }
        if (!inked) throw new Error('KaTeX image is blank (foreignObject not rendered)');

        return { dataUrl: canvas.toDataURL('image/png'), width, height, descent };
    } finally {
        host.remove();
    }
}

// Thay từng span.katex trong clone bằng <img> PNG. origRoot là Preview thật (để đo + lấy font), cloneRoot là bản
// sẽ xuất. Công thức nào lỗi vẫn còn span.katex nên convertKatexForDoc() ở cuối sẽ xử lý bằng MathML.
async function convertKatexToImagesForDoc(origRoot, cloneRoot) {
    const origEls = origRoot.querySelectorAll('span.katex');
    const cloneEls = cloneRoot.querySelectorAll('span.katex');
    // Hai danh sách phải khớp theo chỉ số; lệch thì thôi, dùng MathML cho tất cả.
    if (origEls.length === cloneEls.length) {
        for (let i = 0; i < cloneEls.length; i++) {
            try {
                const { dataUrl, width, height, descent } = await renderKatexToPng(origEls[i]);
                const el = cloneEls[i];
                const display = !!el.parentElement && el.parentElement.classList.contains('katex-display');

                const img = document.createElement('img');
                img.src = dataUrl;
                const annotation = origEls[i].querySelector('annotation[encoding="application/x-tex"]');
                img.alt = annotation ? annotation.textContent : 'Math formula';
                // PNG vẽ ở scale lớn mà Word bỏ qua max-width: luôn gắn kích thước hiển thị tường minh.
                const fit = fitDocImageSize(width, height);
                if (fit.width > 0 && fit.height > 0) {
                    img.setAttribute('width', fit.width);
                    img.setAttribute('height', fit.height);
                    img.style.width = fit.width + 'px';
                    img.style.height = fit.height + 'px';
                }

                if (display) {
                    // Công thức khối: bỏ .katex-display rồi canh giữa dòng chứa nó.
                    const wrapper = el.parentElement;
                    wrapper.replaceWith(img);
                    const block = img.parentElement;
                    if (block && /^(P|DIV)$/.test(block.tagName) && block.childNodes.length === 1) {
                        block.style.textAlign = 'center';
                    } else {
                        const d = document.createElement('div');
                        d.style.textAlign = 'center';
                        img.replaceWith(d);
                        d.appendChild(img);
                    }
                } else {
                    // Công thức inline: hạ ảnh xuống đúng phần descent để baseline công thức trùng baseline chữ.
                    const shift = height > 0 ? descent * fit.height / height : 0;
                    if (shift > 0.5) img.style.verticalAlign = '-' + shift.toFixed(1) + 'px';
                    el.replaceWith(img);
                }
            } catch (e) {
                console.warn('Could not convert the formula to an image, falling back to MathML:', i, e);
            }
        }
    }
    convertKatexForDoc(cloneRoot);
}

// Word/LibreOffice biến MỌI id thành "bookmark" (ngoặc xám ở đầu đề mục). assignHeadingIds() chỉ để neo
// trong app, nên khi xuất DOC gỡ id của tiêu đề không có liên kết neo (#...) nào trỏ tới.
function stripUnusedHeadingIds(container) {
    const linked = new Set();
    container.querySelectorAll('a[href^="#"]').forEach((a) => {
        const raw = a.getAttribute('href').slice(1);
        linked.add(raw);
        try { linked.add(decodeURIComponent(raw)); } catch (e) { /* href hỏng: giữ nguyên bản thô */ }
    });
    container.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
        if (h.id && !linked.has(h.id)) h.removeAttribute('id');
    });
}

// Màu viền/tiêu đề của từng loại GFM Alert khi xuất DOC (Word không hiểu CSS variable).
const DOC_ALERT_COLORS = {
    note: '#0969da',
    tip: '#1a7f37',
    important: '#8250df',
    warning: '#9a6700',
    caution: '#d1242f'
};

// Word gộp các đoạn liền kề có cùng viền thành MỘT khối viền, nên nhiều <blockquote> / GFM Alert đứng cạnh
// nhau bị dính thành một thanh dọc liên tục. Chuyển mỗi blockquote thành bảng 1 ô (viền trái làm "thanh quote",
// có padding + nền thật) và chèn một đoạn đệm nhỏ phía sau: Word cũng gộp cả hai bảng liền kề, nên đoạn đệm
// là thứ duy nhất tách chúng ra. Duyệt ngược để blockquote lồng nhau được xử lý từ trong ra ngoài.
function convertQuotesForDoc(container) {
    const quotes = Array.from(container.querySelectorAll('blockquote')).reverse();
    quotes.forEach((bq) => {
        const alertClass = Array.from(bq.classList)
            .find((c) => /^markdown-alert-(note|tip|important|warning|caution)$/.test(c));
        const type = alertClass ? alertClass.replace('markdown-alert-', '') : '';
        const borderColor = type ? DOC_ALERT_COLORS[type] : '#d0d7de';
        const textColor = type ? '#24292f' : '#57606a';
        const background = type ? 'background:#f6f8fa;' : '';

        const table = document.createElement('table');
        table.setAttribute('width', '100%');
        table.setAttribute('border', '0');
        table.setAttribute('cellspacing', '0');
        table.setAttribute('cellpadding', '0');
        table.style.cssText = 'border-collapse:collapse;border:none;width:100%;margin:0;';

        const td = document.createElement('td');
        // Bảng khung này không có class doc-data-table nên không dính viền ô của DOC_STYLES; thêm mso-border-*-alt
        // để Word chắc chắn chỉ vẽ viền trái.
        // setAttribute (không dùng .style.cssText): CSSOM của trình duyệt sẽ loại bỏ thuộc tính mso-* không nhận ra.
        td.setAttribute('style', 'border-top:none;border-right:none;border-bottom:none;'
            + 'mso-border-top-alt:none;mso-border-right-alt:none;mso-border-bottom-alt:none;'
            + 'border-left:4pt solid ' + borderColor + ';'
            + 'padding:6pt 12pt;color:' + textColor + ';' + background);

        while (bq.firstChild) td.appendChild(bq.firstChild);

        // Bỏ margin thừa ở đầu/cuối ô (padding của ô đã lo khoảng cách).
        const firstEl = td.firstElementChild;
        const lastEl = td.lastElementChild;
        if (firstEl && firstEl.tagName === 'P') firstEl.style.marginTop = '0';
        if (lastEl && lastEl.tagName === 'P') lastEl.style.marginBottom = '0';

        // Tiêu đề alert: tô đúng màu loại alert (class CSS của app không có trong file DOC).
        const title = td.querySelector('.markdown-alert-title');
        if (title && type) {
            title.style.color = borderColor;
            title.style.fontWeight = 'bold';
        }

        const tr = document.createElement('tr');
        tr.appendChild(td);
        const tbody = document.createElement('tbody');
        tbody.appendChild(tr);
        table.appendChild(tbody);

        const spacer = document.createElement('p');
        spacer.setAttribute('style', 'margin:0;font-size:6pt;line-height:6pt;mso-line-height-rule:exactly;');
        spacer.innerHTML = '&nbsp;';

        bq.replaceWith(table, spacer);
    });
}

// Ảnh với URL remote giữ nguyên <img src> (Word tự tải).
async function exportDoc() {
    const text = markdownInput.value;
    if (!text.trim()) {
        showToast("Content is empty, nothing to export.");
        return;
    }
    showToast("Generating DOC file...");

    renderMarkdown();
    await whenMermaidIdle(8000);
    const clone = previewOutput.cloneNode(true);

    stripUnusedHeadingIds(clone);

    clone.querySelectorAll('svg').forEach((el) => el.remove());
    clone.querySelectorAll('input[type="checkbox"]').forEach((el) => {
        el.replaceWith(document.createTextNode(el.checked ? '\u2611 ' : '\u2610 '));
    });

    // Clone chưa vào DOM nên đo kích thước từ ảnh gốc trong Preview theo chỉ số.
    const origImgs = previewOutput.querySelectorAll('img');
    const cloneImgs = clone.querySelectorAll('img');
    for (let idx = 0; idx < cloneImgs.length; idx++) {
        const img = cloneImgs[idx];
        const orig = origImgs[idx];
        if (!orig) continue;
        await waitForImageLoad(orig);
        const size = getDocImageSize(orig);
        const fit = fitDocImageSize(size.width, size.height);
        if (!(fit.width > 0 && fit.height > 0)) continue;

        const src = orig.currentSrc || orig.getAttribute('src') || '';
        if (isSvgImageSrc(src)) {
            try {
                img.src = await svgImageToPngDataUrl(src, fit.width, fit.height);
                img.removeAttribute('srcset');
            } catch (e) {
                console.warn('Could not convert the SVG image to PNG, keeping the original URL:', src, e);
            }
        }
        img.setAttribute('width', fit.width);
        img.setAttribute('height', fit.height);
        img.style.width = fit.width + 'px';
        img.style.height = fit.height + 'px';
    }

    // Ánh xạ theo CHÍNH node pre (pre[i] -> svg con) chứ không theo chỉ số trong danh sách svg: nếu có biểu đồ
    // không có <svg> (mermaid lỗi, DOMPurify dọn rỗng, whenMermaidIdle timeout) thì chỉ số lệch và biểu đồ
    // sau đó xuất nhầm ảnh của biểu đồ khác.
    const cloneMers = clone.querySelectorAll('pre.mermaid');
    const origPres = previewOutput.querySelectorAll('pre.mermaid');
    for (let i = 0; i < cloneMers.length; i++) {
        const svg = origPres[i] && origPres[i].querySelector('svg');
        if (!svg) {
            console.warn('Mermaid diagram has no SVG yet, skipping image conversion:', i);
            continue;
        }
        try {
            const { dataUrl, width, height } = await svgToPngDataUrl(svg);
            const img = document.createElement('img');
            img.src = dataUrl;
            img.alt = 'Mermaid diagram';
            // PNG vẽ ở 2x mà Word bỏ qua max-width: luôn gắn kích thước hiển thị tường minh.
            const fit = fitDocImageSize(width, height);
            if (fit.width > 0 && fit.height > 0) {
                img.setAttribute('width', fit.width);
                img.setAttribute('height', fit.height);
                img.style.width = fit.width + 'px';
                img.style.height = 'auto';
            }
            cloneMers[i].replaceWith(img);
        } catch (e) {
            console.warn('Could not convert the Mermaid diagram to an image, keeping the source code:', e);
        }
    }

    // Công thức -> PNG như Mermaid; công thức nào vẽ lỗi sẽ tự rơi về MathML bên trong hàm này.
    await convertKatexToImagesForDoc(previewOutput, clone);

    // Chạy cuối: các bước trên ghép ảnh/biểu đồ/công thức theo chỉ số trong clone, mà việc đổi blockquote
    // thành bảng chỉ dời node chứ không đổi thứ tự tài liệu, nên để sau cùng cho chắc.
    // Đánh dấu bảng dữ liệu thật TRƯỚC khi convertQuotesForDoc() tạo thêm bảng khung quote (không có class này).
    clone.querySelectorAll('table').forEach((t) => t.classList.add('doc-data-table'));
    convertQuotesForDoc(clone);

    const html = buildWordHtml(clone.innerHTML);
    try {
        const saved = await saveTextFile('\ufeff' + html, deriveExportBaseName(text), 'doc', 'application/msword');
        if (saved) showToast("DOC file exported!");
    } catch (err) {
        console.error('DOC export failed:', err);
        showToast("An error occurred while exporting the DOC file.");
    }
}

async function exportPdf() {
    showToast("Preparing the print page / exporting PDF...");
    renderMarkdown();
    try {
        await Promise.all([
            whenMermaidIdle(8000),
            (document.fonts ? document.fonts.ready : Promise.resolve())
        ]);
    } catch (e) {}
    window.print();
}

function closeExportMenu() {
    exportMenu.classList.add('hidden');
    exportWrap.classList.remove('open');
    btnExport.setAttribute('aria-expanded', 'false');
}

// KHÔNG stopPropagation: listener document bên dưới cần thấy click để đóng menu khác (format/view) đang
// mở; stopPropagation ở đây (và ở btnView) làm hai dropdown mở chồng lên nhau.
btnExport.addEventListener('click', () => {
    const isHidden = exportMenu.classList.toggle('hidden');
    exportWrap.classList.toggle('open', !isHidden);
    btnExport.setAttribute('aria-expanded', String(!isHidden));
});

document.addEventListener('click', (e) => {
    if (!exportMenu.classList.contains('hidden') && !exportWrap.contains(e.target)) {
        closeExportMenu();
    }
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeExportMenu();
});

exportMdBtn.addEventListener('click', () => { closeExportMenu(); exportMarkdown(); });
exportHtmlBtn.addEventListener('click', () => { closeExportMenu(); exportHtml(); });
exportDocBtn.addEventListener('click', () => { closeExportMenu(); exportDoc(); });
exportPdfBtn.addEventListener('click', () => { closeExportMenu(); exportPdf(); });

const btnHeading = document.getElementById('btn-heading');
const headingMenu = document.getElementById('heading-menu');
const btnList = document.getElementById('btn-list');
const listMenu = document.getElementById('list-menu');
const btnBold = document.getElementById('btn-bold');
const btnItalic = document.getElementById('btn-italic');
const btnStrike = document.getElementById('btn-strike');
const btnLink = document.getElementById('btn-link');
const btnUndo = document.getElementById('btn-undo');
const btnRedo = document.getElementById('btn-redo');
const btnClear = document.getElementById('btn-clear');
const btnCodeInline = document.getElementById('btn-code-inline');
const btnCodeBlock = document.getElementById('btn-code-block');
const btnHtml = document.getElementById('btn-html');
const htmlMenu = document.getElementById('html-menu');
const btnMathInline = document.getElementById('btn-math-inline');
const btnMathBlock = document.getElementById('btn-math-block');
const btnQuote = document.getElementById('btn-quote');
const btnMermaid = document.getElementById('btn-mermaid');
const btnTable = document.getElementById('btn-table');
const tableMenu = document.getElementById('table-menu');
const linkDialog = document.getElementById('link-dialog');
const linkTextInput = document.getElementById('link-text');
const linkUrlInput = document.getElementById('link-url');
const linkInsertBtn = document.getElementById('link-insert');
const linkCancelBtn = document.getElementById('link-cancel');
const tableDialog = document.getElementById('table-dialog');
const tableColsInput = document.getElementById('table-cols');
const tableRowsInput = document.getElementById('table-rows');
const tableInsertBtn = document.getElementById('table-insert');
const tableCancelBtn = document.getElementById('table-cancel');

function getHeadingLevel(line) {
    // 0-3 khoảng trắng/tab, 1-6 dấu #, rồi khoảng trắng hoặc hết dòng
    const m = line.match(/^[ \t]{0,3}(#{1,6})(?:[ \t]+|$)/);
    return m ? m[1].length : 0;
}

// level = 0 nghĩa là gỡ heading. Trả về { line, delta }, hoặc null nếu không có gì thay đổi.
function setHeadingLevel(line, level) {
    // Như getHeadingLevel nhưng tách riêng phần thụt lề và khoảng trắng sau #
    const m = line.match(/^([ \t]{0,3})(#{1,6})([ \t]+|$)/);
    // Dòng thường: lấy phần thụt lề đầu dòng
    const indent = m ? m[1] : (line.match(/^[ \t]*/) || [''])[0];
    const rest = m ? line.slice(m[0].length) : line.slice(indent.length);
    if (!m && level === 0) return null;
    const newLine = indent + (level > 0 ? '#'.repeat(level) + ' ' : '') + rest;
    if (newLine === line) return null;
    return { line: newLine, delta: newLine.length - line.length };
}

// Trả về { indent, marker, kind, rest } (kind: bullet | numbered | task | quote),
// hoặc null nếu không phải dòng danh sách.
function parseListLine(line) {
    // thụt lề, marker (-, *, +, 1. / 1) hoặc >), khoảng trắng, checkbox tuỳ chọn, phần còn lại
    const m = line.match(/^([ \t]*)([-*+]|\d+[.)]|>)([ \t]+)(\[[ xX]\][ \t]+)?(.*)$/);
    if (!m) return null;
    const [, indent, mark, sp, checkbox, rest] = m;
    // Marker bắt đầu bằng chữ số -> danh sách có thứ tự
    const kind = checkbox ? 'task' : (mark === '>' ? 'quote' : (/^\d/.test(mark) ? 'numbered' : 'bullet'));
    return { indent, marker: mark + sp + (checkbox || ''), kind, rest };
}

// rows = số dòng THÂN bảng (tối thiểu 1, để luôn có ô để gõ). ponytail: header để trống cho người dùng điền;
// nâng cấp sau: điền tên cột từ vùng chọn hiện tại nếu có.
function buildTableMarkdown(rows, cols) {
    const r = Math.max(1, Math.min(99, rows | 0));
    const c = Math.max(1, Math.min(99, cols | 0));
    const out = ['|' + ' Head |'.repeat(c), '|' + ' --- |'.repeat(c)];
    for (let i = 0; i < r; i++) out.push('|' + '  |'.repeat(c));
    return out.join('\n');
}

// ponytail: kiểm tra scheme bằng regex đơn giản, đủ cho anchor/email/relative
function normalizeLinkUrl(raw) {
    const url = String(raw || '').trim();
    if (!url) return '';
    // Đã có scheme (http:, mailto:, ...), anchor # hoặc protocol-relative // thì giữ nguyên
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url) || url.startsWith('#') || url.startsWith('//')) return url;
    return 'https://' + url;
}

function escapeLinkText(text) {
    // Thêm \ trước [ và ]
    return text.replace(/([\[\]])/g, '\\$1');
}

// ponytail: toggle theo cặp thẻ trọn vẹn (như wrapOrToggleFormat với **), không xử lý thẻ lồng nhau;
// nâng cấp sau: parse DOM thật nếu cần.
function wrapHtmlTag(val, selStart, selEnd, tag) {
    const open = '<' + tag + '>';
    const close = '</' + tag + '>';
    const oLen = open.length;
    const cLen = close.length;
    const selected = val.substring(selStart, selEnd);

    if (selected.length >= oLen + cLen && selected.startsWith(open) && selected.endsWith(close)) {
        const unwrapped = selected.substring(oLen, selected.length - cLen);
        return { text: val.substring(0, selStart) + unwrapped + val.substring(selEnd), selStart, selEnd: selStart + unwrapped.length };
    }
    if (selStart >= oLen && selEnd + cLen <= val.length
        && val.substring(selStart - oLen, selStart) === open
        && val.substring(selEnd, selEnd + cLen) === close) {
        return {
            text: val.substring(0, selStart - oLen) + selected + val.substring(selEnd + cLen),
            selStart: selStart - oLen,
            selEnd: selEnd - oLen
        };
    }
    if (selStart === selEnd) {
        const placeholder = 'text';
        const insert = open + placeholder + close;
        return { text: val.substring(0, selStart) + insert + val.substring(selEnd), selStart: selStart + oLen, selEnd: selStart + oLen + placeholder.length };
    }
    return {
        text: val.substring(0, selStart) + open + selected + close + val.substring(selEnd),
        selStart: selStart + oLen,
        selEnd: selEnd + oLen
    };
}

const formatMenus = [
    { btn: btnHeading, wrap: btnHeading.parentElement, menu: headingMenu },
    { btn: btnList, wrap: btnList.parentElement, menu: listMenu },
    { btn: btnTable, wrap: btnTable.parentElement, menu: tableMenu },
    { btn: btnHtml, wrap: btnHtml.parentElement, menu: htmlMenu }
];

function closeFormatMenus() {
    formatMenus.forEach(({ btn, wrap, menu }) => {
        menu.classList.add('hidden');
        wrap.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
    });
}

function toggleFormatMenu(entry) {
    const wasOpen = !entry.menu.classList.contains('hidden');
    closeExportMenu();
    closeFormatMenus();
    if (!wasOpen) {
        entry.menu.classList.remove('hidden');
        entry.wrap.classList.add('open');
        entry.btn.setAttribute('aria-expanded', 'true');
    }
}

function anyFormatMenuOpen() {
    return formatMenus.some(({ menu }) => !menu.classList.contains('hidden'));
}

btnBold.addEventListener('click', () => { wrapOrToggleFormat('**'); markdownInput.focus(); });
btnItalic.addEventListener('click', () => { wrapOrToggleFormat('*'); markdownInput.focus(); });
btnStrike.addEventListener('click', () => { wrapOrToggleFormat('~~'); markdownInput.focus(); });

btnCodeInline.addEventListener('click', () => { wrapOrToggleFormat('`', 'code'); markdownInput.focus(); });
btnMathInline.addEventListener('click', () => { wrapOrToggleFormat('$', 'E = mc^2'); markdownInput.focus(); });

btnHtml.addEventListener('click', () => toggleFormatMenu(formatMenus[3]));

htmlMenu.querySelectorAll('.format-item').forEach((item) => {
    item.addEventListener('click', () => {
        closeFormatMenus();
        markdownInput.focus();
        const r = wrapHtmlTag(markdownInput.value, markdownInput.selectionStart, markdownInput.selectionEnd, item.dataset.html);
        if (r) applyEditorChange(r.text, r.selStart, r.selEnd);
    });
});

btnCodeBlock.addEventListener('click', () => { insertBlockFence('code'); markdownInput.focus(); });
btnMathBlock.addEventListener('click', () => { insertBlockFence('math'); markdownInput.focus(); });
btnMermaid.addEventListener('click', () => { insertBlockFence('mermaid'); markdownInput.focus(); });

btnQuote.addEventListener('click', () => { applyListStyle('quote'); markdownInput.focus(); });

btnUndo.addEventListener('click', () => { editorHistory.undo(markdownInput); markdownInput.focus(); });
btnRedo.addEventListener('click', () => { editorHistory.redo(markdownInput); markdownInput.focus(); });

btnClear.addEventListener('click', () => {
    if (!markdownInput.value) {
        markdownInput.focus();
        return;
    }
    applyEditorChange('', 0, 0);
    saveContentToStorage();
    showToast('Editor cleared. Press Ctrl+Z to undo.');
});

btnHeading.addEventListener('click', () => toggleFormatMenu(formatMenus[0]));

headingMenu.querySelectorAll('.format-item').forEach((item) => {
    item.addEventListener('click', () => {
        closeFormatMenus();
        markdownInput.focus();
        applyHeadingLevel(parseInt(item.dataset.heading, 10) || 0);
    });
});

btnList.addEventListener('click', () => toggleFormatMenu(formatMenus[1]));

listMenu.querySelectorAll('.format-item').forEach((item) => {
    item.addEventListener('click', () => {
        closeFormatMenus();
        markdownInput.focus();
        applyListStyle(item.dataset.list);
    });
});

btnTable.addEventListener('click', () => toggleFormatMenu(formatMenus[2]));

(function buildTableGrid() {
    const grid = tableMenu.querySelector('.table-grid');
    for (let i = 0; i < 24; i++) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'table-cell';
        const cols = (i % 5) + 1;
        const rows = Math.floor(i / 5) + 1;
        cell.title = 'Insert table ' + cols + ' × ' + rows;
        cell.setAttribute('aria-label', 'Insert table ' + cols + 'x' + rows);
        cell.addEventListener('mouseenter', () => highlightTableCells(grid, i + 1));
        cell.addEventListener('click', () => {
            closeFormatMenus();
            markdownInput.focus();
            insertTableBlock(cols, rows);
        });
        grid.appendChild(cell);
    }
    const customCell = document.createElement('button');
    customCell.type = 'button';
    customCell.className = 'table-cell custom';
    customCell.title = 'Custom size…';
    customCell.setAttribute('aria-label', 'Custom table size');
    customCell.addEventListener('mouseenter', () => highlightTableCells(grid, null));
    customCell.addEventListener('click', () => {
        closeFormatMenus();
        openTableDialog();
    });
    grid.appendChild(customCell);
    tableMenu.addEventListener('mouseleave', () => highlightTableCells(grid, null));
})();

tableMenu.querySelector('[data-table="custom"]').addEventListener('click', () => {
    closeFormatMenus();
    openTableDialog();
});

function highlightTableCells(grid, count) {
    for (let i = 0; i < grid.children.length; i++) {
        grid.children[i].classList.toggle('on', count !== null && i < count);
    }
}

function applyHeadingLevel(level) {
    const val = markdownInput.value;
    const selStart = markdownInput.selectionStart;
    const selEnd = markdownInput.selectionEnd;
    const lineStart = val.lastIndexOf('\n', selStart - 1) + 1;
    let lineEnd = val.indexOf('\n', selEnd);
    if (lineEnd === -1) lineEnd = val.length;
    const original = val.substring(lineStart, lineEnd);
    const lines = original.split('\n');

    const allSame = lines.every((line) => getHeadingLevel(line) === level);
    const target = allSame ? 0 : level;
    let delta = 0;
    const newLines = lines.map((line) => {
        const res = setHeadingLevel(line, target);
        if (!res) return line;
        delta += res.delta;
        return res.line;
    });
    const replacedText = newLines.join('\n');
    // So sánh TEXT chứ không so tổng delta: delta có dấu nên các dòng cộng/bớt cùng số ký tự triệt tiêu nhau
    // (vd ['### a','bbbb'] + H1: -2 +2 = 0 nhưng vẫn phải đổi).
    if (replacedText === original) return;

    const newText = val.substring(0, lineStart) + replacedText + val.substring(lineEnd);
    applyEditorChange(newText, lineStart, Math.max(lineStart, selEnd + delta));
}

function applyListStyle(style) {
    const val = markdownInput.value;
    const selStart = markdownInput.selectionStart;
    const selEnd = markdownInput.selectionEnd;
    const lineStart = val.lastIndexOf('\n', selStart - 1) + 1;
    let lineEnd = val.indexOf('\n', selEnd);
    if (lineEnd === -1) lineEnd = val.length;
    const original = val.substring(lineStart, lineEnd);
    const lines = original.split('\n');

    let delta = 0;
    let num = 0;
    const newLines = lines.map((line, i) => {
        const parsed = parseListLine(line);
        // Dòng thường: lấy phần thụt lề đầu dòng
        const indent = parsed ? parsed.indent : (line.match(/^[ \t]*/) || [''])[0];
        const rest = parsed ? parsed.rest : line.slice(indent.length);

        if (!parsed && rest.trim() === '' && lines.length > 1) return line;

        if (parsed && parsed.kind === style && (lines.length === 1 || parsed.rest.trim() !== '')) {
            const newLine = indent + rest;
            delta += newLine.length - line.length;
            return newLine;
        }

        let marker;
        if (style === 'numbered') {
            num++;
            marker = num + '. ';
        } else if (style === 'task') {
            marker = '- [ ] ';
        } else {
            marker = '- ';
        }
        const newLine = indent + (style === 'quote' ? '> ' : marker) + rest;
        delta += newLine.length - line.length;
        return newLine;
    });
    const replacedText = newLines.join('\n');
    // So sánh TEXT chứ không so tổng delta (xem lý do ở applyHeadingLevel).
    if (replacedText === original) return;

    // ponytail: đánh số liên tục trên cả vùng chọn kể cả khi giữa có dòng trống;
    // nâng cấp sau: restart về 1 khi gặp đoạn văn mới.
    const newText = val.substring(0, lineStart) + replacedText + val.substring(lineEnd);

    // Giữ vùng bôi đen: marker thêm/xoá ở ĐẦU dòng nên selection mới tính bằng cách dịch theo delta độ dài
    // của từng dòng (cùng cách handleEditorTab).
    const firstLineDelta = newLines[0].length - lines[0].length;
    const newSelStart = selStart > lineStart
        ? Math.max(lineStart, selStart + firstLineDelta)
        : lineStart;
    const newSelEnd = Math.max(newSelStart, selEnd + delta);

    applyEditorChange(newText, newSelStart, newSelEnd);
}

let dialogReturnFocus = null;

function openDialog(overlay, focusTarget) {
    dialogReturnFocus = document.activeElement;
    overlay.classList.remove('hidden');
    focusTarget.focus();
    if (focusTarget.select) focusTarget.select();
}

function closeDialogs() {
    linkDialog.classList.add('hidden');
    tableDialog.classList.add('hidden');
    linkTextInput.value = '';
    linkUrlInput.value = '';
    linkInsertBtn.disabled = true;
    if (dialogReturnFocus && document.contains(dialogReturnFocus)) dialogReturnFocus.focus();
    dialogReturnFocus = null;
}

function openLinkDialog() {
    const selStart = markdownInput.selectionStart;
    const selEnd = markdownInput.selectionEnd;
    const selected = selStart !== selEnd ? markdownInput.value.substring(selStart, selEnd) : '';
    linkTextInput.value = '';
    linkUrlInput.value = '';
    linkInsertBtn.disabled = true;
    if (selected) linkTextInput.value = selected;
    openDialog(linkDialog, selected ? linkUrlInput : linkTextInput);
}

function openTableDialog() {
    openDialog(tableDialog, tableColsInput);
}

function insertLinkFromDialog() {
    const url = normalizeLinkUrl(linkUrlInput.value);
    if (!url) return;
    const text = linkTextInput.value.trim();
    const val = markdownInput.value;
    const selStart = markdownInput.selectionStart;
    const selEnd = markdownInput.selectionEnd;
    const label = text || (selStart !== selEnd ? val.substring(selStart, selEnd) : url);
    // URL chứa khoảng trắng phải bọc trong < > theo cú pháp GFM
    const urlPart = /\s/.test(url) ? '<' + url + '>' : url;
    const insert = '[' + escapeLinkText(label) + '](' + urlPart + ')';
    applyEditorChange(val.substring(0, selStart) + insert + val.substring(selEnd), selStart + insert.length, selStart + insert.length);
    closeDialogs();
    markdownInput.focus();
}

function insertTableFromDialog() {
    const cols = Math.max(1, Math.min(99, parseInt(tableColsInput.value, 10) || 3));
    const rows = Math.max(1, Math.min(99, parseInt(tableRowsInput.value, 10) || 3));
    closeDialogs();
    markdownInput.focus();
    insertTableBlock(cols, rows);
}

function insertTableBlock(cols, rows) {
    const val = markdownInput.value;
    const selStart = markdownInput.selectionStart;
    const selEnd = markdownInput.selectionEnd;
    const table = buildTableMarkdown(rows, cols);
    const needTop = selStart > 0 && val[selStart - 1] !== '\n';
    const needBottom = selEnd < val.length && val[selEnd] !== '\n';
    const insert = (needTop ? '\n' : '') + table + (needBottom ? '\n' : '');
    const caret = selStart + insert.length;
    applyEditorChange(val.substring(0, selStart) + insert + val.substring(selEnd), caret, caret);
}

function buildBlockFence(kind, body) {
    // Chỉ thay placeholder khi body rỗng/toàn khoảng trắng; giữ nguyên nội dung (kể cả thụt lề) vì vùng chọn
    // đưa vào code block đã được indent sẵn.
    const hasBody = body != null && String(body).trim() !== '';
    if (kind === 'math') {
        return '$$\n' + (hasBody ? body : 'f(x) = \\int_{-\\infty}^{\\infty} e^{-x^2} dx') + '\n$$';
    }
    const lang = kind === 'mermaid' ? 'mermaid' : 'js';
    const fallback = kind === 'mermaid' ? 'graph TD\n    A[Start] --> B[End]' : '// code here';
    return '```' + lang + '\n' + (hasBody ? body : fallback) + '\n```';
}

// Có vùng chọn: nội dung khối là vùng chọn (mỗi dòng code lùi 4 space đúng cú pháp fence); không có:
// chèn placeholder và đặt caret vào dòng nội dung.
function insertBlockFence(kind) {
    const val = markdownInput.value;
    const selStart = markdownInput.selectionStart;
    const selEnd = markdownInput.selectionEnd;
    const selected = selStart !== selEnd ? val.substring(selStart, selEnd) : '';
    const hasBody = selected.trim() !== '';
    const block = buildBlockFence(kind, hasBody
        ? (kind === 'code' ? selected.split('\n').map((l) => (l.trim() ? '    ' + l : l)).join('\n') : selected)
        : '');

    const needTop = selStart > 0 && val[selStart - 1] !== '\n';
    const needBottom = selEnd < val.length && val[selEnd] !== '\n';
    const insert = (needTop ? '\n' : '') + block + (needBottom ? '\n' : '');
    const blockStart = selStart + (needTop ? 1 : 0);
    const caret = hasBody ? selStart + insert.length : blockStart + (kind === 'math' ? 3 : langPrefixLen(kind));
    applyEditorChange(val.substring(0, selStart) + insert + val.substring(selEnd), caret, caret);
}
// Độ dài của "```js\n" hoặc "```mermaid\n" dùng để tính vị trí caret
function langPrefixLen(kind) {
    return kind === 'mermaid' ? '```mermaid\n'.length : '```js\n'.length;
}

btnLink.addEventListener('click', openLinkDialog);

linkUrlInput.addEventListener('input', () => {
    linkInsertBtn.disabled = linkUrlInput.value.trim() === '';
});

linkInsertBtn.addEventListener('click', insertLinkFromDialog);
linkCancelBtn.addEventListener('click', closeDialogs);
tableInsertBtn.addEventListener('click', insertTableFromDialog);
tableCancelBtn.addEventListener('click', closeDialogs);

[linkDialog, tableDialog].forEach((overlay) => {
    overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) closeDialogs();
    });
});

// Enter = nút chính, Esc = đóng, Tab giữ vòng focus; chặn mọi phím khác lọt xuống editor bên dưới.
[linkDialog, tableDialog].forEach((overlay) => {
    overlay.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
            e.preventDefault();
            const primary = overlay.querySelector('.dialog-btn.primary');
            if (primary && !primary.disabled) primary.click();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeDialogs();
        } else if (e.key === 'Tab') {
            e.preventDefault();
            const focusables = Array.from(overlay.querySelectorAll('input, button'));
            const idx = focusables.indexOf(document.activeElement);
            const next = e.shiftKey
                ? focusables[(idx - 1 + focusables.length) % focusables.length]
                : focusables[(idx + 1) % focusables.length];
            if (next) next.focus();
        }
    });
});

document.addEventListener('click', (e) => {
    if (anyFormatMenuOpen() && !e.target.closest('.format-wrap')) closeFormatMenus();
});
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (anyFormatMenuOpen()) {
        closeFormatMenus();
    } else if (!linkDialog.classList.contains('hidden') || !tableDialog.classList.contains('hidden')) {
        closeDialogs();
    }
});

const IMPORTABLE_EXTS = ['md', 'markdown', 'mdown', 'mkd', 'txt'];
function isImportableFile(file) {
    const name = String(file && file.name || '').toLowerCase();
    const ext = name.includes('.') ? name.split('.').pop() : '';
    if (IMPORTABLE_EXTS.includes(ext)) return true;
    if (ext !== '') return false; // known non-markdown extension (even with empty MIME)
    const type = file ? (file.type || '') : '';
    return type === '' || type.startsWith('text/');
}
btnImport.addEventListener('click', () => importFileInput.click());

importFileInput.addEventListener('change', () => {
    const file = importFileInput.files[0];
    importFileInput.value = ''; // cho phép chọn lại cùng một file ở lần kế tiếp
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
        showToast("File is too large (5MB max).");
        return;
    }

    if (!isImportableFile(file)) {
        showToast('Only Markdown files can be imported (.md, .markdown, .txt).');
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        const text = String(reader.result);
        if (!text.trim()) {
            showToast("File is empty or its content could not be read.");
            return;
        }
        if (markdownInput.value.trim() && !confirm("Importing a file will overwrite the current content. Continue?")) {
            return;
        }
        applyContent(text);
        saveContentToStorage();
        showToast(`Imported "${file.name}" into the editor!`);
    };
    reader.onerror = () => showToast("An error occurred while reading the file.");
    reader.readAsText(file, 'utf-8');
});

function runSelfCheck() {
    const results = [];
    const assert = (name, cond) => results.push(`${cond ? 'PASS' : 'FAIL'} - ${name}`);

    assert('filename từ heading có dấu', deriveExportBaseName('# Trình soạn thảo Markdown Live\n\nnội dung') === 'trinh-soan-thao-markdown-live');
    assert('filename bỏ ký tự đặc biệt', deriveExportBaseName('# Tiêu đề (v1.2)!') === 'tieu-de-v12');
    assert('filename fallback khi không có heading', deriveExportBaseName('không có heading') === 'document');

    assert('split clamp dưới ngưỡng', computeSplitPercent(-50, 1000) === SPLIT_MIN_PERCENT);
    assert('split clamp trên ngưỡng', computeSplitPercent(9999, 1000) === SPLIT_MAX_PERCENT);
    assert('split giữa vùng', computeSplitPercent(500, 1000) === 50);
    assert('split workspace rỗng -> 50', computeSplitPercent(10, 0) === 50);
    assert('kéo sát trái -> preview', computeViewModeFromPercent(1) === 'preview');
    assert('kéo sát phải -> editor', computeViewModeFromPercent(99) === 'editor');
    assert('kéo giữa -> split', computeViewModeFromPercent(50) === 'split');
    assert('drag dọc giữa -> 50', computeSplitPercent(500, 1000) === 50);
    assert('drag dọc clamp dưới', computeSplitPercent(-50, 1000) === SPLIT_MIN_PERCENT);
    assert('drag dọc clamp trên', computeSplitPercent(9999, 1000) === SPLIT_MAX_PERCENT);

    assert('safe url allows https', isSafeExternalUrl('https://example.com/a?b=1') === true);
    assert('safe url allows mailto', isSafeExternalUrl('mailto:a@b.com') === true);
    assert('safe url chặn ftp (ACL opener không nhận)', isSafeExternalUrl('ftp://host/f.md') === false);
    assert('safe url blocks javascript', isSafeExternalUrl('javascript:alert(1)') === false);
    assert('safe url blocks padded data', isSafeExternalUrl('  DATA:text/html,<h1>x</h1>') === false);
    assert('safe url blocks relative', isSafeExternalUrl('/local/path') === false);
    if (typeof DOMPurify !== 'undefined') {
        const probe = DOMPurify.sanitize(
            '<svg><foreignObject><div>probe-label</div></foreignObject></svg>',
            MERMAID_SANITIZE_CONFIG
        );
        assert('sanitize keeps mermaid labels', probe.includes('probe-label'));
    }
    assert('import gate allows md', isImportableFile({ name: 'a.md', type: '' }) === true);
    assert('import gate allows mdown', isImportableFile({ name: 'a.mdown', type: '' }) === true);
    assert('import gate allows mkd', isImportableFile({ name: 'a.mkd', type: '' }) === true);
    assert('import gate allows extensionless', isImportableFile({ name: 'README', type: '' }) === true);
    assert('import gate rejects exe', isImportableFile({ name: 'a.exe', type: '' }) === false);
    (function () {
        const host = document.createElement('div');
        host.innerHTML = '<blockquote><p>a</p></blockquote><blockquote class="markdown-alert markdown-alert-tip"><p class="markdown-alert-title">Tip</p><p>b</p></blockquote>';
        convertQuotesForDoc(host);
        assert('doc quote: không còn blockquote', !host.querySelector('blockquote'));
        assert('doc quote: mỗi quote thành 1 bảng', host.querySelectorAll('table').length === 2);
        assert('doc quote: có đoạn đệm giữa 2 bảng', host.children[0].tagName === 'TABLE' && host.children[1].tagName === 'P' && host.children[2].tagName === 'TABLE');
        assert('doc quote: alert dùng màu viền theo loại', host.querySelectorAll('td')[1].style.cssText.includes('26, 127, 55') || host.querySelectorAll('td')[1].style.cssText.includes('#1a7f37'));
    })();
    const wordHtml = buildWordHtml('<p>x</p>');
    assert('word html có meta UTF-8', wordHtml.includes('charset="UTF-8"'));
    assert('word html có namespace Office', wordHtml.includes('urn:schemas-microsoft-com:office:word'));
    assert('word html giữ body', wordHtml.includes('<p>x</p>'));
    const fitWide = fitDocImageSize(1200, 600);
    assert('doc cap thu ảnh rộng về 650 giữ tỉ lệ', fitWide.width === 650 && fitWide.height === 325);
    const fitSmall = fitDocImageSize(400, 200);
    assert('doc cap giữ nguyên ảnh nhỏ', fitSmall.width === 400 && fitSmall.height === 200);
    const fitTall = fitDocImageSize(500, 1800);
    assert('doc cap thu ảnh cao về 900 giữ tỉ lệ', fitTall.width === 250 && fitTall.height === 900);
    assert('doc cap bỏ qua kích thước lạ', fitDocImageSize(0, 0).width === 0);
    assert('doc nhận badge shields.io là SVG', isSvgImageSrc('https://img.shields.io/badge/Tauri-v2.0-24C8DB') === true);
    assert('doc nhận đuôi .svg là SVG', isSvgImageSrc('https://example.com/a.svg?x=1') === true);
    assert('doc không coi png là SVG', isSvgImageSrc('https://example.com/a.png') === false);

    const standalone = buildStandaloneHtml('<p>x</p>', 'Tiêu đề <đẹp>');
    assert('html standalone có doctype', standalone.startsWith('<!DOCTYPE html>'));
    assert('html standalone có meta UTF-8', standalone.includes('charset="UTF-8"'));
    assert('html standalone giữ body', standalone.includes('<p>x</p>'));
    assert('html standalone escape title', standalone.includes('<title>Tiêu đề &lt;đẹp&gt;</title>'));
    assert('html standalone title fallback', buildStandaloneHtml('<p>x</p>', '').includes('<title>Document</title>'));
    assert('title từ heading cấp 1', deriveDocumentTitle('# Báo cáo tháng 9\nnội dung') === 'Báo cáo tháng 9');
    assert('title fallback khi không có heading', deriveDocumentTitle('không có heading') === 'Document');

    assert('heading nhận diện H2 có thụt lề', getHeadingLevel('  ## Tiêu đề') === 2);
    assert('heading nhận diện dòng thường', getHeadingLevel('nội dung') === 0);
    assert('heading nhận diện # không nội dung', getHeadingLevel('#') === 1);
    assert('heading từ chối #không-cách', getHeadingLevel('#hashtag') === 0);
    assert('heading từ chối 7 dấu #', getHeadingLevel('####### bảy') === 0);
    assert('heading đổi H1 thành H3', setHeadingLevel('# Tiêu đề', 3).line === '### Tiêu đề');
    assert('heading gỡ prefix khi level 0', setHeadingLevel('## Tiêu đề', 0).line === 'Tiêu đề');
    assert('heading giữ nguyên thụt lề', setHeadingLevel('  # a', 2).line === '  ## a');
    assert('heading tạo mới trên dòng thường', setHeadingLevel('văn bản', 2).line === '## văn bản');
    assert('heading dòng thường + gỡ là no-op', setHeadingLevel('văn bản', 0) === null);

    assert('html bọc vùng chọn', wrapHtmlTag('ab', 0, 2, 'sup').text === '<sup>ab</sup>');
    assert('html bọc giữ vùng chọn', (() => { const r = wrapHtmlTag('ab', 0, 2, 'sub'); return r.selStart === 5 && r.selEnd === 7; })());
    assert('html placeholder khi không chọn', (() => { const r = wrapHtmlTag('', 0, 0, 'kbd'); return r.text === '<kbd>text</kbd>' && r.selStart === 5 && r.selEnd === 9; })());
    assert('html gỡ thẻ khi bọc trọn cặp', wrapHtmlTag('<sup>ab</sup>', 0, 13, 'sup').text === 'ab');
    assert('html gỡ thẻ nằm ngoài vùng chọn', (() => { const r = wrapHtmlTag('<mark>ab</mark>', 6, 8, 'mark'); return r.text === 'ab' && r.selStart === 0 && r.selEnd === 2; })());
    assert('html bọc lại sau khi gỡ (toggle về ban đầu)', (() => {
        const a = wrapHtmlTag('ab', 0, 2, 'mark');
        const b = wrapHtmlTag(a.text, a.selStart, a.selEnd, 'mark');
        return b.text === 'ab';
    })());
    assert('heading giữ # trong nội dung', setHeadingLevel('#hashtag', 1).line === '# #hashtag');
    assert('list parse task', parseListLine('- [x] việc').kind === 'task' && parseListLine('- [x] việc').rest === 'việc');
    assert('list parse numbered', parseListLine('2. mục').kind === 'numbered');
    assert('list parse bullet giữ thụt lề', parseListLine('  - a').indent === '  ' && parseListLine('  - a').rest === 'a');
    assert('list từ chối dòng thường', parseListLine('chữ') === null);
    assert('list từ chối dòng trống', parseListLine('') === null);
    assert('list từ chối -5 không cách', parseListLine('-5') === null);
    assert('bảng 2x2 đúng cú pháp', buildTableMarkdown(2, 2) === '| Head | Head |\n| --- | --- |\n|  |  |\n|  |  |');
    assert('bảng 1x1 vẫn có dòng thân để gõ', buildTableMarkdown(1, 1) === '| Head |\n| --- |\n|  |');
    assert('bảng kẹp giới hạn 1..99', buildTableMarkdown(5, 0) === '| Head |\n| --- |\n|  |\n|  |\n|  |\n|  |\n|  |');
    assert('url thêm https khi trần', normalizeLinkUrl('example.com') === 'https://example.com');
    assert('url giữ scheme có sẵn', normalizeLinkUrl('mailto:a@b.com') === 'mailto:a@b.com');
    assert('url giữ anchor nội bộ', normalizeLinkUrl('#muc-luc') === '#muc-luc');
    assert('url giữ protocol-relative', normalizeLinkUrl('//cdn.example.com/x') === '//cdn.example.com/x');
    assert('url rỗng trả về rỗng', normalizeLinkUrl('   ') === '');
    assert('escape nhãn link', escapeLinkText('a[b]c') === 'a\\[b\\]c');
    assert('quote parse dòng >', parseListLine('> trích dẫn').kind === 'quote' && parseListLine('> trích dẫn').rest === 'trích dẫn');
    assert('quote parse giữ thụt lề', parseListLine('  > a').indent === '  ');
    assert('quote từ chối >không-cách', parseListLine('>không-cách') === null);
    assert('fence code mặc định', buildBlockFence('code', '') === '```js\n// code here\n```');
    assert('fence math mặc định', buildBlockFence('math', '') === '$$\nf(x) = \\int_{-\\infty}^{\\infty} e^{-x^2} dx\n$$');
    assert('fence mermaid mặc định', buildBlockFence('mermaid', '') === '```mermaid\ngraph TD\n    A[Start] --> B[End]\n```');
    assert('fence giữ nội dung có sẵn', buildBlockFence('code', 'a\nb') === '```js\na\nb\n```');

    (function () {
        const saved = markdownInput.value;
        const sel = [markdownInput.selectionStart, markdownInput.selectionEnd];
        const run = (text, fn) => {
            markdownInput.value = text;
            markdownInput.setSelectionRange(0, text.length);
            fn();
            return markdownInput.value;
        };
        assert('heading delta 0 vẫn áp dụng', run('### a\nbbbb', () => applyHeadingLevel(1)) === '# a\n# bbbb');
        assert('bullet delta 0 vẫn áp dụng', run('- aaa\nbbb', () => applyListStyle('bullet')) === 'aaa\n- bbb');
        assert('numbered delta 0 vẫn áp dụng', run('1. a\nbbb', () => applyListStyle('numbered')) === 'a\n1. bbb');
        markdownInput.value = saved;
        markdownInput.setSelectionRange(sel[0], sel[1]);
    })();

    assert('slug heading bỏ dấu câu', slugifyHeading('Tiêu đề Mục 2!') === 'tiêu-đề-mục-2');
    (function () {
        const host = document.createElement('div');
        host.innerHTML = '<h2>Giới thiệu</h2><h2>Giới thiệu</h2>';
        assignHeadingIds(host);
        assert('tiêu đề có id để neo', host.querySelector('h2').id === 'giới-thiệu');
        assert('tiêu đề trùng -> id duy nhất', host.querySelectorAll('h2')[1].id === 'giới-thiệu-1');
    })();

    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    const fo = document.createElementNS(NS, 'foreignObject');
    fo.setAttribute('x', '10');
    fo.setAttribute('y', '20');
    fo.setAttribute('width', '100');
    fo.setAttribute('height', '40');
    const labelDiv = document.createElement('div');
    labelDiv.textContent = 'Xin chào';
    fo.appendChild(labelDiv);
    svg.appendChild(fo);
    flattenForeignObjects(svg, '#000', '16px');
    const textEl = svg.querySelector('text');
    assert('foreignObject chuyển thành <text>', !!textEl && !svg.querySelector('foreignObject') && svg.textContent.includes('Xin chào'));
    assert('tspan đặt đúng tâm foreignObject', textEl && textEl.querySelector('tspan').getAttribute('x') === '60');

    const faceCss = '@font-face{font-family:KaTeX_Main;font-style:italic;font-weight:700;'
        + 'src:url(fonts/KaTeX_Main-BoldItalic.woff2) format("woff2"),url(fonts/KaTeX_Main-BoldItalic.woff) format("woff")}'
        + '.katex{font:normal 1.21em KaTeX_Main}';
    assert('katex font-face lấy đúng url woff2', parseKatexFontFaces(faceCss).get('KaTeX_Main|italic|700') === 'fonts/KaTeX_Main-BoldItalic.woff2');
    assert('katex font key chuẩn hoá bold/normal/nháy',
        katexFontKey('KaTeX_Main', 'normal', 'bold') === 'KaTeX_Main|normal|700'
        && katexFontKey('"KaTeX_Math"', 'italic', '400') === 'KaTeX_Math|italic|400');

    if (typeof katex !== 'undefined') {
        const inlineHost = document.createElement('div');
        inlineHost.innerHTML = katex.renderToString('E = mc^2', { throwOnError: false, output: 'htmlAndMathml' });
        convertKatexForDoc(inlineHost);
        const inlineMath = inlineHost.querySelector('math');
        assert('katex inline chuyển thành <math> thuần', !!inlineMath && !inlineHost.querySelector('span.katex'));
        assert('katex inline bỏ annotation', !!inlineMath && !inlineMath.querySelector('annotation'));

        const alignedHost = document.createElement('div');
        alignedHost.innerHTML = katex.renderToString(
            String.raw`\begin{aligned} a &= 1 \\ b &= 2 \end{aligned}`,
            { throwOnError: false, displayMode: true, output: 'htmlAndMathml' }
        );
        convertKatexForDoc(alignedHost);
        const alignedMath = alignedHost.querySelector('math');
        assert('katex aligned chuyển thành <math> có mtable', !!alignedMath && !!alignedMath.querySelector('mtable'));
        assert('katex aligned giữ đủ 2 dòng', !!alignedMath && alignedMath.querySelectorAll('mtr').length === 2);

        const strayHost = document.createElement('div');
        strayHost.innerHTML = katex.renderToString('E = mc^2', { throwOnError: false, output: 'mathml' });
        const strayMath = strayHost.querySelector('math');
        strayMath.appendChild(document.createTextNode('E = mc^2'));
        convertKatexForDoc(strayHost);
        const cleanedMath = strayHost.querySelector('math');
        assert('katex dọn text node trần trong <math>', !!cleanedMath && !Array.from(cleanedMath.childNodes).some(n => n.nodeType === 3 && n.textContent.trim()));

        const brokenHost = document.createElement('div');
        brokenHost.innerHTML = '<span class="katex">fallback text</span>';
        convertKatexForDoc(brokenHost);
        assert('katex hỏng fallback thành text', brokenHost.textContent === 'fallback text' && !brokenHost.querySelector('span.katex'));
    }

    const failed = results.filter(r => r.startsWith('FAIL'));
    (failed.length ? console.error : console.log)('Self-check Import/Export:\n' + results.join('\n'));
    if (failed.length) showToast(`Self-check: ${failed.length} test FAIL (see console)`);
    else showToast('Self-check: all PASS');
}
if (location.search.includes('selfcheck')) {
    window.addEventListener('DOMContentLoaded', runSelfCheck);
}

window.addEventListener('DOMContentLoaded', () => {
    try {
        if (typeof mermaid !== 'undefined') {
            mermaid.initialize({ startOnLoad: false, theme: getCurrentTheme() === 'dark' ? 'dark' : 'default' });
        }

        if (typeof markedKatex !== 'undefined' && typeof marked !== 'undefined') {
            const katexExt = typeof markedKatex === 'function' ? markedKatex : markedKatex.markedKatex;
            if (katexExt) {
                marked.use(katexExt({ throwOnError: false }));
            }
        }

        // Guard: lucide không tải được thì bỏ qua vẽ icon, không để exception làm hỏng toàn bộ khởi tạo.
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    } finally {
        // Nạp nội dung CUỐI: renderMarkdown() đầu tiên phải chạy sau khi mermaid initialize và marked gắn
        // KaTeX extension, nếu không công thức ($...$ / $$...$$) lần mở đầu chỉ hiện chữ thô. Đặt trong finally
        // để editor vẫn có nội dung dù khối init bên trên ném lỗi.
        loadInitialContent();
    }
});

// Lưu ngay (không debounce) khi cửa sổ sắp đóng để không mất nội dung gõ cuối cùng.
window.addEventListener('beforeunload', saveContentToStorage);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        saveContentToStorage();
    }
});

window.renderMarkdown = renderMarkdown;