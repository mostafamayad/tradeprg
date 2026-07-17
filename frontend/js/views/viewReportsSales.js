(function() {
    'use strict';
    window.viewHandlers = window.viewHandlers || {};
    const viewHandlers = window.viewHandlers;

    const req = (...args) => window.req(...args);
    const fmt = (...args) => window.fmt(...args);
    const fmtPlain = (...args) => window.fmtPlain(...args);
    const fmtInt = (...args) => window.fmtInt(...args);
    const esc = (...args) => window.esc(...args);

    // ============================================================
    // VIEW: REPORTS SALES - ربط روابط التقارير
    // ============================================================
    viewHandlers['view-reports-sales'] = async function () {
        const view = document.getElementById('view-reports-sales');
        if (!view) return;

        // ── Populate filter dropdowns ──
        async function loadFilterOptions() {
            const custSel = document.getElementById('rpt-customer');
            if (custSel && custSel.options.length <= 1) {
                const r = await req('/customers');
                if (r.success) (r.data || []).forEach(c => {
                    const o = document.createElement('option');
                    o.value = c.id; o.textContent = `${c.customer_code} - ${c.customer_name}`;
                    custSel.appendChild(o);
                });
            }
            const repSel = document.getElementById('rpt-rep');
            if (repSel && repSel.options.length <= 1) {
                const r = await req('/reps');
                if (r.success) (r.data || []).forEach(rp => {
                    const o = document.createElement('option');
                    o.value = rp.id; o.textContent = rp.rep_name;
                    repSel.appendChild(o);
                });
            }
            const storeSel = document.getElementById('rpt-store');
            if (storeSel && storeSel.options.length <= 1) {
                const r = await req('/stores');
                if (r.success) (r.data || []).forEach(s => {
                    const o = document.createElement('option');
                    o.value = s.id; o.textContent = s.store_name;
                    storeSel.appendChild(o);
                });
            }
        }
        await loadFilterOptions();

        // Default dates: start of year to today
        const rptFrom = document.getElementById('rpt-from');
        const rptTo = document.getElementById('rpt-to');
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        if (rptFrom && !rptFrom.value) rptFrom.value = `${yyyy}-01-01`;
        if (rptTo && !rptTo.value) rptTo.value = `${yyyy}-${mm}-${dd}`;

        const repSel = document.getElementById('rpt-rep');
        if (repSel && !repSel.dataset.searchable) {
            repSel.dataset.searchable = '1';
            window.makeSearchableSelect(repSel, Array.from(repSel.options).filter(o => o.value).map(o => ({id: o.value, name: o.textContent})), 'ابحث عن مندوب...');
        }
        const storeSel = document.getElementById('rpt-store');
        if (storeSel && !storeSel.dataset.searchable) {
            storeSel.dataset.searchable = '1';
            window.makeSearchableSelect(storeSel, Array.from(storeSel.options).filter(o => o.value).map(o => ({id: o.value, name: o.textContent})), 'ابحث عن مخزن...');
        }

        // ── Helpers ──
        function show(id) { const e = document.getElementById(id); if (e) e.style.display = ''; }
        function hide(id) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
        function setHtml(id, html) { const e = document.getElementById(id); if (e) e.innerHTML = html; }

        function showLoading() { hide('rpt-state-empty'); hide('rpt-state-error'); hide('rpt-table-area'); hide('rpt-rep-statement-area'); hide('rpt-info-bar'); show('rpt-state-loading'); }
        function showEmpty(msg) { hide('rpt-state-loading'); hide('rpt-state-error'); hide('rpt-table-area'); hide('rpt-rep-statement-area'); hide('rpt-info-bar'); show('rpt-state-empty'); document.querySelector('#rpt-state-empty h3').textContent = msg || 'اختر التقرير والفلترة ثم اضغط عرض'; }
        function showError(msg) { hide('rpt-state-loading'); hide('rpt-state-empty'); hide('rpt-table-area'); hide('rpt-rep-statement-area'); hide('rpt-info-bar'); show('rpt-state-error'); document.getElementById('rpt-error-msg').textContent = msg || 'خطأ في تحميل التقرير'; }

        function renderTable(headers, rows, foot) {
            hide('rpt-state-loading'); hide('rpt-state-empty'); hide('rpt-state-error'); hide('rpt-rep-statement-area');
            show('rpt-table-area');
            setHtml('rpt-thead', '<tr>' + headers.map(h => `<th>${h}</th>`).join('') + '</tr>');
            setHtml('rpt-tbody', rows);
            if (foot) { show('rpt-tfoot'); setHtml('rpt-tfoot', foot); }
            else hide('rpt-tfoot');
        }

        // ── Sidebar toggle for mobile ──
        const toggleBtn = document.getElementById('rpt-sidebar-toggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                const nav = view.querySelector('.report-nav');
                if (nav) nav.classList.toggle('open');
            });
        }

        function getFilters() {
            const from = document.getElementById('rpt-from')?.value || '';
            const to = document.getElementById('rpt-to')?.value || '';
            const cust = document.getElementById('rpt-customer')?.value || '';
            const rep = document.getElementById('rpt-rep')?.value || '';
            const store = document.getElementById('rpt-store')?.value || '';
            return { from, to, cust, rep, store };
        }

        function updateFilterVisibility(reportType) {
            hide('rpt-filter-customer'); hide('rpt-filter-rep'); hide('rpt-filter-store');
            if (reportType === 'customer-statement') show('rpt-filter-customer');
            if (reportType === 'sales-by-period') { show('rpt-filter-customer'); show('rpt-filter-rep'); show('rpt-filter-store'); }
            if (reportType === 'product-sales') show('rpt-filter-store');
            if (reportType === 'rep-performance' || reportType === 'rep-statement') show('rpt-filter-rep');
        }

        // ── Report renderers ──
        const renderers = {
            async dashboard() {
                const f = getFilters();
                const r = await req(`/reports/dashboard-cards?from=${f.from}&to=${f.to}`);
                if (!r.success || !r.data) { showError(r.message); return; }
                const d = r.data;
                const info = [
                    { label: 'إجمالي المبيعات', value: fmt(d.total_sales) },
                    { label: 'صافي المبيعات', value: fmt(d.net_sales) },
                    { label: 'المرتجعات', value: fmt(d.total_returns) },
                    { label: 'المحصل', value: fmt(d.collected_amount) },
                    { label: 'المستحق', value: fmt(d.outstanding_amount) },
                    { label: 'الضريبة', value: fmt(d.total_vat) },
                    { label: 'الفواتير', value: fmtInt(d.invoice_count) },
                    { label: 'متوسط الفاتورة', value: fmt(d.avg_invoice) },
                    { label: 'ربح', value: fmt(d.total_profit) + ' (' + d.margin_pct.toFixed(1) + '%)' }
                ];
                const bar = document.getElementById('rpt-info-bar');
                if (bar) { bar.innerHTML = info.map(i => '<span><span class="info-label">' + i.label + ':</span> ' + i.value + '</span>').join(' | '); show('rpt-info-bar'); }
                hide('rpt-state-loading'); hide('rpt-state-error'); hide('rpt-table-area'); hide('rpt-rep-statement-area');
                show('rpt-state-empty');
                document.querySelector('#rpt-state-empty h3').textContent = 'جميع التقارير متاحة';
                document.querySelector('#rpt-state-empty p').textContent = 'اختر تقريراً من القائمة الجانبية للبدء';
                _lastReportData = {
                    title: 'بطاقة أداء التقارير',
                    filters: [{ label: 'من تاريخ', value: f.from }, { label: 'إلى تاريخ', value: f.to }].filter(x => x.value),
                    summary: info,
                    columns: [],
                    rows: [],
                    totals: info
                };
            },
            async 'customer-statement'() {
                const f = getFilters();
                if (!f.cust) { showError('يرجى اختيار العميل أولاً'); return; }
                const r = await req(`/reports/customer-statement/${f.cust}?from=${f.from}&to=${f.to}`);
                if (!r.success || !r.data) { showError(r.message); return; }
                const d = r.data;
                const rows = d.rows || [];
                const headers = ['#', 'التاريخ', 'رقم المستند', 'النوع', 'مدين', 'دائن', 'الرصيد'];
                const body = rows.length === 0
                    ? '<tr><td colspan="7" style="text-align:center;padding:30px;color:#999">لا توجد حركات</td></tr>'
                    : rows.map((r, i) => `<tr>
                        <td>${i+1}</td>
                        <td>${r.date || '-'}</td>
                        <td>${r.doc_no || '-'}</td>
                        <td>${r.doc_type_short || r.doc_type || '-'}</td>
                        <td style="font-weight:600">${fmt(r.debit)}</td>
                        <td style="font-weight:600">${fmt(r.credit)}</td>
                        <td style="font-weight:800">${fmt(r.balance)}</td>
                    </tr>`).join('');
                const bar = document.getElementById('rpt-info-bar');
                if (bar) bar.innerHTML = '<span><span class="info-label">العميل:</span> ' + (d.customer?.customer_name || '') + '</span> | <span><span class="info-label">الرصيد الافتتاحي:</span> ' + fmt(d.opening_balance) + '</span> | <span><span class="info-label">الرصيد الختامي:</span> ' + fmt(d.closing_balance) + '</span>';
                const foot = `<tr style="font-weight:bold;background:var(--bg-body)">
                    <td colspan="4" style="text-align:left">الافتتاحي: ${fmt(d.opening_balance)}</td>
                    <td style="font-weight:600">${fmt(d.total_debit)}</td>
                    <td style="font-weight:600">${fmt(d.total_credit)}</td>
                    <td style="font-weight:800">${fmt(d.closing_balance)}</td>
                </tr>`;
                renderTable(headers, body, foot);
                _lastReportData = {
                    title: 'كشف حساب عميل',
                    filters: [{ label: 'العميل', value: d.customer?.customer_name }, { label: 'من تاريخ', value: f.from }, { label: 'إلى تاريخ', value: f.to }].filter(x => x.value),
                    summary: [{ label: 'الرصيد الافتتاحي', value: fmt(d.opening_balance) }, { label: 'الرصيد الختامي', value: fmt(d.closing_balance) }],
                    columns: headers, rows: rows.map((r, i) => [i+1, r.date||'-', r.doc_no||'-', r.doc_type_short||r.doc_type||'-', fmt(r.debit), fmt(r.credit), fmt(r.balance)]),
                    totals: [{ label: 'الافتتاحي', value: fmt(d.opening_balance) }, { label: 'مدين', value: fmt(d.total_debit) }, { label: 'دائن', value: fmt(d.total_credit) }, { label: 'الختامي', value: fmt(d.closing_balance) }]
                };
            },
            async 'sales-by-period'() {
                const f = getFilters();
                const p = new URLSearchParams();
                if (f.from) p.append('from', f.from); if (f.to) p.append('to', f.to);
                if (f.cust) p.append('customer_id', f.cust); if (f.rep) p.append('rep_id', f.rep);
                if (f.store) p.append('store_id', f.store);
                const r = await req(`/reports/sales-by-period?${p.toString()}`);
                if (!r.success) { showError(r.message); return; }
                const data = r.data || [];
                const t = r.totals || {};
                const headers = ['الفترة', 'عدد الفواتير', 'الكمية', 'الإجمالي', 'الخصم', 'الضريبة', 'صافي', 'متوسط الفاتورة', 'هامش%'];
                const body = data.length === 0
                    ? '<tr><td colspan="9" style="text-align:center;padding:30px;color:#999">لا توجد مبيعات</td></tr>'
                    : data.map(p => `<tr>
                        <td><strong>${p.period || '-'}</strong></td>
                        <td>${fmtInt(p.invoice_count)}</td>
                        <td>${fmtInt(p.sold_qty)}</td>
                        <td>${fmt(p.gross_sales)}</td>
                        <td>${fmt(p.total_discount)}</td>
                        <td>${fmt(p.total_tax)}</td>
                        <td style="font-weight:bold">${fmt(p.net_sales)}</td>
                        <td>${fmt(p.avg_invoice)}</td>
                        <td>${fmt(p.avg_margin_pct)}%</td>
                    </tr>`).join('');
                const bar = document.getElementById('rpt-info-bar');
                if (bar) bar.innerHTML = '<span><span class="info-label">فترة التقرير:</span> ' + (f.from || '---') + ' → ' + (f.to || '---') + '</span> | <span><span class="info-label">صافي المبيعات:</span> ' + fmt(t.net_sales) + '</span> | <span><span class="info-label">عدد الفواتير:</span> ' + fmtInt(t.invoice_count) + '</span> | <span><span class="info-label">مردودات:</span> ' + fmt(t.return_total) + ' (' + (t.return_rate||0).toFixed(1) + '%)</span>';
                const foot = `<tr style="font-weight:bold;background:var(--bg-body)">
                    <td style="text-align:left">الإجمالي</td>
                    <td>${fmtInt(t.invoice_count)}</td>
                    <td>${fmtInt(t.sold_qty)}</td>
                    <td>${fmt(t.gross_sales)}</td>
                    <td>${fmt(t.total_discount)}</td>
                    <td>${fmt(t.total_tax)}</td>
                    <td style="color:#059669">${fmt(t.net_sales)}</td>
                    <td>${fmt(t.avg_invoice)}</td>
                    <td>مردودات: ${fmt(t.return_total)} | نسبة: ${(t.return_rate||0).toFixed(1)}%</td>
                </tr>`;
                renderTable(headers, body, foot);
                _lastReportData = {
                    title: 'تقرير مبيعات فترة',
                    filters: [{ label: 'من تاريخ', value: f.from }, { label: 'إلى تاريخ', value: f.to }, { label: 'العميل', value: f.cust }, { label: 'المندوب', value: f.rep }, { label: 'المخزن', value: f.store }].filter(x => x.value),
                    summary: [{ label: 'عدد الفواتير', value: fmtInt(t.invoice_count) }, { label: 'صافي المبيعات', value: fmt(t.net_sales) }, { label: 'المردودات', value: fmt(t.return_total) }, { label: 'نسبة المرتجع', value: (t.return_rate||0).toFixed(1) + '%' }],
                    columns: headers, rows: data.map(p => [p.period||'-', fmtInt(p.invoice_count), fmtInt(p.sold_qty), fmt(p.gross_sales), fmt(p.total_discount), fmt(p.total_tax), fmt(p.net_sales), fmt(p.avg_invoice), fmt(p.avg_margin_pct)+'%']),
                    totals: [{ label: 'الإجمالي', value: '' }, { label: 'الفواتير', value: fmtInt(t.invoice_count) }, { label: 'صافي', value: fmt(t.net_sales) }, { label: 'مردودات', value: fmt(t.return_total) }]
                };
            },
            async 'product-sales'() {
                const f = getFilters();
                const p = new URLSearchParams({ per_page: '100' });
                if (f.from) p.append('from', f.from); if (f.to) p.append('to', f.to);
                if (f.store) p.append('store_id', f.store);
                const r = await req(`/reports/product-sales?${p.toString()}`);
                if (!r.success) { showError(r.message); return; }
                const data = r.data || [];
                const headers = ['#', 'كود الصنف', 'اسم الصنف', 'الوحدة', 'الكمية المباعة', 'المرتجع', 'صافي', 'قيمة المبيعات', 'المخزون'];
                const body = data.length === 0
                    ? '<tr><td colspan="9" style="text-align:center;padding:30px;color:#999">لا توجد مبيعات للأصناف</td></tr>'
                    : data.map((p, i) => `<tr>
                        <td>${i+1}</td>
                        <td>${p.product_code || '-'}</td>
                        <td><strong>${p.product_name || '-'}</strong></td>
                        <td>${p.unit_name || '-'}</td>
                        <td>${fmtInt(p.sold_qty)}</td>
                        <td>${fmtInt(p.returned_qty)}</td>
                        <td>${fmtInt(p.net_qty)}</td>
                        <td>${fmt(p.sales_value)}</td>
                        <td>${fmtInt(p.inventory)}</td>
                    </tr>`).join('');
                renderTable(headers, body);
                _lastReportData = {
                    title: 'تقرير مبيعات الأصناف',
                    filters: [{ label: 'من تاريخ', value: f.from }, { label: 'إلى تاريخ', value: f.to }, { label: 'المخزن', value: f.store }].filter(x => x.value),
                    summary: [{ label: 'عدد الأصناف', value: fmtInt(data.length) }],
                    columns: headers, rows: data.map((p, i) => [i+1, p.product_code||'-', p.product_name||'-', p.unit_name||'-', fmtInt(p.sold_qty), fmtInt(p.returned_qty), fmtInt(p.net_qty), fmt(p.sales_value), fmtInt(p.inventory)]),
                    totals: []
                };
            },
            async vat() {
                const f = getFilters();
                const r = await req(`/reports/vat-report?from=${f.from}&to=${f.to}`);
                if (!r.success) { showError(r.message); return; }
                const data = r.data || [];
                const t = r.totals || {};
                const a = r.accounting_validation || {};
                const headers = ['نسبة VAT', 'عدد الفواتير', 'المبيعات الخاضعة', 'VAT المحصل', 'عدد المرتجعات', 'المرتجعات الخاضعة', 'VAT المرتجع', 'صافي VAT'];
                const body = data.length === 0
                    ? '<tr><td colspan="8" style="text-align:center;padding:30px;color:#999">لا توجد معاملات ضريبية</td></tr>'
                    : data.map(g => `<tr>
                        <td><strong>${g.vat_rate}%</strong></td>
                        <td>${fmtInt(g.invoice_count)}</td>
                        <td>${fmt(g.taxable_sales)}</td>
                        <td style="font-weight:bold;color:#059669">${fmt(g.vat_collected)}</td>
                        <td>${fmtInt(g.return_count)}</td>
                        <td>${fmt(g.taxable_returns)}</td>
                        <td style="font-weight:bold;color:#ef4444">${fmt(g.vat_reversed)}</td>
                        <td style="font-weight:bold;color:#8b5cf6">${fmt(g.vat_collected - g.vat_reversed)}</td>
                    </tr>`).join('');
                const foot = `<tr style="font-weight:bold;background:var(--bg-body)">
                    <td style="text-align:left">الإجمالي</td>
                    <td colspan="2">خاضع: ${fmt(t.taxable_sales)}</td>
                    <td style="color:#059669">${fmt(t.vat_collected)}</td>
                    <td colspan="2">مرتجع: ${fmt(t.taxable_returns)}</td>
                    <td style="color:#ef4444">${fmt(t.vat_reversed)}</td>
                    <td style="color:#8b5cf6">${fmt(t.net_vat)}</td>
                </tr>
                <tr style="background:#fef3c7;font-size:12px">
                    <td colspan="8" style="text-align:center">
                        مطابقة محاسبية: ${a.reconciled ? '✅ متطابقة' : '❌ غير متطابقة'} |
                        المحصل محاسبي: ${fmt(a.vat_collected_accounting)} | تشغيلي: ${fmt(a.vat_collected_operational)}
                    </td>
                </tr>`;
                renderTable(headers, body, foot);
                _lastReportData = {
                    title: 'تقرير VAT',
                    filters: [{ label: 'من تاريخ', value: f.from }, { label: 'إلى تاريخ', value: f.to }].filter(x => x.value),
                    summary: [{ label: 'إجمالي VAT محصل', value: fmt(t.vat_collected) }, { label: 'إجمالي VAT مرتجع', value: fmt(t.vat_reversed) }, { label: 'صافي VAT', value: fmt(t.net_vat) }],
                    columns: headers, rows: data.map(g => [g.vat_rate+'%', fmtInt(g.invoice_count), fmt(g.taxable_sales), fmt(g.vat_collected), fmtInt(g.return_count), fmt(g.taxable_returns), fmt(g.vat_reversed), fmt(g.vat_collected - g.vat_reversed)]),
                    totals: [{ label: 'صافي VAT', value: fmt(t.net_vat) }, { label: 'حالة المطابقة', value: a.reconciled ? 'متطابقة' : 'غير متطابقة' }]
                };
            },
            async receivables() {
                const r = await req('/reports/receivables');
                if (!r.success) { showError(r.message); return; }
                const data = r.data || [];
                const t = r.totals || {};
                const headers = ['#', 'العميل', 'الرصيد', 'الحد الائتماني', 'المتاح', 'أيام', '0-30', '31-60', '61-90', '91-120', '120+', 'الاستخدام%'];
                function ageColor(v) { return v > 0 ? 'color:#ef4444;font-weight:bold' : ''; }
                const body = data.length === 0
                    ? '<tr><td colspan="12" style="text-align:center;padding:30px;color:#999">لا توجد ذمم مدينة</td></tr>'
                    : data.map((c, i) => `<tr>
                        <td>${i+1}</td>
                        <td><strong>${c.customer_name || '-'}</strong><br><small>${c.customer_code || ''}</small></td>
                        <td style="color:#dc2626;font-weight:bold">${fmt(c.current_balance)}</td>
                        <td>${fmt(c.credit_limit)}</td>
                        <td style="${c.available_credit > 0 ? 'color:#059669' : 'color:#ef4444'}">${fmt(c.available_credit)}</td>
                        <td>${fmtInt(c.days_outstanding)}</td>
                        <td ${ageColor(c.age_0_30)}>${fmt(c.age_0_30)}</td>
                        <td ${ageColor(c.age_31_60)}>${fmt(c.age_31_60)}</td>
                        <td ${ageColor(c.age_61_90)}>${fmt(c.age_61_90)}</td>
                        <td ${ageColor(c.age_91_120)}>${fmt(c.age_91_120)}</td>
                        <td style="color:#dc2626;font-weight:bold">${fmt(c.age_120_plus)}</td>
                        <td>${(c.utilization_pct||0).toFixed(1)}%</td>
                    </tr>`).join('');
                const foot = `<tr style="font-weight:bold;background:var(--bg-body)">
                    <td colspan="2" style="text-align:left">الإجمالي</td>
                    <td style="color:#dc2626">${fmt(t.total_balance)}</td>
                    <td>${fmt(t.total_credit_limit)}</td>
                    <td></td>
                    <td></td>
                    <td>${fmt(t.age_0_30)}</td>
                    <td>${fmt(t.age_31_60)}</td>
                    <td>${fmt(t.age_61_90)}</td>
                    <td>${fmt(t.age_91_120)}</td>
                    <td style="color:#dc2626;font-weight:bold">${fmt(t.age_120_plus)}</td>
                    <td></td>
                </tr>`;
                renderTable(headers, body, foot);
                _lastReportData = {
                    title: 'تقرير الذمم المدينة',
                    filters: [],
                    summary: [{ label: 'إجمالي الرصيد', value: fmt(t.total_balance) }, { label: 'إجمالي الحد الائتماني', value: fmt(t.total_credit_limit) }],
                    columns: headers, rows: data.map((c, i) => [i+1, c.customer_name||'-', fmt(c.current_balance), fmt(c.credit_limit), fmt(c.available_credit), fmtInt(c.days_outstanding), fmt(c.age_0_30), fmt(c.age_31_60), fmt(c.age_61_90), fmt(c.age_91_120), fmt(c.age_120_plus), (c.utilization_pct||0).toFixed(1)+'%']),
                    totals: [{ label: 'إجمالي الرصيد', value: fmt(t.total_balance) }, { label: 'أقل من 30', value: fmt(t.age_0_30) }, { label: 'أكثر من 120', value: fmt(t.age_120_plus) }]
                };
            },
            async 'top-customers'() {
                const f = getFilters();
                const p = new URLSearchParams({ per_page: '50' });
                if (f.from) p.append('from', f.from); if (f.to) p.append('to', f.to);
                const r = await req(`/reports/top-customers?${p.toString()}`);
                if (!r.success) { showError(r.message); return; }
                const data = r.data || [];
                const headers = ['#', 'العميل', 'الفواتير', 'المبيعات', 'المرتجعات', 'التحصيلات', 'الربح', 'الهامش%', 'المستحق', 'الترتيب'];
                const body = data.length === 0
                    ? '<tr><td colspan="10" style="text-align:center;padding:30px;color:#999">لا توجد بيانات</td></tr>'
                    : data.map(c => `<tr>
                        <td>${fmtInt(c.ranking)}</td>
                        <td><strong>${c.customer_name || '-'}</strong><br><small>${c.customer_code || ''}</small></td>
                        <td>${fmtInt(c.invoice_count)}</td>
                        <td style="font-weight:bold;color:#059669">${fmt(c.total_sales)}</td>
                        <td style="color:#ef4444">${fmt(c.total_returns)}</td>
                        <td style="color:#6366f1">${fmt(c.total_collections)}</td>
                        <td style="font-weight:bold;color:${c.profit >= 0 ? '#059669' : '#ef4444'}">${fmt(c.profit)}</td>
                        <td>${(c.margin_pct||0).toFixed(1)}%</td>
                        <td style="color:#dc2626;font-weight:bold">${fmt(c.outstanding)}</td>
                        <td>🏆 #${fmtInt(c.ranking)}</td>
                    </tr>`).join('');
                renderTable(headers, body);
                _lastReportData = {
                    title: 'تقرير أفضل العملاء',
                    filters: [{ label: 'من تاريخ', value: f.from }, { label: 'إلى تاريخ', value: f.to }].filter(x => x.value),
                    summary: [{ label: 'عدد العملاء', value: fmtInt(data.length) }],
                    columns: headers, rows: data.map(c => [fmtInt(c.ranking), c.customer_name||'-', fmtInt(c.invoice_count), fmt(c.total_sales), fmt(c.total_returns), fmt(c.total_collections), fmt(c.profit), (c.margin_pct||0).toFixed(1)+'%', fmt(c.outstanding), '#'+fmtInt(c.ranking)]),
                    totals: []
                };
            },
            async 'rep-performance'() {
                const f = getFilters();
                const p = new URLSearchParams();
                if (f.from) p.append('from', f.from); if (f.to) p.append('to', f.to);
                if (f.rep) p.append('rep_id', f.rep);
                const r = await req(`/reports/rep-performance?${p.toString()}`);
                if (!r.success) { showError(r.message); return; }
                const data = r.data || [];
                const headers = ['#', 'المندوب', 'الفواتير', 'المبيعات', 'الخصم', 'التحصيلات', 'المرتجعات', 'متوسط الفاتورة', 'الهدف', 'الإنجاز%', 'العمولة'];
                const body = data.length === 0
                    ? '<tr><td colspan="11" style="text-align:center;padding:30px;color:#999">لا توجد بيانات</td></tr>'
                    : data.map((r, i) => `<tr>
                        <td>${i+1}</td>
                        <td><strong>${r.rep_name || '-'}</strong><br><small>${r.rep_code || ''}</small></td>
                        <td>${fmtInt(r.invoice_count)}</td>
                        <td style="font-weight:bold;color:#059669">${fmt(r.total_sales)}</td>
                        <td>${fmt(r.total_discount)}</td>
                        <td>${fmt(r.total_collections)}</td>
                        <td>${fmt(r.total_returns)}</td>
                        <td>${fmt(r.avg_invoice)}</td>
                        <td>${fmt(r.target_amount)}</td>
                        <td>
                            <div style="display:flex;align-items:center;gap:5px">
                                <div style="flex:1;height:6px;background:#e5e7eb;border-radius:3px;">
                                    <div style="height:100%;border-radius:3px;width:${Math.min(r.achievement_pct||0,100)}%;background:${(r.achievement_pct||0) >= 100 ? '#059669' : (r.achievement_pct||0) >= 50 ? '#f59e0b' : '#ef4444'}"></div>
                                </div>
                                <span style="font-weight:bold;font-size:12px">${(r.achievement_pct||0).toFixed(1)}%</span>
                            </div>
                        </td>
                        <td style="font-weight:bold;color:#8b5cf6">${fmt(r.commission_base)}</td>
                    </tr>`).join('');
                renderTable(headers, body);
                _lastReportData = {
                    title: 'تقرير أداء المندوبين',
                    filters: [{ label: 'من تاريخ', value: f.from }, { label: 'إلى تاريخ', value: f.to }, { label: 'المندوب', value: f.rep }].filter(x => x.value),
                    summary: [{ label: 'عدد المندوبين', value: fmtInt(data.length) }],
                    columns: headers, rows: data.map((r, i) => [i+1, r.rep_name||'-', fmtInt(r.invoice_count), fmt(r.total_sales), fmt(r.total_discount), fmt(r.total_collections), fmt(r.total_returns), fmt(r.avg_invoice), fmt(r.target_amount), (r.achievement_pct||0).toFixed(1)+'%', fmt(r.commission_base)]),
                    totals: []
                };
            },
            async 'rep-statement'() {
                const f = getFilters();
                if (!f.rep) { showEmpty('اختر المندوب أولاً من قائمة التصفية'); return; }
                _rstmtPage = 1;
                _rstmtPagination = null;
                await loadRepStatementPage(1);
            }
        };

        function fmtNum(n) {
            return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }

        // ── Rep Statement pagination (in reports context) ──
        let _rstmtPage = 1;
        let _rstmtPagination = null;

        async function loadRepStatementPage(page) {
            const f = getFilters();
            if (!f.rep) { showError('يرجى اختيار المندوب أولاً'); return; }
            _rstmtPage = page;
            const p = new URLSearchParams({ page: String(page), limit: '50' });
            if (f.from) p.append('from', f.from);
            if (f.to) p.append('to', f.to);
            const r = await req(`/reps/${f.rep}/statement?${p.toString()}`);
            if (!r.success) { showError(r.message); return; }
            const data = r.data;
            if (!data) { showError('لا توجد بيانات'); return; }

            hide('rpt-state-loading'); hide('rpt-state-empty'); hide('rpt-state-error'); hide('rpt-table-area');
            show('rpt-rep-statement-area');

            const s = data.summary || {};
            const repName = data.entity ? data.entity.name : '';
            const repCode = data.entity ? data.entity.code : '';
            setHtml('rstmt-rpt-title', 'كشف حساب: ' + (repCode ? repCode + ' - ' : '') + repName);
            setHtml('rstmt-rpt-sales', fmtNum(s.totalSales));
            setHtml('rstmt-rpt-collections', fmtNum(s.totalCollections));
            setHtml('rstmt-rpt-returns', fmtNum(s.totalReturns));
            setHtml('rstmt-rpt-netsales', fmtNum(s.netSales));
            setHtml('rstmt-rpt-commission', fmtNum(s.commission));
            setHtml('rstmt-rpt-balance', fmtNum(s.finalBalance));
            setHtml('rstmt-rpt-netposition', fmtNum(s.netPosition));

            const movements = data.movements || [];
            _rstmtPagination = data.pagination || null;
            const tbody = document.getElementById('rstmt-rpt-tbody');
            if (movements.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:#6b7280">لا توجد حركات في هذا النطاق</td></tr>';
            } else {
                tbody.innerHTML = movements.map(m => {
                    const typeLabel = m.doc_type_label || m.movement_type || '-';
                    const trClass = m.movement_type === 'sales' ? 'row-sales' : m.movement_type === 'return' ? 'row-return' : m.movement_type === 'collection' ? 'row-collection' : '';
                    return '<tr class="' + trClass + '">' +
                        '<td>' + (m.trans_date || '-') + '</td>' +
                        '<td>' + typeLabel + '</td>' +
                        '<td>' + (m.doc_no || '-') + '</td>' +
                        '<td>' + (m.partner_name || '-') + '</td>' +
                        '<td>' + (m.debit ? fmt(m.debit) : '-') + '</td>' +
                        '<td>' + (m.credit ? fmt(m.credit) : '-') + '</td>' +
                        '<td><strong>' + fmt(m.balance) + '</strong></td>' +
                    '</tr>';
                }).join('');
            }

            const pagEl = document.getElementById('rstmt-rpt-pagination');
            if (!_rstmtPagination || _rstmtPagination.pages <= 1) {
                pagEl.style.display = 'none';
            } else {
                pagEl.style.display = 'flex';
                setHtml('rstmt-rpt-page-info', 'الصفحة ' + _rstmtPagination.page + ' من ' + _rstmtPagination.pages);
                document.getElementById('rstmt-rpt-page-prev').disabled = _rstmtPagination.page <= 1;
                document.getElementById('rstmt-rpt-page-next').disabled = _rstmtPagination.page >= _rstmtPagination.pages;
            }

            _lastReportData = {
                title: 'تقرير نشاط المندوب',
                filters: [{ label: 'المندوب', value: repName }, { label: 'من تاريخ', value: f.from }, { label: 'إلى تاريخ', value: f.to }].filter(x => x.value),
                summary: [{ label: 'إجمالي المبيعات', value: fmtNum(s.totalSales) }, { label: 'الرصيد', value: fmtNum(s.finalBalance) }, { label: 'صافي المركز', value: fmtNum(s.netPosition) }],
                columns: ['التاريخ', 'النوع', 'المستند', 'الطرف', 'مدين', 'دائن', 'الرصيد'],
                rows: movements.map(m => [m.trans_date || '-', m.doc_type_label || m.movement_type || '-', m.doc_no || '-', m.partner_name || '-', m.debit ? fmtNum(m.debit) : '-', m.credit ? fmtNum(m.credit) : '-', fmtNum(m.balance)]),
                totals: []
            };
        }

        // Bind rep-statement pagination buttons
        document.getElementById('rstmt-rpt-page-prev')?.addEventListener('click', () => {
            if (_rstmtPagination && _rstmtPagination.page > 1) {
                loadRepStatementPage(_rstmtPagination.page - 1);
            }
        });
        document.getElementById('rstmt-rpt-page-next')?.addEventListener('click', () => {
            if (_rstmtPagination && _rstmtPagination.page < _rstmtPagination.pages) {
                loadRepStatementPage(_rstmtPagination.page + 1);
            }
        });

        // ── Nav sidebar click ──
        const navItems = view.querySelectorAll('.report-nav li');
        navItems.forEach(item => {
            if (item.dataset.bound) return;
            item.dataset.bound = '1';
            if (item.classList.contains('report-nav-separator')) return;
            item.addEventListener('click', async () => {
                navItems.forEach(n => n.classList.remove('active'));
                item.classList.add('active');
                const reportType = item.dataset.report || 'dashboard';
                updateFilterVisibility(reportType);
                showLoading();
                if (renderers[reportType]) {
                    try { await renderers[reportType](); } catch (e) { showError(e.message || 'خطأ'); }
                } else {
                    showEmpty('اختر تقريراً');
                }
            });
        });

        // ── Run button ──
        const runBtn = document.getElementById('rpt-run-btn');
        if (runBtn && !runBtn.dataset.bound) {
            runBtn.dataset.bound = '1';
            runBtn.addEventListener('click', () => {
                const active = view.querySelector('.report-nav li.active');
                if (active) active.click();
            });
        }

        // ── Print Engine ──
        const printEngine = new ReportPrintEngine();
        let _lastReportData = null;

        // ── Print button ──
        const printBtn = document.getElementById('rpt-print');
        if (printBtn && !printBtn.dataset.bound) {
            printBtn.dataset.bound = '1';
            printBtn.addEventListener('click', async () => {
                if (!_lastReportData) { alert('لا توجد بيانات للطباعة'); return; }
                await printEngine.init();
                printEngine.print(_lastReportData);
            });
        }

        // ── CSV Export ──
        const csvBtn = document.getElementById('rpt-export-csv');
        if (csvBtn && !csvBtn.dataset.bound) {
            csvBtn.dataset.bound = '1';
            csvBtn.addEventListener('click', () => {
                if (!_lastReportData) { alert('لا توجد بيانات للتصدير'); return; }
                printEngine.exportCSV(_lastReportData);
            });
        }

        // ── Load dashboard by default ──
        // Check if first nav already has dashboard data; if not, trigger dashboard
        const firstActive = view.querySelector('.report-nav li.active');
        if (!firstActive) {
            const first = view.querySelector('.report-nav li');
            if (first) first.click();
        }
    };
})();
