// Default Markdown content shown on load or after pressing Reset
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

// Lấy các phần tử DOM
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
const exportDocBtn = document.getElementById('export-doc');
const exportPdfBtn = document.getElementById('export-pdf');
const btnTheme = document.getElementById('btn-theme');
const toast = document.getElementById('toast');

// Các thẻ <link> có thể hoán đổi phiên bản sáng/tối (được thiết lập ban đầu ở <head>)
const markdownThemeLink = document.getElementById('theme-markdown-css');
const hljsThemeLink = document.getElementById('theme-hljs-css');
const THEME_STORAGE_KEY = 'markdown-live-theme';
// Key lưu nội dung Editor vào bộ nhớ tạm (localStorage) để giữ lại sau khi tắt/mở lại app
const CONTENT_STORAGE_KEY = 'markdown-live-content';

// Khởi tạo trạng thái ứng dụng
let isSyncScrollEnabled = true;
let activeScrollSource = null;
let mermaidTimeout = null;
let mermaidScheduled = false;
let pendingMermaidJobs = 0;
// Cho export PDF/DOC doi bieu do ve xong thay vi doan mo 200ms.
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

// Đếm số thứ tự mỗi lần renderMarkdown() được gọi. Việc vẽ Mermaid là bất đồng bộ
// (setTimeout + Promise), nên nếu người dùng gõ tiếp trong lúc nó đang chạy, một lượt
// render MỚI có thể hoàn tất và khôi phục đúng scrollTop TRƯỚC KHI lượt render CŨ (đã lỗi
// thời) vẽ xong và tự ý ghi đè scrollTop bằng giá trị cũ của nó. renderVersion giúp lượt
// render cũ nhận ra mình đã lỗi thời để bỏ qua việc khôi phục scroll, tránh cộng dồn sai lệch.
let renderVersion = 0;

// Cache kết quả vẽ Mermaid theo đúng nội dung mã nguồn: nếu 1 khối biểu đồ không
// thay đổi giữa 2 lần render, ta dùng lại SVG đã vẽ thay vì bắt mermaid.run() tính lại
// từ đầu (thao tác tốn 50-200ms/biểu đồ). Cache sẽ bị xoá mỗi khi đổi theme vì màu
// sắc SVG đã vẽ gắn liền với theme lúc vẽ.
const mermaidCache = new Map();
// ponytail: gioi han dem theo so muc + tong so ky tu (60 muc SVG lon = bo nho vo han);
// nang cap sau: LRU theo bytes thuc te neu so do cuc lon pho bien.
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
// DOMPurify loai bo <foreignObject> theo mac dinh, nhung nhan cua so do Mermaid
// (htmlLabels) nam trong do -> thieu ADD_TAGS nay chu trong flowchart bien mat.
const MERMAID_SANITIZE_CONFIG = {
    USE_PROFILES: { html: true, svg: true },
    ADD_ATTR: ['target', 'rel'],
    ADD_TAGS: ['foreignObject'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|callto|ftp):|[^a-zA-Z]|[a-zA-Z+.\-]+(?:[^a-zA-Z+.:]|$))/i
};

// ==========================================================================
// CHUYỂN ĐỔI GIAO DIỆN SÁNG / TỐI (Light / Dark Theme)
// ==========================================================================

// Lấy theme hiện tại đang áp dụng trên thẻ <html> (đã được thiết lập sớm ở <head>)
function getCurrentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

// Áp dụng theme: cập nhật thuộc tính data-theme, hoán đổi CSS bên ngoài (markdown/hljs)
// và đồng bộ theme của Mermaid. persist=true khi người dùng chủ động bấm nút chuyển đổi.
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
            // Bỏ qua nếu trình duyệt chặn localStorage (ví dụ chế độ ẩn danh)
        }
    }
}

// Đẩy theme khởi động (đã chọn ở <head>) xuống khung cửa sổ Tauri; bỏ qua khi mở bằng trình duyệt thường.
syncWindowTheme(getCurrentTheme());

// Nút Bật/Tắt giao diện Sáng / Tối
if (btnTheme) {
    btnTheme.addEventListener('click', () => {
        const nextTheme = getCurrentTheme() === 'dark' ? 'light' : 'dark';
        applyTheme(nextTheme, true);
        // Xoá cache Mermaid vì SVG cũ mang màu của theme trước, không dùng lại được
        clearMermaidCache();
        // Vẽ lại Preview để cập nhật màu Highlight.js / Mermaid theo theme mới
        if (typeof renderMarkdown === 'function') renderMarkdown();
        showToast(nextTheme === 'dark' ? "Switched to Dark theme" : "Switched to Light theme");
    });
}

// Tự động chuyển theme theo hệ thống nếu người dùng chưa từng chọn thủ công
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

// ==========================================================================
// TÔ MÀU CÚ PHÁP MARKDOWN TRONG EDITOR (Syntax Highlighting cho khung soạn thảo)
// ==========================================================================

// Bảng màu cho các loại GFM Alert, dùng chung tông màu với phần Preview
const alertHighlightColors = {
    NOTE: 'var(--alert-note-color)',
    TIP: 'var(--alert-tip-color)',
    IMPORTANT: 'var(--alert-important-color)',
    WARNING: 'var(--alert-warning-color)',
    CAUTION: 'var(--alert-caution-color)'
};

