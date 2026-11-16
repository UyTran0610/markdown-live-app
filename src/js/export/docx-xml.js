// js/export/docx-xml.js — Sinh OOXML (WordprocessingML) cho file DOCX. Không dùng DOM.
//
// Model đầu vào:
//   { title, blocks, rels, media, orderedListIds }
// block: { type: 'p' | 'table', ... } — xem các hàm build bên dưới.

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const M_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

// Tiền tố kiểu quan hệ (r:id) dùng cho styles/numbering/image/hyperlink.
export const REL_BASE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// A4 dọc, lề 2cm: khung nội dung dùng để chia cột bảng.
const PAGE_WIDTH_TWIP = 11906;
const PAGE_HEIGHT_TWIP = 16838;
const PAGE_MARGIN_TWIP = 1134;
export const CONTENT_WIDTH_TWIP = PAGE_WIDTH_TWIP - PAGE_MARGIN_TWIP * 2;

// Word hỗ trợ tối đa 9 cấp danh sách (ilvl 0..8).
export const NUM_LEVELS = 9;

// 1 px @96dpi = 9525 EMU (đơn vị của DrawingML).
export const EMU_PER_PX = 9525;

export function escapeXml(text) {
    return String(text ?? '')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')        // ký tự điều khiển không hợp lệ trong XML
        .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// --- Đoạn văn / run ---

function runPropsXml(run, isLink) {
    const props = [];
    if (isLink) props.push('<w:rStyle w:val="Hyperlink"/>');
    else if (run.code) props.push('<w:rStyle w:val="CodeChar"/>');
    if (run.bold) props.push('<w:b/>');
    if (run.italic) props.push('<w:i/>');
    if (run.strike) props.push('<w:strike/>');
    if (run.color) props.push(`<w:color w:val="${run.color}"/>`);
    if (run.highlight) props.push(`<w:highlight w:val="${run.highlight}"/>`);
    if (run.sup) props.push('<w:vertAlign w:val="superscript"/>');
    if (run.sub) props.push('<w:vertAlign w:val="subscript"/>');
    return props.length ? `<w:rPr>${props.join('')}</w:rPr>` : '';
}

function drawingXml(image, ctx) {
    const descr = escapeXml(image.alt || '');
    const id = ++ctx.imageId;
    // Ảnh nhúng dùng r:embed, ảnh ngoài (tải lỗi) dùng r:link.
    const blip = image.relId ? `r:embed="${image.relId}"` : `r:link="${image.linkId}"`;
    return '<w:drawing>'
        + `<wp:inline distT="0" distB="0" distL="0" distR="0">`
        + `<wp:extent cx="${image.cx}" cy="${image.cy}"/>`
        + '<wp:effectExtent l="0" t="0" r="0" b="0"/>'
        + `<wp:docPr id="${id}" name="Picture ${id}" descr="${descr}"/>`
        + '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>'
        + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        + '<pic:pic><pic:nvPicPr>'
        + `<pic:cNvPr id="${id}" name="Picture ${id}" descr="${descr}"/><pic:cNvPicPr/></pic:nvPicPr>`
        + `<pic:blipFill><a:blip ${blip}/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
        + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${image.cx}" cy="${image.cy}"/></a:xfrm>`
        + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
        + '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>';
}

function runXml(run, ctx, isLink) {
    const props = runPropsXml(run, isLink);
    if (run.image) return `<w:r>${props}${drawingXml(run.image, ctx)}</w:r>`;
    if (run.break) return `<w:r>${props}<w:br/></w:r>`;
    // w:t không giữ xuống dòng: tách theo \n rồi chèn w:br giữa các phần.
    const parts = String(run.text ?? '').split('\n');
    const body = parts
        .map((part, i) => (i ? '<w:br/>' : '') + `<w:t xml:space="preserve">${escapeXml(part)}</w:t>`)
        .join('');
    return `<w:r>${props}${body}</w:r>`;
}

// Các run liền nhau cùng linkId gộp vào một w:hyperlink.
function runsXml(runs, ctx) {
    let out = '';
    let i = 0;
    while (i < runs.length) {
        const run = runs[i];
        // Công thức OMML nằm thẳng trong w:p, không bọc trong w:r.
        if (run.omml) {
            out += run.omml;
            i++;
            continue;
        }
        if (run.linkId) {
            const group = [];
            while (i < runs.length && runs[i].linkId === run.linkId) { group.push(runs[i]); i++; }
            out += `<w:hyperlink r:id="${run.linkId}" w:history="1">`
                + group.map((r) => runXml(r, ctx, true)).join('')
                + '</w:hyperlink>';
        } else {
            out += runXml(run, ctx);
            i++;
        }
    }
    return out;
}

function paragraphXml(paragraph, ctx) {
    const props = [];
    if (paragraph.style) props.push(`<w:pStyle w:val="${paragraph.style}"/>`);
    if (paragraph.keepNext) props.push('<w:keepNext/>');
    if (paragraph.numId) {
        props.push(`<w:numPr><w:ilvl w:val="${paragraph.ilvl || 0}"/><w:numId w:val="${paragraph.numId}"/></w:numPr>`);
    }
    const borders = [];
    if (paragraph.borderLeft) {
        borders.push(`<w:left w:val="single" w:sz="${paragraph.borderLeft.sz || 18}" w:space="8" w:color="${paragraph.borderLeft.color}"/>`);
    }
    if (paragraph.borderBottom) {
        borders.push(`<w:bottom w:val="single" w:sz="6" w:space="1" w:color="${paragraph.borderBottom.color}"/>`);
    }
    if (borders.length) props.push(`<w:pBdr>${borders.join('')}</w:pBdr>`);
    if (paragraph.shading) props.push(`<w:shd w:val="clear" w:color="auto" w:fill="${paragraph.shading}"/>`);
    if (paragraph.spacingBefore !== undefined || paragraph.spacingAfter !== undefined) {
        const before = paragraph.spacingBefore !== undefined ? ` w:before="${paragraph.spacingBefore}"` : '';
        const after = paragraph.spacingAfter !== undefined ? ` w:after="${paragraph.spacingAfter}"` : '';
        props.push(`<w:spacing${before}${after}/>`);
    }
    if (paragraph.indentLeft || paragraph.indentRight) {
        const left = paragraph.indentLeft ? ` w:left="${paragraph.indentLeft}"` : '';
        const right = paragraph.indentRight ? ` w:right="${paragraph.indentRight}"` : '';
        props.push(`<w:ind${left}${right}/>`);
    }
    if (paragraph.align) props.push(`<w:jc w:val="${paragraph.align}"/>`);
    const pPr = props.length ? `<w:pPr>${props.join('')}</w:pPr>` : '';
    // Công thức hiển thị chiếm trọn đoạn (oMathPara không được trộn nội dung khác).
    const content = paragraph.ommlPara ? paragraph.ommlPara : runsXml(paragraph.runs || [], ctx);
    return `<w:p>${pPr}${content}</w:p>`;
}

// --- Bảng ---

function cellXml(cell, ctx) {
    const props = [`<w:tcW w:w="${cell.width || 0}" w:type="dxa"/>`];
    if (cell.shading) props.push(`<w:shd w:val="clear" w:color="auto" w:fill="${cell.shading}"/>`);
    props.push('<w:vAlign w:val="center"/>');
    const blocks = (cell.blocks && cell.blocks.length) ? cell.blocks : [{ type: 'p', runs: [] }];
    return `<w:tc><w:tcPr>${props.join('')}</w:tcPr>${blocks.map((b) => blockXml(b, ctx)).join('')}</w:tc>`;
}

function tableXml(table, ctx) {
    const columns = table.rows[0] ? table.rows[0].cells.length : 1;
    const widths = table.widths && table.widths.length === columns
        ? table.widths
        : new Array(columns).fill(Math.floor(CONTENT_WIDTH_TWIP / Math.max(1, columns)));
    const grid = widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('');
    const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
        .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="D0D7DE"/>`)
        .join('');
    const rows = table.rows.map((row) => {
        const trPr = row.header ? '<w:trPr><w:tblHeader/></w:trPr>' : '';
        const cells = row.cells.map((cell, i) => cellXml({ ...cell, width: widths[i] }, ctx)).join('');
        return `<w:tr>${trPr}${cells}</w:tr>`;
    }).join('');
    // Word cần một đoạn trống sau bảng, nếu không hai bảng sát nhau bị gộp.
    return '<w:tbl><w:tblPr>'
        + `<w:tblW w:w="${CONTENT_WIDTH_TWIP}" w:type="dxa"/>`
        + `<w:tblBorders>${borders}</w:tblBorders>`
        + '<w:tblLayout w:type="fixed"/>'
        + '<w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="108" w:type="dxa"/>'
        + '<w:bottom w:w="60" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar>'
        + `</w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows}</w:tbl>`
        + '<w:p/>';
}

function blockXml(block, ctx) {
    if (block.type === 'table') return tableXml(block, ctx);
    return paragraphXml(block, ctx);
}

// --- Các part khác của gói ---

export function buildDocumentXml(model) {
    const ctx = { imageId: 0 };
    const body = model.blocks.map((b) => blockXml(b, ctx)).join('');
    const section = '<w:sectPr>'
        + `<w:pgSz w:w="${PAGE_WIDTH_TWIP}" w:h="${PAGE_HEIGHT_TWIP}"/>`
        + `<w:pgMar w:top="${PAGE_MARGIN_TWIP}" w:right="${PAGE_MARGIN_TWIP}" w:bottom="${PAGE_MARGIN_TWIP}"`
        + ` w:left="${PAGE_MARGIN_TWIP}" w:header="708" w:footer="708" w:gutter="0"/>`
        + '<w:cols w:space="708"/><w:docGrid w:linePitch="360"/></w:sectPr>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        + `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}" xmlns:wp="${WP_NS}" xmlns:a="${A_NS}" xmlns:pic="${PIC_NS}" xmlns:m="${M_NS}">`
        + `<w:body>${body}${section}</w:body></w:document>`;
}

