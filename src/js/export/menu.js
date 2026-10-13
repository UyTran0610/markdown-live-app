// js/export/menu.js — Menu thả xuống Export và các nút xuất file (PDF xuất thẳng ở đây; HTML/DOC có module riêng).

import {
    btnExport,
    exportDocBtn,
    exportHtmlBtn,
    exportMenu,
    exportPdfBtn,
    exportWrap
} from '../core/dom.js';
import { showToast } from '../core/toast.js';
import { renderMarkdown, whenMermaidIdle } from '../preview/render.js';
import { exportDoc } from './doc.js';
import { exportHtml } from './html.js';

function closeExportMenu() {
    exportMenu.classList.add('hidden');
    exportWrap.classList.remove('open');
    btnExport.setAttribute('aria-expanded', 'false');
}

// Chống chạy chồng: mỗi lượt xuất chờ Mermaid tới 8s rồi mới mở hộp thoại Save (hoặc window.print), gọi hai
// lần sẽ ra 2 hộp thoại / 2 lần in. ponytail: một cờ chung cho cả 4 nút, nâng cấp sau: xếp hàng lượt thứ 2.
export function makeExclusive(fn) {
    let busy = false;
    return async (...args) => {
        if (busy) return undefined;
        busy = true;
        try {
            return await fn(...args);
        } finally {
            busy = false;
        }
    };
}

// PDF = hộp thoại In của hệ điều hành: render lại và chờ Mermaid + font xong rồi mới window.print().
async function exportPdf() {
    showToast("Preparing the print page / exporting PDF...");
    renderMarkdown();
    try {
        await Promise.all([
            whenMermaidIdle(8000),
            (document.fonts ? document.fonts.ready : Promise.resolve())
        ]);
    } catch (e) {}
    window.print();
}

const exportButtons = [exportHtmlBtn, exportDocBtn, exportPdfBtn];

function setExportDisabled(disabled) {
    exportButtons.forEach((btn) => { btn.disabled = disabled; });
}

// Một wrapper dùng chung cho cả 4 nút: cờ busy phải chung thì mới chặn được chạy chồng, không tạo mới ở mỗi lần
// bấm. Khoá nút trong lúc xuất cũng là phản hồi cho người dùng (một lượt DOC kéo vài giây, bấm hai lần dễ xảy ra).
const runExport = makeExclusive(async (run) => {
    closeExportMenu();
    setExportDisabled(true);
    try {
        await run();
    } finally {
        setExportDisabled(false);
    }
});

export function initExportMenu() {
    // KHÔNG stopPropagation: listener document bên dưới cần thấy click để đóng menu khác (format/view) đang
    // mở; stopPropagation ở đây (và ở btnView) làm hai dropdown mở chồng lên nhau.
    btnExport.addEventListener('click', () => {
        const isHidden = exportMenu.classList.toggle('hidden');
        exportWrap.classList.toggle('open', !isHidden);
        btnExport.setAttribute('aria-expanded', String(!isHidden));
    });

    document.addEventListener('click', (e) => {
        if (!exportMenu.classList.contains('hidden') && !exportWrap.contains(e.target)) {
            closeExportMenu();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeExportMenu();
    });

    exportHtmlBtn.addEventListener('click', () => { runExport(exportHtml); });

    exportDocBtn.addEventListener('click', () => { runExport(exportDoc); });

    exportPdfBtn.addEventListener('click', () => { runExport(exportPdf); });
}
