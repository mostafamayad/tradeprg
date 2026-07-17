// ============================================================
// TradePro ERP - AR/AP Module (الحسابات المالية)
// Accounts Receivable & Accounts Payable
// ============================================================

window.initArPayment = async function() {
    const tbody = document.getElementById('ar-payment-tbody');
    if (!tbody) return;
    const now = new Date();
    const fromInput = document.getElementById('ar-payment-from');
    const toInput = document.getElementById('ar-payment-to');
    if (fromInput && !fromInput.value) fromInput.value = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
    if (toInput && !toInput.value) toInput.value = now.toISOString().slice(0, 10);

    async function load() {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding:20px"><i class="fa-solid fa-spinner fa-spin"></i></td></tr>';
        try {
            const params = {};
            const q = document.getElementById('ar-payment-search')?.value;
            const from = document.getElementById('ar-payment-from')?.value;
            const to = document.getElementById('ar-payment-to')?.value;
            if (q) params.q = q;
            if (from) params.from = from;
            if (to) params.to = to;
            const res = await window.API.getARPayments(params);
            const data = res.data || [];
            tbody.innerHTML = '';
            if (data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding:30px;color:var(--text-muted)">لا توجد دفعات في الفترة</td></tr>';
            } else {
                data.forEach(p => {
                    const methodBadge = p.payment_method === 'cash' ? '<span class="badge-status paid">نقدي</span>' : p.payment_method === 'check' ? '<span class="badge-status pending">شيك</span>' : '<span class="badge-status" style="background:var(--info-color)">تحويل</span>';
                    const statusBadge = p.status === 'active' ? '<span class="badge-status paid">نشط</span>' : '<span class="badge-status" style="background:#dc2626;">ملغي</span>';
                    const tr = document.createElement('tr');
                    tr.innerHTML = `<td><strong>${p.payment_no || '-'}</strong></td><td>${p.payment_date || '-'}</td><td>${p.customer_name || '-'}</td><td class="text-success"><strong>${window.formatMoney(p.amount)} ج.م</strong></td><td>${methodBadge}</td><td>${statusBadge}</td><td class="actions-cell">
                        <button class="icon-btn" onclick="window.API.openCollectionPrint(${p.id})" title="معاينة وطباعة"><i class="fa-solid fa-print"></i></button>
                        ${p.status === 'active' ? `<button class="icon-btn text-danger" onclick="window.deleteARPayment(${p.id})" title="إلغاء السند"><i class="fa-solid fa-trash"></i></button>` : ''}
                    </td>`;
                    tbody.appendChild(tr);
                });
            }
            const monthTotal = data.filter(p => { const d = new Date(p.payment_date); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); }).reduce((s, p) => s + Number(p.amount || 0), 0);
            const st = (id, val) => { const e = document.getElementById(id); if (e) e.innerHTML = val; };
            st('ar-payment-month-total', window.formatMoney(monthTotal) + ' ج.م');
            st('ar-payment-count', String(data.length));
        } catch(e) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-danger" style="padding:20px">خطأ في تحميل البيانات: ' + (e.message || '') + '</td></tr>';
            console.error(e);
        }
    }
    await load();
    ['ar-payment-search', 'ar-payment-from', 'ar-payment-to'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.dataset.bound) { el.dataset.bound = '1'; el.addEventListener('input', load); }
    });
    const btnNew = document.getElementById('btn-ar-payment-new');
    if (btnNew && !btnNew.dataset.bound) {
        btnNew.dataset.bound = '1';
        btnNew.addEventListener('click', () => openArPaymentModal());
    }
};

window.deleteARPayment = async function(id) {
    if (typeof window.showConfirm === 'function') {
        const res = await window.showConfirm('هل أنت متأكد من إلغاء سند القبض؟ لا يمكن التراجع عن هذا الإجراء وسيتم عكس القيود المحاسبية.');
        if (res) doDelete(id);
    } else if (confirm('هل أنت متأكد من إلغاء سند القبض؟')) {
        doDelete(id);
    }
    
    async function doDelete(paymentId) {
        try {
            const res = await window.API.reverseARPayment(paymentId);
            if (res.success) {
                if (window.showAlert) window.showAlert('تم إلغاء السند وعكس القيود بنجاح', {type: 'success'});
                else alert('تم إلغاء السند بنجاح');
                window.initArPayment(); // refresh list
            } else {
                if (window.showAlert) window.showAlert(res.message || 'خطأ في الإلغاء', {type: 'danger'});
                else alert(res.message || 'خطأ في الإلغاء');
            }
        } catch(e) {
            console.error(e);
            if (window.showAlert) window.showAlert(e.message || 'حدث خطأ في الاتصال بالسيرفر', {type: 'danger'});
            else alert(e.message || 'حدث خطأ');
        }
    }
};

function openArPaymentModal() {
    const modal = document.getElementById('global-modal');
    if (!modal) return;
    document.getElementById('modal-title').textContent = 'تسديد فاتورة مبيعات - سند قبض جديد';
    document.getElementById('modal-body').innerHTML = `
        <div class="form-grid">
            <div class="form-group"><label>رقم السند</label><input type="text" id="modal-ar-pay-no" placeholder="تلقائي إذا ترك فارغاً"></div>
            <div class="form-group"><label>العميل <span class="required">*</span></label><select id="modal-ar-pay-cust" style="width:100%"><option value="">-- اختر العميل --</option></select></div>
            <div class="form-group"><label>التاريخ <span class="required">*</span></label><input type="date" id="modal-ar-pay-date"></div>
            <div class="form-group"><label>المبلغ <span class="required">*</span></label><input type="number" id="modal-ar-pay-amount" min="0" step="0.01"></div>
            <div class="form-group"><label>طريقة الدفع</label><select id="modal-ar-pay-method"><option value="cash">نقدي</option><option value="check">شيك</option><option value="transfer">تحويل بنكي</option></select></div>
            <div class="form-group ar-check-field" style="display:none"><label>رقم الشيك</label><input type="text" id="modal-ar-pay-chkno"></div>
            <div class="form-group ar-check-field" style="display:none"><label>تاريخ الشيك</label><input type="date" id="modal-ar-pay-chkdate"></div>
            <div class="form-group ar-check-field" style="display:none"><label>البنك</label><input type="text" id="modal-ar-pay-bank"></div>
            <div class="form-group" style="grid-column:span 2"><label>ملاحظات</label><input type="text" id="modal-ar-pay-notes"></div>
        </div>`;

    window.API.getCustomers().then(r => {
        const sel = document.getElementById('modal-ar-pay-cust');
        if (sel && r.data) {
            (r.data || []).forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = c.customer_name;
                sel.appendChild(opt);
            });
        }
    });

    document.getElementById('modal-ar-pay-date').value = new Date().toISOString().slice(0, 10);

    const methodSel = document.getElementById('modal-ar-pay-method');
    methodSel.addEventListener('change', () => {
        const isCheck = methodSel.value === 'check';
        document.querySelectorAll('.ar-check-field').forEach(el => el.style.display = isCheck ? '' : 'none');
    });

    const saveBtn = document.getElementById('btn-modal-save');
    if (saveBtn) saveBtn.style.display = '';
    if (saveBtn) saveBtn.onclick = async () => {
        const payload = {
            payment_no: document.getElementById('modal-ar-pay-no').value,
            customer_id: document.getElementById('modal-ar-pay-cust').value,
            payment_date: document.getElementById('modal-ar-pay-date').value,
            amount: document.getElementById('modal-ar-pay-amount').value,
            payment_method: methodSel.value,
            check_no: document.getElementById('modal-ar-pay-chkno').value,
            check_date: document.getElementById('modal-ar-pay-chkdate').value,
            bank_name: document.getElementById('modal-ar-pay-bank').value,
            notes: document.getElementById('modal-ar-pay-notes').value
        };
        if (!payload.customer_id || !payload.amount) { alert('اختر العميل وأدخل المبلغ'); return; }
        const orig = saveBtn.innerHTML;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';
        saveBtn.disabled = true;
        const r = await window.API.createARPayment(payload);
        saveBtn.innerHTML = orig;
        saveBtn.disabled = false;
        if (r.success) {
            modal.classList.remove('active');
            window.initArPayment();
            // Show success alert then offer print (same style as invoice print)
            const collId = r.id || r.collection_id;
            const msg = '✅ تم تسجيل التحصيل بنجاح'
                + (collId ? '<br><br><button id="btn-print-coll" class="btn btn-primary" style="margin:0 auto;display:block;padding:8px 22px">'
                + '<i class="fa-solid fa-print" style="margin-left:6px"></i>طباعة سند القبض</button>' : '');
            window.showAlert(msg, { title: 'تمت العملية', type: 'success', infoText: false });
            // Wire print button - uses printInIframe with auth token (same as invoice)
            if (collId) {
                setTimeout(() => {
                    const btn = document.getElementById('btn-print-coll');
                    if (btn) btn.onclick = () => window.API.openCollectionPrint(collId);
                }, 50);
            }
        } else {
            if (typeof window.showAlert === 'function') {
                window.showAlert('خطأ: ' + (r.message || ''), { type: 'danger' });
            } else {
                alert('خطأ: ' + (r.message || ''));
            }
        }
    };
    modal.classList.add('active');
}

