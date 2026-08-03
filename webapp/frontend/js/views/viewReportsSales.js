(function() {
    'use strict';
    window.viewHandlers = window.viewHandlers || {};
    const viewHandlers = window.viewHandlers;

    const req = (...args) => window.req(...args);
    const fmt = (...args) => window.fmt(...args);
    const fmtPlain = (...args) => window.fmtPlain(...args);
    const fmtInt = (...args) => window.fmtInt(...args);
    const esc = (...args) => window.esc(...args);
    const num = (...args) => window.num(...args);

    // ============================================================
    // VIEW: REPORTS SALES - ربط روابط التقارير
    // ============================================================
    viewHandlers['view-reports-sales'] = async function () {
        const view = document.getElementById('view-reports-sales');
        if (!view) return;

        // ── Populate filter dropdowns ──
        async function loadFilterOptions() {
            const custSel = document.getElementById('rpt-customer');
            if (custSel && custSel.options.length <= 1) {
                const r = await req('/customers');
                if (r.success) (r.data || []).forEach(c => {
                    const o = document.createElement('option');
                    o.value = c.id; o.textContent = `${c.customer_code} - ${c.customer_name}`;
                    custSel.appendChild(o);
                });
            }
            const repSel = document.getElementById('rpt-rep');
            if (repSel && repSel.options.length <= 1) {
                const r = await req('/reps');
                if (r.success) (r.data || []).forEach(rp => {
                    const o = document.createElement('option');
                    o.value = rp.id; o.textContent = rp.rep_name;
                    repSel.appendChild(o);
                });
            }
            const storeSel = document.getElementById('rpt-store');
            if (storeSel && storeSel.options.length <= 1) {
                const r = await req('/stores');
                if (r.success) (r.data || []).forEach(s => {
                    const o = document.createElement('option');
                    o.value = s.id; o.textContent = s.store_name;
                    storeSel.appendChild(o);
                });
            }
            // Multi-select: populate rep options (small dataset, load all)
            const repMulti = document.getElementById('rpt-rep-multi');
            if (repMulti && repMulti.options.length <= 1) {
                const r = await req('/reps');
                if (r.success && Array.isArray(r.data)) {
                    r.data.forEach(rp => {
                        const o = document.createElement('option');
                        o.value = rp.id; o.textContent = rp.name || rp.rep_name;
                        repMulti.appendChild(o);
                    });
                }
            }
        }
        try {
            await loadFilterOptions();
        } catch(e) { console.error('[CSS] loadFilterOptions failed:', e); }

        // Default dates: start of year to today
        const rptFrom = document.getElementById('rpt-from');
        const rptTo = document.getElementById('rpt-to');
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        if (rptFrom && !rptFrom.value) rptFrom.value = `${yyyy}-01-01`;
        if (rptTo && !rptTo.value) rptTo.value = `${yyyy}-${mm}-${dd}`;

        const repSel = document.getElementById('rpt-rep');
        if (repSel && !repSel.dataset.searchable) {
            repSel.dataset.searchable = '1';
            window.makeSearchableSelect(repSel, Array.from(repSel.options).filter(o => o.value).map(o => ({id: o.value, name: o.textContent})), 'ابحث عن مندوب...');
        }
        const storeSel = document.getElementById('rpt-store');
        if (storeSel && !storeSel.dataset.searchable) {
            storeSel.dataset.searchable = '1';
            window.makeSearchableSelect(storeSel, Array.from(storeSel.options).filter(o => o.value).map(o => ({id: o.value, name: o.textContent})), 'ابحث عن مخزن...');
        }
        // Initialize multi-select searchable components with loaded options
        let custMultiInstance = null;
        let repMultiInstance = null;
        try {
            const custMulti = document.getElementById('rpt-customer-multi');
            if (custMulti && !custMulti.dataset.searchableInit) {
                custMulti.dataset.searchableInit = '1';
                const custSearchFn = async (q) => {
                    const repMultiEl = document.getElementById('rpt-rep-multi');
                    const selReps = repMultiEl ? Array.from(repMultiEl.selectedOptions).map(o => o.value).filter(v => v) : [];
                    let url = '/customers?limit=50&is_active=1';
                    if (q && q.length >= 1) url += '&q=' + encodeURIComponent(q);
                    if (selReps.length === 1) url += '&rep_id=' + selReps[0];
                    const r = await req(url);
                    if (r.success && Array.isArray(r.data)) return r.data.map(c => ({ id: c.id, name: c.customer_name, code: c.customer_code, rep_id: c.rep_id }));
                    return [];
                };
                custMultiInstance = makeSearchableMultiSelect(custMulti, [], 'ابحث عن عميل...', custSearchFn, (ids) => {
                    const repMultiEl = document.getElementById('rpt-rep-multi');
                    if (!repMultiEl || !repMultiInstance) return;
                    if (ids.length === 1) {
                        const custSel = custMulti;
                        const opt = custSel.querySelector('option[value="' + ids[0] + '"]');
                        if (opt) {
                            const custData = custMultiInstance.getSelectedItems().find(i => String(i.id) === ids[0]);
                            if (custData && custData.rep_id) {
                                repMultiInstance.clearSelection();
                                const repOpt = repMultiEl.querySelector('option[value="' + custData.rep_id + '"]');
                                if (repOpt) { repOpt.selected = true; repMultiEl.dispatchEvent(new Event('change')); }
                            }
                        }
                    }
                });
            }
            const repMulti = document.getElementById('rpt-rep-multi');
            if (repMulti && !repMulti.dataset.searchableInit) {
                repMulti.dataset.searchableInit = '1';
                repMultiInstance = makeSearchableMultiSelect(repMulti, Array.from(repMulti.options).filter(o => o.value).map(o => ({ id: o.value, name: o.textContent })), 'ابحث عن مندوب...', null, (ids) => {
                    if (custMultiInstance) {
                        const repId = ids.length === 1 ? ids[0] : null;
                        custMultiInstance.clearSelection();
                        custMultiInstance.setSearchFn(async (q) => {
                            let url = '/customers?limit=50&is_active=1';
                            if (q && q.length >= 1) url += '&q=' + encodeURIComponent(q);
                            if (repId) url += '&rep_id=' + repId;
                            const r = await req(url);
                            if (r.success && Array.isArray(r.data)) return r.data.map(c => ({ id: c.id, name: c.customer_name, code: c.customer_code, rep_id: c.rep_id }));
                            return [];
                        });
                    }
                });
            }
        } catch(e) {
            console.error('multi-select init error:', e);
        }

        // ── Helpers ──
        function show(id) { const e = document.getElementById(id); if (e) e.style.display = ''; }
        function hide(id) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
        function setHtml(id, html) { const e = document.getElementById(id); if (e) e.innerHTML = html; }

        function clearOutput() {
            hide('rpt-state-loading'); hide('rpt-state-empty'); hide('rpt-state-error'); hide('rpt-rep-statement-area');
            const out = document.getElementById('rpt-output');
            if (out) { out.style.display = 'block'; out.innerHTML = ''; }
        }
        function showLoading() { hide('rpt-state-empty'); hide('rpt-state-error'); hide('rpt-rep-statement-area'); const o = document.getElementById('rpt-output'); if(o){o.style.display='none';o.innerHTML='';} show('rpt-state-loading'); }
        function showEmpty(msg) { hide('rpt-state-loading'); hide('rpt-state-error'); hide('rpt-rep-statement-area'); const o = document.getElementById('rpt-output'); if(o){o.style.display='none';o.innerHTML='';} show('rpt-state-empty'); document.querySelector('#rpt-state-empty h3').textContent = msg || 'اختر التقرير والفلترة ثم اضغط عرض'; }
        function showError(msg) { hide('rpt-state-loading'); hide('rpt-state-empty'); hide('rpt-rep-statement-area'); const o = document.getElementById('rpt-output'); if(o){o.style.display='none';o.innerHTML='';} show('rpt-state-error'); document.getElementById('rpt-error-msg').textContent = msg || 'خطأ في تحميل التقرير'; }

        function renderTable(headers, rows, foot) {
            clearOutput();
            const out = document.getElementById('rpt-output');
            if (!out) return;
            out.innerHTML =
                '<div class="table-responsive"><table class="report-table">' +
                    '<thead><tr>' + headers.map(h => `<th>${h}</th>`).join('') + '</tr></thead>' +
                    '<tbody>' + rows + '</tbody>' +
                    (foot ? '<tfoot>' + foot + '</tfoot>' : '') +
                '</table></div>';
        }

        // ── Sidebar toggle for mobile ──
        const toggleBtn = document.getElementById('rpt-sidebar-toggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                const nav = view.querySelector('.report-nav');
                if (nav) nav.classList.toggle('open');
            });
        }

        function getFilters() {
            const from = document.getElementById('rpt-from')?.value || '';
            const to = document.getElementById('rpt-to')?.value || '';
            const cust = document.getElementById('rpt-customer')?.value || '';
            const rep = document.getElementById('rpt-rep')?.value || '';
            const store = document.getElementById('rpt-store')?.value || '';
            const matchStatus = document.getElementById('rpt-match-status')?.value || '';
            const showDetails = document.getElementById('rpt-show-details')?.checked || false;
            return { from, to, cust, rep, store, matchStatus, showDetails };
        }

        function updateFilterVisibility(reportType) {
            hide('rpt-filter-customer'); hide('rpt-filter-rep'); hide('rpt-filter-store'); hide('rpt-filter-details');
            hide('rpt-filter-governorate'); hide('rpt-filter-branch'); hide('rpt-filter-customer-type'); hide('rpt-filter-sort');
            hide('rpt-filter-customer-multi'); hide('rpt-filter-rep-multi'); hide('rpt-filter-match-status');
            if (reportType === 'customer-statement') { show('rpt-filter-customer'); show('rpt-filter-details'); }
            if (reportType === 'sales-by-period') { show('rpt-filter-customer'); show('rpt-filter-rep'); show('rpt-filter-store'); }
            if (reportType === 'product-sales') show('rpt-filter-store');
            if (reportType === 'rep-performance' || reportType === 'rep-statement') show('rpt-filter-rep');
            if (reportType === 'customer-sales-summary') {
                show('rpt-filter-governorate'); show('rpt-filter-branch'); show('rpt-filter-customer-type');
                show('rpt-filter-customer-multi'); show('rpt-filter-rep-multi');
            }
            if (reportType === 'ar-matching-status') { show('rpt-filter-customer'); show('rpt-filter-match-status'); }
        }

        // ── Searchable Multi-Select (Portal-based, cascading-ready) ──
        function makeSearchableMultiSelect(selectEl, optionsData, placeholder, searchFn, onSelectionChange) {
            try {
            if (!selectEl || selectEl.dataset.searchable === '1') return;
            selectEl.dataset.searchable = '1';

            const wrapper = document.createElement('div');
            wrapper.className = 'custom-select-wrapper';

            const trigger = document.createElement('div');
            trigger.className = 'custom-select-trigger';

            const tagsSpan = document.createElement('span');
            tagsSpan.style.cssText = 'flex:1;display:flex;flex-wrap:wrap;gap:3px;align-items:center;overflow:hidden';
            const chevron = document.createElement('i');
            chevron.className = 'fa-solid fa-chevron-down';
            trigger.appendChild(tagsSpan);
            trigger.appendChild(chevron);

            const portal = document.createElement('div');
            portal.className = 'custom-options';

            const searchBox = document.createElement('div');
            searchBox.className = 'custom-search-box';
            const searchInput = document.createElement('input');
            searchInput.type = 'text';
            searchInput.placeholder = placeholder || 'ابحث...';
            searchBox.appendChild(searchInput);
            portal.appendChild(searchBox);

            const optContainer = document.createElement('div');
            optContainer.style.cssText = 'max-height:220px;overflow-y:auto';
            portal.appendChild(optContainer);

            const selMap = new Map();
            let lastResults = [];
            let currentSearchFn = searchFn;

            function syncSelectedToSelect() {
                selMap.forEach((v, id) => {
                    let el = selectEl.querySelector('option[value="' + id + '"]');
                    if (!el) { el = document.createElement('option'); el.value = id; el.textContent = v.name; selectEl.appendChild(el); }
                    el.selected = true;
                });
                Array.from(selectEl.options).forEach(o => {
                    if (o.value && o.selected && !selMap.has(o.value)) selMap.set(o.value, { id: o.value, name: o.textContent });
                });
            }

            function renderTags() {
                tagsSpan.innerHTML = '';
                if (selMap.size === 0) {
                    const ph = document.createElement('span');
                    ph.style.cssText = 'color:var(--text-muted,#9ca3af);font-size:0.78rem';
                    ph.textContent = placeholder || 'اختر...';
                    tagsSpan.appendChild(ph);
                    return;
                }
                let i = 0;
                selMap.forEach((opt) => {
                    if (i < 3) {
                        const tag = document.createElement('span');
                        tag.style.cssText = 'display:inline-flex;align-items:center;gap:2px;padding:0 5px;background:rgba(124,58,237,0.08);color:var(--primary-color,#7c3aed);border-radius:3px;font-size:0.75rem;font-weight:600;white-space:nowrap';
                        tag.textContent = opt.name.length > 14 ? opt.name.slice(0, 14) + '..' : opt.name;
                        const x = document.createElement('i');
                        x.className = 'fa-solid fa-xmark';
                        x.style.cssText = 'cursor:pointer;font-size:0.5rem;margin-right:2px;color:var(--primary-color,#7c3aed)';
                        x.addEventListener('click', function(e) {
                            e.stopPropagation();
                            selMap.delete(String(opt.id));
                            const el = selectEl.querySelector('option[value="' + opt.id + '"]');
                            if (el) el.selected = false;
                            renderTags();
                            selectEl.dispatchEvent(new Event('change'));
                            if (onSelectionChange) onSelectionChange(getSelectedIds());
                        });
                        tag.appendChild(x);
                        tagsSpan.appendChild(tag);
                    }
                    i++;
                });
                if (selMap.size > 3) {
                    const more = document.createElement('span');
                    more.style.cssText = 'font-size:0.7rem;color:var(--text-muted);font-weight:600';
                    more.textContent = '+' + (selMap.size - 3);
                    tagsSpan.appendChild(more);
                }
            }

            function renderItems(arr) {
                optContainer.innerHTML = '';
                const allDiv = document.createElement('div');
                allDiv.className = 'custom-option' + (selMap.size === 0 ? ' selected' : '');
                allDiv.style.cssText += ';display:flex;align-items:center;gap:6px;font-weight:600;font-size:0.8rem';
                const allCb = document.createElement('span');
                allCb.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border:1.5px solid var(--border-color);border-radius:3px;flex-shrink:0;font-size:0.45rem';
                allCb.innerHTML = '<i class="fa-solid fa-check" style="opacity:' + (selMap.size === 0 ? '1' : '0') + '"></i>';
                if (selMap.size === 0) allCb.style.cssText += ';background:var(--primary-color);border-color:var(--primary-color);color:#fff';
                allDiv.appendChild(allCb);
                allDiv.appendChild(document.createTextNode('الكل'));
                allDiv.addEventListener('click', function(e) {
                    e.stopPropagation();
                    selMap.clear();
                    Array.from(selectEl.options).forEach(o => { if (o.value) o.selected = false; });
                    renderTags();
                    if (currentSearchFn) renderItems(lastResults);
                    else renderOptions(searchInput.value);
                    selectEl.dispatchEvent(new Event('change'));
                    if (onSelectionChange) onSelectionChange(getSelectedIds());
                });
                optContainer.appendChild(allDiv);

                arr.slice(0, 200).forEach(opt => {
                    if (!opt || !opt.name) return;
                    const id = String(opt.id);
                    const sel = selMap.has(id);
                    const div = document.createElement('div');
                    div.className = 'custom-option' + (sel ? ' selected' : '');
                    div.style.cssText += ';display:flex;align-items:center;gap:6px;font-size:0.8rem';
                    const cb = document.createElement('span');
                    cb.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border:1.5px solid var(--border-color);border-radius:3px;flex-shrink:0;font-size:0.45rem';
                    cb.innerHTML = '<i class="fa-solid fa-check" style="opacity:' + (sel ? '1' : '0') + '"></i>';
                    if (sel) cb.style.cssText += ';background:var(--primary-color);border-color:var(--primary-color);color:#fff';
                    div.appendChild(cb);
                    const label = document.createElement('span');
                    label.textContent = (opt.code ? opt.code + ' - ' : '') + opt.name;
                    div.appendChild(label);
                    div.addEventListener('click', function(e) {
                        e.stopPropagation();
                        if (selMap.has(id)) {
                            selMap.delete(id);
                            const el = selectEl.querySelector('option[value="' + opt.id + '"]');
                            if (el) el.selected = false;
                        } else {
                            selMap.set(id, { id: opt.id, name: opt.name });
                            let el = selectEl.querySelector('option[value="' + opt.id + '"]');
                            if (!el) { el = document.createElement('option'); el.value = opt.id; el.textContent = opt.name; selectEl.appendChild(el); }
                            el.selected = true;
                        }
                        renderTags();
                        if (currentSearchFn) renderItems(lastResults);
                        else renderOptions(searchInput.value);
                        selectEl.dispatchEvent(new Event('change'));
                        if (onSelectionChange) onSelectionChange(getSelectedIds());
                    });
                    optContainer.appendChild(div);
                });

                if (arr.length === 0 && searchInput.value.length >= 1) {
                    const e = document.createElement('div');
                    e.style.cssText = 'padding:14px;text-align:center;color:var(--text-muted);font-size:0.8rem';
                    e.textContent = 'لا توجد نتائج';
                    optContainer.appendChild(e);
                }
            }

            async function renderOptions(filter) {
                if (currentSearchFn) {
                    optContainer.innerHTML = '';
                    const loading = document.createElement('div');
                    loading.style.cssText = 'padding:14px;text-align:center;color:var(--text-muted);font-size:0.8rem';
                    loading.textContent = 'جاري البحث...';
                    optContainer.appendChild(loading);
                    try {
                        const results = await currentSearchFn(filter || '');
                        lastResults = results || [];
                        optContainer.innerHTML = '';
                        renderItems(lastResults);
                    } catch(e) {
                        optContainer.innerHTML = '';
                        const msg = document.createElement('div');
                        msg.style.cssText = 'padding:12px;text-align:center;color:var(--danger-color,#ef4444);font-size:0.8rem';
                        msg.textContent = 'خطأ في البحث';
                        optContainer.appendChild(msg);
                    }
                    return;
                }
                const filtered = optionsData.filter(o => o && o.name && (!filter || o.name.toLowerCase().includes(filter.toLowerCase()) || (o.code && String(o.code).includes(filter))));
                renderItems(filtered);
            }

            function positionPortal() {
                const r = trigger.getBoundingClientRect();
                portal.style.setProperty('position', 'fixed');
                portal.style.setProperty('top', r.bottom + 'px');
                portal.style.setProperty('left', r.left + 'px');
                portal.style.setProperty('right', 'auto');
                portal.style.setProperty('width', r.width + 'px');
                portal.style.setProperty('z-index', '99999');
            }

            function openDropdown() {
                document.querySelectorAll('.custom-select-wrapper.open').forEach(w => w.classList.remove('open'));
                document.querySelectorAll('.custom-options.portal-active').forEach(p => {
                    p.classList.remove('portal-active');
                    p.style.setProperty('display', 'none');
                    if (p.parentNode) p.parentNode.removeChild(p);
                });
                wrapper.classList.add('open');
                positionPortal();
                portal.style.setProperty('display', 'block');
                portal.classList.add('portal-active');
                document.body.appendChild(portal);
                searchInput.value = '';
                lastResults = [];
                renderOptions('');
                searchInput.focus();
                window.addEventListener('scroll', positionPortal, { passive: true });
                window.addEventListener('resize', positionPortal, { passive: true });
            }

            function closeDropdown() {
                wrapper.classList.remove('open');
                portal.classList.remove('portal-active');
                portal.style.setProperty('display', 'none');
                if (portal.parentNode) portal.parentNode.removeChild(portal);
                window.removeEventListener('scroll', positionPortal);
                window.removeEventListener('resize', positionPortal);
            }

            trigger.addEventListener('click', function(e) {
                e.stopPropagation();
                const isOpen = wrapper.classList.contains('open');
                document.querySelectorAll('.custom-select-wrapper.open').forEach(w => w.classList.remove('open'));
                document.querySelectorAll('.custom-options.portal-active').forEach(p => {
                    p.classList.remove('portal-active');
                    p.style.setProperty('display', 'none');
                    if (p.parentNode) p.parentNode.removeChild(p);
                });
                if (!isOpen) openDropdown();
            });

            searchInput.addEventListener('input', function(e) {
                if (this._timer) clearTimeout(this._timer);
                this._timer = setTimeout(() => renderOptions(e.target.value), 250);
            });
            searchInput.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeDropdown(); });

            document.addEventListener('click', function(e) {
                if (!wrapper.contains(e.target) && !portal.contains(e.target)) closeDropdown();
            });
            portal.addEventListener('click', function(e) { e.stopPropagation(); });

            wrapper.appendChild(trigger);
            syncSelectedToSelect();
            selectEl.style.display = 'none';
            if (selectEl.nextElementSibling && selectEl.nextElementSibling.classList.contains('custom-select-wrapper')) {
                selectEl.nextElementSibling.remove();
            }
            selectEl.parentNode.insertBefore(wrapper, selectEl.nextSibling);
            portal.style.setProperty('display', 'none');
            document.body.appendChild(portal);
            renderTags();

            function getSelectedIds() { return Array.from(selMap.keys()); }
            function getSelectedItems() { return Array.from(selMap.values()); }

            return {
                wrapper,
                getSelectedIds,
                getSelectedItems,
                clearSelection() {
                    selMap.clear();
                    Array.from(selectEl.options).forEach(o => { if (o.value) o.selected = false; });
                    renderTags();
                },
                setSearchFn(fn) { currentSearchFn = fn; },
                destroy() {
                    closeDropdown();
                    if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
                    if (portal.parentNode) portal.parentNode.removeChild(portal);
                    selectEl.dataset.searchable = '';
                }
            };
            } catch(e) { console.error('makeSearchableMultiSelect error:', e); return null; }
        }

        // ── Report renderers ──
        const renderers = {
            async dashboard() {
                const f = getFilters();
                const r = await req(`/reports/dashboard-cards?from=${f.from}&to=${f.to}`);
                if (!r.success || !r.data) { showError(r.message); return; }
                const d = r.data;
                clearOutput();
                const out = document.getElementById('rpt-output');
                if (!out) return;
                const cards = [
                    { label: 'إجمالي المبيعات', value: fmt(d.total_sales) },
                    { label: 'صافي المبيعات', value: fmt(d.net_sales) },
                    { label: 'المرتجعات', value: fmt(d.total_returns) },
                    { label: 'المحصل', value: fmt(d.collected_amount) },
                    { label: 'المستحق', value: fmt(d.outstanding_amount) },
                    { label: 'الضريبة', value: fmt(d.total_vat) },
                    { label: 'الفواتير', value: fmtInt(d.invoice_count) },
                    { label: 'متوسط الفاتورة', value: fmt(d.avg_invoice) },
                    { label: 'ربح', value: fmt(d.total_profit) + ' (' + d.margin_pct.toFixed(1) + '%)' }
                ];
                out.innerHTML =
                    '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">' +
                    cards.map(c => '<div style="flex:1;min-width:110px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:8px 12px"><div style="font-size:0.7rem;color:#6b7280;margin-bottom:2px">' + c.label + '</div><div style="font-size:0.95rem;font-weight:700;color:#1e3a5f;direction:ltr">' + c.value + '</div></div>').join('') +
                    '</div>' +
                    '<div style="text-align:center;padding:30px;color:#6b7280">' +
                        '<i class="fa-solid fa-chart-pie" style="font-size:2rem;color:#d1d5db;margin-bottom:10px;display:block"></i>' +
                        '<h3 style="color:#374151;margin:0 0 4px 0">جميع التقارير متاحة</h3>' +
                        '<p style="margin:0;font-size:0.8rem">اختر تقريراً من القائمة الجانبية للبدء</p>' +
                    '</div>';
                hide('rpt-state-loading'); hide('rpt-state-error'); hide('rpt-rep-statement-area');
                _lastReportData = {
                    title: 'بطاقة أداء التقارير',
                    filters: [{ label: 'من تاريخ', value: f.from }, { label: 'إلى تاريخ', value: f.to }].filter(x => x.value),
                    summary: cards,
                    columns: [],
                    rows: [],
                    totals: cards
                };
            },
            async 'customer-statement'() {
                const f = getFilters();
                if (!f.cust) { showError('يرجى اختيار العميل أولاً'); return; }

                this._renderSkeleton();

                const params = `from=${f.from}&to=${f.to}&showDetails=${f.showDetails}`;
                const r = await req(`/reports/customer-statement/${f.cust}?${params}`);
                if (!r.success || !r.data) { showError(r.message); return; }
                const d = r.data;
                const allRows = d.rows || [];
                const cust = d.customer || {};
                const kpis = d.kpis || {};
                const summary = d.summary || {};
                const showDet = !!(f.showDetails || document.getElementById('rpt-show-details')?.checked);

                function fmtDt(v) { return v ? String(v).slice(0, 10) : '-'; }

                function balColor(v) { return v > 0 ? '#059669' : v < 0 ? '#ef4444' : '#9ca3af'; }

                const typeMeta = {
                    sales_invoice: { icon: 'fa-file-invoice', label: 'فاتورة', color: '#059669', bg: 'rgba(5,150,105,0.1)' },
                    sales_return: { icon: 'fa-undo', label: 'مرتجع', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
                    collection: { icon: 'fa-hand-holding-usd', label: 'قبض', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
                    journal_entry: { icon: 'fa-book', label: 'قيد', color: '#6b7280', bg: 'rgba(107,114,128,0.08)' },
                    opening: { icon: 'fa-circle', label: 'افتتاحي', color: '#1e3a5f', bg: '#f1f5f9' }
                };

                function getMeta(t) { return typeMeta[t] || { icon: 'fa-circle', label: t, color: '#6b7280', bg: 'rgba(107,114,128,0.08)' }; }

                function getDocDesc(row) {
                    if (row.ref_type === 'sales_invoice') return 'فاتورة بيع رقم ' + esc(row.doc_no);
                    if (row.ref_type === 'sales_return') return 'مرتجع مبيعات رقم ' + esc(row.doc_no);
                    if (row.ref_type === 'collection') return 'سند قبض رقم ' + esc(row.doc_no);
                    if (row.ref_type === 'journal_entry') return 'قيد يدوي رقم ' + esc(row.doc_no);
                    return esc(row.description || '');
                }

                let filteredRows = [...allRows];
                const reportTitle = 'كشف حساب عميل';
                const periodStr = (f.from || '---') + ' → ' + (f.to || '---');

                // ── Build complete report HTML inside rpt-output ──
                clearOutput();
                const out = document.getElementById('rpt-output');
                if (!out) return;

                out.innerHTML =
                    // Title
                    '<div style="margin-bottom:6px;display:flex;align-items:center;justify-content:space-between">' +
                        '<div><span style="font-size:1.05rem;font-weight:800;color:#1e3a5f">' + reportTitle + '</span>' +
                        '<span style="font-size:0.75rem;color:#6b7280;margin-right:10px">' + periodStr + '</span></div>' +
                        '<span style="font-size:0.7rem;color:#9ca3af">' + fmtInt(kpis.transaction_count) + ' حركات</span>' +
                    '</div>' +
                    // Customer card
                    '<div style="margin-bottom:6px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:10px 14px;display:flex;flex-wrap:wrap;gap:10px">' +
                        '<div style="flex:1;min-width:200px">' +
                            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' +
                                '<div style="width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#a78bfa);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:0.9rem">' +
                                    esc((cust.customer_name || '?')[0]) +
                                '</div>' +
                                '<div>' +
                                    '<div style="font-weight:700;font-size:0.85rem;color:#111827">' + esc(cust.customer_name) + '</div>' +
                                    '<div style="font-size:0.7rem;color:#6b7280">' + esc(cust.customer_code) + (cust.rep_name ? ' | ' + esc(cust.rep_name) : '') + (cust.phone ? ' | ' + esc(cust.phone) : '') + '</div>' +
                                '</div>' +
                            '</div>' +
                            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 14px;font-size:0.7rem">' +
                                '<div><span style="color:#9ca3af">الفرع</span><br><span style="color:#374151;font-weight:500">' + esc(cust.branch || '-') + '</span></div>' +
                                '<div><span style="color:#9ca3af">المحافظة</span><br><span style="color:#374151;font-weight:500">' + esc(cust.governorate || '-') + '</span></div>' +
                                '<div><span style="color:#9ca3af">العنوان</span><br><span style="color:#374151;font-weight:500">' + esc(cust.address || '-') + '</span></div>' +
                                '<div><span style="color:#9ca3af">حد الائتمان</span><br><span style="color:#374151;font-weight:500">' + fmt(cust.credit_limit) + '</span></div>' +
                            '</div>' +
                        '</div>' +
                        '<div style="width:1px;background:#e5e7eb"></div>' +
                        '<div style="min-width:160px;display:flex;flex-direction:column;justify-content:center;gap:3px;padding:2px 0">' +
                            '<div style="font-size:0.65rem;color:#9ca3af">الرصيد الحالي</div>' +
                            '<div style="font-size:1.35rem;font-weight:900;color:' + balColor(kpis.current_balance) + ';direction:ltr">' + fmt(kpis.current_balance) + '</div>' +
                            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:1px 10px;margin-top:3px;font-size:0.68rem">' +
                                '<div><span style="color:#9ca3af">آخر فاتورة</span><br><span style="color:#374151;font-weight:500">' + fmtDt(cust.last_invoice_date) + '</span></div>' +
                                '<div><span style="color:#9ca3af">آخر تحصيل</span><br><span style="color:#374151;font-weight:500">' + fmtDt(cust.last_collection_date) + '</span></div>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    // KPI row (4 cards)
                    '<div style="margin-bottom:5px;display:flex;gap:6px;flex-wrap:wrap">' +
                        '<div style="flex:1.5;min-width:130px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;border-right:3px solid #059669;padding:6px 12px">' +
                            '<div style="display:flex;align-items:center;gap:5px;margin-bottom:1px">' +
                                '<i class="fa-solid fa-wallet" style="color:#059669;font-size:0.9rem;width:18px;text-align:center"></i>' +
                                '<span style="color:#6b7280;font-size:0.7rem;font-weight:600">الرصيد الحالي</span>' +
                            '</div>' +
                            '<div style="color:#059669;font-size:1.3rem;font-weight:800;direction:ltr">' + fmt(kpis.current_balance) + '</div>' +
                        '</div>' +
                        '<div style="flex:1;min-width:90px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;border-right:3px solid #7c3aed;padding:6px 12px">' +
                            '<div style="display:flex;align-items:center;gap:5px;margin-bottom:1px">' +
                                '<i class="fa-solid fa-chart-line" style="color:#7c3aed;font-size:0.8rem;width:16px;text-align:center"></i>' +
                                '<span style="color:#6b7280;font-size:0.7rem;font-weight:600">المبيعات</span>' +
                            '</div>' +
                            '<div style="color:#7c3aed;font-size:1rem;font-weight:700;direction:ltr">' + fmt(kpis.total_sales) + '</div>' +
                        '</div>' +
                        '<div style="flex:1;min-width:90px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;border-right:3px solid #3b82f6;padding:6px 12px">' +
                            '<div style="display:flex;align-items:center;gap:5px;margin-bottom:1px">' +
                                '<i class="fa-solid fa-hand-holding-usd" style="color:#3b82f6;font-size:0.8rem;width:16px;text-align:center"></i>' +
                                '<span style="color:#6b7280;font-size:0.7rem;font-weight:600">التحصيلات</span>' +
                            '</div>' +
                            '<div style="color:#3b82f6;font-size:1rem;font-weight:700;direction:ltr">' + fmt(kpis.total_collections) + '</div>' +
                        '</div>' +
                        '<div style="flex:1;min-width:90px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;border-right:3px solid #f59e0b;padding:6px 12px">' +
                            '<div style="display:flex;align-items:center;gap:5px;margin-bottom:1px">' +
                                '<i class="fa-solid fa-undo" style="color:#f59e0b;font-size:0.8rem;width:16px;text-align:center"></i>' +
                                '<span style="color:#6b7280;font-size:0.7rem;font-weight:600">المرتجعات</span>' +
                            '</div>' +
                            '<div style="color:#f59e0b;font-size:1rem;font-weight:700;direction:ltr">' + fmt(kpis.total_returns) + '</div>' +
                        '</div>' +
                    '</div>' +
                    // Filter bar
                    '<div class="no-print" style="display:flex;flex-wrap:wrap;gap:5px;align-items:center;padding:5px 10px;background:#fff;border:1px solid #e5e7eb;border-bottom:none;border-radius:8px 8px 0 0">' +
                        '<div style="display:flex;align-items:center;gap:4px;flex:1;min-width:130px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:0 7px">' +
                            '<i class="fa-solid fa-search" style="color:#9ca3af;font-size:0.7rem"></i>' +
                            '<input type="text" class="stmt-search-inp" placeholder="بحث برقم المستند..." style="flex:1;padding:4px 0;border:none;background:transparent;font-size:0.72rem;outline:none">' +
                        '</div>' +
                        '<div style="display:flex;gap:3px;flex-wrap:wrap;align-items:center">' +
                            ['sales_invoice','sales_return','collection','journal_entry'].map(t => {
                                const m = getMeta(t);
                                return '<label style="display:flex;align-items:center;gap:2px;font-size:0.68rem;cursor:pointer;padding:2px 5px;border-radius:4px;background:' + m.bg + ';border:1px solid ' + m.color + '30">' +
                                    '<input type="checkbox" class="stmt-filter-cb" data-type="' + t + '" checked style="margin:0;width:10px;height:10px;accent-color:' + m.color + '">' +
                                    '<i class="fa-solid ' + m.icon + '" style="color:' + m.color + ';font-size:0.55rem"></i>' +
                                    '<span style="color:' + m.color + ';font-weight:600">' + m.label + '</span>' +
                                '</label>';
                            }).join('') +
                            '<button class="stmt-reset-btn" style="padding:2px 5px;border:1px solid #e5e7eb;border-radius:4px;background:#fff;cursor:pointer;font-size:0.6rem;color:#6b7280"><i class="fa-solid fa-rotate"></i></button>' +
                        '</div>' +
                    '</div>' +
                    // Table placeholder
                    '<div class="stmt-table-wrap"></div>';

                // ── Table renderer (scoped to out) ──
                function renderStmtTable() {
                    const sv = (out.querySelector('.stmt-search-inp')?.value || '').toLowerCase().trim();
                    const active = new Set();
                    out.querySelectorAll('.stmt-filter-cb:checked').forEach(cb => active.add(cb.dataset.type));

                    const openingRow = allRows.length > 0 && allRows[0].ref_type === 'opening' ? allRows[0] : null;
                    const txnRows = openingRow ? allRows.slice(1) : allRows;

                    filteredRows = txnRows.filter(row => {
                        if (!active.has(row.ref_type)) return false;
                        if (!sv) return true;
                        const d = getDocDesc(row).toLowerCase();
                        const pm = row.items && row.items.some(it => (it.product_name || '').toLowerCase().includes(sv));
                        return (row.doc_no || '').toLowerCase().includes(sv) || d.includes(sv) || (row.description || '').toLowerCase().includes(sv) || pm;
                    });

                    const headers = ['#', 'التاريخ', 'النوع', 'رقم المستند', 'البيان', 'مدين', 'دائن', 'الرصيد'];
                    if (showDet) headers.push('');
                    const colSpan = headers.length;

                    let bodyHtml = '';

                    if (openingRow) {
                        bodyHtml += '<tr style="background:#f1f5f9">' +
                            '<td style="color:#9ca3af;font-size:0.68rem;padding:5px 7px">—</td>' +
                            '<td style="color:#9ca3af;padding:5px 7px">—</td>' +
                            '<td colspan="2" style="padding:5px 7px"><span style="color:' + getMeta('opening').color + ';font-weight:600;font-size:0.75rem"><i class="fa-solid fa-circle" style="font-size:0.38rem;vertical-align:middle;margin-left:3px;color:' + getMeta('opening').color + '"></i>' + esc(openingRow.doc_type_short) + '</span></td>' +
                            '<td style="font-size:0.72rem;color:#6b7280;padding:5px 7px">' + esc(openingRow.description) + '</td>' +
                            '<td style="color:#9ca3af;padding:5px 7px">—</td>' +
                            '<td style="color:#9ca3af;padding:5px 7px">—</td>' +
                            '<td style="font-weight:700;direction:ltr;text-align:right;color:' + balColor(openingRow.balance) + ';padding:5px 7px">' + fmt(openingRow.balance) + '</td>' +
                            (showDet ? '<td style="padding:5px 7px"></td>' : '') +
                        '</tr>';
                    }

                    if (filteredRows.length === 0 && !openingRow) {
                        bodyHtml += '<tr><td colspan="' + colSpan + '" style="text-align:center;padding:25px;color:#999;font-size:0.8rem">لا توجد حركات</td></tr>';
                    } else {
                        filteredRows.forEach((r, i) => {
                            const m = getMeta(r.ref_type);
                            const desc = getDocDesc(r);
                            const hasItems = showDet && r.items && r.items.length > 0;
                            const detailId = 'cs-dt-' + i;

                            bodyHtml += '<tr class="stmt-row" style="transition:background 0.15s">' +
                                '<td style="color:#9ca3af;font-size:0.65rem;padding:5px 7px">' + (i + 1) + '</td>' +
                                '<td style="white-space:nowrap;font-size:0.72rem;padding:5px 7px">' + fmtDt(r.date) + '</td>' +
                                '<td style="padding:5px 7px"><span style="display:inline-flex;align-items:center;gap:2px;padding:1px 7px;border-radius:10px;background:' + m.bg + ';color:' + m.color + ';font-weight:600;font-size:0.65rem;white-space:nowrap">' +
                                    '<i class="fa-solid ' + m.icon + '" style="font-size:0.5rem"></i>' +
                                    esc(r.doc_type_short || r.doc_type || '-') +
                                '</span></td>' +
                                '<td style="font-weight:600;font-size:0.75rem;padding:5px 7px">' + esc(r.doc_no || '-') + '</td>' +
                                '<td style="font-size:0.72rem;color:#4b5563;word-break:break-word;padding:5px 7px;min-width:70px">' + desc + '</td>' +
                                '<td style="font-weight:600;color:#059669;direction:ltr;text-align:right;font-size:0.75rem;padding:5px 7px">' + fmt(r.debit) + '</td>' +
                                '<td style="font-weight:600;color:#ef4444;direction:ltr;text-align:right;font-size:0.75rem;padding:5px 7px">' + fmt(r.credit) + '</td>' +
                                '<td style="font-weight:700;direction:ltr;text-align:right;color:' + balColor(r.balance) + ';font-size:0.78rem;padding:5px 7px">' + fmt(r.balance) + '</td>' +
                                (showDet ? '<td style="text-align:center;width:26px;padding:5px 3px">' +
                                    (hasItems
                                        ? '<i class="fa-solid fa-chevron-down cs-toggle" data-target="' + detailId + '" style="cursor:pointer;color:var(--primary-color);transition:transform 0.2s;font-size:0.7rem"></i>'
                                        : '<span style="color:#d1d5db;font-size:0.55rem">—</span>') +
                                '</td>' : '') +
                            '</tr>';

                            if (hasItems) {
                                const itemTotal = r.items.reduce((s, it) => s + it.total, 0);
                                const taxAmt = r.tax_amount || 0;
                                const discAmt = r.discount_amount || 0;
                                bodyHtml += '<tr id="' + detailId + '" style="display:none">' +
                                    '<td colspan="' + colSpan + '" style="padding:0;border:none;background:#fafbff">' +
                                        '<div style="padding:6px 10px">' +
                                            '<table style="width:100%;border-collapse:collapse;font-size:0.7rem">' +
                                                '<thead><tr style="background:#eef2ff;color:#4f46e5;font-weight:600;font-size:0.65rem">' +
                                                    '<th style="padding:3px 5px;text-align:right">المنتج</th>' +
                                                    '<th style="padding:3px 5px;text-align:right">الكود</th>' +
                                                    '<th style="padding:3px 5px;text-align:center">الكمية</th>' +
                                                    '<th style="padding:3px 5px;text-align:center">الوحدة</th>' +
                                                    '<th style="padding:3px 5px;text-align:left">السعر</th>' +
                                                    '<th style="padding:3px 5px;text-align:left">الخصم</th>' +
                                                    '<th style="padding:3px 5px;text-align:left">الإجمالي</th>' +
                                                '</tr></thead><tbody>' +
                                                r.items.map(it => '<tr style="border-bottom:1px solid #f3f4f6">' +
                                                    '<td style="padding:2px 5px;font-weight:500"><i class="fa-solid fa-box" style="color:#9ca3af;font-size:0.5rem;margin-left:2px"></i>' + esc(it.product_name) + '</td>' +
                                                    '<td style="padding:2px 5px;color:#6b7280">' + esc(it.product_code || '-') + '</td>' +
                                                    '<td style="padding:2px 5px;text-align:center">' + fmtInt(it.quantity) + '</td>' +
                                                    '<td style="padding:2px 5px;text-align:center">' + esc(it.unit || '-') + '</td>' +
                                                    '<td style="padding:2px 5px;text-align:left;direction:ltr">' + fmt(it.unit_price) + '</td>' +
                                                    '<td style="padding:2px 5px;text-align:left;direction:ltr">' + fmt(it.discount) + '</td>' +
                                                    '<td style="padding:2px 5px;text-align:left;direction:ltr;font-weight:700;color:#059669">' + fmt(it.total) + '</td>' +
                                                '</tr>').join('') +
                                                '<tr style="background:#f8faff;font-weight:700;font-size:0.7rem">' +
                                                    '<td colspan="5" style="padding:3px 5px;text-align:left;color:#4b5563">إجمالي الأصناف</td>' +
                                                    '<td style="padding:3px 5px;text-align:left;direction:ltr;color:#374151">' + fmt(discAmt) + '</td>' +
                                                    '<td style="padding:3px 5px;text-align:left;direction:ltr;color:#374151">' + fmt(itemTotal) + '</td>' +
                                                '</tr>' +
                                                (taxAmt > 0 ? '<tr style="font-size:0.68rem">' +
                                                    '<td colspan="6" style="padding:1px 5px;text-align:left;color:#6b7280">الضريبة</td>' +
                                                    '<td style="padding:1px 5px;text-align:left;direction:ltr;color:#6b7280">' + fmt(taxAmt) + '</td>' +
                                                '</tr>' : '') +
                                                '<tr style="background:#eef2ff;font-weight:800;font-size:0.75rem">' +
                                                    '<td colspan="6" style="padding:4px 5px;text-align:left;color:#1e3a5f">إجمالي الفاتورة</td>' +
                                                    '<td style="padding:4px 5px;text-align:left;direction:ltr;color:#059669">' + fmt(itemTotal + taxAmt - discAmt) + '</td>' +
                                                '</tr>' +
                                            '</tbody></table>' +
                                        '</div>' +
                                    '</td>' +
                                '</tr>';
                            }
                        });
                    }

                    const foot = filteredRows.length > 0
                        ? '<tr style="font-weight:bold;background:#f3f4f6;font-size:0.75rem;border-top:2px solid #d1d5db">' +
                          '<td style="color:#9ca3af;padding:6px 8px">#</td>' +
                          '<td style="text-align:left;color:#6b7280;padding:6px 8px" colspan="2">الافتتاحي: ' + fmt(kpis.opening_balance) + '</td>' +
                          '<td style="color:#6b7280;padding:6px 8px" colspan="2">' + fmtInt(filteredRows.length) + ' حركات</td>' +
                          '<td style="color:#059669;direction:ltr;text-align:right;padding:6px 8px">' + fmt(summary.total_debit) + '</td>' +
                          '<td style="color:#ef4444;direction:ltr;text-align:right;padding:6px 8px">' + fmt(summary.total_credit) + '</td>' +
                          '<td style="font-weight:800;direction:ltr;text-align:right;color:' + balColor(summary.closing_balance) + ';padding:6px 8px">' + fmt(summary.closing_balance) + '</td>' +
                          (showDet ? '<td style="padding:6px 8px"></td>' : '') +
                        '</tr>'
                        : '';

                    // Write table into the table wrapper
                    const wrap = out.querySelector('.stmt-table-wrap');
                    if (wrap) {
                        wrap.innerHTML =
                            '<div class="table-responsive"><table class="report-table">' +
                                '<thead><tr>' + headers.map(h => `<th>${h}</th>`).join('') + '</tr></thead>' +
                                '<tbody>' + bodyHtml + '</tbody>' +
                                (foot ? '<tfoot>' + foot + '</tfoot>' : '') +
                            '</table></div>';
                    }
                }

                renderStmtTable();

                // Scoped event binding
                let searchTimer;
                setTimeout(() => {
                    const inp = out.querySelector('.stmt-search-inp');
                    const cbs = out.querySelectorAll('.stmt-filter-cb');
                    const reset = out.querySelector('.stmt-reset-btn');
                    if (inp) inp.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderStmtTable, 250); });
                    cbs.forEach(cb => cb.addEventListener('change', renderStmtTable));
                    if (reset) reset.addEventListener('click', () => {
                        if (inp) inp.value = '';
                        cbs.forEach(cb => cb.checked = true);
                        renderStmtTable();
                    });
                }, 50);

                // Accordion toggle (scoped)
                out.addEventListener('click', function(e) {
                    const toggle = e.target.closest('.cs-toggle');
                    if (!toggle || toggle.dataset.bound) return;
                    toggle.dataset.bound = '1';
                    const id = toggle.dataset.target;
                    const row = out.querySelector('#' + CSS.escape(id));
                    if (row) {
                        const h = row.style.display === 'none' || !row.style.display;
                        row.style.display = h ? 'table-row' : 'none';
                        toggle.style.transform = h ? 'rotate(180deg)' : 'rotate(0deg)';
                    }
                });

                // Export
                const expRows = allRows.map((row, i) => {
                    const base = [i + 1, row.date || '-', esc(getDocDesc(row)), row.doc_no || '-', esc(row.doc_type_short || row.doc_type || '-'), fmt(row.debit), fmt(row.credit), fmt(row.balance)];
                    if (showDet && row.items && row.items.length > 0) {
                        return row.items.map(it => [...base, esc(it.product_name), esc(it.product_code || ''), fmtInt(it.quantity), esc(it.unit || ''), fmt(it.unit_price), fmt(it.discount), fmt(it.total)]);
                    }
                    return [base];
                }).flat();
                _lastReportData = {
                    title: 'كشف حساب عميل',
                    filters: [
                        { label: 'العميل', value: cust.customer_name },
                        { label: 'الكود', value: cust.customer_code },
                        { label: 'من', value: f.from },
                        { label: 'إلى', value: f.to }
                    ].filter(x => x.value),
                    summary: [
                        { label: 'الرصيد الافتتاحي', value: fmt(kpis.opening_balance) },
                        { label: 'إجمالي المبيعات', value: fmt(kpis.total_sales) },
                        { label: 'إجمالي المرتجعات', value: fmt(kpis.total_returns) },
                        { label: 'إجمالي التحصيلات', value: fmt(kpis.total_collections) },
                        { label: 'الرصيد الختامي', value: fmt(summary.closing_balance) },
                        { label: 'عدد الحركات', value: fmtInt(kpis.transaction_count) },
                    ],
                    columns: showDet
                        ? ['#', 'التاريخ', 'البيان', 'رقم المستند', 'النوع', 'مدين', 'دائن', 'الرصيد', 'المنتج', 'الكود', 'الكمية', 'الوحدة', 'السعر', 'الخصم', 'الإجمالي']
                        : ['#', 'التاريخ', 'البيان', 'رقم المستند', 'النوع', 'مدين', 'دائن', 'الرصيد'],
                    rows: expRows,
                    totals: [
                        { label: 'الافتتاحي', value: fmt(kpis.opening_balance) },
                        { label: 'مدين', value: fmt(summary.total_debit) },
                        { label: 'دائن', value: fmt(summary.total_credit) },
                        { label: 'الختامي', value: fmt(summary.closing_balance) },
                        { label: 'عدد الحركات', value: fmtInt(summary.transaction_count) }
                    ]
                };
            },

            // Skeleton loader
            _renderSkeleton() {
                show('rpt-state-loading');
                const el = document.getElementById('rpt-state-loading');
                if (el) {
                    el.style.display = 'flex';
                    el.style.flexDirection = 'column';
                    el.style.gap = '12px';
                    el.style.padding = '20px';
                    el.innerHTML =
                        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px">' +
                        Array(8).fill('<div style="height:70px;background:linear-gradient(90deg,#e5e7eb 25%,#f3f4f6 50%,#e5e7eb 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;border-radius:8px"></div>').join('') +
                        '</div>' +
                        '<div style="height:20px;width:60%;margin:10px auto;background:linear-gradient(90deg,#e5e7eb 25%,#f3f4f6 50%,#e5e7eb 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;border-radius:4px"></div>' +
                        '<div style="height:200px;background:linear-gradient(90deg,#e5e7eb 25%,#f3f4f6 50%,#e5e7eb 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;border-radius:8px"></div>';
                }
                hide('rpt-state-empty');
                hide('rpt-state-error');
                hide('rpt-rep-statement-area');
                const ou = document.getElementById('rpt-output');
                if (ou) { ou.style.display = 'none'; ou.innerHTML = ''; }
            },async 'sales-by-period'() {
                const f = getFilters();
                const p = new URLSearchParams();
                if (f.from) p.append('from', f.from); if (f.to) p.append('to', f.to);
                if (f.cust) p.append('customer_id', f.cust); if (f.rep) p.append('rep_id', f.rep);
                if (f.store) p.append('store_id', f.store);
                const r = await req(`/reports/sales-by-period?${p.toString()}`);
                if (!r.success) { showError(r.message); return; }
                const data = r.data || [];
                const t = r.totals || {};

                const isSingleCust = !!f.cust;
                const title = isSingleCust ? 'تقرير مبيعات العميل' : 'تقرير مبيعات فترة';

                const headers = ['الفترة', 'العميل', 'عدد الفواتير', 'الكمية', 'الإجمالي', 'الخصم', 'الضريبة', 'صافي'];
                const colCount = headers.length;

                if (data.length === 0) {
                    showEmpty('لا توجد مبيعات للفلاتر المختارة.');
                    _lastReportData = { title, filters: [], columns: headers, rows: [], totals: [] };
                    return;
                }

                const body = data.map(p => `<tr data-period="${p.period||''}" data-customer="${p.customer_id||''}">
                        <td><strong>${p.period || '-'}</strong></td>
                        <td>${p.customer_name || '-'}</td>
                        <td>${fmtInt(p.invoice_count)}</td>
                        <td>${fmtInt(p.sold_qty)}</td>
                        <td>${fmt(p.gross_sales)}</td>
                        <td>${fmt(p.total_discount)}</td>
                        <td>${fmt(p.total_tax)}</td>
                        <td style="font-weight:bold;cursor:pointer" class="rpt-drill-net" data-period="${p.period||''}" data-customer="${p.customer_id||''}">${fmt(p.net_sales)}</td>
                    </tr>`).join('');

                const foot = `<tr style="font-weight:bold;background:var(--bg-body)">
                    <td style="text-align:left">الإجمالي</td>
                    <td>${fmtInt(t.customer_count||0)}</td>
                    <td>${fmtInt(t.invoice_count)}</td>
                    <td>${fmtInt(t.sold_qty)}</td>
                    <td>${fmt(t.gross_sales)}</td>
                    <td>${fmt(t.total_discount)}</td>
                    <td>${fmt(t.total_tax)}</td>
                    <td style="color:#059669">${fmt(t.net_sales)}</td>
                </tr>`;

                clearOutput();
                const out = document.getElementById('rpt-output');
                if (!out) return;
                out.innerHTML =
                    '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;padding:6px 10px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:6px;font-size:0.72rem;color:#374151">' +
                        '<span><span style="color:#6b7280">فترة التقرير:</span> ' + (f.from || '---') + ' → ' + (f.to || '---') + '</span>' +
                        ' <span style="color:#d1d5db">|</span> ' +
                        '<span><span style="color:#6b7280">صافي المبيعات:</span> ' + fmt(t.net_sales) + '</span>' +
                        ' <span style="color:#d1d5db">|</span> ' +
                        '<span><span style="color:#6b7280">عدد الفواتير:</span> ' + fmtInt(t.invoice_count) + '</span>' +
                        ' <span style="color:#d1d5db">|</span> ' +
                        '<span><span style="color:#6b7280">مردودات:</span> ' + fmt(t.return_total) + ' (' + (t.return_rate||0).toFixed(1) + '%)</span>' +
                    '</div>' +
                    '<div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px">' +
                        '<div style="flex:1;min-width:100px;background:#fff;border:1px solid #e5e7eb;border-radius:6px;border-right:3px solid #7c3aed;padding:5px 10px"><div style="font-size:0.65rem;color:#6b7280">إجمالي المبيعات</div><div style="font-size:0.95rem;font-weight:700;color:#1e3a5f;direction:ltr">' + fmt(t.gross_sales) + '</div></div>' +
                        '<div style="flex:1;min-width:80px;background:#fff;border:1px solid #e5e7eb;border-radius:6px;border-right:3px solid #3b82f6;padding:5px 10px"><div style="font-size:0.65rem;color:#6b7280">عدد الفواتير</div><div style="font-size:0.95rem;font-weight:700;color:#1e3a5f;direction:ltr">' + fmtInt(t.invoice_count) + '</div></div>' +
                        '<div style="flex:1;min-width:80px;background:#fff;border:1px solid #e5e7eb;border-radius:6px;border-right:3px solid #059669;padding:5px 10px"><div style="font-size:0.65rem;color:#6b7280">عدد العملاء</div><div style="font-size:0.95rem;font-weight:700;color:#1e3a5f;direction:ltr">' + fmtInt(t.customer_count||0) + '</div></div>' +
                        '<div style="flex:1;min-width:80px;background:#fff;border:1px solid #e5e7eb;border-radius:6px;border-right:3px solid #f59e0b;padding:5px 10px"><div style="font-size:0.65rem;color:#6b7280">إجمالي الكمية</div><div style="font-size:0.95rem;font-weight:700;color:#1e3a5f;direction:ltr">' + fmtInt(t.sold_qty) + '</div></div>' +
                    '</div>' +
                    '<div class="table-responsive"><table class="report-table">' +
                        '<thead><tr>' + headers.map(h => `<th>${h}</th>`).join('') + '</tr></thead>' +
                        '<tbody>' + body + '</tbody>' +
                        '<tfoot>' + foot + '</tfoot>' +
                    '</table></div>';

                // Drill down (scoped to out)
                out.querySelectorAll('.rpt-drill-net').forEach(el => {
                    el.addEventListener('click', async () => {
                        const per = el.dataset.period;
                        const cid = el.dataset.customer;
                        const p = new URLSearchParams();
                        if (per) p.append('from', per);
                        if (per) p.append('to', per);
                        if (cid) p.append('customer_id', cid);
                        p.append('per_page', '50');
                        const resp = await req('/sales/invoices?' + p.toString());
                        const invs = Array.isArray(resp.data) ? resp.data : [];
                        let html = '<div class="drill-modal"><div class="drill-backdrop" onclick="this.parentElement.remove()"></div><div class="drill-content"><button class="drill-close" onclick="this.closest(\'.drill-modal\').remove()">✕</button><h3>فواتير ' + per + '</h3><table class="data-table"><thead><tr><th>رقم الفاتورة</th><th>العميل</th><th>التاريخ</th><th>الصافي</th></tr></thead><tbody>';
                        invs.forEach(inv => {
                            html += '<tr><td>' + (inv.invoice_no||'') + '</td><td>' + (inv.customer_name||inv.customer_id||'') + '</td><td>' + (String(inv.invoice_date||'').slice(0,10)) + '</td><td>' + fmt(inv.grand_total) + '</td></tr>';
                        });
                        if (invs.length === 0) html += '<tr><td colspan="4" style="text-align:center;color:#999">لا توجد فواتير</td></tr>';
                        html += '</tbody></table></div></div>';
                        document.body.insertAdjacentHTML('beforeend', html);
                    });
                });

                _lastReportData = {
                    title,
                    filters: [{ label: 'من تاريخ', value: f.from }, { label: 'إلى تاريخ', value: f.to }, { label: 'العميل', value: f.cust }, { label: 'المندوب', value: f.rep }, { label: 'المخزن', value: f.store }].filter(x => x.value),
                    summary: [{ label: 'عدد الفواتير', value: fmtInt(t.invoice_count) }, { label: 'صافي المبيعات', value: fmt(t.net_sales) }, { label: 'المردودات', value: fmt(t.return_total) }, { label: 'نسبة المرتجع', value: (t.return_rate||0).toFixed(1) + '%' }],
                    columns: headers,
                    rows: data.map(p => [p.period||'-', p.customer_name||'-', fmtInt(p.invoice_count), fmtInt(p.sold_qty), fmt(p.gross_sales), fmt(p.total_discount), fmt(p.total_tax), fmt(p.net_sales)]),
                    totals: [{ label: 'الإجمالي', value: '' }, { label: 'عدد العملاء', value: fmtInt(t.customer_count||0) }, { label: 'الفواتير', value: fmtInt(t.invoice_count) }, { label: 'صافي', value: fmt(t.net_sales) }, { label: 'مردودات', value: fmt(t.return_total) }]
                };
            },
            async 'ar-matching-status'() {
                const f = getFilters();
                const p = new URLSearchParams();
                if (f.from) p.append('from', f.from); if (f.to) p.append('to', f.to);
                if (f.cust) p.append('customer_id', f.cust);
                if (f.matchStatus) p.append('status', f.matchStatus);
                const r = await req(`/reports/ar-matching-status?${p.toString()}`);
                if (!r.success || !r.data) { showError(r.message); return; }
                const data = r.data || [];
                const headers = ['الفاتورة', 'التاريخ', 'العميل', 'الإجمالي', 'المسدد', 'الخصم', 'المتبقي', 'الحالة'];
                const body = data.length === 0
                    ? '<tr><td colspan="8" style="text-align:center;padding:30px;color:#999">لا توجد فواتير</td></tr>'
                    : data.map(i => `<tr>
                        <td>${i.invoice_no}</td>
                        <td>${i.invoice_date}</td>
                        <td>${i.customer_name || '-'}</td>
                        <td>${fmt(i.grand_total)}</td>
                        <td style="color:#059669">${fmt(i.allocated_amount)}</td>
                        <td style="color:#f59e0b">${fmt(i.discount_amount)}</td>
                        <td style="font-weight:bold;color:${i.remaining > 0 ? '#ef4444' : '#333'}">${fmt(i.remaining)}</td>
                        <td><span class="badge" style="background:${i.remaining <= 0 ? '#dcfce7' : '#fee2e2'}">${i.match_status}</span></td>
                    </tr>`).join('');
                const foot = `<tr style="font-weight:bold;background:var(--bg-body)">
                    <td colspan="3" style="text-align:left">الإجمالي</td>
                    <td>${fmt(r.totals.grand_total)}</td>
                    <td style="color:#059669">${fmt(r.totals.allocated)}</td>
                    <td style="color:#f59e0b">${fmt(r.totals.discount)}</td>
                    <td style="color:#ef4444">${fmt(r.totals.remaining)}</td>
                    <td></td>
                </tr>`;
                renderTable(headers, body, foot);
                _lastReportData = {
                    title: 'حالة مطابقة فواتير العملاء',
                    filters: [{ label: 'العميل', value: f.cust }, { label: 'الحالة', value: f.matchStatus }].filter(x => x.value),
                    summary: [{ label: 'عدد', value: data.length }],
                    columns: headers, rows: data.map(i => [i.invoice_no, i.invoice_date, i.customer_name, fmt(i.grand_total), fmt(i.allocated_amount), fmt(i.discount_amount), fmt(i.remaining), i.match_status]),
                    totals: []
                };
            },
            async 'customer-sales-summary'() {
                const f = getFilters();
                const gov = document.getElementById('rpt-governorate')?.value || '';
                const branch = document.getElementById('rpt-branch')?.value || '';
                const custType = document.getElementById('rpt-customer-type')?.value || '';

                const custMulti = document.getElementById('rpt-customer-multi');
                const repMulti = document.getElementById('rpt-rep-multi');

                const custIds = custMulti ? Array.from(custMulti.selectedOptions).map(o => o.value).filter(v => v) : [];
                const repIds = repMulti ? Array.from(repMulti.selectedOptions).map(o => o.value).filter(v => v) : [];

                this._renderSkeleton();

                const govSel = document.getElementById('rpt-governorate');
                if (govSel && govSel.options.length <= 1) {
                    const optRes = await req('/reports/customer-sales-filter-options');
                    if (optRes.success && optRes.data) {
                        const d = optRes.data;
                        (d.governorates || []).forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; govSel.appendChild(o); });
                        const brSel = document.getElementById('rpt-branch');
                        (d.branches || []).forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; brSel.appendChild(o); });
                        const ctSel = document.getElementById('rpt-customer-type');
                        (d.customer_types || []).forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; ctSel.appendChild(o); });
                    }
                }

                const params = new URLSearchParams();
                if (f.from) params.append('from', f.from);
                if (f.to) params.append('to', f.to);
                if (gov) params.append('governorate', gov);
                if (branch) params.append('branch', branch);
                if (custType) params.append('customer_type', custType);
                if (custIds.length) params.append('customer_id', custIds.join(','));
                if (repIds.length) params.append('rep_id', repIds.join(','));
                params.append('sort', 'gross_sales');
                params.append('order', 'desc');

                const r = await req(`/reports/customer-sales-summary?${params.toString()}`);
                if (!r.success || !r.data) { showError(r.message); return; }

                const data = r.data || [];
                const totals = r.totals || {};
                const title = 'ملخص مبيعات العملاء';
                const cnameStr = custMulti && custMulti.selectedOptions.length > 0 ? Array.from(custMulti.selectedOptions).map(o => o.textContent).join(', ') : '';
                const rnameStr = repMulti && repMulti.selectedOptions.length > 0 ? Array.from(repMulti.selectedOptions).map(o => o.textContent).join(', ') : '';

                clearOutput();
                const out = document.getElementById('rpt-output');
                if (!out) return;

                // ── Columns: ERP order per user request ──
                const allColumns = [
                    { key: 'customer_code',       label: 'الكود',        always: true, fmt: 'text' },
                    { key: 'customer_name',       label: 'العميل',       always: true, fmt: 'text' },
                    { key: 'rep_name',            label: 'المندوب',      always: true, fmt: 'text' },
                    { key: 'branch',              label: 'الفرع',        always: true, fmt: 'text' },
                    { key: 'opening_balance',     label: 'أول المدة',    always: true, fmt: 'money' },
                    { key: 'period_gross',        label: 'إجمالي البيع', always: true, fmt: 'money' },
                    { key: 'period_returns',      label: 'المرتجع',      always: true, fmt: 'money' },
                    { key: 'period_discount',     label: 'الخصم',        always: true, fmt: 'money' },
                    { key: 'period_tax',          label: 'الضريبة',      always: true, fmt: 'money' },
                    { key: 'net_sales',           label: 'صافي البيع',   always: true, fmt: 'money' },
                    { key: 'period_collections',  label: 'التحصيل',      always: true, fmt: 'money' },
                    { key: 'closing_balance',     label: 'الرصيد الختامي', always: true, fmt: 'money' },
                    { key: 'balance_type',        label: 'طبيعة الرصيد', always: true, fmt: 'balType' },
                    { key: 'contribution_pct',    label: 'مساهمة %',     fmt: 'pct' },
                    { key: 'period_count',        label: 'فواتير',       fmt: 'int' },
                    { key: 'governorate',         label: 'المحافظة',     fmt: 'text' },
                    { key: 'last_invoice_date',   label: 'آخر فاتورة',   fmt: 'date' },
                    { key: 'last_collection_date',label: 'آخر تحصيل',     fmt: 'date' }
                ];
                const alwaysKeys = ['customer_code','customer_name','rep_name','branch','opening_balance','period_gross','period_returns','period_discount','period_tax','net_sales','period_collections','closing_balance','balance_type'];
                const optCols = allColumns.filter(c => !alwaysKeys.includes(c.key));
                let visibleKeys;
                try { visibleKeys = JSON.parse(sessionStorage.getItem('css_visible_cols') || 'null'); } catch(e) {}
                if (!visibleKeys) visibleKeys = allColumns.filter(c => alwaysKeys.includes(c.key)).map(c => c.key);
                const tableCols = allColumns.filter(c => visibleKeys.includes(c.key));

                // ── Cell rendering ──
                function cellVal(col, row) {
                    const v = row[col.key];
                    if (col.fmt === 'money') {
                        const n = num(v);
                        return '<span style="direction:ltr;display:inline-block;font-weight:' + (n !== 0 ? '600' : '400') + ';color:' + (n > 0 ? '#059669' : n < 0 ? '#ef4444' : '#6b7280') + '">' + fmtPlain(n) + '</span>';
                    }
                    if (col.fmt === 'pct') return '<span style="font-weight:700;color:#059669;direction:ltr;display:inline-block">' + num(v).toFixed(1) + '%</span>';
                    if (col.fmt === 'int') return '<span style="font-weight:600;direction:ltr;display:inline-block">' + fmtInt(num(v)) + '</span>';
                    if (col.fmt === 'date') return v ? '<span style="color:#6b7280;direction:ltr;display:inline-block">' + String(v).slice(0,10) + '</span>' : '<span style="color:#d1d5db">-</span>';
                    if (col.fmt === 'balType') {
                        const isDebit = v === 'مدين';
                        return '<span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:0.6rem;font-weight:700;' + (isDebit ? 'background:#dcfce7;color:#166534' : 'background:#fef2f2;color:#991b1b') + '">' + esc(v || '-') + '</span>';
                    }
                    return esc(v == null ? '-' : v);
                }

                // ── KPI strip (6 only) ──
                const collectRate = num(totals.net_sales) > 0 ? (num(totals.total_collections) / num(totals.net_sales) * 100) : 0;
                const stripItems = [
                    { label: 'الفواتير',  raw: totals.invoice_count,       fmt: 'int' },
                    { label: 'صافي البيع', raw: totals.net_sales,         fmt: 'money' },
                    { label: 'التحصيل',    raw: totals.total_collections,  fmt: 'money' },
                    { label: 'أول المدة',  raw: totals.opening_balance,    fmt: 'money' },
                    { label: 'الرصيد الختامي', raw: totals.closing_balance, fmt: 'money' },
                    { label: 'نسبة التحصيل', raw: collectRate,             fmt: 'pctRaw' }
                ];
                const stripHtml = '<div style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:2px">' +
                    stripItems.map(k => {
                        const v = num(k.raw);
                        let display;
                        if (k.fmt === 'int') display = fmtInt(v);
                        else if (k.fmt === 'pctRaw') display = v.toFixed(1) + '%';
                        else display = fmtPlain(v);
                        const color = k.fmt === 'pctRaw' ? '#7c3aed' : v > 0 ? '#059669' : v < 0 ? '#ef4444' : '#374151';
                        return '<div style="flex:1;min-width:90px;background:#fff;border:1px solid #e5e7eb;border-radius:4px;padding:3px 6px;text-align:center">' +
                            '<div style="font-size:0.5rem;color:#6b7280;font-weight:600;white-space:nowrap">' + k.label + '</div>' +
                            '<div style="font-size:0.85rem;font-weight:800;direction:ltr;color:' + color + ';margin-top:1px">' + display + '</div>' +
                        '</div>';
                    }).join('') +
                '</div>';

                // ── Info line ──
                const infoParts = [];
                if (f.from || f.to) infoParts.push('الفترة: ' + (f.from || '---') + ' → ' + (f.to || '---'));
                if (gov) infoParts.push('محافظة: ' + gov);
                if (branch) infoParts.push('فرع: ' + branch);
                if (custType) infoParts.push('نوع: ' + custType);
                if (cnameStr) infoParts.push('العملاء: ' + cnameStr);
                if (rnameStr) infoParts.push('المندوبين: ' + rnameStr);

                // ── Toolbar (sort | columns | export) ALWAYS above table ──
                const sortOptions = [
                    { value: 'net_sales',         label: 'صافي البيع' },
                    { value: 'period_gross',      label: 'إجمالي البيع' },
                    { value: 'closing_balance',   label: 'الرصيد الختامي' },
                    { value: 'period_collections', label: 'التحصيل' },
                    { value: 'customer_name',     label: 'الاسم' },
                    { value: 'customer_code',     label: 'الكود' },
                    { value: 'period_count',      label: 'عدد الفواتير' }
                ];
                const sortDropdown = '<select id="css-sort-select" style="font-size:0.6rem;padding:2px 5px;border:1px solid #d1d5db;border-radius:3px;background:#fff;font-family:inherit;color:#374151">' +
                    sortOptions.map((s, i) => '<option value="' + s.value + '" ' + (i === 0 ? 'selected' : '') + '>' + s.label + '</option>').join('') +
                '</select>';
                const toolbarHtml = '<div class="no-print" style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-bottom:2px;padding:3px 6px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px">' +
                    '<span style="font-size:0.6rem;color:#64748b;font-weight:600">ترتيب:</span>' + sortDropdown +
                    '<span style="width:1px;height:14px;background:#cbd5e1;margin:0 3px"></span>' +
                    '<button id="css-chart-btn" style="display:inline-flex;align-items:center;gap:2px;padding:2px 8px;font-size:0.6rem;border:1px solid #e2e8f0;border-radius:3px;background:#fff;cursor:pointer;color:#374151;font-weight:600"><i class="fa-solid fa-chart-simple" style="color:#059669;font-size:0.55rem"></i> رسم بياني</button>' +
                    '<span style="width:1px;height:14px;background:#cbd5e1;margin:0 3px"></span>' +
                    '<button id="css-cols-btn" style="display:inline-flex;align-items:center;gap:2px;padding:2px 8px;font-size:0.6rem;border:1px solid #e2e8f0;border-radius:3px;background:#fff;cursor:pointer;color:#374151;font-weight:600"><i class="fa-solid fa-gear" style="font-size:0.55rem;color:#7c3aed"></i> أعمدة</button>' +
                    '<span style="width:1px;height:14px;background:#cbd5e1;margin:0 3px"></span>' +
                    '<button class="css-exp-btn" data-action="excel" style="display:inline-flex;align-items:center;gap:2px;padding:2px 6px;font-size:0.6rem;border:1px solid #e2e8f0;border-radius:3px;background:#fff;cursor:pointer;color:#059669;font-weight:600"><i class="fa-solid fa-file-excel" style="font-size:0.55rem"></i> Excel</button>' +
                    '<button class="css-exp-btn" data-action="pdf" style="display:inline-flex;align-items:center;gap:2px;padding:2px 6px;font-size:0.6rem;border:1px solid #e2e8f0;border-radius:3px;background:#fff;cursor:pointer;color:#dc2626;font-weight:600"><i class="fa-solid fa-file-pdf" style="font-size:0.55rem"></i> PDF</button>' +
                    '<button class="css-exp-btn" data-action="print" style="display:inline-flex;align-items:center;gap:2px;padding:2px 6px;font-size:0.6rem;border:1px solid #e2e8f0;border-radius:3px;background:#fff;cursor:pointer;color:#374151;font-weight:600"><i class="fa-solid fa-print" style="font-size:0.55rem"></i> طباعة</button>' +
                '</div>';

                // ── Chart (collapsible, BELOW toolbar) ──
                const top10 = [...data].sort((a, b) => num(b.net_sales) - num(a.net_sales)).slice(0, 10);
                const chartWrapHtml = '<div id="css-chart-wrap" style="display:none;margin-bottom:2px;background:#fff;border:1px solid #e2e8f0;border-radius:4px;padding:4px 8px 6px"><canvas id="css-chart" style="height:140px;width:100%"></canvas></div>';

                // ── Table ──
                function fmtEmptyRow(cols) { return '<tr><td colspan="' + cols + '" style="text-align:center;padding:30px;color:#9ca3af;font-size:0.85rem">لا توجد بيانات</td></tr>'; }

                const bodyHtml = data.length === 0
                    ? fmtEmptyRow(tableCols.length)
                    : data.map((r, ri) =>
                        '<tr class="css-cust-row" data-index="' + ri + '" data-cust-id="' + r.id + '" data-cust-name="' + esc(r.customer_name) + '" style="background:' + (ri % 2 === 0 ? '#fff' : '#f8fafc') + '">' +
                            tableCols.map((c, ci) => {
                                let val = c.key === 'customer_code'
                                    ? '<span style="font-weight:700;color:#1e3a5f;direction:ltr;display:inline-block">' + esc(r.customer_code) + '</span>'
                                    : c.key === 'customer_name'
                                    ? '<span style="font-weight:700;color:#111827">' + esc(r.customer_name) + '</span> <span class="css-drill-icon" style="cursor:pointer;font-size:0.5rem;color:#7c3aed;margin-right:2px">▶</span>'
                                    : cellVal(c, r);
                                let align = (c.fmt === 'money' || c.fmt === 'pct' || c.fmt === 'int') ? 'text-align:end;direction:ltr' : 'text-align:start';
                                let sticky = ci < 2 ? 'position:sticky;z-index:1;' + (ci === 0 ? 'left:0;' : 'left:40px;') + 'background:inherit' : '';
                                return '<td style="padding:3px 5px;font-size:0.68rem;white-space:nowrap;border-bottom:1px solid #f1f5f9;' + align + ';' + sticky + '">' + val + '</td>';
                            }).join('') +
                        '</tr>'
                      ).join('');

                // ── Footer ──
                const footMap = {
                    customer_code: '', customer_name: 'الإجمالي',
                    rep_name: '', branch: '',
                    opening_balance: fmtPlain(totals.opening_balance),
                    period_gross: fmtPlain(totals.gross_sales),
                    period_returns: fmtPlain(totals.return_total), period_discount: fmtPlain(totals.discount_amount),
                    period_tax: fmtPlain(totals.tax_amount), net_sales: fmtPlain(totals.net_sales),
                    period_collections: fmtPlain(totals.total_collections),
                    closing_balance: fmtPlain(totals.closing_balance),
                    balance_type: '',
                    contribution_pct: '100%', period_count: fmtInt(totals.invoice_count),
                    last_invoice_date: '', last_collection_date: '', governorate: ''
                };
                const footHtml = data.length === 0 ? '' :
                    '<tr style="font-weight:800;background:#eef2ff;border-top:3px solid #7c3aed;color:#1e3a5f">' +
                        tableCols.map(c => '<td style="padding:6px 8px;font-size:0.75rem;white-space:nowrap">' + (footMap[c.key] || '—') + '</td>').join('') +
                    '</tr>';

                // ── Assemble (compact ERP layout) ──
                out.style.display = 'flex';
                out.style.flexDirection = 'column';
                out.style.flex = '1';
                out.style.minHeight = '0';
                out.innerHTML =
                    '<div style="margin-bottom:2px;display:flex;align-items:center;justify-content:space-between">' +
                        '<span style="font-size:0.8rem;font-weight:800;color:#1e3a5f">' + title + '</span>' +
                        '<span style="font-size:0.5rem;color:#94a3b8">' + infoParts.join(' | ') + '</span>' +
                    '</div>' +
                    stripHtml +
                    toolbarHtml +
                    chartWrapHtml +
                    '<div style="flex:1;overflow:auto;border:1px solid #e2e8f0;border-radius:4px;min-height:0">' +
                        '<table class="report-table" id="css-table" style="font-size:0.72rem;width:100%;border-collapse:separate;border-spacing:0">' +
                            '<thead><tr>' + tableCols.map((c, ci) => {
                                let sticky = ci < 2 ? 'position:sticky;z-index:3;' + (ci === 0 ? 'left:0;' : 'left:40px;') : '';
                                return '<th style="position:sticky;top:0;z-index:2;background:#1e3a5f;color:#fff;font-size:0.6rem;padding:5px 5px;white-space:nowrap;border-bottom:2px solid #2d4a7a;' + sticky + '">' + c.label + '</th>';
                            }).join('') + '</tr></thead>' +
                            '<tbody>' + bodyHtml + '</tbody>' +
                            '<tfoot>' + footHtml + '</tfoot>' +
                        '</table>' +
                    '</div>';

                // ── Chart toggle ──
                const chartBtn = out.querySelector('#css-chart-btn');
                const chartWrap = out.querySelector('#css-chart-wrap');
                let chartInitialized = false;
                if (chartBtn && chartWrap) {
                    chartBtn.addEventListener('click', function() {
                        const isVisible = chartWrap.style.display !== 'none';
                        if (isVisible) {
                            chartWrap.style.display = 'none';
                            this.innerHTML = '<i class="fa-solid fa-chart-simple" style="color:#059669;font-size:0.6rem"></i> رسم بياني';
                        } else {
                            chartWrap.style.display = 'block';
                            this.innerHTML = '<i class="fa-solid fa-chart-simple" style="color:#059669;font-size:0.6rem"></i> إخفاء الرسم البياني';
                            if (!chartInitialized) {
                                chartInitialized = true;
                                setTimeout(function() {
                                    const canvas = out.querySelector('#css-chart');
                                    if (!canvas || top10.length === 0) return;
                                    const ctx = canvas.getContext('2d');
                                    canvas.style.width = '100%'; canvas.style.height = '160px';
                                    const labels = top10.map(r => r.customer_name ? r.customer_name.substring(0, 15) : '?');
                                    const vals = top10.map(r => num(r.net_sales));
                                    if (window._cssChart) window._cssChart.destroy();
                                    window._cssChart = new Chart(ctx, {
                                        type: 'bar',
                                        data: { labels, datasets: [{ label: 'صافي المبيعات', data: vals, backgroundColor: 'rgba(124,58,237,0.55)', borderColor: '#7c3aed', borderWidth: 1, borderRadius: 4 }] },
                                        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtPlain(ctx.raw) } } }, scales: { y: { beginAtZero: true, ticks: { callback: v => fmtPlain(v), font: { size: 9 } } }, x: { ticks: { font: { size: 8 } } } } }
                                    });
                                }, 100);
                            }
                        }
                    });
                }

                // ── Sort via dropdown ──
                const sortSelect = out.querySelector('#css-sort-select');
                if (sortSelect) {
                    sortSelect.addEventListener('change', function() {
                        params.set('sort', this.value);
                        params.set('order', this.value === 'customer_name' || this.value === 'customer_code' ? 'asc' : 'desc');
                        (async () => {
                            const r2 = await req('/reports/customer-sales-summary?' + params.toString());
                            if (!r2.success || !r2.data) return;
                            const d2 = r2.data || []; const t2 = r2.totals || {};
                            const top10_2 = [...d2].sort((a, b) => num(b.net_sales) - num(a.net_sales)).slice(0, 10);
                            const tb = out.querySelector('#css-table tbody');
                            const tf = out.querySelector('#css-table tfoot');
                            if (tb) tb.innerHTML = d2.length === 0 ? fmtEmptyRow(tableCols.length) : d2.map(rr =>
                                '<tr class="css-cust-row" data-cust-id="' + rr.id + '" data-cust-name="' + esc(rr.customer_name) + '">' +
                                    '<td style="padding:3px 5px;font-size:0.65rem;white-space:nowrap"><span class="css-drill-icon">▶</span>' + esc(rr.customer_code) + '</td>' +
                                    tableCols.slice(1).map(c => '<td style="padding:3px 5px;font-size:0.65rem;white-space:nowrap">' + cellVal(c, rr) + '</td>').join('') +
                                '</tr>'
                            ).join('');
                            if (tf) tf.innerHTML = d2.length === 0 ? '' :
                                '<tr style="font-weight:700;background:#f3f4f6;border-top:2px solid #d1d5db">' +
                                    tableCols.map(c => '<td style="padding:3px 6px;font-size:0.65rem;color:#1e3a5f;white-space:nowrap">' + (footMap[c.key] || '—') + '</td>').join('') +
                                '</tr>';
                            if (window._cssChart && top10_2.length > 0) {
                                window._cssChart.data.labels = top10_2.map(r => r.customer_name ? r.customer_name.substring(0, 12) : '?');
                                window._cssChart.data.datasets[0].data = top10_2.map(r => num(r.net_sales));
                                window._cssChart.update();
                            }
                        })();
                    });
                }

                // ── Column customization popup ──
                const colsBtn = out.querySelector('#css-cols-btn');
                if (colsBtn) {
                    colsBtn.addEventListener('click', function() {
                        const existing = document.getElementById('css-cols-popup');
                        if (existing) { existing.remove(); return; }
                        const overlay = document.createElement('div');
                        overlay.id = 'css-cols-popup';
                        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99998;background:rgba(0,0,0,0.2);display:flex;align-items:center;justify-content:center';
                        overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
                        const popup = document.createElement('div');
                        popup.style.cssText = 'background:#fff;border-radius:8px;padding:12px;min-width:220px;max-height:80vh;overflow-y:auto;box-shadow:0 12px 40px rgba(0,0,0,0.15);direction:rtl';
                        let html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #e5e7eb">' +
                            '<span style="font-size:0.75rem;font-weight:700;color:#1e3a5f">تخصيص الأعمدة</span>' +
                            '<button id="css-cols-close" style="background:none;border:none;cursor:pointer;font-size:0.75rem;color:#9ca3af">✕</button>' +
                        '</div>';
                        html += '<div style="display:flex;flex-direction:column;gap:3px">';
                        allColumns.forEach(c => {
                            const checked = visibleKeys.includes(c.key);
                            const always = alwaysKeys.includes(c.key);
                            html += '<label style="display:flex;align-items:center;gap:5px;padding:4px 6px;border-radius:4px;cursor:pointer;font-size:0.65rem;' + (checked ? 'background:#eef2ff;color:#4338ca;font-weight:600' : '') + '">' +
                                '<input type="checkbox" class="css-col-cb" data-key="' + c.key + '" ' + (checked ? 'checked' : '') + (always ? ' disabled' : '') + ' style="margin:0;width:13px;height:13px;accent-color:#7c3aed"> ' +
                                c.label + (always ? ' <span style="color:#9ca3af;font-size:0.5rem">(أساسي)</span>' : '') +
                            '</label>';
                        });
                        html += '</div>';
                        html += '<div style="margin-top:8px;padding-top:6px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between">' +
                            '<button id="css-cols-reset" style="padding:3px 10px;font-size:0.6rem;border:1px solid #e5e7eb;border-radius:4px;background:#fff;cursor:pointer;color:#6b7280">إعادة تعيين</button>' +
                            '<button id="css-cols-apply" style="padding:3px 12px;font-size:0.6rem;border:none;border-radius:4px;background:#7c3aed;cursor:pointer;color:#fff;font-weight:600">تطبيق</button>' +
                        '</div>';
                        popup.innerHTML = html;
                        overlay.appendChild(popup);
                        document.body.appendChild(overlay);
                        overlay.querySelector('#css-cols-close').addEventListener('click', () => overlay.remove());
                        overlay.querySelector('#css-cols-apply').addEventListener('click', () => {
                            const newKeys = [];
                            overlay.querySelectorAll('.css-col-cb').forEach(cb => {
                                if (cb.checked || cb.disabled) newKeys.push(cb.dataset.key);
                            });
                            visibleKeys = newKeys;
                            sessionStorage.setItem('css_visible_cols', JSON.stringify(visibleKeys));
                            applyColumns();
                            overlay.remove();
                        });
                        overlay.querySelector('#css-cols-reset').addEventListener('click', () => {
                            visibleKeys = allColumns.filter(c => alwaysKeys.includes(c.key)).map(c => c.key);
                            sessionStorage.setItem('css_visible_cols', JSON.stringify(visibleKeys));
                            applyColumns();
                            overlay.remove();
                        });
                        function applyColumns() {
                            const newCols = allColumns.filter(c => visibleKeys.includes(c.key));
                            const th = out.querySelector('#css-table thead');
                            const tb = out.querySelector('#css-table tbody');
                            const tf = out.querySelector('#css-table tfoot');
                            if (th) th.innerHTML = '<tr>' + newCols.map(c => '<th style="font-size:0.6rem;padding:4px 5px;white-space:nowrap">' + c.label + '</th>').join('') + '</tr>';
                            if (tb) tb.innerHTML = data.length === 0 ? fmtEmptyRow(newCols.length) : data.map(rr =>
                                '<tr class="css-cust-row" data-cust-id="' + rr.id + '" data-cust-name="' + esc(rr.customer_name) + '">' +
                                    '<td style="padding:3px 5px;font-size:0.65rem;white-space:nowrap"><span class="css-drill-icon">▶</span>' + esc(rr.customer_code) + '</td>' +
                                    newCols.slice(1).map(c => '<td style="padding:3px 5px;font-size:0.65rem;white-space:nowrap">' + cellVal(c, rr) + '</td>').join('') +
                                '</tr>'
                            ).join('');
                            if (tf) tf.innerHTML = data.length === 0 ? '' :
                                '<tr style="font-weight:700;background:#f3f4f6;border-top:2px solid #d1d5db">' +
                                    newCols.map(c => '<td style="padding:3px 6px;font-size:0.65rem;color:#1e3a5f;white-space:nowrap">' + (footMap[c.key] || '—') + '</td>').join('') +
                                '</tr>';
                        }
                    });
                }

                // ── Drill-down ──
                let _invCache = {}, _itemCache = {};
                out.addEventListener('click', async function(e) {
                    const drillIcon = e.target.closest('.css-drill-icon');
                    if (!drillIcon) return;
                    const row = drillIcon.closest('.css-cust-row');
                    if (!row) return;
                    const cid = row.dataset.custId;
                    const cname = row.dataset.custName;
                    if (!cid) return;
                    e.stopPropagation();

                    let detailRow = row.nextElementSibling;
                    if (detailRow && detailRow.classList.contains('css-inv-detail')) {
                        if (drillIcon.classList.contains('open')) {
                            drillIcon.classList.remove('open'); drillIcon.textContent = '▶';
                            row.classList.remove('css-drill-active'); detailRow.style.display = 'none';
                        } else {
                            drillIcon.classList.add('open'); drillIcon.textContent = '▼';
                            row.classList.add('css-drill-active'); detailRow.style.display = 'table-row';
                        }
                        return;
                    }
                    drillIcon.classList.add('open'); drillIcon.textContent = '▼';
                    row.classList.add('css-drill-active');
                    detailRow = document.createElement('tr');
                    detailRow.className = 'css-inv-detail';
                    detailRow.style.display = 'none';
                    detailRow.innerHTML = '<td colspan="' + tableCols.length + '" style="padding:0;border:none"><div style="padding:6px 10px"><div style="text-align:center;padding:6px;color:#6b7280;font-size:0.68rem"><i class="fa-solid fa-spinner fa-spin"></i> جاري تحميل الفواتير...</div></div></td>';
                    row.insertAdjacentElement('afterend', detailRow);
                    detailRow.style.display = 'table-row';

                    try {
                        const invParams = new URLSearchParams({ customer_id: cid, per_page: '100' });
                        if (f.from) invParams.append('from', f.from); if (f.to) invParams.append('to', f.to);
                        const cacheKey = cid + '|' + (f.from||'') + '|' + (f.to||'');
                        let invs;
                        if (_invCache[cacheKey]) { invs = _invCache[cacheKey]; }
                        else {
                            const invRes = await req('/sales/invoices?' + invParams.toString());
                            invs = (invRes.success ? invRes.data : []) || [];
                            _invCache[cacheKey] = invs;
                        }
                        if (invs.length === 0) {
                            detailRow.innerHTML = '<td colspan="' + tableCols.length + '" style="padding:10px;text-align:center;color:#9ca3af;font-size:0.68rem;background:#f8faff">لا توجد فواتير للعميل ' + esc(cname) + '</td>';
                            return;
                        }
                        let invHtml = '<div style="padding:3px">';
                        invHtml += '<div style="display:flex;align-items:center;gap:4px;margin-bottom:2px;padding:2px 8px;background:#eef2ff;border-radius:4px;font-size:0.62rem;color:#4f46e5;font-weight:600"> فواتير ' + esc(cname) + ' (' + invs.length + ')</div>';
                        invHtml += '<table style="width:100%;border-collapse:collapse;font-size:0.6rem">';
                        invHtml += '<thead><tr style="background:#f1f5f9;color:#64748b;font-size:0.58rem"><th style="padding:2px 4px;text-align:right">رقم الفاتورة</th><th style="padding:2px 4px;text-align:right">التاريخ</th><th style="padding:2px 4px;text-align:left">الإجمالي</th><th style="padding:2px 4px;text-align:left">المدفوع</th><th style="padding:2px 4px;text-align:left">المتبقي</th><th style="padding:2px 4px;text-align:center">الحالة</th><th style="padding:2px 4px;text-align:center"></th></tr></thead><tbody>';
                        invs.forEach(inv => {
                            const sc = { paid: '#059669', partial: '#f59e0b', pending: '#ef4444' }[inv.status] || '#6b7280';
                            const sl = { paid: 'مدفوعة', partial: 'جزئي', pending: 'معلق' }[inv.status] || inv.status;
                            invHtml += '<tr class="css-inv-row" data-inv-id="' + inv.id + '" style="border-bottom:1px solid #f3f4f6;cursor:pointer">' +
                                '<td style="padding:1px 4px;font-weight:600">' + esc(inv.invoice_no) + '</td>' +
                                '<td style="padding:1px 4px;color:#6b7280">' + (inv.invoice_date ? String(inv.invoice_date).slice(0,10) : '-') + '</td>' +
                                '<td style="padding:1px 4px;direction:ltr;text-align:left;font-weight:600">' + fmtPlain(inv.grand_total) + '</td>' +
                                '<td style="padding:1px 4px;direction:ltr;text-align:left;color:#059669">' + fmtPlain(inv.amount_paid) + '</td>' +
                                '<td style="padding:1px 4px;direction:ltr;text-align:left;color:' + (num(inv.remaining) > 0 ? '#ef4444' : '#9ca3af') + '">' + fmtPlain(inv.remaining) + '</td>' +
                                '<td style="padding:1px 4px;text-align:center"><span style="display:inline-block;padding:0 5px;border-radius:7px;font-size:0.55rem;font-weight:600;background:' + sc + '20;color:' + sc + '">' + sl + '</span></td>' +
                                '<td style="padding:1px 4px;text-align:center;color:#9ca3af;font-size:0.45rem"><i class="fa-solid fa-chevron-down"></i></td>' +
                            '</tr>';
                        });
                        invHtml += '</tbody></table></div>';
                        detailRow.innerHTML = '<td colspan="' + tableCols.length + '" style="padding:0;border:none;background:#f8faff">' + invHtml + '</td>';

                        detailRow.querySelectorAll('.css-inv-row').forEach(invRow => {
                            invRow.addEventListener('click', async function(ev) {
                                const invId = this.dataset.invId;
                                const existingDetail = this.nextElementSibling;
                                if (existingDetail && existingDetail.classList.contains('css-item-detail')) {
                                    existingDetail.style.display = existingDetail.style.display === 'none' ? 'table-row' : 'none';
                                    return;
                                }
                                const itemDetailRow = document.createElement('tr');
                                itemDetailRow.className = 'css-item-detail';
                                itemDetailRow.style.display = 'none';
                                itemDetailRow.innerHTML = '<td colspan="7" style="padding:0;border:none;background:#fff"><div style="padding:3px 10px 3px 20px"><div style="text-align:center;padding:4px;color:#6b7280;font-size:0.65rem"><i class="fa-solid fa-spinner fa-spin"></i> جاري التحميل...</div></div></td>';
                                this.insertAdjacentElement('afterend', itemDetailRow);
                                itemDetailRow.style.display = 'table-row';
                                try {
                                    let items;
                                    if (_itemCache[invId]) { items = _itemCache[invId]; }
                                    else {
                                        const itemRes = await req('/sales/invoices/' + invId);
                                        items = (itemRes.success && itemRes.data && itemRes.data.items) ? itemRes.data.items : [];
                                        _itemCache[invId] = items;
                                    }
                                    if (items.length === 0) { itemDetailRow.innerHTML = '<td colspan="7" style="padding:4px;text-align:center;color:#9ca3af;font-size:0.62rem;background:#fff">لا توجد أصناف</td>'; return; }
                                    let itemHtml = '<table style="width:100%;border-collapse:collapse;font-size:0.58rem">';
                                    itemHtml += '<thead><tr style="background:#f8fafc;color:#64748b"><th style="padding:1px 4px;text-align:right">المنتج</th><th style="padding:1px 4px;text-align:center">الكمية</th><th style="padding:1px 4px;text-align:left">السعر</th><th style="padding:1px 4px;text-align:left">الخصم</th><th style="padding:1px 4px;text-align:left">الإجمالي</th></tr></thead><tbody>';
                                    items.forEach(it => {
                                        itemHtml += '<tr style="border-bottom:1px solid #f8fafc">' +
                                            '<td style="padding:1px 4px">' + esc(it.product_name || '') + '</td>' +
                                            '<td style="padding:1px 4px;text-align:center">' + fmtInt(it.quantity) + '</td>' +
                                            '<td style="padding:1px 4px;text-align:left;direction:ltr">' + fmtPlain(it.unit_price) + '</td>' +
                                            '<td style="padding:1px 4px;text-align:left;direction:ltr">' + fmtPlain(it.discount_amount || 0) + '</td>' +
                                            '<td style="padding:1px 4px;text-align:left;direction:ltr;font-weight:600">' + fmtPlain(it.line_total) + '</td>' +
                                        '</tr>';
                                    });
                                    itemHtml += '</tbody></table>';
                                    itemDetailRow.innerHTML = '<td colspan="7" style="padding:0;border:none;background:#fff"><div style="padding:3px 10px 3px 20px">' + itemHtml + '</div></td>';
                                } catch(err) {
                                    itemDetailRow.innerHTML = '<td colspan="7" style="padding:4px;text-align:center;color:#ef4444;font-size:0.62rem;background:#fff">خطأ في تحميل الأصناف</td>';
                                }
                            });
                        });
                    } catch(err) {
                        detailRow.innerHTML = '<td colspan="' + tableCols.length + '" style="padding:8px;text-align:center;color:#ef4444;font-size:0.68rem;background:#f8faff">خطأ في تحميل الفواتير</td>';
                    }
                });

                // ── Export / Print buttons ──
                out.querySelectorAll('.css-exp-btn').forEach(btn => {
                    btn.addEventListener('click', function() {
                        const action = this.dataset.action;
                        if (action === 'print') {
                            const printHtml =
                                '<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>' + title + '</title>' +
                                '<style>body{font-family:Cairo,sans-serif;padding:10px;font-size:12px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:4px 6px;text-align:right}th{background:#f3f4f6;font-weight:700}@media print{@page{size:landscape;margin:8mm}}</style></head><body>' +
                                '<h3 style="text-align:center;margin-bottom:5px">' + title + '</h3>' +
                                '<p style="text-align:center;color:#666;font-size:11px">' + infoParts.join(' | ') + '</p>' +
                                '<table><thead><tr>' + tableCols.map(c => '<th>' + c.label + '</th>').join('') + '</tr></thead><tbody>' +
                                data.map(r => '<tr>' + tableCols.map(c => '<td>' + cellVal(c, r).replace(/<[^>]+>/g, '') + '</td>').join('') + '</tr>').join('') +
                                '</tbody></table></body></html>';
                            const w = window.open('', '_blank');
                            if (w) { w.document.write(printHtml); w.document.close(); setTimeout(() => w.print(), 500); }
                            return;
                        }
                        if (action === 'excel') {
                            let csv = tableCols.map(c => c.label).join(',') + '\n';
                            data.forEach(r => {
                                csv += tableCols.map(c => {
                                    const v = r[c.key];
                                    if (c.fmt === 'money') return fmtPlain(num(v));
                                    if (c.fmt === 'pct') return num(v).toFixed(1) + '%';
                                    if (c.fmt === 'int') return fmtInt(num(v));
                                    if (c.fmt === 'date') return v ? String(v).slice(0,10) : '';
                                    return v == null ? '' : String(v).replace(/,/g, ' ');
                                }).join(',') + '\n';
                            });
                            const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
                            const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = title + '.csv'; a.click();
                            return;
                        }
                        if (action === 'pdf') {
                            const printHtml =
                                '<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>' + title + '</title>' +
                                '<style>body{font-family:Cairo,sans-serif;padding:10px;font-size:12px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:4px 6px;text-align:right}th{background:#f3f4f6;font-weight:700}@media print{@page{size:landscape;margin:8mm}}</style></head><body>' +
                                '<h3 style="text-align:center;margin-bottom:5px">' + title + '</h3>' +
                                '<p style="text-align:center;color:#666;font-size:11px">' + infoParts.join(' | ') + '</p>' +
                                '<table><thead><tr>' + tableCols.map(c => '<th>' + c.label + '</th>').join('') + '</tr></thead><tbody>' +
                                data.map(r => '<tr>' + tableCols.map(c => '<td>' + cellVal(c, r).replace(/<[^>]+>/g, '') + '</td>').join('') + '</tr>').join('') +
                                '</tbody></table></body></html>';
                            const w = window.open('', '_blank');
                            if (w) { w.document.write(printHtml); w.document.close(); setTimeout(() => { w.focus(); w.print(); }, 500); }
                        }
                    });
                });

                // ── Store for print engine ──
                _lastReportData = {
                    title,
                    filters: [{ label: 'من تاريخ', value: f.from }, { label: 'إلى تاريخ', value: f.to }, { label: 'المحافظة', value: gov }, { label: 'الفرع', value: branch }, { label: 'نوع العميل', value: custType }].filter(x => x.value),
                    summary: stripItems.map(k => {
                        let val;
                        if (k.fmt === 'int') val = fmtInt(num(k.raw));
                        else if (k.fmt === 'pctRaw') val = num(k.raw).toFixed(1) + '%';
                        else val = fmtPlain(num(k.raw));
                        return { label: k.label, value: val };
                    }),
                    columns: tableCols.map(c => c.label),
                    rows: data.map(r => tableCols.map(c => {
                        if (c.fmt === 'money') return fmtPlain(num(r[c.key]));
                        if (c.fmt === 'pct') return num(r[c.key]).toFixed(1) + '%';
                        if (c.fmt === 'int') return fmtInt(num(r[c.key]));
                        if (c.fmt === 'date') return r[c.key] ? String(r[c.key]).slice(0,10) : '-';
                        return r[c.key] == null ? '-' : r[c.key];
                    })),
                    totals: [
                        { label: 'عدد العملاء', value: fmtInt(data.length) },
                        { label: 'عدد الفواتير', value: fmtInt(totals.invoice_count) },
                        { label: 'إجمالي البيع', value: fmtPlain(totals.gross_sales) },
                        { label: 'إجمالي المرتجع', value: fmtPlain(totals.return_total) },
                        { label: 'إجمالي الخصم', value: fmtPlain(totals.discount_amount) },
                        { label: 'إجمالي الضريبة', value: fmtPlain(totals.tax_amount) },
                        { label: 'صافي البيع', value: fmtPlain(totals.net_sales) },
                        { label: 'إجمالي التحصيل', value: fmtPlain(totals.total_collections) },
                        { label: 'الرصيد النهائي', value: fmtPlain(totals.closing_balance) }
                    ]
                };
            },
            async 'product-sales'() {
                const f = getFilters();
                const p = new URLSearchParams({ per_page: '100' });
                if (f.from) p.append('from', f.from); if (f.to) p.append('to', f.to);
                if (f.store) p.append('store_id', f.store);
                const r = await req(`/reports/product-sales?${p.toString()}`);
                if (!r.success) { showError(r.message); return; }
                const data = r.data || [];
                const headers = ['#', 'كود الصنف', 'اسم الصنف', 'الوحدة', 'الكمية المباعة', 'المرتجع', 'صافي', 'قيمة المبيعات', 'المخزون'];
                const body = data.length === 0
                    ? '<tr><td colspan="9" style="text-align:center;padding:30px;color:#999">لا توجد مبيعات للأصناف</td></tr>'
                    : data.map((p, i) => `<tr>
                        <td>${i+1}</td>
                        <td>${p.product_code || '-'}</td>
                        <td><strong>${p.product_name || '-'}</strong></td>
                        <td>${p.unit_name || '-'}</td>
                        <td>${fmtInt(p.sold_qty)}</td>
                        <td>${fmtInt(p.returned_qty)}</td>
                        <td>${fmtInt(p.net_qty)}</td>
                        <td>${fmt(p.sales_value)}</td>
                        <td>${fmtInt(p.inventory)}</td>
                    </tr>`).join('');
                renderTable(headers, body);
                _lastReportData = {
                    title: 'تقرير مبيعات الأصناف',
                    filters: [{ label: 'من تاريخ', value: f.from }, { label: 'إلى تاريخ', value: f.to }, { label: 'المخزن', value: f.store }].filter(x => x.value),
                    summary: [{ label: 'عدد الأصناف', value: fmtInt(data.length) }],
                    columns: headers, rows: data.map((p, i) => [i+1, p.product_code||'-', p.product_name||'-', p.unit_name||'-', fmtInt(p.sold_qty), fmtInt(p.returned_qty), fmtInt(p.net_qty), fmt(p.sales_value), fmtInt(p.inventory)]),
                    totals: []
                };
            },
            async vat() {
                const f = getFilters();
                const r = await req(`/reports/vat-report?from=${f.from}&to=${f.to}`);
                if (!r.success) { showError(r.message); return; }
                const data = r.data || [];
                const t = r.totals || {};
                const a = r.accounting_validation || {};
                const headers = ['نسبة VAT', 'عدد الفواتير', 'المبيعات الخاضعة', 'VAT المحصل', 'عدد المرتجعات', 'المرتجعات الخاضعة', 'VAT المرتجع', 'صافي VAT'];
                const body = data.length === 0
                    ? '<tr><td colspan="8" style="text-align:center;padding:30px;color:#999">لا توجد معاملات ضريبية</td></tr>'
                    : data.map(g => `<tr>
                        <td><strong>${g.vat_rate}%</strong></td>
                        <td>${fmtInt(g.invoice_count)}</td>
                        <td>${fmt(g.taxable_sales)}</td>
                        <td style="font-weight:bold;color:#059669">${fmt(g.vat_collected)}</td>
                        <td>${fmtInt(g.return_count)}</td>
                        <td>${fmt(g.taxable_returns)}</td>
                        <td style="font-weight:bold;color:#ef4444">${fmt(g.vat_reversed)}</td>
                        <td style="font-weight:bold;color:#8b5cf6">${fmt(g.vat_collected - g.vat_reversed)}</td>
                    </tr>`).join('');
                const foot = `<tr style="font-weight:bold;background:var(--bg-body)">
                    <td style="text-align:left">الإجمالي</td>
                    <td colspan="2">خاضع: ${fmt(t.taxable_sales)}</td>
                    <td style="color:#059669">${fmt(t.vat_collected)}</td>
                    <td colspan="2">مرتجع: ${fmt(t.taxable_returns)}</td>
                    <td style="color:#ef4444">${fmt(t.vat_reversed)}</td>
                    <td style="color:#8b5cf6">${fmt(t.net_vat)}</td>
                </tr>
                <tr style="background:#fef3c7;font-size:12px">
                    <td colspan="8" style="text-align:center">
                        مطابقة محاسبية: ${a.reconciled ? '✅ متطابقة' : '❌ غير متطابقة'} |
                        المحصل محاسبي: ${fmt(a.vat_collected_accounting)} | تشغيلي: ${fmt(a.vat_collected_operational)}
                    </td>
                </tr>`;
                renderTable(headers, body, foot);
                _lastReportData = {
                    title: 'تقرير VAT',
                    filters: [{ label: 'من تاريخ', value: f.from }, { label: 'إلى تاريخ', value: f.to }].filter(x => x.value),
                    summary: [{ label: 'إجمالي VAT محصل', value: fmt(t.vat_collected) }, { label: 'إجمالي VAT مرتجع', value: fmt(t.vat_reversed) }, { label: 'صافي VAT', value: fmt(t.net_vat) }],
                    columns: headers, rows: data.map(g => [g.vat_rate+'%', fmtInt(g.invoice_count), fmt(g.taxable_sales), fmt(g.vat_collected), fmtInt(g.return_count), fmt(g.taxable_returns), fmt(g.vat_reversed), fmt(g.vat_collected - g.vat_reversed)]),
                    totals: [{ label: 'صافي VAT', value: fmt(t.net_vat) }, { label: 'حالة المطابقة', value: a.reconciled ? 'متطابقة' : 'غير متطابقة' }]
                };
            },
            async receivables() {
                const r = await req('/reports/receivables');
                if (!r.success) { showError(r.message); return; }
                const data = r.data || [];
                const t = r.totals || {};
                const headers = ['#', 'العميل', 'الرصيد', 'الحد الائتماني', 'المتاح', 'أيام', '0-30', '31-60', '61-90', '91-120', '120+', 'الاستخدام%'];
                function ageColor(v) { return v > 0 ? 'color:#ef4444;font-weight:bold' : ''; }
                const body = data.length === 0
                    ? '<tr><td colspan="12" style="text-align:center;padding:30px;color:#999">لا توجد ذمم مدينة</td></tr>'
                    : data.map((c, i) => `<tr>
                        <td>${i+1}</td>
                        <td><strong>${c.customer_name || '-'}</strong><br><small>${c.customer_code || ''}</small></td>
                        <td style="color:#dc2626;font-weight:bold">${fmt(c.current_balance)}</td>
                        <td>${fmt(c.credit_limit)}</td>
                        <td style="${c.available_credit > 0 ? 'color:#059669' : 'color:#ef4444'}">${fmt(c.available_credit)}</td>
                        <td>${fmtInt(c.days_outstanding)}</td>
                        <td ${ageColor(c.age_0_30)}>${fmt(c.age_0_30)}</td>
                        <td ${ageColor(c.age_31_60)}>${fmt(c.age_31_60)}</td>
                        <td ${ageColor(c.age_61_90)}>${fmt(c.age_61_90)}</td>
                        <td ${ageColor(c.age_91_120)}>${fmt(c.age_91_120)}</td>
                        <td style="color:#dc2626;font-weight:bold">${fmt(c.age_120_plus)}</td>
                        <td>${(c.utilization_pct||0).toFixed(1)}%</td>
                    </tr>`).join('');
                const foot = `<tr style="font-weight:bold;background:var(--bg-body)">
                    <td colspan="2" style="text-align:left">الإجمالي</td>
                    <td style="color:#dc2626">${fmt(t.total_balance)}</td>
                    <td>${fmt(t.total_credit_limit)}</td>
                    <td></td>
                    <td></td>
                    <td>${fmt(t.age_0_30)}</td>
                    <td>${fmt(t.age_31_60)}</td>
                    <td>${fmt(t.age_61_90)}</td>
                    <td>${fmt(t.age_91_120)}</td>
                    <td style="color:#dc2626;font-weight:bold">${fmt(t.age_120_plus)}</td>
                    <td></td>
                </tr>`;
                renderTable(headers, body, foot);
                _lastReportData = {
                    title: 'تقرير الذمم المدينة',
                    filters: [],
                    summary: [{ label: 'إجمالي الرصيد', value: fmt(t.total_balance) }, { label: 'إجمالي الحد الائتماني', value: fmt(t.total_credit_limit) }],
                    columns: headers, rows: data.map((c, i) => [i+1, c.customer_name||'-', fmt(c.current_balance), fmt(c.credit_limit), fmt(c.available_credit), fmtInt(c.days_outstanding), fmt(c.age_0_30), fmt(c.age_31_60), fmt(c.age_61_90), fmt(c.age_91_120), fmt(c.age_120_plus), (c.utilization_pct||0).toFixed(1)+'%']),
                    totals: [{ label: 'إجمالي الرصيد', value: fmt(t.total_balance) }, { label: 'أقل من 30', value: fmt(t.age_0_30) }, { label: 'أكثر من 120', value: fmt(t.age_120_plus) }]
                };
            },
            async 'top-customers'() {
                const f = getFilters();
                const p = new URLSearchParams({ per_page: '50' });
                if (f.from) p.append('from', f.from); if (f.to) p.append('to', f.to);
                const r = await req(`/reports/top-customers?${p.toString()}`);
                if (!r.success) { showError(r.message); return; }
                const data = r.data || [];
                const headers = ['#', 'العميل', 'الفواتير', 'المبيعات', 'المرتجعات', 'التحصيلات', 'الربح', 'الهامش%', 'المستحق', 'الترتيب'];
                const body = data.length === 0
                    ? '<tr><td colspan="10" style="text-align:center;padding:30px;color:#999">لا توجد بيانات</td></tr>'
                    : data.map(c => `<tr>
                        <td>${fmtInt(c.ranking)}</td>
                        <td><strong>${c.customer_name || '-'}</strong><br><small>${c.customer_code || ''}</small></td>
                        <td>${fmtInt(c.invoice_count)}</td>
                        <td style="font-weight:bold;color:#059669">${fmt(c.total_sales)}</td>
                        <td style="color:#ef4444">${fmt(c.total_returns)}</td>
                        <td style="color:#6366f1">${fmt(c.total_collections)}</td>
                        <td style="font-weight:bold;color:${c.profit >= 0 ? '#059669' : '#ef4444'}">${fmt(c.profit)}</td>
                        <td>${(c.margin_pct||0).toFixed(1)}%</td>
                        <td style="color:#dc2626;font-weight:bold">${fmt(c.outstanding)}</td>
                        <td>🏆 #${fmtInt(c.ranking)}</td>
                    </tr>`).join('');
                renderTable(headers, body);
                _lastReportData = {
                    title: 'تقرير أفضل العملاء',
                    filters: [{ label: 'من تاريخ', value: f.from }, { label: 'إلى تاريخ', value: f.to }].filter(x => x.value),
                    summary: [{ label: 'عدد العملاء', value: fmtInt(data.length) }],
                    columns: headers, rows: data.map(c => [fmtInt(c.ranking), c.customer_name||'-', fmtInt(c.invoice_count), fmt(c.total_sales), fmt(c.total_returns), fmt(c.total_collections), fmt(c.profit), (c.margin_pct||0).toFixed(1)+'%', fmt(c.outstanding), '#'+fmtInt(c.ranking)]),
                    totals: []
                };
            },
            async 'rep-performance'() {
                const f = getFilters();
                const p = new URLSearchParams();
                if (f.from) p.append('from', f.from); if (f.to) p.append('to', f.to);
                if (f.rep) p.append('rep_id', f.rep);
                const r = await req(`/reports/rep-performance?${p.toString()}`);
                if (!r.success) { showError(r.message); return; }
                const data = r.data || [];
                const headers = ['#', 'المندوب', 'الفواتير', 'المبيعات', 'الخصم', 'التحصيلات', 'عدد التحصيلات', 'متوسط التحصيل', 'نسبة التحصيل', 'المرتجعات', 'متوسط الفاتورة', 'الهدف', 'الإنجاز%', 'العمولة'];
                const body = data.length === 0
                    ? '<tr><td colspan="14" style="text-align:center;padding:30px;color:#999">لا توجد بيانات</td></tr>'
                    : data.map((r, i) => `<tr>
                        <td>${i+1}</td>
                        <td><strong>${r.rep_name || '-'}</strong><br><small>${r.rep_code || ''}</small></td>
                        <td>${fmtInt(r.invoice_count)}</td>
                        <td style="font-weight:bold;color:#059669">${fmt(r.total_sales)}</td>
                        <td>${fmt(r.total_discount)}</td>
                        <td style="font-weight:bold;color:#7c3aed">${fmt(r.total_collections)}</td>
                        <td>${fmtInt(r.collection_count)}</td>
                        <td>${fmt(r.avg_collection)}</td>
                        <td>
                            <div style="display:flex;align-items:center;gap:5px">
                                <div style="flex:1;height:6px;background:#e5e7eb;border-radius:3px;">
                                    <div style="height:100%;border-radius:3px;width:${Math.min(r.collection_rate||0,100)}%;background:${(r.collection_rate||0) >= 100 ? '#059669' : (r.collection_rate||0) >= 50 ? '#f59e0b' : '#ef4444'}"></div>
                                </div>
                                <span style="font-weight:bold;font-size:12px">${(r.collection_rate||0).toFixed(1)}%</span>
                            </div>
                        </td>
                        <td>${fmt(r.total_returns)}</td>
                        <td>${fmt(r.avg_invoice)}</td>
                        <td>${fmt(r.target_amount)}</td>
                        <td>
                            <div style="display:flex;align-items:center;gap:5px">
                                <div style="flex:1;height:6px;background:#e5e7eb;border-radius:3px;">
                                    <div style="height:100%;border-radius:3px;width:${Math.min(r.achievement_pct||0,100)}%;background:${(r.achievement_pct||0) >= 100 ? '#059669' : (r.achievement_pct||0) >= 50 ? '#f59e0b' : '#ef4444'}"></div>
                                </div>
                                <span style="font-weight:bold;font-size:12px">${(r.achievement_pct||0).toFixed(1)}%</span>
                            </div>
                        </td>
                        <td style="font-weight:bold;color:#8b5cf6">${fmt(r.commission_base)}</td>
                    </tr>`).join('');
                renderTable(headers, body);
                _lastReportData = {
                    title: 'تقرير أداء المندوبين',
                    filters: [{ label: 'من تاريخ', value: f.from }, { label: 'إلى تاريخ', value: f.to }, { label: 'المندوب', value: f.rep }].filter(x => x.value),
                    summary: [{ label: 'عدد المندوبين', value: fmtInt(data.length) }],
                    columns: headers, rows: data.map((r, i) => [i+1, r.rep_name||'-', fmtInt(r.invoice_count), fmt(r.total_sales), fmt(r.total_discount), fmt(r.total_collections), fmtInt(r.collection_count), fmt(r.avg_collection), (r.collection_rate||0).toFixed(1)+'%', fmt(r.total_returns), fmt(r.avg_invoice), fmt(r.target_amount), (r.achievement_pct||0).toFixed(1)+'%', fmt(r.commission_base)]),
                    totals: []
                };
            },
            async 'rep-statement'() {
                const f = getFilters();
                if (!f.rep) { showEmpty('اختر المندوب أولاً من قائمة التصفية'); return; }
                _rstmtPage = 1;
                _rstmtPagination = null;
                await loadRepStatementPage(1);
            }
        };

        function fmtNum(n) {
            return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }

        // ── Rep Statement pagination (in reports context) ──
        let _rstmtPage = 1;
        let _rstmtPagination = null;

        async function loadRepStatementPage(page) {
            const f = getFilters();
            if (!f.rep) { showError('يرجى اختيار المندوب أولاً'); return; }
            _rstmtPage = page;
            const p = new URLSearchParams({ page: String(page), limit: '50' });
            if (f.from) p.append('from', f.from);
            if (f.to) p.append('to', f.to);
            const r = await req(`/reps/${f.rep}/statement?${p.toString()}`);
            if (!r.success) { showError(r.message); return; }
            const data = r.data;
            if (!data) { showError('لا توجد بيانات'); return; }

            hide('rpt-state-loading'); hide('rpt-state-empty'); hide('rpt-state-error'); hide('rpt-output');
            show('rpt-rep-statement-area');

            const s = data.summary || {};
            const repName = data.entity ? data.entity.name : '';
            const repCode = data.entity ? data.entity.code : '';
            setHtml('rstmt-rpt-title', 'كشف حساب: ' + (repCode ? repCode + ' - ' : '') + repName);
            setHtml('rstmt-rpt-sales', fmtNum(s.totalSales));
            setHtml('rstmt-rpt-collections', fmtNum(s.totalCollections));
            setHtml('rstmt-rpt-returns', fmtNum(s.totalReturns));
            setHtml('rstmt-rpt-netsales', fmtNum(s.netSales));
            setHtml('rstmt-rpt-commission', fmtNum(s.commission));
            setHtml('rstmt-rpt-balance', fmtNum(s.finalBalance));

            const movements = data.movements || [];
            _rstmtPagination = data.pagination || null;
            const tbody = document.getElementById('rstmt-rpt-tbody');
            if (movements.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:#6b7280">لا توجد حركات في هذا النطاق</td></tr>';
            } else {
                tbody.innerHTML = movements.map(m => {
                    const typeLabel = m.doc_type_label || m.movement_type || '-';
                    const trClass = m.movement_type === 'sales' ? 'row-sales' : m.movement_type === 'return' ? 'row-return' : m.movement_type === 'collection' ? 'row-collection' : '';
                    return '<tr class="' + trClass + '">' +
                        '<td>' + (m.trans_date || '-') + '</td>' +
                        '<td>' + typeLabel + '</td>' +
                        '<td>' + (m.doc_no || '-') + '</td>' +
                        '<td>' + (m.partner_name || '-') + '</td>' +
                        '<td>' + (m.debit ? fmt(m.debit) : '-') + '</td>' +
                        '<td>' + (m.credit ? fmt(m.credit) : '-') + '</td>' +
                        '<td><strong>' + fmt(m.balance) + '</strong></td>' +
                    '</tr>';
                }).join('');
            }

            const pagEl = document.getElementById('rstmt-rpt-pagination');
            if (!_rstmtPagination || _rstmtPagination.pages <= 1) {
                pagEl.style.display = 'none';
            } else {
                pagEl.style.display = 'flex';
                setHtml('rstmt-rpt-page-info', 'الصفحة ' + _rstmtPagination.page + ' من ' + _rstmtPagination.pages);
                document.getElementById('rstmt-rpt-page-prev').disabled = _rstmtPagination.page <= 1;
                document.getElementById('rstmt-rpt-page-next').disabled = _rstmtPagination.page >= _rstmtPagination.pages;
            }

            _lastReportData = {
                title: 'تقرير نشاط المندوب',
                filters: [{ label: 'المندوب', value: repName }, { label: 'من تاريخ', value: f.from }, { label: 'إلى تاريخ', value: f.to }].filter(x => x.value),
                summary: [{ label: 'إجمالي المبيعات', value: fmtNum(s.totalSales) }, { label: 'الرصيد', value: fmtNum(s.finalBalance) }, { label: 'صافي المركز', value: fmtNum(s.netPosition) }],
                columns: ['التاريخ', 'النوع', 'المستند', 'الطرف', 'مدين', 'دائن', 'الرصيد'],
                rows: movements.map(m => [m.trans_date || '-', m.doc_type_label || m.movement_type || '-', m.doc_no || '-', m.partner_name || '-', m.debit ? fmtNum(m.debit) : '-', m.credit ? fmtNum(m.credit) : '-', fmtNum(m.balance)]),
                totals: []
            };
        }

        // Bind rep-statement pagination buttons
        document.getElementById('rstmt-rpt-page-prev')?.addEventListener('click', () => {
            if (_rstmtPagination && _rstmtPagination.page > 1) {
                loadRepStatementPage(_rstmtPagination.page - 1);
            }
        });
        document.getElementById('rstmt-rpt-page-next')?.addEventListener('click', () => {
            if (_rstmtPagination && _rstmtPagination.page < _rstmtPagination.pages) {
                loadRepStatementPage(_rstmtPagination.page + 1);
            }
        });

        // ── Nav sidebar click ──
        const navItems = view.querySelectorAll('.report-nav li');
        navItems.forEach(item => {
            if (item.dataset.bound) return;
            item.dataset.bound = '1';
            if (item.classList.contains('report-nav-separator')) return;
            item.addEventListener('click', async () => {
                navItems.forEach(n => n.classList.remove('active'));
                item.classList.add('active');
                const reportType = item.dataset.report || 'dashboard';
                updateFilterVisibility(reportType);
                showLoading();
                if (renderers[reportType]) {
                    try { await renderers[reportType](); } catch (e) { showError(e.message || 'خطأ'); }
                } else {
                    showEmpty('اختر تقريراً');
                }
            });
        });

        // ── Run button ──
        const runBtn = document.getElementById('rpt-run-btn');
        if (runBtn && !runBtn.dataset.bound) {
            runBtn.dataset.bound = '1';
            runBtn.addEventListener('click', () => {
                const active = view.querySelector('.report-nav li.active');
                if (active) active.click();
            });
        }

        // ── Print Engine ──
        const printEngine = new ReportPrintEngine();
        let _lastReportData = null;

        // ── Print button ──
        const printBtn = document.getElementById('rpt-print');
        if (printBtn && !printBtn.dataset.bound) {
            printBtn.dataset.bound = '1';
            printBtn.addEventListener('click', async () => {
                if (!_lastReportData) { alert('لا توجد بيانات للطباعة'); return; }
                await printEngine.init();
                printEngine.print(_lastReportData);
            });
        }

        // ── CSV Export ──
        const csvBtn = document.getElementById('rpt-export-csv');
        if (csvBtn && !csvBtn.dataset.bound) {
            csvBtn.dataset.bound = '1';
            csvBtn.addEventListener('click', () => {
                if (!_lastReportData) { alert('لا توجد بيانات للتصدير'); return; }
                printEngine.exportCSV(_lastReportData);
            });
        }

        // ── PDF Export (reuse print engine) ──
        const pdfBtn = document.getElementById('rpt-export-pdf');
        if (pdfBtn && !pdfBtn.dataset.bound) {
            pdfBtn.dataset.bound = '1';
            pdfBtn.addEventListener('click', async () => {
                if (!_lastReportData) { alert('لا توجد بيانات للتصدير'); return; }
                await printEngine.init();
                printEngine.print(_lastReportData);
            });
        }

        // ── Excel Export ──
        const excelBtn = document.getElementById('rpt-export-excel');
        if (excelBtn && !excelBtn.dataset.bound) {
            excelBtn.dataset.bound = '1';
            excelBtn.addEventListener('click', () => {
                if (!_lastReportData) { alert('لا توجد بيانات للتصدير'); return; }
                const d = _lastReportData;
                let html = '<table>';
                html += '<tr>' + d.columns.map(c => '<th>' + c + '</th>').join('') + '</tr>';
                for (const row of d.rows) {
                    html += '<tr>' + d.columns.map((_, ci) => '<td>' + (row[ci] !== undefined ? row[ci] : '') + '</td>').join('') + '</tr>';
                }
                html += '</table>';
                const blob = new Blob(['﻿' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = (d.title || 'report') + '.xls';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            });
        }

        // ── Share ──
        const shareBtn = document.getElementById('rpt-share');
        if (shareBtn && !shareBtn.dataset.bound) {
            shareBtn.dataset.bound = '1';
            shareBtn.addEventListener('click', () => {
                if (!_lastReportData) { alert('لا توجد بيانات للمشاركة'); return; }
                const d = _lastReportData;
                const text = d.title + '\n' +
                    d.filters.map(f => f.label + ': ' + f.value).join(' | ') + '\n' +
                    d.summary.map(s => s.label + ': ' + s.value).join(' | ') + '\n' +
                    d.totals.map(t => t.label + ': ' + t.value).join(' | ');
                if (navigator.share) {
                    navigator.share({ title: d.title, text }).catch(() => {});
                } else {
                    navigator.clipboard.writeText(text).then(() => alert('تم نسخ التقرير للحافظة')).catch(() => alert('تعذر المشاركة'));
                }
            });
        }

        // ── Load dashboard by default ──
        // Check if first nav already has dashboard data; if not, trigger dashboard
        const firstActive = view.querySelector('.report-nav li.active');
        if (!firstActive) {
            const first = view.querySelector('.report-nav li');
            if (first) first.click();
        }
    };
})();
