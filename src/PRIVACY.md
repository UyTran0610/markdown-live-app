# Privacy Statement

**Markdown Live** — Last updated: October 28, 2026

Markdown Live is an offline-first Markdown editor for Windows. This statement explains what the application does with your information. It applies to the desktop application distributed through GitHub Releases. It does not apply to the GitHub website, to websites you open from the app, or to third-party services you choose to use.

In this statement, **"we"** means the developer of Markdown Live, **"the app"** means the desktop application, and **"you"** means the person using it.

## Summary

- We do not collect, transmit, or share your documents or usage data.
- The app has no accounts, analytics, telemetry, advertising, or tracking.
- Your documents and settings stay on your device.
- The editor works without an internet connection. Only remote content in a document, or a link you click, uses the network.

---

## 1. Information We Collect

**None.**

The app does not collect:

- Personal information (name, email address, location, device identifiers, and similar)
- The content of your Markdown documents
- Usage statistics, analytics, or telemetry
- Crash reports or diagnostic data
- Advertising identifiers or tracking cookies

The app contains no analytics SDK, no tracking code, no advertising, and no crash reporter. It does not check for updates automatically. It does not send your documents, file paths, or usage data to us or to any analytics provider. We do not operate servers that receive data from the app, and we do not sell, rent, or share personal information.

## 2. Information Stored on Your Device

The app stores the following information locally so it can restore your workspace. This information stays on your device and is not sent to us.

| Information | Purpose |
| :--- | :--- |
| Unsaved drafts and text of untitled tabs | Restore work you have not saved yet |
| Paths and last-known modification times of open files | Reopen tabs and detect changes made outside the app |
| Tab order, active tab, pinned tabs, and the editor's cursor and scroll position | Restore your workspace as you left it |
| Theme, view mode, and line-ending style (LF / CRLF) | Reopen with your settings |
| Recent files (up to 10 paths) | Populate the **Recent** menu |

The app keeps this information in its local data folder:

`%LOCALAPPDATA%\com.uytran.markdownlive`

Theme and view mode live in local storage; tab, session, recent-file, and line-ending data live in IndexedDB. The app does not add its own encryption, so access is controlled by your Windows user account.

You control this information:

- Choose **Clear Recent Files** in the **Recent** menu to remove the recent-files list.
- Close a tab (and choose **Don't save** if prompted) to remove its saved session data. Its path may remain in the Recent list until you clear it.
- The **Clear** button in the editor empties the editor; it does not delete the file on disk.
- To remove all local app data, close the app and delete the folder above. Uninstalling the app or deleting the portable executable removes the program, but the local data folder may remain until you delete it.

Local data remains until you remove it as described above or delete the folder. Closing a tab or removing the app does not delete your Markdown files.

## 3. Access to Your Files

The app reads or writes the contents of document files only when you open, save, export, or restore them. You can open a file with the **Open** dialog, by dragging it into the window, from the **Recent** list, by opening it from Windows (file association), or by restoring a previous session. **Save** writes to the file's existing path without asking again; **Save As** and **Export** ask where to write the new file.

While a file is open, the app checks the active file when the window regains focus or when you switch to its tab. If the file changed on disk, the app asks what to do before overwriting it.

The app does not scan, index, or read other files on your computer. File contents are processed locally and are never uploaded.

## 4. Offline Operation

All Markdown parsing, sanitization, KaTeX math typesetting, Mermaid diagram rendering, and syntax highlighting are performed locally. All third-party libraries and fonts are bundled with the app, and the app does not load code or fonts from external CDNs.

The editor works without an internet connection for local documents. The exceptions are content you choose to include from the web, such as a remote image, and links you click (see section 6).

## 5. Clipboard

The **Copy** action places the Markdown text of the current tab on the system clipboard. **Copy Path** in a tab's context menu places that file's path on the clipboard. The app's own code writes to the clipboard only for these actions; standard cut, copy, and paste actions also use the clipboard at your request. The app does not read or monitor the clipboard in the background.

## 6. Network Activity

The app itself does not send data over the network. It does not contact us, use analytics, or check for updates automatically. The following actions can involve the network:

- **External links:** Clicking an external link in a document or the **About** dialog opens it in your default web browser (or your default mail or phone app for `mailto:` and `tel:` links). That website or service is governed by its own privacy policy.
- **Remote content in your documents:** If your Markdown references a remote resource (for example, an image hosted at an `https://` address), displaying it may cause your device to request it from that server. That request can reveal your IP address to the server, along with the fact that you viewed the document. The embedded WebView2 may also store cookies or cached copies of that content in the app's local data folder; deleting that folder removes them. This is determined by the content of your document, not by data collection in the app.
- **Downloading the app:** Releases are distributed through GitHub. Downloading from GitHub is subject to [GitHub's Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). The Windows installer may also download the Microsoft Edge WebView2 Runtime from Microsoft if it is not already installed.

## 7. Third-Party Components

The app bundles open-source libraries (marked, DOMPurify, highlight.js, Mermaid, KaTeX, Lucide, and others) that run locally inside the app. They are not configured to transmit data, and the app does not load them from external servers. Their licenses are listed under **Third-party Notices** in the app's About dialog.

Markdown Live is built on Tauri and renders using the system WebView2 runtime on Windows. The app does not send telemetry through it. Any diagnostic data that Windows or WebView2 handles is governed by Microsoft's terms and your Windows privacy settings.

## 8. Children's Privacy

Markdown Live is a general-purpose editor and is not directed at children. It does not knowingly collect personal information from any user, including children.

## 9. Open Source and Verification

Markdown Live is open source under the MIT License; see **License** in the app's About dialog. The complete source code is available at <https://github.com/uytran0610/markdown-live-app>, so you can inspect it to verify the statements in this document.

## 10. Changes to This Statement

If the app's data practices change, we will update this statement and the "Last updated" date above. The change will also be visible in the repository's commit history.

## 11. Contact

If you have questions about this statement, please open an [issue](https://github.com/uytran0610/markdown-live-app/issues) on the GitHub repository. Please do not include personal information in public issues.
