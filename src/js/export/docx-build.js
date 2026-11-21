// js/export/docx-build.js — Dựng mô hình DOCX từ DOM và đóng gói thành file .docx.
//
// Không phụ thuộc trạng thái app (chỉ dùng API DOM) để self-check gọi được ngoài editor.

import { createZip } from './docx-zip.js';
import { fitDocImageSize, getDocImageSize, imageToPngDataUrl } from './images.js';
import { findKatexMath, katexTexSource, mathmlToOmml, mathmlToOmmlPara } from './docx-math.js';
import { renderKatexToPng } from './math-image.js';
import {
    EMU_PER_PX,
    NUM_LEVELS,
    REL_BASE,
    buildContentTypesXml,
    buildCorePropsXml,
    buildDocumentRelsXml,
    buildDocumentXml,
    buildNumberingXml,
    buildPackageRelsXml,
    buildStylesXml
} from './docx-xml.js';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Màu viền của từng loại GFM Alert (không có dấu # để ghép vào XML).
const ALERT_COLORS = {
    note: '0969DA',
    tip: '1A7F37',
    important: '8250DF',
    warning: '9A6700',
    caution: 'D1242F'
};

// Bullet list dùng chung numId; mỗi danh sách đánh số có numId riêng để đánh số lại từ 1.
const BULLET_NUM_ID = 1;

// <ol start="5"> bắt đầu từ 5; thiếu hoặc sai thì mặc định 1.
function orderedListStart(el) {
    const n = parseInt(el.getAttribute('start'), 10);
    return Number.isFinite(n) && n >= 0 ? n : 1;
}

// Nhận diện ảnh theo chữ ký byte: Word chỉ ăn PNG/JPEG/GIF/BMP.
function detectImageType(bytes) {
    if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
        return { ext: 'png', mime: 'image/png' };
    }
    if (bytes.length > 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
        return { ext: 'jpeg', mime: 'image/jpeg' };
    }
    if (bytes.length > 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
        return { ext: 'gif', mime: 'image/gif' };
    }
    if (bytes.length > 2 && bytes[0] === 0x42 && bytes[1] === 0x4D) {
        return { ext: 'bmp', mime: 'image/bmp' };
    }
    return null;
}

function decodeDataUrl(src) {
    const match = /^data:([^,]*?)(;base64)?,(.*)$/s.exec(src);
    if (!match) return null;
    const mime = match[1] || 'application/octet-stream';
    let raw;
    try {
        raw = match[2] ? atob(match[3]) : decodeURIComponent(match[3]);
    } catch (err) {
        console.warn('Could not decode the image data URL:', err);
        return null;
    }
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return { bytes, mime };
}

// Dựng lại ảnh lạ (SVG, WebP) thành PNG; canvas bị taint khi ảnh tải lỗi CORS -> trả null.
async function rasterToPng(src, fit) {
    try {
        const dataUrl = await imageToPngDataUrl(src, fit.width || 300, fit.height || 200, { scale: 2 });
        return decodeDataUrl(dataUrl);
    } catch (err) {
        console.warn('Could not convert the image to PNG:', src, err);
        return null;
    }
}

// Checkbox task list -> ký tự, vì Word không có checkbox thật trong run.
function checkboxRun(node, style) {
    if (node.getAttribute('type') !== 'checkbox') return null;
    return { text: node.checked ? '\u2611 ' : '\u2610 ', ...style };
}

class DocxBuilder {
    constructor(title, options = {}) {
        this.title = title;
        // options.mathOriginal(cloneEl) -> phần tử KaTeX gốc (để vẽ PNG fallback).
        this.options = options;
        this.blocks = [];
        this.rels = [
            { id: 'rId1', type: `${REL_BASE}/styles`, target: 'styles.xml' },
            { id: 'rId2', type: `${REL_BASE}/numbering`, target: 'numbering.xml' }
        ];
        this.media = [];
        this.linkIds = new Map();
        this.mediaIds = new Map();
        this.externalImageIds = new Map();
        this.orderedListIds = [];
        // Số thứ tự đầu tiên của từng danh sách đánh số (<ol start="5"> -> 5).
        this.orderedListStarts = [];
        this.nextRelId = 3;
    }

    model() {
        return {
            title: this.title,
            blocks: this.blocks,
            rels: this.rels,
            media: this.media,
            orderedListIds: this.orderedListIds,
            orderedListStarts: this.orderedListStarts
        };
    }

