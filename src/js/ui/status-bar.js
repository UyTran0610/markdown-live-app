// js/ui/status-bar.js — EOL (bấm để đổi), vị trí con trỏ và mã hoá.
// EOL cần thiết vì Save As mặc định ra LF, còn Windows thường muốn CRLF.

import { markdownInput, statusEncoding, statusEol, statusPos } from '../core/dom.js';
import { getActiveTab, setActiveEol, subscribe } from '../io/documents.js';

const EOL_LABEL = { '\n': 'LF', '\r\n': 'CRLF' };

function caretPosition() {
    const upto = markdownInput.value.slice(0, markdownInput.selectionStart);
    // Đếm dòng bằng số ký tự xuống dòng trước con trỏ; nội dung tab luôn là LF.
    const line = upto.split('\n').length;
    const column = upto.length - (upto.lastIndexOf('\n') + 1) + 1;
    return { line, column };
}

export function updateStatusBar() {
    const tab = getActiveTab();
    statusEol.textContent = tab ? EOL_LABEL[tab.eol] : 'LF';
    const { line, column } = caretPosition();
    statusPos.textContent = `Ln ${line}, Col ${column}`;
    // readTextFile từ chối file không phải UTF-8 nên tab đang mở luôn là UTF-8.
    statusEncoding.textContent = 'UTF-8';
}

export function initStatusBar() {
    subscribe(updateStatusBar);

    // selectionchange bắt được cả khi chuột chọn trong textarea, không chỉ khi gõ.
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