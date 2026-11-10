// js/editor/find.js — Tìm & thay thế: panel nổi do app dựng, quét nội dung editor.
//
// Chỉ quét doc của CodeMirror, không đụng DOM Preview. Mở panel KHÔNG đổi chế độ xem;
// mũi tên ▲▼ nhảy tới match, ở chế độ Preview-only thì bật Editor tạm để thấy match.

import {
    findCloseBtn,
    findCount,
    findDialog,
    findInput,
    findMatchCase,
    findNextBtn,
    findPrevBtn,
    findRegex,
    findReplaceAllBtn,
    findReplaceBtn,
    findToggleReplace,
    replaceInput
} from '../core/dom.js';
import { subscribe } from '../io/documents.js';
import { showEditorView } from '../ui/view-mode.js';
import { Decoration, getView, setFindHighlights } from './cm.js';

const MAX_MATCHES = 5000;   // trần số kết quả: regex trên tài liệu lớn không quét vô hạn
const MAX_HIGHLIGHTS = 500;  // trần số match được tô trong editor (render tốn)
const SEARCH_DELAY = 120;   // debounce khi gõ vào ô Find

let matches = [];
let activeIndex = -1;
let sourceText = '';        // ảnh chụp nội dung lúc tìm, dùng cho $' trong regex
let searchError = '';
let returnFocus = null;
let searchTimer = null;

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Tìm mọi match của query trong text; trả { matches, error }. */
export function findMatches(text, query, { matchCase = false, useRegex = false } = {}) {
    if (!query) return { matches: [], error: '' };
    let re;
    try {
        re = new RegExp(useRegex ? query : escapeRegExp(query), matchCase ? 'g' : 'gi');
    } catch (e) {
        return { matches: [], error: 'Invalid regular expression' };
    }
    const found = [];
    let m;
    while ((m = re.exec(text)) !== null) {
        // Regex rỗng không tự tiến lastIndex, phải đẩy tay để khỏi lặp vô hạn.
        if (m[0] === '') { re.lastIndex++; continue; }
        found.push({
            from: m.index,
            to: m.index + m[0].length,
            hit: m[0],
            groups: useRegex ? m.slice(1) : null
        });
        if (found.length >= MAX_MATCHES) break;
    }
    return { matches: found, error: '' };
}

function currentOptions() {
    return { matchCase: findMatchCase.checked, useRegex: findRegex.checked };
}

function runSearch(resetActive = false) {
    const v = getView();
    if (!v) return;
    sourceText = v.state.doc.toString();
    const result = findMatches(sourceText, findInput.value, currentOptions());
    matches = result.matches;
    searchError = result.error;
    if (resetActive) activeIndex = -1;
    if (activeIndex >= matches.length) activeIndex = matches.length ? 0 : -1;
    render();
}

function scheduleSearch() {
    if (searchTimer !== null) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
        searchTimer = null;
        runSearch(true);
    }, SEARCH_DELAY);
}

function render() {
    renderCount();
    renderHighlights();
}

function renderCount() {
    findCount.classList.toggle('is-error', !!searchError);
    if (searchError) { findCount.textContent = 'Invalid regex'; return; }
    if (!findInput.value) { findCount.textContent = ''; return; }
    if (!matches.length) {
        findCount.textContent = '0/0';
        findCount.classList.add('is-error');
        return;
    }
    findCount.textContent = activeIndex < 0
        ? `${matches.length} result${matches.length === 1 ? '' : 's'}`
        : `${activeIndex + 1}/${matches.length}`;
}

function renderHighlights() {
    const v = getView();
    if (!v) return;
    const ranges = [];
    let painted = 0;
    matches.forEach((m, i) => {
        if (i === activeIndex) return;
        if (painted >= MAX_HIGHLIGHTS) return;
        painted++;
        ranges.push({ from: m.from, to: m.to, value: Decoration.mark({ class: 'cm-find-hit' }) });
    });
    // Match đang chọn luôn được tô, kể cả khi vượt trần highlight.
    const active = matches[activeIndex];
    if (active) {
        ranges.push({ from: active.from, to: active.to, value: Decoration.mark({ class: 'cm-find-hit cm-find-hit-active' }) });
    }
    setFindHighlights(v, Decoration.set(ranges, true));
}

function selectActive() {
    const v = getView();
    const m = matches[activeIndex];
    if (!v || !m) return;
    v.dispatch({ selection: { anchor: m.from, head: m.to }, scrollIntoView: true });
}

export function findNextMatch() {
    if (!matches.length) return;
    activeIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % matches.length;
    render();
    jumpToActive();
}

export function findPrevMatch() {
    if (!matches.length) return;
    activeIndex = activeIndex < 0 ? matches.length - 1 : (activeIndex - 1 + matches.length) % matches.length;
    render();
    jumpToActive();
}

// Chỉ có ý nghĩa với regex: $1..$9, $&, $' và $$.
function expandGroups(template, m) {
    if (!m.groups) return template;
    return template.replace(/\$\$|\$&|\$'|\$(\d)/g, (all, digit) => {
        if (all === '$$') return '$';
        if (all === '$&') return m.hit;
        if (all === "$'") return sourceText.slice(0, m.from);
        const group = m.groups[Number(digit) - 1];
        return group === undefined ? '' : group;
    });
}

