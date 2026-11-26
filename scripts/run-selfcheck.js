#!/usr/bin/env node

// scripts/run-selfcheck.js — Chạy self-check trong trình duyệt ẩn và trả về mã thoát cho CI.
//
// Self-check là bộ test JS duy nhất của repo (src/js/dev/selfcheck.js). Nó cần DOM thật
// nên chạy trong trình duyệt: dựng server tĩnh cho src/, mở index.html?selfcheck bằng
// Edge/Chrome ẩn, đọc kết quả trong DOM (#selfcheck-result).
//
// Ra 0 khi không có FAIL và không có SKIP; ra 1 khi có FAIL, có SKIP, hoặc không chạy được.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { startStaticServer } from './serve-static.js';

const PORT = Number(process.env.SELFCHECK_PORT || 8765);
const BUDGET_MS = Number(process.env.SELFCHECK_BUDGET_MS || 45000);

const BROWSERS = [
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
];

function findBrowser() {
    const local = process.env.LOCALAPPDATA;
    const extra = [
        local ? path.join(local, 'Microsoft/Edge/Application/msedge.exe') : '',
        local ? path.join(local, 'Google/Chrome/Application/chrome.exe') : ''
    ];
    for (const candidate of [...BROWSERS, ...extra]) {
        if (candidate && fs.existsSync(candidate)) return candidate;
    }
    return null;
}

function runBrowser(browser, url) {
    return new Promise((resolve) => {
        const child = spawn(browser, [
            '--headless=new',
            '--disable-gpu',
            '--no-sandbox',
            '--virtual-time-budget=' + BUDGET_MS,
            '--dump-dom',
            url
        ], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        child.stdout.on('data', (chunk) => { out += chunk; });
        child.on('error', (err) => resolve({ out, error: err }));
        child.on('close', () => resolve({ out, error: null }));
    });
}

const server = await startStaticServer(PORT);
const browser = findBrowser();
if (!browser) {
    server.close();
    console.error('Self-check needs Microsoft Edge or Google Chrome. Install one, or run the app with ?selfcheck by hand.');
    process.exit(1);
}

const url = `http://localhost:${PORT}/index.html?selfcheck`;
const { out, error } = await runBrowser(browser, url);
server.close();

if (error) {
    console.error('Could not start the browser:', error.message);
    process.exit(1);
}

const match = out.match(/Self-check summary: (\d+)\/(\d+) PASS, (\d+) SKIP, (\d+) FAIL/);
if (!match) {
    console.error('The self-check did not report a result.');
    console.error('Open the app with ?selfcheck by hand to see what happened.');
    process.exit(1);
}

const [, passed, total, skipped, failed] = match;
const failures = [...out.matchAll(/<div class="selfcheck-failure">([^<]*)<\/div>/g)].map((m) => m[1]);

console.log(`Self-check: ${passed}/${total} PASS, ${skipped} SKIP, ${failed} FAIL`);
for (const line of failures) console.log(line);

if (Number(failed) > 0 || Number(skipped) > 0) process.exit(1);
process.exit(0);
