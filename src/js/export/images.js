// js/export/images.js — Xử lý ảnh khi xuất DOC: SVG -> PNG, kích thước ảnh, Mermaid -> PNG.

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

// Word bỏ qua max-width nên PNG 2x sẽ tràn lề: thu ảnh lớn về 650x900 theo tỉ lệ, kèm width/height.
const DOC_IMG_MAX_WIDTH_PX = 650;

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

// Vẽ lên canvas 2x; cần crossOrigin='anonymous' (shields.io có CORS), lỗi thì giữ URL gốc.
export async function svgImageToPngDataUrl(src, w, h, scale = 2) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('image load timeout')), 6000);
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
