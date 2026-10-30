# AGENTS.md — Markdown Live

Offline-first Markdown editor: Tauri v2 (thin Rust shell) + vanilla JS/HTML/CSS. No framework, no bundler, no lint/typecheck. All logic is in JS; Rust only registers plugins.

## Map

- `src/index.html` is the only HTML (`frontendDist` = `../src`). Load order is a hard constraint: CSS `tokens → base → layout → format-bar → dialogs → toast → toolbar → tabs → editor → preview → print`; vendor scripts all `defer`.
- `src/js/main.js` calls every `initXxx()` and owns the only `DOMContentLoaded`. Modules are grouped by role under `src/js/{core,editor,preview,export,io,ui,theme,dev}`.
- Key files: `io/documents.js` (tab store, save/restore), `io/session-store.js` (IndexedDB), `editor/sync.js` (`syncEditorAfterChange()`), `editor/highlight.js`, `preview/render.js`, `ui/view-mode.js`, `ui/window-controls.js`.
- `src/vendor/` holds local third-party libs. Must stay fully offline: never add CDN links.
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
- One shared textarea; switching tabs sets `markdownInput.value`. No per-tab DOM.
- `activateTab()` is the only way to change `activeId`; `switchTab/newTab/closeTab/openPaths` all go through it.
- Editor behaviour that must react to changes goes in `syncEditorAfterChange()`.
- Shortcuts are on `window`, not the textarea (Preview hides the editor). Ctrl+Alt+S must be matched before Ctrl+S.
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
- `restoreSession()` loads the active tab first, with `restoring` set and the textarea `readOnly`.
- Clear `editorHistory.typingTimer` before swapping undo stacks. Invalidate `tab.preview` on theme change and when Mermaid finishes late.

**Editor highlight**
- `editorHighlightCode.textContent` must always equal `markdownInput.value + '\n'`; only the visible window is coloured, the rest is plain filler.
- Don't read `scrollHeight` on every keystroke (forces full layout); see `TOP_REFRESH_CHARS`.

**Pane divider**
- Write `--split-size` at most once per frame; measure the workspace rect once at `pointerdown`. Documents over 100k chars use the ghost bar and apply layout once on release.
- `isResizingPanes()` (`core/flags.js`) is the single "dragging" signal. Bind `pointerup/cancel` on `window` too.

**Tauri**
- `single-instance` must be registered FIRST in `lib.rs`, or two windows overwrite the same session. Its callback must `unminimize()` + `show()` before `set_focus()`. First-launch argv is kept in `InitialPaths` and read via `take_initial_paths`.
- Window has `decorations: false`; `data-tauri-drag-region` goes on `.titlebar-drag` only, never on `#tab-strip` or `.titlebar`.
- CSP is `null`, so XSS defence is JS's job: fail-closed DOMPurify, Mermaid re-sanitize, external-URL allowlist.
- Dialogs hide via `visibility` + `pointer-events`, never `display: none` (kills the transition).