window.initArCheques = async function() {
    const tbody = document.getElementById('ar-cheque-tbody');
    if (!tbody) return;

    const statusLabels = { received: 'مستلم', deposited: 'مودع', collected: 'محصل', returned: 'مرتجع', cancelled: 'ملغي' };
    const statusBadgeCls = { received: 'pending', deposited: 'pending', collected: 'paid', returned: '', cancelled: '' };

    function fmt(n) { return parseFloat(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function fmtDate(d) { if (!d) return '—'; return String(d).split('T')[0]; }
    function showMsg(msg, type) { if (window.showToast) window.showToast(msg, type || 'success'); else alert(msg); }
    function confirmMsg(msg) { return confirm(msg); }

    function openModal(html) {
        closeAnyModal();
        document.body.insertAdjacentHTML('beforeend', html);
        var last = document.body.lastElementChild;
        if (last && last.classList.contains('modal-overlay')) {
            last.style.display = 'flex';
            last.classList.add('active');
        }
    }

    function closeAnyModal() {
        document.querySelectorAll('#ar-cheque-modal, #ar-cheque-detail-modal').forEach(el => el.remove());
    }

    // ── Load Customers for dropdown ──
    let customersList = [];
    async function loadCustomers() {
        try {
            const res = await window.API.request('/customers');
            if (res.success) customersList = res.data || [];
        } catch(e) { customersList = []; }
    }

    // ── Show Create/Edit Modal ──
    function showChequeModal(ch) {
        const isEdit = !!ch;
        const title = isEdit ? 'تعديل شيك' : 'شيك جديد';
        const html = `
        <div class="modal-overlay" id="ar-cheque-modal">
            <div class="modal-box" style="max-width:550px">
                <div class="modal-header"><h3>${title}</h3><button class="modal-close" onclick="document.getElementById('ar-cheque-modal').remove()">&times;</button></div>
                <div class="modal-body">
                    <div class="form-row"><label>رقم الشيك *</label><input type="text" id="ac-cheque-no" class="form-control" value="${ch ? ch.cheque_no : ''}" required></div>
                    <div class="form-row"><label>البنك *</label><input type="text" id="ac-bank-name" class="form-control" value="${ch ? (ch.bank_name || '') : ''}" placeholder="اسم البنك" required></div>
                    <div class="form-row"><label>رقم الحساب</label><input type="text" id="ac-account-no" class="form-control" value="${ch ? (ch.account_no || '') : ''}" placeholder="رقم الحساب البنكي"></div>
                    <div class="form-row"><label>العميل</label><select id="ac-customer-id" class="form-control"><option value="">-- اختر العميل --</option>${customersList.map(c => '<option value="' + c.id + '"' + (ch && ch.customer_id == c.id ? ' selected' : '') + '>' + c.customer_name + '</option>').join('')}</select></div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                        <div class="form-row"><label>قيمة الشيك *</label><input type="number" step="0.01" id="ac-amount" class="form-control" value="${ch ? ch.amount : ''}" required></div>
                        <div class="form-row"><label>تاريخ الإصدار</label><input type="date" id="ac-cheque-date" class="form-control" value="${ch ? fmtDate(ch.cheque_date) : new Date().toISOString().slice(0,10)}"></div>
                    </div>
                    <div class="form-row"><label>تاريخ الاستحقاق</label><input type="date" id="ac-due-date" class="form-control" value="${ch ? fmtDate(ch.due_date) : ''}"></div>
                    <div class="form-row"><label>ملاحظات</label><textarea id="ac-notes" class="form-control" rows="2">${ch ? (ch.notes || '') : ''}</textarea></div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-outline" onclick="document.getElementById('ar-cheque-modal').remove()">إلغاء</button>
                    <button class="btn btn-primary" id="ac-save-btn">${isEdit ? 'حفظ التعديلات' : 'إنشاء الشيك'}</button>
                </div>
            </div>
        </div>`;
        openModal(html);

        document.getElementById('ac-save-btn').addEventListener('click', async function() {
            const cheque_no = document.getElementById('ac-cheque-no').value.trim();
            const bank_name = document.getElementById('ac-bank-name').value.trim();
            const account_no = document.getElementById('ac-account-no').value.trim();
            const customer_id = document.getElementById('ac-customer-id').value;
            const amount = document.getElementById('ac-amount').value;
            const cheque_date = document.getElementById('ac-cheque-date').value;
            const due_date = document.getElementById('ac-due-date').value;
            const notes = document.getElementById('ac-notes').value.trim();

            if (!cheque_no) { showMsg('رقم الشيك مطلوب', 'error'); return; }
            if (!bank_name) { showMsg('اسم البنك مطلوب', 'error'); return; }
            if (!amount || parseFloat(amount) <= 0) { showMsg('قيمة الشيك مطلوبة', 'error'); return; }

            this.disabled = true;
            this.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';

            try {
                const payload = {
                    cheque_no, bank_name, account_no: account_no || null,
                    customer_id: customer_id ? parseInt(customer_id) : null,
                    amount: parseFloat(amount), cheque_date: cheque_date || null,
                    due_date: due_date || null, notes: notes || null
                };
                let res;
                if (isEdit) {
                    res = await window.API.updateARCheque(ch.id, payload);
                } else {
                    res = await window.API.createARCheque(payload);
                }
                if (res.success) {
                    showMsg(isEdit ? 'تم تعديل الشيك بنجاح' : 'تم إنشاء الشيك بنجاح');
                    closeAnyModal();
                    load();
                } else {
                    showMsg(res.message || 'خطأ في الحفظ', 'error');
                }
            } catch(e) {
                showMsg(e.message || 'خطأ في الحفظ', 'error');
            }
            this.disabled = false;
            this.innerHTML = isEdit ? 'حفظ التعديلات' : 'إنشاء الشيك';
        });
    }

    // ── Show Detail Modal ──
    function showDetail(ch) {
        const badgeCls = statusBadgeCls[ch.status] || '';
        const html = `
        <div class="modal-overlay" id="ar-cheque-detail-modal">
            <div class="modal-box" style="max-width:550px">
                <div class="modal-header"><h3>تفاصيل الشيك ${ch.cheque_no}</h3><button class="modal-close" onclick="document.getElementById('ar-cheque-detail-modal').remove()">&times;</button></div>
                <div class="modal-body">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
                        <div><strong>رقم الشيك:</strong> ${ch.cheque_no}</div>
                        <div><strong>البنك:</strong> ${ch.bank_name || '—'}</div>
                        <div><strong>رقم الحساب:</strong> ${ch.account_no || '—'}</div>
                        <div><strong>العميل:</strong> ${ch.customer_name || '—'}</div>
                        <div><strong>القيمة:</strong> <span class="text-success" style="font-weight:700">${fmt(ch.amount)} ج.م</span></div>
                        <div><strong>الحالة:</strong> <span class="badge-status ${badgeCls}">${statusLabels[ch.status] || ch.status}</span></div>
                        <div><strong>تاريخ الإصدار:</strong> ${fmtDate(ch.cheque_date)}</div>
                        <div><strong>تاريخ الاستحقاق:</strong> ${fmtDate(ch.due_date)}</div>
                        <div><strong>تاريخ الحالة:</strong> ${fmtDate(ch.status_date)}</div>
                    </div>
                    ${ch.notes ? '<div style="margin-top:16px"><strong>ملاحظات:</strong> ' + ch.notes + '</div>' : ''}
                </div>
                <div class="modal-footer">
                    <button class="btn btn-outline" onclick="document.getElementById('ar-cheque-detail-modal').remove()">إغلاق</button>
                </div>
            </div>
        </div>`;
        openModal(html);
    }

    // ── Perform Action with Confirm ──
    async function performAction(label, apiCall, ch) {
        if (!confirmMsg('هل أنت متأكد من ' + label + ' الشيك ' + ch.cheque_no + ' بقيمة ' + fmt(ch.amount) + ' ج.م؟')) return;
        try {
            const res = await apiCall();
            if (res.success) {
                showMsg(res.message || ('تم ' + label + ' الشيك بنجاح'));
                load();
            } else {
                showMsg(res.message || 'خطأ', 'error');
            }
        } catch(e) {
            showMsg(e.message || 'خطأ', 'error');
        }
    }

    // ── Build Actions ──
    function buildActions(ch) {
        let html = '';
        html += '<button class="btn btn-sm btn-outline" onclick="void(0)" data-action="view" title="عرض"><i class="fa-solid fa-eye"></i></button>';
        if (ch.status === 'received') {
            html += '<button class="btn btn-sm btn-outline" onclick="void(0)" data-action="edit" title="تعديل"><i class="fa-solid fa-pen"></i></button>';
            html += '<button class="btn btn-sm btn-primary" onclick="void(0)" data-action="deposit" title="إيداع"><i class="fa-solid fa-building-columns"></i></button>';
            html += '<button class="btn btn-sm btn-danger" onclick="void(0)" data-action="return" title="إرجاع"><i class="fa-solid fa-rotate-left"></i></button>';
            html += '<button class="btn btn-sm btn-outline" onclick="void(0)" data-action="cancel" title="إلغاء"><i class="fa-solid fa-ban"></i></button>';
            html += '<button class="btn btn-sm btn-outline" onclick="void(0)" data-action="delete" title="حذف"><i class="fa-solid fa-trash"></i></button>';
        } else if (ch.status === 'deposited') {
            html += '<button class="btn btn-sm btn-success" onclick="void(0)" data-action="collect" title="تحصيل"><i class="fa-solid fa-money-bill-wave"></i></button>';
            html += '<button class="btn btn-sm btn-danger" onclick="void(0)" data-action="return" title="إرجاع"><i class="fa-solid fa-rotate-left"></i></button>';
        }
        return html;
    }

    // ── Load Data ──
    async function load() {
        tbody.innerHTML = '<tr><td colspan="10" class="text-center" style="padding:20px"><i class="fa-solid fa-spinner fa-spin"></i></td></tr>';
        try {
            const params = {};
            const search = document.getElementById('ar-cheque-search')?.value;
            const status = document.getElementById('ar-cheque-status-filter')?.value;
            const bank = document.getElementById('ar-cheque-bank-filter')?.value;
            const dueFrom = document.getElementById('ar-cheque-due-from')?.value;
            const dueTo = document.getElementById('ar-cheque-due-to')?.value;
            if (search) params.q = search;
            if (status) params.status = status;
            if (bank) params.bank_name = bank;
            if (dueFrom) params.due_from = dueFrom;
            if (dueTo) params.due_to = dueTo;

            const res = await window.API.getARCheques(params);
            const data = res.data || [];
            tbody.innerHTML = '';
            if (data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="10" class="text-center" style="padding:30px;color:var(--text-muted)">لا توجد شيكات</td></tr>';
                return;
            }
            data.forEach(ch => {
                const tr = document.createElement('tr');
                const badgeCls = statusBadgeCls[ch.status] || '';
                tr.innerHTML = '<td><strong>' + ch.cheque_no + '</strong></td>' +
                    '<td>' + fmtDate(ch.cheque_date) + '</td>' +
                    '<td>' + fmtDate(ch.due_date) + '</td>' +
                    '<td>' + (ch.customer_name || '—') + '</td>' +
                    '<td class="text-success"><strong>' + fmt(ch.amount) + ' ج.م</strong></td>' +
                    '<td>' + (ch.bank_name || '—') + '</td>' +
                    '<td><span class="badge-status ' + badgeCls + '">' + (statusLabels[ch.status] || ch.status) + '</span></td>' +
                    '<td>' + fmtDate(ch.status_date) + '</td>' +
                    '<td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + (ch.notes || '').replace(/"/g, '&quot;') + '">' + (ch.notes || '—') + '</td>' +
                    '<td class="actions-cell" style="display:flex;gap:4px;flex-wrap:wrap">' + buildActions(ch) + '</td>';
                tbody.appendChild(tr);

                // Bind action handlers
                tr.querySelectorAll('.actions-cell button').forEach(btn => {
                    const action = btn.dataset.action;
                    btn.addEventListener('click', function() {
                        if (action === 'view') showDetail(ch);
                        else if (action === 'edit') showChequeModal(ch);
                        else if (action === 'deposit') performAction('إيداع', () => window.API.depositARCheque(ch.id), ch);
                        else if (action === 'collect') performAction('تحصيل', () => window.API.collectARCheque(ch.id), ch);
                        else if (action === 'return') performAction('إرجاع', () => window.API.returnARCheque(ch.id), ch);
                        else if (action === 'cancel') performAction('إلغاء', () => window.API.cancelARCheque(ch.id), ch);
                        else if (action === 'delete') {
                            if (confirmMsg('هل تريد حذف هذا الشيك نهائياً؟')) {
                                window.API.deleteARCheque(ch.id).then(r => {
                                    if (r.success) { showMsg('تم حذف الشيك'); load(); }
                                    else showMsg(r.message || 'خطأ', 'error');
                                }).catch(e => showMsg(e.message, 'error'));
                            }
                        }
                    });
                });
            });
        } catch(e) {
            tbody.innerHTML = '<tr><td colspan="10" class="text-center text-danger" style="padding:20px">' + (e.message || 'خطأ في التحميل') + '</td></tr>';
            console.error(e);
        }
    }

    // ── Wire "New Cheque" button ──
    const newBtn = document.getElementById('btn-ar-cheque-new');
    if (newBtn && !newBtn.dataset.bound) {
        newBtn.dataset.bound = '1';
        newBtn.addEventListener('click', async function() {
            await loadCustomers();
            showChequeModal(null);
        });
    }

    // ── Bind filter events ──
    ['ar-cheque-search', 'ar-cheque-status-filter', 'ar-cheque-bank-filter', 'ar-cheque-due-from', 'ar-cheque-due-to'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.dataset.bound) {
            el.dataset.bound = '1';
            el.addEventListener('change', load);
            if (el.tagName === 'INPUT' && el.type !== 'date') el.addEventListener('keyup', function(e) { if (e.key === 'Enter') load(); });
        }
    });

    // Clear browser auto-filled date filters on init
    const dueFromEl = document.getElementById('ar-cheque-due-from');
    const dueToEl = document.getElementById('ar-cheque-due-to');
    if (dueFromEl) dueFromEl.value = '';
    if (dueToEl) dueToEl.value = '';

    await load();
};

