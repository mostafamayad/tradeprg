(function () {
    'use strict';

    var currentData = null;

    var r2 = function (n) { return Math.round(Number(n || 0) * 100) / 100; };
    var fmt = function (n) { return r2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var esc = function (v) { return String(v || '').replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m] || m; }); };
    var dir = document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr';

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
        if (document.getElementById('bs-styles')) return;
        var s = document.createElement('style');
        s.id = 'bs-styles';
        s.textContent = '\
            .bs-filter-bar { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; align-items: flex-end; }\
            .bs-filter-bar .form-group { margin-bottom: 0; }\
            .bs-filter-bar input, .bs-filter-bar select { padding: 6px 10px; font-size: 0.9rem; }\
            .bs-action-btn { padding: 4px 10px; font-size: 0.85rem; }\
            .bs-table-wrap { overflow-x: auto; }\
            .bs-table-wrap .data-table th, .bs-table-wrap .data-table td { white-space: nowrap; font-size: 0.85rem; }\
            .bs-table-wrap .data-table td { text-align: center; }\
            .bs-table-wrap .data-table td:first-child { text-align: right; min-width: 200px; }\
            .bs-table-wrap .data-table td:last-child, .bs-table-wrap .data-table td:nth-last-child(2) { text-align: left; direction: ltr; }\
            .bs-section-header td { background: var(--primary-color, #7c3aed); color: #fff; font-weight: 700; font-size: 0.95rem; }\
            .bs-group-header td { background: var(--bg-muted, #f3f4f6); font-weight: 600; }\
            .bs-group-header td:first-child { padding-right: 24px; }\
            .bs-total-row td { font-weight: 700; border-top: 2px solid var(--border-color, #d1d5db); }\
            .bs-grand-total td { font-weight: 800; font-size: 0.95rem; border-top: 3px double var(--primary-color, #7c3aed); }\
            .bs-negative { color: var(--danger-color, #dc2626); }\
            .bs-positive { color: var(--success-color, #16a34a); }\
            .bs-balanced-yes { color: var(--success-color, #16a34a); font-weight: 700; }\
            .bs-balanced-no { color: var(--danger-color, #dc2626); font-weight: 700; }\
            .bs-empty { text-align: center; padding: 60px; color: var(--text-muted); }\
            .bs-print-hidden { }\
            .bs-note { font-size: 0.8rem; color: var(--text-muted); margin-top: 8px; }\
            @media print { .bs-filter-bar, .bs-action-btn, .bs-print-hidden { display: none !important; } }';
        document.head.appendChild(s);
    }

    function buildFilterBar(root) {
        // Get today and 30 days ago for defaults
        var today = new Date().toISOString().split('T')[0];
        var monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

        root.innerHTML = '\
            <div class="bs-filter-bar">\
                <div class="form-group">\
                    <label style="font-size:0.85rem;font-weight:500">من تاريخ</label>\
                    <input type="date" id="bs-from" style="padding:6px 10px;font-size:0.9rem">\
                </div>\
                <div class="form-group">\
                    <label style="font-size:0.85rem;font-weight:500">إلى تاريخ</label>\
                    <input type="date" id="bs-to" style="padding:6px 10px;font-size:0.9rem">\
                </div>\
                <div class="form-group" style="display:flex;align-items:center;gap:6px">\
                    <input type="checkbox" id="bs-include-zero" style="width:16px;height:16px">\
                    <label for="bs-include-zero" style="font-size:0.85rem;font-weight:500;margin:0">حتى الحسابات الصفرية</label>\
                </div>\
                <div class="form-group" style="display:flex;align-items:flex-end;gap:8px">\
                    <button class="btn btn-primary bs-action-btn" id="bs-apply-btn"><i class="fa-solid fa-filter"></i> عرض</button>\
                    <button class="btn btn-outline bs-action-btn bs-print-hidden" id="bs-print-btn"><i class="fa-solid fa-print"></i> طباعة</button>\
                    <button class="btn btn-outline bs-action-btn bs-print-hidden" id="bs-csv-btn"><i class="fa-solid fa-file-csv"></i> Excel</button>\
                </div>\
            </div>\
            <div id="bs-results"><div class="bs-empty"><i class="fa-solid fa-chart-pie" style="font-size:2.5rem;margin-bottom:16px"></i><p>اختر نطاق تاريخ واضغط "عرض"</p></div></div>';
    }

    function doFetch() {
        var from = document.getElementById('bs-from').value;
        var to = document.getElementById('bs-to').value;
        var includeZero = document.getElementById('bs-include-zero').checked;
        var params = {};
        if (from) params.from = from;
        if (to) params.to = to;
        if (includeZero) params.includeZero = 'true';

        var resultsDiv = document.getElementById('bs-results');
        resultsDiv.innerHTML = '<div class="bs-empty"><i class="fa-solid fa-spinner fa-spin" style="font-size:2rem"></i><p style="margin-top:12px">جاري التحميل...</p></div>';

        apiFetch('/accounting/balance-sheet', params).then(function (d) {
            if (!d.success || !d.sections || d.sections.length === 0) {
                resultsDiv.innerHTML = '<div class="bs-empty"><i class="fa-solid fa-database" style="font-size:2.5rem;margin-bottom:16px"></i><p>لا توجد بيانات للفترة المحددة</p></div>';
                return;
            }
            currentData = d;
            renderResults(d, resultsDiv);
        }).catch(function (err) {
            resultsDiv.innerHTML = '<div class="bs-empty"><i class="fa-solid fa-exclamation-triangle" style="font-size:3rem;color:var(--danger-color,#dc2626);margin-bottom:16px"></i><h3>خطأ</h3><p style="color:var(--text-muted)">' + esc(err.message) + '</p></div>';
        });
    }

    function balanceLabel(n) {
        if (n > 0) return '<span class="bs-positive">' + fmt(n) + '</span>';
        if (n < 0) return '<span class="bs-negative">(' + fmt(Math.abs(n)) + ')</span>';
        return fmt(0);
    }

    function renderResults(d, container) {
        var periodLabel = '';
        if (d.from && d.to) periodLabel = ' للفترة من ' + d.from + ' إلى ' + d.to;
        else if (d.to) periodLabel = ' حتى ' + d.to;
        else periodLabel = ' — جميع الفترات';

        var html = '<div style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">\
            <div><strong>الميزانية العمومية</strong>' + esc(periodLabel) + '</div>\
            <div class="bs-print-hidden">\
                <span class="' + (d.totals.balanced ? 'bs-balanced-yes' : 'bs-balanced-no') + '">\
                    ' + (d.totals.balanced ? '✓ متوازنة' : '✗ غير متوازنة') + '\
                </span>\
            </div>\
        </div>';

        html += '<div class="bs-table-wrap"><table class="data-table" style="width:100%"><thead><tr>\
            <th style="text-align:right">الحساب</th>\
            <th style="text-align:left;direction:ltr">رصيد أول المدة</th>\
            <th style="text-align:left;direction:ltr">رصيد آخر المدة</th>\
        </tr></thead><tbody>';

        for (var si = 0; si < d.sections.length; si++) {
            var sec = d.sections[si];
            html += '<tr class="bs-section-header"><td colspan="3">' + esc(sec.name) + '</td></tr>';

            for (var gi = 0; gi < sec.groups.length; gi++) {
                var grp = sec.groups[gi];
                if (grp.accounts.length === 0) continue;
                html += '<tr class="bs-group-header"><td>' + esc(grp.name) + '</td>\
                    <td style="text-align:left;direction:ltr">' + fmt(grp.totals.opening) + '</td>\
                    <td style="text-align:left;direction:ltr">' + fmt(grp.totals.closing) + '</td></tr>';

                for (var ai = 0; ai < grp.accounts.length; ai++) {
                    var ac = grp.accounts[ai];
                    html += '<tr>\
                        <td style="padding-right:48px">' + esc(ac.account_code) + ' - ' + esc(ac.account_name) + '</td>\
                        <td style="text-align:left;direction:ltr">' + balanceLabel(ac.opening) + '</td>\
                        <td style="text-align:left;direction:ltr">' + balanceLabel(ac.closing) + '</td>\
                    </tr>';
                }
            }

            // Section total
            html += '<tr class="bs-total-row"><td>إجمالي ' + esc(sec.name) + '</td>\
                <td style="text-align:left;direction:ltr">' + fmt(sec.totals.opening) + '</td>\
                <td style="text-align:left;direction:ltr">' + fmt(sec.totals.closing) + '</td></tr>';
        }

        // Grand total rows
        html += '<tr class="bs-grand-total"><td>إجمالي الأصول</td>\
            <td style="text-align:left;direction:ltr">' + fmt(d.totals.totalAssets.opening) + '</td>\
            <td style="text-align:left;direction:ltr">' + fmt(d.totals.totalAssets.closing) + '</td></tr>';
        html += '<tr class="bs-grand-total"><td>إجمالي الخصوم وحقوق الملكية</td>\
            <td style="text-align:left;direction:ltr">' + fmt(d.totals.totalLiabilitiesAndEquity.opening) + '</td>\
            <td style="text-align:left;direction:ltr">' + fmt(d.totals.totalLiabilitiesAndEquity.closing) + '</td></tr>';

        html += '</tbody></table></div>';

        // Balanced indicator
        if (d.totals.balanced) {
            html += '<div class="bs-note"><span class="bs-balanced-yes">✓ الميزانية العمومية متوازنة: الأصول = الخصوم + حقوق الملكية</span></div>';
        } else {
            html += '<div class="bs-note"><span class="bs-balanced-no">✗ الميزانية العمومية غير متوازنة — الفرق: ' + fmt(Math.abs(r2(d.totals.totalAssets.closing) - r2(d.totals.totalLiabilitiesAndEquity.closing))) + '</span></div>';
        }

        container.innerHTML = html;
    }

    function doPrint() {
        window.print();
    }

    function doCsv() {
        if (!currentData || !currentData.sections) return;
        var d = currentData;
        var dataRows = [];
        var from = document.getElementById('bs-from').value || 'البداية';
        var to = document.getElementById('bs-to').value || 'النهاية';

        for (var si = 0; si < d.sections.length; si++) {
            var sec = d.sections[si];
            for (var gi = 0; gi < sec.groups.length; gi++) {
                var grp = sec.groups[gi];
                for (var ai = 0; ai < grp.accounts.length; ai++) {
                    var ac = grp.accounts[ai];
                    dataRows.push([sec.name, grp.name, ac.account_code, ac.account_name, r2(ac.opening) || 0, r2(ac.closing) || 0]);
                }
                dataRows.push(['', 'إجمالي ' + grp.name, '', '', r2(grp.totals.opening) || 0, r2(grp.totals.closing) || 0]);
            }
            dataRows.push(['', 'إجمالي ' + sec.name, '', '', r2(sec.totals.opening) || 0, r2(sec.totals.closing) || 0]);
        }
        
        dataRows.push([]);
        dataRows.push(['', 'إجمالي الأصول', '', '', r2(d.totals.totalAssets.opening) || 0, r2(d.totals.totalAssets.closing) || 0]);
        dataRows.push(['', 'إجمالي الخصوم وحقوق الملكية', '', '', r2(d.totals.totalLiabilitiesAndEquity.opening) || 0, r2(d.totals.totalLiabilitiesAndEquity.closing) || 0]);

        if (window.exportStyledExcel) {
            window.exportStyledExcel({
                filename: 'balance-sheet-' + from + '-' + to,
                title: 'الميزانية العمومية',
                subtitle: 'من ' + from + ' إلى ' + to,
                headers: ['القسم', 'المجموعة', 'كود الحساب', 'اسم الحساب', 'رصيد أول المدة', 'رصيد آخر المدة'],
                data: dataRows,
                colWidths: [20, 25, 15, 30, 20, 20]
            });
        } else {
            alert('مكتبة التصدير غير متوفرة');
        }
    }

    window.loadBalanceSheet = function () {
        var root = document.getElementById('balance-sheet-root');
        if (!root) return;
        if (root.dataset.bound) return;
        root.dataset.bound = '1';

        injectStyles();
        buildFilterBar(root);

        document.getElementById('bs-apply-btn').addEventListener('click', doFetch);
        document.getElementById('bs-print-btn').addEventListener('click', doPrint);
        document.getElementById('bs-csv-btn').addEventListener('click', doCsv);

        // Auto-load on first open
        setTimeout(doFetch, 100);
    };
})();
