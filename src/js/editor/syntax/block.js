// js/editor/syntax/block.js — Tô màu cú pháp Markdown mức dòng / khối (heading, list, quote, fence, bảng...).

import { escapeHtml, highlightInline } from './inline.js';

const alertHighlightColors = {
    NOTE: 'var(--alert-note-color)',
    TIP: 'var(--alert-tip-color)',
    IMPORTANT: 'var(--alert-important-color)',
    WARNING: 'var(--alert-warning-color)',
    CAUTION: 'var(--alert-caution-color)'
};

function highlightMarkdownLine(line) {
    // Đường kẻ ngang: 3 ký tự - * _ trở lên cùng loại (cho phép xen khoảng trắng)
    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
        return `<span class="md-hr">${escapeHtml(line)}</span>`;
    }

    // Định nghĩa footnote: [^id]: nội dung
    let m = line.match(/^(\s{0,3})(\[\^)([^\]]+)(\]:)(\s*)(.*)$/);
    if (m) {
        const [, indent, ob, fnId, cb, space, content] = m;
        return `${escapeHtml(indent)}<span class="md-footnote-marker">${ob}</span><span class="md-footnote-id">${escapeHtml(fnId)}</span><span class="md-footnote-marker">${cb}</span>${escapeHtml(space)}${highlightInline(escapeHtml(content))}`;
    }

    // Định nghĩa reference link: [id]: url "title" (id không chứa ^ để khỏi nhầm footnote)
    m = line.match(/^(\s{0,3})(\[)([^\]^]+)(\])(:)(\s*)(\S+)(?:(\s+)(.*))?$/);
    if (m) {
        const [, indent, ob, id, cb, colon, sp1, url, sp2 = '', title = ''] = m;
        return `${escapeHtml(indent)}<span class="md-link-marker">${ob}</span><span class="md-ref-id">${escapeHtml(id)}</span><span class="md-link-marker">${cb}${colon}</span>${escapeHtml(sp1)}<span class="md-link-url">${escapeHtml(url)}</span>${escapeHtml(sp2)}${title ? `<span class="md-ref-title">${escapeHtml(title)}</span>` : ''}`;
    }

    // Tiêu đề ATX: 1-6 dấu # rồi khoảng trắng
    m = line.match(/^(\s{0,3})(#{1,6})(\s+)(.*)$/);
    if (m) {
        const [, indent, hashes, space, content] = m;
        const level = hashes.length;
        return `${escapeHtml(indent)}<span class="md-header-marker">${hashes}</span>${escapeHtml(space)}<span class="md-header md-header-${level}">${highlightInline(escapeHtml(content))}</span>`;
    }

    // Trích dẫn: một hoặc nhiều dấu >
    m = line.match(/^(\s{0,3}>+\s?)(.*)$/);
    if (m) {
        const [, marker, rest] = m;
        // GFM alert: [!NOTE] | [!TIP] | [!IMPORTANT] | [!WARNING] | [!CAUTION]
        const alertMatch = rest.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](.*)$/i);
        if (alertMatch) {
            const type = alertMatch[1].toUpperCase();
            const color = alertHighlightColors[type] || '#0969da';
            return `<span class="md-quote-marker">${escapeHtml(marker)}</span><span class="md-alert-tag" style="color:${color}">[!${type}]</span><span class="md-quote-text">${highlightInline(escapeHtml(alertMatch[2]))}</span>`;
        }
        return `<span class="md-quote-marker">${escapeHtml(marker)}</span><span class="md-quote-text">${highlightInline(escapeHtml(rest))}</span>`;
    }

    // Task list: marker danh sách + [ ] hoặc [x]
    m = line.match(/^(\s*)([-*+]|\d+[.)])(\s+)(\[(?: |x|X)\])(\s+)(.*)$/);
    if (m) {
        const [, indent, marker, sp1, checkbox, sp2, content] = m;
        const isChecked = checkbox.toLowerCase().includes('x');
        const checkClass = isChecked ? 'md-task-checked' : 'md-task-unchecked';
        return `${escapeHtml(indent)}<span class="md-list-marker">${escapeHtml(marker)}</span>${escapeHtml(sp1)}<span class="md-task-checkbox ${checkClass}">${escapeHtml(checkbox)}</span>${escapeHtml(sp2)}${highlightInline(escapeHtml(content))}`;
    }

    // List item: -, *, + hoặc số kèm . / )
    m = line.match(/^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/);
    if (m) {
        const [, indent, marker, space, content] = m;
        return `${escapeHtml(indent)}<span class="md-list-marker">${escapeHtml(marker)}</span>${escapeHtml(space)}${highlightInline(escapeHtml(content))}`;
    }

    if (line.includes('|')) {
        // Dòng phân tách bảng: |---|:---:|---:|
        if (/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line)) {
            // Thay | bằng placeholder để chỉ tô phần gạch/dấu :, rồi trả | về đã tô riêng ở cuối
            return escapeHtml(line)
                .replace(/\|/g, '\u0000P\u0000')  // | -> placeholder
                .replace(/:?-+:?/g, '<span class="md-table-separator">$&</span>')  // phần gạch kèm dấu : căn lề tuỳ chọn
                .split('\u0000P\u0000').join('<span class="md-table-pipe">|</span>');
        }
        // Token hoá inline code trước để dấu | trong code không bị tô như dấu bảng.
        const codeStore = [];
        let escapedLine = escapeHtml(line);
        
        // Tách inline code (`...`) ra token để dấu | trong code không bị tô
        escapedLine = escapedLine.replace(/(`+)([^`]+?)\1/g, (m, ticks, content) => {
            const token = `\u0000CODE_${codeStore.length}\u0000`;
            codeStore.push(`${ticks}${content}${ticks}`);
            return token;
        });
        
        // Tô các dấu | của bảng
        escapedLine = escapedLine.replace(/\|/g, '<span class="md-table-pipe">|</span>');
        
        // Trả token inline code về lại
        escapedLine = escapedLine.replace(/\u0000CODE_(\d+)\u0000/g, (m, idx) => {
            return `<span class="md-code-inline">${codeStore[Number(idx)]}</span>`;
        });
        
        return highlightInline(escapedLine);
    }

    return highlightInline(escapeHtml(line));
}

