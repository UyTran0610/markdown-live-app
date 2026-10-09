// js/ui/about.js — Nút "?" cuối toolbar: mở LICENSE và THIRD_PARTY_NOTICES.md trong modal.
//
// Hai file nằm trong frontendDist (src/) nên fetch chạy được cả ở dev lẫn bản cài, hoàn toàn offline.
// data-doc chỉ nhận đúng 2 tên hardcode ở index.html, và DOMPurify fail-closed, nên không có
// bề mặt path traversal: tên file lấy thẳng từ data-doc, không ghép từ input người dùng.

import {
    btnHelp,
    helpItems,
    helpMenu,
    helpWrap,
    infoBody,
    infoCloseBtn,
    infoDialog,
    infoDialogTitle
} from '../core/dom.js';
import { showToast } from '../core/toast.js';

let dialogReturnFocus = null;

function closeHelpMenu() {
    helpMenu.classList.add('hidden');
    helpWrap.classList.remove('open');
    btnHelp.setAttribute('aria-expanded', 'false');
}

function closeInfoDialog() {
    infoDialog.classList.add('hidden');
    if (dialogReturnFocus && document.contains(dialogReturnFocus)) dialogReturnFocus.focus();
    dialogReturnFocus = null;
}

export function isInfoDialogOpen() {
    return !infoDialog.classList.contains('hidden');
}

async function showDoc(name, title) {
    closeHelpMenu();
    dialogReturnFocus = document.activeElement;
    infoDialogTitle.textContent = title;
    infoBody.textContent = 'Loading...';
    infoDialog.classList.remove('hidden');
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
    btnHelp.addEventListener('click', () => {
        const isHidden = helpMenu.classList.toggle('hidden');
        helpWrap.classList.toggle('open', !isHidden);
        btnHelp.setAttribute('aria-expanded', String(!isHidden));
    });

    document.addEventListener('click', (e) => {
        if (!helpMenu.classList.contains('hidden') && !helpWrap.contains(e.target)) {
            closeHelpMenu();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (isInfoDialogOpen()) {
            closeInfoDialog();
            return;
        }
        closeHelpMenu();
    });

    helpItems.forEach((item) => {
        item.addEventListener('click', () => {
            showDoc(item.dataset.doc, item.querySelector('span').textContent);
        });
    });

    infoCloseBtn.addEventListener('click', closeInfoDialog);

    infoDialog.addEventListener('mousedown', (e) => {
        if (e.target === infoDialog) closeInfoDialog();
    });

    // Chặn phím lọt xuống editor bên dưới; Esc phải xử lý ở đây vì stopPropagation chặn listener
    // document ở trên (nơi duy nhất xử lý Esc khi focus nằm ngoài dialog). Cùng pattern ui/dialogs.js.
    infoDialog.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
            e.preventDefault();
            closeInfoDialog();
        } else if (e.key === 'Tab') {
            e.preventDefault();
            infoCloseBtn.focus();
        }
    });
}