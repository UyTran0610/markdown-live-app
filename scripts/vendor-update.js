#!/usr/bin/env node

// Cập nhật các thư viện trong src/vendor/ và đồng bộ src/THIRD_PARTY_NOTICES.md.
// Nguồn: jsDelivr (bản npm chính thức). App offline-first nên vendor file phải nằm sẵn trong repo.
//
//   node scripts/vendor-update.js --check              # báo cáo, không ghi file
//   node scripts/vendor-update.js --all                # nâng tất cả packages lên npm latest
//   node scripts/vendor-update.js --only katex         # nâng 1 package lên npm latest
//   node scripts/vendor-update.js --only katex,mermaid
//   node scripts/vendor-update.js --set marked@15.0.12 # ghim version cụ thể
//
// highlight.js cố ý vắng: src/vendor/highlight.min.js là bundle ~193 ngôn ngữ tự build,
// không có bản phát hành trên npm/jsDelivr/cdnjs (@highlightjs/cdn-assets chỉ có bản "common"
// ~37 ngôn ngữ). Build tay rồi tự sửa version trong notices — công thức:
//   npm i --no-save esbuild highlight.js@11.12.0
//   npx esbuild node_modules/highlight.js/lib/index.js --bundle --minify --format=iife --global-name=hljs --outfile=src/vendor/highlight.min.js
//   node -e "globalThis.window=globalThis;eval(require('fs').readFileSync('src/vendor/highlight.min.js','utf8'));console.log(hljs.versionString, hljs.listLanguages().length)"
// Lệnh cuối phải in version mới + 193 ngôn ngữ thì bundle mới đúng (dùng để bắt build hỏng).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.basename(__dirname) === 'scripts' ? path.resolve(__dirname, '..') : __dirname;

const VENDOR_DIR = path.join(ROOT, 'src/vendor');
const NOTICES_PATH = path.join(ROOT, 'src/THIRD_PARTY_NOTICES.md');

const CDN = 'https://cdn.jsdelivr.net/npm';
const API = 'https://data.jsdelivr.com/v1/packages/npm';
const REGISTRY = 'https://registry.npmjs.org';

const LICENSE_NAMES = ['LICENSE', 'LICENSE.md', 'license', 'license.md', 'LICENCE', 'LICENCE.md', 'COPYING'];

// `remote` là đường dẫn trong npm package; `local` là tên file trong src/vendor/.
// `remote` hết bằng '/**' = copy toàn bộ thư mục (chỉ dùng cho fonts của KaTeX).
// `tag` là tiền tố tag GitHub trong link nguồn ('' hoặc 'v').
const PACKAGES = [
  {
    name: 'marked', npm: 'marked', repo: 'https://github.com/markedjs/marked',
    license: 'MIT', tag: '',
    files: [['lib/marked.umd.js', 'marked.umd.js']],
  },
  {
    name: 'DOMPurify', npm: 'dompurify', repo: 'https://github.com/cure53/DOMPurify',
    license: 'Apache-2.0 **or** MPL-2.0', tag: '',
    files: [['dist/purify.min.js', 'purify.min.js']],
  },
  {
    name: 'mermaid', npm: 'mermaid', repo: 'https://github.com/mermaid-js/mermaid',
    license: 'MIT', tag: '',
    files: [['dist/mermaid.min.js', 'mermaid.min.js']],
  },
  {
    name: 'KaTeX', npm: 'katex', repo: 'https://github.com/KaTeX/KaTeX',
    license: 'MIT', tag: '',
    files: [['dist/katex.min.js', 'katex.min.js'], ['dist/katex.min.css', 'katex.min.css'], ['dist/fonts/**', 'fonts/']],
  },
  {
    name: 'lucide', npm: 'lucide', repo: 'https://github.com/lucide-icons/lucide',
    license: 'ISC', tag: '',
    files: [['dist/umd/lucide.min.js', 'lucide.min.js']],
  },
  {
    name: 'marked-katex-extension', npm: 'marked-katex-extension', repo: 'https://github.com/UziTech/marked-katex-extension',
    license: 'MIT', tag: 'v',
    files: [['lib/index.umd.js', 'marked-katex-extension.umd.js']],
  },
  {
    name: 'github-markdown-css', npm: 'github-markdown-css', repo: 'https://github.com/sindresorhus/github-markdown-css',
    license: 'MIT', tag: 'v',
    files: [['github-markdown-light.css', 'github-markdown-light.css'], ['github-markdown-dark.css', 'github-markdown-dark.css']],
  },
  {
    name: '@highlightjs/cdn-assets', npm: '@highlightjs/cdn-assets', repo: 'https://github.com/highlightjs/cdn-assets',
    license: 'BSD-3-Clause', tag: '',
    files: [['styles/github.min.css', 'hljs-github.min.css'], ['styles/github-dark.min.css', 'hljs-github-dark.min.css']],
  },
];

