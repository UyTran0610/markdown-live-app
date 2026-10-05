// js/export/file-save.js — Ghi file ra đĩa: hộp thoại Save As của Tauri, fallback tải qua trình duyệt.

import { showToast } from '../core/toast.js';

export function deriveExportBaseName(markdown) {
    // Heading cấp 1 đầu tiên (cờ m: tìm ở bất kỳ dòng nào)
    const heading = markdown.match(/^\s{0,3}#\s+(.+?)\s*$/m);
    const raw = heading ? heading[1] : '';
    const slug = raw
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')   // bỏ dấu thanh/dấu phụ sau khi tách NFD
        .replace(/đ/gi, 'd')               // đ không bị tách trong NFD nên phải thay riêng
        .replace(/[^\w\s-]/g, '')          // bỏ ký tự đặc biệt (giữ chữ/số/_/khoảng trắng/-)
        .trim()
        .replace(/\s+/g, '-')              // khoảng trắng -> '-'
        .replace(/-{2,}/g, '-')            // gộp nhiều '-' liên tiếp
        .replace(/^-+|-+$/g, '')           // bỏ '-' ở đầu/cuối
        .toLowerCase();
    return (slug || 'document').slice(0, 80);
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
