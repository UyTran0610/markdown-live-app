// js/ui/status-bar.js — Thanh trạng thái dưới workspace: kiểu xuống dòng đang dùng (bấm để đổi),
// vị trí con trỏ, và mã hoá.
//
// EOL đổi ở đây là cần thiết chứ không phải phô trương: file mới lưu bằng Save As luôn ra LF, và
// trên Windows người dùng thường muốn CRLF để git diff không bị đổi hàng loạt dòng.

import { markdownInput, statusEncoding, statusEol, statusPos } from '../core/dom.js';
import { getActiveTab, setActiveEol, subscribe } from '../io/documents.js';

const EOL_LABEL = { '\n': 'LF', '\r\n': 'CRLF' };

function caretPosition() {
    const upto = markdownInput.value.slice(0, markdownInput.selectionStart);
    // Đếm số dòng bằng số ký tự xuống dòng trước con trỏ: nội dung tab luôn là LF (file-save toLf).
    const line = upto.split('\n').length;
    const column = upto.length - (upto.lastIndexOf('\n') + 1) + 1;
    return { line, column };
}

export function updateStatusBar() {
    const tab = getActiveTab();
    statusEol.textContent = tab ? EOL_LABEL[tab.eol] : 'LF';
    const { line, column } = caretPosition();
    statusPos.textContent = `Ln ${line}, Col ${column}`;
    // UTF-8 là chuỗi: readTextFile từ chối file không phải UTF-8 ngay khi mở, nên tab đang mở luôn
    // là UTF-8. Đây là chỗ để thêm BOM nếu sau này mở được encoding khác.
    statusEncoding.textContent = 'UTF-8';
}

export function initStatusBar() {
    subscribe(updateStatusBar);

    // selectionchange của document bắt được cả khi chuột chọn trong textarea, không chỉ khi gõ.
    document.addEventListener('selectionchange', () => {
        if (document.activeElement === markdownInput) updateStatusBar();
    });
    markdownInput.addEventListener('click', updateStatusBar);

    statusEol.addEventListener('click', () => {
        const tab = getActiveTab();
        if (!tab) return;
        setActiveEol(tab.eol === '\n' ? '\r\n' : '\n');
    });
}