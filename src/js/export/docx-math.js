// js/export/docx-math.js — MathML của KaTeX -> OMML (công thức native của Word).
//
// OMML = Office Math Markup Language: Word mở được và sửa được bằng Equation Editor.
// Bản đồ chính: mfrac -> m:f, msqrt/mroot -> m:rad, msup/msub/msubsup -> m:sSup/m:sSub/m:sSubSup,
// mo fence -> m:d, toán tử lớn (∑ ∫ ...) -> m:nary, mtable -> m:m.

import { escapeXml } from './docx-xml.js';

// Ký tự vô hình (function application, invisible times...) Word không cần.
const INVISIBLE_OPS = new Set(['\u2061', '\u2062', '\u2063', '\u2064']);

// Toán tử n-ary: cần đổi thành m:nary để Word đặt giới hạn đúng chỗ.
const NARY_CHARS = new Set([
    '\u2211', '\u220F', '\u2210', '\u222B', '\u222C', '\u222D', '\u222E', '\u222F',
    '\u2230', '\u22C0', '\u22C1', '\u22C2', '\u22C3', '\u2A00'
]);

// Dấu nhấn: MathML dùng ký tự ASCII, OMML cần ký tự ghép.
const ACCENT_CHARS = {
    '^': '\u0302', '~': '\u0303', '\u2192': '\u20D7', '\u02D9': '\u0307',
    '\u00A8': '\u0308', '\u02C7': '\u030C', '\u02D8': '\u0306', "'": '\u0301'
};

// Ký tự gạch ngang (overline/underline) -> dùng m:bar thay vì m:acc.
const BAR_CHARS = new Set(['\u203E', '\u00AF', '\u2032']);

// Ngoặc mở/đóng khớp nhau.
const FENCE_PAIRS = {
    '(': ')', '[': ']', '{': '}', '\u27E8': '\u27E9', '\u2308': '\u2309',
    '\u230A': '\u230B', '\u007C': '\u007C', '\u2016': '\u2016'
};

// Biến thể chữ: KaTeX ghi mathvariant, OMML thì dùng ký tự Unicode tương ứng.
const VARIANT_MAP = {
    // ℬ ℂ ℰ ℱ ℍ ℕ ℙ ℚ ℝ ℤ ℓ ℯ ℊ ℴ
    'double-struck': {
        '\u0042': '\u212C', '\u0043': '\u2102', '\u0045': '\u2130', '\u0046': '\u2131',
        '\u0048': '\u210D', '\u004E': '\u2115', '\u0050': '\u2119', '\u0051': '\u211A',
        '\u0052': '\u211D', '\u005A': '\u2124', '\u0065': '\u212F', '\u0067': '\u210A',
        '\u006C': '\u2113', '\u006F': '\u2134'
    },
    // ℬ ℰ ℱ ℋ ℐ ℒ ℳ ℛ ℓ ℯ ℊ ℴ
    script: {
        '\u0042': '\u212C', '\u0045': '\u2130', '\u0046': '\u2131', '\u0048': '\u210B',
        '\u0049': '\u2110', '\u004C': '\u2112', '\u004D': '\u2133', '\u0052': '\u211B',
        '\u0065': '\u212F', '\u0067': '\u210A', '\u006C': '\u2113', '\u006F': '\u2134'
    },
    // ℭ ℌ ℑ ℜ ℨ
    fraktur: {
        '\u0043': '\u212D', '\u0048': '\u210C', '\u0049': '\u2111', '\u0052': '\u211C',
        '\u005A': '\u2128'
    }
};

// Biến thể đổi theo khoảng cách mã Unicode (bold/italic/sans/mono).
const VARIANT_OFFSETS = {
    bold: [0x1D400, 0x1D41A],
    italic: [0x1D434, 0x1D44E],
    'bold-italic': [0x1D468, 0x1D482],
    'sans-serif': [0x1D5A0, 0x1D5BA],
    'sans-serif-bold': [0x1D5D4, 0x1D5EE],
    'sans-serif-italic': [0x1D608, 0x1D622],
    monospace: [0x1D670, 0x1D68A]
};

// Bold/italic/sans/mono: dùng thuộc tính run của OMML (m:sty/m:scr), KHÔNG dùng codepoint
// Mathematical Alphanumeric (U+1D4xx) — font của Word không có glyph đó nên chữ biến mất.
const VARIANT_STYLES = {
    bold: { sty: 'b' },
    italic: { sty: 'i' },
    'bold-italic': { sty: 'bi' },
    'sans-serif': { scr: 'sans-serif', sty: 'p' },
    'sans-serif-italic': { scr: 'sans-serif', sty: 'i' },
    'sans-serif-bold': { scr: 'sans-serif', sty: 'b' },
    monospace: { scr: 'monospace', sty: 'p' }
};

