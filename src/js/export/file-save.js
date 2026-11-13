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

const tauriInvoke = () => (window.__TAURI__ ? window.__TAURI__.core?.invoke : undefined);

const hasTauriBridge = () => !!(tauriDialogPlugin()?.save && tauriFsPlugin()?.writeTextFile);

// File tạm cạnh file gốc khi ghi atomic (khớp TMP_SUFFIX trong src-tauri/src/lib.rs).
const TMP_SUFFIX = '.md-live.tmp';

// Duyệt quyền đọc/ghi cho path ngoài $HOME (session, Recent, kéo-thả). Rust kiểm file tồn tại
// và đuôi văn bản; webview vẫn là ranh giới tin cậy (xem AGENTS.md, mục fs scope).
export async function allowTextFiles(paths) {
    const invoke = tauriInvoke();
    if (!invoke || !paths || !paths.length) return;
    try {
        await invoke('allow_text_files', { paths });
    } catch (err) {
        console.warn('[fs] allow_text_files failed', err);
    }
}

// File .tmp cạnh file gốc chỉ được duyệt khi file gốc đã nằm trong scope.
async function allowTempSibling(path) {
    const invoke = tauriInvoke();
    if (!invoke) return false;
    try {
        return await invoke('allow_temp_sibling', { path });
    } catch (err) {
        console.warn('[fs] allow_temp_sibling failed', err);
        return false;
    }
}

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
// sau ghi hỏng file. Ở đây file lạ được CHUYỂN sang UTF-8, chỉ từ chối file nhị phân thật.
export async function readTextFile(path) {
    let bytes;
    try {
        bytes = await window.__TAURI__.fs.readFile(path);
    } catch (err) {
        console.error('Read failed:', err);
        if (isEncodingError(err)) {
            showToast('That file is not UTF-8 text, so opening it would corrupt its contents. Convert it to UTF-8 first.');
        } else if (isAclError(err)) {
            showToast('Could not read that file. It may be missing, or the app may not have access to that location.');
        } else {
            showToast(`Could not read the file: ${errorDetail(err)}`);
        }
        return null;
    }

    const decoded = decodeTextBytes(bytes);
    if (!decoded) {
        // File nhị phân thật: không có cách dịch an toàn, từ chối như cũ.
        showToast('That file is not UTF-8 text, so opening it would corrupt its contents. Convert it to UTF-8 first.');
    }
    return decoded;
}

// Giải mã bytes thành { text, encoding, converted }. Trả null nếu không dịch an toàn.
// Hàm thuần (không báo toast) để self-check gọi được.
export function decodeTextBytes(bytes) {
    if (!bytes || bytes.length === 0) return { text: '', encoding: 'UTF-8', converted: false };

    // BOM UTF-8: giữ U+FEFF cho tầng trên nhận biết bom (giữ hành vi cũ).
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        let body = null;
        try {
            body = decodeUtf8Strict(bytes.slice(3));
        } catch {
            // BOM mà thân không phải UTF-8 hợp lệ: giải mã thân bằng heuristic, vẫn giữ BOM để ghi lại.
        }
        if (body !== null && !hasNulChar(body)) {
            return { text: '\uFEFF' + body, encoding: 'UTF-8', converted: false };
        }
        // Thân có NUL = file nhị phân: đi nhánh heuristic trên thân (giữ BOM để ghi lại).
        const rest = decodeTextBytes(bytes.slice(3));
        return rest ? { ...rest, text: '\uFEFF' + rest.text } : null;
    }

    // BOM UTF-16LE/BE (Notepad Unicode): decode thay vì từ chối. File nhị phân rác cũng có
    // thể bắt đầu bằng FF FE, nên phải qua cùng bộ lọc với nhánh không BOM; thất bại thì
    // bỏ BOM rồi rơi xuống nhánh Windows-125x.
    let body = bytes;
    let utf16 = null;
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
        body = bytes.slice(2);
        utf16 = 'utf-16le';
    } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
        body = bytes.slice(2);
        utf16 = 'utf-16be';
    }

    if (utf16) {
        const text = new TextDecoder(utf16).decode(body);
        if (isPlausibleText(text)) {
            return { text, encoding: utf16 === 'utf-16le' ? 'UTF-16LE' : 'UTF-16BE', converted: true };
        }
    } else {
        // UTF-8 strict trước: file UTF-8 hợp lệ không bao giờ bị dịch sai.
        try {
            // ignoreBOM: true để U+FEFF sống sót; mặc định TextDecoder nuốt BOM và lần lưu sau làm mất BOM.
            const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
            // NUL là byte hợp lệ của UTF-8 nhưng không có trong text: đó là file nhị phân
            // (ví dụ toàn 0x00), không phải tài liệu. Rơi xuống các nhánh heuristic.
            if (!hasNulChar(text)) return { text, encoding: 'UTF-8', converted: false };
        } catch {
            // Xuống dưới: chuột không - decode nhận dạng heuristic.
        }

        // UTF-16LE không BOM: byte lẻ thường 0x00 và decode cho ký tự không có U+FFFD.
        if (bytes.length >= 4 && bytes.length % 2 === 0 && looksLikeUtf16Le(bytes)) {
            const text = new TextDecoder('utf-16le').decode(bytes);
            if (isPlausibleText(text)) return { text, encoding: 'UTF-16LE', converted: true };
        }
    }

    // Single-byte Windows cũ: thử windows-1258 rồi windows-1252, chọn bản ít U+FFFD nhất.
    let best = null;
    for (const label of ['windows-1258', 'windows-1252']) {
        try {
            const text = new TextDecoder(label, { fatal: false }).decode(body);
            const bad = countReplacementChars(text);
            if (!best || bad < best.bad) best = { text, bad, label };
            if (bad === 0) break;
        } catch {
            // TextDecoder không hỗ trợ label này: thử tiếp.
        }
    }
    // Ký-tự điều khiển còn sót = decode sai: file toàn 0x00 hay 0x7F không được mở.
    if (best && best.bad <= Math.max(4, Math.floor(body.length / 200)) && !hasControlChars(best.text)) {
        return { text: best.text, encoding: best.label === 'windows-1258' ? 'Windows-1258' : 'Windows-1252', converted: true };
    }

    // File nhị phân thật: không có cách dịch an toàn, từ chối (readTextFile báo lỗi).
    return null;
}

