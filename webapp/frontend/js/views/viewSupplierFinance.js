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

    // ============================================================
    // VIEW: SUPPLIER STATEMENT — Unified Modern Design
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
        const fromEl = document.getElementById('sup-stmt-from');
        const toEl   = document.getElementById('sup-stmt-to');
        if (fromEl && !fromEl.value) fromEl.value = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
        if (toEl   && !toEl.value)   toEl.value   = now.toISOString().slice(0, 10);

        const typeMeta = {
            purchase_invoice: { icon: 'fa-file-invoice',      label: 'فاتورة',   color: '#059669', bg: 'rgba(5,150,105,0.1)' },
            purchase_return:  { icon: 'fa-undo',               label: 'مرتجع',    color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
            supplier_payment: { icon: 'fa-hand-holding-usd',   label: 'سند صرف',  color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
            ap_payment:       { icon: 'fa-hand-holding-usd',   label: 'سند صرف',  color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
            ap_note:          { icon: 'fa-file-circle-check',  label: 'إشعار',    color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)' },
            journal_entry:    { icon: 'fa-book',               label: 'قيد',      color: '#6b7280', bg: 'rgba(107,114,128,0.08)' },
            manual_je:        { icon: 'fa-book',               label: 'قيد',      color: '#6b7280', bg: 'rgba(107,114,128,0.08)' },
            opening:          { icon: 'fa-circle',             label: 'افتتاحي',  color: '#1e3a5f', bg: '#f1f5f9' }
        };
        function getMeta(t) { return typeMeta[t] || { icon: 'fa-circle', label: t || 'حركة', color: '#6b7280', bg: 'rgba(107,114,128,0.08)' }; }
        function fmtDt(v)   { return v ? String(v).slice(0, 10) : '-'; }
        function balColor(v){ return v > 0 ? '#059669' : v < 0 ? '#ef4444' : '#6b7280'; }

        // ── Main load ──────────────────────────────────────────────────
        let _allRows = [];
        let _supplier = null;
        let _kpis = {};

        async function loadStatement() {
            const id = sel.value;
            if (!id) return alert('اختر مورد أولاً');

            const params = new URLSearchParams();
            const f = fromEl?.value;
            const t = toEl?.value;
            const tp = document.getElementById('sup-stmt-type')?.value || '';
            if (f)  params.append('from', f);
            if (t)  params.append('to', t);
            if (tp) params.append('type', tp);
            params.append('showDetails', 'true');

            const btnShow = document.getElementById('btn-sup-stmt-show');
            if (btnShow) { btnShow.disabled = true; btnShow.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> تحميل...'; }

            try {
                const r = await req(`/ap/payments/supplier/${id}/statement` + (params.toString() ? '?' + params : ''));

                if (btnShow) { btnShow.disabled = false; btnShow.innerHTML = '<i class="fa-solid fa-search"></i> عرض'; }

                if (!r || !r.success) {
                    alert(r?.message || 'خطأ في تحميل كشف الحساب');
                    return;
                }

                const data = r.data;
                _allRows    = data.rows || [];
                _supplier   = data.supplier || {};
                _kpis       = data.kpis || {};

                renderOutput(data);
            } catch (err) {
                if (btnShow) { btnShow.disabled = false; btnShow.innerHTML = '<i class="fa-solid fa-search"></i> عرض'; }
                console.error('[SupplierStatement] Error:', err);
                alert('خطأ: ' + (err.message || 'تعذر تحميل الكشف'));
            }
        }

        // ── Render full output (like customer statement) ───────────────
        function renderOutput(data) {
            const sup    = data.supplier || {};
            const kpis   = data.kpis || {};
            const allRows = data.rows || [];
            const f = fromEl?.value;
            const t = toEl?.value;
            const periodStr = (f || '---') + ' → ' + (t || '---');

            clearOutput();
            const out = document.getElementById('rpt-output') || document.getElementById('sup-stmt-results');
            if (!out) return;
            out.style.display = '';

            // Avatar initials
            const initials = (sup.supplier_name || '?')[0];
            const avatarColor = '#7c3aed';

            out.innerHTML =
                // ── Title bar
                '<div style="margin-bottom:6px;display:flex;align-items:center;justify-content:space-between">' +
                    '<div>' +
                        '<span style="font-size:1.05rem;font-weight:800;color:#1e3a5f">كشف حساب مورد</span>' +
                        '<span style="font-size:0.75rem;color:#6b7280;margin-right:10px">' + periodStr + '</span>' +
                    '</div>' +
                    '<span style="font-size:0.7rem;color:#9ca3af">' + (kpis.transaction_count || 0) + ' حركات</span>' +
                '</div>' +

                // ── Supplier info card
                '<div style="margin-bottom:6px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:10px 14px;display:flex;flex-wrap:wrap;gap:10px">' +
                    '<div style="flex:1;min-width:200px">' +
                        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' +
                            '<div style="width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,' + avatarColor + ',#a78bfa);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:0.9rem">' +
                                esc(initials) +
                            '</div>' +
                            '<div>' +
                                '<div style="font-weight:700;font-size:0.85rem;color:#111827">' + esc(sup.supplier_name || '-') + '</div>' +
                                '<div style="font-size:0.7rem;color:#6b7280">' + esc(sup.supplier_code || '') + (sup.phone ? ' | ' + esc(sup.phone) : '') + (sup.email ? ' | ' + esc(sup.email) : '') + '</div>' +
                            '</div>' +
                        '</div>' +
                        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 14px;font-size:0.7rem">' +
                            '<div><span style="color:#9ca3af">العنوان</span><br><span style="color:#374151;font-weight:500">' + esc(sup.address || '-') + '</span></div>' +
                            '<div><span style="color:#9ca3af">الرقم الضريبي</span><br><span style="color:#374151;font-weight:500">' + esc(sup.tax_number || '-') + '</span></div>' +
                        '</div>' +
                    '</div>' +
                    '<div style="width:1px;background:#e5e7eb"></div>' +
                    '<div style="min-width:160px;display:flex;flex-direction:column;justify-content:center;gap:3px;padding:2px 0">' +
                        '<div style="font-size:0.65rem;color:#9ca3af">الرصيد الحالي</div>' +
                        '<div style="font-size:1.35rem;font-weight:900;color:' + balColor(kpis.current_balance) + ';direction:ltr">' + fmt(kpis.current_balance) + '</div>' +
                        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:1px 10px;margin-top:3px;font-size:0.68rem">' +
                            '<div><span style="color:#9ca3af">آخر فاتورة</span><br><span style="color:#374151;font-weight:500">' + fmtDt(sup.last_invoice_date) + '</span></div>' +
                            '<div><span style="color:#9ca3af">آخر دفعة</span><br><span style="color:#374151;font-weight:500">' + fmtDt(sup.last_payment_date) + '</span></div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +

                // ── KPI cards
                '<div style="margin-bottom:5px;display:flex;gap:6px;flex-wrap:wrap">' +
                    '<div style="flex:1.5;min-width:130px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;border-right:3px solid #059669;padding:6px 12px">' +
                        '<div style="display:flex;align-items:center;gap:5px;margin-bottom:1px">' +
                            '<i class="fa-solid fa-wallet" style="color:#059669;font-size:0.9rem;width:18px;text-align:center"></i>' +
                            '<span style="color:#6b7280;font-size:0.7rem;font-weight:600">الرصيد الحالي</span>' +
                        '</div>' +
                        '<div style="color:' + balColor(kpis.current_balance) + ';font-size:1.3rem;font-weight:800;direction:ltr">' + fmt(kpis.current_balance) + '</div>' +
                    '</div>' +
                    '<div style="flex:1;min-width:90px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;border-right:3px solid #7c3aed;padding:6px 12px">' +
                        '<div style="display:flex;align-items:center;gap:5px;margin-bottom:1px">' +
                            '<i class="fa-solid fa-file-invoice" style="color:#7c3aed;font-size:0.8rem;width:16px;text-align:center"></i>' +
                            '<span style="color:#6b7280;font-size:0.7rem;font-weight:600">المشتريات</span>' +
                        '</div>' +
                        '<div style="color:#7c3aed;font-size:1rem;font-weight:700;direction:ltr">' + fmt(kpis.total_purchases) + '</div>' +
                    '</div>' +
                    '<div style="flex:1;min-width:90px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;border-right:3px solid #3b82f6;padding:6px 12px">' +
                        '<div style="display:flex;align-items:center;gap:5px;margin-bottom:1px">' +
                            '<i class="fa-solid fa-hand-holding-usd" style="color:#3b82f6;font-size:0.8rem;width:16px;text-align:center"></i>' +
                            '<span style="color:#6b7280;font-size:0.7rem;font-weight:600">المدفوعات</span>' +
                        '</div>' +
                        '<div style="color:#3b82f6;font-size:1rem;font-weight:700;direction:ltr">' + fmt(kpis.total_payments) + '</div>' +
                    '</div>' +
                    '<div style="flex:1;min-width:90px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;border-right:3px solid #f59e0b;padding:6px 12px">' +
                        '<div style="display:flex;align-items:center;gap:5px;margin-bottom:1px">' +
                            '<i class="fa-solid fa-undo" style="color:#f59e0b;font-size:0.8rem;width:16px;text-align:center"></i>' +
                            '<span style="color:#6b7280;font-size:0.7rem;font-weight:600">المرتجعات</span>' +
                        '</div>' +
                        '<div style="color:#f59e0b;font-size:1rem;font-weight:700;direction:ltr">' + fmt(kpis.total_returns) + '</div>' +
                    '</div>' +
                '</div>' +

                // ── Filter bar
                '<div class="no-print" style="display:flex;flex-wrap:wrap;gap:5px;align-items:center;padding:5px 10px;background:#fff;border:1px solid #e5e7eb;border-bottom:none;border-radius:8px 8px 0 0">' +
                    '<div style="display:flex;align-items:center;gap:4px;flex:1;min-width:130px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:0 7px">' +
                        '<i class="fa-solid fa-search" style="color:#9ca3af;font-size:0.7rem"></i>' +
                        '<input type="text" class="sup-stmt-search-inp" placeholder="بحث برقم المستند..." style="flex:1;padding:4px 0;border:none;background:transparent;font-size:0.72rem;outline:none">' +
                    '</div>' +
                    '<div style="display:flex;gap:3px;flex-wrap:wrap;align-items:center">' +
                        ['purchase_invoice','purchase_return','ap_payment','ap_note','journal_entry'].map(t => {
                            const m = getMeta(t);
                            return '<label style="display:flex;align-items:center;gap:2px;font-size:0.68rem;cursor:pointer;padding:2px 5px;border-radius:4px;background:' + m.bg + ';border:1px solid ' + m.color + '30">' +
                                '<input type="checkbox" class="sup-stmt-filter-cb" data-type="' + t + '" checked style="margin:0;width:10px;height:10px;accent-color:' + m.color + '">' +
                                '<i class="fa-solid ' + m.icon + '" style="color:' + m.color + ';font-size:0.55rem"></i>' +
                                '<span style="color:' + m.color + ';font-weight:600">' + m.label + '</span>' +
                            '</label>';
                        }).join('') +
                        '<button class="sup-stmt-reset-btn" style="padding:2px 5px;border:1px solid #e5e7eb;border-radius:4px;background:#fff;cursor:pointer;font-size:0.6rem;color:#6b7280"><i class="fa-solid fa-rotate"></i></button>' +
                    '</div>' +
                '</div>' +

                // ── Table placeholder
                '<div class="sup-stmt-table-wrap"></div>';

            // ── Inner table renderer (with filter/search) ──────────────
            function renderStmtTable() {
                const sv = (out.querySelector('.sup-stmt-search-inp')?.value || '').toLowerCase().trim();
                const active = new Set();
                out.querySelectorAll('.sup-stmt-filter-cb:checked').forEach(cb => active.add(cb.dataset.type));

                // Opening row if any
                const hasOpening = allRows.length > 0 && allRows[0].ref_type === 'opening';
                const openingRow = hasOpening ? allRows[0] : null;
                const txnRows    = openingRow ? allRows.slice(1) : allRows;

                const filteredRows = txnRows.filter(row => {
                    // Normalize type for filter: supplier_payment -> ap_payment
                    const normType = (row.ref_type === 'supplier_payment') ? 'ap_payment' : (row.ref_type || 'journal_entry');
                    if (!active.has(normType) && !active.has(row.ref_type)) return false;
                    if (!sv) return true;
                    return (row.doc_no || '').toLowerCase().includes(sv) ||
                           (row.description || '').toLowerCase().includes(sv) ||
                           (row.doc_type_short || '').includes(sv);
                });

                const headers = ['#', 'التاريخ', 'النوع', 'رقم المستند', 'البيان', 'مدين', 'دائن', 'الرصيد', 'التطابق'];
                const colSpan = headers.length;

                let bodyHtml = '';

                // Opening row
                if (openingRow) {
                    const m0 = getMeta('opening');
                    bodyHtml += '<tr style="background:#f1f5f9">' +
                        '<td style="color:#9ca3af;font-size:0.68rem;padding:5px 7px">—</td>' +
                        '<td style="color:#9ca3af;padding:5px 7px">—</td>' +
                        '<td colspan="2" style="padding:5px 7px"><span style="color:' + m0.color + ';font-weight:600;font-size:0.75rem"><i class="fa-solid fa-circle" style="font-size:0.38rem;vertical-align:middle;margin-left:3px"></i>رصيد افتتاحي</span></td>' +
                        '<td style="font-size:0.72rem;color:#6b7280;padding:5px 7px">رصيد قبل الفترة</td>' +
                        '<td style="color:#9ca3af;padding:5px 7px">—</td>' +
                        '<td style="color:#9ca3af;padding:5px 7px">—</td>' +
                        '<td style="font-weight:700;direction:ltr;text-align:right;color:' + balColor(openingRow.balance || data.opening_balance) + ';padding:5px 7px">' + fmt(openingRow.balance || data.opening_balance) + '</td>' +
                        '<td style="padding:5px 7px"></td>' +
                    '</tr>';
                } else if (data.opening_balance !== undefined) {
                    // Always show opening balance row even if not in rows array
                    bodyHtml += '<tr style="background:#f1f5f9">' +
                        '<td style="color:#9ca3af;font-size:0.68rem;padding:5px 7px">—</td>' +
                        '<td style="color:#9ca3af;padding:5px 7px">—</td>' +
                        '<td colspan="2" style="padding:5px 7px"><span style="color:#1e3a5f;font-weight:600;font-size:0.75rem"><i class="fa-solid fa-circle" style="font-size:0.38rem;vertical-align:middle;margin-left:3px"></i>رصيد افتتاحي</span></td>' +
                        '<td style="font-size:0.72rem;color:#6b7280;padding:5px 7px">رصيد قبل الفترة</td>' +
                        '<td style="color:#9ca3af;padding:5px 7px">—</td>' +
                        '<td style="color:#9ca3af;padding:5px 7px">—</td>' +
                        '<td style="font-weight:700;direction:ltr;text-align:right;color:' + balColor(data.opening_balance) + ';padding:5px 7px">' + fmt(data.opening_balance) + '</td>' +
                        '<td style="padding:5px 7px"></td>' +
                    '</tr>';
                }

                if (filteredRows.length === 0) {
                    bodyHtml += '<tr><td colspan="' + colSpan + '" style="text-align:center;padding:25px;color:#999;font-size:0.8rem">لا توجد حركات</td></tr>';
                } else {
                    filteredRows.forEach((r, i) => {
                        const m = getMeta(r.ref_type);

                        let matchBadge = '<span style="color:#9ca3af;font-size:0.65rem">—</span>';
                        if (r.is_matched === true)
                            matchBadge = '<span style="background:#d1fae5;color:#065f46;padding:2px 6px;border-radius:4px;font-size:0.65rem;white-space:nowrap;font-weight:600">✓ متطابق</span>';
                        else if (r.is_matched === false)
                            matchBadge = '<span style="background:#fee2e2;color:#991b1b;padding:2px 6px;border-radius:4px;font-size:0.65rem;white-space:nowrap;font-weight:600">✗ غير متطابق</span>';

                        bodyHtml += '<tr class="sup-stmt-row" style="transition:background 0.15s">' +
                            '<td style="color:#9ca3af;font-size:0.65rem;padding:5px 7px">' + (i + 1) + '</td>' +
                            '<td style="white-space:nowrap;font-size:0.72rem;padding:5px 7px">' + fmtDt(r.date) + '</td>' +
                            '<td style="padding:5px 7px"><span style="display:inline-flex;align-items:center;gap:2px;padding:1px 7px;border-radius:10px;background:' + m.bg + ';color:' + m.color + ';font-weight:600;font-size:0.65rem;white-space:nowrap">' +
                                '<i class="fa-solid ' + m.icon + '" style="font-size:0.5rem"></i>' +
                                esc(r.doc_type_short || m.label) +
                            '</span></td>' +
                            '<td style="font-weight:600;font-size:0.75rem;padding:5px 7px">' + esc(r.doc_no || '-') + '</td>' +
                            '<td style="font-size:0.72rem;color:#4b5563;word-break:break-word;padding:5px 7px;min-width:70px">' + esc(r.description || '-') + '</td>' +
                            '<td style="font-weight:600;color:#059669;direction:ltr;text-align:right;font-size:0.75rem;padding:5px 7px">' + (r.debit  ? fmt(r.debit)  : '—') + '</td>' +
                            '<td style="font-weight:600;color:#ef4444;direction:ltr;text-align:right;font-size:0.75rem;padding:5px 7px">' + (r.credit ? fmt(r.credit) : '—') + '</td>' +
                            '<td style="font-weight:700;direction:ltr;text-align:right;color:' + balColor(r.balance) + ';font-size:0.78rem;padding:5px 7px">' + fmt(r.balance) + '</td>' +
                            '<td style="text-align:center;padding:5px 7px">' + matchBadge + '</td>' +
                        '</tr>';
                    });
                }

                // Footer totals
                const totalDebit  = filteredRows.reduce((s, r) => s + (r.debit  || 0), 0);
                const totalCredit = filteredRows.reduce((s, r) => s + (r.credit || 0), 0);
                const closing = data.closing_balance;
                const foot = filteredRows.length > 0
                    ? '<tr style="font-weight:bold;background:#f3f4f6;font-size:0.75rem;border-top:2px solid #d1d5db">' +
                      '<td style="color:#9ca3af;padding:6px 8px">#</td>' +
                      '<td style="text-align:left;color:#6b7280;padding:6px 8px" colspan="2">الافتتاحي: ' + fmt(kpis.opening_balance) + '</td>' +
                      '<td style="color:#6b7280;padding:6px 8px" colspan="2">' + filteredRows.length + ' حركات</td>' +
                      '<td style="color:#059669;direction:ltr;text-align:right;padding:6px 8px">' + fmt(totalDebit) + '</td>' +
                      '<td style="color:#ef4444;direction:ltr;text-align:right;padding:6px 8px">' + fmt(totalCredit) + '</td>' +
                      '<td style="font-weight:800;direction:ltr;text-align:right;color:' + balColor(closing) + ';padding:6px 8px">' + fmt(closing) + '</td>' +
                      '<td style="padding:6px 8px"></td>' +
                    '</tr>'
                    : '';

                const wrap = out.querySelector('.sup-stmt-table-wrap');
                if (wrap) {
                    wrap.innerHTML =
                        '<div class="table-responsive"><table class="report-table">' +
                            '<thead><tr>' + headers.map(h => '<th>' + h + '</th>').join('') + '</tr></thead>' +
                            '<tbody>' + bodyHtml + '</tbody>' +
                            (foot ? '<tfoot>' + foot + '</tfoot>' : '') +
                        '</table></div>';
                }
            }

            renderStmtTable();

            // Scoped event bindings
            let searchTimer;
            setTimeout(() => {
                const inp  = out.querySelector('.sup-stmt-search-inp');
                const cbs  = out.querySelectorAll('.sup-stmt-filter-cb');
                const rst  = out.querySelector('.sup-stmt-reset-btn');
                if (inp) inp.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderStmtTable, 250); });
                cbs.forEach(cb => cb.addEventListener('change', renderStmtTable));
                if (rst) rst.addEventListener('click', () => { if (inp) inp.value = ''; cbs.forEach(cb => cb.checked = true); renderStmtTable(); });
            }, 50);
        }

        // ── Clear output helper ──────────────────────────────────────
        function clearOutput() {
            const out = document.getElementById('rpt-output') || document.getElementById('sup-stmt-results');
            if (out) { out.innerHTML = ''; out.style.display = 'none'; }
        }

        // ── Button bindings (always refresh onclick to use latest closure) ──
        const btnShow = document.getElementById('btn-sup-stmt-show');
        if (btnShow) {
            btnShow.onclick = loadStatement;
        }

        const btnPrint = document.getElementById('btn-sup-stmt-print');
        if (btnPrint && !btnPrint.dataset.bound) {
            btnPrint.dataset.bound = '1';
            btnPrint.addEventListener('click', () => {
                const out = document.getElementById('rpt-output') || document.getElementById('sup-stmt-results');
                if (!out || !out.innerHTML) return alert('عرض الكشف أولاً');
                const w = window.open('', '_blank', 'width=1000,height=700');
                if (!w) return alert('السماح بالنوافذ المنبثقة');
                const supName = _supplier?.supplier_name || '';
                const pf = fromEl?.value || ''; const pt = toEl?.value || '';
                w.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>كشف حساب مورد - ${supName}</title>
                    <style>
                        body{font-family:Tahoma,Arial,sans-serif;direction:rtl;padding:20px;color:#111}
                        h2{text-align:center;margin:0 0 4px} .sub{text-align:center;color:#555;font-size:13px;margin-bottom:14px}
                        table{width:100%;border-collapse:collapse;font-size:12px}
                        th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:right}
                        th{background:#f1f5f9} tfoot td{font-weight:bold;background:#f8fafc}
                        .no-print{display:none}
                    </style></head><body>
                    <h2>كشف حساب مورد: ${supName}</h2>
                    <div class="sub">الفترة: ${pf} إلى ${pt}</div>
                    <div>${out.querySelector('.sup-stmt-table-wrap')?.innerHTML || ''}</div>
                    <div style="margin-top:40px;display:flex;justify-content:space-between;font-size:12px;color:#555">
                        <div>توقيع مسؤول الحسابات: ______________</div><div>توقيع المورد: ______________</div>
                    </div>
                    </body></html>`);
                w.document.close();
                setTimeout(() => w.print(), 500);
            });
        }

        const btnExcel = document.getElementById('btn-sup-stmt-excel');
        if (btnExcel && !btnExcel.dataset.bound) {
            btnExcel.dataset.bound = '1';
            btnExcel.addEventListener('click', () => {
                if (!_allRows || !_allRows.length) return alert('عرض الكشف أولاً');
                const rows = _allRows.map((r, i) => [
                    i + 1, fmtDt(r.date), r.doc_type_short || '-', esc(r.doc_no || '-'),
                    esc(r.description || '-'), fmt(r.debit), fmt(r.credit), fmt(r.balance),
                    r.is_matched === true ? 'متطابق' : r.is_matched === false ? 'غير متطابق' : '-'
                ]);
                if (typeof window.ExportService !== 'undefined' && window.ExportService.exportReport) {
                    window.ExportService.exportReport('excel', {
                        filename: 'supplier-statement-' + (_supplier?.supplier_code || ''),
                        headers: ['#', 'التاريخ', 'النوع', 'رقم المستند', 'البيان', 'مدين', 'دائن', 'الرصيد', 'التطابق'],
                        rows
                    });
                } else {
                    alert('خدمة التصدير غير متاحة');
                }
            });
        }
    };

})();
