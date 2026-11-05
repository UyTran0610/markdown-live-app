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
    tableDialog,
    tableMenu
} from '../core/dom.js';
import { showToast } from '../core/toast.js';
import { focusEditor, getDocText, getView, redo, replaceRange, undo, wrapOrToggleFormat } from '../editor/cm.js';
import {
    applyHeadingLevel,
    applyListStyle,
    insertBlockFence,
    insertTableBlock
} from '../editor/format-actions.js';
import { wrapHtmlTag } from '../editor/format-helpers.js';
import { saveSession } from '../io/documents.js';
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
    // Menu Export/View tự đóng nhờ listener click ở document của chúng (click ở đây nổi bọt lên).
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

// Lưới 5x5; số cột PHẢI khớp grid-template-columns: repeat(5, 22px) ở css/format-bar.css.
const GRID_COLS = 5;
const GRID_ROWS = 5;

// Sáng đúng hình chữ nhật cols x rows; KHÔNG dùng i + 1 ô đầu vì lưới 5 cột sẽ sáng cả dòng đầu.
// cols = null: tắt sáng toàn bộ.
function highlightTableCells(grid, cols, rows) {
    const cells = grid.querySelectorAll('.table-cell');
    for (let i = 0; i < cells.length; i++) {
        const on = cols !== null && (i % GRID_COLS) < cols && Math.floor(i / GRID_COLS) < rows;
        cells[i].classList.toggle('on', on);
    }
}

export function initFormatToolbar() {
    btnBold.addEventListener('click', () => { wrapOrToggleFormat('**'); focusEditor(); });

    btnItalic.addEventListener('click', () => { wrapOrToggleFormat('*'); focusEditor(); });

    btnStrike.addEventListener('click', () => { wrapOrToggleFormat('~~'); focusEditor(); });

    btnCodeInline.addEventListener('click', () => { wrapOrToggleFormat('`', 'code'); focusEditor(); });

    btnMathInline.addEventListener('click', () => { wrapOrToggleFormat('$', 'E = mc^2'); focusEditor(); });

    btnHtml.addEventListener('click', () => toggleFormatMenu(formatMenus[3]));

    htmlMenu.querySelectorAll('.format-item').forEach((item) => {
        item.addEventListener('click', () => {
            closeFormatMenus();
            focusEditor();
            const v = getView();
            const sel = v.state.selection.main;
            const r = wrapHtmlTag(getDocText(), sel.from, sel.to, item.dataset.html);
            if (r) replaceRange(r.from, r.to, r.insert, r.selStart, r.selEnd);
        });
    });

    btnCodeBlock.addEventListener('click', () => { insertBlockFence('code'); focusEditor(); });

    btnMathBlock.addEventListener('click', () => { insertBlockFence('math'); focusEditor(); });

    btnMermaid.addEventListener('click', () => { insertBlockFence('mermaid'); focusEditor(); });

    btnQuote.addEventListener('click', () => { applyListStyle('quote'); focusEditor(); });

    btnUndo.addEventListener('click', () => { undo(getView()); focusEditor(); });

    btnRedo.addEventListener('click', () => { redo(getView()); focusEditor(); });

    btnClear.addEventListener('click', () => {
        const v = getView();
        if (!v.state.doc.length) {
            focusEditor();
            return;
        }
        replaceRange(0, v.state.doc.length, '', 0, 0);
        saveSession();
        showToast('Editor cleared. Press Ctrl+Z to undo.');
    });

    btnHeading.addEventListener('click', () => toggleFormatMenu(formatMenus[0]));

    headingMenu.querySelectorAll('.format-item').forEach((item) => {
        item.addEventListener('click', () => {
            closeFormatMenus();
            focusEditor();
            applyHeadingLevel(parseInt(item.dataset.heading, 10) || 0);
        });
    });

    btnList.addEventListener('click', () => toggleFormatMenu(formatMenus[1]));

    listMenu.querySelectorAll('.format-item').forEach((item) => {
        item.addEventListener('click', () => {
            closeFormatMenus();
            focusEditor();
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
                focusEditor();
                insertTableBlock(cols, rows);
            });
            grid.appendChild(cell);
        }
        // Custom size là nút có nhãn sẵn trong index.html, không tạo ô trống ở đây.
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
