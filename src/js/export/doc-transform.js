// js/export/doc-transform.js — Biến đổi DOM cho file DOC: gỡ id thừa, blockquote / alert thành bảng.

// Word biến mọi id thành bookmark, nên gỡ id heading không có link neo (#...) trỏ tới khi xuất DOC.
export function stripUnusedHeadingIds(container) {
    const linked = new Set();
    container.querySelectorAll('a[href^="#"]').forEach((a) => {
        const raw = a.getAttribute('href').slice(1);
        linked.add(raw);
        try { linked.add(decodeURIComponent(raw)); } catch (e) { /* href hỏng: giữ nguyên bản thô */ }
    });
    container.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
        if (h.id && !linked.has(h.id)) h.removeAttribute('id');
    });
}

// Viền ô phải INLINE trên từng ô: Word chỉ hỗ trợ selector yếu, class của <table> không xuống ô con
// nên '.doc-data-table td' bị bỏ qua.
export function styleDataTablesForDoc(container) {
    container.querySelectorAll('table').forEach((table) => {
        table.style.borderCollapse = 'collapse';
        table.style.width = '100%';
        table.style.margin = '10pt 0';
        table.querySelectorAll('th, td').forEach((cell) => {
            cell.style.border = '1px solid #d0d7de';
            cell.style.padding = '6pt 10pt';
            if (cell.tagName === 'TH') {
                cell.style.background = '#f6f8fa';
                cell.style.fontWeight = 'bold';
            }
        });
    });
}

// Màu viền/tiêu đề từng loại GFM Alert khi xuất DOC (Word không hiểu CSS variable).
const DOC_ALERT_COLORS = {
    note: '#0969da',
    tip: '#1a7f37',
    important: '#8250df',
    warning: '#9a6700',
    caution: '#d1242f'
};

// Word gộp các blockquote liền kề thành một thanh viền: mỗi cái thành bảng 1 ô + đoạn đệm phía sau,
// duyệt ngược để blockquote lồng nhau xử lý từ trong ra ngoài.
export function convertQuotesForDoc(container) {
    const quotes = Array.from(container.querySelectorAll('blockquote')).reverse();
    quotes.forEach((bq) => {
        const alertClass = Array.from(bq.classList)
            .find((c) => /^markdown-alert-(note|tip|important|warning|caution)$/.test(c));
        const type = alertClass ? alertClass.replace('markdown-alert-', '') : '';
        const borderColor = type ? DOC_ALERT_COLORS[type] : '#d0d7de';
        const textColor = type ? '#24292f' : '#57606a';
        const background = type ? 'background:#f6f8fa;' : '';

        const table = document.createElement('table');
        table.setAttribute('width', '100%');
        table.setAttribute('border', '0');
        table.setAttribute('cellspacing', '0');
        table.setAttribute('cellpadding', '0');
        table.style.cssText = 'border-collapse:collapse;border:none;width:100%;margin:0;';

        const td = document.createElement('td');
        // Không có class doc-data-table nên thêm mso-border-*-alt để Word chỉ vẽ viền trái.
        // setAttribute thay .style.cssText: CSSOM loại bỏ thuộc tính mso-* không nhận ra.
        td.setAttribute('style', 'border-top:none;border-right:none;border-bottom:none;'
            + 'mso-border-top-alt:none;mso-border-right-alt:none;mso-border-bottom-alt:none;'
            + 'border-left:4pt solid ' + borderColor + ';'
            + 'padding:6pt 12pt;color:' + textColor + ';' + background);

        while (bq.firstChild) td.appendChild(bq.firstChild);

        // Bỏ margin thừa ở đầu/cuối ô (padding của ô đã lo khoảng cách).
        const firstEl = td.firstElementChild;
        const lastEl = td.lastElementChild;
        if (firstEl && firstEl.tagName === 'P') firstEl.style.marginTop = '0';
        if (lastEl && lastEl.tagName === 'P') lastEl.style.marginBottom = '0';

        // Tiêu đề alert tô đúng màu loại alert (class CSS của app không có trong file DOC).
        const title = td.querySelector('.markdown-alert-title');
        if (title && type) {
            title.style.color = borderColor;
            title.style.fontWeight = 'bold';
        }

        const tr = document.createElement('tr');
        tr.appendChild(td);
        const tbody = document.createElement('tbody');
        tbody.appendChild(tr);
        table.appendChild(tbody);

        const spacer = document.createElement('p');
        spacer.setAttribute('style', 'margin:0;font-size:6pt;line-height:6pt;mso-line-height-rule:exactly;');
        spacer.innerHTML = '&nbsp;';

        bq.replaceWith(table, spacer);
    });
}
