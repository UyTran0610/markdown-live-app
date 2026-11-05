// js/editor/cm.js — Lớp bọc CodeMirror 6: view dùng chung cho mọi tab, theme, keymap và lệnh sửa văn bản.
//
// Bundle tự build: src/vendor/codemirror.bundle.js (xem scripts/vendor/codemirror.entry.js).
// App chỉ có MỘT EditorView; đổi tab = thay EditorState của view (mỗi tab giữ state riêng
// nên lịch sử undo không trộn giữa các tab).

import { cmHost } from '../core/dom.js';

const CM = window.CodeMirror;
if (!CM) throw new Error('Thiếu src/vendor/codemirror.bundle.js: CodeMirror 6 chưa được nạp.');

export const {
    EditorView,
    EditorState,
    EditorSelection,
    Prec,
    keymap,
    drawSelection,
    dropCursor,
    placeholder,
    history,
    historyKeymap,
    defaultKeymap,
    standardKeymap,
    undo,
    redo,
    undoDepth,
    redoDepth,
    markdown,
    syntaxHighlighting,
    HighlightStyle,
    indentUnit,
    search,
    searchKeymap,
    openSearchPanel,
    closeSearchPanel,
    findNext,
    findPrevious,
    replaceNext,
    replaceAll,
    getSearchQuery,
    setSearchQuery,
    searchPanelOpen,
    tags
} = CM;

const TAB_SIZE = 4;

const TAB_SPACES = ' '.repeat(TAB_SIZE);

// Màu cú pháp lấy từ --md-* trong css/tokens.css nên đổi theme chỉ là đổi biến CSS.
const markdownHighlightStyle = HighlightStyle.define([
    { tag: tags.heading1, class: 'cm-md-h1' },
    { tag: tags.heading2, class: 'cm-md-h2' },
    { tag: tags.heading3, class: 'cm-md-h3' },
    { tag: tags.heading4, class: 'cm-md-h4' },
    { tag: tags.heading5, class: 'cm-md-h5' },
    { tag: tags.heading6, class: 'cm-md-h6' },
    { tag: tags.strong, class: 'cm-md-strong' },
    { tag: tags.emphasis, class: 'cm-md-em' },
    { tag: tags.strikethrough, class: 'cm-md-strike' },
    { tag: tags.monospace, class: 'cm-md-code' },
    { tag: tags.link, class: 'cm-md-link' },
    { tag: tags.url, class: 'cm-md-url' },
    { tag: tags.quote, class: 'cm-md-quote' },
    { tag: tags.list, class: 'cm-md-list' },
    { tag: tags.escape, class: 'cm-md-escape' },
    { tag: tags.comment, class: 'cm-md-comment' },
    { tag: tags.processingInstruction, class: 'cm-md-comment' },
    { tag: tags.labelName, class: 'cm-md-label' }
]);

// Cặp ký tự bọc vùng chọn khi gõ (giống hành vi cũ của textarea).
const WRAP_PAIRS = {
    '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`',
    '*': '*', '_': '_', '~': '~', '$': '$'
};

// Cặp tự đóng ngoặc khi gõ ở vị trí con trỏ.
const AUTO_CLOSE_PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };

// Ký tự đóng: gõ đúng ký tự đang đứng sau con trỏ thì nhảy qua, không chèn thêm.
const CLOSERS = [')', ']', '}', '"', "'", '`'];

/** EditorView dùng chung cho mọi tab (null trước khi init). */
export let view = null;

/** Lấy view hiện tại (null nếu chưa init). */
export function getView() {
    return view;
}

/** Callback gọi khi nội dung editor đổi (sync.js đăng ký). */
let changeHandler = null;

/** Callback gọi khi con trỏ/vùng chọn đổi (status-bar đăng ký). */
let selectionHandler = null;

export function setChangeHandler(fn) {
    changeHandler = fn;
}

export function setSelectionHandler(fn) {
    selectionHandler = fn;
}

function requireView() {
    if (!view) throw new Error('Editor chưa khởi tạo: thiếu initEditorView().');
    return view;
}

/** Đọc toàn bộ nội dung editor. */
export function getDocText() {
    return view ? view.state.doc.toString() : '';
}

/** Độ dài nội dung editor (ký tự). */
export function getDocLength() {
    return view ? view.state.doc.length : 0;
}

/** Vùng chọn chính: { from, to }. */
export function getSelectionRange() {
    if (!view) return { from: 0, to: 0 };
    const { from, to } = view.state.selection.main;
    return { from, to };
}

/** Nội dung đang được chọn. */
export function getSelectedText() {
    if (!view) return '';
    const { from, to } = view.state.selection.main;
    return view.state.sliceDoc(from, to);
}

