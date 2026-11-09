// js/editor/format-actions.js — Hành động của thanh định dạng tác động lên editor (heading, list, bảng, khối code).
//
// Mọi hành động sửa đúng đoạn cần đổi rồi gửi MỘT transaction của CodeMirror,
// không dựng lại cả văn bản (doc có thể vài MB).

import { getView, replaceRange } from './cm.js';
import {
    buildBlockFence,
    buildTableMarkdown,
    getHeadingLevel,
    parseListLine,
    setHeadingLevel
} from './format-helpers.js';

// Thay đổi tối thiểu trên một dòng (chỉ vùng marker): selection trong phần chữ còn lại tự map.
function lineChange(lineFrom, oldLine, newLine) {
    if (newLine === oldLine) return null;
    let p = 0;
    while (p < oldLine.length && p < newLine.length && oldLine[p] === newLine[p]) p++;
    let s = 0;
    while (s < oldLine.length - p && s < newLine.length - p && oldLine[oldLine.length - 1 - s] === newLine[newLine.length - 1 - s]) s++;
    return { from: lineFrom + p, to: lineFrom + oldLine.length - s, insert: newLine.slice(p, newLine.length - s) };
}

export function applyHeadingLevel(level) {
    const v = getView();
    const { state } = v;
    const sel = state.selection.main;
    const firstLine = state.doc.lineAt(sel.from).number;
    const lastLine = state.doc.lineAt(Math.max(sel.from, sel.to)).number;

    const lines = [];
    for (let n = firstLine; n <= lastLine; n++) lines.push(state.doc.line(n));

    const allSame = lines.every((line) => getHeadingLevel(line.text) === level);
    const target = allSame ? 0 : level;
    const changes = [];
    for (const line of lines) {
        const res = setHeadingLevel(line.text, target);
        if (!res) continue;
        const c = lineChange(line.from, line.text, res.line);
        if (c) changes.push(c);
    }
    if (!changes.length) return;

    // Không truyền selection: CM map selection qua từng change.
    v.dispatch({ changes, scrollIntoView: true, userEvent: 'input.format' });
}

export function applyListStyle(style) {
    const v = getView();
    const { state } = v;
    const sel = state.selection.main;
    const firstLine = state.doc.lineAt(sel.from).number;
    const lastLine = state.doc.lineAt(Math.max(sel.from, sel.to)).number;

    const lines = [];
    for (let n = firstLine; n <= lastLine; n++) lines.push(state.doc.line(n));

    // ponytail: đánh số liên tục trên cả vùng chọn kể cả khi có dòng trống;
    // nâng cấp sau: restart về 1 khi gặp đoạn văn mới.
    let num = 0;
    const changes = [];
    for (const lineObj of lines) {
        const line = lineObj.text;
        const parsed = parseListLine(line);
        // Dòng thường: lấy phần thụt lề đầu dòng.
        const indent = parsed ? parsed.indent : (line.match(/^[ \t]*/) || [''])[0];
        const rest = parsed ? parsed.rest : line.slice(indent.length);

        if (!parsed && rest.trim() === '' && lines.length > 1) continue;

        let newLine;
        if (parsed && parsed.kind === style && (lines.length === 1 || parsed.rest.trim() !== '')) {
            newLine = indent + rest;
        } else {
            let marker;
            if (style === 'numbered') {
                num++;
                marker = num + '. ';
            } else if (style === 'task') {
                marker = '- [ ] ';
            } else {
                marker = '- ';
            }
            newLine = indent + (style === 'quote' ? '> ' : marker) + rest;
        }
        if (newLine === line) continue;
        const c = lineChange(lineObj.from, line, newLine);
        if (c) changes.push(c);
    }
    if (!changes.length) return;

    // Không truyền selection: CM map selection qua từng change.
    v.dispatch({ changes, scrollIntoView: true, userEvent: 'input.format' });
}

export function insertTableBlock(cols, rows) {
    const v = getView();
    const { state } = v;
    const selEnd = state.selection.main.to;
    // rows là số dòng THỰC SỰ của bảng, tính cả dòng tiêu đề buildTableMarkdown() tự sinh.
    // ponytail: luôn giữ tối thiểu 1 dòng thân (bảng không có dòng thân thì không còn ô để gõ);
    // nâng cấp sau: đặt caret vào ô tiêu đề.
    const bodyRows = Math.max(1, rows - 1);
    const table = buildTableMarkdown(bodyRows, cols);
    // Chèn SAU vùng chọn (bôi đen abc rồi chèn bảng phải còn abc); caret ở cuối bảng.
    const needTop = selEnd > 0 && state.doc.sliceString(selEnd - 1, selEnd) !== '\n';
    const needBottom = selEnd < state.doc.length && state.doc.sliceString(selEnd, selEnd + 1) !== '\n';
    const insert = (needTop ? '\n' : '') + table + (needBottom ? '\n' : '');
    const caret = selEnd + insert.length;
    replaceRange(selEnd, selEnd, insert, caret, caret);
}

// Có vùng chọn: nội dung khối là vùng chọn; không có: chèn placeholder và đặt caret vào dòng nội dung.
export function insertBlockFence(kind) {
    const v = getView();
    const { state } = v;
    const sel = state.selection.main;
    const selStart = sel.from;
    const selEnd = sel.to;
    const selected = selStart !== selEnd ? state.sliceDoc(selStart, selEnd) : '';
    const hasBody = selected.trim() !== '';
    const block = buildBlockFence(kind, hasBody
        ? (kind === 'code' ? selected.split('\n').map((l) => (l.trim() ? '    ' + l : l)).join('\n') : selected)
        : '');

    const needTop = selStart > 0 && state.doc.sliceString(selStart - 1, selStart) !== '\n';
    const needBottom = selEnd < state.doc.length && state.doc.sliceString(selEnd, selEnd + 1) !== '\n';
    const insert = (needTop ? '\n' : '') + block + (needBottom ? '\n' : '');
    const blockStart = selStart + (needTop ? 1 : 0);
    const caret = hasBody ? selStart + insert.length : blockStart + (kind === 'math' ? 3 : langPrefixLen(kind));
    replaceRange(selStart, selEnd, insert, caret, caret);
}

// Độ dài của ```js hoặc ```mermaid dùng để tính vị trí caret.
function langPrefixLen(kind) {
    return kind === 'mermaid' ? '```mermaid\n'.length : '```js\n'.length;
}
