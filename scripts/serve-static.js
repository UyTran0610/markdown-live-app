#!/usr/bin/env node

// scripts/serve-static.js — Server tĩnh cho src/ để self-check chạy trong trình duyệt.
// Dùng cho CI (scripts/run-selfcheck.js) và để chạy thử trên máy: node scripts/serve-static.js
// Không phụ thuộc gói ngoài: repo đã dùng node cho scripts/.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
    '.png': 'image/png',
    '.md': 'text/markdown; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf'
};

export function startStaticServer(port = 8765, { onSelfCheck } = {}) {
    const server = http.createServer((req, res) => {
        const url = decodeURIComponent((req.url || '/').split('?')[0]);

        // Kết quả self-check gửi về đây: trình duyệt ẩn không đợi được app chạy xong.
        if (req.method === 'POST' && url === '/__selfcheck') {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', () => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end('{"ok":true}');
                if (!onSelfCheck) return;
                try {
                    onSelfCheck(JSON.parse(body));
                } catch (err) {
                    onSelfCheck(null);
                }
            });
            return;
        }

        const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
        const file = path.resolve(ROOT, rel);
        // Không phục vụ ra ngoài src/.
        if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
            res.writeHead(403);
            res.end('forbidden');
            return;
        }
        fs.readFile(file, (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end('not found');
                return;
            }
            res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
            res.end(data);
        });
    });
    return new Promise((resolve) => {
        server.listen(port, () => resolve(server));
    });
}

// Chạy trực tiếp: node scripts/serve-static.js [port]
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const port = Number(process.argv[2] || 8765);
    await startStaticServer(port);
    console.log(`[serve-static] http://localhost:${port}/`);
}
