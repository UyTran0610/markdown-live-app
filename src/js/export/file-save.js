// js/export/file-save.js — Tên file/tiêu đề tài liệu, đọc/ghi file, Save As của Tauri.

import { showToast } from '../core/toast.js';
import { slugifyText } from '../core/utils.js';

// Heading cấp 1: cần ít nhất một space/tab, KHÔNG dùng \s để tránh ăn xuống dòng (`#\nfoo` không phải heading).
const HEADING_RE = /^ {0,3}#[ \t]+(.+?)[ \t]*$/;

// Fence ``` hoặc ~~~, thụt tối đa 3 space, tối thiểu 3 ký tự.
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

// Tiêu đề = H1 đầu tiên NGOÀI code fence; dùng chung cho <title> và tên file xuất.
export function deriveDocumentTitle(markdown) {
    let fence = null;
    for (const line of String(markdown).split('\n')) {
        const f = line.match(FENCE_RE);
        if (f) {
            // Đóng fence bằng cùng ký tự, dài >= lúc mở và không có info string.
            if (!fence) fence = f[1];
            else if (f[1][0] === fence[0] && f[1].length >= fence.length && !f[2].trim()) fence = null;
            continue;
        }
        if (fence) continue;
        const heading = line.match(HEADING_RE);
        if (heading) return heading[1].trim();
    }
    return 'Document';
}

export function deriveExportBaseName(markdown) {
    // Cùng bộ ký tự với id heading (slugifyText) nhưng fold dấu để ra tên file ASCII; sau đó gộp/cắt '-' thừa.
    const slug = slugifyText(deriveDocumentTitle(markdown), { fold: true })
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '');
    // Cắt trước rồi bỏ surrogate lơ lửng: Windows từ chối ghi tên file có codepoint UTF-16 nửa vời.
    return (slug || 'document').slice(0, 80).replace(/[\uD800-\uDFFF]/g, '');
}

// <a download> chỉ là fallback ngoài Tauri; WebView Tauri chặn (thiếu download delegate).
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const tauriDialogPlugin = () => (window.__TAURI__ ? window.__TAURI__.dialog : undefined);

const tauriFsPlugin = () => (window.__TAURI__ ? window.__TAURI__.fs : undefined);

const hasTauriBridge = () => !!(tauriDialogPlugin()?.save && tauriFsPlugin()?.writeTextFile);

// KHÔNG đặt tên isTauri: Tauri inject global isTauri, trùng tên gây SyntaxError.
const isTauriRuntime = () => !!window.__TAURI__;

// Nhớ EOL của file rồi ghi lại đúng kiểu: textarea luôn LF, nếu không mở file CRLF rồi lưu
// là đổi mọi dòng (git diff rác).
export function detectEol(text) {
    return String(text).includes('\r\n') ? '\r\n' : '\n';
}

// CR cũ (Classic Mac) cũng về LF, nếu không nó là ký tự thừa giữa hai dòng.
export function toLf(text) {
    return String(text).replace(/\r\n?/g, '\n');
}

// BOM phải bỏ lúc đọc và nhớ cờ để ghi lại: U+FEFF trước # làm mất heading và tiêu đề export.
export function detectBom(text) {
    return String(text).charCodeAt(0) === 0xFEFF;
}

export function stripBom(text) {
    return detectBom(text) ? String(text).slice(1) : String(text);
}

export function applyEol(text, eol) {
    return eol === '\r\n' ? String(text).replace(/\n/g, '\r\n') : String(text);
}

