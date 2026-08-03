(function() {
    'use strict';
    window.viewHandlers = window.viewHandlers || {};
    const viewHandlers = window.viewHandlers;

    const req = (...args) => window.req(...args);
    const fmt = (...args) => window.fmt(...args);
    const fmtPlain = (...args) => window.fmtPlain(...args);
    const fmtInt = (...args) => window.fmtInt(...args);
    const esc = (...args) => window.esc(...args);

    let cfDailyChartInstance = null;
    let cfMonthlyChartInstance = null;
    let agingArBucketChart = null, agingArTrendChart = null, agingApBucketChart = null;
    let profTrendChart = null, profMarginChart = null, profCategoryChart = null;

    viewHandlers['view-cash-flow'] = async function () {
        const set = (id, val) => { const e = document.getElementById(id); if (e) e.innerHTML = val; };
        try {
            const [stmtRes, chartsRes, forecastRes] = await Promise.all([
                req('/analytics/v1/cash-flow/statement?from=2026-01-01&to=2026-12-31'),
                req('/analytics/v1/cash-flow/charts?from=2026-01-01&to=2026-12-31'),
                req('/analytics/v1/cash-flow/forecast')
            ]);
            if (!stmtRes.success || !chartsRes.success) return;
            const stmt = stmtRes.data;
            const charts = chartsRes.data;

            // KPIs
            const oc = stmt.operating.net;
            const fc = stmt.operating.net - stmt.investing.net;
            set('cf-operating-cash', fmt(oc) + ' ج.م');
            set('cf-free-cash', fmt(fc) + ' ج.م');

            // Summary
            set('cf-opening', fmt(stmt.summary.openingCash) + ' ج.م');
            set('cf-inflow', fmt(stmt.summary.totalInflow) + ' ج.م');
            set('cf-outflow', fmt(stmt.summary.totalOutflow) + ' ج.م');
            set('cf-net-change', fmt(stmt.summary.netCashFlow) + ' ج.م');

            // Operating list
            const opList = document.getElementById('cf-operating-list');
            if (opList) {
                let html = '';
                stmt.operating.inflows.forEach(item => {
                    html += '<li style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9">'
                        + '<span style="font-weight:600;font-size:0.85rem;color:#10b981"><i class="fa-solid fa-arrow-down"></i> ' + esc(item.category) + '</span>'
                        + '<span style="color:#10b981;font-weight:700;font-size:0.85rem">+' + fmt(item.amount) + ' ج.م</span></li>';
                });
                stmt.operating.outflows.forEach(item => {
                    html += '<li style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9">'
                        + '<span style="font-weight:600;font-size:0.85rem;color:#ef4444"><i class="fa-solid fa-arrow-up"></i> ' + esc(item.category) + '</span>'
                        + '<span style="color:#ef4444;font-weight:700;font-size:0.85rem">-' + fmt(item.amount) + ' ج.م</span></li>';
                });
                html += '<li style="display:flex;justify-content:space-between;padding:10px 0;font-weight:800;border-top:2px dashed #e2e8f0">'
                    + '<span>صافي التشغيل</span><span style="color:' + (oc >= 0 ? '#10b981' : '#ef4444') + '">' + fmt(oc) + ' ج.م</span></li>';
                opList.innerHTML = html || '<li style="padding:10px 0;color:#888">لا توجد بيانات</li>';
            }

            // Investing/Financing list
            const invList = document.getElementById('cf-investing-list');
            if (invList) {
                let html = '';
                stmt.investing.outflows.forEach(item => {
                    html += '<li style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9">'
                        + '<span style="font-weight:600;font-size:0.85rem;color:#f59e0b"><i class="fa-solid fa-arrow-up"></i> ' + esc(item.category) + '</span>'
                        + '<span style="color:#f59e0b;font-weight:700;font-size:0.85rem">-' + fmt(item.amount) + ' ج.م</span></li>';
                });
                stmt.financing.inflows.forEach(item => {
                    html += '<li style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9">'
                        + '<span style="font-weight:600;font-size:0.85rem;color:#3b82f6"><i class="fa-solid fa-arrow-down"></i> ' + esc(item.category) + '</span>'
                        + '<span style="color:#3b82f6;font-weight:700;font-size:0.85rem">+' + fmt(item.amount) + ' ج.م</span></li>';
                });
                stmt.financing.outflows.forEach(item => {
                    html += '<li style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9">'
                        + '<span style="font-weight:600;font-size:0.85rem;color:#f59e0b"><i class="fa-solid fa-arrow-up"></i> ' + esc(item.category) + '</span>'
                        + '<span style="color:#f59e0b;font-weight:700;font-size:0.85rem">-' + fmt(item.amount) + ' ج.م</span></li>';
                });
                invList.innerHTML = html || '<li style="padding:10px 0;color:#888">لا توجد بيانات</li>';
            }

            // Forecast table
            const ftBody = document.getElementById('cf-forecast-table');
            if (ftBody && forecastRes.success && forecastRes.data.forecast) {
                ftBody.innerHTML = forecastRes.data.forecast.map(f => {
                    const bal = f.projectedBalance;
                    const cls = bal >= 0 ? '#10b981' : '#ef4444';
                    return '<tr><td style="font-weight:600">' + f.month + '</td>'
                        + '<td style="color:#10b981;font-weight:700">' + fmt(f.projectedInflow) + ' ج.م</td>'
                        + '<td style="color:#ef4444;font-weight:700">' + fmt(f.projectedOutflow) + ' ج.م</td>'
                        + '<td style="color:' + cls + ';font-weight:700">' + fmt(f.projectedBalance) + ' ج.م</td></tr>';
                }).join('');
                // KPIs from forecast
                set('cf-burn-rate', fmt(forecastRes.data.avgBurnRate) + ' ج.م/شهر');
                const runway = forecastRes.data.runwayMonths;
                set('cf-runway', runway === 'infinity' ? 'غير محدود' : runway + ' شهر');
            }

            // Daily Chart
            if (charts.dailyBalance && charts.dailyBalance.length > 0 && typeof Chart !== 'undefined') {
                const ctx = document.getElementById('cf-daily-chart');
                if (ctx) {
                    if (cfDailyChartInstance) cfDailyChartInstance.destroy();
                    const labels = charts.dailyBalance.map(r => { const d = new Date(r.date); return d.getDate() + ' ' + d.toLocaleString('ar-EG',{month:'short'}); });
                    const data = charts.dailyBalance.map(r => r.balance);
                    cfDailyChartInstance = new Chart(ctx, {
                        type: 'line',
                        data: { labels, datasets: [{
                            label: 'الرصيد',
                            data, borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.1)',
                            borderWidth: 3, fill: true, tension: 0.4,
                            pointBackgroundColor: '#fff', pointBorderColor: '#8b5cf6', pointBorderWidth: 2
                        }] },
                        options: {
                            responsive: true, maintainAspectRatio: false,
                            plugins: { legend: { display: false } },
                            scales: { y: { beginAtZero: true, grid: { borderDash: [5,5] } }, x: { grid: { display: false } } }
                        }
                    });
                }
            }

            // Monthly Chart
            if (charts.monthlyTrend && charts.monthlyTrend.length > 0 && typeof Chart !== 'undefined') {
                const ctx = document.getElementById('cf-monthly-chart');
                if (ctx) {
                    if (cfMonthlyChartInstance) cfMonthlyChartInstance.destroy();
                    const labels = charts.monthlyTrend.map(r => r.month);
                    const inflow = charts.monthlyTrend.map(r => r.inflow);
                    const outflow = charts.monthlyTrend.map(r => r.outflow);
                    cfMonthlyChartInstance = new Chart(ctx, {
                        type: 'bar',
                        data: {
                            labels,
                            datasets: [
                                { label: 'وارد', data: inflow, backgroundColor: '#10b981', borderRadius: 4 },
                                { label: 'منصرف', data: outflow, backgroundColor: '#ef4444', borderRadius: 4 }
                            ]
                        },
                        options: {
                            responsive: true, maintainAspectRatio: false,
                            plugins: { legend: { position: 'top', labels: { font: { family: 'Cairo' } } } },
                            scales: { y: { beginAtZero: true, grid: { borderDash: [5,5] } }, x: { grid: { display: false } } }
                        }
                    });
                }
            }
        } catch (e) {
            console.error('Cash Flow Error:', e);
        }
    };

    window.loadCashFlow = function () {
        const handler = viewHandlers['view-cash-flow'];
        if (handler) handler();
    };

    viewHandlers['view-collections'] = async function () {
        const tbody = document.getElementById('collections-tbody');
        if (!tbody) return;
        const now = new Date();
        const fromInput = document.getElementById('collections-from');
        const toInput = document.getElementById('collections-to');
        if (fromInput && !fromInput.value) fromInput.value = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
        if (toInput && !toInput.value) toInput.value = now.toISOString().slice(0, 10);

        let currentRows = [];

        function statusLabel(s) {
            const map = { unallocated: 'غير موزع', partial: 'موزع جزئياً', allocated: 'موزع بالكامل', cancelled: 'ملغي' };
            return map[s] || s || '-';
        }
        function statusBadge(s) {
            const cls = s === 'cancelled' ? 'overdue' : s === 'allocated' ? 'paid' : 'pending';
            return `<span class="badge-status ${cls}">${statusLabel(s)}</span>`;
        }
        function methodLabel(m) {
            if (m === 'cash') return 'نقدي';
            if (m === 'check') return 'شيك';
            if (m === 'transfer') return 'تحويل بنكي';
            return m || '-';
        }

        // Load filter dropdowns (customers + reps) once
        async function loadFilters() {
            const custSel = document.getElementById('collections-customer');
            const repSel = document.getElementById('collections-rep');
            if (custSel && !custSel.dataset.loaded) {
                try {
                    const r = await req('/customers');
                    (r.data || []).forEach(c => {
                        const opt = document.createElement('option');
                        opt.value = c.id;
                        opt.textContent = c.customer_name;
                        custSel.appendChild(opt);
                    });
                } catch (e) { console.error(e); }
                custSel.dataset.loaded = '1';
            }
            if (repSel && !repSel.dataset.loaded) {
                try {
                    const r = await req('/reps');
                    (r.data || []).forEach(rp => {
                        const opt = document.createElement('option');
                        opt.value = rp.id;
                        opt.textContent = rp.rep_name;
                        repSel.appendChild(opt);
                    });
                } catch (e) { console.error(e); }
                repSel.dataset.loaded = '1';
            }
        }

        async function loadCollections() {
            const params = new URLSearchParams();
            const from = document.getElementById('collections-from')?.value;
            const to = document.getElementById('collections-to')?.value;
            const method = document.getElementById('collections-method')?.value;
            const q = document.getElementById('collections-search')?.value;
            const customer = document.getElementById('collections-customer')?.value;
            const rep = document.getElementById('collections-rep')?.value;
            const status = document.getElementById('collections-status')?.value;
            const bank = document.getElementById('collections-bank')?.value;
            if (q) params.append('q', q);
            if (from) params.append('from', from);
            if (to) params.append('to', to);
            if (method) params.append('payment_method', method);
            if (customer) params.append('customer_id', customer);
            if (rep) params.append('rep_id', rep);
            if (status) params.append('status', status);
            if (bank) params.append('bank', bank);
            try {
                const r = await req('/collections' + (params.toString() ? '?' + params : ''));
                if (!r.success) return;
                const rows = r.data || [];
                currentRows = rows;
                renderTable(rows);
                renderSummary(r.summary || rows);
            } catch (e) {
                console.error(e);
                tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:30px;color:var(--text-muted)">خطأ في تحميل البيانات</td></tr>';
            }
        }

        function renderTable(rows) {
            tbody.innerHTML = '';
            if (rows.length === 0) {
                tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:30px;color:var(--text-muted)">لا توجد تحصيلات في الفترة المحددة</td></tr>';
                return;
            }
            rows.forEach(c => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${c.collection_no || '-'}</strong></td>
                    <td>${c.collection_date || '-'}</td>
                    <td>${c.customer_name || '-'}</td>
                    <td>${c.rep_name || '-'}</td>
                    <td>${methodLabel(c.payment_method)}</td>
                    <td>${c.bank_name || '-'}</td>
                    <td>${c.check_no || '-'}</td>
                    <td class="text-success"><strong>${fmt(c.amount)} ج.م</strong></td>
                    <td>${fmt(c.allocated)}</td>
                    <td>${fmt(c.remaining)}</td>
                    <td>${statusBadge(c.status)}</td>
                    <td>${c.notes || '-'}</td>`;
                tbody.appendChild(tr);
            });
        }

        function renderSummary(src) {
            const set = (id, val) => { const e = document.getElementById(id); if (e) e.innerHTML = val; };
            if (src && src.total_count !== undefined) {
                set('collections-sum-count', fmtInt(src.total_count));
                set('collections-sum-amount', fmt(src.total_amount) + ' ج.م');
                set('collections-sum-allocated', fmt(src.total_allocated) + ' ج.م');
                set('collections-sum-remaining', fmt(src.total_remaining) + ' ج.م');
                set('collections-sum-active', fmtInt(src.active_count));
                set('collections-sum-reversed', fmtInt(src.reversed_count));
            } else {
                const rows = src || [];
                let amt = 0, all = 0, rem = 0, act = 0, rev = 0;
                rows.forEach(c => {
                    const a = Number(c.amount || 0);
                    const al = Number(c.allocated || 0);
                    amt += a; all += al; rem += (a - al);
                    if (c.status === 'cancelled') rev++; else act++;
                });
                set('collections-sum-count', fmtInt(rows.length));
                set('collections-sum-amount', fmt(amt) + ' ج.م');
                set('collections-sum-allocated', fmt(all) + ' ج.م');
                set('collections-sum-remaining', fmt(rem) + ' ج.م');
                set('collections-sum-active', fmtInt(act));
                set('collections-sum-reversed', fmtInt(rev));
            }
        }

        function getCompanyInfo() {
            let coName = '', coPhone = '', coAddr = '', coLogo = '';
            try {
                const settings = window.AppData && window.AppData.settings;
                if (settings) {
                    coName  = settings.company_name  || settings.name  || '';
                    coPhone = settings.company_phone || settings.phone || '';
                    coAddr  = settings.company_address || settings.address || '';
                    coLogo  = settings.logo_url || '';
                }
            } catch (e) {}
            return { coName, coPhone, coAddr, coLogo };
        }

        function printReport(mode) {
            if (currentRows.length === 0) { alert('لا توجد بيانات للطباعة'); return; }
            const co = getCompanyInfo();
            const from = document.getElementById('collections-from')?.value || '—';
            const to = document.getElementById('collections-to')?.value || '—';

            let rows = '';
            currentRows.forEach((c, i) => {
                const bg = i % 2 === 0 ? '#fff' : '#f9fafb';
                rows += '<tr style="background:' + bg + '">'
                    + '<td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:center">' + esc(c.collection_no || '-') + '</td>'
                    + '<td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:center">' + esc(c.collection_date || '-') + '</td>'
                    + '<td style="padding:5px 8px;border:1px solid #e5e7eb">' + esc(c.customer_name || '-') + '</td>'
                    + '<td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:center">' + esc(c.rep_name || '-') + '</td>'
                    + '<td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:center">' + methodLabel(c.payment_method) + '</td>'
                    + '<td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:center">' + esc(c.bank_name || '-') + '</td>'
                    + '<td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:center">' + esc(c.check_no || '-') + '</td>'
                    + '<td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:right;direction:ltr">' + fmt(c.amount) + '</td>'
                    + '<td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:right;direction:ltr">' + fmt(c.allocated) + '</td>'
                    + '<td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:right;direction:ltr">' + fmt(c.remaining) + '</td>'
                    + '<td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:center">' + statusLabel(c.status) + '</td>'
                    + '<td style="padding:5px 8px;border:1px solid #e5e7eb">' + esc(c.notes || '-') + '</td>'
                    + '</tr>';
            });

            let tAmt = 0, tAll = 0, tRem = 0;
            currentRows.forEach(c => { tAmt += Number(c.amount || 0); tAll += Number(c.allocated || 0); tRem += Number(c.remaining || 0); });
            const totalRow = '<tr style="background:#fef2f2;font-weight:700">'
                + '<td colspan="7" style="padding:6px 8px;border:1px solid #e5e7eb;text-align:center">الإجمالي</td>'
                + '<td style="padding:6px 8px;border:1px solid #e5e7eb;text-align:right;direction:ltr">' + fmt(tAmt) + '</td>'
                + '<td style="padding:6px 8px;border:1px solid #e5e7eb;text-align:right;direction:ltr">' + fmt(tAll) + '</td>'
                + '<td style="padding:6px 8px;border:1px solid #e5e7eb;text-align:right;direction:ltr">' + fmt(tRem) + '</td>'
                + '<td colspan="2" style="padding:6px 8px;border:1px solid #e5e7eb;text-align:center"></td>'
                + '</tr>';

            const logoHtml = co.coLogo ? '<img src="' + co.coLogo + '" style="max-height:55px;max-width:120px;object-fit:contain;margin-bottom:6px" onerror="this.style.display=\'none\'">' : '';
            const printDate = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });

            const w = window.open('', '_blank', 'width=1200,height=800,scrollbars=yes');
            if (!w) { alert('يرجى السماح بفتح نوافذ جديدة في المتصفح'); return; }
            w.document.write('<!DOCTYPE html><html dir="rtl" lang="ar"><head>'
                + '<meta charset="UTF-8">'
                + '<title>تقرير تحصيلات العملاء - ' + esc(co.coName) + '</title>'
                + '<style>'
                + 'body{font-family:"Segoe UI",Arial,sans-serif;margin:20px;color:#1e293b;font-size:11.5px;}'
                + '.print-header{text-align:center;margin-bottom:18px;padding-bottom:14px;border-bottom:3px solid #7c3aed;}'
                + '.co-name{font-size:1.3rem;font-weight:800;color:#1e293b;}'
                + '.co-info{font-size:0.8rem;color:#64748b;margin-top:3px;}'
                + '.report-title{font-size:1.1rem;font-weight:700;margin:10px 0 4px;color:#7c3aed;}'
                + '.report-period{font-size:0.85rem;color:#475569;}'
                + 'table{width:100%;border-collapse:collapse;margin-top:12px;font-size:11px;}'
                + 'th{background:#7c3aed;color:#fff;padding:7px 8px;border:1px solid #7c3aed;text-align:center;font-size:10.5px;font-weight:600;white-space:nowrap;}'
                + '.footer-print{text-align:center;font-size:10px;color:#94a3b8;margin-top:18px;padding-top:8px;border-top:1px solid #e2e8f0;}'
                + '@media print{body{margin:12px;}-webkit-print-color-adjust:exact;print-color-adjust:exact;}'
                + '</style></head><body>'
                + '<div class="print-header">'
                + (logoHtml ? '<div>' + logoHtml + '</div>' : '')
                + '<div class="co-name">' + esc(co.coName) + '</div>'
                + '<div class="co-info">' + [co.coAddr, co.coPhone].filter(Boolean).map(esc).join(' | ') + '</div>'
                + '<div class="report-title">تقرير تحصيلات العملاء (سندات القبض)</div>'
                + '<div class="report-period">من ' + esc(from) + ' إلى ' + esc(to) + ' | تاريخ الطباعة: ' + printDate + '</div>'
                + '</div>'
                + '<table><thead><tr>'
                + '<th>رقم السند</th><th>التاريخ</th><th>العميل</th><th>المندوب</th><th>طريقة الدفع</th><th>البنك</th><th>رقم الشيك</th><th>المبلغ</th><th>الموزع</th><th>المتبقي</th><th>الحالة</th><th>ملاحظات</th>'
                + '</tr></thead><tbody>' + rows + totalRow + '</tbody></table>'
                + '<div class="footer-print">TradePro ERP &mdash; تقرير تحصيلات العملاء</div>'
                + (mode === 'pdf' ? '' : '<script>window.onload=function(){window.print();};<\/script>')
                + '</body></html>');
            w.document.close();
        }

        function exportExcel() {
            if (currentRows.length === 0) { alert('لا توجد بيانات للتصدير'); return; }
            const from = document.getElementById('collections-from')?.value || 'البداية';
            const to = document.getElementById('collections-to')?.value || 'النهاية';
            const headers = ['رقم السند', 'التاريخ', 'العميل', 'المندوب', 'طريقة الدفع', 'البنك', 'رقم الشيك', 'المبلغ', 'الموزع', 'المتبقي', 'الحالة', 'ملاحظات'];
            const dataRows = currentRows.map(c => [
                c.collection_no || '', c.collection_date || '', c.customer_name || '', c.rep_name || '',
                methodLabel(c.payment_method), c.bank_name || '', c.check_no || '',
                Number(c.amount || 0), Number(c.allocated || 0), Number(c.remaining || 0),
                statusLabel(c.status), c.notes || ''
            ]);
            let tAmt = 0, tAll = 0, tRem = 0;
            currentRows.forEach(c => { tAmt += Number(c.amount || 0); tAll += Number(c.allocated || 0); tRem += Number(c.remaining || 0); });
            dataRows.push(['الإجمالي', '', '', '', '', '', '', tAmt, tAll, tRem, '', '']);
            ExportService.exportReport('excel', {
                filename: 'collections-report-' + (from.replace(/-/g, '')) + '-' + (to.replace(/-/g, '')),
                headers: headers,
                rows: dataRows
            });
        }

        await loadFilters();
        await loadCollections();

        ['collections-from', 'collections-to', 'collections-method', 'collections-search',
         'collections-customer', 'collections-rep', 'collections-status', 'collections-bank'].forEach(id => {
            const el = document.getElementById(id);
            if (el && !el.dataset.bound) {
                el.dataset.bound = '1';
                el.addEventListener('input', loadCollections);
                el.addEventListener('change', loadCollections);
            }
        });

        const viewBtn = document.getElementById('btn-collections-view');
        if (viewBtn) viewBtn.onclick = loadCollections;
        const printBtn = document.getElementById('btn-collections-print');
        if (printBtn) printBtn.onclick = () => printReport('print');
        const pdfBtn = document.getElementById('btn-collections-pdf');
        if (pdfBtn) pdfBtn.onclick = () => printReport('pdf');
        const excelBtn = document.getElementById('btn-collections-excel');
        if (excelBtn) excelBtn.onclick = exportExcel;
    };

    function openCollectionModal() {
        const modal = document.getElementById('global-modal');
        if (!modal) return;
        document.getElementById('modal-title').textContent = 'سند قبض جديد';
        document.getElementById('modal-body').innerHTML = `
            <div id="col-balance-preview" style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:16px;display:flex;gap:16px;flex-wrap:wrap">
                <div style="flex:1;min-width:120px"><label style="display:block;font-size:0.75rem;color:var(--text-muted)">الرصيد السابق</label><strong id="col-bal-opening" style="font-size:1.1rem">---</strong></div>
                <div style="flex:1;min-width:120px"><label style="display:block;font-size:0.75rem;color:var(--text-muted)">إجمالي المديونية</label><strong id="col-bal-current" style="font-size:1.1rem">---</strong></div>
                <div style="flex:1;min-width:120px"><label style="display:block;font-size:0.75rem;color:var(--text-muted)">المبلغ الحالي</label><strong id="col-bal-amount" style="font-size:1.1rem">---</strong></div>
                <div style="flex:1;min-width:120px"><label style="display:block;font-size:0.75rem;color:var(--text-muted)">الرصيد بعد السداد</label><strong id="col-bal-after" style="font-size:1.1rem">---</strong></div>
            </div>
            <div class="form-grid">
                <div class="form-group"><label>رقم السند</label><input type="text" id="modal-col-no" placeholder="تلقائي إذا ترك فارغاً"></div>
                <div class="form-group"><label>العميل</label><select id="modal-col-cust" style="width:100%"><option value="">-- اختر العميل --</option></select></div>
                <div class="form-group"><label>المحصل (مندوب التحصيل)</label><select id="modal-col-rep" style="width:100%"><option value="">-- اختر المحصل --</option></select></div>
                <div class="form-group"><label>التاريخ</label><input type="date" id="modal-col-date"></div>
                <div class="form-group"><label>المبلغ</label><input type="number" id="modal-col-amount" min="0" step="0.01"></div>
                <div class="form-group"><label>طريقة الدفع</label><select id="modal-col-method"><option value="cash">نقدي</option><option value="check">شيك</option><option value="transfer">تحويل بنكي</option></select></div>
                <div class="form-group check-only"><label>رقم الشيك</label><input type="text" id="modal-col-checkno"></div>
                <div class="form-group check-only"><label>تاريخ الشيك</label><input type="date" id="modal-col-checkdate"></div>
                <div class="form-group check-only"><label>البنك</label><input type="text" id="modal-col-bank"></div>
                <div class="form-group" style="grid-column:span 2"><label>ملاحظات</label><input type="text" id="modal-col-notes"></div>
            </div>`;
        req('/customers').then(r => {
            const sel = document.getElementById('modal-col-cust');
            if (sel && r.data) {
                (r.data || []).forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c.id;
                    opt.textContent = c.customer_name;
                    sel.appendChild(opt);
                });
            }
        });
        document.getElementById('modal-col-cust').addEventListener('change', async function() {
            const cid = this.value;
            ['col-bal-opening','col-bal-current','col-bal-amount','col-bal-after'].forEach(id => document.getElementById(id).innerHTML = 'جاري...');
            if (!cid) { ['col-bal-opening','col-bal-current','col-bal-amount','col-bal-after'].forEach(id => document.getElementById(id).innerHTML = '---'); return; }
            try {
                const r = await req('/collections/customer/' + cid + '/preview');
                const d = r.data;
                if (d) {
                    const fmt = window.formatMoney || (v => Number(v).toFixed(2));
                    const formatBal = (val) => {
                        if(val > 0) return `<span style="color:#ef4444;font-weight:bold" title="عليه">عليه ${fmt(val)}</span>`;
                        if(val < 0) return `<span style="color:#10b981;font-weight:bold" title="له">له ${fmt(Math.abs(val))}</span>`;
                        return `<span style="color:#64748b">صِفر</span>`;
                    };
                    document.getElementById('col-bal-opening').innerHTML = formatBal(d.opening);
                    
                    const curEl = document.getElementById('col-bal-current');
                    curEl.dataset.raw = d.balance;
                    curEl.innerHTML = formatBal(d.balance);
                    
                    updateColBalancePreview(d.balance);
                }
            } catch(e) { console.error(e); }
        });
        document.getElementById('modal-col-amount').addEventListener('input', function() {
            const curEl = document.getElementById('col-bal-current');
            const cur = parseFloat(curEl.dataset.raw) || 0;
            updateColBalancePreview(cur);
        });
        function updateColBalancePreview(currentBalance) {
            const amt = parseFloat(document.getElementById('modal-col-amount').value) || 0;
            const fmt = window.formatMoney || (v => Number(v).toFixed(2));
            document.getElementById('col-bal-amount').innerHTML = fmt(amt);
            
            const afterBal = currentBalance - amt;
            const formatBal = (val) => {
                if(val > 0) return `<span style="color:#ef4444;font-weight:bold" title="عليه">عليه ${fmt(val)}</span>`;
                if(val < 0) return `<span style="color:#10b981;font-weight:bold" title="له">له ${fmt(Math.abs(val))}</span>`;
                return `<span style="color:#64748b">صِفر</span>`;
            };
            document.getElementById('col-bal-after').innerHTML = formatBal(afterBal);
        }
        req('/reps').then(r => {
            const sel = document.getElementById('modal-col-rep');
            if (sel && r.data) {
                const repsData = r.data.map(rep => ({ id: rep.id, name: rep.rep_name, code: rep.rep_code }));
                sel.innerHTML = '<option value="">-- اختر المحصل --</option>' + repsData.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
                setTimeout(() => {
                    if (window.makeSearchableSelect && !sel.dataset.searchable) {
                        sel.dataset.searchable = '1';
                        window.makeSearchableSelect(sel, repsData, 'بحث عن محصل...');
                    }
                }, 50);
            }
        });
        document.getElementById('modal-col-date').value = new Date().toISOString().slice(0, 10);
        const methodSel = document.getElementById('modal-col-method');
        methodSel.addEventListener('change', () => {
            const isCheck = methodSel.value === 'check';
            document.querySelectorAll('.check-only').forEach(el => el.style.display = isCheck ? '' : 'none');
        });
        const saveBtn = document.getElementById('btn-modal-save');
        if (saveBtn) saveBtn.style.display = ''; // Reset display in case it was hidden
        if (saveBtn) saveBtn.onclick = async () => {
            const payload = {
                collection_no: document.getElementById('modal-col-no').value,
                customer_id: document.getElementById('modal-col-cust').value,
                rep_id: document.getElementById('modal-col-rep').value,
                collection_date: document.getElementById('modal-col-date').value,
                amount: document.getElementById('modal-col-amount').value,
                payment_method: methodSel.value,
                check_no: document.getElementById('modal-col-checkno').value,
                check_date: document.getElementById('modal-col-checkdate').value,
                bank_name: document.getElementById('modal-col-bank').value,
                notes: document.getElementById('modal-col-notes').value
            };
            if (!payload.customer_id || !payload.amount) { alert('اختر العميل وأدخل المبلغ'); return; }
            const orig = saveBtn.innerHTML;
            saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';
            saveBtn.disabled = true;
            const r = await req('/collections', 'POST', payload);
            saveBtn.innerHTML = orig;
            saveBtn.disabled = false;
            if (r.success) {
                modal.classList.remove('active');
                if (window.TradeProViews) window.TradeProViews.reload('view-collections');
                alert('تم تسجيل التحصيل بنجاح');
            } else {
                if (r.code === 'DUPLICATE_COLLECTION_NO') {
                    alert('تنبيه: ' + r.message);
                    document.getElementById('modal-col-no').value = '';
                    document.getElementById('modal-col-no').focus();
                } else {
                    alert('خطأ: ' + (r.message || ''));
                }
            }
        };
        modal.classList.add('active');
    }

    viewHandlers['view-aging'] = async function () {
        const set = (id, val) => { const e = document.getElementById(id); if (e) e.innerHTML = val; };
        const fmtNum = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

        // Tab switching
        const tabs = document.querySelectorAll('#view-aging .tab-btn');
        tabs.forEach(tab => {
            if (tab.dataset.bound) return;
            tab.dataset.bound = '1';
            tab.addEventListener('click', () => {
                tabs.forEach(t => { t.style.color = '#64748b'; t.style.borderBottomColor = 'transparent'; });
                tab.style.color = '#7c3aed'; tab.style.borderBottomColor = '#7c3aed';
                const show = tab.dataset.tab === 'ar' ? 'aging-ar-tab' : 'aging-ap-tab';
                document.getElementById('aging-ar-tab').style.display = show === 'aging-ar-tab' ? '' : 'none';
                document.getElementById('aging-ap-tab').style.display = show === 'aging-ap-tab' ? '' : 'none';
            });
        });

        try {
            const [arRes, apRes] = await Promise.all([
                req('/analytics/v1/aging/ar'),
                req('/analytics/v1/aging/ap')
            ]);

            // ── AR ──
            if (arRes.success) {
                const ar = arRes.data;
                const s = ar.summary;
                set('aging-ar-total', fmt(s.total_balance) + ' ج.م');
                set('aging-ar-overdue-pct', s.overdue_pct + '%');
                set('aging-ar-count', fmtInt(s.customer_count));
                set('aging-ar-efficiency', ar.collection_efficiency.efficiency_pct + '%');
                set('aging-ar-collected', fmt(ar.collection_efficiency.collections_total));
                set('aging-ar-outstanding', fmt(ar.collection_efficiency.invoices_total));

                // Top delinquent
                const tdEl = document.getElementById('aging-ar-top-delinquent');
                if (tdEl && ar.top_delinquent) {
                    if (ar.top_delinquent.length === 0) {
                        tdEl.innerHTML = '<li style="color:#10b981;padding:15px 0"><i class="fa-solid fa-circle-check"></i> لا توجد مديونيات متأخرة</li>';
                    } else {
                        tdEl.innerHTML = ar.top_delinquent.map((c, i) => {
                            const badges = ['#fbbf24', '#94a3b8', '#f87171'];
                            return '<li style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f1f5f9">'
                                + '<div style="display:flex;align-items:center;gap:10px">'
                                + '<span style="font-size:1.1rem;color:' + (badges[i] || '#cbd5e1') + '"><i class="fa-solid fa-medal"></i></span>'
                                + '<span style="font-weight:600;color:#1e293b;font-size:0.85rem">' + esc(c.customer_name) + '</span></div>'
                                + '<strong style="color:#ef4444;font-size:0.85rem">' + fmt(c.overdue_balance) + ' ج.م</strong></li>';
                        }).join('');
                    }
                }

                // Bucket chart
                const bucketLabels = ['الحالي', '1-30', '31-60', '61-90', '90+'];
                const bucketData = [fmtNum(s.age_current), fmtNum(s.age_1_30), fmtNum(s.age_31_60), fmtNum(s.age_61_90), fmtNum(s.age_90_plus)];
                const bucketCtx = document.getElementById('aging-ar-bucket-chart');
                if (bucketCtx && typeof Chart !== 'undefined') {
                    if (agingArBucketChart) agingArBucketChart.destroy();
                    agingArBucketChart = new Chart(bucketCtx, {
                        type: 'bar',
                        data: {
                            labels: bucketLabels,
                            datasets: [{
                                label: 'المبلغ',
                                data: bucketData,
                                backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#f97316', '#ef4444'],
                                borderRadius: 4
                            }]
                        },
                        options: {
                            responsive: true, maintainAspectRatio: false,
                            plugins: { legend: { display: false } },
                            scales: {
                                y: { beginAtZero: true, grid: { borderDash: [5, 5] }, ticks: { font: { family: 'Cairo' } } },
                                x: { grid: { display: false }, ticks: { font: { family: 'Cairo' } } }
                            }
                        }
                    });
                }

                // Trend chart
                const trendCtx = document.getElementById('aging-ar-trend-chart');
                if (trendCtx && typeof Chart !== 'undefined' && ar.monthly_trend && ar.monthly_trend.length > 0) {
                    if (agingArTrendChart) agingArTrendChart.destroy();
                    agingArTrendChart = new Chart(trendCtx, {
                        type: 'line',
                        data: {
                            labels: ar.monthly_trend.map(r => r.month),
                            datasets: [{
                                label: 'الرصيد',
                                data: ar.monthly_trend.map(r => parseFloat(r.balance)),
                                borderColor: '#3b82f6',
                                backgroundColor: 'rgba(59,130,246,0.1)',
                                fill: true, tension: 0.4, borderWidth: 2,
                                pointBackgroundColor: '#fff',
                                pointBorderColor: '#3b82f6',
                                pointBorderWidth: 2
                            }]
                        },
                        options: {
                            responsive: true, maintainAspectRatio: false,
                            plugins: { legend: { display: false } },
                            scales: {
                                y: { beginAtZero: true, grid: { borderDash: [5, 5] }, ticks: { font: { family: 'Cairo' } } },
                                x: { grid: { display: false }, ticks: { font: { family: 'Cairo' }, maxTicksLimit: 8 } }
                            }
                        }
                    });
                }

                // Detail table
                const tbody = document.getElementById('aging-ar-tbody');
                if (tbody && ar.detail) {
                    tbody.innerHTML = ar.detail.map(c => {
                        const total = fmtNum(c.total_balance);
                        return '<tr>'
                            + '<td><strong>' + esc(c.customer_name) + '</strong></td>'
                            + '<td>' + (c.region || '-') + '</td>'
                            + '<td>' + fmt(c.age_current) + '</td>'
                            + '<td>' + fmt(c.age_1_30) + '</td>'
                            + '<td>' + fmt(c.age_31_60) + '</td>'
                            + '<td>' + fmt(c.age_61_90) + '</td>'
                            + '<td class="text-danger">' + fmt(c.age_90_plus) + '</td>'
                            + '<td><strong class="text-danger">' + fmt(total) + '</strong></td>'
                            + '</tr>';
                    }).join('') || '<tr><td colspan="8" class="text-center">لا توجد بيانات</td></tr>';
                }

                // Search filter
                const searchInput = document.getElementById('aging-ar-filter-search');
                if (searchInput && !searchInput.dataset.bound) {
                    searchInput.dataset.bound = '1';
                    searchInput.addEventListener('input', () => {
                        const q = searchInput.value.toLowerCase();
                        if (!tbody) return;
                        tbody.querySelectorAll('tr').forEach(tr => {
                            tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
                        });
                    });
                }

                // Overdue filter toggle
                const overdueBtn = document.getElementById('aging-ar-filter-overdue');
                if (overdueBtn && !overdueBtn.dataset.bound) {
                    overdueBtn.dataset.bound = '1';
                    let filterActive = false;
                    const allRows = ar.detail;
                    overdueBtn.addEventListener('click', () => {
                        filterActive = !filterActive;
                        overdueBtn.style.borderColor = filterActive ? '#7c3aed' : '#e2e8f0';
                        overdueBtn.style.color = filterActive ? '#7c3aed' : '#64748b';
                        if (!tbody) return;
                        const rows = tbody.querySelectorAll('tr');
                        if (filterActive && allRows) {
                            const overdueIds = ar.detail.filter(c => {
                                const overdue = fmtNum(c.age_31_60) + fmtNum(c.age_61_90) + fmtNum(c.age_90_plus);
                                return parseFloat(overdue) > 0;
                            }).map(c => esc(c.customer_name));
                            rows.forEach(tr => {
                                const name = tr.querySelector('td:first-child')?.textContent?.trim() || '';
                                tr.style.display = overdueIds.includes(name) ? '' : 'none';
                            });
                        } else {
                            rows.forEach(tr => { tr.style.display = ''; });
                        }
                    });
                }
            }

            // ── AP ──
            if (apRes.success) {
                const ap = apRes.data;
                const s = ap.summary;
                set('aging-ap-total', fmt(s.total_balance) + ' ج.م');
                set('aging-ap-overdue-pct', s.overdue_pct + '%');
                set('aging-ap-count', fmtInt(s.supplier_count));

                const apCtx = document.getElementById('aging-ap-bucket-chart');
                if (apCtx && typeof Chart !== 'undefined') {
                    if (agingApBucketChart) agingApBucketChart.destroy();
                    agingApBucketChart = new Chart(apCtx, {
                        type: 'bar',
                        data: {
                            labels: ['الحالي', '1-30', '31-60', '61-90', '90+'],
                            datasets: [{
                                label: 'المبلغ',
                                data: [fmtNum(s.age_current), fmtNum(s.age_1_30), fmtNum(s.age_31_60), fmtNum(s.age_61_90), fmtNum(s.age_90_plus)],
                                backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#f97316', '#ef4444'],
                                borderRadius: 4
                            }]
                        },
                        options: {
                            responsive: true, maintainAspectRatio: false,
                            plugins: { legend: { display: false } },
                            scales: {
                                y: { beginAtZero: true, grid: { borderDash: [5, 5] }, ticks: { font: { family: 'Cairo' } } },
                                x: { grid: { display: false }, ticks: { font: { family: 'Cairo' } } }
                            }
                        }
                    });
                }

                const apTbody = document.getElementById('aging-ap-tbody');
                if (apTbody && ap.detail) {
                    apTbody.innerHTML = ap.detail.map(sup => {
                        const total = fmtNum(sup.total_balance);
                        return '<tr>'
                            + '<td><strong>' + esc(sup.supplier_name) + '</strong></td>'
                            + '<td>' + (sup.phone || '-') + '</td>'
                            + '<td>' + fmt(sup.age_current) + '</td>'
                            + '<td>' + fmt(sup.age_1_30) + '</td>'
                            + '<td>' + fmt(sup.age_31_60) + '</td>'
                            + '<td>' + fmt(sup.age_61_90) + '</td>'
                            + '<td class="text-danger">' + fmt(sup.age_90_plus) + '</td>'
                            + '<td><strong class="text-danger">' + fmt(total) + '</strong></td>'
                            + '</tr>';
                    }).join('') || '<tr><td colspan="8" class="text-center">لا توجد بيانات</td></tr>';
                }
            }
        } catch (e) {
            console.error('Aging Dashboard Error:', e);
        }
    };

    window.loadAging = function () {
        const handler = viewHandlers['view-aging'];
        if (handler) handler();
    };

    viewHandlers['view-profitability'] = async function () {
        const set = (id, val) => { const e = document.getElementById(id); if (e) e.innerHTML = val; };
        const fmtP = (v) => parseFloat(v || 0).toLocaleString('ar-EG');
        const escHtml = (s) => { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; };

        // Tab switching
        const tabs = document.querySelectorAll('#view-profitability .prof-tab');
        tabs.forEach(tab => {
            if (tab.dataset.bound) return;
            tab.dataset.bound = '1';
            tab.addEventListener('click', () => {
                tabs.forEach(t => { t.style.color = '#64748b'; t.style.borderBottomColor = 'transparent'; });
                tab.style.color = '#10b981'; tab.style.borderBottomColor = '#10b981';
                document.getElementById('prof-level-title').textContent = tab.textContent.trim();
                renderLevelTable(tab.dataset.level);
            });
        });

        let data = null;

        function renderLevelTable(level) {
            if (!data) return;
            const levels = data.data.levels;
            let rows = [];
            let title = '';
            if (level === 'branch') { rows = levels.branch; title = 'الفرع'; }
            else if (level === 'rep') { rows = levels.sales_rep; title = 'المندوب'; }
            else if (level === 'product') { rows = levels.product; title = 'المنتج'; }
            else { rows = levels.category; title = 'الفئة'; }

            const container = document.getElementById('prof-level-content');
            if (!rows || rows.length === 0) {
                container.innerHTML = '<div style="text-align:center;padding:30px;color:#64748b">لا توجد بيانات</div>';
                return;
            }

            if (level === 'product') {
                container.innerHTML = '<table class="data-table" style="font-size:0.85rem"><thead><tr><th>' + title + '</th><th>الفئة</th><th>الإيراد</th><th>التكلفة</th><th>الربح</th><th>الهامش</th><th>الكمية</th></tr></thead><tbody>'
                    + rows.map(r => '<tr><td>' + escHtml(r.product_name) + '</td><td>' + escHtml(r.category) + '</td><td>' + fmtP(r.revenue) + '</td><td>' + fmtP(r.cogs) + '</td><td style="color:#10b981;font-weight:600">' + fmtP(r.profit) + '</td><td>' + r.margin + '%</td><td>' + fmtP(r.qty_sold) + '</td></tr>').join('')
                    + '</tbody></table>';
            } else if (level === 'category') {
                container.innerHTML = '<table class="data-table" style="font-size:0.85rem"><thead><tr><th>' + title + '</th><th>الإيراد</th><th>التكلفة</th><th>الربح</th><th>الهامش</th></tr></thead><tbody>'
                    + rows.map(r => '<tr><td>' + escHtml(r.category) + '</td><td>' + fmtP(r.revenue) + '</td><td>' + fmtP(r.cogs) + '</td><td style="color:#10b981;font-weight:600">' + fmtP(r.profit) + '</td><td>' + r.margin + '%</td></tr>').join('')
                    + '</tbody></table>';
            } else {
                container.innerHTML = '<table class="data-table" style="font-size:0.85rem"><thead><tr><th>' + title + '</th><th>المنطقة</th><th>الفواتير</th><th>الإيراد</th><th>التكلفة</th><th>الربح</th><th>الهامش</th></tr></thead><tbody>'
                    + rows.map(r => '<tr><td>' + escHtml(r.store_name || r.rep_name || '-') + '</td><td>' + escHtml(r.region || '-') + '</td><td>' + (r.invoice_count || 0) + '</td><td>' + fmtP(r.revenue) + '</td><td>' + fmtP(r.cogs) + '</td><td style="color:#10b981;font-weight:600">' + fmtP(r.profit) + '</td><td>' + r.margin + '%</td></tr>').join('')
                    + '</tbody></table>';
            }
        }

        try {
            const res = await req('/analytics/v1/profitability/dashboard');
            if (!res.success) return;
            data = res;
            const d = res.data;
            const c = d.company;

            set('prof-revenue', fmtP(c.revenue) + ' ج.م');
            set('prof-cogs', fmtP(c.cogs) + ' ج.م');
            set('prof-gross-profit', fmtP(c.gross_profit) + ' ج.م');
            set('prof-margin', c.gross_margin + '%');

            // Trend chart
            const trendCtx = document.getElementById('prof-trend-chart');
            if (trendCtx && typeof Chart !== 'undefined' && d.charts.profit_trend && d.charts.profit_trend.length > 0) {
                if (profTrendChart) profTrendChart.destroy();
                const t = d.charts.profit_trend;
                profTrendChart = new Chart(trendCtx, {
                    type: 'line',
                    data: {
                        labels: t.map(r => r.month),
                        datasets: [
                            { label: 'الإيراد', data: t.map(r => r.revenue), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)', fill: true, tension: 0.4, borderWidth: 2 },
                            { label: 'الربح', data: t.map(r => r.profit), borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.1)', fill: true, tension: 0.4, borderWidth: 2 }
                        ]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        plugins: { legend: { position: 'top', labels: { font: { family: 'Cairo' } } } },
                        scales: {
                            y: { beginAtZero: true, grid: { borderDash: [5, 5] }, ticks: { font: { family: 'Cairo' } } },
                            x: { grid: { display: false }, ticks: { font: { family: 'Cairo' }, maxTicksLimit: 8 } }
                        }
                    }
                });
            }

            // Margin by branch chart
            const marginCtx = document.getElementById('prof-margin-chart');
            if (marginCtx && typeof Chart !== 'undefined' && d.charts.margin_by_branch && d.charts.margin_by_branch.length > 0) {
                if (profMarginChart) profMarginChart.destroy();
                const mb = d.charts.margin_by_branch;
                profMarginChart = new Chart(marginCtx, {
                    type: 'bar',
                    data: {
                        labels: mb.map(b => b.name),
                        datasets: [
                            { label: 'الربح', data: mb.map(b => b.profit), backgroundColor: '#10b981', borderRadius: 4 },
                            { label: 'الهامش %', data: mb.map(b => b.margin), backgroundColor: '#7c3aed', borderRadius: 4 }
                        ]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        plugins: { legend: { position: 'top', labels: { font: { family: 'Cairo' } } } },
                        scales: {
                            y: { beginAtZero: true, grid: { borderDash: [5, 5] }, ticks: { font: { family: 'Cairo' } } },
                            x: { grid: { display: false }, ticks: { font: { family: 'Cairo' } } }
                        }
                    }
                });
            }

            // Category chart (doughnut)
            const catCtx = document.getElementById('prof-category-chart');
            if (catCtx && typeof Chart !== 'undefined' && d.charts.profit_by_category && d.charts.profit_by_category.length > 0) {
                if (profCategoryChart) profCategoryChart.destroy();
                const pc = d.charts.profit_by_category;
                profCategoryChart = new Chart(catCtx, {
                    type: 'doughnut',
                    data: {
                        labels: pc.map(c => c.category + ' (' + c.margin + '%)'),
                        datasets: [{ data: pc.map(c => c.profit), backgroundColor: ['#7c3aed', '#10b981', '#f59e0b', '#3b82f6', '#ef4444', '#8b5cf6'], borderWidth: 0 }]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        plugins: { legend: { position: 'bottom', labels: { font: { family: 'Cairo' } } } }
                    }
                });
            }

            // Top customers list
            const tcEl = document.getElementById('prof-top-customers');
            if (tcEl && d.top10 && d.top10.customers) {
                tcEl.innerHTML = d.top10.customers.map((c, i) => {
                    const badges = ['#fbbf24', '#94a3b8', '#f87171'];
                    return '<li style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f1f5f9">'
                        + '<div style="display:flex;align-items:center;gap:10px">'
                        + '<span style="font-size:1.1rem;color:' + (badges[i] || '#cbd5e1') + '"><i class="fa-solid fa-medal"></i></span>'
                        + '<div><span style="font-weight:600;color:#1e293b;font-size:0.85rem">' + escHtml(c.customer_name) + '</span>'
                        + '<br><span style="font-size:0.75rem;color:#64748b">' + escHtml(c.region || '-') + ' · ' + c.margin + '%</span></div></div>'
                        + '<strong style="color:#10b981;font-size:0.85rem">' + fmtP(c.profit) + ' ج.م</strong></li>';
                }).join('');
            }

            // Top products table
            const tpEl = document.getElementById('prof-top-products');
            if (tpEl && d.top10 && d.top10.products) {
                tpEl.innerHTML = d.top10.products.map(p =>
                    '<tr><td><strong>' + escHtml(p.product_name) + '</strong></td><td>' + fmtP(p.revenue) + '</td><td style="color:#10b981;font-weight:600">' + fmtP(p.profit) + '</td><td>' + p.margin + '%</td></tr>'
                ).join('') || '<tr><td colspan="4" class="text-center">لا توجد بيانات</td></tr>';
            }

            // Top reps table
            const trEl = document.getElementById('prof-top-reps');
            if (trEl && d.top10 && d.top10.sales_reps) {
                trEl.innerHTML = d.top10.sales_reps.map(r =>
                    '<tr><td><strong>' + escHtml(r.rep_name) + '</strong></td><td>' + escHtml(r.region || '-') + '</td><td>' + fmtP(r.revenue) + '</td><td style="color:#10b981;font-weight:600">' + fmtP(r.profit) + '</td></tr>'
                ).join('') || '<tr><td colspan="4" class="text-center">لا توجد بيانات</td></tr>';
            }

            // Initial tab render
            renderLevelTable('branch');

        } catch (e) {
            console.error('Profitability Analytics Error:', e);
        }
    };

    window.loadProfitability = function () {
        const handler = viewHandlers['view-profitability'];
        if (handler) handler();
    };

})();
