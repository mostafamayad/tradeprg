(function() {
    'use strict';
    window.viewHandlers = window.viewHandlers || {};
    const viewHandlers = window.viewHandlers;

    const req = (...args) => window.req(...args);
    const fmt = (...args) => window.fmt(...args);
    const fmtPlain = (...args) => window.fmtPlain(...args);
    const fmtInt = (...args) => window.fmtInt(...args);
    const esc = (...args) => window.esc(...args);

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
                <td>${window.fmt ? window.fmt(d.total_qty) : d.total_qty}</td>
                <td class="text-danger"><strong>${window.fmt ? window.fmt(d.total_value) : d.total_value} ج.م</strong></td>
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

    viewHandlers['view-stock-count'] = async function () {
        const tbody = document.getElementById('stock-count-tbody');
        const btnNew = document.getElementById('btn-new-count');
        
        if (btnNew && !btnNew.dataset.bound) {
            btnNew.dataset.bound = '1';
            btnNew.addEventListener('click', async () => {
                if (!window.AppData || !window.AppData.stores || window.AppData.stores.length === 0) {
                    return alert('لا توجد مخازن متاحة');
                }
                const modal = document.getElementById('modal-new-count');
                const select = document.getElementById('new-count-store-select');
                const confirmBtn = document.getElementById('btn-confirm-new-count');
                
                select.innerHTML = '<option value="">-- اختر المخزن --</option>';
                window.AppData.stores.forEach(s => {
                    const opt = document.createElement('option');
                    opt.value = s.id;
                    opt.textContent = s.store_name;
                    select.appendChild(opt);
                });
                
                modal.classList.add('open');
                
                confirmBtn.onclick = async () => {
                    const sid = select.value;
                    if (!sid) return alert('الرجاء اختيار المخزن');
                    
                    confirmBtn.disabled = true;
                    confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري البدء...';
                    
                    const r = await req('/inventory/count/start', 'POST', { store_id: sid });
                    
                    confirmBtn.disabled = false;
                    confirmBtn.innerHTML = 'بدء الجرد';
                    
                    if (r.success) {
                        modal.classList.remove('open');
                        viewHandlers['view-stock-count']();
                    } else {
                        alert('خطأ: ' + (r.message || ''));
                    }
                };
            });
        }
        
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
                <td>${window.fmtInt ? window.fmtInt(c.items_count || 0) : (c.items_count || 0)}</td>
                <td>${window.fmt ? window.fmt(c.total_difference || 0) : (c.total_difference || 0)}</td>
                <td><span class="badge-status ${c.status === 'completed' ? 'paid' : 'pending'}">${c.status === 'completed' ? 'مغلق' : c.status === 'in_progress' ? 'جاري' : c.status}</span></td>
                <td class="actions-cell"><button class="icon-btn btn-view" onclick="window.openCountDetail(${c.id})"><i class="fa-solid fa-eye"></i></button></td>`;
            tbody.appendChild(tr);
        });
    };

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

        if (!storeSel.dataset.loaded && window.AppData && window.AppData.stores) {
            storeSel.dataset.loaded = '1';
            storeSel.innerHTML = '<option value="">-- اختر المخزن --</option>';
            window.AppData.stores.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.id;
                opt.textContent = s.store_name;
                storeSel.appendChild(opt);
            });
            if (window.makeSearchableSelect) {
                window.makeSearchableSelect(storeSel, window.AppData.stores.map(s => ({id: s.id, name: s.store_name})), 'ابحث عن مخزن...');
            }
        }

        if (!productSel.dataset.loaded && window.AppData && window.AppData.products) {
            productSel.dataset.loaded = '1';
            productSel.innerHTML = '<option value="">-- اختر الصنف --</option>';
            window.AppData.products.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = `${p.product_code || p.id} - ${p.product_name}`;
                productSel.appendChild(opt);
            });
            if (window.makeSearchableSelect) {
                window.makeSearchableSelect(productSel, window.AppData.products.map(p => ({id: p.id, name: `${p.product_code || p.id} - ${p.product_name}`})), 'ابحث عن صنف...');
            }
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


    let currentCountId = null;
    let countItemsData = [];

    window.openCountDetail = async function(id) {
        currentCountId = id;
        const r = await req('/inventory/count/' + id);
        if (!r.success) return alert(r.message || 'خطأ في جلب التفاصيل');
        
        const count = r.count;
        countItemsData = r.items || [];
        
        document.getElementById('modal-detail-title').textContent = 'تفاصيل الجرد #' + count.count_no;
        document.getElementById('modal-detail-subtitle').textContent = 'المخزن: ' + (count.store_name || '') + ' | التاريخ: ' + (count.count_date || '');
        
        const tbody = document.getElementById('count-items-tbody');
        tbody.innerHTML = '';
        
        const isCompleted = count.status === 'completed';
        document.getElementById('btn-count-save-draft').style.display = isCompleted ? 'none' : 'block';
        document.getElementById('btn-count-complete').style.display = isCompleted ? 'none' : 'block';
        
        countItemsData.forEach((item, index) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${item.product_code || '-'}</td>
                <td>${item.product_name || '-'}</td>
                <td style="text-align:center; font-weight:bold;">${item.system_qty}</td>
                <td style="text-align:center;">
                    ${isCompleted ? 
                        `${item.counted_qty}` : 
                        `<input type="number" step="0.01" min="0" class="form-control text-center count-input" data-idx="${index}" value="${item.counted_qty}" style="width:100px; margin:0 auto; padding:4px;">`
                    }
                </td>
                <td style="text-align:center; font-weight:bold;" class="diff-cell" data-idx="${index}">
                    <span style="color: ${item.diff < 0 ? 'red' : (item.diff > 0 ? 'green' : 'inherit')}">
                        ${item.diff > 0 ? '+' : ''}${item.diff}
                    </span>
                </td>
            `;
            tbody.appendChild(tr);
        });
        
        updateTotalDiff();
        document.getElementById('modal-count-detail').classList.add('open');
    };

    // Use event delegation for input changes to calculate diff dynamically
    document.addEventListener('input', (e) => {
        if (e.target.classList.contains('count-input')) {
            const idx = e.target.dataset.idx;
            const item = countItemsData[idx];
            let val = parseFloat(e.target.value);
            if (isNaN(val) || val < 0) {
                val = 0;
            }
            item.counted_qty = val;
            item.diff = val - item.system_qty;
            
            const diffCell = document.querySelector(`.diff-cell[data-idx="${idx}"] span`);
            if (diffCell) {
                diffCell.textContent = (item.diff > 0 ? '+' : '') + item.diff;
                diffCell.style.color = item.diff < 0 ? 'red' : (item.diff > 0 ? 'green' : 'inherit');
            }
            updateTotalDiff();
        }
    });

    function updateTotalDiff() {
        let total = countItemsData.reduce((sum, item) => sum + Math.abs(item.diff), 0);
        document.getElementById('count-total-diff').textContent = total;
    }

    const btnSaveDraft = document.getElementById('btn-count-save-draft');
    if (btnSaveDraft && !btnSaveDraft.dataset.bound) {
        btnSaveDraft.dataset.bound = '1';
        btnSaveDraft.addEventListener('click', async () => {
            if (!currentCountId) return;
            btnSaveDraft.disabled = true;
            btnSaveDraft.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';
            
            const payload = { items: countItemsData.map(i => ({ product_id: i.product_id, counted_qty: i.counted_qty, diff: i.diff })) };
            const r = await req('/inventory/count/' + currentCountId + '/items', 'PUT', payload);
            
            btnSaveDraft.disabled = false;
            btnSaveDraft.textContent = 'حفظ كمسودة';
            
            if (r.success) {
                alert('تم حفظ الجرد بنجاح');
                if (viewHandlers['view-stock-count']) viewHandlers['view-stock-count']();
            } else {
                alert('خطأ: ' + (r.message || ''));
            }
        });
    }

    const btnComplete = document.getElementById('btn-count-complete');
    if (btnComplete && !btnComplete.dataset.bound) {
        btnComplete.dataset.bound = '1';
        btnComplete.addEventListener('click', async () => {
            if (!currentCountId) return;
            if (!confirm('هل أنت متأكد من اعتماد الجرد؟ ستتم تسوية الأرصدة وإغلاق الجرد ولن تتمكن من تعديله.')) return;
            
            btnComplete.disabled = true;
            btnComplete.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الاعتماد...';
            
            // Save first, then complete
            const payload = { items: countItemsData.map(i => ({ product_id: i.product_id, counted_qty: i.counted_qty, diff: i.diff })) };
            await req('/inventory/count/' + currentCountId + '/items', 'PUT', payload);
            
            const r = await req('/inventory/count/' + currentCountId + '/complete', 'POST');
            
            btnComplete.disabled = false;
            btnComplete.textContent = 'اعتماد وتسوية';
            
            if (r.success) {
                alert('تم الاعتماد وتسوية المخزون بنجاح!');
                document.getElementById('modal-count-detail').classList.remove('open');
                if (viewHandlers['view-stock-count']) viewHandlers['view-stock-count']();
            } else {
                alert('خطأ: ' + (r.message || ''));
            }
        });
    }


})();