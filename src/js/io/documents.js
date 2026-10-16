// js/io/documents.js — Store tài liệu: danh sách tab đang mở, nội dung từng tab, đọc/ghi file, lưu session.
//
// App vẫn dùng MỘT textarea duy nhất. Đổi tab chỉ là gán lại markdownInput.value, nên các module khác
// (render, highlight, history, export, format bar, scroll sync) không cần biết tab tồn tại.

import { btnImport, btnSave, btnSaveAll, btnSaveAs, editorHighlight, markdownInput, previewOutput } from '../core/dom.js';
import { showToast } from '../core/toast.js';
import { updateEditorHighlight } from '../editor/highlight.js';
import { editorHistory, pruneAllHistories } from '../editor/history.js';
import { deriveExportBaseName, detectBom, detectEol, mtimeOf, readTextFile, sameFilePath, saveTextFile, statFile, stripBom, toLf, writeTextFile } from '../export/file-save.js';
import { currentPreviewHtml, onPreviewChanged, renderCachedHtml, renderMarkdown } from '../preview/render.js';
import { confirmAction } from '../ui/confirm-dialog.js';
import { loadSession, migrateLegacySession, whenSessionWritten, writeSession } from './session-store.js';

const SESSION_KEY = 'markdown-live-session';

// Key của bản single-document cũ. Đọc một lần để migrate sang 1 tab Untitled rồi xoá, không giữ song song.
const LEGACY_KEY = 'markdown-live-content';

const MARKDOWN_EXTS = ['md', 'markdown', 'mdown', 'mkd', 'txt'];

const MAX_FILE_CHARS = 5 * 1024 * 1024;

const UNTITLED = 'Untitled';

// tabs: [{ id, path, name, content, savedContent, eol, bom, status, diskMtime, scrollTop, selStart, selEnd, history }]
// savedContent === null nghĩa là "chưa bao giờ ghi xuống đĩa" => luôn coi là chưa lưu, không so sánh chuỗi.
// eol: kiểu xuống dòng của file trên đĩa ('\r\n' hoặc '\n'); nội dung trong tab luôn là LF.
// bom: file gốc có BOM không; BOM bị bỏ khỏi nội dung tab và ghi lại khi lưu.
// status: 'ok' | 'unreadable' (đọc lỗi lúc mở/khôi phục) | 'missing' (file bị xoá khỏi đĩa).
//   status !== 'ok' là cấm tuyệt đối ghi đè đường dẫn cũ: saveActiveDoc phải rơi về Save As.
// diskMtime: mtime (ms) của file lúc đọc/ghi thành công; null = chưa từng chạm đĩa được. So với
//   fs.stat() lúc lưu để phát hiện file bên ngoài đã sửa.
const tabs = [];
let activeId = null;
const listeners = [];
let nextId = 1;

// Đang khôi phục session: textarea còn rỗng, gán nó vào tab active sẽ xoá bản nháp đã đọc từ đĩa.
let restoring = false;

let quotaWarnedAt = 0;

export function isMarkdownPath(path) {
    const name = String(path || '').split(/[\\/]/).pop().toLowerCase();
    const dot = name.lastIndexOf('.');
    return dot > 0 && MARKDOWN_EXTS.includes(name.slice(dot + 1));
}

export function isTabDirty(tab) {
    return tab.savedContent === null || tab.content !== tab.savedContent;
}

export function getTabs() {
    return tabs;
}

export function getActiveTab() {
    return tabs.find((tab) => tab.id === activeId) || null;
}

export function subscribe(fn) {
    listeners.push(fn);
    fn();
}

function emit() {
    listeners.forEach((fn) => fn());
}

// `= {}` bắt buộc: restoreSession dựng tab Untitled cho lần chạy đầu bằng createTab() không tham số.
function createTab({ path = null, name = UNTITLED, content = '', savedContent = content, eol = '\n', bom = false, status = 'ok', diskMtime = null, pinned = false } = {}) {
    const tab = {
        id: nextId++,
        path,
        name,
        content,
        savedContent,
        eol,
        bom,
        status,
        diskMtime,
        pinned,
        scrollTop: 0,
        selStart: 0,
        selEnd: 0,
        preview: null,
        history: null
    };
    tabs.push(tab);
    return tab;
}

// Tab ghim không bị "Close Others" / "Close to the Right" / "Close Saved" dính vào. Chỉ bảo vệ
// khỏi các lệnh đóng hàng loạt — Ctrl+W vẫn đóng được, vì ghim mà không đóng được thì vô dụng.
export function updateTabPin(id) {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    tab.pinned = !tab.pinned;
    emit();
    saveSession();
}