const MANUAL_PACKAGES = [
  {
    name: 'highlight.js', npm: 'highlight.js', repo: 'https://github.com/highlightjs/highlight.js',
    files: [['highlight.min.js', 'highlight.min.js']],
  },
];

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function readFile(p) {
  return fs.readFileSync(p, 'utf8');
}

// Ghi nguyên tử (tmp + rename) và bỏ qua khi nội dung không đổi: tránh mtime
// churn kích hoạt vòng build lại + không để lại file nửa vời khi crash.
function writeFileAtomic(p, data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  const prev = fs.existsSync(p) ? fs.readFileSync(p) : null;
  if (prev && prev.equals(buf)) return false;
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, p);
  return true;
}

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function fetchBuf(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return await res.text();
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return await res.json();
}

// jsDelivr chèn `//# sourceMappingURL=...` + newline ở cuối bản phục vụ; bản đã vendor trong
// repo không có (đã tải bằng công cụ khác / tự cắt). Cắt cho khớp byte-parity, nếu không
// mỗi lần update đều sinh diff ~39 byte ở 3 file.
// Chỉ cắt khi comment nằm thật sự ở đuôi file, và giữ lại newline đứng trước nó.
function stripSourceMappingURL(buf) {
  const marker = Buffer.from('//# sourceMappingURL=');
  const idx = buf.lastIndexOf(marker);
  if (idx === -1 || buf.length - idx > 200) return buf;
  return buf.subarray(0, idx);
}

const fileListCache = new Map();

async function listPackageFiles(spec) {
  if (fileListCache.has(spec)) return fileListCache.get(spec);
  const data = await fetchJson(`${API}/${spec}`);
  const out = [];
  (function walk(nodes, prefix) {
    for (const node of nodes) {
      const p = prefix ? `${prefix}/${node.name}` : node.name;
      if (node.type === 'directory') walk(node.files, p);
      else out.push(p);
    }
  })(data.files, '');
  fileListCache.set(spec, out);
  return out;
}

const latestCache = new Map();

async function npmLatestVersion(npmName) {
  if (latestCache.has(npmName)) return latestCache.get(npmName);
  const data = await fetchJson(`${REGISTRY}/${encodeURIComponent(npmName)}/latest`);
  if (typeof data.version !== 'string') throw new Error(`npm không trả về version cho ${npmName}`);
  latestCache.set(npmName, data.version);
  return data.version;
}

// 'dist/fonts/**' -> mọi file .ttf/.woff/.woff2 trực tiếp trong thư mục đó.
// Rỗng = sai đường dẫn, phải ném lỗi: nếu im lặng trả về [] thì bước prune sẽ xoá sạch
// thư mục đang có (đã xảy ra một lần khi ghi 'fonts/**' thay vì 'dist/fonts/**').
async function expandGlob(pkg, remote, version) {
  if (!remote.endsWith('/**')) return [remote];
  const dir = remote.slice(0, -2); // bỏ '**', giữ dấu '/' cuối
  const files = await listPackageFiles(`${pkg.npm}@${version}`);
  const exts = new Set(['.ttf', '.woff', '.woff2']);
  const matched = files
    .filter((f) => f.startsWith(dir) && !f.slice(dir.length).includes('/') && exts.has(path.extname(f)))
    .sort();
  if (!matched.length) throw new Error(`${pkg.npm}@${version} không có file nào khớp "${dir}*.{ttf,woff,woff2}"`);
  return matched;
}

