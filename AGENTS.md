# AGENTS.md — Markdown Live

Tauri v2 + vanilla JS/HTML/CSS offline-first Markdown editor. No framework, no bundler, no tests/lint/typecheck.

## Layout

`src/index.html` is the only HTML file (Tauri `frontendDist` is `../src`). Its load order is a hard constraint:

- CSS (`src/css/*.css`): `tokens` -> `base` -> `layout` -> `format-bar` -> `dialogs` -> `toast` -> `toolbar` -> `tabs` -> `editor` -> `preview` -> `print`
- scripts, all `defer`, in order: lucide, marked, purify, highlight, mermaid, katex, marked-katex-extension

`src/js/main.js` imports each module, calls its `initXxx()` in a fixed order (see Init order) and owns the only `DOMContentLoaded`. Most modules export one `initXxx()` that only registers listeners; the exceptions are `dev/selfcheck.js` (`runSelfCheck`), `io/documents.js` and `preview/render.js`, which export their functions directly.

| Path | Role |
|---|---|
| `src/js/core/` | `dom.js` (DOM refs, queried once), `toast.js`, `utils.js` (debounce, external-URL allowlist, `slugifyText` — the slug shared by heading ids and export filenames). |
| `src/js/editor/` | `events.js` (keyboard shortcuts, auto-close brackets), `edit.js` (Tab / Enter / format wrapping / link / duplicate line), `content.js` (Copy), `highlight.js` (highlight layer behind the textarea), `history.js` (Undo / Redo), `syntax/{block,inline}.js` (block-level and inline Markdown highlighting), `format-actions.js` + `format-helpers.js` (format bar; the helpers are pure). |
| `src/js/preview/` | `render.js` (marked + DOMPurify + hljs + Mermaid + KaTeX, slug ids so `[link](#anchor)` works, scroll preservation), `sanitize.js` (DOMPurify config + hooks), `alerts.js` (GFM callouts), `links.js`, `mermaid-cache.js`. |
| `src/js/export/` | `menu.js` (Export dropdown, PDF via the browser Print dialog), `file-save.js` (document title = first H1 outside code fences; filename = `slugifyText` with diacritics folded; `readTextFile` / `writeTextFile` open-tab vs. Save As; Tauri's Save As dialog; browser download fallback), `doc.js` + `doc-transform.js`, `html.js`, `images.js` (SVG and Mermaid -> PNG), `math-image.js` / `math-fonts.js` / `math-mathml.js` (KaTeX -> PNG for DOC, MathML for DOC / HTML). |
| `src/js/io/documents.js` | The tab / document store — see Tabs gotcha. |
| `src/js/ui/` | `tabs.js` (tab strip: unsaved dot, close / new-tab, Save button state, drag-to-reorder — lift with `position:fixed`, FLIP the rest, commit with `moveTab()`), `view-mode.js` (Editor / Split / Preview + pane divider), `format-toolbar.js`, `dialogs.js`, `about.js`, `scroll-sync.js`, `window-controls.js` (the self-drawn titlebar's window buttons). |
| `src/js/theme/theme.js` | Light / Dark apply, persist, follow system. All 4 preview vendor CSS are preloaded and toggled via `media`, so the switch is one synchronous tick inside a View Transition. |
| `src/js/dev/selfcheck.js` | Quick self-check suite (`?selfcheck`). |
| `src/css/` | One file per area, in the load order above. `dialogs.css` hides dialogs with `visibility` + `pointer-events: none`, never `display: none` — that would kill the transition. `tabs.css` reuses the `.btn` / `.btn.active` tokens, no new colours. `print.css` holds the print / PDF rules. |
| `src/vendor/` | Locally bundled third-party libs. `highlight.min.js` is a hand-built 193-language esbuild bundle — npm ships no browser build, so `scripts/vendor-update.js` keeps it in `MANUAL_PACKAGES` and documents the rebuild recipe in its header comment. Must stay fully offline: never add CDN links. |
| `src-tauri/src/lib.rs` | Rust backend; only `greet` command + `clipboard-manager`, `opener`, `dialog`, `fs` plugins. Real logic lives in JS. |

## Init order

- `initSanitizer()` first: DOMPurify config is a global hook, not a per-call option — render earlier and the output is unsanitised.
- `initTabs()` before `restoreSession()`: the store emits on restore, and the tab strip must already be subscribed.
- `restoreSession()` last, inside a `finally` (`src/js/main.js`): it renders, so it must follow `mermaid.initialize()`, `marked.use(katexExt)` and `lucide.createIcons()`, or the first paint shows raw `$$`.
- `window.renderMarkdown` (`src/js/main.js`) is a deliberate global escape hatch — don't re-export it.

## Tabs gotcha

- Still one textarea. Switching tabs is `markdownInput.value = tab.content`; every module that reads the editor keeps working unchanged. Don't add per-tab DOM.
- `syncEditorAfterChange()` (`src/js/editor/sync.js`) is the only hook that needs to know a tab exists — it covers `input`, format actions, undo and redo. Add editor behaviour there, not at each call site.
- `savedContent === null` means "never written to disk" and is therefore always dirty. It is also how a tab reads back as unsaved when its content could not be re-read from disk. The session stores only a `dirty` boolean and rebuilds `savedContent` on load for tabs that keep their content; a clean tab with a `path` is restored by reading the file again.
- Session content is per-tab, and only for tabs that still have something to protect (`sessionKeepsContent`: dirty, or no `path`). Clean tabs serialise `content: null` and `restoreSession()` reads them back from disk — it is `async`, so `main.js` awaits it and self-check waits on the same `ready` promise. Quota is ~5M chars for the whole origin while one file may be 5M, so storing everything can never succeed; on a failed `setItem` the key is deleted rather than left stale, because a stale session restores outdated content that then looks saved.
- `eol` and `bom` must round-trip through the session too: BOM is stripped on read (`U+FEFF` before `#` would otherwise kill the first heading and the export title) and written back on save, exactly like EOL.
- Order *is* the array: `tabs` order is the visual order and the persisted one, so reordering is `moveTab()` + `emit()` — no order field. `render()` calls `tabStrip.replaceChildren()`, so the drag must edit the DOM directly while dragging and only touch the store on drop.
- Undo stacks are per tab: `switchTab` must `clearTimeout(editorHistory.typingTimer)` before restoring a stack, or the pending timer pushes the new tab's text into the old tab's history.

## Commands

- `npm install` — deps are `@tauri-apps/cli` (dev) and `@tauri-apps/plugin-clipboard-manager` (Node 20+, Rust stable).
- `npm run vendor` — `scripts/vendor-update.js`, refreshes `src/vendor/`.
- `npm run tauri build` — NSIS/MSI; CI publishes `Markdown-Live-Portable.exe`, `Markdown-Live-Setup.exe`, `Markdown-Live-Setup.msi`.
- Testing = `?selfcheck` only (`src/js/dev/selfcheck.js`); there are no other test/lint/format commands.
- Do NOT launch the app yourself. `npm run tauri dev` opens a desktop window — leave running the real app to the user and say so in your report.

## Versioning

- Source of truth is `src-tauri/tauri.conf.json` `"version"`; root `package.json` is stale — ignore it.
- Bump only via `node scripts/sync-version.js --set X.Y.Z`. It auto-runs on dev/build, copying the version into `Cargo.toml`, cache-busting `?v=` in `src/index.html`, and rewriting `<meta name="app-version">` (the version the About dialog displays, read by `src/js/ui/about.js`). Never hand-edit `?v=`, `app-version` or `Cargo.toml`.
- Cache-busting reaches `src/index.html` and `js/main.js?v=`; the modules `main.js` imports carry no query string. Release: push tag `v*` -> `.github/workflows/release.yml`.

## Tauri config notes

- New plugin permissions go in `src-tauri/capabilities/default.json`, never in Rust code. `frontendDist` is `../src`, targets `nsis`/`msi`.
- The main window is `"decorations": false`, so Windows draws no titlebar (no icon, no title, no buttons). The app draws that row itself: `.titlebar` in `src/css/layout.css`, markup in `src/index.html` — app icon (icon only, no title text), tab strip, drag region, window buttons.
- `data-tauri-drag-region` goes on `.titlebar-drag` ONLY. Tauri walks `e.composedPath()` from the pressed element upwards and stops at the first ancestor carrying the attribute, so:
  - on `#tab-strip`, a press on a tab starts an OS window drag — the window slides while the tab drag runs and the dragged tab (viewport-fixed) drifts off the cursor.
  - on `.titlebar`, the tabs and buttons become drag handles.
- Drag / minimize / maximize / close run through `core:window:allow-start-dragging`, `allow-minimize`, `allow-toggle-maximize`, `allow-close`. Double-click on the drag region is Tauri's own `internal-toggle-maximize`, already covered by `core:default`.
- Price of dropping the native frame: Windows 11 Snap Layouts on hovering Maximize are gone (they need a native `WM_NCHITTEST`/`HTMAXBUTTON` hit test, i.e. a Rust plugin). `Win` + arrow snapping is expected to keep working but is unverified here.
- CSP stays `null`, so XSS defence is JS's job: fail-closed DOMPurify, Mermaid re-sanitize, external-URL allowlist.