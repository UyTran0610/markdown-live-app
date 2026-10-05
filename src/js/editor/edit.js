// js/editor/edit.js — Thao tác chỉnh sửa văn bản trong editor: Tab, Enter, bọc định dạng, link, nhân đôi dòng.

import { markdownInput } from '../core/dom.js';
import { editorHistory } from './history.js';
import { syncEditorAfterChange } from './sync.js';

const TAB_SIZE = 4;

const TAB_SPACES = ' '.repeat(TAB_SIZE);

export function applyEditorChange(newText, newStart, newEnd) {
    editorHistory.saveCurrentState(markdownInput);
    markdownInput.value = newText;
    markdownInput.setSelectionRange(newStart, newEnd !== undefined ? newEnd : newStart);
    editorHistory.saveCurrentState(markdownInput);
    syncEditorAfterChange();
}

export function handleEditorTab(e) {
    e.preventDefault();
    const val = markdownInput.value;
    const selStart = markdownInput.selectionStart;
    const selEnd = markdownInput.selectionEnd;

    if (selStart === selEnd && !e.shiftKey) {
        const newText = val.substring(0, selStart) + TAB_SPACES + val.substring(selEnd);
        applyEditorChange(newText, selStart + TAB_SIZE, selStart + TAB_SIZE);
        return;
    }

    const lineStart = val.lastIndexOf('\n', selStart - 1) + 1;
    let lineEnd = val.indexOf('\n', selEnd);
    if (lineEnd === -1) lineEnd = val.length;

    const selectedBlock = val.substring(lineStart, lineEnd);
    const lines = selectedBlock.split('\n');

    let firstLineDelta = 0;
    let totalDelta = 0;
    const newLines = lines.map((line, idx) => {
        let delta = 0;
        let newLine = line;

        if (!e.shiftKey) {
            newLine = TAB_SPACES + line;
            delta = TAB_SIZE;
        } else {
            if (line.startsWith(TAB_SPACES)) {
                newLine = line.substring(TAB_SIZE);
                delta = -TAB_SIZE;
            } else if (line.startsWith('\t')) {
                newLine = line.substring(1);
                delta = -1;
            } else {
                // Tối đa 4 khoảng trắng đầu dòng
                const spaces = line.match(/^ {1,4}/);
                if (spaces) {
                    newLine = line.substring(spaces[0].length);
                    delta = -spaces[0].length;
                }
            }
        }

        if (idx === 0) firstLineDelta = delta;
        totalDelta += delta;
        return newLine;
    });

    const replacedText = newLines.join('\n');
    const newText = val.substring(0, lineStart) + replacedText + val.substring(lineEnd);
    const newSelStart = Math.max(lineStart, selStart + (selStart > lineStart ? firstLineDelta : 0));
    const newSelEnd = Math.max(newSelStart, selEnd + totalDelta);

    applyEditorChange(newText, newSelStart, newSelEnd);
}

export function handleEditorEnter(e) {
    const val = markdownInput.value;
    const selStart = markdownInput.selectionStart;
    const selEnd = markdownInput.selectionEnd;

    const lineStart = val.lastIndexOf('\n', selStart - 1) + 1;
    const currentLine = val.substring(lineStart, selStart);

    // Dòng task list rỗng: - [ ]
    const emptyTaskMatch = currentLine.match(/^(\s*[-*+]\s+\[[ xX]\]\s*)$/);
    // Dòng bullet rỗng: -, *, +
    const emptyUlMatch = currentLine.match(/^(\s*[-*+]\s*)$/);
    // Dòng số thứ tự rỗng: 1. hoặc 1)
    const emptyOlMatch = currentLine.match(/^(\s*\d+[.)]\s*)$/);
    // Dòng trích dẫn rỗng: >
    const emptyBqMatch = currentLine.match(/^(\s*>+\s*)$/);

    if (emptyTaskMatch || emptyUlMatch || emptyOlMatch || emptyBqMatch) {
        e.preventDefault();
        const newText = val.substring(0, lineStart) + val.substring(selEnd);
        applyEditorChange(newText, lineStart, lineStart);
        return;
    }

    // Task list có nội dung: marker + [ ]/[x] + chữ
    const taskMatch = currentLine.match(/^(\s*)([-*+]|\d+[.)])(\s+\[[ xX]\]\s+)(.*)$/);
    if (taskMatch) {
        e.preventDefault();
        const [, indent, bullet, marker] = taskMatch;
        // Dòng mới luôn bắt đầu với checkbox chưa tick
        const cleanMarker = marker.replace(/\[[xX]\]/, '[ ]');
        const insert = '\n' + indent + bullet + cleanMarker;
        const newText = val.substring(0, selStart) + insert + val.substring(selEnd);
        applyEditorChange(newText, selStart + insert.length, selStart + insert.length);
        return;
    }

    // Bullet: -, *, +
    const ulMatch = currentLine.match(/^(\s*)([-*+]\s+)(.*)$/);
    if (ulMatch) {
        e.preventDefault();
        const [, indent, marker] = ulMatch;
        const insert = '\n' + indent + marker;
        const newText = val.substring(0, selStart) + insert + val.substring(selEnd);
        applyEditorChange(newText, selStart + insert.length, selStart + insert.length);
        return;
    }

    // Số thứ tự: 1. hoặc 1)
    const olMatch = currentLine.match(/^(\s*)(\d+)([.)]\s+)(.*)$/);
    if (olMatch) {
        e.preventDefault();
        const [, indent, num, delim] = olMatch;
        const nextNum = parseInt(num, 10) + 1;
        const insert = '\n' + indent + nextNum + delim;
        const newText = val.substring(0, selStart) + insert + val.substring(selEnd);
        applyEditorChange(newText, selStart + insert.length, selStart + insert.length);
        return;
    }

    // Trích dẫn: > (có thể nhiều cấp)
    const bqMatch = currentLine.match(/^(\s*>+\s*)(.*)$/);
    if (bqMatch) {
        e.preventDefault();
        const insert = '\n' + bqMatch[1];
        const newText = val.substring(0, selStart) + insert + val.substring(selEnd);
        applyEditorChange(newText, selStart + insert.length, selStart + insert.length);
        return;
    }

    // Phần thụt lề đầu dòng
    const indentMatch = currentLine.match(/^(\s+)/);
    if (indentMatch) {
        e.preventDefault();
        const insert = '\n' + indentMatch[1];
        const newText = val.substring(0, selStart) + insert + val.substring(selEnd);
        applyEditorChange(newText, selStart + insert.length, selStart + insert.length);
    }
}

