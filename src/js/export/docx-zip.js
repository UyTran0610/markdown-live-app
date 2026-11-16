// js/export/docx-zip.js — Gói ZIP cho file DOCX (lưu trữ, không nén). Không dùng DOM.

// Bảng CRC-32 chuẩn IEEE 802.3, dựng một lần rồi tra mỗi byte.
const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[i] = c >>> 0;
    }
    return table;
})();

export function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Định dạng thời gian DOS (2 byte thời gian + 2 byte ngày) mà ZIP yêu cầu.
function dosDateTime(date) {
    const year = Math.max(1980, date.getFullYear());
    return {
        time: ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((date.getSeconds() / 2) & 31),
        date: (((year - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31)
    };
}

// entries: [{ name, data: Uint8Array }] -> Uint8Array của file ZIP.
// Dùng phương thức "store": DOCX vẫn hợp lệ, không cần thư viện nén.
export function createZip(entries, { date = new Date() } = {}) {
    const encoder = new TextEncoder();
    const { time, date: dosDate } = dosDateTime(date);
    const body = [];
    const central = [];
    let offset = 0;

    for (const entry of entries) {
        const name = encoder.encode(entry.name);
        const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data);
        const crc = crc32(data);

        const local = new Uint8Array(30 + name.length);
        const lv = new DataView(local.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(4, 20, true);      // version cần thiết
        lv.setUint16(6, 0x0800, true);  // cờ: tên file là UTF-8
        lv.setUint16(8, 0, true);       // 0 = lưu trữ, không nén
        lv.setUint16(10, time, true);
        lv.setUint16(12, dosDate, true);
        lv.setUint32(14, crc, true);
        lv.setUint32(18, data.length, true);
        lv.setUint32(22, data.length, true);
        lv.setUint16(26, name.length, true);
        lv.setUint16(28, 0, true);
        local.set(name, 30);

        const cd = new Uint8Array(46 + name.length);
        const cv = new DataView(cd.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);       // version tạo bởi
        cv.setUint16(6, 20, true);       // version cần thiết
        cv.setUint16(8, 0x0800, true);
        cv.setUint16(10, 0, true);
        cv.setUint16(12, time, true);
        cv.setUint16(14, dosDate, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, data.length, true);
        cv.setUint32(24, data.length, true);
        cv.setUint16(28, name.length, true);
        cv.setUint16(30, 0, true);
        cv.setUint16(32, 0, true);
        cv.setUint16(34, 0, true);
        cv.setUint16(36, 0, true);
        cv.setUint32(38, 0, true);
        cv.setUint32(42, offset, true);
        cd.set(name, 46);

        body.push(local, data);
        central.push(cd);
        offset += local.length + data.length;
    }

    const centralSize = central.reduce((sum, c) => sum + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);

    const total = body.reduce((s, p) => s + p.length, 0) + centralSize + end.length;
    const out = new Uint8Array(total);
    let pos = 0;
    for (const part of body) { out.set(part, pos); pos += part.length; }
    for (const record of central) { out.set(record, pos); pos += record.length; }
    out.set(end, pos);
    return out;
}