window.initArSecurityCheques = async function() {
    const tbody = document.getElementById('ar-sec-cheque-tbody');
    if (!tbody) return;
    try {
        const res = await window.API.getARSecurityCheques();
        const data = res.data || [];
        tbody.innerHTML = '';
        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center" style="padding:30px;color:var(--text-muted)">لا توجد شيكات تأمينية</td></tr>';
        } else {
            const statusLabels = { kept: 'محتجز', returned: 'مرتجع', cashed: 'تم الصرف' };
            data.forEach(ch => {
                const tr = document.createElement('tr');
                tr.innerHTML = `<td><strong>${ch.cheque_no}</strong></td><td>${ch.issue_date}</td><td>${ch.expiry_date}</td><td>${ch.customer_name || '-'}</td><td class="text-success"><strong>${window.formatMoney(ch.amount)} ج.م</strong></td><td>${ch.bank_name || '-'}</td><td>${ch.reason || '-'}</td><td><span class="badge-status ${ch.status === 'cashed' ? 'paid' : (ch.status === 'returned' ? '' : 'pending')}">${statusLabels[ch.status] || ch.status}</span></td><td class="actions-cell"><button class="icon-btn" onclick="window.API.showAlert ? window.API.showAlert('قيد الإنشاء',{type:'info'}):alert('قيد الإنشاء')" title="عرض"><i class="fa-solid fa-eye"></i></button></td>`;
                tbody.appendChild(tr);
            });
        }
    } catch(e) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center text-danger" style="padding:20px">' + (e.message || 'خطأ') + '</td></tr>';
        console.error(e);
    }
};

window.initArNotice = async function() {
    const tbody = document.getElementById('ar-notice-tbody');
    if (!tbody) return;

    async function load() {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center" style="padding:20px"><i class="fa-solid fa-spinner fa-spin"></i></td></tr>';
        try {
            const params = {};
            const search = document.getElementById('ar-notice-search')?.value;
            const noteType = document.getElementById('ar-notice-type-filter')?.value;
            const status = document.getElementById('ar-notice-status-filter')?.value;
            const from = document.getElementById('ar-notice-from')?.value;
            const to = document.getElementById('ar-notice-to')?.value;
            if (search) params.q = search;
            if (noteType) params.note_type = noteType;
            if (status) params.status = status;
            if (from) params.from = from;
            if (to) params.to = to;

            const res = await window.API.getARNotes(params);
            const data = res.data || [];
            tbody.innerHTML = '';
            if (data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="9" class="text-center" style="padding:30px;color:var(--text-muted)">لا توجد إشعارات</td></tr>';
            } else {
                data.forEach(n => {
                    const typeBadge = n.note_type === 'debit' ? '<span class="badge-status" style="background:var(--danger-color)">خصم</span>' : '<span class="badge-status paid">إضافة</span>';
                    const statusBadge = n.status === 'active' ? '<span class="badge-status paid">نشط</span>' : '<span class="badge-status" style="background:#888;">ملغي</span>';
                    const amountCls = n.note_type === 'debit' ? 'text-danger' : 'text-success';
                    const canReverse = n.status === 'active';
                    const reverseBtn = canReverse
                        ? `<button class="btn btn-sm btn-danger ar-note-reverse" data-id="${n.id}" title="عكس الإشعار"><i class="fa-solid fa-rotate-left"></i> عكس</button>`
                        : '';
                    const tr = document.createElement('tr');
                    tr.innerHTML = `<td><strong>${n.note_no}</strong></td><td>${n.note_date}</td><td>${n.customer_name || '-'}</td><td>${typeBadge}</td><td class="${amountCls}"><strong>${window.formatMoney(n.amount)} ج.م</strong></td><td>${n.reason || '-'}</td><td>${statusBadge}</td><td>${n.username || '-'}</td><td class="actions-cell" style="display:flex;gap:4px;flex-wrap:wrap">${reverseBtn}</td>`;
                    tbody.appendChild(tr);
                });

                // Bind reverse buttons
                tbody.querySelectorAll('.ar-note-reverse').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const id = btn.dataset.id;
                        const row = btn.closest('tr');
                        const noteNo = row?.querySelector('td')?.textContent || id;
                        const ok = window.API.showConfirm
                            ? await window.API.showConfirm(`هل أنت متأكد من عكس الإشعار ${noteNo}؟`, { confirmText: 'تأكيد', cancelText: 'إلغاء' })
                            : confirm(`هل أنت متأكد من عكس الإشعار ${noteNo}؟`);
                        if (!ok) return;
                        btn.disabled = true;
                        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
                        try {
                            const r = await window.API.reverseARNote(id);
                            if (r.success) {
                                window.API.showAlert ? window.API.showAlert('تم عكس الإشعار بنجاح', { type: 'success' }) : alert('تم عكس الإشعار بنجاح');
                                load();
                            } else {
                                window.API.showAlert ? window.API.showAlert('خطأ: ' + (r.message || ''), { type: 'error' }) : alert('خطأ: ' + (r.message || ''));
                                btn.disabled = false;
                                btn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> عكس';
                            }
                        } catch (e) {
                            window.API.showAlert ? window.API.showAlert('خطأ: ' + (e.message || ''), { type: 'error' }) : alert('خطأ: ' + (e.message || ''));
                            btn.disabled = false;
                            btn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> عكس';
                        }
                    });
                });
            }
        } catch(e) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center text-danger" style="padding:20px">' + (e.message || 'خطأ') + '</td></tr>';
            console.error(e);
        }
    }

    await load();

    // Bind filter events
    ['ar-notice-search', 'ar-notice-type-filter', 'ar-notice-status-filter', 'ar-notice-from', 'ar-notice-to'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.dataset.bound) { el.dataset.bound = '1'; el.addEventListener('change', load); if (el.tagName === 'INPUT' && el.type !== 'date') el.addEventListener('input', load); }
    });

    // Bind new note button
    const btnNew = document.getElementById('btn-ar-notice-new');
    if (btnNew && !btnNew.dataset.bound) {
        btnNew.dataset.bound = '1';
        btnNew.addEventListener('click', () => openArNoteModal());
    }
};

