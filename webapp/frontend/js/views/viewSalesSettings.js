(function() {
    'use strict';
    window.viewHandlers = window.viewHandlers || {};
    const viewHandlers = window.viewHandlers;

    const req = (...args) => window.req(...args);
    const fmt = (...args) => window.fmt(...args);
    const fmtPlain = (...args) => window.fmtPlain(...args);
    const fmtInt = (...args) => window.fmtInt(...args);
    const esc = (...args) => window.esc(...args);

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


    viewHandlers['view-sales-serials'] = function () {
        const form = document.getElementById('serial-track-form');
        const input = document.getElementById('serial-search-input');
        const resultBox = document.getElementById('serial-track-result');
        const btn = document.getElementById('btn-track-serial');
        if (!form || form.dataset.bound) return;
        form.dataset.bound = '1';

        async function doTrack() {
            const val = (input.value || '').trim();
            if (!val) {
                alert('الرجاء إدخال رقم السيريال أو الباركود');
                return;
            }
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري التتبع...';
            resultBox.style.display = 'block';
            resultBox.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text-muted)"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><p style="margin-top:10px">جاري جلب سجل الحركة الكامل...</p></div>';

            try {
                const res = await req('/products/track/' + encodeURIComponent(val));
                if (!res.success || !res.data) {
                    resultBox.innerHTML = '<div class="alert alert-danger" style="padding:15px;border-radius:8px;background:#fef2f2;color:#dc2626;border:1px solid #fecaca"><i class="fa-solid fa-circle-exclamation"></i> ' + (res.message || 'لم يتم العثور على أي بيانات لهذا الصنف أو السيريال') + '</div>';
                    return;
                }

                const d = res.data;
                const p = d.product || {};
                const balances = d.storeBalances || [];
                const purchases = d.purchases || [];
                const sales = d.sales || [];
                const movements = d.movements || [];

                let html = '<div style="background:var(--card-bg);border:1px solid var(--border-color);border-radius:12px;padding:20px;margin-top:15px">' +
                    '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;border-bottom:1px solid var(--border-color);padding-bottom:15px;margin-bottom:15px">' +
                        '<div>' +
                            '<h3 style="margin:0;font-size:1.25rem;color:var(--text-main)">' + esc(p.product_name) + '</h3>' +
                            '<div style="color:var(--text-muted);font-size:0.85rem;margin-top:4px">' +
                                '<span>كود: <strong>' + esc(p.product_code || '-') + '</strong></span> &bull; ' +
                                '<span>باركود: <strong>' + esc(p.barcode || '-') + '</strong></span> &bull; ' +
                                '<span>الفئة: <strong>' + esc(p.category_name || '-') + '</strong></span>' +
                            '</div>' +
                        '</div>' +
                        '<div style="text-align:left">' +
                            '<span style="font-size:0.85rem;color:var(--text-muted)">الرصيد الكلي:</span>' +
                            '<div style="font-size:1.5rem;font-weight:700;color:var(--primary-color)">' + fmtInt(p.total_stock) + ' ' + esc(p.unit_name || 'قطعة') + '</div>' +
                        '</div>' +
                    '</div>' +

                    '<div style="margin-bottom:20px">' +
                        '<h4 style="font-size:0.95rem;margin-bottom:10px;color:var(--text-main)"><i class="fa-solid fa-warehouse"></i> الأرصدة الحالية بالمخازن</h4>' +
                        '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
                            (balances.length > 0 ? balances.map(b => 
                                '<div style="background:var(--bg-light);border:1px solid var(--border-color);border-radius:8px;padding:10px 15px;min-width:140px">' +
                                    '<div style="font-size:0.8rem;color:var(--text-muted)">' + esc(b.store_name) + '</div>' +
                                    '<div style="font-size:1.1rem;font-weight:700;color:var(--text-main)">' + fmtPlain(b.quantity) + '</div>' +
                                '</div>'
                            ).join('') : '<div style="color:var(--text-muted)">لا توجد أرصدة بالمخازن</div>') +
                        '</div>' +
                    '</div>' +

                    '<div style="margin-bottom:20px">' +
                        '<h4 style="font-size:0.95rem;margin-bottom:10px;color:var(--text-main)"><i class="fa-solid fa-cart-shopping"></i> آخر حركات البيع (العملاء)</h4>' +
                        '<div class="table-responsive">' +
                            '<table class="data-table" style="font-size:0.85rem">' +
                                '<thead><tr><th>رقم الفاتورة</th><th>التاريخ</th><th>العميل</th><th>الكمية</th><th>سعر البيع</th><th>الإجمالي</th></tr></thead>' +
                                '<tbody>' +
                                    (sales.length > 0 ? sales.map(s => 
                                        '<tr>' +
                                            '<td><strong>' + esc(s.invoice_no) + '</strong></td>' +
                                            '<td>' + esc(s.invoice_date) + '</td>' +
                                            '<td>' + esc(s.customer_name || 'عميل نقدي') + '</td>' +
                                            '<td>' + fmtPlain(s.quantity) + '</td>' +
                                            '<td>' + fmt(s.sell_price) + ' ج.م</td>' +
                                            '<td><strong>' + fmt(s.line_total) + ' ج.م</strong></td>' +
                                        '</tr>'
                                    ).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">لا توجد مبيعات مسجلة</td></tr>') +
                                '</tbody>' +
                            '</table>' +
                        '</div>' +
                    '</div>' +

                    '<div style="margin-bottom:20px">' +
                        '<h4 style="font-size:0.95rem;margin-bottom:10px;color:var(--text-main)"><i class="fa-solid fa-truck"></i> آخر حركات الشراء (الموردين)</h4>' +
                        '<div class="table-responsive">' +
                            '<table class="data-table" style="font-size:0.85rem">' +
                                '<thead><tr><th>رقم الفاتورة</th><th>التاريخ</th><th>المورد</th><th>الكمية</th><th>سعر الشراء</th><th>الإجمالي</th></tr></thead>' +
                                '<tbody>' +
                                    (purchases.length > 0 ? purchases.map(pu => 
                                        '<tr>' +
                                            '<td><strong>' + esc(pu.invoice_no) + '</strong></td>' +
                                            '<td>' + esc(pu.invoice_date) + '</td>' +
                                            '<td>' + esc(pu.supplier_name || '-') + '</td>' +
                                            '<td>' + fmtPlain(pu.quantity) + '</td>' +
                                            '<td>' + fmt(pu.cost_price) + ' ج.م</td>' +
                                            '<td><strong>' + fmt(pu.line_total) + ' ج.م</strong></td>' +
                                        '</tr>'
                                    ).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">لا توجد مشتريات مسجلة</td></tr>') +
                                '</tbody>' +
                            '</table>' +
                        '</div>' +
                    '</div>' +

                    '<div>' +
                        '<h4 style="font-size:0.95rem;margin-bottom:10px;color:var(--text-main)"><i class="fa-solid fa-clock-rotate-left"></i> سجل الحركة الدقيق (Stock Movements)</h4>' +
                        '<div class="table-responsive">' +
                            '<table class="data-table" style="font-size:0.82rem">' +
                                '<thead><tr><th>التاريخ</th><th>نوع الحركة</th><th>المستند</th><th>المخزن</th><th>وارد (+)</th><th>منصرف (-)</th><th>الرصيد بعد</th><th>ملاحظات</th></tr></thead>' +
                                '<tbody>' +
                                    (movements.length > 0 ? movements.map(m => 
                                        '<tr>' +
                                            '<td>' + esc(m.move_date) + '</td>' +
                                            '<td><span class="badge-status ' + (m.qty_in > 0 ? 'paid' : 'pending') + '">' + esc(m.move_type) + '</span></td>' +
                                            '<td><strong>' + esc(m.document_no || '-') + '</strong></td>' +
                                            '<td>' + esc(m.store_name || '-') + '</td>' +
                                            '<td class="text-success">' + (m.qty_in > 0 ? '+' + fmtPlain(m.qty_in) : '-') + '</td>' +
                                            '<td class="text-danger">' + (m.qty_out > 0 ? '-' + fmtPlain(m.qty_out) : '-') + '</td>' +
                                            '<td><strong>' + fmtPlain(m.balance_after) + '</strong></td>' +
                                            '<td style="color:var(--text-muted)">' + esc(m.notes || '-') + '</td>' +
                                        '</tr>'
                                    ).join('') : '<tr><td colspan="8" style="text-align:center;color:var(--text-muted)">لا توجد حركات مخزنية</td></tr>') +
                                '</tbody>' +
                            '</table>' +
                        '</div>' +
                    '</div>' +
                '</div>';

                resultBox.innerHTML = html;
            } catch (err) {
                resultBox.innerHTML = '<div class="alert alert-danger" style="padding:15px;border-radius:8px;background:#fef2f2;color:#dc2626;border:1px solid #fecaca">خطأ أثناء جلب البيانات: ' + err.message + '</div>';
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<i class="fa-solid fa-search"></i> تتبع الصنف';
            }
        }

        form.addEventListener('submit', doTrack);
        btn.addEventListener('click', doTrack);
    };

})();