export function focusEditor() {
    if (view) view.focus();
}

/** Thay đoạn [from, to] bằng `insert`; con trỏ đặt theo selectFrom/selectTo. */
export function replaceRange(from, to, insert, selectFrom = null, selectTo = null) {
    const v = requireView();
    const anchor = selectFrom === null ? from + insert.length : selectFrom;
    const head = selectTo === null ? anchor : selectTo;
    v.dispatch({
        changes: { from, to, insert },
        selection: { anchor, head },
        scrollIntoView: true,
        userEvent: 'input'
    });
}

/** Bọc / gỡ định dạng quanh vùng chọn (**, *, ~~, `, $). */
export function wrapOrToggleFormat(wrapper, placeholder = '') {
    const v = requireView();
    const { state } = v;
    const { from, to } = state.selection.main;
    const selected = state.sliceDoc(from, to);
    const wLen = wrapper.length;
    const doc = state.doc;

    if (selected.length >= 2 * wLen && selected.startsWith(wrapper) && selected.endsWith(wrapper)) {
        const unwrapped = selected.slice(wLen, selected.length - wLen);
        replaceRange(from, to, unwrapped, from, from + unwrapped.length);
        return;
    }

    if (from >= wLen && to + wLen <= doc.length) {
        const before = doc.sliceString(from - wLen, from);
        const after = doc.sliceString(to, to + wLen);
        // Cặp tìm được không được là một phần của cặp dài hơn ('*' trong '**').
        const extraBefore = from - wLen - 1 >= 0 ? doc.sliceString(from - wLen - 1, from - wLen) : '';
        const extraAfter = to + wLen < doc.length ? doc.sliceString(to + wLen, to + wLen + 1) : '';
        const isPartOfLongerWrapper = extraBefore === wrapper[wrapper.length - 1] || extraAfter === wrapper[0];
        if (before === wrapper && after === wrapper && !isPartOfLongerWrapper) {
            replaceRange(from - wLen, to + wLen, selected, from - wLen, from - wLen + selected.length);
            return;
        }
    }

    if (from === to) {
        const insert = wrapper + placeholder + wrapper;
        replaceRange(from, to, insert, from + wLen, from + wLen + placeholder.length);
        return;
    }
    const insert = wrapper + selected + wrapper;
    replaceRange(from, to, insert, from + wLen, from + wLen + selected.length);
}

/** Chèn khung link [text](url), chọn sẵn phần url để dán đè. */
export function handleEditorLink() {
    const v = requireView();
    const { state } = v;
    const { from, to } = state.selection.main;
    if (from === to) {
        replaceRange(from, to, '[link](url)', from + 6, from + 9);
        return;
    }
    const selected = state.sliceDoc(from, to);
    const insert = `[${selected}](url)`;
    const urlStart = from + selected.length + 1;
    replaceRange(from, to, insert, urlStart, urlStart + 3);
}

/** Nhân đôi vùng chọn, hoặc nhân đôi dòng hiện tại khi không có vùng chọn. */
export function handleEditorDuplicate() {
    const v = requireView();
    const { state } = v;
    const { from, to } = state.selection.main;
    if (from !== to) {
        const selected = state.sliceDoc(from, to);
        replaceRange(to, to, selected, to, to + selected.length);
        return;
    }
    const line = state.doc.lineAt(from);
    const pos = line.to + 1 + (from - line.from);
    replaceRange(line.to, line.to, '\n' + line.text, pos, pos);
}

/**
 * Tab / Shift+Tab: không có vùng chọn thì chèn 4 khoảng trắng, có vùng chọn thì
 * thụt lề (hoặc bỏ thụt lề) cả khối dòng.
 */
export function indentSelection(shift) {
    const v = requireView();
    const { state } = v;
    const { from, to } = state.selection.main;

    if (from === to && !shift) {
        replaceRange(from, to, TAB_SPACES, from + TAB_SIZE, from + TAB_SIZE);
        return;
    }

    const blockStart = state.doc.lineAt(from).from;
    const blockEnd = state.doc.lineAt(to).to;
    const lines = state.doc.sliceString(blockStart, blockEnd).split('\n');

    let firstLineDelta = 0;
    let totalDelta = 0;
    const newLines = lines.map((line, idx) => {
        let delta = 0;
        let newLine = line;
        if (!shift) {
            newLine = TAB_SPACES + line;
            delta = TAB_SIZE;
        } else if (line.startsWith(TAB_SPACES)) {
            newLine = line.slice(TAB_SIZE);
            delta = -TAB_SIZE;
        } else if (line.startsWith('\t')) {
            newLine = line.slice(1);
            delta = -1;
        } else {
            // Tối đa 4 khoảng trắng đầu dòng
            const spaces = line.match(/^ {1,4}/);
            if (spaces) {
                newLine = line.slice(spaces[0].length);
                delta = -spaces[0].length;
            }
        }
        if (idx === 0) firstLineDelta = delta;
        totalDelta += delta;
        return newLine;
    });

    const newSelStart = Math.max(blockStart, from + (from > blockStart ? firstLineDelta : 0));
    const newSelEnd = Math.max(newSelStart, to + totalDelta);
    replaceRange(blockStart, blockEnd, newLines.join('\n'), newSelStart, newSelEnd);
}

