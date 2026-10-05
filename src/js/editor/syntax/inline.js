// js/editor/syntax/inline.js — Tô màu cú pháp Markdown mức inline (đậm, nghiêng, link, code, math, thẻ HTML...).

export function escapeHtml(str) {
    // Escape & trước, nếu không các &lt; &gt; vừa tạo sẽ bị escape lặp
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function highlightInline(text) {
    const store = [];
    // Cất HTML đã tô vào store và trả về token; rule sau không đụng lại, cuối hàm mới khôi phục.
    const protect = (html) => {
        const token = `\u0000T${store.length}\u0000`;
        store.push(html);
        return token;
    };

    // Thứ tự rule quan trọng: kết quả mỗi rule được protect() thành token nên rule sau không đụng lại;
    // rule đặc thù/dài phải đứng trước (vd *** trước ** và *).
    // Ký tự thoát: \* \_ \[ \] \$ \~ \# ...
    // (&lt; &gt; &amp; liệt kê riêng vì text đã được escape HTML từ trước, nên \< thành \&lt;)
    text = text.replace(/\\(&lt;|&gt;|&amp;|[\\`*_{}\[\]()#+\-.!~$~|^])/g, (m, char) =>
        protect(`<span class="md-escape">\\${char}</span>`));

    // Code inline: `code` (dấu ` mở và đóng phải cùng độ dài)
    text = text.replace(/(`+)([^`]+?)\1/g, (m, ticks, content) =>
        protect(`<span class="md-code-inline">${ticks}${content}${ticks}</span>`));

    // Công thức dạng khối trên 1 dòng: $$...$$
    text = text.replace(/(\$\$)([^$\n]+?)\1/g, (m, d, c) =>
        protect(`<span class="md-math">${d}${c}${d}</span>`));

    // Công thức inline: $...$
    text = text.replace(/(\$)([^$\n]+?)\1/g, (m, d, c) =>
        protect(`<span class="md-math">${d}${c}${d}</span>`));

    // Tham chiếu footnote: [^id]
    text = text.replace(/(\[\^)([^\]]+?)(\])/g, (m, ob, id, cb) =>
        protect(`<span class="md-footnote-ref"><span class="md-footnote-marker">${ob}</span><span class="md-footnote-id">${id}</span><span class="md-footnote-marker">${cb}</span></span>`));

    // Ảnh: ![alt](url)
    text = text.replace(/(!)(\[)([^\]]*)(\])(\()([^)]*)(\))/g, (m, bang, ob, alt, cb, op, url, cp) =>
        protect(`<span class="md-link-marker">${bang}${ob}</span><span class="md-link-text">${alt}</span><span class="md-link-marker">${cb}${op}</span><span class="md-link-url">${url}</span><span class="md-link-marker">${cp}</span>`));

    // Reference link: [text][id] hoặc [text][]
    text = text.replace(/(\[)([^\]]+?)(\])(\s*)(\[)([^\]]*?)(\])/g, (m, ob1, txt, cb1, sp, ob2, id, cb2) =>
        protect(`<span class="md-link-marker">${ob1}</span><span class="md-link-text">${txt}</span><span class="md-link-marker">${cb1}${sp}${ob2}</span><span class="md-ref-id">${id}</span><span class="md-link-marker">${cb2}</span>`));

    // Liên kết thường: [text](url)
    text = text.replace(/(\[)([^\]]*)(\])(\()([^)]*)(\))/g, (m, ob, t, cb, op, url, cp) =>
        protect(`<span class="md-link-marker">${ob}</span><span class="md-link-text">${t}</span><span class="md-link-marker">${cb}${op}</span><span class="md-link-url">${url}</span><span class="md-link-marker">${cp}</span>`));

    // Autolink trong ngoặc nhọn: <https://...> hoặc <email@example.com>
    text = text.replace(/(&lt;)(https?:\/\/[^\s&]+|mailto:[^\s&]+|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(&gt;)/gi, (m, ob, link, cb) =>
        protect(`<span class="md-link-marker">${ob}</span><span class="md-autolink">${link}</span><span class="md-link-marker">${cb}</span>`));

    // Autolink URL trần: https://...
    text = text.replace(/\b(https?:\/\/[^\s<>()"']+)/gi, (m, url) =>
        protect(`<span class="md-autolink">${url}</span>`));

    // In đậm + nghiêng: ***text*** hoặc ___text___
    text = text.replace(/(\*\*\*|___)([^*_\n]+?)\1/g, (m, d, c) =>
        protect(`<span class="md-bolditalic">${d}${c}${d}</span>`));

    // Emphasis lồng nhau: content cho phép delimiter đơn bên trong và được xử lý italic đệ quy
    // trước khi bọc span ngoài (tránh token che mất phần trong).
    // Mẫu nội dung (?:[^*\n]|\*(?!\*))+? = ký tự bất kỳ trừ * và xuống dòng, hoặc một * đơn (không đi liền *);
    // dấu + ? để khớp lười, dừng ở delimiter đóng gần nhất. Bản _ tương tự: (?:[^_\n]|_(?!_))+?
    // underItalicOnce: _text_ (cần word boundary)
    const underItalicOnce = (s) => s.replace(/\b(_)((?:[^_\n]|_(?!_))+?)\1\b/g, (m2, d2, c2) =>
        protect(`<span class="md-italic">${d2}${c2}${d2}</span>`));
    // starItalicOnce: *text* (cho phép _text_ lồng bên trong)
    const starItalicOnce = (s) => s.replace(/(\*)((?:[^*\n]|\*(?!\*))+?)\1/g, (m2, d2, c2) =>
        protect(`<span class="md-italic">${d2}${underItalicOnce(c2)}${d2}</span>`));

    // In đậm: **text** (cho phép * đơn bên trong để lồng italic)
    text = text.replace(/(\*\*)((?:[^*\n]|\*(?!\*))+?)\1/g, (m, d, c) =>
        protect(`<span class="md-bold">${d}${underItalicOnce(starItalicOnce(c))}${d}</span>`));

    // In đậm: __text__ (cho phép _ đơn bên trong, cần word boundary)
    text = text.replace(/\b(__)((?:[^_\n]|_(?!_))+?)\1\b/g, (m, d, c) =>
        protect(`<span class="md-bold">${d}${underItalicOnce(starItalicOnce(c))}${d}</span>`));

    // In nghiêng: *text* (chạy sau bold nên ** đã thành token)
    text = starItalicOnce(text);

    // In nghiêng: _text_ (cần word boundary nên không khớp giữa snake_case)
    text = underItalicOnce(text);

    // Gạch ngang: ~~text~~
    text = text.replace(/(~~)([^~\n]+?)\1/g, (m, d, c) =>
        protect(`<span class="md-strikethrough">${d}${c}${d}</span>`));

    // Thẻ HTML inline <kbd>, <mark>, <sup>, <sub>: tô riêng thẻ và nội dung
    // Nội dung ([^&]+) không chứa '&' (text đã escape) nên không khớp khi bên trong còn thẻ/entity khác.
    text = text.replace(/(&lt;)(kbd&gt;)([^&]+)(&lt;\/)(kbd&gt;)/gi, (m, ob1, tagOpen, content, cb1, tagClose) =>
        protect(`<span class="md-kbd-marker">${ob1}${tagOpen}</span><span class="md-kbd">${content}</span><span class="md-kbd-marker">${cb1}${tagClose}</span>`));

    text = text.replace(/(&lt;)(mark&gt;)([^&]+)(&lt;\/)(mark&gt;)/gi, (m, ob1, tagOpen, content, cb1, tagClose) =>
        protect(`<span class="md-mark-marker">${ob1}${tagOpen}</span><span class="md-mark">${content}</span><span class="md-mark-marker">${cb1}${tagClose}</span>`));

    text = text.replace(/(&lt;)(sup&gt;)([^&]+)(&lt;\/)(sup&gt;)/gi, (m, ob1, tagOpen, content, cb1, tagClose) =>
        protect(`<span class="md-sup-marker">${ob1}${tagOpen}</span><span class="md-sup">${content}</span><span class="md-sup-marker">${cb1}${tagClose}</span>`));

    text = text.replace(/(&lt;)(sub&gt;)([^&]+)(&lt;\/)(sub&gt;)/gi, (m, ob1, tagOpen, content, cb1, tagClose) =>
        protect(`<span class="md-sub-marker">${ob1}${tagOpen}</span><span class="md-sub">${content}</span><span class="md-sub-marker">${cb1}${tagClose}</span>`));

    // <details> / <summary>: chỉ tô riêng thẻ mở/đóng, phần chữ bên trong xử lý như văn bản thường
    text = text.replace(/(&lt;details&gt;)/gi, 
        protect(`<span class="md-details-marker">&lt;details&gt;</span>`));
    text = text.replace(/(&lt;\/details&gt;)/gi, 
        protect(`<span class="md-details-marker">&lt;/details&gt;</span>`));
    text = text.replace(/(&lt;summary&gt;)/gi, 
        protect(`<span class="md-summary-marker">&lt;summary&gt;</span>`));
    text = text.replace(/(&lt;\/summary&gt;)/gi, 
        protect(`<span class="md-summary-marker">&lt;/summary&gt;</span>`));

    // HTML comment trên 1 dòng: <!-- ... -->
    text = text.replace(/(&lt;!--)([\s\S]*?)(--&gt;)/g, (m) =>
        protect(`<span class="md-html-comment">${m}</span>`));

    // Mẫu thuộc tính HTML dùng lặp ở các rule thẻ bên dưới: (?:\s+tên(?:\s*=\s*giá trị)?)*
    // với giá trị là "...", '...' hoặc không nháy (không chứa khoảng trắng, nháy, < >).
    // Thẻ <a href="...">text</a>: href -> md-link-url, nội dung -> md-link-text
    text = text.replace(/(&lt;)(a)((?:\s+[a-zA-Z-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))?)*)(&gt;)([\s\S]*?)(&lt;\/)(a)(&gt;)/gi,
        (m, ob, tag, attrs, cb, content, cb2, tag2, cb3) => {
            // Tô href="..." (giá trị có nháy kép, nháy đơn hoặc không nháy)
            const hlAttrs = attrs.replace(/(^|\s)(href)(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'<>]+)/i,
                `$1<span class="md-link-marker">$2$3</span><span class="md-link-url">$4</span>`);
            return protect(`<span class="md-link-marker">${ob}${tag}${hlAttrs}${cb}</span><span class="md-link-text">${content}</span><span class="md-link-marker">${cb2}${tag2}${cb3}</span>`);
        });

    // Thẻ <img src="..." alt="...">: src -> md-link-url, alt -> md-link-text (thuộc tính theo thứ tự bất kỳ)
    text = text.replace(/(&lt;)(img)((?:\s+[a-zA-Z-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))?)*)(\s*\/?)(&gt;)/gi,
        (m, ob, tag, attrs, slash, cb) => {
            // Tô src giống href ở trên
            let hlAttrs = attrs.replace(/(^|\s)(src)(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'<>]+)/i,
                `$1<span class="md-link-marker">$2$3</span><span class="md-link-url">$4</span>`);
            // Tô alt như văn bản liên kết
            hlAttrs = hlAttrs.replace(/(^|\s)(alt)(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'<>]+)/i,
                `$1<span class="md-link-marker">$2$3</span><span class="md-link-text">$4</span>`);
            return protect(`<span class="md-html-tag-marker">${ob}${tag}${hlAttrs}${slash}${cb}</span>`);
        });

    // Void tag: <br>, <hr>, <input ...> (thuộc tính theo mẫu trên, có thể tự đóng '/>')
    text = text.replace(/(&lt;)(br|hr|input)((?:\s+[a-zA-Z-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))?)*)(\s*\/?)(&gt;)/gi, (m) =>
        protect(`<span class="md-html-void">${m}</span>`));

    // Cặp thẻ có nội dung trên cùng 1 dòng: <div>…</div>, <table>, <b>, <code>, ... (thuộc tính theo mẫu trên)
    text = text.replace(/(&lt;)(div|span|p|table|tr|td|th|thead|tbody|b|strong|i|em|u|code|small)((?:\s+[a-zA-Z-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))?)*)(&gt;)([\s\S]*?)(&lt;\/)(\2)(\s*)(&gt;)/gi,
        (m, ob, tag, attrs, cb, content, cb2, tag2, sp, cb3) =>
            protect(`<span class="md-html-tag-marker">${ob}${tag}${attrs}${cb}</span><span class="md-html-tag-content">${content}</span><span class="md-html-tag-marker">${cb2}${tag2}${sp}${cb3}</span>`));

    // Thẻ khối lẻ không có cặp trên cùng dòng: <div align="center">, </div>, <table>, ... (thuộc tính theo mẫu trên)
    text = text.replace(/(&lt;\/?(?:div|span|p|table|tr|td|th|thead|tbody)(?:\s+[a-zA-Z-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))?)*\s*\/?&gt;)/gi, (m) =>
        protect(`<span class="md-html-tag-marker">${m}</span>`));

    // Trả token về HTML thật. Lặp vì token có thể lồng nhau (span ngoài chứa token của span trong).
    let previous;
    do {
        previous = text;
        // Token do protect() tạo có dạng \u0000T<số>\u0000
        text = text.replace(/\u0000T(\d+)\u0000/g, (m, idx) => store[Number(idx)]);
    } while (text !== previous);

    return text;
}
