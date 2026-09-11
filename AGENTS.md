# AGENTS.md — Markdown Live

Tauri v2 + vanilla JS/HTML/CSS offline-first Markdown editor. No framework, no bundler, no tests/lint/typecheck.

## Structure

- `src/index.html`, `src/script.js`, `src/style.css` — entire frontend. `script.js` (~1300 lines) holds editor, preview render (marked + DOMPurify + KaTeX + mermaid + highlight.js), sync-scroll, PDF export, theme.
- `src/vendor/` — locally bundled third-party libs (marked, katex, mermaid, highlight.js, purify, lucide) + KaTeX `fonts/`. App must stay fully offline: never add CDN links.
- `src-tauri/src/lib.rs` — Rust backend; only `greet` command + `clipboard-manager` and `opener` plugins. Real logic lives in JS.
- `scripts/sync-version.js` — version/cache-bust sync script (see below).

## Commands

- `npm install` — install only dep (`@tauri-apps/cli`); requires Node 20+ and Rust stable + Tauri v2 OS prerequisites.
- `npm run tauri dev` — dev with hot-reload. Required verification before PR (per README Contributing).
- `npm run tauri build` — local full build (NSIS/MSI). CI portable build instead uses `npm run tauri -- build --no-bundle` and renames output to `Markdown-Live-Portable.exe` (+ `.zip`).
- No test/lint/format commands exist — don't invent them.

## Versioning gotcha

- Source of truth is `src-tauri/tauri.conf.json` `"version"` (currently 1.1.6). Root `package.json` version (`0.1.0`) is stale — ignore it.
- `node scripts/sync-version.js` runs automatically via `beforeDevCommand`/`beforeBuildCommand` in `tauri.conf.json`: it copies the tauri.conf version into `src-tauri/Cargo.toml` `[package] version` and `?v=<version>` cache-busters on every css/js `href`/`src` in `src/index.html` (including the inline theme-swap block).
- To bump: `node scripts/sync-version.js --set X.Y.Z` (strips leading `v`). Never hand-edit `?v=` strings or `Cargo.toml` version alone.
- Release: push tag `v*` (or manual `workflow_dispatch` with `version`) → `.github/workflows/release.yml` runs `--set`, builds portable exe on `windows-latest`, publishes `.exe` + `.zip`. Only `workflow_dispatch` commits the version bump back.

## Tauri config notes

- `tauri.conf.json`: `frontendDist` is `../src` (served raw, no dist step); `bundle.active: false`, targets `nsis`/`msi`; CSP is `null`.
- Permissions live in `src-tauri/capabilities/default.json` (`core`, `opener`, `clipboard-manager` + `allow-write-text`). Add new plugin permissions there, not in Rust code.
- Frontend scripts must stay `defer` in declared order in `index.html`; theme must be set inline in `<head>` before CSS to avoid flash.
