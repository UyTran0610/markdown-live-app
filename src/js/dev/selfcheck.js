// js/dev/selfcheck.js — Self-check nhanh, mở app với ?selfcheck.

import { infoAbout, infoBody, infoDialog, infoDoc, previewOutput, tableMenu } from '../core/dom.js';
import { isResizingPanes, setPanesResizing } from '../core/flags.js';
import { showToast } from '../core/toast.js';
import { isSafeExternalUrl, slugifyText } from '../core/utils.js';
import {
    closeSearchPanel,
    EditorView,
    findNext,
    getDocText,
    getSearchQuery,
    getView,
    handleTypedChar,
    openSearchPanel,
    redo,
    replaceAll,
    setChangeHandler,
    undo
} from '../editor/cm.js';
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
import { applyEol, decodeTextBytes, deriveDocumentTitle, deriveExportBaseName, detectBom, detectEol, hashText, mtimeOf, sameFilePath, stripBom, toLf } from '../export/file-save.js';
import { buildStandaloneHtml } from '../export/html.js';
import { fitDocImageSize, flattenForeignObjects, isSvgImageSrc } from '../export/images.js';
import { katexFontKey, parseKatexFontFaces } from '../export/math-fonts.js';
import { convertKatexForDoc } from '../export/math-mathml.js';
import { makeExclusive } from '../export/menu.js';
import { isTabDirty, isMarkdownPath, deserializeSession, diskRevision, getActiveTab, serializeSession, sessionKeepsContent, setTabReadOnly, suggestSavePath, untitledName } from '../io/documents.js';
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
            results.push(`FAIL - ${name}: ném lỗi ${err && err.message ? err.message : err}`);
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

        assert('filename từ heading có dấu', deriveExportBaseName('# Trình soạn thảo Markdown Live\n\nnội dung') === 'trinh-soan-thao-markdown-live');
        assert('filename bỏ ký tự đặc biệt', deriveExportBaseName('# Tiêu đề (v1.2)!') === 'tieu-de-v12');
        assert('filename fallback khi không có heading', deriveExportBaseName('không có heading') === 'document');
        assert('filename giữ H1 tiếng Nhật', deriveExportBaseName('# 季度報告書') === '季度報告書');
        assert('filename giữ H1 tiếng Nga', deriveExportBaseName('# Отчёт за Q3') === 'отчёт-за-q3');
        assert('filename loại ký tự cấm trong tên file', deriveExportBaseName('# a/b:c*d?e"f<g>h|i') === 'abcdefghi');
        assert('filename bỏ heading trong code fence', deriveExportBaseName('```md\n# comment\n```\n\n# Real Title') === 'real-title');

        // EOL: file Windows là CRLF, textarea là LF; nhớ kiểu file để lần lưu không đổi mọi dòng.
        assert('eol nhận file CRLF', detectEol('a\r\nb') === '\r\n');
        assert('eol nhận file LF', detectEol('a\nb') === '\n');
        assert('eol nhận file một dòng', detectEol('abc') === '\n');
        assert('eol chuẩn hoá CRLF và CR cũ về LF', toLf('a\r\nb\rc') === 'a\nb\nc');
        assert('eol ghi lại đúng CRLF của file', applyEol('a\nb', '\r\n') === 'a\r\nb');
        assert('eol giữ nguyên LF', applyEol('a\nb', '\n') === 'a\nb');
        // BOM trước # làm mất heading đầu và tiêu đề export.
        assert('bom nhận file có BOM', detectBom('\uFEFF# A') === true);
        assert('bom file thường', detectBom('# A') === false);
        assert('bom file rỗng', detectBom('') === false);
        assert('bom bỏ sạch ký tự đầu', stripBom('\uFEFF# A') === '# A');
        assert('bom file không BOM thì giữ nguyên', stripBom('# A') === '# A');
        assert('bom bỏ đi thì dòng đầu lại là heading', deriveDocumentTitle(stripBom('\uFEFF# A\nx')) === 'A');
        // Cùng một file không được mở thành hai tab (hai tab ghi đè nhau).
        assert('path Windows không phân biệt hoa thường và dấu gạch', sameFilePath('C:\\Docs\\A.md', 'c:/docs/a.md') === true);
        assert('path khác thư mục vẫn khác file', sameFilePath('/x/a.md', '/y/a.md') === false);
        assert('path thiếu đường dẫn không khớp', sameFilePath(null, '/x/a.md') === false);

        await section('khối #1', async () => {
            const noOverflow = tabScrollState(400, 400, 0);
            assert('tab không tràn -> không fade, không nút cuộn', !noOverflow.canScroll && !noOverflow.left && !noOverflow.right);
            const mid = tabScrollState(1000, 400, 100);
            assert('tab tràn giữa chừng -> fade + nút ở cả hai mép', mid.canScroll && mid.left && mid.right);
            const end = tabScrollState(1000, 400, 600);
            assert('tab cuộn hết sang phải -> tắt nút phải', end.canScroll && end.left && !end.right);
        });

        await section('khối #2', async () => {
            const rects = [{ left: 0, width: 100 }, { left: 100, width: 100 }, { left: 200, width: 100 }];
            assert('kéo sang trái mép giữa -> chèn đầu', dropIndex(rects, 40) === 0);
            assert('kéo sang phải mép giữa -> chèn sau', dropIndex(rects, 60) === 1);
            assert('kéo quá mép phải -> chèn cuối', dropIndex(rects, 900) === 3);
            assert('không còn tab nào -> chèn cuối', dropIndex([], 120) === 0);
        });

        assert('split clamp dưới ngưỡng', computeSplitPercent(-50, 1000) === SPLIT_MIN_PERCENT);
        assert('split clamp trên ngưỡng', computeSplitPercent(9999, 1000) === SPLIT_MAX_PERCENT);
        assert('split giữa vùng', computeSplitPercent(500, 1000) === 50);
        assert('split workspace rỗng -> 50', computeSplitPercent(10, 0) === 50);
        assert('kéo sát trái -> preview', computeViewModeFromPercent(1) === 'preview');
        assert('kéo sát phải -> editor', computeViewModeFromPercent(99) === 'editor');
        assert('kéo giữa -> split', computeViewModeFromPercent(50) === 'split');
        assert('view mode rác bị từ chối', isValidViewMode('abc') === false && isValidViewMode('') === false);
        assert('view mode hợp lệ được nhận', isValidViewMode('editor') && isValidViewMode('split') && isValidViewMode('preview'));

        // Kéo thanh chia: ngưỡng ghost, vị trí thanh ảo, cờ đang kéo pane.
        assert('tài liệu nhỏ kéo live', usesGhostDrag(GHOST_DRAG_MIN_CHARS) === false);
        assert('tài liệu lớn kéo ghost', usesGhostDrag(GHOST_DRAG_MIN_CHARS + 1) === true);
        assert('ngưỡng ghost là 100k ký tự', GHOST_DRAG_MIN_CHARS === 100000);
        assert('thanh ảo giữa vùng -> lệch nửa bề rộng', ghostOffsetPx(50, 1000) === 497.5);
        assert('thanh ảo ở mép trái -> lệch âm nửa bề dày', ghostOffsetPx(0, 1000) === -2.5);
        assert('cờ kéo pane mặc định tắt', isResizingPanes() === false);
        setPanesResizing(true);
        assert('cờ kéo pane bật khi đang kéo', isResizingPanes() === true);
        setPanesResizing(false);
        assert('cờ kéo pane tắt lại sau khi kéo', isResizingPanes() === false);

        // Render preview phải giãn debounce theo độ dài: tài liệu lớn render 1.1–2.2s,
        // chạy giữa lúc gõ sẽ cướp main thread.
        assert('render file nhỏ chờ 300ms', renderDelayFor(0) === 300);
        assert('render file 99k chờ 300ms', renderDelayFor(99000) === 300);
        assert('render file 100k chờ 450ms', renderDelayFor(100000) === 450);
        assert('render file 200k chờ 600ms', renderDelayFor(200000) === 600);
        assert('render file 400k chờ 900ms', renderDelayFor(400000) === 900);
        assert('render file rất lớn không vượt 1s', renderDelayFor(5000000) === 1000);

        assert('safe url allows https', isSafeExternalUrl('https://example.com/a?b=1') === true);
        assert('safe url allows mailto', isSafeExternalUrl('mailto:a@b.com') === true);
        assert('safe url chặn ftp (ACL opener không nhận)', isSafeExternalUrl('ftp://host/f.md') === false);
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
            skip('sanitize keeps mermaid labels', 'DOMPurify chưa tải');
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
        assert('open gate không nhận đuôi trùng trong tên', isMarkdownPath('a.md.exe') === false);

        // Session round-trip: giữ tab + tab đang mở + quy tắc chưa lưu.
        await section('khối #3', async () => {
            // Đúng shape serializeSession(): history không lưu, dirty là boolean.
            const wire = (id, path, name, content, savedContent, eol = '\n', bom = false) => ({
                id, path, name, content, eol, bom, dirty: isTabDirty({ content, savedContent }), scrollTop: 0, selStart: 0, selEnd: 0
            });
            assert('tab sạch khi content khớp savedContent', isTabDirty({ content: '# A', savedContent: '# A' }) === false);
            assert('tab dirty khi content khác savedContent', isTabDirty({ content: '# B2', savedContent: '# B' }) === true);
            assert('tab chưa lưu bao giờ cũng dirty', isTabDirty({ content: 'x', savedContent: null }) === true);

            const back = deserializeSession(JSON.stringify({
                activeId: 2,
                tabs: [wire(1, '/a.md', 'a.md', '# A', '# A'), wire(2, '/b.md', 'b.md', '# B2', '# B'), wire(3, null, 'Untitled', 'x', null)]
            }));
            assert('session giữ số tab', back.tabs.length === 3);
            assert('session giữ tab đang mở', back.activeId === 2);
            assert('session giữ nội dung', back.tabs[1].content === '# B2');
            assert('session giữ đường dẫn', back.tabs[0].path === '/a.md');
            assert('tab sạch lúc đóng vẫn sạch sau khi mở lại', isTabDirty(back.tabs[0]) === false);
            assert('tab sửa lúc đóng vẫn dirty sau khi mở lại', isTabDirty(back.tabs[1]) === true);
            assert('tab chưa lưu vẫn dirty sau khi mở lại', isTabDirty(back.tabs[2]) === true);

            // Tab có content không đọc lại đĩa; mất eol là Ctrl+S ghi đè CRLF bằng LF.
            const crlf = deserializeSession(JSON.stringify({ activeId: 1, tabs: [wire(1, 'C:\\a.md', 'a.md', '# A', '# A', '\r\n')] }));
            assert('session giữ kiểu xuống dòng CRLF', crlf.tabs[0].eol === '\r\n');
            assert('session thiếu eol -> mặc định LF', back.tabs[0].eol === '\n');

            // BOM cũng phải sống cùng session, nếu không file gốc mất BOM ở lần lưu sau.
            const bomBack = deserializeSession(JSON.stringify({ activeId: 1, tabs: [wire(1, 'C:\\a.md', 'a.md', '# A', '# A', '\n', true)] }));
            assert('session giữ cờ BOM', bomBack.tabs[0].bom === true);
            assert('session thiếu bom -> mặc định không BOM', back.tabs[0].bom === false);
            // Encoding cũng phải sống cùng session, nếu không status bar báo sai sau khi mở lại.
            const encBack = deserializeSession(JSON.stringify({ activeId: 1, tabs: [{ ...wire(1, 'C:\\a.md', 'a.md', '# A', '# A'), encoding: 'UTF-16LE' }] }));
            assert('session giữ encoding', encBack.tabs[0].encoding === 'UTF-16LE');
            assert('session thiếu encoding -> mặc định UTF-8', back.tabs[0].encoding === 'UTF-8');

            // Session cũ còn BOM trong content: bỏ BOM ở cả content và savedContent để tab vẫn sạch.
            const legacyBom = deserializeSession(JSON.stringify({ activeId: 1, tabs: [wire(1, '/a.md', 'a.md', '\uFEFF# A', '\uFEFF# A')] }));
            assert('session cũ có BOM -> bỏ khi khôi phục', legacyBom.tabs[0].content === '# A');
            assert('bỏ BOM xong tab vẫn sạch', isTabDirty(legacyBom.tabs[0]) === false);

            // content = null + path -> khôi phục đọc lại từ đĩa.
            assert('tab sạch có path không lưu nội dung', sessionKeepsContent({ path: '/a.md', content: 'x', savedContent: 'x' }) === false);
            assert('tab dirty có path vẫn lưu nội dung', sessionKeepsContent({ path: '/a.md', content: 'y', savedContent: 'x' }) === true);
            assert('tab chưa có path luôn lưu nội dung', sessionKeepsContent({ path: null, content: '', savedContent: '' }) === true);
            // Thoát bằng "Don't save": bỏ bản nháp, tab file đọc lại đĩa, tab Untitled thành rỗng.
            assert('thoát không lưu -> tab file không giữ nội dung', sessionKeepsContent({ path: '/a.md', content: 'y', savedContent: 'x' }, true) === false);
            assert('thoát không lưu -> tab Untitled không giữ nội dung', sessionKeepsContent({ path: null, content: 'x', savedContent: '' }, true) === false);
            const discardedDraft = deserializeSession(JSON.stringify({
                activeId: 1, tabs: [{ id: 1, path: null, name: 'Untitled 1', content: null, dirty: false, eol: '\n', bom: false }]
            }));
            assert('thoát không lưu -> tab Untitled mở lại rỗng, sạch', discardedDraft.tabs[0].content === '' && isTabDirty(discardedDraft.tabs[0]) === false);
            const noContent = deserializeSession(JSON.stringify({
                activeId: 1, tabs: [{ id: 1, path: '/a.md', name: 'a.md', content: null, dirty: false, eol: '\n', bom: false }]
            }));
            assert('session content null + có path -> đánh dấu đọc lại đĩa', noContent.tabs[0].reload === true);
            assert('tab đọc lại đĩa chưa xong thì chưa có nội dung', noContent.tabs[0].content === '' && isTabDirty(noContent.tabs[0]) === false);
            assert('session có content -> không đọc lại đĩa (tương thích session cũ)', back.tabs[0].reload === false);

            assert('session không có tab -> null thay vì crash', deserializeSession('{"tabs":[]}') === null);
            assert('session rỗng -> null', deserializeSession('null') === null);
            assert('session JSON hỏng -> deserializeSession ném lỗi (restoreSession bắt và dựng session mới)', (() => {
                try { deserializeSession('{khong phai json'); return false; } catch (e) { return true; }
            })());
            assert('session thiếu tên/đường dẫn -> điền mặc định', (() => {
                const r = deserializeSession(JSON.stringify({ activeId: 99, tabs: [{ content: 'y' }] }));
                return r.activeId === 99 && r.tabs[0].name === 'Untitled' && r.tabs[0].path === null;
            })());

            // Id hỏng làm nextId = NaN; id trùng làm hai tab nhận lệnh của nhau.
            const badIds = deserializeSession(JSON.stringify({
                tabs: [{ id: 'abc', content: 'a' }, { id: 5, content: 'b' }, { id: 5, content: 'c' }, { id: -3, content: 'd' }, { id: 2.5, content: 'e' }]
            }));
            assert('id hỏng / trùng / âm / thực đều được cấp lại',
                badIds.tabs.every((t) => Number.isSafeInteger(t.id) && t.id > 0)
                && new Set(badIds.tabs.map((t) => t.id)).size === badIds.tabs.length);
            assert('id hợp lệ giữ nguyên', deserializeSession(JSON.stringify({ tabs: [{ id: 9, content: 'a' }] })).tabs[0].id === 9);

            // Tab chưa có path: mốc đã lưu là '', không phải null (null = luôn dirty).
            const draft = deserializeSession(JSON.stringify({ activeId: 1, tabs: [{ id: 1, path: null, name: 'Untitled', content: '', dirty: true }] }));
            assert('tab chưa có path + dirty -> mốc rỗng, không phải null', draft.tabs[0].savedContent === '');
            assert('tab chưa có path đã xoá hết nội dung thì không hỏi khi đóng', isTabDirty(draft.tabs[0]) === false);
            const dirtyPath = deserializeSession(JSON.stringify({ activeId: 1, tabs: [{ id: 1, path: '/a.md', name: 'a.md', content: 'x', dirty: true }] }));
            assert('tab có path + dirty -> savedContent null (chặn ghi đè bản rỗng)', dirtyPath.tabs[0].savedContent === null);

            // status phải sống cùng session: chốt duy nhất chặn Ctrl+S ghi đè file thật bằng bản rỗng.
            const st = deserializeSession(JSON.stringify({ activeId: 1, tabs: [{ id: 1, path: '/a.md', name: 'a.md', content: '', dirty: true, status: 'unreadable', diskMtime: 1712345678901 }] }));
            assert('session giữ status lỗi', st.tabs[0].status === 'unreadable');
            assert('session giữ mốc đĩa', st.tabs[0].diskMtime === 1712345678901);
            const stBad = deserializeSession(JSON.stringify({ activeId: 1, tabs: [{ id: 1, path: '/a.md', name: 'a.md', content: 'x', status: 'bogus', diskMtime: 'x' }] }));
            assert('status lạ -> ok, mtime lạ -> null', stBad.tabs[0].status === 'ok' && stBad.tabs[0].diskMtime === null);
            assert('mtimeOf nhận Date và số', mtimeOf({ mtime: new Date(1712345678901) }) === 1712345678901 && mtimeOf({ mtime: 1712345678901 }) === 1712345678901);
            assert('mtimeOf thiếu mtime -> null', mtimeOf(null) === null && mtimeOf({}) === null);

            // 'unknown' phải im lặng, nếu không mỗi Ctrl+S là một hộp thoại vô nghĩa.
            assert('stat hỏng -> file đã mất', diskRevision(null, 1000) === 'gone');
            assert('mtime khớp -> không hỏi', diskRevision({ mtime: 1000 }, 1000) === 'same');
            assert('mtime lệch -> hỏi', diskRevision({ mtime: 2000 }, 1000) === 'changed');
            assert('chưa có mốc -> im lặng, không hỏi', diskRevision({ mtime: 2000 }, null) === 'unknown');
            assert('mtime không đọc được -> im lặng', diskRevision({}, 1000) === 'unknown');

            // Chỉ còn hash+len: gõ lại đúng nội dung gốc thì tab hết dirty.
            assert('hashText ổn định', hashText('abc') === hashText('abc'));
            assert('hashText phân biệt nội dung', hashText('abc') !== hashText('abd'));
            const reverted = deserializeSession(JSON.stringify({
                activeId: 1,
                tabs: [{
                    id: 1, path: '/a.md', name: 'a.md', content: '# A', dirty: true,
                    savedHash: hashText('# A'), savedLen: '# A'.length, status: 'ok'
                }]
            }));
            assert('khôi phục tab dirty: gõ lại đúng bản gốc -> sạch', isTabDirty(reverted.tabs[0]) === false);
            assert('khôi phục tab dirty: sửa một ký tự -> vẫn chưa lưu', isTabDirty({ ...reverted.tabs[0], content: '# A ' }) === true);
            assert('hash đúng nhưng độ dài lệch -> chưa lưu', isTabDirty({ content: 'x', savedContent: null, savedHash: hashText('x'), savedLen: 99 }) === true);
            assert('khôi phục tab dirty: không có hash thì vẫn là chưa lưu', isTabDirty({ content: 'x', savedContent: null, savedHash: null, savedLen: null }) === true);

            // Tab lỗi phải đọc lại ở lần sau, kể cả khi có bản nháp: đọc hỏng không được thành tab rỗng vĩnh viễn.
            const broken = deserializeSession(JSON.stringify({
                activeId: 1,
                tabs: [{ id: 1, path: '/a.md', name: 'a.md', content: 'draft', dirty: true, status: 'unreadable', reload: true }]
            }));
            assert('tab lỗi được đọc lại đĩa ở lần chạy sau', broken.tabs[0].reload === true);
            assert('tab lỗi vẫn giữ bản nháp', broken.tabs[0].content === 'draft');
            assert('tab lỗi không tự nhận là đã lưu', isTabDirty(broken.tabs[0]) === true);
            // serializeSession() chạy trên tab thật: mọi tab lỗi phải mang cờ reload.
            const liveWire = serializeSession();
            assert('serializeSession đánh cờ reload cho mọi tab lỗi', liveWire.tabs.every((t) => t.reload === (t.status !== 'ok')));
            assert('serializeSession giữ mặc định EOL', liveWire.defaultEol === '\n' || liveWire.defaultEol === '\r\n');
            const discardWire = serializeSession({ discardUnsaved: true });
            assert('serializeSession bỏ bản nháp khi thoát không lưu', discardWire.tabs.every((t) => t.content === null && t.dirty === false && t.savedHash === null && t.savedLen === null));
            // Fingerprint phải phủ MỌI key của record, bỏ sót là ghi phiên cũ và mất dữ liệu im lặng.
            const fpTab = { id: 1, path: '/a.md', name: 'a.md', content: 'hello', dirty: true, scrollTop: 0 };
            assert('vân tay session: record không đổi -> giống nhau', sessionFingerprint(fpTab) === sessionFingerprint({ ...fpTab }));
            assert('vân tay session: nội dung cùng độ dài khác chữ -> khác nhau', sessionFingerprint(fpTab) !== sessionFingerprint({ ...fpTab, content: 'world' }));
            assert('vân tay session: đổi vị trí cuộn -> khác nhau', sessionFingerprint(fpTab) !== sessionFingerprint({ ...fpTab, scrollTop: 9 }));
            assert('vân tay session: content null (tab sạch) -> khác nhau', sessionFingerprint(fpTab) !== sessionFingerprint({ ...fpTab, content: null }));
            assert('vân tay session: trường mới thêm vào record cũng được tính', sessionFingerprint(fpTab) !== sessionFingerprint({ ...fpTab, somethingNew: 1 }));

            // Tab chưa lưu: cấp số Untitled nhỏ nhất còn trống.
            assert('Untitled đánh số từ 1', untitledName([]) === 'Untitled 1');
            assert('Untitled bỏ qua số đã dùng', untitledName([{ name: 'Untitled 1' }, { name: 'Untitled 2' }]) === 'Untitled 3');

            // Save As giữ đuôi và đúng thư mục của tab (.txt không thành .md).
            assert('Save As giữ đuôi .txt', suggestSavePath({ path: 'C:\\docs\\note.txt', name: 'note.txt' }, 'x') === 'C:\\docs\\note.txt');
            assert('Save As tab chưa lưu lấy tên từ H1', suggestSavePath({ path: null, name: 'Untitled 1' }, '# My Doc').endsWith('my-doc.md'));

            // Lịch sử Undo nằm trong EditorState của CodeMirror: mỗi tab một state riêng.
            // Ở đây chỉ kiểm cơ chế undo/redo, phần tách theo tab do editor/cm.js đảm nhiệm.
            const undoBefore = docText();
            probe('nội dung thử');
            assert('có thể undo', undo(view) === true);
            assert('undo trả về nội dung trước', docText() === undoBefore);
            assert('có thể redo', redo(view) === true);
            assert('redo trả lại nội dung sau', docText() === 'nội dung thử');

            // Tên trùng phải phân biệt, không trùng thì giữ nguyên.
            const dupes = [
                { name: 'README.md', path: 'C:\\a\\README.md' },
                { name: 'README.md', path: 'C:\\b\\README.md' },
                { name: 'notes.md', path: 'C:\\a\\notes.md' }
            ];
            assert('hai tab trùng tên -> ghi kèm thư mục cha', disambiguateTabName(dupes[0], dupes) === 'a/README.md');
            assert('tên không trùng -> giữ nguyên', disambiguateTabName(dupes[2], dupes) === 'notes.md');
            assert('tab chưa lưu -> tên gốc', disambiguateTabName({ name: 'Untitled', path: null }, dupes) === 'Untitled');

            // confirmAction chèn câu hỏi bằng innerHTML: tên file phải escape trước khi vào DOM.
            assert('escapeHtml chặn thẻ trong tên file', escapeHtml('<img src=x onerror=alert(1)>') === '&lt;img src=x onerror=alert(1)&gt;');
            assert('escapeHtml chặn dấu nháy', escapeHtml('a"b\'c&d') === 'a&quot;b&#39;c&amp;d');

            // serializeSession() đọc store thật: chỉ kiểm không nổ và đủ trường.
            const live = serializeSession();
            assert('serialize session trả về shape đúng',
                typeof live.activeId === 'number' && Array.isArray(live.tabs)
                && live.tabs.every((t) => 'dirty' in t && (t.eol === '\n' || t.eol === '\r\n')));
        });

        // Giải mã file: đây là chỗ quyết định file nhị phân bị từ chối hay mở ra mojibake.
        await section('giải mã file', async () => {
            const bytes = (...arr) => Uint8Array.from(arr);

            // UTF-16LE có BOM (Notepad Unicode): mở được, đánh dấu đã chuyển.
            const utf16 = decodeTextBytes(bytes(0xff, 0xfe, 0x48, 0x00, 0x69, 0x00));
            assert('file UTF-16LE có BOM -> giải mã đúng chữ', utf16 && utf16.text === 'Hi');
            assert('file UTF-16LE có BOM -> báo đã chuyển', utf16 && utf16.converted === true && utf16.encoding === 'UTF-16LE');

            const utf16be = decodeTextBytes(bytes(0xfe, 0xff, 0x00, 0x48, 0x00, 0x69));
            assert('file UTF-16BE có BOM -> giải mã đúng chữ', utf16be && utf16be.text === 'Hi' && utf16be.encoding === 'UTF-16BE');

            // File nhị phân: phải bị từ chối (null), không mở ra tab toàn ký tự lạ.
            assert('file toàn 0x00 -> bị từ chối', decodeTextBytes(new Uint8Array(2048)) === null);
            const mixed = new Uint8Array(512);
            for (let i = 0; i < mixed.length; i++) mixed[i] = i % 2 ? 0x7f : 0x00;
            assert('file xen 0x00/0x7F -> bị từ chối', decodeTextBytes(mixed) === null);
            // File toàn 0x7F là UTF-8 hợp lệ, nhưng không được mở như file Windows-125x.
            const dels = decodeTextBytes(new Uint8Array(512).fill(0x7f));
            assert('file toàn 0x7F -> không mở như Windows-125x',
                !dels || (dels.encoding !== 'Windows-1252' && dels.encoding !== 'Windows-1258'));

            // Windows-125x cũ: giữ đúng chữ, không U+FFFD.
            const win1252 = decodeTextBytes(bytes(0x63, 0x61, 0x66, 0xe9, 0x0a));
            assert('file windows-1252 -> giữ dấu é', !!win1252 && win1252.text.indexOf('\u00e9') !== -1);
            assert('file windows-1252 -> không ký tự U+FFFD', !!win1252 && win1252.text.indexOf('\ufffd') === -1);
            assert('file windows-1252 -> báo đã chuyển', !!win1252 && win1252.converted === true);

            // UTF-8 BOM phải còn nguyên BOM để lần lưu sau ghi lại đúng file gốc.
            const utf8Bom = decodeTextBytes(bytes(0xef, 0xbb, 0xbf, 0x23, 0x20, 0x41));
            assert('file UTF-8 có BOM -> giữ nguyên BOM', !!utf8Bom && utf8Bom.text.charCodeAt(0) === 0xfeff);
            assert('file UTF-8 có BOM -> không báo chuyển', !!utf8Bom && utf8Bom.converted === false && utf8Bom.encoding === 'UTF-8');

            const plain = decodeTextBytes(bytes(0x23, 0x20, 0x41));
            assert('file UTF-8 thường -> giữ nguyên chữ', !!plain && plain.text === '# A' && plain.converted === false);
        });

        // readOnly phải sống cùng session, nếu không mỗi lần khởi động lại mở khoá gõ.
        await section('session giữ cờ read-only', async () => {
            const ro = deserializeSession(JSON.stringify({
                activeId: 1, tabs: [{ id: 1, path: 'C:\\big.md', name: 'big.md', content: 'x', dirty: false, eol: '\n', bom: false, readOnly: true }]
            }));
            assert('session giữ read-only của tab lớn', ro.tabs[0].readOnly === true);
            const normal = deserializeSession(JSON.stringify({
                activeId: 1, tabs: [{ id: 1, path: 'C:\\a.md', name: 'a.md', content: 'x', dirty: false, eol: '\n', bom: false }]
            }));
            assert('session thiếu read-only -> mặc định gõ được', normal.tabs[0].readOnly === false);
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
            assert('gõ " trên nội dung rỗng -> mở cặp (closeBrackets)', quoteOpen.value === '""' && quoteOpen.caret === 1);
            // Chuỗi gõ thật: mở " rồi gõ chữ rồi " sẽ nhảy qua cặp mình vừa mở.
            probe('', 0, 0);
            type('"'); type('a'); type('b'); type('c'); type('"');
            assert(`gõ " đóng cặp mình mở -> nhảy qua (actual=${JSON.stringify(docText())} caret=${view.state.selection.main.head} facets=${view.state.facet(EditorView.inputHandler).length})`, docText() === '"abc"' && view.state.selection.main.head === 5);
            probe('', 0, 0);
            type('('); type('x'); type(')');
            assert(`gõ ) nhảy qua ( mình vừa mở (actual=${JSON.stringify(docText())} caret=${view.state.selection.main.head})`, docText() === '(x)' && view.state.selection.main.head === 3);
            // Backtick không nằm trong brackets mặc định của markdown: gõ một chỉ ra một.
            const backtick = typeAt('', 0, '`');
            assert('gõ ` không tự đóng (backtick ngoài brackets mặc định)', backtick.value === '`');
            // Caret ở CUỐI don't: nháy đơn sau chữ không tự đóng, gõ thường chèn một ký tự.
            const apostrophe = typeAt("don't", 5, "'");
            assert("' sau chữ là dấu nháy đơn, không tự đóng cặp", apostrophe.value === "don't'");
            // ( chỉ đóng khi ký tự kế tiếp phù hợp: trước chữ thì không đóng.
            const parenWord = typeAt('ab', 0, '(');
            assert('gõ ( trước chữ không tự đóng (closeBrackets chỉ đóng khi hợp)', parenWord.value === '(ab');

            for (const f of ['*', '_', '~', '$', '`']) {
                probe('abc', 0, 3);
                assert(`gõ ${f} khi đang bôi đen thì bọc vùng chọn`, handleTypedChar(view, 0, 3, f) === true && docText() === `${f}abc${f}`);
            }

            // Backspace xoá cả cặp: đi qua closeBracketsKeymap.
            probe('""', 1, 1);
            const bs = window.CodeMirror.closeBracketsKeymap.find((b) => b.key === 'Backspace');
            bs.run(view);
            assert('Backspace giữa cặp xoá cả hai dấu', docText() === '');

            // Enter theo markup: dòng list rỗng thoát list, task mới chưa tick, dòng thụt giữ thụt.
            const enter = window.CodeMirror.markdownKeymap.find((b) => b.key === 'Enter');
            probe('- ', 2, 2);
            enter.run(view);
            assert('Enter dòng list rỗng -> thoát list', !docText().includes('- '));
            probe('- done', 6, 6);
            enter.run(view);
            assert('Enter list thường -> dòng mới cùng bullet', docText() === '- done\n- ');
            probe('- [x] việc', 10, 10);
            enter.run(view);
            assert('Enter task đã tick -> task mới chưa tick', docText().includes('[ ]'));
            probe('    code', 8, 8);
            const handledPlain = enter.run(view);
            // markdownKeymap không xử lý dòng thường: trả false để default insert newline.
            if (!handledPlain) view.dispatch({ changes: { from: 8, to: 8, insert: '\n' }, selection: { anchor: 9, head: 9 } });
            assert('Enter dòng thụt thường -> xuống dòng', docText().includes('\n'));
        });

        // Exact dirty: undo về đúng bản đã lưu thì hết dirty; toggle readOnly giữ undo.
        await section('dirty exact + readOnly giữ undo', async () => {
            const fake = { state: null, savedDoc: null, savedContent: null, savedHash: null, savedLen: null, content: '' };
            probe('', 0, 0);
            fake.state = view.state;
            fake.savedDoc = view.state.doc;
            probe('hello');
            fake.state = view.state;
            assert('gõ -> dirty (so doc)', isTabDirty(fake) === true);
            undo(view);
            fake.state = view.state;
            assert('undo về bản đã lưu -> sạch', isTabDirty(fake) === false);

            const tab = getActiveTab();
            probe('abc');
            try {
                setTabReadOnly(tab, true);
                assert('readOnly bật sau toggle', view.state.readOnly === true);
                setTabReadOnly(tab, false);
                assert('readOnly tắt sau toggle', view.state.readOnly === false);
            } finally {
                setTabReadOnly(tab, false);
            }
            assert('toggle readOnly giữ undo', undo(view) === true && docText() === '');
            probe(snap.value);
        });

        await section('khối #4', async () => {
            const host = document.createElement('div');
            host.innerHTML = '<blockquote><p>a</p></blockquote><blockquote class="markdown-alert markdown-alert-tip"><p class="markdown-alert-title">Tip</p><p>b</p></blockquote>';
            convertQuotesForDoc(host);
            assert('doc quote: không còn blockquote', !host.querySelector('blockquote'));
            assert('doc quote: mỗi quote thành 1 bảng', host.querySelectorAll('table').length === 2);
            assert('doc quote: có đoạn đệm giữa 2 bảng', host.children[0].tagName === 'TABLE' && host.children[1].tagName === 'P' && host.children[2].tagName === 'TABLE');
            assert('doc quote: alert dùng màu viền theo loại', host.querySelectorAll('td')[1].style.cssText.includes('26, 127, 55') || host.querySelectorAll('td')[1].style.cssText.includes('#1a7f37'));
        });
        await section('khối #5', async () => {
            const host = document.createElement('div');
            host.innerHTML = '<table><tr><th align="center">A</th></tr><tr><td>B</td></tr></table>';
            styleDataTablesForDoc(host);
            const th = host.querySelector('th');
            const td = host.querySelector('td');
            assert('doc table: ô có viền inline (Word không đọc selector hậu duệ)', td.style.borderTopWidth === '1px' && th.style.borderTopStyle === 'solid');
            assert('doc table: header có nền + đậm', th.style.backgroundColor === 'rgb(246, 248, 250)' && th.style.fontWeight === 'bold');
            assert('doc table: giữ align của markdown', th.getAttribute('align') === 'center');
        });
        const wordHtml = buildWordHtml('<p>x</p>');
        assert('word html có meta UTF-8', wordHtml.includes('charset="UTF-8"'));
        assert('word html có namespace Office', wordHtml.includes('urn:schemas-microsoft-com:office:word'));
        assert('word html giữ body', wordHtml.includes('<p>x</p>'));
        const fitWide = fitDocImageSize(1200, 600);
        assert('doc cap thu ảnh rộng về 650 giữ tỉ lệ', fitWide.width === 650 && fitWide.height === 325);
        const fitSmall = fitDocImageSize(400, 200);
        assert('doc cap giữ nguyên ảnh nhỏ', fitSmall.width === 400 && fitSmall.height === 200);
        const fitTall = fitDocImageSize(500, 1800);
        assert('doc cap thu ảnh cao về 900 giữ tỉ lệ', fitTall.width === 250 && fitTall.height === 900);
        assert('doc cap bỏ qua kích thước lạ', fitDocImageSize(0, 0).width === 0);
        assert('doc nhận badge shields.io là SVG', isSvgImageSrc('https://img.shields.io/badge/Tauri-v2.0-24C8DB') === true);
        assert('doc nhận đuôi .svg là SVG', isSvgImageSrc('https://example.com/a.svg?x=1') === true);
        assert('doc không coi png là SVG', isSvgImageSrc('https://example.com/a.png') === false);

        const standalone = buildStandaloneHtml('<p>x</p>', 'Tiêu đề <đẹp>');
        assert('html standalone có doctype', standalone.startsWith('<!DOCTYPE html>'));
        assert('html standalone có meta UTF-8', standalone.includes('charset="UTF-8"'));
        assert('html standalone giữ body', standalone.includes('<p>x</p>'));
        assert('html standalone escape title', standalone.includes('<title>Tiêu đề &lt;đẹp&gt;</title>'));
        assert('html standalone title fallback', buildStandaloneHtml('<p>x</p>', '').includes('<title>Document</title>'));
        assert('title từ heading cấp 1', deriveDocumentTitle('# Báo cáo tháng 9\nnội dung') === 'Báo cáo tháng 9');
        assert('title fallback khi không có heading', deriveDocumentTitle('không có heading') === 'Document');
        assert('title không lấy heading trong fence ```', deriveDocumentTitle('```\n# giả\n```\n\n# Thật') === 'Thật');
        assert('title không lấy heading trong fence ~~~', deriveDocumentTitle('~~~md\n# giả\n~~~\n# Thật') === 'Thật');
        assert('title chỉ fallback khi toàn bộ là fence', deriveDocumentTitle('```\n# giả\n```') === 'Document');
        assert('title bỏ fence đóng dài hơn lúc mở', deriveDocumentTitle('```\n# giả\n````\n# Thật') === 'Thật');
        assert('title không ăn xuống dòng sau #', deriveDocumentTitle('#\nfoo') === 'Document');
        assert('title nhận heading thụt tối đa 3 space', deriveDocumentTitle('   # Thụt') === 'Thụt');
        assert('title từ chối heading thụt 4 space', deriveDocumentTitle('    # Sâu') === 'Document');

        assert('heading nhận diện H2 có thụt lề', getHeadingLevel('  ## Tiêu đề') === 2);
        assert('heading nhận diện dòng thường', getHeadingLevel('nội dung') === 0);
        assert('heading nhận diện # không nội dung', getHeadingLevel('#') === 1);
        assert('heading từ chối #không-cách', getHeadingLevel('#hashtag') === 0);
        assert('heading từ chối 7 dấu #', getHeadingLevel('####### bảy') === 0);
        assert('heading đổi H1 thành H3', setHeadingLevel('# Tiêu đề', 3).line === '### Tiêu đề');
        assert('heading gỡ prefix khi level 0', setHeadingLevel('## Tiêu đề', 0).line === 'Tiêu đề');
        assert('heading giữ nguyên thụt lề', setHeadingLevel('  # a', 2).line === '  ## a');
        assert('heading tạo mới trên dòng thường', setHeadingLevel('văn bản', 2).line === '## văn bản');
        assert('heading dòng thường + gỡ là no-op', setHeadingLevel('văn bản', 0) === null);

        assert('html bọc vùng chọn', wrapHtmlTag('ab', 0, 2, 'sup').insert === '<sup>ab</sup>');
        assert('html bọc giữ vùng chọn', (() => { const r = wrapHtmlTag('ab', 0, 2, 'sub'); return r.selStart === 5 && r.selEnd === 7; })());
        assert('html placeholder khi không chọn', (() => { const r = wrapHtmlTag('', 0, 0, 'kbd'); return r.insert === '<kbd>text</kbd>' && r.selStart === 5 && r.selEnd === 9; })());
        assert('html gỡ thẻ khi bọc trọn cặp', wrapHtmlTag('<sup>ab</sup>', 0, 13, 'sup').insert === 'ab');
        assert('html gỡ thẻ nằm ngoài vùng chọn', (() => { const r = wrapHtmlTag('<mark>ab</mark>', 6, 8, 'mark'); return r.insert === 'ab' && r.selStart === 0 && r.selEnd === 2 && r.from === 0 && r.to === 15; })());
        assert('html bọc lại sau khi gỡ (toggle về ban đầu)', (() => {
            const a = wrapHtmlTag('ab', 0, 2, 'mark');
            const b = wrapHtmlTag(a.insert, a.selStart, a.selEnd, 'mark');
            return b.insert === 'ab';
        })());
        assert('heading giữ # trong nội dung', setHeadingLevel('#hashtag', 1).line === '# #hashtag');
        assert('list parse task', parseListLine('- [x] việc').kind === 'task' && parseListLine('- [x] việc').rest === 'việc');
        assert('list parse numbered', parseListLine('2. mục').kind === 'numbered');
        assert('list parse bullet giữ thụt lề', parseListLine('  - a').indent === '  ' && parseListLine('  - a').rest === 'a');
        assert('list từ chối dòng thường', parseListLine('chữ') === null);
        assert('list từ chối dòng trống', parseListLine('') === null);
        assert('list từ chối -5 không cách', parseListLine('-5') === null);
        assert('bảng 2x2 đúng cú pháp', buildTableMarkdown(2, 2) === '| Head | Head |\n| --- | --- |\n|  |  |\n|  |  |');
        assert('bảng 1x1 vẫn có dòng thân để gõ', buildTableMarkdown(1, 1) === '| Head |\n| --- |\n|  |');
        assert('bảng kẹp giới hạn 1..99', buildTableMarkdown(5, 0) === '| Head |\n| --- |\n|  |\n|  |\n|  |\n|  |\n|  |');
        assert('url thêm https khi trần', normalizeLinkUrl('example.com') === 'https://example.com');
        assert('url giữ scheme có sẵn', normalizeLinkUrl('mailto:a@b.com') === 'mailto:a@b.com');
        assert('url giữ anchor nội bộ', normalizeLinkUrl('#muc-luc') === '#muc-luc');
        assert('url giữ protocol-relative', normalizeLinkUrl('//cdn.example.com/x') === '//cdn.example.com/x');
        assert('url rỗng trả về rỗng', normalizeLinkUrl('   ') === '');
        assert('escape nhãn link', escapeLinkText('a[b]c') === 'a\\[b\\]c');
        assert('quote parse dòng >', parseListLine('> trích dẫn').kind === 'quote' && parseListLine('> trích dẫn').rest === 'trích dẫn');
        assert('quote parse giữ thụt lề', parseListLine('  > a').indent === '  ');
        assert('quote từ chối >không-cách', parseListLine('>không-cách') === null);
        assert('fence code mặc định', buildBlockFence('code', '') === '```js\n// code here\n```');
        assert('fence math mặc định', buildBlockFence('math', '') === '$$\nf(x) = \\int_{-\\infty}^{\\infty} e^{-x^2} dx\n$$');
        assert('fence mermaid mặc định', buildBlockFence('mermaid', '') === '```mermaid\ngraph TD\n    A[Start] --> B[End]\n```');
        assert('fence giữ nội dung có sẵn', buildBlockFence('code', 'a\nb') === '```js\na\nb\n```');

        await section('khối #6', async () => {
            const run = (text, fn) => {
                probe(text, 0, text.length);
                fn();
                return docText();
            };
            assert('heading delta 0 vẫn áp dụng', run('### a\nbbbb', () => applyHeadingLevel(1)) === '# a\n# bbbb');
            assert('bullet delta 0 vẫn áp dụng', run('- aaa\nbbb', () => applyListStyle('bullet')) === 'aaa\n- bbb');
            assert('numbered delta 0 vẫn áp dụng', run('1. a\nbbb', () => applyListStyle('numbered')) === 'a\n1. bbb');
            probe('abc def', 0, 3);
            insertTableBlock(2, 2);
            assert('chèn bảng giữ nguyên vùng chọn', docText().startsWith('abc') && docText().includes('| Head |'));
            // Số dòng tính cả tiêu đề: 3x2 = tiêu đề + 1 dòng thân.
            probe('', 0, 0);
            insertTableBlock(3, 2);
            assert('bảng 3x2 ra đúng 2 dòng (tiêu đề + 1 dòng thân)',
                docText() === '| Head | Head | Head |\n| --- | --- | --- |\n|  |  |  |');
            probe('', 0, 0);
            insertTableBlock(1, 1);
            assert('bảng 1x1 vẫn giữ dòng thân để gõ', docText() === '| Head |\n| --- |\n|  |');
        });

        await section('khối #7', async () => {
            // Undo sau khi nạp phải có tác dụng: CodeMirror giữ mốc ban đầu trong state.
            const before = docText();
            probe('hi');
            assert('undo đầu tiên sau khi load có tác dụng', undo(view) === true && docText() === before);
            assert('redo quay lại nội dung vừa gõ', redo(view) === true && docText() === 'hi');
        });

        await section('khối #8', async () => {
            // Dấu cách phải tạo mốc lịch sử riêng, nếu không Undo lùi hết cả cụm.
            probe('hello');
            view.dispatch({ changes: { from: 5, insert: ' ' }, userEvent: 'input.type' });
            view.dispatch({ changes: { from: 6, insert: 'world' }, userEvent: 'input.type' });
            undo(view);
            assert('undo lùi từng từ ở dấu cách', docText() === 'hello ');
        });

        await section('khối #9', async () => {
            // marked.lexer ném lỗi: preview phải rơi về văn bản thô, không đụng innerHTML.
            const savedValue = docText();
            const savedMarked = window.marked;
            probe('# probe render');
            if (savedMarked) {
                // marked.lexer là method của object marked: thay cả object marked rồi trả lại reference cũ.
                window.marked = { ...savedMarked, lexer: () => { throw new Error('probe'); } };
                try {
                    renderMarkdown();
                    assert('render lỗi -> preview hiện văn bản thô', previewOutput.textContent === '# probe render');
                } finally {
                    window.marked = savedMarked;
                }
            } else {
                skip('render lỗi -> preview hiện văn bản thô', 'marked chưa tải');
            }
            // Trả editor về nội dung thật TRƯỚC rồi render lại, không thì preview kẹt ở đoạn probe.
            probe(savedValue);
            renderMarkdown();
        });

        assert('diffBlocks giữ prefix/suffix khi đổi giữa', diffBlocks(['a','b','c'], ['a','X','c']).prefix === 1 && diffBlocks(['a','b','c'], ['a','X','c']).suffix === 1);
        assert('diffBlocks chèn đầu không đụng prefix', diffBlocks(['a','b'], ['n','a','b']).suffix === 2);
        assert('diffBlocks append không đụng suffix', diffBlocks(['a','b'], ['a','b','n']).prefix === 2);
        assert('diffBlocks reorder không tái dùng node', diffBlocks(['a','b','c'], ['c','b','a']).prefix === 0 && diffBlocks(['a','b','c'], ['c','b','a']).suffix === 0);
        assert('diffBlocks tài liệu rỗng', diffBlocks(['a'], []).prefix === 0 && diffBlocks([], ['a']).suffix === 0);
        await section('khối render theo prefix/suffix', async () => {
            const savedValue = docText();
            const doc = 'Alpha para một\n\nBeta para hai\n\nGamma para ba';
            probe(doc);
            renderMarkdown();
            const before = [...previewOutput.children];
            probe('Alpha para một\n\nBeta para SỬA\n\nGamma para ba');
            renderMarkdown();
            const after = [...previewOutput.children];
            assert('khối không đổi giữ nguyên node (prefix/suffix)', after[0] === before[0] && after[2] === before[2]);
            assert('khối đổi được thay node', after[1] !== before[1]);
            probe('công thức $E = mc^2$ test');
            renderMarkdown();
            const slot = previewOutput.querySelector('.math-slot');
            assert('công thức ngoài viewport giữ placeholder TeX', !!slot && slot.textContent.includes('E = mc^2'));
            flushLazyRenders();
            assert('flushLazyRenders vẽ KaTeX ngay cả ngoài viewport', !!previewOutput.querySelector('.katex'));
            probe(savedValue);
            renderMarkdown();
        });

        await section('khối #10', async () => {
            let calls = 0;
            const runOnce = makeExclusive(async () => { calls++; await Promise.resolve(); });
            const first = runOnce();
            runOnce();
            assert('export chạy chồng bị chặn', calls === 1);
            await first;
            await runOnce();
            assert('export chạy lại được sau khi lượt trước xong', calls === 2);
        });

        await section('khối #11', async () => {
            // Đi qua listener mouseenter thật để kiểm cả ánh xạ chỉ số -> cols/rows.
            const grid = tableMenu.querySelector('.table-grid');
            const hover = (index) => grid.children[index].dispatchEvent(new MouseEvent('mouseenter'));
            const onCount = () => grid.querySelectorAll('.table-cell.on').length;

            hover(7);
            assert('lưới bảng sáng đúng hình chữ nhật khi hover', onCount() === 6
                && grid.children[0].classList.contains('on')
                && grid.children[7].classList.contains('on')
                && !grid.children[3].classList.contains('on')
                && !grid.children[10].classList.contains('on'));
            hover(24);
            assert('lưới bảng sáng trọn 5x5', onCount() === 25);
            tableMenu.dispatchEvent(new MouseEvent('mouseleave'));
            assert('lưới bảng tắt sáng khi rời menu', onCount() === 0);
        });

        assert('slug heading bỏ dấu câu', slugifyText('Tiêu đề Mục 2!') === 'tiêu-đề-mục-2');
        await section('khối #12', async () => {
            const host = document.createElement('div');
            host.innerHTML = '<h2>Giới thiệu</h2><h2>Giới thiệu</h2>';
            assignHeadingIds(host);
            assert('tiêu đề có id để neo', host.querySelector('h2').id === 'giới-thiệu');
            assert('tiêu đề trùng -> id duy nhất', host.querySelectorAll('h2')[1].id === 'giới-thiệu-1');
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
        assert('foreignObject chuyển thành <text>', !!textEl && !svg.querySelector('foreignObject') && svg.textContent.includes('Xin chào'));
        assert('tspan đặt đúng tâm foreignObject', textEl && textEl.querySelector('tspan').getAttribute('x') === '60');

        const faceCss = '@font-face{font-family:KaTeX_Main;font-style:italic;font-weight:700;'
            + 'src:url(fonts/KaTeX_Main-BoldItalic.woff2) format("woff2"),url(fonts/KaTeX_Main-BoldItalic.woff) format("woff")}'
            + '.katex{font:normal 1.21em KaTeX_Main}';
        assert('katex font-face lấy đúng url woff2', parseKatexFontFaces(faceCss).get('KaTeX_Main|italic|700') === 'fonts/KaTeX_Main-BoldItalic.woff2');
        assert('katex font key chuẩn hoá bold/normal/nháy',
            katexFontKey('KaTeX_Main', 'normal', 'bold') === 'KaTeX_Main|normal|700'
            && katexFontKey('"KaTeX_Math"', 'italic', '400') === 'KaTeX_Math|italic|400');

        await section('tô màu editor', async () => {
            // CodeMirror tự dựng cây cú pháp (Lezer) và gắn class CSS cho từng loại token.
            const text = '# Tiêu đề\n\nđoạn **đậm** và `code` cùng [link](https://example.com)\n';
            probe(text);
            // Pane ẩn (chế độ Preview) thì editor không render nên không có class để kiểm.
            if (!view.dom.clientWidth) {
                skip('tô màu editor', 'pane đang ẩn');
                return;
            }
            assert('nội dung không đổi sau khi tô màu', docText() === text);
            assert('heading được gắn class riêng', view.dom.querySelectorAll('.cm-md-h1').length >= 1);
            assert('chữ đậm được gắn class riêng', view.dom.querySelectorAll('.cm-md-strong').length >= 1);
            assert('code inline được gắn class riêng', view.dom.querySelectorAll('.cm-md-code').length >= 1);
            assert('link được gắn class riêng', view.dom.querySelectorAll('.cm-md-link').length >= 1);
        });

        await section('tô màu tăng dần', async () => {
            if (!view.dom.clientWidth) {
                skip('tô màu tăng dần', 'pane đang ẩn');
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
            assert('fuzz sửa văn bản: nội dung luôn khớp', ok);
            // Editor phải vẫn render được sau loạt sửa (không lỗi cú pháp cây).
            assert('editor vẫn render sau fuzz', view.dom.querySelectorAll('.cm-line').length > 0);
            probe(snap.value);
        });

        let mark = results.length;
        if (typeof katex !== 'undefined') await section('KaTeX -> MathML', async () => {
            const inlineHost = document.createElement('div');
            inlineHost.innerHTML = katex.renderToString('E = mc^2', { throwOnError: false, output: 'htmlAndMathml' });
            convertKatexForDoc(inlineHost);
            const inlineMath = inlineHost.querySelector('math');
            assert('katex inline chuyển thành <math> thuần', !!inlineMath && !inlineHost.querySelector('span.katex'));
            assert('katex inline bỏ annotation', !!inlineMath && !inlineMath.querySelector('annotation'));

            const alignedHost = document.createElement('div');
            alignedHost.innerHTML = katex.renderToString(
                String.raw`\begin{aligned} a &= 1 \\ b &= 2 \end{aligned}`,
                { throwOnError: false, displayMode: true, output: 'htmlAndMathml' }
            );
            convertKatexForDoc(alignedHost);
            const alignedMath = alignedHost.querySelector('math');
            assert('katex aligned chuyển thành <math> có mtable', !!alignedMath && !!alignedMath.querySelector('mtable'));
            assert('katex aligned giữ đủ 2 dòng', !!alignedMath && alignedMath.querySelectorAll('mtr').length === 2);

            const strayHost = document.createElement('div');
            strayHost.innerHTML = katex.renderToString('E = mc^2', { throwOnError: false, output: 'mathml' });
            const strayMath = strayHost.querySelector('math');
            strayMath.appendChild(document.createTextNode('E = mc^2'));
            convertKatexForDoc(strayHost);
            const cleanedMath = strayHost.querySelector('math');
            assert('katex dọn text node trần trong <math>', !!cleanedMath && !Array.from(cleanedMath.childNodes).some(n => n.nodeType === 3 && n.textContent.trim()));

            const brokenHost = document.createElement('div');
            brokenHost.innerHTML = '<span class="katex">fallback text</span>';
            convertKatexForDoc(brokenHost);
            assert('katex hỏng fallback thành text', brokenHost.textContent === 'fallback text' && !brokenHost.querySelector('span.katex'));
        });
        if (results.length === mark) skip('6 assert KaTeX -> MathML', 'katex chưa tải');

        mark = results.length;
        await section('panel tìm kiếm', async () => {
            // Panel của @codemirror/search nằm trong editor pane, không che format bar.
            const previewBefore = previewOutput.innerHTML;
            probe('foo Foo food');
            openSearchPanel(view);
            const panel = view.dom.querySelector('.cm-search');
            assert('mở panel tìm kiếm', !!panel);
            assert('panel nằm trong editor pane', !!panel && !!panel.closest('.editor-container'));

            const input = panel.querySelector('[name=search]');
            input.value = 'foo';
            // Panel của CodeMirror nghe onkeyup/onchange, không nghe 'input'.
            input.dispatchEvent(new Event('keyup', { bubbles: true }));
            assert('truy vấn tìm kiếm được ghi nhận', getSearchQuery(view.state).search === 'foo');

            findNext(view);
            assert('nút next chọn match đầu tiên',
                view.state.selection.main.from === 0 && view.state.selection.main.to === 3);
            findNext(view);
            assert('nút next chọn match kế tiếp',
                view.state.selection.main.from === 4 && view.state.selection.main.to === 7);

            const replaceInput = panel.querySelector('[name=replace]');
            assert('panel có ô thay thế', !!replaceInput);
            replaceInput.value = 'bar';
            replaceInput.dispatchEvent(new Event('keyup', { bubbles: true }));
            replaceAll(view);
            assert('thay hết đổi đúng nội dung', docText() === 'bar bar bard');
            assert('tìm kiếm không đụng preview', previewOutput.innerHTML === previewBefore);

            closeSearchPanel(view);
            assert('đóng panel tìm kiếm', !view.dom.querySelector('.cm-search'));
            probe(snap.value);
        });
        if (results.length === mark) skip('assert panel tìm kiếm', 'panel không có trong DOM');

        mark = results.length;
        if (document.getElementById('btn-help')) await section('hộp thoại About', async () => {
            const aboutItems = document.querySelectorAll('.about-item');
            assert('nút ? là nút cuối toolbar', document.querySelector('.toolbar').lastElementChild.querySelector('#btn-help') !== null);
            assert('nút ? không còn dropdown', document.getElementById('help-menu') === null);
            assert('about có 3 mục tài liệu', aboutItems.length === 3);

            document.getElementById('btn-help').click();
            assert('bấm ? mở thẳng modal About', isInfoDialogOpen());
            assert('modal mở ra view About', !infoAbout.classList.contains('hidden') && infoDoc.classList.contains('hidden'));
            assert('about hiện số phiên bản', /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(document.getElementById('app-version').textContent.trim()));

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
            assert('bấm mục đổi sang view tài liệu', infoAbout.classList.contains('hidden') && !infoDoc.classList.contains('hidden'));
            assert('modal license đọc được file', infoBody.textContent.includes('MIT License'));
            assert('mở tài liệu thì focus nút Back', document.activeElement === document.getElementById('info-back'));
            // Chuỗi flex .dialog-wide > #info-doc > #info-body làm tài liệu dài cuộn trong hộp.
            assert('nội dung tài liệu cuộn trong hộp', getComputedStyle(infoDoc).display === 'flex'
                && infoBody.getBoundingClientRect().bottom <= infoDialog.querySelector('.dialog').getBoundingClientRect().bottom);

            document.getElementById('info-back').click();
            assert('nút Back quay lại view About', !infoAbout.classList.contains('hidden') && infoDoc.classList.contains('hidden'));

            // Esc = Back: lùi từ tài liệu về About, chưa đóng; showDoc đổi view đồng bộ.
            aboutItems[0].click();
            infoDialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            assert('Esc từ view tài liệu lùi về About, hộp chưa đóng',
                isInfoDialogOpen() && !infoAbout.classList.contains('hidden') && infoDoc.classList.contains('hidden'));
            infoDialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            assert('Esc từ view About mới đóng hộp', !isInfoDialogOpen());

            document.getElementById('btn-help').click();
            document.getElementById('info-close').click();
            assert('đóng modal about', !isInfoDialogOpen());
        });
        if (results.length === mark) skip('14 assert hộp thoại About', 'không có #btn-help');

    } catch (err) {
        console.error('Self-check aborted:', err);
        results.push(`FAIL - self-check bị ngắt giữa chừng: ${err && err.message ? err.message : err}`);
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