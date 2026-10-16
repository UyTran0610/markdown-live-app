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
| `src/js/io/session-store.js` | IndexedDB session store (mỗi tab một record, `meta` riêng) + migrate từ localStorage. |
| `src/js/ui/` | `tabs.js` (tab strip: unsaved dot, broken-file mark, roving tabindex + Enter/Space/Delete on the focused tab, close / new-tab, Save / Save As / Save All state, drag-to-reorder — lift with `position:fixed`, FLIP the rest, commit with `moveTab()`; only scrolls the active tab into view when the active tab actually changed), `tab-menu.js` (right-click menu on a tab + Recent + Clear Recent + all-tabs list; bulk close asks one dialog for the whole group and passes `{ force: true }` to each `closeTab`), `popup-menu.js` (the one popup element all three menus share), `confirm-dialog.js` (3-button dialog → Promise; replaces `confirm()`), `status-bar.js` (EOL toggle, caret position, encoding), `view-mode.js` (Editor / Split / Preview + pane divider), `format-toolbar.js`, `dialogs.js`, `about.js`, `scroll-sync.js`, `window-controls.js` (the self-drawn titlebar's window buttons **and** `onCloseRequested`, which is the only reliable "app is quitting" hook). |
| `src/js/theme/theme.js` | Light / Dark apply, persist, follow system. All 4 preview vendor CSS are preloaded and toggled via `media`, so the switch is one synchronous tick inside a View Transition. |
| `src/js/dev/selfcheck.js` | Quick self-check suite (`?selfcheck`). |
| `src/css/` | One file per area, in the load order above. `dialogs.css` hides dialogs with `visibility` + `pointer-events: none`, never `display: none` — that would kill the transition. `tabs.css` reuses the `.btn` / `.btn.active` tokens, no new colours. `print.css` holds the print / PDF rules. |
| `src/vendor/` | Locally bundled third-party libs. `highlight.min.js` is a hand-built 193-language esbuild bundle — npm ships no browser build, so `scripts/vendor-update.js` keeps it in `MANUAL_PACKAGES` and documents the rebuild recipe in its header comment. Must stay fully offline: never add CDN links. |
| `src-tauri/src/lib.rs` | Rust backend; `greet` + `take_initial_paths` commands, `clipboard-manager`, `opener`, `dialog`, `fs` plugins, plus `single-instance` (which is Rust-only and must be registered FIRST, or a second launch writes over the same IndexedDB session). The only other Rust responsibility is keeping the first launch's argv in `InitialPaths` (see `.setup()`). All other logic lives in JS. |

## Init order

- `initSanitizer()` first: DOMPurify config is a global hook, not a per-call option — render earlier and the output is unsanitised.
- `initPopupMenu()` / `initTabMenu()` / `initStatusBar()` before anything that can open them.
- `initTabs()` before `restoreSession()`: the store emits on restore, and the tab strip must already be subscribed.
- `restoreSession()` last, inside a `finally` (`src/js/main.js`): it renders, so it must follow `mermaid.initialize()`, `marked.use(katexExt)` and `lucide.createIcons()`, or the first paint shows raw `$$`.
- `window.renderMarkdown` (`src/js/main.js`) is a deliberate global escape hatch — don't re-export it.

## Tabs gotcha

- Still one textarea. Switching tabs is `markdownInput.value = tab.content`; every module that reads the editor keeps working unchanged. Don't add per-tab DOM.
- `activateTab(tab)` (`src/js/io/documents.js`) is the **only** way to change `activeId`: capture the old tab → clear `typingTimer` → load → render → `pruneHistories()` → `emit()` → `saveSession()`. `switchTab` / `newTab` / `closeTab` / `openPaths` / `reopenClosedTab` all funnel through it; don't re-inline those steps.
- `syncEditorAfterChange()` (`src/js/editor/sync.js`) is the only hook that needs to know a tab exists — it covers `input`, format actions, undo and redo. Add editor behaviour there, not at each call site.
- `tab.status` is the data-safety gate. `'ok'` | `'unreadable'` (read failed) | `'missing'` (file deleted from disk). `saveTab()` must never `writeTextFile(tab.path, …)` while `status !== 'ok'`; it falls back to Save As. This is what stops a failed session restore from wiping the real file.
- A failed tab is **not** abandoned: the session stores `reload: true` for it, so `restoreSession()` retries the read on the next launch. If the retry succeeds and the tab holds a draft, the draft stays in `content` and the disk text becomes `savedContent` (tab shows unsaved, Ctrl+S still gated on `status`); only an empty tab adopts the disk content. Choosing Save As onto the **same** path a failed tab could not read always goes through the "Overwrite unreadable file" confirm — that round trip is otherwise how an empty tab erases a real file.
- `tab.diskMtime` is the last mtime we read or wrote. `diskRevision(stat, diskMtime)` → `'gone' | 'unknown' | 'same' | 'changed'`; only `'changed'` prompts, `'unknown'` must stay silent or every Ctrl+S opens a dialog. `checkActiveTabDisk()` runs on window focus **and** on every `activateTab()`, handles `'gone'` as well as `'changed'`, and remembers `tab.diskIgnoredMtime` so a dismissed decision is not re-asked on every Alt+Tab.
- `saveTab()` returns a **reason**, not a boolean: `'saved' | 'discard' | 'cancelled' | 'failed' | 'busy'`. Only `'saved'` and `'discard'` may lead to closing a tab — `closeTab(id, { force })` enforces that. An ignored return value is exactly how a cancelled Save As dialog used to close a tab and keep the text in RAM only (`closedTabs`).
- `diskOkToWrite()` (`'proceed' | 'stop' | 'saveas' | 'discard'`) must **never** call `closeTab()`: it runs while `saveTab` still holds `saving = true`, so the second prompt's Save always fails. The decision travels back up as a value.
- Save As picks the path **before** writing (`chooseSavePath()`), so the "already open in another tab" check runs before anything touches the disk, and `tab.eol` / `tab.bom` are never reset: the user's CRLF choice travels with the file. `suggestSavePath()` keeps the tab's extension (a `.txt` tab does not become `.md`) and its directory.
- Keyboard shortcuts live on `window`, not on the textarea (`handleGlobalShortcut` in `src/js/editor/events.js`): in Preview mode `.editor-pane` is `display: none`, so a textarea-bound handler never fires. The editor-only branches (Enter, Tab, auto-close, Backspace) are gated on `e.target === markdownInput`.
- `savedContent === null` means "never written to disk" and is therefore always dirty. On restore a tab **without** `path` gets `savedContent = ''` instead, so an emptied draft isn't permanently dirty. The session stores only a `dirty` boolean plus `savedHash`/`savedLen` (FNV-1a of the saved text), because `savedContent` itself is not persisted: without the hash every dirty tab with a path would stay dirty forever after a restart, even with the exact original text typed back.
- Session content is per-tab, and only for tabs that still have something to protect (`sessionKeepsContent`: dirty, or no `path`). Clean tabs serialise `content: null` and `restoreSession()` reads them back from disk — it is `async`, so `main.js` awaits it and self-check waits on the same `ready` promise. Storage is IndexedDB (`io/session-store.js`), one record per tab plus a `meta` record (which also carries `defaultEol`): localStorage's ~5M-char origin quota is smaller than a single allowed file, so it could never hold a real session. Writes are queued, diffed against the last write by `sessionFingerprint()` — a fingerprint of the record's own keys with `content` replaced by `length:hash` (measured: 4 x 5 MB tabs cost ~39 ms per snapshot and ~1 KB retained, against ~22 ms and 41 MB of retained JSON before) — and **never** delete on failure: a stale session loses changes silently. Any new field on a serialized tab is covered automatically, so nothing can be skipped by accident.
- `writeSession()` resolves only on `tx.oncomplete` and rejects on `error`/`abort`, clearing `lastWritten` for the tabs it was about to write. The queue must swallow errors for chaining but the returned promise must **not** (`enqueue`): swallowing it there makes every caller's `.catch` dead code and marks uncommitted tabs as written, so they are never retried.
- `beforeunload` is gone on purpose: the WebView is torn down with the window, so it is not a reliable flush. `onCloseRequested` → `preventDefault()` → `await flushSession()` (which writes with `durability: 'strict'`) → `win.destroy()` **only if it reports success**; on failure the window stays open with a toast. Destroying on a failed flush loses every draft.
- `restoreSession()` reads the **active** tab first and builds the editor before reading background tabs, with `restoring` making `captureActive()` / `saveSession()` no-ops, and `markdownInput.readOnly = true` until the active tab is in the editor — otherwise typing during the restore is silently overwritten.
- File-association launches: argv of the **first** process is kept in Rust state (`take_initial_paths`, read at the end of `restoreSession()`); only a second launch arrives as the `open-paths` event.
- `eol` and `bom` must round-trip through the session too: BOM is stripped on read (`U+FEFF` before `#` would otherwise kill the first heading and the export title) and written back on save, exactly like EOL.
- Order *is* the array: `tabs` order is the visual order and the persisted one, so reordering is `moveTab()` + `emit()` — no order field. `render()` calls `tabStrip.replaceChildren()`, so the drag must edit the DOM directly while dragging and only touch the store on drop.
- Undo stacks are per tab: `switchTab` must `clearTimeout(editorHistory.typingTimer)` before restoring a stack, or the pending timer pushes the new tab's text into the old tab's history. `pruneAllHistories()` caps **total** history chars across all tabs (entries hold whole documents); it runs on tab switch, never per keystroke, and the active tab goes last in the list.
- Preview HTML is cached per tab (`tab.preview`, keyed on `tab.content`) so switching tabs doesn't re-run marked + DOMPurify + KaTeX + Mermaid. Invalidate on theme change and when Mermaid finishes late (`onPreviewChanged`) — a cache captured before the SVG exists would render the diagram as raw code. `tab.preview.scroll` is captured in `captureActive()`, so each tab keeps its own preview scroll position.
- Session saves are debounced by **size** (`scheduleSessionSave()` in `editor/sync.js`, 400 ms → 1.5 s): a 5 MB document is stringified and written as a whole, so a fixed 400 ms debounce kept rewriting the same block while typing.
- `readTextFile()` reads **bytes** (`fs.readFile`, hence `fs:allow-read-file`) and decodes with `TextDecoder('utf-8', { fatal: true, ignoreBOM: true })`: non-UTF-8 is rejected instead of becoming U+FFFD and being written back corrupted, UTF-16 BOM is detected explicitly, and `ignoreBOM: true` is required or the round-tripped BOM is silently dropped. `writeTextFile()` cleans up its `*.md-live.tmp` (`fs:allow-remove`) when the atomic rename falls back to a direct write.
- The tab strip keeps focus on the active tab after arrow navigation (`switchTab` → `restoreTabIntoEditor` calls `markdownInput.focus()`), activates on Enter/Space and closes on Delete. Ctrl+Alt+S is Save All and is matched **before** plain Ctrl+S.
- `src/index.html` is the only HTML file (Tauri `frontendDist` is `../src`). Its load order is a hard constraint:
- CSS load order gained nothing but the status bar, which lives in `layout.css` next to `.workspace`.

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

- New plugin permissions go in `src-tauri/capabilities/default.json`, never in Rust code. `frontendDist` is `../src`, targets `nsis`/`msi`. Custom commands (`take_initial_paths`) need no capability entry; plugin permissions do (`fs:allow-read-file`, `fs:allow-remove` were added alongside the existing read/write/rename/stat ones).
- File association when the app is **not** running: `single_instance`'s callback only fires for a *second* launch, so `.setup()` stores `std::env::args()` in `InitialPaths` and the frontend asks for them with `take_initial_paths` after `restoreSession()`. The second-launch callback also calls `unminimize()` + `show()` before `set_focus()`, or a minimized window never comes up.
- Accepted limitations: without `tauri-plugin-persisted-scope` a dialog-picked path outside the four `fs:scope` roots can fall out of scope after a restart (the tab then retries the read on each launch instead of being silently emptied); and the atomic write is rename-over, which replaces the file identity (hard links, ACLs, OneDrive's delete-then-create heuristic) — fixing that needs a Rust read/write command, not more JS.
- The main window is `"decorations": false`, so Windows draws no titlebar (no icon, no title, no buttons). The app draws that row itself: `.titlebar` in `src/css/layout.css`, markup in `src/index.html` — app icon (icon only, no title text), tab strip, drag region, window buttons.
- `data-tauri-drag-region` goes on `.titlebar-drag` ONLY. Tauri walks `e.composedPath()` from the pressed element upwards and stops at the first ancestor carrying the attribute, so:
  - on `#tab-strip`, a press on a tab starts an OS window drag — the window slides while the tab drag runs and the dragged tab (viewport-fixed) drifts off the cursor.
  - on `.titlebar`, the tabs and buttons become drag handles.
- Drag / minimize / maximize / close run through `core:window:allow-start-dragging`, `allow-minimize`, `allow-toggle-maximize`, `allow-close`. Double-click on the drag region is Tauri's own `internal-toggle-maximize`, already covered by `core:default`.
- `fs:allow-stat` (mtime check), `fs:allow-rename` (atomic write), `core:window:allow-destroy` (close hook) were added for the tab/store work; `opener:default` already carries `reveal-item-in-dir`, and `core:default` already grants `core:event:allow-listen`, which is what `onCloseRequested` / `onDragDropEvent` / `onFocusChanged` need.
- `tauri-plugin-single-instance` is registered first in `lib.rs` and emits `open-paths` to the main window. It has no JS API, so no capability entry exists for it. `bundle.fileAssociations` claims `.md/.markdown/.mdown/.mkd/.txt`; drop a `.md` file on the running window twice and both launches must end up in ONE window, or the two processes fight over the IndexedDB session.
- Price of dropping the native frame: Windows 11 Snap Layouts on hovering Maximize are gone (they need a native `WM_NCHITTEST`/`HTMAXBUTTON` hit test, i.e. a Rust plugin). `Win` + arrow snapping is expected to keep working but is unverified here.
- CSP stays `null`, so XSS defence is JS's job: fail-closed DOMPurify, Mermaid re-sanitize, external-URL allowlist.