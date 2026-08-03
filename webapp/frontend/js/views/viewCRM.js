(function () {
    'use strict';

    const fmt = (n) => { const v = Number(n || 0); return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    const esc = (v) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    async function api(endpoint, method, body) {
        const token = localStorage.getItem('auth_token');
        const opt = { method, headers: { 'Content-Type': 'application/json' } };
        if (token) opt.headers['Authorization'] = 'Bearer ' + token;
        if (body) opt.body = JSON.stringify(body);
        const res = await fetch('/api' + endpoint, opt);
        return await res.json();
    }

    function showModal(title, content, saveCallback) {
        const modal = document.getElementById('global-modal');
        if (!modal) return;
        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-body').innerHTML = content;
        const saveBtn = document.getElementById('btn-modal-save');
        saveBtn.style.display = saveCallback ? '' : 'none';
        const newSave = saveBtn.cloneNode(true);
        saveBtn.parentNode.replaceChild(newSave, saveBtn);
        if (saveCallback) newSave.addEventListener('click', saveCallback);
        modal.classList.add('active');
        document.querySelectorAll('.btn-close-modal').forEach(b => {
            const newB = b.cloneNode(true);
            b.parentNode.replaceChild(newB, b);
            newB.addEventListener('click', () => modal.classList.remove('active'));
        });
    }

    function loadingMsg(el) { el.innerHTML = '<tr><td colspan="99" class="empty-table-msg"><i class="fa-solid fa-spinner fa-spin"></i> جاري التحميل...</td></tr>'; }
    function emptyMsg(el, col, msg) { el.innerHTML = '<tr><td colspan="' + col + '" class="empty-table-msg">' + (msg || 'لا توجد بيانات') + '</td></tr>'; }

    // ─── WORKPLAN ─────────────────────────────────────────────
    async function loadCrmWorkplan() {
        const tbody = document.getElementById('crm-wp-tbody');
        if (!tbody) return;
        loadingMsg(tbody);
        const search = document.getElementById('crm-wp-search');
        const date = document.getElementById('crm-wp-date');
        const status = document.getElementById('crm-wp-status');
        let params = '?limit=50';
        if (search && search.value) params += '&q=' + encodeURIComponent(search.value);
        if (date && date.value) { params += '&date_from=' + date.value + '&date_to=' + date.value; }
        if (status && status.value) params += '&status=' + status.value;
        const res = await api('/crm/workplans' + params);
        if (!res.success) { emptyMsg(tbody, 7, 'خطأ في تحميل البيانات'); return; }
        if (!res.data || res.data.length === 0) { emptyMsg(tbody, 7); return; }
        tbody.innerHTML = res.data.map(wp => {
            const stCls = wp.status === 'completed' ? 'paid' : wp.status === 'cancelled' ? 'overdue' : 'pending';
            const stLbl = wp.status === 'completed' ? 'مكتملة' : wp.status === 'cancelled' ? 'ملغية' : 'جاري';
            return '<tr>'
                + '<td>' + esc(wp.rep_name || '-') + '</td>'
                + '<td>' + esc(wp.route_name || '-') + '</td>'
                + '<td>' + (wp.plan_date ? wp.plan_date.slice(0, 10) : '-') + '</td>'
                + '<td>' + (wp.target_count || 0) + '</td>'
                + '<td class="text-' + (wp.visited_count > 0 ? 'success' : 'muted') + '">' + (wp.visited_count || 0) + '</td>'
                + '<td><span class="badge-status ' + stCls + '">' + stLbl + '</span></td>'
                + '<td class="actions-cell">'
                + '<button class="icon-btn" onclick="window.crmWpEdit(' + wp.id + ')" title="تعديل"><i class="fa-solid fa-pen"></i></button>'
                + (wp.status === 'pending' ? '<button class="icon-btn text-success" onclick="window.crmWpComplete(' + wp.id + ')" title="إنهاء"><i class="fa-solid fa-check"></i></button>' : '')
                + '<button class="icon-btn text-danger" onclick="window.crmWpDelete(' + wp.id + ')" title="حذف"><i class="fa-solid fa-trash"></i></button>'
                + '</td></tr>';
        }).join('');
    }

    async function crmWpCreate() {
        const reps = await api('/reps?limit=100');
        const repOpts = reps.success && reps.data ? reps.data.map(r => '<option value="' + r.id + '">' + esc(r.rep_name) + '</option>').join('') : '';
        showModal('خطة سير جديدة', '<div class="form-grid">'
            + '<div class="form-group"><label>المندوب</label><select id="f-wp-rep" class="form-control">' + repOpts + '</select></div>'
            + '<div class="form-group"><label>اسم خط السير</label><input type="text" id="f-wp-route" class="form-control"></div>'
            + '<div class="form-group"><label>التاريخ</label><input type="date" id="f-wp-date" class="form-control" value="' + new Date().toISOString().slice(0, 10) + '"></div>'
            + '<div class="form-group"><label>وقت البداية</label><input type="text" id="f-wp-start" class="form-control" placeholder="09:00"></div>'
            + '<div class="form-group"><label>وقت النهاية</label><input type="text" id="f-wp-end" class="form-control" placeholder="17:00"></div>'
            + '<div class="form-group"><label>الأولوية</label><select id="f-wp-pri" class="form-control"><option value="high">عالية</option><option value="medium" selected>متوسطة</option><option value="low">منخفضة</option></select></div>'
            + '<div class="form-group" style="grid-column:span 2"><label>ملاحظات</label><textarea id="f-wp-notes" class="form-control"></textarea></div>'
            + '</div>', async () => {
            const body = {
                rep_id: parseInt(document.getElementById('f-wp-rep').value) || null,
                route_name: document.getElementById('f-wp-route').value,
                plan_date: document.getElementById('f-wp-date').value,
                start_time: document.getElementById('f-wp-start').value || null,
                end_time: document.getElementById('f-wp-end').value || null,
                priority: document.getElementById('f-wp-pri').value
            };
            const r = await api('/crm/workplans', 'POST', body);
            if (r.success) { document.getElementById('global-modal').classList.remove('active'); loadCrmWorkplan(); }
            else { alert(r.message || 'فشل الإنشاء'); }
        });
    }

    async function crmWpEdit(id) {
        const res = await api('/crm/workplans/' + id);
        if (!res.success) { alert(res.message); return; }
        const wp = res.data;
        const reps = await api('/reps?limit=100');
        const repOpts = reps.success && reps.data ? reps.data.map(r => '<option value="' + r.id + '"' + (r.id === wp.rep_id ? ' selected' : '') + '>' + esc(r.rep_name) + '</option>').join('') : '';
        showModal('تعديل خطة السير', '<div class="form-grid">'
            + '<div class="form-group"><label>المندوب</label><select id="f-wp-rep" class="form-control">' + repOpts + '</select></div>'
            + '<div class="form-group"><label>اسم خط السير</label><input type="text" id="f-wp-route" class="form-control" value="' + esc(wp.route_name) + '"></div>'
            + '<div class="form-group"><label>التاريخ</label><input type="date" id="f-wp-date" class="form-control" value="' + (wp.plan_date ? wp.plan_date.slice(0, 10) : '') + '"></div>'
            + '<div class="form-group"><label>وقت البداية</label><input type="text" id="f-wp-start" class="form-control" value="' + esc(wp.start_time) + '"></div>'
            + '<div class="form-group"><label>وقت النهاية</label><input type="text" id="f-wp-end" class="form-control" value="' + esc(wp.end_time) + '"></div>'
            + '<div class="form-group"><label>الأولوية</label><select id="f-wp-pri" class="form-control"><option value="high"' + (wp.priority === 'high' ? ' selected' : '') + '>عالية</option><option value="medium"' + (wp.priority === 'medium' ? ' selected' : '') + '>متوسطة</option><option value="low"' + (wp.priority === 'low' ? ' selected' : '') + '>منخفضة</option></select></div>'
            + '<div class="form-group" style="grid-column:span 2"><label>ملاحظات</label><textarea id="f-wp-notes" class="form-control">' + esc(wp.notes) + '</textarea></div>'
            + '</div>', async () => {
            const body = {
                rep_id: parseInt(document.getElementById('f-wp-rep').value) || null,
                route_name: document.getElementById('f-wp-route').value,
                plan_date: document.getElementById('f-wp-date').value,
                start_time: document.getElementById('f-wp-start').value || null,
                end_time: document.getElementById('f-wp-end').value || null,
                priority: document.getElementById('f-wp-pri').value
            };
            const r = await api('/crm/workplans/' + id, 'PUT', body);
            if (r.success) { document.getElementById('global-modal').classList.remove('active'); loadCrmWorkplan(); }
            else { alert(r.message || 'فشل التعديل'); }
        });
    }

    async function crmWpComplete(id) {
        if (!confirm('تأكيد إنهاء خطة السير؟')) return;
        const r = await api('/crm/workplans/' + id + '/status', 'PATCH', { status: 'completed' });
        if (r.success) loadCrmWorkplan();
        else alert(r.message);
    }

    async function crmWpDelete(id) {
        if (!confirm('تأكيد حذف خطة السير؟')) return;
        const r = await api('/crm/workplans/' + id, 'DELETE');
        if (r.success) loadCrmWorkplan();
        else alert(r.message);
    }

    // ─── TARGETS ─────────────────────────────────────────────
    async function loadCrmTargets() {
        const tbody = document.getElementById('crm-tg-tbody');
        if (!tbody) return;
        loadingMsg(tbody);
        const month = document.getElementById('crm-tg-month');
        const year = document.getElementById('crm-tg-year');
        let params = '?limit=50';
        if (month && month.value) params += '&period_month=' + month.value;
        if (year && year.value) params += '&period_year=' + year.value;
        const res = await api('/crm/targets' + params);
        if (!res.success) { emptyMsg(tbody, 7, 'خطأ في تحميل البيانات'); return; }
        if (!res.data || res.data.length === 0) { emptyMsg(tbody, 7); return; }
        const months = ['', 'يناير', 'فبراير', 'مارس', 'إبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
        tbody.innerHTML = res.data.map(tg => {
            const pct = tg.target_amount > 0 ? ((tg.achieved_amount / tg.target_amount) * 100) : 0;
            const barW = Math.min(pct, 100);
            const barCls = pct >= 100 ? 'var(--success-color)' : pct >= 80 ? 'var(--primary-color)' : 'var(--danger-color)';
            return '<tr>'
                + '<td>' + esc(tg.rep_name || '-') + '</td>'
                + '<td>' + (months[tg.period_month] || tg.period_month) + ' ' + tg.period_year + '</td>'
                + '<td>' + fmt(tg.target_amount) + '</td>'
                + '<td class="text-' + (tg.achieved_amount >= tg.target_amount ? 'success' : 'muted') + '">' + fmt(tg.achieved_amount) + '</td>'
                + '<td><div class="progress-bar" style="background:#e2e8f0;border-radius:10px;height:10px;width:100%"><div class="progress-fill" style="width:' + barW + '%;background:' + barCls + ';height:100%;border-radius:10px"></div></div><small>' + pct.toFixed(1) + '%</small></td>'
                + '<td>' + fmt(tg.commission_amount || (tg.target_amount * tg.commission_pct / 100)) + '</td>'
                + '<td class="actions-cell">'
                + '<button class="icon-btn" onclick="window.crmTgEdit(' + tg.id + ')" title="تعديل"><i class="fa-solid fa-pen"></i></button>'
                + '<button class="icon-btn text-danger" onclick="window.crmTgDelete(' + tg.id + ')" title="حذف"><i class="fa-solid fa-trash"></i></button>'
                + '</td></tr>';
        }).join('');
    }

    async function crmTgCreate() {
        const reps = await api('/reps?limit=100');
        const repOpts = reps.success && reps.data ? reps.data.map(r => '<option value="' + r.id + '">' + esc(r.rep_name) + '</option>').join('') : '';
        const now = new Date();
        showModal('مستهدف جديد', '<div class="form-grid">'
            + '<div class="form-group"><label>المندوب</label><select id="f-tg-rep" class="form-control">' + repOpts + '</select></div>'
            + '<div class="form-group"><label>الشهر</label><select id="f-tg-month" class="form-control">'
            + [1,2,3,4,5,6,7,8,9,10,11,12].map(m => '<option value="' + m + '"' + (m === now.getMonth()+1 ? ' selected' : '') + '>' + ['','يناير','فبراير','مارس','إبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'][m] + '</option>').join('')
            + '</select></div>'
            + '<div class="form-group"><label>السنة</label><input type="number" id="f-tg-year" class="form-control" value="' + now.getFullYear() + '"></div>'
            + '<div class="form-group"><label>قيمة المستهدف</label><input type="number" id="f-tg-amount" class="form-control" step="0.01"></div>'
            + '<div class="form-group"><label>نسبة العمولة %</label><input type="number" id="f-tg-pct" class="form-control" step="0.01"></div>'
            + '<div class="form-group" style="grid-column:span 2"><label>ملاحظات</label><textarea id="f-tg-notes" class="form-control"></textarea></div>'
            + '</div>', async () => {
            const body = {
                rep_id: parseInt(document.getElementById('f-tg-rep').value),
                period_month: parseInt(document.getElementById('f-tg-month').value),
                period_year: parseInt(document.getElementById('f-tg-year').value),
                target_amount: parseFloat(document.getElementById('f-tg-amount').value) || 0,
                commission_pct: parseFloat(document.getElementById('f-tg-pct').value) || 0
            };
            const r = await api('/crm/targets', 'POST', body);
            if (r.success) { document.getElementById('global-modal').classList.remove('active'); loadCrmTargets(); }
            else { alert(r.message || 'فشل الإنشاء'); }
        });
    }

    async function crmTgEdit(id) {
        const res = await api('/crm/targets/' + id);
        if (!res.success) { alert(res.message); return; }
        const tg = res.data;
        showModal('تعديل المستهدف', '<div class="form-grid">'
            + '<div class="form-group"><label>قيمة المستهدف</label><input type="number" id="f-tg-amount" class="form-control" step="0.01" value="' + tg.target_amount + '"></div>'
            + '<div class="form-group"><label>نسبة العمولة %</label><input type="number" id="f-tg-pct" class="form-control" step="0.01" value="' + tg.commission_pct + '"></div>'
            + '<div class="form-group" style="grid-column:span 2"><label>ملاحظات</label><textarea id="f-tg-notes" class="form-control">' + esc(tg.notes) + '</textarea></div>'
            + '</div>', async () => {
            const body = {
                target_amount: parseFloat(document.getElementById('f-tg-amount').value) || 0,
                commission_pct: parseFloat(document.getElementById('f-tg-pct').value) || 0
            };
            const r = await api('/crm/targets/' + id, 'PUT', body);
            if (r.success) { document.getElementById('global-modal').classList.remove('active'); loadCrmTargets(); }
            else { alert(r.message || 'فشل التعديل'); }
        });
    }

    async function crmTgDelete(id) {
        if (!confirm('تأكيد حذف المستهدف؟')) return;
        const r = await api('/crm/targets/' + id, 'DELETE');
        if (r.success) loadCrmTargets();
        else alert(r.message);
    }

    // ─── SETTLEMENTS ──────────────────────────────────────────
    async function loadCrmSettlements() {
        const tbody = document.getElementById('crm-st-tbody');
        if (!tbody) return;
        loadingMsg(tbody);
        const type = document.getElementById('crm-st-type');
        const status = document.getElementById('crm-st-status');
        const search = document.getElementById('crm-st-search');
        let params = '?limit=50';
        if (search && search.value) params += '&q=' + encodeURIComponent(search.value);
        if (type && type.value) params += '&type=' + type.value;
        if (status && status.value) params += '&workflow_status=' + status.value;
        const res = await api('/crm/settlements' + params);
        if (!res.success) { emptyMsg(tbody, 8, 'خطأ في تحميل البيانات'); return; }
        if (!res.data || res.data.length === 0) { emptyMsg(tbody, 8); return; }
        tbody.innerHTML = res.data.map(st => {
            const tpCls = st.type === 'credit' ? 'paid' : 'overdue';
            const tpLbl = st.type === 'credit' ? 'دائن' : 'مدين';
            const wsCls = st.workflow_status === 'approved' ? 'paid' : st.workflow_status === 'reversed' ? 'overdue' : 'pending';
            const wsLbl = st.workflow_status === 'approved' ? 'معتمدة' : st.workflow_status === 'reversed' ? 'ملغية' : 'مسودة';
            return '<tr>'
                + '<td>' + esc(st.settlement_no) + '</td>'
                + '<td>' + (st.settlement_date ? st.settlement_date.slice(0, 10) : '-') + '</td>'
                + '<td>' + esc(st.customer_name || '-') + '</td>'
                + '<td><span class="badge-status ' + tpCls + '">' + tpLbl + '</span></td>'
                + '<td>' + fmt(st.amount) + '</td>'
                + '<td>' + esc(st.reason || '-') + '</td>'
                + '<td><span class="badge-status ' + wsCls + '">' + wsLbl + '</span></td>'
                + '<td class="actions-cell">'
                + (st.workflow_status === 'draft' ? '<button class="icon-btn" onclick="window.crmStEdit(' + st.id + ')" title="تعديل"><i class="fa-solid fa-pen"></i></button>' : '')
                + (st.workflow_status === 'draft' ? '<button class="icon-btn text-success" onclick="window.crmStApprove(' + st.id + ')" title="اعتماد"><i class="fa-solid fa-check-circle"></i></button>' : '')
                + (st.workflow_status === 'approved' ? '<button class="icon-btn text-warning" onclick="window.crmStReverse(' + st.id + ')" title="عكس"><i class="fa-solid fa-undo"></i></button>' : '')
                + (st.workflow_status === 'draft' ? '<button class="icon-btn text-danger" onclick="window.crmStDelete(' + st.id + ')" title="حذف"><i class="fa-solid fa-trash"></i></button>' : '')
                + '</td></tr>';
        }).join('');
    }

    async function crmStCreate() {
        const custs = await api('/customers?limit=500');
        const custOpts = custs.success && custs.data ? custs.data.map(c => '<option value="' + c.id + '">' + esc(c.customer_name) + '</option>').join('') : '';
        showModal('تسوية جديدة', '<div class="form-grid">'
            + '<div class="form-group"><label>العميل</label><select id="f-st-cust" class="form-control">' + custOpts + '</select></div>'
            + '<div class="form-group"><label>التاريخ</label><input type="date" id="f-st-date" class="form-control" value="' + new Date().toISOString().slice(0, 10) + '"></div>'
            + '<div class="form-group"><label>النوع</label><select id="f-st-type" class="form-control"><option value="debit">مدين (على العميل)</option><option value="credit">دائن (لصالح العميل)</option></select></div>'
            + '<div class="form-group"><label>المبلغ</label><input type="number" id="f-st-amount" class="form-control" step="0.01"></div>'
            + '<div class="form-group" style="grid-column:span 2"><label>السبب</label><textarea id="f-st-reason" class="form-control"></textarea></div>'
            + '</div>', async () => {
            const body = {
                customer_id: parseInt(document.getElementById('f-st-cust').value),
                settlement_date: document.getElementById('f-st-date').value,
                type: document.getElementById('f-st-type').value,
                amount: parseFloat(document.getElementById('f-st-amount').value) || 0,
                reason: document.getElementById('f-st-reason').value
            };
            const r = await api('/crm/settlements', 'POST', body);
            if (r.success) { document.getElementById('global-modal').classList.remove('active'); loadCrmSettlements(); }
            else { alert(r.message || 'فشل الإنشاء'); }
        });
    }

    async function crmStEdit(id) {
        const res = await api('/crm/settlements/' + id);
        if (!res.success) { alert(res.message); return; }
        const st = res.data;
        const custs = await api('/customers?limit=500');
        const custOpts = custs.success && custs.data ? custs.data.map(c => '<option value="' + c.id + '"' + (c.id === st.customer_id ? ' selected' : '') + '>' + esc(c.customer_name) + '</option>').join('') : '';
        showModal('تعديل التسوية', '<div class="form-grid">'
            + '<div class="form-group"><label>العميل</label><select id="f-st-cust" class="form-control">' + custOpts + '</select></div>'
            + '<div class="form-group"><label>التاريخ</label><input type="date" id="f-st-date" class="form-control" value="' + (st.settlement_date ? st.settlement_date.slice(0, 10) : '') + '"></div>'
            + '<div class="form-group"><label>النوع</label><select id="f-st-type" class="form-control"><option value="debit"' + (st.type === 'debit' ? ' selected' : '') + '>مدين (على العميل)</option><option value="credit"' + (st.type === 'credit' ? ' selected' : '') + '>دائن (لصالح العميل)</option></select></div>'
            + '<div class="form-group"><label>المبلغ</label><input type="number" id="f-st-amount" class="form-control" step="0.01" value="' + st.amount + '"></div>'
            + '<div class="form-group" style="grid-column:span 2"><label>السبب</label><textarea id="f-st-reason" class="form-control">' + esc(st.reason) + '</textarea></div>'
            + '</div>', async () => {
            const body = {
                customer_id: parseInt(document.getElementById('f-st-cust').value),
                settlement_date: document.getElementById('f-st-date').value,
                type: document.getElementById('f-st-type').value,
                amount: parseFloat(document.getElementById('f-st-amount').value) || 0,
                reason: document.getElementById('f-st-reason').value
            };
            const r = await api('/crm/settlements/' + id, 'PUT', body);
            if (r.success) { document.getElementById('global-modal').classList.remove('active'); loadCrmSettlements(); }
            else { alert(r.message || 'فشل التعديل'); }
        });
    }

    async function crmStApprove(id) {
        if (!confirm('تأكيد اعتماد التسوية؟')) return;
        const r = await api('/crm/settlements/' + id + '/approve', 'PATCH');
        if (r.success) loadCrmSettlements();
        else alert(r.message || 'فشل الاعتماد');
    }

    async function crmStReverse(id) {
        if (!confirm('تأكيد عكس التسوية؟')) return;
        const r = await api('/crm/settlements/' + id + '/reverse', 'PATCH');
        if (r.success) loadCrmSettlements();
        else alert(r.message || 'فشل العكس');
    }

    async function crmStDelete(id) {
        if (!confirm('تأكيد حذف التسوية؟')) return;
        const r = await api('/crm/settlements/' + id, 'DELETE');
        if (r.success) loadCrmSettlements();
        else alert(r.message);
    }

    // ─── SETTLEMENTS REPORT (read-only) ───────────────────────
    window.loadCrmSettlementsReport = async function () {
        const tbody = document.getElementById('st-report-tbody');
        if (!tbody) return;
        const now = new Date();
        const fromInput = document.getElementById('st-report-from');
        const toInput = document.getElementById('st-report-to');
        if (fromInput && !fromInput.value) fromInput.value = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
        if (toInput && !toInput.value) toInput.value = now.toISOString().slice(0, 10);

        let currentRows = [];

        function typeLabel(t) { return t === 'debit' ? 'مدين (على العميل)' : t === 'credit' ? 'دائن (لصالح العميل)' : (t || '-'); }
        function typeBadge(t) { const cls = t === 'credit' ? 'paid' : 'overdue'; return '<span class="badge-status ' + cls + '">' + typeLabel(t) + '</span>'; }
        function statusLabel(s) { const map = { draft: 'مسودة', approved: 'معتمدة', reversed: 'ملغية' }; return map[s] || s || '-'; }
        function statusBadge(s) { const cls = s === 'approved' ? 'paid' : s === 'reversed' ? 'overdue' : 'pending'; return '<span class="badge-status ' + cls + '">' + statusLabel(s) + '</span>'; }

        async function loadFilters() {
            const custSel = document.getElementById('st-report-customer');
            if (custSel && !custSel.dataset.loaded) {
                try {
                    const r = await api('/customers?limit=500');
                    if (r.success && r.data) {
                        r.data.forEach(c => {
                            const opt = document.createElement('option');
                            opt.value = c.id;
                            opt.textContent = c.customer_name;
                            custSel.appendChild(opt);
                        });
                    }
                } catch (e) { console.error(e); }
                custSel.dataset.loaded = '1';
            }
            const userSel = document.getElementById('st-report-user');
            if (userSel && !userSel.dataset.loaded) {
                try {
                    const r = await api('/crm/settlements/creators');
                    if (r.success && r.data) {
                        r.data.forEach(u => {
                            const opt = document.createElement('option');
                            opt.value = u.id;
                            opt.textContent = u.full_name || u.username;
                            userSel.appendChild(opt);
                        });
                    }
                } catch (e) { console.error(e); }
                userSel.dataset.loaded = '1';
            }
        }

        async function loadReport() {
            const params = new URLSearchParams();
            const q = document.getElementById('st-report-search')?.value;
            const from = document.getElementById('st-report-from')?.value;
            const to = document.getElementById('st-report-to')?.value;
            const customer = document.getElementById('st-report-customer')?.value;
            const type = document.getElementById('st-report-type')?.value;
            const user = document.getElementById('st-report-user')?.value;
            const reason = document.getElementById('st-report-reason')?.value;
            const status = document.getElementById('st-report-status')?.value;
            if (q) params.append('q', q);
            if (from) params.append('date_from', from);
            if (to) params.append('date_to', to);
            if (customer) params.append('customer_id', customer);
            if (type) params.append('type', type);
            if (user) params.append('created_by', user);
            if (reason) params.append('reason', reason);
            if (status) params.append('workflow_status', status);
            loadingMsg(tbody);
            const res = await api('/crm/settlements' + (params.toString() ? '?' + params : ''));
            if (!res.success) { emptyMsg(tbody, 8, 'خطأ في تحميل البيانات'); return; }
            const rows = res.data || [];
            currentRows = rows;
            renderTable(rows);
            renderSummary(res.summary || rows);
        }

        function renderTable(rows) {
            tbody.innerHTML = '';
            if (rows.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-muted)">لا توجد تسويات في الفترة المحددة</td></tr>';
                return;
            }
            rows.forEach(st => {
                const tr = document.createElement('tr');
                tr.innerHTML = '<td><strong>' + esc(st.settlement_no) + '</strong></td>'
                    + '<td>' + (st.settlement_date ? st.settlement_date.slice(0, 10) : '-') + '</td>'
                    + '<td>' + esc(st.customer_name || '-') + '</td>'
                    + '<td>' + typeBadge(st.type) + '</td>'
                    + '<td class="text-success"><strong>' + fmt(st.amount) + ' ج.م</strong></td>'
                    + '<td>' + esc(st.reason || '-') + '</td>'
                    + '<td>' + esc(st.created_by_name || '-') + '</td>'
                    + '<td>' + statusBadge(st.workflow_status) + '</td>';
                tbody.appendChild(tr);
            });
        }

        function renderSummary(src) {
            const set = (id, val) => { const e = document.getElementById(id); if (e) e.innerHTML = val; };
            if (src && src.total_count !== undefined) {
                set('st-report-sum-debit', fmt(src.total_debit) + ' ج.م');
                set('st-report-sum-credit', fmt(src.total_credit) + ' ج.م');
                set('st-report-sum-net', fmt(src.net) + ' ج.م');
            } else {
                let debit = 0, credit = 0;
                currentRows.forEach(s => { if (s.type === 'debit') debit += Number(s.amount || 0); else credit += Number(s.amount || 0); });
                set('st-report-sum-debit', fmt(debit) + ' ج.م');
                set('st-report-sum-credit', fmt(credit) + ' ج.م');
                set('st-report-sum-net', fmt(debit - credit) + ' ج.م');
            }
        }

        function getCompanyInfo() {
            let coName = '', coPhone = '', coAddr = '', coLogo = '';
            try {
                const settings = window.AppData && window.AppData.settings;
                if (settings) {
                    coName = settings.company_name || settings.name || '';
                    coPhone = settings.company_phone || settings.phone || '';
                    coAddr = settings.company_address || settings.address || '';
                    coLogo = settings.logo_url || '';
                }
            } catch (e) {}
            return { coName, coPhone, coAddr, coLogo };
        }

        function printReport(mode) {
            if (currentRows.length === 0) { alert('لا توجد بيانات للطباعة'); return; }
            const co = getCompanyInfo();
            const from = document.getElementById('st-report-from')?.value || '—';
            const to = document.getElementById('st-report-to')?.value || '—';

            let rows = '';
            currentRows.forEach((s, i) => {
                const bg = i % 2 === 0 ? '#fff' : '#f9fafb';
                rows += '<tr style="background:' + bg + '">'
                    + '<td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:center">' + esc(s.settlement_no || '-') + '</td>'
                    + '<td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:center">' + (s.settlement_date ? s.settlement_date.slice(0, 10) : '-') + '</td>'
                    + '<td style="padding:5px 8px;border:1px solid #e5e7eb">' + esc(s.customer_name || '-') + '</td>'
                    + '<td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:center">' + typeLabel(s.type) + '</td>'
                    + '<td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:right;direction:ltr">' + fmt(s.amount) + '</td>'
                    + '<td style="padding:5px 8px;border:1px solid #e5e7eb">' + esc(s.reason || '-') + '</td>'
                    + '<td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:center">' + esc(s.created_by_name || '-') + '</td>'
                    + '<td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:center">' + statusLabel(s.workflow_status) + '</td>'
                    + '</tr>';
            });

            let tDebit = 0, tCredit = 0;
            currentRows.forEach(s => { if (s.type === 'debit') tDebit += Number(s.amount || 0); else tCredit += Number(s.amount || 0); });
            const totalRow = '<tr style="background:#fef2f2;font-weight:700">'
                + '<td colspan="4" style="padding:6px 8px;border:1px solid #e5e7eb;text-align:center">الإجمالي</td>'
                + '<td style="padding:6px 8px;border:1px solid #e5e7eb;text-align:right;direction:ltr">' + fmt(tDebit + tCredit) + '</td>'
                + '<td colspan="3" style="padding:6px 8px;border:1px solid #e5e7eb;text-align:center"></td>'
                + '</tr>';

            const logoHtml = co.coLogo ? '<img src="' + co.coLogo + '" style="max-height:55px;max-width:120px;object-fit:contain;margin-bottom:6px" onerror="this.style.display=\'none\'">' : '';
            const printDate = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });

            const w = window.open('', '_blank', 'width=1200,height=800,scrollbars=yes');
            if (!w) { alert('يرجى السماح بفتح نوافذ جديدة في المتصفح'); return; }
            w.document.write('<!DOCTYPE html><html dir="rtl" lang="ar"><head>'
                + '<meta charset="UTF-8">'
                + '<title>تقرير تسويات العملاء - ' + esc(co.coName) + '</title>'
                + '<style>'
                + 'body{font-family:"Segoe UI",Arial,sans-serif;margin:20px;color:#1e293b;font-size:11.5px;}'
                + '.print-header{text-align:center;margin-bottom:18px;padding-bottom:14px;border-bottom:3px solid #7c3aed;}'
                + '.co-name{font-size:1.3rem;font-weight:800;color:#1e293b;}'
                + '.co-info{font-size:0.8rem;color:#64748b;margin-top:3px;}'
                + '.report-title{font-size:1.1rem;font-weight:700;margin:10px 0 4px;color:#7c3aed;}'
                + '.report-period{font-size:0.85rem;color:#475569;}'
                + 'table{width:100%;border-collapse:collapse;margin-top:12px;font-size:11px;}'
                + 'th{background:#7c3aed;color:#fff;padding:7px 8px;border:1px solid #7c3aed;text-align:center;font-size:10.5px;font-weight:600;white-space:nowrap;}'
                + '.footer-print{text-align:center;font-size:10px;color:#94a3b8;margin-top:18px;padding-top:8px;border-top:1px solid #e2e8f0;}'
                + '@media print{body{margin:12px;}-webkit-print-color-adjust:exact;print-color-adjust:exact;}'
                + '</style></head><body>'
                + '<div class="print-header">'
                + (logoHtml ? '<div>' + logoHtml + '</div>' : '')
                + '<div class="co-name">' + esc(co.coName) + '</div>'
                + '<div class="co-info">' + [co.coAddr, co.coPhone].filter(Boolean).map(esc).join(' | ') + '</div>'
                + '<div class="report-title">تقرير تسويات العملاء</div>'
                + '<div class="report-period">من ' + esc(from) + ' إلى ' + esc(to) + ' | تاريخ الطباعة: ' + printDate + '</div>'
                + '</div>'
                + '<table><thead><tr>'
                + '<th>رقم التسوية</th><th>التاريخ</th><th>العميل</th><th>النوع</th><th>المبلغ</th><th>السبب</th><th>المستخدم</th><th>الحالة</th>'
                + '</tr></thead><tbody>' + rows + totalRow + '</tbody></table>'
                + '<div class="footer-print">TradePro ERP &mdash; تقرير تسويات العملاء</div>'
                + (mode === 'pdf' ? '' : '<script>window.onload=function(){window.print();};<\/script>')
                + '</body></html>');
            w.document.close();
        }

        function exportExcel() {
            if (currentRows.length === 0) { alert('لا توجد بيانات للتصدير'); return; }
            const from = document.getElementById('st-report-from')?.value || 'البداية';
            const to = document.getElementById('st-report-to')?.value || 'النهاية';
            const headers = ['رقم التسوية', 'التاريخ', 'العميل', 'النوع', 'المبلغ', 'السبب', 'المستخدم', 'الحالة'];
            const dataRows = currentRows.map(s => [
                s.settlement_no || '', s.settlement_date || '', s.customer_name || '', typeLabel(s.type),
                Number(s.amount || 0), s.reason || '', s.created_by_name || '', statusLabel(s.workflow_status)
            ]);
            let tDebit = 0, tCredit = 0;
            currentRows.forEach(s => { if (s.type === 'debit') tDebit += Number(s.amount || 0); else tCredit += Number(s.amount || 0); });
            dataRows.push(['الإجمالي', '', '', '', tDebit + tCredit, '', '', '']);
            if (window.ExportService) {
                window.ExportService.exportReport('excel', {
                    filename: 'settlements-report-' + (from.replace(/-/g, '')) + '-' + (to.replace(/-/g, '')),
                    headers: headers,
                    rows: dataRows
                });
            }
        }

        await loadFilters();
        await loadReport();

        ['st-report-from', 'st-report-to', 'st-report-customer', 'st-report-type',
         'st-report-user', 'st-report-status'].forEach(id => {
            const el = document.getElementById(id);
            if (el && !el.dataset.bound) {
                el.dataset.bound = '1';
                el.addEventListener('change', loadReport);
            }
        });
        ['st-report-search', 'st-report-reason'].forEach(id => {
            const el = document.getElementById(id);
            if (el && !el.dataset.bound) {
                el.dataset.bound = '1';
                el.addEventListener('input', () => { clearTimeout(el._t); el._t = setTimeout(loadReport, 400); });
            }
        });
        const viewBtn = document.getElementById('btn-st-report-view');
        if (viewBtn) viewBtn.onclick = loadReport;
        const printBtn = document.getElementById('btn-st-report-print');
        if (printBtn) printBtn.onclick = () => printReport('print');
        const pdfBtn = document.getElementById('btn-st-report-pdf');
        if (pdfBtn) pdfBtn.onclick = () => printReport('pdf');
        const excelBtn = document.getElementById('btn-st-report-excel');
        if (excelBtn) excelBtn.onclick = exportExcel;
    };
    window.viewHandlers = window.viewHandlers || {};
    window.viewHandlers['view-crm-settlements-report'] = window.loadCrmSettlementsReport;

    // ─── BIND EVENTS ──────────────────────────────────────────
    function bindEvents() {
        const btnNew = document.getElementById('btn-crm-wp-new');
        if (btnNew) { const clone = btnNew.cloneNode(true); btnNew.parentNode.replaceChild(clone, btnNew); clone.addEventListener('click', crmWpCreate); }
        const btnRef = document.getElementById('btn-crm-wp-refresh');
        if (btnRef) { const clone = btnRef.cloneNode(true); btnRef.parentNode.replaceChild(clone, btnRef); clone.addEventListener('click', loadCrmWorkplan); }
        ['crm-wp-search', 'crm-wp-date', 'crm-wp-status'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { const clone = el.cloneNode(true); el.parentNode.replaceChild(clone, el); clone.addEventListener('change', loadCrmWorkplan); if (clone.type === 'text') clone.addEventListener('keyup', () => setTimeout(loadCrmWorkplan, 400)); }
        });
        const btnTgNew = document.getElementById('btn-crm-tg-new');
        if (btnTgNew) { const clone = btnTgNew.cloneNode(true); btnTgNew.parentNode.replaceChild(clone, btnTgNew); clone.addEventListener('click', crmTgCreate); }
        const btnTgRef = document.getElementById('btn-crm-tg-refresh');
        if (btnTgRef) { const clone = btnTgRef.cloneNode(true); btnTgRef.parentNode.replaceChild(clone, btnTgRef); clone.addEventListener('click', loadCrmTargets); }
        ['crm-tg-month', 'crm-tg-year'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { const clone = el.cloneNode(true); el.parentNode.replaceChild(clone, el); clone.addEventListener('change', loadCrmTargets); }
        });
        const btnStNew = document.getElementById('btn-crm-st-new');
        if (btnStNew) { const clone = btnStNew.cloneNode(true); btnStNew.parentNode.replaceChild(clone, btnStNew); clone.addEventListener('click', crmStCreate); }
        const btnStRef = document.getElementById('btn-crm-st-refresh');
        if (btnStRef) { const clone = btnStRef.cloneNode(true); btnStRef.parentNode.replaceChild(clone, btnStRef); clone.addEventListener('click', loadCrmSettlements); }
        const stSearch = document.getElementById('crm-st-search');
        if (stSearch) { const clone = stSearch.cloneNode(true); stSearch.parentNode.replaceChild(clone, stSearch); clone.addEventListener('input', () => { clearTimeout(stSearch._t); stSearch._t = setTimeout(loadCrmSettlements, 400); }); }
        ['crm-st-type', 'crm-st-status'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { const clone = el.cloneNode(true); el.parentNode.replaceChild(clone, el); clone.addEventListener('change', loadCrmSettlements); }
        });
    }

    // ─── EXPORT ───────────────────────────────────────────────
    window.loadCrmWorkplan = loadCrmWorkplan;
    window.loadCrmTargets = loadCrmTargets;
    window.loadCrmSettlements = loadCrmSettlements;
    window.crmWpCreate = crmWpCreate;
    window.crmWpEdit = crmWpEdit;
    window.crmWpComplete = crmWpComplete;
    window.crmWpDelete = crmWpDelete;
    window.crmTgCreate = crmTgCreate;
    window.crmTgEdit = crmTgEdit;
    window.crmTgDelete = crmTgDelete;
    window.crmStCreate = crmStCreate;
    window.crmStEdit = crmStEdit;
    window.crmStApprove = crmStApprove;
    window.crmStReverse = crmStReverse;
    window.crmStDelete = crmStDelete;

    window.viewHandlers = window.viewHandlers || {};
    window.viewHandlers['view-crm-workplan'] = loadCrmWorkplan;
    window.viewHandlers['view-crm-targets'] = loadCrmTargets;
    window.viewHandlers['view-crm-settlements'] = loadCrmSettlements;

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindEvents);
    else bindEvents();
})();
