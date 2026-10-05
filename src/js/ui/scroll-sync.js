// js/ui/scroll-sync.js — Cuộn đồng bộ giữa editor và preview + nút bật / tắt.

import { btnSync, editorHighlight, markdownInput, previewOutput } from '../core/dom.js';
import { showToast } from '../core/toast.js';
import { notifyPreviewScrolled } from '../preview/render.js';

let isSyncScrollEnabled = true;

let activeScrollSource = null;

function handleScroll(source, target) {
    if (!isSyncScrollEnabled || activeScrollSource !== source) return;

    const sourceScrollable = source.scrollHeight - source.clientHeight;
    if (sourceScrollable <= 0) return;

    const targetScrollable = target.scrollHeight - target.clientHeight;
    const scrollPercentage = source.scrollTop / sourceScrollable;
    target.scrollTop = scrollPercentage * Math.max(targetScrollable, 0);
}

// Gộp scroll-sync theo khung hình (rAF) để tránh đọc scrollHeight/scrollTop (ép tính lại layout) trên
// từng sự kiện scroll dồn dập.
let editorScrollTicking = false;

let previewScrollTicking = false;

export function initScrollSync() {
    markdownInput.addEventListener('mouseenter', () => activeScrollSource = markdownInput);

    previewOutput.addEventListener('mouseenter', () => activeScrollSource = previewOutput);

    markdownInput.addEventListener('focus', () => activeScrollSource = markdownInput);

    previewOutput.addEventListener('focus', () => activeScrollSource = previewOutput);

    markdownInput.addEventListener('wheel', () => activeScrollSource = markdownInput, { passive: true });

    previewOutput.addEventListener('wheel', () => activeScrollSource = previewOutput, { passive: true });

    markdownInput.addEventListener('keydown', () => activeScrollSource = markdownInput);

    previewOutput.addEventListener('keydown', () => activeScrollSource = previewOutput);

    markdownInput.addEventListener('touchstart', () => activeScrollSource = markdownInput, { passive: true });

    previewOutput.addEventListener('touchstart', () => activeScrollSource = previewOutput, { passive: true });

    markdownInput.addEventListener('scroll', () => {
        // Lớp tô màu cú pháp phải bám sát tuyệt đối theo pixel nên đồng bộ ngay, không qua rAF
        editorHighlight.scrollTop = markdownInput.scrollTop;
        editorHighlight.scrollLeft = markdownInput.scrollLeft;

        if (editorScrollTicking) return;
        editorScrollTicking = true;
        requestAnimationFrame(() => {
            editorScrollTicking = false;
            handleScroll(markdownInput, previewOutput);
        });
    });

    previewOutput.addEventListener('scroll', () => {
        notifyPreviewScrolled();
        if (previewScrollTicking) return;
        previewScrollTicking = true;
        requestAnimationFrame(() => {
            previewScrollTicking = false;
            handleScroll(previewOutput, markdownInput);
        });
    });

    btnSync.addEventListener('click', () => {
        isSyncScrollEnabled = !isSyncScrollEnabled;
        btnSync.classList.toggle('active', isSyncScrollEnabled);
        // aria theo class .active: nếu không set, màn hình đọc luôn "pressed".
        btnSync.setAttribute('aria-pressed', String(isSyncScrollEnabled));
        showToast(isSyncScrollEnabled ? "Sync scroll enabled" : "Sync scroll disabled");
    });
}
