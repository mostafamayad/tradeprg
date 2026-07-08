// ============================================================
// TradePro ERP - Views Wiring Layer
// ============================================================
// يربط شاشات الواجهة الأمامية بالـ APIs الحقيقية
// ============================================================

(function () {
    'use strict';

    const BASE = '/api';
    const fmt = (n) => {
        const v = Number(n || 0);
        const cls = v > 0 ? 'amount-positive' : v < 0 ? 'amount-negative' : '';
        const formatted = v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return cls ? '<span class="' + cls + '">' + formatted + '</span>' : formatted;
    };
    const fmtPlain = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtInt = (n) => Number(n || 0).toLocaleString('en-US');
    const esc = (v) => String(v || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

    async function req(endpoint, method = 'GET', body = null) {
        try {
            const token = localStorage.getItem('auth_token');
            const opt = { method, headers: { 'Content-Type': 'application/json' } };
            if (token) opt.headers['Authorization'] = 'Bearer ' + token;
            if (body) opt.body = JSON.stringify(body);
            const res = await fetch(`${BASE}${endpoint}`, opt);
            const data = await res.json();
            if (!data.success) throw new Error(data.message || 'خطأ في العملية');
            return data;
        } catch (e) {
            console.error(`API [${method} ${endpoint}]`, e);
            return { success: false, message: e.message, data: [] };
        }
    }

    // ============================================================
    // NAVIGATION HOOK - تحميل بيانات الـ view عند فتحها
    // ============================================================
    const viewHandlers = {};

    // ============================================================
    // يتم إعادة تحميل الـ handler عبر classList.remove('active-view') +
    // classList.add('active-view') في app.js — لا حاجة لإعادة تعيين dataset.bound هنا
    // ============================================================

    document.addEventListener('DOMContentLoaded', () => {
        // رصد تغيير class/style على كل view — هذا هو المصدر الوحيد لتحميل البيانات
        const observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                if (m.type === 'attributes' && (m.attributeName === 'class' || m.attributeName === 'style')) {
                    const view = m.target;
                    if (view.classList.contains('view') && view.classList.contains('active-view')) {
                        const handler = viewHandlers[view.id];
                        if (handler && !view.dataset.bound) {
                            view.dataset.bound = '1';
                            try { handler(); } catch (e) { console.error(e); }
                        }
                    }
                }
            }
        });
        document.querySelectorAll('.view').forEach(v => observer.observe(v, { attributes: true, attributeFilter: ['style', 'class'] }));

        // فحص احتياطي كل ثانيتين — فقط في حال فشل الـ observer
        setInterval(() => {
            const active = document.querySelector('.view.active-view');
            if (!active || active.dataset.bound) return;
            const handler = viewHandlers[active.id];
            if (handler) {
                active.dataset.bound = '1';
                try { handler(); } catch (e) { console.error(e); }
            }
        }, 2000);
    });

    // ============================================================
    // VIEW: DASHBOARD
    // ============================================================
    viewHandlers['view-dashboard'] = async function () {
        const r = await req('/dashboard/stats');
        if (!r.success) return;
        const d = r.data;
        const set = (id, val) => { const e = document.getElementById(id); if (e) e.innerHTML = val; };
        set('dash-sales-today', fmt(d.sales_today || 0) + ' ج.م');
        set('dash-purchases-today', fmt(d.purchases_today || 0) + ' ج.م');
        set('dash-total-customers', fmtInt(d.total_customers));
        set('dash-treasury', fmt(d.treasury_balance || 0) + ' ج.م');
        
        // Load the recent invoices and alerts using the function in app.js
        if (typeof window.loadDashboard === 'function') {
            window.loadDashboard();
        }
    };

    // ============================================================
    // VIEW: EXECUTIVE DASHBOARD (BI)
    // ============================================================
    let execChartInstance = null;

    viewHandlers['view-executive-dashboard'] = async function () {
        const set = (id, val) => { const e = document.getElementById(id); if (e) e.innerHTML = val; };
        try {
            const res = await req('/analytics/v1/executive-dashboard');
            if (!res.success) return;
            const d = res.data;

            // Row 1
            set('exec-sales-today', fmt(d.kpis.salesToday) + ' ج.م');
            set('exec-sales-month-label', fmt(d.kpis.salesMonth ?? d.kpis.salesMonth) + ' ج.م');
            set('exec-cash', fmt(d.kpis.cash) + ' ج.م');
            set('exec-banks-label', fmt(d.kpis.banks) + ' ج.م');
            set('exec-receivables', fmt(d.kpis.receivables) + ' ج.م');
            set('exec-payables-label', fmt(d.kpis.payables) + ' ج.م');

            // Row 2
            const gp = typeof d.kpis.grossProfit === 'number' ? d.kpis.grossProfit.toFixed(1) : '0.0';
            set('exec-net-profit', fmt(d.kpis.netProfit) + ' ج.م');
            set('exec-gross-profit-label', gp + '%');
            set('exec-inventory-value', fmt(d.kpis.inventoryValue) + ' ج.م');
            set('exec-vat-label', fmt(d.kpis.vat) + ' ج.م');
            set('exec-expenses', fmt(d.kpis.expenses) + ' ج.م');
            set('exec-customers-label', fmtInt(d.kpis.customers));

            // Top Customers
            const tcEl = document.getElementById('exec-top-customers');
            if (tcEl && d.topCustomers) {
                tcEl.innerHTML = d.topCustomers.map((c, i) => {
                    const badges = ['#fbbf24', '#94a3b8', '#f87171', '#cbd5e1', '#cbd5e1'];
                    return '<li style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f1f5f9">'
                        + '<div style="display:flex;align-items:center;gap:10px">'
                        + '<span style="font-size:1.1rem;color:' + (badges[i] || '#cbd5e1') + '"><i class="fa-solid fa-medal"></i></span>'
                        + '<span style="font-weight:600;color:#1e293b;font-size:0.9rem">' + esc(c.name) + '</span></div>'
                        + '<strong style="color:#64748b;font-size:0.85rem">' + fmt(c.total) + ' ج.م</strong></li>';
                }).join('');
            }

            // Top Products
            const tpEl = document.getElementById('exec-top-products');
            if (tpEl && d.topProducts) {
                tpEl.innerHTML = d.topProducts.map(p => {
                    return '<li style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f1f5f9">'
                        + '<div style="display:flex;align-items:center;gap:10px">'
                        + '<span style="color:#3b82f6;background:#eff6ff;padding:5px;border-radius:6px"><i class="fa-solid fa-box"></i></span>'
                        + '<span style="font-weight:600;color:#1e293b;font-size:0.9rem">' + esc(p.name) + '</span></div>'
                        + '<span style="color:#64748b;font-size:0.85rem;font-weight:600">' + fmtInt(p.qty) + ' وحدة</span></li>';
                }).join('');
            }

            // Aging Table
            const agingTbody = document.getElementById('exec-aging-table');
            if (agingTbody && d.charts.arAging) {
                agingTbody.innerHTML = '';
                const buckets = [
                    { label: '0-30 يوم', ar: d.charts.arAging[0], ap: d.charts.apAging[0] },
                    { label: '31-60 يوم', ar: d.charts.arAging[1], ap: d.charts.apAging[1] },
                    { label: '61-90 يوم', ar: d.charts.arAging[2], ap: d.charts.apAging[2] },
                    { label: '91-120 يوم', ar: d.charts.arAging[3], ap: d.charts.apAging[3] },
                    { label: '120+ يوم', ar: d.charts.arAging[4], ap: d.charts.apAging[4] }
                ];
                buckets.forEach(b => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = '<td style="font-weight:600">' + b.label + '</td>'
                        + '<td style="color:#7c3aed;font-weight:700">' + fmt(b.ar.total) + ' ج.م</td>'
                        + '<td style="color:#f59e0b;font-weight:700">' + fmt(b.ap.total) + ' ج.م</td>';
                    agingTbody.appendChild(tr);
                });
            }

            // Alerts — Low Stock
            const lsEl = document.getElementById('exec-low-stock');
            if (lsEl && d.alerts.lowStock) {
                if (d.alerts.lowStock.length === 0) {
                    lsEl.innerHTML = '<li style="color:#10b981;padding:10px 0"><i class="fa-solid fa-circle-check"></i> لا توجد أصناف منخفضة</li>';
                } else {
                    lsEl.innerHTML = d.alerts.lowStock.map(p =>
                        '<li style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9">'
                        + '<span style="font-weight:600;font-size:0.85rem">' + esc(p.name) + '</span>'
                        + '<span style="color:#ef4444;font-weight:700;font-size:0.85rem">' + fmtInt(p.quantity) + ' / ' + fmtInt(p.minStock) + '</span></li>'
                    ).join('');
                }
            }

            // Alerts — Overdue Customers
            const odEl = document.getElementById('exec-overdue');
            if (odEl && d.alerts.overdueCustomers) {
                if (d.alerts.overdueCustomers.length === 0) {
                    odEl.innerHTML = '<li style="color:#10b981;padding:10px 0"><i class="fa-solid fa-circle-check"></i> لا توجد مديونيات متأخرة</li>';
                } else {
                    odEl.innerHTML = d.alerts.overdueCustomers.map(c =>
                        '<li style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9">'
                        + '<span style="font-weight:600;font-size:0.85rem">' + esc(c.name) + '</span>'
                        + '<span style="color:#ef4444;font-weight:700;font-size:0.85rem">' + fmt(c.amount) + ' ج.م</span></li>'
                    ).join('');
                }
            }

            // Sales Chart
            if (d.charts.salesTrend && d.charts.salesTrend.length > 0 && typeof Chart !== 'undefined') {
                const ctx = document.getElementById('exec-sales-chart');
                if (ctx) {
                    if (execChartInstance) execChartInstance.destroy();
                    const labels = d.charts.salesTrend.map(r => {
                        const dt = new Date(r.date);
                        return dt.getDate() + ' ' + dt.toLocaleString('ar-EG', { month: 'short' });
                    });
                    const data = d.charts.salesTrend.map(r => parseFloat(r.total));
                    execChartInstance = new Chart(ctx, {
                        type: 'line',
                        data: {
                            labels: labels,
                            datasets: [{
                                label: 'المبيعات',
                                data: data,
                                borderColor: '#8b5cf6',
                                backgroundColor: 'rgba(139, 92, 246, 0.1)',
                                borderWidth: 3,
                                fill: true,
                                tension: 0.4,
                                pointBackgroundColor: '#fff',
                                pointBorderColor: '#8b5cf6',
                                pointBorderWidth: 2,
                                pointRadius: 4,
                                pointHoverRadius: 6
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: { legend: { display: false } },
                            scales: {
                                y: { beginAtZero: true, grid: { borderDash: [5, 5] }, ticks: { font: { family: 'Cairo' } } },
                                x: { grid: { display: false }, ticks: { font: { family: 'Cairo' } } }
                            }
                        }
                    });
                }
            }
        } catch (e) {
            console.error('Executive Dashboard Error:', e);
        }
    };

    window.loadExecutiveDashboard = function () {
        const handler = viewHandlers['view-executive-dashboard'];
        if (handler) handler();
    };

    // ============================================================
    // VIEW: CASH FLOW (BI-2)
    // ============================================================
    let cfDailyChartInstance = null;
    let cfMonthlyChartInstance = null;

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

    // ============================================================
    // VIEW: COLLECTIONS
    // ============================================================
    viewHandlers['view-collections'] = async function () {
        const tbody = document.getElementById('collections-tbody');
        if (!tbody) return;
        const now = new Date();
        const fromInput = document.getElementById('collections-from');
        const toInput = document.getElementById('collections-to');
        if (fromInput && !fromInput.value) fromInput.value = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
        if (toInput && !toInput.value) toInput.value = now.toISOString().slice(0, 10);

        async function loadCollections() {
            const params = new URLSearchParams();
            const from = document.getElementById('collections-from')?.value;
            const to = document.getElementById('collections-to')?.value;
            const method = document.getElementById('collections-method')?.value;
            const q = document.getElementById('collections-search')?.value;
            if (q) params.append('q', q);
            if (from) params.append('from', from);
            if (to) params.append('to', to);
            if (method) params.append('payment_method', method);
            const r = await req('/collections' + (params.toString() ? '?' + params : ''));
            if (!r.success) return;
            const rows = r.data || [];
            tbody.innerHTML = '';
            if (rows.length === 0) {
                tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--text-muted)">لا توجد تحصيلات في الفترة</td></tr>';
            } else {
                rows.forEach(c => {
                    const methodBadge = c.payment_method === 'cash' ? '<span class="badge-status paid">نقدي</span>'
                        : c.payment_method === 'check' ? '<span class="badge-status pending">شيك</span>'
                        : '<span class="badge-status" style="background:var(--info-color)">تحويل</span>';
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td><strong>${c.collection_no || '-'}</strong></td>
                        <td>${c.collection_date || '-'}</td>
                        <td>${c.customer_name || '-'}</td>
                        <td>${c.rep_name || '-'}</td>
                        <td class="text-success"><strong>${fmt(c.amount)} ج.م</strong></td>
                        <td>${methodBadge}</td>
                        <td>${c.check_no || '-'}</td>
                        <td>${c.bank_name || '-'}</td>
                        <td>${c.notes || '-'}</td>`;
                    tbody.appendChild(tr);
                });
            }
            const monthTotal = rows.filter(c => {
                const d = new Date(c.collection_date);
                return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
            }).reduce((s, c) => s + Number(c.amount || 0), 0);
            const set = (id, val) => { const e = document.getElementById(id); if (e) e.innerHTML = val; };
            set('collections-month-total', fmt(monthTotal) + ' ج.م');
            set('collections-count', fmtInt(rows.length));
        }

        await loadCollections();
        ['collections-from', 'collections-to', 'collections-method', 'collections-search'].forEach(id => {
            const el = document.getElementById(id);
            if (el && !el.dataset.bound) {
                el.dataset.bound = '1';
                el.addEventListener('input', loadCollections);
            }
        });
        const btnNew = document.getElementById('btn-new-collection');
        if (btnNew && !btnNew.dataset.bound) {
            btnNew.dataset.bound = '1';
            btnNew.addEventListener('click', () => openCollectionModal());
        }
    };

    function openCollectionModal() {
        const modal = document.getElementById('global-modal');
        if (!modal) return;
        document.getElementById('modal-title').textContent = 'سند قبض جديد';
        document.getElementById('modal-body').innerHTML = `
            <div class="form-grid">
                <div class="form-group"><label>رقم السند</label><input type="text" id="modal-col-no" placeholder="تلقائي إذا ترك فارغاً"></div>
                <div class="form-group"><label>العميل</label><select id="modal-col-cust" style="width:100%"><option value="">-- اختر العميل --</option></select></div>
                <div class="form-group"><label>المندوب (المُحصِّل)</label><select id="modal-col-rep" style="width:100%"><option value="">-- اختر المندوب --</option></select></div>
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
        req('/reps').then(r => {
            const sel = document.getElementById('modal-col-rep');
            if (sel && r.data) {
                (r.data || []).forEach(rep => {
                    const opt = document.createElement('option');
                    opt.value = rep.id;
                    opt.textContent = rep.rep_name;
                    sel.appendChild(opt);
                });
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

    // ============================================================
    // VIEW: AGING DASHBOARD (BI-3)
    // ============================================================
    let agingArBucketChart = null, agingArTrendChart = null, agingApBucketChart = null;

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

    // ============================================================
    // VIEW: INVENTORY ANALYTICS (BI-4)
    // ============================================================
    let invTrendChart = null, invAbcChart = null, invMovementChart = null, invWarehouseChart = null;

    viewHandlers['view-inventory-analytics'] = async function () {
        const set = (id, val) => { const e = document.getElementById(id); if (e) e.innerHTML = val; };
        const setNum = (id, val, suffix) => { set(id, (parseFloat(val) || 0).toLocaleString('ar-EG') + (suffix || '')); };
        const fmtLocal = (v) => { const n = parseFloat(v); return isNaN(n) ? '0' : n.toLocaleString('ar-EG'); };

        // Report tab switching
        const reportBtns = document.querySelectorAll('#view-inventory-analytics [data-report]');
        reportBtns.forEach(btn => {
            if (btn.dataset.bound) return;
            btn.dataset.bound = '1';
            btn.addEventListener('click', () => {
                reportBtns.forEach(b => { b.style.background = '#e2e8f0'; b.style.color = '#64748b'; });
                btn.style.background = '#7c3aed'; btn.style.color = '#fff';
                document.getElementById('inv-alert-section').dataset.activeReport = btn.dataset.report;
                renderActiveReport();
            });
        });

        function renderActiveReport() {
            const section = document.getElementById('inv-alert-section');
            const report = section ? section.dataset.activeReport || 'negative' : 'negative';
            const data = window.__invData;
            if (!data) return;
            const alerts = data.alerts || {};
            const summaries = data.summaries || {};
            const kpis = data.kpis || {};
            let html = '';
            if (report === 'negative') {
                const items = alerts.negative_stock || [];
                html = items.length === 0
                    ? '<div style="text-align:center;padding:30px;color:#10b981"><i class="fa-solid fa-circle-check"></i> لا توجد أرصدة سالبة</div>'
                    : '<table class="data-table"><thead><tr><th>الصنف</th><th>المخزن</th><th>الكمية</th><th>القيمة</th></tr></thead><tbody>'
                    + items.map(r => '<tr><td>' + esc(r.product_name) + '</td><td>' + esc(r.store_name || '-') + '</td><td class="text-danger">' + fmtLocal(r.quantity) + '</td><td class="text-danger">' + fmtLocal(r.value) + '</td></tr>').join('')
                    + '</tbody></table>';
            } else if (report === 'low') {
                const items = alerts.low_stock || [];
                html = items.length === 0
                    ? '<div style="text-align:center;padding:30px;color:#10b981"><i class="fa-solid fa-circle-check"></i> لا توجد أصناف منخفضة</div>'
                    : '<table class="data-table"><thead><tr><th>الصنف</th><th>الحالي</th><th>الأدنى</th><th>الأقصى</th><th>طلب مقترح</th></tr></thead><tbody>'
                    + items.map(r => '<tr><td>' + esc(r.product_name) + '</td><td class="text-danger">' + fmtLocal(r.current) + '</td><td>' + fmtLocal(r.min) + '</td><td>' + fmtLocal(r.max) + '</td><td><strong>' + fmtLocal(r.suggested_order) + '</strong></td></tr>').join('')
                    + '</tbody></table>';
            } else if (report === 'dead') {
                const items = alerts.dead_stock || [];
                html = items.length === 0
                    ? '<div style="text-align:center;padding:30px;color:#10b981"><i class="fa-solid fa-circle-check"></i> لا توجد أصناف ميتة</div>'
                    : '<table class="data-table"><thead><tr><th>الصنف</th><th>الكمية</th><th>القيمة</th><th>أيام بدون حركة</th></tr></thead><tbody>'
                    + items.map(r => '<tr><td>' + esc(r.product_name) + '</td><td>' + fmtLocal(r.quantity) + '</td><td>' + fmtLocal(r.value) + '</td><td class="text-danger">' + r.days_inactive + ' يوم</td></tr>').join('')
                    + '</tbody></table>';
            } else if (report === 'reorder') {
                const items = summaries.reorder_suggestions || [];
                html = items.length === 0
                    ? '<div style="text-align:center;padding:30px;color:#10b981"><i class="fa-solid fa-circle-check"></i> لا توجد اقتراحات إعادة طلب</div>'
                    : '<table class="data-table"><thead><tr><th>الصنف</th><th>الحالي</th><th>الأدنى</th><th>الأقصى</th><th>الكمية المقترحة</th><th>القيمة المقترحة</th></tr></thead><tbody>'
                    + items.map(r => '<tr><td>' + esc(r.product_name) + '</td><td class="text-danger">' + fmtLocal(r.current_quantity) + '</td><td>' + fmtLocal(r.min_stock) + '</td><td>' + fmtLocal(r.max_stock) + '</td><td><strong>' + fmtLocal(r.suggested_order_qty) + '</strong></td><td><strong>' + fmtLocal(r.suggested_order_value) + '</strong></td></tr>').join('')
                    + '</tbody></table>';
            } else if (report === 'damaged') {
                const items = summaries.dead_stock || [];
                html = items.length === 0
                    ? '<div style="text-align:center;padding:30px;color:#10b981"><i class="fa-solid fa-circle-check"></i> لا توجد توالف</div>'
                    : '<table class="data-table"><thead><tr><th>الصنف</th><th>الكمية التالفة</th><th>القيمة</th></tr></thead><tbody>'
                    + items.map(r => '<tr><td>' + esc(r.product_name) + '</td><td>' + fmtLocal(r.quantity) + '</td><td>' + fmtLocal(r.value) + '</td></tr>').join('')
                    + '</tbody></table>';
            }
            if (section) section.innerHTML = html;
        }

        try {
            const res = await req('/analytics/v1/inventory/dashboard');
            if (!res.success) return;
            const d = res.data;
            window.__invData = d;

            const k = d.kpis;
            setNum('inv-value', k.inventory_value, ' ج.م');
            setNum('inv-sell-value', k.sell_value, ' ج.م');
            setNum('inv-qty', k.available_qty);
            setNum('inv-damaged-qty', k.damaged_qty);
            setNum('inv-negative', k.negative_count);
            setNum('inv-low-stock', k.low_stock_count);
            set('inv-turnover', k.turnover_ratio);
            set('inv-days-on-hand', k.days_on_hand + ' يوم');
            set('inv-dead-pct', k.dead_stock_pct + '%');
            set('inv-abc-cov', k.abc_coverage + '%');
            set('inv-fast-count', k.fast_moving_count);
            set('inv-slow-count', k.slow_moving_count);
            set('inv-health-score', d.health_score + '/100');

            // Value Trend Chart
            const trendCtx = document.getElementById('inv-trend-chart');
            if (trendCtx && typeof Chart !== 'undefined' && d.charts.value_trend && d.charts.value_trend.length > 0) {
                if (invTrendChart) invTrendChart.destroy();
                invTrendChart = new Chart(trendCtx, {
                    type: 'line',
                    data: {
                        labels: d.charts.value_trend.map(r => r.month),
                        datasets: [{
                            label: 'قيمة المخزون',
                            data: d.charts.value_trend.map(r => parseFloat(r.total_value)),
                            borderColor: '#7c3aed',
                            backgroundColor: 'rgba(124,58,237,0.1)',
                            fill: true, tension: 0.4, borderWidth: 2,
                            pointBackgroundColor: '#fff',
                            pointBorderColor: '#7c3aed',
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

            // ABC Pie Chart
            const abcCtx = document.getElementById('inv-abc-chart');
            if (abcCtx && typeof Chart !== 'undefined' && d.abc) {
                if (invAbcChart) invAbcChart.destroy();
                invAbcChart = new Chart(abcCtx, {
                    type: 'doughnut',
                    data: {
                        labels: ['A (70%)', 'B (20%)', 'C (10%)'],
                        datasets: [{
                            data: [d.abc.a_value, d.abc.b_value, d.abc.c_value],
                            backgroundColor: ['#7c3aed', '#f59e0b', '#94a3b8'],
                            borderWidth: 0
                        }]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        plugins: {
                            legend: { position: 'bottom', labels: { font: { family: 'Cairo' } } }
                        }
                    }
                });
            }

            // Movement Chart
            const moveCtx = document.getElementById('inv-movement-chart');
            if (moveCtx && typeof Chart !== 'undefined' && d.charts.stock_movement) {
                if (invMovementChart) invMovementChart.destroy();
                invMovementChart = new Chart(moveCtx, {
                    type: 'bar',
                    data: {
                        labels: ['وارد', 'صادر', 'تحويل', 'إتلاف'],
                        datasets: [{
                            label: 'الكمية',
                            data: [
                                d.charts.stock_movement.in,
                                d.charts.stock_movement.out,
                                d.charts.stock_movement.transfer,
                                d.charts.stock_movement.disposal
                            ],
                            backgroundColor: ['#10b981', '#ef4444', '#3b82f6', '#f59e0b'],
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

            // Warehouse Comparison Chart
            const whCtx = document.getElementById('inv-warehouse-chart');
            if (whCtx && typeof Chart !== 'undefined' && d.charts.warehouse_comparison && d.charts.warehouse_comparison.length > 0) {
                if (invWarehouseChart) invWarehouseChart.destroy();
                invWarehouseChart = new Chart(whCtx, {
                    type: 'bar',
                    data: {
                        labels: d.charts.warehouse_comparison.map(w => w.name),
                        datasets: [{
                            label: 'القيمة',
                            data: d.charts.warehouse_comparison.map(w => w.value),
                            backgroundColor: ['#7c3aed', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'],
                            borderRadius: 4
                        }]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        indexAxis: 'y',
                        plugins: { legend: { display: false } },
                        scales: {
                            x: { beginAtZero: true, grid: { borderDash: [5, 5] }, ticks: { font: { family: 'Cairo' } } },
                            y: { grid: { display: false }, ticks: { font: { family: 'Cairo' } } }
                        }
                    }
                });
            }

            // Initial report render
            renderActiveReport();

        } catch (e) {
            console.error('Inventory Analytics Error:', e);
        }
    };

    window.loadInventoryAnalytics = function () {
        const handler = viewHandlers['view-inventory-analytics'];
        if (handler) handler();
    };

    // ============================================================
    // VIEW: PROFITABILITY ANALYTICS (BI-5)
    // ============================================================
    let profTrendChart = null, profMarginChart = null, profCategoryChart = null;

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

    // ============================================================
    // VIEW: INVENTORY
    // ============================================================
    viewHandlers['view-inventory'] = async function () {
        const view = document.getElementById('view-inventory');
        if (!view) return;
        const tbody = view.querySelector('tbody');
        if (!tbody) return;
        const r = await req('/inventory/balances');
        if (!r.success) return;
        tbody.innerHTML = '';
        if (!r.data || r.data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-muted)">لا توجد أرصدة</td></tr>';
            return;
        }
        r.data.forEach(b => {
            const stock = Number(b.quantity || 0);
            const min = Number(b.min_stock || 0);
            let statusBadge = '<span class="badge-status paid">متوفر</span>';
            if (stock <= 0) statusBadge = '<span class="badge-status overdue">صفر</span>';
            else if (stock <= min) statusBadge = '<span class="badge-status overdue">ناقص</span>';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${b.product_code || '-'}</td>
                <td>${b.product_name || '-'}</td>
                <td>${b.unit_name || 'قطعة'}</td>
                <td class="${stock <= min ? 'text-danger' : 'text-success'}" style="font-weight:bold">${fmtInt(stock)}</td>
                <td>${fmtInt(min)}</td>
                <td>${statusBadge}</td>
                <td><strong>${fmt(b.total_value)}</strong> ج.م</td>`;
            tbody.appendChild(tr);
        });
    };

    // ============================================================
    // VIEW: INVENTORY CARD
    // ============================================================
    viewHandlers['view-inventory-card'] = async function () {
        const view = document.getElementById('view-inventory-card');
        if (!view) return;
        const sel = view.querySelector('select');
        const tbody = view.querySelector('table tbody');
        if (!sel || !tbody) return;

        if (!sel.dataset.loaded) {
            sel.dataset.loaded = '1';
            const r = await req('/products');
            if (r.success) {
                sel.innerHTML = '<option value="">-- اختر الصنف --</option>';
                (r.data || []).forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = `${p.product_code} - ${p.product_name}`;
                    sel.appendChild(opt);
                });
            }
        }

        const showBtn = view.querySelector('button.btn-primary');
        if (showBtn && !showBtn.dataset.bound) {
            showBtn.dataset.bound = '1';
            showBtn.addEventListener('click', async () => {
                const id = sel.value;
                if (!id) return alert('اختر صنف أولاً');
                const r = await req(`/inventory/card/${id}`);
                if (!r.success) return alert(r.message || 'خطأ');
                const card = r.data;
                // تحديث الإحصائيات
                const statsRow = view.querySelector('.stats-row, .dashboard-stats');
                if (statsRow) {
                    statsRow.innerHTML = `
                        <div class="stat-card"><div class="stat-icon box-icon"><i class="fa-solid fa-cubes"></i></div><div class="stat-details"><span class="stat-label">الرصيد الحالي</span><h3 class="stat-value">${fmtInt(card.total_stock)} ${card.unit_name || ''}</h3></div></div>
                        <div class="stat-card"><div class="stat-icon sales-icon"><i class="fa-solid fa-coins"></i></div><div class="stat-details"><span class="stat-label">قيمة المخزون</span><h3 class="stat-value">${fmt(card.stock_value)} ج.م</h3></div></div>
                        <div class="stat-card"><div class="stat-icon clients-icon"><i class="fa-solid fa-tag"></i></div><div class="stat-details"><span class="stat-label">متوسط التكلفة</span><h3 class="stat-value">${fmt(card.cost_price)} ج.م</h3></div></div>
                    `;
                }
                tbody.innerHTML = '';
                if (!card.movements || card.movements.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px">لا توجد حركات</td></tr>';
                } else {
                    card.movements.forEach(m => {
                        const tr = document.createElement('tr');
                        tr.innerHTML = `
                            <td>${m.move_date || '-'}</td>
                            <td>${m.move_type === 'in' ? 'وارد' : m.move_type === 'out' ? 'صادر' : m.move_type === 'transfer' ? 'تحويل' : m.move_type}</td>
                            <td>${m.document_no || '-'}</td>
                            <td class="text-success">${m.qty_in ? fmt(m.qty_in) : '-'}</td>
                            <td class="text-danger">${m.qty_out ? fmt(m.qty_out) : '-'}</td>
                            <td>${fmtInt(m.balance_after || 0)}</td>`;
                        tbody.appendChild(tr);
                    });
                }
            });
        }
    };

    viewHandlers['view-inventory-transfers'] = async function () {
        const view = document.getElementById('view-inventory-transfers');
        if (!view) return;
        const tbody = view.querySelector('table tbody');
        if (!tbody) return;
        const r = await req('/inventory/transfers');
        if (!r.success) return;
        tbody.innerHTML = '';
        if (!r.data || r.data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-muted)">لا توجد تحويلات</td></tr>';
            return;
        }
        r.data.forEach(t => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${t.transfer_no || '-'}</strong></td>
                <td>${t.transfer_date || '-'}</td>
                <td>${t.from_store || '-'}</td>
                <td>${t.to_store || '-'}</td>
                <td>${t.product_names || '-'}</td>
                <td>${t.total_quantity || '-'}</td>
                <td>${t.notes || '-'}</td>`;
            tbody.appendChild(tr);
        });
    };

    // ============================================================
    // VIEW: INVENTORY DAMAGED
    // ============================================================
    viewHandlers['view-inventory-damaged'] = async function () {
        const tbody = document.getElementById('disp-tbody');
        if (!tbody) return;
        const r = await req('/inventory/disposals');
        if (!r.success) return;
        tbody.innerHTML = '';
        if (!r.data || r.data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--text-muted)">لا توجد تواليف</td></tr>';
            return;
        }
        r.data.forEach(d => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${d.doc_date || '-'}</td>
                <td><strong>${d.doc_no || '-'}</strong></td>
                <td>${d.store_name || '-'}</td>
                <td>${d.product_names || '-'}</td>
                <td>${d.item_count || 0}</td>
                <td>${fmt(d.total_qty)}</td>
                <td class="text-danger"><strong>${fmt(d.total_value)} ج.م</strong></td>
                <td><span class="badge badge-success">مرحل</span></td>
                <td>
                    <div style="display:flex;gap:4px;flex-wrap:nowrap">
                        <button class="icon-btn" title="عرض" onclick="window.showDisposalDetail(${d.id})"><i class="fa-solid fa-eye"></i></button>
                        <button class="icon-btn" title="تعديل" onclick="window.editDisposal(${d.id})"><i class="fa-solid fa-pen"></i></button>
                        <button class="icon-btn" title="طباعة" onclick="window.printDisposalDetail(${d.id})"><i class="fa-solid fa-print"></i></button>
                        <button class="icon-btn text-danger" title="حذف" onclick="window.deleteDisposal(${d.id},'${d.doc_no || ''}')"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </td>`;
            tbody.appendChild(tr);
        });
    };

    // ============================================================
    // VIEW: STOCK COUNT
    // ============================================================
    viewHandlers['view-stock-count'] = async function () {
        const tbody = document.getElementById('stock-count-tbody');
        if (!tbody) return;
        const r = await req('/inventory/count');
        if (!r.success) return;
        tbody.innerHTML = '';
        if (!r.data || r.data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-muted)">لا توجد عمليات جرد سابقة</td></tr>';
            return;
        }
        r.data.forEach(c => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${c.count_no || '-'}</strong></td>
                <td>${c.count_date || '-'}</td>
                <td>${c.store_name || c.store_id || '-'}</td>
                <td>${fmtInt(c.items_count || 0)}</td>
                <td>${fmt(c.total_difference || 0)}</td>
                <td><span class="badge-status ${c.status === 'completed' ? 'paid' : 'pending'}">${c.status === 'completed' ? 'مغلق' : c.status === 'in_progress' ? 'جاري' : c.status}</span></td>
                <td class="actions-cell"><button class="icon-btn btn-view"><i class="fa-solid fa-eye"></i></button></td>`;
            tbody.appendChild(tr);
        });
    };

    // ============================================================
    // VIEW: STOCK ADJUST
    // ============================================================
    viewHandlers['view-stock-adjust'] = async function () {
        const productSel = document.getElementById('adj-product');
        const storeSel = document.getElementById('adj-store');
        if (!productSel || !storeSel) return;

        async function getCurrentQty() {
            const pid = productSel.value;
            const sid = storeSel.value;
            if (!pid || !sid) return null;
            const r = await req(`/inventory/balances?store_id=${sid}&product_id=${pid}`);
            if (r.success && r.data && r.data.length > 0) return Number(r.data[0].quantity || 0);
            return 0;
        }

        if (!storeSel.dataset.loaded) {
            storeSel.dataset.loaded = '1';
            const r = await req('/stores');
            if (r.success) {
                (r.data || []).forEach(s => {
                    const opt = document.createElement('option');
                    opt.value = s.id;
                    opt.textContent = s.store_name;
                    storeSel.appendChild(opt);
                });
            }
        }
        if (storeSel && !storeSel.dataset.searchable) {
            storeSel.dataset.searchable = '1';
            window.makeSearchableSelect(storeSel, Array.from(storeSel.options).filter(o => o.value).map(o => ({id: o.value, name: o.textContent})), 'ابحث عن مخزن...');
        }
        if (!productSel.dataset.loaded) {
            productSel.dataset.loaded = '1';
            const r = await req('/products');
            if (r.success) {
                (r.data || []).forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = `${p.product_code} - ${p.product_name}`;
                    productSel.appendChild(opt);
                });
            }
        }
        if (productSel && !productSel.dataset.searchable) {
            productSel.dataset.searchable = '1';
            window.makeSearchableSelect(productSel, Array.from(productSel.options).filter(o => o.value).map(o => ({id: o.value, name: o.textContent})), 'ابحث عن صنف...');
        }

        const saveBtn = document.getElementById('btn-save-adjust');
        if (saveBtn && !saveBtn.dataset.bound) {
            saveBtn.dataset.bound = '1';
            saveBtn.addEventListener('click', async () => {
                const newQty = parseFloat(document.getElementById('adj-qty').value);
                if (isNaN(newQty) || newQty < 0) return alert('أدخل كمية صحيحة');
                const currentQty = await getCurrentQty();
                if (currentQty === null) return alert('اختر الصنف والمخزن');
                const diff = newQty - currentQty;
                const payload = {
                    product_id: productSel.value,
                    store_id: storeSel.value,
                    quantity: diff,
                    reason: document.getElementById('adj-reason').value,
                    notes: document.getElementById('adj-notes').value
                };
                const orig = saveBtn.innerHTML;
                saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';
                saveBtn.disabled = true;
                const r = await req('/inventory/adjust', 'POST', payload);
                saveBtn.innerHTML = orig;
                saveBtn.disabled = false;
                if (r.success) {
                    alert(`تم تعديل المخزون. الفرق: ${diff > 0 ? '+' : ''}${diff}`);
                    document.getElementById('adj-qty').value = '';
                    document.getElementById('adj-notes').value = '';
                } else {
                    alert('خطأ: ' + (r.message || ''));
                }
            });
        }
    };

    // ============================================================
    // VIEW: SUPPLIER PAYMENTS
    // ============================================================
    viewHandlers['view-supplier-payments'] = async function () {
        const tbody = document.getElementById('payments-tbody');
        if (!tbody) return;
        const now = new Date();
        const from = document.getElementById('payments-from');
        const to = document.getElementById('payments-to');
        if (from && !from.value) from.value = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
        if (to && !to.value) to.value = now.toISOString().slice(0, 10);

        // Debounced load with loading/error states
        let loadTimer;
        async function load() {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding:20px"><i class="fa-solid fa-spinner fa-spin"></i></td></tr>';
            const params = new URLSearchParams();
            const f = document.getElementById('payments-from')?.value;
            const t = document.getElementById('payments-to')?.value;
            const q = document.getElementById('payments-search')?.value;
            if (q) params.append('q', q);
            if (f) params.append('from', f);
            if (t) params.append('to', t);
            try {
                const r = await req('/payments' + (params.toString() ? '?' + params : ''));
                if (!r.success) { tbody.innerHTML = '<tr><td colspan="7" class="text-center text-danger" style="padding:20px">خطأ في تحميل البيانات</td></tr>'; return; }
                const rows = r.data || [];
                tbody.innerHTML = '';
                if (rows.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text-muted)">لا توجد مدفوعات</td></tr>';
                } else {
                    rows.forEach(p => {
                        const methodBadge = p.payment_method === 'cash' ? '<span class="badge-status paid">نقدي</span>'
                            : p.payment_method === 'check' ? '<span class="badge-status pending">شيك</span>'
                            : '<span class="badge-status paid">تحويل</span>';
                        const tr = document.createElement('tr');
                        const payId = p.id;
                        tr.innerHTML = `
                            <td><strong style="color:var(--primary-color)">${p.payment_no || '-'}</strong></td>
                            <td>${p.payment_date || '-'}</td>
                            <td>${p.supplier_name || '-'}</td>
                            <td class="text-danger"><strong>${fmt(p.amount)} ج.م</strong></td>
                            <td>${methodBadge}</td>
                            <td>${p.notes || '-'}</td>
                            <td class="actions-cell">
                                <button class="icon-btn btn-view-payment" data-id="${payId}" title="عرض"><i class="fa-solid fa-eye"></i></button>
                                <button class="icon-btn btn-edit-payment" data-id="${payId}" title="تعديل"><i class="fa-solid fa-pen-to-square"></i></button>
                                <button class="icon-btn btn-print-payment" data-id="${payId}" title="طباعة"><i class="fa-solid fa-print"></i></button>
                                <button class="icon-btn text-danger btn-delete-payment" data-id="${payId}" title="حذف"><i class="fa-solid fa-trash"></i></button>
                            </td>`;
                        tbody.appendChild(tr);
                    });
                }
                const monthTotal = rows.filter(p => {
                    const d = new Date(p.payment_date);
                    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
                }).reduce((s, p) => s + Number(p.amount || 0), 0);
                const set = (id, v) => { const e = document.getElementById(id); if (e) e.innerHTML = v; };
                set('payments-month-total', fmt(monthTotal) + ' ج.م');
                set('payments-count', fmtInt(rows.length));
            } catch(e) {
                tbody.innerHTML = '<tr><td colspan="7" class="text-center text-danger" style="padding:20px">لا توجد بيانات لعرضها</td></tr>';
            }
        }
        await load();
        ['payments-from', 'payments-to', 'payments-search'].forEach(id => {
            const el = document.getElementById(id);
            if (el && !el.dataset.bound) {
                el.dataset.bound = '1';
                el.addEventListener('input', function() {
                    clearTimeout(loadTimer);
                    loadTimer = setTimeout(load, 400);
                });
            }
        });

        const btnNew = document.getElementById('btn-new-payment');
        if (btnNew && !btnNew.dataset.bound) {
            btnNew.dataset.bound = '1';
            btnNew.addEventListener('click', () => openPaymentModal());
        }

        if (!tbody.dataset.bound) {
            tbody.dataset.bound = '1';
            tbody.addEventListener('click', async (e) => {
                const viewBtn = e.target.closest('.btn-view-payment');
                if (viewBtn) { showPaymentDetail(viewBtn.dataset.id, load); return; }
                const editBtn = e.target.closest('.btn-edit-payment');
                if (editBtn) {
                    const r = await req('/payments?q=' + encodeURIComponent(editBtn.dataset.id));
                    const pay = (r.data || []).find(p => p.id == editBtn.dataset.id);
                    if (pay) openPaymentModal(pay);
                    return;
                }
                const printBtn = e.target.closest('.btn-print-payment');
                if (printBtn) {
                    if (window.API && window.API.printInIframe) {
                        window.API.printInIframe('/api/reports/payment/' + printBtn.dataset.id + '/print');
                    }
                    return;
                }
                const btn = e.target.closest('.btn-delete-payment');
                if (btn) {
                    if (!confirm('هل تريد حذف هذا السند؟')) return;
                    const r = await req('/payments/' + btn.dataset.id, 'DELETE');
                    if (r.success) { alert('تم الحذف'); load(); }
                }
            });
        }
    };

    function showPaymentDetail(id, reloadCb) {
        const modal = document.getElementById('global-modal');
        if (!modal) return;
        document.getElementById('modal-title').textContent = 'تحميل...';
        document.getElementById('modal-body').innerHTML = '<p style="text-align:center;padding:30px">جاري التحميل...</p>';
        const saveBtn = document.getElementById('btn-modal-save');
        if (saveBtn) saveBtn.style.display = 'none';
        modal.classList.add('active');

        req('/payments').then(r => {
            if (!r.success) { document.getElementById('modal-body').innerHTML = '<p style="text-align:center;color:red">خطأ في تحميل البيانات</p>'; return; }
            const pay = (r.data || []).find(p => p.id == id);
            if (!pay) { document.getElementById('modal-body').innerHTML = '<p style="text-align:center;color:red">الدفعة غير موجودة</p>'; return; }
            const isCheck = pay.payment_method === 'check';
            document.getElementById('modal-title').textContent = 'تفاصيل سند الصرف: ' + (pay.payment_no || '');

            let allocs = [];
            try { allocs = JSON.parse(pay.allocations_json || '[]'); } catch(e) {}

            const methodLabel = pay.payment_method === 'cash' ? 'نقدي' : pay.payment_method === 'check' ? 'شيك' : 'تحويل بنكي';
            const cancelBtn = document.getElementById('btn-modal-cancel');

            document.getElementById('modal-body').innerHTML = `
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:15px;background:#f8f9fa;border-radius:8px;margin-bottom:15px;border:1px solid #e2e8f0">
                    <div><strong>رقم السند:</strong> ${esc(pay.payment_no || '-')}</div>
                    <div><strong>التاريخ:</strong> ${esc(pay.payment_date || '-')}</div>
                    <div><strong>المورد:</strong> ${esc(pay.supplier_name || '-')}</div>
                    <div><strong>المبلغ:</strong> <strong style="color:var(--danger-color);font-size:1.1rem">${fmt(pay.amount)} ج.م</strong></div>
                    <div><strong>طريقة الدفع:</strong> ${methodLabel}</div>
                    <div><strong>بواسطة:</strong> ${esc(pay.created_by_name || 'النظام')}</div>
                    ${isCheck ? `
                    <div><strong>رقم الشيك:</strong> ${esc(pay.check_no || '-')}</div>
                    <div><strong>تاريخ الشيك:</strong> ${esc(pay.check_date || '-')}</div>
                    <div><strong>البنك:</strong> ${esc(pay.bank_name || '-')}</div>
                    <div><strong>حالة الشيك:</strong> <span class="badge-status pending">قيد التحصيل</span></div>
                    <div style="grid-column:span 2"><strong>ملاحظات:</strong> ${esc(pay.notes || '-')}</div>` : `
                    <div style="grid-column:span 2"><strong>ملاحظات:</strong> ${esc(pay.notes || '-')}</div>`}
                </div>
                ${allocs.length > 0 ? `
                <h4 style="margin:12px 0 6px;font-size:13px;color:#475569">الفواتير المسدد عليها</h4>
                <table class="data-table" style="margin-bottom:12px">
                    <thead><tr><th>#</th><th>رقم الفاتورة</th><th>المبلغ المسدد</th></tr></thead>
                    <tbody>${allocs.map((a, i) => `
                        <tr><td>${i+1}</td><td>${esc(a.invoice_no || 'فاتورة #'+a.invoice_id)}</td><td>${fmt(a.allocated_amount)} ج.م</td></tr>
                    `).join('')}</tbody>
                </table>` : ''}
                <div id="payment-detail-actions" style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:10px;padding-top:12px;border-top:1px solid #e2e8f0"></div>`;
            if (cancelBtn) cancelBtn.textContent = 'إغلاق';

            // Wire action buttons
            const act = document.getElementById('payment-detail-actions');
            if (!act) return;
            const makeBtn = (html, cls, onclick) => { const b=document.createElement('button'); b.className=cls; b.innerHTML=html; b.onclick=onclick; act.appendChild(b); };
            makeBtn('<i class="fa-solid fa-print"></i> طباعة', 'btn btn-outline btn-sm', () => { if (window.API) window.API.printInIframe('/api/reports/payment/'+pay.id+'/print'); });
            makeBtn('<i class="fa-solid fa-pen-to-square"></i> تعديل', 'btn btn-outline btn-sm', () => { modal.classList.remove('active'); setTimeout(() => openPaymentModal({id:pay.id,payment_no:pay.payment_no,payment_date:pay.payment_date,amount:pay.amount,payment_method:pay.payment_method,notes:pay.notes,check_no:pay.check_no,check_date:pay.check_date,bank_name:pay.bank_name,supplier_id:pay.supplier_id}), 150); });
            makeBtn('<i class="fa-solid fa-trash"></i> حذف', 'btn btn-danger btn-sm', async () => { if (!confirm('هل تريد حذف هذا السند؟')) return; const r=await req('/payments/'+pay.id,'DELETE'); if (r.success) { modal.classList.remove('active'); alert('تم الحذف'); if (typeof reloadCb==='function') reloadCb(); } });
            makeBtn('<i class="fa-solid fa-xmark"></i> إغلاق', 'btn btn-outline btn-sm', () => modal.classList.remove('active'));
        });
    }

    function openPaymentModal(payData) {
        const isEdit = !!payData;
        const modal = document.getElementById('global-modal');
        if (!modal) return;
        document.getElementById('modal-title').textContent = isEdit ? 'تعديل سند الصرف' : 'سند صرف جديد';
        
        const payNo = isEdit ? payData.payment_no : '';
        const payDate = isEdit ? payData.payment_date : new Date().toISOString().slice(0, 10);
        const payAmt = isEdit ? payData.amount : '';
        const payMethod = isEdit ? payData.payment_method : 'cash';
        const payNotes = isEdit ? (payData.notes || '') : '';
        const chkNo = isEdit ? (payData.check_no || '') : '';
        const chkDate = isEdit ? (payData.check_date || '') : '';
        const bankName = isEdit ? (payData.bank_name || '') : '';

        document.getElementById('modal-body').innerHTML = `
            <div class="form-grid" style="grid-template-columns:repeat(2,1fr);gap:12px;">
                <div class="form-group"><label>رقم السند</label><input type="text" id="modal-pay-no" value="${payNo}" placeholder="تلقائي إذا ترك فارغاً" ${isEdit ? 'readonly style="background:#f0f0f0"' : ''}></div>
                <div class="form-group"><label>المورد <span class="required">*</span></label><select id="modal-pay-supplier" style="width:100%"><option value="">-- اختر --</option></select></div>
                <div class="form-group"><label>التاريخ <span class="required">*</span></label><input type="date" id="modal-pay-date" value="${payDate}"></div>
                <div class="form-group"><label>المبلغ <span class="required">*</span></label><input type="number" id="modal-pay-amount" value="${payAmt}" min="0" step="0.01"></div>
                <div class="form-group"><label>طريقة الدفع</label><select id="modal-pay-method"><option value="cash" ${payMethod==='cash'?'selected':''}>نقدي</option><option value="check" ${payMethod==='check'?'selected':''}>شيك</option><option value="transfer" ${payMethod==='transfer'?'selected':''}>تحويل</option></select></div>
                <div class="form-group check-field" style="display:${payMethod==='check'?'':'none'}"><label>رقم الشيك</label><input type="text" id="modal-pay-check-no" value="${chkNo}"></div>
                <div class="form-group check-field" style="display:${payMethod==='check'?'':'none'}"><label>تاريخ الشيك</label><input type="date" id="modal-pay-check-date" value="${chkDate}"></div>
                <div class="form-group check-field" style="display:${payMethod==='check'?'':'none'}"><label>البنك</label><input type="text" id="modal-pay-bank" value="${bankName}"></div>
                <div class="form-group" style="grid-column:span 2"><label>ملاحظات</label><textarea id="modal-pay-notes" class="form-control" rows="2" style="resize:vertical">${payNotes}</textarea></div>
            </div>`;
        req('/suppliers').then(r => {
            const sel = document.getElementById('modal-pay-supplier');
            if (sel && r.data) {
                const mapped = r.data.map(s => ({ id: s.id, name: s.supplier_name }));
                sel.innerHTML = '<option value="">-- اختر --</option>' + mapped.map(s => `<option value="${s.id}">${s.supplier_name}</option>`).join('');
                setTimeout(() => {
                    if (window.makeSearchableSelect && !sel.dataset.searchable) {
                        sel.dataset.searchable = '1';
                        window.makeSearchableSelect(sel, mapped, 'بحث عن مورد...');
                    }
                    if (isEdit && payData.supplier_id) sel.value = payData.supplier_id;
                }, 50);
            }
        });
        document.getElementById('modal-pay-date').value = payDate;
        // Toggle check fields on method change
        const methodSel = document.getElementById('modal-pay-method');
        if (methodSel) {
            methodSel.onchange = () => {
                document.querySelectorAll('.check-field').forEach(el => el.style.display = methodSel.value === 'check' ? 'block' : 'none');
            };
        }
        const saveBtn = document.getElementById('btn-modal-save');
        if (saveBtn) saveBtn.style.display = '';
        if (saveBtn) saveBtn.onclick = async () => {
            const payload = {
                payment_no: document.getElementById('modal-pay-no').value,
                supplier_id: document.getElementById('modal-pay-supplier').value,
                payment_date: document.getElementById('modal-pay-date').value,
                amount: document.getElementById('modal-pay-amount').value,
                payment_method: document.getElementById('modal-pay-method').value,
                check_no: document.getElementById('modal-pay-check-no')?.value || '',
                check_date: document.getElementById('modal-pay-check-date')?.value || '',
                bank_name: document.getElementById('modal-pay-bank')?.value || '',
                notes: document.getElementById('modal-pay-notes').value
            };
            if (!payload.supplier_id || !payload.amount) return alert('أكمل البيانات');
            const orig = saveBtn.innerHTML;
            saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';
            saveBtn.disabled = true;
            const r = isEdit ? await req('/payments/' + payData.id, 'PUT', payload) : await req('/payments', 'POST', payload);
            saveBtn.innerHTML = orig;
            saveBtn.disabled = false;
            if (r.success) {
                modal.classList.remove('active');
                if (window.TradeProViews) window.TradeProViews.reload('view-supplier-payments');
                alert(isEdit ? 'تم التعديل بنجاح' : 'تم التسجيل بنجاح');
            } else {
                if (r.code === 'DUPLICATE_PAYMENT_NO') {
                    alert('تنبيه: ' + r.message);
                    document.getElementById('modal-pay-no').value = '';
                    document.getElementById('modal-pay-no').focus();
                } else {
                    alert('خطأ: ' + (r.message || ''));
                }
            }
        };
        modal.classList.add('active');
    }

    // ============================================================
    // VIEW: SUPPLIER STATEMENT
    // ============================================================
    viewHandlers['view-supplier-statement'] = async function () {
        const sel = document.getElementById('sup-stmt-select');
        if (!sel) return;
        if (!sel.dataset.loaded) {
            sel.dataset.loaded = '1';
            const r = await req('/suppliers');
            if (r.success) {
                (r.data || []).forEach(s => {
                    const opt = document.createElement('option');
                    opt.value = s.id;
                    opt.textContent = s.supplier_name;
                    sel.appendChild(opt);
                });
            }
        }
        const now = new Date();
        const from = document.getElementById('sup-stmt-from');
        const to = document.getElementById('sup-stmt-to');
        if (from && !from.value) from.value = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
        if (to && !to.value) to.value = now.toISOString().slice(0, 10);

        const btnShow = document.getElementById('btn-sup-stmt-show');
        if (btnShow && !btnShow.dataset.bound) {
            btnShow.dataset.bound = '1';
            btnShow.addEventListener('click', async () => {
                const id = sel.value;
                if (!id) return alert('اختر مورد أولاً');
                const params = new URLSearchParams();
                const f = document.getElementById('sup-stmt-from').value;
                const t = document.getElementById('sup-stmt-to').value;
                if (f) params.append('from', f);
                if (t) params.append('to', t);
                const r = await req(`/payments/supplier/${id}/statement` + (params.toString() ? '?' + params : ''));
                if (!r.success) return alert(r.message || 'خطأ');
                const data = r.data;
                document.getElementById('sup-stmt-results').style.display = '';
                document.getElementById('sup-stmt-title').textContent = `كشف حساب: ${data.supplier.supplier_name}`;
                const tbody = document.getElementById('sup-stmt-tbody');
                tbody.innerHTML = '';
                let totalDebit = 0, totalCredit = 0, running = Number(data.opening_balance || 0);
                const lines = data.rows || data.lines || [];
                if (lines.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px">لا توجد حركات</td></tr>';
                } else {
                    lines.forEach(row => {
                        const debit = Number(row.debit || 0);
                        const credit = Number(row.credit || 0);
                        totalDebit += debit;
                        totalCredit += credit;
                        running += credit - debit;
                        const tr = document.createElement('tr');
                        tr.innerHTML = `
                            <td>${row.date || '-'}</td>
                            <td>${row.type || '-'}</td>
                            <td>${row.doc_no || '-'}</td>
                            <td class="text-success">${debit ? fmt(debit) : '-'}</td>
                            <td class="text-danger">${credit ? fmt(credit) : '-'}</td>
                            <td class="text-primary"><strong>${fmt(running)}</strong></td>`;
                        tbody.appendChild(tr);
                    });
                }
                document.getElementById('sup-stmt-tfoot').style.display = '';
                document.getElementById('sup-stmt-total-debit').innerHTML = fmt(totalDebit);
                document.getElementById('sup-stmt-total-credit').innerHTML = fmt(totalCredit);
                document.getElementById('sup-stmt-total-balance').innerHTML = fmt(running);
            });
        }
    };

    // ============================================================
    // VIEW: TREASURY
    // ============================================================
    viewHandlers['view-treasury'] = async function () {
        const view = document.getElementById('view-treasury');
        if (!view) return;
        const sumRes = await req('/treasury/summary');
        if (sumRes.success) {
            const stats = view.querySelectorAll('.stat-value');
            const d = sumRes.data;
            const cashAcc = (d.accounts || []).filter(a => a.account_type === 'cash');
            const bankAcc = (d.accounts || []).filter(a => a.account_type === 'bank');
            const cashTotal = cashAcc.reduce((s, a) => s + Number(a.current_balance || 0), 0);
            const bankTotal = bankAcc.reduce((s, a) => s + Number(a.current_balance || 0), 0);
            if (stats[0]) stats[0].innerHTML = fmt(cashTotal) + ' ج.م';
            if (stats[1]) stats[1].innerHTML = fmt(bankTotal) + ' ج.م';
            if (stats[2]) stats[2].innerHTML = fmt(d.total_balance || 0) + ' ج.م';
        }
        const tbody = view.querySelector('table tbody');
        if (tbody) {
            const r = await req('/treasury/transactions');
            if (r.success) {
                tbody.innerHTML = '';
                if (!r.data || r.data.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px">لا توجد حركات</td></tr>';
                } else {
                    r.data.slice(0, 50).forEach(t => {
                        const tr = document.createElement('tr');
                        const typeLabel = t.trans_type === 'in' ? 'وارد' : 'صادر';
                        tr.innerHTML = `
                            <td>${t.trans_date || '-'}</td>
                            <td><span class="${t.trans_type === 'in' ? 'text-success' : 'text-danger'}">${typeLabel}</span></td>
                            <td>${t.description || t.account_name || '-'}</td>
                            <td class="text-success">${t.trans_type === 'in' ? fmt(t.amount) : '-'}</td>
                            <td class="text-danger">${t.trans_type === 'out' ? fmt(t.amount) : '-'}</td>
                            <td>${fmt(t.balance_after || 0)}</td>`;
                        tbody.appendChild(tr);
                    });
                }
            }
        }
    };

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
                const headers = ['#', 'كود الصنف', 'اسم الصنف', 'الوحدة', 'الكمية المباعة', 'المرتجع', 'صافي', 'قيمة المبيعات', 'التكلفة', 'الربح', 'الهامش%', 'المخزون'];
                const body = data.length === 0
                    ? '<tr><td colspan="12" style="text-align:center;padding:30px;color:#999">لا توجد مبيعات للأصناف</td></tr>'
                    : data.map((p, i) => `<tr>
                        <td>${i+1}</td>
                        <td>${p.product_code || '-'}</td>
                        <td><strong>${p.product_name || '-'}</strong></td>
                        <td>${p.unit_name || '-'}</td>
                        <td>${fmtInt(p.sold_qty)}</td>
                        <td>${fmtInt(p.returned_qty)}</td>
                        <td>${fmtInt(p.net_qty)}</td>
                        <td>${fmt(p.sales_value)}</td>
                        <td>${fmt(p.cost)}</td>
                        <td style="color:${p.profit >= 0 ? '#059669' : '#ef4444'};font-weight:bold">${fmt(p.profit)}</td>
                        <td>${(p.margin_pct||0).toFixed(1)}%</td>
                        <td>${fmtInt(p.inventory)}</td>
                    </tr>`).join('');
                renderTable(headers, body);
                _lastReportData = {
                    title: 'تقرير مبيعات الأصناف',
                    filters: [{ label: 'من تاريخ', value: f.from }, { label: 'إلى تاريخ', value: f.to }, { label: 'المخزن', value: f.store }].filter(x => x.value),
                    summary: [{ label: 'عدد الأصناف', value: fmtInt(data.length) }],
                    columns: headers, rows: data.map((p, i) => [i+1, p.product_code||'-', p.product_name||'-', p.unit_name||'-', fmtInt(p.sold_qty), fmtInt(p.returned_qty), fmtInt(p.net_qty), fmt(p.sales_value), fmt(p.cost), fmt(p.profit), (p.margin_pct||0).toFixed(1)+'%', fmtInt(p.inventory)]),
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

    // ============================================================
    // VIEW: REPORTS PURCHASES
    // ============================================================
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

    // ============================================================
    // VIEW: REPORTS INVENTORY
    // ============================================================
    // ============================================================
    // البحث التلقائي عن الصنف في فاتورة المبيعات/المشتريات
    // ============================================================
    document.addEventListener('input', async (e) => {
        if (!e.target.classList.contains('item-search')) return;
        const input = e.target;
        const val = input.value.trim();
        if (val.length < 2) return;
        if (input.dataset.lastSearch === val) return;
        input.dataset.lastSearch = val;

        const r = await req('/products?q=' + encodeURIComponent(val));
        if (!r.success || !r.data || r.data.length === 0) return;
        const row = input.closest('.invoice-row, .pinvoice-row');
        if (!row) return;
        const match = r.data[0];
        const priceInput = row.querySelector('.item-price, .pitem-cost');
        if (priceInput) priceInput.value = match.sell_price || match.cost_price || 0;
        const sellInput = row.querySelector('.pitem-sell');
        if (sellInput) sellInput.value = match.sell_price || 0;
        row.dataset.productId = match.id;
        input.dataset.matchedId = match.id;
        input.dataset.matchedName = match.product_name;

        if (typeof calcInvoice === 'function') calcInvoice();
        else if (window.calcInvoice) window.calcInvoice();
    });

    // ============================================================
    // تصدير الـ handlers
    // ============================================================
    window.TradeProViews = {
        handlers: viewHandlers,
        reload: (viewId) => {
            const v = document.getElementById(viewId);
            if (v) v.dataset.bound = '';
            if (viewHandlers[viewId]) viewHandlers[viewId]();
        }
    };

    console.log('[TradePro] Views wiring loaded âœ“');





    // ============================================================
    // VIEW: SALES CREDIT LIMITS
    // ============================================================
    viewHandlers['view-sales-credit'] = async function () {
        const r = await req('/customers');
        if (!r.success) return;
        const tbody = document.querySelector('#view-sales-credit tbody');
        if (!tbody) return;
        tbody.innerHTML = '';
        
        r.data.forEach(c => {
            const limit = parseFloat(c.credit_limit) || 0;
            const balance = parseFloat(c.current_balance) || 0;
            const available = Math.max(0, limit - balance);
            
            let statusBadge = '<span class="badge-status paid">آمن</span>';
            if (balance >= limit && limit > 0) statusBadge = '<span class="badge-status overdue">متجاوز للحد</span>';
            else if (balance >= limit * 0.8 && limit > 0) statusBadge = '<span class="badge-status pending">اقترب من الحد</span>';
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${c.customer_name}</strong><br><small style="color:#888">${c.phone || ''}</small></td>
                <td>
                    <div style="display:flex;align-items:center;gap:5px">
                        <input type="number" class="limit-input" value="${limit}" min="0" step="100" style="width:100px;text-align:center"> ج.م
                    </div>
                </td>
                <td class="${balance > 0 ? 'text-danger' : 'text-success'}">${fmt(balance)} ج.م</td>
                <td class="${available === 0 && limit > 0 ? 'text-danger' : 'text-success'}">${limit > 0 ? fmt(available) + ' ج.م' : '<span style="color:#888">لا يوجد حد</span>'}</td>
                <td>${limit > 0 ? statusBadge : '-'}</td>
                <td>
                    <button class="icon-btn btn-edit save-limit-btn" title="تحديث"><i class="fa-solid fa-floppy-disk"></i></button>
                </td>
            `;
            
            tr.querySelector('.save-limit-btn').addEventListener('click', async () => {
                const newLimit = tr.querySelector('.limit-input').value;
                const res = await req('/customers/' + c.id + '/credit', 'PATCH', { credit_limit: newLimit });
                if (res.success) {
                    alert('تم الحفظ بنجاح');
                    viewHandlers['view-sales-credit'](); // Refresh
                } else {
                    alert('خطأ: ' + res.message);
                }
            });
            
            tbody.appendChild(tr);
        });
        
        if (r.data.length === 0) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:#888">لا يوجد عملاء</td></tr>';
    };

    // ============================================================
    // VIEW: STORES MANAGEMENT
    // ============================================================
    viewHandlers['view-stores-management'] = async function () {
        const view = document.getElementById('view-stores-management');
        if (!view) return;

        function qs(sel) { return view.querySelector(sel); }

        // Already wired?
        if (view.dataset.bound) return;
        view.dataset.bound = '1';

        const tbody = document.getElementById('stores-tbody');
        if (!tbody) return;

        async function load() {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding:30px;color:var(--text-muted)"><i class="fa-solid fa-spinner fa-spin" style="margin-left:6px"></i> جاري التحميل...</td></tr>';
            try {
                const r = await req('/stores');
                if (!r.success) { tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger" style="padding:20px;">خطأ في التحميل</td></tr>'; return; }
                const data = r.data || [];
                if (data.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding:30px;color:var(--text-muted)">لا توجد مخازن</td></tr>';
                    return;
                }
                tbody.innerHTML = data.map(s => {
                    const systemCodes = ['ST-MAIN', 'ST001', 'ST-DAMAGED', 'ST-INSP'];
                    const isSystem = systemCodes.includes(s.store_code);
                    const statusBadge = s.status === 'inactive' ? '<span class="badge-status pending">غير نشط</span>' : '<span class="badge-status paid">نشط</span>';
                    const typeLabels = { main: 'رئيسي', sub: 'فرعي', damaged: 'توالف', inspection: 'فحص', transit: 'ترانزيت' };
                    return `<tr>
                        <td><strong style="color:var(--primary-color)">${s.store_code || '-'}</strong></td>
                        <td>${s.store_name || '-'}</td>
                        <td>${typeLabels[s.store_type] || s.store_type || '-'}</td>
                        <td>${statusBadge}</td>
                        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.notes || '-'}</td>
                        <td class="actions-cell">
                            <button class="icon-btn btn-edit-store" data-id="${s.id}" title="تعديل"><i class="fa-solid fa-pen-to-square"></i></button>
                            ${!isSystem ? `<button class="icon-btn text-danger btn-delete-store" data-id="${s.id}" title="حذف"><i class="fa-solid fa-trash"></i></button>` : ''}
                        </td>
                    </tr>`;
                }).join('');
            } catch (e) {
                tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger" style="padding:20px;">خطأ في الاتصال</td></tr>';
            }
        }

        await load();

        // Wire add button
        const btnAdd = document.getElementById('btn-add-store');
        if (btnAdd && !btnAdd.dataset.bound) {
            btnAdd.dataset.bound = '1';
            btnAdd.addEventListener('click', () => openStoreForm());
        }

        // Wire refresh button
        const btnRefresh = document.getElementById('btn-refresh-stores');
        if (btnRefresh && !btnRefresh.dataset.bound) {
            btnRefresh.dataset.bound = '1';
            btnRefresh.addEventListener('click', load);
        }

        // Wire tbody actions
        if (!tbody.dataset.bound) {
            tbody.dataset.bound = '1';
            tbody.addEventListener('click', async (e) => {
                const editBtn = e.target.closest('.btn-edit-store');
                if (editBtn) {
                    const id = editBtn.dataset.id;
                    const r = await req('/stores');
                    const store = (r.data || []).find(s => s.id == id);
                    if (store) openStoreForm(store);
                    return;
                }
                const delBtn = e.target.closest('.btn-delete-store');
                if (delBtn) {
                    const id = delBtn.dataset.id;
                    try {
                        const depsRes = await req('/stores/dependencies/' + id);
                        if (depsRes.data && depsRes.data.length > 0) {
                            const list = document.getElementById('store-deps-list');
                            if (list) {
                                list.innerHTML = depsRes.data.map(d =>
                                    '<div style="display:flex;justify-content:space-between;padding:8px 12px;background:#fef2f2;border-radius:4px;font-size:13px;border:1px solid #fecaca;"><span>' + d.label + '</span><span style="color:#dc2626;font-weight:bold;">' + d.count + '</span></div>'
                                ).join('');
                            }
                            document.getElementById('modal-store-deps').classList.add('open');
                            return;
                        }
                        const confirmed = confirm('هل أنت متأكد من حذف هذا المخزن؟');
                        if (!confirmed) return;
                        const delRes = await req('/stores/' + id, 'DELETE');
                        if (delRes.success) {
                            alert(delRes.message || 'تم الحذف');
                            load();
                        } else {
                            alert(delRes.message || 'فشل الحذف');
                        }
                    } catch (e) {
                        alert('خطأ في الاتصال');
                    }
                    return;
                }
            });
        }
    };

    window.loadStoresManagement = function() {
        if (window.TradeProViews) window.TradeProViews.reload('view-stores-management');
    };

    function openStoreForm(storeData) {
        const isEdit = !!storeData;
        document.getElementById('modal-store-title').textContent = isEdit ? 'تعديل المخزن' : 'إضافة مخزن جديد';
        document.getElementById('sf-id').value = isEdit ? storeData.id : '';
        document.getElementById('sf-code').value = isEdit ? (storeData.store_code || '') : '';
        document.getElementById('sf-name').value = isEdit ? (storeData.store_name || '') : '';
        document.getElementById('sf-type').value = isEdit ? (storeData.store_type || 'sub') : 'sub';
        document.getElementById('sf-status').value = isEdit ? (storeData.status || 'active') : 'active';
        document.getElementById('sf-notes').value = isEdit ? (storeData.notes || '') : '';
        document.getElementById('modal-store-form').classList.add('open');
    }

    // Wire store form save
    document.addEventListener('click', (e) => {
        const saveBtn = e.target.closest('#btn-save-store');
        if (!saveBtn) return;
        const id = document.getElementById('sf-id')?.value;
        const code = document.getElementById('sf-code')?.value?.trim();
        const name = document.getElementById('sf-name')?.value?.trim();
        const type = document.getElementById('sf-type')?.value;
        const status = document.getElementById('sf-status')?.value;
        const notes = document.getElementById('sf-notes')?.value?.trim();
        if (!code || !name) { alert('الكود والاسم مطلوبان'); return; }
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';
        const payload = { store_code: code, store_name: name, store_type: type, status, notes };
        const method = id ? window.API.updateStore(id, payload) : window.API.createStore(payload);
        method.then(r => {
            if (r.success) {
                alert(r.message || (id ? 'تم التعديل' : 'تم الإضافة'));
                document.getElementById('modal-store-form').classList.remove('open');
                if (window.TradeProViews) window.TradeProViews.reload('view-stores-management');
            } else {
                alert(r.message || 'حدث خطأ');
            }
        }).catch(e => alert('خطأ في الاتصال')).finally(() => {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> حفظ المخزن';
        });
    });

    // ============================================================
    // VIEW: SETTINGS - Enterprise Configuration Center
    // ============================================================
    viewHandlers['view-settings'] = async function () {
        const view = document.getElementById('view-settings');
        if (!view) return;

        function $(id) { return document.getElementById(id); }
        function qs(sel) { return view.querySelector(sel); }
        function qsa(sel) { return view.querySelectorAll(sel); }

        // ── Tab switching ──
        const tabs = qsa('.settings-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                qsa('.settings-panel').forEach(p => p.classList.remove('active'));
                const panel = document.getElementById('stab-' + tab.dataset.stab);
                if (panel) panel.classList.add('active');
                // Load data on tab switch
                if (tab.dataset.stab === 'users') loadUsers();
                if (tab.dataset.stab === 'reps') loadReps();
                if (tab.dataset.stab === 'health') loadHealth();
                if (tab.dataset.stab === 'backup') loadBackupHistory();
                if (tab.dataset.stab === 'license' && window.refreshLicenseSettings) refreshLicenseSettings();
                if (tab.dataset.stab === 'administration') loadAdminSection();
            });
        });

        // ── Helper: save section ──
        async function saveSection(prefix, ids, statusId) {
            const settings = {};
            ids.forEach(id => {
                const el = $(id);
                if (!el) return;
                const key = id.replace('set-', '');
                if (el.type === 'checkbox') settings[key] = el.checked ? '1' : '0';
                else settings[key] = el.value;
            });
            try {
                const token = localStorage.getItem('auth_token');
                const res = await fetch('/api/settings/bulk', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': token ? 'Bearer ' + token : '' },
                    body: JSON.stringify({ settings })
                });
                const data = await res.json();
                if (statusId) {
                    const st = $(statusId);
                    if (st) { st.textContent = data.success ? '✓ تم الحفظ' : '✗ خطأ'; st.style.color = data.success ? '#059669' : '#dc2626'; setTimeout(() => st.textContent = '', 3000); }
                }
            } catch (e) { console.error('Save error', e); }
        }

        // ── Company ──
        const companyIds = ['set-company_name', 'set-company_name_en', 'set-company_tax_no', 'set-company_cr_no',
            'set-company_phone', 'set-company_mobile', 'set-company_address', 'set-company_city',
            'set-company_country', 'set-company_email', 'set-company_website', 'set-company_postal_code'];
        $('btn-save-company')?.addEventListener('click', () => saveSection('company', companyIds, 'company-save-status'));

        // ── Logo upload ──
        $('btn-upload-logo')?.addEventListener('click', () => $('company-logo-input')?.click());
        $('company-logo-input')?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async (ev) => {
                const logo = ev.target.result;
                // Preview
                const preview = $('company-logo-preview');
                if (preview) preview.innerHTML = '<img src="' + logo + '" style="max-width:100%;max-height:100%;object-fit:contain">';
                // Save to backend
                try {
                    const token = localStorage.getItem('auth_token');
                    await fetch('/api/settings/logo', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': token ? 'Bearer ' + token : '' },
                        body: JSON.stringify({ logo })
                    });
                    $('btn-remove-logo').style.display = '';
                } catch (e) { console.error('Logo upload error', e); }
            };
            reader.readAsDataURL(file);
        });
        $('btn-remove-logo')?.addEventListener('click', async () => {
            try {
                const token = localStorage.getItem('auth_token');
                await fetch('/api/settings/logo', { method: 'DELETE', headers: { 'Authorization': token ? 'Bearer ' + token : '' } });
                $('company-logo-preview').innerHTML = '<i class="fa-solid fa-image" style="font-size:32px;color:#d1d5db;"></i>';
                $('btn-remove-logo').style.display = 'none';
            } catch (e) { console.error('Logo remove error', e); }
        });

        // ── Print ──
        const printIds = ['set-print_paper_size', 'set-print_orientation', 'set-print_margin_top', 'set-print_margin_bottom',
            'set-print_margin_right', 'set-print_margin_left', 'set-print_show_logo', 'set-print_show_footer',
            'set-print_show_vat', 'set-print_show_qr', 'set-print_colored'];
        $('btn-save-print')?.addEventListener('click', () => saveSection('print', printIds, 'print-save-status'));

        // ── System ──
        const sysIds = ['set-currency', 'set-currency_symbol', 'set-currency_position', 'set-decimal_places',
            'set-date_format', 'set-time_format', 'set-tax_percent', 'set-language', 'set-direction', 'set-fiscal_year'];
        $('btn-save-system')?.addEventListener('click', () => saveSection('system', sysIds, 'system-save-status'));

        // ── Security ──
        const secIds = ['set-security_min_password_length', 'set-security_session_timeout', 'set-security_max_login_attempts', 'set-security_password_expiry'];
        $('btn-save-security')?.addEventListener('click', () => saveSection('security', secIds, 'security-save-status'));

        // ── Email ──
        const emailIds = ['set-email_smtp_host', 'set-email_smtp_port', 'set-email_username', 'set-email_password',
            'set-email_sender_name', 'set-email_sender_email'];
        $('btn-save-email')?.addEventListener('click', () => saveSection('email', emailIds, 'email-save-status'));
        $('btn-test-email')?.addEventListener('click', () => {
            const st = $('email-test-result');
            if (st) { st.textContent = 'تم اختبار الإرسال بنجاح (محاكاة)'; st.style.color = '#059669'; }
        });

        // ── Users ──
        const permList = ['dashboard', 'executive-dashboard', 'cash-flow', 'aging', 'inventory-analytics', 'profitability', 'sales-invoices', 'sales-returns', 'customers', 'customers.create', 'customers.update',
            'customers.delete', 'customers.export', 'customers.block', 'customer-payments', 'purchase-invoices',
            'purchase-returns', 'suppliers-list', 'supplier-payments', 'inventory-list', 'inventory-transfers',
            'settings', 'reports', 'accounting', 'treasury', 'stores', 'reps', 'logs'];

        let usersData = [];
        async function loadUsers() {
            try {
                const token = localStorage.getItem('auth_token');
                const res = await fetch('/api/users', { headers: { 'Authorization': token ? 'Bearer ' + token : '' } });
                const d = await res.json();
                if (!d.success) return;
                usersData = d.data || [];
                const tbody = $('settings-users-tbody');
                if (!tbody) return;
                tbody.innerHTML = usersData.map(u => {
                    const isAdmin = u.role === 'admin';
                    return '<tr>' +
                        '<td><strong>' + (u.full_name || u.username || '-') + '</strong></td>' +
                        '<td>' + (u.username || '-') + '</td>' +
                        '<td>' + (isAdmin ? '<span class="badge-status paid">مدير</span>' : '<span class="badge-status pending">مستخدم</span>') + '</td>' +
                        '<td>' + (u.is_active == 1 ? '<span style="color:#059669">نشط</span>' : '<span style="color:#dc2626">غير نشط</span>') + '</td>' +
                        '<td>' + (u.created_at || '-') + '</td>' +
                        '<td class="actions-cell">' +
                            '<button class="icon-btn btn-edit" onclick="window.editSettingsUserPerms(' + u.id + ')"><i class="fa-solid fa-shield"></i></button> ' +
                            '<button class="icon-btn btn-edit" onclick="window.editSettingsUserPw(' + u.id + ')"><i class="fa-solid fa-key"></i></button> ' +
                            (isAdmin ? '' : '<button class="icon-btn btn-delete" onclick="window.deleteSettingsUser(' + u.id + ')"><i class="fa-solid fa-trash"></i></button>') +
                        '</td></tr>';
                }).join('');
            } catch (e) { console.error('loadUsers error', e); }
        }

        $('stab-btn-add-user')?.addEventListener('click', () => {
            document.getElementById('modal-settings-user-add').classList.add('open');
        });

        // Setup global functions for user management in settings
        window.editSettingsUserPerms = async function (id) {
            const u = usersData.find(x => x.id === id);
            if (!u) return;
            document.getElementById('sup-user-id').value = id;
            const container = document.getElementById('sup-perms-list');
            const perms = typeof u.permissions === 'string' ? JSON.parse(u.permissions || '[]') : (u.permissions || []);
            container.innerHTML = permList.map(p => {
                const checked = perms.includes(p);
                return '<label class="checkbox-label"><input type="checkbox" value="' + p + '" ' + (checked ? 'checked' : '') + '> ' + p + '</label>';
            }).join('');
            document.getElementById('modal-settings-user-perms').classList.add('open');
        };
        window.editSettingsUserPw = function (id) {
            document.getElementById('supw-user-id').value = id;
            document.getElementById('modal-settings-user-pw').classList.add('open');
        };
        window.deleteSettingsUser = async function (id) {
            if (!confirm('تأكيد حذف المستخدم؟')) return;
            try {
                const token = localStorage.getItem('auth_token');
                await fetch('/api/users/' + id, { method: 'DELETE', headers: { 'Authorization': token ? 'Bearer ' + token : '' } });
                loadUsers();
            } catch (e) { console.error('delete error', e); }
        };

        // Users form handlers
        document.getElementById('form-settings-user-add')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('sua-name').value;
            const email = document.getElementById('sua-email').value;
            const password = document.getElementById('sua-password').value;
            const role = document.getElementById('sua-role').value;
            try {
                const token = localStorage.getItem('auth_token');
                const res = await fetch('/api/users', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': token ? 'Bearer ' + token : '' },
                    body: JSON.stringify({ name, email, password, role, permissions: [] })
                });
                const d = await res.json();
                if (d.success) { document.getElementById('modal-settings-user-add').classList.remove('open'); loadUsers(); }
                else alert(d.message || 'خطأ');
            } catch (e) { alert('خطأ في الاتصال'); }
        });
        document.getElementById('form-settings-user-perms')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('sup-user-id').value;
            const checked = document.querySelectorAll('#sup-perms-list input:checked');
            const permissions = Array.from(checked).map(cb => cb.value);
            try {
                const token = localStorage.getItem('auth_token');
                await fetch('/api/users/' + id + '/permissions', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Authorization': token ? 'Bearer ' + token : '' },
                    body: JSON.stringify({ permissions })
                });
                document.getElementById('modal-settings-user-perms').classList.remove('open');
                loadUsers();
            } catch (e) { alert('خطأ'); }
        });
        document.getElementById('form-settings-user-pw')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('supw-user-id').value;
            const password = document.getElementById('supw-password').value;
            try {
                const token = localStorage.getItem('auth_token');
                await fetch('/api/users/' + id + '/password', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Authorization': token ? 'Bearer ' + token : '' },
                    body: JSON.stringify({ password })
                });
                document.getElementById('modal-settings-user-pw').classList.remove('open');
                alert('تم تغيير كلمة المرور');
            } catch (e) { alert('خطأ'); }
        });

        // ── Reps ──
        let repsData = [];
        let repFilters = { q: '', status: '', region: '', page: 1, limit: 10 };
        let repPagination = null;
        let repSearchTimer = null;

        async function loadReps() {
            try {
                const tbody = $('settings-reps-tbody');
                if (!tbody) return;
                tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#6b7280"><i class="fa-solid fa-spinner fa-spin"></i> جاري التحميل...</td></tr>';

                // Populate region filter from full data on first load
                const regionSel = $('rep-region-filter');
                if (regionSel && !regionSel.dataset.populated) {
                    const all = await window.API.getManageReps();
                    if (all.success) populateRegionFilter(all.data);
                }

                const params = {};
                if (repFilters.q) params.q = repFilters.q;
                if (repFilters.status) params.status = repFilters.status;
                if (repFilters.region) params.region = repFilters.region;
                params.page = repFilters.page;
                params.limit = repFilters.limit;

                const d = await window.API.getManageReps(params);
                if (!d.success) return;
                repsData = d.data || [];
                repPagination = d.pagination || null;

                if (repsData.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#6b7280">لا توجد نتائج</td></tr>';
                } else {
                    tbody.innerHTML = repsData.map((r, i) => {
                        const idx = repPagination ? (repPagination.page - 1) * repPagination.limit + i + 1 : i + 1;
                        return '<tr>' +
                            '<td>' + idx + '</td>' +
                            '<td>' + (r.rep_code || '-') + '</td>' +
                            '<td><strong>' + (r.rep_name || '-') + '</strong></td>' +
                            '<td>' + (r.phone || '-') + '</td>' +
                            '<td>' + (r.region || '-') + '</td>' +
                            '<td>' + (r.commission_rate != null ? r.commission_rate : '0') + '</td>' +
                            '<td>' + (r.is_active == 1 ? '<span style="color:#059669">نشط</span>' : '<span style="color:#dc2626">غير نشط</span>') + '</td>' +
                            '<td class="actions-cell">' +
                                '<button class="icon-btn btn-edit" onclick="window.editSettingsRep(' + r.id + ')"><i class="fa-solid fa-pen"></i></button> ' +
                                '<button class="icon-btn ' + (r.is_active == 1 ? 'btn-delete' : 'btn-edit') + '" onclick="window.toggleSettingsRep(' + r.id + ')"><i class="fa-solid fa-' + (r.is_active == 1 ? 'ban' : 'check') + '"></i></button>' +
                            '</td></tr>';
                    }).join('');
                }

                renderRepPagination();
            } catch (e) { console.error('loadReps error', e); }
        }

        function renderRepPagination() {
            const el = $('rep-pagination');
            if (!el) return;
            if (!repPagination || repPagination.pages <= 1) {
                el.style.display = 'none';
                return;
            }
            el.style.display = 'flex';
            $('rep-page-info').textContent = 'الصفحة ' + repPagination.page + ' من ' + repPagination.pages;
            $('rep-page-prev').disabled = repPagination.page <= 1;
            $('rep-page-next').disabled = repPagination.page >= repPagination.pages;
        }

        function populateRegionFilter(data) {
            const sel = $('rep-region-filter');
            if (!sel || sel.dataset.populated) return;
            const regions = [...new Set(data.map(r => r.region).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
            regions.forEach(r => {
                const opt = document.createElement('option');
                opt.value = r; opt.textContent = r;
                sel.appendChild(opt);
            });
            sel.dataset.populated = '1';
            if (!sel.dataset.searchable) {
                sel.dataset.searchable = '1';
                window.makeSearchableSelect(sel, Array.from(sel.options).filter(o => o.value).map(o => ({id: o.value, name: o.textContent})), 'ابحث عن منطقة...');
            }
        }

        // Rep search/filter event listeners
        $('rep-search')?.addEventListener('input', function () {
            clearTimeout(repSearchTimer);
            repSearchTimer = setTimeout(() => {
                repFilters.q = this.value;
                repFilters.page = 1;
                loadReps();
            }, 400);
        });

        $('rep-status-filter')?.addEventListener('change', function () {
            repFilters.status = this.value;
            repFilters.page = 1;
            loadReps();
        });

        $('rep-region-filter')?.addEventListener('change', function () {
            repFilters.region = this.value;
            repFilters.page = 1;
            loadReps();
        });

        $('rep-page-prev')?.addEventListener('click', () => {
            if (repPagination && repPagination.page > 1) {
                repFilters.page = repPagination.page - 1;
                loadReps();
            }
        });

        $('rep-page-next')?.addEventListener('click', () => {
            if (repPagination && repPagination.page < repPagination.pages) {
                repFilters.page = repPagination.page + 1;
                loadReps();
            }
        });

        $('stab-btn-add-rep')?.addEventListener('click', () => {
            document.getElementById('sra-id').value = '';
            document.getElementById('sra-code').value = '';
            document.getElementById('sra-name').value = '';
            document.getElementById('sra-phone').value = '';
            document.getElementById('sra-region').value = '';
            document.getElementById('sra-target').value = '0';
            document.getElementById('sra-commission').value = '0';
            document.getElementById('sra-notes').value = '';
            document.getElementById('sra-status-group').style.display = 'none';
            document.getElementById('modal-rep-title').textContent = 'إضافة مندوب جديد';
            document.getElementById('modal-settings-rep-add').classList.add('open');
        });

        window.editSettingsRep = function (id) {
            const r = repsData.find(x => x.id === id);
            if (!r) return;
            document.getElementById('sra-id').value = id;
            document.getElementById('sra-code').value = r.rep_code || '';
            document.getElementById('sra-name').value = r.rep_name || '';
            document.getElementById('sra-phone').value = r.phone || '';
            document.getElementById('sra-region').value = r.region || '';
            document.getElementById('sra-target').value = r.target_amount || 0;
            document.getElementById('sra-commission').value = r.commission_rate || 0;
            document.getElementById('sra-notes').value = r.notes || '';
            document.getElementById('sra-status').value = r.is_active == 1 ? '1' : '0';
            document.getElementById('sra-status-group').style.display = '';
            document.getElementById('modal-rep-title').textContent = 'تعديل المندوب';
            document.getElementById('modal-settings-rep-add').classList.add('open');
        };

        window.toggleSettingsRep = async function (id) {
            const r = repsData.find(x => x.id === id);
            const isActive = r && r.is_active == 1;
            const msg = isActive ? 'سيتم إلغاء تنشيط هذا المندوب ولن يظهر في القوائم.' : 'سيتم تفعيل هذا المندوب وظهوره في القوائم.';
            const confirmed = await window.showConfirm(msg, { title: isActive ? 'إلغاء تنشيط مندوب' : 'تفعيل مندوب', type: 'warning' });
            if (!confirmed) return;
            try {
                await window.API.toggleRep(id);
                loadReps();
            } catch (e) { console.error('toggle error', e); }
        };

        document.getElementById('form-settings-rep-add')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('sra-id').value;
            const data = {
                rep_code: document.getElementById('sra-code').value || undefined,
                rep_name: document.getElementById('sra-name').value,
                phone: document.getElementById('sra-phone').value || null,
                region: document.getElementById('sra-region').value || null,
                target_amount: parseFloat(document.getElementById('sra-target').value) || 0,
                commission_rate: parseFloat(document.getElementById('sra-commission').value) || 0,
                notes: document.getElementById('sra-notes').value || null
            };
            if (id) {
                data.is_active = parseInt(document.getElementById('sra-status').value);
            }
            try {
                let d;
                if (id) {
                    d = await window.API.updateRep(id, data);
                } else {
                    d = await window.API.createRep(data);
                }
                if (d.success) {
                    document.getElementById('modal-settings-rep-add').classList.remove('open');
                    document.getElementById('sra-id').value = '';
                    loadReps();
                    showAlert(id ? 'تم تعديل بيانات المندوب بنجاح' : 'تم إضافة المندوب بنجاح', { title: 'تمت العملية', type: 'success', infoText: false });
                } else {
                    showAlert(d.message || 'خطأ', { title: 'خطأ', type: 'danger', infoText: false });
                }
            } catch (e) { alert('خطأ في الاتصال'); }
        });

        // ── Backup ──
        async function loadBackupHistory() {
            try {
                const token = localStorage.getItem('auth_token');
                const res = await fetch('/api/settings/backup', { headers: { 'Authorization': token ? 'Bearer ' + token : '' } });
                const d = await res.json();
                if (!d.success) return;
                const tbody = document.getElementById('backup-history-tbody');
                if (!tbody) return;
                const hist = d.history || [];
                tbody.innerHTML = hist.length ? hist.map((b, i) => '<tr><td>' + (i+1) + '</td><td>' + (b.file_path || '-').split('\\').pop() + '</td><td>' + (b.file_size ? Math.round(b.file_size/1024) + ' KB' : '-') + '</td><td><span style="color:#059669">' + (b.status || '-') + '</span></td><td>' + (b.created_at || '-') + '</td></tr>').join('') : '<tr><td colspan="5" style="text-align:center;padding:20px;color:#9ca3af;">لم يتم عمل أي نسخة احتياطية بعد</td></tr>';
            } catch (e) { console.error('backup error', e); }
        }

        $('btn-run-backup')?.addEventListener('click', async () => {
            const btn = $('btn-run-backup');
            const status = $('backup-status');
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري...'; }
            if (status) status.innerHTML = '<div style="padding:10px;background:#fef3c7;border-radius:6px;color:#92400e;">جاري إنشاء النسخة الاحتياطية...</div>';
            try {
                const token = localStorage.getItem('auth_token');
                const res = await fetch('/api/settings/backup/run', { method: 'POST', headers: { 'Authorization': token ? 'Bearer ' + token : '' } });
                const d = await res.json();
                if (status) status.innerHTML = d.success ? '<div style="padding:10px;background:#d1fae5;border-radius:6px;color:#065f46;">' + d.message + '</div>' : '<div style="padding:10px;background:#fee2e2;border-radius:6px;color:#991b1b;">' + d.message + '</div>';
                loadBackupHistory();
            } catch (e) { if (status) status.innerHTML = '<div style="padding:10px;background:#fee2e2;border-radius:6px;color:#991b1b;">خطأ في الاتصال بالخادم</div>'; }
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-database"></i> إنشاء نسخة احتياطية'; }
        });

        // ── Health ──
        async function loadHealth() {
            const container = document.getElementById('health-data');
            if (!container) return;
            container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:#9ca3af;"><i class="fa-solid fa-spinner fa-spin"></i> جاري التحميل...</div>';
            try {
                const token = localStorage.getItem('auth_token');
                const res = await fetch('/api/settings/health', { headers: { 'Authorization': token ? 'Bearer ' + token : '' } });
                const d = await res.json();
                if (!d.success || !d.data) { container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:#dc2626;">خطأ في تحميل البيانات</div>'; return; }
                const h = d.data;
                const cards = [
                    { label: 'حالة قاعدة البيانات', value: h.database?.status || '-', sub: 'الحجم: ' + (h.database?.size || '-'), status: h.database?.status === 'Connected' ? 'online' : 'offline' },
                    { label: 'مدة التشغيل', value: Math.floor((h.server?.uptime || 0) / 3600) + ' ساعة', sub: 'Node ' + (h.server?.node || '-') },
                    { label: 'إصدار النظام', value: h.app?.version || '-', sub: h.app?.name || '' },
                    { label: 'المنصة', value: h.server?.platform || '-', sub: '' },
                    { label: 'الذاكرة المتاحة', value: h.storage?.memory || '-', sub: '' },
                    { label: 'الإعدادات', value: h.storage?.settings || 0 + ' إعداد', sub: h.storage?.users || 0 + ' مستخدم' },
                ];
                container.innerHTML = cards.map(c => '<div class="health-card"><h4>' + c.label + '</h4><div class="health-value">' + c.value + '</div>' + (c.sub ? '<div class="health-status ' + (c.status || '') + '">' + c.sub + '</div>' : '') + '</div>').join('');
            } catch (e) { container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:#dc2626;">خطأ في الاتصال</div>'; }
        }

        // ── Admin ──
        let _adminPendingAction = null;

        function generateDefaultBackupPath(label) {
            const now = new Date();
            const y = now.getFullYear();
            const m = String(now.getMonth() + 1).padStart(2, '0');
            const d = String(now.getDate()).padStart(2, '0');
            const ts = `${y}_${m}_${d}`;
            return `D:\\Backups\\ERP_${label}_${ts}.bak`;
        }

        function openBackupModal(title, message, action, actionLabel) {
            _adminPendingAction = action;
            document.getElementById('modal-admin-backup-title').innerHTML = '<i class="fa-solid fa-exclamation-triangle"></i> ' + title;
            document.getElementById('modal-admin-backup-message').textContent = message;
            document.getElementById('btn-admin-bak-label').textContent = actionLabel;
            document.getElementById('admin-bak-path').value = generateDefaultBackupPath(action === 'reset' ? 'Before_Reset' : action === 'year-close' ? 'Before_Year_Close' : 'Manual');
            document.getElementById('admin-bak-error').style.display = 'none';
            const pwInp = document.getElementById('admin-bak-pw');
            if (pwInp) pwInp.value = '';
            const confirmBtn = document.getElementById('btn-admin-bak-confirm');
            if (confirmBtn) confirmBtn.disabled = true;
            openModal('modal-admin-backup');
        }

        $('btn-system-reset')?.addEventListener('click', () => {
            openBackupModal(
                'تحذير: إعادة تهيئة النظام',
                'سيتم حذف جميع البيانات الحرجة (الفواتير، المرتجعات، القيود المحاسبية، الإيصالات) مع الاحتفاظ بالبيانات الأساسية (العملاء، الموردين، المنتجات). قبل المتابعة يجب إنشاء نسخة احتياطية. لا يمكن التراجع عن هذه العملية.',
                'reset',
                'إنشاء نسخة احتياطية ثم حذف البيانات'
            );
        });

        $('btn-year-close')?.addEventListener('click', () => {
            openBackupModal(
                'تحذير: إقفال السنة المالية',
                'سيتم ترحيل الأرصدة الافتتاحية للعملاء والموردين والخزينة والمخازن، وإغلاق السنة المالية الحالية، وحذف البيانات الحرجة، وبدء ترقيم جديد. قبل المتابعة يجب إنشاء نسخة احتياطية. لا يمكن التراجع عن هذه العملية.',
                'year-close',
                'إنشاء نسخة احتياطية ثم إقفال السنة'
            );
        });

        $('btn-manual-backup')?.addEventListener('click', () => {
            openBackupModal(
                'إنشاء نسخة احتياطية',
                'سيتم إنشاء نسخة احتياطية كاملة (SQL Backup .bak) من قاعدة البيانات إلى المسار الذي تحدده.',
                'manual',
                'إنشاء النسخة الاحتياطية'
            );
        });

        $('btn-restore-backup')?.addEventListener('click', () => {
            document.getElementById('admin-restore-path').value = '';
            document.getElementById('admin-restore-pw').value = '';
            document.getElementById('admin-restore-error').style.display = 'none';
            document.getElementById('btn-admin-restore-confirm').disabled = true;
            openModal('modal-admin-restore');
        });

        $('btn-admin-integrity')?.addEventListener('click', async () => {
            const resultDiv = document.getElementById('admin-integrity-result');
            if (!resultDiv) return;
            resultDiv.innerHTML = '<div style="text-align:center;padding:12px;color:#9ca3af;"><i class="fa-solid fa-spinner fa-spin"></i> جاري فحص النظام...</div>';
            try {
                const token = localStorage.getItem('auth_token');
                const res = await fetch('/api/admin/integrity', { headers: { 'Authorization': token ? 'Bearer ' + token : '' } });
                const d = await res.json();
                if (!d.success) { resultDiv.innerHTML = '<div style="color:#dc2626;">خطأ في الفحص</div>'; return; }
                const h = d.data;
                const items = [
                    { label: 'توازن القيود', ok: h.journalBalance },
                    { label: 'أرصدة العملاء', ok: h.customersBalanced },
                    { label: 'أرصدة الموردين', ok: h.suppliersBalanced },
                    { label: 'أرصدة الخزينة', ok: h.treasuryBalanced },
                    { label: 'ميزان المراجعة', ok: h.trialBalanceBalanced }
                ];
                const allOk = h.allPassed;
                resultDiv.innerHTML = '<div style="padding:12px;border-radius:6px;background:' + (allOk ? 'var(--success-bg,#d1fae5)' : 'var(--danger-bg,#fee2e2)') + ';color:' + (allOk ? 'var(--success-color,#059669)' : 'var(--danger-color,#dc2626)') + ';font-size:13px;">' +
                    items.map(i => '<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(0,0,0,0.05);">' +
                        '<span>' + i.label + '</span>' +
                        '<span>' + (i.ok ? '<i class="fa-solid fa-check-circle" style="color:#059669"></i>' : '<i class="fa-solid fa-times-circle" style="color:#dc2626"></i>') + '</span>' +
                        '</div>').join('') +
                    '<div style="margin-top:8px;font-weight:bold;text-align:center;">' + (allOk ? 'جميع الفحوصات سليمة ✓' : 'يوجد اختلال في بعض الأرصدة') + '</div></div>';
            } catch (e) {
                resultDiv.innerHTML = '<div style="color:#dc2626;">خطأ في الاتصال بالخادم</div>';
            }
        });

        // ── Browse button (showSaveFilePicker API or fallback) ──
        $('btn-admin-bak-browse')?.addEventListener('click', async () => {
            const pathInput = document.getElementById('admin-bak-path');
            if (!pathInput) return;
            if (window.showSaveFilePicker) {
                try {
                    const handle = await window.showSaveFilePicker({
                        suggestedName: pathInput.value.split('\\').pop() || 'ERP_Backup.bak',
                        types: [{ description: 'SQL Server Backup', accept: { 'application/octet-stream': ['.bak'] } }]
                    });
                    // showSaveFilePicker doesn't give us the full server path, but we keep the filename
                    const fileName = handle.name || pathInput.value.split('\\').pop();
                    const serverDir = pathInput.value.substring(0, pathInput.value.lastIndexOf('\\'));
                    pathInput.value = serverDir ? serverDir + '\\' + fileName : fileName;
                } catch (e) {
                    if (e.name !== 'AbortError') console.warn('Save picker error:', e);
                }
            } else {
                // Fallback: just focus the input for manual typing
                pathInput.focus();
                pathInput.select();
            }
        });

        // ── Backup modal input validation ──
        const bakPw = $('admin-bak-pw');
        const bakPath = $('admin-bak-path');
        const bakConfirm = $('btn-admin-bak-confirm');
        const bakError = $('admin-bak-error');

        function validateBackupForm() {
            if (bakConfirm) bakConfirm.disabled = !(bakPw?.value?.trim() && bakPath?.value?.trim());
            if (bakError) bakError.style.display = 'none';
        }

        if (bakPw) {
            bakPw.addEventListener('input', validateBackupForm);
            bakPw.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && bakConfirm && !bakConfirm.disabled) bakConfirm.click();
            });
        }
        if (bakPath) {
            bakPath.addEventListener('input', validateBackupForm);
        }

        if (bakConfirm) {
            bakConfirm.addEventListener('click', async () => {
                const password = bakPw?.value?.trim();
                const backupPath = bakPath?.value?.trim();
                if (!password || !backupPath) return;

                bakConfirm.disabled = true;
                bakConfirm.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري إنشاء النسخة الاحتياطية...';
                if (bakError) bakError.style.display = 'none';

                const statusDiv = document.getElementById('admin-status');
                const action = _adminPendingAction;

                try {
                    const token = localStorage.getItem('auth_token');

                    // First verify password
                    const vRes = await fetch('/api/admin/verify-password', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': token ? 'Bearer ' + token : '' },
                        body: JSON.stringify({ password })
                    });
                    const v = await vRes.json();
                    if (!v.success) {
                        if (bakError) { bakError.textContent = v.message || 'كلمة المرور غير صحيحة'; bakError.style.display = 'block'; }
                        bakConfirm.disabled = false;
                        bakConfirm.innerHTML = '<i class="fa-solid fa-shield"></i> ' + document.getElementById('btn-admin-bak-label')?.textContent;
                        return;
                    }

                    closeModal('modal-admin-backup');

                    // Execute action
                    if (action === 'reset') {
                        if (statusDiv) statusDiv.innerHTML = '<div style="padding:12px;border-radius:6px;background:#dbeafe;color:#1e40af;font-size:13px;"><i class="fa-solid fa-spinner fa-spin"></i> جاري إنشاء النسخة الاحتياطية وحذف البيانات...</div>';
                        const res = await fetch('/api/admin/reset', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': token ? 'Bearer ' + token : '' },
                            body: JSON.stringify({ password, backupPath })
                        });
                        const d = await res.json();
                        if (d.success) {
                            if (statusDiv) statusDiv.innerHTML = '<div style="padding:12px;border-radius:6px;background:#d1fae5;color:#059669;font-size:13px;"><i class="fa-solid fa-check-circle"></i> ' + d.message + ' (النسخة: ' + (d.backup?.name || '') + ')</div>';
                            if (typeof showAlert === 'function') showAlert(d.message, { type: 'success', title: 'إعادة تهيئة' });
                        } else {
                            if (statusDiv) statusDiv.innerHTML = '<div style="padding:12px;border-radius:6px;background:#fee2e2;color:#dc2626;font-size:13px;"><i class="fa-solid fa-times-circle"></i> ' + (d.message || 'فشلت العملية') + '</div>';
                            if (typeof showAlert === 'function') showAlert(d.message || 'فشلت العملية', { type: 'danger', title: 'خطأ' });
                        }
                    } else if (action === 'year-close') {
                        if (statusDiv) statusDiv.innerHTML = '<div style="padding:12px;border-radius:6px;background:#dbeafe;color:#1e40af;font-size:13px;"><i class="fa-solid fa-spinner fa-spin"></i> جاري إنشاء النسخة الاحتياطية وترحيل الأرصدة...</div>';
                        const res = await fetch('/api/admin/year-close', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': token ? 'Bearer ' + token : '' },
                            body: JSON.stringify({ password, backupPath })
                        });
                        const d = await res.json();
                        if (d.success) {
                            let msg = d.message;
                            if (d.warning) msg += ' (تحذير: يوجد اختلال في الأرصدة)';
                            if (statusDiv) statusDiv.innerHTML = '<div style="padding:12px;border-radius:6px;background:' + (d.warning ? '#fef3c7;color:#92400e' : '#d1fae5;color:#059669') + ';font-size:13px;"><i class="fa-solid fa-' + (d.warning ? 'exclamation-triangle' : 'check-circle') + '"></i> ' + msg + '</div>';
                            if (typeof showAlert === 'function') showAlert(msg, { type: d.warning ? 'warning' : 'success', title: 'إقفال السنة' });
                        } else {
                            if (statusDiv) statusDiv.innerHTML = '<div style="padding:12px;border-radius:6px;background:#fee2e2;color:#dc2626;font-size:13px;"><i class="fa-solid fa-times-circle"></i> ' + (d.message || 'فشلت العملية') + '</div>';
                            if (typeof showAlert === 'function') showAlert(d.message || 'فشلت العملية', { type: 'danger', title: 'خطأ' });
                        }
                    } else if (action === 'manual') {
                        if (statusDiv) statusDiv.innerHTML = '<div style="padding:12px;border-radius:6px;background:#dbeafe;color:#1e40af;font-size:13px;"><i class="fa-solid fa-spinner fa-spin"></i> جاري إنشاء النسخة الاحتياطية...</div>';
                        const res = await fetch('/api/admin/manual-backup', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': token ? 'Bearer ' + token : '' },
                            body: JSON.stringify({ password, backupPath })
                        });
                        const d = await res.json();
                        if (d.success) {
                            if (statusDiv) statusDiv.innerHTML = '<div style="padding:12px;border-radius:6px;background:#d1fae5;color:#059669;font-size:13px;"><i class="fa-solid fa-check-circle"></i> ' + d.message + ' (الملف: ' + (d.backup?.name || '') + ' - ' + formatFileSize(d.backup?.size || 0) + ')</div>';
                            if (typeof showAlert === 'function') showAlert(d.message + ' (الملف: ' + d.backup?.name + ')', { type: 'success', title: 'نسخة احتياطية' });
                        } else {
                            if (statusDiv) statusDiv.innerHTML = '<div style="padding:12px;border-radius:6px;background:#fee2e2;color:#dc2626;font-size:13px;"><i class="fa-solid fa-times-circle"></i> ' + (d.message || 'فشلت العملية') + '</div>';
                            if (typeof showAlert === 'function') showAlert(d.message || 'فشلت العملية', { type: 'danger', title: 'خطأ' });
                        }
                    }
                } catch (e) {
                    if (statusDiv) statusDiv.innerHTML = '<div style="padding:12px;border-radius:6px;background:#fee2e2;color:#dc2626;font-size:13px;"><i class="fa-solid fa-times-circle"></i> خطأ في الاتصال</div>';
                } finally {
                    bakConfirm.disabled = false;
                    bakConfirm.innerHTML = '<i class="fa-solid fa-shield"></i> ' + (document.getElementById('btn-admin-bak-label')?.textContent || 'تأكيد');
                    if (bakPw) bakPw.value = '';
                }
            });
        }

        // ── Restore modal: browse (showOpenFilePicker or fallback) ──
        $('btn-admin-restore-browse')?.addEventListener('click', async () => {
            const pathInput = document.getElementById('admin-restore-path');
            if (!pathInput) return;
            if (window.showOpenFilePicker) {
                try {
                    const [handle] = await window.showOpenFilePicker({
                        types: [{ description: 'SQL Server Backup', accept: { 'application/octet-stream': ['.bak'] } }]
                    });
                    // showOpenFilePicker doesn't give the full server path, keep the filename
                    const fileName = handle.name || '';
                    const currentDir = pathInput.value.substring(0, pathInput.value.lastIndexOf('\\'));
                    pathInput.value = currentDir ? currentDir + '\\' + fileName : fileName;
                    validateRestoreForm();
                } catch (e) {
                    if (e.name !== 'AbortError') console.warn('Open picker error:', e);
                }
            } else {
                pathInput.focus();
                pathInput.select();
            }
        });

        // ── Restore modal validation ──
        const rstPath = document.getElementById('admin-restore-path');
        const rstPw = document.getElementById('admin-restore-pw');
        const rstConfirm = document.getElementById('btn-admin-restore-confirm');
        const rstError = document.getElementById('admin-restore-error');

        function validateRestoreForm() {
            if (rstConfirm) rstConfirm.disabled = !(rstPw?.value?.trim() && rstPath?.value?.trim());
            if (rstError) rstError.style.display = 'none';
        }

        if (rstPw) {
            rstPw.addEventListener('input', validateRestoreForm);
            rstPw.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && rstConfirm && !rstConfirm.disabled) rstConfirm.click();
            });
        }
        if (rstPath) {
            rstPath.addEventListener('input', validateRestoreForm);
        }

        // ── Restore confirm ──
        if (rstConfirm) {
            rstConfirm.addEventListener('click', async () => {
                const backupFile = rstPath?.value?.trim();
                const password = rstPw?.value?.trim();
                if (!backupFile || !password) return;

                rstConfirm.disabled = true;
                rstConfirm.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري استرجاع النسخة...';
                if (rstError) rstError.style.display = 'none';

                const statusDiv = document.getElementById('admin-status');
                closeModal('modal-admin-restore');
                if (statusDiv) statusDiv.innerHTML = '<div style="padding:12px;border-radius:6px;background:#dbeafe;color:#1e40af;font-size:13px;"><i class="fa-solid fa-spinner fa-spin"></i> جاري استرجاع النسخة الاحتياطية...</div>';

                try {
                    const token = localStorage.getItem('auth_token');
                    const res = await fetch('/api/admin/restore', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': token ? 'Bearer ' + token : '' },
                        body: JSON.stringify({ password, backupFile })
                    });
                    const d = await res.json();
                    if (d.success) {
                        if (statusDiv) statusDiv.innerHTML = '<div style="padding:12px;border-radius:6px;background:#d1fae5;color:#059669;font-size:13px;"><i class="fa-solid fa-check-circle"></i> ' + d.message + '</div>';
                        if (typeof showAlert === 'function') showAlert(d.message, { type: 'success', title: 'استرجاع' });
                        setTimeout(() => { window.location.reload(); }, 2000);
                    } else {
                        if (statusDiv) statusDiv.innerHTML = '<div style="padding:12px;border-radius:6px;background:#fee2e2;color:#dc2626;font-size:13px;"><i class="fa-solid fa-times-circle"></i> ' + (d.message || 'فشلت العملية') + '</div>';
                        if (rstError) { rstError.textContent = d.message || 'فشلت العملية'; rstError.style.display = 'block'; }
                    }
                } catch (e) {
                    if (statusDiv) statusDiv.innerHTML = '<div style="padding:12px;border-radius:6px;background:#fee2e2;color:#dc2626;font-size:13px;"><i class="fa-solid fa-times-circle"></i> خطأ في الاتصال</div>';
                } finally {
                    rstConfirm.disabled = false;
                    rstConfirm.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> استرجاع النسخة';
                    if (rstPw) rstPw.value = '';
                }
            });
        }

        function openModal(id) {
            const el = document.getElementById(id);
            if (el) el.classList.add('open');
        }

        function closeModal(id) {
            const el = document.getElementById(id);
            if (el) el.classList.remove('open');
            // Clear backup modal fields if modal-admin-backup is being closed
            if (id === 'modal-admin-backup') {
                const pwInp = document.getElementById('admin-bak-pw');
                if (pwInp) pwInp.value = '';
                const errDiv = document.getElementById('admin-bak-error');
                if (errDiv) errDiv.style.display = 'none';
                const confirmBtn = document.getElementById('btn-admin-bak-confirm');
                if (confirmBtn) confirmBtn.disabled = true;
            }
            // Clear restore modal fields if modal-admin-restore is being closed
            if (id === 'modal-admin-restore') {
                const rstPw = document.getElementById('admin-restore-pw');
                if (rstPw) rstPw.value = '';
                const rstErr = document.getElementById('admin-restore-error');
                if (rstErr) rstErr.style.display = 'none';
                const rstConfirm = document.getElementById('btn-admin-restore-confirm');
                if (rstConfirm) rstConfirm.disabled = true;
            }
            // Legacy cleanups
            const oldPw = document.getElementById('admin-pw-input');
            if (oldPw) oldPw.value = '';
            const oldErr = document.getElementById('admin-pw-error');
            if (oldErr) oldErr.style.display = 'none';
        }

        function formatFileSize(bytes) {
            if (!bytes || bytes === 0) return '0 B';
            const units = ['B', 'KB', 'MB', 'GB'];
            const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
            return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
        }

        async function loadAdminSection() {
            // No backup list needed - restore uses direct file picker
        }

        // ── Load settings data into form ──
        async function loadSettings() {
            try {
                const token = localStorage.getItem('auth_token');
                const res = await fetch('/api/settings', { headers: { 'Authorization': token ? 'Bearer ' + token : '' } });
                const d = await res.json();
                if (!d.success || !d.data) return;
                const all = d.data;
                for (const [key, value] of Object.entries(all)) {
                    const el = document.getElementById('set-' + key);
                    if (!el) continue;
                    if (el.type === 'checkbox') el.checked = value === '1' || value === 'true';
                    else el.value = value || '';
                }
                // Logo
                if (all.company_logo) {
                    const preview = document.getElementById('company-logo-preview');
                    if (preview) preview.innerHTML = '<img src="' + all.company_logo + '" style="max-width:100%;max-height:100%;object-fit:contain">';
                    const removeBtn = document.getElementById('btn-remove-logo');
                    if (removeBtn) removeBtn.style.display = '';
                }
            } catch (e) { console.error('loadSettings error', e); }
        }

        await loadSettings();
    };

    // ============================================================
    // VIEW: INVENTORY REPORTS
    // ============================================================
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
