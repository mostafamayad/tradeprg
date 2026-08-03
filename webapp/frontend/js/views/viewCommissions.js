(function() {
    'use strict';
    window.viewHandlers = window.viewHandlers || {};
    const viewHandlers = window.viewHandlers;
    const req = (...args) => window.req(...args);
    const fmt = (...args) => window.fmt(...args);

    const STATUS_MAP = {
        0: { label: 'قيد المراجعة', cls: 'pending' },
        1: { label: 'تمت المراجعة', cls: 'reviewed' },
        2: { label: 'معتمدة', cls: 'approved' },
        3: { label: 'مجمدة', cls: 'locked' },
        5: { label: 'ملغاة', cls: 'cancelled' }
    };

    function badge(status) {
        const s = STATUS_MAP[status] || { label: 'غير معروف', cls: 'pending' };
        return '<span class="badge-status ' + s.cls + '">' + s.label + '</span>';
    }

    viewHandlers['view-commissions'] = async function() {
        const periodInput = document.getElementById('comm-period');
        const repSelect = document.getElementById('comm-rep');
        const tbody = document.getElementById('comm-tbody');
        const summary = document.getElementById('comm-summary');
        const periodLabel = document.getElementById('comm-period-label');
        const approveBtn = document.getElementById('comm-approve-btn');
        const settleBtn = document.getElementById('comm-settle-btn');
        const postGlBtn = document.getElementById('comm-postgl-btn');
        const selectAll = document.getElementById('comm-select-all');

        if (!periodInput) return;

        const now = new Date();
        if (!periodInput.value) {
            periodInput.value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
        }

        async function loadReps() {
            const r = await req('/commissions/transactions?period=' + periodInput.value);
            if (!r.success) return;
            const reps = {};
            (r.data || []).forEach(t => {
                if (t.rep_id && !reps[t.rep_id]) reps[t.rep_id] = t.rep_name || t.rep_code || ('#' + t.rep_id);
            });
            repSelect.innerHTML = '<option value="">الكل</option>';
            Object.entries(reps).forEach(([id, name]) => {
                repSelect.innerHTML += '<option value="' + id + '">' + esc(name) + '</option>';
            });
        }

        async function loadData() {
            const period = periodInput.value;
            const repId = repSelect.value;
            if (!period) return;

            tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:30px;color:var(--text-muted)"><i class="fa-solid fa-spinner fa-spin"></i> جاري التحميل...</td></tr>';
            approveBtn.disabled = true;
            settleBtn.disabled = true;
            if (postGlBtn) postGlBtn.disabled = true;

            let url = '/commissions/transactions?period=' + period;
            if (repId) url = '/commissions/transactions?rep_id=' + repId + '&period=' + period;

            const r = await req(url);
            if (!r.success) {
                tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:30px;color:#ef4444">خطأ في التحميل: ' + esc(r.message) + '</td></tr>';
                return;
            }

            const data = r.data || [];
            periodLabel.textContent = period;

            if (data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--text-muted)">لا توجد عمولات لهذه الفترة</td></tr>';
                summary.innerHTML = '';
                return;
            }

            let totalComm = 0, totalPending = 0, totalApproved = 0;
            tbody.innerHTML = '';

            data.forEach(t => {
                const comm = parseFloat(t.commission_amount) || 0;
                const coll = parseFloat(t.collection_amount) || 0;
                const pct = parseFloat(t.achievement_pct) || 0;
                const rate = parseFloat(t.effective_rate) || 0;
                const st = parseInt(t.workflow_status) || 0;
                const posted = t.is_posted_to_gl ? '<i class="fa-solid fa-check-circle" style="color:#059669"></i>' : '<i class="fa-solid fa-minus" style="color:#ccc"></i>';

                totalComm += comm;
                if (st === 0) totalPending += comm;
                if (st >= 2) totalApproved += comm;

                const canCheck = st === 0 || st === 1 || st === 2;
                const tr = document.createElement('tr');
                tr.innerHTML = '<td><input type="checkbox" class="comm-check" data-id="' + t.id + '" data-status="' + st + '" data-posted="' + (t.is_posted_to_gl ? '1' : '0') + '" ' + (canCheck ? '' : 'disabled') + '></td>' +
                    '<td><strong>' + esc(t.rep_name || t.rep_code || '') + '</strong></td>' +
                    '<td>' + esc(t.customer_name || '') + '</td>' +
                    '<td>' + esc(t.collection_no || '') + '</td>' +
                    '<td>' + fmt(coll) + '</td>' +
                    '<td>' + pct.toFixed(1) + '%</td>' +
                    '<td>' + rate.toFixed(2) + '%</td>' +
                    '<td><strong>' + fmt(comm) + '</strong></td>' +
                    '<td>' + badge(st) + '</td>' +
                    '<td>' + posted + '</td>';
                tbody.appendChild(tr);
            });

            summary.innerHTML =
                '<span>الإجمالي: <strong>' + fmt(totalComm) + '</strong></span>' +
                '<span>قيد المراجعة: <strong style="color:#f59e0b">' + fmt(totalPending) + '</strong></span>' +
                '<span>معتمدة: <strong style="color:#059669">' + fmt(totalApproved) + '</strong></span>' +
                '<span>عدد السجلات: <strong>' + data.length + '</strong></span>';

            approveBtn.disabled = false;
            settleBtn.disabled = false;
            if (postGlBtn) postGlBtn.disabled = false;
        }

        function getSelectedIds(minStatus, maxStatus) {
            const ids = [];
            document.querySelectorAll('.comm-check:checked').forEach(cb => {
                const st = parseInt(cb.dataset.status);
                if (st >= minStatus && st <= maxStatus) ids.push(parseInt(cb.dataset.id));
            });
            return ids;
        }

        approveBtn.onclick = async function() {
            const ids = getSelectedIds(0, 1);
            if (ids.length === 0) { alert('اختر عمولات قيد المراجعة أو المراجعة'); return; }
            if (!confirm('اعتماد ' + ids.length + ' عمولة؟ (لن يتم إنشاء قيد محاسبي — الترحيل خطوة منفصلة)')) return;
            const r = await req('/commissions/transactions/approve', 'POST', { ids });
            if (r.success) {
                alert('تم الاعتماد بنجاح');
                loadData();
            } else {
                alert('خطأ: ' + r.message);
            }
        };

        const postGlBtn = document.getElementById('comm-postgl-btn');
        if (postGlBtn) {
            postGlBtn.onclick = async function() {
                const ids = getSelectedIds(2, 2);
                const unposted = [];
                document.querySelectorAll('.comm-check:checked').forEach(cb => {
                    const st = parseInt(cb.dataset.status);
                    if (st === 2 && !cb.dataset.posted) unposted.push(parseInt(cb.dataset.id));
                });
                const finalIds = unposted.length > 0 ? unposted : ids;
                if (finalIds.length === 0) { alert('اختر عمولات معتمدة غير مرحّلة'); return; }
                if (!confirm('ترحيل ' + finalIds.length + ' عمولة للمحاسبة؟ سيتم إنشاء قيد محاسبي.')) return;
                const r = await req('/commissions/transactions/post-to-gl', 'POST', { ids: finalIds });
                if (r.success) {
                    alert('تم الترحيل بنجاح' + (r.data && r.data.jeId ? ' (قيد رقم ' + r.data.jeId + ')' : ''));
                    loadData();
                } else {
                    alert('خطأ: ' + r.message);
                }
            };
        }

        settleBtn.onclick = async function() {
            const ids = getSelectedIds(2, 2);
            if (ids.length === 0) { alert('اختر عمولات معتمدة فقط'; return; }
            if (!confirm('تجميد ' + ids.length + ' عمولة؟')) return;
            const r = await req('/commissions/settle', 'POST', { ids });
            if (r.success) {
                alert('تم التجميد بنجاح');
                loadData();
            } else {
                alert('خطأ: ' + r.message);
            }
        };

        selectAll.onchange = function() {
            document.querySelectorAll('.comm-check:not(:disabled)').forEach(cb => {
                cb.checked = selectAll.checked;
            });
        };

        document.getElementById('comm-load-btn').onclick = function() {
            loadReps();
            loadData();
        };

        periodInput.onchange = function() {
            loadReps();
            loadData();
        };

        await loadReps();
        await loadData();
    };

    function esc(v) { return String(v || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
})();
