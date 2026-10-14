// js/io/documents.js — Store tài liệu: danh sách tab đang mở, nội dung từng tab, đọc/ghi file, lưu session.
//
// App vẫn dùng MỘT textarea duy nhất. Đổi tab chỉ là gán lại markdownInput.value, nên các module khác
// (render, highlight, history, export, format bar, scroll sync) không cần biết tab tồn tại.

import { btnImport, btnSave, editorHighlight, markdownInput, previewOutput } from '../core/dom.js';
import { showToast } from '../core/toast.js';
import { updateEditorHighlight } from '../editor/highlight.js';
import { editorHistory } from '../editor/history.js';
import { deriveExportBaseName, detectEol, readTextFile, sameFilePath, saveTextFile, toLf, writeTextFile } from '../export/file-save.js';
import { renderMarkdown } from '../preview/render.js';

const SESSION_KEY = 'markdown-live-session';

// Key của bản single-document cũ. Đọc một lần để migrate sang 1 tab Untitled rồi xoá, không giữ song song.
const LEGACY_KEY = 'markdown-live-content';

const MARKDOWN_EXTS = ['md', 'markdown', 'mdown', 'mkd', 'txt'];

const MAX_FILE_CHARS = 5 * 1024 * 1024;

const UNTITLED = 'Untitled';

// tabs: [{ id, path, name, content, savedContent, eol, scrollTop, selStart, selEnd, history }]
// savedContent === null nghĩa là "chưa bao giờ ghi xuống đĩa" => luôn coi là chưa lưu, không so sánh chuỗi.
// eol: kiểu xuống dòng của file trên đĩa ('\r\n' hoặc '\n'); nội dung trong tab luôn là LF.
const tabs = [];
let activeId = null;
const listeners = [];
let nextId = 1;

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
function createTab({ path = null, name = UNTITLED, content = '', savedContent = content, eol = '\n' } = {}) {
    const tab = {
        id: nextId++,
        path,
        name,
        content,
        savedContent,
        eol,
        scrollTop: 0,
        selStart: 0,
        selEnd: 0,
        history: null
    };
    tabs.push(tab);
    activeId = tab.id;
    return tab;
}

// Ghi nội dung vào textarea và dựng lại mọi thứ phụ thuộc nó. Kết quả nằm trong tab đang mở.
export function applyTextToEditor(text) {
    markdownInput.value = text;
    clearTimeout(editorHistory.typingTimer);
    editorHistory.typingTimer = null;
    editorHistory.stack = [];
    editorHistory.index = -1;
    editorHistory.saveCurrentState(markdownInput);
    updateEditorHighlight();
    previewOutput.scrollTop = 0;
    renderMarkdown();
    markdownInput.scrollTop = 0;
    editorHighlight.scrollTop = 0;
}

// Nhét trạng thái editor hiện tại vào tab đang mở. Phải gọi TRƯỚC khi đổi activeId.
function captureActive() {
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
    editorHighlight.scrollTop = tab.scrollTop;
    markdownInput.scrollTop = tab.scrollTop;
    // previewOutput.scrollTop phải = 0 TRƯỚC renderMarkdown: hàm đó giữ scrollTop cũ, đặt sau thì tab mới
    // mở đầu ngay giữa chừng trang của tab vừa rời.
    previewOutput.scrollTop = 0;
    updateEditorHighlight();
    renderMarkdown();
    markdownInput.setSelectionRange(tab.selStart, tab.selEnd);
    markdownInput.focus();
}

export function switchTab(id) {
    if (id === activeId) return;
    const target = tabs.find((tab) => tab.id === id);
    if (!target) return;
    captureActive();
    activeId = target.id;
    restoreTabIntoEditor(target);
    emit();
    saveSession();
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
    captureActive();
    // Tab rỗng chưa gõ gì thì không có gì để mất: dùng mặc định của createTab (sạch) cho giống tab
    // Untitled lúc khởi động, không đánh dấu chưa lưu chỉ vì vừa bấm "+".
    const tab = createTab();
    restoreTabIntoEditor(tab);
    emit();
    saveSession();
    return tab;
}

