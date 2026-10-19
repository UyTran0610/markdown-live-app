// js/export/math-mathml.js — Công thức KaTeX -> MathML thuần cho file DOC / HTML (fallback khi không vẽ được PNG).

// DOC không mang CSS KaTeX nên Word in cả .katex-mathml lẫn .katex-html: thay span.katex bằng <math>.
// Khối nhiều dòng (aligned/bmatrix) render lại từ LaTeX nguồn với output:'mathml' để có mtable.
export function convertKatexForDoc(container) {
    container.querySelectorAll('span.katex').forEach((el) => {
        let math = el.querySelector('.katex-mathml > math')
            // output:'mathml' của KaTeX không có wrapper .katex-mathml, <math> là con trực tiếp.
            || el.querySelector(':scope > math');
        const annotation = el.querySelector('annotation[encoding="application/x-tex"]');
        const tex = annotation ? annotation.textContent : '';
        // Có \ (xuống dòng) hoặc môi trường nhiều dòng (aligned, matrix, cases, ...).
        if (tex && /\\\\|\\begin\{(aligned|align|gather|cases|matrix|bmatrix|pmatrix|vmatrix|array)\}/.test(tex)
            && typeof katex !== 'undefined') {
            try {
                const tmp = document.createElement('div');
                tmp.innerHTML = katex.renderToString(tex, { throwOnError: false, displayMode: true, output: 'mathml' });
                const rendered = tmp.querySelector('math');
                if (rendered) math = rendered;
            } catch (e) { /* giữ math mặc định bên dưới */ }
        }
        if (math) {
            // Word không hiểu <annotation>: bỏ annotation và text node trần.
            math.querySelectorAll('annotation').forEach((a) => a.remove());
            Array.from(math.childNodes)
                .filter(n => n.nodeType === 3 && n.textContent.trim())
                .forEach(n => n.remove());
            const wrapper = document.createElement('span');
            wrapper.style.fontFamily = "'Cambria Math', 'Times New Roman', serif";
            wrapper.innerHTML = typeof DOMPurify !== 'undefined'
                ? DOMPurify.sanitize(math.outerHTML, { USE_PROFILES: { mathMl: true } })
                : math.outerHTML;
            el.replaceWith(wrapper);
        } else {
            // Không có MathML (KaTeX lỗi/không tải): giữ LaTeX nguồn thay vì chữ rác.
            el.replaceWith(document.createTextNode(el.textContent));
        }
    });
}
