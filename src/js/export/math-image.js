// js/export/math-image.js — Công thức KaTeX -> PNG cho file DOC (giống cách xử lý Mermaid), rơi về MathML nếu lỗi.

import { previewOutput } from '../core/dom.js';
import { fitDocImageSize } from './images.js';
import { getKatexAssets, getKatexFontDataUri, collectKatexFontKeys } from './math-fonts.js';
import { convertKatexForDoc } from './math-mathml.js';

// Clone span.katex gốc từ Preview, nhúng CSS KaTeX + đúng các font đang dùng (base64) vào SVG <foreignObject>,
// vẽ lên canvas rồi xuất PNG. Công thức nào vẽ lỗi / ra ảnh trống thì giữ nguyên để convertKatexForDoc()
// chuyển sang MathML như cũ (xem convertKatexToImagesForDoc).
const KATEX_IMG_SCALE = 3;

const KATEX_IMG_PAD = 2;

// Vẽ MỘT công thức (span.katex trong Preview) thành PNG. Trả { dataUrl, width, height, descent } (px, chưa nhân scale);
// descent = khoảng cách từ baseline xuống đáy ảnh, dùng để canh ảnh inline cho thẳng hàng chữ.
// Ném lỗi nếu canvas bị taint hoặc ảnh trống (WebView không vẽ được foreignObject) -> nơi gọi dùng MathML.
async function renderKatexToPng(origKatex, scale = KATEX_IMG_SCALE) {
    const assets = await getKatexAssets();

    const clone = origKatex.cloneNode(true);
    // Lớp MathML ẩn không cần cho ảnh (và làm XHTML khó serialize hơn).
    clone.querySelectorAll('.katex-mathml').forEach((n) => n.remove());

    // Giữ cỡ chữ/độ đậm của ngữ cảnh trong Preview; ép màu đen vì file Word nền trắng (Preview có thể đang ở Dark).
    const pcs = getComputedStyle(origKatex.parentElement || previewOutput);
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:inline-block;margin:0;padding:' + KATEX_IMG_PAD + 'px;white-space:nowrap;'
        + 'line-height:normal;background:transparent;color:#000;'
        + 'font-size:' + pcs.fontSize + ';font-weight:' + pcs.fontWeight + ';';
    wrap.appendChild(clone);

    // Đo ngoài màn hình: cùng document nên CSS KaTeX trang đang dùng áp dụng đúng.
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;';
    host.appendChild(wrap);
    document.body.appendChild(host);
    try {
        const rect = wrap.getBoundingClientRect();
        const width = Math.max(1, Math.ceil(rect.width));
        const height = Math.max(1, Math.ceil(rect.height));

        // Probe rộng 0 cao 0 nằm trên baseline dòng: đáy của nó chính là baseline.
        const probe = document.createElement('span');
        probe.style.cssText = 'display:inline-block;width:0;height:0;';
        wrap.appendChild(probe);
        const baseline = probe.getBoundingClientRect().bottom - rect.top;
        probe.remove();
        const descent = Math.max(0, height - baseline);

        let fontCss = '';
        for (const key of collectKatexFontKeys(wrap)) {
            const uri = await getKatexFontDataUri(assets, key);
            if (!uri) continue;
            const [family, style, weight] = key.split('|');
            fontCss += '@font-face{font-family:' + family + ';font-style:' + style + ';font-weight:' + weight
                + ';src:url(' + uri + ') format("woff2");}';
        }

        const xhtml = new XMLSerializer().serializeToString(wrap);
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height
            + '" viewBox="0 0 ' + width + ' ' + height + '">'
            + '<style><![CDATA[' + fontCss + assets.baseCss + ']]></style>'
            + '<foreignObject x="0" y="0" width="' + width + '" height="' + height + '">' + xhtml + '</foreignObject></svg>';

        const img = new Image();
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = () => reject(new Error('KaTeX SVG failed to load'));
            img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        });

        // Công thức rất rộng: hạ scale để canvas không vượt giới hạn kích thước của trình duyệt.
        const s = Math.max(1, Math.min(scale, 6000 / Math.max(width, height)));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width * s);
        canvas.height = Math.round(height * s);
        const ctx = canvas.getContext('2d');
        const draw = () => {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.scale(s, s);
            ctx.drawImage(img, 0, 0, width, height);
        };
        draw();
        // Font nhúng trong SVG có thể được giải mã trễ sau onload: chờ một nhịp rồi vẽ lại cho chắc.
        await new Promise((r) => setTimeout(r, 60));
        draw();

        // getImageData ném SecurityError nếu canvas bị taint; ảnh không có pixel nào thì WebView đã bỏ qua foreignObject.
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let inked = false;
        for (let i = 3; i < data.length; i += 4) {
            if (data[i] !== 0) { inked = true; break; }
        }
        if (!inked) throw new Error('KaTeX image is blank (foreignObject not rendered)');

        return { dataUrl: canvas.toDataURL('image/png'), width, height, descent };
    } finally {
        host.remove();
    }
}

// Thay từng span.katex trong clone bằng <img> PNG. origRoot là Preview thật (để đo + lấy font), cloneRoot là bản
// sẽ xuất. Công thức nào lỗi vẫn còn span.katex nên convertKatexForDoc() ở cuối sẽ xử lý bằng MathML.
export async function convertKatexToImagesForDoc(origRoot, cloneRoot) {
    const origEls = origRoot.querySelectorAll('span.katex');
    const cloneEls = cloneRoot.querySelectorAll('span.katex');
    // Hai danh sách phải khớp theo chỉ số; lệch thì thôi, dùng MathML cho tất cả.
    if (origEls.length === cloneEls.length) {
        for (let i = 0; i < cloneEls.length; i++) {
            try {
                const { dataUrl, width, height, descent } = await renderKatexToPng(origEls[i]);
                const el = cloneEls[i];
                const display = !!el.parentElement && el.parentElement.classList.contains('katex-display');

                const img = document.createElement('img');
                img.src = dataUrl;
                const annotation = origEls[i].querySelector('annotation[encoding="application/x-tex"]');
                img.alt = annotation ? annotation.textContent : 'Math formula';
                // PNG vẽ ở scale lớn mà Word bỏ qua max-width: luôn gắn kích thước hiển thị tường minh.
                const fit = fitDocImageSize(width, height);
                if (fit.width > 0 && fit.height > 0) {
                    img.setAttribute('width', fit.width);
                    img.setAttribute('height', fit.height);
                    img.style.width = fit.width + 'px';
                    img.style.height = fit.height + 'px';
                }

                if (display) {
                    // Công thức khối: bỏ .katex-display rồi canh giữa dòng chứa nó.
                    const wrapper = el.parentElement;
                    wrapper.replaceWith(img);
                    const block = img.parentElement;
                    if (block && /^(P|DIV)$/.test(block.tagName) && block.childNodes.length === 1) {
                        block.style.textAlign = 'center';
                    } else {
                        const d = document.createElement('div');
                        d.style.textAlign = 'center';
                        img.replaceWith(d);
                        d.appendChild(img);
                    }
                } else {
                    // Công thức inline: hạ ảnh xuống đúng phần descent để baseline công thức trùng baseline chữ.
                    const shift = height > 0 ? descent * fit.height / height : 0;
                    if (shift > 0.5) img.style.verticalAlign = '-' + shift.toFixed(1) + 'px';
                    el.replaceWith(img);
                }
            } catch (e) {
                console.warn('Could not convert the formula to an image, falling back to MathML:', i, e);
            }
        }
    }
    convertKatexForDoc(cloneRoot);
}
