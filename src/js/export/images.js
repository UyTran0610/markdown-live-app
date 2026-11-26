// js/export/images.js — Xử lý ảnh khi xuất DOC: SVG -> PNG, kích thước ảnh, Mermaid -> PNG.

import { CONTENT_WIDTH_TWIP } from './docx-xml.js';

// Nhận diện ảnh theo chữ ký byte: Word chỉ ăn PNG/JPEG/GIF/BMP.
export function detectImageType(bytes) {
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

// Tải ảnh từ mạng: có giới hạn thời gian và kích thước, một host treo không làm treo app.
const IMAGE_DOWNLOAD_TIMEOUT_MS = 6000;
const IMAGE_DOWNLOAD_MAX_BYTES = 8 * 1024 * 1024;

export async function downloadImageBytes(src, { timeoutMs = IMAGE_DOWNLOAD_TIMEOUT_MS, maxBytes = IMAGE_DOWNLOAD_MAX_BYTES } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(src, { signal: controller.signal });
        if (!res.ok) return null;
        const declared = Number(res.headers.get('content-length') || 0);
        if (declared && declared > maxBytes) return null;
        const buf = await res.arrayBuffer();
        if (buf.byteLength > maxBytes) return null;
        return new Uint8Array(buf);
    } catch (err) {
        console.warn('Could not download the image:', src, err);
        return null;
    } finally {
        clearTimeout(timer);
    }
}

// bytes -> data URL (dùng FileReader để không tự viết base64).
function bytesToDataUrl(bytes, mime) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not encode the image'));
        reader.readAsDataURL(new Blob([bytes], { type: mime }));
    });
}

// Nhúng ảnh từ mạng thành data URL: file .html mang theo ảnh, mở ở máy khác không cần mạng.
// SVG từ mạng cũng được nhúng (đổi sang PNG, vì file HTML không mang theo file .svg).
// Trả { inlined, failed }.
export async function inlineRemoteImages(origRoot, clone) {
    const origImgs = origRoot.querySelectorAll('img');
    const cloneImgs = clone.querySelectorAll('img');
    let inlined = 0;
    let failed = 0;
    for (let i = 0; i < cloneImgs.length; i++) {
        const img = cloneImgs[i];
        const orig = origImgs[i];
        const raw = (orig && orig.getAttribute('src')) || img.getAttribute('src') || '';
        if (!/^https?:/i.test(raw)) continue;
        if (isSvgImageSrc(raw)) {
            const size = orig ? getDocImageSize(orig) : { width: 0, height: 0 };
            const fit = fitDocImageSize(size.width || 400, size.height || 300);
            try {
                img.setAttribute('src', await svgImageToPngDataUrl(raw, fit.width, fit.height));
                img.removeAttribute('srcset');
                inlined++;
            } catch (err) {
                failed++;
                console.warn('Could not embed the SVG image:', raw, err);
            }
            continue;
        }
        const bytes = await downloadImageBytes(raw);
        if (!bytes) {
            failed++;
            continue;
        }
        const known = detectImageType(bytes);
        if (!known) {
            failed++;
            continue;
        }
        img.setAttribute('src', await bytesToDataUrl(bytes, known.mime));
        img.removeAttribute('srcset');
        inlined++;
    }
    return { inlined, failed };
}

// SVG nằm trực tiếp trong tài liệu (không phải Mermaid, không phải icon): đổi sang PNG,
// vì Word không nhúng SVG tốt và nội dung text trong SVG sẽ thành chữ rác trong file Word.
// Gọi SAU prepareDocImages: thay SVG bằng <img> làm danh sách ảnh của clone lệch với preview.
// Trả số SVG không chuyển được.
export async function convertInlineSvgsToPng(origRoot, clone, { withStyle = false } = {}) {
    const pick = (root) => [...root.querySelectorAll('svg')]
        .filter((el) => !el.classList.contains('lucide') && !el.closest('pre.mermaid'));
    const origSvgs = pick(origRoot);
    const cloneSvgs = pick(clone);
    let failed = 0;
    for (let i = 0; i < cloneSvgs.length; i++) {
        const orig = origSvgs[i];
        if (!orig) continue;
        try {
            const { dataUrl, width, height } = await svgToPngDataUrl(orig);
            const img = document.createElement('img');
            img.src = dataUrl;
            img.alt = orig.getAttribute('aria-label') || '';
            const fit = fitDocImageSize(width, height);
            if (fit.width > 0 && fit.height > 0) {
                img.setAttribute('width', fit.width);
                img.setAttribute('height', fit.height);
                if (withStyle) {
                    img.style.width = fit.width + 'px';
                    img.style.height = fit.height + 'px';
                }
            }
            cloneSvgs[i].replaceWith(img);
        } catch (err) {
            failed++;
            cloneSvgs[i].remove();
            console.warn('Could not convert an inline SVG to PNG:', err);
        }
    }
    return failed;
}

