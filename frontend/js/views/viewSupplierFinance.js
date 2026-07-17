(function() {
    'use strict';
    window.viewHandlers = window.viewHandlers || {};
    const viewHandlers = window.viewHandlers;

    const req = (...args) => window.req(...args);
    const fmt = (...args) => window.fmt(...args);
    const fmtPlain = (...args) => window.fmtPlain(...args);
    const fmtInt = (...args) => window.fmtInt(...args);
    const esc = (...args) => window.esc(...args);

    viewHandlers['view-supplier-payments'] = async function () {
        const tbody = document.getElementById('payments-tbody');
        if (!tbody) return;
        const now = new Date();
        const from = document.getElementById('payments-from');
        const to = document.getElementById('payments-to');
        if (from && !from.value) from.value = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
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
        if (from && !from.value) from.value = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
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

})();
