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
| `src/js/editor/content.js` | Loads / replaces editor content (sample, import, restore) and the Reset / Copy buttons. |
| `src/js/editor/default-markdown.js` | Sample Markdown content (first run and on Reset). |
| `src/js/editor/edit.js` | Text-editing operations: Tab, Enter, format wrapping, link, duplicate line. |
| `src/js/editor/events.js` | Editor keyboard events (shortcuts, auto-close brackets) and input events. |
| `src/js/editor/format-actions.js` | Format-bar actions applied to the editor (heading, list, table, code block). |
| `src/js/editor/format-helpers.js` | Pure functions behind the format bar (heading, list, table, link, HTML tag, fence). |
| `src/js/editor/highlight.js` | Syntax-highlight layer behind the textarea, refreshed per frame. |
| `src/js/editor/history.js` | The editor's own Undo / Redo stack. |
| `src/js/editor/storage.js` | Saves / restores editor content in localStorage. |
| `src/js/editor/sync.js` | Post-change sync: char count, highlighting, preview render, draft save. |
| `src/js/editor/syntax/block.js` | Line/block-level Markdown highlighting (heading, list, quote, fence, table...). |
| `src/js/editor/syntax/inline.js` | Inline Markdown highlighting (bold, italic, link, code, math, HTML tag...). |
| `src/js/export/doc-transform.js` | DOM transforms for the DOC file: strip stray ids, blockquote / alert into tables. |
| `src/js/export/doc.js` | Exports a Word (.doc) file from the preview HTML. |
| `src/js/export/file-save.js` | Document title (first H1 outside code fences), export filename (`slugifyText` with diacritics folded) and writing to disk: Tauri's Save As dialog, browser download fallback. |
| `src/js/export/html.js` | Exports a standalone .html file. |
| `src/js/export/images.js` | Image handling for DOC export: SVG -> PNG, image sizing, Mermaid -> PNG. |
| `src/js/export/math-fonts.js` | KaTeX fonts/CSS for formula images: parse `@font-face`, fetch the CSS once, woff2 -> data URI, list fonts a formula uses. |
| `src/js/export/math-image.js` | KaTeX formula -> PNG for the DOC export (SVG `foreignObject` -> canvas); falls back to MathML when a formula fails. |
| `src/js/export/math-mathml.js` | KaTeX formula -> plain MathML for the DOC / HTML export. |
| `src/js/export/menu.js` | The Export dropdown and the file-export buttons, including the .md export and the PDF export (browser Print dialog). |
| `src/js/io/import.js` | Imports Markdown files from disk into the editor. |
| `src/js/main.js` | App entry: initialises the modules in the correct order. |
| `src/js/preview/alerts.js` | GFM Alerts / Callouts ([!NOTE], [!TIP]...) in the preview. |
| `src/js/preview/links.js` | Intercepts preview clicks and opens them in the system browser. |
| `src/js/preview/mermaid-cache.js` | Caches Mermaid SVGs by source so they are not re-rendered. |
| `src/js/preview/render.js` | Renders Markdown -> HTML (marked + DOMPurify + hljs + Mermaid + KaTeX), assigns slug ids to headings so [link](#anchor) works, and preserves scroll position. |
| `src/js/preview/sanitize.js` | DOMPurify config and hooks (block dangerous schemes, open external links safely). |
| `src/js/theme/theme.js` | Light / Dark theme: apply (all 4 preview vendor CSS are preloaded and toggled via `media`, so the switch is one synchronous tick inside a View Transition), persist, follow system theme. |
| `src/js/ui/dialogs.js` | Link insert and table-size dialogs. |
| `src/js/ui/format-toolbar.js` | Format bar: the Heading / List / Table / HTML dropdowns and buttons. |
| `src/js/ui/scroll-sync.js` | Synchronised editor/preview scrolling plus its on/off button. |
| `src/js/ui/view-mode.js` | Editor / Split / Preview view modes and the pane divider. |

### CSS

Load order in `index.html` matters (cascade): tokens -> base -> layout -> format-bar -> dialogs -> toast -> toolbar -> editor -> preview -> print.

| File | Role |
|---|---|
| `src/css/tokens.css` | Colour variables (design tokens) for Light / Dark theme. |
| `src/css/base.css` | Reset and `<body>` background. |
| `src/css/layout.css` | App shell: header, workspace, panes, pane divider, 3 view modes, responsive. |
| `src/css/format-bar.css` | Markdown format bar above the editor (icon buttons, dropdowns, table grid picker). |
| `src/css/dialogs.css` | Input dialogs (Link / table size). |
| `src/css/toast.css` | Toast notifications. |
| `src/css/toolbar.css` | Main toolbar: .btn, Export / View dropdowns, view-mode buttons, theme button. |
| `src/css/editor.css` | Editing area + the Markdown syntax-highlight classes. |
| `src/css/preview.css` | Preview area: GFM Alerts, Mermaid, task lists. |
| `src/css/print.css` | Print / PDF export rules. |

Other paths:

- `src/vendor/` — locally bundled third-party libs (marked, marked-katex-extension, katex + `fonts/`, mermaid, highlight.js, purify, lucide, github-markdown-light.css, hljs-github.min.css). App must stay fully offline: never add CDN links.
- `src-tauri/src/lib.rs` — Rust backend; only `greet` command + `clipboard-manager`, `opener`, `dialog`, `fs` plugins. Real logic lives in JS.
- `scripts/sync-version.js` — version/cache-bust sync script (see below).

## Module init order

- `initSanitizer()` runs first: the DOMPurify config is a global hook, not a per-call option. Render before it and the output is unsanitised.
- `loadInitialContent()` is last **on purpose** (`src/js/main.js:35-58`): it calls `renderMarkdown()`, which must run after `mermaid.initialize()`, `marked.use(katexExt)`, and `lucide.createIcons()`, or the first paint shows raw `$$...$$`. It sits in a `finally` so a throwing vendor guard still leaves the editor populated — do not hoist it out.
- `window.renderMarkdown` (`src/js/main.js:60`) is a deliberate global escape hatch. Don't re-export it from modules.

## Commands

- `npm install` — install only dep (`@tauri-apps/cli`); requires Node 20+ and Rust stable + Tauri v2 OS prerequisites.
- `npm run tauri dev` — dev with hot-reload. Required verification before PR (per README Contributing).
- `npm run tauri build` — full build (NSIS/MSI). CI (`release.yml`) runs `npm run tauri -- build` then copies 3 artifacts to the repo root: `Markdown-Live-Portable.exe`, `Markdown-Live-Setup.exe` (NSIS), `Markdown-Live-Setup.msi`.
- No test/lint/format commands exist — don't invent them. The one runnable check is `src/js/dev/selfcheck.js`: append `?selfcheck` to the app URL (e.g. in `npm run tauri dev`) to run it.

## Versioning gotcha

- Source of truth is `src-tauri/tauri.conf.json` `"version"` (check file; root `package.json` version (`0.1.0`) is stale — ignore it).
- `node scripts/sync-version.js` runs automatically via `beforeDevCommand`/`beforeBuildCommand` in `tauri.conf.json`: it copies the tauri.conf version into `src-tauri/Cargo.toml` `[package] version` and `?v=<version>` cache-busters on every css/js `href`/`src` in `src/index.html` (including the 4 `link[data-theme-css]` vendor files). Writes are atomic (tmp+rename) and skipped when unchanged; `--set` validates semver and refuses to run on garbage.
- To bump: `node scripts/sync-version.js --set X.Y.Z` (strips leading `v`). Never hand-edit `?v=` strings or `Cargo.toml` version alone.
- Only `index.html` carries `?v=`; the module files under `src/js/` have no query string, so the one on `main.js` does not cache-bust its imports.
- Release: push tag `v*` (or manual `workflow_dispatch` with `version`) → `.github/workflows/release.yml` runs `--set`, builds on `windows-latest`, publishes 3 files (portable `.exe` + NSIS `.exe` + `.msi`). Only `workflow_dispatch` commits the version bump back.

## Tauri config notes

- `tauri.conf.json`: `frontendDist` is `../src`, targets `nsis`/`msi`.
- Permissions live in `src-tauri/capabilities/default.json` (`core`, `opener`, `clipboard-manager` + `allow-write-text`, `dialog`, `fs:allow-write-text-file` scoped to `$HOME/**`). Frontend only writes to dialog-picked paths via `saveTextFile()`; CSP stays `null` (local-only app) so XSS must be handled in JS (fail-closed DOMPurify + mermaid re-sanitize + external-URL allowlist). Add new plugin permissions there, not in Rust code.
- Vendor scripts stay `defer` in declared order (`lucide, marked, purify, highlight, mermaid, katex, marked-katex-extension`).