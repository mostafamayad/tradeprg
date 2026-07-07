(function () {
    'use strict';

    var allAccounts = [];
    var journalEntries = [];
    var browserState = { page: 1, pageSize: 20, from: '', to: '', ref_type: '', ref_id: '', search: '', total: 0, totalPages: 0 };

    var esc = function (v) { return String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); };

    var r2 = function (n) { return Math.round(Number(n || 0) * 100) / 100; };

    var fmt = function (n) {
        return r2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    function apiFetch(endpoint, method, body) {
        var token = localStorage.getItem('auth_token');
        var opt = { method: method, headers: { 'Content-Type': 'application/json' } };
        if (token) opt.headers['Authorization'] = 'Bearer ' + token;
        if (body) opt.body = JSON.stringify(body);
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
        if (document.getElementById('jv-styles')) return;
        var s = document.createElement('style');
        s.id = 'jv-styles';
        s.textContent = '\
            .jv-form-card { min-height: 200px; }\
            .jv-form-card .page-card-header { margin-bottom: 24px; }\
            .jv-line-row { display: flex; gap: 10px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }\
            .jv-line-row select { flex: 2; min-width: 180px; }\
            .jv-line-row input[type="text"] { flex: 1; min-width: 100px; }\
            .jv-line-row input[type="number"] { flex: 1; min-width: 90px; }\
            .jv-line-row .btn-remove-line { flex-shrink: 0; }\
            .jv-totals { display: flex; gap: 24px; margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border-color); font-weight: 600; }\
            .jv-totals .jv-balanced { color: var(--success-color, #059669); }\
            .jv-totals .jv-unbalanced { color: var(--danger-color, #dc2626); }\
            .jv-list-card { min-height: 300px; }\
            .jv-list-card .data-table th { white-space: nowrap; }\
            .jv-filter-bar { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; align-items: flex-end; }\
            .jv-filter-bar .form-group { margin-bottom: 0; }\
            .jv-filter-bar input, .jv-filter-bar select { padding: 6px 10px; font-size: 0.9rem; }\
            .jv-pagination { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 12px; margin-top: 8px; }\
            .jv-pagination .btn { min-width: 36px; }\
            .jv-pagination span { font-size: 0.9rem; }\
            .jv-action-btn { padding: 4px 8px; font-size: 0.8rem; margin: 0 2px; }\
        ';
        document.head.appendChild(s);
    }

    function refTypeOptions() {
        var types = [
            { v: '', l: '--- الكل ---' },
            { v: 'manual_je', l: 'قيد يدوي' },
            { v: 'sales_invoice', l: 'فاتورة مبيعات' },
            { v: 'sales_return', l: 'مرتجع مبيعات' },
            { v: 'purchase_invoice', l: 'فاتورة مشتريات' },
            { v: 'purchase_return', l: 'مرتجع مشتريات' },
            { v: 'treasury', l: 'الخزينة' },
            { v: 'ar_payment', l: 'تحصيل عميل' },
            { v: 'ap_payment', l: 'دفع مورد' },
            { v: 'opening_balance', l: 'رصيد افتتاحي' },
            { v: 'year_close', l: 'إقفال سنوي' }
        ];
        var h = '';
        for (var i = 0; i < types.length; i++) {
            h += '<option value="' + types[i].v + '">' + types[i].l + '</option>';
        }
        return h;
    }

    function renderForm() {
        var root = document.getElementById('journals-root');
        if (!root) return;

        var today = new Date().toISOString().split('T')[0];

        root.innerHTML = '\
            <div class="page-card jv-form-card">\
                <div class="page-card-header">\
                    <div class="page-card-title"><i class="fa-solid fa-pen"></i> قيد يومية جديد</div>\
                </div>\
                <div style="display:flex;gap:16px;margin-bottom:20px;flex-wrap:wrap">\
                    <div class="form-group" style="flex:1;min-width:150px">\
                        <label>التاريخ <span style="color:var(--danger-color)">*</span></label>\
                        <input type="date" id="jv-date" value="' + today + '">\
                    </div>\
                    <div class="form-group" style="flex:2;min-width:200px">\
                        <label>الوصف <span style="color:var(--danger-color)">*</span></label>\
                        <input type="text" id="jv-desc" placeholder="وصف القيد..." maxlength="500">\
                    </div>\
                </div>\
                <div id="jv-lines-container"></div>\
                <div style="margin-top:12px">\
                    <button class="btn btn-outline" id="btn-add-line"><i class="fa-solid fa-plus"></i> إضافة سطر</button>\
                </div>\
                <div class="jv-totals" id="jv-totals">\
                    <span>إجمالي المدين: <span id="jv-total-debit">0.00</span></span>\
                    <span>إجمالي الدائن: <span id="jv-total-credit">0.00</span></span>\
                    <span id="jv-balance-indicator" style="font-weight:700">غير متزن</span>\
                </div>\
                <div style="margin-top:16px;text-align:left">\
                    <button class="btn btn-primary" id="btn-save-journal"><i class="fa-solid fa-floppy-disk"></i> حفظ القيد</button>\
                </div>\
                <div id="jv-error" style="color:var(--danger-color,#dc2626);margin-top:12px;display:none"></div>\
            </div>\
            <div class="page-card jv-list-card">\
                <div class="page-card-header">\
                    <div class="page-card-title"><i class="fa-solid fa-list"></i> سجل القيود اليومية</div>\
                </div>\
                <div class="jv-filter-bar">\
                    <div class="form-group"><label>من تاريخ</label><input type="date" id="jv-filter-from"></div>\
                    <div class="form-group"><label>إلى تاريخ</label><input type="date" id="jv-filter-to"></div>\
                    <div class="form-group"><label>النوع</label><select id="jv-filter-ref">' + refTypeOptions() + '</select></div>\
                    <div class="form-group"><label>رقم المرجع</label><input type="text" id="jv-filter-refid" placeholder="ARN, PIN..." style="width:100px"></div>\
                    <div class="form-group"><label>بحث</label><input type="text" id="jv-filter-search" placeholder="وصف أو رقم القيد..." style="width:150px"></div>\
                    <div class="form-group"><button class="btn btn-primary" id="jv-filter-apply" style="margin-bottom:0"><i class="fa-solid fa-search"></i> بحث</button></div>\
                    <div class="form-group"><button class="btn btn-outline" id="jv-filter-clear"><i class="fa-solid fa-undo"></i></button></div>\
                </div>\
                <div class="page-table-wrap" style="overflow-x:auto">\
                    <table class="data-table" id="jv-table">\
                        <thead><tr><th>رقم القيد</th><th>التاريخ</th><th>الوصف</th><th>النوع</th><th>مدين</th><th>دائن</th><th></th></tr></thead>\
                        <tbody id="jv-table-body"><tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted)">جاري التحميل...</td></tr></tbody>\
                    </table>\
                </div>\
                <div class="jv-pagination" id="jv-pagination"></div>\
            </div>\
        ';

        addLine();
        bindEvents();
        loadBrowser();
    }

    function accountOptions() {
        var html = '';
        for (var i = 0; i < allAccounts.length; i++) {
            var a = allAccounts[i];
            var sysTag = a.system_code ? ' [نظامي]' : '';
            var inact = a.is_active === 0 ? ' [غير نشط]' : '';
            html += '<option value="' + a.id + '"' + (a.is_active === 0 ? ' style="color:var(--text-muted)"' : '') + '>' + esc(a.account_code) + ' - ' + esc(a.account_name) + sysTag + inact + '</option>';
        }
        return html;
    }

    function addLine(accId, debit, credit, desc) {
        var container = document.getElementById('jv-lines-container');
        if (!container) return;

        var div = document.createElement('div');
        div.className = 'jv-line-row';
        div.innerHTML = '\
            <select class="jv-account-sel">' + accountOptions() + '</select>\
            <input type="text" class="jv-line-desc" placeholder="وصف السطر" maxlength="200">\
            <input type="number" class="jv-line-debit" step="0.01" min="0" placeholder="مدين">\
            <input type="number" class="jv-line-credit" step="0.01" min="0" placeholder="دائن">\
            <button class="btn btn-sm btn-outline btn-remove-line"><i class="fa-solid fa-trash"></i></button>\
        ';

        if (accId) div.querySelector('.jv-account-sel').value = accId;
        if (debit) div.querySelector('.jv-line-debit').value = debit;
        if (credit) div.querySelector('.jv-line-credit').value = credit;
        if (desc) div.querySelector('.jv-line-desc').value = desc;

        container.appendChild(div);
        recalcTotals();
    }

    function recalcTotals() {
        var container = document.getElementById('jv-lines-container');
        if (!container) return;
        var totalDebit = 0;
        var totalCredit = 0;
        var rows = container.querySelectorAll('.jv-line-row');
        for (var i = 0; i < rows.length; i++) {
            totalDebit = r2(totalDebit + r2(rows[i].querySelector('.jv-line-debit').value));
            totalCredit = r2(totalCredit + r2(rows[i].querySelector('.jv-line-credit').value));
        }
        document.getElementById('jv-total-debit').textContent = fmt(totalDebit);
        document.getElementById('jv-total-credit').textContent = fmt(totalCredit);
        var indicator = document.getElementById('jv-balance-indicator');
        if (Math.abs(totalDebit - totalCredit) < 0.01) {
            indicator.textContent = 'متزن ✓';
            indicator.className = 'jv-balanced';
        } else {
            indicator.textContent = 'غير متزن (الفارق: ' + fmt(Math.abs(totalDebit - totalCredit)) + ')';
            indicator.className = 'jv-unbalanced';
        }
    }

    function bindEvents() {
        var container = document.getElementById('jv-lines-container');
        if (!container) return;

        container.addEventListener('input', function (e) {
            if (e.target.classList.contains('jv-line-debit') || e.target.classList.contains('jv-line-credit')) {
                recalcTotals();
            }
        });

        container.addEventListener('click', function (e) {
            if (e.target.closest('.btn-remove-line')) {
                var row = e.target.closest('.jv-line-row');
                if (row && document.querySelectorAll('.jv-line-row').length > 1) {
                    row.remove();
                    recalcTotals();
                }
            }
        });

        document.getElementById('btn-add-line').onclick = function () { addLine(); };
        document.getElementById('btn-save-journal').onclick = saveJournal;

        document.getElementById('jv-filter-apply').onclick = function () { applyFilters(); };
        document.getElementById('jv-filter-clear').onclick = function () {
            document.getElementById('jv-filter-from').value = '';
            document.getElementById('jv-filter-to').value = '';
            document.getElementById('jv-filter-ref').value = '';
            document.getElementById('jv-filter-refid').value = '';
            document.getElementById('jv-filter-search').value = '';
            applyFilters();
        };

        document.getElementById('jv-filter-search').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') applyFilters();
        });

        document.addEventListener('click', function (e) {
            var link = e.target.closest('.jv-view-lines');
            if (!link) return;
            e.preventDefault();
            showEntryModal(Number(link.dataset.id));
        });

        document.addEventListener('click', function (e) {
            var btn = e.target.closest('.jv-btn-print');
            if (!btn) return;
            e.preventDefault();
            printJournal(Number(btn.dataset.id));
        });

        document.addEventListener('click', function (e) {
            var btn = e.target.closest('.jv-btn-excel');
            if (!btn) return;
            e.preventDefault();
            exportJournalExcel(Number(btn.dataset.id));
        });

        document.addEventListener('click', function (e) {
            var btn = e.target.closest('.jv-btn-reverse');
            if (!btn) return;
            e.preventDefault();
            reverseJournal(Number(btn.dataset.id));
        });

        document.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-jv-page]');
            if (!btn) return;
            e.preventDefault();
            var p = parseInt(btn.dataset.jvPage);
            if (p >= 1 && p <= browserState.totalPages) {
                browserState.page = p;
                loadBrowser();
            }
        });
    }

    function saveJournal() {
        var date = document.getElementById('jv-date').value;
        var desc = document.getElementById('jv-desc').value.trim();

        if (!date || !desc) {
            showError('التاريخ والوصف مطلوبان');
            return;
        }

        var errors = [];
        var lines = [];
        var rows = document.querySelectorAll('.jv-line-row');
        for (var i = 0; i < rows.length; i++) {
            var accId = rows[i].querySelector('.jv-account-sel').value;
            var debit = r2(rows[i].querySelector('.jv-line-debit').value);
            var credit = r2(rows[i].querySelector('.jv-line-credit').value);
            var lDesc = rows[i].querySelector('.jv-line-desc').value.trim() || null;

            if (!accId) { errors.push('السطر ' + (i + 1) + ': لم يتم اختيار حساب'); continue; }
            if (debit === 0 && credit === 0) { errors.push('السطر ' + (i + 1) + ': المبلغ لا يمكن أن يكون صفر — أدخل مدين أو دائن'); continue; }
            if (debit > 0 && credit > 0) { errors.push('السطر ' + (i + 1) + ': لا يمكن إدخال مدين ودائن معًا في نفس السطر'); continue; }

            lines.push({ account_id: Number(accId), debit: debit, credit: credit, description: lDesc });
        }

        if (errors.length > 0) {
            showError(errors.join('<br>'));
            return;
        }

        if (lines.length < 2) {
            showError('يجب إضافة سطرين على الأقل (مدين ودائن)');
            return;
        }

        var totalD = 0, totalC = 0;
        for (var i = 0; i < lines.length; i++) {
            totalD = r2(totalD + lines[i].debit);
            totalC = r2(totalC + lines[i].credit);
        }
        if (Math.abs(totalD - totalC) >= 0.01) {
            showError('القيد غير متزن. يجب أن يتساوى إجمالي المدين مع إجمالي الدائن (الفارق: ' + fmt(Math.abs(totalD - totalC)) + ')');
            return;
        }

        hideError();
        var btn = document.getElementById('btn-save-journal');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';

        apiFetch('/accounting/journals', 'POST', { date: date, description: desc, lines: lines }).then(function (res) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> حفظ القيد';
            if (res.success) {
                clearForm();
                recalcTotals();
                focusFirstLine();
                applyFilters();
            } else {
                showError(res.message || 'حدث خطأ أثناء الحفظ');
            }
        }).catch(function (err) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> حفظ القيد';
            showError(err.message || 'خطأ في الاتصال');
        });
    }

    function focusFirstLine() {
        var first = document.querySelector('.jv-line-row .jv-account-sel');
        if (first) setTimeout(function () { first.focus(); }, 100);
    }

    function clearForm() {
        document.getElementById('jv-desc').value = '';
        var container = document.getElementById('jv-lines-container');
        container.innerHTML = '';
        addLine();
    }

    function showError(msg) {
        var el = document.getElementById('jv-error');
        if (el) { el.innerHTML = msg; el.style.display = 'block'; }
    }

    function hideError() {
        var el = document.getElementById('jv-error');
        if (el) el.style.display = 'none';
    }

    function refTypeLabel(v) {
        var map = {
            'manual_je': 'قيد يدوي',
            'sales_invoice': 'مبيعات',
            'sales_return': 'مرتجع مبيعات',
            'purchase_invoice': 'مشتريات',
            'purchase_return': 'مرتجع مشتريات',
            'treasury': 'خزينة',
            'ar_payment': 'تحصيل',
            'ap_payment': 'دفع',
            'opening_balance': 'افتتاحي',
            'year_close': 'إقفال سنوي'
        };
        return map[v] || v || '—';
    }

    function applyFilters() {
        browserState.from = document.getElementById('jv-filter-from').value;
        browserState.to = document.getElementById('jv-filter-to').value;
        browserState.ref_type = document.getElementById('jv-filter-ref').value;
        browserState.ref_id = document.getElementById('jv-filter-refid').value.trim();
        browserState.search = document.getElementById('jv-filter-search').value.trim();
        browserState.page = 1;
        loadBrowser();
    }

    function loadBrowser() {
        var tbody = document.getElementById('jv-table-body');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted)"><i class="fa-solid fa-spinner fa-spin"></i> جاري التحميل...</td></tr>';

        var q = '?page=' + browserState.page + '&pageSize=' + browserState.pageSize;
        if (browserState.from) q += '&from=' + encodeURIComponent(browserState.from);
        if (browserState.to) q += '&to=' + encodeURIComponent(browserState.to);
        if (browserState.ref_type) q += '&ref_type=' + encodeURIComponent(browserState.ref_type);
        if (browserState.ref_id) q += '&ref_id=' + encodeURIComponent(browserState.ref_id);
        if (browserState.search) q += '&search=' + encodeURIComponent(browserState.search);

        apiFetch('/accounting/journals/browser' + q, 'GET').then(function (res) {
            if (!res.success) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--danger-color)">' + esc(res.message || 'خطأ') + '</td></tr>';
                return;
            }
            journalEntries = res.data || [];
            browserState.total = res.total;
            browserState.totalPages = res.totalPages;
            renderBrowserTable();
            renderPagination();
        }).catch(function (err) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--danger-color)">' + esc(err.message) + '</td></tr>';
        });
    }

    function renderBrowserTable() {
        var tbody = document.getElementById('jv-table-body');
        if (!tbody) return;
        if (journalEntries.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted)">لا توجد قيود تطابق معايير البحث</td></tr>';
            return;
        }
        var html = '';
        for (var i = 0; i < journalEntries.length; i++) {
            var e = journalEntries[i];
            html += '<tr>\
                <td><strong>' + esc(e.entry_no || '#' + e.id) + '</strong></td>\
                <td>' + esc(e.entry_date) + '</td>\
                <td>' + esc(e.description || '') + '</td>\
                <td>' + refTypeLabel(e.reference_type) + '</td>\
                <td>' + fmt(e.total_debit) + '</td>\
                <td>' + fmt(e.total_credit) + '</td>\
                <td style="white-space:nowrap">\
                    <a href="#" class="jv-view-lines jv-action-btn" data-id="' + e.id + '" title="عرض"><i class="fa-solid fa-eye"></i></a>\
                    <a href="#" class="jv-btn-print jv-action-btn" data-id="' + e.id + '" title="طباعة"><i class="fa-solid fa-print"></i></a>\
                    <a href="#" class="jv-btn-excel jv-action-btn" data-id="' + e.id + '" title="Excel"><i class="fa-solid fa-file-excel"></i></a>\
                    ' + (e.is_reversed ? '<span style="color:var(--danger-color,#dc2626);font-size:0.8rem;margin-right:4px">ملغي</span>' : '<a href="#" class="jv-btn-reverse jv-action-btn" data-id="' + e.id + '" title="عكس القيد"><i class="fa-solid fa-undo"></i></a>') + '\
                </td></tr>';
        }
        tbody.innerHTML = html;
    }

    function renderPagination() {
        var el = document.getElementById('jv-pagination');
        if (!el) return;
        if (browserState.totalPages <= 1) { el.innerHTML = ''; return; }
        var p = browserState.page;
        var pp = browserState.totalPages;
        var h = '<span>الصفحة ' + p + ' من ' + pp + ' (' + browserState.total + ' قيد)</span>';
        h += '<button class="btn btn-sm btn-outline" data-jv-page="' + (p - 1) + '"' + (p <= 1 ? ' disabled' : '') + '>‹ السابق</button>';
        h += '<button class="btn btn-sm btn-outline" data-jv-page="' + (p + 1) + '"' + (p >= pp ? ' disabled' : '') + '>التالي ›</button>';
        el.innerHTML = h;
    }

    function findEntryById(id) {
        for (var i = 0; i < journalEntries.length; i++) {
            if (journalEntries[i].id === id) return journalEntries[i];
        }
        return null;
    }

    function showEntryModal(id) {
        var entry = findEntryById(id);
        if (!entry) return;
        var modal = document.getElementById('global-modal');
        if (!modal) return;
        modal.querySelector('.modal-body').innerHTML = '\
            <div style="margin-bottom:16px">\
                <div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:12px">\
                    <span><strong>رقم القيد:</strong> ' + esc(entry.entry_no || '#' + entry.id) + '</span>\
                    <span><strong>التاريخ:</strong> ' + esc(entry.entry_date) + '</span>\
                    <span><strong>النوع:</strong> ' + refTypeLabel(entry.reference_type) + '</span>\
                    <span><strong>الوصف:</strong> ' + esc(entry.description) + '</span>\
                </div>\
            </div>\
            <div style="overflow-x:auto">' + getEntryLinesHtml(entry) + '</div>\
        ';
        modal.classList.add('open');
    }

    function getEntryLinesHtml(entry) {
        var lines = entry.lines || [];
        var hasLineDesc = lines.some(function (l) { return l.description; });
        var h = '<table style="width:100%;border-collapse:collapse;font-size:0.9rem">';
        h += '<thead><tr style="border-bottom:1px solid var(--border-color)"><th style="padding:6px 8px;text-align:right">الحساب</th>';
        if (hasLineDesc) h += '<th style="padding:6px 8px;text-align:right">وصف السطر</th>';
        h += '<th style="padding:6px 8px;text-align:right">مدين</th><th style="padding:6px 8px;text-align:right">دائن</th></tr></thead><tbody>';
        for (var i = 0; i < lines.length; i++) {
            var l = lines[i];
            var accName = esc(l.account_code ? l.account_code + ' - ' + l.account_name : (function () { var a = allAccounts.find(function (x) { return x.id === l.account_id; }); return a ? a.account_code + ' - ' + a.account_name : '#' + l.account_id; })());
            h += '<tr style="border-bottom:1px solid var(--border-color-light)"><td style="padding:6px 8px">' + accName + '</td>';
            if (hasLineDesc) h += '<td style="padding:6px 8px">' + esc(l.description || '') + '</td>';
            h += '<td style="padding:6px 8px">' + (l.debit ? fmt(l.debit) : '') + '</td><td style="padding:6px 8px">' + (l.credit ? fmt(l.credit) : '') + '</td></tr>';
        }
        h += '</tbody></table>';
        h += '<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border-color);display:flex;gap:24px;font-weight:600">';
        h += '<span>إجمالي المدين: ' + fmt(entry.total_debit) + '</span>';
        h += '<span>إجمالي الدائن: ' + fmt(entry.total_credit) + '</span>';
        h += '</div>';
        return h;
    }

    function printJournal(id) {
        var entry = findEntryById(id);
        if (!entry) return;
        var lines = entry.lines || [];
        var linesHtml = '';
        for (var i = 0; i < lines.length; i++) {
            var l = lines[i];
            var accName = esc(l.account_code ? l.account_code + ' - ' + l.account_name : '#' + l.account_id);
            linesHtml += '<tr><td style="padding:6px 12px;border:1px solid #ccc">' + accName + '</td><td style="padding:6px 12px;border:1px solid #ccc">' + esc(l.description || '') + '</td><td style="padding:6px 12px;border:1px solid #ccc;text-align:left">' + (l.debit ? fmt(l.debit) : '') + '</td><td style="padding:6px 12px;border:1px solid #ccc;text-align:left">' + (l.credit ? fmt(l.credit) : '') + '</td></tr>';
        }
        var w = window.open('', '_blank', 'width=800,height=600');
        w.document.write('\
            <!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><title>قيد يومية - ' + esc(entry.entry_no) + '</title>\
            <style>\
                body { font-family: "Segoe UI", Arial, sans-serif; margin: 40px; color: #222; }\
                h2 { text-align: center; margin-bottom: 24px; }\
                .meta { display: flex; gap: 24px; margin-bottom: 20px; }\
                table { width: 100%; border-collapse: collapse; }\
                th { background: #f0f0f0; padding: 8px 12px; border: 1px solid #ccc; text-align: right; }\
                td { padding: 6px 12px; border: 1px solid #ccc; }\
                .totals { margin-top: 16px; display: flex; gap: 24px; font-weight: bold; }\
                @media print { body { margin: 20px; } }\
            </style></head><body>\
            <h2>سند قيد يومية</h2>\
            <div class="meta">\
                <span><strong>رقم القيد:</strong> ' + esc(entry.entry_no || '#' + entry.id) + '</span>\
                <span><strong>التاريخ:</strong> ' + esc(entry.entry_date) + '</span>\
                <span><strong>الوصف:</strong> ' + esc(entry.description || '') + '</span>\
            </div>\
            <table><thead><tr><th>الحساب</th><th>البيان</th><th>مدين</th><th>دائن</th></tr></thead><tbody>' + linesHtml + '</tbody></table>\
            <div class="totals"><span>إجمالي المدين: ' + fmt(entry.total_debit) + '</span><span>إجمالي الدائن: ' + fmt(entry.total_credit) + '</span></div>\
            <script>window.onload = function () { window.print(); };<' + '/script>\
            </body></html>\
        ');
        w.document.close();
    }

    function exportJournalExcel(id) {
        var entry = findEntryById(id);
        if (!entry) return;
        var lines = entry.lines || [];
        var rows = [['رقم القيد: ' + (entry.entry_no || '#' + entry.id), '', '', '']];
        rows.push(['التاريخ: ' + entry.entry_date, '', '', '']);
        rows.push(['الوصف: ' + (entry.description || ''), '', '', '']);
        rows.push(['', '', '', '']);
        rows.push(['الحساب', 'البيان', 'مدين', 'دائن']);
        for (var i = 0; i < lines.length; i++) {
            var l = lines[i];
            var accName = (l.account_code ? l.account_code + ' - ' + l.account_name : '#' + l.account_id);
            rows.push([accName, l.description || '', l.debit ? r2(l.debit) : '', l.credit ? r2(l.credit) : '']);
        }
        rows.push(['', '', '', '']);
        rows.push(['الإجمالي', '', r2(entry.total_debit), r2(entry.total_credit)]);

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
        link.download = (entry.entry_no || 'journal-' + entry.id) + '.csv';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    }

    function reverseJournal(journalId) {
        if (!confirm('هل أنت متأكد من عكس هذا القيد؟ سيتم إنشاء قيد عكسي جديد ولن يتم حذف القيد الأصلي.')) return;
        var desc = prompt('سبب العكس (اختياري):', '');
        var token = localStorage.getItem('auth_token');
        fetch('/api/accounting/journals/' + journalId + '/reverse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ description: desc || '' })
        }).then(function (r) {
            if (r.status === 401) { localStorage.removeItem('auth_token'); window.location.hash = '#login'; throw new Error('انتهت الجلسة'); }
            return r.json();
        }).then(function (res) {
            if (res.success) {
                alert(res.message);
                loadBrowser();
            } else {
                alert(res.message || 'خطأ في عكس القيد');
            }
        }).catch(function (err) {
            alert(err.message || 'خطأ في الاتصال');
        });
    }

    window.loadJournalVoucher = function () {
        var root = document.getElementById('journals-root');
        if (!root) return;
        if (root.dataset.bound) return;
        root.dataset.bound = '1';

        injectStyles();

        root.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-muted)"><i class="fa-solid fa-spinner fa-spin" style="font-size:2rem"></i><p style="margin-top:12px">جاري تحميل البيانات...</p></div>';

        apiFetch('/accounting/accounts', 'GET').then(function (res) {
            if (res.success) allAccounts = res.data || [];
            renderForm();
        }).catch(function (err) {
            root.innerHTML = '<div class="empty-state"><i class="fa-solid fa-exclamation-triangle" style="font-size:3rem;color:var(--danger-color,#dc2626);margin-bottom:16px"></i><h3>خطأ في الاتصال</h3><p style="color:var(--text-muted)">' + esc(err.message) + '</p></div>';
        });
    };

})();