// Windows không phân biệt hoa thường và nhận cả hai kiểu gạch chéo, so chuỗi thô sẽ mở trùng tab.
export function sameFilePath(a, b) {
    if (!a || !b) return false;
    const norm = (p) => String(p).replace(/\\/g, '/');
    const na = norm(a);
    const nb = norm(b);
    const windows = String(a).includes('\\') || String(b).includes('\\') || /^[a-z]:\//i.test(na);
    return windows ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

// Plugin fs ném lỗi thô; đừng đổ mọi lỗi cho ACL khi có thể là UTF-8, ổ đầy hay file khoá.
function isEncodingError(err) {
    const msg = String((err && err.message) || err).toLowerCase();
    return msg.includes('utf-8') || msg.includes('utf8') || msg.includes('invalid data');
}

function isAclError(err) {
    const msg = String((err && err.message) || err).toLowerCase();
    return msg.includes('forbidden path') || msg.includes('not allowed') || msg.includes('scope') || msg.includes('outside');
}

// code (plugin fs trả kèm) giúp phân biệt nguyên nhân.
const errorDetail = (err) => {
    const msg = String((err && err.message) || err);
    return err && err.code ? `${msg} (${err.code})` : msg;
};

// FNV-1a 32-bit: đủ biết bản này có khác bản đã lưu mà không giữ cả chuỗi trong session.
export function hashText(text) {
    let h = 0x811c9dc5;
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
}

// Đọc BYTES rồi tự giải mã: readTextFile không-fatal sẽ biến byte lạ thành U+FFFD và lần lưu
// sau ghi hỏng file. Ở đây file lạ bị TỪ CHỐI.
export async function readTextFile(path) {
    let bytes;
    try {
        bytes = await window.__TAURI__.fs.readFile(path);
    } catch (err) {
        console.error('Read failed:', err);
        if (isEncodingError(err)) {
            showToast('That file is not UTF-8 text, so opening it would corrupt its contents. Convert it to UTF-8 first.');
        } else if (isAclError(err)) {
            showToast('Could not read that file. This build can only open files inside your home, Documents, Desktop or Downloads folder.');
        } else {
            showToast(`Could not read the file: ${errorDetail(err)}`);
        }
        return null;
    }

    // Notepad Unicode (UTF-16) hay gặp trên Windows: đoán theo BOM rồi từ chối kèm hướng dẫn.
    if (bytes.length >= 2
        && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
        showToast('That file is UTF-16, not UTF-8 - opening it here would corrupt it. Re-save it as UTF-8 first.');
        return null;
    }

    try {
        // ignoreBOM: true để U+FEFF sống sót; mặc định TextDecoder nuốt BOM và lần lưu sau làm mất BOM.
        return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch (err) {
        console.error('Decode failed:', err);
        showToast('That file is not UTF-8 text, so opening it would corrupt its contents. Convert it to UTF-8 first.');
        return null;
    }
}

// Trả null thay vì ném: cả file bị xoá và ngoài ACL đều chỉ cần biết không có mtime.
export async function statFile(path) {
    try {
        return await window.__TAURI__.fs.stat(path);
    } catch (err) {
        console.warn('Stat failed:', err);
        return null;
    }
}

// Quy mtime về số phẳng để so bằng ===; Math.round đủ vì Date giữ ms.
export function mtimeOf(stat) {
    if (!stat || !stat.mtime) return null;
    const ms = typeof stat.mtime === 'number' ? stat.mtime : new Date(stat.mtime).getTime();
    return Number.isFinite(ms) ? Math.round(ms) : null;
}

// Xoá file tạm, không để lỗi xoá làm hỏng việc lưu.
async function removeQuietly(path) {
    try {
        await window.__TAURI__.fs.remove(path);
    } catch (err) {
        console.warn('Could not remove temp file:', err);
    }
}

// Chỉ mở hộp thoại, không ghi: nơi gọi kiểm trùng tab TRƯỚC khi nội dung chạm đĩa.
// Trả null nếu người dùng huỷ hoặc không có cầu dialog (bản trình duyệt).
export async function chooseSavePath(defaultPath, extensions) {
    if (!hasTauriBridge()) return null;
    const picked = await window.__TAURI__.dialog.save({
        defaultPath,
        filters: [{ name: 'Text file', extensions }]
    });
    return picked || null;
}

// Ghi đè file đã biết path, không mở hộp thoại; dùng chung bắt lỗi ACL với saveTextFile.
export async function writeTextFile(path, contents, eol = '\n', bom = false) {
    // File tạm cạnh file thật: cùng thư mục nên nằm trong fs:scope sẵn có.
    const tmp = path + '.md-live.tmp';
    try {
        const body = applyEol(contents, eol);
        const payload = bom ? '\uFEFF' + body : body;
        // Ghi atomic: tạm cạnh file rồi rename đè; writeTextFile thẳng sẽ truncate trước khi ghi.
        // rename trên Windows dùng MoveFileEx(REPLACE_EXISTING) nên đè được file đã tồn tại.
        await window.__TAURI__.fs.writeTextFile(tmp, payload);
        try {
            await window.__TAURI__.fs.rename(tmp, path);
        } catch (err) {
            // Rename hỏng (file khoá, ACL): ghi thẳng để không mất thay đổi, rồi dọn file tạm.
            await window.__TAURI__.fs.writeTextFile(path, payload);
            await removeQuietly(tmp);
        }
        return true;
    } catch (err) {
        console.error('Write failed:', err);
        // Ghi hỏng giữa chừng (đầy đĩa, mất quyền): file tạm có thể đã tồn tại, dọn luôn.
        await removeQuietly(tmp);
        if (isAclError(err)) {
            showToast('Could not save there. This build can only save inside your home, Documents, Desktop or Downloads folder - pick another location.');
        } else {
            showToast(`Could not save the file: ${errorDetail(err)}`);
        }
        return false;
    }
}

// Tauri: hộp thoại Save As + fs; ngoài Tauri: <a download>. Trả path đã ghi hoặc null.
export async function saveTextFile(contents, baseName, ext, mimeType, eol = '\n', bom = false) {
    if (hasTauriBridge()) {
        const path = await chooseSavePath(baseName + '.' + ext, [ext]);
        if (!path) return null;
        return (await writeTextFile(path, contents, eol, bom)) ? path : null;
    }

    // Trong WebView Tauri mà thiếu dialog/fs thì <a download> không chạy: báo rõ thay vì im lặng.
    if (isTauriRuntime()) {
        showToast('Could not save the file: the app\'s file-saving plugin is missing.');
        return null;
    }
    downloadBlob(new Blob([contents], { type: mimeType }), baseName + '.' + ext);
    return null;
}
