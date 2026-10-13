// js/ui/tabs.js — Thanh tab: dựng lại từ store mỗi khi store đổi, gắn thao tác bấm / middle-click.

import { btnSave, btnTabScrollLeft, btnTabScrollRight, tabStrip } from '../core/dom.js';
import { closeTab, getActiveTab, getTabs, isTabDirty, moveTab, newTab, subscribe, switchTab } from '../io/documents.js';

// Dùng ký tự "×" chứ không phải icon lucide: lucide.createIcons() chỉ chạy một lần lúc DOMContentLoaded,
// nên icon trong tab tạo sau đó sẽ không bao giờ được vẽ.
function buildTab(tab, isActive) {
    const dirty = isTabDirty(tab);

    const el = document.createElement('div');
    el.className = isActive ? 'tab active' : 'tab';
    el.dataset.tabId = String(tab.id);
    el.title = tab.path || tab.name;
    el.setAttribute('role', 'tab');
    el.setAttribute('aria-selected', String(isActive));

    const name = document.createElement('span');
    name.className = 'tab-name';
    name.textContent = tab.name;

    const dot = document.createElement('span');
    dot.className = 'tab-dot';
    dot.hidden = !dirty;
    dot.title = 'Unsaved changes';

    const close = document.createElement('span');
    close.className = 'tab-close';
    close.title = 'Close tab';
    close.setAttribute('role', 'button');
    close.setAttribute('aria-label', `Close ${tab.name}`);
    close.textContent = '\u00d7';

    el.append(name, dot, close);
    return el;
}

// Ids đã có ở lần render trước: chỉ tab mới mới được class .tab-enter, vì cả dải tab
// bị replaceChildren() mỗi lần store emit — animation trên mọi tab sẽ nháy lại liên tục.
let seenIds = new Set();

// Trạng thái cuộn dải tab, tách khỏi DOM để self-check kiểm được:
// canScroll = dải tab tràn, left/right = còn tab bị khuất ở mép tương ứng.
export function tabScrollState(scrollWidth, clientWidth, scrollLeft) {
    const max = scrollWidth - clientWidth;
    return { canScroll: max > 0, left: scrollLeft > 0, right: scrollLeft < max };
}

