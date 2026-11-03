// js/editor/find-replace.js — Tìm kiếm và thay thế trong Editor (Ctrl+F / Ctrl+H).
// Chỉ quét nội dung textarea của Editor; Preview không được đụng tới.

import {
    editorHighlight,
    editorHighlightCode,
    findBtn,
    findCaseBtn,
    findCloseBtn,
    findCount,
    findInput,
    findNextBtn,
    findPrevBtn,
    findRegexBtn,
    findReplaceAllBtn,
    findReplaceBtn,
    findReplaceInput,
    findReplaceRow,
    findWidget,
    markdownInput
} from '../core/dom.js';
import { showToast } from '../core/toast.js';
import { subscribe } from '../io/documents.js';
import { showEditorView } from '../ui/view-mode.js';
import { applyEditorChange } from './edit.js';
import { onEditorLayerRepaint, updateEditorHighlight } from './highlight.js';

const HIGHLIGHT_NAME = 'md-find-all';
// Trần số match được tô: tài liệu lớn có thể có hàng chục nghìn match, tô hết thì chậm.
const MAX_HIGHLIGHTS = 500;
// Trần số match thu thập: regex khớp rỗng liên tục có thể sinh vô hạn match.
const MAX_MATCHES = 20000;

let isOpen = false;
let matches = [];
let currentIndex = -1;
let matchCase = false;
let useRegex = false;
let invalidRegex = false;
// Range của từng match (dùng cho CSS Custom Highlight API).
let ranges = [];
let highlightRAF = null;

// ---------- Phần thuần: tìm và thay, không đụng DOM ----------

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildRegex(query, matchCase, useRegex) {
    return new RegExp(useRegex ? query : escapeRegExp(query), matchCase ? 'g' : 'gi');
}

// Tìm mọi match trong text. Trả null khi regex hỏng (khác với "không có match").
export function findMatches(text, query, { matchCase = false, useRegex = false, limit = MAX_MATCHES } = {}) {
    if (!query) return [];
    let regex;
    try {
        regex = buildRegex(query, matchCase, useRegex);
    } catch (err) {
        return null;
    }
    const found = [];
    let m;
    while ((m = regex.exec(text)) !== null) {
        found.push({ start: m.index, end: m.index + m[0].length });
        // Regex khớp rỗng (a*) không tiến lastIndex -> phải tự đẩy, nếu không lặp vô hạn.
        if (m[0].length === 0) regex.lastIndex += 1;
        if (found.length >= limit) break;
    }
    return found;
}

// Giải $1, $&, $`, $' trong chuỗi thay thế (chỉ dùng ở chế độ regex).
export function expandGroups(replacement, m) {
    if (!m) return replacement;
    return replacement.replace(/\$(\$|&|`|'|\d{1,2})/g, (all, key) => {
        if (key === '$') return '$';
        if (key === '&') return m[0];
        if (key === '`') return m.input.substring(0, m.index);
        if (key === "'") return m.input.substring(m.index + m[0].length);
        const group = Number(key);
        return m[group] !== undefined ? m[group] : all;
    });
}

// Thay hết match. Không regex thì thay theo nghĩa đen, '$' trong chuỗi thay không được diễn giải.
export function replaceAllMatches(text, query, replacement, { matchCase = false, useRegex = false } = {}) {
    const found = findMatches(text, query, { matchCase, useRegex });
    if (!found || !found.length) return { text, count: 0 };
    if (!useRegex) {
        // Nối lại từ các vị trí đã tìm: nếu không, chế độ không phân biệt hoa thường sẽ tìm 2 match
        // nhưng chỉ thay đúng 1 chữ.
        let out = '';
        let pos = 0;
        for (const m of found) {
            out += text.substring(pos, m.start) + replacement;
            pos = m.end;
        }
        out += text.substring(pos);
        return { text: out, count: found.length };
    }
    let regex;
    try {
        regex = buildRegex(query, matchCase, useRegex);
    } catch (err) {
        return { text, count: 0 };
    }
    let count = 0;
    const out = text.replace(regex, (...args) => {
        count++;
        const groups = args.slice(0, -2);
        groups.index = args[args.length - 2];
        groups.input = text;
        return expandGroups(replacement, groups);
    });
    return { text: out, count };
}

