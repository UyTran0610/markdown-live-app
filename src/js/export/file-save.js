// js/export/file-save.js — Tên file / tiêu đề tài liệu và ghi file ra đĩa (Save As của Tauri, tải qua trình duyệt).

import { showToast } from '../core/toast.js';

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
    // \p{L}\p{N} giữ chữ/số của mọi thứ tự (CJK, Cyrillic...) nên H1 tiếng Nhật/Nga không rơi về 'document';
    // ký tự cấm trong tên file (\ / : * ? " < > |) nằm ngoài \p{L}\p{N} nên bị loại cùng lúc. Cùng bộ ký tự với
    // slugifyHeading ở js/preview/headings.js.
    const slug = deriveDocumentTitle(markdown)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')   // bỏ dấu thanh/dấu phụ sau khi tách NFD
        .replace(/đ/gi, 'd')               // đ không bị tách trong NFD nên phải thay riêng
        .replace(/[^\p{L}\p{N}\s-]/gu, '')  // giữ chữ/số/khoảng trắng/-
        .trim()
        .replace(/\s+/g, '-')              // khoảng trắng -> '-'
        .replace(/-{2,}/g, '-')            // gộp nhiều '-' liên tiếp
        .replace(/^-+|-+$/g, '')           // bỏ '-' ở đầu/cuối
        .toLowerCase();
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

// Lưu văn bản: trong Tauri dùng hộp thoại Save As (plugin dialog) + ghi file (plugin fs); ngoài Tauri
// fallback <a download>. Trả về true nếu đã lưu, false nếu người dùng bấm Cancel.
export async function saveTextFile(contents, baseName, ext, mimeType) {
    if (hasTauriBridge()) {
        const path = await window.__TAURI__.dialog.save({
            defaultPath: baseName + '.' + ext,
            filters: [{ name: ext.toUpperCase() + ' file', extensions: [ext] }]
        });
        if (!path) return false;
        try {
            await window.__TAURI__.fs.writeTextFile(path, contents);
        } catch (err) {
            // ACL plugin fs chỉ cho ghi trong $HOME (src-tauri/capabilities/default.json) mà hộp thoại Save As hiện cả
            // ổ đĩa/mạng/USB -> chọn ngoài $HOME bị từ chối. Báo rõ nguyên nhân thay vì lỗi chung chung.
            console.error('Write failed:', err);
            showToast('Could not write there. This build can only save inside your home folder - pick another location.');
            return false;
        }
        return true;
    }

    // Fallback trình duyệt. Trong WebView Tauri mà thiếu dialog/fs thì <a download> không chạy:
    // báo rõ thay vì im lặng "thành công".
    if (isTauriRuntime()) {
        showToast('Could not save the file: the app\'s file-saving plugin is missing.');
        return false;
    }
    downloadBlob(new Blob([contents], { type: mimeType }), baseName + '.' + ext);
    return true;
}