// Đổi kiểu xuống dòng dùng khi lưu. Nội dung trong tab luôn là LF (textarea hiểu LF), nên đổi eol
// không đụng nội dung — chỉ đổi cách applyEol() viết ra đĩa lần tới.
export function setActiveEol(eol) {
    const tab = getActiveTab();
    if (!tab || (eol !== '\n' && eol !== '\r\n')) return;
    tab.eol = eol;
    showToast(`New lines will be saved as ${eol === '\r\n' ? 'CRLF' : 'LF'}.`);
    emit();
    saveSession();
}

// Điểm vào DUY NHẤT để chuyển sang một tab: nhét trạng thái tab cũ vào store -> nạp tab mới ->
// render -> dựng lại dải tab -> ghi phiên. Mọi nơi đổi activeId (switchTab, newTab, closeTab,
// openPaths, reopenClosedTab, restoreSession) đi qua đây, không tự dựng lại chuỗi bước này.
export function activateTab(tab) {
    if (!tab) return null;
    captureActive();
    activeId = tab.id;
    restoreTabIntoEditor(tab);
    pruneHistories();
    emit();
    saveSession();
    return tab;
}

// Mỗi mục lịch sử giữ nguyên chuỗi nội dung, nên lịch sử của mọi tab cộng lại có thể vượt RAM.
// Cắt ở lúc chuyển tab (không phải mỗi lần gõ) vì đó là lần duy nhất người dùng không gõ.
// Tab đang mở đặt cuối danh sách nên nó bị cắt sau cùng.
function pruneHistories() {
    const active = getActiveTab();
    const histories = tabs
        .filter((tab) => tab !== active && tab.history)
        .map((tab) => tab.history);
    histories.push(editorHistory);
    pruneAllHistories(histories);
    // editorHistory.index có thể đã dịch sau khi cắt: ghi lại vào tab để lần chuyển tab sau
    // khôi phục đúng vị trí undo.
    if (active) active.history = { stack: editorHistory.stack, index: editorHistory.index };
}

// Nhét trạng thái editor hiện tại vào tab đang mở. Phải gọi TRƯỚC khi đổi activeId.
function captureActive() {
    if (restoring) return;
    const tab = getActiveTab();
    if (!tab) return;
    tab.content = markdownInput.value;
    tab.selStart = markdownInput.selectionStart;
    tab.selEnd = markdownInput.selectionEnd;
    tab.scrollTop = markdownInput.scrollTop;
    tab.history = { stack: editorHistory.stack, index: editorHistory.index };
}

// Timer gom lịch sử đang treo sẽ đẩy giá trị của tab MỚI vào stack của tab VỪA RỜI nếu không bỏ trước.
function restoreTabIntoEditor(tab) {
    clearTimeout(editorHistory.typingTimer);
    editorHistory.typingTimer = null;
    markdownInput.value = tab.content;
    if (tab.history) {
        editorHistory.stack = tab.history.stack;
        editorHistory.index = tab.history.index;
    } else {
        editorHistory.stack = [];
        editorHistory.index = -1;
        editorHistory.saveCurrentState(markdownInput);
    }
    markdownInput.scrollTop = tab.scrollTop;
    updateEditorHighlight();
    // editorHighlight.scrollTop đặt SAU updateEditorHighlight: hàm đó thay innerHTML nên trình duyệt
    // reset scrollTop về 0, đặt trước là gán vào cây DOM cũ rồi bị xoá.
    editorHighlight.scrollTop = tab.scrollTop;
    // Nhánh cache tự đặt lại scrollTop; nhánh renderMarkdown giữ scrollTop CŨ (của tab vừa rời) nên
    // phải zero trước, không thì tab mới mở ra nằm giữa chừng trang của tab cũ.
    previewOutput.scrollTop = 0;
    if (tab.preview && tab.preview.content === tab.content) renderCachedHtml(tab.preview.html, tab.preview.scroll);
    else renderMarkdown();
    markdownInput.setSelectionRange(tab.selStart, tab.selEnd);
    markdownInput.focus();
}

// Cache preview của tab: đổi tab thì chỉ gán innerHTML, không chạy lại marked + DOMPurify + hljs +
// KaTeX + Mermaid. Cache hỏng khi nội dung tab đổi, khi đổi theme (màu Mermaid/syntax đi theo), và
// khi Mermaid vẽ xong sau khi hàm đã trả về.
export function cacheActivePreview() {
    const tab = getActiveTab();
    if (!tab) return;
    tab.preview = { content: tab.content, html: currentPreviewHtml(), scroll: previewOutput.scrollTop };
}

export function invalidatePreviewCaches() {
    tabs.forEach((tab) => { tab.preview = null; });
}

// Render preview của tab đang mở (dùng cache nếu còn khớp). view-mode gọi khi chuyển sang chế độ
// có preview, vì lúc ở chế độ Editor mọi lượt render đều bị bỏ qua.
export function renderActivePreview() {
    const tab = getActiveTab();
    if (!tab) return;
    if (tab.preview && tab.preview.content === tab.content) renderCachedHtml(tab.preview.html, tab.preview.scroll);
    else {
        renderMarkdown();
        cacheActivePreview();
    }
}

