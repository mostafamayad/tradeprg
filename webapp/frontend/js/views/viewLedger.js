(function () {
    'use strict';

    var allAccounts = [];
    var currentData = null;
    var currentAccountId = '';

    var r2 = function (n) { return Math.round(Number(n || 0) * 100) / 100; };
    var fmt = function (n) { return r2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var esc = function (v) { return String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); };

    function apiFetch(endpoint, params) {
        var token = localStorage.getItem('auth_token');
        var q = '';
        if (params) {
            var parts = [];
            for (var k in params) {
                if (params[k] !== '' && params[k] !== null && params[k] !== undefined) {
                    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
                }
            }
            if (parts.length) q = '?' + parts.join('&');
        }
        var opt = { method: 'GET', headers: {} };
        if (token) opt.headers['Authorization'] = 'Bearer ' + token;
        return fetch('/api' + endpoint + q, opt).then(function (r) {
            if (r.status === 401) {
                localStorage.removeItem('auth_token');
                window.location.hash = '#login';
                throw new Error('انتهت الجلسة');
            }
            if (r.status === 404) return r.json().then(function (d) { throw new Error(d.message || 'غير موجود'); });
            return r.json();
        });
    }

    function injectStyles() {
        if (document.getElementById('ledger-styles')) return;
        var s = document.createElement('style');
        s.id = 'ledger-styles';
        s.textContent = '\
            .ledger-filter-bar { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; align-items: flex-end; }\
            .ledger-filter-bar .form-group { margin-bottom: 0; }\
            .ledger-filter-bar input, .ledger-filter-bar select { padding: 6px 10px; font-size: 0.9rem; }\
            .ledger-action-btn { padding: 4px 10px; font-size: 0.85rem; }\
            .ledger-table-wrap { overflow-x: auto; }\
            .ledger-table-wrap .data-table th, .ledger-table-wrap .data-table td { white-space: nowrap; font-size: 0.85rem; }\
            .ledger-table-wrap .data-table td { text-align: center; }\
            .ledger-table-wrap .data-table td:nth-child(4) { text-align: right; max-width: 250px; overflow: hidden; text-overflow: ellipsis; }\
            .ledger-opening-row td { background: var(--bg-muted, #f8f9fa); font-weight: 600; }\
            .ledger-total-row td { font-weight: 700; border-top: 2px solid var(--border-color); }\
            .ledger-running-dr { color: var(--primary-color, #7c3aed); }\
            .ledger-running-cr { color: var(--danger-color, #dc2626); }\
            .ledger-account-info { display: flex; gap: 24px; flex-wrap: wrap; padding: 12px 16px; background: var(--bg-muted, #f8f9fa); border-radius: 8px; margin-bottom: 16px; font-size: 0.9rem; }\
            .ledger-account-info span { display: flex; align-items: center; gap: 6px; }\
            .ledger-pagination { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 12px; }\
        ';
        document.head.appendChild(s);
    }

    function renderPage() {
        var root = document.getElementById('ledger-root');
        if (!root) return;
        var today = new Date().toISOString().split('T')[0];

        root.innerHTML = '\
            <div class="page-card" style="min-height:200px">\
                <div class="page-card-header">\
                    <div class="page-card-title"><i class="fa-solid fa-receipt"></i> كشف حساب أستاذ</div>\
                </div>\
                <div class="ledger-filter-bar">\
                    <div class="form-group" style="min-width:200px">\
                        <label>الحساب</label>\
                        <select id="ledger-account"><option value="">--- جميع الحسابات (الأستاذ العام) ---</option></select>\
                    </div>\
                    <div class="form-group"><label>من تاريخ</label><input type="date" id="ledger-from"></div>\
                    <div class="form-group"><label>إلى تاريخ</label><input type="date" id="ledger-to" value="' + today + '"></div>\
                    <div class="form-group" style="display:flex;align-items:center;gap:6px;padding-top:20px">\
                        <input type="checkbox" id="ledger-include-opening" checked>\
                        <label for="ledger-include-opening" style="margin:0;cursor:pointer">إظهار رصيد أول المدة</label>\
                    </div>\
                    <div class="form-group"><button class="btn btn-primary ledger-action-btn" id="ledger-refresh"><i class="fa-solid fa-rotate"></i> عرض</button></div>\
                    <div class="form-group"><button class="btn btn-outline ledger-action-btn" id="ledger-print"><i class="fa-solid fa-print"></i> طباعة</button></div>\
                    <div class="form-group"><button class="btn btn-outline ledger-action-btn" id="ledger-excel"><i class="fa-solid fa-file-excel"></i> Excel</button></div>\
                </div>\
                <div id="ledger-account-info"></div>\
                <div class="ledger-table-wrap">\
                    <table class="data-table" id="ledger-table">\
                        <thead><tr>\
                            <th>التاريخ</th><th>رقم القيد</th><th>المرجع</th><th>البيان</th>\
                            <th>مدين</th><th>دائن</th><th>الرصيد الجاري</th>\
                        </tr></thead>\
                        <tbody id="ledger-body"><tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted)">اختر حساب أو اترك الكل ثم اضغط "عرض"</td></tr></tbody>\
                    </table>\
                </div>\
                <div id="ledger-totals" style="margin-top:12px"></div>\
                <div class="ledger-pagination" id="ledger-pagination"></div>\
            </div>\
        ';

        // Populate account select
        var sel = document.getElementById('ledger-account');
        for (var i = 0; i < allAccounts.length; i++) {
            var a = allAccounts[i];
            var opt = document.createElement('option');
            opt.value = a.id;
            opt.textContent = a.account_code + ' - ' + a.account_name;
            sel.appendChild(opt);
        }
        if (currentAccountId) sel.value = currentAccountId;

        bindEvents();
    }

    function bindEvents() {
        document.getElementById('ledger-refresh').onclick = loadData;
        document.getElementById('ledger-print').onclick = printReport;
        document.getElementById('ledger-excel').onclick = exportExcel;
        document.getElementById('ledger-to').addEventListener('keydown', function (e) { if (e.key === 'Enter') loadData(); });
        document.getElementById('ledger-from').addEventListener('keydown', function (e) { if (e.key === 'Enter') loadData(); });
        document.getElementById('ledger-account').addEventListener('change', function () { loadData(); });

        document.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-lg-page]');
            if (!btn) return;
            e.preventDefault();
            var p = parseInt(btn.dataset.lgPage);
            if (p >= 1) { goToPage(p); }
        });
    }

    var currentPage = 1;
    var totalPages = 1;

    function goToPage(p) {
        currentPage = p;
        loadData();
    }

    function loadData() {
        var tbody = document.getElementById('ledger-body');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted)"><i class="fa-solid fa-spinner fa-spin"></i> جاري التحميل...</td></tr>';

        currentAccountId = document.getElementById('ledger-account').value;

        var params = {
            from: document.getElementById('ledger-from').value,
            to: document.getElementById('ledger-to').value,
            includeOpening: document.getElementById('ledger-include-opening').checked ? 'true' : 'false',
            page: currentPage,
            pageSize: 50
        };
        if (currentAccountId) params.accountId = currentAccountId;

        apiFetch('/accounting/general-ledger', params).then(function (res) {
            if (!res.success) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--danger-color)">' + esc(res.message || 'خطأ') + '</td></tr>';
                return;
            }
            currentData = res;

            if (currentAccountId) {
                renderSingleAccount(res);
            } else {
                renderAllAccounts(res);
            }
        }).catch(function (err) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--danger-color)">' + esc(err.message) + '</td></tr>';
        });
    }

    function renderSingleAccount(res) {
        renderAccountInfo(res.account);
        renderTable(res.data, res.openingBalance);
        renderTotals(res.totals, res.closingBalance);
        renderPagination(res.page, res.totalPages, res.total);
    }

    function renderAllAccounts(res) {
        var info = document.getElementById('ledger-account-info');
        info.innerHTML = '<div style="padding:8px 0;color:var(--text-muted)">الأستاذ العام — جميع الحسابات</div>';

        // Flatten all account data into single table with account separator
        var tbody = document.getElementById('ledger-body');
        var html = '';
        var allTotals = { debit: 0, credit: 0 };

        for (var ai = 0; ai < (res.accounts || []).length; ai++) {
            var acc = res.accounts[ai];
            if (ai > 0) {
                html += '<tr style="background:var(--bg-muted,#f0f0f0)"><td colspan="7" style="padding:2px 8px;font-size:0.8rem;font-weight:600">' + esc(acc.account.code) + ' - ' + esc(acc.account.name) + '</td></tr>';
            }
            var rows = acc.data || [];
            for (var ri = 0; ri < rows.length; ri++) {
                var r = rows[ri];
                var isOpen = r.is_opening;
                html += '<tr class="' + (isOpen ? 'ledger-opening-row' : '') + '">\
                    <td>' + esc(r.entry_date || '') + '</td>\
                    <td>' + (r.journal_id ? esc(r.ref_number || '#' + r.journal_id) : '') + '</td>\
                    <td>' + refTypeLabel(r.reference_type) + (r.ref_number ? ' ' + esc(r.ref_number) : '') + '</td>\
                    <td>' + esc(r.description || '') + '</td>\
                    <td>' + (r.debit ? fmt(r.debit) : '') + '</td>\
                    <td>' + (r.credit ? fmt(r.credit) : '') + '</td>\
                    <td class="' + (r.running_balance_type === 'Dr' ? 'ledger-running-dr' : 'ledger-running-cr') + '">' + fmt(r.running_balance) + ' ' + (r.running_balance_type === 'Dr' ? 'د' : 'ائ') + '</td>\
                </tr>';
            }
            allTotals.debit = r2(allTotals.debit + acc.totals.debit);
            allTotals.credit = r2(allTotals.credit + acc.totals.credit);
        }

        if (!html) {
            html = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted)">لا توجد نتائج</td></tr>';
        }
        tbody.innerHTML = html;
        renderTotals(allTotals, allTotals);
        renderPagination(res.page, res.totalPages, res.total);
    }

    function renderAccountInfo(account) {
        var el = document.getElementById('ledger-account-info');
        if (!account) { el.innerHTML = ''; return; }
        var typeMap = { asset: 'أصول', liability: 'خصوم', equity: 'حقوق ملكية', income: 'إيرادات', expense: 'مصروفات' };
        el.innerHTML = '\
            <span><strong>' + esc(account.code) + '</strong> - ' + esc(account.name) + '</span>\
            <span>النوع: ' + (typeMap[account.type] || account.type) + '</span>\
        ';
    }

    function renderTable(lines, opening) {
        var tbody = document.getElementById('ledger-body');
        if (!lines || lines.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted)">لا توجد حركات في الفترة المحددة</td></tr>';
            return;
        }
        var html = '';
        for (var i = 0; i < lines.length; i++) {
            var r = lines[i];
            var isOpen = r.is_opening;
            html += '<tr class="' + (isOpen ? 'ledger-opening-row' : '') + '">\
                <td>' + esc(r.entry_date || '') + '</td>\
                <td>' + (r.journal_id ? esc(r.ref_number || '#' + r.journal_id) : '') + '</td>\
                <td>' + (r.reference_type ? refTypeLabel(r.reference_type) + (r.ref_number ? ' ' + esc(r.ref_number) : '') : '') + '</td>\
                <td>' + esc(r.description || '') + '</td>\
                <td>' + (r.debit ? fmt(r.debit) : '') + '</td>\
                <td>' + (r.credit ? fmt(r.credit) : '') + '</td>\
                <td class="' + (r.running_balance_type === 'Dr' ? 'ledger-running-dr' : 'ledger-running-cr') + '">' + fmt(r.running_balance) + ' ' + (r.running_balance_type === 'Dr' ? 'د' : 'ائ') + '</td>\
            </tr>';
        }
        tbody.innerHTML = html;
    }

    function renderTotals(totals, closing) {
        var el = document.getElementById('ledger-totals');
        if (!totals) { el.innerHTML = ''; return; }
        el.innerHTML = '\
            <div style="display:flex;gap:24px;flex-wrap:wrap;padding:12px 0;border-top:2px solid var(--border-color);font-weight:700">\
                <span>إجمالي المدين: <span style="color:var(--primary-color)">' + fmt(totals.debit) + '</span></span>\
                <span>إجمالي الدائن: <span style="color:var(--primary-color)">' + fmt(totals.credit) + '</span></span>\
                <span>رصيد آخر المدة: <span class="' + (closing.debit > 0 ? 'ledger-running-dr' : 'ledger-running-cr') + '">' + fmt(closing.debit || closing.credit) + ' ' + (closing.debit > 0 ? 'د' : 'ائ') + '</span></span>\
            </div>\
        ';
    }

    function renderPagination(page, totalPages, total) {
        var el = document.getElementById('ledger-pagination');
        if (!el) return;
        if (totalPages <= 1 && (!currentAccountId || !page)) { el.innerHTML = ''; return; }
        currentPage = page || 1;
        var h = '';
        if (total !== undefined) h += '<span style="font-size:0.85rem">' + total + ' حركة</span>';
        h += '<button class="btn btn-sm btn-outline" data-lg-page="' + (page - 1) + '"' + (page <= 1 ? ' disabled' : '') + '>‹ السابق</button>';
        h += '<span style="font-size:0.85rem">الصفحة ' + page + ' من ' + totalPages + '</span>';
        h += '<button class="btn btn-sm btn-outline" data-lg-page="' + (page + 1) + '"' + (page >= totalPages ? ' disabled' : '') + '>التالي ›</button>';
        el.innerHTML = h;
    }

    function refTypeLabel(v) {
        var map = {
            'manual_je': 'قيد يدوي', 'sales_invoice': 'مبيعات', 'sales_return': 'مرتجع مبيعات',
            'purchase_invoice': 'مشتريات', 'purchase_return': 'مرتجع مشتريات',
            'treasury': 'خزينة', 'ar_payment': 'تحصيل', 'ap_payment': 'دفع',
            'opening_balance': 'افتتاحي', 'year_close': 'إقفال سنوي'
        };
        return map[v] || v || '';
    }

    function printReport() {
        var tbody = document.getElementById('ledger-body');
        if (!tbody || !tbody.querySelector('tr:not(.ledger-opening-row):not(.ledger-total-row)')) {
            if (!tbody.querySelector('td[colspan]')) { alert('لا توجد بيانات للطباعة'); return; }
        }

        var tableRows = '';
        var rows = tbody.querySelectorAll('tr');
        for (var i = 0; i < rows.length; i++) {
            var tr = rows[i];
            var tds = tr.querySelectorAll('td');
            if (tds.length === 0) continue;
            if (tds.length === 1 && tds[0].hasAttribute('colspan')) continue;
            var bg = tr.classList.contains('ledger-opening-row') ? ' style="background:#f0f0f0;font-weight:600"' : '';
            tableRows += '<tr' + bg + '>';
            for (var j = 0; j < tds.length; j++) {
                tableRows += '<td style="padding:4px 8px;border:1px solid #ccc;font-size:11px">' + tds[j].innerHTML + '</td>';
            }
            tableRows += '</tr>';
        }

        var from = document.getElementById('ledger-from').value || 'البداية';
        var to = document.getElementById('ledger-to').value || 'النهاية';
        var accName = currentAccountId ? document.getElementById('ledger-account').options[document.getElementById('ledger-account').selectedIndex].text : 'الأستاذ العام';

        var w = window.open('', '_blank', 'width=1000,height=700');
        w.document.write('\
            <!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><title>كشف حساب - ' + esc(accName) + '</title>\
            <style>\
                body { font-family: "Segoe UI", Arial, sans-serif; margin: 25px; color: #222; font-size: 12px; }\
                h2 { text-align: center; margin-bottom: 4px; }\
                .sub { text-align: center; margin-bottom: 16px; color: #555; }\
                table { width: 100%; border-collapse: collapse; }\
                th { background: #f0f0f0; padding: 6px 8px; border: 1px solid #ccc; text-align: center; font-size: 11px; }\
                td { padding: 4px 8px; border: 1px solid #ccc; }\
                .total-row td { font-weight: bold; border-top: 2px solid #000; }\
                @media print { body { margin: 15px; } }\
            </style></head><body>\
            <h2>' + esc(accName) + '</h2>\
            <div class="sub">من ' + esc(from) + ' إلى ' + esc(to) + '</div>\
            <table><thead><tr><th>التاريخ</th><th>رقم القيد</th><th>المرجع</th><th>البيان</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead><tbody>' + tableRows + '</tbody></table>\
            <script>window.onload = function () { window.print(); };<' + '/script>\
            </body></html>\
        ');
        w.document.close();
    }

    function exportExcel() {
        var tbody = document.getElementById('ledger-body');
        if (!tbody) { alert('لا توجد بيانات للتصدير'); return; }

        var rows = [];
        var from = document.getElementById('ledger-from').value || 'البداية';
        var to = document.getElementById('ledger-to').value || 'النهاية';
        var accName = currentAccountId ? document.getElementById('ledger-account').options[document.getElementById('ledger-account').selectedIndex].text : 'الأستاذ العام';

        rows.push([accName, '', '', '', '', '', '']);
        rows.push(['من ' + from + ' إلى ' + to, '', '', '', '', '', '']);
        rows.push(['', '', '', '', '', '', '']);
        rows.push(['التاريخ', 'رقم القيد', 'المرجع', 'البيان', 'مدين', 'دائن', 'الرصيد']);

        var allRows = tbody.querySelectorAll('tr');
        for (var i = 0; i < allRows.length; i++) {
            var tr = allRows[i];
            var tds = tr.querySelectorAll('td');
            if (tds.length === 0 || (tds.length === 1 && tds[0].hasAttribute('colspan'))) continue;
            var row = [];
            for (var j = 0; j < tds.length; j++) {
                row.push(tds[j].textContent.trim());
            }
            rows.push(row);
        }

        var csv = '\uFEFF';
        for (var i = 0; i < rows.length; i++) {
            var cols = [];
            for (var j = 0; j < rows[i].length; j++) {
                var val = String(rows[i][j] || '');
                if (val.indexOf(',') >= 0 || val.indexOf('"') >= 0 || val.indexOf('\n') >= 0) {
                    val = '"' + val.replace(/"/g, '""') + '"';
                }
                cols.push(val);
            }
            csv += cols.join(',') + '\r\n';
        }

        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = (currentAccountId ? 'ledger-' + currentAccountId : 'general-ledger') + '-' + (from !== 'البداية' ? from : 'all') + '-' + (to !== 'النهاية' ? to : 'all') + '.csv';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    }

    window.loadLedger = function () {
        var root = document.getElementById('ledger-root');
        if (!root) return;
        if (root.dataset.bound) return;
        root.dataset.bound = '1';

        injectStyles();

        root.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-muted)"><i class="fa-solid fa-spinner fa-spin" style="font-size:2rem"></i><p style="margin-top:12px">جاري تحميل الحسابات...</p></div>';

        apiFetch('/accounting/accounts', {}).then(function (res) {
            if (res.success) allAccounts = res.data || [];
            renderPage();
        }).catch(function (err) {
            root.innerHTML = '<div class="empty-state"><i class="fa-solid fa-exclamation-triangle" style="font-size:3rem;color:var(--danger-color,#dc2626);margin-bottom:16px"></i><h3>خطأ</h3><p style="color:var(--text-muted)">' + esc(err.message) + '</p></div>';
        });
    };

})();