// Tab bị khuất thì fade ở mép tương ứng (tabs.css) và bật nút cuộn về hướng đó.
// Nút ở hướng đã hết cần cuộn bị disable thay vì ẩn: cặp nút luôn cùng hiện/ẩn.
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
    const active = getActiveTab();
    const ids = new Set(getTabs().map((tab) => tab.id));
    tabStrip.replaceChildren();

    getTabs().forEach((tab) => {
        const el = buildTab(tab, !!active && tab.id === active.id);
        if (!seenIds.has(tab.id)) el.classList.add('tab-enter');
        el.addEventListener('click', (e) => {
            // Sau khi kéo xong, chuột vẫn sinh một click trên tab vừa kéo: nuốt đúng click đó
            // để kéo không mở nhầm tab. draggedId tự xoá sau một nhịp, nên click thật kế tiếp vẫn ăn.
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
        tabStrip.appendChild(el);
    });

    const add = document.createElement('button');
    add.className = 'tab-add';
    add.type = 'button';
    add.title = 'New tab';
    add.setAttribute('aria-label', 'New tab');
    add.textContent = '+';
    add.addEventListener('click', () => newTab());
    tabStrip.appendChild(add);

    // Lưu chỉ dùng được khi tab đang mở thực sự khác ổ đĩa.
    if (btnSave) btnSave.disabled = !(active && isTabDirty(active));

    // Dải tab vừa được dựng lại từ đầu nên mất vị trí cuộn: kéo tab active vào khung nhìn.
    tabStrip.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    updateOverflow();

    seenIds = ids;
}

// ==== Kéo tab để đổi thứ tự ====
// render() dựng lại dải tab từ đầu mỗi lần store emit, nên trong lúc kéo chỉ sửa DOM trực tiếp
// (store chỉ biết ở lúc thả). Tab đang kéo được nâng lên position:fixed để bám chuột, một
// .tab-slot đứng hộ chỗ trong luồng flex, các tab còn lại trượt sang chỗ mới bằng FLIP.

const DRAG_THRESHOLD = 4;
const EDGE_ZONE = 40;   // px tính từ mép dải tab để bắt đầu tự cuộn
const EDGE_STEP = 12;

let drag = null;        // null khi không kéo
let dragging = [];      // các phần tử đang trượt, chờ frame sau gỡ transform
let draggedId = null;   // tab vừa kéo, để nuốt click sinh ra sau khi thả

// Chỗ sẽ chèn, tính trên danh sách tab đang nằm trong DOM (không kể tab đang kéo): chuột nằm
// bên trái giữa tab nào thì chèn trước tab đó. Tách khỏi DOM để self-check kiểm được.
export function dropIndex(rects, pointerX) {
    for (let i = 0; i < rects.length; i++) {
        if (pointerX < rects[i].left + rects[i].width / 2) return i;
    }
    return rects.length;
}

// FLIP: đo trước, sửa DOM, đặt lệch bằng transform rồi thả lệch ở frame sau để nó trượt tới.
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

// Vòng rAF: giữ tab bám chuột, tự cuộn khi kéo sát mép, tính lại chỗ chèn. Một lần place mỗi
// frame là đủ — và là điều kiện để FLIP không đo trùng lên transform của chính nó.
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

    // position:fixed với left/top = rect (theo viewport) là mốc ban đầu; phần dịch là
    // delta so với lúc BẤM. Trừ rect ở đây sẽ cộng trùng mốc đó: tab lệch đúng bằng
    // rect.left, càng xa mép trái (tab càng sau) lệch càng nhiều.
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
            // Giữ capture để nhận PointerEvent khi rê ra ngoài dải tab; setPointerCapture có
            // thể ném NotFoundError với pointer giả (automation) nên nuốt lỗi, không capture
            // vẫn kéo được. Chỉ capture SAU khi đã thành kéo: capture từ pointerdown sẽ nuốt
            // mất click chuyển tab.
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
    // Thả chuột ngoài cửa sổ thì không có pointerup nào, drag sẽ mắc và chặn click tab sau:
    // mất focus là lúc buộc phải bỏ kéo.
    window.addEventListener('blur', () => endDrag(false));
    // Esc giữa chừng: bỏ kéo, trả dải tab về nguyên trạng thì (tab bám chuột có pointer-events:none).
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') endDrag(false); });

    // Lăn chuột theo chiều dọc (deltaY) cuộn ngang dải tab: overflow-x: auto không tự
    // map chiều dọc. Không preventDefault khi dải không cuộn được để trang vẫn cuộn bình thường.
    tabStrip.addEventListener('wheel', (e) => {
        if (!e.deltaY || tabStrip.scrollWidth <= tabStrip.clientWidth) return;
        e.preventDefault();
        tabStrip.scrollLeft += e.deltaY;
    }, { passive: false });

    // Cuộn bằng nút ‹ ›: chuột không lăn dọc thì đây là đường duy nhất tới tab bị khuất.
    // Không gọi updateOverflow() ở đây: sự kiện scroll của dải tab đã gọi rồi.
    btnTabScrollLeft?.addEventListener('click', () => { tabStrip.scrollLeft -= SCROLL_STEP; });
    btnTabScrollRight?.addEventListener('click', () => { tabStrip.scrollLeft += SCROLL_STEP; });
    tabStrip.addEventListener('scroll', updateOverflow);

    // Bề rộng dải tab đổi theo số tab, theo maximize/restore và theo kéo cửa sổ; ResizeObserver
    // bắt hết ba trường hợp nên không cần nghe resize.
    new ResizeObserver(updateOverflow).observe(tabStrip);
}