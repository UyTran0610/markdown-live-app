// js/io/documents.js — Store tab: nội dung, đọc/ghi file, session (một textarea chung).

import { btnImport, btnSave, btnSaveAll, btnSaveAs, editorHighlight, markdownInput, previewOutput } from '../core/dom.js';
import { showToast } from '../core/toast.js';
import { updateEditorHighlight } from '../editor/highlight.js';
import { editorHistory, pruneAllHistories } from '../editor/history.js';
import { chooseSavePath, deriveExportBaseName, detectBom, detectEol, hashText, mtimeOf, readTextFile, sameFilePath, statFile, stripBom, toLf, writeTextFile } from '../export/file-save.js';
import { currentPreviewHtml, onPreviewChanged, renderCachedHtml, renderMarkdown } from '../preview/render.js';
import { confirmAction } from '../ui/confirm-dialog.js';
import { loadSession, migrateLegacySession, whenSessionWritten, writeSession } from './session-store.js';

const SESSION_KEY = 'markdown-live-session';

// Key single-document cũ, đọc một lần rồi xoá sau khi migrate.
const LEGACY_KEY = 'markdown-live-content';

// Đuôi văn bản — ranh giới DUY NHẤT chặn file nhị phân, đừng nới thêm.
const MARKDOWN_EXTS = ['md', 'markdown', 'mdown', 'mkd', 'mdx', 'rmd', 'qmd', 'txt', 'text'];

const MAX_FILE_CHARS = 5 * 1024 * 1024;

const UNTITLED = 'Untitled';

// tab: { id, path, name, content, savedContent, eol, bom, status, diskMtime, savedHash, savedLen, reload }
// content luôn LF; eol/bom nhớ bản đĩa. savedContent === null = chưa từng ghi đĩa.
// status !== 'ok' cấm ghi đè path cũ (phải Save As).
const tabs = [];
let activeId = null;
const listeners = [];
let nextId = 1;

// Đang khôi phục session: gán textarea vào tab active sẽ xoá bản nháp đọc từ đĩa.
let restoring = false;

// EOL mặc định cho tab mới, đổi ở status bar và nhớ qua session.
let defaultEol = '\n';

let quotaWarnedAt = 0;

export function isMarkdownPath(path) {
    const name = String(path || '').split(/[\\/]/).pop().toLowerCase();
    const dot = name.lastIndexOf('.');
    // Không có đuôi (README, LICENSE) vẫn là file văn bản thật.
    if (dot <= 0) return !!name;
    return MARKDOWN_EXTS.includes(name.slice(dot + 1));
}

