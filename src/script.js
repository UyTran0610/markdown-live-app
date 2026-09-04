// Nội dung Markdown mặc định khi tải trang hoặc ấn Reset
const defaultMarkdown = `# Trình soạn thảo Markdown Live

Chào mừng bạn đến với **Markdown Live**! Đây là một ứng dụng hỗ trợ soạn thảo và xem trước nội dung Markdown trong thời gian thực.

## Các chức năng chính:
- **Bảo mật XSS**: Tự động lọc sạch mã độc hại với DOMPurify.
- **Đồng bộ cuộn (Sync Scroll)**: Cuộn song song cả 2 khung soạn thảo và xem trước.
- **Copy**: Sao chép nhanh mã nguồn Markdown.
- **Export PDF**: Xuất trực tiếp nội dung Preview thành định dạng PDF với **văn bản chọn được (Selectable Text)**.
- **Reset**: Đưa dữ liệu về văn bản mẫu ban đầu này bất kỳ lúc nào.

---

## Tính năng nâng cao chuyên nghiệp:

### 1. Hộp thông báo đặc biệt (GFM Alerts / Callouts)
> [!NOTE]
> Đây là một ghi chú quan trọng giúp người đọc lưu ý thông tin nhanh.

> [!TIP]
> Gợi ý cách làm việc hiệu quả hơn hoặc một mẹo nhỏ hữu ích.

> [!IMPORTANT]
> Đây là thông tin cực kỳ quan trọng không thể bỏ qua.

> [!WARNING]
> Cảnh báo rủi ro có thể xảy ra lỗi nếu thao tác sai.

> [!CAUTION]
> Khuyến cáo nguy hiểm về nguy cơ mất mát dữ liệu hoặc hỏng hóc.

---

### 2. Danh sách công việc (Task List)
- [x] Tích hợp DOMPurify ngăn chặn tấn công XSS
- [x] Cải tiến bộ tô màu cú pháp Editor (Escape, Footnote, Reference Link, Tasklist)
- [ ] Thử nghiệm tạo tài liệu Markdown của riêng bạn

---

### 3. Công thức toán học (LaTeX/Math)
- Viết cùng dòng (inline): $E = mc^2$ hoặc đường chéo tam giác $c = \\sqrt{a^2 + b^2}$.
- Viết khối hiển thị trung tâm (block display):
$$
f(x) = \\int_{-\\infty}^{\\infty} e^{-x^2} dx
$$

---

### 4. Biểu đồ trực quan (Mermaid Diagrams)
\`\`\`mermaid
graph TD
    A[Bắt đầu] --> B(Soạn thảo Markdown)
    B --> C{Xem trước?}
    C -- Có --> D[Hiển thị HTML]
    C -- Không --> E[Tiếp tục viết]
    D --> F[Xuất bản PDF]
\`\`\`

---

### 5. Tô màu cú pháp (Syntax Highlighting)
\`\`\`javascript
// Một đoạn code Javascript đơn giản
function helloWorld() {
    console.log("Xin chào từ Markdown Live!");
}
helloWorld();
\`\`\`

---

### 6. Thoát ký tự (Escape), Liên kết tham chiếu
- Thoát ký tự đặc biệt không bị format: \\*không in nghiêng\\*, \\# không phải tiêu đề.
- Liên kết tự động (Autolink): <https://github.com> hoặc email <support@example.com>.
- Liên kết tham chiếu: Tìm kiếm tại [Google][google-ref] hoặc đọc tài liệu [Markdown Guide][md-guide].

[google-ref]: https://www.google.com "Công cụ tìm kiếm Google"
[md-guide]: https://www.markdownguide.org "Tài liệu Markdown chính thức"

---

### 7. Bảng biểu (Table)

| Tên công cụ | Tính năng | Trạng thái |
| :--- | :--- | :--- |
| Marked JS | Chuyển đổi Markdown | Đã tích hợp |
| DOMPurify | Bảo mật XSS | Đã tích hợp |
| Lucide | Bộ Icon tối giản | Đã tích hợp |

### 8. Trích dẫn thông thường (Blockquote)
> "Sự đơn giản là độ tinh tế tối thượng." — *Leonardo da Vinci*

---
Hãy chỉnh sửa thử nội dung ở khung bên trái và quan sát sự thay đổi tức thì ở khung bên phải nhé!
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
const btnPdf = document.getElementById('btn-pdf');
const btnTheme = document.getElementById('btn-theme');
const toast = document.getElementById('toast');

// Các thẻ <link> có thể hoán đổi phiên bản sáng/tối (được thiết lập ban đầu ở <head>)
const markdownThemeLink = document.getElementById('theme-markdown-css');
const hljsThemeLink = document.getElementById('theme-hljs-css');
const THEME_STORAGE_KEY = 'markdown-live-theme';

// Khởi tạo trạng thái ứng dụng
let isSyncScrollEnabled = true;
let activeScrollSource = null;
let mermaidTimeout = null;

// Cache kết quả vẽ Mermaid theo đúng nội dung mã nguồn: nếu 1 khối biểu đồ không
// thay đổi giữa 2 lần render, ta dùng lại SVG đã vẽ thay vì bắt mermaid.run() tính lại
// từ đầu (thao tác tốn 50-200ms/biểu đồ). Cache sẽ bị xoá mỗi khi đổi theme vì màu
// sắc SVG đã vẽ gắn liền với theme lúc vẽ.
const mermaidCache = new Map();
const MERMAID_CACHE_LIMIT = 60;
function cacheMermaidResult(code, html) {
    if (mermaidCache.has(code)) mermaidCache.delete(code);
    mermaidCache.set(code, html);
    if (mermaidCache.size > MERMAID_CACHE_LIMIT) {
        mermaidCache.delete(mermaidCache.keys().next().value);
    }
}

// ==========================================================================
// CHUYỂN ĐỔI GIAO DIỆN SÁNG / TỐI (Light / Dark Theme)
// ==========================================================================

// Lấy theme hiện tại đang áp dụng trên thẻ <html> (đã được thiết lập sớm ở <head>)
function getCurrentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

// Áp dụng theme: cập nhật thuộc tính data-theme, hoán đổi CSS bên ngoài (markdown/hljs)
// và đồng bộ theme của Mermaid. persist=true khi người dùng chủ động bấm nút chuyển đổi.
function applyTheme(theme, persist) {
    document.documentElement.setAttribute('data-theme', theme);

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

// Nút Bật/Tắt giao diện Sáng / Tối
if (btnTheme) {
    btnTheme.addEventListener('click', () => {
        const nextTheme = getCurrentTheme() === 'dark' ? 'light' : 'dark';
        applyTheme(nextTheme, true);
        // Xoá cache Mermaid vì SVG cũ mang màu của theme trước, không dùng lại được
        mermaidCache.clear();
        // Vẽ lại Preview để cập nhật màu Highlight.js / Mermaid theo theme mới
        if (typeof renderMarkdown === 'function') renderMarkdown();
        showToast(nextTheme === 'dark' ? "Đã chuyển sang giao diện Tối" : "Đã chuyển sang giao diện Sáng");
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
            mermaidCache.clear();
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

    // 11. In đậm: **text** hoặc __text__
    text = text.replace(/(\*\*|__)([^*_\n]+?)\1/g, (m, d, c) =>
        protect(`<span class="md-bold">${d}${c}${d}</span>`));

    // 12. In nghiêng: *text* hoặc _text_
    text = text.replace(/(\*|_)([^*_\n]+?)\1/g, (m, d, c) =>
        protect(`<span class="md-italic">${d}${c}${d}</span>`));

    // 13. Gạch ngang giữa chữ: ~~text~~
    text = text.replace(/(~~)([^~\n]+?)\1/g, (m, d, c) =>
        protect(`<span class="md-strikethrough">${d}${c}${d}</span>`));

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
        const escapedWithPipes = escapeHtml(line).replace(/\|/g, '<span class="md-table-pipe">|</span>');
        return highlightInline(escapedWithPipes);
    }

    // Dòng văn bản thông thường (paragraph)
    return highlightInline(escapeHtml(line));
}

// Hàm quét toàn bộ nội dung Markdown, xử lý khối code (```...```) và khối toán ($$...$$)
function highlightMarkdown(text) {
    const lines = text.split('\n');
    let inFence = false;
    let inMathBlock = false;

    const outputLines = lines.map((line) => {
        const fenceMatch = line.match(/^(\s{0,3})(`{3,}|~{3,})(.*)$/);
        if (fenceMatch) {
            if (!inFence) {
                inFence = true;
                const [, indent, marker, lang] = fenceMatch;
                return `${escapeHtml(indent)}<span class="md-fence-marker">${escapeHtml(marker)}</span><span class="md-fence-lang">${escapeHtml(lang)}</span>`;
            } else {
                inFence = false;
                const [, indent, marker] = fenceMatch;
                return `${escapeHtml(indent)}<span class="md-fence-marker">${escapeHtml(marker)}</span>`;
            }
        }

        if (inFence) {
            return `<span class="md-code-block">${escapeHtml(line)}</span>`;
        }

        if (inMathBlock) {
            if (/^\s*\$\$\s*$/.test(line) || line.trim().endsWith('$$')) {
                inMathBlock = false;
            }
            return `<span class="md-math">${escapeHtml(line)}</span>`;
        }

        if (/^\s*\$\$/.test(line) && !/^\s*\$\$.+\$\$\s*$/.test(line)) {
            inMathBlock = true;
            return `<span class="md-math">${escapeHtml(line)}</span>`;
        }

        return highlightMarkdownLine(line);
    });

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
function showToast(message) {
    toast.textContent = message;
    toast.classList.remove('hidden');
    setTimeout(() => {
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
        if (node.tagName === 'A' && node.hasAttribute('href')) {
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
    const rawText = markdownInput.value;
    
    // 1. Chuyển đổi Markdown sang HTML
    const dirtyHtml = marked.parse(rawText);

    // 2. Bảo mật XSS: Khử độc HTML bằng DOMPurify
    const cleanHtml = typeof DOMPurify !== 'undefined'
        ? DOMPurify.sanitize(dirtyHtml, {
            USE_PROFILES: { html: true, mathMl: true, svg: true },
            ADD_ATTR: ['target', 'rel']
        })
        : dirtyHtml;

    previewOutput.innerHTML = cleanHtml;
    charCounter.textContent = `${rawText.length} ký tự`;

    // 3. Chuyển đổi các khối blockquote đặc biệt thành GFM Alerts
    processGFMAlerts();

    // 4. Tô màu mã nguồn (Syntax Highlighting) bằng Highlight.js
    if (typeof hljs !== 'undefined') {
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
        if (nodesToRender.length > 0) {
            mermaidTimeout = setTimeout(() => {
                mermaid.run({
                    nodes: nodesToRender,
                    suppressErrors: true
                }).then(() => {
                    // Lưu lại SVG vừa vẽ để tái sử dụng cho các lần render sau
                    nodesToRender.forEach((node) => {
                        const code = codeByNode.get(node);
                        if (code && node.innerHTML) {
                            cacheMermaidResult(code, node.innerHTML);
                        }
                    });
                }).catch(err => {
                    console.warn("Mermaid render error (đang soạn thảo sơ đồ chưa hoàn thiện):", err);
                });
            }, 300);
        }
    }

    // 6. Cập nhật và vẽ lại tất cả icon từ Lucide
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
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
        // Nếu nội dung hiện tại chưa kịp lưu vào lịch sử, lưu lại trước khi lùi
        if (this.stack[this.index] && this.stack[this.index].val !== el.value) {
            this.push(el.value, el.selectionStart, el.selectionEnd);
            this.index--;
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
    charCounter.textContent = `${markdownInput.value.length} ký tự`;
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
        if (before === wrapper && after === wrapper) {
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
        const insert = '[liên kết](url)';
        const newText = val.substring(0, selStart) + insert + val.substring(selEnd);
        // Bôi đen sẵn chữ "url" để người dùng dán link vào
        applyEditorChange(newText, selStart + 10, selStart + 13);
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

// Hàm gán lại dữ liệu mặc định
function loadDefaultContent() {
    markdownInput.value = defaultMarkdown;
    editorHistory.stack = [];
    editorHistory.index = -1;
    editorHistory.saveCurrentState(markdownInput);
    updateEditorHighlight();
    renderMarkdown();
    markdownInput.scrollTop = 0;
    previewOutput.scrollTop = 0;
    editorHighlight.scrollTop = 0;
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

// Sự kiện nhập liệu trong Editor
markdownInput.addEventListener('input', (e) => {
    charCounter.textContent = `${markdownInput.value.length} ký tự`;
    scheduleEditorHighlight();
    debouncedRender();

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

markdownInput.addEventListener('touchstart', () => activeScrollSource = markdownInput, { passive: true });
previewOutput.addEventListener('touchstart', () => activeScrollSource = previewOutput, { passive: true });

// Gộp các lần xử lý scroll-sync theo khung hình (rAF) để tránh đọc liên tục
// scrollHeight/scrollTop (buộc trình duyệt tính lại layout) trên từng sự kiện scroll dồn dập.
let editorScrollTicking = false;
let previewScrollTicking = false;

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
    if (previewScrollTicking) return;
    previewScrollTicking = true;
    requestAnimationFrame(() => {
        previewScrollTicking = false;
        handleScroll(previewOutput, markdownInput);
    });
});

// Đảm bảo tất cả liên kết khi nhấp vào trong vùng Preview luôn mở tab mới
previewOutput.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (link && link.getAttribute('href')) {
        const href = link.getAttribute('href');
        // Bỏ qua các liên kết neo nội bộ (ví dụ: #muc-luc)
        if (!href.startsWith('#')) {
            link.setAttribute('target', '_blank');
            link.setAttribute('rel', 'noopener noreferrer nofollow');
        }
    }
});

// Nút Bật/Tắt Sync Scroll
btnSync.addEventListener('click', () => {
    isSyncScrollEnabled = !isSyncScrollEnabled;
    btnSync.classList.toggle('active', isSyncScrollEnabled);
    showToast(isSyncScrollEnabled ? "Đã bật đồng bộ cuộn trang" : "Đã tắt đồng bộ cuộn trang");
});

// Nút Reset
btnReset.addEventListener('click', () => {
    if (confirm("Bạn có chắc chắn muốn khôi phục lại văn bản mẫu không? Hành động này sẽ ghi đè nội dung hiện tại của bạn.")) {
        loadDefaultContent();
        showToast("Đã khôi phục dữ liệu mẫu!");
    }
});

// Nút Copy nội dung Markdown
btnCopy.addEventListener('click', () => {
    const textToCopy = markdownInput.value;
    const copyPromise = (window.__TAURI__ && window.__TAURI__.clipboardManager)
        ? window.__TAURI__.clipboardManager.writeText(textToCopy)
        : navigator.clipboard.writeText(textToCopy);

    copyPromise
        .then(() => showToast("Đã sao chép Markdown vào khay nhớ tạm!"))
        .catch(() => showToast("Có lỗi xảy ra khi sao chép."));
});

// Nút Xuất file PDF với văn bản vector chọn được (Selectable Text & Searchable)
btnPdf.addEventListener('click', () => {
    showToast("Đang chuẩn bị trang in / xuất file PDF...");
    setTimeout(() => {
        window.print();
    }, 200);
});

// Chạy khởi tạo ứng dụng khi trang web tải xong
window.addEventListener('DOMContentLoaded', () => {
    if (typeof mermaid !== 'undefined') {
        mermaid.initialize({ startOnLoad: false, theme: getCurrentTheme() === 'dark' ? 'dark' : 'default' });
    }

    if (typeof markedKatex !== 'undefined') {
        const katexExt = typeof markedKatex === 'function' ? markedKatex : markedKatex.markedKatex;
        if (katexExt) {
            marked.use(katexExt({ throwOnError: false }));
        }
    }

    lucide.createIcons();
    loadDefaultContent();
});

window.renderMarkdown = renderMarkdown;