// ---- AR Note Modal ----
function openArNoteModal() {
    const modal = document.getElementById('global-modal');
    if (!modal) return;
    document.getElementById('modal-title').textContent = 'إشعار خصم / إضافة جديد';
    document.getElementById('modal-body').innerHTML = `
        <div class="form-grid">
            <div class="form-group"><label>العميل <span class="required">*</span></label><select id="modal-ar-note-cust" style="width:100%"><option value="">-- اختر العميل --</option></select></div>
            <div class="form-group"><label>التاريخ</label><input type="date" id="modal-ar-note-date"></div>
            <div class="form-group"><label>النوع <span class="required">*</span></label><select id="modal-ar-note-type"><option value="debit">إشعار خصم (Debit)</option><option value="credit">إشعار إضافة (Credit)</option></select></div>
            <div class="form-group"><label>القيمة <span class="required">*</span></label><input type="number" id="modal-ar-note-amount" min="0" step="0.01"></div>
            <div class="form-group" style="grid-column:span 2"><label>السبب</label><input type="text" id="modal-ar-note-reason" placeholder "سبب الإشعار"></div>
            <div class="form-group" style="grid-column:span 2"><label>ملاحظات</label><textarea id="modal-ar-note-notes" rows="3" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px"></textarea></div>
        </div>`;

    window.API.getCustomers().then(r => {
        const sel = document.getElementById('modal-ar-note-cust');
        if (sel && r.data) {
            (r.data || []).forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = c.customer_name;
                sel.appendChild(opt);
            });
        }
    });

    document.getElementById('modal-ar-note-date').value = new Date().toISOString().slice(0, 10);

    const saveBtn = document.getElementById('btn-modal-save');
    if (saveBtn) saveBtn.style.display = '';
    if (saveBtn) saveBtn.onclick = async () => {
        const payload = {
            customer_id: document.getElementById('modal-ar-note-cust').value,
            note_type: document.getElementById('modal-ar-note-type').value,
            amount: document.getElementById('modal-ar-note-amount').value,
            reason: document.getElementById('modal-ar-note-reason').value,
            notes: document.getElementById('modal-ar-note-notes').value,
            note_date: document.getElementById('modal-ar-note-date').value
        };
        if (!payload.customer_id || !payload.amount) { alert('اختر العميل وأدخل القيمة'); return; }
        const orig = saveBtn.innerHTML;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';
        saveBtn.disabled = true;
        const r = await window.API.createARNote(payload);
        saveBtn.innerHTML = orig;
        saveBtn.disabled = false;
        if (r.success) {
            modal.classList.remove('active');
            window.initArNotice();
            window.API.showAlert ? window.API.showAlert('تم إنشاء الإشعار بنجاح', { type: 'success' }) : alert('تم إنشاء الإشعار بنجاح');
        } else {
            window.API.showAlert ? window.API.showAlert('خطأ: ' + (r.message || ''), { type: 'error' }) : alert('خطأ: ' + (r.message || ''));
        }
    };
    modal.classList.add('active');
}

window.initArMatching = async function() {
    const customerSel = document.getElementById('ar-matching-customer');
    if (!customerSel) return;
    if (customerSel.dataset.bound) return;
    customerSel.dataset.bound = '1';

    let paymentsData = [];
    let invoicesData = [];
    let allocCount = 0;

    // ---- Load customers ----
    try {
        const res = await window.API.getARMatchingCustomers();
        if (res && res.data) {
            res.data.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.innerHTML = c.customer_name + (c.current_balance ? ' (رصيد: ' + window.formatMoney(c.current_balance) + ')' : '');
                customerSel.appendChild(opt);
            });
        }
    } catch (e) { console.error('Load matching customers error:', e); }

    function fm(v) { return window.formatMoney ? window.formatMoney(Number(v || 0)) : Number(v || 0).toFixed(2); }

    function updateAllocSummary() {
        const rows = document.querySelectorAll('#ar-matching-alloc-tbody tr.alloc-row');
        const byPayment = {};
        const byInvoice = {};
        let totalAlloc = 0;

        rows.forEach(tr => {
            const paySelect = tr.querySelector('.alloc-pay');
            const invSelect = tr.querySelector('.alloc-inv');
            const amtInput = tr.querySelector('.alloc-amt');
            if (!paySelect || !invSelect || !amtInput) return;
            const pid = paySelect.value;
            const iid = invSelect.value;
            const amt = parseFloat(amtInput.value) || 0;
            if (!pid || !iid) return;
            byPayment[pid] = (byPayment[pid] || 0) + amt;
            byInvoice[iid] = (byInvoice[iid] || 0) + amt;
            totalAlloc += amt;
        });

        // Update payment rows
        document.querySelectorAll('#ar-matching-payments-tbody tr.pay-row').forEach(tr => {
            const pid = tr.dataset.payId;
            const allocated = byPayment[pid] || 0;
            const unallocated = parseFloat(tr.dataset.payUnallocated) || 0;
            const remaining = unallocated - allocated;
            const willTd = tr.querySelector('.pay-will-alloc');
            if (willTd) willTd.innerHTML = fm(allocated);
            const remTd = tr.querySelector('.pay-remaining');
            if (remTd) { remTd.innerHTML = fm(Math.max(remaining, 0)); remTd.className = remaining < 0 ? 'text-danger' : ''; }
        });

        // Update invoice rows
        document.querySelectorAll('#ar-matching-invoices-tbody tr.inv-row').forEach(tr => {
            const iid = tr.dataset.invId;
            const allocated = byInvoice[iid] || 0;
            const remaining = parseFloat(tr.dataset.invRemaining) || 0;
            const newRemaining = remaining - allocated;
            const willTd = tr.querySelector('.inv-will-alloc');
            if (willTd) willTd.innerHTML = fm(allocated);
            const remTd = tr.querySelector('.inv-remaining');
            if (remTd) { remTd.innerHTML = fm(Math.max(newRemaining, 0)); remTd.className = newRemaining < 0 ? 'text-danger' : ''; }
        });

        // Summary bar
        const totalPayments = paymentsData.reduce((s, p) => s + parseFloat(p.unallocated || 0), 0);
        const totalInvoices = invoicesData.reduce((s, p) => s + parseFloat(p.remaining || 0), 0);
        document.getElementById('ar-matching-total-alloc').innerHTML = fm(totalAlloc) + ' ج.م';
        document.getElementById('ar-matching-remaining-payments').innerHTML = fm(totalPayments - totalAlloc) + ' ج.م';
        document.getElementById('ar-matching-remaining-invoices').innerHTML = fm(totalInvoices - totalAlloc) + ' ج.م';

        // Enable/disable save
        const saveBtn = document.getElementById('btn-ar-matching-save');
        if (saveBtn) {
            const hasRows = rows.length > 0 && totalAlloc > 0;
            saveBtn.disabled = !hasRows;
        }
    }

    function addAllocRow(paymentId, invoiceId, amount) {
        const tbody = document.getElementById('ar-matching-alloc-tbody');
        if (!tbody) return;
        if (tbody.querySelector('td[colspan]')) tbody.innerHTML = '';

        allocCount++;
        const tr = document.createElement('tr');
        tr.className = 'alloc-row';
        const uid = 'alloc_' + allocCount;

        // Payment dropdown
        const payHtml = '<select class="alloc-pay" style="width:100%;padding:4px;border:1px solid #ddd;border-radius:4px;font-size:13px">' +
            paymentsData.map(p => `<option value="${p.id}" ${String(p.id) === String(paymentId) ? 'selected' : ''}>${p.payment_no}</option>`).join('') +
            '</select>';

        // Invoice dropdown
        const invHtml = '<select class="alloc-inv" style="width:100%;padding:4px;border:1px solid #ddd;border-radius:4px;font-size:13px">' +
            invoicesData.map(i => `<option value="${i.id}" ${String(i.id) === String(invoiceId) ? 'selected' : ''}>${i.invoice_no}</option>`).join('') +
            '</select>';

        tr.innerHTML = `<td>${payHtml}</td><td>${invHtml}</td><td><input type="number" class="alloc-amt" value="${amount || ''}" min="0" step="0.01" style="width:120px;padding:4px;border:1px solid #ddd;border-radius:4px;text-align:center"></td><td><button class="icon-btn alloc-del" title="حذف" style="color:var(--danger-color)"><i class="fa-solid fa-trash-can"></i></button></td>`;
        tbody.appendChild(tr);

        // Event listeners
        tr.querySelector('.alloc-pay').addEventListener('change', updateAllocSummary);
        tr.querySelector('.alloc-inv').addEventListener('change', updateAllocSummary);
        tr.querySelector('.alloc-amt').addEventListener('input', updateAllocSummary);
        tr.querySelector('.alloc-del').addEventListener('click', () => {
            tr.remove();
            if (!tbody.querySelector('tr.alloc-row')) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center" style="padding:20px;color:var(--text-muted)">لم يتم إضافة توزيعات بعد</td></tr>';
            }
            updateAllocSummary();
        });

        updateAllocSummary();
    }

    async function loadMatchingData() {
        const cid = customerSel.value;
        if (!cid) { window.API.showAlert ? window.API.showAlert('اختر العميل أولاً', { type: 'warning' }) : alert('اختر العميل أولاً'); return; }

        try {
            const res = await window.API.getARMatchingData(cid);
            if (!res || !res.data) return;
            paymentsData = res.data.payments || [];
            invoicesData = res.data.invoices || [];

            // Render payments
            const payTbody = document.getElementById('ar-matching-payments-tbody');
            if (payTbody) {
                payTbody.innerHTML = '';
                if (paymentsData.length === 0) {
                    payTbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding:20px;color:var(--text-muted)">لا توجد دفعات غير موزعة</td></tr>';
                } else {
                    paymentsData.forEach(p => {
                        const tr = document.createElement('tr');
                        tr.className = 'pay-row';
                        tr.dataset.payId = p.id;
                        tr.dataset.payUnallocated = p.unallocated;
                        tr.innerHTML = `<td><strong>${p.payment_no}</strong></td><td>${p.payment_date}</td><td>${fm(p.amount)}</td><td>${fm(p.unallocated)}</td><td class="pay-will-alloc">0</td><td class="pay-remaining">${fm(p.unallocated)}</td>`;
                        payTbody.appendChild(tr);
                    });
                }
            }

            // Render invoices
            const invTbody = document.getElementById('ar-matching-invoices-tbody');
            if (invTbody) {
                invTbody.innerHTML = '';
                if (invoicesData.length === 0) {
                    invTbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding:20px;color:var(--text-muted)">لا توجد فواتير غير مسددة</td></tr>';
                } else {
                    invoicesData.forEach(i => {
                        const tr = document.createElement('tr');
                        tr.className = 'inv-row';
                        tr.dataset.invId = i.id;
                        tr.dataset.invRemaining = i.remaining;
                        tr.innerHTML = `<td><strong>${i.invoice_no}</strong></td><td>${i.invoice_date}</td><td>${fm(i.grand_total)}</td><td>${fm(i.remaining)}</td><td class="inv-will-alloc">0</td><td class="inv-remaining">${fm(i.remaining)}</td>`;
                        invTbody.appendChild(tr);
                    });
                }
            }

            // Clear allocation grid
            const allocTbody = document.getElementById('ar-matching-alloc-tbody');
            if (allocTbody) allocTbody.innerHTML = '<tr><td colspan="4" class="text-center" style="padding:20px;color:var(--text-muted)">لم يتم إضافة توزيعات بعد</td></tr>';

            // Enable add-row button
            const addBtn = document.getElementById('btn-ar-matching-add-row');
            if (addBtn) addBtn.disabled = (paymentsData.length === 0 || invoicesData.length === 0);

            updateAllocSummary();
        } catch (e) {
            console.error('Load matching data error:', e);
            window.API.showAlert ? window.API.showAlert('خطأ في تحميل البيانات: ' + (e.message || ''), { type: 'error' }) : alert('خطأ في تحميل البيانات');
        }
    }

    // ---- Event handlers ----
    document.getElementById('btn-ar-matching-load')?.addEventListener('click', loadMatchingData);

    document.getElementById('btn-ar-matching-add-row')?.addEventListener('click', () => addAllocRow('', '', ''));

    document.getElementById('btn-ar-matching-save')?.addEventListener('click', async () => {
        const cid = customerSel.value;
        if (!cid) return;

        const rows = document.querySelectorAll('#ar-matching-alloc-tbody tr.alloc-row');
        const allocations = [];
        for (const tr of rows) {
            const paySelect = tr.querySelector('.alloc-pay');
            const invSelect = tr.querySelector('.alloc-inv');
            const amtInput = tr.querySelector('.alloc-amt');
            const pid = paySelect?.value;
            const iid = invSelect?.value;
            const amt = parseFloat(amtInput?.value) || 0;
            if (pid && iid && amt > 0) {
                allocations.push({ payment_id: parseInt(pid), invoice_id: parseInt(iid), allocated_amount: amt });
            }
        }

        if (allocations.length === 0) {
            window.API.showAlert ? window.API.showAlert('يرجى إضافة توزيعات صالحة', { type: 'warning' }) : alert('يرجى إضافة توزيعات صالحة');
            return;
        }

        const saveBtn = document.getElementById('btn-ar-matching-save');
        const origHtml = saveBtn.innerHTML;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';
        saveBtn.disabled = true;

        try {
            const res = await window.API.saveARMatching({ customer_id: parseInt(cid), allocations });
            if (res.success) {
                window.API.showAlert ? window.API.showAlert('تم حفظ المطابقة بنجاح', { type: 'success' }) : alert('تم حفظ المطابقة بنجاح');
                loadMatchingData();
            } else {
                window.API.showAlert ? window.API.showAlert('خطأ: ' + (res.message || ''), { type: 'error' }) : alert('خطأ: ' + (res.message || ''));
            }
        } catch (e) {
            console.error('Save matching error:', e);
            window.API.showAlert ? window.API.showAlert('خطأ في حفظ المطابقة: ' + (e.message || ''), { type: 'error' }) : alert('خطأ في حفظ المطابقة');
        } finally {
            saveBtn.innerHTML = origHtml;
            saveBtn.disabled = false;
        }
    });
};