const HEADING_SIZES = [40, 32, 28, 24, 22, 20];

function headingStyle(level, size) {
    const color = level === 6 ? '57606A' : '1F2328';
    return `<w:style w:type="paragraph" w:styleId="Heading${level}">`
        + `<w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/>`
        + `<w:uiPriority w:val="9"/><w:qFormat/>`
        + '<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="120"/>'
        + `<w:outlineLvl w:val="${level - 1}"/></w:pPr>`
        + `<w:rPr><w:b/><w:color w:val="${color}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>`
        + '</w:style>';
}

export function buildStylesXml() {
    const headings = HEADING_SIZES.map((size, i) => headingStyle(i + 1, size)).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        + `<w:styles xmlns:w="${W_NS}">`
        + '<w:docDefaults><w:rPrDefault><w:rPr>'
        + '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>'
        + '<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/>'
        + '</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>'
        + '<w:spacing w:after="120" w:line="276" w:lineRule="auto"/>'
        + '</w:pPr></w:pPrDefault></w:docDefaults>'
        + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
        + headings
        + '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/>'
        + '<w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/>'
        + '<w:pPr><w:spacing w:after="60"/><w:contextualSpacing/></w:pPr></w:style>'
        + '<w:style w:type="paragraph" w:styleId="CodeBlock"><w:name w:val="Code Block"/><w:basedOn w:val="Normal"/>'
        + '<w:uiPriority w:val="20"/><w:qFormat/>'
        + '<w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="6" w:color="D0D7DE"/></w:pBdr>'
        + '<w:shd w:val="clear" w:color="auto" w:fill="F6F8FA"/>'
        + '<w:spacing w:before="120" w:after="120"/></w:pPr>'
        + '<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>'
        + '<w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>'
        + '<w:style w:type="character" w:styleId="CodeChar"><w:name w:val="Code Char"/>'
        + '<w:uiPriority w:val="1"/><w:rPr>'
        + '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>'
        + '<w:shd w:val="clear" w:color="auto" w:fill="F1F3F5"/></w:rPr></w:style>'
        + '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/>'
        + '<w:uiPriority w:val="99"/><w:rPr><w:color w:val="0969DA"/><w:u w:val="single"/></w:rPr></w:style>'
        + '</w:styles>';
}

