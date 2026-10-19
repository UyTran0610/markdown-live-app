// js/ui/tabs.js — Dải tab: dựng lại từ store, bấm/middle-click, kéo đổi thứ tự.

import { btnSave, btnSaveAll, btnSaveAs, btnTabScrollLeft, btnTabScrollRight, tabStrip } from '../core/dom.js';
import { closeTab, getActiveTab, getTabs, isTabDirty, moveTab, newTab, subscribe, switchTab } from '../io/documents.js';
import { openAllTabsMenu } from './tab-menu.js';

const STATUS_TITLE = {
    unreadable: 'Could not read this file - use Save As, saving here would overwrite it',
    missing: 'This file was deleted from disk'
};

// Dùng ký tự × vì lucide.createIcons() chỉ chạy một lần lúc DOMContentLoaded.
function buildTab(tab, isActive, displayName, dupeCount) {
    const dirty = isTabDirty(tab);
    const broken = tab.status !== 'ok';

    const el = document.createElement('div');
    el.className = isActive ? 'tab active' : 'tab';
    el.dataset.tabId = String(tab.id);
    el.title = tab.path || tab.name;
    el.setAttribute('role', 'tab');
    el.setAttribute('aria-selected', String(isActive));
    // Roving tabindex: chỉ tab active nhận focus; thiếu tabindex thì div không focus được.
    el.tabIndex = isActive ? 0 : -1;

    const name = document.createElement('span');
    name.className = 'tab-name';
    name.textContent = displayName;

    const dot = document.createElement('span');
    dot.className = 'tab-dot';
    dot.hidden = !dirty;
    dot.title = 'Unsaved changes';

    el.append(name, dot);

    if (broken) {
        const mark = document.createElement('span');
        mark.className = 'tab-broken';
        mark.textContent = '!';
        mark.title = STATUS_TITLE[tab.status] || '';
        el.append(mark);
    }

    const close = document.createElement('span');
    close.className = 'tab-close';
    close.title = 'Close tab';
    close.setAttribute('role', 'button');
    close.setAttribute('aria-label', `Close ${tab.name}`);
    close.textContent = '\u00d7';

    el.append(close);
    if (dupeCount > 1) el.dataset.dupe = String(dupeCount);
    if (tab.pinned) el.dataset.pinned = 'true';
    return el;
}

// Tab trùng tên phân biệt bằng thư mục cha (kiểu VS Code).
export function disambiguateTabName(tab, tabs) {
    if (!tab.path) return tab.name;
    const sameName = tabs.filter((other) => other.name === tab.name).length;
    if (sameName < 2) return tab.name;
    const parent = tab.path.split(/[\\/]/).slice(-2, -1)[0];
    return parent ? `${parent}/${tab.name}` : tab.name;
}

// Chỉ tab mới được .tab-enter: dải tab bị replaceChildren() mỗi lần emit.
let seenIds = new Set();

// Lần render đầu không gắn .tab-enter, nếu không cả dải trượt vào lúc mở app.
let firstRender = true;

// Id tab đang mở ở lần render trước: chỉ cuộn tab active vào khung nhìn khi nó thực sự đổi.
let lastRenderedActiveId = null;

// Trạng thái cuộn tách khỏi DOM để self-check kiểm được.
export function tabScrollState(scrollWidth, clientWidth, scrollLeft) {
    const max = scrollWidth - clientWidth;
    return { canScroll: max > 0, left: scrollLeft > 0, right: scrollLeft < max };
}

// Tab bị khuất thì fade + bật nút cuộn; nút hết hướng thì disable, không ẩn.
function updateOverflow() {
    const state = tabScrollState(tabStrip.scrollWidth, tabStrip.clientWidth, tabStrip.scrollLeft);
    tabStrip.classList.toggle('can-left', state.left);
    tabStrip.classList.toggle('can-right', state.right);
    if (btnTabScrollLeft) {
        btnTabScrollLeft.hidden = !state.canScroll;
        btnTabScrollLeft.disabled = !state.left;
    }
    if (btnTabScrollRight) {
        btnTabScrollRight.hidden = !state.canScroll;
        btnTabScrollRight.disabled = !state.right;
    }
}

