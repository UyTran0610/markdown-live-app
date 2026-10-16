// js/export/file-save.js — Tên file / tiêu đề tài liệu và ghi file ra đĩa (Save As của Tauri, tải qua trình duyệt).

import { showToast } from '../core/toast.js';
import { slugifyText } from '../core/utils.js';

// Heading cấp 1: cần ít nhất một space/tab, KHÔNG dùng \s để tránh ăn xuống dòng (`#\nfoo` không phải heading).
const HEADING_RE = /^ {0,3}#[ \t]+(.+?)[ \t]*$/;

// Fence ``` hoặc ~~~, thụt tối đa 3 space, tối thiểu 3 ký tự.
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

// Tiêu đề tài liệu = H1 đầu tiên NGOÀI code fence (khối ví dụ mở đầu file không phải tiêu đề tài liệu).
// Dùng chung cho <title> của file .html và tên file xuất để hai nơi không lệch nhau.
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
        .replace(/-{2,}/g, '-')            // gộp nhiều '-' liên tiếp
        .replace(/^-+|-+$/g, '');          // bỏ '-' ở đầu/cuối
    // Cắt trước rồi bỏ surrogate lơ lửng: Windows từ chối ghi tên file có codepoint UTF-16 nửa vời.
    return (slug || 'document').slice(0, 80).replace(/[\uD800-\uDFFF]/g, '');
}

// Tải Blob qua <a download> (fallback khi chạy ngoài Tauri). Lưu ý: WebView của Tauri CHẶN cơ chế này
// (wry không có download delegate), nên trong app phải dùng saveTextFile() bên dưới.
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

// KHÔNG đặt tên isTauri: Tauri core đã inject global isTauri vào WebView (withGlobalTauri),
// trùng tên gây SyntaxError làm chết cả file script.
const isTauriRuntime = () => !!window.__TAURI__;

// File tạo trên Windows thường dùng CRLF, còn textarea LUÔN chuẩn hoá về LF. Nhớ kiểu xuống dòng của
// file rồi ghi lại đúng kiểu đó: không thì chỉ mở file CRLF rồi lưu cũng thành đổi mọi dòng (git diff
// rác), và so sánh "đã sửa chưa" trên bản LF nên việc mở file không tự làm tab thành chưa lưu.
export function detectEol(text) {
    return String(text).includes('\r\n') ? '\r\n' : '\n';
}

// CR cũ (Classic Mac) cũng về LF, nếu không nó là ký tự thừa giữa hai dòng.
export function toLf(text) {
    return String(text).replace(/\r\n?/g, '\n');
}

// BOM (U+FEFF) do Notepad/Word ghi ở đầu file UTF-8. Để nó lọt vào textarea thì dòng "# ..." đầu
// file không còn khớp /^ {0,3}#/ nên mất heading trong preview và mất tiêu đề export. Xử lý y hệt
// eol: bỏ lúc đọc, nhớ cờ để ghi lại đúng file gốc.
export function detectBom(text) {
    return String(text).charCodeAt(0) === 0xFEFF;
}

export function stripBom(text) {
    return detectBom(text) ? String(text).slice(1) : String(text);
}

export function applyEol(text, eol) {
    return eol === '\r\n' ? String(text).replace(/\n/g, '\r\n') : String(text);
}

