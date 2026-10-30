// js/ui/view-mode.js — Chế độ xem Editor / Split / Preview và thanh kéo chia pane.

import { btnView, markdownInput, paneResizer, paneResizerGhost, viewItems, viewMenu, viewWrap, workspace } from '../core/dom.js';
import { setPanesResizing } from '../core/flags.js';
import { scheduleEditorHighlight } from '../editor/highlight.js';
import { renderActivePreview } from '../io/documents.js';

const VIEW_STORAGE_KEY = 'markdown-live-view';

const DEFAULT_VIEW_MODE = 'split';

// Phải khớp @media (max-width: 768px) trong layout.css.
const VERTICAL_LAYOUT_MQ = '(max-width: 768px)';

export const SPLIT_MIN_PERCENT = 20;

export const SPLIT_MAX_PERCENT = 80;

const VIEW_EDGE_PREVIEW_PERCENT = 2;

const VIEW_EDGE_EDITOR_PERCENT = 98;

// Trên ngưỡng này kéo bằng thanh ảo: reflow Editor + Preview mỗi frame tốn 473–766ms/frame.
export const GHOST_DRAG_MIN_CHARS = 100000;

// Bề dày thanh ảo, khớp #pane-resizer.
const GHOST_BAR = 5;

export function computeSplitPercent(pointerX, workspaceWidth) {
    if (!(workspaceWidth > 0)) return 50;
    const percent = (pointerX / workspaceWidth) * 100;
    return Math.min(SPLIT_MAX_PERCENT, Math.max(SPLIT_MIN_PERCENT, percent));
}

export function computeViewModeFromPercent(percent) {
    if (percent < VIEW_EDGE_PREVIEW_PERCENT) return 'preview';
    if (percent > VIEW_EDGE_EDITOR_PERCENT) return 'editor';
    return 'split';
}

// Tài liệu lớn thì kéo bằng thanh ảo (pane đứng yên) thay vì kéo live (mỗi frame đều reflow).
export function usesGhostDrag(chars) {
    return chars > GHOST_DRAG_MIN_CHARS;
}

// Lệch của mép trái thanh ảo so với ranh giới pane, tính theo phần trăm đã kéo.
export function ghostOffsetPx(percent, size) {
    return (percent / 100) * size - GHOST_BAR / 2;
}

function getCurrentViewMode() {
    return document.body.classList.contains('view-editor') ? 'editor'
        : document.body.classList.contains('view-preview') ? 'preview'
        : 'split';
}

// localStorage có thể chứa rác: chỉ nhận đúng 3 giá trị hợp lệ, nếu không body mất class view-*.
export function isValidViewMode(mode) {
    return mode === 'editor' || mode === 'split' || mode === 'preview';
}

function applyViewMode(mode, persist = true) {
    if (!isValidViewMode(mode)) return;
    document.body.classList.toggle('view-editor', mode === 'editor');
    document.body.classList.toggle('view-split', mode === 'split');
    document.body.classList.toggle('view-preview', mode === 'preview');
    viewItems.forEach((item) => {
        item.classList.toggle('active', item.dataset.view === mode);
    });
    // Editor bỏ qua mọi lượt render nên chuyển sang chế độ có preview phải render bù.
    if (mode !== 'editor') renderActivePreview();
    if (persist) {
        try {
            localStorage.setItem(VIEW_STORAGE_KEY, mode);
        } catch (e) {
            // Bỏ qua nếu localStorage bị chặn.
        }
    }
}

function closeViewMenu() {
    viewMenu.classList.add('hidden');
    viewWrap.classList.remove('open');
    btnView.setAttribute('aria-expanded', 'false');
}

let isDraggingResizer = false;
// 'live' = áp --split-size ngay (rAF); 'ghost' = pane đứng yên, chỉ thanh ảo đi theo chuột.
let dragMode = null;
let dragAxis = 'x';
// Rect workspace đo một lần lúc bắt đầu kéo: đọc lại mỗi move là ép layout giữa kéo.
let dragRect = null;
let pendingSplit = 50;
let pendingViewMode = 'split';
let splitRAF = null;
// --split-size đã ghi lần cuối (null = chưa ghi, CSS mặc định 50%).
let splitPercent = null;

function currentSplitPercent() {
    return splitPercent === null ? 50 : splitPercent;
}

function setSplitPercent(percent) {
    if (percent === splitPercent) return;
    splitPercent = percent;
    workspace.style.setProperty('--split-size', percent + '%');
}

// Gom pointermove vào rAF: không ghi style nhiều hơn tần số quét màn hình.
function scheduleSplitUpdate() {
    if (splitRAF !== null) return;
    splitRAF = requestAnimationFrame(() => {
        splitRAF = null;
        setSplitPercent(pendingSplit);
    });
}

// Đẩy nốt lần ghi đang treo trong rAF, nếu không lần nhả chuột cuối sẽ bị rơi.
function flushSplit() {
    if (splitRAF !== null) {
        cancelAnimationFrame(splitRAF);
        splitRAF = null;
    }
    setSplitPercent(pendingSplit);
}

function showGhost() {
    if (!paneResizerGhost) return;
    paneResizerGhost.style.display = 'block';
    applyGhostGeometry();
    // Đặt ngay tại ranh giới đang có, không nhảy sang con trỏ khi vừa bấm.
    moveGhost(currentSplitPercent());
}

function applyGhostGeometry() {
    if (!paneResizerGhost) return;
    paneResizerGhost.style.left = `${dragRect.left}px`;
    paneResizerGhost.style.top = `${dragRect.top}px`;
    if (dragAxis === 'y') {
        paneResizerGhost.style.width = `${dragRect.width}px`;
        paneResizerGhost.style.height = `${GHOST_BAR}px`;
    } else {
        paneResizerGhost.style.width = `${GHOST_BAR}px`;
        paneResizerGhost.style.height = `${dragRect.height}px`;
    }
}

