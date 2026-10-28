// js/dev/selfcheck.js — Self-check nhanh, mở app với ?selfcheck.

import { editorHighlightCode, infoAbout, infoBody, infoDialog, infoDoc, markdownInput, previewOutput, tableMenu } from '../core/dom.js';
import { showToast } from '../core/toast.js';
import { isSafeExternalUrl, slugifyText } from '../core/utils.js';
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
import { editorHistory, pruneAllHistories } from '../editor/history.js';
import { updateEditorHighlight } from '../editor/highlight.js';
import { syncEditorAfterChange } from '../editor/sync.js';
import { convertQuotesForDoc, styleDataTablesForDoc } from '../export/doc-transform.js';
import { buildWordHtml } from '../export/doc.js';
import { applyEol, deriveDocumentTitle, deriveExportBaseName, detectBom, detectEol, hashText, mtimeOf, sameFilePath, stripBom, toLf } from '../export/file-save.js';
import { buildStandaloneHtml } from '../export/html.js';
import { fitDocImageSize, flattenForeignObjects, isSvgImageSrc } from '../export/images.js';
import { katexFontKey, parseKatexFontFaces } from '../export/math-fonts.js';
import { convertKatexForDoc } from '../export/math-mathml.js';
import { makeExclusive } from '../export/menu.js';
import { isTabDirty, isMarkdownPath, deserializeSession, diskRevision, serializeSession, sessionKeepsContent, suggestSavePath, untitledName } from '../io/documents.js';
import { sessionFingerprint } from '../io/session-store.js';
import { escapeHtml } from '../ui/confirm-dialog.js';
import { assignHeadingIds, renderMarkdown } from '../preview/render.js';
import { MERMAID_SANITIZE_CONFIG } from '../preview/sanitize.js';
import { isInfoDialogOpen } from '../ui/about.js';
import { dropIndex, disambiguateTabName, tabScrollState } from '../ui/tabs.js';
import {
    SPLIT_MAX_PERCENT,
    SPLIT_MIN_PERCENT,
    computeSplitPercent,
    computeViewModeFromPercent,
    isValidViewMode
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
    const snap = {
        value: markdownInput.value,
        selStart: markdownInput.selectionStart,
        selEnd: markdownInput.selectionEnd,
        scrollTop: markdownInput.scrollTop,
        previewScrollTop: previewOutput.scrollTop,
        stack: editorHistory.stack,
        index: editorHistory.index
    };
    editorHistory.stack = [];
    editorHistory.index = -1;

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

            // Session cũ còn BOM trong content: bỏ BOM ở cả content và savedContent để tab vẫn sạch.
            const legacyBom = deserializeSession(JSON.stringify({ activeId: 1, tabs: [wire(1, '/a.md', 'a.md', '\uFEFF# A', '\uFEFF# A')] }));
            assert('session cũ có BOM -> bỏ khi khôi phục', legacyBom.tabs[0].content === '# A');
            assert('bỏ BOM xong tab vẫn sạch', isTabDirty(legacyBom.tabs[0]) === false);

            // content = null + path -> khôi phục đọc lại từ đĩa.
            assert('tab sạch có path không lưu nội dung', sessionKeepsContent({ path: '/a.md', content: 'x', savedContent: 'x' }) === false);
            assert('tab dirty có path vẫn lưu nội dung', sessionKeepsContent({ path: '/a.md', content: 'y', savedContent: 'x' }) === true);
            assert('tab chưa có path luôn lưu nội dung', sessionKeepsContent({ path: null, content: '', savedContent: '' }) === true);
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

            // Trần ký tự lịch sử toàn app; cắt lúc chuyển tab, tab nền trước, tab đang mở sau cùng.
            const bigEntry = () => ({ val: 'x'.repeat(1000), start: 0, end: 0 });
            const hA = { stack: [bigEntry(), bigEntry(), bigEntry()], index: 2 };
            const hB = { stack: [bigEntry()], index: 0 };
            pruneAllHistories([hA, hB]);
            assert('lịch sử nhỏ hơn trần thì không bị cắt', hA.stack.length === 3 && hB.stack.length === 1);
            const hChars = (h) => h.stack.reduce((s, e) => s + e.val.length, 0);
            const hBig = { stack: Array.from({ length: 12 }, bigEntry), index: 11 };
            pruneAllHistories([hBig], 2500);
            assert('vượt trần bị cắt, và sau khi cắt không còn vượt trần', hChars(hBig) <= 2500 && hBig.stack.length < 12);
            assert('index hợp lệ sau khi cắt', hBig.index >= -1 && hBig.index <= hBig.stack.length - 1);
            const hMid = { stack: Array.from({ length: 12 }, bigEntry), index: 11 };
            pruneAllHistories([hMid], 5000);
            assert('cắt một phần, không cắt quá tay', hChars(hMid) <= 5000 && hMid.stack.length > 0);
            const hBgA = { stack: Array.from({ length: 10 }, bigEntry), index: 9 };
            const hBgB = { stack: Array.from({ length: 10 }, bigEntry), index: 9 };
            pruneAllHistories([hBgA, hBgB], 5000);
            assert('tổng lịch sử mọi tab không vượt trần', hChars(hBgA) + hChars(hBgB) <= 5000);
            assert('tab nền bị cắt trước tab đang mở', hChars(hBgB) > hChars(hBgA));
            const hBack = { stack: Array.from({ length: 5 }, bigEntry), index: 2 };
            pruneAllHistories([hBack], 500);
            assert('cắt hết stack -> index về -1, không âm', hBack.stack.length === 0 && hBack.index === -1);

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

        // Handler auto-close gắn thẳng vào textarea nên KeyboardEvent giả là đủ.
        // Event giả không tự chèn ký tự: nhánh để trình duyệt chèn phải assert prevented === false.
        await section('auto-close', async () => {
            const press = (key, value, caret) => {
                markdownInput.value = value;
                markdownInput.setSelectionRange(caret, caret);
                const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
                markdownInput.dispatchEvent(e);
                return { value: markdownInput.value, caret: markdownInput.selectionStart, prevented: e.defaultPrevented };
            };

            const quoteOpen = press('"', '', 0);
            assert('gõ " trên nội dung rỗng -> mở cặp', quoteOpen.value === '""' && quoteOpen.caret === 1);
            // Assert bắt bug: gõ lại " từng chèn thêm một cặp.
            const quoteSkip = press('"', '"abc"', 4);
            assert('gõ lại " nhảy qua dấu đóng, không nhân đôi', quoteSkip.value === '"abc"' && quoteSkip.caret === 5);
            const backtickSkip = press('`', '`a`', 2);
            assert('gõ lại ` nhảy qua, không nhân đôi', backtickSkip.value === '`a`' && backtickSkip.caret === 3);
            const singleSkip = press("'", "'a'", 2);
            assert("gõ lại ' nhảy qua dấu đóng", singleSkip.value === "'a'" && singleSkip.caret === 3);
            // Caret ở CUỐI don't, nếu không nhánh nhảy qua bắt trước và không kiểm được guard nháy đơn.
            const apostrophe = press("'", "don't", 5);
            assert("' sau chữ là dấu nháy đơn, không tự đóng", !apostrophe.prevented);

            const parenOpen = press('(', '', 0);
            assert('gõ ( vẫn mở cặp', parenOpen.value === '()' && parenOpen.caret === 1);
            const parenSkip = press(')', '(x)', 2);
            assert('gõ ) vẫn nhảy qua (không bị đổi thứ tự)', parenSkip.value === '(x)' && parenSkip.caret === 3);

            markdownInput.value = '""';
            markdownInput.setSelectionRange(1, 1);
            markdownInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
            assert('Backspace giữa cặp xoá cả hai dấu', markdownInput.value === '');
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

        assert('html bọc vùng chọn', wrapHtmlTag('ab', 0, 2, 'sup').text === '<sup>ab</sup>');
        assert('html bọc giữ vùng chọn', (() => { const r = wrapHtmlTag('ab', 0, 2, 'sub'); return r.selStart === 5 && r.selEnd === 7; })());
        assert('html placeholder khi không chọn', (() => { const r = wrapHtmlTag('', 0, 0, 'kbd'); return r.text === '<kbd>text</kbd>' && r.selStart === 5 && r.selEnd === 9; })());
        assert('html gỡ thẻ khi bọc trọn cặp', wrapHtmlTag('<sup>ab</sup>', 0, 13, 'sup').text === 'ab');
        assert('html gỡ thẻ nằm ngoài vùng chọn', (() => { const r = wrapHtmlTag('<mark>ab</mark>', 6, 8, 'mark'); return r.text === 'ab' && r.selStart === 0 && r.selEnd === 2; })());
        assert('html bọc lại sau khi gỡ (toggle về ban đầu)', (() => {
            const a = wrapHtmlTag('ab', 0, 2, 'mark');
            const b = wrapHtmlTag(a.text, a.selStart, a.selEnd, 'mark');
            return b.text === 'ab';
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
            const saved = markdownInput.value;
            const sel = [markdownInput.selectionStart, markdownInput.selectionEnd];
            const run = (text, fn) => {
                markdownInput.value = text;
                markdownInput.setSelectionRange(0, text.length);
                fn();
                return markdownInput.value;
            };
            assert('heading delta 0 vẫn áp dụng', run('### a\nbbbb', () => applyHeadingLevel(1)) === '# a\n# bbbb');
            assert('bullet delta 0 vẫn áp dụng', run('- aaa\nbbb', () => applyListStyle('bullet')) === 'aaa\n- bbb');
            assert('numbered delta 0 vẫn áp dụng', run('1. a\nbbb', () => applyListStyle('numbered')) === 'a\n1. bbb');
            markdownInput.value = 'abc def';
            markdownInput.setSelectionRange(0, 3);
            insertTableBlock(2, 2);
            assert('chèn bảng giữ nguyên vùng chọn', markdownInput.value.startsWith('abc') && markdownInput.value.includes('| Head |'));
            // Số dòng tính cả tiêu đề: 3x2 = tiêu đề + 1 dòng thân.
            markdownInput.value = '';
            markdownInput.setSelectionRange(0, 0);
            insertTableBlock(3, 2);
            assert('bảng 3x2 ra đúng 2 dòng (tiêu đề + 1 dòng thân)',
                markdownInput.value === '| Head | Head | Head |\n| --- | --- | --- |\n|  |  |  |');
            markdownInput.value = '';
            markdownInput.setSelectionRange(0, 0);
            insertTableBlock(1, 1);
            assert('bảng 1x1 vẫn giữ dòng thân để gõ', markdownInput.value === '| Head |\n| --- |\n|  |');
            markdownInput.value = saved;
            markdownInput.setSelectionRange(sel[0], sel[1]);
        });

        await section('khối #7', async () => {
            // textarea rời: syncEditorAfterChange() đọc markdownInput thật nên không đụng nội dung người dùng.
            const probe = document.createElement('textarea');
            const savedStack = editorHistory.stack;
            const savedIndex = editorHistory.index;
            editorHistory.stack = [];
            editorHistory.index = -1;
            editorHistory.saveCurrentState(probe);
            probe.value = 'hi';
            editorHistory.undo(probe);
            assert('undo đầu tiên sau khi load có tác dụng', probe.value === '');
            editorHistory.redo(probe);
            assert('redo quay lại nội dung vừa gõ', probe.value === 'hi');
            editorHistory.stack = savedStack;
            editorHistory.index = savedIndex;
        });

        await section('khối #8', async () => {
            // Dấu cách phải tạo mốc lịch sử riêng, nếu không Undo lùi hết cả cụm.
            const saved = markdownInput.value;
            const sel = [markdownInput.selectionStart, markdownInput.selectionEnd];
            const savedStack = editorHistory.stack;
            const savedIndex = editorHistory.index;
            editorHistory.stack = [];
            editorHistory.index = -1;
            markdownInput.value = 'hello';
            editorHistory.saveCurrentState(markdownInput);
            markdownInput.value = 'hello ';
            markdownInput.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ' ' }));
            markdownInput.value = 'hello world';
            markdownInput.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'w' }));
            editorHistory.undo(markdownInput);
            assert('undo lùi từng từ ở dấu cách', markdownInput.value === 'hello ');
            editorHistory.stack = savedStack;
            editorHistory.index = savedIndex;
            markdownInput.value = saved;
            markdownInput.setSelectionRange(sel[0], sel[1]);
        });

        await section('khối #9', async () => {
            // marked.parse ném lỗi: preview phải rơi về văn bản thô, không đụng innerHTML.
            const savedValue = markdownInput.value;
            const savedMarked = window.marked;
            markdownInput.value = '# probe render';
            if (savedMarked) {
                // marked.parse là getter không configurable: thay cả object marked rồi trả lại reference cũ.
                window.marked = { ...savedMarked, parse: () => { throw new Error('probe'); } };
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
            markdownInput.value = savedValue;
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
            const longDoc = '# Tiêu đề\n\n' + 'đoạn **đậm** và `code` cùng [link](https://example.com)\n\n'.repeat(800);
            markdownInput.value = longDoc;
            markdownInput.scrollTop = 0;
            updateEditorHighlight();
            // Pane ẩn (chế độ Preview) thì highlight chủ động bỏ qua vì mọi số đo bằng 0.
            if (!markdownInput.clientWidth) {
                skip('tô màu editor', 'pane đang ẩn');
                return;
            }
            // Ngoài cửa sổ là text thô; toàn bộ chữ vẫn phải khớp textarea, lệch là caret trôi khỏi chữ.
            assert('highlight giữ đúng toàn bộ chữ của textarea', editorHighlightCode.textContent === longDoc + '\n');
            markdownInput.scrollTop = markdownInput.scrollHeight;
            updateEditorHighlight();
            assert('cuộn xuống đáy vẫn giữ đúng chữ', editorHighlightCode.textContent === longDoc + '\n');
            // Chỉ cửa sổ được tô: phần trên là text thô, nếu tô cả file thì node đầu rỗng.
            assert('chỉ tô cửa sổ, phần ngoài là text thô', editorHighlightCode.firstChild.length > 0);
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
        clearTimeout(editorHistory.typingTimer);
        editorHistory.typingTimer = null;
        editorHistory.stack = snap.stack;
        editorHistory.index = snap.index;
        if (markdownInput.value !== snap.value) markdownInput.value = snap.value;
        markdownInput.setSelectionRange(snap.selStart, snap.selEnd);
        markdownInput.scrollTop = snap.scrollTop;
        previewOutput.scrollTop = snap.previewScrollTop;
        // Dựng lại char counter, highlight, preview, tab và nháp phiên từ nội dung thật.
        syncEditorAfterChange();
    }

    // Đếm theo tiền tố dòng; tổng = results.length nên toast luôn khớp console.
    const failed = results.filter(r => r.startsWith('FAIL'));
    const skipped = results.filter(r => r.startsWith('SKIP'));
    const passed = results.length - failed.length - skipped.length;
    const report = `${passed}/${results.length} PASS`;
    (failed.length ? console.error : console.log)('Self-check Import/Export:\n' + results.join('\n'));
    if (failed.length || skipped.length) {
        showToast(`Self-check: ${report}, ${skipped.length} SKIP, ${failed.length} FAIL (see console)`);
    } else {
        showToast(`Self-check: ${report}`);
    }
}