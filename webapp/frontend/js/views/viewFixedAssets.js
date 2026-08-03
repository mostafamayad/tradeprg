// ── Fixed Assets Module ──
(function () {
    'use strict';

    const BASE = '/api/fixed-assets';
    let categories = [];

    // ── Helpers ──
    function loading(el) { if (el) el.innerHTML = '<div class="loading">جاري التحميل...</div>'; }
    function emptyState(el, msg) { el.innerHTML = '<div class="empty-state"><i class="fa-solid fa-box-open"></i><p>' + (msg || 'لا توجد بيانات') + '</p></div>'; }
    function faError(el, msg) { el.innerHTML = '<div class="error-state"><i class="fa-solid fa-circle-exclamation"></i><p>' + (msg || 'حدث خطأ') + '</p></div>'; }
    function val(v, def) { return v != null ? v : (def || 0); }
    function fmt(n) { return parseFloat(n || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function fmtDate(d) { if (!d) return '—'; var p = d.split('T')[0] || d; return p; }
    function addMsg(m, t) { if (window.showToast) window.showToast(m, t || 'success'); else if (window.showNotification) window.showNotification(m, t || 'success'); else alert(m); }
    function confirmMsg(m) { return window.confirm ? window.confirm(m) : confirm(m); }

    function api(path, opts) {
        var token = localStorage.getItem('auth_token');
        return fetch(BASE + path, {
            headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': 'Bearer ' + token } : {}), ...(opts && opts.headers) },
            ...opts
        }).then(r => r.json());
    }

    function showModal(html) {
        document.body.insertAdjacentHTML('beforeend', html);
        var last = document.body.lastElementChild;
        if (last && last.classList.contains('modal-overlay')) {
            last.style.display = 'flex';
            last.classList.add('active');
        }
    }

    async function loadCategories() {
        const r = await api('/categories');
        if (r.success) categories = r.data;
        return categories;
    }

    function catOpts(sel) {
        return categories.map(c => '<option value="' + c.id + '"' + (sel == c.id ? ' selected' : '') + '>' + c.name + ' (' + c.useful_life_months + ' شهر)</option>').join('');
    }

    // ── Render Functions ──
    window.loadFixedAssets = async function () {
        const cont = document.getElementById('view-fixed-assets');
        if (!cont) return;
        const main = cont.querySelector('.fa-main');
        if (!main) return;

        await loadCategories();
        renderFixedAssets(main);
    };

    function renderFixedAssets(cont) {
        const html = `
            <div class="page-section">
                <div class="page-card">
                    <div class="page-card-header">
                        <div class="page-card-title"><i class="fa-solid fa-building"></i> الأصول الثابتة</div>
                        <div class="page-actions">
                            <button class="btn btn-primary" onclick="showFAModal()"><i class="fa-solid fa-plus"></i> أصل ثابت جديد</button>
                            <button class="btn btn-outline" onclick="showDepreciationBatchModal()"><i class="fa-solid fa-calculator"></i> إهلاك دفعة</button>
                            <button class="btn btn-outline" onclick="showFAMovements()"><i class="fa-solid fa-arrows-spin"></i> حركات الأصول</button>
                        </div>
                    </div>
                    <div id="fa-filter-bar" style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">
                        <input type="text" id="fa-search" placeholder="بحث..." style="padding:8px 12px;border:1px solid #ddd;border-radius:6px;flex:1">
                        <select id="fa-filter-status" style="padding:8px 12px;border:1px solid #ddd;border-radius:6px">
                            <option value="">كل الحالات</option>
                            <option value="active">نشط</option>
                            <option value="disposed">مخرد</option>
                            <option value="sold">مباع</option>
                        </select>
                        <select id="fa-filter-category" style="padding:8px 12px;border:1px solid #ddd;border-radius:6px">
                            <option value="">كل الفئات</option>
                            ${catOpts()}
                        </select>
                        <button class="btn btn-outline btn-sm" onclick="loadFixedAssets()"><i class="fa-solid fa-search"></i> بحث</button>
                    </div>
                    <div id="fa-table-wrap" class="page-table-wrap"></div>
                    <div id="fa-summary" class="page-summary"></div>
                </div>
            </div>
        `;
        cont.innerHTML = html;
        document.getElementById('fa-search').addEventListener('keyup', function (e) { if (e.key === 'Enter') loadFATable(); });
        document.getElementById('fa-filter-status').addEventListener('change', loadFATable);
        document.getElementById('fa-filter-category').addEventListener('change', loadFATable);
        loadFATable();
        loadFASummary();
    }

    window.loadFATable = async function (page) {
        const wrap = document.getElementById('fa-table-wrap');
        if (!wrap) return;
        loading(wrap);
        const q = document.getElementById('fa-search') ? document.getElementById('fa-search').value : '';
        const st = document.getElementById('fa-filter-status') ? document.getElementById('fa-filter-status').value : '';
        const cat = document.getElementById('fa-filter-category') ? document.getElementById('fa-filter-category').value : '';
        const p = page || 1;
        let url = '?limit=50&page=' + p;
        if (q) url += '&q=' + encodeURIComponent(q);
        if (st) url += '&asset_status=' + st;
        if (cat) url += '&category_id=' + cat;
        const r = await api(url);
        if (!r.success) { faError(wrap, r.message); return; }
        if (!r.data.length) { emptyState(wrap, 'لا توجد أصول ثابتة'); return; }

        let html = '<div class="table-responsive"><table class="data-table"><thead><tr><th>الكود</th><th>اسم الأصل</th><th>الفئة</th><th>تاريخ الشراء</th><th>التكلفة</th><th>مجمع الإهلاك</th><th>القيمة الدفترية</th><th>الحالة</th><th></th></tr></thead><tbody>';
        for (const a of r.data) {
            const nbv = a.purchase_cost - a.accumulated_depreciation;
            const statusMap = { active: '<span class="badge-status paid">نشط</span>', disposed: '<span class="badge-status cancelled">مخرد</span>', sold: '<span class="badge-status pending">مباع</span>' };
            html += '<tr><td><strong>' + a.asset_code + '</strong></td><td>' + a.asset_name + '</td><td>' + (a.category_name || '—') + '</td><td>' + fmtDate(a.purchase_date) + '</td><td>' + fmt(a.purchase_cost) + '</td><td>' + fmt(a.accumulated_depreciation) + '</td><td>' + fmt(nbv) + '</td><td>' + (statusMap[a.asset_status] || a.asset_status) + '</td><td>';
            html += '<button class="icon-btn btn-view" onclick="showFADetail(' + a.id + ')" title="عرض"><i class="fa-solid fa-eye"></i></button>';
            if (a.asset_status === 'active') {
                html += '<button class="icon-btn btn-edit" onclick="showFAEdit(' + a.id + ')" title="تعديل"><i class="fa-solid fa-pen"></i></button>';
                html += '<button class="icon-btn btn-action" onclick="showFADepreciate(' + a.id + ')" title="إهلاك"><i class="fa-solid fa-calculator"></i></button>';
                html += '<button class="icon-btn btn-action" onclick="showFADispose(' + a.id + ')" title="تخريد"><i class="fa-solid fa-trash"></i></button>';
                html += '<button class="icon-btn btn-success" onclick="showFASell(' + a.id + ')" title="بيع"><i class="fa-solid fa-hand-holding-dollar"></i></button>';
            }
            html += '</td></tr>';
        }
        html += '</tbody></table></div>';

        // Pagination
        if (r.pagination && r.pagination.pages > 1) {
            html += '<div class="pagination" style="display:flex;justify-content:center;gap:8px;margin-top:16px">';
            for (let i = 1; i <= r.pagination.pages && i <= 10; i++) {
                html += '<button class="btn btn-sm ' + (i === p ? 'btn-primary' : 'btn-outline') + '" onclick="loadFATable(' + i + ')">' + i + '</button>';
            }
            html += '</div>';
        }

        wrap.innerHTML = html;
    };

    window.loadFASummary = async function () {
        const el = document.getElementById('fa-summary');
        if (!el) return;
        const r = await api('/summary');
        if (!r.success) return;
        const d = r.data;
        el.innerHTML = '<div class="fa-summary-grid">' +
            '<div class="fa-stat-card"><div class="fa-stat-icon stat-icon--purple"><i class="fa-solid fa-building"></i></div><div class="fa-stat-info"><div class="fa-stat-label">إجمالي الأصول</div><div class="fa-stat-value">' + val(d.total_assets) + '</div></div></div>' +
            '<div class="fa-stat-card"><div class="fa-stat-icon stat-icon--blue"><i class="fa-solid fa-coins"></i></div><div class="fa-stat-info"><div class="fa-stat-label">إجمالي التكلفة</div><div class="fa-stat-value">' + fmt(d.total_cost) + '</div></div></div>' +
            '<div class="fa-stat-card"><div class="fa-stat-icon stat-icon--orange"><i class="fa-solid fa-chart-line"></i></div><div class="fa-stat-info"><div class="fa-stat-label">مجمع الإهلاك</div><div class="fa-stat-value">' + fmt(d.total_depreciation) + '</div></div></div>' +
            '<div class="fa-stat-card"><div class="fa-stat-icon stat-icon--green"><i class="fa-solid fa-sack-dollar"></i></div><div class="fa-stat-info"><div class="fa-stat-label">صافي القيمة الدفترية</div><div class="fa-stat-value">' + fmt(d.total_nbv) + '</div></div></div>' +
            '<div class="fa-stat-card"><div class="fa-stat-icon stat-icon--green"><i class="fa-solid fa-circle-check"></i></div><div class="fa-stat-info"><div class="fa-stat-label">أصول نشطة</div><div class="fa-stat-value">' + val(d.active_assets) + '</div></div></div>' +
            '<div class="fa-stat-card"><div class="fa-stat-icon stat-icon--red"><i class="fa-solid fa-box-archive"></i></div><div class="fa-stat-info"><div class="fa-stat-label">مستهلك بالكامل</div><div class="fa-stat-value">' + val(d.fully_depreciated) + '</div></div></div>' +
            '</div>';
    };

    // ── Create / Edit Asset Modal ──
    window.showFAModal = function (asset) {
        const isEdit = !!asset;
        const title = isEdit ? 'تعديل أصل ثابت' : 'أصل ثابت جديد';
        const html = `
            <div class="modal-overlay" id="fa-modal">
                <div class="modal-box" style="max-width:600px">
                    <div class="modal-header"><h3>${title}</h3><button class="modal-close" onclick="closeModal('fa-modal')">&times;</button></div>
                    <div class="modal-body">
                        <div class="form-row">
                            <label>اسم الأصول</label>
                            <input type="text" id="fa-name" class="form-control" value="${asset ? asset.asset_name : ''}">
                        </div>
                        <div class="form-row">
                            <label>الفئة</label>
                            <select id="fa-category" class="form-control">${catOpts(asset ? asset.category_id : '')}</select>
                        </div>
                        ${!isEdit ? `
                        <div class="form-row">
                            <label>مصدر الإنشاء</label>
                            <select id="fa-source" class="form-control">
                                <option value="">بدون قيد محاسبي (فاتورة شراء)</option>
                                <option value="opening_balance">رصيد افتتاحي</option>
                                <option value="capital">رأس المال</option>
                            </select>
                        </div>` : ''}
                        <div class="form-row">
                            <label>تاريخ الشراء</label>
                            <input type="date" id="fa-purchase-date" class="form-control" value="${asset ? (asset.purchase_date ? asset.purchase_date.split('T')[0] : '') : ''}">
                        </div>
                        <div class="form-row">
                            <label>تكلفة الشراء</label>
                            <input type="number" step="0.01" id="fa-cost" class="form-control" value="${asset ? asset.purchase_cost : ''}">
                        </div>
                        <div class="form-row">
                            <label>القيمة المتبقية (Salvage Value)</label>
                            <input type="number" step="0.01" id="fa-salvage" class="form-control" value="${asset ? asset.salvage_value : '0'}">
                        </div>
                        <div class="form-row">
                            <label>العمر الإنتاجي (أشهر)</label>
                            <input type="number" step="0.1" id="fa-life" class="form-control" value="${asset ? asset.useful_life_months : ''}">
                        </div>
                        <div class="form-row">
                            <label>الموقع</label>
                            <input type="text" id="fa-location" class="form-control" value="${asset ? asset.location || '' : ''}">
                        </div>
                        <div class="form-row">
                            <label>الرقم المسلسل</label>
                            <input type="text" id="fa-serial" class="form-control" value="${asset ? asset.serial_number || '' : ''}">
                        </div>
                        <div class="form-row">
                            <label>ملاحظات</label>
                            <textarea id="fa-notes" class="form-control" rows="3">${asset ? asset.notes || '' : ''}</textarea>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-outline" onclick="closeModal('fa-modal')">إلغاء</button>
                        <button class="btn btn-primary" onclick="${isEdit ? 'saveFAEdit(' + asset.id + ')' : 'saveFANew()'}">${isEdit ? 'حفظ' : 'إنشاء'}</button>
                    </div>
                </div>
            </div>`;
        showModal(html);
        // Auto-fill life from category
        if (!isEdit) {
            document.getElementById('fa-category').addEventListener('change', function () {
                const cat = categories.find(c => c.id == this.value);
                if (cat) document.getElementById('fa-life').value = cat.useful_life_months;
            });
        }
    };

    window.saveFANew = async function () {
        const name = document.getElementById('fa-name').value;
        const cat = document.getElementById('fa-category').value;
        const date = document.getElementById('fa-purchase-date').value;
        const cost = document.getElementById('fa-cost').value;
        const salvage = document.getElementById('fa-salvage').value;
        const life = document.getElementById('fa-life').value;
        const source = document.getElementById('fa-source').value;
        const loc = document.getElementById('fa-location').value;
        const sn = document.getElementById('fa-serial').value;
        const notes = document.getElementById('fa-notes').value;
        if (!name || !cat || !date || !cost || !life) { addMsg('يرجى ملء الحقول المطلوبة', 'error'); return; }
        const r = await api('', {
            method: 'POST',
            body: JSON.stringify({ asset_name: name, category_id: parseInt(cat), purchase_date: date, purchase_cost: parseFloat(cost), salvage_value: parseFloat(salvage || 0), useful_life_months: parseFloat(life), source_type: source || null, location: loc || null, serial_number: sn || null, notes: notes || null })
        });
        if (r.success) { addMsg('تم إنشاء الأصل: ' + (r.asset_code || ''), 'success'); closeModal('fa-modal'); loadFATable(); loadFASummary(); }
        else addMsg(r.message, 'error');
    };

    window.showFAEdit = async function (id) {
        const r = await api('/' + id);
        if (r.success) window.showFAModal(r.data);
    };

    window.saveFAEdit = async function (id) {
        const name = document.getElementById('fa-name').value;
        const date = document.getElementById('fa-purchase-date').value;
        const cost = document.getElementById('fa-cost').value;
        const salvage = document.getElementById('fa-salvage').value;
        const life = document.getElementById('fa-life').value;
        const loc = document.getElementById('fa-location').value;
        const sn = document.getElementById('fa-serial').value;
        const notes = document.getElementById('fa-notes').value;
        const r = await api('/' + id, {
            method: 'PUT',
            body: JSON.stringify({ asset_name: name, purchase_date: date || null, purchase_cost: parseFloat(cost), salvage_value: parseFloat(salvage || 0), useful_life_months: life ? parseFloat(life) : null, location: loc || null, serial_number: sn || null, notes: notes || null })
        });
        if (r.success) { addMsg('تم تعديل الأصل'); closeModal('fa-modal'); loadFATable(); loadFASummary(); }
        else addMsg(r.message, 'error');
    };

    // ── Detail View ──
    window.showFADetail = async function (id) {
        const r = await api('/' + id);
        if (!r.success) { addMsg(r.message, 'error'); return; }
        const a = r.data;
        const nbv = a.purchase_cost - a.accumulated_depreciation;
        const statusMap = { active: 'نشط', disposed: 'مخرد', sold: 'مباع' };
        const html = `
            <div class="modal-overlay" id="fa-detail-modal">
                <div class="modal-box" style="max-width:700px">
                    <div class="modal-header"><h3>${a.asset_code} — ${a.asset_name}</h3><button class="modal-close" onclick="closeModal('fa-detail-modal')">&times;</button></div>
                    <div class="modal-body">
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
                            <div><strong>الكود:</strong> ${a.asset_code}</div>
                            <div><strong>الحالة:</strong> ${statusMap[a.asset_status] || a.asset_status}</div>
                            <div><strong>الفئة:</strong> ${a.category_name || '—'}</div>
                            <div><strong>تاريخ الشراء:</strong> ${fmtDate(a.purchase_date)}</div>
                            <div><strong>التكلفة:</strong> ${fmt(a.purchase_cost)}</div>
                            <div><strong>القيمة المتبقية:</strong> ${fmt(a.salvage_value)}</div>
                            <div><strong>العمر الإنتاجي:</strong> ${a.useful_life_months} شهر</div>
                            <div><strong>مجمع الإهلاك:</strong> ${fmt(a.accumulated_depreciation)}</div>
                            <div><strong>القيمة الدفترية:</strong> ${fmt(nbv)}</div>
                            <div><strong>الموقع:</strong> ${a.location || '—'}</div>
                            <div><strong>الرقم المسلسل:</strong> ${a.serial_number || '—'}</div>
                        </div>
                        ${a.notes ? '<div style="margin-top:16px"><strong>ملاحظات:</strong> ' + a.notes + '</div>' : ''}
                        <div id="fa-dep-history" style="margin-top:24px">
                            <h4 style="margin-bottom:8px">سجل الإهلاك</h4>
                            <div id="fa-dep-list"></div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-outline" onclick="closeModal('fa-detail-modal')">إغلاق</button>
                    </div>
                </div>
            </div>`;
        showModal(html);
        // Load depreciation history
        const depEl = document.getElementById('fa-dep-list');
        if (depEl) {
            const dr = await api('/' + id + '/depreciation');
            if (dr.success && dr.data.length) {
                let dh = '<div class="table-responsive"><table class="data-table"><thead><tr><th>الفترة</th><th>قيمة الإهلاك</th><th>مجمع بعد</th><th>قيد رقم</th></tr></thead><tbody>';
                for (const d of dr.data) {
                    dh += '<tr><td>' + fmtDate(d.period_date) + '</td><td>' + fmt(d.depreciation_amount) + '</td><td>' + fmt(d.accumulated_after) + '</td><td>' + (d.entry_no || '—') + '</td></tr>';
                }
                dh += '</tbody></table></div>';
                depEl.innerHTML = dh;
            } else {
                depEl.innerHTML = '<p class="text-muted">لا يوجد إهلاك مسجل</p>';
            }
        }
    };

    // ── Depreciation ──
    window.showFADepreciate = function (id) {
        const html = `
            <div class="modal-overlay" id="fa-dep-modal">
                <div class="modal-box" style="max-width:400px">
                    <div class="modal-header"><h3>إهلاك الأصل</h3><button class="modal-close" onclick="closeModal('fa-dep-modal')">&times;</button></div>
                    <div class="modal-body">
                        <div class="form-row">
                            <label>تاريخ الفترة (شهر)</label>
                            <input type="date" id="fa-dep-date" class="form-control" value="${new Date().toISOString().slice(0, 7) + '-01'}">
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-outline" onclick="closeModal('fa-dep-modal')">إلغاء</button>
                        <button class="btn btn-primary" onclick="runFADepreciate(${id})">ترحيل الإهلاك</button>
                    </div>
                </div>
            </div>`;
        showModal(html);
    };

    window.runFADepreciate = async function (id) {
        const period = document.getElementById('fa-dep-date').value;
        if (!period) { addMsg('يرجى اختيار الفترة', 'error'); return; }
        const r = await api('/' + id + '/depreciate', {
            method: 'POST',
            body: JSON.stringify({ period_date: period })
        });
        if (r.success) { addMsg('تم إهلاك الأصل بقيمة ' + fmt(r.depreciation), 'success'); closeModal('fa-dep-modal'); loadFATable(); loadFASummary(); }
        else addMsg(r.message, 'error');
    };

    window.showDepreciationBatchModal = function () {
        const html = `
            <div class="modal-overlay" id="fa-batch-modal">
                <div class="modal-box" style="max-width:400px">
                    <div class="modal-header"><h3>إهلاك دفعة</h3><button class="modal-close" onclick="closeModal('fa-batch-modal')">&times;</button></div>
                    <div class="modal-body">
                        <p>سيتم إهلاك جميع الأصول النشطة التي لم يتم إهلاكها في هذه الفترة</p>
                        <div class="form-row">
                            <label>تاريخ الفترة (شهر)</label>
                            <input type="date" id="fa-batch-date" class="form-control" value="${new Date().toISOString().slice(0, 7) + '-01'}">
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-outline" onclick="closeModal('fa-batch-modal')">إلغاء</button>
                        <button class="btn btn-primary" onclick="runFABatch()">ترحيل الإهلاك للكل</button>
                    </div>
                </div>
            </div>`;
        showModal(html);
    };

    window.runFABatch = async function () {
        const period = document.getElementById('fa-batch-date').value;
        if (!period) { addMsg('يرجى اختيار الفترة', 'error'); return; }
        const r = await api('/depreciate-batch', {
            method: 'POST',
            body: JSON.stringify({ period_date: period })
        });
        if (r.success) { addMsg(r.message, 'success'); closeModal('fa-batch-modal'); loadFATable(); loadFASummary(); }
        else addMsg(r.message, 'error');
    };

    // ── Disposal ──
    window.showFADispose = function (id) {
        const html = `
            <div class="modal-overlay" id="fa-dispose-modal">
                <div class="modal-box" style="max-width:500px">
                    <div class="modal-header"><h3>تخريد أصل</h3><button class="modal-close" onclick="closeModal('fa-dispose-modal')">&times;</button></div>
                    <div class="modal-body">
                        <p class="text-warning"><i class="fa-solid fa-triangle-exclamation"></i> سيتم إنشاء مسودة تخريد. يجب اعتمادها ثم ترحيلها لإنشاء القيد المحاسبي.</p>
                        <div class="form-row">
                            <label>تاريخ التخريد</label>
                            <input type="date" id="fa-dispose-date" class="form-control" value="${new Date().toISOString().slice(0, 10)}">
                        </div>
                        <div class="form-row">
                            <label>ملاحظات</label>
                            <textarea id="fa-dispose-notes" class="form-control" rows="3"></textarea>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-outline" onclick="closeModal('fa-dispose-modal')">إلغاء</button>
                        <button class="btn btn-danger" onclick="runFADispose(${id})">حفظ المسودة</button>
                    </div>
                </div>
            </div>`;
        showModal(html);
    };

    window.runFADispose = async function (id) {
        const date = document.getElementById('fa-dispose-date').value;
        const notes = document.getElementById('fa-dispose-notes').value;
        if (!date) { addMsg('يرجى اختيار التاريخ', 'error'); return; }
        const r = await api('/' + id + '/dispose', {
            method: 'POST',
            body: JSON.stringify({ movement_date: date, notes: notes || null })
        });
        if (r.success) { addMsg('تم إنشاء مسودة تخريد: ' + (r.movement_no || ''), 'success'); closeModal('fa-dispose-modal'); loadFATable(); }
        else addMsg(r.message, 'error');
    };

    // ── Sell ──
    window.showFASell = function (id) {
        const html = `
            <div class="modal-overlay" id="fa-sell-modal">
                <div class="modal-box" style="max-width:500px">
                    <div class="modal-header"><h3>بيع أصل</h3><button class="modal-close" onclick="closeModal('fa-sell-modal')">&times;</button></div>
                    <div class="modal-body">
                        <p class="text-warning"><i class="fa-solid fa-triangle-exclamation"></i> سيتم إنشاء مسودة بيع. يجب اعتمادها ثم ترحيلها لإنشاء القيد المحاسبي.</p>
                        <div class="form-row">
                            <label>تاريخ البيع</label>
                            <input type="date" id="fa-sell-date" class="form-control" value="${new Date().toISOString().slice(0, 10)}">
                        </div>
                        <div class="form-row">
                            <label>سعر البيع</label>
                            <input type="number" step="0.01" id="fa-sell-price" class="form-control">
                        </div>
                        <div class="form-row">
                            <label>اسم المشتري</label>
                            <input type="text" id="fa-sell-buyer" class="form-control">
                        </div>
                        <div class="form-row">
                            <label>ملاحظات</label>
                            <textarea id="fa-sell-notes" class="form-control" rows="3"></textarea>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-outline" onclick="closeModal('fa-sell-modal')">إلغاء</button>
                        <button class="btn btn-success" onclick="runFASell(${id})">حفظ المسودة</button>
                    </div>
                </div>
            </div>`;
        showModal(html);
    };

    window.runFASell = async function (id) {
        const date = document.getElementById('fa-sell-date').value;
        const price = document.getElementById('fa-sell-price').value;
        const buyer = document.getElementById('fa-sell-buyer').value;
        const notes = document.getElementById('fa-sell-notes').value;
        if (!date || !price) { addMsg('التاريخ وسعر البيع مطلوبان', 'error'); return; }
        const r = await api('/' + id + '/sell', {
            method: 'POST',
            body: JSON.stringify({ movement_date: date, selling_price: parseFloat(price), buyer_name: buyer || null, notes: notes || null })
        });
        if (r.success) { addMsg('تم إنشاء مسودة بيع: ' + (r.movement_no || ''), 'success'); closeModal('fa-sell-modal'); loadFATable(); }
        else addMsg(r.message, 'error');
    };

    // ── Movements Management ──
    window.showFAMovements = async function () {
        const r = await api('/reports/movement');
        if (!r.success) { addMsg(r.message, 'error'); return; }
        const data = r.data.filter(m => m.workflow_status !== 'posted');
        const html = `
            <div class="modal-overlay" id="fa-mv-modal">
                <div class="modal-box" style="max-width:900px">
                    <div class="modal-header"><h3>حركات الأصول — قيد الانتظار</h3><button class="modal-close" onclick="closeModal('fa-mv-modal')">&times;</button></div>
                    <div class="modal-body">
                        ${data.length === 0 ? '<p class="text-muted">لا توجد حركات في انتظار الاعتماد</p>' : `
                        <div class="table-responsive"><table class="data-table">
                            <thead><tr><th>#</th><th>الأصل</th><th>النوع</th><th>التاريخ</th><th>المبلغ</th><th>الحالة</th><th></th></tr></thead><tbody>
                            ${data.map(m => {
                                const typeMap = { disposal: 'تخريد', sale: 'بيع', transfer: 'نقل' };
                                const statusMap = { draft: '<span class="badge-status pending">مسودة</span>', approved: '<span class="badge-status paid">معتمد</span>' };
                                let actions = '';
                                if (m.workflow_status === 'draft') actions += '<button class="icon-btn btn-success" onclick="approveFAMovement(' + m.id + ')" title="اعتماد"><i class="fa-solid fa-check"></i></button>';
                                if (m.workflow_status === 'approved') actions += '<button class="icon-btn btn-primary" onclick="postFAMovement(' + m.id + ')" title="ترحيل"><i class="fa-solid fa-file-export"></i></button>';
                                if (m.workflow_status === 'posted') actions += '<button class="icon-btn btn-warning" onclick="reverseFAMovement(' + m.id + ')" title="عكس"><i class="fa-solid fa-rotate-left"></i></button>';
                                return '<tr><td>' + m.movement_no + '</td><td>' + (m.asset_name || m.asset_code) + '</td><td>' + (typeMap[m.movement_type] || m.movement_type) + '</td><td>' + fmtDate(m.movement_date) + '</td><td>' + (m.amount ? fmt(m.amount) : '—') + '</td><td>' + (statusMap[m.workflow_status] || m.workflow_status) + '</td><td>' + actions + '</td></tr>';
                            }).join('')}
                        </tbody></table></div>`}
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-outline" onclick="closeModal('fa-mv-modal')">إغلاق</button>
                    </div>
                </div>
            </div>`;
        showModal(html);
    };

    window.approveFAMovement = async function (mid) {
        if (!confirmMsg('اعتماد هذه الحركة؟')) return;
        const r = await api('/movements/' + mid + '/approve', { method: 'PATCH' });
        if (r.success) { addMsg('تم الاعتماد', 'success'); closeModal('fa-mv-modal'); }
        else addMsg(r.message, 'error');
    };

    window.postFAMovement = async function (mid) {
        if (!confirmMsg('ترحيل هذه الحركة؟ سيتم إنشاء القيد المحاسبي.')) return;
        const r = await api('/movements/' + mid + '/post', { method: 'PATCH' });
        if (r.success) { addMsg('تم الترحيل', 'success'); closeModal('fa-mv-modal'); loadFATable(); loadFASummary(); }
        else addMsg(r.message, 'error');
    };

    window.reverseFAMovement = async function (mid) {
        if (!confirmMsg('هل أنت متأكد من إلغاء هذا الإهلاك؟ سيتم إنشاء قيد عكسي.')) return;
        const r = await api('/movements/' + mid + '/reverse', { method: 'PATCH' });
        if (r.success) { addMsg('تم الإلغاء', 'success'); closeModal('fa-mv-modal'); loadFATable(); loadFASummary(); }
        else addMsg(r.message, 'error');
    };

    window.viewHandlers = window.viewHandlers || {};
    window.viewHandlers['view-fixed-assets'] = window.loadFixedAssets;

})();
