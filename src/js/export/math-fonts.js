// js/export/math-fonts.js — Font + CSS KaTeX cho việc vẽ công thức thành ảnh: parse @font-face, tải CSS một lần,
// đổi font woff2 sang data URI, và liệt kê font thực sự dùng trong một công thức.

let katexAssetsPromise = null;

// Khoá font: family|style|weight đã chuẩn hoá, để khớp @font-face trong CSS với computed style của từng phần tử.
export function katexFontKey(family, style, weight) {
    const w = weight === 'bold' ? 700 : (weight === 'normal' ? 400 : parseInt(weight, 10));
    return String(family).replace(/["']/g, '').trim()
        + '|' + (/italic|oblique/i.test(style) ? 'italic' : 'normal')
        + '|' + (w >= 600 ? '700' : '400');
}

// Trả về Map(khoá font -> url woff2 tương đối). Chỉ lấy woff2 để SVG không phải mang cả woff/ttf.
export function parseKatexFontFaces(css) {
    const faces = new Map();
    const re = /@font-face\s*\{([^}]*)\}/gi;
    let m;
    while ((m = re.exec(css))) {
        const block = m[1];
        const fam = block.match(/font-family\s*:\s*["']?([^;"']+?)["']?\s*(?:;|$)/i);
        const url = block.match(/url\(\s*["']?([^"')]+?\.woff2)(?:\?[^"')]*)?["']?\s*\)/i);
        if (!fam || !url) continue;
        const style = (block.match(/font-style\s*:\s*(\w+)/i) || ['', 'normal'])[1];
        const weight = (block.match(/font-weight\s*:\s*(\w+)/i) || ['', '400'])[1].toLowerCase();
        faces.set(katexFontKey(fam[1], style, weight), url[1]);
    }
    return faces;
}

// Tải CSS KaTeX một lần (cache). Lỗi thì xoá cache để lần xuất sau thử lại.
export function getKatexAssets() {
    if (!katexAssetsPromise) {
        katexAssetsPromise = (async () => {
            const link = document.querySelector('link[rel="stylesheet"][href*="katex"]');
            if (!link) throw new Error('KaTeX stylesheet not found');
            const cssUrl = link.href;
            const resp = await fetch(cssUrl);
            if (!resp.ok) throw new Error('Cannot fetch KaTeX CSS: ' + resp.status);
            const css = await resp.text();
            return {
                cssUrl,
                baseCss: css.replace(/@font-face\s*\{[^}]*\}/gi, ''),
                faces: parseKatexFontFaces(css),
                dataUris: new Map()
            };
        })();
        katexAssetsPromise.catch(() => { katexAssetsPromise = null; });
    }
    return katexAssetsPromise;
}

export async function getKatexFontDataUri(assets, key) {
    if (assets.dataUris.has(key)) return assets.dataUris.get(key);
    const rel = assets.faces.get(key);
    if (!rel) return null;
    const resp = await fetch(new URL(rel, assets.cssUrl).href);
    if (!resp.ok) throw new Error('Cannot fetch KaTeX font: ' + rel);
    const blob = new Blob([await resp.arrayBuffer()], { type: 'font/woff2' });
    const dataUri = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
    assets.dataUris.set(key, dataUri);
    return dataUri;
}

// Các font KaTeX_* thật sự dùng trong công thức (theo computed style), để chỉ nhúng đúng những font cần.
export function collectKatexFontKeys(root) {
    const keys = new Set();
    const nodes = [root, ...root.querySelectorAll('*')];
    for (const n of nodes) {
        const cs = getComputedStyle(n);
        for (const fam of cs.fontFamily.split(',')) {
            const name = fam.replace(/["']/g, '').trim();
            if (name.startsWith('KaTeX_')) keys.add(katexFontKey(name, cs.fontStyle, cs.fontWeight));
        }
    }
    return keys;
}