    newRelId() {
        return 'rId' + (this.nextRelId++);
    }

    addLink(url) {
        if (this.linkIds.has(url)) return this.linkIds.get(url);
        const id = this.newRelId();
        this.linkIds.set(url, id);
        this.rels.push({ id, type: `${REL_BASE}/hyperlink`, target: url, mode: 'External' });
        return id;
    }

    // Ảnh ngoài (tải lỗi CORS): quan hệ loại image, không phải hyperlink.
    addExternalImage(url) {
        if (this.externalImageIds.has(url)) return this.externalImageIds.get(url);
        const id = this.newRelId();
        this.externalImageIds.set(url, id);
        this.rels.push({ id, type: `${REL_BASE}/image`, target: url, mode: 'External' });
        return id;
    }

    addMedia(bytes, ext, mime, key) {
        if (this.mediaIds.has(key)) return this.mediaIds.get(key);
        const id = this.newRelId();
        const name = `image${this.media.length + 1}.${ext}`;
        this.mediaIds.set(key, id);
        this.media.push({ name, bytes, mime });
        this.rels.push({ id, type: `${REL_BASE}/image`, target: `media/${name}` });
        return id;
    }

    newOrderedListId(start = 1) {
        const id = this.orderedListIds.length + 2;
        this.orderedListIds.push(id);
        this.orderedListStarts.push(start);
        return id;
    }

    paragraph(runs, props = {}) {
        return { type: 'p', runs, ...props };
    }

    // --- Duyệt khối cấp cao ---

    async build(container) {
        await this.walkChildren(container, this.blocks, { para: {}, color: null });
    }

    async walkChildren(container, out, ctx) {
        for (const node of container.childNodes) {
            if (node.nodeType === 3) {
                const text = node.textContent.replace(/\s+/g, ' ').trim();
                if (text) out.push(this.paragraph([{ text, color: ctx.color }], { ...ctx.para }));
                continue;
            }
            if (node.nodeType !== 1) continue;
            await this.block(node, out, ctx);
        }
    }

    async block(el, out, ctx) {
        const tag = el.tagName;
        if (/^H[1-6]$/.test(tag)) {
            const runs = await this.inlineRuns(el, { color: ctx.color });
            out.push(this.paragraph(runs, { style: `Heading${tag.slice(1)}`, indentLeft: ctx.para.indentLeft }));
            return;
        }
        if (tag === 'P') {
            const runs = await this.inlineRuns(el, { color: ctx.color });
            out.push(this.paragraph(runs, { ...ctx.para }));
            return;
        }
        if (tag === 'BLOCKQUOTE') {
            await this.blockquote(el, out, ctx);
            return;
        }
        if (tag === 'UL' || tag === 'OL') {
            await this.list(el, out, ctx, 0);
            return;
        }
        if (tag === 'PRE') {
            const code = el.querySelector('code') || el;
            const text = code.textContent.replace(/\n+$/, '');
            out.push(this.paragraph([{ text }], { style: 'CodeBlock' }));
            return;
        }
        if (tag === 'TABLE') {
            out.push(await this.table(el));
            return;
        }
        if (tag === 'HR') {
            out.push(this.paragraph([], { borderBottom: { color: 'D0D7DE' }, spacingBefore: 120, spacingAfter: 120 }));
            return;
        }
        if (tag === 'IMG') {
            const run = await this.imageRun(el);
            if (run) out.push(this.paragraph([run], { align: ctx.para.align }));
            return;
        }
        if (tag === 'SPAN' && el.classList.contains('katex-display')) {
            // Công thức hiển thị: một đoạn riêng, canh giữa.
            const math = await this.mathRun(el, true);
            out.push(math);
            return;
        }
        if (tag === 'SPAN' && el.classList.contains('katex')) {
            // span.katex lọt ra ngoài math-slot: vẫn coi là công thức inline.
            const math = await this.mathRun(el, false);
            if (math.omml || math.image || math.text) out.push(this.paragraph([math], {}));
            return;
        }
        if (tag === 'DETAILS') {
            const summary = el.querySelector('summary');
            if (summary) {
                const runs = await this.inlineRuns(summary, { color: ctx.color, bold: true });
                out.push(this.paragraph(runs, { keepNext: true }));
            }
            for (const child of el.children) {
                if (child.tagName === 'SUMMARY') continue;
                await this.block(child, out, ctx);
            }
            return;
        }
        // DIV và mọi thẻ chưa biết: đi sâu vào bên trong.
        const align = el.style && el.style.textAlign ? el.style.textAlign : null;
        const nextCtx = align ? { ...ctx, para: { ...ctx.para, align } } : ctx;
        await this.walkChildren(el, out, nextCtx);
    }

