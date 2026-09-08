#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Thiết lập tương đương __dirname trong môi trường ES Module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Tự nhận diện thư mục gốc của dự án (markdown-live)
const isInsideScripts = path.basename(__dirname) === 'scripts';
const ROOT = isInsideScripts ? path.resolve(__dirname, '..') : __dirname;

function readFile(p) {
  return fs.readFileSync(p, 'utf8');
}

function writeFile(p, content) {
  fs.writeFileSync(p, content, 'utf8');
}

// Tự tìm file theo các vị trí thông dụng (root hoặc thư mục con)
function resolveExistingPath(candidates, fileDescription) {
  for (const relPath of candidates) {
    const fullPath = path.join(ROOT, relPath);
    if (fs.existsSync(fullPath)) return fullPath;
  }
  throw new Error(`Không tìm thấy file ${fileDescription} ở bất kỳ vị trí nào: ${candidates.join(', ')}`);
}

const TAURI_CONF = resolveExistingPath(['src-tauri/tauri.conf.json', 'tauri.conf.json'], 'tauri.conf.json');
const CARGO_TOML = resolveExistingPath(['src-tauri/Cargo.toml', 'Cargo.toml'], 'Cargo.toml');
const INDEX_HTML = resolveExistingPath(['index.html', 'src/index.html'], 'index.html');

function setTauriConfVersion(content, version) {
  if (!/"version":\s*"[^"]*"/.test(content)) {
    throw new Error('Không tìm thấy trường "version" trong tauri.conf.json');
  }
  return content.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`);
}

function getTauriConfVersion(content) {
  const m = content.match(/"version":\s*"([^"]*)"/);
  if (!m) throw new Error('Không tìm thấy trường "version" trong tauri.conf.json');
  return m[1];
}

function setCargoVersion(content, version) {
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
  // 1) Cache-bust các file css/js nội bộ
  content = content.replace(
    /(href|src)="((?!https?:|\/\/)[^"]+?\.(?:css|js))(?:\?v=[^"]*)?"/g,
    (_m, attr, filePath) => `${attr}="${filePath}?v=${version}"`
  );

  // 2) Cache-bust đoạn script đổi theme trong index.html
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
    version = version.replace(/^v/, '');

    let tauriConf = readFile(TAURI_CONF);
    tauriConf = setTauriConfVersion(tauriConf, version);
    writeFile(TAURI_CONF, tauriConf);

    let cargoToml = readFile(CARGO_TOML);
    cargoToml = setCargoVersion(cargoToml, version);
    writeFile(CARGO_TOML, cargoToml);

    console.log(`[sync-version] Đã cập nhật version = ${version} vào tauri.conf.json & Cargo.toml`);
  } else {
    const tauriConf = readFile(TAURI_CONF);
    version = getTauriConfVersion(tauriConf);
  }

  let indexHtml = readFile(INDEX_HTML);
  indexHtml = syncIndexHtmlVersion(indexHtml, version);
  writeFile(INDEX_HTML, indexHtml);

  console.log(`[sync-version] Đã đồng bộ cache-busting ?v=${version} vào ${path.relative(ROOT, INDEX_HTML)}`);
}

main();