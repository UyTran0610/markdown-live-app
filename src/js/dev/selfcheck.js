// js/dev/selfcheck.js — Self-check nhanh, mở app với ?selfcheck.

import { findInput, infoAbout, infoBody, infoDialog, infoDoc, previewOutput, replaceInput, tableMenu, toast } from '../core/dom.js';
import { showToast } from '../core/toast.js';
import { isSafeExternalUrl, slugifyText } from '../core/utils.js';
import {
    EditorView,
    getDocText,
    getView,
    handleTypedChar,
    redo,
    setChangeHandler,
    undo
} from '../editor/cm.js';
import {
    closeFindDialog,
    findNextMatch,
    getFindActiveIndex,
    getFindMatches,
    isFindDialogOpen,
    openFindDialog,
    replaceFindAll,
    runFindSearch
} from '../editor/find.js';
import { applyHeadingLevel, applyListStyle, insertTableBlock } from '../editor/format-actions.js';
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
import { applyEol, decodeTextBytes, deriveDocumentTitle, deriveExportBaseName, detectBom, detectEol, hashText, mtimeOf, readErrorMessage, readTextFile, sameFilePath, stripBom, toLf, writeTextFile } from '../export/file-save.js';
import { buildStandaloneHtml } from '../export/html.js';
import { fitDocImageSize, flattenForeignObjects, isSvgImageSrc } from '../export/images.js';
import { katexFontKey, parseKatexFontFaces } from '../export/math-fonts.js';
import { convertKatexForDoc } from '../export/math-mathml.js';
import { makeExclusive } from '../export/menu.js';
import { isTabDirty, isMarkdownPath, deserializeSession, diskRevision, getActiveTab, needsSave, serializeSession, sessionKeepsContent, setTabReadOnly, suggestSavePath, untitledName } from '../io/documents.js';
import { sessionFingerprint } from '../io/session-store.js';
import { escapeHtml } from '../ui/confirm-dialog.js';
import { assignHeadingIds, flushLazyRenders, renderMarkdown } from '../preview/render.js';
import { diffBlocks } from '../preview/blocks.js';
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

        // EOL: file Windows là CRLF, textarea là LF; nhớ kiểu file để lần lưu không đổi mọi dòng.
        assert('eol detects a CRLF file', detectEol('a\r\nb') === '\r\n');
        assert('eol detects an LF file', detectEol('a\nb') === '\n');
        assert('eol detects a single-line file', detectEol('abc') === '\n');
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
        assert('ghost bar mid-range -> offset by half the width', ghostOffsetPx(50, 1000) === 497.5);
        assert('ghost bar at left edge -> negative half-thickness offset', ghostOffsetPx(0, 1000) === -2.5);

        // Render preview phải giãn debounce theo độ dài: tài liệu lớn render 1.1–2.2s,
        // chạy giữa lúc gõ sẽ cướp main thread.
        assert('small file render waits 300ms', renderDelayFor(0) === 300);
        assert('99k file render waits 300ms', renderDelayFor(99000) === 300);
        assert('100k file render waits 450ms', renderDelayFor(100000) === 450);
        assert('200k file render waits 600ms', renderDelayFor(200000) === 600);
        assert('400k file render waits 900ms', renderDelayFor(400000) === 900);
        assert('very large file render stays under 1s', renderDelayFor(5000000) === 1000);

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
            // serializeSession() chạy trên tab thật: mọi tab lỗi phải mang cờ reload.
            const liveWire = serializeSession();
            assert('serializeSession flags reload for every error tab', liveWire.tabs.every((t) => t.reload === (t.status !== 'ok')));
            assert('serializeSession keeps the default EOL', liveWire.defaultEol === '\n' || liveWire.defaultEol === '\r\n');
            const discardWire = serializeSession({ discardUnsaved: true });
            assert('serializeSession drops drafts when quitting without saving', discardWire.tabs.every((t) => t.content === null && t.dirty === false && t.savedHash === null && t.savedLen === null));
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
            // File toàn 0x7F là UTF-8 hợp lệ, nhưng không được mở như file Windows-125x.
            const dels = decodeTextBytes(new Uint8Array(512).fill(0x7f));
            assert('all-0x7F file -> not opened as Windows-125x',
                !dels || (dels.encoding !== 'Windows-1252' && dels.encoding !== 'Windows-1258'));

            // Windows-125x cũ: giữ đúng chữ, không U+FFFD.
            const win1252 = decodeTextBytes(bytes(0x63, 0x61, 0x66, 0xe9, 0x0a));
            assert('windows-1252 file -> keeps the é accent', !!win1252 && win1252.text.indexOf('\u00e9') !== -1);
            assert('windows-1252 file -> no U+FFFD characters', !!win1252 && win1252.text.indexOf('\ufffd') === -1);
            assert('windows-1252 file -> reports the conversion', !!win1252 && win1252.converted === true);

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

        // readOnly phải sống cùng session, nếu không mỗi lần khởi động lại mở khoá gõ.
        await section('session keeps the read-only flag', async () => {
            const ro = deserializeSession(JSON.stringify({
                activeId: 1, tabs: [{ id: 1, path: 'C:\\big.md', name: 'big.md', content: 'x', dirty: false, eol: '\n', bom: false, readOnly: true }]
            }));
            assert('session keeps the read-only flag of a large tab', ro.tabs[0].readOnly === true);
            const normal = deserializeSession(JSON.stringify({
                activeId: 1, tabs: [{ id: 1, path: 'C:\\a.md', name: 'a.md', content: 'x', dirty: false, eol: '\n', bom: false }]
            }));
            assert('session missing read-only -> defaults to editable', normal.tabs[0].readOnly === false);
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
            assert('Enter on an empty list line -> leaves the list', !docText().includes('- '));
            probe('- done', 6, 6);
            enter.run(view);
            assert('Enter on a normal list line -> new line with the same bullet', docText() === '- done\n- ');
            probe('- [x] việc', 10, 10);
            enter.run(view);
            assert('Enter on a ticked task -> new unticked task', docText().includes('[ ]'));
            probe('    code', 8, 8);
            const handledPlain = enter.run(view);
            // markdownKeymap không xử lý dòng thường: trả false để default insert newline.
            if (!handledPlain) view.dispatch({ changes: { from: 8, to: 8, insert: '\n' }, selection: { anchor: 9, head: 9 } });
            assert('Enter on an indented plain line -> newline', docText().includes('\n'));
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
        assert('doc caps a wide image at 650 keeping the ratio', fitWide.width === 650 && fitWide.height === 325);
        const fitSmall = fitDocImageSize(400, 200);
        assert('doc keeps a small image as-is', fitSmall.width === 400 && fitSmall.height === 200);
        const fitTall = fitDocImageSize(500, 1800);
        assert('doc caps a tall image at 900 keeping the ratio', fitTall.width === 250 && fitTall.height === 900);
        assert('doc skips unusual sizes', fitDocImageSize(0, 0).width === 0);
        assert('doc treats a shields.io badge as SVG', isSvgImageSrc('https://img.shields.io/badge/Tauri-v2.0-24C8DB') === true);
        assert('doc treats the .svg extension as SVG', isSvgImageSrc('https://example.com/a.svg?x=1') === true);
        assert('doc does not treat png as SVG', isSvgImageSrc('https://example.com/a.png') === false);

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
        await section('block render by prefix/suffix', async () => {
            const savedValue = docText();
            const doc = 'Alpha para một\n\nBeta para hai\n\nGamma para ba';
            probe(doc);
            renderMarkdown();
            const before = [...previewOutput.children];
            probe('Alpha para một\n\nBeta para SỬA\n\nGamma para ba');
            renderMarkdown();
            const after = [...previewOutput.children];
            assert('unchanged block keeps its node (prefix/suffix)', after[0] === before[0] && after[2] === before[2]);
            assert('changed block gets its node replaced', after[1] !== before[1]);
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
            const text = '# Tiêu đề\n\nđoạn **đậm** và `code` cùng [link](https://example.com)\n';
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
        });

        await section('progressive highlighting', async () => {
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
}