async function findLicenseFile(pkg, version) {
  const files = await listPackageFiles(`${pkg.npm}@${version}`);
  for (const name of LICENSE_NAMES) {
    if (files.includes(name)) return name;
  }
  throw new Error(`${pkg.npm}@${version} không có file license (thử: ${LICENSE_NAMES.join(', ')})`);
}

// 0.16 -> 0.19 là breaking dù major vẫn là 0, nên 0.x so cả minor.
function isBreakingJump(from, to) {
  const a = from.split('.').map(Number);
  const b = to.split('.').map(Number);
  if (a[0] !== b[0]) return true;
  return a[0] === 0 && a[1] !== b[1];
}

// ---------------------------------------------------------------------------
// THIRD_PARTY_NOTICES.md
// ---------------------------------------------------------------------------

// Các khối license của marked / DOMPurify chứa chính các dòng bắt đầu bằng '## '
// ("## Grant of Copyright License", "## Contribution License Agreement"...).
// Nên phải bỏ qua mọi heading nằm trong ```text, nếu không section sẽ bị cắt cụt
// và phần thay license text không bao giờ chạy tới.
function topLevelSections(doc) {
  const out = [];
  let offset = 0;
  let inFence = false;
  for (const line of doc.split('\n')) {
    if (/^```/.test(line)) inFence = !inFence;
    else if (!inFence && line.startsWith('## ')) out.push({ name: line.slice(3).trim(), start: offset });
    offset += line.length + 1;
  }
  return out;
}

// Cắt file theo heading `## <name>`; chỉ patch bên trong section tương ứng để không
// đụng nhầm các section khác (mỗi package có nguyên khối license 400 dòng).
function patchSection(doc, name, patch) {
  const sections = topLevelSections(doc);
  const i = sections.findIndex((s) => s.name === name);
  if (i === -1) throw new Error(`Không tìm thấy section "## ${name}" trong THIRD_PARTY_NOTICES.md`);
  const start = sections[i].start;
  const end = i + 1 < sections.length ? sections[i + 1].start : doc.length;
  // Không cần patch nào khớp cũng OK: chạy lại ở version hiện tại là no-op.
  return doc.slice(0, start) + patch(doc.slice(start, end)) + doc.slice(end);
}

function patchNoticesTableRow(doc, pkg, version) {
  const re = new RegExp(`^(\\|\\s*\\[${esc(pkg.name)}\\]\\([^)]*\\)\\s*\\|\\s*)(\\S+?)(\\s*\\|)`, 'm');
  if (!re.test(doc)) throw new Error(`Không tìm thấy dòng bảng cho ${pkg.name}`);
  return doc.replace(re, `$1${version}$3`);
}

function patchPackageSection(doc, pkg, version, licenseFile, licenseText) {
  const tag = pkg.tag + version;
  return patchSection(doc, pkg.name, (section) => {
    // File notices trộn lẫn CRLF và LF, nên mọi pattern đều khoá `[^\r\n]`
    // thay vì `$` — nếu không, dòng kết thúc bằng CRLF sẽ không khớp.
    section = section
      .replace(/^(- \*\*Version:\*\* )[^\r\n]+/m, `$1${version}`)
      .replace(/^(- \*\*Source:\*\* npm: <)[^<\r\n]+(> &middot; GitHub: <)[^<\r\n]+(>)/m,
        `$1https://www.npmjs.com/package/${pkg.npm}/v/${version}$2${pkg.repo}/tree/${tag}$3`)
      .replace(/^(- \*\*License text retrieved from:\*\* )[^\r\n]+/m,
        `$1${CDN}/${pkg.npm}@${version}/${licenseFile}`)
      .replace(/^(<summary>Full license text &mdash; .*?) \d[^<\r\n]*(<\/summary>)/m,
        `$1 ${version}$2`);
    // Khối ```text ngay sau <details>: thay bằng license tải về.
    section = section.replace(/(```text\r?\n)[\s\S]*?(\r?\n```)/, (_m, open, close) =>
      open + licenseText.replace(/\s+$/, '') + close);
    return section;
  });
}

function currentVersion(doc, pkg) {
  const m = new RegExp(`^\\|\\s*\\[${esc(pkg.name)}\\]\\([^)]*\\)\\s*\\|\\s*(\\S+?)\\s*\\|`, 'm').exec(doc);
  if (!m) throw new Error(`Không tìm thấy dòng bảng cho ${pkg.name} trong THIRD_PARTY_NOTICES.md`);
  return m[1];
}

// ---------------------------------------------------------------------------
// cập nhật
// ---------------------------------------------------------------------------

function ownedTopLevelNames() {
  const names = new Set();
  for (const p of [...PACKAGES, ...MANUAL_PACKAGES]) {
    for (const [remote, local] of p.files) {
      if (!remote.endsWith('/**')) names.add(local);
    }
  }
  return names;
}

function pruneFonts(keep) {
  const dir = path.join(VENDOR_DIR, 'fonts');
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (keep.has(`fonts/${f}`)) continue;
    fs.rmSync(path.join(dir, f));
    console.log(`    - xoá file thừa fonts/${f}`);
  }
}

async function updatePackage(pkg, version) {
  console.log(`\n[${pkg.name}] -> ${version}`);
  const licenseFile = await findLicenseFile(pkg, version);
  const licenseText = await fetchText(`${CDN}/${pkg.npm}@${version}/${licenseFile}`);

  const written = new Set();
  for (const [remoteSpec, localSpec] of pkg.files) {
    for (const remote of await expandGlob(pkg, remoteSpec, version)) {
      const local = localSpec.endsWith('/') ? localSpec + path.basename(remote) : localSpec;
      const buf = stripSourceMappingURL(await fetchBuf(`${CDN}/${pkg.npm}@${version}/${remote}`));
      const target = path.join(VENDOR_DIR, local);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const changed = writeFileAtomic(target, buf);
      written.add(local.split(path.sep).join('/'));
      console.log(`    ${changed ? 'cập nhật' : 'giữ nguyên'}  ${local}  (${buf.length} bytes)`);
    }
  }

  if (pkg.files.some(([remote]) => remote.endsWith('/**'))) pruneFonts(written);

  const doc = readFile(NOTICES_PATH);
  const next = patchPackageSection(
    patchNoticesTableRow(doc, pkg, version), pkg, version, licenseFile, licenseText);
  writeFileAtomic(NOTICES_PATH, next);
  console.log(`    notices: version ${version}, license lấy từ ${licenseFile}`);

  console.log('    ⚠ kiểm tra lại phần "## Notes" của notices — version ghi trong đó');
  console.log('      (dependency nội bộ của bundle mermaid) không được script tự sửa.');
}

function parseArgs(argv) {
  // Mặc định là --check: chạy script không cờ chỉ in báo cáo, không ghi file.
  const args = { mode: 'check', all: false, only: null, pins: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check' || a === '--dry-run') args.mode = 'check';
    else if (a === '--all') { args.mode = 'apply'; args.all = true; }
    else if (a === '--set') { args.mode = 'apply'; pin(args.pins, argv[++i]); }
    else if (a === '--only') { args.mode = 'apply'; args.only = splitList(argv[++i]); }
    else if (a && a.startsWith('--set=')) { args.mode = 'apply'; pin(args.pins, a.slice('--set='.length)); }
    else if (a && a.startsWith('--only=')) { args.mode = 'apply'; args.only = splitList(a.slice('--only='.length)); }
    else if (a === '--help' || a === '-h') args.mode = 'help';
    else throw new Error(`Tham số lạ: ${a}`);
  }
  if (args.all && (args.only || Object.keys(args.pins).length)) {
    throw new Error('--all không đi cùng --only/--set — chọn một: --all | --only <pkg> | --set <pkg>@<ver>');
  }
  return args;
}

function splitList(v) {
  if (!v) throw new Error('Thiếu danh sách package sau --only');
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

function pin(pins, value) {
  if (!value) throw new Error('Thiếu giá trị sau --set, vd: --set marked@15.0.12');
  const at = value.lastIndexOf('@');
  if (at <= 0) throw new Error(`--set cần dạng <package>@<version>, vd: --set marked@15.0.12 (nhận "${value}")`);
  pins[value.slice(0, at).trim()] = value.slice(at + 1).trim();
}

function selectPackages(only, pins) {
  // `--set a@1 --set b@2` không có --only vẫn chỉ chạy 2 package đó, không phải toàn bộ.
  const wanted = new Set(only ?? Object.keys(pins));
  if (!wanted.size) return PACKAGES;
  const picked = PACKAGES.filter((p) => wanted.has(p.name) || wanted.has(p.npm));
  const unknown = [...wanted].filter((w) => !picked.some((p) => p.name === w || p.npm === w));
  if (unknown.length) throw new Error(`Không có package nào tên "${unknown.join(', ')}"`);
  return picked;
}

function usage() {
  console.log(`Cập nhật thư viện trong src/vendor/ + src/THIRD_PARTY_NOTICES.md

  node scripts/vendor-update.js                 (= --check) báo cáo version hiện tại vs npm latest
  node scripts/vendor-update.js --all            nâng TẤT CẢ package lên npm latest
  node scripts/vendor-update.js --only <pkg>[,<pkg>] nâng package lên npm latest
  node scripts/vendor-update.js --set <pkg>@<ver>     ghim version cụ thể (ghép nhiều: --set a@1 --set b@2)

Package hỗ trợ: ${PACKAGES.map((p) => p.name).join(', ')}
Không tự động: ${MANUAL_PACKAGES.map((p) => p.name).join(', ')} (bundle tự build, không có trên CDN)`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === 'help') return usage();

  const doc = readFile(NOTICES_PATH);
  const targets = selectPackages(args.only, args.pins);

  if (args.mode === 'check') {
    const rows = [];
    for (const pkg of targets) {
      const cur = currentVersion(doc, pkg);
      const latest = await npmLatestVersion(pkg.npm);
      rows.push({ pkg: pkg.name, cur, latest, breaking: isBreakingJump(cur, latest) });
    }
    for (const m of MANUAL_PACKAGES) {
      rows.push({ pkg: m.name, cur: currentVersion(doc, { name: m.name }), latest: '— build tay —', breaking: false, manual: true });
    }
    const w = Math.max(...rows.map((r) => r.pkg.length));
    for (const r of rows) {
      const flag = r.manual ? 'build tay      '
        : r.cur === r.latest ? 'ok             '
        : r.breaking ? 'CẦN REVIEW     '
        : 'có bản mới      ';
      console.log(`${r.pkg.padEnd(w)}  ${flag}  ${r.cur} -> ${r.latest}`);
    }
    console.log('\nDùng --all (tất cả), --only <pkg> hoặc --set <pkg>@<ver> để cập nhật.');
    return;
  }

  if (args.all) {
    const breaking = [];
    for (const pkg of targets) {
      const cur = currentVersion(doc, pkg);
      const latest = await npmLatestVersion(pkg.npm);
      if (cur !== latest && isBreakingJump(cur, latest)) breaking.push(`    ${pkg.name}: ${cur} -> ${latest}`);
    }
    if (breaking.length) {
      console.log('Sắp nhảy major, có thể phá app — nhớ test lại sau khi chạy:');
      console.log(breaking.join('\n'));
    }
  }

  for (const pkg of targets) {
    const version = args.pins[pkg.name] ?? args.pins[pkg.npm] ?? await npmLatestVersion(pkg.npm);
    await updatePackage(pkg, version);
  }

  const owned = ownedTopLevelNames();
  for (const f of fs.readdirSync(VENDOR_DIR)) {
    const full = path.join(VENDOR_DIR, f);
    if (!fs.statSync(full).isFile() || owned.has(f)) continue;
    console.log(`\n⚠ ${f} trong src/vendor/ không thuộc package nào trong bảng registry — kiểm tra thủ công.`);
  }
  console.log('\nXong. Chạy `npm run tauri dev` để xác nhận app vẫn render sau khi nhảy version.');
}

main().catch((e) => {
  console.error(`[vendor-update] ${e.message}`);
  process.exit(1);
});