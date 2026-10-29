# AGENTS.md — Markdown Live

Tauri v2 + vanilla JS/HTML/CSS offline-first Markdown editor. No framework, no bundler, no tests/lint/typecheck.

- Comments: only for non-obvious parts, max 2 lines — no narrating the code.

## Layout

`src/index.html` is the only HTML file (Tauri `frontendDist` is `../src`). Its load order is a hard constraint:

- CSS (`src/css/*.css`): `tokens` -> `base` -> `layout` -> `format-bar` -> `dialogs` -> `toast` -> `toolbar` -> `tabs` -> `editor` -> `preview` -> `print`
- scripts, all `defer`, in order: lucide, marked, purify, highlight, mermaid, katex, marked-katex-extension

`src/js/main.js` imports each module, calls its `initXxx()` in a fixed order (see Init order) and owns the only `DOMContentLoaded`. Most modules export one `initXxx()` that only registers listeners; the exceptions are `dev/selfcheck.js` (`runSelfCheck`), `dev/perfcheck.js` (`runPerfCheck`), `io/documents.js` and `preview/render.js`, which export their functions directly.

| Path | Role |
|---|---|
| `src/js/core/` | `dom.js` (DOM refs, queried once), `toast.js`, `utils.js` (debounce, external-URL allowlist, `slugifyText` — the slug shared by heading ids and export filenames). |
| `src/js/editor/` | `events.js` (keyboard shortcuts, auto-close brackets), `edit.js` (Tab / Enter / format wrapping / link / duplicate line), `content.js` (Copy), `highlight.js` (highlight layer behind the textarea; only the visible window is syntax-highlighted, the rest is a plain text filler so wrapping/caret stay exact — `editorHighlightCode.textContent` must always equal `markdownInput.value + '\n'`; the layer is split into 128-line block chunks, so scrolling relayouts only the edge chunks), `history.js` (Undo / Redo), `syntax/{block,inline}.js` (block-level and inline Markdown highlighting), `format-actions.js` + `format-helpers.js` (format bar; the helpers are pure). |
| `src/js/preview/` | `render.js` (marked + DOMPurify + hljs + Mermaid + KaTeX, slug ids so `[link](#anchor)` works, scroll preservation), `sanitize.js` (DOMPurify config + hooks), `alerts.js` (GFM callouts), `links.js`, `mermaid-cache.js`. |
| `src/js/export/` | `menu.js` (Export dropdown, PDF via the browser Print dialog), `file-save.js` (document title = first H1 outside code fences; filename = `slugifyText` with diacritics folded; `readTextFile` / `writeTextFile` open-tab vs. Save As; Tauri's Save As dialog; browser download fallback), `doc.js` + `doc-transform.js`, `html.js`, `images.js` (SVG and Mermaid -> PNG), `math-image.js` / `math-fonts.js` / `math-mathml.js` (KaTeX -> PNG for DOC, MathML for DOC / HTML). |
| `src/js/io/documents.js` | The tab / document store — see Tabs gotcha. |
| `src/js/io/session-store.js` | IndexedDB session store (mỗi tab một record, `meta` riêng) + migrate từ localStorage. |
| `src/js/ui/` | `tabs.js` (tab strip: unsaved dot, broken-file mark, roving tabindex + Enter/Space/Delete on the focused tab, close / new-tab, Save / Save As / Save All state, drag-to-reorder — lift with `position:fixed`, FLIP the rest, commit with `moveTab()`; only scrolls the active tab into view when the active tab actually changed), `tab-menu.js` (right-click menu on a tab + Recent + Clear Recent + all-tabs list; bulk close asks one dialog for the whole group and passes `{ force: true }` to each `closeTab`), `popup-menu.js` (the one popup element all three menus share), `confirm-dialog.js` (3-button dialog → Promise; replaces `confirm()`), `status-bar.js` (EOL toggle, caret position, encoding), `view-mode.js` (Editor / Split / Preview + pane divider), `format-toolbar.js`, `dialogs.js`, `about.js`, `scroll-sync.js`, `window-controls.js` (the self-drawn titlebar's window buttons **and** `onCloseRequested`, which is the only reliable "app is quitting" hook). |
| `src/js/theme/theme.js` | Light / Dark apply, persist, follow system. All 4 preview vendor CSS are preloaded and toggled via `media`, so the switch is one synchronous tick inside a View Transition. |
| `src/js/dev/selfcheck.js` | Quick self-check suite (`?selfcheck`). |
| `src/js/dev/perfcheck.js` | Performance harness: preview render + editor highlight at 20k/100k/200k/400k chars (`?perf`, results in `console.table`). |
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

- One shared textarea: switching tabs is `markdownInput.value = tab.content`. Don't add per-tab DOM.
- `activateTab(tab)` (`src/js/io/documents.js`) is the **only** way to change `activeId`: capture old tab → clear `typingTimer` → load → render → `pruneHistories()` → `emit()` → `saveSession()`. Everything else (`switchTab`, `newTab`, `closeTab`, `openPaths`, `reopenClosedTab`) funnels through it; don't re-inline those steps.
- `syncEditorAfterChange()` (`src/js/editor/sync.js`) is the only hook that knows a tab exists (input, format actions, undo/redo). Add editor behaviour there.
- Shortcuts live on `window` (`handleGlobalShortcut`), not the textarea: in Preview `.editor-pane` is `display: none`. Editor-only branches are gated on `e.target === markdownInput`. Ctrl+Alt+S (Save All) must be matched **before** Ctrl+S.
- Order *is* the array: `tabs` order is visual and persisted order, so reorder with `moveTab()` + `emit()`. `render()` does `replaceChildren()`, so a drag edits the DOM directly and touches the store only on drop.

### Data safety

- `tab.status` (`'ok' | 'unreadable' | 'missing'`) is the gate: `saveTab()` must never write `tab.path` while `status !== 'ok'`, it falls back to Save As. This stops a failed restore from wiping the real file. Save As onto the **same** path a failed tab couldn't read must go through the "Overwrite unreadable file" confirm.
- Failed tabs persist `reload: true` and are retried next launch. If the retry succeeds and the tab holds a draft, the draft stays in `content` and disk text becomes `savedContent` (tab shows unsaved); only an empty tab adopts disk content.
- `diskRevision(stat, diskMtime)` → `'gone' | 'unknown' | 'same' | 'changed'`. `'unknown'` must stay silent or every Ctrl+S opens a dialog. `checkActiveTabDisk()` runs on window focus and every `activateTab()`; `tab.diskIgnoredMtime` stops a dismissed prompt from reappearing on each Alt+Tab.
- `saveTab()` returns a **reason** (`'saved' | 'discard' | 'cancelled' | 'failed' | 'busy'`), not a boolean. Only `'saved'` and `'discard'` may close a tab; ignoring it once let a cancelled Save As close a tab and lose the text.
- `diskOkToWrite()` must **never** call `closeTab()`: `saveTab` still holds `saving = true`, so a second prompt's Save always fails. Return the decision as a value.
- Save As picks the path **before** writing (`chooseSavePath()`) so the "already open in another tab" check runs first. `eol` / `bom` are never reset and round-trip through the session; BOM is stripped on read (U+FEFF before `#` kills the first heading and export title) and written back on save.
- `readTextFile()` reads **bytes** and decodes with `TextDecoder('utf-8', { fatal: true, ignoreBOM: true })`: non-UTF-8 is rejected (not turned into U+FFFD and written back), UTF-16 is detected by BOM, and `ignoreBOM: true` is required or the BOM is silently dropped.
- `savedContent === null` means "never written" → always dirty. A restored tab without `path` gets `''` instead. Only a `dirty` boolean plus `savedHash`/`savedLen` (FNV-1a) are persisted, so retyping the original text clears dirty after a restart.

### Session & lifecycle

- Session = IndexedDB (`io/session-store.js`), one record per tab plus `meta`. Never localStorage: its ~5M-char quota is below one allowed file. Only tabs with something to protect keep `content` (`sessionKeepsContent`: dirty or no `path`); clean tabs store `null` and are re-read from disk.
- Writes are queued and diffed by `sessionFingerprint()` (covers every key of the record, `content` as `length:hash`). **Never** delete on failure: a stale session loses changes silently.
- `writeSession()` must resolve only on `tx.oncomplete` and reject on error/abort, clearing `lastWritten` for pending tabs. `enqueue` swallows errors for chaining but must **not** swallow them for the caller, or `.catch` is dead code and uncommitted tabs are never retried.
- No `beforeunload` (the WebView is torn down with the window). Quit path: `onCloseRequested` → `preventDefault()` → `await flushSession()` (`durability: 'strict'`) → `win.destroy()` **only on success**; on failure keep the window open with a toast, or every draft is lost.
- `restoreSession()` reads the **active** tab first, with `restoring` making `captureActive()` / `saveSession()` no-ops and `markdownInput.readOnly = true` until the editor is built, otherwise typing during restore is overwritten. First-launch argv is read at the end via `take_initial_paths`; only a second launch arrives as `open-paths`.
- Undo stacks are per tab: clear `editorHistory.typingTimer` before restoring a stack, or the old tab's timer pushes the new tab's text into it. `pruneAllHistories()` caps **total** chars across tabs (entries are whole documents); it runs on tab switch, never per keystroke, with the active tab last.
- Preview HTML is cached per tab (`tab.preview`, keyed on `tab.content`). Invalidate on theme change and when Mermaid finishes late (`onPreviewChanged`), or a diagram renders as raw code. Preview scroll is captured in `captureActive()`.

## Commands

- `npm run vendor` refreshes `src/vendor/` (`scripts/vendor-update.js`); `npm run tauri build` makes NSIS/MSI, CI publishes Portable `.exe`, Setup `.exe`, `.msi`.
- Testing = `?selfcheck` (correctness) and `?perf` (timings, `console.table`); there are no other test/lint/format commands.
- Do NOT launch the app yourself. `npm run tauri dev` opens a desktop window; leave running it to the user and say so in your report.

## Versioning

- Source of truth: `src-tauri/tauri.conf.json` `"version"`. Root `package.json` is stale, ignore it.
- Bump only with `node scripts/sync-version.js --set X.Y.Z` (also runs on dev/build). It syncs `Cargo.toml`, `?v=` in `src/index.html` and `<meta name="app-version">`; never hand-edit those. Modules imported by `main.js` carry no `?v=`. Release: push tag `v*`.

## Tauri config notes

- New plugin permissions go in `src-tauri/capabilities/default.json`, never in Rust. Custom commands (`take_initial_paths`) need no entry.
- Launch with a file while the app is **not** running: `single_instance` fires only for a *second* launch, so `.setup()` stores `std::env::args()` in `InitialPaths`. The second-launch callback must `unminimize()` + `show()` before `set_focus()`. Two launches must end in ONE window, or two processes fight over the IndexedDB session.
- The window is `"decorations": false`; the app draws its own titlebar (`.titlebar` in `layout.css`). `data-tauri-drag-region` goes on `.titlebar-drag` **only**: Tauri stops at the first ancestor with the attribute, so on `#tab-strip` a tab press drags the OS window, and on `.titlebar` tabs/buttons become drag handles.
- Accepted limitations: without `tauri-plugin-persisted-scope` a dialog-picked path outside the four `fs:scope` roots can fall out of scope after restart (the tab retries the read each launch instead of being emptied); atomic write is rename-over, which replaces file identity (hard links, ACLs, OneDrive); Windows 11 Snap Layouts on Maximize are gone (needs a native hit test, i.e. a Rust plugin).
- CSP stays `null`, so XSS defence is JS's job: fail-closed DOMPurify, Mermaid re-sanitize, external-URL allowlist.