/** Enter: tiếp tục list / task / quote của dòng đang gõ. */
export function insertNewlineContinueList() {
    const v = requireView();
    const { state } = v;
    const { from, to } = state.selection.main;
    const line = state.doc.lineAt(from);
    const currentLine = state.doc.sliceString(line.from, from);

    const emptyTaskMatch = currentLine.match(/^(\s*[-*+]\s+\[[ xX]\]\s*)$/);
    const emptyUlMatch = currentLine.match(/^(\s*[-*+]\s*)$/);
    const emptyOlMatch = currentLine.match(/^(\s*\d+[.)]\s*)$/);
    const emptyBqMatch = currentLine.match(/^(\s*>+\s*)$/);

    if (emptyTaskMatch || emptyUlMatch || emptyOlMatch || emptyBqMatch) {
        replaceRange(line.from, to, '', line.from, line.from);
        return true;
    }

    const taskMatch = currentLine.match(/^(\s*)([-*+]|\d+[.)])(\s+\[[ xX]\]\s+)(.*)$/);
    if (taskMatch) {
        const [, indent, bullet, marker] = taskMatch;
        // Dòng mới luôn bắt đầu với checkbox chưa tick.
        const cleanMarker = marker.replace(/\[[xX]\]/, '[ ]');
        const insert = '\n' + indent + bullet + cleanMarker;
        replaceRange(from, to, insert, from + insert.length, from + insert.length);
        return true;
    }

    const ulMatch = currentLine.match(/^(\s*)([-*+]\s+)(.*)$/);
    if (ulMatch) {
        const [, indent, marker] = ulMatch;
        const insert = '\n' + indent + marker;
        replaceRange(from, to, insert, from + insert.length, from + insert.length);
        return true;
    }

    const olMatch = currentLine.match(/^(\s*)(\d+)([.)]\s+)(.*)$/);
    if (olMatch) {
        const [, indent, num, delim] = olMatch;
        const nextNum = parseInt(num, 10) + 1;
        const insert = '\n' + indent + nextNum + delim;
        replaceRange(from, to, insert, from + insert.length, from + insert.length);
        return true;
    }

    const bqMatch = currentLine.match(/^(\s*>+\s*)(.*)$/);
    if (bqMatch) {
        const insert = '\n' + bqMatch[1];
        replaceRange(from, to, insert, from + insert.length, from + insert.length);
        return true;
    }

    const indentMatch = currentLine.match(/^(\s+)/);
    if (indentMatch) {
        const insert = '\n' + indentMatch[1];
        replaceRange(from, to, insert, from + insert.length, from + insert.length);
        return true;
    }

    return false;
}

/** Backspace giữa một cặp ngoặc: xoá luôn cả hai. */
export function deletePairBackward() {
    const v = requireView();
    const { state } = v;
    const { from, to } = state.selection.main;
    if (from !== to || from === 0 || from >= state.doc.length) return false;
    const charBefore = state.sliceDoc(from - 1, from);
    const charAfter = state.sliceDoc(from, from + 1);
    if (AUTO_CLOSE_PAIRS[charBefore] !== charAfter) return false;
    replaceRange(from - 1, from + 1, '', from - 1, from - 1);
    return true;
}

/**
 * Gõ ký tự: tự đóng ngoặc, nhảy qua dấu đóng, hoặc bọc vùng chọn.
 * Chạy trước xử lý mặc định của CodeMirror nên phải tự gửi transaction.
 */