    async blockquote(el, out, ctx) {
        const alertClass = Array.from(el.classList)
            .find((c) => /^markdown-alert-(note|tip|important|warning|caution)$/.test(c));
        const type = alertClass ? alertClass.replace('markdown-alert-', '') : '';
        const borderColor = type ? ALERT_COLORS[type] : 'D0D7DE';
        const quoteCtx = {
            para: {
                indentLeft: 360,
                borderLeft: { color: borderColor, sz: type ? 24 : 18 },
                shading: type ? 'F6F8FA' : null
            },
            color: type ? '24292F' : '57606A'
        };
        let titleDone = false;
        for (const child of el.children) {
            if (!titleDone && type && child.classList.contains('markdown-alert-title')) {
                titleDone = true;
                const runs = await this.inlineRuns(child, { color: borderColor, bold: true });
                out.push(this.paragraph(runs, { ...quoteCtx.para }));
                continue;
            }
            await this.block(child, out, quoteCtx);
        }
    }

    async list(el, out, ctx, level) {
        const numId = el.tagName === 'OL' ? this.newOrderedListId(orderedListStart(el)) : BULLET_NUM_ID;
        for (const li of el.children) {
            if (li.tagName !== 'LI') continue;
            await this.listItem(li, out, ctx, level, numId);
        }
    }

    async listItem(li, out, ctx, level, numId) {
        const runs = [];
        let numbered = false;
        // Khoảng cách đoạn tự đặt: không phụ thuộc contextualSpacing (Word và LO hiểu khác nhau).
        // Word chỉ định nghĩa 9 cấp; list sâu hơn thì ghim vào cấp cuối.
        const ilvl = Math.min(level, NUM_LEVELS - 1);
        const listProps = (withNumber) => ({
            style: 'ListParagraph',
            spacingBefore: 0,
            spacingAfter: 40,
            // Đoạn không đánh số vẫn phải thụt đúng cấp của mục.
            ...(withNumber ? { numId, ilvl } : { indentLeft: 720 + ilvl * 720 })
        });
        const flush = () => {
            if (!runs.length) return;
            const props = numbered ? listProps(false) : listProps(true);
            numbered = true;
            out.push(this.paragraph(runs.splice(0, runs.length), props));
        };
        for (const child of [...li.childNodes]) {
            if (child.nodeType === 3) {
                // Khoảng trắng thuần là xuống dòng HTML, không phải nội dung.
                // Xuống dòng mềm trong mục cũng chỉ là dấu cách, giữ \n sẽ thành <w:br/>.
                const text = child.textContent.replace(/\s+/g, ' ');
                if (text.trim()) runs.push({ text, color: ctx.color });
                continue;
            }
            if (child.nodeType !== 1) continue;
            const tag = child.tagName;
            if (tag === 'INPUT') {
                // Checkbox nằm trực tiếp trong <li>, không có node con để duyệt.
                const run = checkboxRun(child, { color: ctx.color });
                if (run) runs.push(run);
                continue;
            }
            if (tag === 'UL' || tag === 'OL') {
                flush();
                await this.list(child, out, ctx, level + 1);
                continue;
            }
            if (/^(P|DIV|PRE|TABLE|BLOCKQUOTE|HR|DETAILS)$/.test(tag)) {
                flush();
                if (tag === 'P') {
                    const pRuns = await this.inlineRuns(child, { color: ctx.color });
                    // Đoạn tiếp của mục: giữ viền/cạnh của ngữ cảnh ngoài (ví dụ quote), thụt theo cấp mục.
                    const props = numbered ? { ...ctx.para, ...listProps(false) } : listProps(true);
                    numbered = true;
                    out.push(this.paragraph(pRuns, props));
                } else {
                    await this.block(child, out, ctx);
                }
                continue;
            }
            if (/^H[1-6]$/.test(tag)) {
                // Heading trong mục: giữ đúng cấp heading, thụt theo cấp của mục.
                const hRuns = await this.inlineRuns(child, { color: ctx.color });
                out.push(this.paragraph(hRuns, {
                    style: `Heading${tag.slice(1)}`,
                    indentLeft: 720 + ilvl * 720
                }));
                continue;
            }
            runs.push(...await this.inlineRuns(child, { color: ctx.color }));
        }
        flush();
    }

