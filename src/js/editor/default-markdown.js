// js/editor/default-markdown.js — Nội dung Markdown mẫu (lần mở đầu và khi bấm Reset).

export const defaultMarkdown = `# Markdown Live Editor

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
