(function () {
    'use strict';

    var trialData = [];

    var r2 = function (n) { return Math.round(Number(n || 0) * 100) / 100; };

    var fmt = function (n) {
        return r2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

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
                throw new Error('انتهت الجلسة، الرجاء تسجيل الدخول مجددًا');
            }
            return r.json();
        });
    }

    function injectStyles() {
        if (document.getElementById('tb-styles')) return;
        var s = document.createElement('style');
        s.id = 'tb-styles';
        s.textContent = '\
            .tb-filter-bar { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; align-items: flex-end; }\
            .tb-filter-bar .form-group { margin-bottom: 0; }\
            .tb-filter-bar input, .tb-filter-bar select { padding: 6px 10px; font-size: 0.9rem; }\
            .tb-table-wrap { overflow-x: auto; }\
            .tb-table-wrap .data-table th, .tb-table-wrap .data-table td { white-space: nowrap; font-size: 0.85rem; }\
            .tb-table-wrap .data-table td { text-align: center; }\
            .tb-table-wrap .data-table td:first-child, .tb-table-wrap .data-table td:nth-child(2) { text-align: right; }\
            .tb-total-row td { font-weight: 700; border-top: 2px solid var(--border-color); }\
            .tb-unbalanced { color: var(--danger-color, #dc2626); font-weight: 700; margin-top: 12px; }\
            .tb-balanced { color: var(--success-color, #059669); font-weight: 700; margin-top: 12px; }\
            .tb-action-btn { padding: 4px 10px; font-size: 0.85rem; }\
        ';
        document.head.appendChild(s);
    }

    function accountTypeOptions() {
        var types = [
            { v: '', l: '--- جميع الأنواع ---' },
            { v: 'asset', l: 'أصول' },
            { v: 'liability', l: 'خصوم' },
            { v: 'equity', l: 'حقوق ملكية' },
            { v: 'income', l: 'إيرادات' },
            { v: 'expense', l: 'مصروفات' }
        ];
        var h = '';
        for (var i = 0; i < types.length; i++) {
            h += '<option value="' + types[i].v + '">' + types[i].l + '</option>';
        }
        return h;
    }

    function renderPage() {
        var root = document.getElementById('tb-root');
        if (!root) return;
        var today = new Date().toISOString().split('T')[0];

        root.innerHTML = '\
            <div class="page-card" style="min-height:200px">\
                <div class="page-card-header">\
                    <div class="page-card-title"><i class="fa-solid fa-scale-balanced"></i> ميزان المراجعة</div>\
                </div>\
                <div class="tb-filter-bar">\
                    <div class="form-group"><label>من تاريخ</label><input type="date" id="tb-from"></div>\
                    <div class="form-group"><label>إلى تاريخ</label><input type="date" id="tb-to" value="' + today + '"></div>\
                    <div class="form-group"><label>نوع الحساب</label><select id="tb-type">' + accountTypeOptions() + '</select></div>\
                    <div class="form-group" style="display:flex;align-items:center;gap:6px;padding-top:20px">\
                        <input type="checkbox" id="tb-include-zero" checked>\
                        <label for="tb-include-zero" style="margin:0;cursor:pointer">إظهار الحسابات بدون حركة</label>\
                    </div>\
                    <div class="form-group"><button class="btn btn-primary tb-action-btn" id="tb-refresh"><i class="fa-solid fa-rotate"></i> تحديث</button></div>\
                    <div class="form-group"><button class="btn btn-outline tb-action-btn" id="tb-print"><i class="fa-solid fa-print"></i> طباعة</button></div>\
                    <div class="form-group"><button class="btn btn-outline tb-action-btn" id="tb-excel"><i class="fa-solid fa-file-excel"></i> Excel</button></div>\
                </div>\
                <div class="tb-table-wrap">\
                    <table class="data-table" id="tb-table">\
                        <thead><tr>\
                            <th>الكود</th><th>اسم الحساب</th><th>النوع</th>\
                            <th>رصيد أول المدة (مدين)</th><th>رصيد أول المدة (دائن)</th>\
                            <th>حركة مدين</th><th>حركة دائن</th>\
                            <th>رصيد آخر المدة (مدين)</th><th>رصيد آخر المدة (دائن)</th>\
                        </tr></thead>\
                        <tbody id="tb-body"><tr><td colspan="9" style="text-align:center;padding:24px;color:var(--text-muted)">اضغط "تحديث" لعرض التقرير</td></tr></tbody>\
                    </table>\
                </div>\
                <div id="tb-summary" style="margin-top:16px"></div>\
            </div>\
        ';

        bindEvents();
    }

    function bindEvents() {
        document.getElementById('tb-refresh').onclick = loadData;
        document.getElementById('tb-print').onclick = printReport;
        document.getElementById('tb-excel').onclick = exportExcel;
        document.getElementById('tb-to').addEventListener('keydown', function (e) { if (e.key === 'Enter') loadData(); });
        document.getElementById('tb-from').addEventListener('keydown', function (e) { if (e.key === 'Enter') loadData(); });
    }

    function loadData() {
        var tbody = document.getElementById('tb-body');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--text-muted)"><i class="fa-solid fa-spinner fa-spin"></i> جاري تحميل ميزان المراجعة...</td></tr>';

        var params = {
            from: document.getElementById('tb-from').value,
            to: document.getElementById('tb-to').value,
            accountType: document.getElementById('tb-type').value,
            includeZero: document.getElementById('tb-include-zero').checked ? 'true' : 'false'
        };

        apiFetch('/accounting/trial-balance', params).then(function (res) {
            if (!res.success) {
                tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--danger-color)">' + esc(res.message || 'خطأ') + '</td></tr>';
                return;
            }
            trialData = res.data || [];
            renderTable(res.summary);
        }).catch(function (err) {
            tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--danger-color)">' + esc(err.message) + '</td></tr>';
        });
    }

    function renderTable(summary) {
        var tbody = document.getElementById('tb-body');
        if (!tbody) return;

        if (trialData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--text-muted)">لا توجد نتائج للفترة المحددة</td></tr>';
            document.getElementById('tb-summary').innerHTML = '';
            return;
        }

        var html = '';
        for (var i = 0; i < trialData.length; i++) {
            var a = trialData[i];
            html += '<tr>\
                <td>' + esc(a.account_code) + '</td>\
                <td style="text-align:right">' + esc(a.account_name) + '</td>\
                <td>' + typeLabel(a.account_type) + '</td>\
                <td>' + (a.opening_debit ? fmt(a.opening_debit) : '') + '</td>\
                <td>' + (a.opening_credit ? fmt(a.opening_credit) : '') + '</td>\
                <td>' + (a.period_debit ? fmt(a.period_debit) : '') + '</td>\
                <td>' + (a.period_credit ? fmt(a.period_credit) : '') + '</td>\
                <td><strong>' + fmt(a.closing_debit) + '</strong></td>\
                <td><strong>' + fmt(a.closing_credit) + '</strong></td>\
            </tr>';
        }
        tbody.innerHTML = html;

        var summaryEl = document.getElementById('tb-summary');
        if (!summary || !summaryEl) return;
        var balanced = summary.balanced;
        summaryEl.innerHTML = '\
            <div style="display:flex;gap:24px;flex-wrap:wrap;padding:12px 0;border-top:2px solid var(--border-color);font-weight:700">\
                <span>إجمالي المدين: <span style="color:var(--primary-color)">' + fmt(summary.totalDebit) + '</span></span>\
                <span>إجمالي الدائن: <span style="color:var(--primary-color)">' + fmt(summary.totalCredit) + '</span></span>\
                <span class="' + (balanced ? 'tb-balanced' : 'tb-unbalanced') + '">' + (balanced ? '✓ متزن' : '✗ غير متزن (الفارق: ' + fmt(Math.abs(summary.totalDebit - summary.totalCredit)) + ')') + '</span>\
            </div>\
        ';
    }

    function typeLabel(t) {
        var map = { asset: 'أصول', liability: 'خصوم', equity: 'حقوق ملكية', income: 'إيرادات', expense: 'مصروفات' };
        return map[t] || t || '—';
    }

    function printReport() {
        if (trialData.length === 0) { alert('لا توجد بيانات للطباعة'); return; }
        var rows = '';
        for (var i = 0; i < trialData.length; i++) {
            var a = trialData[i];
            rows += '<tr><td style="padding:4px 8px;border:1px solid #ccc">' + esc(a.account_code) + '</td><td style="padding:4px 8px;border:1px solid #ccc">' + esc(a.account_name) + '</td><td style="padding:4px 8px;border:1px solid #ccc">' + typeLabel(a.account_type) + '</td><td style="padding:4px 8px;border:1px solid #ccc;text-align:left">' + fmt(a.opening_debit) + '</td><td style="padding:4px 8px;border:1px solid #ccc;text-align:left">' + fmt(a.opening_credit) + '</td><td style="padding:4px 8px;border:1px solid #ccc;text-align:left">' + fmt(a.period_debit) + '</td><td style="padding:4px 8px;border:1px solid #ccc;text-align:left">' + fmt(a.period_credit) + '</td><td style="padding:4px 8px;border:1px solid #ccc;text-align:left">' + fmt(a.closing_debit) + '</td><td style="padding:4px 8px;border:1px solid #ccc;text-align:left">' + fmt(a.closing_credit) + '</td></tr>';
        }
        var from = document.getElementById('tb-from').value || 'البداية';
        var to = document.getElementById('tb-to').value || 'النهاية';
        var w = window.open('', '_blank', 'width=1000,height=700');
        w.document.write('\
            <!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><title>ميزان المراجعة</title>\
            <style>\
                body { font-family: "Segoe UI", Arial, sans-serif; margin: 30px; color: #222; font-size: 12px; }\
                h2 { text-align: center; margin-bottom: 8px; }\
                .period { text-align: center; margin-bottom: 20px; color: #555; }\
                table { width: 100%; border-collapse: collapse; }\
                th { background: #f0f0f0; padding: 6px 8px; border: 1px solid #ccc; text-align: center; font-size: 11px; }\
                td { padding: 4px 8px; border: 1px solid #ccc; }\
                .total-row td { font-weight: bold; border-top: 2px solid #000; }\
                @media print { body { margin: 15px; } }\
            </style></head><body>\
            <h2>ميزان المراجعة</h2>\
            <div class="period">من ' + esc(from) + ' إلى ' + esc(to) + '</div>\
            <table><thead><tr>\
                <th>الكود</th><th>اسم الحساب</th><th>النوع</th><th>رصيد أول المدة (مدين)</th><th>رصيد أول المدة (دائن)</th><th>حركة مدين</th><th>حركة دائن</th><th>رصيد آخر المدة (مدين)</th><th>رصيد آخر المدة (دائن)</th>\
            </tr></thead><tbody>' + rows + '</tbody></table>\
            <script>window.onload = function () { window.print(); };<' + '/script>\
            </body></html>\
        ');
        w.document.close();
    }

    function exportExcel() {
        if (trialData.length === 0) { alert('لا توجد بيانات للتصدير'); return; }
        var from = document.getElementById('tb-from').value || 'البداية';
        var to = document.getElementById('tb-to').value || 'النهاية';
        var rows = [
            ['ميزان المراجعة', '', '', '', '', '', '', '', ''],
            ['من ' + from + ' إلى ' + to, '', '', '', '', '', '', '', ''],
            ['', '', '', '', '', '', '', '', ''],
            ['الكود', 'اسم الحساب', 'النوع', 'رصيد أول المدة (مدين)', 'رصيد أول المدة (دائن)', 'حركة مدين', 'حركة دائن', 'رصيد آخر المدة (مدين)', 'رصيد آخر المدة (دائن)']
        ];
        var totalOD = 0, totalOC = 0, totalPD = 0, totalPC = 0, totalCD = 0, totalCC = 0;
        for (var i = 0; i < trialData.length; i++) {
            var a = trialData[i];
            rows.push([a.account_code, a.account_name, typeLabel(a.account_type), r2(a.opening_debit), r2(a.opening_credit), r2(a.period_debit), r2(a.period_credit), r2(a.closing_debit), r2(a.closing_credit)]);
            totalOD = r2(totalOD + a.opening_debit);
            totalOC = r2(totalOC + a.opening_credit);
            totalPD = r2(totalPD + a.period_debit);
            totalPC = r2(totalPC + a.period_credit);
            totalCD = r2(totalCD + a.closing_debit);
            totalCC = r2(totalCC + a.closing_credit);
        }
        rows.push(['', '', '', '', '', '', '', '', '']);
        rows.push(['الإجمالي', '', '', r2(totalOD), r2(totalOC), r2(totalPD), r2(totalPC), r2(totalCD), r2(totalCC)]);

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
        link.download = 'trial-balance-' + (from !== 'البداية' ? from : 'all') + '-' + (to !== 'النهاية' ? to : 'all') + '.csv';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    }

    window.loadTrialBalance = function () {
        var root = document.getElementById('tb-root');
        if (!root) return;
        if (root.dataset.bound) return;
        root.dataset.bound = '1';

        injectStyles();
        renderPage();
    };

})();
