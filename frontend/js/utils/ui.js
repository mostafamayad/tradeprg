(function () {

    window.showEmptyState = function (container, opts) {
        if (typeof container === 'string') container = document.querySelector(container);
        if (!container) return;
        const icon = opts.icon || 'fa-solid fa-inbox';
        const title = opts.title || '';
        const message = opts.message || 'لا توجد بيانات';
        const btnText = opts.btnText || null;
        const btnAction = opts.btnAction || null;
        const html = `<div class="empty-state">
            <div class="empty-state-icon"><i class="${icon}"></i></div>
            ${title ? `<h3>${escHtml(title)}</h3>` : ''}
            <p>${escHtml(message)}</p>
            ${btnText ? `<button class="btn btn-primary btn-sm">${escHtml(btnText)}</button>` : ''}
        </div>`;
        container.innerHTML = html;
        if (btnText && btnAction) {
            container.querySelector('.btn').addEventListener('click', btnAction);
        }
    };

    window.showTableEmpty = function (tbody, colspan, msg) {
        tbody.innerHTML = `<tr><td colspan="${colspan}" class="text-center" style="padding:40px;color:var(--text-muted)">${escHtml(msg || 'لا توجد بيانات')}</td></tr>`;
    };

    window.showTableLoading = function (tbody, colspan, msg) {
        tbody.innerHTML = `<tr><td colspan="${colspan}" class="text-center" style="padding:40px;color:var(--text-muted)"><i class="fa-solid fa-spinner fa-spin" style="font-size:1.2rem;margin-left:8px"></i>${escHtml(msg || 'جاري التحميل...')}</td></tr>`;
    };

    window.showLoading = function (container, opts) {
        if (typeof container === 'string') container = document.querySelector(container);
        if (!container) return;
        const text = opts && opts.text ? opts.text : 'جاري التحميل...';
        container.innerHTML = `<div class="empty-state" style="min-height:200px"><div class="spinner" style="width:36px;height:36px;border:3px solid var(--border-color);border-top-color:var(--primary);border-radius:50%;animation:spin 0.8s linear infinite;margin-bottom:16px"></div><p style="color:var(--text-muted)">${escHtml(text)}</p></div>`;
    };

    window.showError = function (container, message, btnText, btnAction) {
        if (typeof container === 'string') container = document.querySelector(container);
        if (!container) return;
        const html = `<div class="empty-state">
            <div class="empty-state-icon" style="background:rgba(220,38,38,0.08);color:#dc2626"><i class="fa-solid fa-exclamation-triangle"></i></div>
            <h3 style="color:#dc2626">خطأ</h3>
            <p>${escHtml(message || 'حدث خطأ غير متوقع')}</p>
            ${btnText ? `<button class="btn btn-outline btn-sm">${escHtml(btnText)}</button>` : ''}
        </div>`;
        container.innerHTML = html;
        if (btnText && btnAction) container.querySelector('.btn').addEventListener('click', btnAction);
    };

    function escHtml(s) {
        if (s == null) return '';
        const d = document.createElement('div');
        d.textContent = String(s);
        return d.innerHTML;
    }

    if (!document.getElementById('spinner-style')) {
        const style = document.createElement('style');
        style.id = 'spinner-style';
        style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
        document.head.appendChild(style);
    }
})();