// <foreignObject> (nhãn HTML của Mermaid) -> <text> thuần SVG vì canvas không vẽ được.
// ponytail: mất đậm/nghiêng, chỉ giữ chữ/màu/cỡ; nâng cấp sau: dựng text theo toạ độ từng span.
export function flattenForeignObjects(svgClone, fallbackColor, fallbackFontSize) {
    const NS = 'http://www.w3.org/2000/svg';
    svgClone.querySelectorAll('foreignObject').forEach((fo) => {
        const div = fo.querySelector('div, span, p');
        const lines = (div ? div.textContent : fo.textContent).split('\n').map(s => s.trim()).filter(Boolean);
        if (!lines.length) {
            fo.remove();
            return;
        }
        const x = parseFloat(fo.getAttribute('x')) || 0;
        const y = parseFloat(fo.getAttribute('y')) || 0;
        const w = parseFloat(fo.getAttribute('width')) || 100;
        const h = parseFloat(fo.getAttribute('height')) || 40;
        const fontSize = (div && div.style.fontSize) || fallbackFontSize || '16px';
        const lineH = (parseFloat(fontSize) || 16) * 1.25;
        const text = document.createElementNS(NS, 'text');
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'middle');
        text.setAttribute('fill', (div && div.style.color) || fallbackColor || '#000');
        text.setAttribute('font-size', fontSize);
        // Mỗi dòng là một tspan căn giữa; vị trí do transform của phần tử cha quyết định.
        const startY = y + h / 2 - ((lines.length - 1) * lineH) / 2;
        lines.forEach((line, i) => {
            const tspan = document.createElementNS(NS, 'tspan');
            tspan.setAttribute('x', x + w / 2);
            tspan.setAttribute('y', startY + i * lineH);
            tspan.textContent = line;
            text.appendChild(tspan);
        });
        fo.replaceWith(text);
    });
}

// SVG -> PNG 2x kèm kích thước hiển thị (Word không hỗ trợ SVG inline).
export async function svgToPngDataUrl(svg, scale = 2) {
    // viewBox dạng 'x y w h', ngăn cách bằng khoảng trắng hoặc dấu phẩy.
    const viewBox = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    const rect = svg.getBoundingClientRect();
    const w = rect.width > 0 ? rect.width : (viewBox.length === 4 && viewBox[2] > 0 ? viewBox[2] : 800);
    const h = rect.height > 0 ? rect.height : (viewBox.length === 4 && viewBox[3] > 0 ? viewBox[3] : 600);

    const svgStyle = window.getComputedStyle(svg);
    const clone = svg.cloneNode(true);
    flattenForeignObjects(clone, svgStyle.color, svgStyle.fontSize);
    clone.setAttribute('width', w);
    clone.setAttribute('height', h);

    const img = new Image();
    await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
    });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, w, h);
    return { dataUrl: canvas.toDataURL('image/png'), width: w, height: h };
}

// Word bỏ qua max-width nên PNG 2x sẽ tràn lề: thu ảnh về đúng bề rộng khung nội dung.
// DOCX dùng A4 (CONTENT_WIDTH_TWIP -> 642 px), DOC dùng khuyến mặc định của Word (6.5in = 624 px).
// Lấy số nhỏ hơn để ảnh không tràn lề trong cả hai.
const DOC_IMG_MAX_WIDTH_PX = Math.min(624, Math.floor(CONTENT_WIDTH_TWIP / 1440 * 96));

const DOC_IMG_MAX_HEIGHT_PX = 900;

export function fitDocImageSize(w, h, maxW = DOC_IMG_MAX_WIDTH_PX, maxH = DOC_IMG_MAX_HEIGHT_PX) {
    w = Math.round(Number(w));
    h = Math.round(Number(h));
    if (!(w > 0) || !(h > 0)) return { width: w, height: h };
    const s = Math.min(1, maxW / w, maxH / h);
    return { width: Math.round(w * s), height: Math.round(h * s) };
}

// Badge SVG remote không có width/height nên Word tự đoán: luôn gắn kích thước px tường minh
// cho MỌI ảnh, và đổi SVG sang PNG data-URL (Word xử lý PNG ổn định hơn).
// Các host chuyên phục vụ badge (luôn trả SVG).
const DOC_SVG_HOSTS = /^https?:\/\/(?:img\.shields\.io|flat\.badgen\.net|badgen\.net|badge\.fury\.io|camo\.githubusercontent\.com)\//i;

