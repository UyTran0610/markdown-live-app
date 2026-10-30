// js/editor/highlight.js — Lớp tô màu cú pháp phía sau textarea (chỉ tô vùng nhìn thấy).

import { editorHighlight, editorHighlightCode, markdownInput } from '../core/dom.js';
import { isResizingPanes } from '../core/flags.js';
import { highlightMarkdown } from './syntax/block.js';

// Phải khớp #markdown-input / #editor-highlight trong css/editor.css.
const LINE_HEIGHT = 26;
const PAD_Y = 20;
// Tô thêm mỗi phía chừng này viewport: cuộn thường không phải dựng lại mà vẫn có màu sẵn.
const OVERSCAN = 1.5;
// Lớp chia lô theo dòng, mỗi lô một block (xem #editor-highlight-code > span trong css/editor.css):
// đổi cửa sổ chỉ layout lại lô ở hai mép, không ngắt dòng lại cả tài liệu (phần lớn độ trễ cuộn).
const CHUNK_LINES = 128;
// Vùng đổi rộng hơn tỉ lệ này thì dựng lại cả lớp (chép nguyên tài liệu, đổi tab).
const FULL_REBUILD_RATIO = 0.5;
// Ngân sách lệch của ước lượng wrap: số ký tự đã sửa kể từ lần đo scrollHeight gần nhất.
// Gõ tay mỗi phím chỉ dùng 1 ký tự nên không bao giờ chạm ngân sách; dán lôi thì chạm,
// và lúc đó phải đo lại, nếu không ước lượng lệch xa và vùng nhìn thấy mất màu tô.
const TOP_REFRESH_CHARS = 200;

// ?perf: perfcheck bật cờ này để đếm đường đi của lớp tô màu; tắt thì không tốn gì.
export const highlightPerf = {
    enabled: false,
    build: 0,
    edited: 0,
    editFailed: 0,
    paintCalls: 0,
    paintedChunks: 0,
    chunks: 0
};

// Đỉnh từng dòng và các lô hiện tại; text đổi thì chỉ dựng lại vùng bị chạm, bề rộng đổi thì chỉ tính lại đỉnh.
let lastText = null;
let lastWidth = 0;
let tops = [];
let lineCount = 0;
let chunks = [];
// Số ký tự đã sửa kể từ lần tính tops gần nhất (xem TOP_REFRESH_CHARS).
let topDrift = 0;

const EMPTY_STATE = { inFence: false, inHtmlComment: false, inMathBlock: false };

// Đỉnh từng dòng (px) suy từ số dòng hiển thị thật của textarea; phần tử cuối là đáy tài liệu.
// Chỉ dùng để CHỌN cửa sổ: ước lượng lệch thì thiếu màu chứ không lệch chữ, vì ngoài cửa sổ là text thô.
function lineTops(lines, totalRows) {
    let chars = 0;
    for (const line of lines) chars += line.length;
    // Một dòng hiển thị chứa trung bình wrapWidth ký tự; dòng ngắn vẫn chiếm trọn 1 dòng hiển thị.
    const wrapWidth = Math.max(chars / Math.max(totalRows - lines.length / 2, 1), 1);
    let rows = 0;
    for (const line of lines) rows += Math.ceil(Math.max(line.length, 1) / wrapWidth);
    const rowHeight = (totalRows / Math.max(rows, 1)) * LINE_HEIGHT;
    const tops = new Array(lines.length + 1);
    let y = 0;
    for (let i = 0; i < lines.length; i++) {
        tops[i] = y;
        y += Math.ceil(Math.max(lines[i].length, 1) / wrapWidth) * rowHeight;
    }
    tops[lines.length] = y;
    return tops;
}

