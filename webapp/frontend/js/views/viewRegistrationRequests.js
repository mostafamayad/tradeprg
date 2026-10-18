// ============================================================
// TradePro ERP - Registration Requests & Leads Management
// ============================================================

(function () {
    'use strict';

    let currentFilter = 'all';

    async function loadRegistrationRequests() {
        const tbody = document.getElementById('reg-requests-tbody');
        if (!tbody) return;

        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--text-muted)"><i class="fa-solid fa-spinner fa-spin"></i> جاري تحميل طلبات التسجيل...</td></tr>';

        try {
            const token = localStorage.getItem('auth_token');
            const res = await fetch(`/api/admin/registrations?status=${currentFilter}`, {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            const result = await res.json();

            if (!result.success) {
                tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--danger)">خطأ: ${result.message || 'تعذر جلب البيانات'}</td></tr>`;
                return;
            }

            const items = result.data || [];
            updateStats(items);

            if (items.length === 0) {
                tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--text-muted)">لا توجد طلبات تسجيل مطابقة</td></tr>';
                return;
            }

            tbody.innerHTML = items.map((r, idx) => {
                const dateStr = r.created_at ? new Date(r.created_at).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' }) : '---';
                const statusBadge = getStatusBadge(r.status);
                const cleanPhone = (r.phone || '').replace(/[^0-9]/g, '');
                const waPhone = cleanPhone.startsWith('0') ? '2' + cleanPhone : cleanPhone;
                const waUrl = waPhone ? `https://wa.me/${waPhone}?text=${encodeURIComponent('مرحباً ' + r.full_name + '، بخصوص طلب اشتراكك في برنامج TradePro ERP...')}` : '#';

                return `
                    <tr>
                        <td style="font-weight:700">${idx + 1}</td>
                        <td style="font-size:12px;color:var(--text-muted)">${dateStr}</td>
                        <td>
                            <strong style="color:var(--text-main)">${esc(r.full_name)}</strong>
                        </td>
                        <td>
                            <a href="mailto:${esc(r.email)}" style="color:var(--primary);text-decoration:none">${esc(r.email)}</a>
                        </td>
                        <td>
                            ${r.phone ? `
                                <div style="display:flex;align-items:center;gap:6px">
                                    <span dir="ltr">${esc(r.phone)}</span>
                                    <a href="${waUrl}" target="_blank" title="مراسلة عبر واتساب" style="color:#22c55e;font-size:16px"><i class="fa-brands fa-whatsapp"></i></a>
                                </div>
                            ` : '---'}
                        </td>
                        <td>${esc(r.company_name || '---')}</td>
                        <td><span class="badge" style="background:rgba(59,130,246,0.15);color:#3b82f6;border:1px solid rgba(59,130,246,0.3)">${esc(r.package_name || 'أساسي')}</span></td>
                        <td>${statusBadge}</td>
                        <td>
                            <div style="display:flex;gap:6px;align-items:center">
                                ${r.status === 'pending' ? `
                                    <button class="btn btn-sm btn-success" onclick="activateRegistration(${r.id}, '${esc(r.email)}', '${esc(r.full_name)}')">
                                        <i class="fa-solid fa-user-check"></i> تفعيل
                                    </button>
                                    <button class="btn btn-sm btn-outline-danger" onclick="rejectRegistration(${r.id})">
                                        <i class="fa-solid fa-ban"></i> رفض
                                    </button>
                                ` : (r.status === 'activated' ? `
                                    <span style="font-size:12px;color:#10b981"><i class="fa-solid fa-circle-check"></i> تم التفعيل</span>
                                ` : `
                                    <span style="font-size:12px;color:#ef4444"><i class="fa-solid fa-circle-xmark"></i> مرفوض</span>
                                    <button class="btn btn-sm btn-link" onclick="reopenRegistration(${r.id})" style="font-size:11px">إعادة فتح</button>
                                `)}
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
        } catch (e) {
            console.error('loadRegistrationRequests error:', e);
            tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--danger)">حدث خطأ: ${e.message}</td></tr>`;
        }
    }

    function getStatusBadge(status) {
        if (status === 'activated') {
            return '<span class="badge" style="background:rgba(16,185,129,0.15);color:#10b981;border:1px solid rgba(16,185,129,0.3)">مفعّل</span>';
        } else if (status === 'rejected') {
            return '<span class="badge" style="background:rgba(239,68,68,0.15);color:#ef4444;border:1px solid rgba(239,68,68,0.3)">مرفوض</span>';
        }
        return '<span class="badge" style="background:rgba(245,158,11,0.15);color:#f59e0b;border:1px solid rgba(245,158,11,0.3)">قيد الانتظار</span>';
    }

    function updateStats(items) {
        const total = items.length;
        const pending = items.filter(i => i.status === 'pending').length;
        const activated = items.filter(i => i.status === 'activated').length;
        const rejected = items.filter(i => i.status === 'rejected').length;

        const elTotal = document.getElementById('reg-stat-total');
        const elPending = document.getElementById('reg-stat-pending');
        const elActivated = document.getElementById('reg-stat-activated');
        const elRejected = document.getElementById('reg-stat-rejected');

        if (elTotal) elTotal.textContent = total;
        if (elPending) elPending.textContent = pending;
        if (elActivated) elActivated.textContent = activated;
        if (elRejected) elRejected.textContent = rejected;
    }

    function esc(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // Expose global actions
    window.loadRegistrationRequests = loadRegistrationRequests;
    window.filterRegistrations = function(status) {
        currentFilter = status;
        document.querySelectorAll('.reg-filter-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-status') === status);
        });
        loadRegistrationRequests();
    };

    window.activateRegistration = async function(id, email, name) {
        if (!confirm(`هل أنت متأكد من تفعيل حساب (${name} - ${email})؟\nسيتم إنشاء المستخدم فوراً في النظام وتمكينه من الدخول.`)) {
            return;
        }

        try {
            const token = localStorage.getItem('auth_token');
            const res = await fetch(`/api/admin/registrations/${id}/activate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + token
                },
                body: JSON.stringify({})
            });

            const data = await res.json();
            if (res.ok && data.success) {
                alert(`✅ ${data.message}\nيمكن للمستخدم الآن تسجيل الدخول باستخدام البريد وكلمة المرور الافتراضية.`);
                loadRegistrationRequests();
            } else {
                alert('خطأ: ' + (data.message || 'فشل التفعيل'));
            }
        } catch (e) {
            alert('حدث خطأ أثناء الاتصال بالخادم: ' + e.message);
        }
    };

    window.rejectRegistration = async function(id) {
        const reason = prompt('سبب الرفض (اختياري):', '');
        if (reason === null) return;

        try {
            const token = localStorage.getItem('auth_token');
            const res = await fetch(`/api/admin/registrations/${id}/status`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + token
                },
                body: JSON.stringify({ status: 'rejected', notes: reason })
            });

            const data = await res.json();
            if (res.ok && data.success) {
                loadRegistrationRequests();
            } else {
                alert('خطأ: ' + (data.message || 'فشل الرفض'));
            }
        } catch (e) {
            alert('حدث خطأ أثناء الاتصال بالخادم: ' + e.message);
        }
    };

    window.reopenRegistration = async function(id) {
        try {
            const token = localStorage.getItem('auth_token');
            const res = await fetch(`/api/admin/registrations/${id}/status`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + token
                },
                body: JSON.stringify({ status: 'pending' })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                loadRegistrationRequests();
            }
        } catch (e) {}
    };

    // Register into viewHandlers
    if (window.viewHandlers) {
        window.viewHandlers['view-registration-requests'] = loadRegistrationRequests;
    }
})();