onPreviewChanged(invalidatePreviewCaches);

export function switchTab(id) {
    if (id === activeId) return;
    activateTab(tabs.find((tab) => tab.id === id));
}

export function cycleTab(step) {
    if (tabs.length < 2) return;
    const i = tabs.findIndex((tab) => tab.id === activeId);
    switchTab(tabs[(i + step + tabs.length) % tabs.length].id);
}

// Đổi chỗ một tab: thứ tự trong mảng `tabs` chính là thứ tự hiển thị và thứ tự lưu vào
// session, nên chỉ cần splice rồi emit — không cần trường order riêng.
// `toIndex` tính trên danh sách ĐÃ bỏ tab đang kéo (tabs.js truyền vào đúng nghĩa đó).
export function moveTab(id, toIndex) {
    const from = tabs.findIndex((tab) => tab.id === id);
    if (from < 0) return;
    const to = Math.max(0, Math.min(toIndex, tabs.length - 1));
    if (from === to) return;
    tabs.splice(to, 0, tabs.splice(from, 1)[0]);
    emit();
    saveSession();
}

export function newTab() {
    // Tab rỗng chưa gõ gì thì không có gì để mất: dùng mặc định của createTab (sạch) cho giống tab
    // Untitled lúc khởi động, không đánh dấu chưa lưu chỉ vì vừa bấm "+".
    return activateTab(createTab());
}

// Ngăn xếp tab vừa đóng, để mở lại bằng Ctrl+Shift+T. Giữ CẢ nội dung: tab đóng thường là tab
// người dùng bấm nhầm hoặc đóng rồi nhận ra ngay, đọc lại từ đĩa thì mất trắng phần chưa lưu.
// Chỉ trong RAM — đóng app là mất, chấp nhận.
const CLOSED_TAB_LIMIT = 10;
const closedTabs = [];

function rememberClosedTab(tab) {
    closedTabs.push({ path: tab.path, name: tab.name, content: tab.content, savedContent: tab.savedContent, eol: tab.eol, bom: tab.bom, status: tab.status, diskMtime: tab.diskMtime, pinned: tab.pinned });
    if (closedTabs.length > CLOSED_TAB_LIMIT) closedTabs.shift();
}

export function reopenClosedTab() {
    const closed = closedTabs.pop();
    if (!closed) {
        showToast('No recently closed tab.');
        return;
    }
    const tab = createTab(closed);
    activateTab(tab);
}

export async function closeTab(id) {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    if (isTabDirty(tab)) {
        // 3 lựa chọn thay cho confirm(): confirm() không có "Save", buộc người dùng phải hủy,
        // lưu rồi đóng lại — và bấm nhầm Cancel thì mất luôn.
        const choice = await confirmAction({
            title: 'Close tab',
            message: `"${tab.name}" has unsaved changes.`,
            actions: [{ id: 'save', label: 'Save' }, { id: 'discard', label: "Don't save" }]
        });
        if (!choice) return;
        if (choice === 'save') await saveTab(tab);
        if (tabs.indexOf(tab) < 0) return;
    }

    rememberClosedTab(tab);
    const wasActive = tab.id === activeId;
    const index = tabs.indexOf(tab);
    tabs.splice(index, 1);

    if (wasActive) {
        // Không để app rơi vào trạng thái không có editor.
        activateTab(tabs.length ? tabs[Math.min(index, tabs.length - 1)] : createTab());
    }
    emit();
    saveSession();
}

// Nội dung tab đang mở vừa đổi (mọi đường ghi đều đi qua syncEditorAfterChange).
// Chỉ emit khi cờ "chưa lưu" lật, không emit mỗi lần gõ — tab strip không cần dựng lại 200 lần/giây.
export function updateActiveContent(text) {
    const tab = getActiveTab();
    if (!tab) return;
    const wasDirty = isTabDirty(tab);
    tab.content = text;
    // Chỉ emit khi cờ "chưa lưu" lật, không emit mỗi lần gõ — tab strip không cần dựng lại 200 lần/giây.
    if (isTabDirty(tab) !== wasDirty) emit();
}

const dialog = () => (window.__TAURI__ ? window.__TAURI__.dialog : undefined);

const fs = () => (window.__TAURI__ ? window.__TAURI__.fs : undefined);

export async function openFiles() {
    if (!dialog()?.open || !fs()?.readTextFile) {
        showToast("Opening files needs the desktop app - this browser build can't reach your files.");
        return;
    }

    const picked = await dialog().open({
        multiple: true,
        filters: [{ name: 'Markdown', extensions: MARKDOWN_EXTS }]
    });
    if (!picked) return;

    const paths = (Array.isArray(picked) ? picked : [picked]).filter(isMarkdownPath);
    if (!paths.length) {
        showToast('No Markdown files selected.');
        return;
    }
    await openPaths(paths);
}

