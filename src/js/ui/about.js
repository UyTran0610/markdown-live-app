// js/ui/about.js — Nút "?" cuối toolbar: mở hộp thoại About (logo + tên + phiên bản) và
// đọc LICENSE / THIRD_PARTY_NOTICES.md ngay trong hộp đó.
//
// Hai file nằm trong frontendDist (src/) nên fetch chạy được cả ở dev lẫn bản cài, hoàn toàn offline.
// data-doc chỉ nhận đúng 2 tên hardcode ở index.html, và DOMPurify fail-closed, nên không có
// bề mặt path traversal: tên file lấy thẳng từ data-doc, không ghép từ input người dùng.

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

// Một modal duy nhất, hai view: About (mặc định) và tài liệu. .dialog-wide làm modal rộng ra
// khi đọc tài liệu dài; quay lại About thì thu về .dialog mặc định.
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

async function showDoc(name) {
    infoAbout.classList.add('hidden');
    infoDoc.classList.remove('hidden');
    infoDialog.querySelector('.dialog').classList.add('dialog-wide');
    infoBody.textContent = 'Loading...';
    infoCloseBtn.focus();

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

    // Fail-closed y như renderMarkdown: không có marked/DOMPurify thì hiện text thuần, không đụng innerHTML.
    if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
        infoBody.textContent = text;
        return;
    }
    infoBody.innerHTML = DOMPurify.sanitize(marked.parse(text), {
        USE_PROFILES: { html: true, mathMl: true, svg: true },
        ADD_ATTR: ['target', 'rel'],
        // Khác MERMAID_SANITIZE_CONFIG: chỉ nhận URL có scheme. initPreviewLinks() chỉ bind vào
        // previewOutput nên link tương đối trong modal ("[LICENSE](LICENSE)") sẽ điều hướng cả
        // WebView khỏi app; ở đây DOMPurify gỡ href, link còn lại thành text thuần.
        ALLOWED_URI_REGEXP: /^(?:https?|mailto|tel|callto|ftp):/i
    });
}

export function initAbout() {
    // Số phiên bản do scripts/sync-version.js ghi vào <meta name="app-version"> mỗi lần dev/build.
    appVersion.textContent = document.querySelector('meta[name="app-version"]')?.content || '';

    btnHelp.addEventListener('click', openAboutDialog);

    infoAbout.querySelectorAll('.about-item').forEach((item) => {
        item.addEventListener('click', () => {
            showDoc(item.dataset.doc);
        });
    });

    infoBackBtn.addEventListener('click', () => {
        showAbout();
        infoCloseBtn.focus();
    });

    infoCloseBtn.addEventListener('click', closeInfoDialog);

    infoDialog.addEventListener('mousedown', (e) => {
        if (e.target === infoDialog) closeInfoDialog();
    });

    // Chặn phím lọt xuống editor bên dưới; Esc phải xử lý ở đây. Tab giữ vòng focus giữa các nút
    // của view đang mở (About có 2 mục, doc có Back) — cùng pattern ui/dialogs.js.
    infoDialog.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
            e.preventDefault();
            closeInfoDialog();
        } else if (e.key === 'Tab') {
            e.preventDefault();
            // offsetParent === null ⇔ display:none: view ẩn (About / tài liệu) vẫn còn trong DOM,
            // focus() vào nút ẩn là no-op nên vòng focus sẽ kẹt. Chỉ xét nút đang hiện.
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