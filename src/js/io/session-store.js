// js/io/session-store.js — Session trong IndexedDB: mỗi tab một record, meta riêng.
// localStorage chỉ ~5M ký tự cho cả origin nên một file lớn là hết chỗ; IDB cho hàng trăm MB
// và chỉ ghi lại tab vừa đổi.

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

// Xếp hàng các lần ghi: lần sau không đè lên lần trước, nhất là khi onCloseRequested đang chờ.
let queue = Promise.resolve();

function enqueue(job) {
    // Lỗi phải tới NƠI GỌI để saveSession báo được và giữ cửa sổ; hàng đợi dùng bản đã nuốt
    // để vẫn chạy tiếp.
    const result = queue.then(job);
    queue = result.catch(() => {});
    return result;
}

// Chờ mọi lần ghi đang xếp hàng; onCloseRequested gọi trước khi destroy().
export function whenSessionWritten() {
    return queue;
}

// Vân tay bản ghi đã ghi lần trước; xoá khỏi đây là xoá khỏi đĩa.
const lastWritten = new Map();

// Vân tay rút từ chính record: mọi trường đều góp mặt, riêng content thay bằng độ dài + hash
// (stringify 4 tab 5 MB tốn ~57 ms/snapshot và giữ 41 MB trong RAM). Hàm thuần.
export function sessionFingerprint(tab) {
    return Object.keys(tab).sort().map((key) => {
        const value = tab[key];
        if (key !== 'content') return String(value);
        return value === null ? 'null' : `${value.length}:${hashText(value)}`;
    }).join('\u0000');
}

// null = chưa có phiên trong IDB (cần migrate từ localStorage).
export async function loadSession() {
    const db = await openDb();
    const store = db.transaction(STORE, 'readonly').objectStore(STORE);
    // Hai request trong cùng transaction: await giữa chúng sẽ đóng transaction.
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

    // lastWritten còn rỗng nên lần ghi kế tiếp ghi lại hết: đúng, cần đồng bộ với IDB.
    return {
        activeId: meta.activeId,
        tabs,
        recent: Array.isArray(meta.recent) ? meta.recent : [],
        defaultEol: meta.defaultEol === '\r\n' ? '\r\n' : '\n'
    };
}

// Chỉ ghi lại tab đã đổi và xoá record của tab không còn; resolve khi transaction commit.
// lastWritten chỉ cập nhật sau commit, nếu không tab ghi hỏng sẽ không bao giờ được thử lại.
// durability 'strict' dùng cho lần ghi lúc đóng cửa sổ (mặc định có thể mất khi destroy ngay).
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
        // Chỉ cập nhật lastWritten sau commit, nếu không lần sau bỏ qua đúng tab vừa mất.
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
                // Quên vân tay cũ để lần ghi sau thử lại.
                pending.forEach((_fp, id) => lastWritten.delete(id));
                reject(tx.error || new Error('IndexedDB transaction failed'));
            };
        });
        return done;
    });
}

// Ghi sang IDB rồi mới xoá key localStorage; xoá trước mà ghi hỏng là mất phiên.
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
        // storage bị chặn: key cũ còn nguyên cũng vô hại, IDB đã có bản chính.
    }
    return true;
}