// URL này có thể trả về SVG? (shields.io trả SVG dù URL không có đuôi .svg)
export function isSvgImageSrc(src) {
    src = String(src || '');
    // data:image/svg, đuôi .svg (có thể kèm ?query/#hash), hoặc host badge.
    return /^data:image\/svg/i.test(src) || /\.svg(?:[?#]|$)/i.test(src) || DOC_SVG_HOSTS.test(src);
}

// Kích thước hiển thị: ưu tiên width/height người dùng ghi (bỏ %), rồi kích thước tự nhiên.
export function getDocImageSize(orig) {
    // Bỏ qua giá trị dạng % vì không quy ra px được.
    const px = (v) => (v && !/%\s*$/.test(v)) ? (parseFloat(v) || 0) : 0;
    let w = px(orig.getAttribute('width'));
    let h = px(orig.getAttribute('height'));
    const natW = orig.naturalWidth || 0;
    const natH = orig.naturalHeight || 0;
    const ratio = natW > 0 && natH > 0 ? natW / natH : 0;
    if (w > 0 && !(h > 0) && ratio) h = w / ratio;
    else if (h > 0 && !(w > 0) && ratio) w = h * ratio;
    else if (!(w > 0) || !(h > 0)) { w = natW; h = natH; }
    if (!(w > 0) || !(h > 0)) {
        const r = orig.getBoundingClientRect();
        w = r.width;
        h = r.height;
    }
    return { width: w, height: h };
}

export function waitForImageLoad(img, timeoutMs = 4000) {
    if (img.complete) return Promise.resolve();
    return new Promise((resolve) => {
        const done = () => { clearTimeout(t); img.removeEventListener('load', done); img.removeEventListener('error', done); resolve(); };
        const t = setTimeout(done, timeoutMs);
        img.addEventListener('load', done);
        img.addEventListener('error', done);
    });
}

// Tải ảnh vào canvas rồi xuất PNG. crossOrigin='anonymous' cần cho ảnh từ host khác (CORS).
export async function imageToPngDataUrl(src, w, h, { scale = 2, crossOrigin = false, timeoutMs = 6000 } = {}) {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('image load timeout')), timeoutMs);
        img.onload = () => { clearTimeout(t); resolve(); };
        img.onerror = () => { clearTimeout(t); reject(new Error('image load failed')); };
        img.src = src;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
}

// Vẽ lên canvas 2x; cần crossOrigin='anonymous' (shields.io có CORS), lỗi thì giữ URL gốc.
export async function svgImageToPngDataUrl(src, w, h, scale = 2) {
    return imageToPngDataUrl(src, w, h, { scale, crossOrigin: true });
}

// Gom ảnh của Preview về kích thước hiển thị và đổi SVG sang PNG.
// Clone chưa vào DOM nên đo kích thước từ ảnh gốc trong Preview theo chỉ số.
// Vì vậy danh sách ảnh của clone phải khớp Preview: đừng thêm <img> vào clone trước bước này.
// withStyle: DOC (HTML) cần style để trình duyệt giữ đúng khung; DOCX chỉ cần thuộc tính.
// Trả số ảnh KHÔNG chuyển được (SVG tải lỗi) để người dùng được báo.
export async function prepareDocImages(origRoot, clone, { withStyle = false } = {}) {
    const origImgs = origRoot.querySelectorAll('img');
    const cloneImgs = clone.querySelectorAll('img');
    let failed = 0;
    for (let i = 0; i < cloneImgs.length; i++) {
        const img = cloneImgs[i];
        const orig = origImgs[i];
        if (!orig) continue;
        await waitForImageLoad(orig);
        const size = getDocImageSize(orig);
        const fit = fitDocImageSize(size.width, size.height);
        if (!(fit.width > 0 && fit.height > 0)) continue;
        const src = orig.currentSrc || orig.getAttribute('src') || '';
        if (isSvgImageSrc(src)) {
            try {
                img.src = await svgImageToPngDataUrl(src, fit.width, fit.height);
                img.removeAttribute('srcset');
            } catch (e) {
                failed++;
                console.warn('Could not convert the SVG image to PNG, keeping the original URL:', src, e);
            }
        }
        img.setAttribute('width', fit.width);
        img.setAttribute('height', fit.height);
        if (withStyle) {
            img.style.width = fit.width + 'px';
            img.style.height = fit.height + 'px';
        }
    }
    return failed;
}

// Mermaid -> PNG; lỗi thì giữ nguyên khối code để không mất nội dung.
// Trả số biểu đồ KHÔNG vẽ được để báo cho người dùng.
export async function convertMermaidToImages(origRoot, clone, { withStyle = false } = {}) {
    // Ánh xạ theo chính node pre (không theo chỉ số svg): mermaid lỗi làm lệch chỉ số và xuất nhầm ảnh.
    const cloneMers = clone.querySelectorAll('pre.mermaid');
    const origPres = origRoot.querySelectorAll('pre.mermaid');
    let failed = 0;
    for (let i = 0; i < cloneMers.length; i++) {
        const svg = origPres[i] && origPres[i].querySelector('svg');
        if (!svg) {
            failed++;
            console.warn('Mermaid diagram has no SVG yet, skipping image conversion:', i);
            continue;
        }
        try {
            const { dataUrl, width, height } = await svgToPngDataUrl(svg);
            const img = document.createElement('img');
            img.src = dataUrl;
            img.alt = 'Mermaid diagram';
            // PNG vẽ ở 2x mà Word bỏ qua max-width: luôn gắn kích thước hiển thị tường minh.
            const fit = fitDocImageSize(width, height);
            if (fit.width > 0 && fit.height > 0) {
                img.setAttribute('width', fit.width);
                img.setAttribute('height', fit.height);
                if (withStyle) {
                    img.style.width = fit.width + 'px';
                    img.style.height = fit.height + 'px';
                }
            }
            cloneMers[i].replaceWith(img);
        } catch (e) {
            failed++;
            console.warn('Could not convert the Mermaid diagram to an image, keeping the source code:', e);
        }
    }
    return failed;
}