// savedContent === null có hai nghĩa: chưa từng ghi đĩa (luôn dirty) hoặc tab khôi phục
// chỉ có hash+len (sạch nếu gõ lại đúng bản gốc) — xem savedHash/savedLen.
export function isTabDirty(tab) {
    if (tab.content === tab.savedContent) return false;
    if (tab.savedContent !== null) return true;
    const len = typeof tab.content === 'string' ? tab.content.length : -1;
    return !(tab.savedHash && tab.savedLen === len && tab.savedHash === hashText(tab.content));
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

// Tên Untitled N nhỏ nhất còn trống; hàm thuần.
export function untitledName(existing) {
    const names = new Set((existing || tabs).map((tab) => tab.name));
    let n = 1;
    while (names.has(`${UNTITLED} ${n}`)) n++;
    return `${UNTITLED} ${n}`;
}

// `= {}` bắt buộc: restoreSession gọi createTab() không tham số.
function createTab({ path = null, name = null, content = '', savedContent = content, eol = defaultEol, bom = false, status = 'ok', diskMtime = null, pinned = false } = {}) {
    const tab = {
        id: nextId++,
        path,
        name: name || untitledName(),
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

// Tab ghim chỉ chặn đóng hàng loạt; Ctrl+W vẫn đóng được.
export function updateTabPin(id) {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    tab.pinned = !tab.pinned;
    emit();
    saveSession();
}

// Đổi EOL khi lưu; nội dung tab luôn LF nên không đụng content.
export function setActiveEol(eol) {
    const tab = getActiveTab();
    if (!tab || (eol !== '\n' && eol !== '\r\n')) return;
    tab.eol = eol;
    // Tab chưa có file: lựa chọn này thành mặc định cho các tab Untitled sau.
    if (!tab.path) defaultEol = eol;
    showToast(`New lines will be saved as ${eol === '\r\n' ? 'CRLF' : 'LF'}.`);
    emit();
    saveSession();
}

// Điểm vào DUY NHẤT để đổi activeId: capture -> load -> render -> prune -> emit -> saveSession.
// switchTab/newTab/closeTab/openPaths/reopenClosedTab/restoreSession đều đi qua đây.
export function activateTab(tab) {
    if (!tab) return null;
    captureActive();
    activeId = tab.id;
    restoreTabIntoEditor(tab);
    pruneHistories();
    emit();
    saveSession();
    // Kiểm luôn tab vừa mở vì chuyển tab cũng là lúc file ngoài dễ bị sửa.
    if (!restoring) checkActiveTabDisk();
    return tab;
}

// Cắt lịch sử lúc chuyển tab (không phải mỗi lần gõ); tab active đặt cuối nên bị cắt sau cùng.
function pruneHistories() {
    const active = getActiveTab();
    const histories = tabs
        .filter((tab) => tab !== active && tab.history)
        .map((tab) => tab.history);
    histories.push(editorHistory);
    pruneAllHistories(histories);
    // index có thể đã dịch sau khi cắt: ghi lại để lần sau khôi phục đúng vị trí undo.
    if (active) active.history = { stack: editorHistory.stack, index: editorHistory.index };
}

// Nhét trạng thái editor vào tab đang mở; phải gọi TRƯỚC khi đổi activeId.
function captureActive() {
    if (restoring) return;
    const tab = getActiveTab();
    if (!tab) return;
    tab.content = markdownInput.value;
    tab.selStart = markdownInput.selectionStart;
    tab.selEnd = markdownInput.selectionEnd;
    tab.scrollTop = markdownInput.scrollTop;
    // Preview scroll thuộc về tab, không nhớ thì đổi tab là mất chỗ đang đọc.
    if (tab.preview && tab.preview.content === tab.content) tab.preview.scroll = previewOutput.scrollTop;
    tab.history = { stack: editorHistory.stack, index: editorHistory.index };
}

// Timer gom lịch sử đang treo sẽ đẩy text tab mới vào stack tab vừa rời.
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
    // Đặt SAU updateEditorHighlight: hàm đó thay innerHTML nên reset scrollTop về 0.
    editorHighlight.scrollTop = tab.scrollTop;
    // renderMarkdown giữ scrollTop cũ nên phải zero trước khi render tab mới.
    previewOutput.scrollTop = 0;
    if (tab.preview && tab.preview.content === tab.content) renderCachedHtml(tab.preview.html, tab.preview.scroll);
    else renderMarkdown();
    markdownInput.setSelectionRange(tab.selStart, tab.selEnd);
    markdownInput.focus();
}

// Cache preview theo tab (key = content) để đổi tab không chạy lại marked/sanitize/KaTeX/Mermaid.
// Phải invalidate khi đổi theme và khi Mermaid vẽ xong muộn.
export function cacheActivePreview() {
    const tab = getActiveTab();
    if (!tab) return;
    tab.preview = { content: tab.content, html: currentPreviewHtml(), scroll: previewOutput.scrollTop };
}

export function invalidatePreviewCaches() {
    tabs.forEach((tab) => { tab.preview = null; });
}

// Render preview tab đang mở; view-mode gọi khi chuyển sang chế độ có preview.
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

// Thứ tự mảng tabs là thứ tự hiển thị và thứ tự lưu; toIndex tính trên danh sách đã bỏ tab kéo.
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
    // Tab rỗng mới mở không dirty: không có gì để mất.
    return activateTab(createTab());
}

// Ngăn xếp tab vừa đóng (Ctrl+Shift+T), giữ cả nội dung; chỉ trong RAM, đóng app là mất.
const CLOSED_TAB_LIMIT = 10;
const closedTabs = [];

function rememberClosedTab(tab) {
    // Bỏ tab Untitled sạch rỗng: mở lại chỉ ra tab trống vô nghĩa.
    if (!tab.path && !isTabDirty(tab) && !tab.content) return;
    closedTabs.push({
        path: tab.path, name: tab.name, content: tab.content, savedContent: tab.savedContent,
        savedHash: tab.savedHash, savedLen: tab.savedLen,
        eol: tab.eol, bom: tab.bom, status: tab.status, diskMtime: tab.diskMtime, pinned: tab.pinned
    });
    if (closedTabs.length > CLOSED_TAB_LIMIT) closedTabs.shift();
}

export function reopenClosedTab() {
    const closed = closedTabs.pop();
    if (!closed) {
        showToast('No recently closed tab.');
        return;
    }
    // File đã mở lại trong lúc chờ: chuyển tới tab đó thay vì mở tab thứ hai cùng file.
    const open = closed.path && tabs.find((tab) => sameFilePath(tab.path, closed.path));
    activateTab(open || createTab(closed));
}

export async function closeTab(id, { force = false, remember = true } = {}) {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    // force: đóng hàng loạt — người dùng đã trả lời một hộp thoại cho cả nhóm.
    if (!force && isTabDirty(tab)) {
        // 3 lựa chọn thay confirm(): confirm() không có Save, bấm nhầm Cancel là mất bản nháp.
        const choice = await confirmAction({
            title: 'Close tab',
            message: `"${tab.name}" has unsaved changes.`,
            actions: [{ id: 'save', label: 'Save' }, { id: 'discard', label: "Don't save" }]
        });
        if (!choice) return;
        if (choice === 'save') {
            // saveTab trả LÝ DO, không phải true/false: chỉ 'saved' và 'discard' mới được đóng tab.
            // Bỏ qua kết quả là cách bản cũ đóng tab dù Save As bị huỷ, mất nội dung chưa xuống đĩa.
            const result = await saveTab(tab);
            if (result !== 'saved' && result !== 'discard') return;
        }
        if (tabs.indexOf(tab) < 0) return;
    }

    // remember: false = tab tạm của perfcheck, không đẩy vào Ctrl+Shift+T.
    if (remember) rememberClosedTab(tab);
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

// Nội dung tab vừa đổi (mọi đường ghi qua syncEditorAfterChange); chỉ emit khi cờ dirty lật.
export function updateActiveContent(text) {
    const tab = getActiveTab();
    if (!tab) return;
    const wasDirty = isTabDirty(tab);
    tab.content = text;
    if (isTabDirty(tab) !== wasDirty) emit();
}

const dialog = () => (window.__TAURI__ ? window.__TAURI__.dialog : undefined);

const fs = () => (window.__TAURI__ ? window.__TAURI__.fs : undefined);

export async function openFiles() {
    // fs.readFile (bytes) để từ chối file không phải UTF-8 thay vì ghi hỏng lần sau.
    if (!dialog()?.open || !fs()?.readFile) {
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

// Tách khỏi openFiles: kéo-thả, file association và recent cũng gọi tới.
export async function openPaths(paths) {
    // Danh sách rỗng không được thành toast 'Opened 0 files'.
    if (!paths || !paths.length) return;
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
        // Giữ EOL của file; nội dung tab luôn LF.
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

    // Chỉ nạp tab active vào editor: mỗi lần nạp là một lượt render đầy đủ.
    const target = created[created.length - 1] || reused;
    if (target) activateTab(target);

    emit();
    saveSession();
    showToast(opened === 1 && !failed
        ? `Opened "${tabs.find((t) => sameFilePath(t.path, paths[0]))?.name ?? ''}".`
        : `Opened ${opened} file${opened === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}.`);
}

const baseName = (path) => String(path || '').split(/[\\/]/).pop();

// Thư mục lần lưu gần nhất, chỉ trong RAM, gợi ý cho Save As của tab chưa có file.
let lastSaveDir = null;

// Giữ đuôi và thư mục của tab; hàm thuần, selfcheck gọi được.
export function suggestSavePath(tab, content) {
    const sep = tab.path && String(tab.path).includes('\\') ? '\\' : '/';
    const dir = tab.path ? String(tab.path).slice(0, String(tab.path).lastIndexOf(sep)) : (lastSaveDir || '');
    const dot = tab.path ? tab.name.lastIndexOf('.') : -1;
    const base = dot > 0 ? tab.name.slice(0, dot) : (tab.path ? tab.name : '');
    const ext = dot > 0 ? tab.name.slice(dot + 1) : 'md';
    return `${dir ? dir + sep : ''}${base || deriveExportBaseName(content)}.${ext}`;
}

function noteSaveDir(path) {
    const p = String(path);
    const sep = p.includes('\\') ? '\\' : '/';
    const cut = p.lastIndexOf(sep);
    if (cut > 0) lastSaveDir = p.slice(0, cut);
}

// Chặn Ctrl+S liên tiếp mở hai hộp thoại/ghi chồng lên nhau.
let saving = false;

export async function saveActiveDoc(options = {}) {
    return saveTab(getActiveTab(), options);
}

// Lưu một tab bất kỳ, trả 'saved' | 'discard' | 'cancelled' | 'failed' | 'busy'.
// Chỉ 'saved' và 'discard' được dẫn tới đóng tab (xem closeTab).
// 'busy' = đang có lần lưu khác; 'discard' = người dùng bỏ bản nháp ở hộp thoại File is gone.
export async function saveTab(tab, options = {}) {
    if (!tab || saving) return 'busy';
    // Tab sạch không cần ghi; ngoại lệ tab lỗi vẫn phải cho lưu.
    if (!isTabDirty(tab) && tab.status === 'ok' && !options.as) return 'saved';
    saving = true;
    try {
        // Chụp nội dung TRƯỚC mọi await: người dùng gõ trong lúc hộp thoại mở thì đĩa nhận bản
        // đã chụp và tab vẫn phải dirty.
        const snapshot = tab.content;
        let path = tab.path;

        // File đích đang mở ở tab khác: hai tab cùng file là hai lần ghi đè nhau.
        const clashOf = (p) => tabs.find((other) => other !== tab && sameFilePath(other.path, p));

        // Chọn path + kiểm trùng TRƯỚC khi ghi. Trả { path } khi sẵn sàng, { error: true } khi
        // trùng tab, {} khi người dùng huỷ.
        const pickTarget = async () => {
            const picked = await chooseSavePath(suggestSavePath(tab, snapshot), MARKDOWN_EXTS);
            if (!picked) return {};
            const clash = clashOf(picked);
            if (clash) {
                showToast(`"${baseName(picked)}" is already open in the "${clash.name}" tab - nothing was written.`);
                return { error: true };
            }
            // Ghi đè chính path cũ không đọc được (mất quyền, ổ mạng) là đường file thật bị xoá bằng bản rỗng.
            if (tab.status !== 'ok' && sameFilePath(tab.path, picked)) {
                const ok = await confirmAction({
                    title: 'Overwrite unreadable file',
                    message: `"${baseName(picked)}"\ncould not be read, so this tab does not know what is in that file. Write this tab's content over it?`,
                    actions: [{ id: 'overwrite', label: 'Overwrite anyway' }]
                });
                return ok === 'overwrite' ? { path: picked } : {};
            }
            return { path: picked };
        };

        // Chạy TRƯỚC nhánh ghi: 'gone' thì chuyển status 'unreadable' và đi nhánh Save As.
        if (!options.as && path && tab.status === 'ok') {
            const decision = await diskOkToWrite(tab);
            // 'discard' đi LÊN qua giá trị trả về, không gọi closeTab() khi saving còn bật.
            if (decision === 'discard') return 'discard';
            if (decision === 'stop') return 'cancelled';
            if (decision === 'saveas') tab.status = 'unreadable';
        }

        // status !== 'ok': tuyệt đối không ghi path cũ (nội dung có thể rỗng) — buộc Save As.
        if (!path || tab.status !== 'ok' || options.as) {
            const target = await pickTarget();
            if (target.error) return 'failed';
            if (!target.path) return 'cancelled';
            if (!await writeTextFile(target.path, snapshot, tab.eol, tab.bom)) return 'failed';
            path = target.path;
        } else if (clashOf(path)) {
            showToast('This file is also open in another tab. Close that tab before saving here.');
            return 'failed';
        } else if (!await writeTextFile(path, snapshot, tab.eol, tab.bom)) {
            // Ghi hỏng (ngoài scope, file khoá, chỉ đọc): cho chọn chỗ mới ngay.
            const target = await pickTarget();
            if (target.error) return 'failed';
            if (!target.path) return 'cancelled';
            if (!await writeTextFile(target.path, snapshot, tab.eol, tab.bom)) return 'failed';
            path = target.path;
        }

        if (!sameFilePath(tab.path, path)) {
            tab.path = path;
            tab.name = baseName(path);
        }
        // Save As không reset eol/bom: lựa chọn CRLF/BOM phải đi theo file mới.
        noteSaveDir(path);
        noteRecentPath(path);

        // Ghi xong: đĩa khớp tab, kể cả khi Save As chọn lại path cũ của tab lỗi.
        tab.status = 'ok';
        tab.diskMtime = mtimeOf(await statFile(path));
        tab.savedContent = snapshot;
        // savedContent đã là chuỗi: hash + len không còn cần.
        tab.savedHash = null;
        tab.savedLen = null;
        tab.diskIgnoredMtime = null;
        emit();
        saveSession();
        showToast(`Saved "${tab.name}".`);
        return 'saved';
    } finally {
        saving = false;
    }
}

// Lưu tuần tự: mỗi bước có thể mở hộp thoại Save As nên không chạy song song.
export async function saveAllTabs() {
    const dirty = tabs.filter(isTabDirty);
    if (!dirty.length) {
        showToast('Nothing to save.');
        return;
    }
    let done = 0;
    for (const tab of dirty) {
        const result = await saveTab(tab);
        if (result === 'saved') done++;
        // 'discard': người dùng đã quyết định, đóng luôn thay vì bỏ qua im lặng.
        else if (result === 'discard') await closeTab(tab.id, { force: true });
    }
    if (done < dirty.length) showToast(`Saved ${done} of ${dirty.length} tabs.`);
}


// So mốc đĩa với fs.stat(): 'gone' (stat hỏng) | 'unknown' (không có mốc, không hỏi) |
// 'same' | 'changed'. Hàm thuần.
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
    tab.diskIgnoredMtime = null;
    // Lịch sử Undo cũ trỏ vào nội dung không còn trong tab: xoá để dựng stack mới.
    tab.history = null;
    if (tab.id === activeId) restoreTabIntoEditor(tab);
    // Tải lại âm thầm mà không nói gì thì tài liệu tự đổi trước mắt người dùng.
    showToast(`Reloaded "${tab.name}" from disk.`);
    emit();
    return true;
}

// 'proceed' | 'stop' | 'saveas' | 'discard'; hàm này KHÔNG tự đóng tab, chỉ trả quyết định.
// 'saveas' = saveTab chuyển status 'unreadable' để đi đúng nhánh Save As.
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
        // KHÔNG gọi closeTab() ở đây: saving còn bật nên Save ở hộp thoại thứ hai luôn thất bại.
        if (choice === 'close') return 'discard';
        return choice === 'saveas' ? 'saveas' : 'stop';
    }

    if (!isTabDirty(tab)) {
        // Tab sạch: đĩa là nguồn đúng, tải lại không hỏi.
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
    if (choice !== 'keep') {
        // Nhớ mtime đã bỏ qua để Alt+Tab không bật lại đúng hộp thoại này.
        tab.diskIgnoredMtime = mtimeOf(await statFile(tab.path));
        return 'stop';
    }
    // Lấy mốc đĩa hiện tại làm mốc mới, nếu không lần lưu sau hỏi lại.
    tab.diskMtime = mtimeOf(await statFile(tab.path));
    tab.diskIgnoredMtime = null;
    return 'proceed';
}

// Focus lại là lúc file ngoài dễ bị đụng (git pull, sync): kiểm tab đang mở.
export async function checkActiveTabDisk() {
    const tab = getActiveTab();
    if (!tab || !tab.path || tab.status !== 'ok' || restoring) return;
    const stat = await statFile(tab.path);
    const revision = diskRevision(stat, tab.diskMtime);
    // 'unknown' phải im lặng: không có mốc để so thì hỏi chỉ để hỏi.
    if (revision === 'same' || revision === 'unknown') return;
    // Người dùng đã giữ bản của mình cho đúng bản đang trên đĩa: đừng hỏi lại.
    if (revision === 'changed' && tab.diskIgnoredMtime !== null && tab.diskIgnoredMtime === mtimeOf(stat)) return;
    // 'gone' cũng đi qua đây để tab hiện dấu lỗi ngay; 'discard' = đóng thật, không nuốt lựa chọn.
    if (await diskOkToWrite(tab) === 'discard') await closeTab(tab.id, { force: true });
}


// Tab sạch có path không lưu content: khôi phục đọc lại từ đĩa (quota).
export function sessionKeepsContent(tab) {
    return !tab.path || isTabDirty(tab);
}

// File vừa mở, mới nhất trước; sống trong bản ghi 'meta'.
const RECENT_LIMIT = 10;
let recentPaths = [];

export function getRecentPaths() {
    return recentPaths;
}

export function clearRecentPaths() {
    if (!recentPaths.length) return;
    recentPaths = [];
    emit();
    saveSession();
}

function noteRecentPath(path) {
    recentPaths = [path, ...recentPaths.filter((p) => !sameFilePath(p, path))].slice(0, RECENT_LIMIT);
}

// Hàm thuần: selfcheck gọi được.
export function serializeSession() {
    return {
        activeId,
        recent: recentPaths,
        // EOL mặc định của tab mới sống cùng session.
        defaultEol,
        tabs: tabs.map((tab) => ({
            id: tab.id,
            path: tab.path,
            name: tab.name,
            // null = không lưu content, đọc lại từ đĩa (khác '' là tab rỗng thật).
            content: sessionKeepsContent(tab) ? tab.content : null,
            // eol/bom phải sống cùng session, nếu không lần lưu sau đổi CRLF thành LF và mất BOM.
            eol: tab.eol,
            bom: tab.bom,
            // status + diskMtime: 'unreadable' chặn Ctrl+S ghi đè file thật bằng bản rỗng.
            status: tab.status,
            diskMtime: tab.diskMtime,
            pinned: tab.pinned === true,
            // reload: tab lỗi phải được đọc lại ở lần chạy sau, nếu không thành tab rỗng vĩnh viễn.
            reload: tab.status !== 'ok',
            // Không lưu savedContent (nhân đôi dung lượng); dirty là boolean đủ để hiện dấu.
            dirty: isTabDirty(tab),
            // savedHash/savedLen: chỉ tab savedContent === null cần, để biết đã gõ lại đúng bản gốc.
            savedHash: tab.savedContent === null ? (tab.savedHash || null) : hashText(tab.savedContent),
            savedLen: tab.savedContent === null ? (Number.isFinite(tab.savedLen) ? tab.savedLen : null) : tab.savedContent.length,
            scrollTop: tab.scrollTop,
            selStart: tab.selStart,
            selEnd: tab.selEnd
        }))
    };
}

// Trả null nếu JSON hỏng -> caller dựng session mới thay vì crash lúc khởi động.
// Id phải là số nguyên dương, khác nhau; id xấu được cấp lại từ fallbackId.
export function deserializeSession(raw, fallbackId = 1) {
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.tabs) || !data.tabs.length) return null;
    const usedIds = new Set();
    const restored = data.tabs.map((t) => {
        const path = typeof t.path === 'string' ? t.path : null;
        // Session cũ lưu BOM trong content: strip một lần cho cả content và savedContent.
        const stored = typeof t.content === 'string' ? stripBom(t.content) : null;
        // content === null + path = đọc lại từ đĩa; reload = tab lỗi, đọc lại kể cả khi có bản nháp.
        const reload = t.reload === true || (stored === null && !!path);
        const content = stored === null ? '' : stored;
        let id = Number.isSafeInteger(t.id) && t.id > 0 ? t.id : null;
        if (id === null || usedIds.has(id)) id = fallbackId++;
        usedIds.add(id);
        return {
            id,
            path,
            name: typeof t.name === 'string' && t.name ? t.name : UNTITLED,
            content,
            // Tab chưa có path: savedContent = '' chứ không null, nếu không tab rỗng luôn dirty.
            savedContent: t.dirty ? (path ? null : '') : content,
            // Không có content -> restoreSession đọc lại đĩa trước khi nạp vào editor.
            reload,
            // Hash bản đã lưu: isTabDirty dùng khi savedContent === null.
            savedHash: typeof t.savedHash === 'string' ? t.savedHash : null,
            savedLen: Number.isFinite(t.savedLen) ? t.savedLen : null,
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

// true = đã commit xuống IndexedDB; onCloseRequested chỉ destroy cửa sổ khi nhận true,
// nếu không là mất bản nháp của mọi tab.
export function saveSession(options) {
    if (restoring) return Promise.resolve(true);
    captureActive();
    return writeSession(serializeSession(), options)
        .then(() => true)
        .catch((err) => {
            // Không xoá gì khi ghi hỏng: bản ghi cũ vẫn nguyên và lần sau thử lại được.
            const now = Date.now();
            if (now - quotaWarnedAt > 10000) {
                quotaWarnedAt = now;
                showToast(`Could not save this session: ${err && err.message ? err.message : err}`);
            }
            return false;
        });
}

async function loadRestoredSession() {
    const stored = await loadSession();
    if (stored) {
        recentPaths = stored.recent.filter((p) => typeof p === 'string' && p).slice(0, RECENT_LIMIT);
        defaultEol = stored.defaultEol === '\r\n' ? '\r\n' : '\n';
        return deserializeSession(JSON.stringify(stored));
    }

    // Lần đầu sau khi đổi tầng lưu: ghi sang IndexedDB TRƯỚC rồi mới xoá key localStorage.
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
    // Khoá editor tới khi tab active nạp xong, nếu không gõ vào sẽ bị ghi đè.
    markdownInput.readOnly = true;
    tabs.length = 0;
    activeId = null;
    nextId = 1;
    recentPaths = [];

    try {
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
            // Chưa từng dùng app: mở một tab Untitled rỗng, sạch.
            activeId = createTab().id;
        }

        // Đọc tab đang mở trước rồi mới tới tab nền: textarea rỗng suốt lúc chờ đĩa sẽ bị captureActive() đè.
        const active = getActiveTab();
        await loadTabFromDisk(active);

        restoring = false;
        restoreTabIntoEditor(active);
        markdownInput.readOnly = false;
        emit();
        saveSession();

        // Tab nền đọc sau; emit() cuối để cập nhật dấu chưa-lưu / tên.
        for (const tab of tabs) {
            if (tab !== active) await loadTabFromDisk(tab);
        }
        emit();
    } finally {
        restoring = false;
        markdownInput.readOnly = false;
    }

    // File association lần chạy đầu: hỏi SAU khi editor dựng xong, không thì bị restoreSession ghi đè.
    await openInitialPaths();
}

// Đọc lại tab từ đĩa khi session không lưu content; lỗi/quá giới hạn -> status 'unreadable',
// đây là chốt khiến saveActiveDoc buộc Save As thay vì ghi bản rỗng lên file thật.
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
    const wasBroken = tab.status !== 'ok';
    const diskText = toLf(stripBom(raw));
    // Tab lỗi nay đọc được: bản nháp là thứ duy nhất người dùng còn, không ghi đè bằng nội dung đĩa.
    // Lấy nội dung đĩa làm savedContent -> tab dirty và Ctrl+S ghi bản nháp lên file thật.
    if (wasBroken && tab.content) {
        tab.savedContent = diskText;
    } else {
        tab.content = diskText;
        tab.savedContent = diskText;
    }
    tab.eol = detectEol(raw);
    tab.bom = detectBom(raw);
    tab.status = 'ok';
    tab.diskMtime = mtimeOf(await statFile(tab.path));
    tab.diskIgnoredMtime = null;
    tab.savedHash = null;
    tab.savedLen = null;
    if (wasBroken) showToast(`Recovered "${tab.name}" from disk.`);
}

// Chạy một lần: dựng tab từ nháp single-document cũ rồi xoá key cũ.
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

// Resolve khi transaction đã commit; onCloseRequested chỉ destroy khi nhận true.
// false = chưa chắc gì nằm trên đĩa.
export async function flushSession() {
    // durability 'strict': mặc định ghi qua OS buffer, destroy() ngay sau đó vẫn mất.
    const ok = await saveSession({ durability: 'strict' });
    await whenSessionWritten();
    return ok;
}

export function initDocuments() {
    btnImport.addEventListener('click', () => { openFiles(); });
    btnSave.addEventListener('click', () => { saveActiveDoc(); });
    btnSaveAs.addEventListener('click', () => { saveActiveDoc({ as: true }); });
    btnSaveAll.addEventListener('click', () => { saveAllTabs(); });

    initOpenFromOs();
}

// argv của instance đầu, Rust giữ hộ; lấy xong state rỗng nên không mở trùng.
async function openInitialPaths() {
    const invoke = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
    if (!invoke) return;
    try {
        const paths = await invoke('take_initial_paths');
        const files = (Array.isArray(paths) ? paths : []).filter(isMarkdownPath);
        if (files.length) await openPaths(files);
    } catch (err) {
        console.warn('[documents] take_initial_paths failed', err);
    }
}

// Overlay 'Drop Markdown files here' (class trên body).
function setDropOverlay(on) {
    document.body.classList.toggle('drop-target', on);
}

// Nguồn mở file ngoài hộp thoại: kéo-thả và sự kiện 'open-paths' từ instance thứ hai.
function initOpenFromOs() {
    const webview = window.__TAURI__ && window.__TAURI__.webview;
    if (webview?.getCurrentWebview) {
        webview.getCurrentWebview()
            .onDragDropEvent((event) => {
                const payload = event.payload;
                // Hiện overlay khi kéo file qua cửa sổ, nếu không người dùng không biết app có nhận.
                if (payload.type === 'enter' || payload.type === 'over') setDropOverlay(true);
                else if (payload.type === 'leave' || payload.type === 'drop') setDropOverlay(false);
                if (payload.type !== 'drop' || !payload.paths?.length) return;
                const files = payload.paths.filter(isMarkdownPath);
                if (!files.length) {
                    showToast('Only Markdown and text files can be opened.');
                    return;
                }
                openPaths(files);
            })
            .catch((err) => console.warn('[documents] drag-drop listen failed', err));
    }

    // Instance thứ hai gửi path qua đây; không có listener là mở file lần hai bị bỏ qua.
    const listen = window.__TAURI__ && window.__TAURI__.event;
    listen?.listen('open-paths', ({ payload }) => {
        const paths = (Array.isArray(payload) ? payload : []).filter(isMarkdownPath);
        if (paths.length) openPaths(paths);
    }).catch((err) => console.warn('[documents] open-paths listen failed', err));

    // Lưu ngay khi cửa sổ mất focus; đường thoát thật do window-controls chặn và flushSession.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') saveSession();
    });
}