// Mở danh sách đường dẫn thành tab. Tách khỏi openFiles vì còn nguồn khác gọi tới: kéo-thả file
// vào cửa sổ, file association, danh sách recent.
export async function openPaths(paths) {
    let opened = 0;
    let failed = 0;
    const created = [];
    let reused = null;

    for (const path of paths) {
        const existing = tabs.find((tab) => sameFilePath(tab.path, path));
        if (existing) {
            reused = existing;
            opened++;
            continue;
        }
        const raw = await readTextFile(path);
        if (raw === null) {
            failed++;
            continue;
        }
        if (raw.length > MAX_FILE_CHARS) {
            showToast(`"${path.split(/[\\/]/).pop()}" is too large (5MB max).`);
            failed++;
            continue;
        }
        // Giữ kiểu xuống dòng của file; textarea chỉ hiểu LF nên nội dung trong tab luôn là LF.
        const eol = detectEol(raw);
        const bom = detectBom(raw);
        const text = toLf(stripBom(raw));
        const tab = createTab({
            path,
            name: path.split(/[\\/]/).pop(),
            content: text,
            savedContent: text,
            eol,
            bom,
            diskMtime: mtimeOf(await statFile(path))
        });
        noteRecentPath(path);
        created.push(tab);
        opened++;
    }

    // Chỉ nạp MỘT tab vào editor thay vì nạp từng tab một: mỗi lần nạp là một lượt render đầy đủ
    // (marked + DOMPurify + KaTeX + Mermaid), mở 10 file là 10 lượt render để rồi 9 lượt bị xoá ngay.
    const target = created[created.length - 1] || reused;
    if (target) activateTab(target);

    emit();
    saveSession();
    showToast(opened === 1 && !failed
        ? `Opened "${tabs.find((t) => sameFilePath(t.path, paths[0]))?.name ?? ''}".`
        : `Opened ${opened} file${opened === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}.`);
}

// Tên gợi ý cho hộp thoại Save As: tab mở từ file thì theo tên file (đổi tên theo H1 sẽ gợi ý sai
// file), tab chưa có đường dẫn thì mới lấy H1.
function defaultSaveName(tab, content) {
    if (!tab.path) return deriveExportBaseName(content);
    return tab.name.replace(/\.[^./\\]+$/, '') || deriveExportBaseName(content);
}

// Ctrl+S liên tiếp (hoặc bấm nút Save nhiều lần) không được mở hai hộp thoại / ghi chồng lên nhau.
let saving = false;

export async function saveActiveDoc(options = {}) {
    return saveTab(getActiveTab(), options);
}

