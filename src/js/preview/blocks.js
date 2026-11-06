// js/preview/blocks.js — Cache HTML theo khối (hash nội dung) + patch DOM theo prefix/suffix.
// Khối không đổi giữ nguyên node DOM; chỉ phần giữa bị thay mới vào DOM.

// cyrb53: hash 53 bit, đủ phân biệt khối trong tài liệu cục bộ; không mật mã.
export function cyrb53(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

const BLOCK_CACHE_LIMIT = 2000;
// Block khổng lồ (bảng nhiều MB) không đáng giữ: chặn phình bộ nhớ khi lặp lại nhiều khối to.
const BLOCK_CACHE_MAX_ENTRY = 1000000; // chars

// Map giữ thứ tự chèn; get/ re-store để làm LRU.
const blockCache = new Map();

export function findBlockHtml(hash) {
    const html = blockCache.get(hash);
    if (html === undefined) return undefined;
    blockCache.delete(hash);
    blockCache.set(hash, html);
    return html;
}

export function storeBlockHtml(hash, html) {
    if (html.length > BLOCK_CACHE_MAX_ENTRY) return;
    blockCache.set(hash, html);
    while (blockCache.size > BLOCK_CACHE_LIMIT) blockCache.delete(blockCache.keys().next().value);
}

// Mô tả các khối đang nằm trong DOM; null = lần patch tới dựng lại toàn bộ.
let currentBlocks = null;

export function resetBlocks() {
    currentBlocks = null;
    blockCache.clear();
}

// Bản chụp cho tab cache: chỉ hash + html, không giữ nodes.
export function snapshotBlocks() {
    return currentBlocks ? currentBlocks.map(({ hash, html }) => ({ hash, html })) : [];
}

function buildNodes(block, prepare) {
    const tpl = document.createElement('template');
    tpl.innerHTML = block.html;
    if (prepare) prepare(tpl.content);
    return [...tpl.content.childNodes];
}

// Prefix/suffix match giữa hai dãy hash khối; thuần để test được.
export function diffBlocks(prevHashes, nextHashes) {
    const nNew = nextHashes.length, nPrev = prevHashes.length;
    let p = 0;
    while (p < nNew && p < nPrev && nextHashes[p] === prevHashes[p]) p++;
    let s = 0;
    while (s < nNew - p && s < nPrev - p && nextHashes[nNew - 1 - s] === prevHashes[nPrev - 1 - s]) s++;
    return { prefix: p, suffix: s };
}

// blocks: [{hash, html}] theo đúng thứ tự tài liệu.
// prepare(fragment): biến đổi template trước khi lấy nodes (ví dụ mermaid pre code -> pre.mermaid).
// Trả { inserted } để caller đồng bộ enhancement.
export function patchBlocks(container, blocks, prepare) {
    const prev = currentBlocks;
    if (!prev) {
        const frag = document.createDocumentFragment();
        const out = [];
        for (const b of blocks) {
            const nodes = buildNodes(b, prepare);
            nodes.forEach((n) => frag.appendChild(n));
            out.push({ hash: b.hash, html: b.html, nodes });
        }
        container.replaceChildren(frag);
        currentBlocks = out;
        return { inserted: out };
    }

    const nNew = blocks.length, nPrev = prev.length;
    const { prefix: p, suffix: s } = diffBlocks(prev.map((b) => b.hash), blocks.map((b) => b.hash));

    const out = [];

    for (let i = 0; i < p; i++) {
        out.push({ hash: blocks[i].hash, html: blocks[i].html, nodes: prev[i].nodes });
    }
    for (let i = p; i < nPrev - s; i++) {
        prev[i].nodes.forEach((n) => n.remove());
    }
    // Neo chèn: node đầu tiên của khối suffix còn nằm trong DOM.
    let anchor = null;
    for (let i = nPrev - s; i < nPrev && !anchor; i++) anchor = prev[i].nodes[0] || null;

    const inserted = [];
    for (let i = p; i < nNew - s; i++) {
        const nodes = buildNodes(blocks[i], prepare);
        nodes.forEach((n) => container.insertBefore(n, anchor));
        const rec = { hash: blocks[i].hash, html: blocks[i].html, nodes };
        out.push(rec);
        inserted.push(rec);
    }
    for (let k = 1; k <= s; k++) {
        const src = prev[nPrev - k];
        out.push({ hash: blocks[nNew - k].hash, html: blocks[nNew - k].html, nodes: src.nodes });
    }
    currentBlocks = out;
    return { inserted };
}
