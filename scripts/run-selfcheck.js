#!/usr/bin/env node

// scripts/run-selfcheck.js — Chạy self-check trong trình duyệt ẩn và trả về mã thoát cho CI.
//
// Self-check là bộ test JS duy nhất của repo (src/js/dev/selfcheck.js). Nó cần DOM thật
// nên chạy trong trình duyệt: dựng server tĩnh cho src/, mở index.html?selfcheck bằng
// Edge/Chrome ẩn, chờ app POST kết quả về /__selfcheck.
//
// Ra 0 khi không có FAIL và không có SKIP; ra 1 khi có FAIL, có SKIP, hoặc không chạy được.
//
// Vì sao không dùng `--dump-dom`: trình duyệt ẩn chụp DOM ngay khi hết thời gian ảo,
// tức là TRƯỚC khi self-check chạy xong -> runner không thấy kết quả và luôn báo lỗi.
// App gửi kết quả bằng POST nên runner chỉ cần chờ, không cần đoán thời điểm.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startStaticServer } from './serve-static.js';

const PORT = Number(process.env.SELFCHECK_PORT || 8765);
const TIMEOUT_MS = Number(process.env.SELFCHECK_TIMEOUT_MS || 120000);

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
    // Đường dẫn tự chọn: máy dev có thể không cài Edge/Chrome đúng chỗ.
    const override = process.env.SELFCHECK_BROWSER;
    if (override && fs.existsSync(override)) return override;
    for (const candidate of [...BROWSERS, ...extra]) {
        if (candidate && fs.existsSync(candidate)) return candidate;
    }
    return null;
}

// Mở trình duyệt ẩn và giữ nó sống tới khi app báo kết quả.
function startBrowser(browser, url, profileDir) {
    const child = spawn(browser, [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--user-data-dir=' + profileDir,
        url
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const spawnError = new Promise((resolve) => child.on('error', resolve));
    const browserExit = new Promise((resolve) => child.on('close', resolve));
    return { child, spawnError, browserExit, stderr: () => stderr };
}

// Tắt trình duyệt kèm cây tiến trình con, nếu không CI chờ tiến trình mồ côi rồi treo.
function stopBrowser(child) {
    return new Promise((resolve) => {
        if (!child.pid) {
            resolve();
            return;
        }
        if (process.platform === 'win32') {
            const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
            killer.on('close', resolve);
            killer.on('error', resolve);
            return;
        }
        child.once('close', resolve);
        child.kill();
    });
}

let finish;
let received = null;
const outcome = new Promise((resolve) => { finish = resolve; });
const server = await startStaticServer(PORT, {
    onSelfCheck: (payload) => {
        received = payload;
        finish({ payload });
    }
});
const browser = findBrowser();
if (!browser) {
    server.close();
    console.error('Self-check needs Microsoft Edge or Google Chrome. Install one, or run the app with ?selfcheck by hand.');
    process.exit(1);
}

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-live-selfcheck-'));
const url = `http://localhost:${PORT}/index.html?selfcheck`;
const { child, spawnError, browserExit, stderr } = startBrowser(browser, url, profileDir);

const timer = setTimeout(() => finish({ timeout: true }), TIMEOUT_MS);
const result = await Promise.race([
    outcome,
    spawnError.then((err) => ({ spawnError: err })),
    // Trình duyệt đóng ngay sau khi kết quả về: kết quả đã nhận thì vẫn dùng kết quả.
    browserExit.then((code) => (received ? { payload: received } : { browserExit: code }))
]);
clearTimeout(timer);

await stopBrowser(child);
server.close();
try {
    fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
} catch (err) {
    // Chrome chưa nhả hết file: thư mục tạm sót lại trong %TEMP% không ảnh hưởng gì.
}

if (result.spawnError) {
    console.error('Could not start the browser:', result.spawnError.message);
    process.exit(1);
}

if (result.timeout || result.browserExit !== undefined) {
    console.error(result.timeout
        ? `The self-check did not report a result within ${TIMEOUT_MS} ms.`
        : `The browser closed (code ${result.browserExit}) before the self-check reported a result.`);
    const noise = stderr().trim();
    if (noise) console.error(noise.split('\n').slice(-20).join('\n'));
    console.error('Open the app with ?selfcheck by hand to see what happened.');
    process.exit(1);
}

const payload = result.payload;
const summary = String((payload && payload.summary) || '');
const match = summary.match(/(\d+)\/(\d+) PASS, (\d+) SKIP, (\d+) FAIL/);
if (!match) {
    console.error('The self-check reported an unreadable result:', summary);
    process.exit(1);
}

const [, passed, total, skipped, failed] = match;
console.log(`Self-check: ${passed}/${total} PASS, ${skipped} SKIP, ${failed} FAIL`);
for (const line of (payload && payload.failures) || []) console.log(line);

if (Number(failed) > 0 || Number(skipped) > 0) process.exit(1);
process.exit(0);
