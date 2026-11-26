// js/export/export-context.js — Thông tin chung cho các bước xuất file.

import { showToast } from '../core/toast.js';
import { getActiveTab } from '../io/documents.js';

// Thư mục của tài liệu đang mở: dùng để trỏ tới ảnh cục bộ trong file Word.
export function documentBaseDir() {
    const tab = getActiveTab();
    const path = tab && tab.path ? String(tab.path) : '';
    if (!path) return null;
    const cut = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
    return cut > 0 ? path.slice(0, cut) : null;
}

// Báo những gì KHÔNG xuất được (biểu đồ chưa vẽ xong, ảnh không nhúng được...).
// Im lặng thì người dùng tưởng file xuất ra đủ, không phải.
export function reportExportIssues(issues) {
    const list = issues.filter(Boolean);
    if (!list.length) return;
    const shown = list.slice(0, 2).join(' ');
    const rest = list.length > 2 ? ` (+${list.length - 2} more)` : '';
    showToast(`${shown}${rest}`);
}