window.initApPayment = async function() {
    const tbody = document.getElementById('ap-payment-tbody');
    if (!tbody) return;
    const now = new Date();
    const fromInput = document.getElementById('ap-payment-from');
    const toInput = document.getElementById('ap-payment-to');
    if (fromInput && !fromInput.value) fromInput.value = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
    if (toInput && !toInput.value) toInput.value = now.toISOString().slice(0, 10);

    async function load() {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding:20px"><i class="fa-solid fa-spinner fa-spin"></i></td></tr>';
        try {
            const params = {};
            const q = document.getElementById('ap-payment-search')?.value;
            const from = document.getElementById('ap-payment-from')?.value;
            const to = document.getElementById('ap-payment-to')?.value;
            if (q) params.q = q;
            if (from) params.from = from;
            if (to) params.to = to;
            const res = await window.API.getAPPayments(params);
            const data = res.data || [];
            tbody.innerHTML = '';
            if (data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding:30px;color:var(--text-muted)">لا توجد دفعات في الفترة</td></tr>';
            } else {
                data.forEach(p => {
                    const methodBadge = p.payment_method === 'cash' ? '<span class="badge-status paid">نقدي</span>' : p.payment_method === 'check' ? '<span class="badge-status pending">شيك</span>' : '<span class="badge-status" style="background:var(--info-color)">تحويل</span>';
                    const statusBadge = p.status === 'active' ? '<span class="badge-status paid">نشط</span>' : '<span class="badge-status" style="background:#dc2626;">ملغي</span>';
                    const tr = document.createElement('tr');
                    tr.innerHTML = `<td><strong>${p.payment_no || '-'}</strong></td><td>${p.payment_date || '-'}</td><td>${p.supplier_name || '-'}</td><td class="text-danger"><strong>${window.formatMoney(p.amount)} ج.م</strong></td><td>${methodBadge}</td><td>${statusBadge}</td><td class="actions-cell">
                        <button class="icon-btn" onclick="window.API.openApPaymentPrint(${p.id})" title="معاينة وطباعة"><i class="fa-solid fa-print"></i></button>
                        ${p.status === 'active' ? `<button class="icon-btn text-danger" onclick="window.deleteAPPayment(${p.id})" title="إلغاء السند"><i class="fa-solid fa-trash"></i></button>` : ''}
                    </td>`;
                    tbody.appendChild(tr);
                });
            }
            const monthTotal = data.filter(p => { const d = new Date(p.payment_date); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); }).reduce((s, p) => s + Number(p.amount || 0), 0);
            const st = (id, val) => { const e = document.getElementById(id); if (e) e.innerHTML = val; };
            st('ap-payment-month-total', window.formatMoney(monthTotal) + ' ج.م');
            st('ap-payment-count', String(data.length));
        } catch(e) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-danger" style="padding:20px">' + (e.message || 'خطأ') + '</td></tr>';
            console.error(e);
        }
    }
    await load();
    ['ap-payment-search', 'ap-payment-from', 'ap-payment-to'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.dataset.bound) { el.dataset.bound = '1'; el.addEventListener('input', load); }
    });
    const btnNew = document.getElementById('btn-ap-payment-new');
    if (btnNew && !btnNew.dataset.bound) {
        btnNew.dataset.bound = '1';
        btnNew.addEventListener('click', () => openApPaymentModal());
    }
};

window.deleteAPPayment = async function(id) {
    if (typeof window.showConfirm === 'function') {
        const confirmed = await window.showConfirm('هل أنت متأكد من إلغاء سند الدفع؟ سيتم عكس القيود المحاسبية وإرجاع المديونية للمورد.');
        if (confirmed) doDelete(id);
    } else if (confirm('هل أنت متأكد من إلغاء سند الدفع؟')) {
        doDelete(id);
    }

    async function doDelete(paymentId) {
        try {
            const res = await window.API.reverseAPPayment(paymentId);
            if (res.success) {
                if (window.showAlert) window.showAlert('تم إلغاء سند الدفع وعكس القيود بنجاح', {type: 'success'});
                else alert('تم إلغاء سند الدفع بنجاح');
                window.initApPayment();
            } else {
                if (window.showAlert) window.showAlert(res.message || 'خطأ في الإلغاء', {type: 'danger'});
                else alert(res.message || 'خطأ في الإلغاء');
            }
        } catch(e) {
            console.error(e);
            if (window.showAlert) window.showAlert(e.message || 'حدث خطأ في الاتصال بالسيرفر', {type: 'danger'});
            else alert(e.message || 'حدث خطأ');
        }
    }
};

