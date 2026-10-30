// js/core/flags.js — Cờ trạng thái dùng chung, không phụ thuộc DOM (để không sinh vòng import).

let panesResizing = false;

// Đang kéo thanh chia pane: lớp tô màu editor tạm ngưng, hover/cursor trong pane bị khoá.
export function isResizingPanes() {
    return panesResizing;
}

export function setPanesResizing(value) {
    panesResizing = !!value;
}