// Escape các ký tự HTML đặc biệt để tránh phá vỡ cấu trúc thẻ khi chèn span
function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// Xử lý các cú pháp định dạng nằm trong một dòng (in đậm, in nghiêng, code, liên kết...)
function highlightInline(text) {
    const store = [];
    const protect = (html) => {
        const token = `\u0000T${store.length}\u0000`;
        store.push(html);
        return token;
    };

    // 0. Ký tự thoát (Escape characters): \* \_ \[ \] \$ \~ \# ...
    text = text.replace(/\\(&lt;|&gt;|&amp;|[\\`*_{}\[\]()#+\-.!~$~|^])/g, (m, char) =>
        protect(`<span class="md-escape">\\${char}</span>`));

    // 1. Code inline: `code`
    text = text.replace(/(`+)([^`]+?)\1/g, (m, ticks, content) =>
        protect(`<span class="md-code-inline">${ticks}${content}${ticks}</span>`));

    // 2. Công thức toán dạng khối trên 1 dòng: $$...$$
    text = text.replace(/(\$\$)([^$\n]+?)\1/g, (m, d, c) =>
        protect(`<span class="md-math">${d}${c}${d}</span>`));

    // 3. Công thức toán dạng inline: $...$
    text = text.replace(/(\$)([^$\n]+?)\1/g, (m, d, c) =>
        protect(`<span class="md-math">${d}${c}${d}</span>`));

    // 4. Tham chiếu Footnote: [^id]
    text = text.replace(/(\[\^)([^\]]+?)(\])/g, (m, ob, id, cb) =>
        protect(`<span class="md-footnote-ref"><span class="md-footnote-marker">${ob}</span><span class="md-footnote-id">${id}</span><span class="md-footnote-marker">${cb}</span></span>`));

    // 5. Ảnh: ![alt](url)
    text = text.replace(/(!)(\[)([^\]]*)(\])(\()([^)]*)(\))/g, (m, bang, ob, alt, cb, op, url, cp) =>
        protect(`<span class="md-link-marker">${bang}${ob}</span><span class="md-link-text">${alt}</span><span class="md-link-marker">${cb}${op}</span><span class="md-link-url">${url}</span><span class="md-link-marker">${cp}</span>`));

    // 6. Reference Link usage: [text][id] hoặc [text][]
    text = text.replace(/(\[)([^\]]+?)(\])(\s*)(\[)([^\]]*?)(\])/g, (m, ob1, txt, cb1, sp, ob2, id, cb2) =>
        protect(`<span class="md-link-marker">${ob1}</span><span class="md-link-text">${txt}</span><span class="md-link-marker">${cb1}${sp}${ob2}</span><span class="md-ref-id">${id}</span><span class="md-link-marker">${cb2}</span>`));

    // 7. Liên kết thông thường: [text](url)
    text = text.replace(/(\[)([^\]]*)(\])(\()([^)]*)(\))/g, (m, ob, t, cb, op, url, cp) =>
        protect(`<span class="md-link-marker">${ob}</span><span class="md-link-text">${t}</span><span class="md-link-marker">${cb}${op}</span><span class="md-link-url">${url}</span><span class="md-link-marker">${cp}</span>`));

    // 8. Autolinks dạng ngoặc nhọn: <https://...> hoặc <email@example.com>
    text = text.replace(/(&lt;)(https?:\/\/[^\s&]+|mailto:[^\s&]+|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(&gt;)/gi, (m, ob, link, cb) =>
        protect(`<span class="md-link-marker">${ob}</span><span class="md-autolink">${link}</span><span class="md-link-marker">${cb}</span>`));

    // 9. Autolinks URL trần: https://... hoặc http://...
    text = text.replace(/\b(https?:\/\/[^\s<>()"']+)/gi, (m, url) =>
        protect(`<span class="md-autolink">${url}</span>`));

    // 10. In đậm + in nghiêng: ***text*** hoặc ___text___
    text = text.replace(/(\*\*\*|___)([^*_\n]+?)\1/g, (m, d, c) =>
        protect(`<span class="md-bolditalic">${d}${c}${d}</span>`));

    // Helpers cho emphasis lồng nhau: content cho phép delimiter đơn lẻ bên trong,
    // và content được xử lý italic đệ quy trước khi bọc span ngoài (tránh token che mất inner).
    const underItalicOnce = (s) => s.replace(/\b(_)((?:[^_\n]|_(?!_))+?)\1\b/g, (m2, d2, c2) =>
        protect(`<span class="md-italic">${d2}${c2}${d2}</span>`));
    const starItalicOnce = (s) => s.replace(/(\*)((?:[^*\n]|\*(?!\*))+?)\1/g, (m2, d2, c2) =>
        protect(`<span class="md-italic">${d2}${underItalicOnce(c2)}${d2}</span>`));

    // 11. In đậm: **text** (cho phép * đơn bên trong cho nested italic)
    text = text.replace(/(\*\*)((?:[^*\n]|\*(?!\*))+?)\1/g, (m, d, c) =>
        protect(`<span class="md-bold">${d}${underItalicOnce(starItalicOnce(c))}${d}</span>`));

    // 11b. In đậm: __text__ (cho phép _ đơn bên trong, yêu cầu word boundary)
    text = text.replace(/\b(__)((?:[^_\n]|_(?!_))+?)\1\b/g, (m, d, c) =>
        protect(`<span class="md-bold">${d}${underItalicOnce(starItalicOnce(c))}${d}</span>`));

    // 12. In nghiêng: *text* (cho phép _ bên trong, xử lý đệ quy trước khi bọc)
    text = starItalicOnce(text);

    // 12b. In nghiêng: _text_ (cho phép * bên trong đã xử lý ở rule 12, yêu cầu word boundary)
    text = underItalicOnce(text);

    // 13. Gạch ngang giữa chữ: ~~text~~
    text = text.replace(/(~~)([^~\n]+?)\1/g, (m, d, c) =>
        protect(`<span class="md-strikethrough">${d}${c}${d}</span>`));

    // 14. Keyboard shortcut (kbd): <kbd>Ctrl</kbd>
    text = text.replace(/(&lt;)(kbd&gt;)([^&]+)(&lt;\/)(kbd&gt;)/gi, (m, ob1, tagOpen, content, cb1, tagClose) =>
        protect(`<span class="md-kbd-marker">${ob1}${tagOpen}</span><span class="md-kbd">${content}</span><span class="md-kbd-marker">${cb1}${tagClose}</span>`));

    // 15. Highlighted text (mark): <mark>text</mark>
    text = text.replace(/(&lt;)(mark&gt;)([^&]+)(&lt;\/)(mark&gt;)/gi, (m, ob1, tagOpen, content, cb1, tagClose) =>
        protect(`<span class="md-mark-marker">${ob1}${tagOpen}</span><span class="md-mark">${content}</span><span class="md-mark-marker">${cb1}${tagClose}</span>`));

    // 16. Superscript: <sup>text</sup>
    text = text.replace(/(&lt;)(sup&gt;)([^&]+)(&lt;\/)(sup&gt;)/gi, (m, ob1, tagOpen, content, cb1, tagClose) =>
        protect(`<span class="md-sup-marker">${ob1}${tagOpen}</span><span class="md-sup">${content}</span><span class="md-sup-marker">${cb1}${tagClose}</span>`));

    // 17. Subscript: <sub>text</sub>
    text = text.replace(/(&lt;)(sub&gt;)([^&]+)(&lt;\/)(sub&gt;)/gi, (m, ob1, tagOpen, content, cb1, tagClose) =>
        protect(`<span class="md-sub-marker">${ob1}${tagOpen}</span><span class="md-sub">${content}</span><span class="md-sub-marker">${cb1}${tagClose}</span>`));

    // 18. Details/Accordion block: <details>...</details> and <summary>...</summary>
    text = text.replace(/(&lt;details&gt;)/gi, 
        protect(`<span class="md-details-marker">&lt;details&gt;</span>`));
    text = text.replace(/(&lt;\/details&gt;)/gi, 
        protect(`<span class="md-details-marker">&lt;/details&gt;</span>`));
    text = text.replace(/(&lt;summary&gt;)/gi, 
        protect(`<span class="md-summary-marker">&lt;summary&gt;</span>`));
    text = text.replace(/(&lt;\/summary&gt;)/gi, 
        protect(`<span class="md-summary-marker">&lt;/summary&gt;</span>`));

    // 19. HTML comments trên 1 dòng: <!-- ... -->
    text = text.replace(/(&lt;!--)([\s\S]*?)(--&gt;)/g, (m) =>
        protect(`<span class="md-html-comment">${m}</span>`));

    // 20. Anchor: <a href="...">text</a> (href -> md-link-url, text -> md-link-text)
    text = text.replace(/(&lt;)(a)((?:\s+[a-zA-Z-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))?)*)(&gt;)([\s\S]*?)(&lt;\/)(a)(&gt;)/gi,
        (m, ob, tag, attrs, cb, content, cb2, tag2, cb3) => {
            const hlAttrs = attrs.replace(/(^|\s)(href)(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'<>]+)/i,
                `$1<span class="md-link-marker">$2$3</span><span class="md-link-url">$4</span>`);
            return protect(`<span class="md-link-marker">${ob}${tag}${hlAttrs}${cb}</span><span class="md-link-text">${content}</span><span class="md-link-marker">${cb2}${tag2}${cb3}</span>`);
        });

    // 21. Images: <img src="..." alt="..." ...> (thứ tự thuộc tính bất kỳ)
    text = text.replace(/(&lt;)(img)((?:\s+[a-zA-Z-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))?)*)(\s*\/?)(&gt;)/gi,
        (m, ob, tag, attrs, slash, cb) => {
            let hlAttrs = attrs.replace(/(^|\s)(src)(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'<>]+)/i,
                `$1<span class="md-link-marker">$2$3</span><span class="md-link-url">$4</span>`);
            hlAttrs = hlAttrs.replace(/(^|\s)(alt)(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'<>]+)/i,
                `$1<span class="md-link-marker">$2$3</span><span class="md-link-text">$4</span>`);
            return protect(`<span class="md-html-tag-marker">${ob}${tag}${hlAttrs}${slash}${cb}</span>`);
        });

    // 22. Void tags: <br>, <hr>, <input type="checkbox" ...>
    text = text.replace(/(&lt;)(br|hr|input)((?:\s+[a-zA-Z-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))?)*)(\s*\/?)(&gt;)/gi, (m) =>
        protect(`<span class="md-html-void">${m}</span>`));

    // 23. Paired tags (open/content/close): inline + block containers + raw tables
    text = text.replace(/(&lt;)(div|span|p|table|tr|td|th|thead|tbody|b|strong|i|em|u|code|small)((?:\s+[a-zA-Z-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))?)*)(&gt;)([\s\S]*?)(&lt;\/)(\2)(\s*)(&gt;)/gi,
        (m, ob, tag, attrs, cb, content, cb2, tag2, sp, cb3) =>
            protect(`<span class="md-html-tag-marker">${ob}${tag}${attrs}${cb}</span><span class="md-html-tag-content">${content}</span><span class="md-html-tag-marker">${cb2}${tag2}${sp}${cb3}</span>`));

    // 24. Lone block tags: <div align="center">, </div>, <table>... (không có cặp trên cùng dòng)
    text = text.replace(/(&lt;\/?(?:div|span|p|table|tr|td|th|thead|tbody)(?:\s+[a-zA-Z-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))?)*\s*\/?&gt;)/gi, (m) =>
        protect(`<span class="md-html-tag-marker">${m}</span>`));

    let previous;
    do {
        previous = text;
        text = text.replace(/\u0000T(\d+)\u0000/g, (m, idx) => store[Number(idx)]);
    } while (text !== previous);

    return text;
}

// Xử lý cú pháp ở cấp độ dòng (tiêu đề, trích dẫn, danh sách, gạch ngang, bảng biểu, footnote...)
function highlightMarkdownLine(line) {
    // Đường kẻ ngang (Horizontal Rule): ---, ***, ___
    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
        return `<span class="md-hr">${escapeHtml(line)}</span>`;
    }

    // Chú thích chân trang (Footnote definition): [^1]: Nội dung
    let m = line.match(/^(\s{0,3})(\[\^)([^\]]+)(\]:)(\s*)(.*)$/);
    if (m) {
        const [, indent, ob, fnId, cb, space, content] = m;
        return `${escapeHtml(indent)}<span class="md-footnote-marker">${ob}</span><span class="md-footnote-id">${escapeHtml(fnId)}</span><span class="md-footnote-marker">${cb}</span>${escapeHtml(space)}${highlightInline(escapeHtml(content))}`;
    }

    // Liên kết tham chiếu (Reference link definition): [id]: url "optional title"
    m = line.match(/^(\s{0,3})(\[)([^\]^]+)(\])(:)(\s*)(\S+)(?:(\s+)(.*))?$/);
    if (m) {
        const [, indent, ob, id, cb, colon, sp1, url, sp2 = '', title = ''] = m;
        return `${escapeHtml(indent)}<span class="md-link-marker">${ob}</span><span class="md-ref-id">${escapeHtml(id)}</span><span class="md-link-marker">${cb}${colon}</span>${escapeHtml(sp1)}<span class="md-link-url">${escapeHtml(url)}</span>${escapeHtml(sp2)}${title ? `<span class="md-ref-title">${escapeHtml(title)}</span>` : ''}`;
    }

    // Tiêu đề dạng ATX: #, ##, ### ...
    m = line.match(/^(\s{0,3})(#{1,6})(\s+)(.*)$/);
    if (m) {
        const [, indent, hashes, space, content] = m;
        const level = hashes.length;
        return `${escapeHtml(indent)}<span class="md-header-marker">${hashes}</span>${escapeHtml(space)}<span class="md-header md-header-${level}">${highlightInline(escapeHtml(content))}</span>`;
    }

    // Trích dẫn / GFM Alerts (Blockquote): > ...
    m = line.match(/^(\s{0,3}>+\s?)(.*)$/);
    if (m) {
        const [, marker, rest] = m;
        const alertMatch = rest.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](.*)$/i);
        if (alertMatch) {
            const type = alertMatch[1].toUpperCase();
            const color = alertHighlightColors[type] || '#0969da';
            return `<span class="md-quote-marker">${escapeHtml(marker)}</span><span class="md-alert-tag" style="color:${color}">[!${type}]</span><span class="md-quote-text">${highlightInline(escapeHtml(alertMatch[2]))}</span>`;
        }
        return `<span class="md-quote-marker">${escapeHtml(marker)}</span><span class="md-quote-text">${highlightInline(escapeHtml(rest))}</span>`;
    }

    // Task-list (Danh sách công việc có checkbox): - [ ] hoặc - [x]
    m = line.match(/^(\s*)([-*+]|\d+[.)])(\s+)(\[(?: |x|X)\])(\s+)(.*)$/);
    if (m) {
        const [, indent, marker, sp1, checkbox, sp2, content] = m;
        const isChecked = checkbox.toLowerCase().includes('x');
        const checkClass = isChecked ? 'md-task-checked' : 'md-task-unchecked';
        return `${escapeHtml(indent)}<span class="md-list-marker">${escapeHtml(marker)}</span>${escapeHtml(sp1)}<span class="md-task-checkbox ${checkClass}">${escapeHtml(checkbox)}</span>${escapeHtml(sp2)}${highlightInline(escapeHtml(content))}`;
    }

    // Danh sách thông thường (List item): -, *, +, hoặc số thứ tự "1."
    m = line.match(/^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/);
    if (m) {
        const [, indent, marker, space, content] = m;
        return `${escapeHtml(indent)}<span class="md-list-marker">${escapeHtml(marker)}</span>${escapeHtml(space)}${highlightInline(escapeHtml(content))}`;
    }

    // Dòng thuộc bảng biểu (chứa dấu |)
    if (line.includes('|')) {
        // Dòng phân tách header/body: |---|:---:|---:| (tô riêng, không qua highlightInline)
        if (/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line)) {
            return escapeHtml(line)
                .replace(/\|/g, '\u0000P\u0000')
                .replace(/:?-+:?/g, '<span class="md-table-separator">$&</span>')
                .split('\u0000P\u0000').join('<span class="md-table-pipe">|</span>');
        }
        // Tokenize inline code first to preserve pipes inside code
        const codeStore = [];
        let escapedLine = escapeHtml(line);
        
        // Protect inline code containing pipes
        escapedLine = escapedLine.replace(/(`+)([^`]+?)\1/g, (m, ticks, content) => {
            const token = `\u0000CODE_${codeStore.length}\u0000`;
            codeStore.push(`${ticks}${content}${ticks}`);
            return token;
        });
        
        // Now safe to highlight table pipes
        escapedLine = escapedLine.replace(/\|/g, '<span class="md-table-pipe">|</span>');
        
        // Restore inline code tokens
        escapedLine = escapedLine.replace(/\u0000CODE_(\d+)\u0000/g, (m, idx) => {
            return `<span class="md-code-inline">${codeStore[Number(idx)]}</span>`;
        });
        
        return highlightInline(escapedLine);
    }

    // Dòng văn bản thông thường (paragraph)
    return highlightInline(escapeHtml(line));
}

// Hàm quét toàn bộ nội dung Markdown: khối code (```...```), khối toán ($$...$$),
// HTML comments (<!-- ... -->), indented code, setext headings (=== / ---)
function highlightMarkdown(text) {
    const lines = text.split('\n');
    let inFence = false;
    let inMathBlock = false;
    let inHtmlComment = false;
    let inIndentedCode = false;

    // Dòng văn bản thuần (ứng viên cho setext title): không blank/block
    // (heading, list, quote, table, hr, footnote, refdef, fence, math, code, comment...)
    const isPlainPara = (s) => {
        if (!s || !s.trim()) return false;
        if (/^\s{0,3}(=+|-+)\s*$/.test(s)) return false;
        if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(s)) return false;
        if (/^\s{0,3}#{1,6}\s+/.test(s)) return false;
        if (/^\s{0,3}>/.test(s)) return false;
        if (/^\s*([-*+]|\d+[.)])\s+/.test(s)) return false;
        if (/^\s{0,3}\[\^/.test(s)) return false;
        if (/^\s{0,3}\[[^\]^]+\]:/.test(s)) return false;
        if (/^\s{0,3}(`{3,}|~{3,})/.test(s)) return false;
        if (/^\s*\$\$/.test(s)) return false;
        if (/^(    |\t)/.test(s)) return false;
        if (s.includes('|')) return false;
        if (s.includes('<!--') || s.includes('-->')) return false;
        return true;
    };

    const outputLines = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // HTML comments nhiều dòng: nuốt mọi dòng cho tới -->
        // (đặt trước fence để ``` nằm trong comment vẫn là comment)
        if (inHtmlComment) {
            outputLines.push(`<span class="md-html-comment">${escapeHtml(line)}</span>`);
            if (line.includes('-->')) inHtmlComment = false;
            continue;
        }

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
            if (/^\s*\$\$\s*$/.test(line) || line.trim().endsWith('$$')) {
                inMathBlock = false;
            }
            outputLines.push(`<span class="md-math">${escapeHtml(line)}</span>`);
            continue;
        }

        // Indented code: 4 spaces / 1 tab. Không chen giữa paragraph/list nên chỉ mở
        // sau dòng trắng (hoặc đầu file); dòng trắng không kết thúc block.
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

        // Mở HTML comment nhiều dòng (không có --> trên cùng dòng)
        if (line.includes('<!--') && !line.includes('-->')) {
            inHtmlComment = true;
            outputLines.push(`<span class="md-html-comment">${escapeHtml(line)}</span>`);
            continue;
        }

        if (/^\s*\$\$/.test(line) && !/^\s*\$\$.+\$\$\s*$/.test(line)) {
            inMathBlock = true;
            outputLines.push(`<span class="md-math">${escapeHtml(line)}</span>`);
            continue;
        }

        // Setext headings: dòng === (H1) / --- (H2) sau 1 paragraph thuần.
        // Đặt trước highlightMarkdownLine để --- sau paragraph thành H2 thay vì <hr>.
        const setextMatch = line.match(/^\s{0,3}(=+|-+)\s*$/);
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

// Cập nhật lớp nền tô màu cú pháp phía sau khung soạn thảo
function updateEditorHighlight() {
    editorHighlightCode.innerHTML = highlightMarkdown(markdownInput.value) + '\n';
}

// Gộp nhiều lệnh gọi liên tiếp (do gõ nhanh) thành 1 lần tô màu duy nhất mỗi khung hình,
// tránh chặn (block) luồng chính ngay trong handler của sự kiện 'input' -> giảm độ trễ gõ phím.
let editorHighlightRAF = null;
function scheduleEditorHighlight() {
    if (editorHighlightRAF !== null) return;
    editorHighlightRAF = requestAnimationFrame(() => {
        editorHighlightRAF = null;
        updateEditorHighlight();
    });
}

// Hàm hiển thị thông báo Toast
let toastTimer = null;
function showToast(message) {
    toast.textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.classList.add('hidden');
    }, 2500);
}