// Lưu một tab bất kỳ (không nhất thiết tab đang mở): Save All và "Save rồi đóng" của tab nền cần
// vậy. Trả true nếu thực sự ghi xong, false nếu người dùng hủy hoặc ghi hỏng.
export async function saveTab(tab, options = {}) {
    if (!tab || saving) return false;
    // Lưu tab sạch chỉ đổi mtime của file, người dùng không được gì từ đó. Ngoại lệ: tab lỗi
    // (status !== 'ok') thì "sạch" chỉ có nghĩa là chưa sửa gì so với bản rỗng, vẫn phải cho lưu.
    if (!isTabDirty(tab) && tab.status === 'ok' && !options.as) return true;
    saving = true;
    try {
        // Chụp nội dung TRƯỚC mọi await: nếu người dùng gõ thêm trong lúc hộp thoại Save As đang mở
        // hoặc lúc ghi, đĩa nhận bản đã chụp và tab phải vẫn hiện chưa lưu - gán tab.content sau await
        // sẽ đánh dấu "đã lưu" cho phần chưa từng xuống đĩa.
        const snapshot = tab.content;
        let path = tab.path;

        // File đích đang nằm trong tab khác: hai tab cùng trỏ một file là hai lần ghi đè lên nhau,
        // đúng cái logic dedupe của openFiles cố tránh. Chặn TRƯỚC khi ghi, không phải sau.
        const clashOf = (p) => tabs.find((other) => other !== tab && sameFilePath(other.path, p));

        // File còn nguyên trên đĩa không. Chạy TRƯỚC nhánh ghi để khi người dùng chọn "Save as..."
        // ở hộp thoại file biến mất, ta chuyển status sang 'unreadable' và đi đúng nhánh Save As
        // thay vì ghi vào một đường dẫn không còn tồn tại.
        if (!options.as && path && tab.status === 'ok') {
            const decision = await diskOkToWrite(tab);
            if (decision === 'stop') return false;
            if (decision === 'saveas') tab.status = 'unreadable';
        }

        // status !== 'ok' (đọc lỗi / file bị xoá) tuyệt đối không ghi vào đường dẫn cũ: nội dung lúc
        // đó có thể là bản rỗng, ghi là xoá sạch file thật. Bắt buộc rơi về Save As.
        if (!path || tab.status !== 'ok' || options.as) {
            const picked = await saveTextFile(snapshot, defaultSaveName(tab, snapshot), 'md', 'text/markdown;charset=utf-8');
            if (!picked) return false;
            const clash = clashOf(picked);
            if (clash) {
                showToast(`"${picked.split(/[\\/]/).pop()}" is already open in the "${clash.name}" tab.`);
                return false;
            }
            path = picked;
        } else if (clashOf(path)) {
            showToast('This file is also open in another tab. Close that tab before saving here.');
            return false;
        } else if (!await writeTextFile(path, snapshot, tab.eol, tab.bom)) {
            // Ghi đè thất bại (đường dẫn ngoài scope sau khởi động lại, file bị khoá, chỉ đọc...):
            // đường dẫn cũ không còn dùng được nên cho chọn chỗ mới ngay, không để tab kẹt không lưu được.
            const saved = await saveTextFile(snapshot, defaultSaveName(tab, snapshot), 'md', 'text/markdown;charset=utf-8');
            if (!saved) return false;
            path = saved;
        }

        if (!sameFilePath(tab.path, path)) {
            tab.path = path;
            tab.name = path.split(/[\\/]/).pop();
            // saveTextFile không biết eol/bom của file đích: nó luôn ghi LF không BOM, nên đích mới là file LF không BOM.
            tab.eol = '\n';
            tab.bom = false;
        }

        // Ghi xong thì file trên đĩa đúng bằng nội dung tab, kể cả khi Save As chọn lại chính
        // đường dẫn cũ của tab lỗi (sameFilePath -> khối trên không chạy, status phải tự bỏ).
        tab.status = 'ok';
        tab.diskMtime = mtimeOf(await statFile(path));
        tab.savedContent = snapshot;
        emit();
        saveSession();
        showToast(`Saved "${tab.name}".`);
        return true;
    } finally {
        saving = false;
    }
}

// Lưu mọi tab đang sửa, tuần tự: mỗi bước có thể mở hộp thoại Save As nên chạy song song sẽ lồn
// hộp thoại lên nhau.
export async function saveAllTabs() {
    const dirty = tabs.filter(isTabDirty);
    if (!dirty.length) {
        showToast('Nothing to save.');
        return;
    }
    let done = 0;
    for (const tab of dirty) {
        if (await saveTab(tab)) done++;
    }
    if (done < dirty.length) showToast(`Saved ${done} of ${dirty.length} tabs.`);
}

// ---- File bị sửa / bị xoá từ bên ngoài ---------------------------------------

// So mốc đĩa của tab với fs.stat() hiện tại. Hàm thuần, selfcheck gọi được.
// 'gone'     - stat() hỏng: file không còn trên đĩa (xoá, di chuyển, ổ cắm rút).
// 'unknown' - không có mốc để so (tab vừa Save As, hoặc filesystem không trả mtime): không hỏi,
//             vì hỏi mỗi lần lưu vì một lý do không xác định là hỏi cho có.
// 'same'/'changed' - mtime khớp / lệch.
export function diskRevision(stat, diskMtime) {
    if (!stat) return 'gone';
    const m = mtimeOf(stat);
    if (diskMtime === null || m === null) return 'unknown';
    return m === diskMtime ? 'same' : 'changed';
}

async function reloadTabFromDisk(tab) {
    const raw = await readTextFile(tab.path);
    if (raw === null || raw.length > MAX_FILE_CHARS) {
        tab.status = 'unreadable';
        tab.diskMtime = null;
        emit();
        return false;
    }
    tab.eol = detectEol(raw);
    tab.bom = detectBom(raw);
    tab.content = toLf(stripBom(raw));
    tab.savedContent = tab.content;
    tab.status = 'ok';
    tab.diskMtime = mtimeOf(await statFile(tab.path));
    if (tab.id === activeId) restoreTabIntoEditor(tab);
    emit();
    return true;
}

