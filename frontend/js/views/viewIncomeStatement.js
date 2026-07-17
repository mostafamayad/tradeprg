(function () {
    'use strict';

    var currentData = null;

    var r2 = function (n) { return Math.round(Number(n || 0) * 100) / 100; };
    var fmt = function (n) { return r2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var esc = function (v) { return String(v || '').replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m] || m; }); };

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
        if (document.getElementById('is-styles')) return;
        var s = document.createElement('style');
        s.id = 'is-styles';
        s.textContent = '\
            .is-filter-bar { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; align-items: flex-end; }\
            .is-filter-bar .form-group { margin-bottom: 0; }\
            .is-filter-bar input { padding: 6px 10px; font-size: 0.9rem; }\
            .is-action-btn { padding: 4px 10px; font-size: 0.85rem; }\
            .is-table-wrap { overflow-x: auto; }\
            .is-table-wrap .data-table th, .is-table-wrap .data-table td { white-space: nowrap; font-size: 0.85rem; }\
            .is-table-wrap .data-table td { text-align: center; }\
            .is-table-wrap .data-table td:first-child { text-align: right; min-width: 200px; }\
            .is-table-wrap .data-table td:last-child, .is-table-wrap .data-table td:nth-last-child(2) { text-align: left; direction: ltr; }\
            .is-section-header td { background: var(--primary-color, #7c3aed); color: #fff; font-weight: 700; font-size: 0.95rem; }\
            .is-group-header td { background: var(--bg-muted, #f3f4f6); font-weight: 600; }\
            .is-group-header td:first-child { padding-right: 24px; }\
            .is-total-row td { font-weight: 700; border-top: 2px solid var(--border-color, #d1d5db); }\
            .is-net-income td { font-weight: 800; font-size: 0.95rem; border-top: 3px double var(--primary-color, #7c3aed); }\
            .is-negative { color: var(--danger-color, #dc2626); }\
            .is-positive { color: var(--success-color, #16a34a); }\
            .is-empty { text-align: center; padding: 60px; color: var(--text-muted); }\
            .is-note { font-size: 0.8rem; color: var(--text-muted); margin-top: 8px; }\
            @media print { .is-filter-bar, .is-action-btn { display: none !important; } }';
        document.head.appendChild(s);
    }

    function buildFilterBar(root) {
        root.innerHTML = '\
            <div class="is-filter-bar">\
                <div class="form-group">\
                    <label style="font-size:0.85rem;font-weight:500">من تاريخ</label>\
                    <input type="date" id="is-from" style="padding:6px 10px;font-size:0.9rem">\
                </div>\
                <div class="form-group">\
                    <label style="font-size:0.85rem;font-weight:500">إلى تاريخ</label>\
                    <input type="date" id="is-to" style="padding:6px 10px;font-size:0.9rem">\
                </div>\
                <div class="form-group" style="display:flex;align-items:flex-end;gap:8px">\
                    <button class="btn btn-primary is-action-btn" id="is-apply-btn"><i class="fa-solid fa-filter"></i> عرض</button>\
                    <button class="btn btn-outline is-action-btn" id="is-print-btn"><i class="fa-solid fa-print"></i> طباعة</button>\
                    <button class="btn btn-outline is-action-btn" id="is-csv-btn"><i class="fa-solid fa-file-csv"></i> Excel</button>\
                </div>\
            </div>\
            <div id="is-results"><div class="is-empty"><i class="fa-solid fa-chart-line" style="font-size:2.5rem;margin-bottom:16px"></i><p>اختر نطاق تاريخ واضغط "عرض"</p></div></div>';
    }

    function doFetch() {
        var from = document.getElementById('is-from').value;
        var to = document.getElementById('is-to').value;
        var params = {};
        if (from) params.from = from;
        if (to) params.to = to;

        var resultsDiv = document.getElementById('is-results');
        resultsDiv.innerHTML = '<div class="is-empty"><i class="fa-solid fa-spinner fa-spin" style="font-size:2rem"></i><p style="margin-top:12px">جاري التحميل...</p></div>';

        apiFetch('/accounting/income-statement', params).then(function (d) {
            if (!d.success) {
                resultsDiv.innerHTML = '<div class="is-empty"><i class="fa-solid fa-exclamation-triangle" style="font-size:3rem;color:var(--danger-color,#dc2626);margin-bottom:16px"></i><h3>خطأ</h3><p style="color:var(--text-muted)">' + esc(d.message || '') + '</p></div>';
                return;
            }
            if (!d.revenue || d.revenue.groups.length === 0) {
                resultsDiv.innerHTML = '<div class="is-empty"><i class="fa-solid fa-database" style="font-size:2.5rem;margin-bottom:16px"></i><p>لا توجد بيانات للفترة المحددة</p></div>';
                return;
            }
            currentData = d;
            renderResults(d, resultsDiv);
        }).catch(function (err) {
            resultsDiv.innerHTML = '<div class="is-empty"><i class="fa-solid fa-exclamation-triangle" style="font-size:3rem;color:var(--danger-color,#dc2626);margin-bottom:16px"></i><h3>خطأ</h3><p style="color:var(--text-muted)">' + esc(err.message) + '</p></div>';
        });
    }

    function balanceLabel(n) {
        if (n > 0) return '<span class="is-positive">' + fmt(n) + '</span>';
        if (n < 0) return '<span class="is-negative">(' + fmt(Math.abs(n)) + ')</span>';
        return fmt(0);
    }

    function sectionHTML(section, label, isExpense) {
        var h = '';
        h += '<tr class="is-section-header"><td colspan="3">' + esc(label) + '</td></tr>';
        for (var gi = 0; gi < section.groups.length; gi++) {
            var grp = section.groups[gi];
            if (grp.accounts.length === 0) continue;
            h += '<tr class="is-group-header"><td>' + esc(grp.name) + '</td>\
                <td style="text-align:left;direction:ltr">' + fmt(grp.totals.period) + '</td>\
                <td style="text-align:left;direction:ltr">' + fmt(grp.totals.closing) + '</td></tr>';
            for (var ai = 0; ai < grp.accounts.length; ai++) {
                var ac = grp.accounts[ai];
                h += '<tr><td style="padding-right:48px">' + esc(ac.account_code) + ' - ' + esc(ac.account_name) + '</td>\
                    <td style="text-align:left;direction:ltr">' + balanceLabel(ac.period) + '</td>\
                    <td style="text-align:left;direction:ltr">' + balanceLabel(ac.closing) + '</td></tr>';
            }
        }
        h += '<tr class="is-total-row"><td>إجمالي ' + esc(label) + '</td>\
            <td style="text-align:left;direction:ltr">' + fmt(section.totals.period) + '</td>\
            <td style="text-align:left;direction:ltr">' + fmt(section.totals.closing) + '</td></tr>';
        return h;
    }

    function renderResults(d, container) {
        var periodLabel = '';
        if (d.from && d.to) periodLabel = ' للفترة من ' + d.from + ' إلى ' + d.to;
        else if (d.to) periodLabel = ' حتى ' + d.to;
        else periodLabel = ' — جميع الفترات';

        var html = '<div style="margin-bottom:12px"><strong>قائمة الدخل</strong>' + esc(periodLabel) + '</div>';
        html += '<div class="is-table-wrap"><table class="data-table" style="width:100%"><thead><tr>\
            <th style="text-align:right">البيان</th>\
            <th style="text-align:left;direction:ltr">الفترة</th>\
            <th style="text-align:left;direction:ltr">تراكمي</th>\
        </tr></thead><tbody>';

        html += sectionHTML(d.revenue, d.revenue.name, false);
        html += sectionHTML(d.expenses, d.expenses.name, true);

        var niClass = d.netIncome >= 0 ? 'is-positive' : 'is-negative';
        html += '<tr class="is-net-income"><td>صافي الدخل</td>\
            <td style="text-align:left;direction:ltr"><span class="' + niClass + '">' + fmt(d.netIncome) + '</span></td>\
            <td style="text-align:left;direction:ltr"><span class="' + niClass + '">' + fmt(d.netIncome) + '</span></td></tr>';

        html += '</tbody></table></div>';
        html += '<div class="is-note">صافي الدخل = إجمالي الإيرادات (' + fmt(d.totals.totalRevenue) + ') - إجمالي المصروفات (' + fmt(d.totals.totalExpenses) + ')</div>';

        container.innerHTML = html;
    }

    function doPrint() {
        window.print();
    }

    function doCsv() {
        if (!currentData) return;
        var d = currentData;
        var from = document.getElementById('is-from').value || 'البداية';
        var to = document.getElementById('is-to').value || 'النهاية';
        var dataRows = [];

        function addSection(section, label) {
            dataRows.push([label, '', '', '', '', '']);
            for (var gi = 0; gi < section.groups.length; gi++) {
                var grp = section.groups[gi];
                for (var ai = 0; ai < grp.accounts.length; ai++) {
                    var ac = grp.accounts[ai];
                    dataRows.push(['', grp.name, ac.account_code, ac.account_name, r2(ac.period) || 0, r2(ac.closing) || 0]);
                }
                dataRows.push(['', 'إجمالي ' + grp.name, '', '', r2(grp.totals.period) || 0, r2(grp.totals.closing) || 0]);
            }
            dataRows.push(['', 'إجمالي ' + label, '', '', r2(section.totals.period) || 0, r2(section.totals.closing) || 0]);
        }

        addSection(d.revenue, d.revenue.name);
        addSection(d.expenses, d.expenses.name);

        if (window.exportStyledExcel) {
            window.exportStyledExcel({
                filename: 'income-statement-' + from + '-' + to,
                title: 'قائمة الدخل',
                subtitle: 'من ' + from + ' إلى ' + to,
                headers: ['البيان', 'المجموعة', 'كود الحساب', 'اسم الحساب', 'الفترة', 'تراكمي'],
                data: dataRows,
                totals: ['صافي الدخل', '', '', '', r2(d.netIncome) || 0, r2(d.netIncome) || 0],
                colWidths: [20, 25, 15, 30, 20, 20]
            });
        } else {
            alert('مكتبة التصدير غير متوفرة');
        }
    }

    window.loadIncomeStatement = function () {
        var root = document.getElementById('income-statement-root');
        if (!root) return;
        if (root.dataset.bound) return;
        root.dataset.bound = '1';

        injectStyles();
        buildFilterBar(root);

        document.getElementById('is-apply-btn').addEventListener('click', doFetch);
        document.getElementById('is-print-btn').addEventListener('click', doPrint);
        document.getElementById('is-csv-btn').addEventListener('click', doCsv);

        setTimeout(doFetch, 100);
    };
})();
