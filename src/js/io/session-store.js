// js/io/session-store.js — Tầng lưu phiên làm việc: IndexedDB thay cho localStorage.
//
// Vì sao không localStorage: quota ~5M ký tự cho CẢ origin trong khi một file được phép tới 5M,
// nên chỉ một file lớn đang sửa dở là hết chỗ. setItem lỗi thì mất trắng cả danh sách tab. Ở đây
// mỗi tab một record riêng nên chỉ ghi lại tab vừa đổi, và quota thực tế là hàng trăm MB.
//
// Hình dạng record (schema v1):
//   key 'meta'      -> { v, activeId, order: [id], recent: [path] }
//   key 'tab:<id>'  -> { id, path, name, content, eol, bom, status, diskMtime, dirty, scroll... }
// loadSession() trả về đúng shape của serializeSession(), documents.js vẫn chạy
// deserializeSession() trên đó — nơi duy nhất biết dữ liệu lưu hỏng thì phải sửa thế nào.

import { hashText } from '../export/file-save.js';

const DB_NAME = 'markdown-live';
const DB_VERSION = 1;
const STORE = 'session';
const META_KEY = 'meta';
const SCHEMA_VERSION = 1;

let dbPromise = null;

function openDb() {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
            req.onblocked = () => reject(new Error('IndexedDB bị chặn bởi một tab khác của app'));
        }).catch((err) => {
            dbPromise = null;
            throw err;
        });
    }
    return dbPromise;
}