    async table(el) {
        const rows = [];
        let headerSeen = false;
        // Chỉ hàng của bảng này: 'tr' không giới hạn độ sâu sẽ lôi hàng của bảng lồng vào.
        const rowSelector = ':scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr, :scope > tr';
        for (const tr of el.querySelectorAll(rowSelector)) {
            const cells = [];
            const isHeader = !headerSeen && !!tr.querySelector(':scope > th');
            for (const cell of tr.children) {
                if (cell.tagName !== 'TD' && cell.tagName !== 'TH') continue;
                cells.push({
                    blocks: await this.cellBlocks(cell, isHeader),
                    shading: isHeader ? 'F6F8FA' : null
                });
            }
            if (!cells.length) continue;
            rows.push({ cells, header: isHeader });
            if (isHeader) headerSeen = true;
        }
        // Bề rộng cột đo sẵn từ bảng gốc trong Preview (clone chưa vào DOM nên không đo được).
        const widths = this.options.tableWidths ? this.options.tableWidths.get(el) : null;
        return { type: 'table', rows, widths };
    }

    async cellBlocks(cell, isHeader) {
        const children = [...cell.children]
            .filter((c) => /^(P|UL|OL|PRE|TABLE|BLOCKQUOTE|DIV|H[1-6])$/.test(c.tagName));
        if (!children.length) {
            const runs = await this.inlineRuns(cell, isHeader ? { bold: true } : {});
            return [this.paragraph(runs, { spacingBefore: 40, spacingAfter: 40 })];
        }
        const blocks = [];
        for (const child of children) await this.block(child, blocks, { para: {}, color: null });
        return blocks;
    }

    // --- Duyệt nội dung trong dòng ---

    async inlineRuns(el, style = {}) {
        const runs = [];
        for (const node of el.childNodes) {
            if (node.nodeType === 3) {
                // Xuống dòng mềm của Markdown chỉ là dấu cách; giữ \n sẽ thành <w:br/> trong Word.
                const text = node.textContent.replace(/\s+/g, ' ');
                if (text) runs.push({ text, ...style });
                continue;
            }
            if (node.nodeType !== 1) continue;
            const tag = node.tagName;
            if (tag === 'STRONG' || tag === 'B') {
                runs.push(...await this.inlineRuns(node, { ...style, bold: true }));
            } else if (tag === 'EM' || tag === 'I') {
                runs.push(...await this.inlineRuns(node, { ...style, italic: true }));
            } else if (tag === 'DEL' || tag === 'S' || tag === 'STRIKE') {
                runs.push(...await this.inlineRuns(node, { ...style, strike: true }));
            } else if (tag === 'CODE' || tag === 'KBD') {
                runs.push({ text: node.textContent, ...style, code: true });
            } else if (tag === 'A') {
                const href = node.getAttribute('href') || '';
                const linkId = /^(?:https?|mailto|tel|ftp):/i.test(href) ? this.addLink(href) : null;
                runs.push(...await this.inlineRuns(node, { ...style, linkId: linkId || style.linkId }));
            } else if (tag === 'IMG') {
                const run = await this.imageRun(node);
                if (run) runs.push(run);
            } else if (tag === 'BR') {
                runs.push({ break: true, ...style });
            } else if (tag === 'SUP') {
                runs.push(...await this.inlineRuns(node, { ...style, sup: true }));
            } else if (tag === 'SUB') {
                runs.push(...await this.inlineRuns(node, { ...style, sub: true }));
            } else if (tag === 'MARK') {
                runs.push(...await this.inlineRuns(node, { ...style, highlight: 'yellow' }));
            } else if (tag === 'SPAN' && node.classList.contains('katex')) {
                // node là span.katex; bỏ qua phần .katex-html (bản vẽ) bên trong nó.
                const math = await this.mathRun(node, false);
                if (math.text || math.omml || math.image) runs.push(math);
            } else if (tag === 'INPUT') {
                const run = checkboxRun(node, style);
                if (run) runs.push(run);
            } else if (tag === 'SVG') {
                // Icon lucide / SVG inline: Word không nhúng được, bỏ qua.
            } else {
                runs.push(...await this.inlineRuns(node, style));
            }
        }
        return runs;
    }

    // --- Công thức ---

