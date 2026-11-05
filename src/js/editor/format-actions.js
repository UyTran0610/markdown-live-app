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

export function applyHeadingLevel(level) {
    const v = getView();
    const { state } = v;
    const sel = state.selection.main;
    const lineStart = state.doc.lineAt(sel.from).from;
    const lineEnd = state.doc.lineAt(sel.to).to;
    const original = state.doc.sliceString(lineStart, lineEnd);
    const lines = original.split('\n');

    const allSame = lines.every((line) => getHeadingLevel(line) === level);
    const target = allSame ? 0 : level;
    let delta = 0;
    const newLines = lines.map((line) => {
        const res = setHeadingLevel(line, target);
        if (!res) return line;
        delta += res.delta;
        return res.line;
    });
    const replacedText = newLines.join('\n');
    // So sánh TEXT chứ không so tổng delta: delta có dấu nên dòng cộng/bớt cùng độ dài triệt tiêu nhau.
    if (replacedText === original) return;

    replaceRange(lineStart, lineEnd, replacedText, lineStart, Math.max(lineStart, sel.to + delta));
}

export function applyListStyle(style) {
    const v = getView();
    const { state } = v;
    const sel = state.selection.main;
    const lineStart = state.doc.lineAt(sel.from).from;
    const lineEnd = state.doc.lineAt(sel.to).to;
    const original = state.doc.sliceString(lineStart, lineEnd);
    const lines = original.split('\n');

    let delta = 0;
    let num = 0;
    const newLines = lines.map((line) => {
        const parsed = parseListLine(line);
        // Dòng thường: lấy phần thụt lề đầu dòng.
        const indent = parsed ? parsed.indent : (line.match(/^[ \t]*/) || [''])[0];
        const rest = parsed ? parsed.rest : line.slice(indent.length);

        if (!parsed && rest.trim() === '' && lines.length > 1) return line;

        if (parsed && parsed.kind === style && (lines.length === 1 || parsed.rest.trim() !== '')) {
            const newLine = indent + rest;
            delta += newLine.length - line.length;
            return newLine;
        }

        let marker;
        if (style === 'numbered') {
            num++;
            marker = num + '. ';
        } else if (style === 'task') {
            marker = '- [ ] ';
        } else {
            marker = '- ';
        }
        const newLine = indent + (style === 'quote' ? '> ' : marker) + rest;
        delta += newLine.length - line.length;
        return newLine;
    });
    const replacedText = newLines.join('\n');
    // So sánh TEXT chứ không so tổng delta (xem lý do ở applyHeadingLevel).
    if (replacedText === original) return;

    // ponytail: đánh số liên tục trên cả vùng chọn kể cả khi có dòng trống;
    // nâng cấp sau: restart về 1 khi gặp đoạn văn mới.

    // Giữ vùng bôi đen: marker ở ĐẦU dòng nên selection mới dịch theo delta độ dài từng dòng.
    const firstLineDelta = newLines[0].length - lines[0].length;
    const newSelStart = sel.from > lineStart
        ? Math.max(lineStart, sel.from + firstLineDelta)
        : lineStart;
    const newSelEnd = Math.max(newSelStart, sel.to + delta);

    replaceRange(lineStart, lineEnd, replacedText, newSelStart, newSelEnd);
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
