// js/dev/selfcheck.js — Bộ tự kiểm tra nhanh (mở app với ?selfcheck để chạy).

import { infoAbout, infoBody, infoDialog, infoDoc, markdownInput, previewOutput, tableColsInput, tableMenu, tableRowsInput } from '../core/dom.js';
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
import { editorHistory } from '../editor/history.js';
import { convertQuotesForDoc, styleDataTablesForDoc } from '../export/doc-transform.js';
import { buildWordHtml } from '../export/doc.js';
import { deriveDocumentTitle, deriveExportBaseName } from '../export/file-save.js';
import { buildStandaloneHtml } from '../export/html.js';
import { fitDocImageSize, flattenForeignObjects, isSvgImageSrc } from '../export/images.js';
import { katexFontKey, parseKatexFontFaces } from '../export/math-fonts.js';
import { convertKatexForDoc } from '../export/math-mathml.js';
import { makeExclusive } from '../export/menu.js';
import { isImportableFile } from '../io/import.js';
import { assignHeadingIds, renderMarkdown } from '../preview/render.js';
import { MERMAID_SANITIZE_CONFIG } from '../preview/sanitize.js';
import { isInfoDialogOpen } from '../ui/about.js';
import { closeDialogs, openTableDialog } from '../ui/dialogs.js';
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

    assert('filename từ heading có dấu', deriveExportBaseName('# Trình soạn thảo Markdown Live\n\nnội dung') === 'trinh-soan-thao-markdown-live');
    assert('filename bỏ ký tự đặc biệt', deriveExportBaseName('# Tiêu đề (v1.2)!') === 'tieu-de-v12');
    assert('filename fallback khi không có heading', deriveExportBaseName('không có heading') === 'document');
    assert('filename giữ H1 tiếng Nhật', deriveExportBaseName('# 季度報告書') === '季度報告書');
    assert('filename giữ H1 tiếng Nga', deriveExportBaseName('# Отчёт за Q3') === 'отчёт-за-q3');
    assert('filename loại ký tự cấm trong tên file', deriveExportBaseName('# a/b:c*d?e"f<g>h|i') === 'abcdefghi');
    assert('filename bỏ heading trong code fence', deriveExportBaseName('```md\n# comment\n```\n\n# Real Title') === 'real-title');

    assert('split clamp dưới ngưỡng', computeSplitPercent(-50, 1000) === SPLIT_MIN_PERCENT);
    assert('split clamp trên ngưỡng', computeSplitPercent(9999, 1000) === SPLIT_MAX_PERCENT);
    assert('split giữa vùng', computeSplitPercent(500, 1000) === 50);
    assert('split workspace rỗng -> 50', computeSplitPercent(10, 0) === 50);
    assert('kéo sát trái -> preview', computeViewModeFromPercent(1) === 'preview');
    assert('kéo sát phải -> editor', computeViewModeFromPercent(99) === 'editor');
    assert('kéo giữa -> split', computeViewModeFromPercent(50) === 'split');
    assert('view mode rác bị từ chối', isValidViewMode('abc') === false && isValidViewMode('') === false);
    assert('view mode hợp lệ được nhận', isValidViewMode('editor') && isValidViewMode('split') && isValidViewMode('preview'));
    assert('drag dọc giữa -> 50', computeSplitPercent(500, 1000) === 50);
    assert('drag dọc clamp dưới', computeSplitPercent(-50, 1000) === SPLIT_MIN_PERCENT);
    assert('drag dọc clamp trên', computeSplitPercent(9999, 1000) === SPLIT_MAX_PERCENT);

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
    }
    assert('import gate allows md', isImportableFile({ name: 'a.md', type: '' }) === true);
    assert('import gate allows mdown', isImportableFile({ name: 'a.mdown', type: '' }) === true);
    assert('import gate allows mkd', isImportableFile({ name: 'a.mkd', type: '' }) === true);
    assert('import gate allows extensionless', isImportableFile({ name: 'README', type: '' }) === true);
    assert('import gate rejects exe', isImportableFile({ name: 'a.exe', type: '' }) === false);
    (function () {
        const host = document.createElement('div');
        host.innerHTML = '<blockquote><p>a</p></blockquote><blockquote class="markdown-alert markdown-alert-tip"><p class="markdown-alert-title">Tip</p><p>b</p></blockquote>';
        convertQuotesForDoc(host);
        assert('doc quote: không còn blockquote', !host.querySelector('blockquote'));
        assert('doc quote: mỗi quote thành 1 bảng', host.querySelectorAll('table').length === 2);
        assert('doc quote: có đoạn đệm giữa 2 bảng', host.children[0].tagName === 'TABLE' && host.children[1].tagName === 'P' && host.children[2].tagName === 'TABLE');
        assert('doc quote: alert dùng màu viền theo loại', host.querySelectorAll('td')[1].style.cssText.includes('26, 127, 55') || host.querySelectorAll('td')[1].style.cssText.includes('#1a7f37'));
    })();
    (function () {
        const host = document.createElement('div');
        host.innerHTML = '<table><tr><th align="center">A</th></tr><tr><td>B</td></tr></table>';
        styleDataTablesForDoc(host);
        const th = host.querySelector('th');
        const td = host.querySelector('td');
        assert('doc table: ô có viền inline (Word không đọc selector hậu duệ)', td.style.borderTopWidth === '1px' && th.style.borderTopStyle === 'solid');
        assert('doc table: header có nền + đậm', th.style.background === 'rgb(246, 248, 250)' && th.style.fontWeight === 'bold');
        assert('doc table: giữ align của markdown', th.getAttribute('align') === 'center');
    })();
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

    (function () {
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
        // Số dòng người chọn tính cả dòng tiêu đề: 3x2 = tiêu đề + 1 dòng thân, không phải 3 dòng.
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
    })();

    (function () {
        // textarea RỜI: undo/redo gọi syncEditorAfterChange() đọc markdownInput thật nên không đụng nội dung người dùng.
        const probe = document.createElement('textarea');
        const savedStack = editorHistory.stack;
        const savedIndex = editorHistory.index;
        editorHistory.stack = [];
        editorHistory.index = -1;
        editorHistory.saveCurrentState(probe);   // giống applyContent() lúc mới load
        probe.value = 'hi';                       // gõ xong nhưng chưa kịp lưu vào lịch sử
        editorHistory.undo(probe);
        assert('undo đầu tiên sau khi load có tác dụng', probe.value === '');
        editorHistory.redo(probe);
        assert('redo quay lại nội dung vừa gõ', probe.value === 'hi');
        editorHistory.stack = savedStack;
        editorHistory.index = savedIndex;
    })();

    (function () {
        // Dấu cách phải tạo mốc lịch sử riêng, nếu không cả "hello world" gộp một mục và Undo lùi hết cụm.
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
    })();

    (function () {
        // marked.parse ném lỗi (lib chưa tải xong, extension hỏng): preview phải rơi về văn bản thô, không đụng innerHTML.
        const savedValue = markdownInput.value;
        const savedMarked = window.marked;
        markdownInput.value = '# probe render';
        if (savedMarked) {
            // marked v18 khai báo `parse` bằng getter không configurable, nên gán
            // window.marked.parse ném TypeError và làm hỏng cả selfcheck. Thay cả object
            // `marked` (window.marked writable) rồi trả lại đúng reference cũ.
            window.marked = { ...savedMarked, parse: () => { throw new Error('probe'); } };
            renderMarkdown();
            assert('render lỗi -> preview hiện văn bản thô', previewOutput.textContent === '# probe render');
            window.marked = savedMarked;
        }
        markdownInput.value = savedValue;
    })();

    (function () {
        let calls = 0;
        const runOnce = makeExclusive(() => { calls++; });
        runOnce();
        runOnce();
        assert('export chạy chồng bị chặn', calls === 1);
    })();

    (function () {
        tableColsInput.value = '9';
        tableRowsInput.value = '9';
        openTableDialog();
        assert('dialog bảng mở lại về mặc định 3x3', tableColsInput.value === '3' && tableRowsInput.value === '3');
        closeDialogs();
    })();

    (function () {
        // Đi qua listener mouseenter thật (không export hàm ra) để kiểm cả cách ánh xạ chỉ số -> cols/rows.
        const grid = tableMenu.querySelector('.table-grid');
        const hover = (index) => grid.children[index].dispatchEvent(new MouseEvent('mouseenter'));
        const onCount = () => grid.querySelectorAll('.table-cell.on').length;

        hover(7);   // 3 cột x 2 dòng
        assert('lưới bảng sáng đúng hình chữ nhật khi hover', onCount() === 6
            && grid.children[0].classList.contains('on')
            && grid.children[7].classList.contains('on')
            && !grid.children[3].classList.contains('on')     // cột 4 dòng 1
            && !grid.children[10].classList.contains('on'));  // dòng 3
        hover(24);  // 5 cột x 5 dòng
        assert('lưới bảng sáng trọn 5x5', onCount() === 25);
        tableMenu.dispatchEvent(new MouseEvent('mouseleave'));
        assert('lưới bảng tắt sáng khi rời menu', onCount() === 0);
    })();

    assert('slug heading bỏ dấu câu', slugifyText('Tiêu đề Mục 2!') === 'tiêu-đề-mục-2');
    (function () {
        const host = document.createElement('div');
        host.innerHTML = '<h2>Giới thiệu</h2><h2>Giới thiệu</h2>';
        assignHeadingIds(host);
        assert('tiêu đề có id để neo', host.querySelector('h2').id === 'giới-thiệu');
        assert('tiêu đề trùng -> id duy nhất', host.querySelectorAll('h2')[1].id === 'giới-thiệu-1');
    })();

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

    if (typeof katex !== 'undefined') {
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
    }

    if (document.getElementById('btn-help')) {
        const aboutItems = document.querySelectorAll('.about-item');
        assert('nút ? là nút cuối toolbar', document.querySelector('.toolbar').lastElementChild.querySelector('#btn-help') !== null);
        assert('nút ? không còn dropdown', document.getElementById('help-menu') === null);
        assert('about có 2 mục tài liệu', aboutItems.length === 2);

        document.getElementById('btn-help').click();
        assert('bấm ? mở thẳng modal About', isInfoDialogOpen());
        assert('modal mở ra view About', !infoAbout.classList.contains('hidden') && infoDoc.classList.contains('hidden'));
        assert('about hiện số phiên bản', /^\d+\.\d+\.\d+$/.test(document.getElementById('app-version').textContent.trim()));

        // Mở tài liệu rồi đợi fetch xong: showDoc là async nên check phải bất đồng bộ.
        aboutItems[0].click();
        await Promise.race([
            new Promise((resolve) => {
                const observer = new MutationObserver(() => {
                    if (infoBody.textContent !== 'Loading...') {
                        observer.disconnect();
                        resolve();
                    }
                });
                observer.observe(infoBody, { childList: true, subtree: true, characterData: true });
            }),
            new Promise((resolve) => setTimeout(resolve, 3000))
        ]);
        assert('bấm mục đổi sang view tài liệu', infoAbout.classList.contains('hidden') && !infoDoc.classList.contains('hidden'));
        assert('modal license đọc được file', infoBody.textContent.includes('MIT License'));
        // Chuỗi flex .dialog-wide > #info-doc > #info-body mới làm tài liệu dài (third-party
        // notices) cuộn trong hộp thay vì tràn ra ngoài. Bỏ display:flex ở #info-doc là hỏng.
        assert('nội dung tài liệu cuộn trong hộp', getComputedStyle(infoDoc).display === 'flex'
            && infoBody.scrollHeight >= infoBody.clientHeight
            && infoBody.getBoundingClientRect().bottom <= infoDialog.querySelector('.dialog').getBoundingClientRect().bottom);

        document.getElementById('info-back').click();
        assert('nút Back quay lại view About', !infoAbout.classList.contains('hidden') && infoDoc.classList.contains('hidden'));
        document.getElementById('info-close').click();
        assert('đóng modal about', !isInfoDialogOpen());
    }

    const failed = results.filter(r => r.startsWith('FAIL'));
    (failed.length ? console.error : console.log)('Self-check Import/Export:\n' + results.join('\n'));
    if (failed.length) showToast(`Self-check: ${failed.length} test FAIL (see console)`);
    else showToast('Self-check: all PASS');
}
