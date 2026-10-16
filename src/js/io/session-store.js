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
    queue = queue.then(job).catch((err) => console.error('Session store:', err));
    return queue;
}

// Chờ mọi lần ghi đang xếp hàng hoàn tất. onCloseRequested gọi hàm này rồi mới destroy() cửa sổ.
export function whenSessionWritten() {
    return queue;
}

// Bản ghi tab đã gì lần trước, dùng để chỉ ghi lại tab thật sự đổi. Xoá khỏi đây là xoá khỏi đĩa.
const lastWritten = new Map();

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
    return { activeId: meta.activeId, tabs, recent: Array.isArray(meta.recent) ? meta.recent : [] };
}

// Ghi phiên. `snapshot` là output của serializeSession(). Chỉ ghi lại record tab đã đổi so với
// lần ghi trước, và xoá record của tab không còn trong danh sách.
export function writeSession(snapshot) {
    return enqueue(async () => {
        const db = await openDb();
        const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
        store.put({
            v: SCHEMA_VERSION,
            activeId: snapshot.activeId,
            order: snapshot.tabs.map((tab) => tab.id),
            recent: snapshot.recent || []
        }, META_KEY);

        const liveIds = new Set(snapshot.tabs.map((tab) => tab.id));
        for (const tab of snapshot.tabs) {
            const json = JSON.stringify(tab);
            if (lastWritten.get(tab.id) === json) continue;
            store.put(tab, `tab:${tab.id}`);
            lastWritten.set(tab.id, json);
        }
        for (const id of [...lastWritten.keys()]) {
            if (liveIds.has(id)) continue;
            store.delete(`tab:${id}`);
            lastWritten.delete(id);
        }
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