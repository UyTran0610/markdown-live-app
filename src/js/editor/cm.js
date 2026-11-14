// js/editor/cm.js — Lớp bọc CodeMirror 6: view dùng chung cho mọi tab, theme, keymap và lệnh sửa văn bản.
//
// Bundle tự build: src/vendor/codemirror.bundle.js (xem scripts/vendor/codemirror.entry.js).
// App chỉ có MỘT EditorView; đổi tab = thay EditorState của view (mỗi tab giữ state riêng
// nên lịch sử undo không trộn giữa các tab).

import { cmHost } from '../core/dom.js';

const CM = window.CodeMirror;
if (!CM) throw new Error('Missing src/vendor/codemirror.bundle.js: CodeMirror 6 was not loaded.');

export const {
    EditorView,
    EditorState,
    Decoration,
    StateField,
    StateEffect,
    Prec,
    keymap,
    Compartment,
    drawSelection,
    dropCursor,
    placeholder,
    history,
    historyKeymap,
    defaultKeymap,
    undo,
    redo,
    indentMore,
    indentLess,
    copyLineDown,
    markdown,
    markdownKeymap,
    syntaxHighlighting,
    HighlightStyle,
    indentUnit,
    closeBrackets,
    closeBracketsKeymap,
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

// Chỉ bọc vùng chọn khi gõ; tự đóng ngoặc + nhảy qua dấu đóng do closeBrackets() lo.
// Backtick bọc qua đây vì closeBrackets() không biết nó; gõ ` trên vùng chọn phải bọc, không xoá.
const WRAP_FORMATS = { '*': '*', '_': '_', '~': '~', '$': '$', '`': '`' };

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
    if (!view) throw new Error('Editor is not initialized: initEditorView() is missing.');
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
    if (state.readOnly) return false;
    const { from, to } = state.selection.main;
    if (from !== to) {
        const selected = state.sliceDoc(from, to);
        replaceRange(to, to, selected, to, to + selected.length);
        return true;
    }
    return copyLineDown({ state, dispatch: (spec) => v.dispatch(spec) });
}

/** Tab không chọn dòng: chèn 4 khoảng trắng tại con trỏ (giữ hành vi cũ). */
export function insertTabAtCursor(v) {
    const { from, to } = v.state.selection.main;
    if (from !== to) return indentMore(v);
    v.dispatch({
        changes: { from, to, insert: TAB_SPACES },
        selection: { anchor: from + TAB_SIZE, head: from + TAB_SIZE },
        scrollIntoView: true,
        userEvent: 'input'
    });
    return true;
}

/**
 * Gõ * _ ~ $ khi đang bôi đen: bọc vùng chọn. Tự đóng ngoặc do closeBrackets() lo.
 */
export function handleTypedChar(v, from, to, text) {
    if (text.length !== 1 || v.state.readOnly) return false;
    const { state } = v;
    const sel = state.selection.main;
    if (from !== sel.from || to !== sel.to) return false;
    if (from === to) return false;
    const close = WRAP_FORMATS[text];
    if (!close) return false;
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

// Tô sáng kết quả tìm kiếm: field giữ bộ decoration, app đẩy bộ mới qua effect.
const setFindHits = StateEffect.define();

const findHitField = StateField.define({
    create: () => Decoration.none,
    update: (value, tr) => {
        let next = value.map(tr.changes);
        for (const eff of tr.effects) if (eff.is(setFindHits)) next = eff.value;
        return next;
    },
    provide: (f) => EditorView.decorations.from(f)
});

/** Đẩy bộ highlight tìm kiếm (DecorationSet) vào editor. */
export function setFindHighlights(v, decorationSet) {
    if (!v) return;
    v.dispatch({ effects: setFindHits.of(decorationSet) });
}

// Phím tắt riêng của app: ưu tiên cao nhất để không đụng keymap mặc định của CM6.
const editorKeymap = Prec.highest(keymap.of([
    { key: 'Tab', run: insertTabAtCursor },
    { key: 'Shift-Tab', run: indentLess },
    { key: 'Mod-b', run: () => wrapOrToggleFormat('**') },
    { key: 'Mod-i', run: () => wrapOrToggleFormat('*') },
    { key: 'Mod-e', run: () => wrapOrToggleFormat('`', 'code') },
    { key: 'Shift-Mod-x', run: () => wrapOrToggleFormat('~~') },
    { key: 'Mod-k', run: handleEditorLink },
    { key: 'Mod-d', run: handleEditorDuplicate }
]));

// Enter/Backspace theo markup (list, fence, quote): dựa trên syntax tree, đúng hơn regex cũ.
const markdownKeymapPrec = Prec.highest(keymap.of(markdownKeymap));

const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged && changeHandler) changeHandler(update);
    if (update.selectionSet && selectionHandler) selectionHandler(update);
});

export const readOnlyCompartment = new Compartment();

/** Extension readOnly/editable cho Compartment (dùng khi dựng state). */
export function readOnlyEffect(readOnly) {
    const ro = readOnly === true;
    return readOnlyCompartment.of([EditorState.readOnly.of(ro), EditorView.editable.of(!ro)]);
}

/** StateEffect reconfigure Compartment (dùng khi dispatch, giữ nguyên undo). */
export function readOnlyReconfigureEffect(readOnly) {
    const ro = readOnly === true;
    return readOnlyCompartment.reconfigure([EditorState.readOnly.of(ro), EditorView.editable.of(!ro)]);
}

// Extension giống nhau mọi tab (parser dùng chung, không mỗi tab một parser riêng).
const sharedExtensions = [
    historyWithWordBoundary,
    drawSelection(),
    dropCursor(),
    placeholder('Type Markdown here...'),
    EditorState.tabSize.of(TAB_SIZE),
    indentUnit.of(TAB_SPACES),
    EditorView.lineWrapping,
    markdown({ addKeymap: false, pasteURLAsLink: false, completeHTMLTags: false }),
    syntaxHighlighting(markdownHighlightStyle),
    closeBrackets(),
    inputHandler,
    findHitField,
    updateListener
];

/** Tạo EditorState cho một tab (nội dung + chế độ chỉ đọc + selection). */
export function createEditorState(text = '', { readOnly = false, selStart = 0, selEnd = 0 } = {}) {
    const docLen = text.length;
    const anchor = Math.max(0, Math.min(selStart, docLen));
    const head = Math.max(anchor, Math.min(selEnd, docLen));
    return EditorState.create({
        doc: text,
        selection: { anchor, head },
        extensions: [
            ...sharedExtensions,
            markdownKeymapPrec,
            editorKeymap,
            keymap.of(historyKeymap),
            keymap.of(closeBracketsKeymap),
            keymap.of(defaultKeymap),
            readOnlyEffect(readOnly)
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
