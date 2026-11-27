// js/dev/selfcheck.js — Self-check nhanh, mở app với ?selfcheck.

import { btnTheme, charCounter, confirmCancelBtn, confirmDialog, confirmPrimaryBtn, confirmSecondaryBtn, findInput, findRegex, infoAbout, infoBody, infoDialog, infoDoc, lineCounter, previewOutput, replaceInput, tableMenu, toast, wordCounter } from '../core/dom.js';
import { showToast, toastDuration } from '../core/toast.js';
import { countWords, isSafeExternalUrl, slugifyText } from '../core/utils.js';
import {
    EditorView,
    getDocText,
    getView,
    handleTypedChar,
    redo,
    setChangeHandler,
    undo,
    wrapOrToggleFormat
} from '../editor/cm.js';
import {
    closeFindDialog,
    findMatches,
    findNextMatch,
    getFindActiveIndex,
    getFindMatches,
    isFindDialogOpen,
    openFindDialog,
    replaceFindAll,
    replaceFindCurrent,
    runFindSearch
} from '../editor/find.js';
import { applyHeadingLevel, applyListStyle, insertBlockFence, insertTableBlock } from '../editor/format-actions.js';
import {
    buildBlockFence,
    buildTableMarkdown,
    escapeLinkText,
    getHeadingLevel,
    normalizeLinkUrl,
    parseListLine,
    setHeadingLevel,
    wrapHtmlTag
} from '../editor/format-helpers.js';
import { handleEditorChange, renderDelayFor } from '../editor/sync.js';
import { convertQuotesForDoc, styleDataTablesForDoc } from '../export/doc-transform.js';
import { buildWordHtml } from '../export/doc.js';
import { buildDocxModel, buildDocxPackage } from '../export/docx-build.js';
import { mathmlToOmml } from '../export/docx-math.js';
import { createZip, crc32 } from '../export/docx-zip.js';
import { buildDocumentRelsXml, buildDocumentXml, buildNumberingXml, buildStylesXml, CONTENT_WIDTH_TWIP, escapeXml } from '../export/docx-xml.js';
import { applyEol, decodeTextBytes, deriveDocumentTitle, deriveExportBaseName, detectBom, detectEol, hashText, mtimeOf, readErrorMessage, readTextFile, sameFilePath, saveBinaryFile, saveTextFile, stripBom, toLf, writeTextFile } from '../export/file-save.js';
import { buildStandaloneHtml } from '../export/html.js';
import { fitDocImageSize, flattenForeignObjects, isSvgImageSrc } from '../export/images.js';
import { katexFontKey, parseKatexFontFaces } from '../export/math-fonts.js';
import { convertKatexForDoc } from '../export/math-mathml.js';
import { makeExclusive } from '../export/menu.js';
import { closeTab, getActiveTab, getTabs, isTabDirty, isMarkdownPath, deserializeSession, diskRevision, needsSave, newTab, saveTab, serializeSession, sessionKeepsContent, setTabReadOnly, suggestSavePath, switchTab, tabText, untitledName } from '../io/documents.js';
import { sessionFingerprint } from '../io/session-store.js';
import { escapeHtml } from '../ui/confirm-dialog.js';
import { assignHeadingIds, blockFingerprint, flushLazyRenders, PREVIEW_MAX_CHARS, renderMarkdown, snapshotPreviewBlocks, whenMermaidIdle } from '../preview/render.js';
import { diffBlocks, findBlockHtml, resetBlocks, storeBlockHtml } from '../preview/blocks.js';
import { mermaidCache } from '../preview/mermaid-cache.js';
import { MERMAID_SANITIZE_CONFIG } from '../preview/sanitize.js';
import { isInfoDialogOpen } from '../ui/about.js';
import { dropIndex, disambiguateTabName, tabScrollState } from '../ui/tabs.js';
import {
    GHOST_DRAG_MIN_CHARS,
    SPLIT_MAX_PERCENT,
    SPLIT_MIN_PERCENT,
    computeSplitPercent,
    computeViewModeFromPercent,
    ghostOffsetPx,
    isValidViewMode,
    usesGhostDrag
} from '../ui/view-mode.js';

// fs giả cho các mục data safety: Map path -> { bytes, mtime } + log mọi lệnh ghi/xoá.
// forbidWrite = lỗi ACL (được phép ghi thẳng), failWrite = lỗi I/O (KHÔNG được ghi thẳng).
function makeFakeFs() {
    const disk = new Map();
    const log = [];
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    let clock = 1700000000000;
    const api = {
        disk,
        log,
        forbidWrite: new Set(),
        failWrite: new Set(),
        allowTemp: true,
        put(path, text) { disk.set(path, { bytes: enc.encode(text), mtime: clock }); },
        read(path) { const f = disk.get(path); return f ? dec.decode(f.bytes) : null; },
        wroteTo(path) { return log.some((c) => c[0] === 'write' && c[1] === path); },
        fs: {
            readFile: async (path) => {
                const f = disk.get(path);
                if (!f) throw new Error('file not found: ' + path);
                return f.bytes;
            },
            writeTextFile: async (path, contents) => {
                log.push(['write', path]);
                if (api.forbidWrite.has(path)) throw new Error('forbidden path: ' + path);
                if (api.failWrite.has(path)) throw new Error('disk full');
                disk.set(path, { bytes: enc.encode(contents), mtime: ++clock });
            },
            rename: async (from, to) => {
                log.push(['rename', from, to]);
                const f = disk.get(from);
                if (!f) throw new Error('file is locked');
                disk.delete(from);
                disk.set(to, f);
            },
            remove: async (path) => { log.push(['remove', path]); disk.delete(path); },
            stat: async (path) => {
                const f = disk.get(path);
                if (!f) throw new Error('not found: ' + path);
                return { mtime: new Date(f.mtime) };
            }
        }
    };
    return api;
}

// Cài window.__TAURI__ giả; trả về hàm khôi phục bản cũ.
// ok=false nghĩa là không gán được (app thật giữ global): tuyệt đối không chạy test ghi file thật.
function stubTauri(fake, { savePath = null } = {}) {
    const real = window.__TAURI__;
    const stub = {
        core: { invoke: async (cmd) => (cmd === 'allow_temp_sibling' ? fake.allowTemp : true) },
        fs: fake.fs,
        dialog: { save: async () => (typeof savePath === 'function' ? savePath() : savePath) }
    };
    let ok = false;
    try {
        window.__TAURI__ = stub;
        ok = window.__TAURI__ === stub && window.__TAURI__.fs === fake.fs;
    } catch (e) {
        ok = false;
    }
    return {
        ok,
        restore: () => {
            try { window.__TAURI__ = real; } catch (e) { /* app giữ global: không khôi phục được */ }
        }
    };
}

// Bấm nút trong hộp thoại xác nhận (primary/secondary/cancel) sau khi hộp thoại mở.
async function clickConfirm(action) {
    for (let i = 0; i < 100; i++) {
        if (!confirmDialog.classList.contains('hidden')) break;
        await new Promise((r) => setTimeout(r, 10));
    }
    if (confirmDialog.classList.contains('hidden')) throw new Error('confirm dialog did not open');
    const btn = action === 'cancel'
        ? confirmCancelBtn
        : (action === 'secondary' ? confirmSecondaryBtn : confirmPrimaryBtn);
    btn.click();
}

// Promise có giới hạn thời gian: hộp thoại không mở thì phải FAIL chứ không treo cả self-check.
function withTimeout(promise, ms = 4000) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timed out waiting for the app')), ms))
    ]);
}

// Gửi kết quả cho runner (scripts/run-selfcheck.js). Trình duyệt ẩn chụp DOM trước khi
// app chạy xong nên runner không đọc được DOM; POST là kênh chắc chắn tới.
function postSelfCheckResult(summary, failures) {
    try {
        fetch('/__selfcheck', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ summary, failures })
        }).catch(() => {});
    } catch (err) {
        // Không có runner (mở app bằng tay): bỏ qua.
    }
}

