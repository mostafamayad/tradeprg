(function () {
    let container = null;

    function ensureContainer() {
        if (container) return;
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;flex-direction:column;gap:10px;pointer-events:none;';
        document.body.appendChild(container);
    }

    const icons = {
        success: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>',
        error:   '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
        warning: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        info:    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
    };

    const colors = {
        success: { bg: '#f0fdf4', border: '#16a34a', text: '#166534' },
        error:   { bg: '#fef2f2', border: '#dc2626', text: '#991b1b' },
        warning: { bg: '#fffbeb', border: '#d97706', text: '#92400e' },
        info:    { bg: '#eff6ff', border: '#2563eb', text: '#1e40af' }
    };

    window.showToast = function (message, type, duration) {
        type = type || 'info';
        duration = duration || 4000;
        ensureContainer();

        const c = colors[type] || colors.info;
        const toast = document.createElement('div');
        toast.style.cssText = `display:flex;align-items:center;gap:10px;padding:14px 20px;border-radius:12px;background:${c.bg};border-right:4px solid ${c.border};box-shadow:0 8px 24px rgba(0,0,0,0.12),0 2px 4px rgba(0,0,0,0.05);pointer-events:auto;max-width:480px;font-size:14px;color:${c.text};direction:rtl;text-align:right;transition:all 0.3s ease;opacity:0;transform:translateY(-16px) scale(0.96);`;
        toast.innerHTML = `<span style="flex-shrink:0;display:flex;align-items:center;">${icons[type] || icons.info}</span><span style="flex:1;line-height:1.5;">${message}</span><button onclick="this.parentElement.remove()" style="flex-shrink:0;background:none;border:none;cursor:pointer;padding:2px;color:${c.text};opacity:0.6;display:flex;" title="إغلاق"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
        container.appendChild(toast);

        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0) scale(1)';
        });

        const timer = setTimeout(() => dismiss(toast), duration);

        toast.addEventListener('mouseenter', () => clearTimeout(timer));
        toast.addEventListener('mouseleave', () => setTimeout(() => dismiss(toast), 1500));

        function dismiss(el) {
            el.style.opacity = '0';
            el.style.transform = 'translateY(-8px) scale(0.96)';
            setTimeout(() => el.remove(), 300);
        }
    };

    window.showToast.success = (m, d) => window.showToast(m, 'success', d);
    window.showToast.error   = (m, d) => window.showToast(m, 'error', d);
    window.showToast.warning = (m, d) => window.showToast(m, 'warning', d);
    window.showToast.info    = (m, d) => window.showToast(m, 'info', d);
})();
