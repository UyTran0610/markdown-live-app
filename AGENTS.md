# AGENTS.md — Markdown Live

Tauri v2 + vanilla JS/HTML/CSS offline-first Markdown editor. No framework, no bundler, no tests/lint/typecheck.

## Structure

Entry: `src/js/main.js` (ES module). Every module exports an `initXxx()` that only registers listeners; `main.js` calls them in a fixed order (see Module init order) and owns the only `DOMContentLoaded` logic.

| Module | Role |
|---|---|
| `src/js/core/dom.js` | References to the app's DOM elements (queried once, imported by other modules). |
| `src/js/core/toast.js` | Small corner-of-screen toast notifications. |
| `src/js/core/utils.js` | Shared helpers: debounce, safe external-URL check, `slugifyText` (slug shared by heading ids and export filenames). |
| `src/js/dev/selfcheck.js` | Quick self-check suite (open the app with `?selfcheck` to run). |
| `src/js/editor/content.js` | The Copy button. |
| `src/js/editor/edit.js` | Text-editing operations: Tab, Enter, format wrapping, link, duplicate line. |
| `src/js/editor/events.js` | Editor keyboard events (shortcuts, auto-close brackets) and input events. |
| `src/js/editor/format-actions.js` | Format-bar actions applied to the editor (heading, list, table, code block). |
| `src/js/editor/format-helpers.js` | Pure functions behind the format bar (heading, list, table, link, HTML tag, fence). |
| `src/js/editor/highlight.js` | Syntax-highlight layer behind the textarea, refreshed per frame. |
| `src/js/editor/history.js` | The editor's own Undo / Redo stack. |
| `src/js/editor/sync.js` | Post-change sync: char count, highlighting, preview render, push the new text into the active tab, save the session. |
| `src/js/editor/syntax/block.js` | Line/block-level Markdown highlighting (heading, list, quote, fence, table...). |
| `src/js/editor/syntax/inline.js` | Inline Markdown highlighting (bold, italic, link, code, math, HTML tag...). |
| `src/js/export/doc-transform.js` | DOM transforms for the DOC file: strip stray ids, blockquote / alert into tables. |
| `src/js/export/doc.js` | Exports a Word (.doc) file from the preview HTML. |
| `src/js/export/file-save.js` | Document title (first H1 outside code fences), export filename (`slugifyText` with diacritics folded) and disk I/O behind the fs ACL: `readTextFile` / `writeTextFile` (open tab vs. Save As) and Tauri's Save As dialog, browser download fallback. |
| `src/js/export/html.js` | Exports a standalone .html file. |
| `src/js/export/images.js` | Image handling for DOC export: SVG -> PNG, image sizing, Mermaid -> PNG. |
| `src/js/export/math-fonts.js` | KaTeX fonts/CSS for formula images: parse `@font-face`, fetch the CSS once, woff2 -> data URI, list fonts a formula uses. |
| `src/js/export/math-image.js` | KaTeX formula -> PNG for the DOC export (SVG `foreignObject` -> canvas); falls back to MathML when a formula fails. |
| `src/js/export/math-mathml.js` | KaTeX formula -> plain MathML for the DOC / HTML export. |
| `src/js/export/menu.js` | The Export dropdown and the file-export buttons, including the .md export and the PDF export (browser Print dialog). |
| `src/js/io/documents.js` | The tab / document store: open tabs, per-tab content + dirty state + undo stack, reading and writing the files behind them, and the localStorage session (tab list, active tab, drafts). Still ONE textarea — switching tabs just reassigns `markdownInput.value`, so every other module keeps reading it. |
| `src/js/main.js` | App entry: initialises the modules in the correct order. |
| `src/js/preview/alerts.js` | GFM Alerts / Callouts ([!NOTE], [!TIP]...) in the preview. |
| `src/js/preview/links.js` | Intercepts preview clicks and opens them in the system browser. |
| `src/js/preview/mermaid-cache.js` | Caches Mermaid SVGs by source so they are not re-rendered. |
| `src/js/preview/render.js` | Renders Markdown -> HTML (marked + DOMPurify + hljs + Mermaid + KaTeX), assigns slug ids to headings so [link](#anchor) works, and preserves scroll position. |
| `src/js/preview/sanitize.js` | DOMPurify config and hooks (block dangerous schemes, open external links safely). |
| `src/js/theme/theme.js` | Light / Dark theme: apply (all 4 preview vendor CSS are preloaded and toggled via `media`, so the switch is one synchronous tick inside a View Transition), persist, follow system theme. |
| `src/js/ui/about.js` | The About dialog (logo, name, version) and the LICENSE / THIRD_PARTY_NOTICES reader. |
| `src/js/ui/dialogs.js` | Link insert and table-size dialogs. |
| `src/js/ui/format-toolbar.js` | Format bar: the Heading / List / Table / HTML dropdowns and buttons. |
| `src/js/ui/scroll-sync.js` | Synchronised editor/preview scrolling plus its on/off button. |
| `src/js/ui/tabs.js` | The tab strip: renders the open tabs, the unsaved dot, close / new-tab buttons and the Save button state. |
| `src/js/ui/view-mode.js` | Editor / Split / Preview view modes and the pane divider. |
| `src/js/ui/window-controls.js` | The self-drawn titlebar's Minimize / Maximize-Restore / Close buttons (native frame is off) and the maximize-state glyph. |

### CSS

Load order in `index.html` matters (cascade): tokens -> base -> layout -> format-bar -> dialogs -> toast -> toolbar -> tabs -> editor -> preview -> print.

| File | Role |
|---|---|
| `src/css/tokens.css` | Colour variables (design tokens) for Light / Dark theme. |
| `src/css/base.css` | Reset and `<body>` background. |
| `src/css/layout.css` | App shell: header — self-drawn titlebar (drag region, tab strip, window buttons) above the toolbar — workspace, panes, pane divider, 3 view modes, responsive. |
| `src/css/format-bar.css` | Markdown format bar above the editor (icon buttons, dropdowns, table grid picker). |
| `src/css/dialogs.css` | Dialogs: Link / table size and the About ("?") dialog (open / close + view switch animation). Hidden via `visibility` + `pointer-events: none`, never `display: none` — that would kill the transition. |
| `src/css/toast.css` | Toast notifications. |
| `src/css/toolbar.css` | Main toolbar: .btn, Export / View dropdowns, view-mode buttons, theme button. |
| `src/css/tabs.css` | Tab strip above the toolbar. Reuses the `.btn` / `.btn.active` tokens, no new colours. |
| `src/css/editor.css` | Editing area + the Markdown syntax-highlight classes. |
| `src/css/preview.css` | Preview area: GFM Alerts, Mermaid, task lists. |
| `src/css/print.css` | Print / PDF export rules. |

Other paths:

- `src/vendor/` — locally bundled third-party libs (marked, marked-katex-extension, katex + `fonts/`, mermaid, highlight.js, purify, lucide, github-markdown-light/dark.css, hljs-github.min.css, hljs-github-dark.min.css). `highlight.min.js` is a hand-built 193-language esbuild bundle — npm ships no browser build, so `scripts/vendor-update.js` keeps it in `MANUAL_PACKAGES` and documents the rebuild recipe in its header comment. App must stay fully offline: never add CDN links.
- `src-tauri/src/lib.rs` — Rust backend; only `greet` command + `clipboard-manager`, `opener`, `dialog`, `fs` plugins. Real logic lives in JS.
- `scripts/sync-version.js` — version/cache-bust sync script (see below).

## Module init order

- `initSanitizer()` first: DOMPurify config is a global hook, not a per-call option — render earlier and the output is unsanitised.
- `initTabs()` before `restoreSession()`: the store emits on restore, and the tab strip must already be subscribed.
- `restoreSession()` last, inside a `finally` (`src/js/main.js`): it renders, so it must follow `mermaid.initialize()`, `marked.use(katexExt)` and `lucide.createIcons()`, or the first paint shows raw `$$`.
- `window.renderMarkdown` (`src/js/main.js`) is a deliberate global escape hatch — don't re-export it.

## Tabs gotcha

- Still one textarea. Switching tabs is `markdownInput.value = tab.content`; every module that reads the editor keeps working unchanged. Don't add per-tab DOM.
- `syncEditorAfterChange()` (`src/js/editor/sync.js`) is the only hook that needs to know a tab exists — it covers `input`, format actions, undo and redo. Add editor behaviour there, not at each call site.
- `savedContent === null` means "never written to disk" and is therefore always dirty. The session stores only a `dirty` boolean and rebuilds `savedContent` on load — it never re-reads the file, so unsaved drafts survive a restart.
- Undo stacks are per tab: `switchTab` must `clearTimeout(editorHistory.typingTimer)` before restoring a stack, or the pending timer pushes the new tab's text into the old tab's history.

## Commands

- `npm install` — only dep is `@tauri-apps/cli` (Node 20+, Rust stable).
- `npm run tauri dev` — dev; required verification before a PR. `npm run tauri build` — NSIS/MSI; CI publishes `Markdown-Live-Portable.exe`, `Markdown-Live-Setup.exe`, `Markdown-Live-Setup.msi`.
- No test/lint/format commands exist. The one runnable check is `?selfcheck` on the app URL (`src/js/dev/selfcheck.js`).

## Versioning gotcha

- Source of truth is `src-tauri/tauri.conf.json` `"version"`; root `package.json` is stale — ignore it.
- Bump only via `node scripts/sync-version.js --set X.Y.Z`. It auto-runs on dev/build, copying the version into `Cargo.toml`, cache-busting `?v=` in `index.html`, and rewriting `<meta name="app-version">` (the version the About dialog displays, read by `src/js/ui/about.js`). Never hand-edit `?v=`, `app-version` or `Cargo.toml`.
- Only `index.html` carries `?v=`; `src/js/**` modules have no query string. Release: push tag `v*` → `.github/workflows/release.yml`.

## Tauri config notes

- New plugin permissions go in `src-tauri/capabilities/default.json`, never in Rust code. `frontendDist` is `../src`, targets `nsis`/`msi`.
- The main window is `"decorations": false`, so Windows draws no titlebar (no app icon, no title, no buttons): the app draws that row itself (`.titlebar` in `src/css/layout.css`, markup in `index.html`): app icon (icon only, no title text), tab strip, drag region, window buttons. `data-tauri-drag-region` goes on the exact elements that may be dragged (`#tab-strip`, `.titlebar-drag`) — the attribute is not inherited by children, and putting it on the `.titlebar` container would turn the tabs and the buttons into drag handles. Drag, minimize, maximize/restore and close run through `core:window:allow-start-dragging`, `allow-minimize`, `allow-toggle-maximize` and `allow-close`; double-click on the drag region is Tauri's own `internal-toggle-maximize`, already covered by `core:default`.
- Price of dropping the native frame: Windows 11 Snap Layouts on hovering the Maximize button is gone (it needs a native `WM_NCHITTEST`/`HTMAXBUTTON` hit test, i.e. a Rust plugin). `Win` + arrow snapping is expected to keep working but is unverified here.
- CSP stays `null`, so XSS defence is JS's job: fail-closed DOMPurify, Mermaid re-sanitize, external-URL allowlist.
- Vendor scripts stay `defer` in order: lucide, marked, purify, highlight, mermaid, katex, marked-katex-extension.