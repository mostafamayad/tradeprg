(function () {
    'use strict';

    var currentPage = 1;
    var PAGE_SIZE = 25;
    var currentParams = {};

    var refTypeOptions = [
        { label: '--- الكل ---', value: '' },
        { label: 'قيد يدوي', value: 'manual_je' },
        { label: 'مبيعات', value: 'sales_invoice' },
        { label: 'مشتريات', value: 'purchase_invoice' },
        { label: 'مرتجع مبيعات', value: 'sales_return' },
        { label: 'مرتجع مشتريات', value: 'purchase_return' },
        { label: 'تحصيل', value: 'ar_payment' },
        { label: 'دفع', value: 'ap_payment' },
        { label: 'خزينة', value: 'treasury' },
        { label: 'إشعار مدين', value: 'ar_note' },
        { label: 'إشعار دائن', value: 'ap_note' },
        { label: 'شيك مقبوض', value: 'ar_cheque' },
        { label: 'شيك مدفوع', value: 'ap_cheque' },
        { label: 'افتتاحي', value: 'opening_balance' },
        { label: 'إقفال سنوي', value: 'year_close' }
    ];

    var columns = [
        { key: 'entry_date',      label: 'التاريخ',   align: 'center', width: '90px', formatter: function (v) { return v || ''; } },
        { key: 'entry_no_link',   label: 'رقم القيد', align: 'center', width: '110px', formatter: function (v) { return v || ''; } },
        { key: 'description',     label: 'البيان',    align: 'right' },
        { key: 'reference_type_label', label: 'النوع',   align: 'center', width: '100px' },
        { key: 'source_document', label: 'المستند',   align: 'center', width: '100px' },
        { key: 'source_module',   label: 'الوحدة',    align: 'center', width: '80px' },
        { key: 'total_debit',     label: 'مدين',      align: 'center', width: '100px', formatter: function (v) { return v ? ReportUtils.fmt(v) : ''; } },
        { key: 'total_credit',    label: 'دائن',      align: 'center', width: '100px', formatter: function (v) { return v ? ReportUtils.fmt(v) : ''; } }
    ];

    function injectStyles() {
        ReportLayout.injectStyles('ji', '\
            .ji-filter-bar { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; align-items: flex-end; }\
            .ji-filter-bar .form-group { margin-bottom: 0; min-width: 130px; }\
            .ji-filter-bar input, .ji-filter-bar select { padding: 5px 8px; font-size: 0.85rem; }\
            .ji-table-wrap { overflow-x: auto; }\
            .ji-table-wrap .data-table th, .ji-table-wrap .data-table td { white-space: nowrap; font-size: 0.82rem; }\
            .ji-table-wrap .data-table td { text-align: center; }\
            .ji-table-wrap .data-table td:nth-child(3) { text-align: right; max-width: 200px; overflow: hidden; text-overflow: ellipsis; }\
            .ji-entry-link { color: var(--primary-color, #7c3aed); cursor: pointer; text-decoration: underline; }\
            .ji-entry-link:hover { color: var(--primary-hover, #6d28d9); }\
            .ji-modal-lines td { padding: 6px 10px; }\
            .ji-total-row td { font-weight: 700; border-top: 2px solid var(--border-color); }\
            @media print { .no-print { display: none !important; } }\
        ');
    }

    function refTypeLabel(v) {
        for (var i = 0; i < refTypeOptions.length; i++) {
            if (refTypeOptions[i].value === v) return refTypeOptions[i].label;
        }
        return v || '';
    }

    function buildRows(data) {
        if (!data) return [];
        return data.map(function (r) {
            var linkHtml = '';
            if (r.id && r.entry_no) {
                linkHtml = '<span class="ji-entry-link" data-entry-id="' + r.id + '" data-entry-no="' + ReportUtils.esc(r.entry_no) + '">' + ReportUtils.esc(r.entry_no) + '</span>';
            }
            return {
                entry_date: r.entry_date ? r.entry_date.split('T')[0] : '',
                entry_no_link: linkHtml,
                description: r.description || '',
                reference_type_label: refTypeLabel(r.reference_type),
                source_document: r.source_document || '',
                source_module: r.source_module || '',
                total_debit: r.total_debit || 0,
                total_credit: r.total_credit || 0,
                _raw: r
            };
        });
    }

    function renderPage() {
        var root = document.getElementById('journal-inquiry-root');
        if (!root) return;
        var today = ReportUtils.todayStr();
        var firstOfYear = new Date().getFullYear() + '-01-01';

        var refSelect = '<option value="">--- الكل ---</option>';
        for (var i = 0; i < refTypeOptions.length; i++) {
            if (!refTypeOptions[i].value) continue;
            refSelect += '<option value="' + refTypeOptions[i].value + '">' + refTypeOptions[i].label + '</option>';
        }

        root.innerHTML =
            '<div class="page-section"><div class="page-card" style="min-height:200px">' +
                '<div class="page-card-header"><div class="page-card-title"><i class="fa-solid fa-magnifying-glass"></i> الاستعلام عن القيود</div></div>' +
                '<div class="ji-filter-bar">' +
                    '<div class="form-group"><label>من تاريخ</label><input type="date" id="ji-from" class="form-control" value="' + firstOfYear + '"></div>' +
                    '<div class="form-group"><label>إلى تاريخ</label><input type="date" id="ji-to" class="form-control" value="' + today + '"></div>' +
                    '<div class="form-group"><label>رقم القيد</label><input type="text" id="ji-entry-no" class="form-control" placeholder="مثال: JV-00001"></div>' +
                    '<div class="form-group"><label>بحث</label><input type="text" id="ji-search" class="form-control" placeholder="وصف القيد"></div>' +
                    '<div class="form-group"><label>النوع</label><select id="ji-ref-type" class="form-control">' + refSelect + '</select></div>' +
                    '<div class="form-group"><label>المستند</label><input type="text" id="ji-source-doc" class="form-control" placeholder="رقم المستند"></div>' +
                    '<div class="form-group" style="display:flex;gap:6px;align-items:flex-end">' +
                        '<button class="btn btn-primary" id="ji-search-btn"><i class="fa-solid fa-search"></i> بحث</button>' +
                        '<button class="btn btn-outline" id="ji-reset-btn"><i class="fa-solid fa-undo"></i> إعادة</button>' +
                        '<button class="btn btn-outline no-print" id="ji-print-btn"><i class="fa-solid fa-print"></i> طباعة</button>' +
                        '<button class="btn btn-outline no-print" id="ji-csv-btn"><i class="fa-solid fa-file-csv"></i> Excel</button>' +
                    '</div>' +
                '</div>' +
                '<div class="ji-table-wrap" id="ji-table"><div style="text-align:center;padding:40px;color:var(--text-muted)"><i class="fa-solid fa-info-circle"></i> استخدم الفلاتر واضغط "بحث"</div></div>' +
                '<div id="ji-pagination"></div>' +
            '</div></div>';

        bindEvents();
    }

    function bindEvents() {
        document.getElementById('ji-search-btn').onclick = function () { currentPage = 1; loadData(); };
        document.getElementById('ji-reset-btn').onclick = resetFilters;
        document.getElementById('ji-print-btn').onclick = printReport;
        document.getElementById('ji-csv-btn').onclick = exportCsv;
        document.getElementById('ji-to').addEventListener('keydown', function (e) { if (e.key === 'Enter') { currentPage = 1; loadData(); } });
        document.getElementById('ji-search').addEventListener('keydown', function (e) { if (e.key === 'Enter') { currentPage = 1; loadData(); } });
        document.getElementById('ji-entry-no').addEventListener('keydown', function (e) { if (e.key === 'Enter') { currentPage = 1; loadData(); } });
    }

    function getParams() {
        return {
            from: document.getElementById('ji-from').value,
            to: document.getElementById('ji-to').value,
            entry_no: document.getElementById('ji-entry-no').value,
            search: document.getElementById('ji-search').value,
            ref_type: document.getElementById('ji-ref-type').value,
            source_document: document.getElementById('ji-source-doc').value,
            page: currentPage,
            pageSize: PAGE_SIZE,
            sortBy: 'entry_date',
            sortDirection: 'DESC'
        };
    }

    function setParams(p) {
        if (p.from) document.getElementById('ji-from').value = p.from;
        if (p.to) document.getElementById('ji-to').value = p.to;
        if (p.entry_no) document.getElementById('ji-entry-no').value = p.entry_no;
        if (p.search) document.getElementById('ji-search').value = p.search;
        if (p.ref_type) document.getElementById('ji-ref-type').value = p.ref_type;
        if (p.source_document) document.getElementById('ji-source-doc').value = p.source_document;
    }

    function resetFilters() {
        var today = ReportUtils.todayStr();
        document.getElementById('ji-from').value = '';
        document.getElementById('ji-to').value = today;
        document.getElementById('ji-entry-no').value = '';
        document.getElementById('ji-search').value = '';
        document.getElementById('ji-ref-type').value = '';
        document.getElementById('ji-source-doc').value = '';
        currentPage = 1;
        loadData();
    }

    function loadData() {
        var table = document.getElementById('ji-table');
        if (!table) return;
        ReportTable.render('ji-table', columns, [], { state: 'loading' });

        currentParams = getParams();
        var params = {};
        for (var k in currentParams) {
            if (currentParams[k] !== '' && currentParams[k] !== null && currentParams[k] !== undefined) {
                params[k] = currentParams[k];
            }
        }

        ReportUtils.apiFetch('/accounting/journals/browser', params).then(function (res) {
            if (!res.success) {
                ReportTable.render('ji-table', columns, [], { state: 'error', errorMessage: res.message });
                return;
            }
            if (!res.data || res.data.length === 0) {
                ReportTable.render('ji-table', columns, [], { state: 'empty', emptyMessage: 'لا توجد قيود بالفترة المحددة' });
                document.getElementById('ji-pagination').innerHTML = '';
                return;
            }
            ReportTable.render('ji-table', columns, buildRows(res.data));
            var pg = res.pagination || {};
            if (pg.totalPages > 1) {
                Pagination.render('ji-pagination', { page: pg.page, pageSize: pg.pageSize, total: pg.total, onChange: goToPage });
            } else {
                document.getElementById('ji-pagination').innerHTML = '';
            }
            bindEntryClicks();
        }).catch(function (err) {
            ReportTable.render('ji-table', columns, [], { state: 'error', errorMessage: err.message });
        });
    }

    function goToPage(p) {
        currentPage = p;
        loadData();
    }

    function bindEntryClicks() {
        document.querySelectorAll('.ji-entry-link').forEach(function (el) {
            el.addEventListener('click', function (e) {
                e.stopPropagation();
                var eId = parseInt(this.getAttribute('data-entry-id'));
                var eNo = this.getAttribute('data-entry-no');
                if (eId) showEntryDetail(eId, eNo);
            });
        });
    }

    function showEntryDetail(entryId, entryNo) {
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

        ReportUtils.apiFetch('/accounting/journals/browser?entry_no=' + encodeURIComponent(entryNo), {}).then(function (res) {
            if (!res.success || !res.data || res.data.length === 0) {
                body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger-color)">لم يتم العثور على القيد</div>';
                title.textContent = 'خطأ';
                return;
            }
            var je = res.data[0];

            title.textContent = 'تفاصيل القيد - ' + ReportUtils.esc(je.entry_no);

            var h = '<div style="margin-bottom:12px">' +
                '<button class="btn btn-sm btn-outline no-print" onclick="copyToClipboard(\'' + ReportUtils.esc(je.entry_no) + '\')" style="margin-bottom:8px"><i class="fa-solid fa-copy"></i> نسخ رقم القيد</button>' +
            '</div>';

            var statusBadge = '';
            if (je.is_reversed) {
                statusBadge = ' <span class="badge badge-danger" style="background:#dc2626;color:#fff;padding:2px 8px;border-radius:4px;font-size:0.75rem">ملغي</span>';
            } else if (je.is_system_generated) {
                statusBadge = ' <span class="badge badge-info" style="background:#6366f1;color:#fff;padding:2px 8px;border-radius:4px;font-size:0.75rem">نظامي</span>';
            }

            h += '<div style="display:flex;gap:16px;flex-wrap:wrap;padding:10px 14px;background:var(--bg-muted,#f8f9fa);border-radius:8px;margin-bottom:14px">' +
                '<span><strong>رقم القيد:</strong> ' + ReportUtils.esc(je.entry_no) + statusBadge + '</span>' +
                '<span><strong>التاريخ:</strong> ' + ReportUtils.esc(je.entry_date || '') + '</span>' +
                '<span><strong>النوع:</strong> ' + ReportUtils.esc(refTypeLabel(je.reference_type)) + '</span>' +
                '<span><strong>الوحدة:</strong> ' + ReportUtils.esc(je.source_module || '') + '</span>' +
                (je.source_document ? '<span><strong>المستند:</strong> ' + ReportUtils.esc(je.source_document) + '</span>' : '') +
                '<span style="width:100%"><strong>البيان:</strong> ' + ReportUtils.esc(je.description || '') + '</span>' +
            '</div>';

            h += '<table class="data-table ji-modal-lines" style="width:100%"><thead><tr><th>الحساب</th><th>البيان</th><th style="text-align:center">مدين</th><th style="text-align:center">دائن</th></tr></thead><tbody>';
            if (je.lines) {
                for (var i = 0; i < je.lines.length; i++) {
                    var l = je.lines[i];
                    h += '<tr><td>' + ReportUtils.esc(l.account_code || '') + ' - ' + ReportUtils.esc(l.account_name || '') + '</td><td>' + ReportUtils.esc(l.description || '') + '</td><td style="text-align:center">' + (l.debit ? ReportUtils.fmt(l.debit) : '') + '</td><td style="text-align:center">' + (l.credit ? ReportUtils.fmt(l.credit) : '') + '</td></tr>';
                }
            }
            h += '</tbody></table>';
            h += '<div style="display:flex;gap:24px;margin-top:10px;padding-top:10px;border-top:2px solid var(--border-color);font-weight:700;flex-wrap:wrap">' +
                '<span>إجمالي المدين: <span style="color:var(--primary-color)">' + ReportUtils.fmt(je.total_debit || 0) + '</span></span>' +
                '<span>إجمالي الدائن: <span style="color:var(--primary-color)">' + ReportUtils.fmt(je.total_credit || 0) + '</span></span>' +
                (je.is_reversed ? '<span style="color:#dc2626">ملغي - قيد معكوس</span>' : '') +
                (je.reversal_of_id ? '<span>مرجع الإلغاء: ' + ReportUtils.esc(je.reversal_of_id || '') + '</span>' : '') +
            '</div>';

            body.innerHTML = h;
        }).catch(function (err) {
            body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger-color)">' + ReportUtils.esc(err.message) + '</div>';
            title.textContent = 'خطأ';
        });
    }

    window.copyToClipboard = function (text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                if (window.showAlert) window.showAlert('تم نسخ رقم القيد: ' + text, { title: 'تم', type: 'success' });
            }).catch(function () {
                fallbackCopy(text);
            });
        } else {
            fallbackCopy(text);
        }
    };

    function fallbackCopy(text) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand('copy');
            if (window.showAlert) window.showAlert('تم نسخ رقم القيد: ' + text, { title: 'تم', type: 'success' });
        } catch (e) {
            if (window.showAlert) window.showAlert('تعذر النسخ', { title: 'خطأ', type: 'error' });
        }
        document.body.removeChild(ta);
    }

    function printReport() {
        var t = document.querySelector('#ji-table table');
        if (!t) { if (window.showAlert) window.showAlert('لا توجد بيانات للطباعة', { title: 'تنبيه', type: 'warning' }); return; }

        var rowsHtml = '';
        t.querySelectorAll('tbody tr').forEach(function (tr) {
            var tds = tr.querySelectorAll('td');
            if (tds.length === 0 || (tds.length === 1 && tds[0].hasAttribute('colspan'))) return;
            rowsHtml += '<tr>';
            tds.forEach(function (td) { rowsHtml += '<td style="padding:4px 8px;border:1px solid #ccc;font-size:11px;text-align:center">' + td.innerHTML + '</td>'; });
            rowsHtml += '</tr>';
        });

        PrintService.popup('الاستعلام عن القيود', rowsHtml, ['التاريخ', 'رقم القيد', 'البيان', 'النوع', 'المستند', 'الوحدة', 'مدين', 'دائن']);
    }

    function exportCsv() {
        var t = document.querySelector('#ji-table table');
        if (!t) { if (window.showAlert) window.showAlert('لا توجد بيانات للتصدير', { title: 'تنبيه', type: 'warning' }); return; }

        var rows = [];
        var from = document.getElementById('ji-from').value || 'البداية';
        var toDoc = document.getElementById('ji-to').value || 'النهاية';

        rows.push(['الاستعلام عن القيود', '', '', '', '', '', '', '']);
        rows.push(['من ' + from + ' إلى ' + toDoc, '', '', '', '', '', '', '']);
        rows.push([]);
        rows.push(['التاريخ', 'رقم القيد', 'البيان', 'النوع', 'المستند', 'الوحدة', 'مدين', 'دائن']);

        t.querySelectorAll('tbody tr').forEach(function (tr) {
            var tds = tr.querySelectorAll('td');
            if (tds.length === 0 || (tds.length === 1 && tds[0].hasAttribute('colspan'))) return;
            var row = [];
            tds.forEach(function (td) { row.push(td.textContent.trim()); });
            rows.push(row);
        });

        ExportService.exportReport('csv', { filename: 'journal-inquiry-' + (from.replace(/-/g, '')) + '-' + (toDoc.replace(/-/g, '')) + '.csv', headers: [], rows: rows });
    }

    window.loadJournalInquiry = function () {
        var root = document.getElementById('journal-inquiry-root');
        if (!root) return;
        if (root.dataset.bound) return;
        root.dataset.bound = '1';

        injectStyles();
        renderPage();
    };
})();