export function closeTab(id) {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    if (isTabDirty(tab) && !confirm(`"${tab.name}" has unsaved changes. Close it anyway?`)) return;

    const wasActive = tab.id === activeId;
    const index = tabs.indexOf(tab);
    tabs.splice(index, 1);

    if (wasActive) {
        if (!tabs.length) {
            // Không để app rơi vào trạng thái không có editor.
            const fresh = createTab();
            restoreTabIntoEditor(fresh);
        } else {
            const next = tabs[Math.min(index, tabs.length - 1)];
            activeId = next.id;
            restoreTabIntoEditor(next);
        }
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

    let opened = 0;
    let failed = 0;
    for (const path of paths) {
        const existing = tabs.find((tab) => sameFilePath(tab.path, path));
        if (existing) {
            switchTab(existing.id);
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
        const text = toLf(raw);
        captureActive();
        const tab = createTab({ path, name: path.split(/[\\/]/).pop(), content: text, savedContent: text, eol });
        restoreTabIntoEditor(tab);
        opened++;
    }

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

export async function saveActiveDoc() {
    const tab = getActiveTab();
    if (!tab || saving) return;
    saving = true;
    try {
        // Chụp nội dung TRƯỚC mọi await: nếu người dùng gõ thêm trong lúc hộp thoại Save As đang mở
        // hoặc lúc ghi, đĩa nhận bản đã chụp và tab phải vẫn hiện chưa lưu - gán tab.content sau await
        // sẽ đánh dấu "đã lưu" cho phần chưa từng xuống đĩa.
        const snapshot = tab.content;
        let path = tab.path;

        if (!path) {
            const saved = await saveTextFile(snapshot, defaultSaveName(tab, snapshot), 'md', 'text/markdown;charset=utf-8');
            if (!saved) return;
            path = saved;
        } else if (!await writeTextFile(path, snapshot, tab.eol)) {
            // Ghi đè thất bại (đường dẫn ngoài scope sau khi khởi động lại, file bị khoá, chỉ đọc...):
            // đường dẫn cũ không còn dùng được nên cho chọn chỗ mới ngay, không để tab kẹt không lưu được.
            const saved = await saveTextFile(snapshot, defaultSaveName(tab, snapshot), 'md', 'text/markdown;charset=utf-8');
            if (!saved) return;
            path = saved;
        }

        if (!sameFilePath(tab.path, path)) {
            const clash = tabs.find((other) => other !== tab && sameFilePath(other.path, path));
            if (clash) showToast(`That file is already open in the "${clash.name}" tab.`);
            tab.path = path;
            tab.name = path.split(/[\\/]/).pop();
            // saveTextFile không biết eol của file đích: nó luôn ghi LF, nên đích mới là file LF.
            tab.eol = '\n';
        }

        tab.savedContent = snapshot;
        emit();
        saveSession();
        showToast(`Saved "${tab.name}".`);
    } finally {
        saving = false;
    }
}

// ---- Session ----------------------------------------------------------------

// Hàm thuần: selfcheck gọi được mà không đụng editor thật.
export function serializeSession() {
    return {
        activeId,
        tabs: tabs.map((tab) => ({
            id: tab.id,
            path: tab.path,
            name: tab.name,
            content: tab.content,
            // Kiểu xuống dòng phải sống cùng session: tab khôi phục không đọc lại file từ đĩa nên
            // mất eol là lần lưu sau ghi đè file CRLF thành LF.
            eol: tab.eol,
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
export function deserializeSession(raw) {
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.tabs) || !data.tabs.length) return null;
    const restored = data.tabs.map((t) => ({
        id: t.id,
        path: typeof t.path === 'string' ? t.path : null,
        name: typeof t.name === 'string' && t.name ? t.name : UNTITLED,
        content: typeof t.content === 'string' ? t.content : '',
        savedContent: t.dirty ? null : (typeof t.content === 'string' ? t.content : ''),
        eol: t.eol === '\r\n' ? '\r\n' : '\n',
        scrollTop: Number(t.scrollTop) || 0,
        selStart: Number(t.selStart) || 0,
        selEnd: Number(t.selEnd) || 0,
        history: null
    }));
    return { activeId: data.activeId, tabs: restored };
}

export function saveSession() {
    captureActive();
    try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(serializeSession()));
    } catch (e) {
        const isQuota = e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014);
        const now = Date.now();
        if (isQuota && now - quotaWarnedAt > 10000) {
            quotaWarnedAt = now;
            showToast('Storage is full, new content may be lost when the app closes.');
        }
    }
}

export function restoreSession() {
    tabs.length = 0;
    activeId = null;
    nextId = 1;

    let restored = null;
    try {
        restored = deserializeSession(localStorage.getItem(SESSION_KEY));
    } catch (e) {
        restored = null;
    }

    if (restored) {
        restored.tabs.forEach((tab) => { tabs.push(tab); nextId = Math.max(nextId, tab.id + 1); });
        activeId = tabs.some((tab) => tab.id === restored.activeId) ? restored.activeId : tabs[0].id;
    } else if (migrateLegacy()) {
        // migrateLegacy tự dựng tab.
    } else {
        // Chưa từng dùng app: mở sẵn một tab Untitled rỗng (savedContent = content -> không dirty).
        createTab();
    }

    restoreTabIntoEditor(getActiveTab());
    emit();
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
    return true;
}

export function initDocuments() {
    btnImport.addEventListener('click', () => { openFiles(); });
    btnSave.addEventListener('click', () => { saveActiveDoc(); });

    // Lưu ngay (không debounce) khi cửa sổ sắp đóng để không mất nội dung gõ cuối cùng.
    window.addEventListener('beforeunload', saveSession);

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') saveSession();
    });
}