// Chỉ đổi transform: thanh ảo nằm trên layer GPU nên không reflow pane nào.
function moveGhost(percent) {
    if (!paneResizerGhost) return;
    if (dragAxis === 'y') {
        const offset = ghostOffsetPx(percent, dragRect.height);
        paneResizerGhost.style.transform = `translate3d(0, ${offset}px, 0)`;
    } else {
        const offset = ghostOffsetPx(percent, dragRect.width);
        paneResizerGhost.style.transform = `translate3d(${offset}px, 0, 0)`;
    }
}

function hideGhost() {
    if (!paneResizerGhost) return;
    paneResizerGhost.style.display = 'none';
    paneResizerGhost.style.transform = '';
}

function endResizerDrag() {
    if (!isDraggingResizer) return;
    isDraggingResizer = false;
    const wasGhost = dragMode === 'ghost';
    dragMode = null;
    paneResizer.classList.remove('dragging');
    document.body.classList.remove('resizing');
    setPanesResizing(false);
    hideGhost();
    // Layout cuối cùng chỉ áp dụng đúng một lần: ghost đợi tới lúc nhả chuột, live đẩy nốt rAF đang treo.
    if (wasGhost) {
        if (pendingViewMode !== 'split') applyViewMode(pendingViewMode);
        else setSplitPercent(pendingSplit);
    } else {
        flushSplit();
    }
    // Bề rộng editor đã đổi: tô màu lại đúng một lần sau khi kéo xong.
    scheduleEditorHighlight();
}

export function initViewMode() {
    btnView.addEventListener('click', () => {
        const isHidden = viewMenu.classList.toggle('hidden');
        viewWrap.classList.toggle('open', !isHidden);
        btnView.setAttribute('aria-expanded', String(!isHidden));
    });

    document.addEventListener('click', (e) => {
        if (!viewMenu.classList.contains('hidden') && !viewWrap.contains(e.target)) {
            closeViewMenu();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeViewMenu();
    });

    viewItems.forEach((item) => {
        item.addEventListener('click', () => {
            applyViewMode(item.dataset.view);
            closeViewMenu();
        });
    });

    paneResizer.addEventListener('pointerdown', (e) => {
        if (getCurrentViewMode() !== 'split') return;
        isDraggingResizer = true;
        paneResizer.classList.add('dragging');
        document.body.classList.add('resizing');
        setPanesResizing(true);
        // Đo rect một lần lúc bắt đầu kéo: đọc lại ở mỗi move là ép layout giữa lúc kéo.
        dragRect = workspace.getBoundingClientRect();
        dragAxis = window.matchMedia(VERTICAL_LAYOUT_MQ).matches ? 'y' : 'x';
        pendingSplit = currentSplitPercent();
        pendingViewMode = 'split';
        dragMode = usesGhostDrag(markdownInput.value.length) ? 'ghost' : 'live';
        if (dragMode === 'ghost') showGhost();
        // setPointerCapture có thể ném NotFoundError với pointer giả (automation).
        try {
            paneResizer.setPointerCapture(e.pointerId);
        } catch (err) {
            // Không giữ capture vẫn kéo được, chỉ là PointerEvent đi lạc ngoài resizer.
        }
        e.preventDefault();
    });

    paneResizer.addEventListener('pointermove', (e) => {
        if (!isDraggingResizer) return;
        // Bố cục có thể đổi trục giữa lúc kéo (kéo cửa sổ qua ngưỡng 768px): đo lại rect một lần.
        const axis = window.matchMedia(VERTICAL_LAYOUT_MQ).matches ? 'y' : 'x';
        if (axis !== dragAxis) {
            dragAxis = axis;
            dragRect = workspace.getBoundingClientRect();
            if (dragMode === 'ghost') applyGhostGeometry();
        }
        const size = dragAxis === 'y' ? dragRect.height : dragRect.width;
        if (!(size > 0)) return;
        const point = dragAxis === 'y' ? e.clientY - dragRect.top : e.clientX - dragRect.left;
        // Xét ngưỡng biên theo percent THÔ; clamp trước thì không bao giờ chạm 2%/98%.
        const rawPercent = (point / size) * 100;
        const mode = computeViewModeFromPercent(rawPercent);
        pendingViewMode = mode;
        pendingSplit = computeSplitPercent(point, size);
        if (dragMode === 'ghost') {
            // Pane đứng yên: chỉ thanh ảo đi theo chuột, không ghi --split-size.
            moveGhost(Math.min(100, Math.max(0, rawPercent)));
            return;
        }
        if (mode !== 'split') {
            endResizerDrag();
            applyViewMode(mode);
            return;
        }
        scheduleSplitUpdate();
    });

    paneResizer.addEventListener('pointerup', endResizerDrag);

    paneResizer.addEventListener('pointercancel', endResizerDrag);

    // pointerup có thể rơi ra ngoài resizer khi không giữ được capture: khoá "resizing" treo là app treo.
    window.addEventListener('pointerup', endResizerDrag);

    window.addEventListener('pointercancel', endResizerDrag);

    // Chỉ nhớ chế độ xem, không nhớ vị trí splitter (luôn mở 50/50). Script dùng defer.
    (function initViewModel() {
        let saved = null;
        try {
            saved = localStorage.getItem(VIEW_STORAGE_KEY);
        } catch (e) {
            // Bỏ qua nếu localStorage bị chặn.
        }
        applyViewMode(isValidViewMode(saved) ? saved : DEFAULT_VIEW_MODE, false);
    })();
}
