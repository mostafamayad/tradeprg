(function() {
    'use strict';
    window.viewHandlers = window.viewHandlers || {};
    const viewHandlers = window.viewHandlers;

    const req = (...args) => window.req(...args);
    const fmt = (...args) => window.fmt(...args);
    const fmtPlain = (...args) => window.fmtPlain(...args);
    const fmtInt = (...args) => window.fmtInt(...args);
    const esc = (...args) => window.esc(...args);

    viewHandlers['view-settings'] = async function () {
        const view = document.getElementById('view-settings');
        if (!view) return;

        function $(id) { return document.getElementById(id); }
        function qs(sel) { return view.querySelector(sel); }
        function qsa(sel) { return view.querySelectorAll(sel); }

        // ── Tab switching ──
        const tabs = qsa('.settings-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                qsa('.settings-panel').forEach(p => p.classList.remove('active'));
                const panel = document.getElementById('stab-' + tab.dataset.stab);
                if (panel) panel.classList.add('active');
                // Load data on tab switch
                if (tab.dataset.stab === 'reps') loadReps();
                if (tab.dataset.stab === 'health') loadHealth();
                if (tab.dataset.stab === 'backup') loadBackupHistory();
                if (tab.dataset.stab === 'license' && window.refreshLicenseSettings) refreshLicenseSettings();
                if (tab.dataset.stab === 'administration') loadAdminSection();
            });
        });

        // ── Helper: save section ──
        async function saveSection(prefix, ids, statusId) {
            const settings = {};
            ids.forEach(id => {
                const el = $(id);
                if (!el) return;
                const key = id.replace('set-', '');
                if (el.type === 'checkbox') settings[key] = el.checked ? '1' : '0';
                else settings[key] = el.value;
            });
            try {
                const token = localStorage.getItem('auth_token');
                const res = await fetch('/api/settings/bulk', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': token ? 'Bearer ' + token : '' },
                    body: JSON.stringify({ settings })
                });
                const data = await res.json();
                if (statusId) {
                    const st = $(statusId);
                    if (st) { st.textContent = data.success ? '✓ تم الحفظ' : '✗ خطأ'; st.style.color = data.success ? '#059669' : '#dc2626'; setTimeout(() => st.textContent = '', 3000); }
                }
            } catch (e) { console.error('Save error', e); }
        }

        // ── Company ──
        const companyIds = ['set-company_name', 'set-company_name_en', 'set-company_tax_no', 'set-company_cr_no',
            'set-company_phone', 'set-company_mobile', 'set-company_address', 'set-company_city',
            'set-company_country', 'set-company_email', 'set-company_website', 'set-company_postal_code'];
        $('btn-save-company')?.addEventListener('click', () => saveSection('company', companyIds, 'company-save-status'));

        // ── Logo upload ──
        $('btn-upload-logo')?.addEventListener('click', () => $('company-logo-input')?.click());
        $('company-logo-input')?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async (ev) => {
                const logo = ev.target.result;
                // Preview
                const preview = $('company-logo-preview');
                if (preview) preview.innerHTML = '<img src="' + logo + '" style="max-width:100%;max-height:100%;object-fit:contain">';
                // Save to backend
                try {
                    const token = localStorage.getItem('auth_token');
                    await fetch('/api/settings/logo', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': token ? 'Bearer ' + token : '' },
                        body: JSON.stringify({ logo })
                    });
                    $('btn-remove-logo').style.display = '';
                } catch (e) { console.error('Logo upload error', e); }
            };
            reader.readAsDataURL(file);
        });
        $('btn-remove-logo')?.addEventListener('click', async () => {
            try {
                const token = localStorage.getItem('auth_token');
                await fetch('/api/settings/logo', { method: 'DELETE', headers: { 'Authorization': token ? 'Bearer ' + token : '' } });
                $('company-logo-preview').innerHTML = '<i class="fa-solid fa-image" style="font-size:32px;color:#d1d5db;"></i>';
                $('btn-remove-logo').style.display = 'none';
            } catch (e) { console.error('Logo remove error', e); }
        });

        // ── Print ──
        const printIds = ['set-print_paper_size', 'set-print_orientation', 'set-print_margin_top', 'set-print_margin_bottom',
            'set-print_margin_right', 'set-print_margin_left', 'set-print_show_logo', 'set-print_show_footer',
            'set-print_show_vat', 'set-print_show_qr', 'set-print_colored'];
        $('btn-save-print')?.addEventListener('click', () => saveSection('print', printIds, 'print-save-status'));

        // ── System ──
        const sysIds = ['set-currency', 'set-currency_symbol', 'set-currency_position', 'set-decimal_places',
            'set-date_format', 'set-time_format', 'set-tax_percent', 'set-language', 'set-direction', 'set-fiscal_year'];
        $('btn-save-system')?.addEventListener('click', () => saveSection('system', sysIds, 'system-save-status'));

        // ── Security ──
        const secIds = ['set-security_min_password_length', 'set-security_session_timeout', 'set-security_max_login_attempts', 'set-security_password_expiry'];
        $('btn-save-security')?.addEventListener('click', () => saveSection('security', secIds, 'security-save-status'));

        // ── Email ──
        const emailIds = ['set-email_smtp_host', 'set-email_smtp_port', 'set-email_username', 'set-email_password',
            'set-email_sender_name', 'set-email_sender_email'];
        $('btn-save-email')?.addEventListener('click', () => saveSection('email', emailIds, 'email-save-status'));
        $('btn-test-email')?.addEventListener('click', () => {
            const st = $('email-test-result');
            if (st) { st.textContent = 'تم اختبار الإرسال بنجاح (محاكاة)'; st.style.color = '#059669'; }
        });

        // ── Reps ──
        let repsData = [];
        let repFilters = { q: '', status: '', region: '', page: 1, limit: 10 };
        let repPagination = null;
        let repSearchTimer = null;

        async function loadReps() {
            try {
                const tbody = $('settings-reps-tbody');
                if (!tbody) return;
                tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#6b7280"><i class="fa-solid fa-spinner fa-spin"></i> جاري التحميل...</td></tr>';

                // Populate region filter from full data on first load
                const regionSel = $('rep-region-filter');
                if (regionSel && !regionSel.dataset.populated) {
                    const all = await window.API.getManageReps();
                    if (all.success) populateRegionFilter(all.data);
                }

                const params = {};
                if (repFilters.q) params.q = repFilters.q;
                if (repFilters.status) params.status = repFilters.status;
                if (repFilters.region) params.region = repFilters.region;
                params.page = repFilters.page;
                params.limit = repFilters.limit;

                const d = await window.API.getManageReps(params);
                if (!d.success) return;
                repsData = d.data || [];
                repPagination = d.pagination || null;

                if (repsData.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#6b7280">لا توجد نتائج</td></tr>';
                } else {
                    tbody.innerHTML = repsData.map((r, i) => {
                        const idx = repPagination ? (repPagination.page - 1) * repPagination.limit + i + 1 : i + 1;
                        return '<tr>' +
                            '<td>' + idx + '</td>' +
                            '<td>' + (r.rep_code || '-') + '</td>' +
                            '<td><strong>' + (r.rep_name || '-') + '</strong></td>' +
                            '<td>' + (r.phone || '-') + '</td>' +
                            '<td>' + (r.region || '-') + '</td>' +
                            '<td>' + (r.commission_rate != null ? r.commission_rate : '0') + '</td>' +
                            '<td>' + (r.is_active == 1 ? '<span style="color:#059669">نشط</span>' : '<span style="color:#dc2626">غير نشط</span>') + '</td>' +
                            '<td class="actions-cell">' +
                                '<button class="icon-btn btn-edit" onclick="window.editSettingsRep(' + r.id + ')"><i class="fa-solid fa-pen"></i></button> ' +
                                '<button class="icon-btn ' + (r.is_active == 1 ? 'btn-delete' : 'btn-edit') + '" onclick="window.toggleSettingsRep(' + r.id + ')"><i class="fa-solid fa-' + (r.is_active == 1 ? 'ban' : 'check') + '"></i></button>' +
                            '</td></tr>';
                    }).join('');
                }

                renderRepPagination();
            } catch (e) { console.error('loadReps error', e); }
        }

        function renderRepPagination() {
            const el = $('rep-pagination');
            if (!el) return;
            if (!repPagination || repPagination.pages <= 1) {
                el.style.display = 'none';
                return;
            }
            el.style.display = 'flex';
            $('rep-page-info').textContent = 'الصفحة ' + repPagination.page + ' من ' + repPagination.pages;
            $('rep-page-prev').disabled = repPagination.page <= 1;
            $('rep-page-next').disabled = repPagination.page >= repPagination.pages;
        }

        function populateRegionFilter(data) {
            const sel = $('rep-region-filter');
            if (!sel || sel.dataset.populated) return;
            const regions = [...new Set(data.map(r => r.region).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
            regions.forEach(r => {
                const opt = document.createElement('option');
                opt.value = r; opt.textContent = r;
                sel.appendChild(opt);
            });
            sel.dataset.populated = '1';
            if (!sel.dataset.searchable) {
                sel.dataset.searchable = '1';
                window.makeSearchableSelect(sel, Array.from(sel.options).filter(o => o.value).map(o => ({id: o.value, name: o.textContent})), 'ابحث عن منطقة...');
            }
        }

        // Rep search/filter event listeners
        $('rep-search')?.addEventListener('input', function () {
            clearTimeout(repSearchTimer);
            repSearchTimer = setTimeout(() => {
                repFilters.q = this.value;
                repFilters.page = 1;
                loadReps();
            }, 400);
        });

        $('rep-status-filter')?.addEventListener('change', function () {
            repFilters.status = this.value;
            repFilters.page = 1;
            loadReps();
        });

        $('rep-region-filter')?.addEventListener('change', function () {
            repFilters.region = this.value;
            repFilters.page = 1;
            loadReps();
        });

        $('rep-page-prev')?.addEventListener('click', () => {
            if (repPagination && repPagination.page > 1) {
                repFilters.page = repPagination.page - 1;
                loadReps();
            }
        });

        $('rep-page-next')?.addEventListener('click', () => {
            if (repPagination && repPagination.page < repPagination.pages) {
                repFilters.page = repPagination.page + 1;
                loadReps();
            }
        });

        $('stab-btn-add-rep')?.addEventListener('click', () => {
            document.getElementById('sra-id').value = '';
            document.getElementById('sra-code').value = '';
            document.getElementById('sra-name').value = '';
            document.getElementById('sra-phone').value = '';
            document.getElementById('sra-region').value = '';
            document.getElementById('sra-target').value = '0';
            document.getElementById('sra-commission').value = '0';
            document.getElementById('sra-notes').value = '';
            document.getElementById('sra-status-group').style.display = 'none';
            document.getElementById('modal-rep-title').textContent = 'إضافة مندوب جديد';
            document.getElementById('modal-settings-rep-add').classList.add('open');
        });

        window.editSettingsRep = function (id) {
            const r = repsData.find(x => x.id === id);
            if (!r) return;
            document.getElementById('sra-id').value = id;
            document.getElementById('sra-code').value = r.rep_code || '';
            document.getElementById('sra-name').value = r.rep_name || '';
            document.getElementById('sra-phone').value = r.phone || '';
            document.getElementById('sra-region').value = r.region || '';
            document.getElementById('sra-target').value = r.target_amount || 0;
            document.getElementById('sra-commission').value = r.commission_rate || 0;
            document.getElementById('sra-notes').value = r.notes || '';
            document.getElementById('sra-status').value = r.is_active == 1 ? '1' : '0';
            document.getElementById('sra-status-group').style.display = '';
            document.getElementById('modal-rep-title').textContent = 'تعديل المندوب';
            document.getElementById('modal-settings-rep-add').classList.add('open');
        };

        window.toggleSettingsRep = async function (id) {
            const r = repsData.find(x => x.id === id);
            const isActive = r && r.is_active == 1;
            const msg = isActive ? 'سيتم إلغاء تنشيط هذا المندوب ولن يظهر في القوائم.' : 'سيتم تفعيل هذا المندوب وظهوره في القوائم.';
            const confirmed = await window.showConfirm(msg, { title: isActive ? 'إلغاء تنشيط مندوب' : 'تفعيل مندوب', type: 'warning' });
            if (!confirmed) return;
            try {
                await window.API.toggleRep(id);
                loadReps();
            } catch (e) { console.error('toggle error', e); }
        };

        document.getElementById('form-settings-rep-add')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('sra-id').value;
            const data = {
                rep_code: document.getElementById('sra-code').value || undefined,
                rep_name: document.getElementById('sra-name').value,
                phone: document.getElementById('sra-phone').value || null,
                region: document.getElementById('sra-region').value || null,
                target_amount: parseFloat(document.getElementById('sra-target').value) || 0,
                commission_rate: parseFloat(document.getElementById('sra-commission').value) || 0,
                notes: document.getElementById('sra-notes').value || null
            };
            if (id) {
                data.is_active = parseInt(document.getElementById('sra-status').value);
            }
            try {
                let d;
                if (id) {
                    d = await window.API.updateRep(id, data);
                } else {
                    d = await window.API.createRep(data);
                }
                if (d.success) {
                    document.getElementById('modal-settings-rep-add').classList.remove('open');
                    document.getElementById('sra-id').value = '';
                    loadReps();
                    showAlert(id ? 'تم تعديل بيانات المندوب بنجاح' : 'تم إضافة المندوب بنجاح', { title: 'تمت العملية', type: 'success', infoText: false });
                } else {
                    showAlert(d.message || 'خطأ', { title: 'خطأ', type: 'danger', infoText: false });
                }
            } catch (e) { alert('خطأ في الاتصال'); }
        });

        // ── Backup ──
        async function loadBackupHistory() {
            try {
                const token = localStorage.getItem('auth_token');
                const res = await fetch('/api/settings/backup', { headers: { 'Authorization': token ? 'Bearer ' + token : '' } });
                const d = await res.json();
                if (!d.success) return;
                const tbody = document.getElementById('backup-history-tbody');
                if (!tbody) return;
                const hist = d.history || [];
                tbody.innerHTML = hist.length ? hist.map((b, i) => '<tr><td>' + (i+1) + '</td><td>' + (b.file_path || '-').split('\\').pop() + '</td><td>' + (b.file_size ? Math.round(b.file_size/1024) + ' KB' : '-') + '</td><td><span style="color:#059669">' + (b.status || '-') + '</span></td><td>' + (b.created_at || '-') + '</td></tr>').join('') : '<tr><td colspan="5" style="text-align:center;padding:20px;color:#9ca3af;">لم يتم عمل أي نسخة احتياطية بعد</td></tr>';
            } catch (e) { console.error('backup error', e); }
        }

        $('btn-run-backup')?.addEventListener('click', async () => {
            const btn = $('btn-run-backup');
            const status = $('backup-status');
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري...'; }
            if (status) status.innerHTML = '<div style="padding:10px;background:#fef3c7;border-radius:6px;color:#92400e;">جاري إنشاء النسخة الاحتياطية...</div>';
            try {
                const token = localStorage.getItem('auth_token');
                const res = await fetch('/api/settings/backup/run', { method: 'POST', headers: { 'Authorization': token ? 'Bearer ' + token : '' } });
                const d = await res.json();
                if (status) status.innerHTML = d.success ? '<div style="padding:10px;background:#d1fae5;border-radius:6px;color:#065f46;">' + d.message + '</div>' : '<div style="padding:10px;background:#fee2e2;border-radius:6px;color:#991b1b;">' + d.message + '</div>';
                loadBackupHistory();
            } catch (e) { if (status) status.innerHTML = '<div style="padding:10px;background:#fee2e2;border-radius:6px;color:#991b1b;">خطأ في الاتصال بالخادم</div>'; }
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-database"></i> إنشاء نسخة احتياطية'; }
        });

        // ── Health ──
        async function loadHealth() {
            const container = document.getElementById('health-data');
            if (!container) return;
            container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:#9ca3af;"><i class="fa-solid fa-spinner fa-spin"></i> جاري التحميل...</div>';
            try {
                const token = localStorage.getItem('auth_token');
                const res = await fetch('/api/settings/health', { headers: { 'Authorization': token ? 'Bearer ' + token : '' } });
                const d = await res.json();
                if (!d.success || !d.data) { container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:#dc2626;">خطأ في تحميل البيانات</div>'; return; }
                const h = d.data;
                const cards = [
                    { label: 'حالة قاعدة البيانات', value: h.database?.status || '-', sub: 'الحجم: ' + (h.database?.size || '-'), status: h.database?.status === 'Connected' ? 'online' : 'offline' },
                    { label: 'مدة التشغيل', value: Math.floor((h.server?.uptime || 0) / 3600) + ' ساعة', sub: 'Node ' + (h.server?.node || '-') },
                    { label: 'إصدار النظام', value: h.app?.version || '-', sub: h.app?.name || '' },
                    { label: 'المنصة', value: h.server?.platform || '-', sub: '' },
                    { label: 'الذاكرة المتاحة', value: h.storage?.memory || '-', sub: '' },
                    { label: 'الإعدادات', value: h.storage?.settings || 0 + ' إعداد', sub: h.storage?.users || 0 + ' مستخدم' },
                ];
                container.innerHTML = cards.map(c => '<div class="health-card"><h4>' + c.label + '</h4><div class="health-value">' + c.value + '</div>' + (c.sub ? '<div class="health-status ' + (c.status || '') + '">' + c.sub + '</div>' : '') + '</div>').join('');
            } catch (e) { container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:#dc2626;">خطأ في الاتصال</div>'; }
        }

        // ── Admin ──
        let _adminPendingAction = null;

        function generateDefaultBackupPath(label) {
            const now = new Date();
            const y = now.getFullYear();
            const m = String(now.getMonth() + 1).padStart(2, '0');
            const d = String(now.getDate()).padStart(2, '0');
            const ts = `${y}_${m}_${d}`;
            return `D:\\Backups\\ERP_${label}_${ts}.bak`;
        }

        function openBackupModal(title, message, action, actionLabel) {
            _adminPendingAction = action;
            document.getElementById('modal-admin-backup-title').innerHTML = '<i class="fa-solid fa-exclamation-triangle"></i> ' + title;
            document.getElementById('modal-admin-backup-message').textContent = message;
            document.getElementById('btn-admin-bak-label').textContent = actionLabel;
            document.getElementById('admin-bak-path').value = generateDefaultBackupPath(action === 'reset' ? 'Before_Reset' : action === 'year-close' ? 'Before_Year_Close' : 'Manual');
            document.getElementById('admin-bak-error').style.display = 'none';
            const pwInp = document.getElementById('admin-bak-pw');
            if (pwInp) pwInp.value = '';
            const confirmBtn = document.getElementById('btn-admin-bak-confirm');
            if (confirmBtn) confirmBtn.disabled = true;
            openModal('modal-admin-backup');
        }

        $('btn-system-reset')?.addEventListener('click', () => {
            openBackupModal(
                'تحذير: إعادة تهيئة النظام',
                'سيتم حذف جميع البيانات الحرجة (الفواتير، المرتجعات، القيود المحاسبية، الإيصالات) مع الاحتفاظ بالبيانات الأساسية (العملاء، الموردين، المنتجات). قبل المتابعة يجب إنشاء نسخة احتياطية. لا يمكن التراجع عن هذه العملية.',
                'reset',
                'إنشاء نسخة احتياطية ثم حذف البيانات'
            );
        });

        $('btn-year-close')?.addEventListener('click', () => {
            openBackupModal(
                'تحذير: إقفال السنة المالية',
                'سيتم ترحيل الأرصدة الافتتاحية للعملاء والموردين والخزينة والمخازن، وإغلاق السنة المالية الحالية، وحذف البيانات الحرجة، وبدء ترقيم جديد. قبل المتابعة يجب إنشاء نسخة احتياطية. لا يمكن التراجع عن هذه العملية.',
                'year-close',
                'إنشاء نسخة احتياطية ثم إقفال السنة'
            );
        });

        $('btn-manual-backup')?.addEventListener('click', () => {
            openBackupModal(
                'إنشاء نسخة احتياطية',
                'سيتم إنشاء نسخة احتياطية كاملة (SQL Backup .bak) من قاعدة البيانات إلى المسار الذي تحدده.',
                'manual',
                'إنشاء النسخة الاحتياطية'
            );
        });

        $('btn-restore-backup')?.addEventListener('click', () => {
            document.getElementById('admin-restore-path').value = '';
            document.getElementById('admin-restore-pw').value = '';
            document.getElementById('admin-restore-error').style.display = 'none';
            document.getElementById('btn-admin-restore-confirm').disabled = true;
            openModal('modal-admin-restore');
        });

        $('btn-admin-integrity')?.addEventListener('click', async () => {
            const resultDiv = document.getElementById('admin-integrity-result');
            if (!resultDiv) return;
            resultDiv.innerHTML = '<div style="text-align:center;padding:12px;color:#9ca3af;"><i class="fa-solid fa-spinner fa-spin"></i> جاري فحص النظام...</div>';
            try {
                const token = localStorage.getItem('auth_token');
                const res = await fetch('/api/admin/integrity', { headers: { 'Authorization': token ? 'Bearer ' + token : '' } });
                const d = await res.json();
                if (!d.success) { resultDiv.innerHTML = '<div style="color:#dc2626;">خطأ في الفحص</div>'; return; }
                const h = d.data;
                const items = [
                    { label: 'توازن القيود', ok: h.journalBalance },
                    { label: 'أرصدة العملاء', ok: h.customersBalanced },
                    { label: 'أرصدة الموردين', ok: h.suppliersBalanced },
                    { label: 'أرصدة الخزينة', ok: h.treasuryBalanced },
                    { label: 'ميزان المراجعة', ok: h.trialBalanceBalanced }
                ];
                const allOk = h.allPassed;
                resultDiv.innerHTML = '<div style="padding:12px;border-radius:6px;background:' + (allOk ? 'var(--success-bg,#d1fae5)' : 'var(--danger-bg,#fee2e2)') + ';color:' + (allOk ? 'var(--success-color,#059669)' : 'var(--danger-color,#dc2626)') + ';font-size:13px;">' +
                    items.map(i => '<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(0,0,0,0.05);">' +
                        '<span>' + i.label + '</span>' +
                        '<span>' + (i.ok ? '<i class="fa-solid fa-check-circle" style="color:#059669"></i>' : '<i class="fa-solid fa-times-circle" style="color:#dc2626"></i>') + '</span>' +
                        '</div>').join('') +
                    '<div style="margin-top:8px;font-weight:bold;text-align:center;">' + (allOk ? 'جميع الفحوصات سليمة ✓' : 'يوجد اختلال في بعض الأرصدة') + '</div></div>';
            } catch (e) {
                resultDiv.innerHTML = '<div style="color:#dc2626;">خطأ في الاتصال بالخادم</div>';
            }
        });

        // ── Browse button (showSaveFilePicker API or fallback) ──
        $('btn-admin-bak-browse')?.addEventListener('click', async () => {
            const pathInput = document.getElementById('admin-bak-path');
            if (!pathInput) return;
            if (window.showSaveFilePicker) {
                try {
                    const handle = await window.showSaveFilePicker({
                        suggestedName: pathInput.value.split('\\').pop() || 'ERP_Backup.bak',
                        types: [{ description: 'SQL Server Backup', accept: { 'application/octet-stream': ['.bak'] } }]
                    });
                    // showSaveFilePicker doesn't give us the full server path, but we keep the filename
                    const fileName = handle.name || pathInput.value.split('\\').pop();
                    const serverDir = pathInput.value.substring(0, pathInput.value.lastIndexOf('\\'));
                    pathInput.value = serverDir ? serverDir + '\\' + fileName : fileName;
                } catch (e) {
                    if (e.name !== 'AbortError') console.warn('Save picker error:', e);
                }
            } else {
                // Fallback: just focus the input for manual typing
                pathInput.focus();
                pathInput.select();
            }
        });

        // ── Backup modal input validation ──
        const bakPw = $('admin-bak-pw');
        const bakPath = $('admin-bak-path');
        const bakConfirm = $('btn-admin-bak-confirm');
        const bakError = $('admin-bak-error');

        function validateBackupForm() {
            if (bakConfirm) bakConfirm.disabled = !(bakPw?.value?.trim() && bakPath?.value?.trim());
            if (bakError) bakError.style.display = 'none';
        }

        if (bakPw) {
            bakPw.addEventListener('input', validateBackupForm);
            bakPw.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && bakConfirm && !bakConfirm.disabled) bakConfirm.click();
            });
        }
        if (bakPath) {
            bakPath.addEventListener('input', validateBackupForm);
        }

        if (bakConfirm) {
            bakConfirm.addEventListener('click', async () => {
                const password = bakPw?.value?.trim();
                const backupPath = bakPath?.value?.trim();
                if (!password || !backupPath) return;

                bakConfirm.disabled = true;
                bakConfirm.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري إنشاء النسخة الاحتياطية...';
                if (bakError) bakError.style.display = 'none';

                const statusDiv = document.getElementById('admin-status');
                const action = _adminPendingAction;

                try {
                    const token = localStorage.getItem('auth_token');

                    // First verify password
                    const vRes = await fetch('/api/admin/verify-password', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': token ? 'Bearer ' + token : '' },
                        body: JSON.stringify({ password })
                    });
                    const v = await vRes.json();
                    if (!v.success) {
                        if (bakError) { bakError.textContent = v.message || 'كلمة المرور غير صحيحة'; bakError.style.display = 'block'; }
                        bakConfirm.disabled = false;
                        bakConfirm.innerHTML = '<i class="fa-solid fa-shield"></i> ' + document.getElementById('btn-admin-bak-label')?.textContent;
                        return;
                    }

                    closeModal('modal-admin-backup');

                    // Execute action
                    if (action === 'reset') {
                        if (statusDiv) statusDiv.innerHTML = '<div style="padding:12px;border-radius:6px;background:#dbeafe;color:#1e40af;font-size:13px;"><i class="fa-solid fa-spinner fa-spin"></i> جاري إنشاء النسخة الاحتياطية وحذف البيانات...</div>';
                        const res = await fetch('/api/admin/reset', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': token ? 'Bearer ' + token : '' },
                            body: JSON.stringify({ password, backupPath })
                        });
                        const d = await res.json();
                        if (d.success) {
                            if (statusDiv) statusDiv.innerHTML = '<div style="padding:12px;border-radius:6px;background:#d1fae5;color:#059669;font-size:13px;"><i class="fa-solid fa-check-circle"></i> ' + d.message + ' (النسخة: ' + (d.backup?.name || '') + ')</div>';
                            if (typeof showAlert === 'function') showAlert(d.message, { type: 'success', title: 'إعادة تهيئة' });
                        } else {
                            if (statusDiv) statusDiv.innerHTML = '<div style="padding:12px;border-radius:6px;background:#fee2e2;color:#dc2626;font-size:13px;"><i class="fa-solid fa-times-circle"></i> ' + (d.message || 'فشلت العملية') + '</div>';
                            if (typeof showAlert === 'function') showAlert(d.message || 'فشلت العملية', { type: 'danger', title: 'خطأ' });
                        }
                    } else if (action === 'year-close') {
                        if (statusDiv) statusDiv.innerHTML = '<div style="padding:12px;border-radius:6px;background:#dbeafe;color:#1e40af;font-size:13px;"><i class="fa-solid fa-spinner fa-spin"></i> جاري إنشاء النسخة الاحتياطية وترحيل الأرصدة...</div>';
                        const res = await fetch('/api/admin/year-close', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': token ? 'Bearer ' + token : '' },
                            body: JSON.stringify({ password, backupPath })
                        });
                        const d = await res.json();
                        if (d.success) {
                            let msg = d.message;
                            if (d.warning) msg += ' (تحذير: يوجد اختلال في الأرصدة)';
                            if (statusDiv) statusDiv.innerHTML = '<div style="padding:12px;border-radius:6px;background:' + (d.warning ? '#fef3c7;color:#92400e' : '#d1fae5;color:#059669') + ';font-size:13px;"><i class="fa-solid fa-' + (d.warning ? 'exclamation-triangle' : 'check-circle') + '"></i> ' + msg + '</div>';
                            if (typeof showAlert === 'function') showAlert(msg, { type: d.warning ? 'warning' : 'success', title: 'إقفال السنة' });
                        } else {
                            if (statusDiv) statusDiv.innerHTML = '<div style="padding:12px;border-radius:6px;background:#fee2e2;color:#dc2626;font-size:13px;"><i class="fa-solid fa-times-circle"></i> ' + (d.message || 'فشلت العملية') + '</div>';
                            if (typeof showAlert === 'function') showAlert(d.message || 'فشلت العملية', { type: 'danger', title: 'خطأ' });
                        }
                    } else if (action === 'manual') {
                        if (statusDiv) statusDiv.innerHTML = '<div style="padding:12px;border-radius:6px;background:#dbeafe;color:#1e40af;font-size:13px;"><i class="fa-solid fa-spinner fa-spin"></i> جاري إنشاء النسخة الاحتياطية...</div>';
                        const res = await fetch('/api/admin/manual-backup', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': token ? 'Bearer ' + token : '' },
                            body: JSON.stringify({ password, backupPath })
                        });
                        const d = await res.json();
                        if (d.success) {
                            if (statusDiv) statusDiv.innerHTML = '<div style="padding:12px;border-radius:6px;background:#d1fae5;color:#059669;font-size:13px;"><i class="fa-solid fa-check-circle"></i> ' + d.message + ' (الملف: ' + (d.backup?.name || '') + ' - ' + formatFileSize(d.backup?.size || 0) + ')</div>';
                            if (typeof showAlert === 'function') showAlert(d.message + ' (الملف: ' + d.backup?.name + ')', { type: 'success', title: 'نسخة احتياطية' });
                        } else {
                            if (statusDiv) statusDiv.innerHTML = '<div style="padding:12px;border-radius:6px;background:#fee2e2;color:#dc2626;font-size:13px;"><i class="fa-solid fa-times-circle"></i> ' + (d.message || 'فشلت العملية') + '</div>';
                            if (typeof showAlert === 'function') showAlert(d.message || 'فشلت العملية', { type: 'danger', title: 'خطأ' });
                        }
                    }
                } catch (e) {
                    if (statusDiv) statusDiv.innerHTML = '<div style="padding:12px;border-radius:6px;background:#fee2e2;color:#dc2626;font-size:13px;"><i class="fa-solid fa-times-circle"></i> خطأ في الاتصال</div>';
                } finally {
                    bakConfirm.disabled = false;
                    bakConfirm.innerHTML = '<i class="fa-solid fa-shield"></i> ' + (document.getElementById('btn-admin-bak-label')?.textContent || 'تأكيد');
                    if (bakPw) bakPw.value = '';
                }
            });
        }

        // ── Restore modal: browse (showOpenFilePicker or fallback) ──
        $('btn-admin-restore-browse')?.addEventListener('click', async () => {
            const pathInput = document.getElementById('admin-restore-path');
            if (!pathInput) return;
            if (window.showOpenFilePicker) {
                try {
                    const [handle] = await window.showOpenFilePicker({
                        types: [{ description: 'SQL Server Backup', accept: { 'application/octet-stream': ['.bak'] } }]
                    });
                    // showOpenFilePicker doesn't give the full server path, keep the filename
                    const fileName = handle.name || '';
                    const currentDir = pathInput.value.substring(0, pathInput.value.lastIndexOf('\\'));
                    pathInput.value = currentDir ? currentDir + '\\' + fileName : fileName;
                    validateRestoreForm();
                } catch (e) {
                    if (e.name !== 'AbortError') console.warn('Open picker error:', e);
                }
            } else {
                pathInput.focus();
                pathInput.select();
            }
        });

        // ── Restore modal validation ──
        const rstPath = document.getElementById('admin-restore-path');
        const rstPw = document.getElementById('admin-restore-pw');
        const rstConfirm = document.getElementById('btn-admin-restore-confirm');
        const rstError = document.getElementById('admin-restore-error');

        function validateRestoreForm() {
            if (rstConfirm) rstConfirm.disabled = !(rstPw?.value?.trim() && rstPath?.value?.trim());
            if (rstError) rstError.style.display = 'none';
        }

        if (rstPw) {
            rstPw.addEventListener('input', validateRestoreForm);
            rstPw.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && rstConfirm && !rstConfirm.disabled) rstConfirm.click();
            });
        }
        if (rstPath) {
            rstPath.addEventListener('input', validateRestoreForm);
        }

        // ── Restore confirm ──
        if (rstConfirm) {
            rstConfirm.addEventListener('click', async () => {
                const backupFile = rstPath?.value?.trim();
                const password = rstPw?.value?.trim();
                if (!backupFile || !password) return;

                rstConfirm.disabled = true;
                rstConfirm.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري استرجاع النسخة...';
                if (rstError) rstError.style.display = 'none';

                const statusDiv = document.getElementById('admin-status');
                closeModal('modal-admin-restore');
                if (statusDiv) statusDiv.innerHTML = '<div style="padding:12px;border-radius:6px;background:#dbeafe;color:#1e40af;font-size:13px;"><i class="fa-solid fa-spinner fa-spin"></i> جاري استرجاع النسخة الاحتياطية...</div>';

                try {
                    const token = localStorage.getItem('auth_token');
                    const res = await fetch('/api/admin/restore', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': token ? 'Bearer ' + token : '' },
                        body: JSON.stringify({ password, backupFile })
                    });
                    const d = await res.json();
                    if (d.success) {
                        if (statusDiv) statusDiv.innerHTML = '<div style="padding:12px;border-radius:6px;background:#d1fae5;color:#059669;font-size:13px;"><i class="fa-solid fa-check-circle"></i> ' + d.message + '</div>';
                        if (typeof showAlert === 'function') showAlert(d.message, { type: 'success', title: 'استرجاع' });
                        setTimeout(() => { window.location.reload(); }, 2000);
                    } else {
                        if (statusDiv) statusDiv.innerHTML = '<div style="padding:12px;border-radius:6px;background:#fee2e2;color:#dc2626;font-size:13px;"><i class="fa-solid fa-times-circle"></i> ' + (d.message || 'فشلت العملية') + '</div>';
                        if (rstError) { rstError.textContent = d.message || 'فشلت العملية'; rstError.style.display = 'block'; }
                    }
                } catch (e) {
                    if (statusDiv) statusDiv.innerHTML = '<div style="padding:12px;border-radius:6px;background:#fee2e2;color:#dc2626;font-size:13px;"><i class="fa-solid fa-times-circle"></i> خطأ في الاتصال</div>';
                } finally {
                    rstConfirm.disabled = false;
                    rstConfirm.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> استرجاع النسخة';
                    if (rstPw) rstPw.value = '';
                }
            });
        }

        function openModal(id) {
            const el = document.getElementById(id);
            if (el) el.classList.add('open');
        }

        function closeModal(id) {
            const el = document.getElementById(id);
            if (el) el.classList.remove('open');
            // Clear backup modal fields if modal-admin-backup is being closed
            if (id === 'modal-admin-backup') {
                const pwInp = document.getElementById('admin-bak-pw');
                if (pwInp) pwInp.value = '';
                const errDiv = document.getElementById('admin-bak-error');
                if (errDiv) errDiv.style.display = 'none';
                const confirmBtn = document.getElementById('btn-admin-bak-confirm');
                if (confirmBtn) confirmBtn.disabled = true;
            }
            // Clear restore modal fields if modal-admin-restore is being closed
            if (id === 'modal-admin-restore') {
                const rstPw = document.getElementById('admin-restore-pw');
                if (rstPw) rstPw.value = '';
                const rstErr = document.getElementById('admin-restore-error');
                if (rstErr) rstErr.style.display = 'none';
                const rstConfirm = document.getElementById('btn-admin-restore-confirm');
                if (rstConfirm) rstConfirm.disabled = true;
            }
            // Legacy cleanups
            const oldPw = document.getElementById('admin-pw-input');
            if (oldPw) oldPw.value = '';
            const oldErr = document.getElementById('admin-pw-error');
            if (oldErr) oldErr.style.display = 'none';
        }

        function formatFileSize(bytes) {
            if (!bytes || bytes === 0) return '0 B';
            const units = ['B', 'KB', 'MB', 'GB'];
            const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
            return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
        }

        async function loadAdminSection() {
            // No backup list needed - restore uses direct file picker
        }

        // ── Load settings data into form ──
        async function loadSettings() {
            try {
                const token = localStorage.getItem('auth_token');
                const res = await fetch('/api/settings', { headers: { 'Authorization': token ? 'Bearer ' + token : '' } });
                const d = await res.json();
                if (!d.success || !d.data) return;
                const all = d.data;
                for (const [key, value] of Object.entries(all)) {
                    const el = document.getElementById('set-' + key);
                    if (!el) continue;
                    if (el.type === 'checkbox') el.checked = value === '1' || value === 'true';
                    else el.value = value || '';
                }
                // Logo
                if (all.company_logo) {
                    const preview = document.getElementById('company-logo-preview');
                    if (preview) preview.innerHTML = '<img src="' + all.company_logo + '" style="max-width:100%;max-height:100%;object-fit:contain">';
                    const removeBtn = document.getElementById('btn-remove-logo');
                    if (removeBtn) removeBtn.style.display = '';
                }
            } catch (e) { console.error('loadSettings error', e); }
        }

        await loadSettings();
    };
})();