function elementChildren(el) {
    return Array.from(el.children || []);
}

function textOf(el) {
    return el ? el.textContent : '';
}

// Chuyển chữ sang ký tự Unicode của biến thể (ví dụ \mathbb{R} -> ℝ).
function variantChar(ch, variant) {
    const table = VARIANT_MAP[variant];
    if (table && table[ch]) return table[ch];
    const offsets = VARIANT_OFFSETS[variant];
    if (offsets) {
        const code = ch.charCodeAt(0);
        if (code >= 65 && code <= 90) return String.fromCodePoint(offsets[0] + code - 65);
        if (code >= 97 && code <= 122) return String.fromCodePoint(offsets[1] + code - 97);
    }
    return null;
}

// Run của OMML: <m:r><m:rPr><m:sty/></m:rPr><m:t>..</m:t></m:r>
// Thứ tự trong m:rPr: m:scr trước m:sty (Word đòi vậy).
function ommlRun(text, style, script) {
    if (!text) return '';
    const props = [];
    if (script) props.push(`<m:scr m:val="${script}"/>`);
    if (style) props.push(`<m:sty m:val="${style}"/>`);
    const rPr = props.length ? `<m:rPr>${props.join('')}</m:rPr>` : '';
    return `<m:r>${rPr}<m:t xml:space="preserve">${escapeXml(text)}</m:t></m:r>`;
}

function ommlRunPlain(text) {
    return ommlRun(text, 'p');
}

function convertChildren(el) {
    return elementChildren(el).map(convertElement).join('');
}

// Đọc phần thân của <math>: bỏ <semantics>/<annotation>, lấy <mrow> đầu tiên.
function mathBody(math) {
    const semantics = elementChildren(math).find((c) => c.tagName === 'semantics');
    const scope = semantics || math;
    for (const child of elementChildren(scope)) {
        if (child.tagName === 'annotation' || child.tagName === 'annotation-xml') continue;
        return child;
    }
    return null;
}

function isFence(el) {
    return !!el && el.tagName === 'mo' && el.getAttribute('fence') === 'true';
}

function isBigOperator(el) {
    if (!el || el.tagName !== 'mo') return false;
    const t = textOf(el);
    return t.length === 1 && NARY_CHARS.has(t);
}

// Toán tử nhị phân: đánh dấu chỗ ngừng lấy toán hạng của m:nary.
const BINARY_OPS = new Set(['+', '-', '=', '<', '>', '\u2260', '\u2264', '\u2265', '\u00B1', ',', ';', '\u2212']);

// Điểm dừng của toán hạng n-ary: gặp toán tử nhị phân thì hết.
function stopsOperand(el) {
    if (!el || el.tagName !== 'mo') return false;
    return BINARY_OPS.has(textOf(el));
}

// <mo fence="true">(</mo> ... <mo fence="true">)</mo> -> m:d
function convertDelimited(kids) {
    const beg = textOf(kids[0]);
    const end = textOf(kids[kids.length - 1]);
    if (FENCE_PAIRS[beg] !== end) return null;
    const inner = kids.slice(1, -1).map(convertElement).join('');
    return `<m:d><m:dPr><m:begChr m:val="${escapeXml(beg)}"/><m:endChr m:val="${escapeXml(end)}"/></m:dPr>`
        + `<m:e>${inner}</m:e></m:d>`;
}

// <mi>sin</mi><mo>&#x2061;</mo> -> m:func
function isFunctionName(el) {
    if (!el || el.tagName !== 'mi') return false;
    const t = textOf(el);
    return t.length > 1 && /^[a-zA-Z]+$/.test(t);
}

function isInvisibleApply(el) {
    return !!el && el.tagName === 'mo' && INVISIBLE_OPS.has(textOf(el));
}

