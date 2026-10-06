// js/ui/format-toolbar.js — Thanh định dạng: các dropdown (Heading, List, Table, HTML) và nút bấm.

import {
    btnBold,
    btnClear,
    btnCodeBlock,
    btnCodeInline,
    btnHeading,
    btnHtml,
    btnItalic,
    btnList,
    btnMathBlock,
    btnMathInline,
    btnMermaid,
    btnQuote,
    btnRedo,
    btnStrike,
    btnTable,
    btnUndo,
    headingMenu,
    htmlMenu,
    linkDialog,
    listMenu,
    markdownInput,
    tableDialog,
    tableMenu
} from '../core/dom.js';
import { showToast } from '../core/toast.js';
import { applyEditorChange, wrapOrToggleFormat } from '../editor/edit.js';
import {
    applyHeadingLevel,
    applyListStyle,
    insertBlockFence,
    insertTableBlock
} from '../editor/format-actions.js';
import { wrapHtmlTag } from '../editor/format-helpers.js';
import { editorHistory } from '../editor/history.js';
import { saveContentToStorage } from '../editor/storage.js';
import { closeExportMenu } from '../export/menu.js';
import { closeDialogs, openTableDialog } from './dialogs.js';

const formatMenus = [
    { btn: btnHeading, wrap: btnHeading.parentElement, menu: headingMenu },
    { btn: btnList, wrap: btnList.parentElement, menu: listMenu },
    { btn: btnTable, wrap: btnTable.parentElement, menu: tableMenu },
    { btn: btnHtml, wrap: btnHtml.parentElement, menu: htmlMenu }
];

function closeFormatMenus() {
    formatMenus.forEach(({ btn, wrap, menu }) => {
        menu.classList.add('hidden');
        wrap.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
    });
}

function toggleFormatMenu(entry) {
    const wasOpen = !entry.menu.classList.contains('hidden');
    closeExportMenu();
    closeFormatMenus();
    if (!wasOpen) {
        entry.menu.classList.remove('hidden');
        entry.wrap.classList.add('open');
        entry.btn.setAttribute('aria-expanded', 'true');
    }
}

function anyFormatMenuOpen() {
    return formatMenus.some(({ menu }) => !menu.classList.contains('hidden'));
}

// Lưới chọn kích thước bảng: 5x5 ô. Số cột PHẢI khớp grid-template-columns: repeat(5, 22px) ở css/format-bar.css.
const GRID_COLS = 5;
const GRID_ROWS = 5;

// Sáng đúng hình chữ nhật cols x rows của ô đang hover. KHÔNG dùng "i + 1 ô đầu": lưới rộng 5 cột nên
// tiền tố tuyến tính làm cả dòng đầu sáng hết (hover bảng 2 dòng x 3 cột lại hiện 5x3).
// cols = null: tắt sáng toàn bộ (hover ô khác hoặc rời menu).
function highlightTableCells(grid, cols, rows) {
    const cells = grid.querySelectorAll('.table-cell');
    for (let i = 0; i < cells.length; i++) {
        const on = cols !== null && (i % GRID_COLS) < cols && Math.floor(i / GRID_COLS) < rows;
        cells[i].classList.toggle('on', on);
    }
}

export function initFormatToolbar() {
    btnBold.addEventListener('click', () => { wrapOrToggleFormat('**'); markdownInput.focus(); });

    btnItalic.addEventListener('click', () => { wrapOrToggleFormat('*'); markdownInput.focus(); });

    btnStrike.addEventListener('click', () => { wrapOrToggleFormat('~~'); markdownInput.focus(); });

    btnCodeInline.addEventListener('click', () => { wrapOrToggleFormat('`', 'code'); markdownInput.focus(); });

    btnMathInline.addEventListener('click', () => { wrapOrToggleFormat('$', 'E = mc^2'); markdownInput.focus(); });

    btnHtml.addEventListener('click', () => toggleFormatMenu(formatMenus[3]));

    htmlMenu.querySelectorAll('.format-item').forEach((item) => {
        item.addEventListener('click', () => {
            closeFormatMenus();
            markdownInput.focus();
            const r = wrapHtmlTag(markdownInput.value, markdownInput.selectionStart, markdownInput.selectionEnd, item.dataset.html);
            if (r) applyEditorChange(r.text, r.selStart, r.selEnd);
        });
    });

    btnCodeBlock.addEventListener('click', () => { insertBlockFence('code'); markdownInput.focus(); });

    btnMathBlock.addEventListener('click', () => { insertBlockFence('math'); markdownInput.focus(); });

    btnMermaid.addEventListener('click', () => { insertBlockFence('mermaid'); markdownInput.focus(); });

    btnQuote.addEventListener('click', () => { applyListStyle('quote'); markdownInput.focus(); });

    btnUndo.addEventListener('click', () => { editorHistory.undo(markdownInput); markdownInput.focus(); });

    btnRedo.addEventListener('click', () => { editorHistory.redo(markdownInput); markdownInput.focus(); });

    btnClear.addEventListener('click', () => {
        if (!markdownInput.value) {
            markdownInput.focus();
            return;
        }
        applyEditorChange('', 0, 0);
        saveContentToStorage();
        showToast('Editor cleared. Press Ctrl+Z to undo.');
    });

    btnHeading.addEventListener('click', () => toggleFormatMenu(formatMenus[0]));

    headingMenu.querySelectorAll('.format-item').forEach((item) => {
        item.addEventListener('click', () => {
            closeFormatMenus();
            markdownInput.focus();
            applyHeadingLevel(parseInt(item.dataset.heading, 10) || 0);
        });
    });

    btnList.addEventListener('click', () => toggleFormatMenu(formatMenus[1]));

    listMenu.querySelectorAll('.format-item').forEach((item) => {
        item.addEventListener('click', () => {
            closeFormatMenus();
            markdownInput.focus();
            applyListStyle(item.dataset.list);
        });
    });

    btnTable.addEventListener('click', () => toggleFormatMenu(formatMenus[2]));

    (function buildTableGrid() {
        const grid = tableMenu.querySelector('.table-grid');
        for (let i = 0; i < GRID_COLS * GRID_ROWS; i++) {
            const cell = document.createElement('button');
            cell.type = 'button';
            cell.className = 'table-cell';
            const cols = (i % GRID_COLS) + 1;
            const rows = Math.floor(i / GRID_COLS) + 1;
            cell.title = 'Insert table ' + cols + ' × ' + rows;
            cell.setAttribute('aria-label', 'Insert table ' + cols + 'x' + rows);
            cell.addEventListener('mouseenter', () => highlightTableCells(grid, cols, rows));
            cell.addEventListener('click', () => {
                closeFormatMenus();
                markdownInput.focus();
                insertTableBlock(cols, rows);
            });
            grid.appendChild(cell);
        }
        // Ô "Custom size" là nút có nhãn sẵn trong index.html ([data-table="custom"]); không tạo thêm ô
        // trống ở đây vì nó trông y hệt ô kích thước và lại mở hộp thoại chứ không chèn bảng.
        tableMenu.addEventListener('mouseleave', () => highlightTableCells(grid, null));
    })();

    tableMenu.querySelector('[data-table="custom"]').addEventListener('click', () => {
        closeFormatMenus();
        openTableDialog();
    });

    document.addEventListener('click', (e) => {
        if (anyFormatMenuOpen() && !e.target.closest('.format-wrap')) closeFormatMenus();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (anyFormatMenuOpen()) {
            closeFormatMenus();
        } else if (!linkDialog.classList.contains('hidden') || !tableDialog.classList.contains('hidden')) {
            closeDialogs();
        }
    });
}
