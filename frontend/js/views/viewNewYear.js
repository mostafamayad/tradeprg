(function () {
    'use strict';
    window.viewHandlers = window.viewHandlers || {};

    // ─── helpers ────────────────────────────────────────────────────────────────
    function apiFetch(endpoint, opts) {
        var token = localStorage.getItem('auth_token');
        var defaults = { method: 'GET', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } };
        var merged = Object.assign({}, defaults, opts || {});
        if (merged.body && typeof merged.body === 'object') merged.body = JSON.stringify(merged.body);
        return fetch('/api' + endpoint, merged).then(function (r) { return r.json(); });
    }

    function r2(n) { return Math.round(Number(n || 0) * 100) / 100; }
    function fmt(n) { return r2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function esc(v) { return String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function typeLabel(t) {
        var m = { asset: 'أصول', liability: 'خصوم', equity: 'حقوق ملكية', revenue: 'إيرادات', income: 'إيرادات', expense: 'مصروفات' };
        return m[t] || t || '—';
    }

    // ─── main handler ────────────────────────────────────────────────────────────
    window.viewHandlers['view-new-year'] = async function () {
        var view = document.getElementById('view-new-year');
        if (!view) return;

        // ── Detect current year ──────────────────────────────────────────────
        var targetYear = new Date().getFullYear();
        try {
            var sRes = await apiFetch('/settings');
            if (sRes.success && sRes.data) {
                var fySetting = sRes.data.find(function (s) { return s.key === 'current_fiscal_year'; });
                if (fySetting && fySetting.value) targetYear = parseInt(fySetting.value, 10);
            }
        } catch (e) { /* use current year */ }

        // ── Update heading ───────────────────────────────────────────────────
        var h2 = view.querySelector('h2');
        if (h2) h2.textContent = 'إقفال السنة المالية ' + targetYear;

        // ── Get company settings for print header ────────────────────────────
        var companyName = '';
        try {
            var cRes = await apiFetch('/settings');
            if (cRes.success && cRes.data) {
                var cn = cRes.data.find(function (s) { return s.key === 'company_name'; });
                if (cn) companyName = cn.value;
            }
        } catch (e) {}

        // ─────────────────────────────────────────────────────────────────────
        // EXPORT TRIAL BALANCE
        // ─────────────────────────────────────────────────────────────────────
        
        async function loadTrialBalancePreview(year) {
            var tbody = document.getElementById('ny-preview-tbody');
            if (!tbody) return;
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center">جاري التحميل...</td></tr>';
            
            try {
                var from = year + '-01-01';
                var to   = year + '-12-31';
                var tbRes = await apiFetch('/accounting/trial-balance?from=' + from + '&to=' + to + '&includeZero=false');
                if (!tbRes.success) throw new Error(tbRes.message || 'خطأ في جلب الميزان');
                
                var data = tbRes.data || [];
                if (!data.length) {
                    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center">لا توجد بيانات لهذه السنة</td></tr>';
                    return;
                }
                var html = '';
                data.forEach(function (a) {
                    html += '<tr>' +
                        '<td>' + esc(a.account_code) + '</td>' +
                        '<td>' + esc(a.account_name) + '</td>' +
                        '<td>' + typeLabel(a.account_type) + '</td>' +
                        '<td>' + fmt(r2(a.opening_debit) - r2(a.opening_credit)) + '</td>' +
                        '<td>' + fmt(r2(a.period_debit) - r2(a.period_credit)) + '</td>' +
                        '<td>' + fmt(r2(a.closing_debit) - r2(a.closing_credit)) + '</td>' +
                        '</tr>';
                });
                tbody.innerHTML = html;
            } catch (err) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:red;">' + esc(err.message || 'حدث خطأ') + '</td></tr>';
            }
        }

        var btnExport = document.getElementById('btn-export-tb-first');
        if (btnExport) {
            btnExport.onclick = async function () {
                btnExport.disabled = true;
                btnExport.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري التحميل...';
                try {
                    var from = targetYear + '-01-01';
                    var to   = targetYear + '-12-31';
                    var tbRes = await apiFetch('/accounting/trial-balance?from=' + from + '&to=' + to + '&includeZero=true');
                    if (!tbRes.success || !tbRes.data || !tbRes.data.length) {
                        alert('لا توجد بيانات لهذه السنة');
                        return;
                    }
                    var data = tbRes.data;
                    // Build CSV
                    var headers = ['الكود', 'اسم الحساب', 'النوع', 'رصيد أول المدة (مدين)', 'رصيد أول المدة (دائن)', 'حركة مدين', 'حركة دائن', 'رصيد آخر المدة (مدين)', 'رصيد آخر المدة (دائن)'];
                    var dataRows = [];
                    var tOD = 0, tOC = 0, tPD = 0, tPC = 0, tCD = 0, tCC = 0;
                    data.forEach(function (a) {
                        dataRows.push([
                            a.account_code, 
                            a.account_name, 
                            typeLabel(a.account_type),
                            r2(a.opening_debit) || 0, 
                            r2(a.opening_credit) || 0, 
                            r2(a.period_debit) || 0, 
                            r2(a.period_credit) || 0, 
                            r2(a.closing_debit) || 0, 
                            r2(a.closing_credit) || 0
                        ]);
                        tOD += r2(a.opening_debit); tOC += r2(a.opening_credit);
                        tPD += r2(a.period_debit);  tPC += r2(a.period_credit);
                        tCD += r2(a.closing_debit); tCC += r2(a.closing_credit);
                    });

                    if (window.exportStyledExcel) {
                        window.exportStyledExcel({
                            filename: 'trial-balance-' + targetYear,
                            title: 'ميزان المراجعة',
                            subtitle: 'من ' + from + ' إلى ' + to,
                            headers: ['الكود', 'اسم الحساب', 'النوع', 'رصيد أول المدة (مدين)', 'رصيد أول المدة (دائن)', 'حركة مدين', 'حركة دائن', 'رصيد آخر المدة (مدين)', 'رصيد آخر المدة (دائن)'],
                            data: dataRows,
                            totals: ['الإجمالي', '', '', tOD, tOC, tPD, tPC, tCD, tCC],
                            colWidths: [15, 30, 15, 20, 20, 20, 20, 20, 20]
                        });
                    } else {
                        alert('مكتبة التصدير غير متوفرة');
                    }
                } catch (err) {
                    alert('خطأ في تصدير ميزان المراجعة: ' + (err.message || err));
                } finally {
                    btnExport.disabled = false;
                    btnExport.innerHTML = '<i class="fa-solid fa-download"></i> تصدير ميزان المراجعة أولاً';
                }
            };
        }

        // ─────────────────────────────────────────────────────────────────────
        // YEAR CLOSE
        // ─────────────────────────────────────────────────────────────────────
        var btnClose = document.getElementById('btn-do-year-close');
        if (btnClose) {
            btnClose.onclick = function () {
                // Build confirmation modal HTML
                var modalId = 'modal-ny-confirm';
                var existing = document.getElementById(modalId);
                if (existing) existing.remove();

                var overlay = document.createElement('div');
                overlay.id = modalId;
                overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:9999;';
                overlay.innerHTML = '\
<div style="background:var(--bg-card,#fff);border-radius:16px;padding:36px 32px;max-width:480px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.3);">\
  <i class="fa-solid fa-triangle-exclamation" style="font-size:3.5rem;color:var(--danger-color,#dc2626);margin-bottom:16px;display:block"></i>\
  <h2 style="margin-bottom:8px;font-size:1.3rem;">إقفال السنة المالية ' + targetYear + '</h2>\
  <p style="color:var(--text-muted,#64748b);font-size:0.9rem;line-height:1.6;margin-bottom:24px;">\
    سيتم تصفير حسابات الإيرادات والمصروفات وترحيل صافي الربح/الخسارة إلى الأرباح المحتجزة.<br>\
    لن يمكن تعديل قيود هذه السنة بعد الإقفال.\
  </p>\
  <div style="margin-bottom:20px;text-align:right;">\
    <label style="display:block;font-size:0.875rem;font-weight:600;margin-bottom:6px;">كلمة مرور مدير النظام <span style="color:var(--danger-color,#dc2626)">*</span></label>\
    <input type="password" id="ny-admin-pass" class="form-control" placeholder="أدخل كلمة المرور للتأكيد" style="width:100%">\
  </div>\
  <div style="display:flex;gap:12px;justify-content:center;">\
    <button id="ny-btn-cancel" class="btn btn-outline" style="min-width:120px">إلغاء</button>\
    <button id="ny-btn-confirm" class="btn btn-primary" style="min-width:150px;background:var(--danger-color,#dc2626);border-color:var(--danger-color,#dc2626)">\
      <i class="fa-solid fa-lock"></i> تأكيد الإقفال\
    </button>\
  </div>\
  <div id="ny-confirm-msg" style="margin-top:14px;font-size:0.85rem;"></div>\
</div>';

                document.body.appendChild(overlay);
                setTimeout(function () { var el = document.getElementById('ny-admin-pass'); if (el) el.focus(); }, 100);

                // Cancel
                document.getElementById('ny-btn-cancel').onclick = function () { overlay.remove(); };
                overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };

                // Confirm
                document.getElementById('ny-btn-confirm').onclick = async function () {
                    var pwd = (document.getElementById('ny-admin-pass') || {}).value || '';
                    var msgEl = document.getElementById('ny-confirm-msg');
                    var confirmBtn = document.getElementById('ny-btn-confirm');

                    if (!pwd) { msgEl.innerHTML = '<span style="color:var(--danger-color,#dc2626)">يرجى إدخال كلمة المرور</span>'; return; }

                    confirmBtn.disabled = true;
                    confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الإقفال...';
                    msgEl.innerHTML = '';

                    try {
                        var result = await apiFetch('/admin/year-close', {
                            method: 'POST',
                            body: { password: pwd, year: targetYear }
                        });

                        if (result.success) {
                            overlay.remove();
                            // Success notification
                            var notif = document.createElement('div');
                            notif.style.cssText = 'position:fixed;top:24px;left:50%;transform:translateX(-50%);background:#16a34a;color:#fff;padding:16px 28px;border-radius:12px;font-size:1rem;font-weight:600;z-index:99999;box-shadow:0 8px 30px rgba(0,0,0,0.2);';
                            notif.innerHTML = '<i class="fa-solid fa-check-circle"></i>  تم إقفال السنة المالية ' + targetYear + ' بنجاح';
                            document.body.appendChild(notif);
                            setTimeout(function () { window.location.reload(); }, 2500);
                        } else {
                            confirmBtn.disabled = false;
                            confirmBtn.innerHTML = '<i class="fa-solid fa-lock"></i> تأكيد الإقفال';
                            msgEl.innerHTML = '<span style="color:var(--danger-color,#dc2626)">' + esc(result.message || 'فشل الإقفال') + '</span>';
                        }
                    } catch (err) {
                        confirmBtn.disabled = false;
                        confirmBtn.innerHTML = '<i class="fa-solid fa-lock"></i> تأكيد الإقفال';
                        msgEl.innerHTML = '<span style="color:var(--danger-color,#dc2626)">خطأ في الاتصال: ' + esc(err.message || '') + '</span>';
                    }
                };
            };
        }
    };

    // ─── auto-loader ─────────────────────────────────────────────────────────────
    window.loadNewYear = function () {
        var handler = window.viewHandlers['view-new-year'];
        if (typeof handler === 'function') handler();
    };

})();
