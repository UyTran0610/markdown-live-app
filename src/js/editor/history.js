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
        // Bỏ timer gom lịch sử còn treo: nếu để chạy sau khi đã lùi, nó push lại giá trị hiện tại và sinh
        // entry trùng không liền kề, làm Undo/Redo lệch bước.
        clearTimeout(this.typingTimer);
        // Lưu nội dung chưa kịp vào lịch sử trước khi lùi. push() đã tự tăng this.index nên KHÔNG giảm thêm,
        // nếu không Undo sẽ lùi 2 bước thay vì 1.
        if (this.stack[this.index] && this.stack[this.index].val !== el.value) {
            this.push(el.value, el.selectionStart, el.selectionEnd);
        }
        // Chỉ lùi được khi còn mục phía trước; stack rỗng (index = -1) thì index > 0 là false nên tự thoát.
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

// Trần ký tự cho TOÀN APP, không phải từng tab. Mỗi mục giữ nguyên chuỗi nội dung nên một file
// vài MB là vài chục MB lịch sử; nhân lên số tab là hết RAM. documents.js gọi pruneAllHistories()
// khi chuyển tab — chỉ ở đó thì không tốn công mỗi lần gõ.
//
// Đo bằng s.length là O(1) trong JS (độ dài chuỗi lưu sẵn), nên cộng vài nghìn mục là không tốn.
// 20M ký tự ~ 40MB UTF-16.
export const HISTORY_MAX_CHARS = 20000000;

// Cắt bớt từ các stack của tab NỀN trước (tab đang mở giữ nguyên đến lượt sau), rồi tới tab đang
// mở nếu vẫn còn dư. index phải dịch theo vì cắt ở đầu làm mất mục cũ đã lùi qua.
// histories: mọi stack, tab đang mở đặt CUỐI để nó bị cắt sau cùng — đó là cái người dùng đang Undo.
// histories đặt theo thứ tự ưu tiên cắt: tab đang mở đưa vào CUỐI để nó bị cắt sau cùng, vì đó
// là cái người dùng đang Undo. Mỗi lượt, stack h_i bị cắt xuống đúng số dư của trần sau khi trừ
// hết các stack còn lại — cắt "nhiều nhất có thể mà vẫn còn dưới trần".
// Duyệt tối đa 2 vòng rồi dừng: một lượt đã đủ để h_i về đúng mức, nên 2 vòng là biên an toàn
// và luôn kết thúc, không cần nhánh "stalled".
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

// Bỏ mục cũ từ đầu cho tới khi còn tối đa `budget` ký tự. Trả về số ký tự đã bỏ.
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
    // -1 là "trước mục cũ nhất", tức không còn gì để Undo tới — không xuống dưới -1.
    h.index = Math.max(-1, Math.min(h.index - cut, h.stack.length - 1));
    return before - chars;
}
