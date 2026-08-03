// ============================================================
// TradePro ERP — HR Module Views (Complete)
// Employees, Payroll, Loans, Attendance, Vacations, Penalties, Rewards
// ============================================================
(function () {
    'use strict';

    function loadingMsg(el) { el.innerHTML = '<tr><td colspan="99" class="empty-table-msg"><i class="fa-solid fa-spinner fa-spin"></i> جاري التحميل...</td></tr>'; }
    function emptyMsg(el, colspan, msg) { el.innerHTML = '<tr><td colspan="' + colspan + '" class="empty-table-msg"><i class="fa-solid fa-box-open"></i> ' + msg + '</td></tr>'; }
    function esc(v) { return String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
    function today() { return new Date().toISOString().slice(0, 10); }

    function showModal(title, content, saveCallback) {
        var modal = document.getElementById('global-modal');
        if (!modal) return;
        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-body').innerHTML = content;
        var saveBtn = document.getElementById('btn-modal-save');
        saveBtn.style.display = saveCallback ? '' : 'none';
        var newSave = saveBtn.cloneNode(true);
        saveBtn.parentNode.replaceChild(newSave, saveBtn);
        if (saveCallback) newSave.addEventListener('click', saveCallback);
        modal.classList.add('active');
        document.querySelectorAll('.btn-close-modal').forEach(function (b) {
            var newB = b.cloneNode(true);
            b.parentNode.replaceChild(newB, b);
            newB.addEventListener('click', function () { modal.classList.remove('active'); });
        });
    }

    function closeModal() {
        var modal = document.getElementById('global-modal');
        if (modal) modal.classList.remove('active');
    }

    function empSelectOptions(selectedId) {
        return API.getHREmployees({ status: 'active' }).then(function (res) {
            var list = res && res.data ? res.data : [];
            return '<option value="">-- اختر الموظف --</option>' + list.map(function (e) {
                return '<option value="' + e.id + '"' + (e.id == selectedId ? ' selected' : '') + '>' + esc(e.emp_code) + ' - ' + esc(e.emp_name) + ' (' + window.formatMoney(e.basic_salary) + ' ج.م)</option>';
            }).join('');
        }).catch(function () { return '<option value="">-- لا يوجد موظفين --</option>'; });
    }

    // ═══════════════════════════════════════════════════
    // 1. EMPLOYEES (DO NOT MODIFY - WORKING 100%)
    // ═══════════════════════════════════════════════════

    async function loadHr() {
        var tbody = document.getElementById('hr-tbody');
        var statsBar = document.getElementById('hr-stats-bar');
        if (!tbody) return;
        loadingMsg(tbody);
        var results = await Promise.all([
            API.getHRStats().catch(function () { return null; }),
            API.getHREmployees().catch(function () { return null; }),
            API.getHRDepartments().catch(function () { return null; })
        ]);
        var statsRes = results[0], empRes = results[1], deptRes = results[2];
        if (statsBar && statsRes && statsRes.data) {
            var s = statsRes.data;
            statsBar.innerHTML =
                '<div class="stat-card" style="flex:1;min-width:160px;padding:16px;background:var(--card-bg);border-radius:12px;border:1px solid var(--border-color)"><div style="font-size:13px;color:var(--text-muted)">إجمالي الموظفين</div><div style="font-size:24px;font-weight:700;color:var(--primary)">' + (s.employees.total || 0) + '</div></div>' +
                '<div class="stat-card" style="flex:1;min-width:160px;padding:16px;background:var(--card-bg);border-radius:12px;border:1px solid var(--border-color)"><div style="font-size:13px;color:var(--text-muted)">الموظفين النشطين</div><div style="font-size:24px;font-weight:700;color:#10b981">' + (s.employees.active || 0) + '</div></div>' +
                '<div class="stat-card" style="flex:1;min-width:160px;padding:16px;background:var(--card-bg);border-radius:12px;border:1px solid var(--border-color)"><div style="font-size:13px;color:var(--text-muted)">السلف النشطة</div><div style="font-size:24px;font-weight:700;color:#f59e0b">' + (s.loans.total || 0) + '</div><div style="font-size:11px;color:var(--text-muted)">' + window.formatMoney(s.loans.total_amount - s.loans.total_paid) + ' ج.م متبقي</div></div>' +
                '<div class="stat-card" style="flex:1;min-width:160px;padding:16px;background:var(--card-bg);border-radius:12px;border:1px solid var(--border-color)"><div style="font-size:13px;color:var(--text-muted)">آخر مسير</div><div style="font-size:20px;font-weight:700;color:var(--primary)">' + (s.payroll.period || '-') + '</div><div style="font-size:11px;color:var(--text-muted)">' + window.formatMoney(s.payroll.total_net) + ' ج.م</div></div>';
        }
        if (deptRes && deptRes.data) {
            var deptFilter = document.getElementById('hr-dept-filter');
            if (deptFilter && deptFilter.options.length <= 1) {
                deptRes.data.forEach(function (d) { var o = document.createElement('option'); o.value = d; o.textContent = d; deptFilter.appendChild(o); });
            }
        }
        renderHrTable(empRes ? empRes.data : []);
        var searchInput = document.getElementById('hr-search');
        var statusFilter = document.getElementById('hr-status-filter');
        var deptFilterEl = document.getElementById('hr-dept-filter');
        var debounce;
        function reloadFiltered() {
            clearTimeout(debounce);
            debounce = setTimeout(async function () {
                var params = {};
                if (searchInput && searchInput.value) params.q = searchInput.value;
                if (statusFilter && statusFilter.value) params.status = statusFilter.value;
                if (deptFilterEl && deptFilterEl.value) params.department = deptFilterEl.value;
                var res = await API.getHREmployees(params).catch(function () { return null; });
                renderHrTable(res ? res.data : []);
            }, 300);
        }
        if (searchInput) searchInput.oninput = reloadFiltered;
        if (statusFilter) statusFilter.onchange = reloadFiltered;
        if (deptFilterEl) deptFilterEl.onchange = reloadFiltered;
        var btnNew = document.getElementById('btn-hr-new');
        if (btnNew) btnNew.onclick = function () { openEmployeeForm(); };
    }

    function renderHrTable(list) {
        var tbody = document.getElementById('hr-tbody');
        if (!tbody) return;
        if (!list.length) { emptyMsg(tbody, 8, 'لا يوجد موظفين'); return; }
        tbody.innerHTML = list.map(function (e) {
            var statusBadge = e.status === 'active' ? '<span class="badge-status paid">نشط</span>' : '<span class="badge-status cancelled">غير نشط</span>';
            return '<tr><td><code>' + esc(e.emp_code) + '</code></td><td><strong>' + esc(e.emp_name) + '</strong></td><td>' + esc(e.department || '-') + '</td><td>' + esc(e.job_title || '-') + '</td><td>' + window.formatMoney(e.basic_salary) + ' ج.م</td><td>' + esc(e.hire_date || '-') + '</td><td>' + statusBadge + '</td><td><button class="icon-btn" title="تعديل" onclick="window._hrEdit(' + e.id + ')"><i class="fa-solid fa-pen"></i></button> <button class="icon-btn" title="تفعيل/تعطيل" onclick="window._hrToggle(' + e.id + ')"><i class="fa-solid fa-toggle-' + (e.status === 'active' ? 'on text-success' : 'off text-danger') + '"></i></button> <button class="icon-btn" title="حذف" onclick="window._hrDelete(' + e.id + ', \'' + esc(e.emp_name).replace(/'/g, "\\'") + '\')"><i class="fa-solid fa-trash text-danger"></i></button></td></tr>';
        }).join('');
    }

    function openEmployeeForm(id, data) {
        var isEdit = !!id; var d = data || {};
        var html = '<div style="max-width:600px"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
            '<div class="form-group"><label>كود الموظف *</label><input id="_emp-code" value="' + esc(d.emp_code) + '" class="form-control" placeholder="EMP-001"></div>' +
            '<div class="form-group"><label>اسم الموظف *</label><input id="_emp-name" value="' + esc(d.emp_name) + '" class="form-control" placeholder="الاسم الكامل"></div>' +
            '<div class="form-group"><label>القسم</label><input id="_emp-dept" value="' + esc(d.department) + '" class="form-control" placeholder="المبيعات"></div>' +
            '<div class="form-group"><label>المسمى الوظيفي</label><input id="_emp-job" value="' + esc(d.job_title) + '" class="form-control" placeholder="مندوب مبيعات"></div>' +
            '<div class="form-group"><label>الراتب الأساسي *</label><input id="_emp-salary" type="number" value="' + (d.basic_salary || '') + '" class="form-control" placeholder="5000"></div>' +
            '<div class="form-group"><label>تاريخ التعيين</label><input id="_emp-hire" type="date" value="' + (d.hire_date || '') + '" class="form-control"></div>' +
            '<div class="form-group"><label>الهاتف</label><input id="_emp-phone" value="' + esc(d.phone) + '" class="form-control" placeholder="01012345678"></div>' +
            '<div class="form-group"><label>رقم الهوية</label><input id="_emp-nid" value="' + esc(d.national_id) + '" class="form-control"></div>' +
            '</div></div>';
        showModal(isEdit ? 'تعديل بيانات الموظف' : 'إضافة موظف جديد', html, async function () {
            var payload = { emp_code: document.getElementById('_emp-code').value.trim(), emp_name: document.getElementById('_emp-name').value.trim(), department: document.getElementById('_emp-dept').value.trim(), job_title: document.getElementById('_emp-job').value.trim(), basic_salary: document.getElementById('_emp-salary').value, hire_date: document.getElementById('_emp-hire').value, phone: document.getElementById('_emp-phone').value.trim(), national_id: document.getElementById('_emp-nid').value.trim() };
            if (!payload.emp_code) { window.showAlert('كود الموظف مطلوب', { type: 'warning' }); return; }
            if (!payload.emp_name) { window.showAlert('اسم الموظف مطلوب', { type: 'warning' }); return; }
            try { if (isEdit) await API.updateHREmployee(id, payload); else await API.createHREmployee(payload); closeModal(); loadHr(); } catch (e) { window.showAlert(e.message, { type: 'danger' }); }
        });
    }

    window._hrEdit = async function (id) { try { var res = await API.getHREmployee(id); openEmployeeForm(id, res.data); } catch (e) { window.showAlert(e.message, { type: 'danger' }); } };
    window._hrToggle = async function (id) { try { await API.toggleHREmployee(id); loadHr(); } catch (e) { window.showAlert(e.message, { type: 'danger' }); } };
    window._hrDelete = function (id, name) { window.showConfirm('هل أنت متأكد من حذف الموظف "' + name + '"؟').then(async function (ok) { if (!ok) return; try { await API.deleteHREmployee(id); loadHr(); } catch (e) { window.showAlert(e.message, { type: 'danger' }); } }); };
    window.loadHr = loadHr;

    // ═══════════════════════════════════════════════════
    // 2. PAYROLL (ENHANCED: edit modal + print)
    // ═══════════════════════════════════════════════════

    async function loadPayroll() {
        var tbody = document.getElementById('payroll-tbody');
        var summary = document.getElementById('payroll-summary');
        var periodInput = document.getElementById('payroll-period');
        if (!tbody) return;
        // ── bind controls always (before any early return) ──
        var statusFilter = document.getElementById('payroll-status-filter');
        if (periodInput && !periodInput.value) { var now = new Date(); periodInput.value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0'); }
        if (periodInput && !periodInput._bound) { periodInput._bound = true; periodInput.onchange = loadPayroll; }
        if (statusFilter && !statusFilter._bound) { statusFilter._bound = true; statusFilter.onchange = loadPayroll; }
        var btnGen = document.getElementById('btn-payroll-generate');
        if (btnGen && !btnGen._bound) {
            btnGen._bound = true;
            btnGen.onclick = async function () {
                var p = periodInput ? periodInput.value : '';
                if (!p) { window.showAlert('اختر الفترة أولاً', { type: 'warning' }); return; }
                window.showConfirm('هل تريد إعداد مسير رواتب ' + p + ' لجميع الموظفين النشطين؟').then(async function (ok) {
                    if (!ok) return;
                    try { await API.generateHRPayroll(p); loadPayroll(); } catch (e) { window.showAlert(e.message, { type: 'danger' }); }
                });
            };
        }
        // ── load data ──
        loadingMsg(tbody);
        var period = periodInput ? periodInput.value : '';
        var params = {};
        if (period) params.period = period;
        if (statusFilter && statusFilter.value) params.status = statusFilter.value;
        var res = await API.getHRPayroll(params).catch(function () { return null; });
        var list = res ? res.data : [];
        if (!list.length) { emptyMsg(tbody, 11, 'لا يوجد سجلات رواتب لهذه الفترة'); if (summary) summary.style.display = 'none'; return; }
        tbody.innerHTML = list.map(function (s) {
            var statusBadge = s.status === 'paid' ? '<span class="badge-status paid">مدفوع</span>' : '<span class="badge-status pending">مسودة</span>';
            var actions = '';
            if (s.status === 'draft') {
                actions = '<button class="icon-btn" title="تعديل" onclick="window._payrollEdit(' + s.id + ')"><i class="fa-solid fa-pen"></i></button> ' +
                    '<button class="icon-btn" title="ترحيل" onclick="window._payrollPost(' + s.id + ')"><i class="fa-solid fa-check text-success"></i></button> ' +
                    '<button class="icon-btn" title="حذف" onclick="window._payrollDelete(' + s.id + ')"><i class="fa-solid fa-trash text-danger"></i></button>';
            } else {
                actions = '<button class="icon-btn" title="إلغاء الترحيل" onclick="window._payrollCancel(' + s.id + ')"><i class="fa-solid fa-rotate-left text-warning"></i></button>';
            }
            return '<tr><td><code>' + esc(s.slip_no) + '</code></td><td>' + esc(s.period) + '</td><td><strong>' + esc(s.emp_name) + '</strong><br><small style="color:var(--text-muted)">' + esc(s.emp_code) + '</small></td><td>' + esc(s.department || '-') + '</td><td>' + window.formatMoney(s.basic_salary) + '</td><td>' + window.formatMoney(s.allowances) + '</td><td class="text-danger">' + window.formatMoney(s.deductions) + '</td><td class="text-danger">' + window.formatMoney(s.loans) + '</td><td class="text-success"><strong>' + window.formatMoney(s.net_salary) + ' ج.م</strong></td><td>' + statusBadge + '</td><td>' + actions + '</td></tr>';
        }).join('');
        if (summary) {
            var totalNet = list.reduce(function (a, b) { return a + parseFloat(b.net_salary || 0); }, 0);
            summary.style.display = 'block';
            summary.innerHTML = '<strong>إجمالي الرواتب: <span class="text-primary">' + window.formatMoney(totalNet) + ' ج.م</span> — (' + list.length + ' موظف)</strong>';
        }
    }


    window._payrollEdit = async function (id) {
        var res = await API.getHRPayroll({ emp_id: 0 }).catch(function () { return null; });
        var slip = null;
        if (res && res.data) slip = res.data.find(function (s) { return s.id === id; });
        if (!slip) { try { var all = await API.getHRPayroll(); slip = (all.data || []).find(function (s) { return s.id === id; }); } catch (e) {} }
        if (!slip) { window.showAlert('لم يتم العثور على تسجيل الراتب', { type: 'danger' }); return; }
        var html = '<div style="max-width:500px">' +
            '<p style="margin-bottom:12px"><strong>' + esc(slip.emp_name) + '</strong> — <code>' + esc(slip.slip_no) + '</code></p>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
            '<div class="form-group"><label>الراتب الأساسي</label><input class="form-control" value="' + window.formatMoney(slip.basic_salary) + '" disabled></div>' +
            '<div class="form-group"><label>السلف المستحقة</label><input class="form-control" value="' + window.formatMoney(slip.loans) + '" disabled></div>' +
            '<div class="form-group"><label>البدلات</label><input id="_pay-allow" type="number" class="form-control" value="' + (slip.allowances || 0) + '"></div>' +
            '<div class="form-group"><label>الخصومات</label><input id="_pay-ded" type="number" class="form-control" value="' + (slip.deductions || 0) + '"></div>' +
            '</div>' +
            '<div class="form-group"><label>ملاحظات</label><input id="_pay-notes" class="form-control" value="' + esc(slip.notes || '') + '"></div>' +
            '</div>';
        showModal('تعديل راتب — ' + esc(slip.emp_name), html, async function () {
            var payload = { allowances: document.getElementById('_pay-allow').value, deductions: document.getElementById('_pay-ded').value, notes: document.getElementById('_pay-notes').value.trim() };
            try { await API.updateHRPayrollSlip(id, payload); closeModal(); loadPayroll(); } catch (e) { window.showAlert(e.message, { type: 'danger' }); }
        });
    };

    window._payrollPost = function (id) { window.showConfirm('تأكيد ترحيل هذا الراتب؟').then(async function (ok) { if (!ok) return; try { await API.postHRPayrollSlip(id); loadPayroll(); } catch (e) { window.showAlert(e.message, { type: 'danger' }); } }); };
    window._payrollCancel = function (id) { window.showConfirm('إرجاع هذا الراتب إلى المسودة؟').then(async function (ok) { if (!ok) return; try { await API.cancelHRPayrollSlip(id); loadPayroll(); } catch (e) { window.showAlert(e.message, { type: 'danger' }); } }); };
    window._payrollDelete = function (id) { window.showConfirm('هل أنت متأكد من حذف هذا التسجيل؟').then(async function (ok) { if (!ok) return; try { await API.deleteHRPayrollSlip(id); loadPayroll(); } catch (e) { window.showAlert(e.message, { type: 'danger' }); } }); };
    window.loadPayroll = loadPayroll;

    // ═══════════════════════════════════════════════════
    // 3. HR LOANS (ENHANCED: edit functionality)
    // ═══════════════════════════════════════════════════

    async function loadHrLoans() {
        var tbody = document.getElementById('hr-loans-tbody');
        if (!tbody) return;
        // ── bind controls always (before any early return) ──
        var searchInput = document.getElementById('hr-loans-search');
        var statusFilter = document.getElementById('hr-loans-status-filter');
        var btnNew = document.getElementById('btn-hr-loan-new');
        if (btnNew && !btnNew._bound) { btnNew._bound = true; btnNew.onclick = function () { openLoanForm(); }; }
        var debounce;
        function reloadFiltered() { clearTimeout(debounce); debounce = setTimeout(loadHrLoans, 300); }
        if (searchInput && !searchInput._bound) { searchInput._bound = true; searchInput.oninput = reloadFiltered; }
        if (statusFilter && !statusFilter._bound) { statusFilter._bound = true; statusFilter.onchange = loadHrLoans; }
        // ── load data ──
        loadingMsg(tbody);
        var params = {};
        if (searchInput && searchInput.value) params.q = searchInput.value;
        if (statusFilter && statusFilter.value) params.status = statusFilter.value;
        var res = await API.getHRLoans(params).catch(function () { return null; });
        var list = res ? res.data : [];
        if (!list.length) { emptyMsg(tbody, 10, 'لا يوجد سلف'); return; }
        tbody.innerHTML = list.map(function (l) {
            var remaining = parseFloat(l.amount || 0) - parseFloat(l.paid_amount || 0);
            var statusBadge = l.status === 'settled' ? '<span class="badge-status paid">مسددة</span>' : '<span class="badge-status pending">جارية</span>';
            var actions = '';
            if (l.status === 'active') {
                actions = '<button class="icon-btn" title="تعديل" onclick="window._loanEdit(' + l.id + ')"><i class="fa-solid fa-pen"></i></button> ' +
                    '<button class="icon-btn" title="سداد" onclick="window._loanRepay(' + l.id + ', ' + remaining + ')"><i class="fa-solid fa-money-bill-wave text-success"></i></button> ';
                if (!l.paid_amount || parseFloat(l.paid_amount) === 0) actions += '<button class="icon-btn" title="حذف" onclick="window._loanDelete(' + l.id + ')"><i class="fa-solid fa-trash text-danger"></i></button>';
            }
            return '<tr><td><code>' + esc(l.emp_code) + '</code></td><td><strong>' + esc(l.emp_name) + '</strong></td><td>' + esc(l.department || '-') + '</td><td>' + esc(l.loan_date) + '</td><td>' + window.formatMoney(l.amount) + ' ج.م</td><td>' + window.formatMoney(l.monthly_installment) + ' ج.م</td><td class="text-success">' + window.formatMoney(l.paid_amount) + ' ج.م</td><td class="text-warning">' + window.formatMoney(remaining) + ' ج.م</td><td>' + statusBadge + '</td><td>' + actions + '</td></tr>';
        }).join('');
    }

    async function openLoanForm(id, data) {
        var isEdit = !!id; var d = data || {};
        var empOpts = await empSelectOptions(d.emp_id);
        var html = '<div style="max-width:500px">' +
            '<div class="form-group"><label>الموظف *</label><select id="_loan-emp" class="form-control">' + empOpts + '</select></div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
            '<div class="form-group"><label>مبلغ السلفة *</label><input id="_loan-amt" type="number" class="form-control" value="' + (d.amount || '') + '" placeholder="1000"></div>' +
            '<div class="form-group"><label>القسط الشهري</label><input id="_loan-installment" type="number" class="form-control" value="' + (d.monthly_installment || '') + '" placeholder="200"></div>' +
            '</div>' +
            '<div class="form-group"><label>السبب</label><input id="_loan-reason" class="form-control" value="' + esc(d.reason || '') + '" placeholder="سلفة شخصية"></div></div>';
        showModal(isEdit ? 'تعديل السلفة' : 'إضافة سلفة جديدة', html, async function () {
            var payload = { emp_id: document.getElementById('_loan-emp').value, amount: document.getElementById('_loan-amt').value, monthly_installment: document.getElementById('_loan-installment').value, reason: document.getElementById('_loan-reason').value.trim() };
            if (!payload.emp_id) { window.showAlert('اختر الموظف', { type: 'warning' }); return; }
            if (!payload.amount || parseFloat(payload.amount) <= 0) { window.showAlert('أدخل مبلغ السلفة', { type: 'warning' }); return; }
            try { if (isEdit) await API.updateHRLoan(id, payload); else await API.createHRLoan(payload); closeModal(); loadHrLoans(); } catch (e) { window.showAlert(e.message, { type: 'danger' }); }
        });
    }

    window._loanEdit = async function (id) {
        try {
            var res = await API.getHRLoans();
            var loan = (res.data || []).find(function (l) { return l.id === id; });
            if (loan) openLoanForm(id, loan);
        } catch (e) { window.showAlert(e.message, { type: 'danger' }); }
    };

    window._loanRepay = function (id, remaining) {
        var html = '<div style="max-width:350px;text-align:center"><p style="margin-bottom:8px">المتبقي: <strong>' + window.formatMoney(remaining) + ' ج.م</strong></p><input id="_repay-amt" type="number" class="form-control" placeholder="المبلغ" max="' + remaining + '"></div>';
        showModal('تسجيل سداد', html, async function () {
            var amt = parseFloat(document.getElementById('_repay-amt').value);
            if (!amt || amt <= 0) { window.showAlert('أدخل مبلغ صحيح', { type: 'warning' }); return; }
            if (amt > remaining) { window.showAlert('المبلغ أكبر من المتبقي', { type: 'warning' }); return; }
            try { await API.repayHRLoan(id, amt); closeModal(); loadHrLoans(); } catch (e) { window.showAlert(e.message, { type: 'danger' }); }
        });
    };

    window._loanDelete = function (id) { window.showConfirm('هل أنت متأكد من حذف هذه السلفة؟').then(async function (ok) { if (!ok) return; try { await API.deleteHRLoan(id); loadHrLoans(); } catch (e) { window.showAlert(e.message, { type: 'danger' }); } }); };
    window.loadHrLoans = loadHrLoans;

    // ═══════════════════════════════════════════════════
    // 4. ATTENDANCE
    // ═══════════════════════════════════════════════════

    async function loadAttendance() {
        var tbody = document.getElementById('att-tbody');
        if (!tbody) return;
        // ── bind controls always (before any early return) ──
        var searchInput = document.getElementById('att-search');
        var dateFrom = document.getElementById('att-date-from');
        var dateTo = document.getElementById('att-date-to');
        var statusFilter = document.getElementById('att-status-filter');
        var btnNew = document.getElementById('btn-att-new');
        var btnSummary = document.getElementById('btn-att-summary');
        var debounce;
        function reloadFiltered() { clearTimeout(debounce); debounce = setTimeout(loadAttendance, 300); }
        if (searchInput && !searchInput._bound) { searchInput._bound = true; searchInput.oninput = reloadFiltered; }
        if (dateFrom && !dateFrom._bound) { dateFrom._bound = true; dateFrom.onchange = loadAttendance; }
        if (dateTo && !dateTo._bound) { dateTo._bound = true; dateTo.onchange = loadAttendance; }
        if (statusFilter && !statusFilter._bound) { statusFilter._bound = true; statusFilter.onchange = loadAttendance; }
        if (btnNew && !btnNew._bound) { btnNew._bound = true; btnNew.onclick = function () { openAttForm(); }; }
        if (btnSummary && !btnSummary._bound) { btnSummary._bound = true; btnSummary.onclick = function () { openAttSummary(); }; }
        // ── load data ──
        loadingMsg(tbody);
        var params = {};
        if (searchInput && searchInput.value) params.q = searchInput.value;
        if (dateFrom && dateFrom.value) params.date_from = dateFrom.value;
        if (dateTo && dateTo.value) params.date_to = dateTo.value;
        if (statusFilter && statusFilter.value) params.status = statusFilter.value;
        var res = await API.getHRAttendance(params).catch(function () { return null; });
        var list = res ? res.data : [];
        if (!list.length) { emptyMsg(tbody, 10, 'لا توجد سجلات حضور'); return; }
        tbody.innerHTML = list.map(function (a) {
            var statusMap = { present: '<span class="badge-status paid">حاضر</span>', absent: '<span class="badge-status cancelled">غائب</span>', late: '<span class="badge-status pending">متأخر</span>', leave: '<span class="badge-status info">إجازة</span>' };
            return '<tr><td><code>' + esc(a.emp_code) + '</code></td><td><strong>' + esc(a.emp_name) + '</strong></td><td>' + esc(a.department || '-') + '</td><td>' + esc(a.att_date) + '</td><td>' + esc(a.check_in || '-') + '</td><td>' + esc(a.check_out || '-') + '</td><td>' + (statusMap[a.status] || a.status) + '</td><td>' + (a.late_minutes || 0) + '</td><td>' + (a.overtime_minutes || 0) + '</td><td><button class="icon-btn" title="تعديل" onclick="window._attEdit(' + a.id + ')"><i class="fa-solid fa-pen"></i></button> <button class="icon-btn" title="حذف" onclick="window._attDelete(' + a.id + ')"><i class="fa-solid fa-trash text-danger"></i></button></td></tr>';
        }).join('');
    }

    async function openAttForm(id, data) {
        var isEdit = !!id; var d = data || {};
        var empOpts = await empSelectOptions(d.emp_id);
        var html = '<div style="max-width:500px">' +
            '<div class="form-group"><label>الموظف *</label><select id="_att-emp" class="form-control">' + empOpts + '</select></div>' +
            '<div class="form-group"><label>التاريخ *</label><input id="_att-date" type="date" class="form-control" value="' + (d.att_date || today()) + '"></div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
            '<div class="form-group"><label>وقت الحضور</label><input id="_att-in" type="time" class="form-control" value="' + (d.check_in || '') + '"></div>' +
            '<div class="form-group"><label>وقت الانصراف</label><input id="_att-out" type="time" class="form-control" value="' + (d.check_out || '') + '"></div>' +
            '<div class="form-group"><label>الحالة</label><select id="_att-status" class="form-control"><option value="present"' + (d.status === 'present' ? ' selected' : '') + '>حاضر</option><option value="absent"' + (d.status === 'absent' ? ' selected' : '') + '>غائب</option><option value="late"' + (d.status === 'late' ? ' selected' : '') + '>متأخر</option><option value="leave"' + (d.status === 'leave' ? ' selected' : '') + '>إجازة</option></select></div>' +
            '<div class="form-group"><label>دقائق التأخر</label><input id="_att-late" type="number" class="form-control" value="' + (d.late_minutes || 0) + '"></div>' +
            '</div>' +
            '<div class="form-group"><label>الإضافي (دقائق)</label><input id="_att-ot" type="number" class="form-control" value="' + (d.overtime_minutes || 0) + '"></div>' +
            '<div class="form-group"><label>ملاحظات</label><input id="_att-notes" class="form-control" value="' + esc(d.notes || '') + '"></div></div>';
        showModal(isEdit ? 'تعديل سجل الحضور' : 'تسجيل حضور جديد', html, async function () {
            var payload = { emp_id: document.getElementById('_att-emp').value, att_date: document.getElementById('_att-date').value, check_in: document.getElementById('_att-in').value, check_out: document.getElementById('_att-out').value, status: document.getElementById('_att-status').value, late_minutes: parseInt(document.getElementById('_att-late').value) || 0, overtime_minutes: parseInt(document.getElementById('_att-ot').value) || 0, notes: document.getElementById('_att-notes').value.trim() };
            if (!payload.emp_id) { window.showAlert('اختر الموظف', { type: 'warning' }); return; }
            if (!payload.att_date) { window.showAlert('التاريخ مطلوب', { type: 'warning' }); return; }
            try { if (isEdit) await API.updateHRAttendance(id, payload); else await API.createHRAttendance(payload); closeModal(); loadAttendance(); } catch (e) { window.showAlert(e.message, { type: 'danger' }); }
        });
    }

    window._attEdit = async function (id) {
        try {
            var res = await API.getHRAttendance();
            var att = (res.data || []).find(function (a) { return a.id === id; });
            if (att) openAttForm(id, att);
        } catch (e) { window.showAlert(e.message, { type: 'danger' }); }
    };

    window._attDelete = function (id) { window.showConfirm('هل أنت متأكد من حذف سجل الحضور؟').then(async function (ok) { if (!ok) return; try { await API.deleteHRAttendance(id); loadAttendance(); } catch (e) { window.showAlert(e.message, { type: 'danger' }); } }); };

    async function openAttSummary() {
        var now = new Date();
        var month = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
        var res = await API.getHRAttendanceSummary(month).catch(function () { return null; });
        var list = res ? res.data : [];
        if (!list.length) { window.showAlert('لا توجد بيانات لهذا الشهر', { type: 'info' }); return; }
        var html = '<div class="table-responsive"><table class="data-table"><thead><tr><th>الكود</th><th>الموظف</th><th>القسم</th><th>أيام الحضور</th><th>أيام الغياب</th><th>أيام التأخر</th><th>أيام الإجازة</th><th>التأخر (د)</th><th>الإضافي (د)</th></tr></thead><tbody>';
        list.forEach(function (r) {
            html += '<tr><td><code>' + esc(r.emp_code) + '</code></td><td><strong>' + esc(r.emp_name) + '</strong></td><td>' + esc(r.department || '-') + '</td><td class="text-success">' + (r.present_days || 0) + '</td><td class="text-danger">' + (r.absent_days || 0) + '</td><td class="text-warning">' + (r.late_days || 0) + '</td><td>' + (r.leave_days || 0) + '</td><td>' + (r.total_late_minutes || 0) + '</td><td>' + (r.total_overtime_minutes || 0) + '</td></tr>';
        });
        html += '</tbody></table></div>';
        showModal('ملخص الحضور — ' + month, html, null);
    }

    window.loadAttendance = loadAttendance;

    // ═══════════════════════════════════════════════════
    // 5. VACATIONS
    // ═══════════════════════════════════════════════════

    async function loadVacations() {
        var tbody = document.getElementById('vac-tbody');
        if (!tbody) return;
        // ── bind controls always (before any early return) ──
        var searchInput = document.getElementById('vac-search');
        var statusFilter = document.getElementById('vac-status-filter');
        var btnNew = document.getElementById('btn-vac-new');
        var debounce;
        function reloadFiltered() { clearTimeout(debounce); debounce = setTimeout(loadVacations, 300); }
        if (searchInput && !searchInput._bound) { searchInput._bound = true; searchInput.oninput = reloadFiltered; }
        if (statusFilter && !statusFilter._bound) { statusFilter._bound = true; statusFilter.onchange = loadVacations; }
        if (btnNew && !btnNew._bound) { btnNew._bound = true; btnNew.onclick = function () { openVacForm(); }; }
        // ── load data ──
        loadingMsg(tbody);
        var params = {};
        if (searchInput && searchInput.value) params.q = searchInput.value;
        if (statusFilter && statusFilter.value) params.status = statusFilter.value;
        var res = await API.getHRVacations(params).catch(function () { return null; });
        var list = res ? res.data : [];
        if (!list.length) { emptyMsg(tbody, 10, 'لا توجد طلبات إجازات'); return; }
        tbody.innerHTML = list.map(function (v) {
            var statusMap = { pending: '<span class="badge-status pending">قيد الانتظار</span>', approved: '<span class="badge-status paid">معتمدة</span>', rejected: '<span class="badge-status cancelled">مرفوضة</span>' };
            var vacTypes = { annual: 'سنوية', sick: 'مرضية', personal: 'شخصية', maternity: 'أمومة', other: 'أخرى' };
            var actions = '';
            if (v.status === 'pending') {
                actions = '<button class="icon-btn" title="تعديل" onclick="window._vacEdit(' + v.id + ')"><i class="fa-solid fa-pen"></i></button> ' +
                    '<button class="icon-btn text-success" title="اعتماد" onclick="window._vacApprove(' + v.id + ')"><i class="fa-solid fa-check"></i></button> ' +
                    '<button class="icon-btn text-danger" title="رفض" onclick="window._vacReject(' + v.id + ')"><i class="fa-solid fa-xmark"></i></button> ' +
                    '<button class="icon-btn" title="حذف" onclick="window._vacDelete(' + v.id + ')"><i class="fa-solid fa-trash text-danger"></i></button>';
            }
            return '<tr><td><code>' + esc(v.emp_code) + '</code></td><td><strong>' + esc(v.emp_name) + '</strong></td><td>' + esc(v.department || '-') + '</td><td>' + (vacTypes[v.vac_type] || v.vac_type) + '</td><td>' + esc(v.start_date) + '</td><td>' + esc(v.end_date) + '</td><td>' + v.days + '</td><td>' + esc(v.reason || '-') + '</td><td>' + (statusMap[v.status] || v.status) + '</td><td>' + actions + '</td></tr>';
        }).join('');
    }

    async function openVacForm(id, data) {
        var isEdit = !!id; var d = data || {};
        var empOpts = await empSelectOptions(d.emp_id);
        var html = '<div style="max-width:500px">' +
            '<div class="form-group"><label>الموظف *</label><select id="_vac-emp" class="form-control">' + empOpts + '</select></div>' +
            '<div class="form-group"><label>نوع الإجازة</label><select id="_vac-type" class="form-control"><option value="annual"' + (d.vac_type === 'annual' ? ' selected' : '') + '>سنوية</option><option value="sick"' + (d.vac_type === 'sick' ? ' selected' : '') + '>مرضية</option><option value="personal"' + (d.vac_type === 'personal' ? ' selected' : '') + '>شخصية</option><option value="maternity"' + (d.vac_type === 'maternity' ? ' selected' : '') + '>أمومة</option><option value="other"' + (d.vac_type === 'other' ? ' selected' : '') + '>أخرى</option></select></div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
            '<div class="form-group"><label>من تاريخ *</label><input id="_vac-from" type="date" class="form-control" value="' + (d.start_date || '') + '"></div>' +
            '<div class="form-group"><label>إلى تاريخ *</label><input id="_vac-to" type="date" class="form-control" value="' + (d.end_date || '') + '"></div>' +
            '</div>' +
            '<div class="form-group"><label>عدد الأيام</label><input id="_vac-days" type="number" class="form-control" value="' + (d.days || '') + '" min="1"></div>' +
            '<div class="form-group"><label>السبب</label><input id="_vac-reason" class="form-control" value="' + esc(d.reason || '') + '" placeholder="سبب الإجازة"></div></div>';
        showModal(isEdit ? 'تعديل طلب الإجازة' : 'طلب إجازة جديد', html, async function () {
            var payload = { emp_id: document.getElementById('_vac-emp').value, vac_type: document.getElementById('_vac-type').value, start_date: document.getElementById('_vac-from').value, end_date: document.getElementById('_vac-to').value, days: parseInt(document.getElementById('_vac-days').value) || 0, reason: document.getElementById('_vac-reason').value.trim() };
            if (!payload.emp_id) { window.showAlert('اختر الموظف', { type: 'warning' }); return; }
            if (!payload.start_date || !payload.end_date) { window.showAlert('حدد تاريخ البداية والنهاية', { type: 'warning' }); return; }
            try { if (isEdit) await API.updateHRVacation(id, payload); else await API.createHRVacation(payload); closeModal(); loadVacations(); } catch (e) { window.showAlert(e.message, { type: 'danger' }); }
        });
    }

    window._vacEdit = async function (id) {
        try {
            var res = await API.getHRVacations();
            var vac = (res.data || []).find(function (v) { return v.id === id; });
            if (vac) openVacForm(id, vac);
        } catch (e) { window.showAlert(e.message, { type: 'danger' }); }
    };

    window._vacApprove = function (id) { window.showConfirm('هل تريد اعتماد هذا الطلب؟').then(async function (ok) { if (!ok) return; try { await API.approveHRVacation(id); loadVacations(); } catch (e) { window.showAlert(e.message, { type: 'danger' }); } }); };
    window._vacReject = function (id) {
        var html = '<div><div class="form-group"><label>سبب الرفض</label><input id="_vac-reject-reason" class="form-control" placeholder="سبب رفض الإجازة"></div></div>';
        showModal('رفض طلب الإجازة', html, async function () {
            var reason = document.getElementById('_vac-reject-reason').value.trim();
            if (!reason) { window.showAlert('أدخل سبب الرفض', { type: 'warning' }); return; }
            try { await API.rejectHRVacation(id, reason); closeModal(); loadVacations(); } catch (e) { window.showAlert(e.message, { type: 'danger' }); }
        });
    };
    window._vacDelete = function (id) { window.showConfirm('هل أنت متأكد من حذف طلب الإجازة؟').then(async function (ok) { if (!ok) return; try { await API.deleteHRVacation(id); loadVacations(); } catch (e) { window.showAlert(e.message, { type: 'danger' }); } }); };
    window.loadVacations = loadVacations;

    // ═══════════════════════════════════════════════════
    // 6. PENALTIES
    // ═══════════════════════════════════════════════════

    async function loadPenalties() {
        var tbody = document.getElementById('pen-tbody');
        if (!tbody) return;
        // ── bind controls always (before any early return) ──
        var searchInput = document.getElementById('pen-search');
        var statusFilter = document.getElementById('pen-status-filter');
        var btnNew = document.getElementById('btn-pen-new');
        var debounce;
        function reloadFiltered() { clearTimeout(debounce); debounce = setTimeout(loadPenalties, 300); }
        if (searchInput && !searchInput._bound) { searchInput._bound = true; searchInput.oninput = reloadFiltered; }
        if (statusFilter && !statusFilter._bound) { statusFilter._bound = true; statusFilter.onchange = loadPenalties; }
        if (btnNew && !btnNew._bound) { btnNew._bound = true; btnNew.onclick = function () { openPenForm(); }; }
        // ── load data ──
        loadingMsg(tbody);
        var params = {};
        if (searchInput && searchInput.value) params.q = searchInput.value;
        if (statusFilter && statusFilter.value) params.status = statusFilter.value;
        var res = await API.getHRPenalties(params).catch(function () { return null; });
        var list = res ? res.data : [];
        if (!list.length) { emptyMsg(tbody, 9, 'لا توجد جزاءات'); return; }
        tbody.innerHTML = list.map(function (p) {
            var statusBadge = p.status === 'active' ? '<span class="badge-status paid">نشط</span>' : '<span class="badge-status cancelled">ملغي</span>';
            var types = { absence: 'غياب', late: 'تأخر', misconduct: 'سوء سلوك', warning: 'تنبيه', deduction: 'خصم', other: 'أخرى' };
            return '<tr><td><code>' + esc(p.emp_code) + '</code></td><td><strong>' + esc(p.emp_name) + '</strong></td><td>' + esc(p.department || '-') + '</td><td>' + (types[p.penalty_type] || p.penalty_type) + '</td><td>' + esc(p.penalty_date) + '</td><td>' + window.formatMoney(p.amount) + ' ج.م</td><td>' + esc(p.reason || '-') + '</td><td>' + statusBadge + '</td><td><button class="icon-btn" title="تعديل" onclick="window._penEdit(' + p.id + ')"><i class="fa-solid fa-pen"></i></button> <button class="icon-btn" title="حذف" onclick="window._penDelete(' + p.id + ')"><i class="fa-solid fa-trash text-danger"></i></button></td></tr>';
        }).join('');
    }

    async function openPenForm(id, data) {
        var isEdit = !!id; var d = data || {};
        var empOpts = await empSelectOptions(d.emp_id);
        var html = '<div style="max-width:500px">' +
            '<div class="form-group"><label>الموظف *</label><select id="_pen-emp" class="form-control">' + empOpts + '</select></div>' +
            '<div class="form-group"><label>نوع الجزاء *</label><select id="_pen-type" class="form-control"><option value="absence"' + (d.penalty_type === 'absence' ? ' selected' : '') + '>غياب</option><option value="late"' + (d.penalty_type === 'late' ? ' selected' : '') + '>تأخر</option><option value="misconduct"' + (d.penalty_type === 'misconduct' ? ' selected' : '') + '>سوء سلوك</option><option value="warning"' + (d.penalty_type === 'warning' ? ' selected' : '') + '>تنبيه</option><option value="deduction"' + (d.penalty_type === 'deduction' ? ' selected' : '') + '>خصم</option><option value="other"' + (d.penalty_type === 'other' ? ' selected' : '') + '>أخرى</option></select></div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
            '<div class="form-group"><label>التاريخ *</label><input id="_pen-date" type="date" class="form-control" value="' + (d.penalty_date || today()) + '"></div>' +
            '<div class="form-group"><label>المبلغ</label><input id="_pen-amt" type="number" class="form-control" value="' + (d.amount || '') + '" placeholder="0"></div>' +
            '</div>' +
            '<div class="form-group"><label>السبب</label><input id="_pen-reason" class="form-control" value="' + esc(d.reason || '') + '" placeholder="سبب الجزاء"></div></div>';
        showModal(isEdit ? 'تعديل الجزاء' : 'تسجيل جزاء جديد', html, async function () {
            var payload = { emp_id: document.getElementById('_pen-emp').value, penalty_type: document.getElementById('_pen-type').value, penalty_date: document.getElementById('_pen-date').value, amount: document.getElementById('_pen-amt').value, reason: document.getElementById('_pen-reason').value.trim() };
            if (!payload.emp_id) { window.showAlert('اختر الموظف', { type: 'warning' }); return; }
            if (!payload.penalty_date) { window.showAlert('التاريخ مطلوب', { type: 'warning' }); return; }
            try { if (isEdit) await API.updateHRPenalty(id, payload); else await API.createHRPenalty(payload); closeModal(); loadPenalties(); } catch (e) { window.showAlert(e.message, { type: 'danger' }); }
        });
    }

    window._penEdit = async function (id) {
        try {
            var res = await API.getHRPenalties();
            var pen = (res.data || []).find(function (p) { return p.id === id; });
            if (pen) openPenForm(id, pen);
        } catch (e) { window.showAlert(e.message, { type: 'danger' }); }
    };

    window._penDelete = function (id) { window.showConfirm('هل أنت متأكد من حذف هذا الجزاء؟').then(async function (ok) { if (!ok) return; try { await API.deleteHRPenalty(id); loadPenalties(); } catch (e) { window.showAlert(e.message, { type: 'danger' }); } }); };
    window.loadPenalties = loadPenalties;

    // ═══════════════════════════════════════════════════
    // 7. REWARDS
    // ═══════════════════════════════════════════════════

    async function loadRewards() {
        var tbody = document.getElementById('rew-tbody');
        if (!tbody) return;
        // ── bind controls always (before any early return) ──
        var searchInput = document.getElementById('rew-search');
        var statusFilter = document.getElementById('rew-status-filter');
        var btnNew = document.getElementById('btn-rew-new');
        var debounce;
        function reloadFiltered() { clearTimeout(debounce); debounce = setTimeout(loadRewards, 300); }
        if (searchInput && !searchInput._bound) { searchInput._bound = true; searchInput.oninput = reloadFiltered; }
        if (statusFilter && !statusFilter._bound) { statusFilter._bound = true; statusFilter.onchange = loadRewards; }
        if (btnNew && !btnNew._bound) { btnNew._bound = true; btnNew.onclick = function () { openRewForm(); }; }
        // ── load data ──
        loadingMsg(tbody);
        var params = {};
        if (searchInput && searchInput.value) params.q = searchInput.value;
        if (statusFilter && statusFilter.value) params.status = statusFilter.value;
        var res = await API.getHRRewards(params).catch(function () { return null; });
        var list = res ? res.data : [];
        if (!list.length) { emptyMsg(tbody, 9, 'لا توجد مكافآت'); return; }
        tbody.innerHTML = list.map(function (r) {
            var statusBadge = r.status === 'active' ? '<span class="badge-status paid">نشط</span>' : '<span class="badge-status cancelled">ملغي</span>';
            var types = { bonus: 'مكافأة', incentive: 'حافز', overtime: 'إضافي', holiday: 'عيدية', performance: 'أداء', other: 'أخرى' };
            return '<tr><td><code>' + esc(r.emp_code) + '</code></td><td><strong>' + esc(r.emp_name) + '</strong></td><td>' + esc(r.department || '-') + '</td><td>' + (types[r.reward_type] || r.reward_type) + '</td><td>' + esc(r.reward_date) + '</td><td>' + window.formatMoney(r.amount) + ' ج.م</td><td>' + esc(r.reason || '-') + '</td><td>' + statusBadge + '</td><td><button class="icon-btn" title="تعديل" onclick="window._rewEdit(' + r.id + ')"><i class="fa-solid fa-pen"></i></button> <button class="icon-btn" title="حذف" onclick="window._rewDelete(' + r.id + ')"><i class="fa-solid fa-trash text-danger"></i></button></td></tr>';
        }).join('');
    }

    async function openRewForm(id, data) {
        var isEdit = !!id; var d = data || {};
        var empOpts = await empSelectOptions(d.emp_id);
        var html = '<div style="max-width:500px">' +
            '<div class="form-group"><label>الموظف *</label><select id="_rew-emp" class="form-control">' + empOpts + '</select></div>' +
            '<div class="form-group"><label>نوع المكافأة *</label><select id="_rew-type" class="form-control"><option value="bonus"' + (d.reward_type === 'bonus' ? ' selected' : '') + '>مكافأة</option><option value="incentive"' + (d.reward_type === 'incentive' ? ' selected' : '') + '>حافز</option><option value="overtime"' + (d.reward_type === 'overtime' ? ' selected' : '') + '>إضافي</option><option value="holiday"' + (d.reward_type === 'holiday' ? ' selected' : '') + '>عيدية</option><option value="performance"' + (d.reward_type === 'performance' ? ' selected' : '') + '>أداء</option><option value="other"' + (d.reward_type === 'other' ? ' selected' : '') + '>أخرى</option></select></div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
            '<div class="form-group"><label>التاريخ *</label><input id="_rew-date" type="date" class="form-control" value="' + (d.reward_date || today()) + '"></div>' +
            '<div class="form-group"><label>المبلغ</label><input id="_rew-amt" type="number" class="form-control" value="' + (d.amount || '') + '" placeholder="0"></div>' +
            '</div>' +
            '<div class="form-group"><label>السبب</label><input id="_rew-reason" class="form-control" value="' + esc(d.reason || '') + '" placeholder="سبب المكافأة"></div></div>';
        showModal(isEdit ? 'تعديل المكافأة' : 'تسجيل مكافأة جديدة', html, async function () {
            var payload = { emp_id: document.getElementById('_rew-emp').value, reward_type: document.getElementById('_rew-type').value, reward_date: document.getElementById('_rew-date').value, amount: document.getElementById('_rew-amt').value, reason: document.getElementById('_rew-reason').value.trim() };
            if (!payload.emp_id) { window.showAlert('اختر الموظف', { type: 'warning' }); return; }
            if (!payload.reward_date) { window.showAlert('التاريخ مطلوب', { type: 'warning' }); return; }
            try { if (isEdit) await API.updateHRReward(id, payload); else await API.createHRReward(payload); closeModal(); loadRewards(); } catch (e) { window.showAlert(e.message, { type: 'danger' }); }
        });
    }

    window._rewEdit = async function (id) {
        try {
            var res = await API.getHRRewards();
            var rew = (res.data || []).find(function (r) { return r.id === id; });
            if (rew) openRewForm(id, rew);
        } catch (e) { window.showAlert(e.message, { type: 'danger' }); }
    };

    window._rewDelete = function (id) { window.showConfirm('هل أنت متأكد من حذف هذه المكافأة؟').then(async function (ok) { if (!ok) return; try { await API.deleteHRReward(id); loadRewards(); } catch (e) { window.showAlert(e.message, { type: 'danger' }); } }); };
    window.loadRewards = loadRewards;

    // Register handlers in viewHandlers for the MutationObserver in views.js
    window.viewHandlers = window.viewHandlers || {};
    window.viewHandlers['view-hr'] = loadHr;
    window.viewHandlers['view-payroll'] = loadPayroll;
    window.viewHandlers['view-hr-loans'] = loadHrLoans;
    window.viewHandlers['view-hr-attendance'] = loadAttendance;
    window.viewHandlers['view-hr-vacations'] = loadVacations;
    window.viewHandlers['view-hr-penalties'] = loadPenalties;
    window.viewHandlers['view-hr-rewards'] = loadRewards;
})();
