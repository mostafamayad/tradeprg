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
        const fromInput = document.getElementById('payments-from');
        const toInput = document.getElementById('payments-to');
        if (fromInput && !fromInput.value) fromInput.value = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
        if (toInput && !toInput.value) toInput.value = now.toISOString().slice(0, 10);

        let currentRows = [];

        function statusLabel(s) {
            const map = { unallocated: 'غير موزع', partial: 'موزع جزئياً', allocated: 'موزع بالكامل', cancelled: 'ملغي' };
            return map[s] || s || '-';
        }
        function allocationBadge(s) {
            if (s === 'cancelled') return '<span class="badge-status overdue">—</span>';
            const cls = s === 'allocated' ? 'paid' : 'pending';
            return `<span class="badge-status ${cls}">${statusLabel(s)}</span>`;
        }
        function paymentStatusBadge(ps) {
            if (ps === 'reversed') return '<span class="badge-status overdue">ملغي</span>';
            return '<span class="badge-status paid">نشط</span>';
        }
        function methodLabel(m) {
            if (m === 'cash') return 'نقدي';
            if (m === 'check') return 'شيك';
            if (m === 'transfer') return 'تحويل بنكي';
            return m || '-';
        }
        function escVal(v) { return v == null ? '-' : esc(String(v)); }

        // Load filter dropdowns (suppliers + users) once
        async function loadFilters() {
            const supSel = document.getElementById('payments-supplier');
            const usrSel = document.getElementById('payments-created-by');
            if (supSel && !supSel.dataset.loaded) {
                try {
                    const r = await req('/suppliers');
                    (r.data || []).forEach(s => {
                        const opt = document.createElement('option');
                        opt.value = s.id;
                        opt.textContent = s.supplier_name;
                        supSel.appendChild(opt);
                    });
                } catch (e) { console.error(e); }
                supSel.dataset.loaded = '1';
            }
            if (usrSel && !usrSel.dataset.loaded) {
                try {
                    const r = await req('/users');
                    (r.data || []).forEach(u => {
                        const opt = document.createElement('option');
                        opt.value = u.id;
                        opt.textContent = u.full_name || u.username || ('مستخدم #' + u.id);
                        usrSel.appendChild(opt);
                    });
                } catch (e) { console.error(e); }
                usrSel.dataset.loaded = '1';
            }
        }

        async function loadPayments() {
            tbody.innerHTML = '<tr><td colspan="13" style="text-align:center;padding:30px;color:var(--text-muted)"><i class="fa-solid fa-spinner fa-spin"></i> جاري التحميل...</td></tr>';
            const params = new URLSearchParams();
            const from = document.getElementById('payments-from')?.value;
            const to = document.getElementById('payments-to')?.value;
            const method = document.getElementById('payments-method')?.value;
            const q = document.getElementById('payments-search')?.value;
            const supplier = document.getElementById('payments-supplier')?.value;
            const status = document.getElementById('payments-status')?.value;
            const bank = document.getElementById('payments-bank')?.value;
            const createdBy = document.getElementById('payments-created-by')?.value;
            if (q) params.append('q', q);
            if (from) params.append('from', from);
            if (to) params.append('to', to);
            if (method) params.append('payment_method', method);
            if (supplier) params.append('supplier_id', supplier);
            if (status) params.append('status', status);
            if (bank) params.append('bank', bank);
            if (createdBy) params.append('created_by', createdBy);
            try {
                const r = await req('/payments' + (params.toString() ? '?' + params : ''));
                if (!r.success) { tbody.innerHTML = '<tr><td colspan="13" style="text-align:center;padding:30px;color:var(--danger-color)">خطأ في تحميل البيانات</td></tr>'; return; }
                const rows = r.data || [];
                currentRows = rows;
                renderTable(rows);
                renderSummary(r.summary || rows);
            } catch (e) {
                console.error(e);
                tbody.innerHTML = '<tr><td colspan="13" style="text-align:center;padding:30px;color:var(--text-muted)">خطأ في تحميل البيانات</td></tr>';
            }
        }

        function renderTable(rows) {
            tbody.innerHTML = '';
            if (rows.length === 0) {
                tbody.innerHTML = '<tr><td colspan="13" style="text-align:center;padding:30px;color:var(--text-muted)">لا توجد مدفوعات في الفترة المحددة</td></tr>';
                return;
            }
            rows.forEach(p => {
                const tr = document.createElement('tr');
                tr.style.cursor = 'pointer';
                tr.dataset.payId = p.id;
                tr.innerHTML = `
                    <td><strong style="color:var(--primary-color)">${escVal(p.payment_no)}</strong></td>
                    <td>${escVal(p.payment_date)}</td>
                    <td>${escVal(p.supplier_name)}</td>
                    <td>${methodLabel(p.payment_method)}</td>
                    <td>${escVal(p.bank_name)}</td>
                    <td>${escVal(p.check_no)}${p.cheque_due_date ? '<div style="font-size:0.72rem;color:var(--text-muted)">استحقاق: ' + escVal(p.cheque_due_date) + '</div>' : ''}</td>
                    <td class="text-danger"><strong>${fmt(p.amount)} ج.م</strong></td>
                    <td>${fmt(p.allocated)}</td>
                    <td>${fmt(p.remaining)}</td>
                    <td>${allocationBadge(p.status)}</td>
                    <td>${paymentStatusBadge(p.payment_status)}</td>
                    <td>${escVal(p.notes)}</td>
                    <td class="actions-cell">
                        <button class="icon-btn btn-view-payment" data-id="${p.id}" title="عرض التفاصيل"><i class="fa-solid fa-eye"></i></button>
                    </td>`;
                tbody.appendChild(tr);
            });
        }

        function renderSummary(src) {
            const set = (id, val) => { const e = document.getElementById(id); if (e) e.innerHTML = val; };
            if (src && src.total_count !== undefined) {
                set('pay-sum-count', fmtInt(src.total_count));
                set('pay-sum-amount', fmt(src.total_amount) + ' ج.م');
                set('pay-sum-cash', fmt(src.cash_amount) + ' ج.م');
                set('pay-sum-check', fmt(src.check_amount) + ' ج.م');
                set('pay-sum-transfer', fmt(src.transfer_amount) + ' ج.م');
                set('pay-sum-active', fmtInt(src.active_count));
                set('pay-sum-reversed', fmtInt(src.reversed_count));
                set('pay-sum-unallocated', fmtInt(src.unallocated_count));
            } else {
                const rows = src || [];
                let amt = 0, cash = 0, chk = 0, trf = 0, act = 0, rev = 0, unalloc = 0;
                rows.forEach(p => {
                    const a = Number(p.amount || 0);
                    amt += a;
                    if (p.payment_status === 'reversed') rev++;
                    else {
                        act++;
                        if (p.payment_method === 'cash') cash += a;
                        else if (p.payment_method === 'check') chk += a;
                        else if (p.payment_method === 'transfer') trf += a;
                    }
                    if (p.status === 'unallocated') unalloc++;
                });
                set('pay-sum-count', fmtInt(rows.length));
                set('pay-sum-amount', fmt(amt) + ' ج.م');
                set('pay-sum-cash', fmt(cash) + ' ج.م');
                set('pay-sum-check', fmt(chk) + ' ج.م');
                set('pay-sum-transfer', fmt(trf) + ' ج.م');
                set('pay-sum-active', fmtInt(act));
                set('pay-sum-reversed', fmtInt(rev));
                set('pay-sum-unallocated', fmtInt(unalloc));
            }
        }

        // ── Side Drawer: تفاصيل سند الصرف ────────────────────────────────
        const drawer = document.getElementById('payments-drawer');
        const drawerClose = document.getElementById('payments-drawer-close');
        if (drawer && drawerClose && !drawerClose.dataset.bound) {
            drawerClose.dataset.bound = '1';
            drawerClose.addEventListener('click', () => drawer.classList.remove('active', 'open'));
            drawer.addEventListener('click', (e) => {
                if (e.target === drawer) drawer.classList.remove('active', 'open');
            });
        }

        async function openPaymentDrawer(id) {
            if (!drawer) return;
            drawer.classList.add('active', 'open');
            document.getElementById('payments-drawer-title').textContent = 'جاري التحميل...';
            document.getElementById('payments-drawer-body').innerHTML = '<p style="text-align:center;padding:30px;color:var(--text-muted)"><i class="fa-solid fa-spinner fa-spin"></i> جاري التحميل...</p>';
            try {
                const r = await req('/payments/' + id);
                if (!r.success || !r.data) {
                    document.getElementById('payments-drawer-body').innerHTML = '<p style="text-align:center;color:var(--danger-color);padding:30px">تعذر تحميل تفاصيل السند</p>';
                    return;
                }
                const p = r.data;
                document.getElementById('payments-drawer-title').textContent = 'تفاصيل سند الصرف: ' + (p.payment_no || '');
                const isCheck = p.payment_method === 'check';
                const isCancelled = p.status === 'reversed';
                const allocs = p.allocations || [];
                const cheques = p.cheques || [];
                const jes = p.journal_entries || [];

                let html = '';
                html += `<div style="display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px;background:${isCancelled ? '#fef2f2' : '#f0fdf4'};border:1px solid ${isCancelled ? '#fecaca' : '#bbf7d0'};margin-bottom:14px">
                    <i class="fa-solid ${isCheck ? 'fa-money-check' : 'fa-money-bill-transfer'}" style="color:${isCancelled ? '#dc2626' : '#059669'};font-size:1.6rem"></i>
                    <div style="flex:1">
                        <div style="font-weight:800;color:${isCancelled ? '#dc2626' : '#059669'};font-size:1rem">${escVal(p.payment_no)}</div>
                        <div style="font-size:0.75rem;color:var(--text-muted)">${escVal(p.supplier_name)} — ${escVal(p.payment_date)}</div>
                    </div>
                    <div style="text-align:left">
                        <div style="font-size:0.7rem;color:var(--text-muted)">المبلغ</div>
                        <div style="font-weight:900;font-size:1.15rem;color:${isCancelled ? '#dc2626' : '#0f172a'}">${fmt(p.amount)} ج.م</div>
                    </div>
                </div>`;

                html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px;margin-bottom:14px">`;
                const fields = [
                    ['رقم السند', escVal(p.payment_no)],
                    ['التاريخ', escVal(p.payment_date)],
                    ['المورد', escVal(p.supplier_name)],
                    ['طريقة الدفع', methodLabel(p.payment_method)],
                    ['البنك / الخزينة', escVal(p.bank_name)],
                    ['رقم الشيك', escVal(p.check_no)],
                    ['تاريخ الشيك', escVal(p.check_date)],
                    ['استحقاق الشيك', escVal((cheques[0] && cheques[0].due_date) || null)],
                    ['المبلغ', fmt(p.amount) + ' ج.م'],
                    ['الموزع', fmt(p.allocated) + ' ج.م'],
                    ['المتبقي', fmt(p.remaining) + ' ج.م'],
                    ['الحالة', p.status === 'reversed' ? 'ملغي' : 'نشط'],
                    ['بواسطة', escVal(p.created_by_name || 'النظام')],
                    ['ملاحظات', escVal(p.notes)]
                ];
                fields.forEach(([k, v]) => {
                    if (!v || v === '-') return;
                    html += `<div style="background:var(--bg-body);border:1px solid var(--border-color, #e5e7eb);border-radius:8px;padding:6px 10px">
                        <div style="font-size:0.68rem;color:var(--text-muted)">${k}</div>
                        <div style="font-size:0.85rem;font-weight:600;color:var(--text-color)">${v}</div>
                    </div>`;
                });
                html += '</div>';

                // ── الفواتير المسدد عليها ──
                if (allocs.length > 0) {
                    html += `<h4 style="font-size:0.85rem;color:var(--text-color);margin:0 0 8px">الفواتير المسدد عليها (${allocs.length})</h4>`;
                    html += `<div class="table-responsive"><table class="data-table">
                        <thead><tr style="background:#f1f5f9"><th>#</th><th>رقم الفاتورة</th><th>المبلغ المسدد</th></tr></thead><tbody>`;
                    allocs.forEach((a, i) => {
                        html += `<tr><td>${i + 1}</td><td>${escVal(a.invoice_no || ('فاتورة #' + a.invoice_id))}</td><td><strong>${fmt(a.allocated_amount)} ج.م</strong></td></tr>`;
                    });
                    html += '</tbody></table></div>';
                }

                // ── القيود المحاسبية ──
                if (jes.length > 0) {
                    const byEntry = {};
                    jes.forEach(l => {
                        if (!byEntry[l.entry_id]) {
                            byEntry[l.entry_id] = { entry_no: l.entry_no, entry_date: l.entry_date, description: l.description, is_reversed: l.is_reversed, created_by_name: l.created_by_name, lines: [] };
                        }
                        byEntry[l.entry_id].lines.push(l);
                    });
                    html += `<h4 style="font-size:0.85rem;color:var(--text-color);margin:14px 0 8px">القيود المحاسبية (${Object.keys(byEntry).length})</h4>`;
                    Object.values(byEntry).forEach(je => {
                        html += `<div style="border:1px solid #e5e7eb;border-radius:10px;margin-bottom:10px;overflow:hidden">
                            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#f8fafc;flex-wrap:wrap;gap:6px">
                                <div><strong>${escVal(je.entry_no)}</strong> <span style="font-size:0.72rem;color:var(--text-muted)">${escVal(je.entry_date)}</span></div>
                                <div style="font-size:0.72rem;color:var(--text-muted)">${escVal(je.description)} ${je.is_reversed ? '<span class="badge-status overdue">معكوس</span>' : ''}</div>
                            </div>
                            <div class="table-responsive"><table class="data-table">
                                <thead><tr style="background:#f1f5f9"><th>الحساب</th><th>مدين</th><th>دائن</th></tr></thead><tbody>`;
                        je.lines.forEach(l => {
                            html += `<tr>
                                <td>${escVal((l.account_code || '') + ' — ' + (l.account_name || ''))}</td>
                                <td class="text-success">${l.debit ? fmt(l.debit) : '-'}</td>
                                <td class="text-danger">${l.credit ? fmt(l.credit) : '-'}</td>
                            </tr>`;
                        });
                        html += '</tbody></table></div></div>';
                    });
                }

                html += `<div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
                    <button class="btn btn-outline" id="payments-drawer-cancel"><i class="fa-solid fa-xmark"></i> إغلاق</button>
                    <button class="btn btn-outline" id="payments-drawer-print"><i class="fa-solid fa-print"></i> طباعة</button>
                    <button class="btn btn-primary" id="payments-drawer-open"><i class="fa-solid fa-up-right-from-square"></i> فتح سند الصرف الأصلي</button>
                </div>`;

                document.getElementById('payments-drawer-body').innerHTML = html;

                const btnCancel = document.getElementById('payments-drawer-cancel');
                if (btnCancel) btnCancel.onclick = () => drawer.classList.remove('active', 'open');
                const btnPrint = document.getElementById('payments-drawer-print');
                if (btnPrint) btnPrint.onclick = () => { if (window.API && window.API.printInIframe) window.API.printInIframe('/api/reports/payment/' + p.id + '/print'); };
                const btnOpen = document.getElementById('payments-drawer-open');
                if (btnOpen) btnOpen.onclick = () => {
                    drawer.classList.remove('active', 'open');
                    if (typeof window.navigateTo === 'function') window.navigateTo('ap-payment');
                };
            } catch (e) {
                console.error(e);
                document.getElementById('payments-drawer-body').innerHTML = '<p style="text-align:center;color:var(--danger-color);padding:30px">خطأ في تحميل تفاصيل السند</p>';
            }
        }

        // ── الطباعة / التصدير ────────────────────────────────────────────
        function getCompanyInfo() {
            let coName = '', coPhone = '', coAddr = '', coLogo = '';
            try {
                const settings = window.AppData && window.AppData.settings;
                if (settings) {
                    coName  = settings.company_name  || settings.name  || '';
                    coPhone = settings.company_phone || settings.phone || '';
                    coAddr  = settings.company_address || settings.address || '';
                    coLogo  = settings.logo_url || '';
                }
            } catch (e) {}
            return { coName, coPhone, coAddr, coLogo };
        }

        function printReport(mode) {
            if (currentRows.length === 0) { alert('لا توجد بيانات للطباعة'); return; }
            const co = getCompanyInfo();
            const from = document.getElementById('payments-from')?.value || '—';
            const to = document.getElementById('payments-to')?.value || '—';

            let rows = '';
            currentRows.forEach((p, i) => {
                const bg = i % 2 === 0 ? '#fff' : '#f9fafb';
                rows += '<tr style="background:' + bg + '">'
                    + '<td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:center">' + escVal(p.payment_no) + '</td>'
                    + '<td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:center">' + escVal(p.payment_date) + '</td>'
                    + '<td style="padding:5px 8px;border:1px solid #e5e7eb">' + escVal(p.supplier_name) + '</td>'
                    + '<td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:center">' + methodLabel(p.payment_method) + '</td>'
                    + '<td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:center">' + escVal(p.bank_name) + '</td>'
                    + '<td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:center">' + escVal(p.check_no) + '</td>'
                    + '<td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:right;direction:ltr">' + fmt(p.amount) + '</td>'
                    + '<td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:right;direction:ltr">' + fmt(p.allocated) + '</td>'
                    + '<td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:right;direction:ltr">' + fmt(p.remaining) + '</td>'
                    + '<td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:center">' + statusLabel(p.status) + '</td>'
                    + '<td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:center">' + (p.payment_status === 'reversed' ? 'ملغي' : 'نشط') + '</td>'
                    + '<td style="padding:5px 8px;border:1px solid #e5e7eb">' + escVal(p.notes) + '</td>'
                    + '</tr>';
            });

            let tAmt = 0, tAll = 0, tRem = 0;
            currentRows.forEach(p => { tAmt += Number(p.amount || 0); tAll += Number(p.allocated || 0); tRem += Number(p.remaining || 0); });
            const totalRow = '<tr style="background:#fef2f2;font-weight:700">'
                + '<td colspan="6" style="padding:6px 8px;border:1px solid #e5e7eb;text-align:center">الإجمالي</td>'
                + '<td style="padding:6px 8px;border:1px solid #e5e7eb;text-align:right;direction:ltr">' + fmt(tAmt) + '</td>'
                + '<td style="padding:6px 8px;border:1px solid #e5e7eb;text-align:right;direction:ltr">' + fmt(tAll) + '</td>'
                + '<td style="padding:6px 8px;border:1px solid #e5e7eb;text-align:right;direction:ltr">' + fmt(tRem) + '</td>'
                + '<td colspan="3" style="padding:6px 8px;border:1px solid #e5e7eb;text-align:center"></td>'
                + '</tr>';

            const logoHtml = co.coLogo ? '<img src="' + co.coLogo + '" style="max-height:55px;max-width:120px;object-fit:contain;margin-bottom:6px" onerror="this.style.display=\'none\'">' : '';
            const printDate = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });

            const w = window.open('', '_blank', 'width=1200,height=800,scrollbars=yes');
            if (!w) { alert('يرجى السماح بفتح نوافذ جديدة في المتصفح'); return; }
            w.document.write('<!DOCTYPE html><html dir="rtl" lang="ar"><head>'
                + '<meta charset="UTF-8">'
                + '<title>تقرير مدفوعات الموردين - ' + esc(co.coName) + '</title>'
                + '<style>'
                + 'body{font-family:"Segoe UI",Arial,sans-serif;margin:20px;color:#1e293b;font-size:11.5px;}'
                + '.print-header{text-align:center;margin-bottom:18px;padding-bottom:14px;border-bottom:3px solid #1d4ed8;}'
                + '.co-name{font-size:1.3rem;font-weight:800;color:#1e293b;}'
                + '.co-info{font-size:0.8rem;color:#64748b;margin-top:3px;}'
                + '.report-title{font-size:1.1rem;font-weight:700;margin:10px 0 4px;color:#1d4ed8;}'
                + '.report-period{font-size:0.85rem;color:#475569;}'
                + 'table{width:100%;border-collapse:collapse;margin-top:12px;font-size:11px;}'
                + 'th{background:#1d4ed8;color:#fff;padding:7px 8px;border:1px solid #1d4ed8;text-align:center;font-size:10.5px;font-weight:600;white-space:nowrap;}'
                + '.footer-print{text-align:center;font-size:10px;color:#94a3b8;margin-top:18px;padding-top:8px;border-top:1px solid #e2e8f0;}'
                + '@media print{body{margin:12px;}-webkit-print-color-adjust:exact;print-color-adjust:exact;}'
                + '</style></head><body>'
                + '<div class="print-header">'
                + (logoHtml ? '<div>' + logoHtml + '</div>' : '')
                + '<div class="co-name">' + esc(co.coName) + '</div>'
                + '<div class="co-info">' + [co.coAddr, co.coPhone].filter(Boolean).map(esc).join(' | ') + '</div>'
                + '<div class="report-title">تقرير مدفوعات الموردين (سندات الصرف)</div>'
                + '<div class="report-period">من ' + esc(from) + ' إلى ' + esc(to) + ' | تاريخ الطباعة: ' + printDate + '</div>'
                + '</div>'
                + '<table><thead><tr>'
                + '<th>رقم السند</th><th>التاريخ</th><th>المورد</th><th>طريقة الدفع</th><th>البنك</th><th>رقم الشيك</th><th>المبلغ</th><th>الموزع</th><th>المتبقي</th><th>المرحّل</th><th>الحالة</th><th>ملاحظات</th>'
                + '</tr></thead><tbody>' + rows + totalRow + '</tbody></table>'
                + '<div class="footer-print">TradePro ERP &mdash; تقرير مدفوعات الموردين</div>'
                + (mode === 'pdf' ? '' : '<script>window.onload=function(){window.print();};<\/script>')
                + '</body></html>');
            w.document.close();
        }

        function exportExcel() {
            if (currentRows.length === 0) { alert('لا توجد بيانات للتصدير'); return; }
            const from = document.getElementById('payments-from')?.value || 'البداية';
            const to = document.getElementById('payments-to')?.value || 'النهاية';
            const headers = ['رقم السند', 'التاريخ', 'المورد', 'طريقة الدفع', 'البنك', 'رقم الشيك', 'المبلغ', 'الموزع', 'المتبقي', 'المرحّل', 'الحالة', 'ملاحظات'];
            const dataRows = currentRows.map(p => [
                p.payment_no || '', p.payment_date || '', p.supplier_name || '',
                methodLabel(p.payment_method), p.bank_name || '', p.check_no || '',
                Number(p.amount || 0), Number(p.allocated || 0), Number(p.remaining || 0),
                statusLabel(p.status), (p.payment_status === 'reversed' ? 'ملغي' : 'نشط'), p.notes || ''
            ]);
            let tAmt = 0, tAll = 0, tRem = 0;
            currentRows.forEach(p => { tAmt += Number(p.amount || 0); tAll += Number(p.allocated || 0); tRem += Number(p.remaining || 0); });
            dataRows.push(['الإجمالي', '', '', '', '', '', tAmt, tAll, tRem, '', '', '']);
            ExportService.exportReport('excel', {
                filename: 'supplier-payments-report-' + (from.replace(/-/g, '')) + '-' + (to.replace(/-/g, '')),
                headers: headers,
                rows: dataRows
            });
        }

        await loadFilters();
        await loadPayments();

        ['payments-from', 'payments-to', 'payments-method', 'payments-search',
         'payments-supplier', 'payments-status', 'payments-bank', 'payments-created-by'].forEach(id => {
            const el = document.getElementById(id);
            if (el && !el.dataset.bound) {
                el.dataset.bound = '1';
                el.addEventListener('input', loadPayments);
                el.addEventListener('change', loadPayments);
            }
        });

        const viewBtn = document.getElementById('btn-payments-view');
        if (viewBtn) viewBtn.onclick = loadPayments;
        const printBtn = document.getElementById('btn-payments-print');
        if (printBtn) printBtn.onclick = () => printReport('print');
        const pdfBtn = document.getElementById('btn-payments-pdf');
        if (pdfBtn) pdfBtn.onclick = () => printReport('pdf');
        const excelBtn = document.getElementById('btn-payments-excel');
        if (excelBtn) excelBtn.onclick = exportExcel;

        if (!tbody.dataset.bound) {
            tbody.dataset.bound = '1';
            tbody.addEventListener('click', (e) => {
                const btn = e.target.closest('.btn-view-payment');
                if (btn) { openPaymentDrawer(btn.dataset.id); return; }
                const tr = e.target.closest('tr[data-pay-id]');
                if (tr) openPaymentDrawer(tr.dataset.payId);
            });
        }

        const btnNew = document.getElementById('btn-new-payment');
        if (btnNew && !btnNew.dataset.bound) {
            btnNew.dataset.bound = '1';
            btnNew.onclick = () => {
                if (typeof window.navigateTo === 'function') window.navigateTo('ap-payment');
            };
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
            <div id="pay-balance-preview" style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:16px;display:flex;gap:16px;flex-wrap:wrap">
                <div style="flex:1;min-width:120px"><label style="display:block;font-size:0.75rem;color:var(--text-muted)">الرصيد السابق</label><strong id="pay-bal-opening" style="font-size:1.1rem">---</strong></div>
                
                <div style="flex:1;min-width:120px"><label style="display:block;font-size:0.75rem;color:var(--text-muted)">إجمالي المستحق</label><strong id="pay-bal-current" style="font-size:1.1rem">---</strong></div>
                <div style="flex:1;min-width:120px"><label style="display:block;font-size:0.75rem;color:var(--text-muted)">قيمة السداد</label><strong id="pay-bal-amount" style="font-size:1.1rem">---</strong></div>
                <div style="flex:1;min-width:120px"><label style="display:block;font-size:0.75rem;color:var(--text-muted)">الرصيد بعد السداد</label><strong id="pay-bal-after" style="font-size:1.1rem">---</strong></div>
            </div>
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

        document.getElementById('modal-pay-supplier').addEventListener('change', async function() {
            const sid = this.value;
            ['pay-bal-opening','pay-bal-current','pay-bal-amount','pay-bal-after'].forEach(id => document.getElementById(id).innerHTML = 'جاري...');
            if (!sid) { ['pay-bal-opening','pay-bal-current','pay-bal-amount','pay-bal-after'].forEach(id => document.getElementById(id).innerHTML = '---'); return; }
            try {
                const r = await req('/payments/supplier/' + sid + '/preview');
                const d = r.data;
                if (d) {
                    const fmt = window.formatMoney || (v => Number(v).toFixed(2));
                    const formatBal = (val) => {
                        if(val > 0) return `<span style="color:#ef4444;font-weight:bold" title="له">له ${fmt(val)}</span>`;
                        if(val < 0) return `<span style="color:#10b981;font-weight:bold" title="عليه">عليه ${fmt(Math.abs(val))}</span>`;
                        return `<span style="color:#64748b">صِفر</span>`;
                    };
                    document.getElementById('pay-bal-opening').innerHTML = formatBal(d.opening);
                    
                    const curEl = document.getElementById('pay-bal-current');
                    curEl.dataset.raw = d.balance;
                    curEl.innerHTML = formatBal(d.balance);
                    
                    updatePayBalancePreview(d.balance);
                }
            } catch(e) { console.error(e); }
        });
        
        document.getElementById('modal-pay-amount').addEventListener('input', function() {
            const curEl = document.getElementById('pay-bal-current');
            const cur = parseFloat(curEl.dataset.raw) || 0;
            updatePayBalancePreview(cur);
        });
        
        function updatePayBalancePreview(currentBalance) {
            const amt = parseFloat(document.getElementById('modal-pay-amount').value) || 0;
            const fmt = window.formatMoney || (v => Number(v).toFixed(2));
            document.getElementById('pay-bal-amount').innerHTML = fmt(amt);
            
            const afterBal = currentBalance - amt;
            const formatBal = (val) => {
                if(val > 0) return `<span style="color:#ef4444;font-weight:bold" title="له">له ${fmt(val)}</span>`;
                if(val < 0) return `<span style="color:#10b981;font-weight:bold" title="عليه">عليه ${fmt(Math.abs(val))}</span>`;
                return `<span style="color:#64748b">صِفر</span>`;
            };
            document.getElementById('pay-bal-after').innerHTML = formatBal(afterBal);
        }

        document.getElementById('modal-pay-date').value = payDate;
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
    // VIEW: SUPPLIER STATEMENT — Ledger / Sub-Ledger محاسبي كامل
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
        const from = document.getElementById('sup-stmt-from');
        const to = document.getElementById('sup-stmt-to');
        if (from && !from.value) from.value = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
        if (to && !to.value) to.value = now.toISOString().slice(0, 10);

        // ── Side Drawer ────────────────────────────────────────────
        const drawer = document.getElementById('sup-stmt-drawer');
        const closeBtn = document.getElementById('sup-stmt-drawer-close');
        if (drawer && closeBtn && !closeBtn.dataset.bound) {
            closeBtn.dataset.bound = '1';
            closeBtn.addEventListener('click', () => drawer.classList.remove('active', 'open'));
            drawer.addEventListener('click', (e) => {
                if (e.target === drawer) drawer.classList.remove('active', 'open');
            });
        }

        const typeMeta = {
            purchase_invoice: { icon: 'fa-file-invoice', label: 'فاتورة', color: '#059669', bg: 'rgba(5,150,105,0.12)', badge: 'paid' },
            purchase_return:  { icon: 'fa-undo',         label: 'مرتجع',  color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', badge: 'pending' },
            supplier_payment: { icon: 'fa-hand-holding-usd', label: 'سند صرف', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)', badge: 'paid' },
            ap_payment:       { icon: 'fa-hand-holding-usd', label: 'سند صرف', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)', badge: 'paid' },
            ap_note:          { icon: 'fa-file-circle-check', label: 'إشعار', color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)', badge: 'pending' },
            journal_entry:    { icon: 'fa-book',        label: 'قيد',     color: '#64748b', bg: 'rgba(100,116,139,0.1)', badge: 'pending' },
            opening:          { icon: 'fa-circle',      label: 'افتتاحي', color: '#1e3a5f', bg: '#f1f5f9', badge: '' }
        };

        function getMeta(t) {
            return typeMeta[t] || { icon: 'fa-circle', label: t || 'حركة', color: '#64748b', bg: 'rgba(100,116,139,0.1)', badge: '' };
        }

        function fmtDt(v) { return v ? String(v).slice(0, 10) : '-'; }

        function balColor(v) { return v > 0 ? 'var(--success-color)' : v < 0 ? 'var(--danger-color)' : 'var(--text-muted)'; }

        function escVal(v) { return v == null ? '-' : esc(String(v)); }

        // ── عرض تفاصيل الحركة في الـ Side Drawer ───────────────────
        function openDrawer(row) {
            if (!drawer) return;
            document.getElementById('sup-stmt-drawer-title').textContent = 'تفاصيل: ' + (row.doc_type || 'حركة') + (row.doc_no ? ' — ' + row.doc_no : '');
            const m = getMeta(row.ref_type || row.type);
            let html = '';
            html += `<div style="display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:10px;background:${m.bg};margin-bottom:12px">
                <i class="fa-solid ${m.icon}" style="color:${m.color};font-size:1.3rem"></i>
                <div style="flex:1">
                    <div style="font-weight:800;color:${m.color};font-size:0.95rem">${esc(row.doc_type || m.label)}</div>
                    <div style="font-size:0.75rem;color:var(--text-muted)">${esc(row.description || '')}</div>
                </div>
                <div style="text-align:left">
                    <div style="font-size:0.7rem;color:var(--text-muted)">الرصيد الجاري</div>
                    <div style="font-weight:800;color:${balColor(row.balance)};font-size:1.05rem">${fmt(row.balance)}</div>
                </div>
            </div>`;

            html += `<div class="drawer-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;margin-bottom:14px">`;
            const fields = [
                ['التاريخ', fmtDt(row.date)],
                ['رقم المستند', escVal(row.doc_no)],
                ['مدين', row.debit ? fmt(row.debit) : '-'],
                ['دائن', row.credit ? fmt(row.credit) : '-'],
                ['الرصيد قبل الحركة', fmt(row.balance_before)],
                ['أثر الحركة', (row.impact != null ? (row.impact > 0 ? '+' : '') + fmt(row.impact) : '-')]
            ];
            if (row.payment_method) fields.push(['طريقة الدفع', row.payment_method === 'cash' ? 'نقدي' : row.payment_method === 'check' ? 'شيك' : 'تحويل']);
            if (row.bank_name) fields.push(['البنك', escVal(row.bank_name)]);
            if (row.check_no) fields.push(['رقم الشيك', escVal(row.check_no)]);
            if (row.created_by) fields.push(['أنشأها', escVal(row.created_by)]);
            fields.forEach(([k, v]) => {
                html += `<div style="background:var(--bg-body);border:1px solid var(--border-color, #e5e7eb);border-radius:8px;padding:6px 10px">
                    <div style="font-size:0.68rem;color:var(--text-muted)">${k}</div>
                    <div style="font-size:0.85rem;font-weight:600;color:var(--text-color)">${v}</div>
                </div>`;
            });
            html += '</div>';

            // ── بنود المستند (أصناف) ──
            if (row.items && row.items.length > 0) {
                html += `<h4 style="font-size:0.82rem;color:var(--text-color);margin:0 0 8px">بنود المستند (${row.items.length})</h4>`;
                html += `<div class="table-responsive"><table class="data-table">
                    <thead><tr style="background:#f1f5f9"><th>الصنف</th><th>الكود</th><th>الكمية</th><th>الوحدة</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead><tbody>`;
                row.items.forEach(it => {
                    html += `<tr>
                        <td>${esc(it.product_name || '-')}</td>
                        <td>${esc(it.product_code || '-')}</td>
                        <td>${fmt(it.quantity)}</td>
                        <td>${esc(it.unit || '-')}</td>
                        <td>${fmt(it.unit_price)}</td>
                        <td><strong>${fmt(it.total)}</strong></td>
                    </tr>`;
                });
                html += '</tbody></table></div>';
                if (row.subtotal != null || row.discount_amount != null || row.tax_amount != null) {
                    html += `<div style="display:flex;justify-content:flex-end;gap:20px;margin-top:8px;font-size:0.8rem;flex-wrap:wrap">
                        ${row.subtotal != null ? `<span>الإجمالي الفرعي: <strong>${fmt(row.subtotal)}</strong></span>` : ''}
                        ${row.discount_amount ? `<span>الخصم: <strong class="text-danger">- ${fmt(row.discount_amount)}</strong></span>` : ''}
                        ${row.tax_amount ? `<span>الضريبة: <strong>+ ${fmt(row.tax_amount)}</strong></span>` : ''}
                    </div>`;
                }
            }

            // ── زر فتح المستند الأصلي ──
            html += `<div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end">
                <button class="btn btn-outline" id="sup-stmt-drawer-cancel">إغلاق</button>`;
            const openDocLabel = { purchase_invoice: 'فتح الفاتورة', purchase_return: 'فتح المرتجع', supplier_payment: 'فتح سند الصرف', ap_payment: 'فتح سند الصرف', ap_note: 'فتح الإشعار', journal_entry: 'فتح القيد' };
            if (openDocLabel[row.ref_type] && row.ref_id) {
                html += `<button class="btn btn-primary" id="sup-stmt-drawer-open">${openDocLabel[row.ref_type]}</button>`;
            }
            html += '</div>';

            document.getElementById('sup-stmt-drawer-body').innerHTML = html;
            drawer.classList.add('active', 'open');

            const btnCancel = document.getElementById('sup-stmt-drawer-cancel');
            if (btnCancel) btnCancel.addEventListener('click', () => drawer.classList.remove('active', 'open'));

            const btnOpen = document.getElementById('sup-stmt-drawer-open');
            if (btnOpen) {
                btnOpen.addEventListener('click', () => {
                    drawer.classList.remove('active', 'open');
                    if (row.ref_type === 'purchase_invoice' && typeof window.editPurchaseInvoice === 'function') {
                        const det = { id: row.ref_id, invoice_no: row.doc_no, invoice_date: row.date };
                        window.editPurchaseInvoice(det);
                    } else if (row.ref_type === 'purchase_return' && typeof window.editPurchaseReturn === 'function') {
                        const det = { id: row.ref_id, return_no: row.doc_no, return_date: row.date };
                        window.editPurchaseReturn(det);
                    } else {
                        if (typeof window.navigateTo === 'function') {
                            const target = { purchase_invoice: 'purchase-invoice', purchase_return: 'purchase-return', supplier_payment: 'supplier-payments', ap_payment: 'ap-payment', ap_note: 'ap-notice', journal_entry: 'journal-inquiry' }[row.ref_type];
                            if (target) window.navigateTo(target);
                        }
                    }
                });
            }
        }

        // ── بناء الجدول ────────────────────────────────────────────
        function renderTable(data) {
            const tbody = document.getElementById('sup-stmt-tbody');
            const tfoot = document.getElementById('sup-stmt-tfoot');
            const kpisEl = document.getElementById('sup-stmt-kpis');
            const lines = data.rows || [];
            const kpis = data.kpis || {};

            // بطاقة ملخص (KPIs)
            if (kpisEl) {
                const cards = [
                    { icon: 'fa-wallet', color: '#059669', label: 'الرصيد الحالي', value: fmt(kpis.current_balance) },
                    { icon: 'fa-file-invoice', color: '#7c3aed', label: 'المشتريات', value: fmt(kpis.total_purchases) },
                    { icon: 'fa-undo', color: '#f59e0b', label: 'المرتجعات', value: fmt(kpis.total_returns) },
                    { icon: 'fa-hand-holding-usd', color: '#3b82f6', label: 'المدفوعات', value: fmt(kpis.total_payments) },
                    { icon: 'fa-file-circle-check', color: '#8b5cf6', label: 'التسويات (صافي)', value: fmt(kpis.total_notes) },
                    { icon: 'fa-book', color: '#64748b', label: 'عدد الحركات', value: fmtInt(kpis.transaction_count) }
                ];
                kpisEl.innerHTML = `
                    <div style="display:flex;gap:8px;flex-wrap:wrap;padding:12px 14px">
                        <div style="flex:1.4;min-width:150px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;border-right:4px solid #059669;padding:10px 14px">
                            <div style="display:flex;align-items:center;gap:6px"><i class="fa-solid fa-wallet" style="color:#059669"></i><span style="font-size:0.72rem;color:#6b7280;font-weight:600">الرصيد الحالي</span></div>
                            <div style="font-size:1.3rem;font-weight:900;color:${balColor(kpis.current_balance)};direction:ltr">${fmt(kpis.current_balance)}</div>
                        </div>
                        ${cards.slice(1).map(c => `
                        <div style="flex:1;min-width:120px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;border-right:3px solid ${c.color};padding:8px 12px">
                            <div style="display:flex;align-items:center;gap:6px"><i class="fa-solid ${c.icon}" style="color:${c.color};font-size:0.8rem"></i><span style="font-size:0.68rem;color:#6b7280;font-weight:600">${c.label}</span></div>
                            <div style="font-size:0.95rem;font-weight:800;color:${c.color};direction:ltr">${c.value}</div>
                        </div>`).join('')}
                    </div>`;
                kpisEl.style.display = '';
            }

            tbody.innerHTML = '';
            let totalDebit = 0, totalCredit = 0;

            // سطر الرصيد الافتتاحي الدائم
            const m0 = getMeta('opening');
            const openTr = document.createElement('tr');
            openTr.style.background = m0.bg;
            openTr.innerHTML = `
                <td>—</td>
                <td><span class="badge-status ${m0.badge}" style="background:${m0.bg};color:${m0.color}"><i class="fa-solid ${m0.icon}"></i> ${m0.label}</span></td>
                <td>—</td>
                <td><span style="color:var(--text-muted);font-size:0.8rem">رصيد افتتاحي / رصيد قبل الفترة</span></td>
                <td>—</td><td>—</td>
                <td>—</td><td>—</td>
                <td style="font-weight:800;color:${balColor(data.opening_balance)}"><strong>${fmt(data.opening_balance)}</strong></td>
                <td></td>`;
            tbody.appendChild(openTr);

            if (lines.length === 0) {
                tbody.innerHTML += '<tr><td colspan="10" style="text-align:center;padding:30px;color:var(--text-muted)">لا توجد حركات في هذه الفترة</td></tr>';
            }

            lines.forEach(row => {
                const m = getMeta(row.ref_type || row.type);
                totalDebit += row.debit;
                totalCredit += row.credit;
                const tr = document.createElement('tr');
                tr.style.cursor = 'pointer';
                tr.innerHTML = `
                    <td>${fmtDt(row.date)}</td>
                    <td><span class="badge-status ${m.badge}" style="background:${m.bg};color:${m.color}"><i class="fa-solid ${m.icon}"></i> ${m.label}</span></td>
                    <td><strong>${escVal(row.doc_no)}</strong></td>
                    <td style="max-width:240px"><span style="font-size:0.78rem;color:var(--text-muted)">${esc(row.description || '')}</span></td>
                    <td class="text-success">${row.debit ? fmt(row.debit) : '-'}</td>
                    <td class="text-danger">${row.credit ? fmt(row.credit) : '-'}</td>
                    <td style="color:var(--text-muted)">${fmt(row.balance_before)}</td>
                    <td style="color:${row.impact >= 0 ? 'var(--success-color)' : 'var(--danger-color)'}">${row.impact >= 0 ? '+' : ''}${fmt(row.impact)}</td>
                    <td style="font-weight:800;color:${balColor(row.balance)}">${fmt(row.balance)}</td>
                    <td><button class="icon-btn" title="تفاصيل"><i class="fa-solid fa-eye" style="color:${m.color}"></i></button></td>`;
                tr.addEventListener('click', () => openDrawer(row));
                tbody.appendChild(tr);
            });

            tfoot.style.display = '';
            document.getElementById('sup-stmt-total-debit').innerHTML = fmt(totalDebit);
            document.getElementById('sup-stmt-total-credit').innerHTML = fmt(totalCredit);
            document.getElementById('sup-stmt-total-balance').innerHTML = fmt(data.closing_balance);

            // تحديث عنوان/فترة الكشف
            document.getElementById('sup-stmt-results').style.display = '';
            document.getElementById('sup-stmt-title').textContent = 'كشف حساب: ' + (data.supplier?.supplier_name || '');
            const pf = document.getElementById('sup-stmt-from')?.value;
            const pt = document.getElementById('sup-stmt-to')?.value;
            document.getElementById('sup-stmt-period').textContent = 'الفترة: ' + (pf || '---') + ' إلى ' + (pt || '---');
        }

        const btnShow = document.getElementById('btn-sup-stmt-show');
        if (btnShow && !btnShow.dataset.bound) {
            btnShow.dataset.bound = '1';
            btnShow.addEventListener('click', async () => {
                const id = sel.value;
                if (!id) return alert('اختر مورد أولاً');
                const params = new URLSearchParams();
                const f = document.getElementById('sup-stmt-from').value;
                const t = document.getElementById('sup-stmt-to').value;
                const tp = document.getElementById('sup-stmt-type')?.value || '';
                const q = document.getElementById('sup-stmt-q')?.value || '';
                if (f) params.append('from', f);
                if (t) params.append('to', t);
                if (tp) params.append('type', tp);
                if (q) params.append('q', q);
                params.append('showDetails', 'true');
                const r = await req(`/payments/supplier/${id}/statement` + (params.toString() ? '?' + params : ''));
                if (!r.success) return alert(r.message || 'خطأ');
                renderTable(r.data);
            });
        }

        const btnPrint = document.getElementById('btn-sup-stmt-print');
        if (btnPrint && !btnPrint.dataset.bound) {
            btnPrint.dataset.bound = '1';
            btnPrint.addEventListener('click', () => {
                const tbody = document.getElementById('sup-stmt-tbody');
                if (!tbody || !tbody.innerHTML) return alert('عرض الكشف أولاً');
                const w = window.open('', '_blank', 'width=1000,height=700');
                if (!w) return alert('منع النافذة المنبثقة');
                const title = document.getElementById('sup-stmt-title').textContent;
                const period = document.getElementById('sup-stmt-period').textContent;
                w.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>${title}</title>
                    <style>
                        body{font-family:Tahoma,Arial,sans-serif;direction:rtl;padding:20px;color:#111}
                        h2{text-align:center;margin:0 0 4px} .sub{text-align:center;color:#555;font-size:13px;margin-bottom:14px}
                        table{width:100%;border-collapse:collapse;font-size:12px}
                        th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:right}
                        th{background:#f1f5f9}
                        tfoot td{font-weight:bold;background:#f8fafc}
                        .muted{color:#64748b} .danger{color:#dc2626} .success{color:#16a34a}
                    </style></head><body>
                    <h2>${title}</h2><div class="sub">${period}</div>
                    <table><thead>${document.querySelector('#sup-stmt-table thead').innerHTML}</thead>
                    <tbody>${tbody.innerHTML}</tbody>
                    <tfoot>${document.getElementById('sup-stmt-tfoot').innerHTML}</tfoot></table>
                    <div style="margin-top:16px;text-align:center;font-size:12px;color:#555">الرصيد الافتتاحي: ${document.getElementById('sup-stmt-tbody').querySelector('tr').children[8].textContent}</div>
                    <div style="margin-top:40px;display:flex;justify-content:space-between;font-size:12px;color:#555">
                        <div>توقيع مسؤول الحسابات: ______________</div><div>توقيع المورد: ______________</div>
                    </div>
                    </body></html>`);
                w.document.close();
            });
        }

        const btnExcel = document.getElementById('btn-sup-stmt-excel');
        if (btnExcel && !btnExcel.dataset.bound) {
            btnExcel.dataset.bound = '1';
            btnExcel.addEventListener('click', () => {
                const tbody = document.getElementById('sup-stmt-tbody');
                if (!tbody || !tbody.innerHTML) return alert('عرض الكشف أولاً');
                const rows = [];
                tbody.querySelectorAll('tr').forEach(tr => {
                    const cells = tr.querySelectorAll('td');
                    if (!cells.length) return;
                    rows.push(Array.from(cells).slice(0, 9).map(td => td.textContent.trim()));
                });
                if (typeof window.ExportService !== 'undefined' && window.ExportService.exportReport) {
                    window.ExportService.exportReport('excel', {
                        filename: 'supplier-statement',
                        headers: ['التاريخ', 'الحركة', 'رقم المستند', 'البيان', 'مدين', 'دائن', 'الرصيد قبل', 'الأثر', 'الرصيد الجاري'],
                        rows
                    });
                } else {
                    alert('خدمة التصدير غير متاحة');
                }
            });
        }
    };

})();
