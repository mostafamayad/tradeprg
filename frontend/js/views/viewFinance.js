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