// Windows không phân biệt hoa thường và nhận cả '\' lẫn '/', nên so sánh chuỗi thô coi C:\A.md và
// c:\a.md là hai file khác nhau -> mở trùng tab, hai tab ghi đè nhau.
export function sameFilePath(a, b) {
    if (!a || !b) return false;
    const norm = (p) => String(p).replace(/\\/g, '/');
    const na = norm(a);
    const nb = norm(b);
    const windows = String(a).includes('\\') || String(b).includes('\\') || /^[a-z]:\//i.test(na);
    return windows ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

// Plugin fs ném lỗi thô. Thông báo cũ luôn đổ cho ACL ("chỉ lưu được trong home...") kể cả khi
// nguyên nhân thật là file không phải UTF-8, ổ đầy hay file bị khoá.
function isEncodingError(err) {
    const msg = String((err && err.message) || err).toLowerCase();
    return msg.includes('utf-8') || msg.includes('utf8') || msg.includes('invalid data');
}

function isAclError(err) {
    const msg = String((err && err.message) || err).toLowerCase();
    return msg.includes('forbidden path') || msg.includes('not allowed') || msg.includes('scope') || msg.includes('outside');
}

// `code` (plugin fs trả kèm ở một số lỗi) giúp phân biệt nguyên nhân mà không phải đoán qua câu chữ.
const errorDetail = (err) => {
    const msg = String((err && err.message) || err);
    return err && err.code ? `${msg} (${err.code})` : msg;
};

// Vân tay nội dung 32-bit (FNV-1a): đủ để biết "bản này có khác bản đã lưu không" mà không phải
// giữ cả chuỗi đã lưu trong session. Hàm thuần, selfcheck gọi được.
export function hashText(text) {
    let h = 0x811c9dc5;
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
}

// Đọc file đã biết đường dẫn (tab được mở từ hộp thoại Open). Cùng ranh giới ACL với writeTextFile:
// đọc cũng chỉ được trong các thư mục trong scope, nên lỗi phải báo rõ chứ không im lặng trả về rỗng.
//
// Đọc BYTES rồi tự giải mã (thay vì fs.readTextFile) vì readTextFile giải mã bằng TextDecoder
// không-fatal: byte không phải UTF-8 thành U+FFFD, tab hiện ký tự rác và lần lưu sau ghi hỏng file
// vĩnh viễn. Ở đây file lạ bị TỪ CHỐI, đúng như thông báo trong UI từ trước tới nay vẫn hứa.
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

    // Notepad "Unicode" (UTF-16) rất hay gặp với người dùng Windows; app còn đăng ký mở .txt. Đoán
    // theo BOM rồi từ chối kèm hướng dẫn, không thử chuyển đổi sau lưng người dùng.
    if (bytes.length >= 2
        && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
        showToast('That file is UTF-16, not UTF-8 - opening it here would corrupt it. Re-save it as UTF-8 first.');
        return null;
    }

    try {
        // ignoreBOM: true để U+FEFF ở đầu file sống sót vào chuỗi: detectBom/stripBom dựa vào nó, và
        // mặc định của TextDecoder là NUỐT BOM, tức là lần lưu sau sẽ làm file mất BOM.
        return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch (err) {
        console.error('Decode failed:', err);
        showToast('That file is not UTF-8 text, so opening it would corrupt its contents. Convert it to UTF-8 first.');
        return null;
    }
}

// fs.stat() bọc lại: trả null thay vì ném (file bị xoá, ngoài ACL) vì cả hai trường hợp đều chỉ
// cần "không đọc được mtime". Không tự báo lỗi: đây là phép kiểm, lỗi thật do read/write báo.
export async function statFile(path) {
    try {
        return await window.__TAURI__.fs.stat(path);
    } catch (err) {
        console.warn('Stat failed:', err);
        return null;
    }
}

// mtime của file về dạng số phẳng để so sánh bằng ===. fs trả Date; Math.round vì độ phân giải
// filesystem Windows là 100ns còn Date giữ ms nên so sánh Date gốc là hợp lý nhưng làm tròn thì
// không bao giờ lệch do độ chính xác. Hàm thuần, selfcheck gọi được.
export function mtimeOf(stat) {
    if (!stat || !stat.mtime) return null;
    const ms = typeof stat.mtime === 'number' ? stat.mtime : new Date(stat.mtime).getTime();
    return Number.isFinite(ms) ? Math.round(ms) : null;
}

// Xoá file tạm, không để lỗi xoá làm hỏng việc lưu: file tạm còn lại chỉ là rác trong thư mục
// người dùng, còn ném lỗi ở đây thì thay đổi vừa ghi coi như thất bại.
async function removeQuietly(path) {
    try {
        await window.__TAURI__.fs.remove(path);
    } catch (err) {
        console.warn('Could not remove temp file:', err);
    }
}

// Chọn đường dẫn để lưu — CHỈ mở hộp thoại, không ghi gì. Tách khỏi việc ghi để nơi gọi kiểm tra
// trùng tab TRƯỚC khi nội dung chạm đĩa (ghi trước rồi mới báo trùng là đã ghi đè file của tab kia).
// Trả null nếu người dùng hủy, hoặc khi không có cầu dialog (bản chạy trong trình duyệt).
export async function chooseSavePath(defaultPath, extensions) {
    if (!hasTauriBridge()) return null;
    const picked = await window.__TAURI__.dialog.save({
        defaultPath,
        filters: [{ name: 'Text file', extensions }]
    });
    return picked || null;
}

// Ghi đè một file đã biết đường dẫn (tab đang mở có path) — không mở hộp thoại.
// Dùng chung đoạn bắt lỗi ACL với saveTextFile để thông báo nhất quán.
export async function writeTextFile(path, contents, eol = '\n', bom = false) {
    // File tạm cạnh file thật: cùng thư mục nên nằm trong fs:scope sẵn có.
    const tmp = path + '.md-live.tmp';
    try {
        const body = applyEol(contents, eol);
        const payload = bom ? '\uFEFF' + body : body;
        // Ghi atomic: tạm cạnh file rồi rename đè lên file thật. writeTextFile thẳng sẽ truncate
        // file trước rồi mới ghi, app bị kill giữa chừng là còn một file rỗng/rút cụt.
        // std::fs::rename trên Windows dùng MoveFileEx(MOVEFILE_REPLACE_EXISTING) nên rename đè
        // được file đã tồn tại.
        await window.__TAURI__.fs.writeTextFile(tmp, payload);
        try {
            await window.__TAURI__.fs.rename(tmp, path);
        } catch (err) {
            // Đổi tên hỏng (file thật bị khoá bởi chương trình khác, ACL khác...) -> ghi thẳng để
            // không mất thay đổi chỉ vì không atomic được. Ghi thẳng vẫn thành công thì file tạm đã
            // hết việc: để lại là rác nằm mãi trong thư mục người dùng.
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

// Lưu văn bản: trong Tauri dùng hộp thoại Save As (plugin dialog) + ghi file (plugin fs); ngoài Tauri
// fallback <a download>. Trả về ĐƯỜNG DẪN đã ghi, hoặc null nếu người dùng hủy / ghi lỗi.
// (Callers cũ chỉ kiểm tra if (saved) nên đổi false -> null không phá gì.)
export async function saveTextFile(contents, baseName, ext, mimeType, eol = '\n', bom = false) {
    if (hasTauriBridge()) {
        const path = await chooseSavePath(baseName + '.' + ext, [ext]);
        if (!path) return null;
        return (await writeTextFile(path, contents, eol, bom)) ? path : null;
    }

    // Fallback trình duyệt. Trong WebView Tauri mà thiếu dialog/fs thì <a download> không chạy:
    // báo rõ thay vì im lặng "thành công".
    if (isTauriRuntime()) {
        showToast('Could not save the file: the app\'s file-saving plugin is missing.');
        return null;
    }
    downloadBlob(new Blob([contents], { type: mimeType }), baseName + '.' + ext);
    return null;
}
