// js/ui/status-bar.js — EOL (bấm để đổi), vị trí con trỏ và mã hoá.
// EOL cần thiết vì Save As mặc định ra LF, còn Windows thường muốn CRLF.

import { statusEncoding, statusEol, statusPos } from '../core/dom.js';
import { getView, setSelectionHandler } from '../editor/cm.js';
import { getActiveTab, setActiveEol, subscribe } from '../io/documents.js';

const EOL_LABEL = { '\n': 'LF', '\r\n': 'CRLF' };

function caretPosition() {
    const v = getView();
    if (!v) return { line: 1, column: 1 };
    const { head } = v.state.selection.main;
    // Nội dung tab luôn là LF nên số dòng của CodeMirror là số dòng thật.
    const line = v.state.doc.lineAt(head);
    return { line: line.number, column: head - line.from + 1 };
}

export function updateStatusBar() {
    const tab = getActiveTab();
    statusEol.textContent = tab ? EOL_LABEL[tab.eol] : 'LF';
    const { line, column } = caretPosition();
    statusPos.textContent = `Ln ${line}, Col ${column}`;
    // Tab có thể đã được chuyển từ UTF-16/Windows-125x lúc đọc.
    statusEncoding.textContent = tab?.encoding || 'UTF-8';
}

export function initStatusBar() {
    subscribe(updateStatusBar);

    // Con trỏ nhảy trong CodeMirror báo qua updateListener, không có selectionchange của DOM.
    setSelectionHandler(updateStatusBar);

    statusEol.addEventListener('click', () => {
        const tab = getActiveTab();
        if (!tab) return;
        setActiveEol(tab.eol === '\n' ? '\r\n' : '\n');
    });
}
