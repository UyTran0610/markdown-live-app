#!/usr/bin/env node
//
// scripts/sync-version.js
//
// Cách dùng:
//   1) node scripts/sync-version.js --set 1.2.0
//      -> Ghi đè version vào src-tauri/tauri.conf.json và src-tauri/Cargo.toml,
//         sau đó tự đồng bộ cache-busting (?v=...) cho mọi asset local trong src/index.html.
//
//   2) node scripts/sync-version.js
//      -> Không đổi version, chỉ đọc version hiện có trong tauri.conf.json
//         rồi cập nhật lại ?v=... trong index.html cho khớp.
//         Dùng làm "beforeBuildCommand"/"beforeDevCommand" trong tauri.conf.json
//         để BUILD NÀO CŨNG tự cache-bust, không cần nhớ làm thủ công.
//
// Vì sao cần: WebView2 cache các file .css/.js theo URL. Nếu URL asset không đổi
// giữa các bản release, máy người dùng đã cài bản cũ sẽ tiếp tục dùng file cache cũ
// dù .exe mới đã được thay. Gắn ?v=<version> vào URL buộc WebView2 phải tải lại.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TAURI_CONF = path.join(ROOT, 'src-tauri', 'tauri.conf.json');
const CARGO_TOML = path.join(ROOT, 'src-tauri', 'Cargo.toml');
const INDEX_HTML = path.join(ROOT, 'src', 'index.html');

function readFile(p) {
  return fs.readFileSync(p, 'utf8');
}
function writeFile(p, content) {
  fs.writeFileSync(p, content, 'utf8');
}

function setTauriConfVersion(content, version) {
  if (!/"version":\s*"[^"]*"/.test(content)) {
    throw new Error('Không tìm thấy trường "version" trong tauri.conf.json');
  }
  // Chỉ thay occurrence đầu tiên (field version ở top-level của file).
  return content.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`);
}

function getTauriConfVersion(content) {
  const m = content.match(/"version":\s*"([^"]*)"/);
  if (!m) throw new Error('Không tìm thấy trường "version" trong tauri.conf.json');
  return m[1];
}

function setCargoVersion(content, version) {
  // Cargo.toml có thể có nhiều dòng `version = "..."` (trong [dependencies] chẳng hạn).
  // Chỉ sửa dòng version nằm trong block [package].
  const lines = content.split('\n');
  let inPackage = false;
  let done = false;
  for (let i = 0; i < lines.length; i++) {
    const sectionMatch = lines[i].match(/^\s*\[([^\]]+)\]\s*$/);
    if (sectionMatch) {
      inPackage = sectionMatch[1].trim() === 'package';
      continue;
    }
    if (inPackage && /^\s*version\s*=\s*"/.test(lines[i])) {
      lines[i] = lines[i].replace(/"[^"]*"/, `"${version}"`);
      done = true;
      break;
    }
  }
  if (!done) throw new Error('Không tìm thấy version trong block [package] của Cargo.toml');
  return lines.join('\n');
}

function syncIndexHtmlVersion(content, version) {
  // 1) Cache-bust mọi href/src trỏ tới file .css/.js local (bỏ qua link http(s):// hoặc //cdn)
  content = content.replace(
    /(href|src)="((?!https?:|\/\/)[^"]+?\.(?:css|js))(?:\?v=[^"]*)?"/g,
    (_m, attr, filePath) => `${attr}="${filePath}?v=${version}"`
  );

  // 2) index.html của Markdown Live có đoạn JS đổi theme bằng cách gán trực tiếp
  //    mdLink.href / hljsLink.href (không phải attribute HTML nên regex trên không bắt được).
  content = content.replace(
    /(mdLink\.href\s*=\s*')([^']+?)(?:\?v=[^']*)?(')/,
    (_m, pre, filePath, post) => `${pre}${filePath}?v=${version}${post}`
  );
  content = content.replace(
    /(hljsLink\.href\s*=\s*')([^']+?)(?:\?v=[^']*)?(')/,
    (_m, pre, filePath, post) => `${pre}${filePath}?v=${version}${post}`
  );

  return content;
}

function main() {
  const args = process.argv.slice(2);
  const setIdx = args.indexOf('--set');
  let version;

  if (setIdx !== -1) {
    version = args[setIdx + 1];
    if (!version) {
      console.error('Thiếu giá trị version sau --set, vd: --set 1.2.0');
      process.exit(1);
    }
    version = version.replace(/^v/, ''); // phòng khi lỡ truyền "v1.2.0"

    let tauriConf = readFile(TAURI_CONF);
    tauriConf = setTauriConfVersion(tauriConf, version);
    writeFile(TAURI_CONF, tauriConf);

    let cargoToml = readFile(CARGO_TOML);
    cargoToml = setCargoVersion(cargoToml, version);
    writeFile(CARGO_TOML, cargoToml);

    console.log(`[sync-version] Đã set version = ${version} trong tauri.conf.json & Cargo.toml`);
  } else {
    const tauriConf = readFile(TAURI_CONF);
    version = getTauriConfVersion(tauriConf);
  }

  let indexHtml = readFile(INDEX_HTML);
  indexHtml = syncIndexHtmlVersion(indexHtml, version);
  writeFile(INDEX_HTML, indexHtml);

  console.log(`[sync-version] Đã đồng bộ cache-busting ?v=${version} trong src/index.html`);
}

main();