// Dòng chứa pixel y (kẹp trong [0, count - 1]).
function lineAt(tops, y, count) {
    let lo = 0;
    let hi = count - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (tops[mid + 1] <= y) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

function updateTops(lines) {
    const totalRows = Math.max(1, Math.round((markdownInput.scrollHeight - PAD_Y * 2) / LINE_HEIGHT));
    tops = lineTops(lines, totalRows);
    lineCount = lines.length;
    topDrift = 0;
}

// Thứ tự ưu tiên giống vòng lặp trong highlightMarkdown: comment -> fence -> toán.
const BLOCK_MARK = /^[ \t]{0,3}(`{3,}|~{3,})|(<!--)|(-->)|^[ \t]*(\$\$)[ \t]*$/gm;

// shortcut: bỏ qua indented code và fence thụt bằng tab ở đầu cửa sổ; lệch thì chỉ sai màu vài dòng.
function advanceBlockState(state, text) {
    const next = { ...state };
    BLOCK_MARK.lastIndex = 0;
    let mark;
    while ((mark = BLOCK_MARK.exec(text)) !== null) {
        if (mark[1]) {
            if (!next.inHtmlComment) next.inFence = !next.inFence;
        } else if (mark[2]) {
            if (!next.inFence && !next.inMathBlock) next.inHtmlComment = true;
        } else if (mark[3]) {
            next.inHtmlComment = false;
        } else if (!next.inFence && !next.inHtmlComment) {
            next.inMathBlock = !next.inMathBlock;
        }
    }
    return next;
}

// Lô chứa offset (lô cuối nhận offset == độ dài tài liệu).
function chunkAt(offset) {
    let lo = 0;
    let hi = chunks.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (chunks[mid].start <= offset) lo = mid;
        else hi = mid - 1;
    }
    return lo;
}

function chunkAtLine(line) {
    let lo = 0;
    let hi = chunks.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (chunks[mid].line <= line) lo = mid;
        else hi = mid - 1;
    }
    return lo;
}

// Toàn bộ tài liệu vẫn nằm trong lớp (đúng thứ tự) để wrap và caret khớp textarea;
// chỉ có lô quanh viewport là HTML đã tô, phần còn lại là text thô.
function buildLayer(text) {
    if (highlightPerf.enabled) highlightPerf.build++;
    const lines = text.split('\n');
    updateTops(lines);
    chunks = [];
    let start = 0;
    let state = EMPTY_STATE;
    for (let i = 0; i < lines.length; i += CHUNK_LINES) {
        // '\n' cuối lô kết thúc dòng cuối của lô; block kế tiếp bắt đầu dòng mới nên không thêm dòng trống.
        const body = lines.slice(i, i + CHUNK_LINES).join('\n') + '\n';
        const el = document.createElement('span');
        el.textContent = body;
        chunks.push({ el, body, start, line: i, state, painted: false });
        state = advanceBlockState(state, body);
        start += body.length;
    }
    editorHighlightCode.replaceChildren(...chunks.map((chunk) => chunk.el));
}

// Dựng lại đúng vùng bị chạm; lô sau chỉ cộng delta vào start/line, không đụng DOM.
// Vùng dừng ở biên lô cũ + delta (thêm 1 lô nếu mất newline biên) nên lô cuối có thể ngắn hơn CHUNK_LINES.
function editLayer(prev, text) {
    let prefix = 0;
    const max = Math.min(prev.length, text.length);
    while (prefix < max && prev.charCodeAt(prefix) === text.charCodeAt(prefix)) prefix++;
    let suffix = 0;
    while (suffix < max - prefix
        && prev.charCodeAt(prev.length - 1 - suffix) === text.charCodeAt(text.length - 1 - suffix)) suffix++;
    const oldEnd = prev.length - suffix;
    const changed = Math.max(oldEnd - prefix, text.length - suffix - prefix);
    if (changed > Math.max(prev.length, text.length) * FULL_REBUILD_RATIO) return false;

    const i0 = chunkAt(prefix);
    let i1 = oldEnd > prefix ? chunkAt(oldEnd - 1) : i0;
    // Xoá đúng biên lô làm mất newline cuối lô: dòng đầu lô sau nhập vào dòng cuối vùng,
    // nên gộp thêm lô đó để biên mới vẫn nằm ở đầu dòng.
    if (oldEnd > prefix && i1 + 1 < chunks.length
        && oldEnd === chunks[i1].start + chunks[i1].body.length) i1++;
    const lines = text.split('\n');
    const lineDelta = lines.length - lineCount;
    const lineStart = chunks[i0].line;
    const oldNextLine = i1 + 1 < chunks.length ? chunks[i1 + 1].line : lineCount;
    const regionLines = lines.slice(lineStart, oldNextLine + lineDelta);
    if (!regionLines.length) return false;

    const oldCount = i1 - i0 + 1;
    const regionState = chunks[i0].state;
    const oldNextState = i1 + 1 < chunks.length ? chunks[i1 + 1].state : null;
    const delta = text.length - prev.length;
    let offset = chunks[i0].start;
    const parts = [];
    for (let k = 0; k < regionLines.length; k += CHUNK_LINES) {
        const part = k / CHUNK_LINES;
        const body = regionLines.slice(k, k + CHUNK_LINES).join('\n') + '\n';
        // Tái dùng element cũ: giữ vị trí DOM, chỉ thay text (xoá HTML đã tô).
        const el = part < oldCount ? chunks[i0 + part].el : document.createElement('span');
        el.textContent = body;
        parts.push({ el, body, start: offset, line: lineStart + k, state: regionState, painted: false });
        offset += body.length;
    }
    const anchor = chunks[i1].el.nextSibling;
    for (let k = oldCount; k < parts.length; k++) editorHighlightCode.insertBefore(parts[k].el, anchor);
    for (let k = parts.length; k < oldCount; k++) chunks[i0 + k].el.remove();
    chunks.splice(i0, oldCount, ...parts);
    for (let i = i0 + parts.length; i < chunks.length; i++) {
        chunks[i].start += delta;
        chunks[i].line += lineDelta;
    }

    // State từng lô trong vùng phải tính tuần tự: fence/comment có thể mở rồi đóng giữa vùng.
    let state = regionState;
    for (let i = i0; i < i0 + parts.length; i++) {
        chunks[i].state = state;
        state = advanceBlockState(state, chunks[i].body);
    }
    // State cuối vùng đổi thì state của mọi lô sau cũng đổi, kể cả khi dòng đổi không chứa ký hiệu khối.
    const stateChanged = oldNextState !== null && (state.inFence !== oldNextState.inFence
        || state.inHtmlComment !== oldNextState.inHtmlComment
        || state.inMathBlock !== oldNextState.inMathBlock);
    if (stateChanged) {
        for (let i = i0 + parts.length; i < chunks.length; i++) {
            chunks[i].state = state;
            state = advanceBlockState(state, chunks[i].body);
        }
        // HTML đã tô của các lô sau dựa trên trạng thái cũ; trả hết về text thô rồi tô lại cửa sổ.
        for (const chunk of chunks) {
            if (!chunk.painted) continue;
            chunk.el.textContent = chunk.body;
            chunk.painted = false;
        }
    }
    // Số dòng không đổi thì đỉnh dòng (chỉ dùng chọn cửa sổ tô màu) vẫn gần đúng: bỏ qua
    // updateTops để không đọc scrollHeight, vì đọc là ép layout toàn bộ textarea (35–130ms mỗi phím).
    // Sửa lôi (dán) thì ngân sách lệch đầy -> phải đo lại, nếu không vùng nhìn thấy sẽ mất màu.
    topDrift += changed;
    if (lineDelta !== 0 || topDrift > TOP_REFRESH_CHARS) updateTops(lines);
    return true;
}

// Tô các lô trong [from, to], trả các lô đã tô nằm ngoài về text thô.
function paint(from, to) {
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (chunk.painted && (i < from || i > to)) {
            chunk.el.textContent = chunk.body;
            chunk.painted = false;
        }
    }
    let painted = 0;
    for (let i = from; i <= to; i++) {
        const chunk = chunks[i];
        if (chunk.painted) continue;
        chunk.el.innerHTML = highlightMarkdown(chunk.body, chunk.state);
        chunk.painted = true;
        painted++;
    }
    if (highlightPerf.enabled) {
        highlightPerf.paintCalls++;
        highlightPerf.paintedChunks += painted;
    }
}

export function updateEditorHighlight(force = false) {
    const text = markdownInput.value;
    const width = markdownInput.clientWidth;
    // Pane ẩn (chế độ Preview): mọi số đo bằng 0, ResizeObserver gọi lại khi pane hiện.
    if (!width) return;
    // Text đổi thì sửa lô; bề rộng đổi thì chỉ wrap đổi, không đụng nội dung lô nào.
    let rebuilt = force || lastText === null;
    if (!rebuilt && text !== lastText) {
        if (editLayer(lastText, text)) {
            if (highlightPerf.enabled) highlightPerf.edited++;
        } else {
            if (highlightPerf.enabled) highlightPerf.editFailed++;
            rebuilt = true;
        }
    }
    if (rebuilt) buildLayer(text);
    else if (text === lastText && width !== lastWidth) updateTops(text.split('\n'));
    lastText = text;
    lastWidth = width;
    if (highlightPerf.enabled) highlightPerf.chunks = chunks.length;

    const scrollTop = markdownInput.scrollTop;
    const viewHeight = markdownInput.clientHeight;
    const top = scrollTop - PAD_Y;
    const overscan = viewHeight * OVERSCAN;
    const from = chunkAtLine(lineAt(tops, top - overscan, lineCount));
    const to = chunkAtLine(lineAt(tops, top + viewHeight + overscan, lineCount));
    paint(from, to);

    // Thay nội dung làm lớp này mất vị trí cuộn; textarea là chân lý.
    editorHighlight.scrollTop = scrollTop;
    editorHighlight.scrollLeft = markdownInput.scrollLeft;
}

// Gộp các lần gọi liên tiếp thành 1 lần tô màu mỗi khung hình, không chặn handler input.
let editorHighlightRAF = null;

export function scheduleEditorHighlight() {
    if (editorHighlightRAF !== null) return;
    editorHighlightRAF = requestAnimationFrame(() => {
        editorHighlightRAF = null;
        updateEditorHighlight();
    });
}

// Perfcheck dùng: hủy rAF đang treo để giờ đo bắt đầu rỗng rAF, không bị guard nuốt mất tô màu.
export function cancelScheduledEditorHighlight() {
    if (editorHighlightRAF === null) return;
    cancelAnimationFrame(editorHighlightRAF);
    editorHighlightRAF = null;
}

export function initEditorHighlight() {
    // Cuộn không đổi nội dung thì cửa sổ tô màu phải trôi theo; guard trong update lo phần bỏ qua.
    markdownInput.addEventListener('scroll', scheduleEditorHighlight);
    // Đổi bề rộng (kéo divider, đổi view, maximize) là đổi chỗ wrap của cả hai lớp.
    // Đang kéo divider thì tạm dừng: tô lại mỗi frame tốn 77–193ms, tô một lần lúc nhả chuột.
    new ResizeObserver(() => {
        if (isResizingPanes()) return;
        scheduleEditorHighlight();
    }).observe(markdownInput);
}
