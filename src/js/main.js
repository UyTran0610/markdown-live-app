// js/main.js — Điểm vào của ứng dụng: khởi tạo các module theo đúng thứ tự.

import { runPerfCheck } from './dev/perfcheck.js';
import { runSelfCheck } from './dev/selfcheck.js';
import { initContentActions } from './editor/content.js';
import { initEditorEvents } from './editor/events.js';
import { initEditorHighlight } from './editor/highlight.js';
import { initExportMenu } from './export/menu.js';
import { initDocuments, restoreSession } from './io/documents.js';
import { initPreviewLinks } from './preview/links.js';
import { renderMarkdown } from './preview/render.js';
import { initSanitizer } from './preview/sanitize.js';
import { getCurrentTheme, initTheme } from './theme/theme.js';
import { initAbout } from './ui/about.js';
import { initConfirmDialog } from './ui/confirm-dialog.js';
import { initDialogs } from './ui/dialogs.js';
import { initFormatToolbar } from './ui/format-toolbar.js';
import { initPopupMenu } from './ui/popup-menu.js';
import { initScrollSync } from './ui/scroll-sync.js';
import { initStatusBar } from './ui/status-bar.js';
import { initTabMenu } from './ui/tab-menu.js';
import { initTabs } from './ui/tabs.js';
import { initViewMode } from './ui/view-mode.js';
import { initWindowControls } from './ui/window-controls.js';

initSanitizer();
initTheme();
initPopupMenu();
initTabMenu();
initStatusBar();
initConfirmDialog();
initEditorEvents();
initScrollSync();
initEditorHighlight();
initPreviewLinks();
initViewMode();
initWindowControls();
initContentActions();
initExportMenu();
initFormatToolbar();
initDialogs();
initAbout();
initTabs();
initDocuments();

// restoreSession() là async; gán `ready` TRƯỚC await để selfcheck đăng ký sau thấy đúng promise,
// nếu không nó chạy trên editor chưa khôi phục xong.
let ready = Promise.resolve();

window.addEventListener('DOMContentLoaded', async () => {
    try {
        if (typeof mermaid !== 'undefined') {
            mermaid.initialize({ startOnLoad: false, theme: getCurrentTheme() === 'dark' ? 'dark' : 'default' });
        }

        if (typeof markedKatex !== 'undefined' && typeof marked !== 'undefined') {
            const katexExt = typeof markedKatex === 'function' ? markedKatex : markedKatex.markedKatex;
            if (katexExt) {
                marked.use(katexExt({ throwOnError: false }));
            }
        }

        // lucide lỗi thì bỏ qua vẽ icon, không để exception làm hỏng khởi tạo.
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    } finally {
        // Nạp nội dung CUỐI: mermaid.initialize() và marked.use(katex) phải xong trước lần render đầu.
        // Đặt trong finally để editor vẫn có nội dung dù khối init trên ném lỗi.
        ready = restoreSession();
        await ready;
    }
});

// Đăng ký SAU listener trên: self-check phải chạy trên app đã nạp xong, không phải textarea rỗng.
if (location.search.includes('selfcheck')) {
    window.addEventListener('DOMContentLoaded', async () => {
        await ready;
        runSelfCheck();
    });
}

if (location.search.includes('perf')) {
    window.addEventListener('DOMContentLoaded', async () => {
        await ready;
        runPerfCheck();
    });
}

window.renderMarkdown = renderMarkdown;
