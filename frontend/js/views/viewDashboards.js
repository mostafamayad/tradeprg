(function() {
    'use strict';
    window.viewHandlers = window.viewHandlers || {};
    const viewHandlers = window.viewHandlers;

    const req = (...args) => window.req(...args);
    const fmt = (...args) => window.fmt(...args);
    const fmtPlain = (...args) => window.fmtPlain(...args);
    const fmtInt = (...args) => window.fmtInt(...args);
    const esc = (...args) => window.esc(...args);

    let execChartInstance = null;

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

})();
