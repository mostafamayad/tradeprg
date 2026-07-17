(function() {
    'use strict';
    window.viewHandlers = window.viewHandlers || {};
    const viewHandlers = window.viewHandlers;

    const req = (...args) => window.req(...args);
    const fmt = (...args) => window.fmt(...args);
    const fmtPlain = (...args) => window.fmtPlain(...args);
    const fmtInt = (...args) => window.fmtInt(...args);
    const esc = (...args) => window.esc(...args);

    viewHandlers['view-reports-inventory'] = async function () {
        const view = document.getElementById('view-reports-inventory');
        if (!view) return;

        async function loadFilterOptions() {
            const storeSel = document.getElementById('inv-rpt-store');
            if (storeSel && storeSel.options.length <= 1) {
                const r = await req('/stores');
                if (r.success) (r.data || []).forEach(s => {
                    const o = document.createElement('option');
                    o.value = s.id; o.textContent = s.store_name;
                    storeSel.appendChild(o);
                });
            }
            const prodSel = document.getElementById('inv-rpt-product');
            if (prodSel && prodSel.options.length <= 1) {
                const r = await req('/products');
                if (r.success) (r.data || []).forEach(p => {
                    const o = document.createElement('option');
                    o.value = p.id; o.textContent = `${p.product_code} - ${p.product_name}`;
                    prodSel.appendChild(o);
                });
            }
            const catSel = document.getElementById('inv-rpt-category');
            if (catSel && catSel.options.length <= 1) {
                const r = await req('/products/categories');
                if (r.success && r.data) {
                    (r.data || []).forEach(c => {
                        const o = document.createElement('option');
                        o.value = c.id; o.textContent = c.category_name;
                        catSel.appendChild(o);
                    });
                }
            }
        }
        await loadFilterOptions();

        const storeSel = document.getElementById('inv-rpt-store');
        if (storeSel && !storeSel.dataset.searchable) {
            storeSel.dataset.searchable = '1';
            window.makeSearchableSelect(storeSel, Array.from(storeSel.options).filter(o => o.value).map(o => ({id: o.value, name: o.textContent})), 'ابحث عن مخزن...');
        }
        const prodSel = document.getElementById('inv-rpt-product');
        if (prodSel && !prodSel.dataset.searchable) {
            prodSel.dataset.searchable = '1';
            window.makeSearchableSelect(prodSel, Array.from(prodSel.options).filter(o => o.value).map(o => ({id: o.value, name: o.textContent})), 'ابحث عن صنف...');
        }
        const catSel = document.getElementById('inv-rpt-category');
        if (catSel && !catSel.dataset.searchable) {
            catSel.dataset.searchable = '1';
            window.makeSearchableSelect(catSel, Array.from(catSel.options).filter(o => o.value).map(o => ({id: o.value, name: o.textContent})), 'ابحث عن مجموعة...');
        }

        function show(id) { const e = document.getElementById(id); if (e) e.style.display = ''; }
        function hide(id) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
        function setHtml(id, html) { const e = document.getElementById(id); if (e) e.innerHTML = html; }

        function showLoading() { hide('inv-rpt-state-empty'); hide('inv-rpt-state-error'); hide('inv-rpt-table-area'); hide('inv-rpt-info-bar'); show('inv-rpt-state-loading'); }
        function showEmpty(msg) { hide('inv-rpt-state-loading'); hide('inv-rpt-state-error'); hide('inv-rpt-table-area'); hide('inv-rpt-info-bar'); show('inv-rpt-state-empty'); const p = document.querySelector('#inv-rpt-state-empty h3'); if (p) p.textContent = msg || 'اختر التقرير والفلترة ثم اضغط عرض'; }
        function showError(msg) { hide('inv-rpt-state-loading'); hide('inv-rpt-state-empty'); hide('inv-rpt-table-area'); hide('inv-rpt-info-bar'); show('inv-rpt-state-error'); const e = document.getElementById('inv-rpt-error-msg'); if (e) e.textContent = msg || 'خطأ في تحميل التقرير'; }

        function renderTable(headers, rows, foot) {
            hide('inv-rpt-state-loading'); hide('inv-rpt-state-empty'); hide('inv-rpt-state-error');
            show('inv-rpt-table-area');
            setHtml('inv-rpt-thead', '<tr>' + headers.map(h => `<th>${h}</th>`).join('') + '</tr>');
            setHtml('inv-rpt-tbody', rows);
            if (foot) { show('inv-rpt-tfoot'); setHtml('inv-rpt-tfoot', foot); }
            else hide('inv-rpt-tfoot');
        }

        const toggleBtn = document.getElementById('inv-rpt-sidebar-toggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                const nav = view.querySelector('.report-nav');
                if (nav) nav.classList.toggle('open');
            });
        }

        function getFilters() {
            const from = document.getElementById('inv-rpt-from')?.value || '';
            const to = document.getElementById('inv-rpt-to')?.value || '';
            const store = document.getElementById('inv-rpt-store')?.value || '';
            const product = document.getElementById('inv-rpt-product')?.value || '';
            const category = document.getElementById('inv-rpt-category')?.value || '';
            const days = document.getElementById('inv-rpt-days')?.value || '';
            const sortBy = document.getElementById('inv-rpt-sort-by')?.value || '';
            const stockStatus = document.getElementById('inv-rpt-stock-status')?.value || '';
            return { from, to, store, product, category, days, sortBy, stockStatus };
        }

        function updateFilterVisibility(reportType) {
            hide('inv-rpt-filter-store'); hide('inv-rpt-filter-product'); hide('inv-rpt-filter-category');
            hide('inv-rpt-filter-days'); hide('inv-rpt-filter-sort-by'); hide('inv-rpt-filter-stock-status');
            if (reportType === 'balances') { show('inv-rpt-filter-store'); show('inv-rpt-filter-category'); show('inv-rpt-filter-stock-status'); }
            if (reportType === 'movement') { show('inv-rpt-filter-store'); show('inv-rpt-filter-product'); }
            if (reportType === 'transfers') { show('inv-rpt-filter-store'); }
            if (reportType === 'disposals') { show('inv-rpt-filter-store'); }
            if (reportType === 'counts') { show('inv-rpt-filter-store'); }
            if (reportType === 'adjustments') { show('inv-rpt-filter-store'); }
            if (reportType === 'slow-moving') { show('inv-rpt-filter-store'); show('inv-rpt-filter-days'); }
            if (reportType === 'fast-moving') { show('inv-rpt-filter-store'); show('inv-rpt-filter-sort-by'); }
        }

        let _lastReportData = null;

        const printBtn = document.getElementById('inv-rpt-print');
        if (printBtn && !printBtn.dataset.bound) {
            printBtn.dataset.bound = '1';
            printBtn.addEventListener('click', async () => {
                if (!_lastReportData) { showAlert('لا توجد بيانات للطباعة', { type: 'warning' }); return; }
                const engine = new ReportPrintEngine();
                await engine.init();
                engine.print(_lastReportData);
            });
        }

        const csvBtn = document.getElementById('inv-rpt-export-csv');
        if (csvBtn && !csvBtn.dataset.bound) {
            csvBtn.dataset.bound = '1';
            csvBtn.addEventListener('click', () => {
                if (!_lastReportData) { showAlert('لا توجد بيانات للتصدير', { type: 'warning' }); return; }
                const engine = new ReportPrintEngine();
                engine.exportCSV(_lastReportData);
            });
        }

        const runBtn = document.getElementById('inv-rpt-run-btn');
        if (runBtn && !runBtn.dataset.bound) {
            runBtn.dataset.bound = '1';
            runBtn.addEventListener('click', () => {
                const activeItem = view.querySelector('.report-nav li.active');
                if (activeItem) {
                    const reportType = activeItem.dataset.report;
                    if (renderers[reportType]) renderers[reportType]();
                }
            });
        }

        const renderers = {
            async dashboard() {
                showLoading();
                const f = getFilters();
                try {
                    const r = await window.API.getInvDashboardReport({ from: f.from, to: f.to });
                    if (!r.success || !r.data) { showError(r.message); return; }
                    const d = r.data;
                    const info = [
                        { label: 'قيمة المخزون', value: fmt(d.total_value) },
                        { label: 'الأصناف', value: fmtInt(d.total_products) },
                        { label: 'أقل من الحد', value: fmtInt(d.low_stock_count) + ' صنف' },
                        { label: 'نفد من المخزون', value: fmtInt(d.out_of_stock_count) + ' صنف' },
                        { label: 'المخازن', value: fmtInt(d.store_count) },
                        { label: 'التحويلات', value: fmtInt(d.transfer_count) },
                        { label: 'الإعدام', value: fmtInt(d.disposal_count) + ' (' + fmt(d.disposal_value) + ')' },
                        { label: 'الجرد', value: fmtInt(d.count_count) },
                        { label: 'التسويات', value: fmtInt(d.adjustment_count) + ' (' + fmt(d.adjustment_qty) + ' وحدة)' }
                    ];
                    const bar = document.getElementById('inv-rpt-info-bar');
                    if (bar) {
                        bar.innerHTML = info.map(i => '<span><span class="info-label">' + i.label + ':</span> ' + i.value + '</span>').join(' | ');
                        show('inv-rpt-info-bar');
                    }
                    // Top/Bottom stores
                    let extra = '';
                    if (d.top_store) extra += `<div style="margin-top:15px;display:flex;gap:20px;flex-wrap:wrap">
                        <div style="flex:1;background:#f0fdf4;padding:15px;border-radius:8px;border:1px solid #bbf7d0">
                            <h4 style="margin:0 0 5px;color:#166534">أعلى مخزن قيمة</h4>
                            <span style="font-size:1.2rem">${d.top_store.store_name}: <strong>${fmt(d.top_store.store_value)}</strong></span>
                        </div>` +
                        (d.bottom_store ? `
                        <div style="flex:1;background:#fef2f2;padding:15px;border-radius:8px;border:1px solid #fecaca">
                            <h4 style="margin:0 0 5px;color:#991b1b">أقل مخزن قيمة</h4>
                            <span style="font-size:1.2rem">${d.bottom_store.store_name}: <strong>${fmt(d.bottom_store.store_value)}</strong></span>
                        </div>` : '') + '</div>';
                    hide('inv-rpt-table-area');
                    hide('inv-rpt-state-loading');
                    show('inv-rpt-state-empty');
                    const emptyDiv = document.querySelector('#inv-rpt-state-empty h3');
                    if (emptyDiv) {
                        emptyDiv.innerHTML = 'لوحة مؤشرات المخازن' + extra;
                        document.querySelector('#inv-rpt-state-empty p').textContent = 'اختر تقريراً من القائمة الجانبية للتفاصيل';
                    }
                    _lastReportData = {
                        title: 'لوحة مؤشرات المخازن',
                        filters: [{ label: 'من تاريخ', value: f.from }, { label: 'إلى تاريخ', value: f.to }].filter(x => x.value),
                        summary: info,
                        columns: [],
                        rows: [],
                        totals: info
                    };
                } catch (e) { showError(e.message); }
            },
            async balances() {
                showLoading();
                const f = getFilters();
                try {
                    const r = await window.API.getInvBalancesReport({ store_id: f.store, category_id: f.category, stock_status: f.stockStatus });
                    if (!r.success) { showError(r.message); return; }
                    const data = r.data || [];
                    const t = r.totals || {};
                    const headers = ['#', 'المخزن', 'كود الصنف', 'اسم الصنف', 'الوحدة', 'الكمية', 'متوسط التكلفة', 'القيمة', 'الحد الأدنى', 'الحالة'];
                    const body = data.length === 0
                        ? '<tr><td colspan="10" style="text-align:center;padding:30px;color:#999">لا توجد أرصدة</td></tr>'
                        : data.map((d, i) => `<tr>
                            <td>${i+1}</td>
                            <td>${esc(d.store_name)}</td>
                            <td>${esc(d.product_code)}</td>
                            <td>${esc(d.product_name)}</td>
                            <td>${esc(d.unit_name)}</td>
                            <td style="font-weight:600">${fmtInt(d.quantity)}</td>
                            <td>${fmt(d.cost_price)}</td>
                            <td style="font-weight:600">${fmt(d.total_value)}</td>
                            <td>${fmtInt(d.min_stock)}</td>
                            <td>${d.stock_status === 'normal' ? '<span class="badge-status paid">طبيعي</span>' : d.stock_status === 'low' ? '<span class="badge-status overdue">أقل من الحد</span>' : '<span class="badge-status" style="background:#6b7280">نفد</span>'}</td>
                        </tr>`).join('');
                    const bar = document.getElementById('inv-rpt-info-bar');
                    if (bar) bar.innerHTML = '<span><span class="info-label">عدد الأصناف:</span> ' + fmtInt(t.product_count) + '</span> | <span><span class="info-label">إجمالي الكميات:</span> ' + fmtInt(t.total_qty) + '</span> | <span><span class="info-label">إجمالي القيمة:</span> ' + fmt(t.total_value) + '</span>';
                    const foot = `<tr style="font-weight:bold;background:var(--bg-body)">
                        <td colspan="5" style="text-align:left">الإجمالي</td>
                        <td>${fmtInt(t.total_qty)}</td><td></td>
                        <td style="color:#059669">${fmt(t.total_value)}</td><td></td><td></td>
                    </tr>`;
                    renderTable(headers, body, foot);
                    _lastReportData = {
                        title: 'أرصدة المخازن',
                        filters: [{ label: 'مخزن', value: f.store ? document.getElementById('inv-rpt-store')?.options[f.store]?.textContent : '' }].filter(x => x.value),
                        columns: headers, rows: data.map((d, i) => [i+1, d.store_name, d.product_code, d.product_name, d.unit_name, d.quantity, d.cost_price, d.total_value, d.min_stock, d.stock_status]),
                        totals: [{ label: 'إجمالي القيمة', value: fmt(t.total_value) }]
                    };
                } catch (e) { showError(e.message); }
            },
            async movement() {
                showLoading();
                const f = getFilters();
                if (!f.product) { showError('الرجاء اختيار المنتج'); return; }
                try {
                    const r = await window.API.getInvMovementReport(f.product, { from: f.from, to: f.to, store_id: f.store });
                    if (!r.success || !r.data) { showError(r.message); return; }
                    const d = r.data;
                    const rows = d.movements || [];
                    const headers = ['#', 'التاريخ', 'المخزن', 'نوع الحركة', 'رقم المستند', 'وارد', 'صادر', 'الرصيد', 'تكلفة الوحدة', 'ملاحظات'];
                    const moveTypeLabels = {
                        'in': 'وارد', 'out': 'صادر', 'transfer': 'تحويل', 'transfer_cancel': 'إلغاء تحويل',
                        'damaged': 'تالف', 'damaged_cancel': 'إلغاء تالف', 'adjustment': 'تسوية', 'adjustment_cancel': 'إلغاء تسوية',
                        'disposal': 'إعدام', 'disposal_reversal': 'عكس إعدام', 'purchase': 'شراء', 'sale': 'بيع',
                        'purchase_return': 'مرتجع شراء', 'sale_return': 'مرتجع بيع', 'count': 'جرد'
                    };
                    const body = rows.length === 0
                        ? '<tr><td colspan="10" style="text-align:center;padding:30px;color:#999">لا توجد حركات</td></tr>'
                        : rows.map((m, i) => `<tr>
                            <td>${i+1}</td>
                            <td>${m.move_date || '-'}</td>
                            <td>${esc(m.store_name || '-')}</td>
                            <td>${moveTypeLabels[m.move_type] || m.move_type || '-'}</td>
                            <td>${m.document_no || '-'}</td>
                            <td style="color:#059669;font-weight:600">${m.qty_in > 0 ? fmtInt(m.qty_in) : '-'}</td>
                            <td style="color:#dc2626;font-weight:600">${m.qty_out > 0 ? fmtInt(m.qty_out) : '-'}</td>
                            <td style="font-weight:800">${fmtInt(m.running_balance)}</td>
                            <td>${fmt(m.cost_price)}</td>
                            <td>${esc(m.notes || '-')}</td>
                        </tr>`).join('');
                    const bar = document.getElementById('inv-rpt-info-bar');
                    if (bar) bar.innerHTML = '<span><span class="info-label">الصنف:</span> ' + esc(d.product?.product_name || '') + ' (' + esc(d.product?.product_code || '') + ')</span> | <span><span class="info-label">الوحدة:</span> ' + esc(d.product?.unit_name || '-') + '</span> | <span><span class="info-label">رصيد أول المدة:</span> ' + fmtInt(d.opening_balance) + '</span> | <span><span class="info-label">رصيد آخر المدة:</span> ' + fmtInt(d.closing_balance) + '</span> | <span><span class="info-label">وارد:</span> ' + fmtInt(d.total_qty_in) + '</span> | <span><span class="info-label">صادر:</span> ' + fmtInt(d.total_qty_out) + '</span>';
                    const foot = `<tr style="font-weight:bold;background:var(--bg-body)">
                        <td colspan="5" style="text-align:left">رصيد أول: ${fmtInt(d.opening_balance)} | آخر: ${fmtInt(d.closing_balance)}</td>
                        <td style="color:#059669">${fmtInt(d.total_qty_in)}</td>
                        <td style="color:#dc2626">${fmtInt(d.total_qty_out)}</td>
                        <td style="font-weight:800">${fmtInt(d.closing_balance)}</td><td></td><td></td>
                    </tr>`;
                    renderTable(headers, body, foot);
                    _lastReportData = {
                        title: 'حركة صنف - ' + d.product?.product_name,
                        filters: [{ label: 'الصنف', value: d.product?.product_name }, { label: 'من', value: f.from }, { label: 'إلى', value: f.to }].filter(x => x.value),
                        columns: headers, rows: rows.map((m, i) => [i+1, m.move_date, m.store_name, moveTypeLabels[m.move_type]||m.move_type, m.document_no, m.qty_in, m.qty_out, m.running_balance, m.cost_price, m.notes]),
                        totals: [{ label: 'الرصيد الافتتاحي', value: fmtInt(d.opening_balance) }, { label: 'الرصيد الختامي', value: fmtInt(d.closing_balance) }]
                    };
                } catch (e) { showError(e.message); }
            },
            async transfers() {
                showLoading();
                const f = getFilters();
                try {
                    const r = await window.API.getInvTransfersReport({ from: f.from, to: f.to, store_id: f.store });
                    if (!r.success) { showError(r.message); return; }
                    const data = r.data || [];
                    const t = r.totals || {};
                    const headers = ['#', 'رقم التحويل', 'التاريخ', 'من مخزن', 'إلى مخزن', 'عدد الأصناف', 'إجمالي الكمية', 'الحالة', 'المستخدم'];
                    const body = data.length === 0
                        ? '<tr><td colspan="9" style="text-align:center;padding:30px;color:#999">لا توجد تحويلات</td></tr>'
                        : data.map((d, i) => `<tr>
                            <td>${i+1}</td>
                            <td><strong>${esc(d.transfer_no)}</strong></td>
                            <td>${d.transfer_date || '-'}</td>
                            <td>${esc(d.from_store)}</td>
                            <td>${esc(d.to_store)}</td>
                            <td>${fmtInt(d.item_count)}</td>
                            <td>${fmtInt(d.total_qty)}</td>
                            <td><span class="badge-status ${d.status === 'posted' ? 'paid' : d.status === 'cancelled' ? 'overdue' : 'pending'}">${d.status === 'posted' ? 'مرحل' : d.status === 'cancelled' ? 'ملغي' : d.status}</span></td>
                            <td>${esc(d.created_by_name || '-')}</td>
                        </tr>`).join('');
                    const bar = document.getElementById('inv-rpt-info-bar');
                    if (bar) bar.innerHTML = '<span><span class="info-label">عدد التحويلات:</span> ' + fmtInt(t.transfer_count) + '</span> | <span><span class="info-label">إجمالي الكمية:</span> ' + fmtInt(t.total_qty) + '</span>';
                    const foot = `<tr style="font-weight:bold;background:var(--bg-body)">
                        <td colspan="6" style="text-align:left">الإجمالي</td>
                        <td>${fmtInt(t.total_qty)}</td><td></td><td></td>
                    </tr>`;
                    renderTable(headers, body, foot);
                    _lastReportData = {
                        title: 'تحويلات المخازن',
                        filters: [{ label: 'من', value: f.from }, { label: 'إلى', value: f.to }].filter(x => x.value),
                        columns: headers, rows: data.map((d, i) => [i+1, d.transfer_no, d.transfer_date, d.from_store, d.to_store, d.item_count, d.total_qty, d.status, d.created_by_name]),
                        totals: [{ label: 'عدد التحويلات', value: fmtInt(t.transfer_count) }, { label: 'إجمالي الكمية', value: fmtInt(t.total_qty) }]
                    };
                } catch (e) { showError(e.message); }
            },
            async disposals() {
                showLoading();
                const f = getFilters();
                try {
                    const r = await window.API.getInvDisposalsReport({ from: f.from, to: f.to, store_id: f.store });
                    if (!r.success) { showError(r.message); return; }
                    const data = r.data || [];
                    const t = r.totals || {};
                    const headers = ['#', 'رقم الإذن', 'التاريخ', 'المخزن', 'السبب', 'اللجنة', 'عدد الأصناف', 'الكمية', 'القيمة', 'المستخدم'];
                    const body = data.length === 0
                        ? '<tr><td colspan="10" style="text-align:center;padding:30px;color:#999">لا توجد أذون إعدام</td></tr>'
                        : data.map((d, i) => `<tr>
                            <td>${i+1}</td>
                            <td><strong>${esc(d.doc_no)}</strong></td>
                            <td>${d.doc_date || '-'}</td>
                            <td>${esc(d.store_name)}</td>
                            <td>${esc(d.reason || '-')}</td>
                            <td>${esc(d.committee || '-')}</td>
                            <td>${fmtInt(d.item_count)}</td>
                            <td>${fmtInt(d.total_qty)}</td>
                            <td style="font-weight:600">${fmt(d.total_value)}</td>
                            <td>${esc(d.created_by_name || '-')}</td>
                        </tr>`).join('');
                    const bar = document.getElementById('inv-rpt-info-bar');
                    if (bar) bar.innerHTML = '<span><span class="info-label">عدد الأذون:</span> ' + fmtInt(t.disposal_count) + '</span> | <span><span class="info-label">إجمالي القيمة:</span> ' + fmt(t.total_value) + '</span>';
                    const foot = `<tr style="font-weight:bold;background:var(--bg-body)">
                        <td colspan="7" style="text-align:left">الإجمالي</td>
                        <td>${fmtInt(t.total_qty)}</td>
                        <td style="color:#dc2626">${fmt(t.total_value)}</td><td></td>
                    </tr>`;
                    renderTable(headers, body, foot);
                    _lastReportData = {
                        title: 'أذون الإعدام',
                        filters: [{ label: 'من', value: f.from }, { label: 'إلى', value: f.to }].filter(x => x.value),
                        columns: headers, rows: data.map((d, i) => [i+1, d.doc_no, d.doc_date, d.store_name, d.reason, d.committee, d.item_count, d.total_qty, d.total_value, d.created_by_name]),
                        totals: [{ label: 'عدد الأذون', value: fmtInt(t.disposal_count) }, { label: 'إجمالي القيمة', value: fmt(t.total_value) }]
                    };
                } catch (e) { showError(e.message); }
            },
            async counts() {
                showLoading();
                const f = getFilters();
                try {
                    const r = await window.API.getInvCountsReport({ from: f.from, to: f.to, store_id: f.store });
                    if (!r.success) { showError(r.message); return; }
                    const data = r.data || [];
                    const t = r.totals || {};
                    const headers = ['#', 'رقم الجرد', 'التاريخ', 'المخزن', 'عدد الأصناف', 'أصناف بفروقات', 'إجمالي الفروقات', 'أثر الفروقات المالي', 'الحالة', 'ملاحظات'];
                    const body = data.length === 0
                        ? '<tr><td colspan="10" style="text-align:center;padding:30px;color:#999">لا توجد جردات</td></tr>'
                        : data.map((d, i) => `<tr>
                            <td>${i+1}</td>
                            <td><strong>${esc(d.count_no)}</strong></td>
                            <td>${d.count_date || '-'}</td>
                            <td>${esc(d.store_name)}</td>
                            <td>${fmtInt(d.item_count)}</td>
                            <td>${fmtInt(d.diff_count)}</td>
                            <td>${fmtInt(d.total_diff_qty)}</td>
                            <td style="font-weight:600">${fmt(d.total_diff_value)}</td>
                            <td><span class="badge-status ${d.status === 'completed' ? 'paid' : d.status === 'in_progress' ? 'pending' : 'overdue'}">${d.status === 'completed' ? 'مكتمل' : d.status === 'in_progress' ? 'جاري' : d.status === 'cancelled' ? 'ملغي' : d.status}</span></td>
                            <td>${esc(d.notes || '-')}</td>
                        </tr>`).join('');
                    const bar = document.getElementById('inv-rpt-info-bar');
                    if (bar) bar.innerHTML = '<span><span class="info-label">عدد الجردات:</span> ' + fmtInt(t.count_count) + '</span> | <span><span class="info-label">إجمالي الفروقات:</span> ' + fmtInt(t.total_diff_qty) + '</span> | <span><span class="info-label">الأثر المالي:</span> ' + fmt(t.total_diff_value) + '</span>';
                    const foot = `<tr style="font-weight:bold;background:var(--bg-body)">
                        <td colspan="6" style="text-align:left">الإجمالي</td>
                        <td>${fmtInt(t.total_diff_qty)}</td>
                        <td>${fmt(t.total_diff_value)}</td><td></td><td></td>
                    </tr>`;
                    renderTable(headers, body, foot);
                    _lastReportData = {
                        title: 'تقرير الجرد',
                        filters: [{ label: 'من', value: f.from }, { label: 'إلى', value: f.to }].filter(x => x.value),
                        columns: headers, rows: data.map((d, i) => [i+1, d.count_no, d.count_date, d.store_name, d.item_count, d.diff_count, d.total_diff_qty, d.total_diff_value, d.status, d.notes]),
                        totals: [{ label: 'إجمالي الفروقات', value: fmtInt(t.total_diff_qty) }, { label: 'الأثر المالي', value: fmt(t.total_diff_value) }]
                    };
                } catch (e) { showError(e.message); }
            },
            async adjustments() {
                showLoading();
                const f = getFilters();
                try {
                    const r = await window.API.getInvAdjustmentsReport({ from: f.from, to: f.to, store_id: f.store });
                    if (!r.success) { showError(r.message); return; }
                    const data = r.data || [];
                    const t = r.totals || {};
                    const headers = ['#', 'رقم التسوية', 'التاريخ', 'المخزن', 'الصنف', 'الوحدة', 'الكمية', 'القيمة', 'السبب', 'المستخدم'];
                    const body = data.length === 0
                        ? '<tr><td colspan="10" style="text-align:center;padding:30px;color:#999">لا توجد تسويات</td></tr>'
                        : data.map((d, i) => `<tr>
                            <td>${i+1}</td>
                            <td><strong>${esc(d.adj_no)}</strong></td>
                            <td>${d.adj_date || '-'}</td>
                            <td>${esc(d.store_name)}</td>
                            <td>${esc(d.product_name)} (${esc(d.product_code)})</td>
                            <td>${esc(d.unit_name)}</td>
                            <td style="font-weight:600;color:${d.quantity >= 0 ? '#059669' : '#dc2626'}">${d.quantity >= 0 ? '+' : ''}${fmtInt(d.quantity)}</td>
                            <td style="font-weight:600">${fmt(d.total_value)}</td>
                            <td>${esc(d.reason || '-')}</td>
                            <td>${esc(d.created_by_name || '-')}</td>
                        </tr>`).join('');
                    const bar = document.getElementById('inv-rpt-info-bar');
                    if (bar) bar.innerHTML = '<span><span class="info-label">عدد التسويات:</span> ' + fmtInt(t.adjustment_count) + '</span> | <span><span class="info-label">إجمالي الكمية:</span> ' + fmtInt(t.total_qty) + '</span> | <span><span class="info-label">إجمالي القيمة:</span> ' + fmt(t.total_value) + '</span>';
                    const foot = `<tr style="font-weight:bold;background:var(--bg-body)">
                        <td colspan="6" style="text-align:left">الإجمالي</td>
                        <td>${fmtInt(t.total_qty)}</td>
                        <td>${fmt(t.total_value)}</td><td></td><td></td>
                    </tr>`;
                    renderTable(headers, body, foot);
                    _lastReportData = {
                        title: 'تسويات المخزون',
                        filters: [{ label: 'من', value: f.from }, { label: 'إلى', value: f.to }].filter(x => x.value),
                        columns: headers, rows: data.map((d, i) => [i+1, d.adj_no, d.adj_date, d.store_name, d.product_name, d.unit_name, d.quantity, d.total_value, d.reason, d.created_by_name]),
                        totals: [{ label: 'عدد التسويات', value: fmtInt(t.adjustment_count) }, { label: 'إجمالي القيمة', value: fmt(t.total_value) }]
                    };
                } catch (e) { showError(e.message); }
            },
            async 'slow-moving'() {
                showLoading();
                const f = getFilters();
                try {
                    const r = await window.API.getInvSlowMovingReport({ days: f.days || 90, store_id: f.store });
                    if (!r.success) { showError(r.message); return; }
                    const data = r.data || [];
                    const t = r.totals || {};
                    const headers = ['#', 'كود الصنف', 'اسم الصنف', 'الوحدة', 'الكمية الحالية', 'التكلفة', 'القيمة', 'آخر تاريخ حركة', 'أيام بدون حركة'];
                    const body = data.length === 0
                        ? '<tr><td colspan="9" style="text-align:center;padding:30px;color:#999">لا توجد أصناف راكدة حسب الفترة المحددة</td></tr>'
                        : data.map((d, i) => `<tr>
                            <td>${i+1}</td>
                            <td>${esc(d.product_code)}</td>
                            <td>${esc(d.product_name)}</td>
                            <td>${esc(d.unit_name)}</td>
                            <td style="font-weight:600">${fmtInt(d.current_qty)}</td>
                            <td>${fmt(d.cost_price)}</td>
                            <td>${fmt(d.total_value)}</td>
                            <td>${d.last_move_date || '-'}</td>
                            <td style="color:#dc2626;font-weight:600">${fmtInt(d.days_since_move)} يوم</td>
                        </tr>`).join('');
                    const bar = document.getElementById('inv-rpt-info-bar');
                    if (bar) bar.innerHTML = '<span><span class="info-label">عدد الأصناف الراكدة:</span> ' + fmtInt(t.product_count) + '</span> | <span><span class="info-label">إجمالي الكمية:</span> ' + fmtInt(t.total_qty) + '</span> | <span><span class="info-label">إجمالي القيمة:</span> ' + fmt(t.total_value) + '</span>';
                    const foot = `<tr style="font-weight:bold;background:var(--bg-body)">
                        <td colspan="4" style="text-align:left">الإجمالي</td>
                        <td>${fmtInt(t.total_qty)}</td><td></td>
                        <td>${fmt(t.total_value)}</td><td></td><td></td>
                    </tr>`;
                    renderTable(headers, body, foot);
                    _lastReportData = {
                        title: 'الأصناف الراكدة',
                        filters: [{ label: 'فترة الركود', value: (f.days || '90') + ' يوم' }],
                        columns: headers, rows: data.map((d, i) => [i+1, d.product_code, d.product_name, d.unit_name, d.current_qty, d.cost_price, d.total_value, d.last_move_date, d.days_since_move + ' يوم']),
                        totals: [{ label: 'عدد الأصناف', value: fmtInt(t.product_count) }, { label: 'إجمالي القيمة', value: fmt(t.total_value) }]
                    };
                } catch (e) { showError(e.message); }
            },
            async 'fast-moving'() {
                showLoading();
                const f = getFilters();
                try {
                    const r = await window.API.getInvFastMovingReport({ from: f.from, to: f.to, store_id: f.store, sort_by: f.sortBy });
                    if (!r.success) { showError(r.message); return; }
                    const data = r.data || [];
                    const t = r.totals || {};
                    const headers = ['#', 'كود الصنف', 'اسم الصنف', 'الوحدة', 'عدد الحركات', 'إجمالي الكمية', 'إجمالي القيمة', 'آخر تاريخ حركة', 'الرصيد الحالي'];
                    const body = data.length === 0
                        ? '<tr><td colspan="9" style="text-align:center;padding:30px;color:#999">لا توجد حركات في الفترة المحددة</td></tr>'
                        : data.map((d, i) => `<tr>
                            <td>${i+1}</td>
                            <td>${esc(d.product_code)}</td>
                            <td><strong>${esc(d.product_name)}</strong></td>
                            <td>${esc(d.unit_name)}</td>
                            <td>${fmtInt(d.movement_count)}</td>
                            <td style="font-weight:600">${fmtInt(d.total_movement_qty)}</td>
                            <td style="font-weight:600">${fmt(d.total_movement_value)}</td>
                            <td>${d.last_move_date || '-'}</td>
                            <td>${fmtInt(d.current_qty)}</td>
                        </tr>`).join('');
                    const bar = document.getElementById('inv-rpt-info-bar');
                    if (bar) bar.innerHTML = '<span><span class="info-label">عدد الأصناف:</span> ' + fmtInt(t.product_count) + '</span> | <span><span class="info-label">إجمالي الكمية المتحركة:</span> ' + fmtInt(t.total_movement_qty) + '</span> | <span><span class="info-label">إجمالي القيمة المتحركة:</span> ' + fmt(t.total_movement_value) + '</span>';
                    const foot = `<tr style="font-weight:bold;background:var(--bg-body)">
                        <td colspan="4" style="text-align:left">الإجمالي</td>
                        <td>${fmtInt(t.product_count)}</td>
                        <td>${fmtInt(t.total_movement_qty)}</td>
                        <td>${fmt(t.total_movement_value)}</td><td></td><td></td>
                    </tr>`;
                    renderTable(headers, body, foot);
                    _lastReportData = {
                        title: 'الأصناف الأكثر حركة',
                        filters: [{ label: 'من', value: f.from }, { label: 'إلى', value: f.to }].filter(x => x.value),
                        columns: headers, rows: data.map((d, i) => [i+1, d.product_code, d.product_name, d.unit_name, d.movement_count, d.total_movement_qty, d.total_movement_value, d.last_move_date, d.current_qty]),
                        totals: [{ label: 'إجمالي الكمية', value: fmtInt(t.total_movement_qty) }, { label: 'إجمالي القيمة', value: fmt(t.total_movement_value) }]
                    };
                } catch (e) { showError(e.message); }
            },
            async valuation() {
                showLoading();
                try {
                    const r = await window.API.getInvValuationReport();
                    if (!r.success || !r.data) { showError(r.message); return; }
                    const d = r.data;

                    // By store HTML
                    const storeRows = (d.by_store || []).map((s, i) => `<tr>
                        <td>${i+1}</td>
                        <td><strong>${esc(s.store_name)}</strong></td>
                        <td>${fmtInt(s.product_count)}</td>
                        <td>${fmtInt(s.total_qty)}</td>
                        <td style="font-weight:600">${fmt(s.total_value)}</td>
                    </tr>`).join('');

                    // By category HTML
                    const catRows = (d.by_category || []).map((c, i) => `<tr>
                        <td>${i+1}</td>
                        <td><strong>${esc(c.category_name)}</strong></td>
                        <td>${fmtInt(c.product_count)}</td>
                        <td>${fmtInt(c.total_qty)}</td>
                        <td style="font-weight:600">${fmt(c.total_value)}</td>
                    </tr>`).join('');

                    const bar = document.getElementById('inv-rpt-info-bar');
                    if (bar) bar.innerHTML = '<span><span class="info-label">إجمالي قيمة المخزون:</span> ' + fmt(d.grand_total?.total_value) + '</span> | <span><span class="info-label">الرصيد المحاسبي:</span> ' + fmt(d.accounting_balance) + '</span> | <span><span class="info-label">الفرق:</span> ' + fmt(d.difference) + '</span>';

                    // Build custom table area with two sections
                    const html = `
                        <div style="margin-bottom:20px">
                            <h4 style="margin:0 0 10px;color:var(--primary-color)">قيمة المخزون حسب المخازن</h4>
                            <table class="data-table">
                                <thead><tr><th>#</th><th>المخزن</th><th>عدد الأصناف</th><th>الكمية</th><th>القيمة</th></tr></thead>
                                <tbody>${storeRows || '<tr><td colspan="5" style="text-align:center">لا توجد بيانات</td></tr>'}</tbody>
                                <tfoot><tr style="font-weight:bold;background:var(--bg-body)"><td colspan="2">الإجمالي</td><td>${fmtInt(d.grand_total?.product_count)}</td><td>${fmtInt(d.grand_total?.total_qty)}</td><td style="color:#059669">${fmt(d.grand_total?.total_value)}</td></tr></tfoot>
                            </table>
                        </div>
                        <div>
                            <h4 style="margin:0 0 10px;color:var(--primary-color)">قيمة المخزون حسب المجموعات</h4>
                            <table class="data-table">
                                <thead><tr><th>#</th><th>المجموعة</th><th>عدد الأصناف</th><th>الكمية</th><th>القيمة</th></tr></thead>
                                <tbody>${catRows || '<tr><td colspan="5" style="text-align:center">لا توجد بيانات</td></tr>'}</tbody>
                                <tfoot><tr style="font-weight:bold;background:var(--bg-body)"><td colspan="2">الإجمالي</td><td>${fmtInt(d.grand_total?.product_count)}</td><td>${fmtInt(d.grand_total?.total_qty)}</td><td style="color:#059669">${fmt(d.grand_total?.total_value)}</td></tr></tfoot>
                            </table>
                        </div>
                        <div style="margin-top:15px;padding:15px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;display:flex;gap:20px;flex-wrap:wrap">
                            <div><strong>القيمة التشغيلية:</strong> ${fmt(d.grand_total?.total_value)}</div>
                            <div><strong>الرصيد المحاسبي:</strong> ${fmt(d.accounting_balance)}</div>
                            <div style="color:${Math.abs(d.difference) < 0.01 ? '#059669' : '#dc2626'}"><strong>الفرق:</strong> ${fmt(d.difference)} ${Math.abs(d.difference) < 0.01 ? '✓ متطابق' : ''}</div>
                        </div>`;

                    hide('inv-rpt-state-loading'); hide('inv-rpt-state-empty'); hide('inv-rpt-state-error');
                    show('inv-rpt-table-area');
                    setHtml('inv-rpt-thead', '');
                    setHtml('inv-rpt-tbody', '');
                    hide('inv-rpt-tfoot');
                    document.getElementById('inv-rpt-table-area')?.querySelector('.table-responsive')?.remove();
                    const tableArea = document.getElementById('inv-rpt-table-area');
                    if (tableArea) {
                        const existing = tableArea.querySelector('.inv-valuation-container');
                        if (existing) existing.remove();
                        const container = document.createElement('div');
                        container.className = 'inv-valuation-container';
                        container.innerHTML = html;
                        tableArea.appendChild(container);
                    }

                    _lastReportData = {
                        title: 'تقييم المخزون',
                        filters: [],
                        columns: [],
                        rows: [],
                        totals: [{ label: 'إجمالي القيمة', value: fmt(d.grand_total?.total_value) }, { label: 'الرصيد المحاسبي', value: fmt(d.accounting_balance) }]
                    };
                } catch (e) { showError(e.message); }
            }
        };

        // Wire sidebar navigation
        const navItems = view.querySelectorAll('.report-nav li');
        navItems.forEach(li => {
            if (li.dataset.report && !li.dataset.bound) {
                li.dataset.bound = '1';
                li.addEventListener('click', () => {
                    navItems.forEach(n => n.classList.remove('active'));
                    li.classList.add('active');
                    const reportType = li.dataset.report;
                    updateFilterVisibility(reportType);
                    if (renderers[reportType]) renderers[reportType]();
                    const nav = view.querySelector('.report-nav');
                    if (nav) nav.classList.remove('open');
                });
            }
        });

        // Trigger active report on first load
        const activeItem = view.querySelector('.report-nav li.active');
        if (activeItem && activeItem.dataset.report && renderers[activeItem.dataset.report]) {
            updateFilterVisibility(activeItem.dataset.report);
            renderers[activeItem.dataset.report]();
        }
    };
})();
