// js/main.js — Điểm vào của ứng dụng: khởi tạo các module theo đúng thứ tự.

import { runSelfCheck } from './dev/selfcheck.js';
import { initContentActions, loadInitialContent } from './editor/content.js';
import { initEditorEvents } from './editor/events.js';
import { initContentPersistence } from './editor/storage.js';
import { initExportMenu } from './export/menu.js';
import { initImport } from './io/import.js';
import { initPreviewLinks } from './preview/links.js';
import { renderMarkdown } from './preview/render.js';
import { initSanitizer } from './preview/sanitize.js';
import { getCurrentTheme, initTheme } from './theme/theme.js';
import { initDialogs } from './ui/dialogs.js';
import { initFormatToolbar } from './ui/format-toolbar.js';
import { initScrollSync } from './ui/scroll-sync.js';
import { initViewMode } from './ui/view-mode.js';

initSanitizer();
initTheme();
initEditorEvents();
initScrollSync();
initPreviewLinks();
initViewMode();
initContentActions();
initExportMenu();
initFormatToolbar();
initDialogs();
initImport();
initContentPersistence();

if (location.search.includes('selfcheck')) {
    window.addEventListener('DOMContentLoaded', runSelfCheck);
}

window.addEventListener('DOMContentLoaded', () => {
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

        // Guard: lucide không tải được thì bỏ qua vẽ icon, không để exception làm hỏng toàn bộ khởi tạo.
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    } finally {
        // Nạp nội dung CUỐI: renderMarkdown() đầu tiên phải chạy sau khi mermaid initialize và marked gắn
        // KaTeX extension, nếu không công thức ($...$ / $$...$$) lần mở đầu chỉ hiện chữ thô. Đặt trong finally
        // để editor vẫn có nội dung dù khối init bên trên ném lỗi.
        loadInitialContent();
    }
});

window.renderMarkdown = renderMarkdown;