function render() {
    if (drag) endDrag(false);
    const all = getTabs();
    const active = getActiveTab();
    const ids = new Set(all.map((tab) => tab.id));
    tabStrip.replaceChildren();

    all.forEach((tab) => {
        const el = buildTab(tab, !!active && tab.id === active.id, disambiguateTabName(tab, all), all.filter((t) => t.name === tab.name).length);
        if (!firstRender && !seenIds.has(tab.id)) el.classList.add('tab-enter');
        el.addEventListener('click', (e) => {
            // Nuốt click sinh ra sau khi kéo, nếu không kéo sẽ mở nhầm tab.
            if (draggedId === tab.id) {
                draggedId = null;
                return;
            }
            if (e.target.closest('.tab-close')) {
                e.stopPropagation();
                closeTab(tab.id);
                return;
            }
            switchTab(tab.id);
        });
        // Middle-click đóng tab: chuẩn trình duyệt, miễn phí bằng một listener.
        el.addEventListener('auxclick', (e) => {
            if (e.button !== 1) return;
            e.preventDefault();
            closeTab(tab.id);
        });
        // Windows bật autoscroll ở mousedown chuột giữa, trước auxclick, nên preventDefault
        // phải đặt ở mousedown.
        el.addEventListener('mousedown', (e) => {
            if (e.button === 1) e.preventDefault();
        });
        tabStrip.appendChild(el);
    });

    const add = document.createElement('button');
    add.className = 'tab-add';
    add.type = 'button';
    add.title = 'New tab (Ctrl+T)';
    add.setAttribute('aria-label', 'New tab');
    add.textContent = '+';
    add.addEventListener('click', () => newTab());
    tabStrip.appendChild(add);

    // Save chỉ bật khi tab khác đĩa; tab lỗi không bật vì bấm Save sẽ thành Save As.
    const dirty = !!(active && isTabDirty(active));
    const broken = !!(active && active.status !== 'ok');
    if (btnSave) btnSave.disabled = !dirty || broken;
    if (btnSaveAs) btnSaveAs.disabled = !active;
    if (btnSaveAll) btnSaveAll.hidden = all.filter(isTabDirty).length < 2;

    // Chỉ cuộn tab active vào khung nhìn khi tab active đổi, nếu không dải tab bị giật.
    const activeChanged = !active || active.id !== lastRenderedActiveId;
    lastRenderedActiveId = active ? active.id : null;
    if (activeChanged) tabStrip.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    updateOverflow();

    seenIds = ids;
    firstRender = false;
}

// Trong lúc kéo chỉ sửa DOM (store chỉ biết lúc thả): tab kéo dùng position:fixed, chỗ giữ là
// .tab-slot, các tab còn lại trượt bằng FLIP.

const DRAG_THRESHOLD = 4;
const EDGE_ZONE = 40;
const EDGE_STEP = 12;

let drag = null;
let dragging = [];
let draggedId = null;

// Vị trí chèn trên danh sách DOM (không kể tab đang kéo); tách khỏi DOM để self-check kiểm.
export function dropIndex(rects, pointerX) {
    for (let i = 0; i < rects.length; i++) {
        if (pointerX < rects[i].left + rects[i].width / 2) return i;
    }
    return rects.length;
}

// FLIP: đo trước, sửa DOM, đặt lệch bằng transform rồi thả ở frame sau.
function flip(apply) {
    const els = [...tabStrip.querySelectorAll('.tab, .tab-slot')].filter((el) => el !== drag.el);
    const before = els.map((el) => el.getBoundingClientRect().left);
    apply();
    els.forEach((el, i) => {
        const delta = before[i] - el.getBoundingClientRect().left;
        if (!delta) return;
        el.style.transition = 'none';
        el.style.transform = `translateX(${delta}px)`;
        dragging.push(el);
    });
    requestAnimationFrame(() => {
        dragging.forEach((el) => { el.style.transition = ''; el.style.transform = ''; });
        dragging = [];
    });
}

// Chỗ chèn có đổi mới sửa DOM: giữa hai lần pointermove có thể không có chuyện gì xảy ra.
function place() {
    const els = [...tabStrip.querySelectorAll('.tab:not(.tab-dragging)')];
    const index = dropIndex(els.map((el) => el.getBoundingClientRect()), drag.x);
    if (index === drag.index) return;
    drag.index = index;
    flip(() => tabStrip.insertBefore(drag.slot, els[index] || tabStrip.querySelector('.tab-add')));
}

// Một lần place mỗi frame là đủ để FLIP không đo trùng lên transform của chính nó.
function dragLoop() {
    if (!drag) return;
    const rect = tabStrip.getBoundingClientRect();
    if (drag.x > rect.right - EDGE_ZONE) tabStrip.scrollLeft += EDGE_STEP;
    else if (drag.x < rect.left + EDGE_ZONE) tabStrip.scrollLeft -= EDGE_STEP;
    place();
    drag.raf = requestAnimationFrame(dragLoop);
}

function startDrag() {
    const el = drag.el;
    const rect = el.getBoundingClientRect();

    const slot = document.createElement('div');
    slot.className = 'tab-slot';
    slot.style.width = rect.width + 'px';
    el.parentNode.insertBefore(slot, el);
    drag.slot = slot;
    drag.index = [...tabStrip.querySelectorAll('.tab:not(.tab-dragging)')].indexOf(el);

    // position:fixed + left/top = rect là mốc ban đầu; phần dịch tính từ lúc BẤM, không trừ rect lần nữa.
    el.classList.add('tab-dragging');
    el.style.left = rect.left + 'px';
    el.style.top = rect.top + 'px';
    el.style.width = rect.width + 'px';
    el.style.height = rect.height + 'px';
    drag.moved = true;
    tabStrip.classList.add('reordering');
    drag.raf = requestAnimationFrame(dragLoop);
}