// ---------- Tô match trên lớp cú pháp của Editor ----------

function highlightSupported() {
    return typeof CSS !== 'undefined' && !!CSS.highlights && typeof Highlight !== 'undefined';
}

// Các đoạn text trong lớp tô màu; nội dung giống textarea nên offset là của Editor.
function buildSegments() {
    const segs = [];
    const walker = document.createTreeWalker(editorHighlightCode, NodeFilter.SHOW_TEXT);
    let acc = 0;
    let node;
    while ((node = walker.nextNode())) {
        const len = node.nodeValue.length;
        if (!len) continue;
        segs.push({ node, start: acc, end: acc + len });
        acc += len;
    }
    return segs;
}

function segmentAt(segs, offset) {
    let lo = 0;
    let hi = segs.length - 1;
    let found = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (segs[mid].start <= offset) {
            found = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return found === -1 ? null : segs[found];
}

function makeRange(segs, match) {
    const startSeg = segmentAt(segs, match.start);
    const endSeg = segmentAt(segs, Math.max(match.start, match.end - 1));
    if (!startSeg || !endSeg) return null;
    // Lớp tô màu có thể lệch với textarea (vừa gõ xong chưa kịp vẽ lại) -> kẹp offset vào trong node.
    const startOffset = Math.min(match.start - startSeg.start, startSeg.node.nodeValue.length);
    const endOffset = Math.min(match.end - endSeg.start, endSeg.node.nodeValue.length);
    if (startOffset > endOffset) return null;
    const range = document.createRange();
    range.setStart(startSeg.node, startOffset);
    range.setEnd(endSeg.node, endOffset);
    return range;
}

function applyHighlights() {
    if (!highlightSupported()) return;
    if (!isOpen || !matches.length) {
        CSS.highlights.delete(HIGHLIGHT_NAME);
        ranges = [];
        return;
    }
    const segs = buildSegments();
    const limit = Math.min(matches.length, MAX_HIGHLIGHTS);
    const highlight = new Highlight();
    const next = [];
    for (let i = 0; i < limit; i++) {
        // Range còn nối vào DOM thì vẫn đúng: lớp tô màu chỉ thay text node của lô vừa vẽ lại.
        const old = ranges[i];
        let range = (old && old.startContainer.isConnected && old.endContainer.isConnected) ? old : null;
        if (!range) range = makeRange(segs, matches[i]);
        if (!range) {
            next.push(null);
            continue;
        }
        highlight.add(range);
        next.push(range);
    }
    ranges = next;
    CSS.highlights.set(HIGHLIGHT_NAME, highlight);
}

// Gom các lần gọi liên tiếp thành 1 lần tô màu mỗi khung hình.
function scheduleHighlights() {
    if (highlightRAF !== null) return;
    highlightRAF = requestAnimationFrame(() => {
        highlightRAF = null;
        applyHighlights();
    });
}

// ---------- Trạng thái tìm kiếm ----------

function updateCount() {
    if (invalidRegex) {
        findCount.textContent = 'Invalid regex';
        return;
    }
    if (!findInput.value) {
        findCount.textContent = '';
        return;
    }
    findCount.textContent = matches.length ? `${currentIndex + 1}/${matches.length}` : 'No results';
}

// Match đang chứa con trỏ; nếu không có thì lấy match kế tiếp phía sau.
function matchIndexAtCaret() {
    if (!matches.length) return -1;
    const caret = markdownInput.selectionStart;
    const inside = matches.findIndex((m) => caret >= m.start && caret <= m.end);
    if (inside !== -1) return inside;
    const next = matches.findIndex((m) => m.start > caret);
    return next !== -1 ? next : 0;
}

function selectCurrent(scroll) {
    const match = matches[currentIndex];
    if (!match) return;
    markdownInput.setSelectionRange(match.start, match.end);
    if (scroll) scrollToMatch(match);
    updateCount();
}

function gotoMatch(step) {
    if (!matches.length) return;
    if (currentIndex < 0) currentIndex = step > 0 ? -1 : 0;
    currentIndex = (currentIndex + step + matches.length) % matches.length;
    selectCurrent(true);
}

// Lớp tô màu có cùng nội dung với textarea nên đo được vị trí thật của match.
function scrollToMatch(match) {
    if (editorHighlightCode.textContent.length !== markdownInput.value.length + 1) {
        updateEditorHighlight();
    }
    const range = makeRange(buildSegments(), match);
    if (!range) return;
    const rect = range.getBoundingClientRect();
    if (!rect.height && !rect.width) return;
    const layerRect = editorHighlight.getBoundingClientRect();
    const view = markdownInput.clientHeight;
    const target = (rect.top - layerRect.top) + markdownInput.scrollTop - view / 3;
    const max = Math.max(0, markdownInput.scrollHeight - view);
    markdownInput.scrollTop = Math.max(0, Math.min(target, max));
}

function refresh({ select, scroll = false } = {}) {
    const prev = currentIndex >= 0 ? matches[currentIndex] : null;
    const found = findMatches(markdownInput.value, findInput.value, { matchCase, useRegex });
    invalidRegex = found === null;
    matches = found || [];
    ranges = [];
    findInput.classList.toggle('invalid', invalidRegex);

    if (prev) {
        const idx = matches.findIndex((m) => m.start === prev.start && m.end === prev.end);
        currentIndex = idx;
    }
    if (currentIndex < 0) currentIndex = matchIndexAtCaret();

    const inWidget = document.activeElement === findInput || document.activeElement === findReplaceInput;
    scheduleHighlights();
    if ((select ?? inWidget) && currentIndex >= 0) {
        selectCurrent(scroll);
    } else {
        updateCount();
    }
}

// ---------- Thay thế ----------

// Nhóm bắt của match đang xét (chỉ chế độ regex mới cần).
function groupsAt(text, match) {
    if (!useRegex) return null;
    let regex;
    try {
        regex = buildRegex(findInput.value, matchCase, true);
    } catch (err) {
        return null;
    }
    regex.lastIndex = match.start;
    return regex.exec(text);
}

function replaceCurrent() {
    const match = matches[currentIndex];
    if (!match) return;
    const text = markdownInput.value;
    const groups = groupsAt(text, match);
    const replacement = useRegex ? expandGroups(findReplaceInput.value, groups) : findReplaceInput.value;
    const newText = text.substring(0, match.start) + replacement + text.substring(match.end);
    applyEditorChange(newText, match.start, match.start + replacement.length);

    // Tìm lại trên nội dung mới rồi nhảy tới match kế tiếp sau vị trí vừa thay.
    refresh({ select: false });
    const next = matches.findIndex((m) => m.start > match.start);
    currentIndex = next === -1 ? (matches.length ? 0 : -1) : next;
    if (currentIndex >= 0) selectCurrent(true);
    else updateCount();
}

function replaceAll() {
    const result = replaceAllMatches(markdownInput.value, findInput.value, findReplaceInput.value, { matchCase, useRegex });
    if (!result.count) return;
    const caret = Math.min(markdownInput.selectionStart, result.text.length);
    applyEditorChange(result.text, caret, caret);
    refresh({ select: false });
    showToast(`Replaced ${result.count} match${result.count === 1 ? '' : 'es'}`);
}

// ---------- Mở / đóng ----------

function setReplaceVisible(visible) {
    findReplaceRow.classList.toggle('hidden', !visible);
}

export function openFindWidget(withReplace = false) {
    if (!isOpen) {
        // Editor đang ẩn (chế độ Preview) thì bật lại Editor, nếu không widget mở ra mà không thấy.
        if (document.body.classList.contains('view-preview')) showEditorView();
        const selected = markdownInput.value.substring(markdownInput.selectionStart, markdownInput.selectionEnd);
        if (selected && !selected.includes('\n')) findInput.value = selected;
    }
    isOpen = true;
    findWidget.classList.add('open');
    setReplaceVisible(withReplace);
    refresh({ select: true, scroll: true });
    findInput.focus();
    findInput.select();
}

export function closeFindWidget() {
    if (!isOpen) return;
    isOpen = false;
    findWidget.classList.remove('open');
    if (highlightSupported()) CSS.highlights.delete(HIGHLIGHT_NAME);
    ranges = [];
    markdownInput.focus();
}

// ---------- Sự kiện ----------

function onWidgetKeydown(e) {
    // Chặn phím tắt toàn cục khi đang gõ trong widget (Tab, Ctrl+S, Ctrl+1..9...).
    e.stopPropagation();

    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const isCtrl = isMac ? e.metaKey : e.ctrlKey;
    const key = e.key.toLowerCase();
    const isInput = e.target instanceof HTMLInputElement;

    if (e.key === 'Escape') {
        e.preventDefault();
        closeFindWidget();
        return;
    }

    if (isCtrl && key === 'f') {
        e.preventDefault();
        setReplaceVisible(false);
        findInput.focus();
        findInput.select();
        return;
    }

    if (isCtrl && key === 'h') {
        e.preventDefault();
        setReplaceVisible(true);
        findReplaceInput.focus();
        findReplaceInput.select();
        return;
    }

    if (e.key === 'Enter' && isInput) {
        e.preventDefault();
        if (e.ctrlKey && e.altKey) {
            replaceAll();
            return;
        }
        if (e.target === findReplaceInput) {
            replaceCurrent();
            return;
        }
        gotoMatch(e.shiftKey ? -1 : 1);
    }
}

function onSelectionChange() {
    if (!isOpen) return;
    if (document.activeElement !== markdownInput) return;
    const match = matches[currentIndex];
    if (match && markdownInput.selectionStart === match.start && markdownInput.selectionEnd === match.end) return;
    const idx = matchIndexAtCaret();
    if (idx !== -1 && idx !== currentIndex) {
        currentIndex = idx;
        updateCount();
    }
}

export function initFindReplace() {
    findInput.addEventListener('input', () => refresh());
    findWidget.addEventListener('keydown', onWidgetKeydown);

    // Nút trên thanh định dạng: lối vào chắc chắn khi hệ điều hành giữ phím tắt.
    findBtn.addEventListener('click', () => openFindWidget(true));

    findCaseBtn.addEventListener('click', () => {
        matchCase = !matchCase;
        findCaseBtn.setAttribute('aria-pressed', String(matchCase));
        refresh();
    });

    findRegexBtn.addEventListener('click', () => {
        useRegex = !useRegex;
        findRegexBtn.setAttribute('aria-pressed', String(useRegex));
        refresh();
    });

    findPrevBtn.addEventListener('click', () => gotoMatch(-1));
    findNextBtn.addEventListener('click', () => gotoMatch(1));
    findCloseBtn.addEventListener('click', closeFindWidget);
    findReplaceBtn.addEventListener('click', replaceCurrent);
    findReplaceAllBtn.addEventListener('click', replaceAll);

    // Gõ trong Editor thì danh sách match phải bám theo nội dung mới.
    markdownInput.addEventListener('input', () => {
        if (isOpen) refresh();
    });

    // Đổi tab thì tìm lại trong nội dung tab mới.
    subscribe(() => {
        if (isOpen) refresh({ select: false });
    });

    document.addEventListener('selectionchange', onSelectionChange);

    // Lớp tô màu vẽ lại thì highlight của find phải vẽ lại theo.
    onEditorLayerRepaint(() => {
        if (isOpen) scheduleHighlights();
    });
}
