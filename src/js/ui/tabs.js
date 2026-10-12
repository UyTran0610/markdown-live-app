// js/ui/tabs.js — Thanh tab: dựng lại từ store mỗi khi store đổi, gắn thao tác bấm / middle-click.

import { btnSave, tabStrip } from '../core/dom.js';
import { closeTab, getActiveTab, getTabs, isTabDirty, newTab, subscribe, switchTab } from '../io/documents.js';

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

function render() {
    const active = getActiveTab();
    const ids = new Set(getTabs().map((tab) => tab.id));
    tabStrip.replaceChildren();

    getTabs().forEach((tab) => {
        const el = buildTab(tab, !!active && tab.id === active.id);
        if (!seenIds.has(tab.id)) el.classList.add('tab-enter');
        el.addEventListener('click', (e) => {
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

    seenIds = ids;
}

export function initTabs() {
    subscribe(render);

    // Lăn chuột theo chiều dọc (deltaY) cuộn ngang dải tab: overflow-x: auto không tự
    // map chiều dọc. Không preventDefault khi dải không cuộn được để trang vẫn cuộn bình thường.
    tabStrip.addEventListener('wheel', (e) => {
        if (!e.deltaY || tabStrip.scrollWidth <= tabStrip.clientWidth) return;
        e.preventDefault();
        tabStrip.scrollLeft += e.deltaY;
    }, { passive: false });
}