export function wrapOrToggleFormat(wrapper, placeholder = '') {
    const val = markdownInput.value;
    const selStart = markdownInput.selectionStart;
    const selEnd = markdownInput.selectionEnd;
    const selected = val.substring(selStart, selEnd);
    const wLen = wrapper.length;

    if (selected.length >= 2 * wLen && selected.startsWith(wrapper) && selected.endsWith(wrapper)) {
        const unwrapped = selected.substring(wLen, selected.length - wLen);
        const newText = val.substring(0, selStart) + unwrapped + val.substring(selEnd);
        applyEditorChange(newText, selStart, selStart + unwrapped.length);
        return;
    }

    if (selStart >= wLen && selEnd + wLen <= val.length) {
        const before = val.substring(selStart - wLen, selStart);
        const after = val.substring(selEnd, selEnd + wLen);
        // Cặp ký hiệu tìm được không được là MỘT PHẦN của cặp dài hơn (vd '*' trong '**' của bold không phải
        // wrapper '*' của italic): xem thêm 1 ký tự ngoài before/after, nếu trùng wrapper thì chuỗi dấu dài hơn.
        const extraBefore = selStart - wLen - 1 >= 0 ? val[selStart - wLen - 1] : '';
        const extraAfter = selEnd + wLen < val.length ? val[selEnd + wLen] : '';
        const isPartOfLongerWrapper = extraBefore === wrapper[wrapper.length - 1] || extraAfter === wrapper[0];
        if (before === wrapper && after === wrapper && !isPartOfLongerWrapper) {
            const newText = val.substring(0, selStart - wLen) + selected + val.substring(selEnd + wLen);
            applyEditorChange(newText, selStart - wLen, selStart - wLen + selected.length);
            return;
        }
    }

    if (selStart === selEnd) {
        const insert = wrapper + placeholder + wrapper;
        const newText = val.substring(0, selStart) + insert + val.substring(selEnd);
        const newPos = selStart + wLen + (placeholder ? placeholder.length : 0);
        applyEditorChange(newText, selStart + wLen, newPos);
    } else {
        const insert = wrapper + selected + wrapper;
        const newText = val.substring(0, selStart) + insert + val.substring(selEnd);
        applyEditorChange(newText, selStart + wLen, selStart + wLen + selected.length);
    }
}

export function handleEditorLink() {
    const val = markdownInput.value;
    const selStart = markdownInput.selectionStart;
    const selEnd = markdownInput.selectionEnd;
    const selected = val.substring(selStart, selEnd);

    if (selStart === selEnd) {
        const insert = '[link](url)';
        const newText = val.substring(0, selStart) + insert + val.substring(selEnd);
        // Chọn sẵn chữ "url" (vị trí 7-10 trong "[link](url)") để người dùng dán link đè lên.
        applyEditorChange(newText, selStart + 7, selStart + 10);
    } else {
        const insert = `[${selected}](url)`;
        const newText = val.substring(0, selStart) + insert + val.substring(selEnd);
        const urlStart = selStart + selected.length + 3;
        applyEditorChange(newText, urlStart, urlStart + 3);
    }
}

export function handleEditorDuplicate() {
    const val = markdownInput.value;
    const selStart = markdownInput.selectionStart;
    const selEnd = markdownInput.selectionEnd;

    if (selStart !== selEnd) {
        const selected = val.substring(selStart, selEnd);
        const newText = val.substring(0, selEnd) + selected + val.substring(selEnd);
        applyEditorChange(newText, selEnd, selEnd + selected.length);
    } else {
        const lineStart = val.lastIndexOf('\n', selStart - 1) + 1;
        let lineEnd = val.indexOf('\n', selStart);
        if (lineEnd === -1) lineEnd = val.length;

        const currentLine = val.substring(lineStart, lineEnd);
        const insert = '\n' + currentLine;
        const newText = val.substring(0, lineEnd) + insert + val.substring(lineEnd);
        const offset = selStart - lineStart;
        applyEditorChange(newText, lineEnd + 1 + offset, lineEnd + 1 + offset);
    }
}
