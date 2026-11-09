# AGENTS.md — Markdown Live

Offline-first Markdown editor: Tauri v2 (thin Rust shell) + vanilla JS/HTML/CSS. No framework, no bundler, no lint/typecheck. All logic is in JS; Rust only registers plugins (plus one Windows-only WebView2 setting for Ctrl+F). The editor itself is CodeMirror 6, bundled by hand into `src/vendor/codemirror.bundle.js` (global `CodeMirror`).

## Map

- `src/index.html` is the only HTML (`frontendDist` = `../src`). Load order is a hard constraint: CSS `tokens → base → layout → format-bar → dialogs → toast → toolbar → tabs → editor → preview → print`; vendor scripts all `defer` (`codemirror.bundle.js` must stay before `js/main.js`).
- `src/js/main.js` calls every `initXxx()` and owns the only `DOMContentLoaded`. Modules are grouped by role under `src/js/{core,editor,preview,export,io,ui,theme,dev}`.
- Key files: `io/documents.js` (tab store, save/restore), `io/session-store.js` (IndexedDB), `editor/cm.js` (the whole CodeMirror 6 wrapper: view, keymap, theme, search panel), `editor/sync.js` (`initEditorSync()`), `preview/render.js` (block renderer: marked.lexer + hash cache + prefix/suffix DOM patch; KaTeX/Mermaid/hljs lazy via IntersectionObserver, `flushLazyRenders()` for exports; docs above `PREVIEW_MAX_CHARS` get a notice instead of a render, exports pass `{ force: true }`), `preview/blocks.js` (hash, LRU block cache, diff/patch), `ui/view-mode.js`, `ui/window-controls.js`.
- `src/vendor/` holds local third-party libs. Must stay fully offline: never add CDN links. CodeMirror 6 is a hand-built esbuild bundle; rebuild recipe lives in `scripts/vendor-update.js` (`scripts/vendor/codemirror.entry.js` → global `CodeMirror`).
- `src-tauri/`: new plugin permissions go in `capabilities/default.json`, never in Rust.

## Commands

- Don't launch the app (`npm run tauri dev` opens a desktop window). Leave that to the user and say so.
- Testing: open with `?selfcheck` (correctness) or `?perf` (timings). No other test commands.
- Version source of truth is `src-tauri/tauri.conf.json`. Bump only with `node scripts/sync-version.js --set X.Y.Z`; never hand-edit the synced files (`Cargo.toml`, `?v=` in `index.html`). Root `package.json` is stale.
- Comments: only for non-obvious parts, max 2 lines.

## Invariants

**Init order** (`main.js`)
- `initSanitizer()` first (DOMPurify hooks are global; rendering earlier is unsanitised).
- `initTabs()` before `restoreSession()`, which runs last in a `finally`, after `mermaid.initialize()`, `marked.use(katex)` and `lucide.createIcons()`.

**Tabs**
- One shared `EditorView` (`#cm-editor`); every tab keeps its own `tab.state` (`EditorState`) so undo history never mixes across tabs. Switching tabs = `view.setState(tab.state)`.
- `activateTab()` is the only way to change `activeId`; `switchTab/newTab/closeTab/openPaths` all go through it.
- Editor behaviour that must react to changes goes in `handleEditorChange()` (`editor/sync.js`), registered through `setChangeHandler()`.
- Shortcuts are on `window` (capture phase), not on the editor DOM (Preview hides the editor). Ctrl+Alt+S must be matched before Ctrl+S.
- `tabs` array order is the visual and persisted order; reorder via `moveTab()`.

**Data safety**
- Never write `tab.path` while `tab.status !== 'ok'`; fall back to Save As. This prevents a failed restore from wiping the real file.
- `saveTab()` returns a reason, not a boolean. Only `'saved'` and `'discard'` may close a tab.
- `diskOkToWrite()` must never call `closeTab()` (`saving` is still true); return the decision instead.
- `readTextFile()` reads bytes and decodes with `fatal: true, ignoreBOM: true`. Non-UTF-8 is rejected; BOM and EOL are stripped on read and restored on write.
- `savedContent === null` means never written, so the tab is always dirty.

**Session**
- IndexedDB only, never localStorage (quota is below one allowed file). Never delete on write failure.
- `writeSession()` resolves only on `tx.oncomplete` and must propagate errors to the caller.
- Quit path: `onCloseRequested` → `preventDefault()` → `await flushSession()` → `destroy()` only on success. No `beforeunload`.
- `restoreSession()` loads the active tab first, with `restoring` set and the editor read-only (`EditorState.readOnly` + `EditorView.editable.of(false)`).
- Invalidate `tab.preview` on theme change (blocks=true clears block cache too); Mermaid late-render needs no invalidation (SVG comes from `mermaidCache`).

**CodeMirror editor** (`editor/cm.js`)
- One `EditorView` for all tabs; never create a second view. `view.setState()` is illegal while an update is in progress.
- `EditorState.readOnly` blocks DOM input but NOT `view.dispatch({changes})`; pair it with `EditorView.editable.of(false)` for read-only tabs.
- All app CSS overrides live under the `#cm-editor` ID prefix (CM6's own class selectors would otherwise win) and map `.cm-md-*` token classes onto the existing `--md-*` tokens.
- Undo grouping is per word via `history({joinToEvent})`; CM6 has no `tr.annotate`.

**Find & replace**
- Use the built-in `@codemirror/search` panel (`openSearchPanel`); it renders inside `.editor-container` so it never covers the format bar.
- Only scans the Editor document, never the Preview DOM.
- WebView2 keeps Ctrl+F for its own find bar (Tauri exposes no switch), so the format-bar magnifier button is the entry point that always works.

**Pane divider**
- Write `--split-size` at most once per frame; measure the workspace rect once at `pointerdown`. Documents over 100k chars use the ghost bar and apply layout once on release.
- Dragging state is `document.body.resizing` (class from `view-mode.js`); bind `pointerup/cancel` on `window` too.

**Tauri**
- `single-instance` must be registered FIRST in `lib.rs`, or two windows overwrite the same session. Its callback must `unminimize()` + `show()` before `set_focus()`. First-launch argv is kept in `InitialPaths` and read via `take_initial_paths`.
- Windows only: `release_browser_accelerator_keys()` in `lib.rs` turns off WebView2's browser accelerator keys, otherwise Ctrl+F is swallowed by the WebView2 find bar and never reaches the page. wry has `with_browser_accelerator_keys` but Tauri does not expose it (tauri#16306), so it calls the WebView2 COM API directly; the pinned versions must match wry's (`webview2-com` 0.38, `windows-core` 0.61).
- Window has `decorations: false`; `data-tauri-drag-region` goes on `.titlebar-drag` only, never on `#tab-strip` or `.titlebar`.
- CSP is `null`, so XSS defence is JS's job: fail-closed DOMPurify, Mermaid re-sanitize, external-URL allowlist.
- Dialogs hide via `visibility` + `pointer-events`, never `display: none` (kills the transition).