// Bullet xen kẳng 3 kiểu như mặc định của Word (Symbol, Courier New, Wingdings).
const BULLET_STYLES = [
    ['\uF0B7', 'Symbol'],
    ['o', 'Courier New'],
    ['\uF0A7', 'Wingdings']
];

function bulletLevel(level) {
    const [char, font] = BULLET_STYLES[level % BULLET_STYLES.length];
    const indent = 720 + level * 720;
    return `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="bullet"/>`
        + `<w:lvlText w:val="${char}"/><w:lvlJc w:val="left"/>`
        + `<w:pPr><w:ind w:left="${indent}" w:hanging="360"/></w:pPr>`
        + `<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:hint="default"/></w:rPr></w:lvl>`;
}

function decimalLevel(level) {
    const indent = 720 + level * 720;
    // Cấp 0 -> %1., cấp 1 -> %1.%2., cấp 2 -> %1.%2.%3. ...
    const text = Array.from({ length: level + 1 }, (_, i) => `%${i + 1}`).join('.') + '.';
    return `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="decimal"/>`
        + `<w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/>`
        + `<w:pPr><w:ind w:left="${indent}" w:hanging="360"/></w:pPr></w:lvl>`;
}

export function buildNumberingXml(model) {
    const listIds = model.orderedListIds || [];
    const nums = ['<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'];
    for (const id of listIds) {
        // startOverride để mỗi danh sách đánh số bắt đầu lại từ 1.
        const overrides = Array.from({ length: NUM_LEVELS }, (_, lvl) =>
            `<w:lvlOverride w:ilvl="${lvl}"><w:startOverride w:val="1"/></w:lvlOverride>`).join('');
        nums.push(`<w:num w:numId="${id}"><w:abstractNumId w:val="1"/>${overrides}</w:num>`);
    }
    const bullets = Array.from({ length: NUM_LEVELS }, (_, i) => bulletLevel(i)).join('');
    const decimals = Array.from({ length: NUM_LEVELS }, (_, i) => decimalLevel(i)).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        + `<w:numbering xmlns:w="${W_NS}">`
        + '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>'
        + bullets
        + '</w:abstractNum>'
        + '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>'
        + decimals
        + '</w:abstractNum>'
        + nums.join('')
        + '</w:numbering>';
}

