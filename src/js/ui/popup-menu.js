// js/ui/popup-menu.js — Menu bật lên dùng chung cho tab, Recent và danh sách tab.
// Một #popup-menu duy nhất, tái tạo nội dung mỗi lần mở: không có trạng thái bền để giữ.

const MENU_MARGIN = 4;

let popup = null;

function ensurePopup() {
    if (popup) return popup;
    popup = document.createElement('div');
    popup.id = 'popup-menu';
    popup.className = 'popup-menu hidden';
    popup.setAttribute('role', 'menu');
    document.body.appendChild(popup);
    return popup;
}

function closePopup() {
    if (!popup) return;
    popup.classList.add('hidden');
    popup.replaceChildren();
}

// items: [{ label, onClick, disabled }]; { separator: true } là gạch ngang. Tự đóng sau onClick.
export function openPopupMenu(items, x, y) {
    const el = ensurePopup();
    closePopup();

    const buttons = [];
    el.replaceChildren(...items.filter(Boolean).map((item) => {
        if (item.separator) {
            const hr = document.createElement('div');
            hr.className = 'popup-sep';
            hr.setAttribute('role', 'separator');
            return hr;
        }
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'popup-item';
        btn.setAttribute('role', 'menuitem');
        btn.textContent = item.label;
        btn.disabled = !!item.disabled;
        btn.addEventListener('click', () => {
            closePopup();
            item.onClick();
        });
        if (!item.disabled) buttons.push(btn);
        return btn;
    }));

    el.classList.remove('hidden');
    // Đặt vị trí rồi mới đo; tràn mép thì bật lên trên/sang trái, giới hạn theo kích thước menu.
    const rect = el.getBoundingClientRect();
    el.style.left = `${Math.max(MENU_MARGIN, Math.min(x, window.innerWidth - rect.width - MENU_MARGIN))}px`;
    el.style.top = `${Math.max(MENU_MARGIN, Math.min(y, window.innerHeight - rect.height - MENU_MARGIN))}px`;

    // Menu mở bằng phím thì focus vào mục đầu, giống menu hệ điều hành.
    if (buttons.length) buttons[0].focus();
    return el;
}

export function initPopupMenu() {
    // Đóng khi bấm ra ngoài, bấm phím tắt khác, hoặc cuộn (menu neo theo con trỏ).
    document.addEventListener('pointerdown', (e) => {
        if (popup && !popup.classList.contains('hidden') && !popup.contains(e.target)) closePopup();
    }, true);
    document.addEventListener('keydown', (e) => {
        if (popup && !popup.classList.contains('hidden') && e.key === 'Escape') {
            e.stopPropagation();
            closePopup();
        }
    });
    window.addEventListener('blur', closePopup);
}