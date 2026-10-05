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
        if (this.index <= 0 && this.stack.length <= 1) return;
        // Lưu nội dung chưa kịp vào lịch sử trước khi lùi. push() đã tự tăng this.index nên KHÔNG giảm thêm,
        // nếu không Undo sẽ lùi 2 bước thay vì 1.
        if (this.stack[this.index] && this.stack[this.index].val !== el.value) {
            this.push(el.value, el.selectionStart, el.selectionEnd);
        }
        if (this.index > 0) {
            this.index--;
            const state = this.stack[this.index];
            el.value = state.val;
            el.setSelectionRange(state.start, state.end);
            syncEditorAfterChange();
        }
    },

    redo(el) {
        if (this.index < this.stack.length - 1) {
            this.index++;
            const state = this.stack[this.index];
            el.value = state.val;
            el.setSelectionRange(state.start, state.end);
            syncEditorAfterChange();
        }
    }
};