// Cổng chặn trước khi ghi đè: hỏi người dùng khi file trên đĩa đã khác với lúc mở tab.
// 'proceed' -> ghi tiếp. 'stop' -> dừng, không ghi gì. 'saveas' -> buộc rơi về Save As
// (saveTab chuyển status sang 'unreadable' để đi đúng nhánh đó).
async function diskOkToWrite(tab) {
    const revision = diskRevision(await statFile(tab.path), tab.diskMtime);
    if (revision === 'same' || revision === 'unknown') return 'proceed';

    if (revision === 'gone') {
        tab.status = 'missing';
        emit();
        if (!isTabDirty(tab)) return 'stop';
        const choice = await confirmAction({
            title: 'File is gone',
            message: `"${tab.path}"\nno longer exists on disk, and this tab has unsaved changes.`,
            actions: [{ id: 'saveas', label: 'Save as...' }, { id: 'close', label: 'Close tab' }]
        });
        if (choice === 'close') await closeTab(tab.id);
        return choice === 'saveas' ? 'saveas' : 'stop';
    }

    // revision === 'changed'
    if (!isTabDirty(tab)) {
        // Tab sạch: không có gì để mất cục bộ, đĩa là nguồn đúng -> tải lại không hỏi.
        await reloadTabFromDisk(tab);
        return 'stop';
    }
    const choice = await confirmAction({
        title: 'File changed on disk',
        message: `"${tab.path}"\nwas changed by another program after you opened it.`,
        actions: [{ id: 'keep', label: 'Keep my version' }, { id: 'disk', label: 'Load from disk' }]
    });
    if (choice === 'disk') {
        await reloadTabFromDisk(tab);
        return 'stop';
    }
    if (choice !== 'keep') return 'stop';
    // Ghi đè bản của mình: lấy mốc đĩa HIỆN TẠI làm mốc mới, nếu không lần lưu sau sẽ hỏi lại y hệt.
    tab.diskMtime = mtimeOf(await statFile(tab.path));
    return 'proceed';
}

// Cửa sổ lấy lại focus là lúc file trên đĩa nhiều khả năng vừa bị đụng (git pull, Word, sync đám mây).
// Kiểm tra tab đang mở; tab sạch tự tải lại, tab đang sửa thì hỏi.
export async function checkActiveTabDisk() {
    const tab = getActiveTab();
    if (!tab || !tab.path || tab.status !== 'ok' || restoring) return;
    if (diskRevision(await statFile(tab.path), tab.diskMtime) === 'changed') {
        await diskOkToWrite(tab);
    }
}

// ---- Session ----------------------------------------------------------------

// Nội dung tab sạch có đường dẫn không lưu vào session: lúc khôi phục đọc lại từ đĩa. Quota
// localStorage tính cho CẢ origin (~5M ký tự) trong khi một file được phép tới 5M, nên nhồi nội
// dung mọi tab là tự đặt mình vào chỗ chết: session vừa to vừa không ghi được xuống.
export function sessionKeepsContent(tab) {
    return !tab.path || isTabDirty(tab);
}

// File vừa mở, mới nhất trước. Sống cùng bản ghi 'meta' của session (xem session-store.js).
const RECENT_LIMIT = 10;
let recentPaths = [];

export function getRecentPaths() {
    return recentPaths;
}

function noteRecentPath(path) {
    recentPaths = [path, ...recentPaths.filter((p) => !sameFilePath(p, path))].slice(0, RECENT_LIMIT);
}

// Hàm thuần: selfcheck gọi được mà không đụng editor thật.
export function serializeSession() {
    return {
        activeId,
        recent: recentPaths,
        tabs: tabs.map((tab) => ({
            id: tab.id,
            path: tab.path,
            name: tab.name,
            // null = "không lưu, đọc từ đĩa lúc khôi phục" (khác '' là tab sạch thật sự rỗng).
            content: sessionKeepsContent(tab) ? tab.content : null,
            // Kiểu xuống dòng và BOM phải sống cùng session: tab lưu được nội dung (dirty / chưa có path)
            // không được đọc lại từ đĩa, nên mất eol là lần lưu sau ghi đè file CRLF thành LF, mất
            // bom là file gốc bị mất BOM.
            eol: tab.eol,
            bom: tab.bom,
            // status và diskMtime phải sống cùng session: status='unreadable' là thứ duy nhất
            // chặn Ctrl+S ghi đè file thật bằng nội dung rỗng sau khi khởi động lại, còn diskMtime
            // là mốc so để lần lưu tới không báo "file bên ngoài đã đổi" một cách giả.
            status: tab.status,
            diskMtime: tab.diskMtime,
            pinned: tab.pinned === true,
            // Không lưu savedContent (nhân đôi dung lượng). dirty === false nghĩa là lúc đóng nội dung
            // khớp đĩa; dirty === true nghĩa là đã sửa sau lần lưu cuối -> vẫn phải hiện chưa lưu.
            dirty: isTabDirty(tab),
            scrollTop: tab.scrollTop,
            selStart: tab.selStart,
            selEnd: tab.selEnd
        }))
    };
}