function decodeUtf8Strict(bytes) {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
}

function looksLikeUtf16Le(bytes) {
    const sample = Math.min(bytes.length, 4096);
    let zeroOdd = 0;
    for (let i = 1; i < sample; i += 2) {
        if (bytes[i] === 0) zeroOdd++;
    }
    // File nhỏ: mọi byte cao phải là 0x00, threshold 25% quá lỏng.
    if (sample < 100) return zeroOdd === Math.floor(sample / 2);
    return zeroOdd >= Math.max(2, Math.floor(sample / 4));
}

function countReplacementChars(text) {
    let n = 0;
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) === 0xfffd) n++;
    }
    return n;
}

function hasManyReplacementChars(text) {
    return countReplacementChars(text) > Math.max(4, Math.floor(text.length / 200));
}

// Text giải mã được phải sạch: không U+FFFD hàng loạt, không ký-tự điều khiển lạ.
function isPlausibleText(text) {
    return !hasManyReplacementChars(text) && !hasControlChars(text);
}

// NUL không có trong text thật: byte 0x00 là dấu hiệu file nhị phân.
function hasNulChar(text) {
    return text.indexOf('\u0000') !== -1;
}

// Ký-tự điều khiển ngoài \t\n\r (kể cả DEL 0x7F): dấu hiệu decode heuristic sai.
function hasControlChars(text) {
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c === 0x7f) return true;
        if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) return true;
    }
    return false;
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
    // File tạm cạnh file thật: cần cùng nằm trong fs scope mới ghi atomic được.
    const tmp = path + TMP_SUFFIX;
    try {
        const body = applyEol(contents, eol);
        const payload = bom ? '\uFEFF' + body : body;
        // File gốc phải đã được duyệt thì mới cho phép ghi file .tmp cạnh nó.
        const tmpAllowed = await allowTempSibling(path);
        if (!tmpAllowed) {
            // Không có quyền ghi file .tmp: ghi thẳng (không atomic) để không mất thay đổi.
            await window.__TAURI__.fs.writeTextFile(path, payload);
            return true;
        }
        try {
            await window.__TAURI__.fs.writeTextFile(tmp, payload);
        } catch (err) {
            // Chỉ lỗi phạm vi mới ghi thẳng. Lỗi I/O (đầy đĩa, file khoá) phải ném ra:
            // writeTextFile truncate file cũ trước khi ghi nên ghi thẳng là mất nội dung gốc.
            if (!isAclError(err)) throw err;
            await removeQuietly(tmp);
            await window.__TAURI__.fs.writeTextFile(path, payload);
            return true;
        }
        try {
            // rename trên Windows dùng MoveFileEx(REPLACE_EXISTING) nên đè được file đã tồn tại.
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
            showToast('Could not save that file. The app may not have permission for that location.');
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
