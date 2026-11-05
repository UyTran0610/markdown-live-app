// js/ui/scroll-sync.js — Cuộn đồng bộ giữa editor và preview + nút bật / tắt.

import { btnSync, previewOutput } from '../core/dom.js';
import { getView } from '../editor/cm.js';
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

// Gộp scroll-sync theo khung hình (rAF) để không đọc scrollHeight/scrollTop mỗi sự kiện scroll.
let editorScrollTicking = false;

let previewScrollTicking = false;

export function initScrollSync() {
    const v = getView();
    if (!v) return;
    // CodeMirror cuộn trong .cm-scroller; sự kiện chuột/bàn phím bám trên .cm-editor.
    const editor = v.dom;
    const scroller = v.scrollDOM;

    editor.addEventListener('mouseenter', () => { activeScrollSource = scroller; });

    previewOutput.addEventListener('mouseenter', () => { activeScrollSource = previewOutput; });

    editor.addEventListener('focus', () => { activeScrollSource = scroller; });

    previewOutput.addEventListener('focus', () => { activeScrollSource = previewOutput; });

    editor.addEventListener('wheel', () => { activeScrollSource = scroller; }, { passive: true });

    previewOutput.addEventListener('wheel', () => { activeScrollSource = previewOutput; }, { passive: true });

    editor.addEventListener('keydown', () => { activeScrollSource = scroller; });

    previewOutput.addEventListener('keydown', () => { activeScrollSource = previewOutput; });

    editor.addEventListener('touchstart', () => { activeScrollSource = scroller; }, { passive: true });

    previewOutput.addEventListener('touchstart', () => { activeScrollSource = previewOutput; }, { passive: true });

    scroller.addEventListener('scroll', () => {
        if (editorScrollTicking) return;
        editorScrollTicking = true;
        requestAnimationFrame(() => {
            editorScrollTicking = false;
            handleScroll(scroller, previewOutput);
        });
    });

    previewOutput.addEventListener('scroll', () => {
        notifyPreviewScrolled();
        if (previewScrollTicking) return;
        previewScrollTicking = true;
        requestAnimationFrame(() => {
            previewScrollTicking = false;
            handleScroll(previewOutput, scroller);
        });
    });

    btnSync.addEventListener('click', () => {
        isSyncScrollEnabled = !isSyncScrollEnabled;
        btnSync.classList.toggle('active', isSyncScrollEnabled);
        // aria theo class .active: không set thì màn hình đọc luôn là pressed.
        btnSync.setAttribute('aria-pressed', String(isSyncScrollEnabled));
    });
}
