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

        // ── gather company info ──────────────────────────────────────────────
        var coName = '', coPhone = '', coAddr = '', coLogo = '';
        try {
            var settings = window.AppData && window.AppData.settings;
            if (settings) {
                coName  = settings.company_name  || settings.name  || '';
                coPhone = settings.company_phone || settings.phone || '';
                coAddr  = settings.company_address || settings.address || '';
                coLogo  = settings.logo_url || '';
            }
        } catch (e) {}

        var from = (document.getElementById('tb-from') || {}).value || '—';
        var to   = (document.getElementById('tb-to')   || {}).value || '—';

        // ── totals ───────────────────────────────────────────────────────────
        var tOD = 0, tOC = 0, tPD = 0, tPC = 0, tCD = 0, tCC = 0;
        var rows = '';
        for (var i = 0; i < trialData.length; i++) {
            var a = trialData[i];
            tOD += r2(a.opening_debit);  tOC += r2(a.opening_credit);
            tPD += r2(a.period_debit);   tPC += r2(a.period_credit);
            tCD += r2(a.closing_debit);  tCC += r2(a.closing_credit);
            var rowBg = i % 2 === 0 ? '#fff' : '#f9fafb';
            rows += '<tr style="background:' + rowBg + '">'
                + '<td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:center">' + esc(a.account_code) + '</td>'
                + '<td style="padding:5px 8px;border:1px solid #e5e7eb">' + esc(a.account_name) + '</td>'
                + '<td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:center">' + typeLabel(a.account_type) + '</td>'
                + '<td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:right;direction:ltr">' + (r2(a.opening_debit)  ? fmt(a.opening_debit)  : '') + '</td>'
                + '<td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:right;direction:ltr">' + (r2(a.opening_credit) ? fmt(a.opening_credit) : '') + '</td>'
                + '<td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:right;direction:ltr">' + (r2(a.period_debit)   ? fmt(a.period_debit)   : '') + '</td>'
                + '<td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:right;direction:ltr">' + (r2(a.period_credit)  ? fmt(a.period_credit)  : '') + '</td>'
                + '<td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:right;direction:ltr;font-weight:700">' + fmt(a.closing_debit)  + '</td>'
                + '<td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:right;direction:ltr;font-weight:700">' + fmt(a.closing_credit) + '</td>'
                + '</tr>';
        }

        var totalRow = '<tr style="background:#fef2f2;font-weight:700">'
            + '<td colspan="3" style="padding:6px 8px;border:2px solid #dc2626;border-left:1px solid #e5e7eb;text-align:center">الإجمالي</td>'
            + '<td style="padding:6px 8px;border:2px solid #dc2626;border-left:1px solid #e5e7eb;text-align:right;direction:ltr">' + fmt(tOD) + '</td>'
            + '<td style="padding:6px 8px;border:2px solid #dc2626;border-left:1px solid #e5e7eb;text-align:right;direction:ltr">' + fmt(tOC) + '</td>'
            + '<td style="padding:6px 8px;border:2px solid #dc2626;border-left:1px solid #e5e7eb;text-align:right;direction:ltr">' + fmt(tPD) + '</td>'
            + '<td style="padding:6px 8px;border:2px solid #dc2626;border-left:1px solid #e5e7eb;text-align:right;direction:ltr">' + fmt(tPC) + '</td>'
            + '<td style="padding:6px 8px;border:2px solid #dc2626;border-left:1px solid #e5e7eb;text-align:right;direction:ltr">' + fmt(tCD) + '</td>'
            + '<td style="padding:6px 8px;border:2px solid #dc2626;text-align:right;direction:ltr">' + fmt(tCC) + '</td>'
            + '</tr>';

        var balanced = Math.abs(r2(tCD) - r2(tCC)) < 0.01;
        var balanceStatus = balanced
            ? '<span style="color:#16a34a;font-weight:700">✓ ميزان متزن</span>'
            : '<span style="color:#dc2626;font-weight:700">✗ ميزان غير متزن — الفارق: ' + fmt(Math.abs(r2(tCD) - r2(tCC))) + '</span>';

        var logoHtml = coLogo ? '<img src="' + coLogo + '" style="max-height:55px;max-width:120px;object-fit:contain;margin-bottom:6px" onerror="this.style.display=\'none\'">' : '';

        var printDate = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });

        var w = window.open('', '_blank', 'width=1100,height=750,scrollbars=yes');
        if (!w) { alert('يرجى السماح بفتح نوافذ جديدة في المتصفح'); return; }

        w.document.write('<!DOCTYPE html><html dir="rtl" lang="ar"><head>'
            + '<meta charset="UTF-8">'
            + '<title>ميزان المراجعة - ' + esc(coName) + '</title>'
            + '<style>'
            + 'body{font-family:"Segoe UI",Arial,sans-serif;margin:20px;color:#1e293b;font-size:11.5px;}'
            + '.print-header{text-align:center;margin-bottom:18px;padding-bottom:14px;border-bottom:3px solid #dc2626;}'
            + '.co-logo{margin-bottom:6px;}'
            + '.co-name{font-size:1.3rem;font-weight:800;color:#1e293b;}'
            + '.co-info{font-size:0.8rem;color:#64748b;margin-top:3px;}'
            + '.report-title{font-size:1.1rem;font-weight:700;margin:10px 0 4px;color:#dc2626;}'
            + '.report-period{font-size:0.85rem;color:#475569;}'
            + 'table{width:100%;border-collapse:collapse;margin-top:12px;font-size:11px;}'
            + 'th{background:#dc2626;color:#fff;padding:7px 8px;border:1px solid #dc2626;text-align:center;font-size:10.5px;font-weight:600;white-space:nowrap;}'
            + '.balance-status{margin-top:10px;padding:8px 14px;border-radius:6px;display:inline-block;}'
            + '.footer-print{text-align:center;font-size:10px;color:#94a3b8;margin-top:18px;padding-top:8px;border-top:1px solid #e2e8f0;}'
            + '.watermark{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);font-size:110px;opacity:0.03;color:#dc2626;pointer-events:none;z-index:-1;font-weight:900;}'
            + '@media print{body{margin:12px;}-webkit-print-color-adjust:exact;print-color-adjust:exact;}'
            + '</style></head><body>'
            + '<div class="watermark">TradePro</div>'
            + '<div class="print-header">'
            + (logoHtml ? '<div class="co-logo">' + logoHtml + '</div>' : '')
            + '<div class="co-name">' + esc(coName) + '</div>'
            + '<div class="co-info">' + [coAddr, coPhone].filter(Boolean).map(esc).join(' | ') + '</div>'
            + '<div class="report-title">ميزان المراجعة</div>'
            + '<div class="report-period">من ' + esc(from) + ' إلى ' + esc(to) + ' | تاريخ الطباعة: ' + printDate + '</div>'
            + '</div>'
            + '<table><thead><tr>'
            + '<th>الكود</th><th>اسم الحساب</th><th>النوع</th>'
            + '<th>رصيد أول المدة<br>مدين</th><th>رصيد أول المدة<br>دائن</th>'
            + '<th>حركة المدة<br>مدين</th><th>حركة المدة<br>دائن</th>'
            + '<th>رصيد آخر المدة<br>مدين</th><th>رصيد آخر المدة<br>دائن</th>'
            + '</tr></thead><tbody>' + rows + totalRow + '</tbody></table>'
            + '<div style="margin-top:12px">' + balanceStatus + '</div>'
            + '<div class="footer-print">TradePro ERP &mdash; تقرير ميزان المراجعة</div>'
            + '<script>window.onload=function(){window.print();};<\/script>'
            + '</body></html>');
        w.document.close();
    }

    function exportExcel() {
        if (trialData.length === 0) { alert('لا توجد بيانات للتصدير'); return; }
        
        var from = document.getElementById('tb-from').value || 'البداية';
        var to = document.getElementById('tb-to').value || 'النهاية';
        
        var dataRows = [];
        var totalOD = 0, totalOC = 0, totalPD = 0, totalPC = 0, totalCD = 0, totalCC = 0;
        
        for (var i = 0; i < trialData.length; i++) {
            var a = trialData[i];
            dataRows.push([
                a.account_code, 
                a.account_name, 
                typeLabel(a.account_type), 
                r2(a.opening_debit) || 0, 
                r2(a.opening_credit) || 0, 
                r2(a.period_debit) || 0, 
                r2(a.period_credit) || 0, 
                r2(a.closing_debit) || 0, 
                r2(a.closing_credit) || 0
            ]);
            totalOD += r2(a.opening_debit);
            totalOC += r2(a.opening_credit);
            totalPD += r2(a.period_debit);
            totalPC += r2(a.period_credit);
            totalCD += r2(a.closing_debit);
            totalCC += r2(a.closing_credit);
        }

        if (window.exportStyledExcel) {
            window.exportStyledExcel({
                filename: 'trial-balance-' + (from !== 'البداية' ? from : 'all') + '-' + (to !== 'النهاية' ? to : 'all'),
                title: 'ميزان المراجعة',
                subtitle: 'من ' + from + ' إلى ' + to,
                headers: ['الكود', 'اسم الحساب', 'النوع', 'رصيد أول المدة (مدين)', 'رصيد أول المدة (دائن)', 'حركة مدين', 'حركة دائن', 'رصيد آخر المدة (مدين)', 'رصيد آخر المدة (دائن)'],
                data: dataRows,
                totals: ['الإجمالي', '', '', totalOD, totalOC, totalPD, totalPC, totalCD, totalCC],
                colWidths: [15, 30, 15, 20, 20, 20, 20, 20, 20]
            });
        } else {
            alert('مكتبة التصدير غير متوفرة');
        }
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
