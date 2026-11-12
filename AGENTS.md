# AGENTS.md — Markdown Live

Offline-first Markdown editor. Tauri v2 (thin Rust shell in `lib.rs`: registers plugins, exposes the `take_initial_paths` command, emits `open-paths`, and applies a Windows-only WebView2 tweak) + vanilla JS/HTML/CSS. No framework, bundler or linter. Editor is CodeMirror 6, hand-bundled into `src/vendor/codemirror.bundle.js` (global `CodeMirror`).

## Map

- `src/index.html` is the only HTML. Load order is fixed: CSS `tokens → base → layout → format-bar → dialogs → toast → toolbar → tabs → editor → preview → print`; vendor scripts `defer`, `codemirror.bundle.js` before `js/main.js`.
- `src/js/main.js` owns every `initXxx()` and the only `DOMContentLoaded`. Modules live in `src/js/{core,editor,preview,export,io,ui,theme,dev}`.
- Core files: `io/documents.js` (tab store, save/restore), `io/session-store.js` (IndexedDB), `editor/cm.js` (CM6 wrapper), `editor/sync.js` (`handleEditorChange`), `preview/render.js` (block renderer, lazy KaTeX/Mermaid/hljs; exports call `flushLazyRenders()` and `renderMarkdown({ force: true })`).
- `src/vendor/` is offline-only: never add CDN links. Rebuild recipes: `scripts/vendor-update.js`.
- New Tauri plugin permissions go in `src-tauri/capabilities/default.json`, not Rust.

## Commands

- Never launch the app (`npm run tauri dev` opens a window); tell the user to do it.
- Test by opening with `?selfcheck` (correctness) or `?perf` (timings). No other test commands.
- Version: only `node scripts/sync-version.js --set X.Y.Z` (source of truth `tauri.conf.json`); never hand-edit `Cargo.toml` or `?v=` in `index.html`. Root `package.json` is stale.
- Comments: only for non-obvious parts (the why, not the what), max 2 lines. Don't comment self-explanatory code.

## Invariants

- **Init order:** `initSanitizer()` first; `initTabs()` before `restoreSession()`, which runs last (after mermaid/marked/lucide init).
- **Tabs:** one shared `EditorView`; each tab keeps its own `EditorState` (undo never mixes). At runtime `activateTab()` is the only way to change `activeId`; `restoreSession()`/`migrateLegacy()` assign it directly while `restoring` is true. Shortcuts live on `window` (capture), and Ctrl+Alt+S is matched before Ctrl+S.
- **Read-only:** `EditorState.readOnly` does not block `dispatch`; pair with `EditorView.editable.of(false)`.
- **CodeMirror CSS:** prefix overrides with `#cm-editor` or CM6 selectors win.
- **Data safety:** never write `tab.path` when `tab.status !== 'ok'` (use Save As; the only exception is Save As onto the same path after the "Overwrite anyway" confirm). `saveTab()` returns a reason; only `'saved'`/`'discard'` may close a tab. `diskOkToWrite()` must never call `closeTab()`. `savedContent === null` = disk content unknown (never written, or restored dirty): `isTabDirty()` then compares `savedHash`/`savedLen`, so it is dirty unless they match. Files are read as bytes via `decodeTextBytes()`: UTF-8 is kept, UTF-16 and Windows-1252/1258 are converted to UTF-8 (the tab records `encoding`), binaries are rejected, and every save writes UTF-8. BOM/EOL are stripped on read and restored on write.
- **Session:** IndexedDB only; localStorage is read once to migrate the legacy session (theme and view mode still live there). Never delete on write failure; `writeSession()` resolves on `tx.oncomplete` and propagates errors. Quit: `onCloseRequested` → `preventDefault()` → `await flushSession()` → `destroy()` only on success (no `beforeunload`). Invalidate `tab.preview` on theme change.
- **Find panel:** app-built, non-modal, scans only the Editor doc (never Preview DOM); opening it must not change view mode. Ctrl+F/Ctrl+H are captured on `window`, but WebView2 can swallow Ctrl+F (the Windows COM tweak in `lib.rs` targets this), so keep the format-bar button as the fallback entry.
- **Pane divider:** write `--split-size` at most once per frame; measure rect once at `pointerdown`; docs >100k chars use the ghost bar.
- **Tauri:** register `single-instance` FIRST in `lib.rs`; its callback does `unminimize()` + `show()` before `set_focus()`. Windows-only `webview2-com`/`windows-core` versions must match wry's. `data-tauri-drag-region` only on `.titlebar-drag`.
- **Security:** CSP is `null`, so XSS defence is JS: fail-closed DOMPurify, Mermaid re-sanitize, external-URL allowlist.
- **Dialogs:** hide `.dialog-overlay` and dropdown menus via `visibility` + `pointer-events`, never `display: none`. `display: none` is only for swapping views inside a dialog (`#info-about`/`#info-doc`) and for `.popup-menu`.