export async function runSelfCheck() {
    const results = [];
    const assert = (name, cond) => results.push(`${cond ? 'PASS' : 'FAIL'} - ${name}`);

    // Guard không chạy được phải ghi SKIP, nếu không vendor hỏng vẫn ra PASS và giấu assert chưa chạy.
    const skip = (name, why) => results.push(`SKIP - ${name} (${why})`);

    // Mỗi khối trong section(): một khối ném lỗi thành 1 dòng FAIL thay vì mất cả báo cáo.
    const section = async (name, fn) => {
        try {
            await fn();
        } catch (err) {
            console.error(`Self-check section "${name}" threw:`, err);
            results.push(`FAIL - ${name}: threw ${err && err.message ? err.message : err}`);
        }
    };

    // Chạy trên app thật nên phải trả lại nội dung, vùng chọn, scroll và lịch sử Undo sau khi xong.
    const view = getView();
    const docText = () => view.state.doc.toString();
    const snap = {
        value: docText(),
        selStart: view.state.selection.main.from,
        selEnd: view.state.selection.main.to,
        scrollTop: view.scrollDOM.scrollTop,
        previewScrollTop: previewOutput.scrollTop
    };

    // Tắt đồng bộ của app trong lúc thử: nội dung thử không được lọt vào tab/phiên.
    setChangeHandler(null);

    // Đặt nội dung thử trong editor (thay cả doc rồi đặt con trỏ).
    const probe = (text, from = 0, to = from) => {
        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: text },
            selection: { anchor: from, head: to },
            userEvent: 'input'
        });
    };

    try {

        assert('filename from heading with diacritics', deriveExportBaseName('# Trình soạn thảo Markdown Live\n\nnội dung') === 'trinh-soan-thao-markdown-live');
        assert('filename strips special characters', deriveExportBaseName('# Tiêu đề (v1.2)!') === 'tieu-de-v12');
        assert('filename fallback when no heading', deriveExportBaseName('không có heading') === 'document');
        assert('filename keeps Japanese H1', deriveExportBaseName('# 季度報告書') === '季度報告書');
        assert('filename keeps Russian H1', deriveExportBaseName('# Отчёт за Q3') === 'отчёт-за-q3');
        assert('filename drops characters forbidden in file names', deriveExportBaseName('# a/b:c*d?e"f<g>h|i') === 'abcdefghi');
        assert('filename ignores heading inside code fence', deriveExportBaseName('```md\n# comment\n```\n\n# Real Title') === 'real-title');

        // Tin dài (đường dẫn file .md-live.tmp) phải còn trên màn hình đủ lâu để đọc.
        assert('a short toast keeps the 2.5s minimum', toastDuration('Saved') === 2500);
        assert('a long toast stays up about 60ms per character', toastDuration('x'.repeat(200)) === 12000);
        assert('a very long toast is capped', toastDuration('x'.repeat(2000)) === 25000);

        // EOL: file Windows là CRLF, textarea là LF; nhớ kiểu file để lần lưu không đổi mọi dòng.
        assert('eol detects a CRLF file', detectEol('a\r\nb') === '\r\n');
        assert('eol detects an LF file', detectEol('a\nb') === '\n');
        assert('eol detects a single-line file', detectEol('abc') === '\n');
        // File trộn lẫn: lấy kiểu ĐÔNG HƠN, không phải "thấy CRLF là CRLF".
        assert('eol follows the majority style of a mixed file', detectEol('a\nb\nc\r\n') === '\n');
        assert('eol keeps CRLF when CRLF is the majority', detectEol('a\r\nb\r\nc\n') === '\r\n');
        assert('eol normalizes CRLF and lone CR to LF', toLf('a\r\nb\rc') === 'a\nb\nc');
        assert('eol writes back the file CRLF', applyEol('a\nb', '\r\n') === 'a\r\nb');
        assert('eol keeps LF as-is', applyEol('a\nb', '\n') === 'a\nb');
        // BOM trước # làm mất heading đầu và tiêu đề export.
        assert('bom detects a file with BOM', detectBom('\uFEFF# A') === true);
        assert('bom plain file', detectBom('# A') === false);
        assert('bom empty file', detectBom('') === false);
        assert('bom strips the leading marker', stripBom('\uFEFF# A') === '# A');
        assert('bom keeps a file without BOM unchanged', stripBom('# A') === '# A');
        assert('bom removed makes the first line a heading again', deriveDocumentTitle(stripBom('\uFEFF# A\nx')) === 'A');
        // Cùng một file không được mở thành hai tab (hai tab ghi đè nhau).
        assert('Windows path ignores case and slash direction', sameFilePath('C:\\Docs\\A.md', 'c:/docs/a.md') === true);
        assert('paths in different folders stay different files', sameFilePath('/x/a.md', '/y/a.md') === false);
        assert('missing path does not match', sameFilePath(null, '/x/a.md') === false);
        // Đường dẫn tương đối (không có separator): cắt chuỗi sẽ ra rác kiểu "a.m/a.md".
        assert('relative save path does not cut the folder', suggestSavePath({ path: 'a.md', name: 'a.md' }, '') === 'a.md');
        assert('windows save path keeps the folder', suggestSavePath({ path: 'C:\\d\\a.md', name: 'a.md' }, '') === 'C:\\d\\a.md');
        // EOL đổi thì phải ghi được dù nội dung không đổi, không thì status bar nói dối.
        assert('clean tab, matching EOL -> no save needed', needsSave({ content: 'x', savedContent: 'x', eol: '\n', diskEol: '\n' }) === false);
        assert('clean tab, different EOL -> must save', needsSave({ content: 'y', savedContent: 'y', eol: '\r\n', diskEol: '\n' }) === true);
        assert('read error: ACL reason is explicit', readErrorMessage(new Error('forbidden path: C:\\x\\a.md')).includes('Could not read that file'));

        await section('block #1', async () => {
            const noOverflow = tabScrollState(400, 400, 0);
            assert('tab not overflowing -> no fade, no scroll buttons', !noOverflow.canScroll && !noOverflow.left && !noOverflow.right);
            const mid = tabScrollState(1000, 400, 100);
            assert('tab overflowing mid-way -> fade + buttons on both edges', mid.canScroll && mid.left && mid.right);
            const end = tabScrollState(1000, 400, 600);
            assert('tab scrolled fully right -> right button hidden', end.canScroll && end.left && !end.right);
        });

        await section('block #2', async () => {
            const rects = [{ left: 0, width: 100 }, { left: 100, width: 100 }, { left: 200, width: 100 }];
            assert('drag left of mid edge -> insert first', dropIndex(rects, 40) === 0);
            assert('drag right of mid edge -> insert after', dropIndex(rects, 60) === 1);
            assert('drag past right edge -> insert last', dropIndex(rects, 900) === 3);
            assert('no tabs left -> insert last', dropIndex([], 120) === 0);
        });

        assert('split clamps below threshold', computeSplitPercent(-50, 1000) === SPLIT_MIN_PERCENT);
        assert('split clamps above threshold', computeSplitPercent(9999, 1000) === SPLIT_MAX_PERCENT);
        assert('split in the middle of the range', computeSplitPercent(500, 1000) === 50);
        assert('split empty workspace -> 50', computeSplitPercent(10, 0) === 50);
        assert('drag to far left -> preview', computeViewModeFromPercent(1) === 'preview');
        assert('drag to far right -> editor', computeViewModeFromPercent(99) === 'editor');
        assert('drag to middle -> split', computeViewModeFromPercent(50) === 'split');
        assert('invalid view mode rejected', isValidViewMode('abc') === false && isValidViewMode('') === false);
        assert('valid view mode accepted', isValidViewMode('editor') && isValidViewMode('split') && isValidViewMode('preview'));

        // Kéo thanh chia: ngưỡng ghost, vị trí thanh ảo, cờ đang kéo pane.
        assert('small document drags live', usesGhostDrag(GHOST_DRAG_MIN_CHARS) === false);
        assert('large document drags with ghost bar', usesGhostDrag(GHOST_DRAG_MIN_CHARS + 1) === true);
        assert('ghost threshold is 100k characters', GHOST_DRAG_MIN_CHARS === 100000);
        assert('ghost bar mid-range -> offset by half the width', ghostOffsetPx(50, 1000) === 499);
        assert('ghost bar at left edge -> negative half-thickness offset', ghostOffsetPx(0, 1000) === -1);

        // Render preview phải giãn debounce theo độ dài: tài liệu lớn render chậm hơn nhiều,
        // chạy giữa lúc gõ sẽ cướp main thread.
        assert('small file render waits 300ms', renderDelayFor(0) === 300);
        assert('99k file render waits 300ms', renderDelayFor(99000) === 300);
        assert('100k file render waits 350ms', renderDelayFor(100000) === 350);
        assert('200k file render waits 400ms', renderDelayFor(200000) === 400);
        assert('400k file render waits 500ms', renderDelayFor(400000) === 500);
        assert('very large file render stays under 600ms', renderDelayFor(5000000) === 600);

        assert('safe url allows https', isSafeExternalUrl('https://example.com/a?b=1') === true);
        assert('safe url allows mailto', isSafeExternalUrl('mailto:a@b.com') === true);
        assert('safe url blocks ftp (opener ACL rejects it)', isSafeExternalUrl('ftp://host/f.md') === false);
        assert('safe url blocks javascript', isSafeExternalUrl('javascript:alert(1)') === false);
        assert('safe url blocks padded data', isSafeExternalUrl('  DATA:text/html,<h1>x</h1>') === false);
        assert('safe url blocks relative', isSafeExternalUrl('/local/path') === false);
        if (typeof DOMPurify !== 'undefined') {
            const probe = DOMPurify.sanitize(
                '<svg><foreignObject><div>probe-label</div></foreignObject></svg>',
                MERMAID_SANITIZE_CONFIG
            );
            assert('sanitize keeps mermaid labels', probe.includes('probe-label'));
        } else {
            skip('sanitize keeps mermaid labels', 'DOMPurify not loaded');
        }
        assert('open gate allows md', isMarkdownPath('a.md') === true);
        assert('open gate allows mdown', isMarkdownPath('/x/y/a.mdown') === true);
        assert('open gate allows mkd', isMarkdownPath('C:\\docs\\a.mkd') === true);
        // File không đuôi vẫn là văn bản; danh sách đuôi là ranh giới duy nhất chặn file nhị phân.
        assert('open gate allows extensionless', isMarkdownPath('/x/README') === true);
        assert('open gate allows mdx', isMarkdownPath('notes.mdx') === true);
        assert('open gate allows txt', isMarkdownPath('notes.txt') === true);
        assert('open gate rejects png', isMarkdownPath('a.png') === false);
        assert('open gate rejects exe', isMarkdownPath('a.exe') === false);
        assert('open gate rejects a duplicate extension in the name', isMarkdownPath('a.md.exe') === false);

        // Session round-trip: giữ tab + tab đang mở + quy tắc chưa lưu.
        await section('block #3', async () => {
            // Đúng shape serializeSession(): history không lưu, dirty là boolean.
            const wire = (id, path, name, content, savedContent, eol = '\n', bom = false) => ({
                id, path, name, content, eol, bom, dirty: isTabDirty({ content, savedContent }), scrollTop: 0, selStart: 0, selEnd: 0
            });
            assert('tab clean when content matches savedContent', isTabDirty({ content: '# A', savedContent: '# A' }) === false);
            assert('tab dirty when content differs from savedContent', isTabDirty({ content: '# B2', savedContent: '# B' }) === true);
            assert('never-saved tab is always dirty', isTabDirty({ content: 'x', savedContent: null }) === true);

            const back = deserializeSession(JSON.stringify({
                activeId: 2,
                tabs: [wire(1, '/a.md', 'a.md', '# A', '# A'), wire(2, '/b.md', 'b.md', '# B2', '# B'), wire(3, null, 'Untitled', 'x', null)]
            }));
            assert('session keeps the tab count', back.tabs.length === 3);
            assert('session keeps the active tab', back.activeId === 2);
            assert('session keeps content', back.tabs[1].content === '# B2');
            assert('session keeps the path', back.tabs[0].path === '/a.md');
            assert('clean tab at close stays clean after reopen', isTabDirty(back.tabs[0]) === false);
            assert('edited tab at close stays dirty after reopen', isTabDirty(back.tabs[1]) === true);
            assert('never-saved tab stays dirty after reopen', isTabDirty(back.tabs[2]) === true);

            // Tab có content không đọc lại đĩa; mất eol là Ctrl+S ghi đè CRLF bằng LF.
            const crlf = deserializeSession(JSON.stringify({ activeId: 1, tabs: [wire(1, 'C:\\a.md', 'a.md', '# A', '# A', '\r\n')] }));
            assert('session keeps CRLF line endings', crlf.tabs[0].eol === '\r\n');
            assert('session missing eol -> defaults to LF', back.tabs[0].eol === '\n');

            // BOM cũng phải sống cùng session, nếu không file gốc mất BOM ở lần lưu sau.
            const bomBack = deserializeSession(JSON.stringify({ activeId: 1, tabs: [wire(1, 'C:\\a.md', 'a.md', '# A', '# A', '\n', true)] }));
            assert('session keeps the BOM flag', bomBack.tabs[0].bom === true);
            assert('session missing bom -> defaults to no BOM', back.tabs[0].bom === false);
            // Encoding cũng phải sống cùng session, nếu không status bar báo sai sau khi mở lại.
            const encBack = deserializeSession(JSON.stringify({ activeId: 1, tabs: [{ ...wire(1, 'C:\\a.md', 'a.md', '# A', '# A'), encoding: 'UTF-16LE' }] }));
            assert('session keeps the encoding', encBack.tabs[0].encoding === 'UTF-16LE');
            assert('session missing encoding -> defaults to UTF-8', back.tabs[0].encoding === 'UTF-8');

            // Session cũ còn BOM trong content: bỏ BOM ở cả content và savedContent để tab vẫn sạch.
            const legacyBom = deserializeSession(JSON.stringify({ activeId: 1, tabs: [wire(1, '/a.md', 'a.md', '\uFEFF# A', '\uFEFF# A')] }));
            assert('old session with BOM -> stripped on restore', legacyBom.tabs[0].content === '# A');
            assert('tab stays clean after the BOM strip', isTabDirty(legacyBom.tabs[0]) === false);

            // content = null + path -> khôi phục đọc lại từ đĩa.
            assert('clean tab with path does not keep content', sessionKeepsContent({ path: '/a.md', content: 'x', savedContent: 'x' }) === false);
            assert('dirty tab with path still keeps content', sessionKeepsContent({ path: '/a.md', content: 'y', savedContent: 'x' }) === true);
            assert('tab without a path always keeps content', sessionKeepsContent({ path: null, content: '', savedContent: '' }) === true);
            // Thoát bằng "Don't save": bỏ bản nháp, tab file đọc lại đĩa, tab Untitled thành rỗng.
            assert('quit without saving -> file tab keeps no content', sessionKeepsContent({ path: '/a.md', content: 'y', savedContent: 'x' }, true) === false);
            assert('quit without saving -> Untitled tab keeps no content', sessionKeepsContent({ path: null, content: 'x', savedContent: '' }, true) === false);
            const discardedDraft = deserializeSession(JSON.stringify({
                activeId: 1, tabs: [{ id: 1, path: null, name: 'Untitled 1', content: null, dirty: false, eol: '\n', bom: false }]
            }));
            assert('quit without saving -> Untitled tab reopens empty and clean', discardedDraft.tabs[0].content === '' && isTabDirty(discardedDraft.tabs[0]) === false);
            const noContent = deserializeSession(JSON.stringify({
                activeId: 1, tabs: [{ id: 1, path: '/a.md', name: 'a.md', content: null, dirty: false, eol: '\n', bom: false }]
            }));
            assert('session content null + path -> marks a disk reload', noContent.tabs[0].reload === true);
            assert('tab pending a disk reload has no content yet', noContent.tabs[0].content === '' && isTabDirty(noContent.tabs[0]) === false);
            assert('session with content -> no disk reload (old session compatible)', back.tabs[0].reload === false);

            assert('session without tabs -> null instead of a crash', deserializeSession('{"tabs":[]}') === null);
            assert('empty session -> null', deserializeSession('null') === null);
            assert('broken session JSON -> deserializeSession throws (restoreSession catches it and builds a new session)', (() => {
                try { deserializeSession('{khong phai json'); return false; } catch (e) { return true; }
            })());
            assert('session missing name/path -> fills defaults', (() => {
                const r = deserializeSession(JSON.stringify({ activeId: 99, tabs: [{ content: 'y' }] }));
                return r.activeId === 99 && r.tabs[0].name === 'Untitled' && r.tabs[0].path === null;
            })());

            // Id hỏng làm nextId = NaN; id trùng làm hai tab nhận lệnh của nhau.
            const badIds = deserializeSession(JSON.stringify({
                tabs: [{ id: 'abc', content: 'a' }, { id: 5, content: 'b' }, { id: 5, content: 'c' }, { id: -3, content: 'd' }, { id: 2.5, content: 'e' }]
            }));
            assert('broken / duplicate / negative / fractional ids are reassigned',
                badIds.tabs.every((t) => Number.isSafeInteger(t.id) && t.id > 0)
                && new Set(badIds.tabs.map((t) => t.id)).size === badIds.tabs.length);
            assert('valid id stays as-is', deserializeSession(JSON.stringify({ tabs: [{ id: 9, content: 'a' }] })).tabs[0].id === 9);

            // Tab chưa có path: mốc đã lưu là '', không phải null (null = luôn dirty).
            const draft = deserializeSession(JSON.stringify({ activeId: 1, tabs: [{ id: 1, path: null, name: 'Untitled', content: '', dirty: true }] }));
            assert('tab without a path + dirty -> empty baseline, not null', draft.tabs[0].savedContent === '');
            assert('tab without a path and emptied -> no prompt on close', isTabDirty(draft.tabs[0]) === false);
            const dirtyPath = deserializeSession(JSON.stringify({ activeId: 1, tabs: [{ id: 1, path: '/a.md', name: 'a.md', content: 'x', dirty: true }] }));
            assert('tab with a path + dirty -> savedContent null (blocks overwriting with empty content)', dirtyPath.tabs[0].savedContent === null);

            // status phải sống cùng session: chốt duy nhất chặn Ctrl+S ghi đè file thật bằng bản rỗng.
            const st = deserializeSession(JSON.stringify({ activeId: 1, tabs: [{ id: 1, path: '/a.md', name: 'a.md', content: '', dirty: true, status: 'unreadable', diskMtime: 1712345678901 }] }));
            assert('session keeps the error status', st.tabs[0].status === 'unreadable');
            assert('session keeps the disk mtime', st.tabs[0].diskMtime === 1712345678901);
            const stBad = deserializeSession(JSON.stringify({ activeId: 1, tabs: [{ id: 1, path: '/a.md', name: 'a.md', content: 'x', status: 'bogus', diskMtime: 'x' }] }));
            assert('unknown status -> ok, unknown mtime -> null', stBad.tabs[0].status === 'ok' && stBad.tabs[0].diskMtime === null);
            assert('mtimeOf accepts a Date and a number', mtimeOf({ mtime: new Date(1712345678901) }) === 1712345678901 && mtimeOf({ mtime: 1712345678901 }) === 1712345678901);
            assert('mtimeOf missing mtime -> null', mtimeOf(null) === null && mtimeOf({}) === null);

            // 'unknown' phải im lặng, nếu không mỗi Ctrl+S là một hộp thoại vô nghĩa.
            assert('failed stat -> file is gone', diskRevision(null, 1000) === 'gone');
            assert('mtime matches -> no prompt', diskRevision({ mtime: 1000 }, 1000) === 'same');
            assert('mtime differs -> prompt', diskRevision({ mtime: 2000 }, 1000) === 'changed');
            assert('no baseline yet -> stay silent, no prompt', diskRevision({ mtime: 2000 }, null) === 'unknown');
            assert('mtime unreadable -> stay silent', diskRevision({}, 1000) === 'unknown');

            // Chỉ còn hash+len: gõ lại đúng nội dung gốc thì tab hết dirty.
            assert('hashText is stable', hashText('abc') === hashText('abc'));
            assert('hashText distinguishes content', hashText('abc') !== hashText('abd'));
            const reverted = deserializeSession(JSON.stringify({
                activeId: 1,
                tabs: [{
                    id: 1, path: '/a.md', name: 'a.md', content: '# A', dirty: true,
                    savedHash: hashText('# A'), savedLen: '# A'.length, status: 'ok'
                }]
            }));
            assert('restored dirty tab: retyping the original text -> clean', isTabDirty(reverted.tabs[0]) === false);
            assert('restored dirty tab: editing one character -> still unsaved', isTabDirty({ ...reverted.tabs[0], content: '# A ' }) === true);
            assert('matching hash but different length -> unsaved', isTabDirty({ content: 'x', savedContent: null, savedHash: hashText('x'), savedLen: 99 }) === true);
            assert('restored dirty tab: no hash -> still unsaved', isTabDirty({ content: 'x', savedContent: null, savedHash: null, savedLen: null }) === true);

            // Tab lỗi phải đọc lại ở lần sau, kể cả khi có bản nháp: đọc hỏng không được thành tab rỗng vĩnh viễn.
            const broken = deserializeSession(JSON.stringify({
                activeId: 1,
                tabs: [{ id: 1, path: '/a.md', name: 'a.md', content: 'draft', dirty: true, status: 'unreadable', reload: true }]
            }));
            assert('error tab reloads from disk on the next run', broken.tabs[0].reload === true);
            assert('error tab keeps the draft', broken.tabs[0].content === 'draft');
            assert('error tab does not claim to be saved', isTabDirty(broken.tabs[0]) === true);
            // serializeSession() chạy trên tab thật: cờ reload phải khớp status của từng tab.
            // Nhánh tab lỗi được thử thật ở mục 'data safety' (tab status !== 'ok').
            const liveWire = serializeSession();
            assert('serializeSession flags reload exactly for the error tabs',
                liveWire.tabs.every((t) => t.reload === (t.status !== 'ok')));
            assert('serializeSession keeps the default EOL', liveWire.defaultEol === '\n' || liveWire.defaultEol === '\r\n');
            const discardWire = serializeSession({ discardUnsaved: true });
            assert('serializeSession drops every draft when quitting without saving',
                discardWire.tabs.every((t) => t.content === null && t.dirty === false && t.savedHash === null && t.savedLen === null));
            // Fingerprint phải phủ MỌI key của record, bỏ sót là ghi phiên cũ và mất dữ liệu im lặng.
            const fpTab = { id: 1, path: '/a.md', name: 'a.md', content: 'hello', dirty: true, scrollTop: 0 };
            assert('session fingerprint: unchanged record -> identical', sessionFingerprint(fpTab) === sessionFingerprint({ ...fpTab }));
            assert('session fingerprint: same length, different text -> different', sessionFingerprint(fpTab) !== sessionFingerprint({ ...fpTab, content: 'world' }));
            assert('session fingerprint: scroll position changed -> different', sessionFingerprint(fpTab) !== sessionFingerprint({ ...fpTab, scrollTop: 9 }));
            assert('session fingerprint: content null (clean tab) -> different', sessionFingerprint(fpTab) !== sessionFingerprint({ ...fpTab, content: null }));
            assert('session fingerprint: a newly added field counts too', sessionFingerprint(fpTab) !== sessionFingerprint({ ...fpTab, somethingNew: 1 }));

            // Tab chưa lưu: cấp số Untitled nhỏ nhất còn trống.
            assert('Untitled numbering starts at 1', untitledName([]) === 'Untitled 1');
            assert('Untitled skips used numbers', untitledName([{ name: 'Untitled 1' }, { name: 'Untitled 2' }]) === 'Untitled 3');

            // Save As giữ đuôi và đúng thư mục của tab (.txt không thành .md).
            assert('Save As keeps the .txt extension', suggestSavePath({ path: 'C:\\docs\\note.txt', name: 'note.txt' }, 'x') === 'C:\\docs\\note.txt');
            assert('Save As on an unsaved tab takes the name from H1', suggestSavePath({ path: null, name: 'Untitled 1' }, '# My Doc').endsWith('my-doc.md'));

            // Lịch sử Undo nằm trong EditorState của CodeMirror: mỗi tab một state riêng.
            // Ở đây chỉ kiểm cơ chế undo/redo, phần tách theo tab do editor/cm.js đảm nhiệm.
            const undoBefore = docText();
            probe('nội dung thử');
            assert('can undo', undo(view) === true);
            assert('undo restores the previous content', docText() === undoBefore);
            assert('can redo', redo(view) === true);
            assert('redo restores the later content', docText() === 'nội dung thử');

            // Tên trùng phải phân biệt, không trùng thì giữ nguyên.
            const dupes = [
                { name: 'README.md', path: 'C:\\a\\README.md' },
                { name: 'README.md', path: 'C:\\b\\README.md' },
                { name: 'notes.md', path: 'C:\\a\\notes.md' }
            ];
            assert('two tabs with the same name -> prefixed with the parent folder', disambiguateTabName(dupes[0], dupes) === 'a/README.md');
            assert('no name clash -> kept as-is', disambiguateTabName(dupes[2], dupes) === 'notes.md');
            assert('unsaved tab -> original name', disambiguateTabName({ name: 'Untitled', path: null }, dupes) === 'Untitled');

            // confirmAction chèn câu hỏi bằng innerHTML: tên file phải escape trước khi vào DOM.
            assert('escapeHtml blocks tags in a file name', escapeHtml('<img src=x onerror=alert(1)>') === '&lt;img src=x onerror=alert(1)&gt;');
            assert('escapeHtml blocks quotes', escapeHtml('a"b\'c&d') === 'a&quot;b&#39;c&amp;d');

            // serializeSession() đọc store thật: chỉ kiểm không nổ và đủ trường.
            const live = serializeSession();
            assert('serialize session returns the right shape',
                typeof live.activeId === 'number' && Array.isArray(live.tabs)
                && live.tabs.every((t) => 'dirty' in t && (t.eol === '\n' || t.eol === '\r\n')));
        });

        // Giải mã file: đây là chỗ quyết định file nhị phân bị từ chối hay mở ra mojibake.
        await section('file decoding', async () => {
            const bytes = (...arr) => Uint8Array.from(arr);

            // UTF-16LE có BOM (Notepad Unicode): mở được, đánh dấu đã chuyển.
            const utf16 = decodeTextBytes(bytes(0xff, 0xfe, 0x48, 0x00, 0x69, 0x00));
            assert('UTF-16LE file with BOM -> decodes the text correctly', utf16 && utf16.text === 'Hi');
            assert('UTF-16LE file with BOM -> reports the conversion', utf16 && utf16.converted === true && utf16.encoding === 'UTF-16LE');

            const utf16be = decodeTextBytes(bytes(0xfe, 0xff, 0x00, 0x48, 0x00, 0x69));
            assert('UTF-16BE file with BOM -> decodes the text correctly', utf16be && utf16be.text === 'Hi' && utf16be.encoding === 'UTF-16BE');

            // File nhị phân: phải bị từ chối (null), không mở ra tab toàn ký tự lạ.
            assert('all-0x00 file -> rejected', decodeTextBytes(new Uint8Array(2048)) === null);
            const mixed = new Uint8Array(512);
            for (let i = 0; i < mixed.length; i++) mixed[i] = i % 2 ? 0x7f : 0x00;
            assert('file mixing 0x00/0x7F -> rejected', decodeTextBytes(mixed) === null);
            // File toàn 0x7F là UTF-8 hợp lệ: mở được, nhưng phải là UTF-8 chứ không phải Windows-125x.
            const dels = decodeTextBytes(new Uint8Array(512).fill(0x7f));
            assert('all-0x7F file -> opened as UTF-8, not as Windows-125x',
                !!dels && dels.encoding === 'UTF-8' && dels.converted === false
                && dels.encoding !== 'Windows-1252' && dels.encoding !== 'Windows-1258');

            // File UTF-8 chỉ hỏng MỘT byte: không được rơi về Windows-1252 (mọi chữ có dấu hoá thành rác).
            const broken = new Uint8Array([...new TextEncoder().encode('Tiếng Việt đẹp quá'), 0xff]);
            const brokenText = decodeTextBytes(broken);
            assert('utf-8 file with one broken byte -> still opens as UTF-8',
                !!brokenText && brokenText.encoding === 'UTF-8' && brokenText.converted === false);
            assert('utf-8 file with one broken byte -> the accented letters survive',
                !!brokenText && brokenText.text.includes('Tiếng Việt đẹp quá'));
            assert('utf-8 file with one broken byte -> the replaced byte count is reported',
                !!brokenText && brokenText.replacedBytes === 1);

            // Windows-125x cũ: giữ đúng chữ, không U+FFFD, nhãn encoding phải đúng.
            const win1252 = decodeTextBytes(bytes(0x63, 0x61, 0x66, 0xe9, 0x0a));
            assert('windows-1252 file -> keeps the é accent', !!win1252 && win1252.text.indexOf('\u00e9') !== -1);
            assert('windows-1252 file -> no U+FFFD characters', !!win1252 && win1252.text.indexOf('\ufffd') === -1);
            assert('windows-1252 file -> reports the conversion', !!win1252 && win1252.converted === true);
            assert('windows-1252 file -> is labelled Windows-1252', !!win1252 && win1252.encoding === 'Windows-1252');
            // File single-byte KHÔNG có chữ nhiều byte thật thì không được đoán thành UTF-8 hỏng.
            assert('windows-1252 file -> not mistaken for a broken UTF-8', !!win1252 && win1252.converted === true);
            // 0xEC/0xF2: 1252 ra 'ì'/'ò' dựng sẵn, 1258 ra chữ + dấu kết hợp -> phải chọn 1252.
            const win1252Accent = decodeTextBytes(bytes(0x69, 0xec, 0x20, 0x6f, 0xf2));
            assert('windows-1252 file -> keeps the precomposed ì and ò',
                !!win1252Accent && win1252Accent.text === 'iì oò' && !/[\u0300-\u036f]/.test(win1252Accent.text));
            assert('windows-1252 file with ì/ò -> is labelled Windows-1252',
                !!win1252Accent && win1252Accent.encoding === 'Windows-1252');

            // File CP1258 thật: chữ ă đ ơ ư + dấu thanh tổ hợp đứng sau chữ cái.
            // Bytes: Đ(0xD0) o ọ(0xF2) c | t a í(0xEC) | l i ệ(0xEA+0xF2) | ư(0xDD) ơ(0xF5) n g
            const cp1258 = decodeTextBytes(bytes(
                0xd0, 0x6f, 0xf2, 0x63, 0x20,
                0x74, 0x61, 0x69, 0xec, 0x20,
                0x6c, 0x69, 0xea, 0xf2, 0x20,
                0xdd, 0xf5, 0x6e, 0x67
            ));
            const cp1258Text = '\u0110o\u0323c tai\u0301 li\u00ea\u0323 \u01af\u01a1ng';
            assert('cp1258 file -> is labelled Windows-1258',
                !!cp1258 && cp1258.encoding === 'Windows-1258' && cp1258.converted === true);
            assert('cp1258 file -> keeps the Vietnamese letters and tone marks',
                !!cp1258 && cp1258.text === cp1258Text);
            assert('cp1258 file -> reads the letters that only 1258 has',
                !!cp1258 && /[\u0102\u0103\u0110\u0111\u01A0\u01A1\u01AF\u01B0]/.test(cp1258.text) && /[\u0300-\u0323]/.test(cp1258.text));
            // Không được nhận nhầm file Tây Âu làm CP1258: Iceland có ð, Bồ Đào Nha có ã/õ,
            // Ý có ì — nhưng không có dấu thanh tổ hợp nào cả.
            const icelandic = decodeTextBytes(bytes(0x4d, 0x61, 0xf0, 0x75, 0x72));
            assert('icelandic file with ð -> stays Windows-1252',
                !!icelandic && icelandic.encoding === 'Windows-1252' && icelandic.text === 'Maður');
            const portuguese = decodeTextBytes(bytes(0x6e, 0xe3, 0x6f, 0x20, 0x73, 0xe3, 0x6f));
            assert('portuguese file with ã -> stays Windows-1252',
                !!portuguese && portuguese.encoding === 'Windows-1252' && portuguese.text === 'não são');
            const italian = decodeTextBytes(bytes(0x63, 0x6f, 0x73, 0xec));
            assert('italian file with ì -> stays Windows-1252',
                !!italian && italian.encoding === 'Windows-1252' && italian.text === 'così');
            const tilde = decodeTextBytes(bytes(0xf5));
            assert('a file with only õ -> stays Windows-1252',
                !!tilde && tilde.encoding === 'Windows-1252' && tilde.text === 'õ');

            // UTF-8 BOM phải còn nguyên BOM để lần lưu sau ghi lại đúng file gốc.
            const utf8Bom = decodeTextBytes(bytes(0xef, 0xbb, 0xbf, 0x23, 0x20, 0x41));
            assert('UTF-8 file with BOM -> keeps the BOM', !!utf8Bom && utf8Bom.text.charCodeAt(0) === 0xfeff);
            assert('UTF-8 file with BOM -> reports no conversion', !!utf8Bom && utf8Bom.converted === false && utf8Bom.encoding === 'UTF-8');

            const plain = decodeTextBytes(bytes(0x23, 0x20, 0x41));
            assert('plain UTF-8 file -> keeps the text as-is', !!plain && plain.text === '# A' && plain.converted === false);
        });

        // Mở/lưu file: lỗi phải nói rõ, và lần ghi hỏng không được xoá mất bản nháp.
        await section('open/save file: clear error + keeps the temp file', async () => {
            const realTauri = window.__TAURI__;
            const target = 'C:\\selfcheck\\a.md';
            const tmp = target + '.md-live.tmp';
            const calls = [];
            // fs giả: đọc thì bị chặn ACL, ghi file gốc thì hỏng, rename thì bị khoá.
            const fakeFs = {
                readFile: async () => { throw new Error('forbidden path: ' + target); },
                writeTextFile: async (path) => {
                    calls.push(['write', path]);
                    if (path === target) throw new Error('disk full');
                },
                rename: async () => { calls.push(['rename']); throw new Error('file is locked'); },
                remove: async (path) => { calls.push(['remove', path]); }
            };
            // window.__TAURI__ có thể bị khoá: không gán được thì bỏ phần test này.
            let stubbed = false;
            try {
                window.__TAURI__ = { core: { invoke: async () => true }, fs: fakeFs };
                stubbed = window.__TAURI__ && window.__TAURI__.fs === fakeFs;
            } catch (e) {
                stubbed = false;
            }
            if (!stubbed) {
                skip('stub fs to test write errors', 'window.__TAURI__ could not be assigned');
                return;
            }
            try {
                // Lỗi đọc: đẩy lý do vào notes, không toast (toast chỉ một ô, lý do không được bị đè).
                const notes = [];
                const toastBefore = toast.textContent;
                const decoded = await readTextFile(target, notes);
                assert('read error -> reason written to notes', decoded === null && notes.length === 1 && notes[0].includes('Could not read that file'));
                assert('read error with notes -> does not overwrite the toast', toast.textContent === toastBefore);

                // Ghi hỏng sau rename lỗi: file tạm là bản nội dung mới, không được xoá.
                calls.length = 0;
                const ok = await writeTextFile(target, 'hello');
                assert('write failed -> reports failure', ok === false);
                assert('write failed -> keeps the temp file (draft not deleted)', !calls.some((c) => c[0] === 'remove' && c[1] === tmp));
                assert('write failed -> toast names where the draft was rescued', toast.textContent.includes(tmp));
            } finally {
                window.__TAURI__ = realTauri;
            }
        });

        // Xuất DOCX phải ghi atomic giống file văn bản: ghi thẳng sẽ cắt file cũ khi hỏng giữa chừng.
        await section('binary export writes atomically', async () => {
            const realTauri = window.__TAURI__;
            const target = 'C:\\selfcheck\\out.docx';
            const tmp = target + '.md-live.tmp';
            const calls = [];
            // fs giả: ghi file gốc hỏng, rename bị khoá -> file tạm phải còn lại.
            const fakeFs = {
                writeFile: async (path) => {
                    calls.push(['write', path]);
                    if (path === target) throw new Error('disk full');
                },
                writeTextFile: async (path) => { calls.push(['write', path]); },
                rename: async () => { calls.push(['rename']); throw new Error('file is locked'); },
                remove: async (path) => { calls.push(['remove', path]); }
            };
            let stubbed = false;
            try {
                window.__TAURI__ = {
                    core: { invoke: async () => true },
                    fs: fakeFs,
                    dialog: { save: async () => target }
                };
                stubbed = window.__TAURI__ && window.__TAURI__.fs === fakeFs;
            } catch (e) {
                stubbed = false;
            }
            if (!stubbed) {
                skip('stub fs to test the binary write', 'window.__TAURI__ could not be assigned');
                return;
            }
            try {
                const path = await saveBinaryFile(new Uint8Array([1, 2, 3]), 'out', 'docx', 'application/octet-stream');
                assert('binary write failed -> reports failure', path === null);
                assert('binary write goes through the temp file', calls.some((c) => c[0] === 'write' && c[1] === tmp));
                assert('binary write writes the temp file first', calls.length > 0 && calls[0][1] === tmp);
                assert('binary write keeps the temp file (new content not deleted)', !calls.some((c) => c[0] === 'remove' && c[1] === tmp));
            } finally {
                window.__TAURI__ = realTauri;
            }
        });
        // Xuất .doc/.html đi qua saveTextFile: BOM/EOL phải đúng, hộp thoại huỷ thì không ghi gì.
        await section('text export writes BOM and line endings', async () => {
            const realTauri = window.__TAURI__;
            const target = 'C:\\selfcheck\\out.doc';
            const tmp = target + '.md-live.tmp';
            const calls = [];
            const fakeFs = {
                writeTextFile: async (path, contents) => { calls.push(['write', path, contents]); },
                writeFile: async (path) => { calls.push(['write', path]); },
                rename: async (from, to) => { calls.push(['rename', from, to]); },
                remove: async (path) => { calls.push(['remove', path]); },
                stat: async () => ({ mtime: new Date() })
            };
            let stubbed = false;
            try {
                window.__TAURI__ = {
                    core: { invoke: async () => true },
                    fs: fakeFs,
                    dialog: { save: async () => target }
                };
                stubbed = window.__TAURI__ && window.__TAURI__.fs === fakeFs;
            } catch (e) {
                stubbed = false;
            }
            if (!stubbed) {
                skip('stub fs to test the text write', 'window.__TAURI__ could not be assigned');
                return;
            }
            try {
                const path = await saveTextFile('a\nb', 'out', 'doc', 'application/msword', '\r\n', true);
                assert('text export returns the chosen path', path === target);
                const write = calls.find((c) => c[0] === 'write' && c[1] === tmp);
                assert('text export writes through the temp file', !!write);
                assert('text export writes the BOM exactly once',
                    !!write && write[2].charCodeAt(0) === 0xFEFF && write[2].indexOf('\uFEFF', 1) === -1);
                assert('text export writes the requested line endings', !!write && write[2].includes('\r\n'));

                // Huỷ hộp thoại: không ghi file nào.
                calls.length = 0;
                window.__TAURI__.dialog.save = async () => null;
                const cancelled = await saveTextFile('x', 'out', 'html', 'text/html');
                assert('text export writes nothing when the dialog is cancelled',
                    cancelled === null && calls.length === 0);
            } finally {
                window.__TAURI__ = realTauri;
            }
        });

        // Session cũ từng khoá tab lớn và không có cách nào mở lại -> restore luôn mở khoá.
        await section('session drops the old read-only flag', async () => {
            const ro = deserializeSession(JSON.stringify({
                activeId: 1, tabs: [{ id: 1, path: 'C:\\big.md', name: 'big.md', content: 'x', dirty: false, eol: '\n', bom: false, readOnly: true }]
            }));
            assert('old session with a read-only tab -> restored as editable', ro.tabs[0].readOnly === false);
            const normal = deserializeSession(JSON.stringify({
                activeId: 1, tabs: [{ id: 1, path: 'C:\\a.md', name: 'a.md', content: 'x', dirty: false, eol: '\n', bom: false }]
            }));
            assert('session missing read-only -> defaults to editable', normal.tabs[0].readOnly === false);
            // Session cũ đọc từ IndexedDB là object: không cần stringify rồi parse lại.
            const fromObject = deserializeSession({
                activeId: 1, tabs: [{ id: 1, path: '/a.md', name: 'a.md', content: '# A', dirty: false, eol: '\n', bom: false }]
            });
            assert('session accepts an object as well as a JSON string',
                !!fromObject && fromObject.tabs.length === 1 && fromObject.tabs[0].content === '# A');
        });

        // Tự đóng do closeBrackets() + bọc * _ ~ $; Enter theo markdownKeymap. Mô phỏng gõ qua inputHandler facet.
        await section('auto-close', async () => {
            const type = (key) => {
                const { from, to } = view.state.selection.main;
                for (const h of view.state.facet(EditorView.inputHandler)) {
                    if (h(view, from, to, key)) return true;
                }
                view.dispatch({ changes: { from, to, insert: key }, selection: { anchor: from + key.length, head: from + key.length }, userEvent: 'input.type' });
                return false;
            };
            const typeAt = (value, caret, key) => {
                probe(value, caret, caret);
                type(key);
                return { value: docText(), caret: view.state.selection.main.head };
            };

            const quoteOpen = typeAt('', 0, '"');
            assert('typing " on empty content -> opens a pair (closeBrackets)', quoteOpen.value === '""' && quoteOpen.caret === 1);
            // Chuỗi gõ thật: mở " rồi gõ chữ rồi " sẽ nhảy qua cặp mình vừa mở.
            probe('', 0, 0);
            type('"'); type('a'); type('b'); type('c'); type('"');
            assert(`typing " closes the pair it just opened -> jumps over (actual=${JSON.stringify(docText())} caret=${view.state.selection.main.head} facets=${view.state.facet(EditorView.inputHandler).length})`, docText() === '"abc"' && view.state.selection.main.head === 5);
            probe('', 0, 0);
            type('('); type('x'); type(')');
            assert(`typing ) jumps over the ( it just opened (actual=${JSON.stringify(docText())} caret=${view.state.selection.main.head})`, docText() === '(x)' && view.state.selection.main.head === 3);
            // Backtick không nằm trong brackets mặc định của markdown: gõ một chỉ ra một.
            const backtick = typeAt('', 0, '`');
            assert('typing ` does not auto-close (backtick outside the default brackets)', backtick.value === '`');
            // Caret ở CUỐI don't: nháy đơn sau chữ không tự đóng, gõ thường chèn một ký tự.
            const apostrophe = typeAt("don't", 5, "'");
            assert("' after a letter is an apostrophe, does not auto-close a pair", apostrophe.value === "don't'");
            // ( chỉ đóng khi ký tự kế tiếp phù hợp: trước chữ thì không đóng.
            const parenWord = typeAt('ab', 0, '(');
            assert('typing ( before a word does not auto-close (closeBrackets only closes on a match)', parenWord.value === '(ab');

            for (const f of ['*', '_', '~', '$', '`']) {
                probe('abc', 0, 3);
                assert(`typing ${f} with a selection wraps the selection`, handleTypedChar(view, 0, 3, f) === true && docText() === `${f}abc${f}`);
            }

            // Backspace xoá cả cặp: đi qua closeBracketsKeymap.
            probe('""', 1, 1);
            const bs = window.CodeMirror.closeBracketsKeymap.find((b) => b.key === 'Backspace');
            bs.run(view);
            assert('Backspace between a pair deletes both marks', docText() === '');

            // Enter theo markup: dòng list rỗng thoát list, task mới chưa tick, dòng thụt giữ thụt.
            const enter = window.CodeMirror.markdownKeymap.find((b) => b.key === 'Enter');
            probe('- ', 2, 2);
            enter.run(view);
            assert('Enter on an empty list line -> leaves the list (marker gone)', docText() === '');
            probe('- done', 6, 6);
            enter.run(view);
            assert('Enter on a normal list line -> new line with the same bullet', docText() === '- done\n- ');
            probe('- [x] việc', 10, 10);
            enter.run(view);
            assert('Enter on a ticked task -> new unticked task', docText() === '- [x] việc\n- [ ] ');
            probe('    code', 8, 8);
            const handledPlain = enter.run(view);
            // markdownKeymap không xử lý dòng thường: trả false để default insert newline.
            assert('Enter on an indented plain line -> markdownKeymap does not handle it', handledPlain === false);
            if (!handledPlain) view.dispatch({ changes: { from: 8, to: 8, insert: '\n' }, selection: { anchor: 9, head: 9 } });
            assert('Enter on an indented plain line -> exactly one newline, text untouched', docText() === '    code\n');
        });

        // Exact dirty: undo về đúng bản đã lưu thì hết dirty; toggle readOnly giữ undo.
        await section('exact dirty + readOnly keeps undo', async () => {
            const fake = { state: null, savedDoc: null, savedContent: null, savedHash: null, savedLen: null, content: '' };
            probe('', 0, 0);
            fake.state = view.state;
            fake.savedDoc = view.state.doc;
            probe('hello');
            fake.state = view.state;
            assert('typing -> dirty (compared to the doc)', isTabDirty(fake) === true);
            undo(view);
            fake.state = view.state;
            assert('undo back to the saved content -> clean', isTabDirty(fake) === false);

            const tab = getActiveTab();
            probe('abc');
            try {
                setTabReadOnly(tab, true);
                assert('readOnly enabled after toggle', view.state.readOnly === true);
                setTabReadOnly(tab, false);
                assert('readOnly disabled after toggle', view.state.readOnly === false);
            } finally {
                setTabReadOnly(tab, false);
            }
            assert('toggling readOnly keeps undo', undo(view) === true && docText() === '');
            probe(snap.value);
        });

        await section('block #4', async () => {
            const host = document.createElement('div');
            host.innerHTML = '<blockquote><p>a</p></blockquote><blockquote class="markdown-alert markdown-alert-tip"><p class="markdown-alert-title">Tip</p><p>b</p></blockquote>';
            convertQuotesForDoc(host);
            assert('doc quote: no blockquote left', !host.querySelector('blockquote'));
            assert('doc quote: each quote becomes a table', host.querySelectorAll('table').length === 2);
            assert('doc quote: spacer paragraph between the two tables', host.children[0].tagName === 'TABLE' && host.children[1].tagName === 'P' && host.children[2].tagName === 'TABLE');
            assert('doc quote: alert uses the border color of its type', host.querySelectorAll('td')[1].style.cssText.includes('26, 127, 55') || host.querySelectorAll('td')[1].style.cssText.includes('#1a7f37'));
        });
        await section('block #5', async () => {
            const host = document.createElement('div');
            host.innerHTML = '<table><tr><th align="center">A</th></tr><tr><td>B</td></tr></table>';
            styleDataTablesForDoc(host);
            const th = host.querySelector('th');
            const td = host.querySelector('td');
            assert('doc table: cells have inline borders (Word ignores later selectors)', td.style.borderTopWidth === '1px' && th.style.borderTopStyle === 'solid');
            assert('doc table: header has a background and is bold', th.style.backgroundColor === 'rgb(246, 248, 250)' && th.style.fontWeight === 'bold');
            assert('doc table: keeps the markdown alignment', th.getAttribute('align') === 'center');
        });
        const wordHtml = buildWordHtml('<p>x</p>');
        assert('word html has a UTF-8 meta', wordHtml.includes('charset="UTF-8"'));
        assert('word html has the Office namespace', wordHtml.includes('urn:schemas-microsoft-com:office:word'));
        assert('word html keeps the body', wordHtml.includes('<p>x</p>'));
        const fitWide = fitDocImageSize(1200, 600);
        assert('doc caps a wide image at the text column width keeping the ratio', fitWide.width === 624 && fitWide.height === 312);
        const fitSmall = fitDocImageSize(400, 200);
        assert('doc keeps a small image as-is', fitSmall.width === 400 && fitSmall.height === 200);
        const fitTall = fitDocImageSize(500, 1800);
        assert('doc caps a tall image at 900 keeping the ratio', fitTall.width === 250 && fitTall.height === 900);
        assert('doc skips unusual sizes', fitDocImageSize(0, 0).width === 0);
        assert('doc treats a shields.io badge as SVG', isSvgImageSrc('https://img.shields.io/badge/Tauri-v2.0-24C8DB') === true);
        assert('doc treats the .svg extension as SVG', isSvgImageSrc('https://example.com/a.svg?x=1') === true);
        assert('doc does not treat png as SVG', isSvgImageSrc('https://example.com/a.png') === false);

        // DOCX: gói ZIP phải đúng chuẩn OPC, XML phải parse được và giữ đủ nội dung.
        await section('docx package and content', async () => {
            assert('crc32 matches the known vector', crc32(new TextEncoder().encode('123456789')) === 0xCBF43926);
            const zip = createZip([{ name: 'a.txt', data: new TextEncoder().encode('x') }]);
            const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
            assert('zip starts with a local file header', view.getUint32(0, true) === 0x04034b50);
            assert('zip ends with the central directory record', view.getUint32(zip.length - 22, true) === 0x06054b50);

            // ZIP nhiều file: số entry, offset thư mục trung tâm và CRC từng entry phải đúng.
            const two = createZip([
                { name: 'a.txt', data: new TextEncoder().encode('hello') },
                { name: 'b.txt', data: new TextEncoder().encode('world!') }
            ]);
            const dv = new DataView(two.buffer, two.byteOffset, two.byteLength);
            assert('zip records both entries', dv.getUint16(two.length - 22 + 10, true) === 2);
            const cdOffset = dv.getUint32(two.length - 22 + 16, true);
            assert('zip central directory starts at the right offset', dv.getUint32(cdOffset, true) === 0x02014b50);
            const firstCrc = crc32(new TextEncoder().encode('hello'));
            assert('zip stores the CRC of the first entry', dv.getUint32(14, true) === firstCrc);
            assert('zip central directory repeats the CRC', dv.getUint32(cdOffset + 16, true) === firstCrc);
            assert('zip central directory points at the first local header', dv.getUint32(cdOffset + 42, true) === 0);

            // escapeXml: ký tự điều khiển và surrogate lơ lửng làm XML hỏng -> Word báo "file hỏng".
            assert('escapeXml escapes the XML special characters',
                escapeXml('a & b < c > d "e"') === 'a &amp; b &lt; c &gt; d &quot;e&quot;');
            assert('escapeXml removes control characters', escapeXml('a\u0001b\u0007c') === 'abc');
            assert('escapeXml replaces a lone surrogate', escapeXml('\uD83D') === '\uFFFD');
            assert('escapeXml keeps Vietnamese text', escapeXml('Tiêu đề') === 'Tiêu đề');

            const host = document.createElement('div');
            host.innerHTML = '<h1>Tiêu đề</h1><p><strong>Đậm</strong> và <em>nghiêng</em></p>'
                + '<ul><li>mục một</li></ul><ol><li>bước một</li></ol>'
                + '<table><tr><th>A</th></tr><tr><td>B</td></tr></table>'
                + '<blockquote><p>trích dẫn</p></blockquote>'
                + '<pre><code>const x = 1;</code></pre>';
            const model = await buildDocxModel(host, 'Tài liệu');
            const xml = buildDocumentXml(model);
            const parsed = new DOMParser().parseFromString(xml, 'application/xml');
            assert('docx document.xml is well-formed XML', !parsed.querySelector('parsererror'));
            const text = parsed.documentElement.textContent;
            assert('docx keeps the heading text', text.includes('Tiêu đề'));
            assert('docx keeps the paragraph text', text.includes('Đậm') && text.includes('nghiêng'));
            assert('docx keeps the table cells', text.includes('A') && text.includes('B'));
            assert('docx keeps the code block', text.includes('const x = 1;'));
            assert('docx heading uses the Heading1 style', xml.includes('<w:pStyle w:val="Heading1"/>'));
            assert('docx bold run carries the bold flag', xml.includes('<w:b/>'));
            assert('docx list items carry a numbering reference', xml.includes('<w:numId w:val="1"/>'));
            assert('docx ordered list gets its own numbering id', model.orderedListIds.length === 1);
            assert('docx table becomes a w:tbl', xml.includes('<w:tbl>') && xml.includes('<w:gridCol'));
            assert('docx quote keeps a left border', xml.includes('<w:left w:val="single"'));
            assert('docx code block uses the CodeBlock style', xml.includes('<w:pStyle w:val="CodeBlock"/>'));

            const wraps = document.createElement('div');
            wraps.innerHTML = '<p>dòng một\ndòng hai</p><pre><code>a\tb</code></pre>';
            const wrapXml = buildDocumentXml(await buildDocxModel(wraps, 'Xuống dòng'));
            assert('docx turns a soft line break into a space',
                wrapXml.includes('dòng một dòng hai') && !wrapXml.includes('<w:br/>'));
            assert('docx keeps a tab as w:tab', wrapXml.includes('<w:tab/>'));

            const tight = document.createElement('div');
            tight.innerHTML = '<ul><li>dòng một\ndòng hai</li></ul>';
            const tightXml = buildDocumentXml(await buildDocxModel(tight, 'Mục'));
            assert('docx turns a soft line break in a list item into a space',
                tightXml.includes('dòng một dòng hai') && !tightXml.includes('<w:br/>'));

            const bytes = buildDocxPackage(model);
            assert('docx package starts with the ZIP signature', bytes[0] === 0x50 && bytes[1] === 0x4B);
            const rels = buildDocumentRelsXml(model);
            assert('docx relationships list styles and numbering', rels.includes('styles.xml') && rels.includes('numbering.xml'));
            const styles = buildStylesXml();
            assert('docx styles define the heading styles', styles.includes('w:styleId="Heading1"'));
            // Word/LO map style theo w:name: lệch tên là heading 1 ra "Heading 5".
            const headingStyles = [1, 2, 3, 4, 5, 6].map((n) => {
                const m = styles.match(new RegExp(`<w:style [^>]*w:styleId="Heading${n}">([\\s\\S]*?)</w:style>`));
                return m ? m[1] : '';
            });
            assert('docx heading style names match their ids',
                headingStyles.every((body, i) => body.includes(`<w:name w:val="heading ${i + 1}"/>`)));
            const headingSizes = headingStyles.map((body) => Number((body.match(/<w:sz w:val="(\d+)"\/>/) || [])[1] || 0));
            assert('docx heading sizes shrink from H1 to H6',
                headingSizes.every((size, i) => size > 0 && (i === 0 || size < headingSizes[i - 1])));
            // Word ẩn style heading built-in trong UI nếu không khai báo latentStyles.
            assert('docx styles declare the heading styles visible in Word',
                styles.includes('<w:latentStyles')
                && [1, 2, 3, 4, 5, 6].every((n) => styles.includes(`<w:lsdException w:name="heading ${n}"`)
                    && styles.includes(`w:name="heading ${n}" w:semiHidden="0"`))
                && headingStyles.every((body) => body.includes('<w:semiHidden w:val="0"/>')));
            const numbering = buildNumberingXml(model);
            assert('docx numbering defines the bullet list', numbering.includes('<w:abstractNum w:abstractNumId="0">'));
            assert('docx numbering restarts each ordered list', numbering.includes('<w:startOverride w:val="1"/>'));
        });

        // Bảng: bề rộng cột đo từ Preview và bảng lồng không lẫn hàng vào bảng ngoài.
        await section('docx: table columns and nested tables', async () => {
            const host = document.createElement('div');
            host.innerHTML = '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>';
            const plain = buildDocumentXml(await buildDocxModel(host, 'Bảng'));
            const half = Math.floor(CONTENT_WIDTH_TWIP / 2);
            assert('docx table without measured widths splits columns evenly',
                plain.includes(`<w:gridCol w:w="${half}"/>`));

            const widths = new WeakMap();
            widths.set(host.querySelector('table'), [1200, CONTENT_WIDTH_TWIP - 1200]);
            const sized = buildDocumentXml(await buildDocxModel(host, 'Bảng', { tableWidths: widths }));
            assert('docx table keeps the measured column widths',
                sized.includes('<w:gridCol w:w="1200"/>')
                && sized.includes(`<w:gridCol w:w="${CONTENT_WIDTH_TWIP - 1200}"/>`));
            assert('docx table cells follow the column widths', sized.includes('<w:tcW w:w="1200"'));

            const nested = document.createElement('div');
            nested.innerHTML = '<table><tr><td><table><tr><td>x</td></tr></table></td></tr></table>';
            const nestedModel = await buildDocxModel(nested, 'Lồng');
            const outer = nestedModel.blocks.find((b) => b.type === 'table');
            assert('docx keeps the outer table rows apart from the nested table', outer.rows.length === 1);
        });

        // Danh sách: đủ 9 cấp để list lồng sâu không trỏ tới ilvl chưa định nghĩa.
        await section('docx: list levels', async () => {
            const numbering = buildNumberingXml({ orderedListIds: [2] });
            assert('docx numbering defines nine bullet levels',
                numbering.includes('<w:lvl w:ilvl="8"><w:start w:val="1"/><w:numFmt w:val="bullet"/>'));
            assert('docx numbering defines nine decimal levels',
                numbering.includes('<w:lvl w:ilvl="8"><w:start w:val="1"/><w:numFmt w:val="decimal"/>'));
            assert('docx decimal level four counts its own level',
                numbering.includes('<w:lvlText w:val="%4."/>'));
            assert('docx ordered list restarts every level',
                (numbering.match(/<w:startOverride w:val="1"\/>/g) || []).length === 9);

            // <ol start="5"> phải ra số 5 trong Word, không phải 1.
            const started = document.createElement('div');
            started.innerHTML = '<ol start="5"><li>a</li><li>b</li></ol>';
            const startedModel = await buildDocxModel(started, 'Bắt đầu');
            assert('docx keeps the start value of an ordered list', startedModel.orderedListStarts[0] === 5);
            const startedNumbering = buildNumberingXml(startedModel);
            assert('docx numbering starts the list at 5',
                startedNumbering.includes('<w:lvlOverride w:ilvl="0"><w:startOverride w:val="5"/></w:lvlOverride>'));
            assert('docx numbering keeps the nested levels at 1',
                (startedNumbering.match(/<w:startOverride w:val="1"\/>/g) || []).length === 8);
            const plainList = document.createElement('div');
            plainList.innerHTML = '<ol><li>a</li></ol>';
            assert('docx list without a start value defaults to 1',
                (await buildDocxModel(plainList, 'Mặc định')).orderedListStarts[0] === 1);

            const nest = (depth) => {
                let inner = 'x';
                for (let i = 0; i < depth; i++) inner = `<ul><li>${inner}</li></ul>`;
                return inner;
            };
            const deep = document.createElement('div');
            deep.innerHTML = nest(4);
            const deepXml = buildDocumentXml(await buildDocxModel(deep, 'Sâu'));
            assert('docx keeps the fourth list level', deepXml.includes('<w:ilvl w:val="3"/>'));

            const veryDeep = document.createElement('div');
            veryDeep.innerHTML = nest(10);
            const veryDeepXml = buildDocumentXml(await buildDocxModel(veryDeep, 'Rất sâu'));
            assert('docx clamps a list deeper than nine levels', veryDeepXml.includes('<w:ilvl w:val="8"/>'));

            const loose = document.createElement('div');
            loose.innerHTML = '<ol><li><p>một</p><p>tiếp</p></li></ol>';
            const looseXml = buildDocumentXml(await buildDocxModel(loose, 'Mục'));
            assert('docx indents the second paragraph of a list item',
                (looseXml.match(/w:pStyle w:val="ListParagraph"/g) || []).length === 2
                && looseXml.includes('<w:ind w:left="720"/>'));

            // Heading trong mục: phải giữ cấp heading, không gộp vào đoạn của mục.
            const headingList = document.createElement('div');
            headingList.innerHTML = '<ul><li><h2>Mục có heading</h2></li></ul>';
            const headingListXml = buildDocumentXml(await buildDocxModel(headingList, 'Mục'));
            assert('docx keeps the heading level of a heading inside a list item',
                headingListXml.includes('<w:pStyle w:val="Heading2"/>'));

            // List sâu hơn 9 cấp: thụt của đoạn tiếp phải bị ghim theo cấp cuối, không theo cấp gốc.
            const nestLoose = (depth) => {
                let inner = '<p>x</p><p>y</p>';
                for (let i = 0; i < depth; i++) inner = `<ul><li>${inner}</li></ul>`;
                return inner;
            };
            const deepLoose = document.createElement('div');
            deepLoose.innerHTML = nestLoose(10);
            const deepLooseXml = buildDocumentXml(await buildDocxModel(deepLoose, 'Rất sâu'));
            assert('docx clamps the indent of a continuation paragraph in a deep list',
                deepLooseXml.includes('<w:ind w:left="6480"/>')
                && !deepLooseXml.includes('<w:ind w:left="7920"/>'));

            // Đoạn tiếp của mục nằm trong quote: giữ viền trái của quote.
            const quoted = document.createElement('div');
            quoted.innerHTML = '<blockquote><ol><li><p>một</p><p>tiếp</p></li></ol></blockquote>';
            const quotedXml = buildDocumentXml(await buildDocxModel(quoted, 'Trích'));
            assert('docx keeps the quote border on a list continuation paragraph',
                quotedXml.includes('<w:pBdr><w:left w:val="single"')
                && quotedXml.includes('<w:ind w:left="720"/>'));
        });

        // Công thức phải thành equation native của Word (OMML), không phải ảnh.
        await section('docx: formulas become Word equations', async () => {
            if (typeof katex === 'undefined') {
                skip('docx: formulas become Word equations', 'KaTeX not loaded');
                return;
            }
            const host = document.createElement('div');
            host.innerHTML = katex.renderToString('\\frac{a}{b} + \\sqrt{x}', { throwOnError: false });
            const math = host.querySelector('.katex-mathml > math');
            const omml = mathmlToOmml(math);
            assert('mathml converts to an OMML equation', !!omml && omml.startsWith('<m:oMath>'));
            assert('OMML keeps the fraction element', !!omml && omml.includes('<m:f>'));
            assert('OMML keeps the radical element', !!omml && omml.includes('<m:rad>'));

            const model = await buildDocxModel(host, 'Công thức');
            const xml = buildDocumentXml(model);
            assert('docx formula is written as an OMML equation', xml.includes('<m:oMath>'));
            assert('docx formula is not exported as an image', !xml.includes('<w:drawing>'));
            const parsed = new DOMParser().parseFromString(xml, 'application/xml');
            assert('docx with a formula is well-formed XML', !parsed.querySelector('parsererror'));
            assert('docx declares the math namespace', xml.includes('xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"'));

            // aligned phải là m:eqArr; m:m khiến Word coi là ma trận và các dòng lệch nhau.
            const alignedHost = document.createElement('div');
            alignedHost.innerHTML = katex.renderToString(
                String.raw`\begin{aligned} a &= 1 \\ b &= 2 \end{aligned}`,
                { throwOnError: false, displayMode: true, output: 'htmlAndMathml' });
            const alignedOmml = mathmlToOmml(alignedHost.querySelector('.katex-mathml > math'));
            assert('docx aligned equations become an equation array', !!alignedOmml && alignedOmml.includes('<m:eqArr>'));
            assert('docx aligned equations are not exported as a matrix', !!alignedOmml && !alignedOmml.includes('<m:m>'));
            assert('docx aligned equations keep the alignment point', !!alignedOmml && alignedOmml.includes('&amp;'));

            // Chữ đậm: dùng m:sty, không dùng codepoint Mathematical Alphanumeric (Word thiếu glyph).
            const boldHost = document.createElement('div');
            boldHost.innerHTML = katex.renderToString(String.raw`\mathbf{B}`, { throwOnError: false, output: 'htmlAndMathml' });
            const boldOmml = mathmlToOmml(boldHost.querySelector('.katex-mathml > math'));
            assert('docx bold variables use the math bold style', !!boldOmml && boldOmml.includes('<m:sty m:val="b"/>'));
            assert('docx bold variables keep the plain letter', !!boldOmml && boldOmml.includes('>B<'));
            assert('docx avoids Mathematical Alphanumeric codepoints', !boldOmml || !boldOmml.includes('\u{1D401}'));

            // Toán tử lớn và hàm: nhánh riêng, lỗi ở đây là công thức sai mà không ai thấy.
            const sumHost = document.createElement('div');
            sumHost.innerHTML = katex.renderToString(String.raw`\sum_{i=1}^{n} x_i`, { throwOnError: false, output: 'htmlAndMathml' });
            const sumOmml = mathmlToOmml(sumHost.querySelector('.katex-mathml > math'));
            assert('docx big operators become an n-ary equation', !!sumOmml && sumOmml.includes('<m:nary>'));
            assert('docx n-ary equation keeps its limits', !!sumOmml && sumOmml.includes('<m:sub>') && sumOmml.includes('<m:sup>'));
            const sumAddHost = document.createElement('div');
            sumAddHost.innerHTML = katex.renderToString(String.raw`\sum_{i=1}^{n} x_i + y`, { throwOnError: false, output: 'htmlAndMathml' });
            const sumAddOmml = mathmlToOmml(sumAddHost.querySelector('.katex-mathml > math'));
            const tail = sumAddOmml ? (sumAddOmml.split('</m:nary>')[1] || '') : '';
            assert('docx n-ary equation does not swallow the term after it', tail.includes('+') && tail.includes('y'));
            const sinHost = document.createElement('div');
            sinHost.innerHTML = katex.renderToString(String.raw`\sin(x)`, { throwOnError: false, output: 'htmlAndMathml' });
            const sinOmml = mathmlToOmml(sinHost.querySelector('.katex-mathml > math'));
            assert('docx keeps the name of a function', !!sinOmml && sinOmml.includes('sin'));
        });

        const standalone = buildStandaloneHtml('<p>x</p>', 'Tiêu đề <đẹp>');
        assert('standalone html has a doctype', standalone.startsWith('<!DOCTYPE html>'));
        assert('standalone html has a UTF-8 meta', standalone.includes('charset="UTF-8"'));
        assert('standalone html keeps the body', standalone.includes('<p>x</p>'));
        assert('html standalone escape title', standalone.includes('<title>Tiêu đề &lt;đẹp&gt;</title>'));
        assert('html standalone title fallback', buildStandaloneHtml('<p>x</p>', '').includes('<title>Document</title>'));
        assert('title from a level 1 heading', deriveDocumentTitle('# Báo cáo tháng 9\nnội dung') === 'Báo cáo tháng 9');
        assert('title fallback when there is no heading', deriveDocumentTitle('không có heading') === 'Document');
        assert('title ignores a heading inside a ``` fence', deriveDocumentTitle('```\n# giả\n```\n\n# Thật') === 'Thật');
        assert('title ignores a heading inside a ~~~ fence', deriveDocumentTitle('~~~md\n# giả\n~~~\n# Thật') === 'Thật');
        assert('title only falls back when everything is a fence', deriveDocumentTitle('```\n# giả\n```') === 'Document');
        assert('title ignores a fence closed longer than it opened', deriveDocumentTitle('```\n# giả\n````\n# Thật') === 'Thật');
        assert('title does not swallow the line after #', deriveDocumentTitle('#\nfoo') === 'Document');
        assert('title accepts a heading indented up to 3 spaces', deriveDocumentTitle('   # Thụt') === 'Thụt');
        assert('title rejects a heading indented 4 spaces', deriveDocumentTitle('    # Sâu') === 'Document');

        assert('heading detects an indented H2', getHeadingLevel('  ## Tiêu đề') === 2);
        assert('heading detects a plain line', getHeadingLevel('nội dung') === 0);
        assert('heading detects # with no content', getHeadingLevel('#') === 1);
        assert('heading rejects #without-space', getHeadingLevel('#hashtag') === 0);
        assert('heading rejects 7 hashes', getHeadingLevel('####### bảy') === 0);
        assert('heading turns H1 into H3', setHeadingLevel('# Tiêu đề', 3).line === '### Tiêu đề');
        assert('heading strips the prefix at level 0', setHeadingLevel('## Tiêu đề', 0).line === 'Tiêu đề');
        assert('heading keeps the indentation', setHeadingLevel('  # a', 2).line === '  ## a');
        assert('heading creates a new one on a plain line', setHeadingLevel('văn bản', 2).line === '## văn bản');
        assert('heading on a plain line + strip is a no-op', setHeadingLevel('văn bản', 0) === null);

        assert('html wraps the selection', wrapHtmlTag('ab', 0, 2, 'sup').insert === '<sup>ab</sup>');
        assert('html wrap keeps the selection', (() => { const r = wrapHtmlTag('ab', 0, 2, 'sub'); return r.selStart === 5 && r.selEnd === 7; })());
        assert('html placeholder when nothing is selected', (() => { const r = wrapHtmlTag('', 0, 0, 'kbd'); return r.insert === '<kbd>text</kbd>' && r.selStart === 5 && r.selEnd === 9; })());
        assert('html removes the tag when the whole pair is wrapped', wrapHtmlTag('<sup>ab</sup>', 0, 13, 'sup').insert === 'ab');
        assert('html removes the tag when it sits outside the selection', (() => { const r = wrapHtmlTag('<mark>ab</mark>', 6, 8, 'mark'); return r.insert === 'ab' && r.selStart === 0 && r.selEnd === 2 && r.from === 0 && r.to === 15; })());
        assert('html re-wraps after removal (toggles back)', (() => {
            const a = wrapHtmlTag('ab', 0, 2, 'mark');
            const b = wrapHtmlTag(a.insert, a.selStart, a.selEnd, 'mark');
            return b.insert === 'ab';
        })());
        assert('heading keeps the # inside the content', setHeadingLevel('#hashtag', 1).line === '# #hashtag');
        assert('list parse task', parseListLine('- [x] việc').kind === 'task' && parseListLine('- [x] việc').rest === 'việc');
        assert('list parse numbered', parseListLine('2. mục').kind === 'numbered');
        assert('list parse bullet keeps the indentation', parseListLine('  - a').indent === '  ' && parseListLine('  - a').rest === 'a');
        assert('list rejects a plain line', parseListLine('chữ') === null);
        assert('list rejects an empty line', parseListLine('') === null);
        assert('list rejects -5 without a space', parseListLine('-5') === null);
        assert('2x2 table has valid syntax', buildTableMarkdown(2, 2) === '| Head | Head |\n| --- | --- |\n|  |  |\n|  |  |');
        assert('1x1 table still has a body row to type into', buildTableMarkdown(1, 1) === '| Head |\n| --- |\n|  |');
        assert('table clamps to the 1..99 range', buildTableMarkdown(5, 0) === '| Head |\n| --- |\n|  |\n|  |\n|  |\n|  |\n|  |');
        assert('url adds https when bare', normalizeLinkUrl('example.com') === 'https://example.com');
        assert('url keeps an existing scheme', normalizeLinkUrl('mailto:a@b.com') === 'mailto:a@b.com');
        assert('url keeps an internal anchor', normalizeLinkUrl('#muc-luc') === '#muc-luc');
        assert('url keeps protocol-relative', normalizeLinkUrl('//cdn.example.com/x') === '//cdn.example.com/x');
        assert('blank url returns empty', normalizeLinkUrl('   ') === '');
        assert('escapes the link label', escapeLinkText('a[b]c') === 'a\\[b\\]c');
        assert('quote parses a > line', parseListLine('> trích dẫn').kind === 'quote' && parseListLine('> trích dẫn').rest === 'trích dẫn');
        assert('quote parse keeps the indentation', parseListLine('  > a').indent === '  ');
        assert('quote rejects >without-space', parseListLine('>không-cách') === null);
        assert('code fence default', buildBlockFence('code', '') === '```js\n// code here\n```');
        assert('math fence default', buildBlockFence('math', '') === '$$\nf(x) = \\int_{-\\infty}^{\\infty} e^{-x^2} dx\n$$');
        assert('mermaid fence default', buildBlockFence('mermaid', '') === '```mermaid\ngraph TD\n    A[Start] --> B[End]\n```');
        assert('fence keeps the existing content', buildBlockFence('code', 'a\nb') === '```js\na\nb\n```');

        await section('block #6', async () => {
            const run = (text, fn) => {
                probe(text, 0, text.length);
                fn();
                return docText();
            };
            assert('heading delta 0 still applies', run('### a\nbbbb', () => applyHeadingLevel(1)) === '# a\n# bbbb');
            assert('bullet delta 0 still applies', run('- aaa\nbbb', () => applyListStyle('bullet')) === 'aaa\n- bbb');
            assert('numbered delta 0 still applies', run('1. a\nbbb', () => applyListStyle('numbered')) === 'a\n1. bbb');
            // Per-line changes: CM map selection qua delta từng dòng (không tính tay).
            probe('abc\ndef', 1, 6);
            applyHeadingLevel(1);
            assert('heading: selection shifts with the per-line marker',
                view.state.selection.main.from === 3 && view.state.selection.main.to === 10);
            probe('aaa\nbbb', 1, 6);
            applyListStyle('bullet');
            assert('bullet: selection shifts with the per-line marker',
                view.state.selection.main.from === 3 && view.state.selection.main.to === 10);
            probe('abc def', 0, 3);
            insertTableBlock(2, 2);
            assert('inserting a table keeps the selection', docText().startsWith('abc') && docText().includes('| Head |'));
            // Số dòng tính cả tiêu đề: 3x2 = tiêu đề + 1 dòng thân.
            probe('', 0, 0);
            insertTableBlock(3, 2);
            assert('3x2 table gives 2 rows (header + 1 body row)',
                docText() === '| Head | Head | Head |\n| --- | --- | --- |\n|  |  |  |');
            probe('', 0, 0);
            insertTableBlock(1, 1);
            assert('1x1 table still keeps a body row to type into', docText() === '| Head |\n| --- |\n|  |');
        });

        await section('block #7', async () => {
            // Undo sau khi nạp phải có tác dụng: CodeMirror giữ mốc ban đầu trong state.
            const before = docText();
            probe('hi');
            assert('the first undo after load works', undo(view) === true && docText() === before);
            assert('redo returns to the just-typed content', redo(view) === true && docText() === 'hi');
        });

        await section('block #8', async () => {
            // Dấu cách phải tạo mốc lịch sử riêng, nếu không Undo lùi hết cả cụm.
            probe('hello');
            view.dispatch({ changes: { from: 5, insert: ' ' }, userEvent: 'input.type' });
            view.dispatch({ changes: { from: 6, insert: 'world' }, userEvent: 'input.type' });
            undo(view);
            assert('undo steps back word by word at spaces', docText() === 'hello ');
        });

        await section('block #9', async () => {
            // marked.lexer ném lỗi: preview phải rơi về văn bản thô, không đụng innerHTML.
            const savedValue = docText();
            const savedMarked = window.marked;
            probe('# probe render');
            if (savedMarked) {
                // marked.lexer là method của object marked: thay cả object marked rồi trả lại reference cũ.
                window.marked = { ...savedMarked, lexer: () => { throw new Error('probe'); } };
                try {
                    renderMarkdown();
                    assert('render error -> preview shows plain text', previewOutput.textContent === '# probe render');
                } finally {
                    window.marked = savedMarked;
                }
            } else {
                skip('render error -> preview shows plain text', 'marked not loaded');
            }
            // Trả editor về nội dung thật TRƯỚC rồi render lại, không thì preview kẹt ở đoạn probe.
            probe(savedValue);
            renderMarkdown();
        });

        assert('diffBlocks keeps prefix/suffix when the middle changes', diffBlocks(['a','b','c'], ['a','X','c']).prefix === 1 && diffBlocks(['a','b','c'], ['a','X','c']).suffix === 1);
        assert('diffBlocks insert at the start does not touch the prefix', diffBlocks(['a','b'], ['n','a','b']).suffix === 2);
        assert('diffBlocks append does not touch the suffix', diffBlocks(['a','b'], ['a','b','n']).prefix === 2);
        assert('diffBlocks reorder does not reuse nodes', diffBlocks(['a','b','c'], ['c','b','a']).prefix === 0 && diffBlocks(['a','b','c'], ['c','b','a']).suffix === 0);
        assert('diffBlocks on an empty document', diffBlocks(['a'], []).prefix === 0 && diffBlocks([], ['a']).suffix === 0);
        // Cache khối phải đuổi theo số khối lẫn tổng ký tự: doc >2000 khối khác nhau thì
        // LRU đuổi đầu mỗi lượt render, khối bị render lại từ đầu (mất cache khi sửa).
        resetBlocks();
        for (let i = 0; i < 50001; i++) storeBlockHtml(`probe-${i}`, 'x');
        assert('block cache evicts the oldest entry past the count limit',
            findBlockHtml('probe-0') === undefined && findBlockHtml('probe-50000') === 'x');
        resetBlocks();
        const bigBlock = 'x'.repeat(1000000);
        for (let i = 0; i < 9; i++) storeBlockHtml(`big-${i}`, bigBlock);
        assert('block cache evicts by total chars, not only by count',
            findBlockHtml('big-0') === undefined && findBlockHtml('big-8') === bigBlock);
        resetBlocks();
        await section('block render by prefix/suffix', async () => {
            const savedValue = docText();
            // >= 5 khối: đảo thứ tự suffix chỉ lộ khi còn hơn MỘT khối suffix.
            const doc = 'Alpha para một\n\nBeta para hai\n\nGamma para ba\n\nDelta para bốn\n\nEpsilon para năm';
            const edited = 'Alpha para một\n\nBeta para SỬA\n\nGamma para ba\n\nDelta para bốn\n\nEpsilon para năm';
            probe(doc);
            renderMarkdown();
            const before = [...previewOutput.children];
            assert('the document is split into five blocks', before.length === 5);
            probe(edited);
            renderMarkdown();
            const after = [...previewOutput.children];
            assert('unchanged block keeps its node (prefix/suffix)', after[0] === before[0]);
            assert('changed block gets its node replaced', after[1] !== before[1]);
            assert('suffix blocks keep their nodes', after[2] === before[2] && after[3] === before[3] && after[4] === before[4]);
            assert('preview keeps the document order',
                after.map((n) => n.textContent.trim()).join('|')
                === 'Alpha para một|Beta para SỬA|Gamma para ba|Delta para bốn|Epsilon para năm');

            // Đảo thứ tự khối suffix khiến lượt render sau dựng lại gần hết tài liệu.
            probe(edited);
            renderMarkdown();
            const again = [...previewOutput.children];
            assert('rendering the same document again reuses every block node',
                again.length === after.length && again.every((node, i) => node === after[i]));
            assert('rendering the same document again keeps the order',
                again.map((n) => n.textContent.trim()).join('|')
                === 'Alpha para một|Beta para SỬA|Gamma para ba|Delta para bốn|Epsilon para năm');
            if (window.marked) {
                // Băm y hệt cách render băm: dùng chính blockFingerprint để test không lệch.
                const tokens = window.marked.lexer(edited);
                const linksKey = JSON.stringify(tokens.links || {});
                const order = snapshotPreviewBlocks().map((b) => b.hash);
                const expected = tokens.map((t) => blockFingerprint(linksKey, t));
                assert('block cache keeps the document order', order.join(',') === expected.join(','));
            } else {
                skip('block cache keeps the document order', 'marked not loaded');
            }
            probe('công thức $E = mc^2$ test');
            renderMarkdown();
            const slot = previewOutput.querySelector('.math-slot');
            assert('formula outside the viewport keeps the TeX placeholder', !!slot && slot.textContent.includes('E = mc^2'));
            flushLazyRenders();
            assert('flushLazyRenders renders KaTeX even outside the viewport', !!previewOutput.querySelector('.katex'));
            probe(savedValue);
            renderMarkdown();
        });

        await section('block #10', async () => {
            let calls = 0;
            const runOnce = makeExclusive(async () => { calls++; await Promise.resolve(); });
            const first = runOnce();
            runOnce();
            assert('overlapping export is blocked', calls === 1);
            await first;
            await runOnce();
            assert('export can run again once the previous run finished', calls === 2);
        });

        await section('block #11', async () => {
            // Đi qua listener mouseenter thật để kiểm cả ánh xạ chỉ số -> cols/rows.
            const grid = tableMenu.querySelector('.table-grid');
            const hover = (index) => grid.children[index].dispatchEvent(new MouseEvent('mouseenter'));
            const onCount = () => grid.querySelectorAll('.table-cell.on').length;

            hover(7);
            assert('table grid highlights the right rectangle on hover', onCount() === 6
                && grid.children[0].classList.contains('on')
                && grid.children[7].classList.contains('on')
                && !grid.children[3].classList.contains('on')
                && !grid.children[10].classList.contains('on'));
            hover(24);
            assert('table grid highlights the full 5x5', onCount() === 25);
            tableMenu.dispatchEvent(new MouseEvent('mouseleave'));
            assert('table grid clears the highlight when leaving the menu', onCount() === 0);
        });

        assert('heading slug drops punctuation', slugifyText('Tiêu đề Mục 2!') === 'tiêu-đề-mục-2');
        // Dấu thanh tổ hợp (NFD) là chữ: bỏ nó thì neo của tiêu đề Việt/Hindi lệch.
        assert('heading slug keeps combining marks', slugifyText('Tiêu đề'.normalize('NFD')) === 'tiêu-đề'.normalize('NFD'));
        assert('heading slug keeps Devanagari marks', slugifyText('हिन्दी'.normalize('NFD')) === 'हिन्दी'.normalize('NFD'));
        await section('block #12', async () => {
            const host = document.createElement('div');
            host.innerHTML = '<h2>Giới thiệu</h2><h2>Giới thiệu</h2>';
            assignHeadingIds(host);
            assert('heading gets an anchor id', host.querySelector('h2').id === 'giới-thiệu');
            assert('duplicate heading -> unique id', host.querySelectorAll('h2')[1].id === 'giới-thiệu-1');
        });

        const NS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(NS, 'svg');
        const fo = document.createElementNS(NS, 'foreignObject');
        fo.setAttribute('x', '10');
        fo.setAttribute('y', '20');
        fo.setAttribute('width', '100');
        fo.setAttribute('height', '40');
        const labelDiv = document.createElement('div');
        labelDiv.textContent = 'Xin chào';
        fo.appendChild(labelDiv);
        svg.appendChild(fo);
        flattenForeignObjects(svg, '#000', '16px');
        const textEl = svg.querySelector('text');
        assert('foreignObject converted to <text>', !!textEl && !svg.querySelector('foreignObject') && svg.textContent.includes('Xin chào'));
        assert('tspan centered on the foreignObject', textEl && textEl.querySelector('tspan').getAttribute('x') === '60');

        const faceCss = '@font-face{font-family:KaTeX_Main;font-style:italic;font-weight:700;'
            + 'src:url(fonts/KaTeX_Main-BoldItalic.woff2) format("woff2"),url(fonts/KaTeX_Main-BoldItalic.woff) format("woff")}'
            + '.katex{font:normal 1.21em KaTeX_Main}';
        assert('katex font-face picks the right woff2 url', parseKatexFontFaces(faceCss).get('KaTeX_Main|italic|700') === 'fonts/KaTeX_Main-BoldItalic.woff2');
        assert('katex font key normalizes bold/normal/italic',
            katexFontKey('KaTeX_Main', 'normal', 'bold') === 'KaTeX_Main|normal|700'
            && katexFontKey('"KaTeX_Math"', 'italic', '400') === 'KaTeX_Math|italic|400');

        await section('editor syntax highlighting', async () => {
            // CodeMirror tự dựng cây cú pháp (Lezer) và gắn class CSS cho từng loại token.
            const text = '# Tiêu đề\n\nđoạn **đậm** và `code` cùng [link](https://example.com)\n\n```js\nconst x = "s";\n```\n';
            probe(text);
            // Pane ẩn (chế độ Preview) thì editor không render nên không có class để kiểm.
            if (!view.dom.clientWidth) {
                skip('editor syntax highlighting', 'pane is hidden');
                return;
            }
            assert('content unchanged after highlighting', docText() === text);
            assert('heading gets its own class', view.dom.querySelectorAll('.cm-md-h1').length >= 1);
            assert('bold text gets its own class', view.dom.querySelectorAll('.cm-md-strong').length >= 1);
            assert('inline code gets its own class', view.dom.querySelectorAll('.cm-md-code').length >= 1);
            assert('link gets its own class', view.dom.querySelectorAll('.cm-md-link').length >= 1);
            assert('fenced code keyword is highlighted', view.dom.querySelectorAll('.cm-code-keyword').length >= 1);
            assert('fenced code string is highlighted', view.dom.querySelectorAll('.cm-code-string').length >= 1);
        });

        // Thanh trạng thái: số từ / dòng / ký tự + gutter số dòng + vạch chia mảnh.
        await section('status bar counts and line numbers', async () => {
            assert('word count ignores markdown punctuation', countWords('# Title\n\n**bold** text') === 3);
            assert('word count keeps contractions together', countWords("don't well-known") === 2);
            assert('word count handles Vietnamese', countWords('xin chào Việt Nam') === 4);
            assert('empty document has no words', countWords('') === 0);

            probe('Một hai ba\nbốn năm\n');
            handleEditorChange({ state: view.state });
            // Số từ quét cả văn bản nên trễ một nhịp 200ms.
            await new Promise((resolve) => setTimeout(resolve, 400));
            assert('character count follows the document', charCounter.textContent === `${view.state.doc.length} characters`);
            assert('line count follows the document', lineCounter.textContent === `${view.state.doc.lines} lines`);
            assert('word count follows the document', wordCounter.textContent === '5 words');

            if (!view.dom.clientWidth) {
                skip('editor renders line numbers', 'pane is hidden');
            } else {
                const nums = Array.from(view.dom.querySelectorAll('.cm-lineNumbers .cm-gutterElement')).map((el) => el.textContent);
                const firstVisible = view.state.doc.lineAt(view.viewport.from).number;
                assert('editor renders line numbers', nums.includes(String(firstVisible)));
                // Số dòng đang có con trỏ phải nổi bật hơn (đậm màu) để khớp với "Ln x" ở thanh trạng thái.
                view.dispatch({ selection: { anchor: view.state.doc.line(2).from } });
                const activeGutter = view.dom.querySelector('.cm-activeLineGutter');
                assert('active line number is highlighted in the gutter', !!activeGutter && activeGutter.textContent === '2');
            }

            // Vạch chia mảnh: 1px hay 2px đều được, miễn là mảnh như các đường kẻ khác.
            const divider = getComputedStyle(document.getElementById('pane-resizer'), '::after');
            const thin = (v) => parseFloat(v) > 0 && parseFloat(v) <= 2;
            assert('pane divider is a thin line', thin(divider.width) || thin(divider.height));
        });

        // Fuzz sửa văn bản: kiểm CodeMirror giữ đúng nội dung VÀ app vẫn theo kịp nội dung editor.
        await section('editor edit fuzz', async () => {
            if (!view.dom.clientWidth) {
                skip('progressive highlighting', 'pane is hidden');
                return;
            }
            const doc = [];
            for (let n = 0; n < 300; n++) {
                doc.push(`## Mục ${n}`, '', `đoạn **đậm** và \`code\` cùng [link](https://example.com/${n})`);
                if (n % 17 === 0) doc.push('```js', `const x${n} = ${n};`, '```');
                if (n % 23 === 0) doc.push('<!-- ghi chú -->', '$$', 'x^2 + y^2', '$$');
            }
            // Seed cố định: FAIL phải tái hiện được.
            let seed = 20261030;
            const rand = (n) => {
                seed = (seed * 1103515245 + 12345) & 0x7fffffff;
                return seed % n;
            };
            // Chèn/xoá ở đầu, cuối, giữa dòng, biên lô, dán nhiều dòng và ký hiệu khối.
            const edits = [
                (cur) => ({ from: cur.length, to: cur.length, insert: 'x' }),
                (cur) => ({ from: 0, to: 0, insert: 'x' }),
                (cur) => { const at = rand(cur.length + 1); return { from: at, to: at, insert: 'chữ' }; },
                (cur) => { const at = rand(cur.length + 1); return { from: at, to: at, insert: '\n- mục mới\n' }; },
                (cur) => { const at = rand(cur.length); return { from: at, to: Math.min(at + 1 + rand(40), cur.length), insert: '' }; },
                (cur) => { const at = rand(cur.length + 1); return { from: at, to: at, insert: '```\n' }; },
                (cur) => { const at = rand(cur.length + 1); return { from: at, to: at, insert: '$$' }; },
                (cur) => { const at = rand(cur.length + 1); return { from: at, to: at, insert: '<!--' }; }
            ];
            const applyTo = (cur, change) => cur.slice(0, change.from) + change.insert + cur.slice(change.to);

            const base = doc.join('\n');
            probe(base);
            let ok = true;
            for (let batch = 0; batch < 8; batch++) {
                const steps = 5 + rand(10);
                for (let step = 0; step < steps; step++) {
                    const cur = docText();
                    const change = edits[rand(edits.length)](cur);
                    view.dispatch({ changes: change });
                    if (docText() !== applyTo(cur, change)) ok = false;
                }
            }
            assert('text edit fuzz: content always matches', ok);
            // Editor phải vẫn render được sau loạt sửa (không lỗi cú pháp cây).
            assert('editor still renders after the fuzz', view.dom.querySelectorAll('.cm-line').length > 0);
            // Phần của app: nội dung tab đang mở phải khớp editor sau khi đồng bộ lại.
            handleEditorChange({ state: view.state });
            const fuzzTab = getActiveTab();
            assert('app content tracking matches the editor after the fuzz',
                !!fuzzTab && tabText(fuzzTab) === docText());
            probe(snap.value);
        });

        let mark = results.length;
        if (typeof katex !== 'undefined') await section('KaTeX -> MathML', async () => {
            const inlineHost = document.createElement('div');
            inlineHost.innerHTML = katex.renderToString('E = mc^2', { throwOnError: false, output: 'htmlAndMathml' });
            convertKatexForDoc(inlineHost);
            const inlineMath = inlineHost.querySelector('math');
            assert('katex inline becomes a plain <math>', !!inlineMath && !inlineHost.querySelector('span.katex'));
            assert('katex inline drops the annotation', !!inlineMath && !inlineMath.querySelector('annotation'));

            const alignedHost = document.createElement('div');
            alignedHost.innerHTML = katex.renderToString(
                String.raw`\begin{aligned} a &= 1 \\ b &= 2 \end{aligned}`,
                { throwOnError: false, displayMode: true, output: 'htmlAndMathml' }
            );
            convertKatexForDoc(alignedHost);
            const alignedMath = alignedHost.querySelector('math');
            assert('katex aligned becomes <math> with an mtable', !!alignedMath && !!alignedMath.querySelector('mtable'));
            assert('katex aligned keeps both rows', !!alignedMath && alignedMath.querySelectorAll('mtr').length === 2);

            const strayHost = document.createElement('div');
            strayHost.innerHTML = katex.renderToString('E = mc^2', { throwOnError: false, output: 'mathml' });
            const strayMath = strayHost.querySelector('math');
            strayMath.appendChild(document.createTextNode('E = mc^2'));
            convertKatexForDoc(strayHost);
            const cleanedMath = strayHost.querySelector('math');
            assert('katex cleans bare text nodes inside <math>', !!cleanedMath && !Array.from(cleanedMath.childNodes).some(n => n.nodeType === 3 && n.textContent.trim()));

            const brokenHost = document.createElement('div');
            brokenHost.innerHTML = '<span class="katex">fallback text</span>';
            convertKatexForDoc(brokenHost);
            assert('broken katex fallback becomes text', brokenHost.textContent === 'fallback text' && !brokenHost.querySelector('span.katex'));
        });
        if (results.length === mark) skip('6 assert KaTeX -> MathML', 'katex not loaded');

        mark = results.length;
        await section('find & replace dialog', async () => {
            const previewBefore = previewOutput.innerHTML;
            const viewModeBefore = document.body.className;
            probe('foo Foo food');

            openFindDialog();
            assert('opens the find dialog', isFindDialogOpen());
            assert('dialog has a find field and a replace field', !!findInput && !!replaceInput);
            assert('opening the dialog does not change the view mode', document.body.className === viewModeBefore);
            assert('find panel is anchored in the content area, not a modal',
                document.getElementById('find-dialog').closest('.workspace') !== null);
            assert('replace row is collapsed by default', !document.getElementById('find-dialog').classList.contains('show-replace'));
            document.getElementById('find-toggle-replace').click();
            assert('the toggle button expands the replace row', document.getElementById('find-dialog').classList.contains('show-replace'));

            findInput.value = 'foo';
            runFindSearch();
            assert('finds 3 matches', getFindMatches().length === 3);

            findNextMatch();
            assert('next button selects the first match',
                view.state.selection.main.from === 0 && view.state.selection.main.to === 3);
            findNextMatch();
            assert('next button selects the next match',
                view.state.selection.main.from === 4 && view.state.selection.main.to === 7);
            assert('the selected match is kept after clicking the arrow', getFindActiveIndex() === 1);

            replaceInput.value = 'bar';
            replaceFindAll();
            assert('replace all changes the right content', docText() === 'bar bar bard');
            assert('search does not touch the preview', previewOutput.innerHTML === previewBefore);

            closeFindDialog();
            assert('closes the find dialog', !isFindDialogOpen());
            probe(snap.value);
        });
        if (results.length === mark) skip('find dialog asserts', 'dialog is not in the DOM');

        mark = results.length;
        if (document.getElementById('btn-help')) await section('About dialog', async () => {
            const aboutItems = document.querySelectorAll('.about-item');
            assert('the ? button is the last toolbar button', document.querySelector('.toolbar').lastElementChild.querySelector('#btn-help') !== null);
            assert('the ? button has no dropdown', document.getElementById('help-menu') === null);
            assert('about has 3 doc items', aboutItems.length === 3);

            document.getElementById('btn-help').click();
            assert('clicking ? opens the About modal directly', isInfoDialogOpen());
            assert('the modal opens on the About view', !infoAbout.classList.contains('hidden') && infoDoc.classList.contains('hidden'));
            assert('about shows the version number', /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(document.getElementById('app-version').textContent.trim()));

            // showDoc là async nên phải đợi fetch xong.
            aboutItems[0].click();
            await new Promise((resolve) => {
                const finish = () => { observer.disconnect(); clearTimeout(timer); resolve(); };
                const observer = new MutationObserver(() => {
                    if (infoBody.textContent !== 'Loading...') finish();
                });
                const timer = setTimeout(finish, 3000);
                observer.observe(infoBody, { childList: true, subtree: true, characterData: true });
            });
            assert('clicking an item switches to the doc view', infoAbout.classList.contains('hidden') && !infoDoc.classList.contains('hidden'));
            assert('the license modal reads the file', infoBody.textContent.includes('MIT License'));
            assert('opening a doc focuses the Back button', document.activeElement === document.getElementById('info-back'));
            // Chuỗi flex .dialog-wide > #info-doc > #info-body làm tài liệu dài cuộn trong hộp.
            assert('doc content scrolls inside the dialog', getComputedStyle(infoDoc).display === 'flex'
                && infoBody.getBoundingClientRect().bottom <= infoDialog.querySelector('.dialog').getBoundingClientRect().bottom);

            document.getElementById('info-back').click();
            assert('the Back button returns to the About view', !infoAbout.classList.contains('hidden') && infoDoc.classList.contains('hidden'));

            // Esc = Back: lùi từ tài liệu về About, chưa đóng; showDoc đổi view đồng bộ.
            aboutItems[0].click();
            infoDialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            assert('Esc from the doc view goes back to About, the dialog stays open',
                isInfoDialogOpen() && !infoAbout.classList.contains('hidden') && infoDoc.classList.contains('hidden'));
            infoDialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            assert('Esc from the About view closes the dialog', !isInfoDialogOpen());

            document.getElementById('btn-help').click();
            document.getElementById('info-close').click();
            assert('closes the about modal', !isInfoDialogOpen());
        });
        if (results.length === mark) skip('14 About dialog asserts', 'no #btn-help');

        // Nút Insert của hộp thoại Link bị disabled tới khi có URL: Tab phải bỏ qua nó.
        await section('link dialog focus trap skips the disabled button', async () => {
            const linkDialog = document.getElementById('link-dialog');
            const urlInput = document.getElementById('link-url');
            if (!linkDialog || !urlInput) {
                skip('link dialog focus trap', 'dialog is not in the DOM');
                return;
            }
            linkDialog.classList.remove('hidden');
            try {
                urlInput.focus();
                urlInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
                assert('tab moves past the disabled insert button',
                    document.activeElement === document.getElementById('link-cancel'));
            } finally {
                linkDialog.classList.add('hidden');
            }
        });

        // Data safety: lưu/đóng tab không được mất bản nháp, tab lỗi không được ghi đè file gốc.
        await section('data safety: save and close never lose a draft', async () => {
            const originalId = getActiveTab() ? getActiveTab().id : null;
            const path = 'C:\\selfcheck\\data.md';
            const otherPath = 'C:\\selfcheck\\other.md';
            const draftPath = 'C:\\selfcheck\\draft.md';
            const keepPath = 'C:\\selfcheck\\keep.md';
            const queuePath = 'C:\\selfcheck\\queue.md';
            const fake = makeFakeFs();
            fake.put(path, '# A\n');
            fake.put(draftPath, 'bản nháp\n');
            fake.put(keepPath, 'giữ lại\n');
            let saveTarget = otherPath;
            const tauriStub = stubTauri(fake, { savePath: () => saveTarget });
            // Không gán được global thì tuyệt đối không chạy: test này ghi file.
            if (!tauriStub.ok) {
                tauriStub.restore();
                skip('data safety: save and close never lose a draft', 'window.__TAURI__ could not be stubbed');
                return;
            }
            const created = [];
            // Tab giả: có path, nội dung trên đĩa và mốc mtime khớp để không bị hộp thoại nhầm.
            const openTab = (tabPath, text) => {
                const tab = newTab();
                created.push(tab.id);
                tab.path = tabPath;
                tab.name = tabPath.split('\\').pop();
                tab.content = text;
                tab.savedContent = text;
                tab.eol = '\n';
                tab.diskEol = '\n';
                tab.status = 'ok';
                tab.diskMtime = fake.disk.get(tabPath).mtime;
                probe(text);
                handleEditorChange({ state: view.state });
                return tab;
            };
            try {
                // 1. Tab sạch: không ghi gì xuống đĩa.
                const tab = openTab(path, '# A\n');
                assert('clean tab -> saveTab reports saved', await saveTab(tab) === 'saved');
                assert('clean tab -> nothing was written', !fake.wroteTo(path));

                // 2. Tab bẩn: ghi atomic qua file .tmp, không ghi thẳng đè file gốc.
                probe('# B\n');
                handleEditorChange({ state: view.state });
                assert('dirty tab -> saveTab reports saved', await saveTab(tab) === 'saved');
                assert('dirty tab -> the file on disk has the new content', fake.read(path) === '# B\n');
                assert('dirty tab -> written through the temp file, not straight over the original',
                    !fake.wroteTo(path) && fake.log.some((c) => c[0] === 'write' && c[1] === path + '.md-live.tmp'));
                assert('dirty tab -> clean after saving', isTabDirty(tab) === false);

                // 3. Tab lỗi: tuyệt đối không ghi path cũ, phải đi qua Save As.
                tab.status = 'unreadable';
                probe('# C\n');
                handleEditorChange({ state: view.state });
                fake.log.length = 0;
                assert('error tab -> saveTab reports saved through Save As', await saveTab(tab) === 'saved');
                assert('error tab -> the old path was never written', !fake.wroteTo(path));
                assert('error tab -> the new path received the content', fake.read(otherPath) === '# C\n');
                assert('error tab -> the tab now points at the new path', tab.path === otherPath);

                // 4. Ngoại lệ duy nhất: Save As đúng path cũ của tab lỗi thì phải hỏi "Overwrite anyway".
                tab.path = path;
                tab.status = 'unreadable';
                probe('# D\n');
                handleEditorChange({ state: view.state });
                saveTarget = path;
                fake.log.length = 0;
                const overwriting = saveTab(tab);
                await clickConfirm('primary');
                assert('error tab -> overwriting the same path reports saved', await withTimeout(overwriting) === 'saved');
                assert('error tab -> the old path was written only after the confirmation', fake.read(path) === '# D\n');

                // 5. Lỗi I/O khi ghi file .tmp: file gốc phải còn nguyên.
                tab.status = 'ok';
                probe('# E\n');
                handleEditorChange({ state: view.state });
                fake.failWrite.add(path + '.md-live.tmp');
                fake.log.length = 0;
                assert('io error on the temp file -> saveTab reports failed', await saveTab(tab) === 'failed');
                assert('io error on the temp file -> the original file is untouched', fake.read(path) === '# D\n');
                assert('io error on the temp file -> nothing was written straight over the original', !fake.wroteTo(path));
                fake.failWrite.delete(path + '.md-live.tmp');

                // 6. Không có quyền ghi file .tmp: ghi thẳng file gốc để không mất thay đổi.
                fake.allowTemp = false;
                probe('# F\n');
                handleEditorChange({ state: view.state });
                fake.log.length = 0;
                assert('no temp permission -> saveTab reports saved', await saveTab(tab) === 'saved');
                assert('no temp permission -> the file was written directly', fake.read(path) === '# F\n' && fake.wroteTo(path));
                assert('no temp permission -> no temp file was written',
                    !fake.log.some((c) => c[0] === 'write' && c[1] === path + '.md-live.tmp'));
                fake.allowTemp = true;

                // 7. File biến mất trên đĩa: "File is gone" -> chọn Close tab thì saveTab trả 'discard',
                //    và bản thân diskOkToWrite KHÔNG được đóng tab.
                fake.disk.delete(path);
                probe('# G\n');
                handleEditorChange({ state: view.state });
                const goneSave = saveTab(tab);
                await clickConfirm('secondary');
                assert('file gone -> saveTab reports discard', await withTimeout(goneSave) === 'discard');
                assert('file gone -> the tab is still open (only closeTab closes a tab)',
                    getTabs().some((t) => t.id === tab.id));
                assert('file gone -> the tab is marked as an error', tab.status === 'missing');

                // 8. Tab lỗi phải mang cờ reload để lần sau đọc lại đĩa.
                const wire = serializeSession();
                const rec = wire.tabs.find((t) => t.id === tab.id);
                assert('error tab -> the session flags it for a disk reload',
                    !!rec && rec.reload === true && rec.status === 'missing');
                const discardWire = serializeSession({ discardUnsaved: true });
                const rec2 = discardWire.tabs.find((t) => t.id === tab.id);
                assert('error tab -> quitting without saving drops the draft but keeps the reload flag',
                    !!rec2 && rec2.content === null && rec2.dirty === false && rec2.reload === true);

                // 9. Đóng tab chưa lưu: hỏi trước; "Don't save" thì đóng, hủy thì giữ tab.
                const draft = openTab(draftPath, 'bản nháp\n');
                probe('bản nháp sửa\n');
                handleEditorChange({ state: view.state });
                const closing = closeTab(draft.id);
                await clickConfirm('secondary');
                await withTimeout(closing);
                assert('closing a dirty tab with "Don\'t save" removes the tab',
                    !getTabs().some((t) => t.id === draft.id));
                const keep = openTab(keepPath, 'giữ lại\n');
                probe('giữ lại sửa\n');
                handleEditorChange({ state: view.state });
                const closing2 = closeTab(keep.id);
                await clickConfirm('cancel');
                await withTimeout(closing2);
                assert('cancelling the close prompt keeps the tab open',
                    getTabs().some((t) => t.id === keep.id));

                // 10. Lần lưu thứ hai phải xếp sau lần đầu, không bị bỏ im lặng.
                fake.put(queuePath, 'old\n');
                const queued = openTab(queuePath, 'old\n');
                probe('new\n');
                handleEditorChange({ state: view.state });
                fake.put(queuePath, 'disk\n');
                // Đổi nội dung trên đĩa: mtime phải khác, app so mtime mới hỏi "File changed on disk".
                fake.disk.get(queuePath).mtime += 1;
                const firstSave = saveTab(queued);
                const secondSave = saveTab(queued);
                let secondDone = false;
                secondSave.then(() => { secondDone = true; });
                await new Promise((resolve) => setTimeout(resolve, 20));
                assert('a second save waits while the first is running', !secondDone);
                await clickConfirm('primary');
                assert('the first save completes', await withTimeout(firstSave) === 'saved');
                assert('the queued save completes', await withTimeout(secondSave) === 'saved');
                assert('the queued save writes the latest content', fake.read(queuePath) === 'new\n');
            } finally {
                tauriStub.restore();
                if (originalId !== null) switchTab(originalId);
                for (const id of created) await closeTab(id, { force: true, remember: false });
            }
        });

        // Undo không trộn giữa các tab: mỗi tab một EditorState riêng.
        await section('undo history does not mix between tabs', async () => {
            const originalId = getActiveTab() ? getActiveTab().id : null;
            const created = [];
            try {
                const tabA = newTab();
                created.push(tabA.id);
                probe('alpha');
                const tabB = newTab();
                created.push(tabB.id);
                probe('beta');
                switchTab(tabA.id);
                assert('switching back restores the first tab content', docText() === 'alpha');
                assert('undo works inside the first tab', undo(view) === true && docText() === '');
                switchTab(tabB.id);
                assert('the second tab keeps its own content', docText() === 'beta');
                assert('undo in the second tab does not touch the first tab', undo(view) === true && docText() === '');
                switchTab(tabA.id);
                assert('the first tab is still empty after undoing in the second tab', docText() === '');
            } finally {
                if (originalId !== null) switchTab(originalId);
                for (const id of created) await closeTab(id, { force: true, remember: false });
            }
        });

        // Bộ nhớ: khi tab đã có EditorState thì tab.content là bản sao thừa của cả văn bản.
        await section('a tab drops the duplicate content copy once it has an editor state', async () => {
            const originalId = getActiveTab() ? getActiveTab().id : null;
            const created = [];
            try {
                const tab = newTab();
                created.push(tab.id);
                if (originalId !== null) switchTab(originalId);
                // Giống tab vừa nạp từ đĩa: có content nhưng chưa có state.
                tab.content = '# Nội dung\n';
                tab.savedContent = '# Nội dung\n';
                tab.state = null;
                switchTab(tab.id);
                assert('a tab with an editor state keeps no duplicate content copy', tab.content === '');
                assert('the live text still comes from the editor state', tabText(tab) === '# Nội dung\n');
            } finally {
                if (originalId !== null) switchTab(originalId);
                for (const id of created) await closeTab(id, { force: true, remember: false });
            }
        });

        // Ctrl+1..9 nhảy tới tab thứ N: e.key của phím số là '1'..'9', không phải 'Digit1'.
        await section('ctrl+digit jumps to a tab', async () => {
            const originalId = getActiveTab() ? getActiveTab().id : null;
            const created = [];
            try {
                created.push(newTab().id);
                created.push(newTab().id);
                const firstId = getTabs()[0].id;
                window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', ctrlKey: true, bubbles: true }));
                assert('ctrl+1 jumps to the first tab', getActiveTab().id === firstId);
                switchTab(created[1]);
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', ctrlKey: true, bubbles: true }));
                assert('ctrl+F1 is not treated as ctrl+1', getActiveTab().id === created[1]);
            } finally {
                if (originalId !== null) switchTab(originalId);
                for (const id of created) await closeTab(id, { force: true, remember: false });
            }
        });

        // CSP chặn script từ xa; chống XSS vẫn là việc của JS (DOMPurify). Payload lọt vào preview là lỗi bảo mật.
        await section('preview sanitizes untrusted markdown', async () => {
            const savedValue = docText();
            const payloads = [
                '<script>alert(1)</script>',
                '<img src=x onerror="alert(1)">',
                '<svg onload="alert(1)"><circle r="10"/></svg>',
                '[link](javascript:alert(1))',
                '<a href="javascript:alert(1)">x</a>',
                '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
                '<form action="javascript:alert(1)"><button formaction="javascript:alert(1)">go</button></form>'
            ];
            for (const payload of payloads) {
                probe(payload);
                renderMarkdown();
                const html = previewOutput.innerHTML;
                assert(`xss payload dropped: ${payload.slice(0, 30)}`,
                    !/<script/i.test(html)
                    && !/\son[a-z]+\s*=/i.test(html)
                    && !/javascript:/i.test(html)
                    && !/srcdoc/i.test(html));
            }
            // CSS trong Markdown phải bị loại: <style> áp lên cả app, style= che cửa sổ bằng overlay.
            probe('<style>*{display:none!important}</style>');
            renderMarkdown();
            assert('css <style> block is dropped', !/<style/i.test(previewOutput.innerHTML));
            probe('<div style="position:fixed;inset:0;z-index:2147483647">x</div>');
            renderMarkdown();
            assert('inline style attribute is dropped', !/\sstyle=/i.test(previewOutput.innerHTML));
            // <form> phải bị loại: bấm nút submit làm cửa sổ tải lại hoặc trắng.
            probe('<form action="https://evil.example"><input type="text"><button>go</button></form>');
            renderMarkdown();
            assert('html <form> is dropped', !/<form/i.test(previewOutput.innerHTML));
            // <input> thì phải giữ: task list cần nó.
            probe('- [ ] việc cần làm');
            renderMarkdown();
            assert('task list checkbox (input) is kept', !!previewOutput.querySelector('input[type="checkbox"]'));

            // Link ngoài mở tab mới kèm rel an toàn; anchor trong tài liệu thì không.
            probe('[ngoài](https://example.com) và [trong](#muc)');
            renderMarkdown();
            const ext = previewOutput.querySelector('a[href^="https://"]');
            const anchor = previewOutput.querySelector('a[href^="#"]');
            assert('external link opens in a new tab with noopener noreferrer',
                !!ext && ext.getAttribute('target') === '_blank'
                && /noopener/.test(ext.getAttribute('rel') || '')
                && /noreferrer/.test(ext.getAttribute('rel') || ''));
            assert('anchor link stays in the same tab',
                !!anchor && !anchor.hasAttribute('target') && !anchor.hasAttribute('rel'));
            // Mermaid tự sinh SVG chưa lọc: phải lọc lại trước khi tin và cache.
            if (typeof DOMPurify !== 'undefined') {
                const clean = DOMPurify.sanitize(
                    '<svg><script>alert(1)</script><foreignObject><div>nhãn</div></foreignObject></svg>',
                    MERMAID_SANITIZE_CONFIG
                );
                assert('mermaid svg is sanitized again: no script', !/<script/i.test(clean));
                assert('mermaid svg keeps the label', clean.includes('nhãn'));
            } else {
                skip('mermaid svg is sanitized again: no script', 'DOMPurify not loaded');
            }
            probe(savedValue);
            renderMarkdown();
        });

        // Link reference ([docs][d]) lấy địa chỉ từ dòng định nghĩa: đổi định nghĩa phải cập nhật preview.
        await section('preview follows reference link definitions', async () => {
            const savedValue = docText();
            probe('See [docs][d] here.\n\n[d]: https://old.example\n');
            renderMarkdown();
            assert('reference link resolves to its definition',
                !!previewOutput.querySelector('a[href="https://old.example"]'));
            probe('See [docs][d] here.\n\n[d]: https://new.example\n');
            renderMarkdown();
            assert('changing the definition updates the preview link',
                !!previewOutput.querySelector('a[href="https://new.example"]')
                && !previewOutput.querySelector('a[href="https://old.example"]'));
            probe(savedValue);
            renderMarkdown();
        });

        // Cache Mermaid phải khoá theo MÃ NGUỒN: đọc textContent sau khi vẽ là text của SVG.
        await section('mermaid cache is keyed by the diagram source', async () => {
            if (typeof mermaid === 'undefined') {
                skip('mermaid cache is keyed by the diagram source', 'mermaid not loaded');
                return;
            }
            const savedValue = docText();
            const source = 'graph TD;\n  A-->B;';
            probe('```mermaid\n' + source + '\n```');
            renderMarkdown();
            // Đọc mã nguồn TRƯỚC khi Mermaid vẽ: sau khi vẽ thì textContent là text của SVG.
            const pre = previewOutput.querySelector('pre.mermaid');
            const code = pre ? pre.textContent : '';
            flushLazyRenders();
            await whenMermaidIdle();
            if (!previewOutput.querySelector('pre.mermaid svg')) {
                skip('mermaid cache is keyed by the diagram source', 'mermaid did not render in this environment');
                probe(savedValue);
                renderMarkdown();
                return;
            }
            assert('mermaid cache is keyed by the diagram source', !!code && mermaidCache.has(code));
            // Dựng lại từ đầu (node Mermaid mới): lần này phải lấy SVG từ cache.
            resetBlocks();
            renderMarkdown();
            flushLazyRenders();
            await whenMermaidIdle();
            assert('mermaid diagram comes from the cache on the second draw',
                previewOutput.querySelector('pre.mermaid')?.dataset.mermaidCached === 'true');
            probe(savedValue);
            renderMarkdown();
        });

        // Đổi theme chỉ đổi CSS: biểu đồ Mermaid luôn vẽ theme sáng nên không được vẽ lại.
        await section('theme switch keeps the mermaid diagram untouched', async () => {
            if (typeof mermaid === 'undefined' || !btnTheme) {
                skip('theme switch keeps the mermaid diagram untouched', 'mermaid or theme button not available');
                return;
            }
            const savedValue = docText();
            const savedTheme = document.documentElement.getAttribute('data-theme');
            probe('```mermaid\ngraph TD;\n  A-->B;\n```');
            renderMarkdown();
            flushLazyRenders();
            await whenMermaidIdle();
            const svg = previewOutput.querySelector('pre.mermaid svg');
            if (!svg) {
                skip('theme switch keeps the mermaid diagram untouched', 'mermaid did not render in this environment');
                probe(savedValue);
                renderMarkdown();
                return;
            }
            const nodeFill = svg.querySelector('.node rect');
            const fillRgb = (nodeFill ? getComputedStyle(nodeFill).fill : '').match(/\d+/g);
            const isLight = !!fillRgb && (Number(fillRgb[0]) + Number(fillRgb[1]) + Number(fillRgb[2])) / 3 > 200;
            assert('mermaid diagram is painted with the light theme', isLight);

            btnTheme.click();
            // View Transitions chạy bất đồng bộ: chờ theme đổi xong rồi mới so node.
            for (let i = 0; i < 40 && document.documentElement.getAttribute('data-theme') === savedTheme; i++) {
                await new Promise((r) => setTimeout(r, 50));
            }
            const newTheme = document.documentElement.getAttribute('data-theme');
            assert('theme switch really changes the theme', !!newTheme && newTheme !== savedTheme);
            assert('theme switch does not redraw the mermaid diagram',
                previewOutput.querySelector('pre.mermaid svg') === svg);

            // Trả theme về như cũ: nút Theme ghi lựa chọn vào localStorage.
            if (document.documentElement.getAttribute('data-theme') !== savedTheme) btnTheme.click();
            probe(savedValue);
            renderMarkdown();
        });

        // Tìm & thay thế: regex, nhóm bắt, regex hỏng.
        await section('find and replace: regex, groups, invalid pattern', async () => {
            const savedValue = docText();
            const nums = findMatches('a1 b22 c333', '(\\w)(\\d+)', { useRegex: true });
            assert('regex finds every number', nums.matches.length === 3 && nums.matches[2].hit === 'c333');
            assert('regex keeps the capture groups',
                !!nums.matches[0].groups && nums.matches[0].groups[0] === 'a' && nums.matches[0].groups[1] === '1');
            const bad = findMatches('abc', '(unclosed', { useRegex: true });
            assert('invalid regex -> error, no match', bad.error !== '' && bad.matches.length === 0);
            const empty = findMatches('abc', 'x*', { useRegex: true });
            assert('an empty regex match does not loop forever', empty.matches.length === 0);
            assert('regex dot matches any character', findMatches('a.b', '.', { useRegex: true }).matches.length === 3);
            assert('search is case-insensitive by default', findMatches('Foo foo', 'foo').matches.length === 2);
            assert('match case narrows the hits', findMatches('Foo foo', 'foo', { matchCase: true }).matches.length === 1);
            assert('the search term is escaped when it is not a regex', findMatches('a.b', 'a.b').matches.length === 1);

            probe('name: value');
            openFindDialog();
            findRegex.checked = true;
            findInput.value = '(\\w+): (\\w+)';
            runFindSearch();
            findNextMatch();
            replaceInput.value = '$2: $1';
            replaceFindCurrent();
            assert('regex groups are expanded when replacing', docText() === 'value: name');

            probe('foo abc');
            findInput.value = 'foo';
            runFindSearch();
            findNextMatch();
            replaceInput.value = "[$'|$&]";
            replaceFindCurrent();
            assert('$\' and $& are expanded when replacing', docText() === '[ abc|foo] abc');

            findRegex.checked = false;
            const many = Array(5100).fill('x').join(' ');
            const capped = findMatches(many, 'x');
            assert('search marks the 5,000 cap', capped.matches.length === 5000 && capped.truncated === true);
            probe(many);
            findInput.value = 'x';
            replaceInput.value = 'y';
            runFindSearch();
            replaceFindAll();
            assert('Replace All replaces every match past the cap', docText() === Array(5100).fill('y').join(' '));
            findInput.value = '';
            replaceInput.value = '';
            closeFindDialog();
            probe(savedValue);
        });

        // Thanh định dạng: list task/quote, toggle heading, khối code.
        await section('format toolbar: lists, headings, code fence', async () => {
            probe('mục một');
            applyListStyle('task');
            assert('task style adds an unchecked box', docText() === '- [ ] mục một');
            probe('mục một');
            applyListStyle('quote');
            assert('quote style prefixes the line', docText() === '> mục một');
            probe('### a\n### b', 0, 9);
            applyHeadingLevel(3);
            assert('heading toggles off when every line has the same level', docText() === 'a\nb');
            applyHeadingLevel(3);
            assert('heading toggles back on', docText() === '### a\n### b');
            probe('', 0, 0);
            insertBlockFence('code');
            assert('code fence inserts a js block', docText() === '```js\n// code here\n```');
            assert('code fence puts the caret inside the block', view.state.selection.main.head === 6);
            probe('', 0, 0);
            insertBlockFence('math');
            assert('math fence inserts a $$ block', docText() === '$$\nf(x) = \\int_{-\\infty}^{\\infty} e^{-x^2} dx\n$$');
            assert('math fence puts the caret on the formula line', view.state.selection.main.head === 3);
            probe('let x = 1;', 0, 10);
            insertBlockFence('code');
            assert('the selection becomes the body of the fence', docText() === '```js\n    let x = 1;\n```');
        });

        // Bật/tắt định dạng: **, *, và nhánh "cặp nằm trong cặp dài hơn".
        await section('bold and italic toggle', async () => {
            probe('**đậm**', 2, 5);
            wrapOrToggleFormat('**');
            assert('bold toggles off when the selection is already wrapped', docText() === 'đậm');
            probe('*nghiêng*', 1, 8);
            wrapOrToggleFormat('*');
            assert('italic toggles off when the selection is already wrapped', docText() === 'nghiêng');
            probe('chữ', 0, 3);
            wrapOrToggleFormat('**');
            assert('bold wraps a plain selection', docText() === '**chữ**');
            probe('**đậm**', 2, 5);
            wrapOrToggleFormat('*');
            assert('italic does not strip the outer ** pair', docText() === '***đậm***');
            probe('', 0, 0);
            wrapOrToggleFormat('**');
            assert('bold with no selection inserts an empty pair', docText() === '****');
            assert('the caret lands between the marks', view.state.selection.main.head === 2);
        });

        // Đọc file rồi ghi lại: BOM và EOL phải y hệt byte gốc.
        await section('file round-trip: BOM, EOL and legacy encoding', async () => {
            const original = '\uFEFFTiêu đề\r\nDòng hai\r\n';
            const decoded = decodeTextBytes(new TextEncoder().encode(original));
            assert('a UTF-8 BOM file decodes with the BOM kept',
                !!decoded && decoded.text === original && decoded.encoding === 'UTF-8' && decoded.converted === false);
            const content = toLf(stripBom(decoded.text));
            const eol = detectEol(decoded.text);
            const bom = detectBom(decoded.text);
            assert('BOM and EOL are detected from the raw text', bom === true && eol === '\r\n');
            assert('saving the file writes back the original bytes',
                (bom ? '\uFEFF' : '') + applyEol(content, eol) === original);
            const utf8 = 'café tiếng Việt\n';
            const plain = decodeTextBytes(new TextEncoder().encode(utf8));
            assert('a UTF-8 file keeps the Vietnamese diacritics',
                !!plain && plain.text === utf8 && plain.converted === false);
            const legacy = decodeTextBytes(Uint8Array.from([0x63, 0x61, 0x66, 0xe9]));
            assert('a windows-1252 file is read as text',
                !!legacy && legacy.text === 'café' && legacy.converted === true && legacy.encoding === 'Windows-1252');
            assert('a converted file is written back as UTF-8',
                new TextDecoder().decode(new TextEncoder().encode(legacy.text)) === 'café');
        });

        // Preview: alert, task list, tiền không phải công thức, giới hạn kích thước.
        await section('preview edge cases', async () => {
            const savedValue = docText();
            probe('> [!NOTE]\n> Nội dung cảnh báo');
            renderMarkdown();
            const alertBox = previewOutput.querySelector('.markdown-alert');
            assert('GFM alert becomes an alert block',
                !!alertBox && alertBox.classList.contains('markdown-alert-note'));
            const alertTitle = previewOutput.querySelector('.markdown-alert-title');
            assert('alert gets a title', !!alertTitle && alertTitle.textContent.includes('Note'));
            assert('alert drops the [!NOTE] marker', !previewOutput.textContent.includes('[!NOTE]'));
            probe('- [x] xong\n- [ ] chưa');
            renderMarkdown();
            const boxes = previewOutput.querySelectorAll('input[type="checkbox"]');
            assert('task list renders a checkbox per item', boxes.length === 2);
            assert('task list keeps the ticked state',
                !!boxes[0] && boxes[0].checked === true && !!boxes[1] && boxes[1].checked === false);
            probe('Giá $5 và $6');
            renderMarkdown();
            assert('money is not treated as math', !previewOutput.querySelector('.math-slot'));
            assert('money stays in the text', previewOutput.textContent.includes('$5 và $6'));
            probe('x'.repeat(PREVIEW_MAX_CHARS + 10));
            renderMarkdown();
            assert('a huge document shows the too-large notice', !!previewOutput.querySelector('.preview-too-large'));
            probe(savedValue);
            renderMarkdown();
        });

    } catch (err) {
        console.error('Self-check aborted:', err);
        results.push(`FAIL - self-check aborted midway: ${err && err.message ? err.message : err}`);
    } finally {
        if (isInfoDialogOpen()) document.getElementById('info-close').click();
        // Trả editor về đúng trạng thái trước khi thử rồi bật lại đồng bộ của app.
        if (docText() !== snap.value) probe(snap.value, snap.selStart, snap.selEnd);
        view.dispatch({
            selection: { anchor: snap.selStart, head: snap.selEnd },
            scrollIntoView: false
        });
        view.scrollDOM.scrollTop = snap.scrollTop;
        previewOutput.scrollTop = snap.previewScrollTop;
        setChangeHandler(handleEditorChange);
        // Dựng lại char counter, preview, tab và nháp phiên từ nội dung thật.
        handleEditorChange({ state: view.state });
    }

    // Đếm theo tiền tố dòng; tổng = results.length nên toast luôn khớp console.
    const failed = results.filter(r => r.startsWith('FAIL'));
    const skipped = results.filter(r => r.startsWith('SKIP'));
    const passed = results.length - failed.length - skipped.length;
    const report = `${passed}/${results.length} PASS`;
    (failed.length ? console.error : console.log)('Self-check Import/Export:\n' + results.join('\n'));
    // Từng dòng FAIL log riêng: báo cáo gộp bị console cắt bớt nên không thấy lỗi.
    failed.forEach((line) => console.error(line));
    console.log(`Self-check summary: ${report}, ${skipped.length} SKIP, ${failed.length} FAIL`);
    if (failed.length || skipped.length) {
        showToast(`Self-check: ${report}, ${skipped.length} SKIP, ${failed.length} FAIL (see console)`);
    } else {
        showToast(`Self-check: ${report}`);
    }
    // Kết quả nằm trong DOM (để mở bằng tay thấy) và được POST cho runner của CI.
    const summary = `Self-check summary: ${report}, ${skipped.length} SKIP, ${failed.length} FAIL`;
    const marker = document.createElement('div');
    marker.id = 'selfcheck-result';
    marker.textContent = summary;
    document.body.appendChild(marker);
    failed.forEach((line) => {
        const item = document.createElement('div');
        item.className = 'selfcheck-failure';
        item.textContent = line;
        marker.appendChild(item);
    });
    postSelfCheckResult(summary, failed);
}