export function handleTypedChar(v, from, to, text) {
    if (text.length !== 1 || v.state.readOnly) return false;
    const { state } = v;
    const sel = state.selection.main;
    if (from !== sel.from || to !== sel.to) return false;

    if (from !== to) {
        const close = WRAP_PAIRS[text];
        if (!close) return false;
        const selected = state.sliceDoc(from, to);
        v.dispatch({
            changes: [
                { insert: text, from },
                { insert: close, from: to }
            ],
            selection: { anchor: from + 1, head: to + 1 },
            userEvent: 'input.type'
        });
        return true;
    }

    const next = state.sliceDoc(from, Math.min(from + 1, state.doc.length));
    if (CLOSERS.includes(text) && next === text) {
        // Nhảy qua dấu đóng: thay chính dấu đó bằng nó (DOM đã chèn sẵn 1 ký tự).
        v.dispatch({
            changes: { from, to: from + 1, insert: text },
            selection: { anchor: from + 1, head: from + 1 },
            userEvent: 'input.type'
        });
        return true;
    }

    const close = AUTO_CLOSE_PAIRS[text];
    if (!close) return false;
    if (text === "'") {
        // Không tự đóng nháy đơn sau ký tự chữ/số (don't, it's, user's).
        const charBefore = from > 0 ? state.sliceDoc(from - 1, from) : '';
        if (/\w/.test(charBefore)) return false;
    }
    v.dispatch({
        changes: { from, to, insert: text + close },
        selection: { anchor: from + 1, head: from + 1 },
        userEvent: 'input.type'
    });
    return true;
}

const inputHandler = EditorView.inputHandler.of((v, from, to, text) => handleTypedChar(v, from, to, text));

// Mỗi từ là một bước Undo: gõ ngay sau khoảng trắng thì transaction không gộp vào
// nhóm trước (CodeMirror chỉ gộp khi joinToEvent trả về true).
function startsNewWord(tr) {
    if (!tr.docChanged) return false;
    let startsWord = false;
    tr.changes.iterChanges((fromA, toA, fromB, toB) => {
        const before = fromB > 0 ? tr.newDoc.sliceString(fromB - 1, fromB) : '';
        if (before === ' ' || before === '\n' || before === '\t') startsWord = true;
    });
    return startsWord;
}

const historyWithWordBoundary = history({
    joinToEvent: (tr, isAdjacent) => isAdjacent && !startsNewWord(tr)
});

/** Mở panel tìm kiếm và đưa con trỏ vào ô Replace (Ctrl+H). */
export function openReplacePanel(v) {
    openSearchPanel(v);
    const focusReplace = () => {
        const input = v.dom.querySelector('.cm-search [name=replace]');
        if (input) {
            input.focus();
            input.select();
            return true;
        }
        return false;
    };
    if (!focusReplace()) setTimeout(focusReplace, 0);
    return true;
}

// Phím tắt riêng của app: ưu tiên cao nhất để không đụng keymap mặc định của CM6.
const editorKeymap = Prec.highest(keymap.of([
    { key: 'Tab', run: () => indentSelection(false) },
    { key: 'Shift-Tab', run: () => indentSelection(true) },
    { key: 'Enter', run: insertNewlineContinueList },
    { key: 'Backspace', run: deletePairBackward },
    { key: 'Mod-b', run: () => wrapOrToggleFormat('**') },
    { key: 'Mod-i', run: () => wrapOrToggleFormat('*') },
    { key: 'Mod-e', run: () => wrapOrToggleFormat('`', 'code') },
    { key: 'Shift-Mod-x', run: () => wrapOrToggleFormat('~~') },
    { key: 'Mod-k', run: handleEditorLink },
    { key: 'Mod-d', run: handleEditorDuplicate },
    { key: 'Mod-f', run: (v) => openSearchPanel(v) },
    { key: 'Mod-h', run: openReplacePanel }
]));

const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged && changeHandler) changeHandler(update);
    if (update.selectionSet && selectionHandler) selectionHandler(update);
});

/** Tạo EditorState cho một tab (nội dung + chế độ chỉ đọc). */
export function createEditorState(text = '', { readOnly = false } = {}) {
    return EditorState.create({
        doc: text,
        extensions: [
            historyWithWordBoundary,
            drawSelection(),
            dropCursor(),
            placeholder('Type Markdown here...'),
            EditorState.tabSize.of(TAB_SIZE),
            indentUnit.of(TAB_SPACES),
            EditorView.lineWrapping,
            markdown({ addKeymap: false, pasteURLAsLink: false, completeHTMLTags: false }),
            syntaxHighlighting(markdownHighlightStyle),
            editorKeymap,
            keymap.of(historyKeymap),
            keymap.of(defaultKeymap),
            keymap.of(searchKeymap),
            search({ top: false }),
            EditorState.readOnly.of(readOnly),
            EditorView.editable.of(!readOnly),
            updateListener
        ]
    });
}

/** Dựng EditorView duy nhất của app. */
export function initEditorView() {
    view = new EditorView({
        parent: cmHost,
        state: createEditorState('', { readOnly: true })
    });
    return view;
}

/** Thay state của view (dùng khi đổi tab). */
export function setEditorState(state) {
    if (!view) return;
    view.setState(state);
}

/** Chiều cao cuộn của editor (px). */
export function getScrollTop() {
    return view ? view.scrollDOM.scrollTop : 0;
}

export function setScrollTop(value) {
    if (view) view.scrollDOM.scrollTop = value;
}
