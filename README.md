<div align="center">

<img src="icon.png" width="120" height="120" alt="Markdown Live Icon" />

# Markdown Live

A standalone, offline-first, real-time bidirectional Markdown editor packaged on the Tauri v2 platform.

[![Tauri Version](https://img.shields.io/badge/Tauri-v2.0-24C8DB?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app/)
![Backend](https://img.shields.io/badge/Backend-Rust-CE422B?logo=rust&logoColor=white)
[![JavaScript](https://img.shields.io/badge/Frontend-Vanilla_JS-F7DF1E?style=flat-square&logo=javascript&logoColor=black)](https://developer.mozilla.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows_x64-0078D6?style=flat-square&logo=windows&logoColor=white)](https://github.com/uytran0610/markdown-live-app/releases)
[![License](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](LICENSE)

</div>

<div align="center">

**English** | [Tiếng Việt](README.vi.md)

</div>

---

## Table of Contents

- [Technical Features](#technical-features)
- [Screenshots](#screenshots)
- [Quick Start](#quick-start)
- [How to Use](#how-to-use)
- [PDF Export Guide](#pdf-export-guide)
- [Architecture Overview](#architecture-overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Contributing](#contributing)
- [License](#license)

---

## Technical Features

- **Dual-Pane Bidirectional Sync:** Side-by-side editing and preview with near-zero latency.
- **GFM Alert Specifications:** Fully compatible with GitHub Markdown Alerts (`NOTE`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`).
- **LaTeX Math Rendering:** Integrated KaTeX parser for both inline (`$...$`) and block (`$$...$$`) math formulas.
- **Diagrams as Code:** Integrated Mermaid.js engine supporting Flowcharts, Sequence Diagrams, and Entity Relationship Diagrams (ERDs).
- **Code Syntax Highlighting:** Automatic detection and multi-language syntax formatting powered by Highlight.js.
- **Dynamic Syntax Overlay:** Textarea synchronized with real-time Markdown syntax highlighting directly in the editor.
- **Vector PDF Print Engine:** Vector-based PDF export (text remains selectable and copyable, not rasterized into images).
- **Light/Dark Theme:** Automatic system theme detection, manual theme switching, and state persistence between sessions.

---

## Screenshots

![Main Interface - Light mode](images/light-mode.png)

![Main Interface - Dark mode](images/dark-mode.png)

---

## Quick Start

### Download Pre-built Binary (Recommended for users)

A portable Windows executable (`.exe`) is automatically built via GitHub Actions for every release tag. Download the latest release from the **[Releases](https://github.com/uytran0610/markdown-live-app/releases)** page—no installation required, just launch `Markdown-Live-Portable.exe`.

> [!WARNING]
> **Windows SmartScreen may flag the app on first launch**
>
> Because this is a free, open-source project that is **not digitally signed** with an expensive code-signing certificate, Windows Defender SmartScreen may display a **"Windows protected your PC"** warning when you run the file for the first time, showing **Publisher: Unknown publisher**. This is standard behavior for unsigned software and does not mean the file contains malware. You can choose **either** of the two methods below to proceed.

**Bypass SmartScreen prompt**

1. In the **"Windows protected your PC"** dialog, click **More info** if the **Run anyway** button is hidden.
2. Click **Run anyway** to launch the application.

**Unblock the file (If double-clicking fails to open the app)**

1. Right-click `Markdown-Live-Portable.exe` → select **Properties**.
2. Under the **General** tab, scroll down to the bottom **Security** section. Look for the message: *"This file came from another computer and might be blocked to help protect this computer."*
3. Check the **Unblock** box → click **Apply** → **OK**.
4. Double-click the `.exe` file again; the app will now launch normally.

> [!NOTE]
> If you want to verify the file before execution, you can scan it using your preferred antivirus software or upload it to [VirusTotal](https://www.virustotal.com/) to compare results across multiple security engines.

### Build from Source (For developers)

**Prerequisites:**
- [Node.js](https://nodejs.org/) v20 or later
- [Rust toolchain](https://www.rust-lang.org/tools/install) (latest stable)
- Tauri v2 system prerequisites as outlined in the [Tauri Prerequisites Guide](https://tauri.app/start/prerequisites/)

**Steps:**

```bash
# 1. Clone the repository
git clone https://github.com/uytran0610/markdown-live-app.git
cd markdown-live-app

# 2. Install dependencies
npm install

# 3. Run in development mode (dev, hot-reload)
npm run tauri dev

# 4. Build release package (NSIS/MSI installer)
npm run tauri build
```

---

## How to Use

After launching the application, type or paste your Markdown content into the **EDITOR** pane on the left; the output will be rendered instantly in the **PREVIEW** pane on the right. The top toolbar provides convenient actions:

| Action | Description |
| :--- | :--- |
| **Sync Scroll** | Toggle synchronized scrolling between Editor and Preview |
| **Reset** | Restore the default template content |
| **Copy** | Copy the full raw Markdown content to the clipboard |
| **Export PDF** | Export Preview content to a selectable vector PDF file |
| **Theme** | Toggle between Light and Dark themes |

### Editor Shortcuts

The editor includes built-in shortcuts and formatting utilities common in modern source code editors:

| Shortcut | Action |
| :--- | :--- |
| `Ctrl`/`Cmd` + `B` | Bold selected text |
| `Ctrl`/`Cmd` + `I` | Italicize selected text |
| `Ctrl`/`Cmd` + `Shift` + `X` | Strikethrough selected text |
| `Ctrl`/`Cmd` + `E` or `Ctrl` + backtick key | Wrap selection in inline code |
| `Ctrl`/`Cmd` + `K` | Insert link, automatically highlighting the `url` for quick pasting |
| `Ctrl`/`Cmd` + `D` | Duplicate current line (or selection) |
| `Ctrl`/`Cmd` + `Z` | Undo |
| `Ctrl`/`Cmd` + `Y` or `Ctrl`/`Cmd` + `Shift` + `Z` | Redo |
| `Tab` / `Shift` + `Tab` | Indent / Unindent — supports multi-line selections |
| `Enter` | Preserves indentation, continues lists (`-`, `1.`, `>`, task lists), or exits the list if the line is empty |
| Typing `(`, `[`, `{`, quotes, backtick, `*`, `_`, `~`, or `$` over selected text | Automatically encloses selection with the typed character pair |

---

## PDF Export Guide

> [!IMPORTANT]
> **System Print Engine Settings:**
> To ensure printed documents or exported PDF files retain background colors, Alert Callouts, and code block styles:
> 1. In the system Print Dialog, expand the **More settings** dropdown.
> 2. Enable the **Background graphics** checkbox.

---

## Architecture Overview

Markdown Live is engineered with memory efficiency and near-instant responsiveness in mind. The application adopts a hybrid architecture:
- **Core Runtime:** Tauri v2 (Rust backend) guarantees a compact binary footprint, native clipboard management, and low-overhead system API integrations.
- **Frontend Layer:** Built entirely with Vanilla JavaScript/HTML5/CSS3. Without heavy Single Page Application (SPA) frameworks, all dependencies are bundled locally (`vendor/`) without relying on external CDNs.

> [!NOTE]
> The application runs completely offline. All Markdown parsing, KaTeX mathematical typesetting, and Mermaid diagram rendering are executed locally within the client-side Webview.

---

## Tech Stack

| Component | Technology / Library | Role |
| :--- | :--- | :--- |
| **Backend Core** | Tauri v2, Rust | Window management, Native Clipboard Manager, Opener Plugin |
| **Markdown Parser**| Marked.js + DOMPurify | Markdown parsing and secure XSS sanitization |
| **Mathematics** | KaTeX + marked-katex-extension | TeX/LaTeX mathematical formula typesetting |
| **Diagram Engine** | Mermaid.js | Declarative diagram rendering |
| **Code Engine** | Highlight.js | Code block syntax highlighting |
| **Iconography** | Lucide Icons | User interface icon system |

---

## Project Structure

```
markdown-live-app/
├── src/                    # Frontend (Pure HTML/CSS/JS)
│   ├── index.html
│   ├── script.js
│   ├── style.css
│   └── vendor/             # Locally bundled 3rd-party dependencies (marked, katex, mermaid...)
├── src-tauri/              # Rust backend + Tauri configuration
│   ├── src/
│   │   ├── lib.rs
│   │   └── main.rs
│   ├── capabilities/
│   ├── icons/
│   └── tauri.conf.json
└── .github/workflows/      # Automated CI/CD build & release workflows
```

---

## Contributing

Contributions are always welcome! If you want to help improve the project:

1. Fork the repository and create a new branch (`git checkout -b feature/feature-name`).
2. Make your changes with clear, concise commit messages.
3. Ensure `npm run tauri dev` runs without errors prior to submitting a Pull Request.
4. Submit a Pull Request with a short summary of the updates made.

If you encounter any bugs or have feature suggestions, please open a new [Issue](https://github.com/uytran0610/markdown-live-app/issues).

---

## License

Released under the [MIT](LICENSE) License.