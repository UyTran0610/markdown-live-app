// js/core/dom.js — Tham chiếu tới các phần tử DOM của ứng dụng (lấy một lần, các module khác import lại).

export const markdownInput = document.getElementById('markdown-input');

export const previewOutput = document.getElementById('preview-output');

export const charCounter = document.getElementById('char-counter');

export const editorHighlight = document.getElementById('editor-highlight');

export const editorHighlightCode = document.getElementById('editor-highlight-code');

export const btnSync = document.getElementById('btn-sync');

export const btnReset = document.getElementById('btn-reset');

export const btnCopy = document.getElementById('btn-copy');

export const btnImport = document.getElementById('btn-import');

export const importFileInput = document.getElementById('import-file');

export const btnExport = document.getElementById('btn-export');

export const exportWrap = document.querySelector('.export-wrap');

export const exportMenu = document.getElementById('export-menu');

export const exportMdBtn = document.getElementById('export-md');

export const exportHtmlBtn = document.getElementById('export-html');

export const exportDocBtn = document.getElementById('export-doc');

export const exportPdfBtn = document.getElementById('export-pdf');

export const btnTheme = document.getElementById('btn-theme');

export const btnHelp = document.getElementById('btn-help');

export const helpWrap = document.querySelector('.help-wrap');

export const helpMenu = document.getElementById('help-menu');

export const helpItems = document.querySelectorAll('.help-item');

export const infoDialog = document.getElementById('info-dialog');

export const infoDialogTitle = document.getElementById('info-dialog-title');

export const infoBody = document.getElementById('info-body');

export const infoCloseBtn = document.getElementById('info-close');

export const toast = document.getElementById('toast');

// Bốn file CSS theme của Preview (2 light + 2 dark), nạp sẵn trong index.html.
// Đổi theme chỉ bật/tắt media của chúng — không fetch, không đổi href.
export const themeCssLinks = Array.from(document.querySelectorAll('link[data-theme-css]'));

export const workspace = document.querySelector('.workspace');

export const paneResizer = document.getElementById('pane-resizer');

export const viewWrap = document.querySelector('.view-wrap');

export const btnView = document.getElementById('btn-view');

export const viewMenu = document.getElementById('view-menu');

export const viewItems = Array.from(document.querySelectorAll('.view-item'));

export const btnHeading = document.getElementById('btn-heading');

export const headingMenu = document.getElementById('heading-menu');

export const btnList = document.getElementById('btn-list');

export const listMenu = document.getElementById('list-menu');

export const btnBold = document.getElementById('btn-bold');

export const btnItalic = document.getElementById('btn-italic');

export const btnStrike = document.getElementById('btn-strike');

export const btnLink = document.getElementById('btn-link');

export const btnUndo = document.getElementById('btn-undo');

export const btnRedo = document.getElementById('btn-redo');

export const btnClear = document.getElementById('btn-clear');

export const btnCodeInline = document.getElementById('btn-code-inline');

export const btnCodeBlock = document.getElementById('btn-code-block');

export const btnHtml = document.getElementById('btn-html');

export const htmlMenu = document.getElementById('html-menu');

export const btnMathInline = document.getElementById('btn-math-inline');

export const btnMathBlock = document.getElementById('btn-math-block');

export const btnQuote = document.getElementById('btn-quote');

export const btnMermaid = document.getElementById('btn-mermaid');

export const btnTable = document.getElementById('btn-table');

export const tableMenu = document.getElementById('table-menu');

export const linkDialog = document.getElementById('link-dialog');

export const linkTextInput = document.getElementById('link-text');

export const linkUrlInput = document.getElementById('link-url');

export const linkInsertBtn = document.getElementById('link-insert');

export const linkCancelBtn = document.getElementById('link-cancel');

export const tableDialog = document.getElementById('table-dialog');

export const tableColsInput = document.getElementById('table-cols');

export const tableRowsInput = document.getElementById('table-rows');

export const tableInsertBtn = document.getElementById('table-insert');

export const tableCancelBtn = document.getElementById('table-cancel');