// Hàm thuần. Trả null nếu JSON hỏng -> caller dựng session mới thay vì crash lúc khởi động.
// Ids phải là số nguyên dương và khác nhau: id hỏng làm nextId = NaN, kéo theo activeId và
// getActiveTab() hỏng theo. Id trùng cũng hỏng: hai tab cùng id thì active/close/đổi thứ tự nhắm
// nhầm tab. Id xấu bị cấp lại từ `fallbackId`.
export function deserializeSession(raw, fallbackId = 1) {
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.tabs) || !data.tabs.length) return null;
    const usedIds = new Set();
    const restored = data.tabs.map((t) => {
        const path = typeof t.path === 'string' ? t.path : null;
        // Session của build cũ lưu BOM trong content -> bỏ luôn, nếu không dòng đầu mất heading
        // vĩnh viễn và lần lưu sau âm thầm mất BOM của file. Strip MỘT lần rồi dùng lại cho cả
        // content lẫn savedContent, không thì hai bên lệch nhau khiến tab sạch hoá dirty.
        const stored = typeof t.content === 'string' ? stripBom(t.content) : null;
        // content === null + có path = session không lưu nội dung tab này, đọc lại từ đĩa.
        const reload = stored === null && !!path;
        const content = stored === null ? '' : stored;
        let id = Number.isSafeInteger(t.id) && t.id > 0 ? t.id : null;
        if (id === null || usedIds.has(id)) id = fallbackId++;
        usedIds.add(id);
        return {
            id,
            path,
            name: typeof t.name === 'string' && t.name ? t.name : UNTITLED,
            content,
            // Tab CHƯA có path thì mốc "đã lưu" hợp lệ là chuỗi rỗng, không phải null: null nghĩa là
            // "chưa bao giờ xuống đĩa" nên tab đó vĩnh viễn dirty và cứ hỏi khi đóng, kể cả khi
            // người dùng đã xoá hết nội dung. Chỉ tab có path mới cần null (không có bản trên đĩa
            // để so).
            savedContent: t.dirty ? (path ? null : '') : content,
            // Session không lưu nội dung tab này -> restoreSession phải đọc lại từ đĩa, và
            // chỉ được nạp vào editor sau khi đọc xong (xem vòng lặp trong restoreSession).
            reload,
            eol: t.eol === '\r\n' ? '\r\n' : '\n',
            bom: t.bom === true,
            status: t.status === 'unreadable' || t.status === 'missing' ? t.status : 'ok',
            diskMtime: Number.isFinite(t.diskMtime) ? t.diskMtime : null,
            pinned: t.pinned === true,
            scrollTop: Number(t.scrollTop) || 0,
            selStart: Number(t.selStart) || 0,
            selEnd: Number(t.selEnd) || 0,
            history: null
        };
    });
    return { activeId: data.activeId, tabs: restored };
}

export function saveSession() {
    if (restoring) return;
    captureActive();
    return writeSession(serializeSession()).catch((err) => {
        // Không xoá gì cả: bản ghi cũ trong IndexedDB vẫn nguyên vẹn, và lần ghi sau thử lại được.
        // Xoá phiên là cách nhanh nhất để mất bản nháp của mọi tab.
        const now = Date.now();
        if (now - quotaWarnedAt > 10000) {
            quotaWarnedAt = now;
            showToast(`Could not save this session: ${err && err.message ? err.message : err}`);
        }
    });
}

async function loadRestoredSession() {
    const stored = await loadSession();
    if (stored) {
        recentPaths = stored.recent.filter((p) => typeof p === 'string' && p).slice(0, RECENT_LIMIT);
        return deserializeSession(JSON.stringify(stored));
    }

    // Chưa có gì trong IndexedDB: đây là lần chạy đầu sau khi đổi tầng lưu. Ghi phiên cũ sang
    // IndexedDB TRƯỚC rồi mới xoá key localStorage — xoá trước là mất phiên nếu ghi hỏng.
    let legacyRaw = null;
    try {
        legacyRaw = localStorage.getItem(SESSION_KEY);
    } catch (e) {
        legacyRaw = null;
    }
    if (!legacyRaw) return null;
    try {
        await migrateLegacySession(legacyRaw);
    } catch (e) {
        console.error('Không migrate được phiên cũ sang IndexedDB:', e);
    }
    return deserializeSession(legacyRaw);
}

