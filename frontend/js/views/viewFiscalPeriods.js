(function () {
    'use strict';

    var r2 = function (n) { return Math.round(Number(n || 0) * 100) / 100; };
    var fmt = function (n) {
        return r2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };
    var esc = function (v) { return String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); };

    function todayStr() {
        var d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function apiFetch(endpoint, opts) {
        var token = localStorage.getItem('auth_token');
        var opt = opts || {};
        if (!opt.headers) opt.headers = {};
        if (token) opt.headers['Authorization'] = 'Bearer ' + token;
        if (opt.body && typeof opt.body === 'object' && !opt.headers['Content-Type']) {
            opt.headers['Content-Type'] = 'application/json';
            opt.body = JSON.stringify(opt.body);
        }
        return fetch('/api' + endpoint, opt).then(function (r) {
            if (r.status === 401) {
                localStorage.removeItem('auth_token');
                window.location.hash = '#login';
                throw new Error('انتهت الجلسة، الرجاء تسجيل الدخول مجددًا');
            }
            return r.json();
        });
    }

    function injectStyles() {
        if (document.getElementById('fp-styles')) return;
        var s = document.createElement('style');
        s.id = 'fp-styles';
        s.textContent = '\
            .fp-toolbar { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; align-items: flex-end; }\
            .fp-toolbar .form-group { margin-bottom: 0; }\
            .fp-table-wrap { overflow-x: auto; }\
            .fp-table-wrap .data-table th, .fp-table-wrap .data-table td { white-space: nowrap; font-size: 0.85rem; }\
            .fp-table-wrap .data-table td { text-align: center; }\
            .fp-table-wrap .data-table td:nth-child(2) { text-align: right; }\
            .fp-active-badge { display: inline-block; padding: 3px 12px; border-radius: 12px; font-size: 0.8rem; font-weight: 600; }\
            .fp-active-badge.open { background: #d1fae5; color: #065f46; }\
            .fp-active-badge.closed { background: #fee2e2; color: #991b1b; }\
            .fp-form-card { min-height: auto !important; }\
            .fp-form-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end; }\
            .fp-form-row .form-group { margin-bottom: 0; flex: 1; min-width: 150px; }\
            .fp-current { display: inline-flex; align-items: center; gap: 8px; padding: 4px 16px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; font-size: 0.9rem; }\
        ';
        document.head.appendChild(s);
    }

    function renderTable(root, periods) {
        var html = '<div class="fp-table-wrap"><table class="data-table" style="width:100%"><thead><tr>\
            <th>#</th><th>الاسم</th><th>تاريخ البداية</th><th>تاريخ النهاية</th>\
            <th>الحالة</th><th>افتتح بواسطة</th><th>تاريخ الافتتاح</th><th>أغلق بواسطة</th><th>تاريخ الإغلاق</th><th>ملاحظات</th><th>إجراءات</th>\
        </tr></thead><tbody>';

        if (!periods || periods.length === 0) {
            html += '<tr><td colspan="11" style="text-align:center;padding:40px">لا توجد فترات مالية بعد</td></tr>';
        } else {
            periods.forEach(function (p) {
                var isOpen = p.status === 'open';
                var badgeCls = isOpen ? 'open' : 'closed';
                var badgeTxt = isOpen ? 'مفتوحة' : 'مغلقة';
                html += '<tr>' +
                    '<td>' + p.id + '</td>' +
                    '<td>' + esc(p.name) + '</td>' +
                    '<td>' + (p.start_date ? p.start_date.split('T')[0] : '') + '</td>' +
                    '<td>' + (p.end_date ? p.end_date.split('T')[0] : '') + '</td>' +
                    '<td><span class="fp-active-badge ' + badgeCls + '">' + badgeTxt + '</span></td>' +
                    '<td>' + esc(p.opened_by_name || '—') + '</td>' +
                    '<td>' + (p.opened_at ? new Date(p.opened_at).toLocaleDateString('ar-EG') : '—') + '</td>' +
                    '<td>' + esc(p.closed_by_name || '—') + '</td>' +
                    '<td>' + (p.closed_at ? new Date(p.closed_at).toLocaleDateString('ar-EG') : '—') + '</td>' +
                    '<td>' + esc(p.notes || '') + '</td>' +
                    '<td class="actions-cell">' +
                        (isOpen
                            ? '<button class="icon-btn btn-danger" onclick="window._fpClose(' + p.id + ')" title="إغلاق الفترة"><i class="fa-solid fa-lock"></i></button>'
                            : '<button class="icon-btn btn-success" onclick="window._fpReopen(' + p.id + ')" title="إعادة فتح الفترة"><i class="fa-solid fa-lock-open"></i></button>'
                        ) +
                    '</td></tr>';
            });
        }

        html += '</tbody></table></div>';
        root.innerHTML = html;
    }

    function loadFiscalPeriods() {
        var root = document.getElementById('fiscal-periods-root');
        if (!root) return;
        if (root.dataset.bound) return;
        root.dataset.bound = '1';

        injectStyles();

        // Create form card
        var formHtml = '<div class="page-section"><div class="page-card fp-form-card">' +
            '<div class="page-card-header"><div class="page-card-title"><i class="fa-solid fa-calendar"></i> إدارة الفترات المالية</div></div>' +
            '<div class="fp-form-row">' +
                '<div class="form-group"><label>اسم الفترة</label><input type="text" id="fp-name" class="form-control" placeholder="مثال: 2026-01"></div>' +
                '<div class="form-group"><label>تاريخ البداية</label><input type="date" id="fp-start" class="form-control"></div>' +
                '<div class="form-group"><label>تاريخ النهاية</label><input type="date" id="fp-end" class="form-control"></div>' +
                '<div class="form-group" style="display:flex;align-items:flex-end">' +
                    '<button class="btn btn-primary" onclick="window._fpCreate()"><i class="fa-solid fa-plus"></i> إنشاء فترة</button>' +
                '</div>' +
            '</div>' +
        '</div></div>';

        var tableHtml = '<div class="page-section"><div class="page-card">' +
            '<div class="page-card-header"><div class="page-card-title"><i class="fa-solid fa-list"></i> قائمة الفترات المالية</div></div>' +
            '<div id="fp-table-root"></div>' +
        '</div></div>';

        root.innerHTML = formHtml + tableHtml;

        // Attach global handlers
        window._fpCreate = function () {
            var name = document.getElementById('fp-name').value.trim();
            var start = document.getElementById('fp-start').value;
            var end = document.getElementById('fp-end').value;
            if (!name) { window.showAlert('يرجى إدخال اسم الفترة', { title: 'تنبيه', type: 'warning' }); return; }
            if (!start || !end) { window.showAlert('يرجى تحديد تاريخ البداية والنهاية', { title: 'تنبيه', type: 'warning' }); return; }
            if (new Date(end) < new Date(start)) { window.showAlert('تاريخ النهاية يجب أن يكون بعد تاريخ البداية', { title: 'تنبيه', type: 'warning' }); return; }

            apiFetch('/accounting/fiscal-periods', { method: 'POST', body: { name: name, start_date: start, end_date: end } })
                .then(function (res) {
                    if (res.success) {
                        window.showAlert('تم إنشاء الفترة بنجاح', { title: 'نجاح', type: 'success' });
                        document.getElementById('fp-name').value = '';
                        document.getElementById('fp-start').value = '';
                        document.getElementById('fp-end').value = '';
                        refreshTable();
                    } else {
                        window.showAlert(res.message || 'حدث خطأ', { title: 'خطأ', type: 'danger' });
                    }
                })
                .catch(function (e) { window.showAlert(e.message, { title: 'خطأ', type: 'danger' }); });
        };

        window._fpClose = function (id) {
            window.showConfirm('هل أنت متأكد من إغلاق هذه الفترة المالية؟', function (ok) {
                if (!ok) return;
                apiFetch('/accounting/fiscal-periods/' + id + '/close', { method: 'POST' })
                    .then(function (res) {
                        if (res.success) {
                            window.showAlert('تم إغلاق الفترة بنجاح', { title: 'نجاح', type: 'success' });
                            refreshTable();
                        } else {
                            window.showAlert(res.message || 'حدث خطأ', { title: 'خطأ', type: 'danger' });
                        }
                    })
                    .catch(function (e) { window.showAlert(e.message, { title: 'خطأ', type: 'danger' }); });
            });
        };

        window._fpReopen = function (id) {
            window.showConfirm('هل أنت متأكد من إعادة فتح هذه الفترة المالية؟', function (ok) {
                if (!ok) return;
                apiFetch('/accounting/fiscal-periods/' + id + '/reopen', { method: 'POST' })
                    .then(function (res) {
                        if (res.success) {
                            window.showAlert('تم إعادة فتح الفترة بنجاح', { title: 'نجاح', type: 'success' });
                            refreshTable();
                        } else {
                            window.showAlert(res.message || 'حدث خطأ', { title: 'خطأ', type: 'danger' });
                        }
                    })
                    .catch(function (e) { window.showAlert(e.message, { title: 'خطأ', type: 'danger' }); });
            });
        };

        function refreshTable() {
            var tableRoot = document.getElementById('fp-table-root');
            if (!tableRoot) return;
            tableRoot.innerHTML = '<div style="text-align:center;padding:40px">جاري التحميل...</div>';
            apiFetch('/accounting/fiscal-periods')
                .then(function (res) {
                    if (res.success) {
                        renderTable(tableRoot, res.data);
                    } else {
                        tableRoot.innerHTML = '<div style="text-align:center;padding:40px;color:red">' + esc(res.message) + '</div>';
                    }
                })
                .catch(function (e) {
                    tableRoot.innerHTML = '<div style="text-align:center;padding:40px;color:red">' + esc(e.message) + '</div>';
                });
        }

        refreshTable();
    }

    window.loadFiscalPeriods = loadFiscalPeriods;
})();