    // OMML là công thức native của Word; không chuyển được thì mới vẽ PNG.
    async mathRun(el, display) {
        const math = findKatexMath(el);
        if (math) {
            const omml = display
                ? mathmlToOmmlPara(math, { display: true })
                : mathmlToOmml(math, { display: false });
            if (omml) {
                return display
                    ? { type: 'p', ommlPara: omml, align: 'center' }
                    : { omml };
            }
        }
        // Fallback: vẽ PNG từ KaTeX (cần phần tử gốc đang nằm trong DOM để đo font).
        const original = this.options.mathOriginal ? this.options.mathOriginal(el) : null;
        if (original) {
            try {
                const { dataUrl, width, height } = await renderKatexToPng(original);
                const decoded = decodeDataUrl(dataUrl);
                const known = decoded ? detectImageType(decoded.bytes) : null;
                if (decoded && known) {
                    const fit = fitDocImageSize(width, height);
                    const relId = this.addMedia(decoded.bytes, known.ext, known.mime, dataUrl);
                    const image = {
                        relId,
                        cx: Math.max(1, Math.round(fit.width * EMU_PER_PX)),
                        cy: Math.max(1, Math.round(fit.height * EMU_PER_PX)),
                        alt: 'Formula'
                    };
                    return display
                        ? { type: 'p', runs: [{ image }], align: 'center' }
                        : { image };
                }
            } catch (err) {
                console.warn('Could not render the formula as an image:', err);
            }
        }
        // Cuối cùng: giữ LaTeX nguồn để không mất nội dung.
        const tex = katexTexSource(el);
        return display
            ? { type: 'p', runs: [{ text: tex, code: true }], align: 'center' }
            : { text: tex, code: true };
    }

    // --- Ảnh ---

    async imageRun(el) {
        const src = el.currentSrc || el.getAttribute('src') || '';
        if (!src) return null;
        const alt = el.getAttribute('alt') || '';
        const size = getDocImageSize(el);
        const fit = fitDocImageSize(size.width || 300, size.height || 200);
        const cx = Math.max(1, Math.round(fit.width * EMU_PER_PX));
        const cy = Math.max(1, Math.round(fit.height * EMU_PER_PX));

        const part = await this.resolveImage(src, fit);
        if (!part) {
            // Tải lỗi (CORS): trỏ thẳng URL, Word tự tải ảnh.
            if (/^https?:/i.test(src)) {
                return { image: { linkId: this.addExternalImage(src), cx, cy, alt } };
            }
            console.warn('Skipping the image that could not be read:', src);
            return null;
        }
        const relId = this.addMedia(part.bytes, part.ext, part.mime, src);
        return { image: { relId, cx, cy, alt } };
    }

    async resolveImage(src, fit) {
        if (src.startsWith('data:')) {
            const decoded = decodeDataUrl(src);
            if (!decoded) return null;
            const known = detectImageType(decoded.bytes);
            if (known) return { ...decoded, ...known };
            return rasterToPng(src, fit);
        }
        if (!/^https?:/i.test(src)) return null;
        try {
            const res = await fetch(src);
            if (!res.ok) return null;
            const bytes = new Uint8Array(await res.arrayBuffer());
            const known = detectImageType(bytes);
            if (known) return { bytes, ...known };
            return rasterToPng(src, fit);
        } catch (err) {
            console.warn('Could not download the image:', src, err);
            return null;
        }
    }
}

// Dùng được trong self-check: dựng model từ một container DOM bất kỳ.
// options.mathOriginal(cloneEl) -> phần tử KaTeX gốc trong Preview (để vẽ PNG fallback).
export async function buildDocxModel(container, title, options = {}) {
    const builder = new DocxBuilder(title, options);
    await builder.build(container);
    return builder.model();
}

export function buildDocxPackage(model) {
    const encoder = new TextEncoder();
    const entries = [
        { name: '[Content_Types].xml', data: encoder.encode(buildContentTypesXml()) },
        { name: '_rels/.rels', data: encoder.encode(buildPackageRelsXml()) },
        { name: 'docProps/core.xml', data: encoder.encode(buildCorePropsXml(model.title)) },
        { name: 'word/document.xml', data: encoder.encode(buildDocumentXml(model)) },
        { name: 'word/_rels/document.xml.rels', data: encoder.encode(buildDocumentRelsXml(model)) },
        { name: 'word/styles.xml', data: encoder.encode(buildStylesXml()) },
        { name: 'word/numbering.xml', data: encoder.encode(buildNumberingXml(model)) },
        ...model.media.map((m) => ({ name: `word/media/${m.name}`, data: m.bytes }))
    ];
    return createZip(entries);
}