export async function restoreSession() {
    restoring = true;
    tabs.length = 0;
    activeId = null;
    nextId = 1;
    recentPaths = [];

    let restored = null;
    try {
        restored = await loadRestoredSession();
    } catch (e) {
        console.error('Không đọc được phiên làm việc:', e);
        restored = null;
    }

    if (restored) {
        restored.tabs.forEach((tab) => { tabs.push(tab); nextId = Math.max(nextId, tab.id + 1); });
        activeId = tabs.some((tab) => tab.id === restored.activeId) ? restored.activeId : tabs[0].id;
    } else if (migrateLegacy()) {
        activeId = getActiveTab().id;
    } else {
        // Chưa từng dùng app: mở sẵn một tab Untitled rỗng (savedContent = content -> không dirty).
        activeId = createTab().id;
    }

    // Đọc tab ĐANG MỞ trước, dựng editor ngay, rồi mới đọc nốt các tab còn lại. Cũ (dựng hết tab
    // trước rồi mới await) để textarea rỗng suốt lúc chờ đĩa: bấm "+", mở file hay đóng cửa sổ
    // trong khoảng đó làm captureActive() gán chuỗi rỗng đè lên bản nháp vừa đọc.
    const active = getActiveTab();
    await loadTabFromDisk(active);

    restoring = false;
    restoreTabIntoEditor(active);
    emit();
    saveSession();

    // Tab nền: đọc sau, lúc này editor đã có nội dung thật nên mọi tương tác của người dùng chạy
    // đúng; emit() cuối để tab vừa nạp cập nhật dấu chưa-lưu / tên.
    for (const tab of tabs) {
        if (tab !== active) await loadTabFromDisk(tab);
    }
    emit();
}

// Nạp nội dung tab từ đĩa khi session không lưu nó (tab sạch có path). Đọc lỗi (file bị xoá/di
// chuyển, ngoài ACL) hoặc file phình quá giới hạn -> status='unreadable'. Đó là chốt chặn khiến
// saveActiveDoc bắt buộc Save As thay vì writeTextFile(path, ''): nội dung lúc này là bản rỗng,
// ghi vào đường dẫn cũ là xoá sạch file thật.
async function loadTabFromDisk(tab) {
    if (!tab || !tab.reload) return;
    tab.reload = false;
    const raw = await readTextFile(tab.path);
    if (raw === null || raw.length > MAX_FILE_CHARS) {
        tab.savedContent = null;
        tab.status = 'unreadable';
        tab.diskMtime = null;
        return;
    }
    tab.eol = detectEol(raw);
    tab.bom = detectBom(raw);
    tab.content = toLf(stripBom(raw));
    tab.savedContent = tab.content;
    tab.diskMtime = mtimeOf(await statFile(tab.path));
}

// Một lần duy nhất: dựng tab Untitled từ nháp single-document cũ rồi xoá key cũ.
function migrateLegacy() {
    let legacy = null;
    try {
        legacy = localStorage.getItem(LEGACY_KEY);
        localStorage.removeItem(LEGACY_KEY);
    } catch (e) {
        return false;
    }
    if (typeof legacy !== 'string' || !legacy) return false;
    createTab({ content: legacy, savedContent: null });
    activeId = tabs[tabs.length - 1].id;
    return true;
}

// Ghi session ra kho rồi resolve khi đã ghi xong. onCloseRequested chặn cửa sổ và chỉ destroy
// sau khi hàm này xong — nếu chỉ gọi saveSession() (không await) thì lần ghi bị huỷ giữa đường
// cùng lúc cửa sổ đang đóng.
export async function flushSession() {
    await saveSession();
    await whenSessionWritten();
}

export function initDocuments() {
    btnImport.addEventListener('click', () => { openFiles(); });
    btnSave.addEventListener('click', () => { saveActiveDoc(); });
    btnSaveAs.addEventListener('click', () => { saveActiveDoc({ as: true }); });
    btnSaveAll.addEventListener('click', () => { saveAllTabs(); });

    initOpenFromOs();
}

// Nguồn mở file ngoài hộp thoại: kéo-thả vào cửa sổ, và sự kiện 'open-paths' do tiến trình thứ hai
// bắn sang (single-instance + file association).
function initOpenFromOs() {
    const webview = window.__TAURI__ && window.__TAURI__.webview;
    if (webview?.getCurrentWebview) {
        webview.getCurrentWebview()
            .onDragDropEvent((event) => {
                const payload = event.payload;
                if (payload.type === 'drop' && payload.paths?.length) openPaths(payload.paths.filter(isMarkdownPath));
            })
            .catch((err) => console.warn('[documents] drag-drop listen failed', err));
    }

    // single-instance: tiến trình thứ hai thoát ngay và gửi đường dẫn qua đây. Không có listener
    // này thì lần mở file thứ hai bằng OS sẽ bị bỏ qua im lặng.
    const listen = window.__TAURI__ && window.__TAURI__.event;
    listen?.listen('open-paths', ({ payload }) => {
        const paths = (Array.isArray(payload) ? payload : []).filter(isMarkdownPath);
        if (paths.length) openPaths(paths);
    }).catch((err) => console.warn('[documents] open-paths listen failed', err));

    // Lưu ngay (không debounce) khi cửa sổ sắp mất focus (thu nhỏ, Alt+Tab) để không mất nội
    // dung gõ cuối cùng. Đường thoát thật (đóng cửa sổ) do window-controls chặn và await flushSession.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') saveSession();
    });
}