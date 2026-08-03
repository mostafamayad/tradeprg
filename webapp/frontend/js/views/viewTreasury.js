(function() {
    'use strict';
    window.viewHandlers = window.viewHandlers || {};
    const viewHandlers = window.viewHandlers;

    const req = (...args) => window.req(...args);
    const fmt = (...args) => window.fmt(...args);
    const fmtPlain = (...args) => window.fmtPlain(...args);
    const fmtInt = (...args) => window.fmtInt(...args);
    const esc = (...args) => window.esc(...args);

    viewHandlers['view-treasury'] = async function () {
        const view = document.getElementById('view-treasury');
        if (!view) return;
        console.log('[Treasury] Handler running — wiring buttons...');

        // ── Helpers ──
        async function loadAccounts() {
            const r = await req('/treasury/summary');
            if (!r.success) return;
            const d = r.data;
            const cashAcc = (d.accounts || []).filter(a => a.account_type === 'cash');
            const bankAcc = (d.accounts || []).filter(a => a.account_type === 'bank');
            const cashTotal = cashAcc.reduce((s, a) => s + Number(a.current_balance || 0), 0);
            const bankTotal = bankAcc.reduce((s, a) => s + Number(a.current_balance || 0), 0);
            const el = id => document.getElementById(id);
            if (el('treasury-cash-total')) el('treasury-cash-total').innerHTML = fmt(cashTotal) + ' ج.م';
            if (el('treasury-bank-total')) el('treasury-bank-total').innerHTML = fmt(bankTotal) + ' ج.م';
            if (el('treasury-total')) el('treasury-total').innerHTML = fmt(d.total_balance || 0) + ' ج.م';

            // Populate account filter dropdown
            const filterSel = el('treasury-account-filter');
            if (filterSel) {
                const curVal = filterSel.value;
                filterSel.innerHTML = '<option value="">كل الحسابات</option>';
                (d.accounts || []).forEach(a => {
                    const o = document.createElement('option');
                    o.value = a.id; o.textContent = a.account_name + (a.bank_name ? ' (' + a.bank_name + ')' : '');
                    filterSel.appendChild(o);
                });
                if (curVal) filterSel.value = curVal;
            }

            // Populate modal account dropdown too
            const modalSel = el('tf-account');
            if (modalSel) {
                modalSel.innerHTML = '<option value="">-- اختر الحساب --</option>';
                (d.accounts || []).forEach(a => {
                    const o = document.createElement('option');
                    o.value = a.id; o.textContent = a.account_name + (a.bank_name ? ' (' + a.bank_name + ')' : '') + ' - الرصيد: ' + fmtPlain(a.current_balance || 0);
                    modalSel.appendChild(o);
                });
            }
        }

        async function loadTransactions() {
            const tbody = document.getElementById('treasury-tbody');
            if (!tbody) return;
            const filterSel = document.getElementById('treasury-account-filter');
            const fromEl = document.getElementById('treasury-filter-from');
            const toEl = document.getElementById('treasury-filter-to');
            const params = new URLSearchParams();
            if (filterSel && filterSel.value) params.set('account_id', filterSel.value);
            if (fromEl && fromEl.value) params.set('from', fromEl.value);
            if (toEl && toEl.value) params.set('to', toEl.value);
            const qs = params.toString();
            const r = await req('/treasury/transactions' + (qs ? '?' + qs : ''));
            if (r.success) {
                tbody.innerHTML = '';
                if (!r.data || r.data.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text-muted)">لا توجد حركات</td></tr>';
                } else {
                    r.data.slice(0, 100).forEach(t => {
                        const tr = document.createElement('tr');
                        const typeLabel = t.trans_type === 'in' ? 'وارد' : 'صادر';
                        tr.innerHTML = [
                            '<td>' + esc(t.trans_date || '-') + '</td>',
                            '<td>' + esc(t.trans_no || '-') + '</td>',
                            '<td>' + esc(t.account_name || '-') + '</td>',
                            '<td>' + esc(t.description || '-') + '</td>',
                            '<td class="text-success">' + (t.trans_type === 'in' ? fmt(t.amount) : '-') + '</td>',
                            '<td class="text-danger">' + (t.trans_type === 'out' ? fmt(t.amount) : '-') + '</td>'
                        ].join('');
                        tbody.appendChild(tr);
                    });
                }
            }
        }

        function openModal(type) {
            const modal = document.getElementById('treasury-modal');
            if (!modal) { console.warn('[Treasury] Modal element missing'); return; }
            const title = document.getElementById('treasury-modal-title');
            const typeSel = document.getElementById('tf-type');
            if (title) title.textContent = type === 'in' ? 'إيداع نقدي (وارد)' : 'سحب نقدي (صادر)';
            if (typeSel) typeSel.value = type;
            const dateEl = document.getElementById('tf-date');
            if (dateEl) dateEl.value = new Date().toISOString().slice(0, 10);
            const amtEl = document.getElementById('tf-amount');
            if (amtEl) amtEl.value = '';
            const descEl = document.getElementById('tf-desc');
            if (descEl) descEl.value = '';
            const docEl = document.getElementById('tf-doc-no');
            if (docEl) docEl.value = '';
            modal.style.display = 'flex';
            modal.classList.add('active');
        }

        function closeModal() {
            const modal = document.getElementById('treasury-modal');
            if (modal) {
                modal.style.display = 'none';
                modal.classList.remove('active');
            }
        }

        // ── Wire buttons ──
        const depositBtn = document.getElementById('btn-treasury-deposit');
        const withdrawBtn = document.getElementById('btn-treasury-withdraw');
        const refreshBtn = document.getElementById('btn-treasury-refresh');

        if (depositBtn) depositBtn.onclick = function (e) { e.preventDefault(); openModal('in'); };
        if (withdrawBtn) withdrawBtn.onclick = function (e) { e.preventDefault(); openModal('out'); };
        if (refreshBtn) refreshBtn.onclick = function (e) { e.preventDefault(); loadAccounts(); loadTransactions(); };

        // Modal close buttons
        const closeBtns = document.querySelectorAll('#btn-treasury-modal-close, #btn-treasury-modal-cancel');
        closeBtns.forEach(function (b) { b.onclick = function () { closeModal(); }; });
        document.getElementById('treasury-modal').onclick = function (e) {
            if (e.target === this) closeModal();
        };

        // Save handler
        const saveBtn = document.getElementById('btn-treasury-modal-save');
        if (saveBtn) {
            saveBtn.onclick = async function () {
                const account_id = document.getElementById('tf-account')?.value;
                const trans_type = document.getElementById('tf-type')?.value;
                const trans_date = document.getElementById('tf-date')?.value;
                const amount = document.getElementById('tf-amount')?.value;
                const description = document.getElementById('tf-desc')?.value;
                const document_no = document.getElementById('tf-doc-no')?.value;

                if (!account_id) { showToast('الرجاء اختيار الحساب', 'warning'); return; }
                if (!amount || parseFloat(amount) <= 0) { showToast('الرجاء إدخال مبلغ صحيح', 'warning'); return; }

                saveBtn.disabled = true;
                saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';

                const r = await req('/treasury/transactions', 'POST', {
                    account_id: parseInt(account_id),
                    trans_type: trans_type,
                    trans_date: trans_date || undefined,
                    amount: parseFloat(amount),
                    description: description || '',
                    document_no: document_no || null
                });

                saveBtn.disabled = false;
                saveBtn.innerHTML = 'حفظ الحركة';

                if (r.success) {
                    showToast('تم تسجيل الحركة بنجاح', 'success');
                    closeModal();
                    loadAccounts();
                    loadTransactions();
                } else {
                    showToast(r.message || 'فشل في تسجيل الحركة', 'error');
                }
            };
        }

        // Filter change -> reload transactions
        const filterEls = ['treasury-account-filter', 'treasury-filter-from', 'treasury-filter-to'];
        filterEls.forEach(function (id) {
            const el = document.getElementById(id);
            if (el) el.onchange = function () { loadTransactions(); };
        });

        // ── Initial load ──
        await loadAccounts();
        await loadTransactions();
    };
})();
