// js/ui/status-bar.js — EOL (bấm để đổi), vị trí con trỏ, mã hoá và số liệu tài liệu.
// EOL cần thiết vì Save As mặc định ra LF, còn Windows thường muốn CRLF.

import { setCharCount, setLineCount, setWordCount, setWordCountUnknown, statusEncoding, statusEol, statusPos } from '../core/dom.js';
import { countWords } from '../core/utils.js';
import { getView, setSelectionHandler } from '../editor/cm.js';
import { getActiveTab, setActiveEol, subscribe } from '../io/documents.js';

const EOL_LABEL = { '\n': 'LF', '\r\n': 'CRLF' };

// Số từ phải quét cả văn bản nên chờ gõ NGỪNG hẳn rồi mới đếm; quá ngưỡng thì bỏ qua,
// quét mỗi lần gõ là dồn ép main thread trên tài liệu lớn.
const WORD_COUNT_DELAY = 400;
const WORD_COUNT_MAX_CHARS = 1000000;

let wordCountTimer = null;

// Doc đã đếm từ; dùng identity của Text để biết nội dung có đổi không.
let countedDoc = null;

function recountWords() {
    wordCountTimer = null;
    const v = getView();
    if (!v) return;
    countedDoc = v.state.doc;
    setWordCount(countWords(v.state.doc.toString()));
}

function scheduleWordCount(doc) {
    if (!doc || doc === countedDoc) return;
    // Quá lớn: không đếm, nhưng phải huỷ lượt đang chờ và báo rõ là không có số.
    if (doc.length > WORD_COUNT_MAX_CHARS) {
        if (wordCountTimer !== null) {
            clearTimeout(wordCountTimer);
            wordCountTimer = null;
        }
        countedDoc = doc;
        setWordCountUnknown();
        return;
    }
    // Debounce thật: mỗi lần gõ đẩy lại mốc, chỉ đếm khi người dùng ngừng.
    if (wordCountTimer !== null) clearTimeout(wordCountTimer);
    wordCountTimer = setTimeout(recountWords, WORD_COUNT_DELAY);
}

/** Cập nhật số ký tự / dòng / từ của tài liệu đang mở. */
export function updateDocStats(doc) {
    if (!doc) return;
    setCharCount(doc.length);
    setLineCount(doc.lines);
    scheduleWordCount(doc);
}

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
    // Số liệu theo tab đang mở: đổi tab phải cập nhật, không chỉ khi gõ.
    const v = getView();
    updateDocStats(v ? v.state.doc : null);
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
