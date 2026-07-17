/**
 * dialog.js - Custom Alert / Confirm dialogs
 * Replaces browser-native alert() and confirm() globally
 */

(function () {

    // Inject HTML on DOM ready
    function injectHTML() {
        const html = `
        <div id="custom-dialog-overlay">
            <div id="custom-dialog-box" role="dialog" aria-modal="true">
                <div id="custom-dialog-icon-wrap">
                    <!-- icon injected by JS -->
                </div>
                <h2 id="custom-dialog-title">تحذير</h2>
                <p id="custom-dialog-message"></p>
                <div id="custom-dialog-info-box">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    <span id="custom-dialog-info-text">هذا الإجراء غير قابل للتراجع وقد يؤدي إلى فقدان البيانات.</span>
                </div>
                <div id="custom-dialog-actions">
                    <button id="custom-dialog-cancel">إلغاء</button>
                    <button id="custom-dialog-confirm">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                        متابعة على أي حال
                    </button>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', html);

        document.getElementById('custom-dialog-overlay').addEventListener('click', function (e) {
            if (e.target === this) _cancel();
        });
    }

    let _resolveCallback = null;
    let _isAlert = false;

    function _showDialog({ title, message, infoText, type, isAlert, confirmText, cancelText }) {
        const overlay  = document.getElementById('custom-dialog-overlay');
        const iconWrap = document.getElementById('custom-dialog-icon-wrap');
        const titleEl  = document.getElementById('custom-dialog-title');
        const msgEl    = document.getElementById('custom-dialog-message');
        const infoBox  = document.getElementById('custom-dialog-info-box');
        const infoTxt  = document.getElementById('custom-dialog-info-text');
        const confirmBtn = document.getElementById('custom-dialog-confirm');
        const cancelBtn  = document.getElementById('custom-dialog-cancel');

        _isAlert = isAlert || false;

        // Icon
        const warningIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="${type === 'danger' ? '#ef4444' : '#2563eb'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
        const successIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
        const infoIcon    = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;

        iconWrap.className = type === 'danger' ? 'danger' : '';
        if (type === 'success') {
            iconWrap.innerHTML = successIcon;
            iconWrap.style.background = 'linear-gradient(135deg,#dcfce7,#f0fdf4)';
            iconWrap.style.boxShadow = '0 0 0 12px rgba(34,197,94,0.08)';
        } else if (type === 'danger') {
            iconWrap.innerHTML = warningIcon;
            iconWrap.style.background = 'linear-gradient(135deg,#fee2e2,#fff5f5)';
            iconWrap.style.boxShadow = '0 0 0 12px rgba(239,68,68,0.08)';
        } else {
            iconWrap.innerHTML = warningIcon;
            iconWrap.style.background = 'linear-gradient(135deg,#dbeafe,#eff6ff)';
            iconWrap.style.boxShadow = '0 0 0 12px rgba(59,130,246,0.08)';
        }

        titleEl.textContent  = title  || 'تحذير';
        msgEl.innerHTML      = message || '';
        infoTxt.textContent  = infoText || 'هذا الإجراء غير قابل للتراجع وقد يؤدي إلى فقدان البيانات.';
        infoBox.style.display = (infoText === false) ? 'none' : 'flex';

        // Confirm button
        confirmBtn.innerHTML = confirmText
            ? confirmText
            : `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> متابعة على أي حال`;
        confirmBtn.className = type === 'danger' ? 'danger' : '';

        // For alert mode: hide cancel, change confirm text
        if (_isAlert) {
            cancelBtn.style.display = 'none';
            confirmBtn.style.flex = '1';
            if (!confirmText) {
                confirmBtn.innerHTML = 'حسناً';
            }
        } else {
            cancelBtn.style.display = '';
        }

        overlay.classList.add('active');
    }

    function _confirm() {
        document.getElementById('custom-dialog-overlay').classList.remove('active');
        if (_resolveCallback) { _resolveCallback(true); _resolveCallback = null; }
    }

    function _cancel() {
        document.getElementById('custom-dialog-overlay').classList.remove('active');
        if (_resolveCallback) { _resolveCallback(false); _resolveCallback = null; }
    }

    // Wire buttons after HTML injection
    function wireButtons() {
        document.getElementById('custom-dialog-confirm').addEventListener('click', _confirm);
        document.getElementById('custom-dialog-cancel').addEventListener('click', _cancel);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') _cancel();
            if (e.key === 'Enter') {
                const overlay = document.getElementById('custom-dialog-overlay');
                if (overlay && overlay.classList.contains('active')) _confirm();
            }
        });
    }

    // Public API
    /**
     * showAlert(message, { title, type, infoText, confirmText })
     * type: 'warning' | 'danger' | 'success' | 'info'
     */
    window.showAlert = function (message, opts = {}) {
        return new Promise((resolve) => {
            _resolveCallback = resolve;
            _showDialog({
                title:       opts.title   || (opts.type === 'success' ? 'تمت العملية' : 'تنبيه'),
                message:     message,
                infoText:    opts.infoText !== undefined ? opts.infoText : false,
                type:        opts.type    || 'warning',
                isAlert:     true,
                confirmText: opts.confirmText || null,
            });
        });
    };

    /**
     * showConfirm(message, { title, type, infoText, confirmText })
     * Returns Promise<boolean>
     */
    window.showConfirm = function (message, opts = {}) {
        return new Promise((resolve) => {
            _resolveCallback = resolve;
            _showDialog({
                title:       opts.title       || 'تحذير',
                message:     message,
                infoText:    opts.infoText !== undefined ? opts.infoText : 'هذا الإجراء غير قابل للتراجع وقد يؤدي إلى فقدان البيانات.',
                type:        opts.type        || 'danger',
                isAlert:     false,
                confirmText: opts.confirmText || null,
            });
        });
    };

    // Override native window.alert and window.confirm globally
    window.alert = function (msg) {
        return window.showAlert(String(msg || ''));
    };

    window.confirm = function (msg) {
        // synchronous confirm() replacement returns a Promise
        // Callers that use: if(confirm(...)) must be migrated to async/await
        // We'll return the Promise; callers in app.js should already use await
        return window.showConfirm(String(msg || ''));
    };

    // Init
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { injectHTML(); wireButtons(); });
    } else {
        injectHTML(); wireButtons();
    }

})();