function openApPaymentModal() {
    const modal = document.getElementById('global-modal');
    if (!modal) return;
    document.getElementById('modal-title').textContent = 'تسديد فاتورة مورد - سند صرف جديد';
    document.getElementById('modal-body').innerHTML = `
        <div class="form-grid">
            <div class="form-group"><label>رقم السند</label><input type="text" id="modal-ap-pay-no" placeholder="تلقائي إذا ترك فارغاً"></div>
            <div class="form-group"><label>المورد <span class="required">*</span></label><select id="modal-ap-pay-supplier" style="width:100%"><option value="">-- اختر المورد --</option></select></div>
            <div class="form-group"><label>التاريخ <span class="required">*</span></label><input type="date" id="modal-ap-pay-date"></div>
            <div class="form-group"><label>المبلغ <span class="required">*</span></label><input type="number" id="modal-ap-pay-amount" min="0" step="0.01"></div>
            <div class="form-group"><label>طريقة الدفع</label><select id="modal-ap-pay-method"><option value="cash">نقدي</option><option value="check">شيك</option><option value="transfer">تحويل بنكي</option></select></div>
            <div class="form-group ap-check-field" style="display:none"><label>رقم الشيك</label><input type="text" id="modal-ap-pay-chkno"></div>
            <div class="form-group ap-check-field" style="display:none"><label>تاريخ الشيك</label><input type="date" id="modal-ap-pay-chkdate"></div>
            <div class="form-group ap-check-field" style="display:none"><label>البنك</label><input type="text" id="modal-ap-pay-bank"></div>
            <div class="form-group" style="grid-column:span 2"><label>ملاحظات</label><input type="text" id="modal-ap-pay-notes"></div>
        </div>`;

    window.API.getSuppliers({active: '1'}).then(r => {
        const sel = document.getElementById('modal-ap-pay-supplier');
        if (sel && r.data) {
            (r.data || []).forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.id;
                opt.textContent = s.supplier_name;
                sel.appendChild(opt);
            });
        }
    });

    document.getElementById('modal-ap-pay-date').value = new Date().toISOString().slice(0, 10);

    const methodSel = document.getElementById('modal-ap-pay-method');
    methodSel.addEventListener('change', () => {
        const isCheck = methodSel.value === 'check';
        document.querySelectorAll('.ap-check-field').forEach(el => el.style.display = isCheck ? '' : 'none');
    });

    const saveBtn = document.getElementById('btn-modal-save');
    if (saveBtn) saveBtn.style.display = '';
    if (saveBtn) saveBtn.onclick = async () => {
        const payload = {
            payment_no: document.getElementById('modal-ap-pay-no').value,
            supplier_id: document.getElementById('modal-ap-pay-supplier').value,
            payment_date: document.getElementById('modal-ap-pay-date').value,
            amount: document.getElementById('modal-ap-pay-amount').value,
            payment_method: methodSel.value,
            check_no: document.getElementById('modal-ap-pay-chkno').value,
            check_date: document.getElementById('modal-ap-pay-chkdate').value,
            bank_name: document.getElementById('modal-ap-pay-bank').value,
            notes: document.getElementById('modal-ap-pay-notes').value
        };
        if (!payload.supplier_id || !payload.amount) { alert('اختر المورد وأدخل المبلغ'); return; }
        const orig = saveBtn.innerHTML;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';
        saveBtn.disabled = true;
        const r = await window.API.request('/ap/payments', 'POST', payload);
        saveBtn.innerHTML = orig;
        saveBtn.disabled = false;
        if (r.success) {
            modal.classList.remove('active');
            window.initApPayment();
            alert('تم تسجيل سند الصرف بنجاح');
        } else {
            alert('خطأ: ' + (r.message || ''));
        }
    };
    modal.classList.add('active');
}

window.initApCheques = async function() {
    const tbody = document.getElementById('ap-cheque-tbody');
    if (!tbody) return;
    const filter = document.getElementById('ap-cheque-status-filter');
    async function load() {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="padding:20px"><i class="fa-solid fa-spinner fa-spin"></i></td></tr>';
        try {
            const params = {};
            if (filter && filter.value) params.status = filter.value;
            const res = await window.API.getAPCheques(params);
            const data = res.data || [];
            tbody.innerHTML = '';
            if (data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="padding:30px;color:var(--text-muted)">لا توجد شيكات</td></tr>';
            } else {
                const statusLabels = { issued: 'مصدر', cleared: 'مصفي', returned: 'مرتجع', cancelled: 'ملغي' };
                data.forEach(ch => {
                    const tr = document.createElement('tr');
                    let actions = '';
                    if (ch.status === 'issued') {
                        actions = `
                            <button class="icon-btn action-clear" title="تصفية" style="color:var(--success-color)"><i class="fa-solid fa-check"></i></button>
                            <button class="icon-btn action-return" title="إرجاع" style="color:var(--warning-color)"><i class="fa-solid fa-rotate-left"></i></button>
                            <button class="icon-btn action-cancel" title="إلغاء" style="color:var(--danger-color)"><i class="fa-solid fa-ban"></i></button>
                        `;
                    } else {
                        actions = `<button class="icon-btn" title="عرض"><i class="fa-solid fa-eye"></i></button>`;
                    }
                    tr.innerHTML = `<td><strong>${ch.cheque_no}</strong></td><td>${ch.cheque_date}</td><td>${ch.due_date || '-'}</td><td>${ch.supplier_name || '-'}</td><td class="text-danger"><strong>${window.formatMoney(ch.amount)} ج.م</strong></td><td>${ch.bank_name || '-'}</td><td><span class="badge-status ${ch.status === 'cleared' ? 'paid' : (ch.status === 'returned' || ch.status === 'cancelled' ? '' : 'pending')}">${statusLabels[ch.status] || ch.status}</span></td><td class="actions-cell">${actions}</td>`;
                    tbody.appendChild(tr);

                    if (ch.status === 'issued') {
                        tr.querySelector('.action-clear')?.addEventListener('click', async () => {
                            if (!confirm(`تصفية شيك ${ch.cheque_no} بقيمة ${window.formatMoney(ch.amount)} ج.م؟`)) return;
                            try {
                                const r = await window.API.clearAPCheque(ch.id);
                                if (r.success) {
                                    window.API.showAlert ? window.API.showAlert('تمت تصفية الشيك بنجاح', { type: 'success' }) : alert('تمت تصفية الشيك بنجاح');
                                    load();
                                } else {
                                    window.API.showAlert ? window.API.showAlert('خطأ: ' + (r.message || ''), { type: 'error' }) : alert('خطأ: ' + (r.message || ''));
                                }
                            } catch(e) {
                                window.API.showAlert ? window.API.showAlert('خطأ: ' + (e.message || ''), { type: 'error' }) : alert('خطأ: ' + (e.message || ''));
                            }
                        });
                        tr.querySelector('.action-return')?.addEventListener('click', async () => {
                            if (!confirm(`إرجاع شيك ${ch.cheque_no} بقيمة ${window.formatMoney(ch.amount)} ج.م؟ سيؤدي ذلك إلى عكس الدفعة بالكامل.`)) return;
                            try {
                                const r = await window.API.returnAPCheque(ch.id);
                                if (r.success) {
                                    window.API.showAlert ? window.API.showAlert('تم إرجاع الشيك وعكس الدفعة', { type: 'success' }) : alert('تم إرجاع الشيك وعكس الدفعة');
                                    load();
                                } else {
                                    window.API.showAlert ? window.API.showAlert('خطأ: ' + (r.message || ''), { type: 'error' }) : alert('خطأ: ' + (r.message || ''));
                                }
                            } catch(e) {
                                window.API.showAlert ? window.API.showAlert('خطأ: ' + (e.message || ''), { type: 'error' }) : alert('خطأ: ' + (e.message || ''));
                            }
                        });
                        tr.querySelector('.action-cancel')?.addEventListener('click', async () => {
                            if (!confirm(`إلغاء شيك ${ch.cheque_no} بقيمة ${window.formatMoney(ch.amount)} ج.م؟ سيؤدي ذلك إلى عكس الدفعة بالكامل.`)) return;
                            try {
                                const r = await window.API.cancelAPCheque(ch.id);
                                if (r.success) {
                                    window.API.showAlert ? window.API.showAlert('تم إلغاء الشيك وعكس الدفعة', { type: 'success' }) : alert('تم إلغاء الشيك وعكس الدفعة');
                                    load();
                                } else {
                                    window.API.showAlert ? window.API.showAlert('خطأ: ' + (r.message || ''), { type: 'error' }) : alert('خطأ: ' + (r.message || ''));
                                }
                            } catch(e) {
                                window.API.showAlert ? window.API.showAlert('خطأ: ' + (e.message || ''), { type: 'error' }) : alert('خطأ: ' + (e.message || ''));
                            }
                        });
                    }
                });
            }
        } catch(e) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center text-danger" style="padding:20px">' + (e.message || 'خطأ') + '</td></tr>';
            console.error(e);
        }
    }
    await load();
    if (filter && !filter.dataset.bound) { filter.dataset.bound = '1'; filter.addEventListener('change', load); }

    const btnNew = document.getElementById('btn-ap-cheque-new');
    if (btnNew && !btnNew.dataset.bound) {
        btnNew.dataset.bound = '1';
        btnNew.addEventListener('click', () => openApChequeForm());
    }
};

window.openApChequeForm = function() {
    const modal = document.getElementById('global-modal');
    if (!modal) return;
    document.getElementById('modal-title').textContent = 'شيك مورد جديد';
    document.getElementById('modal-body').innerHTML = `
        <div class="form-grid">
            <div class="form-group"><label>رقم الشيك <span class="required">*</span></label><input type="text" id="modal-ap-chq-no" placeholder="أدخل رقم الشيك"></div>
            <div class="form-group"><label>المورد <span class="required">*</span></label><select id="modal-ap-chq-supplier" style="width:100%"><option value="">-- اختر المورد --</option></select></div>
            <div class="form-group"><label>تاريخ الشيك <span class="required">*</span></label><input type="date" id="modal-ap-chq-date"></div>
            <div class="form-group"><label>تاريخ الاستحقاق</label><input type="date" id="modal-ap-chq-due"></div>
            <div class="form-group"><label>المبلغ (ج.م) <span class="required">*</span></label><input type="number" id="modal-ap-chq-amount" min="0" step="0.01"></div>
            <div class="form-group"><label>البنك</label><input type="text" id="modal-ap-chq-bank" placeholder="اسم البنك"></div>
            <div class="form-group" style="grid-column:span 2"><label>ملاحظات</label><input type="text" id="modal-ap-chq-notes" placeholder="ملاحظات اختيارية"></div>
        </div>`;

    document.getElementById('modal-ap-chq-date').value = new Date().toISOString().slice(0, 10);

    window.API.getSuppliers({active: '1'}).then(r => {
        const sel = document.getElementById('modal-ap-chq-supplier');
        if (sel && r.data) {
            (r.data || []).forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.id;
                opt.textContent = s.supplier_name;
                sel.appendChild(opt);
            });
        }
    });

    const saveBtn = document.getElementById('btn-modal-save');
    if (saveBtn) saveBtn.style.display = '';
    if (saveBtn) saveBtn.onclick = async () => {
        const payload = {
            cheque_no: document.getElementById('modal-ap-chq-no').value.trim(),
            supplier_id: document.getElementById('modal-ap-chq-supplier').value,
            cheque_date: document.getElementById('modal-ap-chq-date').value,
            due_date: document.getElementById('modal-ap-chq-due').value || null,
            amount: document.getElementById('modal-ap-chq-amount').value,
            bank_name: document.getElementById('modal-ap-chq-bank').value.trim(),
            notes: document.getElementById('modal-ap-chq-notes').value.trim()
        };
        if (!payload.cheque_no) { alert('رقم الشيك مطلوب'); return; }
        if (!payload.supplier_id) { alert('اختر المورد'); return; }
        if (!payload.amount || parseFloat(payload.amount) <= 0) { alert('أدخل مبلغ صحيح'); return; }
        const orig = saveBtn.innerHTML;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';
        saveBtn.disabled = true;
        try {
            const r = await window.API.createAPCheque(payload);
            saveBtn.innerHTML = orig;
            saveBtn.disabled = false;
            if (r.success) {
                modal.classList.remove('active');
                window.initApCheques();
            } else {
                alert('خطأ: ' + (r.message || ''));
            }
        } catch(e) {
            saveBtn.innerHTML = orig;
            saveBtn.disabled = false;
            alert('خطأ: ' + (e.message || ''));
        }
    };
    modal.classList.add('active');
};

