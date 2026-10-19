// js/editor/history.js — Lịch sử Undo / Redo riêng của editor.

import { syncEditorAfterChange } from './sync.js';

export const editorHistory = {
    stack: [],
    index: -1,
    maxSize: 150,
    typingTimer: null,

    push(val, start, end) {
        if (this.index < this.stack.length - 1) {
            this.stack = this.stack.slice(0, this.index + 1);
        }
        if (this.stack.length > 0 && this.stack[this.stack.length - 1].val === val) {
            this.stack[this.stack.length - 1].start = start;
            this.stack[this.stack.length - 1].end = end;
            return;
        }
        this.stack.push({ val, start, end });
        if (this.stack.length > this.maxSize) {
            this.stack.shift();
        } else {
            this.index++;
        }
    },

    saveCurrentState(el) {
        this.push(el.value, el.selectionStart, el.selectionEnd);
    },

    undo(el) {
        // Bỏ timer gom còn treo, nếu không nó push lại giá trị hiện tại và sinh entry trùng.
        clearTimeout(this.typingTimer);
        // push() đã tăng index nên KHÔNG giảm thêm, nếu không Undo lùi 2 bước.
        if (this.stack[this.index] && this.stack[this.index].val !== el.value) {
            this.push(el.value, el.selectionStart, el.selectionEnd);
        }
        // Chỉ lùi khi còn mục phía trước; index > 0 tự thoát khi stack rỗng.
        if (this.index > 0) {
            this.index--;
            const state = this.stack[this.index];
            el.value = state.val;
            el.setSelectionRange(state.start, state.end);
            syncEditorAfterChange();
        }
    },

    redo(el) {
        clearTimeout(this.typingTimer);
        if (this.index < this.stack.length - 1) {
            this.index++;
            const state = this.stack[this.index];
            el.value = state.val;
            el.setSelectionRange(state.start, state.end);
            syncEditorAfterChange();
        }
    }
};

// Trần ký tự cho TOÀN APP (mỗi mục giữ cả tài liệu); documents.js gọi khi chuyển tab, không mỗi lần gõ.
// 20M ký tự ~ 40MB UTF-16; s.length là O(1).
export const HISTORY_MAX_CHARS = 20000000;

// Cắt stack tab nền trước, tab đang mở đặt CUỐI nên bị cắt sau cùng; index dịch theo vì cắt ở đầu.
// Mỗi lượt cắt h_i xuống đúng số dư của trần sau khi trừ các stack còn lại.
// Tối đa 2 vòng là biên an toàn và luôn kết thúc.
export function pruneAllHistories(histories, maxChars = HISTORY_MAX_CHARS) {
    if (!histories.length) return;
    const chars = histories.map(historyChars);
    let total = chars.reduce((sum, n) => sum + n, 0);
    let i = 0;
    for (let step = 0; total > maxChars && step < histories.length * 2; step++) {
        const budget = Math.max(0, maxChars - (total - chars[i]));
        if (chars[i] > budget) {
            total -= trimHistory(histories[i], budget);
            chars[i] = historyChars(histories[i]);
        }
        i = (i + 1) % histories.length;
    }
}

function historyChars(h) {
    return h.stack.reduce((sum, entry) => sum + entry.val.length, 0);
}

// Bỏ mục cũ từ đầu cho tới khi còn tối đa budget ký tự. Trả về số ký tự đã bỏ.
function trimHistory(h, budget) {
    const before = historyChars(h);
    if (before <= budget) return 0;
    let chars = before;
    let cut = 0;
    while (chars > budget && cut < h.stack.length) {
        chars -= h.stack[cut].val.length;
        cut++;
    }
    h.stack.splice(0, cut);
    // -1 là trước mục cũ nhất, không xuống dưới -1.
    h.index = Math.max(-1, Math.min(h.index - cut, h.stack.length - 1));
    return before - chars;
}
