// js/editor/format-actions.js — Hành động của thanh định dạng tác động lên editor (heading, list, bảng, khối code).

import { markdownInput } from '../core/dom.js';
import { applyEditorChange } from './edit.js';
import {
    buildBlockFence,
    buildTableMarkdown,
    getHeadingLevel,
    parseListLine,
    setHeadingLevel
} from './format-helpers.js';

export function applyHeadingLevel(level) {
    const val = markdownInput.value;
    const selStart = markdownInput.selectionStart;
    const selEnd = markdownInput.selectionEnd;
    const lineStart = val.lastIndexOf('\n', selStart - 1) + 1;
    let lineEnd = val.indexOf('\n', selEnd);
    if (lineEnd === -1) lineEnd = val.length;
    const original = val.substring(lineStart, lineEnd);
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
    // So sánh TEXT chứ không so tổng delta: delta có dấu nên các dòng cộng/bớt cùng số ký tự triệt tiêu nhau
    // (vd ['### a','bbbb'] + H1: -2 +2 = 0 nhưng vẫn phải đổi).
    if (replacedText === original) return;

    const newText = val.substring(0, lineStart) + replacedText + val.substring(lineEnd);
    applyEditorChange(newText, lineStart, Math.max(lineStart, selEnd + delta));
}

export function applyListStyle(style) {
    const val = markdownInput.value;
    const selStart = markdownInput.selectionStart;
    const selEnd = markdownInput.selectionEnd;
    const lineStart = val.lastIndexOf('\n', selStart - 1) + 1;
    let lineEnd = val.indexOf('\n', selEnd);
    if (lineEnd === -1) lineEnd = val.length;
    const original = val.substring(lineStart, lineEnd);
    const lines = original.split('\n');

    let delta = 0;
    let num = 0;
    const newLines = lines.map((line, i) => {
        const parsed = parseListLine(line);
        // Dòng thường: lấy phần thụt lề đầu dòng
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

    // ponytail: đánh số liên tục trên cả vùng chọn kể cả khi giữa có dòng trống;
    // nâng cấp sau: restart về 1 khi gặp đoạn văn mới.
    const newText = val.substring(0, lineStart) + replacedText + val.substring(lineEnd);

    // Giữ vùng bôi đen: marker thêm/xoá ở ĐẦU dòng nên selection mới tính bằng cách dịch theo delta độ dài
    // của từng dòng (cùng cách handleEditorTab).
    const firstLineDelta = newLines[0].length - lines[0].length;
    const newSelStart = selStart > lineStart
        ? Math.max(lineStart, selStart + firstLineDelta)
        : lineStart;
    const newSelEnd = Math.max(newSelStart, selEnd + delta);

    applyEditorChange(newText, newSelStart, newSelEnd);
}

export function insertTableBlock(cols, rows) {
    const val = markdownInput.value;
    const selEnd = markdownInput.selectionEnd;
    const table = buildTableMarkdown(rows, cols);
    // Chèn SAU vùng chọn, không phải tại vùng chọn: bôi đen "abc" rồi chèn bảng phải còn nguyên "abc".
    // caret đặt cuối bảng (bên trong ô cuối) để gõ tiếp được ngay.
    const needTop = selEnd > 0 && val[selEnd - 1] !== '\n';
    const needBottom = selEnd < val.length && val[selEnd] !== '\n';
    const insert = (needTop ? '\n' : '') + table + (needBottom ? '\n' : '');
    const caret = selEnd + insert.length;
    applyEditorChange(val.substring(0, selEnd) + insert + val.substring(selEnd), caret, caret);
}

// Có vùng chọn: nội dung khối là vùng chọn (mỗi dòng code lùi 4 space đúng cú pháp fence); không có:
// chèn placeholder và đặt caret vào dòng nội dung.
export function insertBlockFence(kind) {
    const val = markdownInput.value;
    const selStart = markdownInput.selectionStart;
    const selEnd = markdownInput.selectionEnd;
    const selected = selStart !== selEnd ? val.substring(selStart, selEnd) : '';
    const hasBody = selected.trim() !== '';
    const block = buildBlockFence(kind, hasBody
        ? (kind === 'code' ? selected.split('\n').map((l) => (l.trim() ? '    ' + l : l)).join('\n') : selected)
        : '');

    const needTop = selStart > 0 && val[selStart - 1] !== '\n';
    const needBottom = selEnd < val.length && val[selEnd] !== '\n';
    const insert = (needTop ? '\n' : '') + block + (needBottom ? '\n' : '');
    const blockStart = selStart + (needTop ? 1 : 0);
    const caret = hasBody ? selStart + insert.length : blockStart + (kind === 'math' ? 3 : langPrefixLen(kind));
    applyEditorChange(val.substring(0, selStart) + insert + val.substring(selEnd), caret, caret);
}

// Độ dài của "```js\n" hoặc "```mermaid\n" dùng để tính vị trí caret
function langPrefixLen(kind) {
    return kind === 'mermaid' ? '```mermaid\n'.length : '```js\n'.length;
}