// Lấy icon Lucide cho GFM Alert
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

// Lấy tiêu đề hiển thị cho GFM Alert
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

// Xử lý các khối blockquote để định dạng thành GFM Alerts (phong cách GitHub)
function processGFMAlerts() {
    previewOutput.querySelectorAll('blockquote').forEach((bq) => {
        const firstP = bq.querySelector('p');
        if (firstP) {
            const htmlContent = firstP.innerHTML.trim();
            const match = htmlContent.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br\s*\/?>)?\s*/i);
            
            if (match) {
                const type = match[1].toUpperCase();
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

// Bảo mật bổ sung cho DOMPurify
if (typeof DOMPurify !== 'undefined') {
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
        const tag = (node.tagName || '').toUpperCase();
        // SVG <a> co tagName viet thuong + xlink:href: chan tren moi phan tu.
        const url = node.getAttribute
            ? (node.getAttribute('href') || node.getAttribute('xlink:href')) : null;
        if (url != null && /^\s*(javascript|data|vbscript):/i.test(url)) {
            node.removeAttribute('href');
            node.removeAttribute('xlink:href');
            return;
        }
        // Form/iframe khong co cho trong preview: bo thuoc tinh dieu huong.
        node.removeAttribute('formaction');
        if (tag === 'FORM') node.removeAttribute('action');
        if (tag === 'IFRAME') node.removeAttribute('srcdoc');
        if (tag === 'A' && node.hasAttribute('href')) {
            const href = node.getAttribute('href') || '';
            if (/^\s*(javascript|data|vbscript):/i.test(href)) {
                node.removeAttribute('href');
                return;
            }
            // Chỉ mở tab mới với liên kết ra ngoài; liên kết neo nội bộ (#muc-luc) giữ nguyên trong tab hiện tại
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

// Cập nhật kết quả Preview từ Markdown sang HTML (Đảm bảo an toàn XSS)
function renderMarkdown() {
    // Đánh dấu phiên bản của lượt render này (xem giải thích ở khai báo renderVersion).
    const myRenderVersion = ++renderVersion;

    const rawText = markdownInput.value;

    // Lưu lại vị trí cuộn hiện tại của Preview TRƯỚC khi thay nội dung.
    const previousPreviewScrollTop = previewOutput.scrollTop;
    
    // 1. Chuyển đổi Markdown sang HTML
    const dirtyHtml = marked.parse(rawText);

    // 2. Bảo mật XSS: Khử độc HTML bằng DOMPurify
    // Fail-closed: DOMPurify chua tai duoc thi hien thi van ban thuan,
    // khong bao gio innerHTML HTML chua loc.
    if (typeof DOMPurify === 'undefined') {
        previewOutput.textContent = rawText;
        charCounter.textContent = `${rawText.length} characters`;
        restorePreviewScrollTop(previousPreviewScrollTop);
        return;
    }
    const cleanHtml = DOMPurify.sanitize(dirtyHtml, {
        USE_PROFILES: { html: true, mathMl: true, svg: true },
        ADD_ATTR: ['target', 'rel'],
        ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|callto|ftp):|[^a-zA-Z]|[a-zA-Z+.\-]+(?:[^a-zA-Z+.:]|$))/i
    });

    previewOutput.innerHTML = cleanHtml;
    charCounter.textContent = `${rawText.length} characters`;

    // LƯU Ý: KHÔNG khôi phục scrollTop ngay ở đây. Các bước bên dưới (GFM alerts, hljs,
    // mermaid, lucide icons) vẫn có thể làm thay đổi chiều cao nội dung; nếu khôi phục
    // scrollTop ngay bây giờ rồi các bước đó chèn thêm chiều cao ở phía TRÊN vị trí đang
    // xem, preview sẽ bị đẩy lệch và trông như "cuộn dần lên" sau mỗi lần gõ phím.
    // Ta chỉ khôi phục scrollTop MỘT LẦN duy nhất, sau khi mọi thay đổi đồng bộ về
    // chiều cao đã hoàn tất (xem lệnh gọi restorePreviewScrollTop() ở cuối hàm này).

    // 3. Chuyển đổi các khối blockquote đặc biệt thành GFM Alerts
    processGFMAlerts();

    // 4. Tô màu mã nguồn (Syntax Highlighting) bằng Highlight.js
    // ponytail: bo highlight khi preview >300k ky tu (O(blocks x size) moi lan go);
    // nang cap sau: highlight rieng tung khoi thay doi hoac worker.
    const isHugePreview = (previewOutput.textContent || '').length > 300000;
    if (typeof hljs !== 'undefined' && !isHugePreview) {
        previewOutput.querySelectorAll('pre code').forEach((block) => {
            const hasLanguage = Array.from(block.classList).some(cls => cls.startsWith('language-'));
            if (hasLanguage && !block.classList.contains('language-mermaid')) {
                hljs.highlightElement(block);
            }
        });
    }
    
    // 5. Xử lý các khối code Mermaid và vẽ biểu đồ
    if (typeof mermaid !== 'undefined') {
        const mermaidBlocks = previewOutput.querySelectorAll('pre code.language-mermaid');
        // Chỉ những khối có nội dung THỰC SỰ mới (chưa có trong cache) mới cần mermaid.run() vẽ lại;
        // khối trùng nội dung với lần render trước sẽ dùng ngay SVG đã lưu, không tốn CPU tính toán lại.
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
                // Mermaid có thể phóng to chiều cao rất nhiều so với khối code chữ ban đầu.
                // Ghi lại scrollTop NGAY TRƯỚC lúc thay thế nội dung để khôi phục lại đúng
                // vị trí đang xem sau khi biểu đồ được vẽ xong (tránh preview bị "nhảy"/trôi lên).
                const scrollTopBeforeMermaid = previewOutput.scrollTop;
                const scrollGenBeforeMermaid = previewScrollGen;

                mermaid.run({
                    nodes: nodesToRender,
                    suppressErrors: true
                }).then(() => {
                    // Lưu lại SVG vừa vẽ để tái sử dụng cho các lần render sau
                    nodesToRender.forEach((node) => {
                        // Mermaid sinh SVG chua qua loc (click/href javascript:):
                        // loc lai truoc khi tin va cache.
                        if (typeof DOMPurify !== 'undefined' && node.innerHTML) {
                            node.innerHTML = DOMPurify.sanitize(node.innerHTML, MERMAID_SANITIZE_CONFIG);
                        }
                        const code = codeByNode.get(node);
                        if (code && node.innerHTML) {
                            cacheMermaidResult(code, node.innerHTML);
                        }
                    });
                    // Nếu đã có một lượt renderMarkdown() MỚI hơn chạy trong lúc Mermaid
                    // đang vẽ (ví dụ người dùng gõ tiếp), thì lượt render hiện tại đã lỗi
                    // thời: các node vừa vẽ không còn nằm trong DOM hiển thị nữa, và
                    // scrollTopBeforeMermaid cũng không còn phản ánh đúng vị trí hiện tại
                    // của Preview. Bỏ qua việc khôi phục scroll trong trường hợp này để
                    // tránh ghi đè lên vị trí cuộn đúng mà lượt render mới hơn đã thiết lập.
                    if (myRenderVersion !== renderVersion) return;
                    // Nguoi dung da cuon trong luc ve: giu vi tri moi, khong ghi de.
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

    // 6. Cập nhật và vẽ lại tất cả icon từ Lucide
    // Scope to preview container only to avoid scanning entire DOM
    if (typeof lucide !== 'undefined') {
        lucide.createIcons({ root: previewOutput });
    }

    // Khôi phục vị trí cuộn đã lưu từ đầu hàm, giới hạn trong phạm vi có thể cuộn của
    // nội dung mới. Đặt ở đây (SAU khi GFM alerts, hljs, mermaid-từ-cache và lucide icon
    // đã chạy xong) để những thay đổi chiều cao đồng bộ ở trên không làm preview bị lệch.
    restorePreviewScrollTop(previousPreviewScrollTop);
}

// Khôi phục scrollTop của Preview về đúng giá trị mong muốn, giới hạn trong phạm vi
// có thể cuộn thực tế của nội dung hiện tại (nội dung có thể đã ngắn/dài hơn trước).
function restorePreviewScrollTop(desiredScrollTop) {
    const maxPreviewScrollTop = Math.max(previewOutput.scrollHeight - previewOutput.clientHeight, 0);
    previewOutput.scrollTop = Math.min(desiredScrollTop, maxPreviewScrollTop);
}

// ==========================================================================
// BỘ QUẢN LÝ TIỆN ÍCH & PHÍM TẮT TRÌNH SOẠN THẢO (Editor Actions & Shortcuts)
// ==========================================================================
const TAB_SIZE = 4;
const TAB_SPACES = ' '.repeat(TAB_SIZE);

// Quản lý lịch sử Undo / Redo cho Editor
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
        // Nếu nội dung hiện tại chưa kịp lưu vào lịch sử, lưu lại trước khi lùi.
        // Lưu ý: push() đã tự tăng this.index khi thêm state mới, nên KHÔNG được
        // giảm index thêm ở đây nữa - nếu không Undo sẽ lùi tới 2 bước thay vì 1.
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

// Đồng bộ giao diện sau khi thực hiện thao tác chỉnh sửa văn bản
function syncEditorAfterChange() {
    charCounter.textContent = `${markdownInput.value.length} characters`;
    scheduleEditorHighlight();
    debouncedRender();
}

// Áp dụng thay đổi văn bản và ghi nhận trạng thái vào lịch sử
function applyEditorChange(newText, newStart, newEnd) {
    editorHistory.saveCurrentState(markdownInput);
    markdownInput.value = newText;
    markdownInput.setSelectionRange(newStart, newEnd !== undefined ? newEnd : newStart);
    editorHistory.saveCurrentState(markdownInput);
    syncEditorAfterChange();
}

// Xử lý phím Tab và Shift + Tab (Thụt lề / Hủy thụt lề)
function handleEditorTab(e) {
    e.preventDefault();
    const val = markdownInput.value;
    const selStart = markdownInput.selectionStart;
    const selEnd = markdownInput.selectionEnd;

    // Trường hợp con trỏ đơn, không chọn nhiều dòng và không ấn Shift: chèn 4 khoảng trắng
    if (selStart === selEnd && !e.shiftKey) {
        const newText = val.substring(0, selStart) + TAB_SPACES + val.substring(selEnd);
        applyEditorChange(newText, selStart + TAB_SIZE, selStart + TAB_SIZE);
        return;
    }

    // Trường hợp bôi đen nhiều dòng hoặc Shift + Tab
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
            // Thụt lề vào trong
            newLine = TAB_SPACES + line;
            delta = TAB_SIZE;
        } else {
            // Hủy thụt lề ra ngoài
            if (line.startsWith(TAB_SPACES)) {
                newLine = line.substring(TAB_SIZE);
                delta = -TAB_SIZE;
            } else if (line.startsWith('\t')) {
                newLine = line.substring(1);
                delta = -1;
            } else {
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

// Xử lý phím Enter thông minh (Auto-indent & Tự động tiếp tục danh sách)
function handleEditorEnter(e) {
    const val = markdownInput.value;
    const selStart = markdownInput.selectionStart;
    const selEnd = markdownInput.selectionEnd;

    const lineStart = val.lastIndexOf('\n', selStart - 1) + 1;
    const currentLine = val.substring(lineStart, selStart);

    // 1. Kiểm tra trường hợp dòng danh sách rỗng (người dùng muốn thoát khỏi danh sách)
    const emptyTaskMatch = currentLine.match(/^(\s*[-*+]\s+\[[ xX]\]\s*)$/);
    const emptyUlMatch = currentLine.match(/^(\s*[-*+]\s*)$/);
    const emptyOlMatch = currentLine.match(/^(\s*\d+[.)]\s*)$/);
    const emptyBqMatch = currentLine.match(/^(\s*>+\s*)$/);

    if (emptyTaskMatch || emptyUlMatch || emptyOlMatch || emptyBqMatch) {
        e.preventDefault();
        const newText = val.substring(0, lineStart) + val.substring(selEnd);
        applyEditorChange(newText, lineStart, lineStart);
        return;
    }

    // 2. Danh sách công việc (Task list): - [ ] hoặc - [x]
    const taskMatch = currentLine.match(/^(\s*)([-*+]|\d+[.)])(\s+\[[ xX]\]\s+)(.*)$/);
    if (taskMatch) {
        e.preventDefault();
        const [, indent, bullet, marker] = taskMatch;
        const cleanMarker = marker.replace(/\[[xX]\]/, '[ ]');
        const insert = '\n' + indent + bullet + cleanMarker;
        const newText = val.substring(0, selStart) + insert + val.substring(selEnd);
        applyEditorChange(newText, selStart + insert.length, selStart + insert.length);
        return;
    }

    // 3. Danh sách không thứ tự (Unordered list): -, *, +
    const ulMatch = currentLine.match(/^(\s*)([-*+]\s+)(.*)$/);
    if (ulMatch) {
        e.preventDefault();
        const [, indent, marker] = ulMatch;
        const insert = '\n' + indent + marker;
        const newText = val.substring(0, selStart) + insert + val.substring(selEnd);
        applyEditorChange(newText, selStart + insert.length, selStart + insert.length);
        return;
    }

    // 4. Danh sách có thứ tự (Ordered list): 1. , 2)
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

    // 5. Trích dẫn (Blockquote): >
    const bqMatch = currentLine.match(/^(\s*>+\s*)(.*)$/);
    if (bqMatch) {
        e.preventDefault();
        const insert = '\n' + bqMatch[1];
        const newText = val.substring(0, selStart) + insert + val.substring(selEnd);
        applyEditorChange(newText, selStart + insert.length, selStart + insert.length);
        return;
    }

    // 6. Giữ nguyên độ thụt lề của dòng hiện tại (Auto indentation)
    const indentMatch = currentLine.match(/^(\s+)/);
    if (indentMatch) {
        e.preventDefault();
        const insert = '\n' + indentMatch[1];
        const newText = val.substring(0, selStart) + insert + val.substring(selEnd);
        applyEditorChange(newText, selStart + insert.length, selStart + insert.length);
    }
}

// Bọc hoặc hủy bọc đoạn văn bản bằng ký hiệu Markdown (Bold, Italic, Code, Strikethrough...)
function wrapOrToggleFormat(wrapper, placeholder = '') {
    const val = markdownInput.value;
    const selStart = markdownInput.selectionStart;
    const selEnd = markdownInput.selectionEnd;
    const selected = val.substring(selStart, selEnd);
    const wLen = wrapper.length;

    // Kiểm tra nếu nội dung đang chọn đã được bọc bởi wrapper
    if (selected.length >= 2 * wLen && selected.startsWith(wrapper) && selected.endsWith(wrapper)) {
        const unwrapped = selected.substring(wLen, selected.length - wLen);
        const newText = val.substring(0, selStart) + unwrapped + val.substring(selEnd);
        applyEditorChange(newText, selStart, selStart + unwrapped.length);
        return;
    }

    // Kiểm tra nếu wrapper nằm ngay bên ngoài phạm vi đang chọn
    if (selStart >= wLen && selEnd + wLen <= val.length) {
        const before = val.substring(selStart - wLen, selStart);
        const after = val.substring(selEnd, selEnd + wLen);
        // Đảm bảo cặp ký hiệu vừa tìm thấy không phải là MỘT PHẦN của một cặp dài hơn
        // (vd: 1 dấu "*" đứng liền trong cặp "**" của bold không được coi là wrapper "*" của italic).
        // Cách làm: xem thêm 1 ký tự nằm ngay ngoài "before"/"after" - nếu ký tự đó
        // cũng trùng với wrapper thì nghĩa là chuỗi dấu thực tế dài hơn wrapper đang xét.
        const extraBefore = selStart - wLen - 1 >= 0 ? val[selStart - wLen - 1] : '';
        const extraAfter = selEnd + wLen < val.length ? val[selEnd + wLen] : '';
        const isPartOfLongerWrapper = extraBefore === wrapper[wrapper.length - 1] || extraAfter === wrapper[0];
        if (before === wrapper && after === wrapper && !isPartOfLongerWrapper) {
            const newText = val.substring(0, selStart - wLen) + selected + val.substring(selEnd + wLen);
            applyEditorChange(newText, selStart - wLen, selStart - wLen + selected.length);
            return;
        }
    }

    // Bọc mới
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

// Chèn hoặc bọc liên kết (Link)
function handleEditorLink() {
    const val = markdownInput.value;
    const selStart = markdownInput.selectionStart;
    const selEnd = markdownInput.selectionEnd;
    const selected = val.substring(selStart, selEnd);

    if (selStart === selEnd) {
        const insert = '[link](url)';
        const newText = val.substring(0, selStart) + insert + val.substring(selEnd);
        // Pre-select the word "url" so the user can paste their link over it.
        // "[link](url)" -> "url" sits at index 7-10.
        applyEditorChange(newText, selStart + 7, selStart + 10);
    } else {
        const insert = `[${selected}](url)`;
        const newText = val.substring(0, selStart) + insert + val.substring(selEnd);
        const urlStart = selStart + selected.length + 3;
        applyEditorChange(newText, urlStart, urlStart + 3);
    }
}

// Nhân bản dòng hiện tại hoặc đoạn văn bản đang chọn (Duplicate line / selection)
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

// Lắng nghe sự kiện bàn phím trên khung soạn thảo
markdownInput.addEventListener('keydown', (e) => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const isCmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
    const key = e.key;

    // 1. Phím tắt có Ctrl / Cmd
    if (isCmdOrCtrl) {
        const lowerKey = key.toLowerCase();

        // Undo: Ctrl+Z
        if (lowerKey === 'z' && !e.shiftKey) {
            e.preventDefault();
            editorHistory.undo(markdownInput);
            return;
        }

        // Redo: Ctrl+Y hoặc Ctrl+Shift+Z
        if (lowerKey === 'y' || (lowerKey === 'z' && e.shiftKey)) {
            e.preventDefault();
            editorHistory.redo(markdownInput);
            return;
        }

        // Bold: Ctrl+B
        if (lowerKey === 'b') {
            e.preventDefault();
            wrapOrToggleFormat('**');
            return;
        }

        // Italic: Ctrl+I
        if (lowerKey === 'i') {
            e.preventDefault();
            wrapOrToggleFormat('*');
            return;
        }

        // Link: Ctrl+K
        if (lowerKey === 'k') {
            e.preventDefault();
            handleEditorLink();
            return;
        }

        // Inline Code: Ctrl+E hoặc Ctrl+`
        if (lowerKey === 'e' || key === '`') {
            e.preventDefault();
            wrapOrToggleFormat('`');
            return;
        }

        // Strikethrough: Ctrl+Shift+X
        if (e.shiftKey && lowerKey === 'x') {
            e.preventDefault();
            wrapOrToggleFormat('~~');
            return;
        }

        // Duplicate line/selection: Ctrl+D
        if (lowerKey === 'd') {
            e.preventDefault();
            handleEditorDuplicate();
            return;
        }
    }

    // 2. Phím Tab & Shift + Tab
    if (key === 'Tab') {
        handleEditorTab(e);
        return;
    }

    // 3. Phím Enter
    if (key === 'Enter' && !e.shiftKey && !e.altKey && !isCmdOrCtrl) {
        handleEditorEnter(e);
        return;
    }

    const val = markdownInput.value;
    const selStart = markdownInput.selectionStart;
    const selEnd = markdownInput.selectionEnd;

    // 4. Tự động bao bọc vùng chọn khi gõ ký tự mở / ký hiệu Markdown
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

    // 5. Tự động đóng cặp ngoặc & nháy khi con trỏ không bôi đen
    const autoClosePairs = {
        '(': ')',
        '[': ']',
        '{': '}',
        '"': '"',
        "'": "'",
        '`': '`'
    };

    if (selStart === selEnd && autoClosePairs[key]) {
        // Don't auto-close single quote after word characters (contractions)
        if (key === "'") {
            const charBefore = selStart > 0 ? val[selStart - 1] : '';
            // Skip auto-close if preceded by alphanumeric (e.g., don't, it's, user's)
            if (/\w/.test(charBefore)) {
                return; // Let the quote be typed normally
            }
        }
        e.preventDefault();
        const openChar = key;
        const closeChar = autoClosePairs[key];
        const newText = val.substring(0, selStart) + openChar + closeChar + val.substring(selEnd);
        applyEditorChange(newText, selStart + 1, selStart + 1);
        return;
    }

    // 6. Bỏ qua ký tự đóng nếu con trỏ đang đứng trước nó
    const closers = [')', ']', '}', '"', "'", '`'];
    if (selStart === selEnd && closers.includes(key) && selStart < val.length && val[selStart] === key) {
        e.preventDefault();
        markdownInput.setSelectionRange(selStart + 1, selStart + 1);
        return;
    }

    // 7. Xóa cả cặp ngoặc khi nhấn Backspace giữa cặp ngoặc rỗng
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

// Hàm áp dụng một đoạn văn bản bất kỳ vào Editor (dùng chung cho nạp mặc định / nạp dữ liệu đã lưu)
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

// Hàm gán lại dữ liệu mặc định (dùng cho nút Reset)
function loadDefaultContent() {
    applyContent(defaultMarkdown);
    // Ghi đè luôn bộ nhớ tạm để nếu người dùng thoát app ngay sau khi Reset,
    // lần mở lại sau vẫn thấy bản mẫu chứ không phải nội dung cũ đã bị xoá.
    saveContentToStorage();
}

// Hàm lưu nội dung hiện tại của Editor vào bộ nhớ tạm (localStorage)
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

// Hàm nạp nội dung khi khởi động ứng dụng: ưu tiên bản đã lưu trong bộ nhớ tạm,
// nếu chưa có gì được lưu (lần đầu mở app) thì dùng văn bản mẫu mặc định.
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

// Hàm hoãn xử lý (Debounce) giúp tránh giật lag khi gõ văn bản
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
// Tự động lưu nội dung Editor vào bộ nhớ tạm sau khi người dùng ngừng gõ 400ms
const debouncedSaveContent = debounce(saveContentToStorage, 400);

// Sự kiện nhập liệu trong Editor
markdownInput.addEventListener('input', (e) => {
    charCounter.textContent = `${markdownInput.value.length} characters`;
    scheduleEditorHighlight();
    debouncedRender();
    debouncedSaveContent();

    // Tự động lưu snapshot vào lịch sử Undo/Redo khi người dùng gõ
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

// Đồng bộ cuộn trang (Sync Scroll) dựa trên phần trăm vị trí cuộn
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

// Also update activeScrollSource on focus, wheel, and keydown for keyboard navigation
markdownInput.addEventListener('focus', () => activeScrollSource = markdownInput);
previewOutput.addEventListener('focus', () => activeScrollSource = previewOutput);

markdownInput.addEventListener('wheel', () => activeScrollSource = markdownInput, { passive: true });
previewOutput.addEventListener('wheel', () => activeScrollSource = previewOutput, { passive: true });

markdownInput.addEventListener('keydown', () => activeScrollSource = markdownInput);
previewOutput.addEventListener('keydown', () => activeScrollSource = previewOutput);

markdownInput.addEventListener('touchstart', () => activeScrollSource = markdownInput, { passive: true });
previewOutput.addEventListener('touchstart', () => activeScrollSource = previewOutput, { passive: true });

// Gộp các lần xử lý scroll-sync theo khung hình (rAF) để tránh đọc liên tục
// scrollHeight/scrollTop (buộc trình duyệt tính lại layout) trên từng sự kiện scroll dồn dập.
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

// Intercept external link clicks and open in system browser
// This prevents WebView navigation issues in desktop apps
previewOutput.addEventListener('click', async (e) => {
    const link = e.target.closest('a');
    if (link && link.getAttribute('href')) {
        const href = link.getAttribute('href');
        // Bỏ qua các liên kết neo nội bộ (ví dụ: #muc-luc)
        if (!href.startsWith('#')) {
            e.preventDefault();
            if (!isSafeExternalUrl(href)) return;
            
            // Use Tauri opener plugin in desktop app, fallback to window.open
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

// Nút Bật/Tắt Sync Scroll
btnSync.addEventListener('click', () => {
    isSyncScrollEnabled = !isSyncScrollEnabled;
    btnSync.classList.toggle('active', isSyncScrollEnabled);
    showToast(isSyncScrollEnabled ? "Sync scroll enabled" : "Sync scroll disabled");
});

// Nút Reset
btnReset.addEventListener('click', () => {
    if (confirm("Are you sure you want to restore the sample text? This will overwrite your current content.")) {
        loadDefaultContent();
        showToast("Sample content restored!");
    }
});

// Nút Copy nội dung Markdown
btnCopy.addEventListener('click', () => {
    const textToCopy = markdownInput.value;
    const copyPromise = (window.__TAURI__ && window.__TAURI__.clipboardManager)
        ? window.__TAURI__.clipboardManager.writeText(textToCopy)
        : navigator.clipboard.writeText(textToCopy);

    copyPromise
        .then(() => showToast("Markdown copied to clipboard!"))
        .catch(() => showToast("An error occurred while copying."));
});

// ==========================================================================
// IMPORT & EXPORT (Markdown / DOC / PDF)
// ==========================================================================

// Tạo tên file (không phần mở rộng) từ heading cấp 1 đầu tiên trong Markdown.
// Bỏ dấu tiếng Việt, thay khoảng trắng bằng gạch nối; không có heading thì dùng "document".
// Hàm thuần để self-check được.
function deriveExportBaseName(markdown) {
    const heading = markdown.match(/^\s{0,3}#\s+(.+?)\s*$/m);
    const raw = heading ? heading[1] : '';
    const slug = raw
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')   // bỏ dấu thanh/dấu phụ sau khi tách NFD
        .replace(/đ/gi, 'd')               // đ không bị tách trong NFD nên phải thay riêng
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
    return (slug || 'document').slice(0, 80);
}

// Tải một Blob về máy thông qua thẻ <a download> (fallback khi chạy ngoài Tauri,
// ví dụ mở trực tiếp bằng trình duyệt). Lưu ý: WebView của Tauri CHẶN cơ chế này
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

// Lưu văn bản ra file: trong app Tauri dùng hộp thoại "Save As" (plugin dialog) và
// ghi file (plugin fs); ngoài Tauri thì fallback về <a download> của trình duyệt.
// Trả về true nếu đã lưu, false nếu người dùng bấm Cancel.
// Lưu ý: KHÔNG được đặt tên isTauri - Tauri core đã inject biến global isTauri
// vào WebView (withGlobalTauri), trùng tên sẽ gây SyntaxError chết cả file script.
// Chi mo http(s)/mailto/tel/ftp ra trinh duyet he thong; chan
// javascript:/data:/file:/blob: ngay ca khi sanitizer bi lot.
function isSafeExternalUrl(href) {
    const url = String(href || '').trim();
    return /^(https?|ftp):\/\/\S/i.test(url) || /^(mailto|tel):\S/i.test(url);
}
const tauriDialogPlugin = () => (window.__TAURI__ ? window.__TAURI__.dialog : undefined);
const tauriFsPlugin = () => (window.__TAURI__ ? window.__TAURI__.fs : undefined);
const hasTauriBridge = () => !!(tauriDialogPlugin()?.save && tauriFsPlugin()?.writeTextFile);
const isTauriRuntime = () => !!window.__TAURI__;

async function saveTextFile(contents, baseName, ext, mimeType) {
    if (hasTauriBridge()) {
        const path = await window.__TAURI__.dialog.save({
            defaultPath: baseName + '.' + ext,
            filters: [{ name: ext.toUpperCase() + ' file', extensions: [ext] }]
        });
        if (!path) return false; // người dùng bấm Cancel
        await window.__TAURI__.fs.writeTextFile(path, contents);
        return true;
    }

    // Fallback trinh duyet. Trong WebView Tauri ma thieu dialog/fs thi
    // <a download> khong hoat dong: bao ro thay vi im lang "thanh cong".
    if (isTauriRuntime()) {
        showToast('Could not save the file: the app\'s file-saving plugin is missing.');
        return false;
    }
    downloadBlob(new Blob([contents], { type: mimeType }), baseName + '.' + ext);
    return true;
}

// ----- Export Markdown -----

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

// ----- Export DOC (Word-compatible HTML) -----

// Chuyển mọi <foreignObject> (nhãn HTML của Mermaid) bên trong SVG clone thành <text>
// thuần SVG, vì canvas không vẽ được nội dung foreignObject (nhãn sơ đồ sẽ biến mất).
// ponytail: mất định dạng đậm/nghiêng trong nhãn, chỉ giữ dòng chữ, màu và cỡ font;
// nâng cấp sau: dựng text theo đúng kích thước/tọa độ từng span con của foreignObject.
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
        // Mỗi dòng là một tspan, căn giữa theo chiều rộng/cao của foreignObject;
        // vị trí tuyệt đối do transform của phần tử cha (được giữ nguyên) quyết định.
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

// Vẽ một SVG (sơ đồ Mermaid) lên canvas ở độ phân giải 2x rồi trả về data-URL PNG
// để nhúng trực tiếp vào file DOC (Word không hỗ trợ SVG inline).
// Trả về kèm kích thước hiển thị (px) để exportDoc thu ảnh vừa trang Word.
async function svgToPngDataUrl(svg, scale = 2) {
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

// Word bỏ qua CSS max-width nên ảnh PNG 2x lớn hơn trang sẽ tràn lề.
// Giữ nguyên ảnh nhỏ, thu ảnh lớn về vừa trang (rộng 650px / cao 900px,
// nhỏ hơn khổ A4 trừ lề 15mm trong style.css) theo đúng tỉ lệ,
// kèm width/height tường minh cho Word.
const DOC_IMG_MAX_WIDTH_PX = 650;
const DOC_IMG_MAX_HEIGHT_PX = 900;
// Hàm thuần để self-check được.
function fitDocImageSize(w, h, maxW = DOC_IMG_MAX_WIDTH_PX, maxH = DOC_IMG_MAX_HEIGHT_PX) {
    w = Math.round(Number(w));
    h = Math.round(Number(h));
    if (!(w > 0) || !(h > 0)) return { width: w, height: h };
    const s = Math.min(1, maxW / w, maxH / h);
    return { width: Math.round(w * s), height: Math.round(h * s) };
}

// CSS tối giản nhúng trong file DOC: Word không đọc được stylesheet của app nên
// phải tự mang theo các định dạng cốt lõi (heading, bảng, code, trích dẫn, alert).
const DOC_STYLES = `
    body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.5; }
    h1 { font-size: 20pt; } h2 { font-size: 16pt; } h3 { font-size: 14pt; }
    h4 { font-size: 12pt; } h5 { font-size: 11pt; } h6 { font-size: 10pt; color: #57606a; }
    table { border-collapse: collapse; width: 100%; margin: 10px 0; }
    th, td { border: 1px solid #d0d7de; padding: 6px 10px; text-align: left; }
    th { background: #f6f8fa; font-weight: bold; }
    pre { background: #f6f8fa; border: 1px solid #d0d7de; padding: 10px; font-family: Consolas, "Courier New", monospace; font-size: 9.5pt; white-space: pre-wrap; }
    code { font-family: Consolas, "Courier New", monospace; }
    blockquote { border-left: 4px solid #d0d7de; margin-left: 0; padding-left: 12px; color: #57606a; }
    img { max-width: 650px; max-height: 900px; height: auto; }
    a { color: #0969da; }
    hr { border: none; border-top: 1px solid #d0d7de; }
    .markdown-alert { border-left: 4px solid #0969da; background: #f6f8fa; padding: 8px 12px; }
    .markdown-alert-title { font-weight: bold; }
    .markdown-alert-tip { border-left-color: #1a7f37; }
    .markdown-alert-important { border-left-color: #8250df; }
    .markdown-alert-warning { border-left-color: #9a6700; }
    .markdown-alert-caution { border-left-color: #d1242f; }
`;

// Bọc nội dung HTML trong khung file Word (namespace Office + meta UTF-8).
// Hàm thuần để self-check được.
function buildWordHtml(bodyHtml) {
    return '<html xmlns:o="urn:schemas-microsoft-com:office:office" '
        + 'xmlns:w="urn:schemas-microsoft-com:office:word" '
        + 'xmlns="http://www.w3.org/TR/REC-html40">\n<head>\n'
        + '<meta charset="UTF-8">\n'
        + '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->\n'
        + '<style>' + DOC_STYLES + '</style>\n</head>\n<body>\n' + bodyHtml + '\n</body>\n</html>';
}

// KaTeX render mỗi công thức thành 2 lớp: .katex-mathml (MathML chuẩn, ẩn bằng CSS
// của katex.min.css) và .katex-html (hàng trăm span định vị bằng CSS). File DOC không
// mang theo CSS đó nên Word in cả hai lớp ra thành chữ rác. Hàm này thay mỗi
// span.katex bằng một <math> MathML thuần mà Word nhập trực tiếp thành phương trình.
// Khối nhiều dòng (aligned/bmatrix...): MathML mặc định của KaTeX còn thưa (chỉ mrow),
// nên render lại từ LaTeX nguồn (lấy trong <annotation encoding="application/x-tex">)
// với output:'mathml' để có cây mtable đầy đủ mà Word hiểu là công thức nhiều dòng.
function convertKatexForDoc(container) {
    container.querySelectorAll('span.katex').forEach((el) => {
        let math = el.querySelector('.katex-mathml > math')
            // output:'mathml' của KaTeX không có wrapper .katex-mathml, <math> là con trực tiếp.
            || el.querySelector(':scope > math');
        const annotation = el.querySelector('annotation[encoding="application/x-tex"]');
        const tex = annotation ? annotation.textContent : '';
        // Khối nhiều dòng: MathML mặc định của KaTeX (nhân bản .katex-mathml) thiếu
        // cấu trúc dòng; render lại từ LaTeX nguồn cho ra MathML phẳng đầy đủ (mtable).
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
            // Word không hiểu <annotation>; bỏ annotation và mọi text node trần
            // (DOMPurify ở preview có thể đã gỡ annotation nhưng chừa lại text của nó).
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

// Ảnh với URL remote giữ nguyên <img src> (Word tự tải).
async function exportDoc() {
    const text = markdownInput.value;
    if (!text.trim()) {
        showToast("Content is empty, nothing to export.");
        return;
    }
    showToast("Generating DOC file...");

    // Clone Preview đã render hoàn chỉnh (heading, bullet, đậm/nghiêng, bảng, alert...)
    renderMarkdown();
    await whenMermaidIdle(8000);
    const clone = previewOutput.cloneNode(true);

    // Bỏ icon Lucide (Word không hiểu) và thay checkbox bằng ký hiệu Unicode
    clone.querySelectorAll('svg').forEach((el) => el.remove());
    clone.querySelectorAll('input[type="checkbox"]').forEach((el) => {
        el.replaceWith(document.createTextNode(el.checked ? '\u2611 ' : '\u2610 '));
    });

    // Thu ảnh Markdown quá khổ về vừa trang Word (Word bỏ qua max-width).
    // Clone chưa vào DOM nên đo kích thước từ ảnh gốc trong preview theo chỉ số.
    clone.querySelectorAll('img').forEach((img, idx) => {
        const orig = previewOutput.querySelectorAll('img')[idx];
        if (!orig) return;
        const w = orig.naturalWidth || orig.width || parseFloat(orig.getAttribute('width')) || 0;
        const h = orig.naturalHeight || orig.height || parseFloat(orig.getAttribute('height')) || 0;
        if (w > 0 && h > 0 && (w > DOC_IMG_MAX_WIDTH_PX || h > DOC_IMG_MAX_HEIGHT_PX)) {
            const fit = fitDocImageSize(w, h);
            img.setAttribute('width', fit.width);
            img.setAttribute('height', fit.height);
            img.style.width = fit.width + 'px';
            img.style.height = 'auto';
        }
    });

    // Chuyển sơ đồ Mermaid thành ảnh PNG. Thứ tự pre.mermaid trong clone khớp 1-1
    // với thứ tự trong DOM gốc nên có thể ánh xạ theo chỉ số.
    const cloneMers = clone.querySelectorAll('pre.mermaid');
    const origSvgs = previewOutput.querySelectorAll('pre.mermaid > svg');
    for (let i = 0; i < cloneMers.length; i++) {
        try {
            const { dataUrl, width, height } = await svgToPngDataUrl(origSvgs[i]);
            const img = document.createElement('img');
            img.src = dataUrl;
            img.alt = 'Mermaid diagram';
            // PNG vẽ ở 2x nên điểm ảnh gốc gấp đôi kích thước hiển thị, mà Word
            // lại bỏ qua max-width: luôn gắn kích thước hiển thị tường minh.
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

    // Công thức KaTeX -> MathML thuần (Word nhập trực tiếp thành phương trình);
    // chạy sau vòng lặp Mermaid vì các bước convert trên không đụng tới span.katex.
    convertKatexForDoc(clone);

    const html = buildWordHtml(clone.innerHTML);
    try {
        const saved = await saveTextFile('\ufeff' + html, deriveExportBaseName(text), 'doc', 'application/msword');
        if (saved) showToast("DOC file exported!");
    } catch (err) {
        console.error('DOC export failed:', err);
        showToast("An error occurred while exporting the DOC file.");
    }
}

// ----- Export PDF (hộp thoại In của hệ thống, văn bản chọn được & tìm kiếm được) -----

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

// ----- Dropdown Export -----

function closeExportMenu() {
    exportMenu.classList.add('hidden');
    exportWrap.classList.remove('open');
}

btnExport.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = exportMenu.classList.toggle('hidden');
    exportWrap.classList.toggle('open', !isHidden);
});

// Đóng menu khi bấm ra ngoài hoặc nhấn Esc
document.addEventListener('click', (e) => {
    if (!exportMenu.classList.contains('hidden') && !exportWrap.contains(e.target)) {
        closeExportMenu();
    }
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeExportMenu();
});

exportMdBtn.addEventListener('click', () => { closeExportMenu(); exportMarkdown(); });
exportDocBtn.addEventListener('click', () => { closeExportMenu(); exportDoc(); });
exportPdfBtn.addEventListener('click', () => { closeExportMenu(); exportPdf(); });

// ==========================================================================
// THANH ĐỊNH DẠNG MARKDOWN (Format bar: Headings, Lists, Bold, Italic,
// Strikethrough, Link, Table) — thay thế vị trí logo cũ trên header
// ==========================================================================

// ----- Tham chiếu DOM của format bar và hộp thoại -----
const btnHeading = document.getElementById('btn-heading');
const headingMenu = document.getElementById('heading-menu');
const btnList = document.getElementById('btn-list');
const listMenu = document.getElementById('list-menu');
const btnBold = document.getElementById('btn-bold');
const btnItalic = document.getElementById('btn-italic');
const btnStrike = document.getElementById('btn-strike');
const btnLink = document.getElementById('btn-link');
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

// ----- Các hàm thuần (không đụng DOM, có assert trong self-check) -----

// Đọc level heading của một dòng: 0 = không phải heading, 1..6
function getHeadingLevel(line) {
    const m = line.match(/^[ \t]{0,3}(#{1,6})(?:[ \t]+|$)/);
    return m ? m[1].length : 0;
}

// Đặt level heading của một dòng: "#..." mới thay hoàn toàn "#..." cũ;
// level = 0 nghĩa là gỡ heading. Dòng thường (không phải heading) sẽ được THÊM
// prefix khi level > 0. Trả về { line, delta }, hoặc null nếu không có gì thay đổi.
function setHeadingLevel(line, level) {
    const m = line.match(/^([ \t]{0,3})(#{1,6})([ \t]+|$)/);
    const indent = m ? m[1] : (line.match(/^[ \t]*/) || [''])[0];
    const rest = m ? line.slice(m[0].length) : line.slice(indent.length);
    if (!m && level === 0) return null; // dòng thường muốn gỡ heading: nothing to do
    const newLine = indent + (level > 0 ? '#'.repeat(level) + ' ' : '') + rest;
    if (newLine === line) return null;
    return { line: newLine, delta: newLine.length - line.length };
}

// Nhận diện marker danh sách ở đầu dòng, trả về { indent, marker, kind, rest }
// với kind: 'bullet' | 'numbered' | 'task'; null nếu không phải dòng danh sách.
function parseListLine(line) {
    const m = line.match(/^([ \t]*)([-*+]|\d+[.)])([ \t]+)(\[[ xX]\][ \t]+)?(.*)$/);
    if (!m) return null;
    const [, indent, mark, sp, checkbox, rest] = m;
    const kind = checkbox ? 'task' : (/^\d/.test(mark) ? 'numbered' : 'bullet');
    return { indent, marker: mark + sp + (checkbox || ''), kind, rest };
}

// Xây dựng nội dung bảng Markdown kích thước rows x cols.
// ponytail: header để trống cho người dùng điền sau khi chèn;
// nâng cấp sau: điền tên cột từ lựa chọn văn bản hiện tại nếu có.
function buildTableMarkdown(rows, cols) {
    const r = Math.max(1, Math.min(99, rows | 0));
    const c = Math.max(1, Math.min(99, cols | 0));
    const out = ['|' + ' Head |'.repeat(c), '|' + ' --- |'.repeat(c)];
    for (let i = 1; i < r; i++) out.push('|' + '  |'.repeat(c));
    return out.join('\n');
}

// Chuẩn hoá URL người dùng nhập cho liên kết: thêm https:// nếu còn trần
// (ponytail: kiểm tra scheme bằng regex đơn giản, đủ cho anchor/email/relative)
function normalizeLinkUrl(raw) {
    const url = String(raw || '').trim();
    if (!url) return '';
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url) || url.startsWith('#') || url.startsWith('//')) return url;
    return 'https://' + url;
}

// Thoát dấu [ ] trong nhãn liên kết để không bẻ gãy cú pháp [text](url)
function escapeLinkText(text) {
    return text.replace(/([\[\]])/g, '\\$1');
}

// ----- Mở / đóng dropdown của format bar -----
const formatMenus = [
    { btn: btnHeading, wrap: btnHeading.parentElement, menu: headingMenu },
    { btn: btnList, wrap: btnList.parentElement, menu: listMenu },
    { btn: btnTable, wrap: btnTable.parentElement, menu: tableMenu }
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

// ----- Bold / Italic / Strikethrough: dùng lại wrapOrToggleFormat có sẵn -----
btnBold.addEventListener('click', () => { wrapOrToggleFormat('**'); markdownInput.focus(); });
btnItalic.addEventListener('click', () => { wrapOrToggleFormat('*'); markdownInput.focus(); });
btnStrike.addEventListener('click', () => { wrapOrToggleFormat('~~'); markdownInput.focus(); });

// ----- Dropdown Headings -----
btnHeading.addEventListener('click', () => toggleFormatMenu(formatMenus[0]));

headingMenu.querySelectorAll('.format-item').forEach((item) => {
    item.addEventListener('click', () => {
        closeFormatMenus();
        markdownInput.focus();
        applyHeadingLevel(parseInt(item.dataset.heading, 10) || 0);
    });
});

// ----- Dropdown Lists -----
btnList.addEventListener('click', () => toggleFormatMenu(formatMenus[1]));

listMenu.querySelectorAll('.format-item').forEach((item) => {
    item.addEventListener('click', () => {
        closeFormatMenus();
        markdownInput.focus();
        applyListStyle(item.dataset.list);
    });
});

// ----- Dropdown Table: lưới 5x5, ô góc dưới-phải là Custom size -----
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

// Đánh dấu các ô lưới đã rê qua (count = null để bỏ hết)
function highlightTableCells(grid, count) {
    for (let i = 0; i < grid.children.length; i++) {
        grid.children[i].classList.toggle('on', count !== null && i < count);
    }
}

// ----- Áp dụng heading cho (các) dòng đang chọn hoặc dòng con trỏ -----
function applyHeadingLevel(level) {
    const val = markdownInput.value;
    const selStart = markdownInput.selectionStart;
    const selEnd = markdownInput.selectionEnd;
    const lineStart = val.lastIndexOf('\n', selStart - 1) + 1;
    let lineEnd = val.indexOf('\n', selEnd);
    if (lineEnd === -1) lineEnd = val.length;
    const lines = val.substring(lineStart, lineEnd).split('\n');

    // Toggle: nếu TẤT CẢ dòng đã cùng level yêu cầu thì gỡ heading thay vì đặt lại
    const allSame = lines.every((line) => getHeadingLevel(line) === level);
    const target = allSame ? 0 : level;
    let delta = 0;
    const newLines = lines.map((line) => {
        const res = setHeadingLevel(line, target);
        if (!res) return line;
        delta += res.delta;
        return res.line;
    });
    if (delta === 0) return; // không có gì thay đổi

    const newText = val.substring(0, lineStart) + newLines.join('\n') + val.substring(lineEnd);
    applyEditorChange(newText, lineStart, Math.max(lineStart, selEnd + delta));
}

// ----- Áp dụng kiểu danh sách cho (các) dòng đang chọn hoặc dòng con trỏ -----
function applyListStyle(style) {
    const val = markdownInput.value;
    const selStart = markdownInput.selectionStart;
    const selEnd = markdownInput.selectionEnd;
    const lineStart = val.lastIndexOf('\n', selStart - 1) + 1;
    let lineEnd = val.indexOf('\n', selEnd);
    if (lineEnd === -1) lineEnd = val.length;
    const lines = val.substring(lineStart, lineEnd).split('\n');

    let delta = 0;
    let num = 0; // đánh số tăng dần trong phạm vi vùng chọn
    const newLines = lines.map((line, i) => {
        const parsed = parseListLine(line);
        const indent = parsed ? parsed.indent : (line.match(/^[ \t]*/) || [''])[0];
        const rest = parsed ? parsed.rest : line.slice(indent.length);

        // Dòng trống trong vùng chọn nhiều dòng: giữ nguyên, không đánh dấu
        if (!parsed && rest.trim() === '' && lines.length > 1) return line;

        // Cùng kiểu đang có: toggle bỏ marker (dòng đơn rỗng marker cũng bỏ)
        if (parsed && parsed.kind === style && (lines.length === 1 || parsed.rest.trim() !== '')) {
            const newLine = indent + rest;
            delta += newLine.length - line.length;
            return newLine;
        }

        // Thêm mới hoặc đổi kiểu marker
        let marker;
        if (style === 'numbered') {
            num++;
            marker = num + '. ';
        } else if (style === 'task') {
            marker = '- [ ] ';
        } else {
            marker = '- ';
        }
        const newLine = indent + marker + rest;
        delta += newLine.length - line.length;
        return newLine;
    });
    if (delta === 0) return;

    // ponytail: đánh số liên tục trên cả vùng chọn kể cả khi giữa có dòng trống;
    // nâng cấp sau: restart về 1 khi gặp đoạn văn mới (dòng trống).
    const newText = val.substring(0, lineStart) + newLines.join('\n') + val.substring(lineEnd);

    // Giữ nguyên vùng bôi đen: marker được thêm/xoá ở ĐẦU dòng, nên selection mới
    // được tính bằng cách dịch theo delta độ dài của từng dòng (cùng cách handleEditorTab).
    const firstLineDelta = newLines[0].length - lines[0].length;
    const newSelStart = selStart > lineStart
        ? Math.max(lineStart, selStart + firstLineDelta)
        : lineStart;
    const newSelEnd = Math.max(newSelStart, selEnd + delta);

    applyEditorChange(newText, newSelStart, newSelEnd);
}

// ----- Hộp thoại dùng chung (Link / Table custom size) -----
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

// Chèn bảng Markdown tại con trỏ, đảm bảo có dòng mới bao quanh
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

// ----- Sự kiện hộp thoại -----
btnLink.addEventListener('click', openLinkDialog);

linkUrlInput.addEventListener('input', () => {
    linkInsertBtn.disabled = linkUrlInput.value.trim() === '';
});

linkInsertBtn.addEventListener('click', insertLinkFromDialog);
linkCancelBtn.addEventListener('click', closeDialogs);
tableInsertBtn.addEventListener('click', insertTableFromDialog);
tableCancelBtn.addEventListener('click', closeDialogs);

// Click nền overlay để đóng
[linkDialog, tableDialog].forEach((overlay) => {
    overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) closeDialogs();
    });
});

// Trong hộp thoại: Enter = nút chính, Esc = đóng, Tab = giữ vòng focus;
// chặn mọi phím khác lọt xuống editor bên dưới.
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

// ----- Đóng dropdown khi bấm ra ngoài hoặc Esc (cùng cơ chế menu Export) -----
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

// ----- Import file Markdown -----

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

// ==========================================================================
// SELF-CHECK (chỉ chạy khi URL có ?selfcheck - dùng console, không framework)
// ==========================================================================
function runSelfCheck() {
    const results = [];
    const assert = (name, cond) => results.push(`${cond ? 'PASS' : 'FAIL'} - ${name}`);

    assert('filename từ heading có dấu', deriveExportBaseName('# Trình soạn thảo Markdown Live\n\nnội dung') === 'trinh-soan-thao-markdown-live');
    assert('filename bỏ ký tự đặc biệt', deriveExportBaseName('# Tiêu đề (v1.2)!') === 'tieu-de-v12');
    assert('filename fallback khi không có heading', deriveExportBaseName('không có heading') === 'document');

    assert('safe url allows https', isSafeExternalUrl('https://example.com/a?b=1') === true);
    assert('safe url allows mailto', isSafeExternalUrl('mailto:a@b.com') === true);
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
    assert('import gate allows extensionless', isImportableFile({ name: 'README', type: '' }) === true);
    assert('import gate rejects exe', isImportableFile({ name: 'a.exe', type: '' }) === false);
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

    // ----- Format bar: helpers thuần -----
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
    assert('heading giữ # trong nội dung', setHeadingLevel('#hashtag', 1).line === '# #hashtag');
    assert('list parse task', parseListLine('- [x] việc').kind === 'task' && parseListLine('- [x] việc').rest === 'việc');
    assert('list parse numbered', parseListLine('2. mục').kind === 'numbered');
    assert('list parse bullet giữ thụt lề', parseListLine('  - a').indent === '  ' && parseListLine('  - a').rest === 'a');
    assert('list từ chối dòng thường', parseListLine('chữ') === null);
    assert('list từ chối dòng trống', parseListLine('') === null);
    assert('list từ chối -5 không cách', parseListLine('-5') === null);
    assert('bảng 2x2 đúng cú pháp', buildTableMarkdown(2, 2) === '| Head | Head |\n| --- | --- |\n|  |  |');
    assert('bảng kẹp giới hạn 1..99', buildTableMarkdown(5, 0) === '| Head |\n| --- |\n|  |\n|  |\n|  |\n|  |');
    assert('url thêm https khi trần', normalizeLinkUrl('example.com') === 'https://example.com');
    assert('url giữ scheme có sẵn', normalizeLinkUrl('mailto:a@b.com') === 'mailto:a@b.com');
    assert('url giữ anchor nội bộ', normalizeLinkUrl('#muc-luc') === '#muc-luc');
    assert('url giữ protocol-relative', normalizeLinkUrl('//cdn.example.com/x') === '//cdn.example.com/x');
    assert('url rỗng trả về rỗng', normalizeLinkUrl('   ') === '');
    assert('escape nhãn link', escapeLinkText('a[b]c') === 'a\\[b\\]c');

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

    if (typeof katex !== 'undefined') {
        // Inline thường: dùng MathML có sẵn trong .katex-mathml, gỡ annotation.
        const inlineHost = document.createElement('div');
        inlineHost.innerHTML = katex.renderToString('E = mc^2', { throwOnError: false, output: 'htmlAndMathml' });
        convertKatexForDoc(inlineHost);
        const inlineMath = inlineHost.querySelector('math');
        assert('katex inline chuyển thành <math> thuần', !!inlineMath && !inlineHost.querySelector('span.katex'));
        assert('katex inline bỏ annotation', !!inlineMath && !inlineMath.querySelector('annotation'));

        // Khối nhiều dòng: phải render lại từ LaTeX nguồn ra MathML phẳng có mtable/mtr.
        const alignedHost = document.createElement('div');
        alignedHost.innerHTML = katex.renderToString(
            String.raw`\begin{aligned} a &= 1 \\ b &= 2 \end{aligned}`,
            { throwOnError: false, displayMode: true, output: 'htmlAndMathml' }
        );
        convertKatexForDoc(alignedHost);
        const alignedMath = alignedHost.querySelector('math');
        assert('katex aligned chuyển thành <math> có mtable', !!alignedMath && !!alignedMath.querySelector('mtable'));
        assert('katex aligned giữ đủ 2 dòng', !!alignedMath && alignedMath.querySelectorAll('mtr').length === 2);

        // Text node trần (tàn dư của annotation bị DOMPurify gỡ ở preview) phải bị dọn.
        const strayHost = document.createElement('div');
        strayHost.innerHTML = katex.renderToString('E = mc^2', { throwOnError: false, output: 'mathml' });
        const strayMath = strayHost.querySelector('math');
        strayMath.appendChild(document.createTextNode('E = mc^2'));
        convertKatexForDoc(strayHost);
        const cleanedMath = strayHost.querySelector('math');
        assert('katex dọn text node trần trong <math>', !!cleanedMath && !Array.from(cleanedMath.childNodes).some(n => n.nodeType === 3 && n.textContent.trim()));

        // KaTeX hỏng (không có .katex-mathml): phải thay bằng text thay vì để lại span rác.
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

// Chạy khởi tạo ứng dụng khi trang web tải xong
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

        // Guard: nếu lucide fail to load thì bỏ qua vẽ icon thay vì văng exception
        // làm hỏng toàn bộ khởi tạo.
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    } finally {
        // Nạp nội dung CUỐI cùng: lần renderMarkdown() đầu tiên phải chạy sau khi
        // mermaid đã initialize và marked đã gắn KaTeX extension, nếu không công
        // thức toán ($...$ / $$...$$) ở lần mở app đầu tiên chỉ hiện chữ thô và
        // phải gõ thêm mới render. Đặt trong finally để editor vẫn có nội dung
        // dù khối init bên trên có ném lỗi.
        loadInitialContent();
    }
});

// Lưu ngay lập tức (không debounce) khi cửa sổ chuẩn bị đóng lại,
// để không bị mất vài trăm mili-giây nội dung gõ cuối cùng.
window.addEventListener('beforeunload', saveContentToStorage);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        saveContentToStorage();
    }
});

window.renderMarkdown = renderMarkdown;