window.initApNotice = async function() {
    const tbody = document.getElementById('ap-notice-tbody');
    if (!tbody) return;

    async function load() {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center" style="padding:20px"><i class="fa-solid fa-spinner fa-spin"></i></td></tr>';
        try {
            const params = {};
            const q = document.getElementById('ap-notice-search')?.value;
            const typeFilter = document.getElementById('ap-notice-type-filter')?.value;
            const statusFilter = document.getElementById('ap-notice-status-filter')?.value;
            const from = document.getElementById('ap-notice-from')?.value;
            const to = document.getElementById('ap-notice-to')?.value;
            if (q) params.q = q;
            if (typeFilter) params.note_type = typeFilter;
            if (statusFilter) params.status = statusFilter;
            if (from) params.from = from;
            if (to) params.to = to;
            const res = await window.API.getAPNotes(params);
            const data = res.data || [];
            tbody.innerHTML = '';
            if (data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="9" class="text-center" style="padding:30px;color:var(--text-muted)">لا توجد إشعارات</td></tr>';
            } else {
                data.forEach(n => {
                    const typeBadge = n.note_type === 'debit' ? '<span class="badge-status" style="background:var(--danger-color)">خصم</span>' : '<span class="badge-status paid">إضافة</span>';
                    const statusBadge = n.status === 'active' ? '<span class="badge-status paid">نشط</span>' : '<span class="badge-status" style="background:#888;">ملغي</span>';
                    const amountCls = n.note_type === 'debit' ? 'text-danger' : 'text-success';
                    const canReverse = n.status === 'active';
                    const reverseBtn = canReverse
                        ? `<button class="btn btn-sm btn-danger ap-note-reverse" data-id="${n.id}" title="عكس الإشعار"><i class="fa-solid fa-rotate-left"></i> عكس</button>`
                        : '';
                    const tr = document.createElement('tr');
                    tr.innerHTML = `<td><strong>${n.note_no}</strong></td><td>${n.note_date}</td><td>${n.supplier_name || '-'}</td><td>${typeBadge}</td><td class="${amountCls}"><strong>${window.formatMoney(n.amount)} ج.م</strong></td><td>${n.reason || '-'}</td><td>${statusBadge}</td><td>${n.username || '-'}</td><td class="actions-cell" style="display:flex;gap:4px;flex-wrap:wrap">${reverseBtn}</td>`;
                    tbody.appendChild(tr);
                });

                tbody.querySelectorAll('.ap-note-reverse').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const id = btn.dataset.id;
                        const row = btn.closest('tr');
                        const noteNo = row?.querySelector('td')?.textContent || id;
                        const ok = window.API.showConfirm
                            ? await window.API.showConfirm(`هل أنت متأكد من عكس الإشعار ${noteNo}؟`, { confirmText: 'تأكيد', cancelText: 'إلغاء' })
                            : confirm(`هل أنت متأكد من عكس الإشعار ${noteNo}؟`);
                        if (!ok) return;
                        btn.disabled = true;
                        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
                        try {
                            const r = await window.API.reverseAPNote(id);
                            if (r.success) {
                                window.API.showAlert ? window.API.showAlert('تم عكس الإشعار بنجاح', { type: 'success' }) : alert('تم عكس الإشعار بنجاح');
                                load();
                            } else {
                                window.API.showAlert ? window.API.showAlert('خطأ: ' + (r.message || ''), { type: 'error' }) : alert('خطأ: ' + (r.message || ''));
                                btn.disabled = false;
                                btn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> عكس';
                            }
                        } catch (e) {
                            window.API.showAlert ? window.API.showAlert('خطأ: ' + (e.message || ''), { type: 'error' }) : alert('خطأ: ' + (e.message || ''));
                            btn.disabled = false;
                            btn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> عكس';
                        }
                    });
                });
            }
        } catch(e) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center text-danger" style="padding:20px">' + (e.message || 'خطأ') + '</td></tr>';
            console.error(e);
        }
    }

    await load();

    ['ap-notice-search', 'ap-notice-type-filter', 'ap-notice-status-filter', 'ap-notice-from', 'ap-notice-to'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.dataset.bound) { el.dataset.bound = '1'; el.addEventListener('change', load); if (el.tagName === 'INPUT' && el.type !== 'date') el.addEventListener('input', load); }
    });

    const btnNew = document.getElementById('btn-ap-notice-new');
    if (btnNew && !btnNew.dataset.bound) {
        btnNew.dataset.bound = '1';
        btnNew.addEventListener('click', () => openApNoteModal());
    }
};

function openApNoteModal() {
    const modal = document.getElementById('global-modal');
    if (!modal) return;
    document.getElementById('modal-title').textContent = 'إشعار خصم / إضافة جديد للمورد';
    document.getElementById('modal-body').innerHTML = `
        <div class="form-grid">
            <div class="form-group"><label>المورد <span class="required">*</span></label><select id="modal-ap-note-supplier" style="width:100%"><option value="">-- اختر المورد --</option></select></div>
            <div class="form-group"><label>التاريخ</label><input type="date" id="modal-ap-note-date"></div>
            <div class="form-group"><label>النوع <span class="required">*</span></label><select id="modal-ap-note-type"><option value="debit">إشعار خصم (Debit)</option><option value="credit">إشعار إضافة (Credit)</option></select></div>
            <div class="form-group"><label>القيمة <span class="required">*</span></label><input type="number" id="modal-ap-note-amount" min="0" step="0.01"></div>
            <div class="form-group" style="grid-column:span 2"><label>السبب</label><input type="text" id="modal-ap-note-reason" placeholder="سبب الإشعار"></div>
            <div class="form-group" style="grid-column:span 2"><label>ملاحظات</label><textarea id="modal-ap-note-notes" rows="3" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px"></textarea></div>
        </div>`;

    window.API.getSuppliers().then(r => {
        const sel = document.getElementById('modal-ap-note-supplier');
        if (sel && r.data) {
            (r.data || []).forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.id;
                opt.textContent = s.supplier_name;
                sel.appendChild(opt);
            });
        }
    });

    document.getElementById('modal-ap-note-date').value = new Date().toISOString().slice(0, 10);

    const saveBtn = document.getElementById('btn-modal-save');
    if (saveBtn) saveBtn.style.display = '';
    if (saveBtn) saveBtn.onclick = async () => {
        const payload = {
            supplier_id: document.getElementById('modal-ap-note-supplier').value,
            note_type: document.getElementById('modal-ap-note-type').value,
            amount: document.getElementById('modal-ap-note-amount').value,
            reason: document.getElementById('modal-ap-note-reason').value,
            notes: document.getElementById('modal-ap-note-notes').value,
            note_date: document.getElementById('modal-ap-note-date').value
        };
        if (!payload.supplier_id || !payload.amount) { alert('اختر المورد وأدخل القيمة'); return; }
        const orig = saveBtn.innerHTML;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';
        saveBtn.disabled = true;
        const r = await window.API.createAPNote(payload);
        saveBtn.innerHTML = orig;
        saveBtn.disabled = false;
        if (r.success) {
            modal.classList.remove('active');
            window.initApNotice();
            window.API.showAlert ? window.API.showAlert('تم إنشاء الإشعار بنجاح', { type: 'success' }) : alert('تم إنشاء الإشعار بنجاح');
        } else {
            window.API.showAlert ? window.API.showAlert('خطأ: ' + (r.message || ''), { type: 'error' }) : alert('خطأ: ' + (r.message || ''));
        }
    };
    modal.classList.add('active');
}

