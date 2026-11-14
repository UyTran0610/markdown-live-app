#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Tương đương __dirname trong ESM.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Nhận diện thư mục gốc dự án.
const isInsideScripts = path.basename(__dirname) === 'scripts';
const ROOT = isInsideScripts ? path.resolve(__dirname, '..') : __dirname;

function readFile(p) {
  return fs.readFileSync(p, 'utf8');
}

function writeFile(p, content) {
  fs.writeFileSync(p, content, 'utf8');
}

// Ghi nguyên tử (tmp + rename), bỏ qua khi nội dung không đổi để khỏi mtime churn.
function writeFileAtomic(p, content) {
  let prev = null;
  try {
    prev = fs.readFileSync(p, 'utf8');
  } catch (e) {}
  if (prev === content) return false;
  const tmp = `${p}.tmp-${process.pid}`;
  writeFile(tmp, content);
  fs.renameSync(tmp, p);
  return true;
}

function isValidVersion(v) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(v);
}

// Tìm file theo các vị trí thông dụng.
function resolveExistingPath(candidates, fileDescription) {
  for (const relPath of candidates) {
    const fullPath = path.join(ROOT, relPath);
    if (fs.existsSync(fullPath)) return fullPath;
  }
  throw new Error(`File ${fileDescription} not found in any of these locations: ${candidates.join(', ')}`);
}

const TAURI_CONF = resolveExistingPath(['src-tauri/tauri.conf.json', 'tauri.conf.json'], 'tauri.conf.json');
const CARGO_TOML = resolveExistingPath(['src-tauri/Cargo.toml', 'Cargo.toml'], 'Cargo.toml');
const INDEX_HTML = resolveExistingPath(['index.html', 'src/index.html'], 'index.html');

function parseTauriConf(content) {
  try {
    return JSON.parse(content);
  } catch (e) {
    throw new Error('tauri.conf.json is not valid JSON: ' + e.message);
  }
}

function setTauriConfVersion(content, version) {
  // Chỉ thay version cấp cao nhất rồi xác minh JSON hợp lệ và đã đổi đúng chỗ.
  const oldVersion = getTauriConfVersion(content); // kiểm tra JSON + sự tồn tại
  const escaped = oldVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(^\\s*"version"\\s*:\\s*)"${escaped}"`, 'm');
  if (!pattern.test(content)) {
    throw new Error('Top-level "version" field not found in tauri.conf.json');
  }
  const next = content.replace(pattern, `$1"${version}"`);
  if (getTauriConfVersion(next) !== version) {
    throw new Error('Version update failed (the post-condition check did not pass)');
  }
  return next;
}

function getTauriConfVersion(content) {
  const obj = parseTauriConf(content);
  if (typeof obj.version !== 'string' || !obj.version) {
    throw new Error('No "version" field found in tauri.conf.json');
  }
  return obj.version;
}

function setCargoVersion(content, version) {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
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
  if (!done) throw new Error('No version found in the [package] block of Cargo.toml');
  return lines.join(eol);
}

function syncIndexHtmlVersion(content, version) {
  // 1) Cache-bust các file css/js nội bộ.
  content = content.replace(
    /(href|src)="((?!https?:|\/\/)[^"]+?\.(?:css|js))(?:\?v=[^"]*)?"/g,
    (_m, attr, filePath) => `${attr}="${filePath}?v=${version}"`
  );

  // 2) Meta app-version trong About, cùng nguồn sự thật tauri.conf.json.
  content = content.replace(
    /(<meta\s+name="app-version"\s+content=")[^"]*(")/,
    `$1${version}$2`
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
      console.error('Missing version value after --set, e.g.: --set 1.2.0');
      process.exit(1);
    }
    version = version.replace(/^v/, '');
    if (!isValidVersion(version)) {
      console.error(`Invalid version: "${version}" (expected X.Y.Z, e.g.: 1.2.0)`);
      process.exit(1);
    }

    let tauriConf = readFile(TAURI_CONF);
    tauriConf = setTauriConfVersion(tauriConf, version);
    writeFileAtomic(TAURI_CONF, tauriConf);

    let cargoToml = readFile(CARGO_TOML);
    cargoToml = setCargoVersion(cargoToml, version);
    writeFileAtomic(CARGO_TOML, cargoToml);

    console.log(`[sync-version] Updated version = ${version} in tauri.conf.json & Cargo.toml`);
  } else {
    const tauriConf = readFile(TAURI_CONF);
    version = getTauriConfVersion(tauriConf);
    if (!isValidVersion(version)) {
      throw new Error(`Version in tauri.conf.json is invalid: "${version}"`);
    }
  }

  let indexHtml = readFile(INDEX_HTML);
  indexHtml = syncIndexHtmlVersion(indexHtml, version);
  writeFileAtomic(INDEX_HTML, indexHtml);

  console.log(`[sync-version] Synced cache-busting ?v=${version} into ${path.relative(ROOT, INDEX_HTML)}`);
}

main();