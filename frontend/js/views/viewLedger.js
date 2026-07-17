(function () {
    'use strict';

    var allAccounts = [];
    var currentData = null;
    var currentAccountId = '';
    var currentPage = 1;

    function refTypeLabel(v) {
        var map = {
            'manual_je': 'قيد يدوي', 'sales_invoice': 'مبيعات', 'sales_return': 'مرتجع مبيعات',
            'purchase_invoice': 'مشتريات', 'purchase_return': 'مرتجع مشتريات',
            'treasury': 'خزينة', 'ar_payment': 'تحصيل', 'ap_payment': 'دفع',
            'opening_balance': 'افتتاحي', 'year_close': 'إقفال سنوي'
        };
        return map[v] || v || '';
    }

    var columns = [
        { key: 'entry_date',      label: 'التاريخ',   align: 'center', width: '100px', formatter: function (v) { return v || ''; } },
        { key: 'journal_no_link', label: 'رقم القيد', align: 'center', width: '110px', formatter: function (v) { return v || ''; } },
        { key: 'reference',       label: 'المرجع',    align: 'center', width: '130px' },
        { key: 'description',     label: 'البيان',    align: 'right' },
        { key: 'debit',           label: 'مدين',      align: 'center', width: '110px', formatter: function (v) { return v ? ReportUtils.fmt(v) : ''; } },
        { key: 'credit',          label: 'دائن',      align: 'center', width: '110px', formatter: function (v) { return v ? ReportUtils.fmt(v) : ''; } },
        { key: 'running_balance', label: 'الرصيد الجاري', align: 'center', width: '150px', formatter: function (v, row) {
            if (v === '' || v === null || v === undefined) { return ''; }
            var cls = row._balType === 'Dr' ? 'gl-running-dr' : 'gl-running-cr';
            return '<span class="' + cls + '">' + ReportUtils.fmt(v) + ' ' + (row._balType === 'Dr' ? 'د' : 'ائ') + '</span>';
        }}
    ];

    function injectStyles() {
        ReportLayout.injectStyles('gl', '\
            .gl-filter-bar { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; align-items: flex-end; }\
            .gl-filter-bar .form-group { margin-bottom: 0; }\
            .gl-filter-bar input, .gl-filter-bar select { padding: 6px 10px; font-size: 0.9rem; }\
            .gl-table-wrap { overflow-x: auto; }\
            .gl-table-wrap .data-table th, .gl-table-wrap .data-table td { white-space: nowrap; font-size: 0.85rem; }\
            .gl-table-wrap .data-table td { text-align: center; }\
            .gl-table-wrap .data-table td:nth-child(4) { text-align: right; max-width: 250px; overflow: hidden; text-overflow: ellipsis; }\
            .gl-opening-row td { background: var(--bg-muted, #f8f9fa); font-weight: 600; }\
            .gl-total-row td { font-weight: 700; border-top: 2px solid var(--border-color); }\
            .gl-running-dr { color: var(--primary-color, #7c3aed); }\
            .gl-running-cr { color: var(--danger-color, #dc2626); }\
            .gl-journal-link { color: var(--primary-color, #7c3aed); cursor: pointer; text-decoration: underline; }\
            .gl-journal-link:hover { color: var(--primary-hover, #6d28d9); }\
            @media print { .no-print { display: none !important; } }\
        ');
    }

    function renderPage() {
        var root = document.getElementById('ledger-root');
        if (!root) return;
        var today = ReportUtils.todayStr();

        var accountOpts = '<option value="">--- جميع الحسابات (الأستاذ العام) ---</option>';
        for (var i = 0; i < allAccounts.length; i++) {
            var a = allAccounts[i];
            var sysTag = a.system_code ? ' [نظامي]' : '';
            accountOpts += '<option value="' + a.id + '">' + ReportUtils.esc(a.account_code) + ' - ' + ReportUtils.esc(a.account_name) + sysTag + '</option>';
        }

        root.innerHTML =
            '<div class="page-section"><div class="page-card" style="min-height:200px">' +
                '<div class="page-card-header"><div class="page-card-title"><i class="fa-solid fa-receipt"></i> الأستاذ العام</div></div>' +
                '<div class="gl-filter-bar">' +
                    '<div class="form-group" style="min-width:220px"><label>الحساب</label><select id="gl-account" class="form-control">' + accountOpts + '</select></div>' +
                    '<div class="form-group"><label>من تاريخ</label><input type="date" id="gl-from" class="form-control"></div>' +
                    '<div class="form-group"><label>إلى تاريخ</label><input type="date" id="gl-to" class="form-control" value="' + today + '"></div>' +
                    '<div class="form-group" style="min-width:160px"><label>نوع المرجع</label><select id="gl-ref-type" class="form-control"><option value="">--- الكل ---</option><option value="manual_je">قيد يدوي</option><option value="sales_invoice">مبيعات</option><option value="purchase_invoice">مشتريات</option><option value="sales_return">مرتجع مبيعات</option><option value="purchase_return">مرتجع مشتريات</option><option value="ar_payment">تحصيل</option><option value="ap_payment">دفع</option><option value="treasury">خزينة</option></select></div>' +
                    '<div class="form-group" style="min-width:160px"><label>بحث</label><input type="text" id="gl-search" class="form-control" placeholder="رقم/بيان القيد"></div>' +
                    '<div class="form-group" style="display:flex;align-items:center;gap:6px;padding-top:20px"><input type="checkbox" id="gl-include-opening" checked><label for="gl-include-opening" style="margin:0;cursor:pointer">رصيد أول المدة</label></div>' +
                    '<div class="form-group" style="display:flex;gap:8px;align-items:flex-end">' +
                        '<button class="btn btn-primary" id="gl-refresh"><i class="fa-solid fa-rotate"></i> عرض</button>' +
                        '<button class="btn btn-outline no-print" id="gl-print"><i class="fa-solid fa-print"></i> طباعة</button>' +
                        '<button class="btn btn-outline no-print" id="gl-excel"><i class="fa-solid fa-file-csv"></i> Excel</button>' +
                    '</div>' +
                '</div>' +
                '<div id="gl-account-info"></div>' +
                '<div class="gl-table-wrap" id="gl-table"><div style="text-align:center;padding:40px;color:var(--text-muted)">اختر الحساب أو اترك الكل ثم اضغط "عرض"</div></div>' +
                '<div id="gl-totals"></div>' +
                '<div id="gl-pagination"></div>' +
            '</div></div>';

        if (currentAccountId) document.getElementById('gl-account').value = currentAccountId;
        bindEvents();
    }

    function bindEvents() {
        document.getElementById('gl-refresh').onclick = function () { currentPage = 1; loadData(); };
        document.getElementById('gl-print').onclick = printReport;
        document.getElementById('gl-excel').onclick = exportCsv;
        document.getElementById('gl-to').addEventListener('keydown', function (e) { if (e.key === 'Enter') { currentPage = 1; loadData(); } });
        document.getElementById('gl-from').addEventListener('keydown', function (e) { if (e.key === 'Enter') { currentPage = 1; loadData(); } });
        document.getElementById('gl-search').addEventListener('keydown', function (e) { if (e.key === 'Enter') { currentPage = 1; loadData(); } });
    }

    function loadData() {
        var container = document.getElementById('gl-table');
        if (!container) return;
        container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)"><i class="fa-solid fa-spinner fa-spin" style="font-size:1.5rem"></i><p style="margin-top:8px">جاري التحميل...</p></div>';

        currentAccountId = document.getElementById('gl-account').value;

        var params = {
            from: document.getElementById('gl-from').value,
            to: document.getElementById('gl-to').value,
            includeOpening: document.getElementById('gl-include-opening').checked ? 'true' : 'false',
            page: currentPage,
            pageSize: 50,
            search: document.getElementById('gl-search').value,
            reference_type: document.getElementById('gl-ref-type').value
        };
        if (currentAccountId) params.accountId = currentAccountId;

        ReportUtils.apiFetch('/accounting/general-ledger', params).then(function (res) {
            if (!res.success) {
                ReportTable.render('gl-table', columns, [], { state: 'error', errorMessage: res.message });
                return;
            }
            currentData = res;
            if (currentAccountId) {
                renderSingleAccount(res);
            } else {
                renderAllAccounts(res);
            }
        }).catch(function (err) {
            ReportTable.render('gl-table', columns, [], { state: 'error', errorMessage: err.message });
        });
    }

    function buildRows(lines) {
        var rows = [];
        if (!lines) return rows;
        for (var i = 0; i < lines.length; i++) {
            var r = lines[i];
            var linkHtml = '';
            if (r.journal_id && r.ref_number) {
                linkHtml = '<span class="gl-journal-link" data-journal-id="' + r.journal_id + '" data-ref-number="' + ReportUtils.esc(r.ref_number) + '">' + ReportUtils.esc(r.ref_number) + '</span>';
            }
            rows.push({
                _className: r.is_opening ? 'gl-opening-row' : '',
                entry_date: r.entry_date ? r.entry_date.split('T')[0] : '',
                journal_no_link: linkHtml,
                reference: r.reference_type ? refTypeLabel(r.reference_type) + ' ' + ReportUtils.esc(r.ref_number || '') : '',
                description: r.description || '',
                debit: r.debit || 0,
                credit: r.credit || 0,
                _balType: r.running_balance_type || 'Dr',
                running_balance: r.running_balance || 0
            });
        }
        return rows;
    }

    function renderSingleAccount(res) {
        var info = document.getElementById('gl-account-info');
        if (res.account) {
            var typeMap = { asset: 'أصول', liability: 'خصوم', equity: 'حقوق ملكية', income: 'إيرادات', expense: 'مصروفات' };
            info.innerHTML = '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px;padding:8px 12px;background:var(--bg-muted,#f8f9fa);border-radius:8px">' +
                '<span><strong>' + ReportUtils.esc(res.account.code) + '</strong> - ' + ReportUtils.esc(res.account.name) + '</span>' +
                '<span>النوع: ' + (typeMap[res.account.type] || res.account.type) + '</span>' +
                '<span>إجمالي الحركات: ' + (res.total || 0) + '</span>' +
            '</div>';
        }
        ReportTable.render('gl-table', columns, buildRows(res.data));
        renderTotals(res.totals, res.closingBalance);
        if (res.totalPages > 1) {
            Pagination.render('gl-pagination', { page: res.page, pageSize: res.pageSize, total: res.total, onChange: goToPage });
        } else {
            document.getElementById('gl-pagination').innerHTML = '';
        }
        bindJournalClicks();
    }

    function renderAllAccounts(res) {
        document.getElementById('gl-account-info').innerHTML = '<div style="padding:8px 0;color:var(--text-muted)">الأستاذ العام — جميع الحسابات</div>';

        var flatRows = [];
        var allTotals = { debit: 0, credit: 0 };

        for (var ai = 0; ai < (res.accounts || []).length; ai++) {
            var acc = res.accounts[ai];
            flatRows.push({
                _className: '',
                entry_date: '<strong>' + ReportUtils.esc(acc.account.code) + ' - ' + ReportUtils.esc(acc.account.name) + '</strong>',
                journal_no_link: '', reference: '', description: '', debit: '', credit: '',
                _balType: 'Dr', running_balance: ''
            });
            flatRows = flatRows.concat(buildRows(acc.data));
            allTotals.debit = ReportUtils.r2(allTotals.debit + (acc.totals ? acc.totals.debit : 0));
            allTotals.credit = ReportUtils.r2(allTotals.credit + (acc.totals ? acc.totals.credit : 0));
        }

        if (flatRows.length === 0) {
            ReportTable.render('gl-table', columns, [], { state: 'empty', emptyMessage: 'لا توجد نتائج للفترة المحددة' });
        } else {
            ReportTable.render('gl-table', columns, flatRows);
        }
        renderTotals(allTotals, allTotals);
        if (res.totalPages > 1) {
            Pagination.render('gl-pagination', { page: res.page, pageSize: res.pageSize, total: res.total, onChange: goToPage });
        } else {
            document.getElementById('gl-pagination').innerHTML = '';
        }
        bindJournalClicks();
    }

    function bindJournalClicks() {
        document.querySelectorAll('.gl-journal-link').forEach(function (el) {
            el.addEventListener('click', function (e) {
                e.stopPropagation();
                var jId = parseInt(this.getAttribute('data-journal-id'));
                var refNum = this.getAttribute('data-ref-number');
                if (jId) showJournalDetail(jId, refNum);
            });
        });
    }

    function showJournalDetail(journalId, refNumber) {
        var modal = document.getElementById('global-modal');
        if (!modal) return;
        var body = modal.querySelector('.modal-body');
        var title = modal.querySelector('.modal-title') || document.getElementById('modal-title');
        var footer = modal.querySelector('.modal-footer');
        if (!body || !title) return;

        if (footer) footer.style.display = 'none';

        title.textContent = 'جاري تحميل تفاصيل القيد...';
        body.innerHTML = '<div style="text-align:center;padding:40px"><i class="fa-solid fa-spinner fa-spin" style="font-size:2rem"></i></div>';
        modal.classList.add('open');

        var searchTerm = refNumber || '#' + journalId;
        ReportUtils.apiFetch('/accounting/journals/browser?pageSize=1&search=' + encodeURIComponent(searchTerm)).then(function (res) {
            if (!res.success || !res.data || res.data.length === 0) {
                body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger-color)">لم يتم العثور على القيد</div>';
                title.textContent = 'خطأ';
                return;
            }
            var je = res.data[0];
            for (var ci = 1; ci < res.data.length; ci++) {
                if (Number(res.data[ci].id) === journalId) { je = res.data[ci]; break; }
            }
            title.textContent = 'تفاصيل القيد رقم ' + ReportUtils.esc(je.entry_no || je.id);

            var linesHtml = '<table class="data-table" style="width:100%"><thead><tr><th>الحساب</th><th>البيان</th><th>مدين</th><th>دائن</th></tr></thead><tbody>';
            if (je.lines) {
                for (var i = 0; i < je.lines.length; i++) {
                    var l = je.lines[i];
                    linesHtml += '<tr><td>' + ReportUtils.esc(l.account_code || '') + ' - ' + ReportUtils.esc(l.account_name || '') + '</td><td>' + ReportUtils.esc(l.description || '') + '</td><td style="text-align:center">' + (l.debit ? ReportUtils.fmt(l.debit) : '') + '</td><td style="text-align:center">' + (l.credit ? ReportUtils.fmt(l.credit) : '') + '</td></tr>';
                }
            }
            linesHtml += '</tbody></table>';
            linesHtml += '<div style="display:flex;gap:24px;margin-top:12px;padding-top:12px;border-top:1px solid var(--border-color);font-weight:700;flex-wrap:wrap">' +
                '<span>التاريخ: ' + ReportUtils.esc(je.entry_date || '') + '</span>' +
                '<span>النوع: ' + ReportUtils.esc(refTypeLabel(je.reference_type) || '') + '</span>' +
                '<span>إجمالي المدين: ' + ReportUtils.fmt(je.total_debit || 0) + '</span>' +
                '<span>إجمالي الدائن: ' + ReportUtils.fmt(je.total_credit || 0) + '</span>' +
            '</div>';
            body.innerHTML = linesHtml;
        }).catch(function (err) {
            body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger-color)">' + ReportUtils.esc(err.message) + '</div>';
            title.textContent = 'خطأ';
        });
    }

    function renderTotals(totals, closing) {
        var el = document.getElementById('gl-totals');
        if (!totals) { el.innerHTML = ''; return; }
        var cls = closing && closing.debit > 0 ? 'gl-running-dr' : 'gl-running-cr';
        var label = closing && closing.debit > 0 ? 'د' : 'ائ';
        el.innerHTML =
            '<div style="display:flex;gap:24px;flex-wrap:wrap;padding:12px 0;border-top:2px solid var(--border-color);font-weight:700">' +
                '<span>إجمالي المدين: <span style="color:var(--primary-color)">' + ReportUtils.fmt(totals.debit) + '</span></span>' +
                '<span>إجمالي الدائن: <span style="color:var(--primary-color)">' + ReportUtils.fmt(totals.credit) + '</span></span>' +
                '<span>رصيد آخر المدة: <span class="' + cls + '">' + ReportUtils.fmt(closing ? (closing.debit || closing.credit) : 0) + ' ' + label + '</span></span>' +
            '</div>';
    }

    function goToPage(p) {
        currentPage = p;
        loadData();
    }

    function printReport() {
        var table = document.querySelector('#gl-table table');
        if (!table) { window.showAlert('لا توجد بيانات للطباعة', { title: 'تنبيه', type: 'warning' }); return; }

        var rowsHtml = '';
        var rows = table.querySelectorAll('tbody tr');
        rows.forEach(function (tr) {
            var tds = tr.querySelectorAll('td');
            if (tds.length === 0 || (tds.length === 1 && tds[0].hasAttribute('colspan'))) return;
            var bg = tr.classList.contains('gl-opening-row') ? ' style="background:#f0f0f0;font-weight:600"' : '';
            rowsHtml += '<tr' + bg + '>';
            tds.forEach(function (td) { rowsHtml += '<td style="padding:4px 8px;border:1px solid #ccc;font-size:11px">' + td.innerHTML + '</td>'; });
            rowsHtml += '</tr>';
        });

        var accName = currentAccountId ? document.getElementById('gl-account').options[document.getElementById('gl-account').selectedIndex].text : 'الأستاذ العام';
        PrintService.popup(accName, rowsHtml, ['التاريخ', 'رقم القيد', 'المرجع', 'البيان', 'مدين', 'دائن', 'الرصيد']);
    }

    function exportCsv() {
        var table = document.querySelector('#gl-table table');
        if (!table) { window.showAlert('لا توجد بيانات للتصدير', { title: 'تنبيه', type: 'warning' }); return; }

        var rows = [];
        var from = document.getElementById('gl-from').value || 'البداية';
        var toDoc = document.getElementById('gl-to').value || 'النهاية';
        var accName = currentAccountId ? document.getElementById('gl-account').options[document.getElementById('gl-account').selectedIndex].text : 'الأستاذ العام';

        rows.push([accName, '', '', '', '', '', '']);
        rows.push(['من ' + from + ' إلى ' + toDoc, '', '', '', '', '', '']);
        rows.push(['', '', '', '', '', '', '']);
        rows.push(['التاريخ', 'رقم القيد', 'المرجع', 'البيان', 'مدين', 'دائن', 'الرصيد']);

        var allRows = table.querySelectorAll('tbody tr');
        allRows.forEach(function (tr) {
            var tds = tr.querySelectorAll('td');
            if (tds.length === 0 || (tds.length === 1 && tds[0].hasAttribute('colspan'))) return;
            var row = [];
            tds.forEach(function (td) { row.push(td.textContent.trim()); });
            rows.push(row);
        });

        var filename = 'ledger-' + (from.replace(/-/g, '')) + '-' + (toDoc.replace(/-/g, '')) + '.csv';
        ExportService.exportReport('csv', { filename: filename, headers: [], rows: rows });
    }

    window.loadLedger = function () {
        var root = document.getElementById('ledger-root');
        if (!root) return;
        if (root.dataset.bound) return;
        root.dataset.bound = '1';

        injectStyles();

        root.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-muted)"><i class="fa-solid fa-spinner fa-spin" style="font-size:2rem"></i><p style="margin-top:12px">جاري تحميل الحسابات...</p></div>';

        ReportUtils.apiFetch('/accounting/accounts', {}).then(function (res) {
            if (res.success) allAccounts = res.data || [];
            renderPage();
        }).catch(function (err) {
            root.innerHTML = '<div class="empty-state"><i class="fa-solid fa-exclamation-triangle" style="font-size:3rem;color:var(--danger-color,#dc2626);margin-bottom:16px"></i><h3>خطأ</h3><p style="color:var(--text-muted)">' + ReportUtils.esc(err.message) + '</p></div>';
        });
    };
})();