export function buildContentTypesXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Default Extension="png" ContentType="image/png"/>'
        + '<Default Extension="jpeg" ContentType="image/jpeg"/>'
        + '<Default Extension="jpg" ContentType="image/jpeg"/>'
        + '<Default Extension="gif" ContentType="image/gif"/>'
        + '<Default Extension="bmp" ContentType="image/bmp"/>'
        + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
        + '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
        + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
        + '</Types>';
}

export function buildPackageRelsXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        + `<Relationships xmlns="${PKG_REL_NS}">`
        + `<Relationship Id="rId1" Type="${R_NS}/officeDocument" Target="word/document.xml"/>`
        + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
        + '</Relationships>';
}

export function buildDocumentRelsXml(model) {
    const rels = (model.rels || []).map((rel) => {
        const mode = rel.mode ? ` TargetMode="${rel.mode}"` : '';
        return `<Relationship Id="${rel.id}" Type="${rel.type}" Target="${escapeXml(rel.target)}"${mode}/>`;
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        + `<Relationships xmlns="${PKG_REL_NS}">${rels}</Relationships>`;
}

export function buildCorePropsXml(title) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"'
        + ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"'
        + ' xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        + `<dc:title>${escapeXml(title || 'Document')}</dc:title>`
        + '<dc:creator>Markdown Live</dc:creator>'
        + '<cp:lastModifiedBy>Markdown Live</cp:lastModifiedBy>'
        + '</cp:coreProperties>';
}