function request(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// Các lần ghi nối tiếp nhau trên cùng một store: xếp hàng để lần sau không đè lên lần trước giữa
// chừng (đặc biệt khi onCloseRequested đang chờ một lần ghi cụ thể).
let queue = Promise.resolve();

function enqueue(job) {
    // Lỗi phải đi tới NƠI GỌI (saveSession cần biết để báo người dùng và để không đóng cửa sổ), nên
    // promise trả về không được nuốt lỗi; hàng đợi thì vẫn phải chạy tiếp nên nó dùng bản đã nuốt.
    // Bản cũ `queue.then(job).catch(...)` làm promise trả về luôn resolve -> mọi .catch() của nơi gọi
    // là code chết, không lỗi nào từng được báo.
    const result = queue.then(job);
    queue = result.catch(() => {});
    return result;
}

// Chờ mọi lần ghi đang xếp hàng hoàn tất. onCloseRequested gọi hàm này rồi mới destroy() cửa sổ.
export function whenSessionWritten() {
    return queue;
}

// Vân tay bản ghi tab đã ghi lần trước, dùng để chỉ ghi lại tab thật sự đổi. Xoá khỏi đây là xoá khỏi đĩa.
const lastWritten = new Map();

// Vân tay rút từ CHÍNH record sắp ghi: mọi trường đều góp mặt (thêm trường mới là tự động được tính),
// riêng `content` — chuỗi có thể tới 5 MB — thay bằng độ dài + hash. Không dùng JSON.stringify ở đây:
// đo trên 4 tab 5 MB thì stringify + hash tốn ~57 ms mỗi snapshot, cách này ~37 ms, còn bản cũ giữ
// nguyên chuỗi JSON của mọi tab trong RAM (41 MB cho 4 tab). Hàm thuần, selfcheck gọi được.
export function sessionFingerprint(tab) {
    return Object.keys(tab).sort().map((key) => {
        const value = tab[key];
        if (key !== 'content') return String(value);
        return value === null ? 'null' : `${value.length}:${hashText(value)}`;
    }).join('\u0000');
}

// Trả về null khi chưa có phiên nào trong IDB (cần migrate từ localStorage).
export async function loadSession() {
    const db = await openDb();
    const store = db.transaction(STORE, 'readonly').objectStore(STORE);
    // Hai request bắn cùng lúc trong cùng transaction: transaction của IndexedDB tự đóng khi
    // hàng đợi microtask rỗng, nên await giữa chúng sẽ giết transaction.
    const keysPromise = request(store.getAllKeys());
    const valuesPromise = request(store.getAll());
    const [keys, values] = await Promise.all([keysPromise, valuesPromise]);

    const byId = new Map();
    keys.forEach((key, i) => {
        const rec = values[i];
        if (key !== META_KEY && rec && Number.isSafeInteger(rec.id)) byId.set(rec.id, rec);
    });
    const meta = values[keys.indexOf(META_KEY)];
    if (!meta || !byId.size) return null;

    const order = Array.isArray(meta.order) ? meta.order : [...byId.keys()];
    const tabs = order.filter((id) => byId.has(id)).map((id) => byId.get(id));
    if (!tabs.length) return null;

    // lastWritten lúc này vẫn rỗng nên lần ghi kế tiếp sẽ ghi lại hết: đúng, cần đồng bộ với IDB.
    return {
        activeId: meta.activeId,
        tabs,
        recent: Array.isArray(meta.recent) ? meta.recent : [],
        defaultEol: meta.defaultEol === '\r\n' ? '\r\n' : '\n'
    };
}

// Ghi phiên. `snapshot` là output của serializeSession(). Chỉ ghi lại record tab đã đổi so với
// lần ghi trước, và xoá record của tab không còn trong danh sách.
//
// Promise này chỉ resolve khi TRANSACTION đã commit (oncomplete). Trước đây hàm đưa put() vào hàng
// đợi rồi return ngay: lỗi quota/abort không bao giờ tới .catch của nơi gọi, và lastWritten đã được
// cập nhật nên tab hỏng ghi đó vĩnh viễn không được ghi lại.
// `durability: 'strict'` dùng cho lần ghi lúc đóng cửa sổ — mặc định của Chromium ghi qua OS buffer,
// nên destroy() ngay sau khi transaction xong vẫn có thể mất dữ liệu.
export function writeSession(snapshot, { durability = 'default' } = {}) {
    return enqueue(async () => {
        const db = await openDb();
        const tx = db.transaction(STORE, 'readwrite', { durability });
        const store = tx.objectStore(STORE);

        store.put({
            v: SCHEMA_VERSION,
            activeId: snapshot.activeId,
            order: snapshot.tabs.map((tab) => tab.id),
            recent: snapshot.recent || [],
            defaultEol: snapshot.defaultEol === '\r\n' ? '\r\n' : '\n'
        }, META_KEY);

        const liveIds = new Set(snapshot.tabs.map((tab) => tab.id));
        // Chỉ cập nhật lastWritten khi transaction đã commit: chưa commit mà đã coi là "đã ghi" thì
        // lần ghi sau bỏ qua đúng những tab vừa mất.
        const pending = new Map();
        for (const tab of snapshot.tabs) {
            const fp = sessionFingerprint(tab);
            if (lastWritten.get(tab.id) === fp) continue;
            store.put(tab, `tab:${tab.id}`);
            pending.set(tab.id, fp);
        }
        const removed = [];
        for (const id of [...lastWritten.keys()]) {
            if (liveIds.has(id)) continue;
            store.delete(`tab:${id}`);
            removed.push(id);
        }

        const done = new Promise((resolve, reject) => {
            tx.oncomplete = () => {
                pending.forEach((fp, id) => lastWritten.set(id, fp));
                removed.forEach((id) => lastWritten.delete(id));
                resolve();
            };
            tx.onerror = tx.onabort = () => {
                // Quên vân tay cũ của những tab vừa định ghi: lần ghi sau sẽ thử lại chúng.
                pending.forEach((_fp, id) => lastWritten.delete(id));
                reject(tx.error || new Error('IndexedDB transaction failed'));
            };
        });
        return done;
    });
}

// Nhận phiên cũ đang nằm trong localStorage: ghi sang IDB rồi xoá key cũ. Ghi trước, xoá sau —
// mất key cũ khi ghi IDB hỏng là mất phiên.
export async function migrateLegacySession(rawJson) {
    let parsed;
    try {
        parsed = JSON.parse(rawJson);
    } catch (e) {
        return false;
    }
    if (!parsed || !Array.isArray(parsed.tabs) || !parsed.tabs.length) return false;
    await writeSession(parsed);
    try {
        localStorage.removeItem('markdown-live-session');
    } catch (e) {
        // storage bị chính sách chặn: key cũ còn nguyên cũng vô hại, IDB đã có bản chính.
    }
    return true;
}