export function highlightMarkdown(text) {
    const lines = text.split('\n');
    let inFence = false;
    let inMathBlock = false;
    let inHtmlComment = false;
    let inIndentedCode = false;

    const isPlainPara = (s) => {
        if (!s || !s.trim()) return false;
        if (/^\s{0,3}(=+|-+)\s*$/.test(s)) return false;               // gạch dưới setext
        if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(s)) return false;  // đường kẻ ngang
        if (/^\s{0,3}#{1,6}\s+/.test(s)) return false;                 // tiêu đề ATX
        if (/^\s{0,3}>/.test(s)) return false;                         // trích dẫn
        if (/^\s*([-*+]|\d+[.)])\s+/.test(s)) return false;            // danh sách
        if (/^\s{0,3}\[\^/.test(s)) return false;                      // định nghĩa footnote
        if (/^\s{0,3}\[[^\]^]+\]:/.test(s)) return false;              // định nghĩa reference link
        if (/^\s{0,3}(`{3,}|~{3,})/.test(s)) return false;             // fence code
        if (/^\s*\$\$/.test(s)) return false;                          // khối toán $$
        if (/^(    |\t)/.test(s)) return false;                        // indented code
        if (s.includes('|')) return false;
        if (s.includes('<!--') || s.includes('-->')) return false;
        return true;
    };

    const outputLines = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Đặt trước fence để ``` nằm trong HTML comment vẫn là comment.
        if (inHtmlComment) {
            outputLines.push(`<span class="md-html-comment">${escapeHtml(line)}</span>`);
            if (line.includes('-->')) inHtmlComment = false;
            continue;
        }

        // Fence code: ``` hoặc ~~~ (từ 3 ký tự), phần còn lại là info string
        const fenceMatch = line.match(/^(\s{0,3})(`{3,}|~{3,})(.*)$/);
        if (fenceMatch) {
            inIndentedCode = false;
            if (!inFence) {
                inFence = true;
                const [, indent, marker, lang] = fenceMatch;
                outputLines.push(`${escapeHtml(indent)}<span class="md-fence-marker">${escapeHtml(marker)}</span><span class="md-fence-lang">${escapeHtml(lang)}</span>`);
            } else {
                inFence = false;
                const [, indent, marker] = fenceMatch;
                outputLines.push(`${escapeHtml(indent)}<span class="md-fence-marker">${escapeHtml(marker)}</span>`);
            }
            continue;
        }

        if (inFence) {
            outputLines.push(`<span class="md-code-block">${escapeHtml(line)}</span>`);
            continue;
        }

        if (inMathBlock) {
            // Dòng đóng khối toán: chỉ có $$ hoặc kết thúc bằng $$
            if (/^\s*\$\$\s*$/.test(line) || line.trim().endsWith('$$')) {
                inMathBlock = false;
            }
            outputLines.push(`<span class="md-math">${escapeHtml(line)}</span>`);
            continue;
        }

        // Indented code chỉ mở sau dòng trắng/đầu file (không chen giữa paragraph/list);
        // dòng trắng không kết thúc block.
        if (/^(    |\t)/.test(line)) {
            if (inIndentedCode || i === 0 || !lines[i - 1].trim()) {
                inIndentedCode = true;
                outputLines.push(`<span class="md-code-block">${escapeHtml(line)}</span>`);
                continue;
            }
        } else if (!line.trim()) {
            outputLines.push(escapeHtml(line));
            continue;
        } else {
            inIndentedCode = false;
        }

        if (line.includes('<!--') && !line.includes('-->')) {
            inHtmlComment = true;
            outputLines.push(`<span class="md-html-comment">${escapeHtml(line)}</span>`);
            continue;
        }

        // Mở khối toán nhiều dòng: bắt đầu bằng $$ nhưng không đóng ngay trên cùng dòng
        if (/^\s*\$\$/.test(line) && !/^\s*\$\$.+\$\$\s*$/.test(line)) {
            inMathBlock = true;
            outputLines.push(`<span class="md-math">${escapeHtml(line)}</span>`);
            continue;
        }

        // Setext heading: đặt trước highlightMarkdownLine để --- sau paragraph thành H2 chứ không phải <hr>.
        const setextMatch = line.match(/^\s{0,3}(=+|-+)\s*$/);
        // Loại trường hợp chỉ có đúng 1 dấu '-' (không coi là gạch dưới setext)
        if (setextMatch && i > 0 && isPlainPara(lines[i - 1]) && !/^\s{0,3}-\s*$/.test(line)) {
            const level = setextMatch[1][0] === '=' ? 1 : 2;
            outputLines[i - 1] = `<span class="md-header md-header-${level}">${outputLines[i - 1]}</span>`;
            outputLines.push(`<span class="md-header-marker">${escapeHtml(line)}</span>`);
            continue;
        }

        outputLines.push(highlightMarkdownLine(line));
    }

    return outputLines.join('\n');
}
