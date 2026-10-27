// js/ui/about.js — Nút ? cuối toolbar: hộp thoại About và đọc LICENSE / PRIVACY.md / THIRD_PARTY_NOTICES.md.
// Các file nằm trong src/ nên fetch chạy offline ở cả dev lẫn bản cài; tên lấy từ data-doc hardcode
// (không ghép từ input) nên không có path traversal.

import {
    appVersion,
    btnHelp,
    infoAbout,
    infoBackBtn,
    infoBody,
    infoCloseBtn,
    infoDialog,
    infoDoc
} from '../core/dom.js';
import { showToast } from '../core/toast.js';

let dialogReturnFocus = null;

function closeInfoDialog() {
    infoDialog.classList.add('hidden');
    if (dialogReturnFocus && document.contains(dialogReturnFocus)) dialogReturnFocus.focus();
    dialogReturnFocus = null;
}

export function isInfoDialogOpen() {
    return !infoDialog.classList.contains('hidden');
}

// Một modal, hai view: About và tài liệu; .dialog-wide chỉ khi đọc tài liệu dài.
function showAbout() {
    infoDoc.classList.add('hidden');
    infoAbout.classList.remove('hidden');
    infoDialog.querySelector('.dialog').classList.remove('dialog-wide');
}

function openAboutDialog() {
    showAbout();
    dialogReturnFocus = document.activeElement;
    infoDialog.classList.remove('hidden');
    infoCloseBtn.focus();
}

// Nút Back và Esc ở view tài liệu đều lùi về About, dùng chung một hàm.
function backToAbout() {
    showAbout();
    infoCloseBtn.focus();
}

async function showDoc(name) {
    infoAbout.classList.add('hidden');
    infoDoc.classList.remove('hidden');
    infoDialog.querySelector('.dialog').classList.add('dialog-wide');
    infoBody.textContent = 'Loading...';
    infoBackBtn.focus();

    let text;
    try {
        const response = await fetch(name);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        text = await response.text();
    } catch (err) {
        console.error('Could not load ' + name + ':', err);
        infoBody.textContent = 'Could not load ' + name + '.';
        showToast('Could not load ' + name);
        return;
    }

    // Fail-closed như renderMarkdown: thiếu marked/DOMPurify thì hiện text thuần, không đụng innerHTML.
    if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
        infoBody.textContent = text;
        return;
    }
    infoBody.innerHTML = DOMPurify.sanitize(marked.parse(text), {
        USE_PROFILES: { html: true, mathMl: true, svg: true },
        ADD_ATTR: ['target', 'rel'],
        // Khác Mermaid: chỉ nhận URL có scheme. initPreviewLinks() chỉ bind vào previewOutput nên link
        // tương đối trong modal sẽ điều hướng cả WebView; ở đây DOMPurify gỡ href, còn lại text thuần.
        ALLOWED_URI_REGEXP: /^(?:https?|mailto|tel|callto|ftp):/i
    });
}

export function initAbout() {
    // scripts/sync-version.js ghi phiên bản vào <meta name="app-version"> mỗi lần dev/build.
    appVersion.textContent = document.querySelector('meta[name="app-version"]')?.content || '';

    btnHelp.addEventListener('click', openAboutDialog);

    infoAbout.querySelectorAll('.about-item').forEach((item) => {
        item.addEventListener('click', () => {
            showDoc(item.dataset.doc);
        });
    });

    infoBackBtn.addEventListener('click', backToAbout);

    infoCloseBtn.addEventListener('click', closeInfoDialog);

    infoDialog.addEventListener('mousedown', (e) => {
        if (e.target === infoDialog) closeInfoDialog();
    });

    // Esc lùi từng tầng: view tài liệu về About, view About mới đóng. Tab giữ vòng focus trong view.
    infoDialog.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
            e.preventDefault();
            if (infoDoc.classList.contains('hidden')) closeInfoDialog();
            else backToAbout();
        } else if (e.key === 'Tab') {
            e.preventDefault();
            // offsetParent === null là display:none: focus() vào nút ẩn là no-op nên chỉ xét nút đang hiện.
            const focusables = Array.from(infoDialog.querySelectorAll('button'))
                .filter((b) => b.offsetParent !== null);
            const idx = focusables.indexOf(document.activeElement);
            const next = e.shiftKey
                ? focusables[(idx - 1 + focusables.length) % focusables.length]
                : focusables[(idx + 1) % focusables.length];
            if (next) next.focus();
        }
    });
}