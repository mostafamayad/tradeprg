(function() {
    'use strict';
    window.viewHandlers = window.viewHandlers || {};
    const viewHandlers = window.viewHandlers;

    const req = (...args) => window.req(...args);
    const fmt = (...args) => window.fmt(...args);
    const fmtPlain = (...args) => window.fmtPlain(...args);
    const fmtInt = (...args) => window.fmtInt(...args);
    const esc = (...args) => window.esc(...args);

    viewHandlers['view-reports-purchases'] = async function () {
        const view = document.getElementById('view-reports-purchases');
        if (!view) return;

        async function loadFilterOptions() {
            const supSel = document.getElementById('pur-rpt-supplier');
            if (supSel && supSel.options.length <= 1) {
                const r = await req('/suppliers');
                if (r.success) (r.data || []).forEach(s => {
                    const o = document.createElement('option');
                    o.value = s.id; o.textContent = `${s.supplier_code} - ${s.supplier_name}`;
                    supSel.appendChild(o);
                });
            }
            const storeSel = document.getElementById('pur-rpt-store');
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

        const supSel = document.getElementById('pur-rpt-supplier');
        if (supSel && !supSel.dataset.searchable) {
            supSel.dataset.searchable = '1';
            window.makeSearchableSelect(supSel, Array.from(supSel.options).filter(o => o.value).map(o => ({id: o.value, name: o.textContent})), 'ابحث عن مورد...');
        }
        const storeSel = document.getElementById('pur-rpt-store');
        if (storeSel && !storeSel.dataset.searchable) {
            storeSel.dataset.searchable = '1';
            window.makeSearchableSelect(storeSel, Array.from(storeSel.options).filter(o => o.value).map(o => ({id: o.value, name: o.textContent})), 'ابحث عن مخزن...');
        }

        function show(id) { const e = document.getElementById(id); if (e) e.style.display = ''; }
        function hide(id) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
        function setHtml(id, html) { const e = document.getElementById(id); if (e) e.innerHTML = html; }

        function showLoading() { hide('pur-rpt-state-empty'); hide('pur-rpt-state-error'); hide('pur-rpt-table-area'); hide('pur-rpt-supplier-statement-area'); hide('pur-rpt-info-bar'); show('pur-rpt-state-loading'); }
        function showEmpty(msg) { hide('pur-rpt-state-loading'); hide('pur-rpt-state-error'); hide('pur-rpt-table-area'); hide('pur-rpt-supplier-statement-area'); hide('pur-rpt-info-bar'); show('pur-rpt-state-empty'); document.querySelector('#pur-rpt-state-empty h3').textContent = msg || 'اختر التقرير والفلترة ثم اضغط عرض'; }
        function showError(msg) { hide('pur-rpt-state-loading'); hide('pur-rpt-state-empty'); hide('pur-rpt-state-error'); hide('pur-rpt-table-area'); hide('pur-rpt-supplier-statement-area'); hide('pur-rpt-info-bar'); show('pur-rpt-state-error'); document.getElementById('pur-rpt-error-msg').textContent = msg || 'خطأ في تحميل التقرير'; }

        function renderTable(headers, rows, foot) {
            hide('pur-rpt-state-loading'); hide('pur-rpt-state-empty'); hide('pur-rpt-state-error'); hide('pur-rpt-supplier-statement-area');
            show('pur-rpt-table-area');
            setHtml('pur-rpt-thead', '<tr>' + headers.map(h => `<th>${h}</th>`).join('') + '</tr>');
            setHtml('pur-rpt-tbody', rows);
            if (foot) { show('pur-rpt-tfoot'); setHtml('pur-rpt-tfoot', foot); }
            else hide('pur-rpt-tfoot');
        }

        const toggleBtn = document.getElementById('pur-rpt-sidebar-toggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                const nav = view.querySelector('.report-nav');
                if (nav) nav.classList.toggle('open');
            });
        }

        function getFilters() {
            const from = document.getElementById('pur-rpt-from')?.value || '';
            const to = document.getElementById('pur-rpt-to')?.value || '';
            const sup = document.getElementById('pur-rpt-supplier')?.value || '';
            const store = document.getElementById('pur-rpt-store')?.value || '';
            return { from, to, sup, store };
        }

        function updateFilterVisibility(reportType) {
            hide('pur-rpt-filter-supplier'); hide('pur-rpt-filter-store');
            if (reportType === 'pur-supplier-statement') show('pur-rpt-filter-supplier');
            if (reportType === 'pur-purchases-by-period') { show('pur-rpt-filter-supplier'); show('pur-rpt-filter-store'); }
            if (reportType === 'pur-purchase-returns') show('pur-rpt-filter-supplier');
            if (reportType === 'pur-supplier-payments') show('pur-rpt-filter-supplier');
            if (reportType === 'pur-product-purchases') show('pur-rpt-filter-store');
            if (reportType === 'pur-purchase-movement') { show('pur-rpt-filter-supplier'); show('pur-rpt-filter-store'); }
        }

        const renderers = {
            async 'pur-dashboard'() {
                const f = getFilters();
                const r = await req(`/reports/purchase-dashboard?from=${f.from}&to=${f.to}`);
                if (!r.success || !r.data) { showError(r.message); return; }
                const d = r.data;
                const info = [
                    { label: 'إجمالي المشتريات', value: fmt(d.total_purchases) },
                    { label: 'صافي المشتريات', value: fmt(d.net_purchases) },
                    { label: 'المرتجعات', value: fmt(d.total_returns) },
                    { label: 'المدفوع', value: fmt(d.paid_amount) },
                    { label: 'المستحق', value: fmt(d.outstanding_amount) },
                    { label: 'الضريبة', value: fmt(d.total_vat) },
                    { label: 'الفواتير', value: fmtInt(d.invoice_count) },
                    { label: 'متوسط الفاتورة', value: fmt(d.avg_invoice) }
                ];
                const bar = document.getElementById('pur-rpt-info-bar');
                if (bar) { bar.innerHTML = info.map(i => '<span><span class="info-label">' + i.label + ':</span> ' + i.value + '</span>').join(' | '); show('pur-rpt-info-bar'); }
                hide('pur-rpt-state-loading'); hide('pur-rpt-state-error'); hide('pur-rpt-table-area'); hide('pur-rpt-supplier-statement-area');
                show('pur-rpt-state-empty');
                document.querySelector('#pur-rpt-state-empty h3').textContent = 'جميع التقارير متاحة';
                document.querySelector('#pur-rpt-state-empty p').textContent = 'اختر تقريراً من القائمة الجانبية للبدء';
                _lastReportData = {
                    title: 'بطاقة أداء تقارير المشتريات',
                    filters: [{ label: 'من تاريخ', value: f.from }, { label: 'إلى تاريخ', value: f.to }].filter(x => x.value),
                    summary: info,
                    columns: [], rows: [], totals: info
                };
            },
            async 'pur-supplier-statement'() {
                const f = getFilters();
                if (!f.sup) { showError('يرجى اختيار المورد أولاً'); return; }
                const r = await req(`/reports/supplier-statement/${f.sup}?from=${f.from}&to=${f.to}`);
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
                const bar = document.getElementById('pur-rpt-info-bar');
                if (bar) bar.innerHTML = '<span><span class="info-label">المورد:</span> ' + (d.supplier?.supplier_name || '') + '</span> | <span><span class="info-label">الرصيد الافتتاحي:</span> ' + fmt(d.opening_balance) + '</span> | <span><span class="info-label">الرصيد الختامي:</span> ' + fmt(d.closing_balance) + '</span>';
                const foot = `<tr style="font-weight:bold;background:var(--bg-body)">
                    <td colspan="4" style="text-align:left">الافتتاحي: ${fmt(d.opening_balance)}</td>
                    <td style="font-weight:600">${fmt(d.total_debit)}</td>
                    <td style="font-weight:600">${fmt(d.total_credit)}</td>
                    <td style="font-weight:800">${fmt(d.closing_balance)}</td>
                </tr>`;
                renderTable(headers, body, foot);
                _lastReportData = {
                    title: 'كشف حساب مورد',
                    filters: [{ label: 'المورد', value: d.supplier?.supplier_name }, { label: 'من تاريخ', value: f.from }, { label: 'إلى تاريخ', value: f.to }].filter(x => x.value),
                    summary: [{ label: 'الرصيد الافتتاحي', value: fmt(d.opening_balance) }, { label: 'الرصيد الختامي', value: fmt(d.closing_balance) }],
                    columns: headers, rows: rows.map((r, i) => [i+1, r.date||'-', r.doc_no||'-', r.doc_type_short||r.doc_type||'-', fmt(r.debit), fmt(r.credit), fmt(r.balance)]),
                    totals: [{ label: 'الافتتاحي', value: fmt(d.opening_balance) }, { label: 'مدين', value: fmt(d.total_debit) }, { label: 'دائن', value: fmt(d.total_credit) }, { label: 'الختامي', value: fmt(d.closing_balance) }]
                };
            },
            async 'pur-purchases-by-period'() {
                const f = getFilters();
                const p = new URLSearchParams();
                if (f.from) p.append('from', f.from); if (f.to) p.append('to', f.to);
                if (f.sup) p.append('supplier_id', f.sup); if (f.store) p.append('store_id', f.store);
                const r = await req(`/reports/purchases-by-period?${p.toString()}`);
                if (!r.success) { showError(r.message); return; }
                const data = r.data || [];
                const t = r.totals || {};
                const headers = ['الفترة', 'عدد الفواتير', 'الكمية', 'الإجمالي', 'الخصم', 'الضريبة', 'صافي', 'متوسط الفاتورة'];
                const body = data.length === 0
                    ? '<tr><td colspan="8" style="text-align:center;padding:30px;color:#999">لا توجد مشتريات</td></tr>'
                    : data.map(p => `<tr>
                        <td><strong>${p.period || '-'}</strong></td>
                        <td>${fmtInt(p.invoice_count)}</td>
                        <td>${fmtInt(p.purchased_qty)}</td>
                        <td>${fmt(p.gross_purchases)}</td>
                        <td>${fmt(p.total_discount)}</td>
                        <td>${fmt(p.total_tax)}</td>
                        <td style="font-weight:bold">${fmt(p.net_purchases)}</td>
                        <td>${fmt(p.avg_invoice)}</td>
                    </tr>`).join('');
                const bar = document.getElementById('pur-rpt-info-bar');
                if (bar) bar.innerHTML = '<span><span class="info-label">فترة التقرير:</span> ' + (f.from || '---') + ' → ' + (f.to || '---') + '</span> | <span><span class="info-label">صافي المشتريات:</span> ' + fmt(t.net_purchases) + '</span> | <span><span class="info-label">عدد الفواتير:</span> ' + fmtInt(t.invoice_count) + '</span> | <span><span class="info-label">مردودات:</span> ' + fmt(t.return_total) + ' (' + (t.return_rate||0).toFixed(1) + '%)</span>';
                const foot = `<tr style="font-weight:bold;background:var(--bg-body)">
                    <td style="text-align:left">الإجمالي</td>
                    <td>${fmtInt(t.invoice_count)}</td>
                    <td>${fmtInt(t.purchased_qty)}</td>
                    <td>${fmt(t.gross_purchases)}</td>
                    <td>${fmt(t.total_discount)}</td>
                    <td>${fmt(t.total_tax)}</td>
                    <td style="color:#059669">${fmt(t.net_purchases)}</td>
                    <td>${fmt(t.avg_invoice)}</td>
                </tr>`;
                renderTable(headers, body, foot);
                _lastReportData = {
                    title: 'تقرير مشتريات فترة',
                    filters: [{ label: 'من تاريخ', value: f.from }, { label: 'إلى تاريخ', value: f.to }, { label: 'المورد', value: f.sup }, { label: 'المخزن', value: f.store }].filter(x => x.value),
                    summary: [{ label: 'عدد الفواتير', value: fmtInt(t.invoice_count) }, { label: 'صافي المشتريات', value: fmt(t.net_purchases) }, { label: 'المردودات', value: fmt(t.return_total) }],
                    columns: headers, rows: data.map(p => [p.period||'-', fmtInt(p.invoice_count), fmtInt(p.purchased_qty), fmt(p.gross_purchases), fmt(p.total_discount), fmt(p.total_tax), fmt(p.net_purchases), fmt(p.avg_invoice)]),
                    totals: [{ label: 'الإجمالي', value: '' }, { label: 'الفواتير', value: fmtInt(t.invoice_count) }, { label: 'صافي', value: fmt(t.net_purchases) }]
                };
            },
            async 'pur-purchase-returns'() {
                const f = getFilters();
                const p = new URLSearchParams();
                if (f.from) p.append('from', f.from); if (f.to) p.append('to', f.to);
                if (f.sup) p.append('supplier_id', f.sup);
                const r = await req(`/reports/purchase-returns?${p.toString()}`);
                if (!r.success) { showError(r.message); return; }
                const data = r.data || [];
                const t = r.totals || {};
                const headers = ['#', 'رقم المرتجع', 'التاريخ', 'المورد', 'الفاتورة', 'الإجمالي', 'الضريبة', 'صافي', 'السبب'];
                const body = data.length === 0
                    ? '<tr><td colspan="9" style="text-align:center;padding:30px;color:#999">لا توجد مرتجعات</td></tr>'
                    : data.map((r, i) => `<tr>
                        <td>${i+1}</td>
                        <td>${r.return_no || '-'}</td>
                        <td>${r.return_date || '-'}</td>
                        <td><strong>${r.supplier_name || '-'}</strong></td>
                        <td>${r.invoice_no || '-'}</td>
                        <td>${fmt(r.grand_total)}</td>
                        <td>${fmt(r.tax_amount)}</td>
                        <td style="font-weight:bold">${fmt(r.net_total)}</td>
                        <td>${r.reason || '-'}</td>
                    </tr>`).join('');
                const foot = `<tr style="font-weight:bold;background:var(--bg-body)">
                    <td colspan="5" style="text-align:left">الإجمالي</td>
                    <td>${fmt(t.grand_total)}</td>
                    <td>${fmt(t.tax_amount)}</td>
                    <td style="color:#059669">${fmt(t.net_total)}</td>
                    <td>عدد: ${fmtInt(t.return_count)}</td>
                </tr>`;
                renderTable(headers, body, foot);
                _lastReportData = {
                    title: 'تقرير مرتجعات المشتريات',
                    filters: [{ label: 'من تاريخ', value: f.from }, { label: 'إلى تاريخ', value: f.to }, { label: 'المورد', value: f.sup }].filter(x => x.value),
                    summary: [{ label: 'عدد المرتجعات', value: fmtInt(t.return_count) }, { label: 'إجمالي', value: fmt(t.grand_total) }],
                    columns: headers, rows: data.map((r, i) => [i+1, r.return_no||'-', r.return_date||'-', r.supplier_name||'-', r.invoice_no||'-', fmt(r.grand_total), fmt(r.tax_amount), fmt(r.net_total), r.reason||'-']),
                    totals: [{ label: 'عدد', value: fmtInt(t.return_count) }, { label: 'الإجمالي', value: fmt(t.grand_total) }]
                };
            },
            async 'pur-supplier-payments'() {
                const f = getFilters();
                const p = new URLSearchParams();
                if (f.from) p.append('from', f.from); if (f.to) p.append('to', f.to);
                if (f.sup) p.append('supplier_id', f.sup);
                const r = await req(`/reports/supplier-payments?${p.toString()}`);
                if (!r.success) { showError(r.message); return; }
                const data = r.data || [];
                const t = r.totals || {};
                const headers = ['#', 'رقم السند', 'التاريخ', 'المورد', 'المبلغ', 'طريقة الدفع', 'المرجع', 'ملاحظات'];
                const body = data.length === 0
                    ? '<tr><td colspan="8" style="text-align:center;padding:30px;color:#999">لا توجد مدفوعات</td></tr>'
                    : data.map((r, i) => `<tr>
                        <td>${i+1}</td>
                        <td>${r.payment_no || '-'}</td>
                        <td>${r.payment_date || '-'}</td>
                        <td><strong>${r.supplier_name || '-'}</strong></td>
                        <td style="font-weight:bold;color:#059669">${fmt(r.amount)}</td>
                        <td>${r.payment_method || '-'}</td>
                        <td>${r.reference || '-'}</td>
                        <td>${r.notes || '-'}</td>
                    </tr>`).join('');
                const foot = `<tr style="font-weight:bold;background:var(--bg-body)">
                    <td colspan="4" style="text-align:left">الإجمالي</td>
                    <td style="color:#059669">${fmt(t.total_amount)}</td>
                    <td colspan="3">عدد: ${fmtInt(t.payment_count)}</td>
                </tr>`;
                renderTable(headers, body, foot);
                _lastReportData = {
                    title: 'تقرير مدفوعات الموردين',
                    filters: [{ label: 'من تاريخ', value: f.from }, { label: 'إلى تاريخ', value: f.to }, { label: 'المورد', value: f.sup }].filter(x => x.value),
                    summary: [{ label: 'عدد السندات', value: fmtInt(t.payment_count) }, { label: 'الإجمالي', value: fmt(t.total_amount) }],
                    columns: headers, rows: data.map((r, i) => [i+1, r.payment_no||'-', r.payment_date||'-', r.supplier_name||'-', fmt(r.amount), r.payment_method||'-', r.reference||'-', r.notes||'-']),
                    totals: [{ label: 'عدد', value: fmtInt(t.payment_count) }, { label: 'الإجمالي', value: fmt(t.total_amount) }]
                };
            },
            async 'pur-payables'() {
                const r = await req('/reports/payables');
                if (!r.success) { showError(r.message); return; }
                const data = r.data || [];
                const t = r.totals || {};
                const headers = ['#', 'المورد', 'الرصيد', 'أيام', '0-30', '31-60', '61-90', '91-120', '120+'];
                function ageColor(v) { return v > 0 ? 'color:#ef4444;font-weight:bold' : ''; }
                const body = data.length === 0
                    ? '<tr><td colspan="9" style="text-align:center;padding:30px;color:#999">لا توجد ذمم دائنة</td></tr>'
                    : data.map((s, i) => `<tr>
                        <td>${i+1}</td>
                        <td><strong>${s.supplier_name || '-'}</strong><br><small>${s.supplier_code || ''}</small></td>
                        <td style="color:#dc2626;font-weight:bold">${fmt(s.current_balance)}</td>
                        <td>${fmtInt(s.days_outstanding)}</td>
                        <td ${ageColor(s.age_0_30)}>${fmt(s.age_0_30)}</td>
                        <td ${ageColor(s.age_31_60)}>${fmt(s.age_31_60)}</td>
                        <td ${ageColor(s.age_61_90)}>${fmt(s.age_61_90)}</td>
                        <td ${ageColor(s.age_91_120)}>${fmt(s.age_91_120)}</td>
                        <td style="color:#dc2626;font-weight:bold">${fmt(s.age_120_plus)}</td>
                    </tr>`).join('');
                const foot = `<tr style="font-weight:bold;background:var(--bg-body)">
                    <td colspan="2" style="text-align:left">الإجمالي</td>
                    <td style="color:#dc2626">${fmt(t.total_balance)}</td>
                    <td></td>
                    <td>${fmt(t.age_0_30)}</td>
                    <td>${fmt(t.age_31_60)}</td>
                    <td>${fmt(t.age_61_90)}</td>
                    <td>${fmt(t.age_91_120)}</td>
                    <td style="color:#dc2626;font-weight:bold">${fmt(t.age_120_plus)}</td>
                </tr>`;
                renderTable(headers, body, foot);
                _lastReportData = {
                    title: 'تقرير أعمار الديون',
                    filters: [],
                    summary: [{ label: 'إجمالي الرصيد', value: fmt(t.total_balance) }],
                    columns: headers, rows: data.map((s, i) => [i+1, s.supplier_name||'-', fmt(s.current_balance), fmtInt(s.days_outstanding), fmt(s.age_0_30), fmt(s.age_31_60), fmt(s.age_61_90), fmt(s.age_91_120), fmt(s.age_120_plus)]),
                    totals: [{ label: 'إجمالي الرصيد', value: fmt(t.total_balance) }, { label: 'أقل من 30', value: fmt(t.age_0_30) }, { label: 'أكثر من 120', value: fmt(t.age_120_plus) }]
                };
            },
            async 'pur-top-suppliers'() {
                const f = getFilters();
                const p = new URLSearchParams({ per_page: '50' });
                if (f.from) p.append('from', f.from); if (f.to) p.append('to', f.to);
                const r = await req(`/reports/top-suppliers?${p.toString()}`);
                if (!r.success) { showError(r.message); return; }
                const data = r.data || [];
                const headers = ['#', 'المورد', 'الفواتير', 'المشتريات', 'المرتجعات', 'المدفوع', 'المستحق', 'الترتيب'];
                const body = data.length === 0
                    ? '<tr><td colspan="8" style="text-align:center;padding:30px;color:#999">لا توجد بيانات</td></tr>'
                    : data.map(s => `<tr>
                        <td>${fmtInt(s.ranking)}</td>
                        <td><strong>${s.supplier_name || '-'}</strong><br><small>${s.supplier_code || ''}</small></td>
                        <td>${fmtInt(s.invoice_count)}</td>
                        <td style="font-weight:bold;color:#059669">${fmt(s.total_purchases)}</td>
                        <td style="color:#ef4444">${fmt(s.total_returns)}</td>
                        <td style="color:#6366f1">${fmt(s.total_payments)}</td>
                        <td style="color:#dc2626;font-weight:bold">${fmt(s.outstanding)}</td>
                        <td>🏆 #${fmtInt(s.ranking)}</td>
                    </tr>`).join('');
                renderTable(headers, body);
                _lastReportData = {
                    title: 'تقرير أفضل الموردين',
                    filters: [{ label: 'من تاريخ', value: f.from }, { label: 'إلى تاريخ', value: f.to }].filter(x => x.value),
                    summary: [{ label: 'عدد الموردين', value: fmtInt(data.length) }],
                    columns: headers, rows: data.map(s => [fmtInt(s.ranking), s.supplier_name||'-', fmtInt(s.invoice_count), fmt(s.total_purchases), fmt(s.total_returns), fmt(s.total_payments), fmt(s.outstanding), '#'+fmtInt(s.ranking)]),
                    totals: []
                };
            },
            async 'pur-product-purchases'() {
                const f = getFilters();
                const p = new URLSearchParams({ per_page: '100' });
                if (f.from) p.append('from', f.from); if (f.to) p.append('to', f.to);
                if (f.store) p.append('store_id', f.store);
                const r = await req(`/reports/product-purchases?${p.toString()}`);
                if (!r.success) { showError(r.message); return; }
                const data = r.data || [];
                const headers = ['#', 'كود الصنف', 'اسم الصنف', 'الوحدة', 'الكمية المشتراة', 'المرتجع', 'صافي', 'قيمة المشتريات', 'التكلفة', 'المخزون'];
                const body = data.length === 0
                    ? '<tr><td colspan="10" style="text-align:center;padding:30px;color:#999">لا توجد مشتريات للأصناف</td></tr>'
                    : data.map((p, i) => `<tr>
                        <td>${i+1}</td>
                        <td>${p.product_code || '-'}</td>
                        <td><strong>${p.product_name || '-'}</strong></td>
                        <td>${p.unit_name || '-'}</td>
                        <td>${fmtInt(p.purchased_qty)}</td>
                        <td>${fmtInt(p.returned_qty)}</td>
                        <td>${fmtInt(p.net_qty)}</td>
                        <td>${fmt(p.purchase_value)}</td>
                        <td>${fmt(p.cost)}</td>
                        <td>${fmtInt(p.inventory)}</td>
                    </tr>`).join('');
                renderTable(headers, body);
                _lastReportData = {
                    title: 'تقرير الأصناف المشتراة',
                    filters: [{ label: 'من تاريخ', value: f.from }, { label: 'إلى تاريخ', value: f.to }, { label: 'المخزن', value: f.store }].filter(x => x.value),
                    summary: [{ label: 'عدد الأصناف', value: fmtInt(data.length) }],
                    columns: headers, rows: data.map((p, i) => [i+1, p.product_code||'-', p.product_name||'-', p.unit_name||'-', fmtInt(p.purchased_qty), fmtInt(p.returned_qty), fmtInt(p.net_qty), fmt(p.purchase_value), fmt(p.cost), fmtInt(p.inventory)]),
                    totals: []
                };
            },
            async 'pur-purchase-movement'() {
                const f = getFilters();
                const p = new URLSearchParams();
                if (f.from) p.append('from', f.from); if (f.to) p.append('to', f.to);
                if (f.sup) p.append('supplier_id', f.sup); if (f.store) p.append('store_id', f.store);
                const r = await req(`/reports/purchase-movement?${p.toString()}`);
                if (!r.success) { showError(r.message); return; }
                const data = r.data || [];
                const t = r.totals || {};
                const headers = ['#', 'التاريخ', 'رقم المستند', 'النوع', 'المورد', 'المخزن', 'الإجمالي', 'الضريبة', 'صافي', 'الحالة'];
                const body = data.length === 0
                    ? '<tr><td colspan="10" style="text-align:center;padding:30px;color:#999">لا توجد حركات مشتريات</td></tr>'
                    : data.map((r, i) => {
                        const statusColor = r.status === 'paid' ? '#059669' : r.status === 'cancelled' ? '#ef4444' : '#f59e0b';
                        const statusLabel = r.status === 'paid' ? 'مدفوعة' : r.status === 'cancelled' ? 'ملغية' : 'معلقة';
                        return `<tr>
                            <td>${i+1}</td>
                            <td>${r.trans_date || '-'}</td>
                            <td>${r.doc_no || '-'}</td>
                            <td>${r.doc_type || '-'}</td>
                            <td>${r.supplier_name || '-'}</td>
                            <td>${r.store_name || '-'}</td>
                            <td>${fmt(r.grand_total)}</td>
                            <td>${fmt(r.tax_amount)}</td>
                            <td style="font-weight:bold">${fmt(r.net_total)}</td>
                            <td style="color:${statusColor};font-weight:bold">${statusLabel}</td>
                        </tr>`;
                    }).join('');
                const foot = `<tr style="font-weight:bold;background:var(--bg-body)">
                    <td colspan="6" style="text-align:left">الإجمالي</td>
                    <td>${fmt(t.grand_total)}</td>
                    <td>${fmt(t.tax_amount)}</td>
                    <td style="color:#059669">${fmt(t.net_total)}</td>
                    <td>عدد: ${fmtInt(t.trans_count)}</td>
                </tr>`;
                renderTable(headers, body, foot);
                _lastReportData = {
                    title: 'تقرير حركة المشتريات',
                    filters: [{ label: 'من تاريخ', value: f.from }, { label: 'إلى تاريخ', value: f.to }, { label: 'المورد', value: f.sup }, { label: 'المخزن', value: f.store }].filter(x => x.value),
                    summary: [{ label: 'عدد الحركات', value: fmtInt(t.trans_count) }, { label: 'صافي', value: fmt(t.net_total) }],
                    columns: headers, rows: data.map((r, i) => [i+1, r.trans_date||'-', r.doc_no||'-', r.doc_type||'-', r.supplier_name||'-', r.store_name||'-', fmt(r.grand_total), fmt(r.tax_amount), fmt(r.net_total), r.status||'-']),
                    totals: [{ label: 'عدد', value: fmtInt(t.trans_count) }, { label: 'الإجمالي', value: fmt(t.grand_total) }]
                };
            },
            async 'pur-vat'() {
                const f = getFilters();
                const r = await req(`/reports/vat-purchase-report?from=${f.from}&to=${f.to}`);
                if (!r.success) { showError(r.message); return; }
                const data = r.data || [];
                const t = r.totals || {};
                const a = r.accounting_validation || {};
                const headers = ['نسبة VAT', 'عدد الفواتير', 'المشتريات الخاضعة', 'VAT المسدد', 'عدد المرتجعات', 'المرتجعات الخاضعة', 'VAT المرتجع', 'صافي VAT'];
                const body = data.length === 0
                    ? '<tr><td colspan="8" style="text-align:center;padding:30px;color:#999">لا توجد معاملات ضريبية</td></tr>'
                    : data.map(g => `<tr>
                        <td><strong>${g.vat_rate}%</strong></td>
                        <td>${fmtInt(g.invoice_count)}</td>
                        <td>${fmt(g.taxable_purchases)}</td>
                        <td style="font-weight:bold;color:#059669">${fmt(g.vat_paid)}</td>
                        <td>${fmtInt(g.return_count)}</td>
                        <td>${fmt(g.taxable_returns)}</td>
                        <td style="font-weight:bold;color:#ef4444">${fmt(g.vat_reversed)}</td>
                        <td style="font-weight:bold;color:#8b5cf6">${fmt(g.vat_paid - g.vat_reversed)}</td>
                    </tr>`).join('');
                const foot = `<tr style="font-weight:bold;background:var(--bg-body)">
                    <td style="text-align:left">الإجمالي</td>
                    <td colspan="2">خاضع: ${fmt(t.taxable_purchases)}</td>
                    <td style="color:#059669">${fmt(t.vat_paid)}</td>
                    <td colspan="2">مرتجع: ${fmt(t.taxable_returns)}</td>
                    <td style="color:#ef4444">${fmt(t.vat_reversed)}</td>
                    <td style="color:#8b5cf6">${fmt(t.net_vat)}</td>
                </tr>
                <tr style="background:#fef3c7;font-size:12px">
                    <td colspan="8" style="text-align:center">
                        مطابقة محاسبية: ${a.reconciled ? '✅ متطابقة' : '❌ غير متطابقة'} |
                        المسدد محاسبي: ${fmt(a.vat_paid_accounting)} | تشغيلي: ${fmt(a.vat_paid_operational)}
                    </td>
                </tr>`;
                renderTable(headers, body, foot);
                _lastReportData = {
                    title: 'تقرير VAT المشتريات',
                    filters: [{ label: 'من تاريخ', value: f.from }, { label: 'إلى تاريخ', value: f.to }].filter(x => x.value),
                    summary: [{ label: 'إجمالي VAT مسدد', value: fmt(t.vat_paid) }, { label: 'إجمالي VAT مرتجع', value: fmt(t.vat_reversed) }, { label: 'صافي VAT', value: fmt(t.net_vat) }],
                    columns: headers, rows: data.map(g => [g.vat_rate+'%', fmtInt(g.invoice_count), fmt(g.taxable_purchases), fmt(g.vat_paid), fmtInt(g.return_count), fmt(g.taxable_returns), fmt(g.vat_reversed), fmt(g.vat_paid - g.vat_reversed)]),
                    totals: [{ label: 'صافي VAT', value: fmt(t.net_vat) }, { label: 'حالة المطابقة', value: a.reconciled ? 'متطابقة' : 'غير متطابقة' }]
                };
            }
        };

        // ── Nav sidebar click ──
        const navItems = view.querySelectorAll('.report-nav li');
        navItems.forEach(item => {
            if (item.dataset.bound) return;
            item.dataset.bound = '1';
            if (item.classList.contains('report-nav-separator')) return;
            item.addEventListener('click', async () => {
                navItems.forEach(n => n.classList.remove('active'));
                item.classList.add('active');
                const reportType = item.dataset.report || 'pur-dashboard';
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
        const runBtn = document.getElementById('pur-rpt-run-btn');
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

        const printBtn = document.getElementById('pur-rpt-print');
        if (printBtn && !printBtn.dataset.bound) {
            printBtn.dataset.bound = '1';
            printBtn.addEventListener('click', async () => {
                if (!_lastReportData) { alert('لا توجد بيانات للطباعة'); return; }
                await printEngine.init();
                printEngine.print(_lastReportData);
            });
        }

        const csvBtn = document.getElementById('pur-rpt-export-csv');
        if (csvBtn && !csvBtn.dataset.bound) {
            csvBtn.dataset.bound = '1';
            csvBtn.addEventListener('click', () => {
                if (!_lastReportData) { alert('لا توجد بيانات للتصدير'); return; }
                printEngine.exportCSV(_lastReportData);
            });
        }

        const firstActive = view.querySelector('.report-nav li.active');
        if (!firstActive) {
            const first = view.querySelector('.report-nav li');
            if (first) first.click();
        }
    };
})();