window.initApMatching = async function() {
    const supplierSel = document.getElementById('ap-matching-supplier');
    if (!supplierSel) return;
    if (supplierSel.dataset.bound) return;
    supplierSel.dataset.bound = '1';

    let paymentsData = [];
    let invoicesData = [];
    let allocCount = 0;

    try {
        const res = await window.API.getAPMatchingSuppliers();
        if (res && res.data) {
            res.data.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.id;
                opt.innerHTML = s.supplier_name + (s.current_balance ? ' (رصيد: ' + window.formatMoney(s.current_balance) + ')' : '');
                supplierSel.appendChild(opt);
            });
        }
    } catch (e) { console.error('Load matching suppliers error:', e); }

    function fm(v) { return window.formatMoney ? window.formatMoney(Number(v || 0)) : Number(v || 0).toFixed(2); }

    function updateAllocSummary() {
        const rows = document.querySelectorAll('#ap-matching-alloc-tbody tr.alloc-row');
        const byPayment = {};
        const byInvoice = {};
        let totalAlloc = 0;

        rows.forEach(tr => {
            const paySelect = tr.querySelector('.alloc-pay');
            const invSelect = tr.querySelector('.alloc-inv');
            const amtInput = tr.querySelector('.alloc-amt');
            if (!paySelect || !invSelect || !amtInput) return;
            const pid = paySelect.value;
            const iid = invSelect.value;
            const amt = parseFloat(amtInput.value) || 0;
            if (!pid || !iid) return;
            byPayment[pid] = (byPayment[pid] || 0) + amt;
            byInvoice[iid] = (byInvoice[iid] || 0) + amt;
            totalAlloc += amt;
        });

        document.querySelectorAll('#ap-matching-payments-tbody tr.pay-row').forEach(tr => {
            const pid = tr.dataset.payId;
            const allocated = byPayment[pid] || 0;
            const unallocated = parseFloat(tr.dataset.payUnallocated) || 0;
            const remaining = unallocated - allocated;
            const willTd = tr.querySelector('.pay-will-alloc');
            if (willTd) willTd.innerHTML = fm(allocated);
            const remTd = tr.querySelector('.pay-remaining');
            if (remTd) { remTd.innerHTML = fm(Math.max(remaining, 0)); remTd.className = remaining < 0 ? 'text-danger' : ''; }
        });

        document.querySelectorAll('#ap-matching-invoices-tbody tr.inv-row').forEach(tr => {
            const iid = tr.dataset.invId;
            const allocated = byInvoice[iid] || 0;
            const remaining = parseFloat(tr.dataset.invRemaining) || 0;
            const newRemaining = remaining - allocated;
            const willTd = tr.querySelector('.inv-will-alloc');
            if (willTd) willTd.innerHTML = fm(allocated);
            const remTd = tr.querySelector('.inv-remaining');
            if (remTd) { remTd.innerHTML = fm(Math.max(newRemaining, 0)); remTd.className = newRemaining < 0 ? 'text-danger' : ''; }
        });

        const totalPayments = paymentsData.reduce((s, p) => s + parseFloat(p.unallocated || 0), 0);
        const totalInvoices = invoicesData.reduce((s, p) => s + parseFloat(p.remaining || 0), 0);
        document.getElementById('ap-matching-total-alloc').innerHTML = fm(totalAlloc) + ' ج.م';
        document.getElementById('ap-matching-remaining-payments').innerHTML = fm(totalPayments - totalAlloc) + ' ج.م';
        document.getElementById('ap-matching-remaining-invoices').innerHTML = fm(totalInvoices - totalAlloc) + ' ج.م';

        const saveBtn = document.getElementById('btn-ap-matching-save');
        if (saveBtn) {
            saveBtn.disabled = !(rows.length > 0 && totalAlloc > 0);
        }
    }

    function addAllocRow(paymentId, invoiceId, amount) {
        const tbody = document.getElementById('ap-matching-alloc-tbody');
        if (!tbody) return;
        if (tbody.querySelector('td[colspan]')) tbody.innerHTML = '';

        allocCount++;
        const tr = document.createElement('tr');
        tr.className = 'alloc-row';
        const uid = 'alloc_' + allocCount;

        const payHtml = '<select class="alloc-pay" style="width:100%;padding:4px;border:1px solid #ddd;border-radius:4px;font-size:13px">' +
            paymentsData.map(p => `<option value="${p.id}" ${String(p.id) === String(paymentId) ? 'selected' : ''}>${p.payment_no}</option>`).join('') +
            '</select>';

        const invHtml = '<select class="alloc-inv" style="width:100%;padding:4px;border:1px solid #ddd;border-radius:4px;font-size:13px">' +
            invoicesData.map(i => `<option value="${i.id}" ${String(i.id) === String(invoiceId) ? 'selected' : ''}>${i.invoice_no}</option>`).join('') +
            '</select>';

        tr.innerHTML = `<td>${payHtml}</td><td>${invHtml}</td><td><input type="number" class="alloc-amt" value="${amount || ''}" min="0" step="0.01" style="width:120px;padding:4px;border:1px solid #ddd;border-radius:4px;text-align:center"></td><td><button class="icon-btn alloc-del" title="حذف" style="color:var(--danger-color)"><i class="fa-solid fa-trash-can"></i></button></td>`;
        tbody.appendChild(tr);

        tr.querySelector('.alloc-pay').addEventListener('change', updateAllocSummary);
        tr.querySelector('.alloc-inv').addEventListener('change', updateAllocSummary);
        tr.querySelector('.alloc-amt').addEventListener('input', updateAllocSummary);
        tr.querySelector('.alloc-del').addEventListener('click', () => {
            tr.remove();
            if (!tbody.querySelector('tr.alloc-row')) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center" style="padding:20px;color:var(--text-muted)">لم يتم إضافة توزيعات بعد</td></tr>';
            }
            updateAllocSummary();
        });

        updateAllocSummary();
    }

    async function loadMatchingData() {
        const sid = supplierSel.value;
        if (!sid) { window.API.showAlert ? window.API.showAlert('اختر المورد أولاً', { type: 'warning' }) : alert('اختر المورد أولاً'); return; }

        try {
            const res = await window.API.getAPMatchingData(sid);
            if (!res || !res.data) return;
            paymentsData = res.data.payments || [];
            invoicesData = res.data.invoices || [];

            const payTbody = document.getElementById('ap-matching-payments-tbody');
            if (payTbody) {
                payTbody.innerHTML = '';
                if (paymentsData.length === 0) {
                    payTbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding:20px;color:var(--text-muted)">لا توجد دفعات غير موزعة</td></tr>';
                } else {
                    paymentsData.forEach(p => {
                        const tr = document.createElement('tr');
                        tr.className = 'pay-row';
                        tr.dataset.payId = p.id;
                        tr.dataset.payUnallocated = p.unallocated;
                        tr.innerHTML = `<td><strong>${p.payment_no}</strong></td><td>${p.payment_date}</td><td>${fm(p.amount)}</td><td>${fm(p.unallocated)}</td><td class="pay-will-alloc">0</td><td class="pay-remaining">${fm(p.unallocated)}</td>`;
                        payTbody.appendChild(tr);
                    });
                }
            }

            const invTbody = document.getElementById('ap-matching-invoices-tbody');
            if (invTbody) {
                invTbody.innerHTML = '';
                if (invoicesData.length === 0) {
                    invTbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding:20px;color:var(--text-muted)">لا توجد فواتير غير مسددة</td></tr>';
                } else {
                    invoicesData.forEach(i => {
                        const tr = document.createElement('tr');
                        tr.className = 'inv-row';
                        tr.dataset.invId = i.id;
                        tr.dataset.invRemaining = i.remaining;
                        tr.innerHTML = `<td><strong>${i.invoice_no}</strong></td><td>${i.invoice_date}</td><td>${fm(i.grand_total)}</td><td>${fm(i.remaining)}</td><td class="inv-will-alloc">0</td><td class="inv-remaining">${fm(i.remaining)}</td>`;
                        invTbody.appendChild(tr);
                    });
                }
            }

            const allocTbody = document.getElementById('ap-matching-alloc-tbody');
            if (allocTbody) allocTbody.innerHTML = '<tr><td colspan="4" class="text-center" style="padding:20px;color:var(--text-muted)">لم يتم إضافة توزيعات بعد</td></tr>';

            const addBtn = document.getElementById('btn-ap-matching-add-row');
            if (addBtn) addBtn.disabled = (paymentsData.length === 0 || invoicesData.length === 0);

            updateAllocSummary();
        } catch (e) {
            console.error('Load matching data error:', e);
            window.API.showAlert ? window.API.showAlert('خطأ في تحميل البيانات: ' + (e.message || ''), { type: 'error' }) : alert('خطأ في تحميل البيانات');
        }
    }

    document.getElementById('btn-ap-matching-load')?.addEventListener('click', loadMatchingData);
    document.getElementById('btn-ap-matching-add-row')?.addEventListener('click', () => addAllocRow('', '', ''));
    document.getElementById('btn-ap-matching-save')?.addEventListener('click', async () => {
        const sid = supplierSel.value;
        if (!sid) return;

        const rows = document.querySelectorAll('#ap-matching-alloc-tbody tr.alloc-row');
        const allocations = [];
        for (const tr of rows) {
            const paySelect = tr.querySelector('.alloc-pay');
            const invSelect = tr.querySelector('.alloc-inv');
            const amtInput = tr.querySelector('.alloc-amt');
            const pid = paySelect?.value;
            const iid = invSelect?.value;
            const amt = parseFloat(amtInput?.value) || 0;
            if (pid && iid && amt > 0) {
                allocations.push({ payment_id: parseInt(pid), invoice_id: parseInt(iid), allocated_amount: amt });
            }
        }

        if (allocations.length === 0) {
            window.API.showAlert ? window.API.showAlert('يرجى إضافة توزيعات صالحة', { type: 'warning' }) : alert('يرجى إضافة توزيعات صالحة');
            return;
        }

        const saveBtn = document.getElementById('btn-ap-matching-save');
        const origHtml = saveBtn.innerHTML;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';
        saveBtn.disabled = true;

        try {
            const res = await window.API.saveAPMatching({ supplier_id: parseInt(sid), allocations });
            if (res.success) {
                window.API.showAlert ? window.API.showAlert('تم حفظ المطابقة بنجاح', { type: 'success' }) : alert('تم حفظ المطابقة بنجاح');
                loadMatchingData();
            } else {
                window.API.showAlert ? window.API.showAlert('خطأ: ' + (res.message || ''), { type: 'error' }) : alert('خطأ: ' + (res.message || ''));
            }
        } catch (e) {
            console.error('Save matching error:', e);
            window.API.showAlert ? window.API.showAlert('خطأ في حفظ المطابقة: ' + (e.message || ''), { type: 'error' }) : alert('خطأ في حفظ المطابقة');
        } finally {
            saveBtn.innerHTML = origHtml;
            saveBtn.disabled = false;
        }
    });
};