// Tìm cặp ngoặc đóng sau mở, để lấy đúng phần đối số của hàm.
function closingIndex(kids, open) {
    let depth = 0;
    for (let i = open; i < kids.length; i++) {
        const t = textOf(kids[i]);
        if (kids[i].tagName === 'mo' && (t === '(' || t === '[' || t === '{')) depth++;
        else if (kids[i].tagName === 'mo' && (t === ')' || t === ']' || t === '}')) {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

// Toán tử lớn kèm giới hạn: msubsup/munderover -> m:nary
function convertNary(el, operand, display) {
    const base = elementChildren(el)[0];
    const chr = textOf(base);
    const rest = elementChildren(el).slice(1);
    let sub = '';
    let sup = '';
    if (el.tagName === 'msubsup') {
        sub = rest[0] ? convertElement(rest[0]) : '';
        sup = rest[1] ? convertElement(rest[1]) : '';
    } else if (el.tagName === 'munderover') {
        sub = rest[0] ? convertElement(rest[0]) : '';
        sup = rest[1] ? convertElement(rest[1]) : '';
    } else if (el.tagName === 'msub') {
        sub = rest[0] ? convertElement(rest[0]) : '';
    } else if (el.tagName === 'msup') {
        sup = rest[0] ? convertElement(rest[0]) : '';
    }
    const limLoc = display ? 'undOvr' : 'subSup';
    const subHide = sub ? '0' : '1';
    const supHide = sup ? '0' : '1';
    return '<m:nary><m:naryPr>'
        + `<m:chr m:val="${escapeXml(chr)}"/><m:limLoc m:val="${limLoc}"/><m:grow m:val="1"/>`
        + `<m:subHide m:val="${subHide}"/><m:supHide m:val="${supHide}"/>`
        + `</m:naryPr><m:sub>${sub}</m:sub><m:sup>${sup}</m:sup><m:e>${operand}</m:e></m:nary>`;
}

// Dấu nhấn: mover/munder có accent -> m:acc hoặc m:bar
function convertAccent(el, isUnder) {
    const kids = elementChildren(el);
    const base = kids[0] ? convertElement(kids[0]) : '';
    const mark = textOf(kids[1]);
    if (BAR_CHARS.has(mark)) {
        const pos = isUnder ? 'bot' : 'top';
        return `<m:bar><m:barPr><m:pos m:val="${pos}"/></m:barPr><m:e>${base}</m:e></m:bar>`;
    }
    const chr = ACCENT_CHARS[mark] || mark;
    return `<m:acc><m:accPr><m:chr m:val="${escapeXml(chr)}"/></m:accPr><m:e>${base}</m:e></m:acc>`;
}

// KaTeX dựng môi trường aligned/align thành mtable columnalign="right left".
// Đó là mảng công thức căn theo dấu "=", phải là m:eqArr; để m:m thì Word coi là ma trận
// và các dòng lệch nhau (xem ECMA-376 m:eqArr và phần "align value").
function isAlignedTable(align) {
    return align.length === 2 && align[0] === 'right' && align[1] === 'left';
}

// Mỗi dòng là một m:e; dấu & trong m:t là điểm căn (align value) của Word.
function convertEqArray(rows) {
    const alignValue = '<m:r><m:t xml:space="preserve">&amp;</m:t></m:r>';
    const body = rows.map((row) => {
        const cells = elementChildren(row).filter((c) => c.tagName === 'mtd')
            .map((cell) => convertChildren(cell));
        return `<m:e>${cells.join(alignValue)}</m:e>`;
    }).join('');
    return '<m:eqArr><m:eqArrPr><m:baseJc m:val="center"/><m:maxDist m:val="0"/><m:objDist m:val="1"/>'
        + `</m:eqArrPr>${body}</m:eqArr>`;
}

function convertTable(el) {
    const rows = elementChildren(el).filter((c) => c.tagName === 'mtr');
    const columns = rows.length ? elementChildren(rows[0]).filter((c) => c.tagName === 'mtd').length : 0;
    const align = (el.getAttribute('columnalign') || '').trim().split(/\s+/);
    if (isAlignedTable(align)) return convertEqArray(rows);
    // Mỗi cột một mc để giữ căn lề riêng.
    const cols = Array.from({ length: columns }, (_, i) => {
        const a = align[i] || align[0] || 'center';
        const just = a === 'right' ? 'right' : a === 'left' ? 'left' : 'center';
        return `<m:mc><m:mcPr><m:count m:val="1"/><m:mcJc m:val="${just}"/></m:mcPr></m:mc>`;
    }).join('');
    const body = rows.map((row) => {
        const cells = elementChildren(row).filter((c) => c.tagName === 'mtd')
            .map((cell) => `<m:e>${convertChildren(cell)}</m:e>`).join('');
        return `<m:mr>${cells}</m:mr>`;
    }).join('');
    return `<m:m><m:mPr><m:mcs>${cols}</m:mcs></m:mPr>${body}</m:m>`;
}

function convertElement(el) {
    const tag = el.tagName;
    switch (tag) {
        case 'mrow':
            return convertRow(el);
        case 'mi': {
            const variant = el.getAttribute('mathvariant');
            const raw = textOf(el);
            // Bold/italic/sans/mono: để Word tự vẽ bằng m:sty/m:scr.
            const style = VARIANT_STYLES[variant];
            if (style) return ommlRun(raw, style.sty, style.scr);
            // double-struck/script/fraktur: giữ codepoint Unicode (ℝ, ℬ, ℯ có sẵn trong font).
            const converted = variant ? variantChar(raw, variant) : null;
            const text = converted || raw;
            // Chữ đơn là biến (nghiêng); chữ nhiều ký tự là tên hàm (đứng).
            if (variant === 'normal') return ommlRunPlain(text);
            if (converted) return ommlRunPlain(text);
            return raw.length > 1 ? ommlRunPlain(text) : ommlRun(text);
        }
        case 'mn':
            return ommlRunPlain(textOf(el));
        case 'mo': {
            const t = textOf(el);
            if (INVISIBLE_OPS.has(t)) return '';
            return ommlRunPlain(t);
        }
        case 'mtext':
            return ommlRunPlain(textOf(el));
        case 'mspace':
            return '';
        case 'mfrac': {
            const kids = elementChildren(el);
            const num = kids[0] ? convertElement(kids[0]) : '';
            const den = kids[1] ? convertElement(kids[1]) : '';
            // \binom dùng mfrac không vạch -> kiểu noBar.
            const thin = (el.getAttribute('linethickness') || '').trim();
            const type = thin && /^(0|0px|0pt|0em)$/i.test(thin) ? ' noBar' : '';
            return `<m:f>${type ? `<m:fPr><m:type m:val="noBar"/></m:fPr>` : ''}`
                + `<m:num>${num}</m:num><m:den>${den}</m:den></m:f>`;
        }
        case 'msqrt': {
            const e = convertChildren(el);
            return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${e}</m:e></m:rad>`;
        }
        case 'mroot': {
            const kids = elementChildren(el);
            const e = kids[0] ? convertElement(kids[0]) : '';
            const deg = kids[1] ? convertElement(kids[1]) : '';
            return `<m:rad><m:radPr><m:degHide m:val="0"/></m:radPr><m:deg>${deg}</m:deg><m:e>${e}</m:e></m:rad>`;
        }
        case 'msup': {
            const kids = elementChildren(el);
            const e = kids[0] ? convertElement(kids[0]) : '';
            const sup = kids[1] ? convertElement(kids[1]) : '';
            return `<m:sSup><m:e>${e}</m:e><m:sup>${sup}</m:sup></m:sSup>`;
        }
        case 'msub': {
            const kids = elementChildren(el);
            const e = kids[0] ? convertElement(kids[0]) : '';
            const sub = kids[1] ? convertElement(kids[1]) : '';
            return `<m:sSub><m:e>${e}</m:e><m:sub>${sub}</m:sub></m:sSub>`;
        }
        case 'msubsup': {
            const kids = elementChildren(el);
            const e = kids[0] ? convertElement(kids[0]) : '';
            const sub = kids[1] ? convertElement(kids[1]) : '';
            const sup = kids[2] ? convertElement(kids[2]) : '';
            return `<m:sSubSup><m:e>${e}</m:e><m:sub>${sub}</m:sub><m:sup>${sup}</m:sup></m:sSubSup>`;
        }
        case 'mover': {
            if (el.getAttribute('accent') === 'true') return convertAccent(el, false);
            const kids = elementChildren(el);
            const e = kids[0] ? convertElement(kids[0]) : '';
            const over = kids[1] ? convertElement(kids[1]) : '';
            return `<m:limUpp><m:e>${e}</m:e><m:lim>${over}</m:lim></m:limUpp>`;
        }
        case 'munder': {
            if (el.getAttribute('accentunder') === 'true') return convertAccent(el, true);
            const kids = elementChildren(el);
            const e = kids[0] ? convertElement(kids[0]) : '';
            const under = kids[1] ? convertElement(kids[1]) : '';
            return `<m:limLow><m:e>${e}</m:e><m:lim>${under}</m:lim></m:limLow>`;
        }
        case 'munderover': {
            const kids = elementChildren(el);
            const e = kids[0] ? convertElement(kids[0]) : '';
            const under = kids[1] ? convertElement(kids[1]) : '';
            const over = kids[2] ? convertElement(kids[2]) : '';
            return `<m:limLow><m:e>${e}</m:e><m:lim>${under}`
                + `<m:limUpp><m:e/><m:lim>${over}</m:lim></m:limUpp></m:lim></m:limLow>`;
        }
        case 'mtable':
            return convertTable(el);
        case 'mstyle':
        case 'mpadded':
        case 'mphantom':
        case 'menclose':
            return convertChildren(el);
        case 'mfenced': {
            const beg = el.getAttribute('open') || '(';
            const end = el.getAttribute('close') || ')';
            return `<m:d><m:dPr><m:begChr m:val="${escapeXml(beg)}"/><m:endChr m:val="${escapeXml(end)}"/></m:dPr>`
                + `<m:e>${convertChildren(el)}</m:e></m:d>`;
        }
        default:
            // Thẻ lạ: bỏ qua wrapper, giữ nội dung bên trong.
            return convertChildren(el);
    }
}

// Một hàng MathML: tự nhận ngoặc \left..\right và hàm \sin(x).
function convertRow(el, display) {
    const kids = elementChildren(el);
    let out = '';
    for (let i = 0; i < kids.length; i++) {
        const child = kids[i];
        if (i === 0 && kids.length > 2 && isFence(child) && isFence(kids[kids.length - 1])) {
            const delimited = convertDelimited(kids);
            if (delimited) return delimited;
        }
        if (isFunctionName(child) && isInvisibleApply(kids[i + 1])) {
            const name = ommlRunPlain(textOf(child));
            let arg = '';
            let next = i + 2;
            const opener = kids[next];
            if (opener && opener.tagName === 'mo' && /^[([{]$/.test(textOf(opener))) {
                const close = closingIndex(kids, next);
                if (close !== -1) {
                    arg = kids.slice(next, close + 1).map(convertElement).join('');
                    next = close + 1;
                }
            } else if (opener) {
                arg = convertElement(opener);
                next = i + 3;
            }
            // Không có đối số (ví dụ \lim) thì để tên hàm là run thường, tránh m:func rỗng.
            out += arg
                ? `<m:func><m:fName>${name}</m:fName><m:e>${arg}</m:e></m:func>`
                : name;
            i = next - 1;
            continue;
        }
        if (isBigOperator(elementChildren(child)[0])
            && (child.tagName === 'msubsup' || child.tagName === 'munderover' || child.tagName === 'msub' || child.tagName === 'msup')) {
            // Toán hạng của m:nary lấy tiếp các phần tử sau, dừng ở toán tử nhị phân.
            const operandKids = [];
            let j = i + 1;
            while (j < kids.length && !stopsOperand(kids[j])) {
                operandKids.push(kids[j]);
                j++;
            }
            out += convertNary(child, operandKids.map(convertElement).join(''), display);
            i = j - 1;
            continue;
        }
        out += convertElement(child);
    }
    return out;
}

// Tìm phần <math> trong span.katex của KaTeX (bản htmlAndMathml hoặc mathml thuần).
export function findKatexMath(el) {
    if (!el) return null;
    if (el.tagName === 'math') return el;
    return el.querySelector('.katex-mathml > math') || el.querySelector(':scope > math') || null;
}

// LaTeX nguồn, dùng khi không chuyển được sang OMML.
export function katexTexSource(el) {
    if (!el) return '';
    const annotation = el.querySelector('annotation[encoding="application/x-tex"]');
    return annotation ? annotation.textContent : (el.textContent || '').trim();
}

// MathML -> OMML. Trả null nếu không chuyển được (khi đó gọi dùng ảnh PNG).
export function mathmlToOmml(math, { display = false } = {}) {
    try {
        if (!math) return null;
        const body = mathBody(math);
        if (!body) return null;
        const inner = body.tagName === 'mrow'
            ? convertRow(body, display)
            : convertElement(body);
        if (!inner) return null;
        return `<m:oMath>${inner}</m:oMath>`;
    } catch (err) {
        console.warn('Could not convert the formula to a Word equation:', err);
        return null;
    }
}

// Công thức hiển thị: bọc trong oMathPara để Word canh giữa.
export function mathmlToOmmlPara(math, { display = true } = {}) {
    const omml = mathmlToOmml(math, { display });
    if (!omml) return null;
    return `<m:oMathPara><m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr>${omml}</m:oMathPara>`;
}
