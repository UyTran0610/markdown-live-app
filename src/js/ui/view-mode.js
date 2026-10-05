// js/ui/view-mode.js — Chế độ xem Editor / Split / Preview và thanh kéo chia pane.

import { btnView, paneResizer, viewItems, viewMenu, viewWrap, workspace } from '../core/dom.js';

const VIEW_STORAGE_KEY = 'markdown-live-view';

const DEFAULT_VIEW_MODE = 'split';

// Phải khớp @media (max-width: 768px) trong style.css.
const VERTICAL_LAYOUT_MQ = '(max-width: 768px)';

export const SPLIT_MIN_PERCENT = 20;

export const SPLIT_MAX_PERCENT = 80;

const VIEW_EDGE_PREVIEW_PERCENT = 2;

const VIEW_EDGE_EDITOR_PERCENT = 98;

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

function getCurrentViewMode() {
    return document.body.classList.contains('view-editor') ? 'editor'
        : document.body.classList.contains('view-preview') ? 'preview'
        : 'split';
}

function applyViewMode(mode, persist = true) {
    if (mode !== 'editor' && mode !== 'split' && mode !== 'preview') return;
    document.body.classList.toggle('view-editor', mode === 'editor');
    document.body.classList.toggle('view-split', mode === 'split');
    document.body.classList.toggle('view-preview', mode === 'preview');
    viewItems.forEach((item) => {
        item.classList.toggle('active', item.dataset.view === mode);
    });
    if (persist) {
        try {
            localStorage.setItem(VIEW_STORAGE_KEY, mode);
        } catch (e) {
            // Bỏ qua nếu localStorage bị chặn
        }
    }
}

function closeViewMenu() {
    viewMenu.classList.add('hidden');
    viewWrap.classList.remove('open');
    btnView.setAttribute('aria-expanded', 'false');
}

let isDraggingResizer = false;

function endResizerDrag() {
    if (!isDraggingResizer) return;
    isDraggingResizer = false;
    paneResizer.classList.remove('dragging');
    document.body.classList.remove('resizing');
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
        // setPointerCapture có thể ném NotFoundError với pointer giả (automation)
        try {
            paneResizer.setPointerCapture(e.pointerId);
        } catch (err) {
            // Không giữ capture: vẫn kéo được, chỉ là PointerEvent đi lạc ngoài resizer
        }
        e.preventDefault();
    });

    paneResizer.addEventListener('pointermove', (e) => {
        if (!isDraggingResizer) return;
        const rect = workspace.getBoundingClientRect();
        // Chọn trục theo layout hiện tại (dọc khi màn hình nhỏ), kiểm mỗi lần move để kéo vắt qua ngưỡng
        // resize cửa sổ cũng không lỗi.
        const vertical = window.matchMedia(VERTICAL_LAYOUT_MQ).matches;
        const size = vertical ? rect.height : rect.width;
        if (!(size > 0)) return;
        const point = vertical ? e.clientY - rect.top : e.clientX - rect.left;
        // Xét ngưỡng biên theo percent THÔ (chưa clamp); clamp trước thì không bao giờ chạm 2%/98%.
        const rawPercent = (point / size) * 100;
        const mode = computeViewModeFromPercent(rawPercent);
        if (mode !== 'split') {
            endResizerDrag();
            applyViewMode(mode);
            return;
        }
        workspace.style.setProperty('--split-size', computeSplitPercent(point, size) + '%');
    });

    paneResizer.addEventListener('pointerup', endResizerDrag);

    paneResizer.addEventListener('pointercancel', endResizerDrag);

    // Chỉ nhớ chế độ xem, không nhớ vị trí splitter (luôn mở 50/50). Chạy ngay vì script dùng `defer`.
    (function initViewModel() {
        let saved = null;
        try {
            saved = localStorage.getItem(VIEW_STORAGE_KEY);
        } catch (e) {
            // Bỏ qua nếu localStorage bị chặn
        }
        applyViewMode(saved || DEFAULT_VIEW_MODE, false);
    })();
}