function endDrag(commit) {
    if (!drag) return;
    const d = drag;
    drag = null;
    cancelAnimationFrame(d.raf);

    if (!d.moved) return;
    d.el.classList.remove('tab-dragging');
    d.el.removeAttribute('style');
    d.slot.remove();
    tabStrip.classList.remove('reordering');
    dragging.forEach((el) => { el.style.transition = ''; el.style.transform = ''; });
    dragging = [];

    if (!commit) return;
    draggedId = d.id;
    setTimeout(() => { if (draggedId === d.id) draggedId = null; }, 0);
    // Thả chỉ sắp xếp, không mở tab: moveTab emit() nên dải tab được dựng lại đúng thứ tự mới.
    moveTab(d.id, d.index);
}

const SCROLL_STEP = 120;

export function initTabs() {
    subscribe(render);

    // Bấm giữ tab rồi rê ngang: chưa vượt ngưỡng thì vẫn là click như cũ, vượt ngưỡng mới kéo.
    tabStrip.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || drag) return;
        const tab = e.target.closest('.tab');
        if (!tab || e.target.closest('.tab-close')) return;
        drag = { id: Number(tab.dataset.tabId), el: tab, slot: null, moved: false,
                 startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY,
                 index: 0, raf: 0 };
    });

    tabStrip.addEventListener('pointermove', (e) => {
        if (!drag) return;
        drag.x = e.clientX;
        drag.y = e.clientY;
        if (!drag.moved) {
            if (Math.abs(drag.x - drag.startX) < DRAG_THRESHOLD
                && Math.abs(drag.y - drag.startY) < DRAG_THRESHOLD) return;
            startDrag();
            // Chỉ capture SAU khi thành kéo: capture từ pointerdown sẽ nuốt click chuyển tab.
            try {
                tabStrip.setPointerCapture(e.pointerId);
            } catch (err) {
                // Không giữ capture: chỉ mất sự kiện khi rê ra khỏi dải tab.
            }
        }
        drag.el.style.transform = `translate(${drag.x - drag.startX}px, ${drag.y - drag.startY}px)`;
    });

    // Nghe trên window: kéo ra ngoài dải tab mà không giữ được capture vẫn phải biết đã thả.
    window.addEventListener('pointerup', () => endDrag(true));
    window.addEventListener('pointercancel', () => endDrag(false));
    // Mất focus là lúc buộc bỏ kéo: thả chuột ngoài cửa sổ không có pointerup.
    window.addEventListener('blur', () => endDrag(false));
    // Esc giữa chừng: bỏ kéo, trả dải tab về nguyên trạng thì (tab bám chuột có pointer-events:none).
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') endDrag(false); });

    // Lăn dọc cuộn ngang dải tab (overflow-x không tự map); không preventDefault khi không cuộn được.
    tabStrip.addEventListener('wheel', (e) => {
        if (!e.deltaY || tabStrip.scrollWidth <= tabStrip.clientWidth) return;
        e.preventDefault();
        tabStrip.scrollLeft += e.deltaY;
    }, { passive: false });

    // Nút ‹ › là đường duy nhất tới tab bị khuất khi chuột không lăn dọc.
    btnTabScrollLeft?.addEventListener('click', () => { tabStrip.scrollLeft -= SCROLL_STEP; });
    btnTabScrollRight?.addEventListener('click', () => { tabStrip.scrollLeft += SCROLL_STEP; });
    tabStrip.addEventListener('scroll', updateOverflow);

    // Tablist chuẩn dùng roving tabindex: chỉ tab active có tabindex 0, phím mũi tên di chuyển focus.
    // Không có nó thì Tab bị nuốt vào textarea và :focus-visible không chạy.
    tabStrip.addEventListener('keydown', (e) => {
        const el = e.target.closest('.tab');
        const els = [...tabStrip.querySelectorAll('.tab')];
        const current = els.indexOf(el);
        if (current < 0) return;

        // Enter/Space kích hoạt tab đang focus như tablist thật.
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            switchTab(Number(el.dataset.tabId));
            return;
        }
        // Nút × là <span> (lucide chỉ vẽ icon một lần) nên đóng bằng bàn phím dùng Delete.
        if (e.key === 'Delete') {
            e.preventDefault();
            closeTab(Number(el.dataset.tabId));
            return;
        }

        const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 1, ArrowUp: -1 }[e.key];
        let next = null;
        if (step !== undefined) next = els[(current + step + els.length) % els.length];
        else if (e.key === 'Home') next = els[0];
        else if (e.key === 'End') next = els[els.length - 1];
        if (!next) return;
        e.preventDefault();
        switchTab(Number(next.dataset.tabId));
        // render() vừa thay sạch dải tab nên focus lại tab active, nếu không mũi tên vừa bấm là lần cuối dùng được.
        tabStrip.querySelector('.tab.active')?.focus();
    });

    // Danh sách toàn bộ tab: dải tab cuộn ngang không cho tìm nhanh một tab bị khuất giữa 30 tab.
    btnTabScrollRight?.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openAllTabsMenu(btnTabScrollRight);
    });

    // ResizeObserver bắt cả đổi số tab, maximize và kéo cửa sổ nên không cần nghe resize.
    new ResizeObserver(updateOverflow).observe(tabStrip);
}