export function replaceFindCurrent() {
    const v = getView();
    const m = matches[activeIndex];
    if (!v || !m) return;
    const insert = expandGroups(replaceInput.value, m);
    const anchor = m.from + insert.length;
    v.dispatch({
        changes: { from: m.from, to: m.to, insert },
        selection: { anchor },
        userEvent: 'input'
    });
    runSearch();
    // Chọn match kế tiếp sau chỗ vừa thay.
    const next = matches.findIndex((x) => x.from >= anchor);
    activeIndex = next >= 0 ? next : (matches.length ? 0 : -1);
    render();
    selectActive();
}

export function replaceFindAll() {
    const v = getView();
    if (!v || !matches.length) return;
    // Changes phải tăng dần và không chồng nhau: matches đã đúng thứ tự đó.
    const changes = matches.map((m) => ({ from: m.from, to: m.to, insert: expandGroups(replaceInput.value, m) }));
    v.dispatch({ changes, userEvent: 'input' });
    runSearch(true);
}

export function isFindDialogOpen() {
    return !findDialog.classList.contains('hidden');
}

/** Bật/tắt hàng thay thế (nút ⇄ hoặc Ctrl+H). */
function setReplaceVisible(visible) {
    findDialog.classList.toggle('show-replace', visible);
    findToggleReplace.setAttribute('aria-expanded', visible ? 'true' : 'false');
}

/** Mở panel tìm; focus='replace' để Ctrl+H nhảy thẳng ô thay thế. */
export function openFindDialog({ focus = 'find' } = {}) {
    const v = getView();
    if (!v) return;
    if (!isFindDialogOpen()) {
        returnFocus = document.activeElement;
        findDialog.classList.remove('hidden');
        // Mở lại với vùng đang bôi đen thì chọn sẵn nội dung đó.
        const sel = v.state.selection.main;
        if (sel.from !== sel.to && !findInput.value) findInput.value = v.state.sliceDoc(sel.from, sel.to);
        runSearch(true);
    }
    if (focus === 'replace') setReplaceVisible(true);
    const target = focus === 'replace' ? replaceInput : findInput;
    target.focus();
    target.select();
}

export function closeFindDialog() {
    if (!isFindDialogOpen()) return;
    findDialog.classList.add('hidden');
    matches = [];
    activeIndex = -1;
    searchError = '';
    findCount.textContent = '';
    const v = getView();
    if (v) setFindHighlights(v, Decoration.none);
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
    returnFocus = null;
}

/** Quét lại ngay (selfcheck, đổi tab). */
export function runFindSearch() {
    if (!isFindDialogOpen()) return;
    runSearch(true);
}

/** Editor đổi nội dung thì kết quả cũ hỏng theo. */
export function refreshFindResults() {
    if (!isFindDialogOpen()) return;
    scheduleSearch();
}

export function getFindMatches() {
    return matches;
}

export function getFindActiveIndex() {
    return activeIndex;
}

function jumpToActive() {
    const v = getView();
    if (!v) return;
    // Ở chế độ Preview-only, editor đang ẩn: bật Editor trước rồi mới đặt con trỏ.
    if (document.body.classList.contains('view-preview')) {
        showEditorView(false);
        requestAnimationFrame(() => {
            v.requestMeasure();
            selectActive();
        });
        return;
    }
    selectActive();
}

function onDialogKeydown(e) {
    e.stopPropagation();
    const inFind = e.target === findInput;
    const inReplace = e.target === replaceInput;
    if (e.key === 'Escape') {
        e.preventDefault();
        closeFindDialog();
        return;
    }
    if (e.key === 'Tab') {
        e.preventDefault();
        // Chỉ duyệt phần tử đang hiện: hàng thay thế gập thì không focus được.
        const focusables = Array.from(findDialog.querySelectorAll('input, button')).filter((el) => el.offsetParent !== null);
        const idx = focusables.indexOf(document.activeElement);
        const next = e.shiftKey
            ? focusables[(idx - 1 + focusables.length) % focusables.length]
            : focusables[(idx + 1) % focusables.length];
        if (next) next.focus();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 'f') { e.preventDefault(); findInput.focus(); findInput.select(); return; }
        if (key === 'h') { e.preventDefault(); setReplaceVisible(true); replaceInput.focus(); replaceInput.select(); return; }
    }
    if (e.key === 'Enter') {
        if (inFind) {
            e.preventDefault();
            if (e.shiftKey) findPrevMatch(); else findNextMatch();
            return;
        }
        if (inReplace) {
            e.preventDefault();
            replaceFindCurrent();
            return;
        }
    }
    if (inFind && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        if (e.key === 'ArrowDown') findNextMatch(); else findPrevMatch();
    }
}

export function initFindDialog() {
    findInput.addEventListener('input', scheduleSearch);
    findMatchCase.addEventListener('change', () => runSearch(true));
    findRegex.addEventListener('change', () => runSearch(true));
    findNextBtn.addEventListener('click', findNextMatch);
    findPrevBtn.addEventListener('click', findPrevMatch);
    findReplaceBtn.addEventListener('click', replaceFindCurrent);
    findReplaceAllBtn.addEventListener('click', replaceFindAll);
    findCloseBtn.addEventListener('click', closeFindDialog);
    findToggleReplace.addEventListener('click', () => {
        setReplaceVisible(!findDialog.classList.contains('show-replace'));
    });
    findDialog.addEventListener('keydown', onDialogKeydown);
    // Đổi tab là nội dung editor đổi: tìm lại trên tài liệu mới.
    subscribe(() => {
        if (isFindDialogOpen()) runSearch(true);
    });
}
