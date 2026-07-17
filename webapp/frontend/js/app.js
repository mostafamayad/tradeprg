 // ── Event Bus: decoupled pub/sub for background refresh ──
window.EventBus = {
    _listeners: {},
    on(ev, fn) { if (!this._listeners[ev]) this._listeners[ev] = []; this._listeners[ev].push(fn); },
    off(ev, fn) { if (!this._listeners[ev]) return; this._listeners[ev] = this._listeners[ev].filter(f => f !== fn); },
    emit(ev, data) { if (!this._listeners[ev]) return; this._listeners[ev].forEach(fn => { try { fn(data); } catch(e) { console.error('EventBus:', e); } }); }
};
// Shortcut: emit refresh for a specific view
window.refreshView = function(viewId) {
    EventBus.emit('view:refresh', viewId);
};

window.escapeHtml = function(unsafe) {
    if (unsafe == null) return '';
    return unsafe.toString().replace(/[&<"']/g, function(m) {
        switch (m) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            case "'": return '&#039;';
            default: return m;
        }
    });
};


// Global money formatter — returns colored HTML span
function formatMoney(n) {
    const v = Number(n || 0);
    const cls = v > 0 ? 'amount-positive' : v < 0 ? 'amount-negative' : '';
    const formatted = v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return cls ? '<span class="' + cls + '">' + formatted + '</span>' : formatted;
}
// ============================================================
// SIDEBAR: Collapsible Groups
// ============================================================
function toggleNavGroup(headerEl) {
    const group = headerEl.closest('.nav-group');
    if (!group) return;
    const isOpen = group.classList.contains('open');
    // Close all other groups
    document.querySelectorAll('.nav-group.open').forEach(g => {
        if (g !== group) g.classList.remove('open');
    });
    // Toggle this one
    group.classList.toggle('open', !isOpen);
}
window.toggleNavGroup = toggleNavGroup;

// Auto-open group that contains the active item
function openActiveGroup() {
    const activeItem = document.querySelector('.nav-group-items .nav-item.active');
    if (activeItem) {
        const group = activeItem.closest('.nav-group');
        if (group) group.classList.add('open');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // checkAuth is called from index.html after all scripts load


    // ============================================================
    // 0. LOAD LEGACY DATA & ADVANCED UX (Search & Undo)
    // ============================================================
    let invoiceHistory = [];
    
    // Custom Searchable Dropdown function — Portal-based (renders at body level, avoids stacking context clipping)
    function makeSearchableSelect(selectElement, optionsData, placeholder = "ابحث...") {
        const wrapper = document.createElement('div');
        wrapper.className = 'custom-select-wrapper';
        
        const trigger = document.createElement('div');
        trigger.className = 'custom-select-trigger';
        trigger.innerHTML = `<span>${placeholder}</span><i class="fa-solid fa-chevron-down"></i>`;
        
        const portal = document.createElement('div');
        portal.className = 'custom-options';
        
        const searchBox = document.createElement('div');
        searchBox.className = 'custom-search-box';
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = placeholder;
        searchBox.appendChild(searchInput);
        portal.appendChild(searchBox);
        
        function renderOptions(filter = "") {
            portal.querySelectorAll('.custom-option').forEach(opt => opt.remove());
            
            const filtered = optionsData.filter(o => {
                if(!o || !o.name) return false;
                return o.name.toLowerCase().includes(filter.toLowerCase()) || (o.code && o.code.toString().includes(filter));
            });
            
            filtered.slice(0, 50).forEach(opt => {
                const optEl = document.createElement('div');
                optEl.className = 'custom-option';
                optEl.innerHTML = opt.code ? `<span class="custom-option-code">${opt.code}</span>${opt.name}` : opt.name;
                optEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    trigger.querySelector('span').textContent = opt.name;
                    selectElement.value = opt.id || opt.code || opt.name;
                    closeDropdown();
                    selectElement.dispatchEvent(new Event('change'));
                });
                portal.appendChild(optEl);
            });
        }
        
        renderOptions();
        
        function positionPortal() {
            const rect = trigger.getBoundingClientRect();
            portal.style.setProperty('position', 'fixed');
            portal.style.setProperty('top', rect.bottom + 'px');
            portal.style.setProperty('left', rect.left + 'px');
            portal.style.setProperty('right', 'auto');
            portal.style.setProperty('width', rect.width + 'px');
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
            renderOptions();
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
        
        trigger.addEventListener('click', (e) => {
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
        
        searchInput.addEventListener('input', (e) => renderOptions(e.target.value));
        searchInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDropdown(); });
        
        document.addEventListener('click', (e) => {
            if (!wrapper.contains(e.target) && !portal.contains(e.target)) closeDropdown();
        });
        
        portal.addEventListener('click', (e) => e.stopPropagation());
        
        wrapper.appendChild(trigger);
        
        selectElement.style.display = 'none';
        if (selectElement.nextElementSibling && selectElement.nextElementSibling.classList.contains('custom-select-wrapper')) {
            selectElement.nextElementSibling.remove();
        }
        selectElement.parentNode.insertBefore(wrapper, selectElement.nextSibling);
        
        portal.style.setProperty('display', 'none');
        document.body.appendChild(portal);
        
        return wrapper;
    }
    window.makeSearchableSelect = makeSearchableSelect;

    function renderCustomerTable(customers) {
        const custTableBody = document.querySelector('#view-customers tbody');
        if (!custTableBody) return;
        custTableBody.innerHTML = '';
        if (!customers || customers.length === 0) {
            custTableBody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:30px;color:var(--text-muted)">لا يوجد عملاء</td></tr>';
            return;
        }
        customers.forEach(c => {
            const bal = parseFloat(c.balance || 0);
            const limit = parseFloat(c.credit_limit || 0);
            const balColor = bal > 0 ? 'color:var(--danger-color)' : 'color:var(--success-color)';
            const usage = limit > 0 ? Math.min(100, (bal / limit) * 100) : 0;
            const isActive = c.is_active !== 0;
            const isBlocked = c.blocked_status === 'blocked';
            let status = 'نشط', statusClass = 'paid';
            if (isBlocked) { status = 'محظور'; statusClass = 'blocked'; }
            else if (!isActive) { status = 'غير نشط'; statusClass = 'inactive'; }
            const groupName = c.customer_group_name || '';
            const typeMap = { wholesale: 'جملة', retail: 'تجزئة', vip: 'كبار عملاء' };
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-weight:600;color:var(--text-muted)">${c.code || ''}</td>
                <td><strong>${c.name || ''}</strong>${groupName ? '<br><span style="font-size:0.75rem;color:var(--text-muted)">' + escapeHtml(groupName) + '</span>' : ''}</td>
                <td>${groupName || '<span style="color:#aaa">—</span>'}</td>
                <td>${typeMap[c.customer_type] || c.customer_type || ''}</td>
                <td>${c.phone || '<span style="color:#aaa">—</span>'}</td>
                <td>${c.city || '<span style="color:#aaa">—</span>'}</td>
                <td style="${balColor}; font-weight:bold">${formatMoney(bal)} ج.م</td>
                <td>${formatMoney(limit)} ج.م</td>
                <td><span class="badge-status ${statusClass}">${status}</span></td>
                <td class="actions-cell">
                    ${hasPerm('customers.update') ? '<button class="icon-btn btn-view" title="عرض/تعديل"><i class="fa-solid fa-user"></i></button>' : ''}
                    ${hasPerm('customers.update') ? '<button class="icon-btn btn-edit" title="تعديل"><i class="fa-solid fa-pen-to-square"></i></button>' : ''}
                    ${hasPerm('customers.update') ? '<button class="icon-btn btn-toggle-active" title="تنشيط/إلغاء تنشيط" style="color:var(--info-color)"><i class="fa-solid fa-power-off"></i></button>' : ''}
                    ${hasPerm('customers.block') ? '<button class="icon-btn btn-block" title="حظر/إلغاء حظر" style="color:var(--warning-color)"><i class="fa-solid fa-ban"></i></button>' : ''}
                    ${hasPerm('customers.delete') ? '<button class="icon-btn btn-delete" title="حذف" style="color:var(--danger-color)"><i class="fa-solid fa-trash"></i></button>' : ''}
                </td>
            `;
            const viewBtn = tr.querySelector('.btn-view');
            if (viewBtn) viewBtn.addEventListener('click', () => openCustomerForm(c));
            const editBtn = tr.querySelector('.btn-edit');
            if (editBtn) editBtn.addEventListener('click', () => openCustomerForm(c));
            const activeBtn = tr.querySelector('.btn-toggle-active');
            if (activeBtn) activeBtn.addEventListener('click', () => toggleActiveCustomer(c.id, c.name, c.is_active !== 0));
            const blockBtn = tr.querySelector('.btn-block');
            if (blockBtn) blockBtn.addEventListener('click', () => toggleBlockCustomer(c.id, c.name, c.blocked_status === 'blocked'));
            const delBtn = tr.querySelector('.btn-delete');
            if (delBtn) delBtn.addEventListener('click', () => deleteCustomerWithConfirm(c.id, c.name));
            custTableBody.appendChild(tr);
        });
    }

    async function initDataFromServer() {
        console.log('[TRACE] initDataFromServer: ENTRY');
        try {
            // Fetch customers
            const custRes = await window.API.getCustomers();
            const customers = custRes.data;
            
            const mappedCustomers = customers.map(c => ({
                id: c.id, code: c.customer_code, name: c.customer_name,
                phone: c.phone, balance: c.current_balance, credit_limit: c.credit_limit,
                customer_type: c.customer_type, phone2: c.phone2, address: c.address,
                region: c.region, rep_id: c.rep_id, notes: c.notes,
                email: c.email, city: c.city, mobile: c.mobile, whatsapp: c.whatsapp,
                customer_group_name: c.customer_group_name, blocked_status: c.blocked_status,
                customer_code: c.customer_code, customer_name: c.customer_name,
                is_active: c.is_active
            }));

            // Fetch products
            const prodRes = await window.API.getProducts();
            const products = prodRes.data;

            // Update AppData globally so other parts of the app use the fresh data
            if (!window.AppData) window.AppData = {};
            window.AppData.customers = mappedCustomers;
            window.AppData.products = products;

            // 1. Update Dashboard Stats
            const dashCustomersElem = document.getElementById('dash-total-customers');
            if (dashCustomersElem) dashCustomersElem.textContent = mappedCustomers.length;
            
            renderCustomerTable(mappedCustomers);

            // Load customer groups for filter
            try {
                const grpRes = await window.API.getCustomerGroups();
                if (grpRes && grpRes.data) {
                    window.AppData.customerGroups = grpRes.data;
                    const grpSel = document.getElementById('cust-group-filter');
                    if (grpSel) {
                        if (!grpSel.dataset) grpSel.dataset = {};
                        if (grpSel.dataset.searchable) return;
                        grpSel.dataset.searchable = '1';
                        grpSel.innerHTML = '<option value="">كل المجموعات</option>' + grpRes.data.map(g => `<option value="${g.id}">${g.group_name}</option>`).join('');
                        makeSearchableSelect(grpSel, grpRes.data.map(g => ({id: g.id, name: g.group_name})), 'ابحث عن مجموعة...');
                    }
                }
            } catch (e) {}

            // Wire customer filters
            const custSearch = document.getElementById('cust-search');
            const custTypeFilter = document.getElementById('cust-type-filter');
            const custGroupFilter = document.getElementById('cust-group-filter');
            const custStatusFilter = document.getElementById('cust-status-filter');
            if (custSearch && !custSearch.dataset.wired) {
                custSearch.dataset.wired = '1';
                let searchTimer = null;
                let currentPage = 1;
                const refreshCustomerList = async () => {
                    try {
                        const params = { page: currentPage, limit: 50 };
                        const q = custSearch.value.trim();
                        if (q) params.q = q;
                        if (custTypeFilter && custTypeFilter.value) params.type = custTypeFilter.value;
                        if (custGroupFilter && custGroupFilter.value) params.group_id = custGroupFilter.value;
                        if (custStatusFilter && custStatusFilter.value) params.status = custStatusFilter.value;
                        const res = await window.API.getCustomers(params);
                        if (!res || !res.data) return;
                        const mapped = res.data.map(c => ({
                            id: c.id, code: c.customer_code, name: c.customer_name,
                            phone: c.phone, balance: c.current_balance, credit_limit: c.credit_limit,
                            customer_type: c.customer_type, email: c.email, city: c.city,
                            customer_group_name: c.customer_group_name, blocked_status: c.blocked_status,
                            is_active: c.is_active
                        }));
                        window.AppData.customers = mapped;
                        renderCustomerTable(mapped);
                        // Pagination
                        const pagDiv = document.getElementById('cust-pagination');
                        if (pagDiv && res.pagination) {
                            const { page, pages, total } = res.pagination;
                            pagDiv.innerHTML = '';
                            const mkBtn = (p, label, cls = '') => {
                                const b = document.createElement('button');
                                b.className = 'btn btn-sm ' + cls;
                                b.textContent = label;
                                b.onclick = () => { currentPage = p; refreshCustomerList(); };
                                if (p === page) b.style.background = 'var(--primary-color)'; b.style.color = '#fff'; b.style.borderColor = 'var(--primary-color)';
                                pagDiv.appendChild(b);
                            };
                            if (page > 1) mkBtn(1, '« الأولى');
                            if (page > 1) mkBtn(page - 1, '‹ السابق');
                            mkBtn(page, `الصفحة ${page} / ${pages}`);
                            if (page < pages) mkBtn(page + 1, 'التالي ›');
                            if (page < pages) mkBtn(pages, 'الأخيرة »');
                        }
                    } catch (e) { /* silent */ }
                };
                custSearch.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(refreshCustomerList, 300); });
                if (custTypeFilter) custTypeFilter.addEventListener('change', () => { currentPage = 1; refreshCustomerList(); });
                if (custGroupFilter) custGroupFilter.addEventListener('change', () => { currentPage = 1; refreshCustomerList(); });
                if (custStatusFilter) custStatusFilter.addEventListener('change', () => { currentPage = 1; refreshCustomerList(); });
            }

            // Tabbed Customer Form (Create/Edit)
            window.openCustomerForm = function(customer) {
                const isEdit = !!customer;
                const modal = document.getElementById('global-modal');
                if (!modal) return;
                modal.classList.add('modal-lg');
                const title = isEdit ? 'تعديل بيانات العميل' : 'إضافة عميل جديد';
                document.getElementById('modal-title').textContent = title;

                const h = (name, val) => escapeHtml(val || '');
                const sel = (name, val, options) => options.map(o => `<option value="${o[0]}" ${val === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('');

                const c = customer || {};
                const body = `
                <div class="modal-tabs">
                    <button class="modal-tab active" data-mtab="mtab1"><i class="fa-solid fa-building"></i> عام</button>
                    <button class="modal-tab" data-mtab="mtab2"><i class="fa-solid fa-address-book"></i> الاتصال</button>
                    <button class="modal-tab" data-mtab="mtab3"><i class="fa-solid fa-location-dot"></i> العنوان</button>
                    <button class="modal-tab" data-mtab="mtab4"><i class="fa-solid fa-calculator"></i> المحاسبة</button>
                    <button class="modal-tab" data-mtab="mtab5"><i class="fa-solid fa-file-contract"></i> المستندات</button>
                    <button class="modal-tab" data-mtab="mtab6"><i class="fa-solid fa-note-sticky"></i> الملاحظات</button>
                </div>
                <div class="modal-tab-content active" id="mtab1">
                    <div class="form-grid">
                        <div class="form-group"><label>اسم العميل <span class="text-danger">*</span></label><input type="text" id="cf-name" value="${h('', c.customer_name || c.name)}"></div>
                        <div class="form-group"><label>الاسم (إنجليزي)</label><input type="text" id="cf-name-en" value="${h('', c.customer_name_en)}"></div>
                        <div class="form-group"><label>النوع</label><select id="cf-type">${sel('type', c.customer_type, [['wholesale','جملة'],['retail','تجزئة'],['vip','كبار عملاء']])}</select></div>
                        <div class="form-group"><label>المجموعة</label><select id="cf-group"><option value="">—</option>${(window.AppData?.customerGroups || []).map(g => `<option value="${g.id}" ${c.customer_group_id == g.id ? 'selected' : ''}>${g.group_name}</option>`).join('')}</select></div>
                        <div class="form-group"><label>تصنيف العميل</label><select id="cf-category">${sel('category', c.customer_category, [['','—'],['premium','ممتاز'],['standard','عادي'],['low','ضعيف']])}</select></div>
                        <div class="form-group"><label>حالة العميل</label><select id="cf-customer-status">${sel('status', c.customer_status, [['active','نشط'],['inactive','غير نشط']])}</select></div>
                        <div class="form-group"><label>الكود</label><input type="text" id="cf-code" value="${h('', c.customer_code)}" placeholder="يولد تلقائياً"></div>
                        <div class="form-group"><label>تاريخ التسجيل</label><input type="date" id="cf-since" value="${h('', c.customer_since ? new Date(c.customer_since).toISOString().slice(0,10) : new Date().toISOString().slice(0,10))}"></div>
                        <div class="form-group"><label>الفرع</label><input type="text" id="cf-branch" value="${h('', c.branch)}" placeholder="الفرع"></div>
                        <div class="form-group"><label>مصدر العميل</label><select id="cf-lead-source">${sel('ls', c.lead_source, [['','—'],['social_media','تواصل اجتماعي'],['referral','توصية'],['website','الموقع الإلكتروني'],['call','اتصال هاتفي'],['walk_in','زيارة مباشرة'],['campaign','حملة تسويقية'],['other','أخرى']])}</select></div>
                        <div class="form-group"><label>اللغة</label><select id="cf-lang">${sel('lang', c.language, [['ar','العربية'],['en','English']])}</select></div>
                        <div class="form-group"><label>العملة</label><select id="cf-currency">${sel('cur', c.currency, [['EGP','جنيه مصري'],['USD','دولار أمريكي'],['SAR','ريال سعودي']])}</select></div>
                        <div class="form-group" style="grid-column:span 2"><label>الرقم الضريبي</label><input type="text" id="cf-tax-id" value="${h('', c.tax_id)}"></div>
                        <div class="form-group" style="grid-column:span 2"><label>السجل التجاري</label><input type="text" id="cf-commercial" value="${h('', c.commercial_register)}"></div>
                        <div class="form-group"><label>المندوب</label><select id="cf-rep"><option value="">—</option></select></div>
                        <div class="form-group"><label>شروط الدفع (أيام)</label><input type="number" id="cf-payment-terms" value="${c.payment_terms_days || 0}" min="0"></div>
                        <div class="form-group"><label>أيام الائتمان</label><input type="number" id="cf-credit-days" value="${c.credit_days || 0}" min="0"></div>
                        <div class="form-group"><label>الحد الائتماني</label><input type="number" id="cf-credit" value="${c.credit_limit || 0}" min="0"></div>
                        <div class="form-group"><label>مستوى المخاطر</label><select id="cf-risk-level">${sel('risk', c.credit_risk, [['normal','عادي'],['low','منخفض'],['medium','متوسط'],['high','مرتفع']])}</select></div>
                    </div>
                </div>
                <div class="modal-tab-content" id="mtab2">
                    <div class="form-grid">
                        <div class="form-group"><label>الهاتف</label><input type="text" id="cf-phone" value="${h('', c.phone)}"></div>
                        <div class="form-group"><label>الهاتف 2</label><input type="text" id="cf-phone2" value="${h('', c.phone2)}"></div>
                        <div class="form-group"><label>الجوال</label><input type="text" id="cf-mobile" value="${h('', c.mobile)}"></div>
                        <div class="form-group"><label>واتساب</label><input type="text" id="cf-whatsapp" value="${h('', c.whatsapp)}"></div>
                        <div class="form-group"><label>البريد الإلكتروني</label><input type="email" id="cf-email" value="${h('', c.email)}"></div>
                        <div class="form-group"><label>الموقع الإلكتروني</label><input type="url" id="cf-website" value="${h('', c.website)}"></div>
                        <div class="form-group"><label>فاكس</label><input type="text" id="cf-fax" value="${h('', c.fax)}"></div>
                        <div class="form-group"><label>جهة الاتصال الرئيسية</label><input type="text" id="cf-primary-contact" value="${h('', c.primary_contact)}"></div>
                        <div class="form-group"><label>المسمى الوظيفي</label><input type="text" id="cf-job-title" value="${h('', c.job_title)}"></div>
                        <div class="form-group"><label>جهة اتصال ثانوية</label><input type="text" id="cf-secondary-contact" value="${h('', c.secondary_contact)}"></div>
                        <div class="form-group"><label>جهة اتصال طارئة</label><input type="text" id="cf-emergency-contact" value="${h('', c.emergency_contact)}"></div>
                        <div class="form-group"><label>طريقة الاتصال المفضلة</label><select id="cf-preferred-contact-method">${sel('pcm', c.preferred_contact_method, [['','—'],['phone','هاتف'],['mobile','جوال'],['whatsapp','واتساب'],['email','بريد إلكتروني'],['mail','بريد عادي']])}</select></div>
                    </div>
                </div>
                <div class="modal-tab-content" id="mtab3">
                    <div class="form-grid">
                        <div class="form-group"><label>الدولة</label><input type="text" id="cf-country" value="${h('', c.country)}"></div>
                        <div class="form-group"><label>المحافظة</label><input type="text" id="cf-governorate" value="${h('', c.governorate)}"></div>
                        <div class="form-group"><label>المدينة</label><input type="text" id="cf-city" value="${h('', c.city)}"></div>
                        <div class="form-group"><label>المنطقة</label><input type="text" id="cf-region" value="${h('', c.region)}"></div>
                        <div class="form-group"><label>الحي</label><input type="text" id="cf-district" value="${h('', c.district)}"></div>
                        <div class="form-group"><label>الشارع</label><input type="text" id="cf-street" value="${h('', c.street)}"></div>
                        <div class="form-group"><label>رقم المبنى</label><input type="text" id="cf-building" value="${h('', c.building_no)}"></div>
                        <div class="form-group"><label>رقم الطابق</label><input type="text" id="cf-floor" value="${h('', c.floor_no)}"></div>
                        <div class="form-group"><label>رقم الشقة</label><input type="text" id="cf-apartment" value="${h('', c.apartment_no)}"></div>
                        <div class="form-group"><label>الرمز البريدي</label><input type="text" id="cf-postal" value="${h('', c.postal_code)}"></div>
                        <div class="form-group"><label>معلم</label><input type="text" id="cf-landmark" value="${h('', c.landmark)}"></div>
                        <div class="form-group" style="grid-column:span 2"><label>العنوان بالكامل</label><input type="text" id="cf-address" value="${h('', c.address)}"></div>
                        <div class="form-group" style="grid-column:span 2"><label>عنوان الشحن</label><input type="text" id="cf-shipping" value="${h('', c.shipping_address)}"></div>
                        <div class="form-group" style="grid-column:span 2"><label>عنوان الفوترة</label><input type="text" id="cf-billing" value="${h('', c.billing_address)}"></div>
                        <div class="form-group"><label>خط العرض (GPS)</label><input type="text" id="cf-gps-lat" value="${h('', c.gps_latitude)}" placeholder="مثال: 30.0444"></div>
                        <div class="form-group"><label>خط الطول (GPS)</label><input type="text" id="cf-gps-lng" value="${h('', c.gps_longitude)}" placeholder="مثال: 31.2357"></div>
                        <div class="form-group" style="grid-column:span 2"><label>رابط خرائط Google</label><input type="url" id="cf-gmap" value="${h('', c.google_maps_link)}"></div>
                    </div>
                </div>
                <div class="modal-tab-content" id="mtab4">
                    <div class="form-grid">
                        <div class="form-group"><label>الرصيد الافتتاحي</label><input type="number" id="cf-opening" value="${c.opening_balance || 0}" min="0" ${isEdit ? 'disabled' : ''}></div>
                        <div class="form-group"><label>تاريخ الرصيد الافتتاحي</label><input type="date" id="cf-opening-balance-date" value="${h('', c.opening_balance_date ? new Date(c.opening_balance_date).toISOString().slice(0,10) : '')}"></div>
                        <div class="form-group"><label>حساب العميل (AR)</label><input type="text" id="cf-ar-account" value="${h('', c.ar_account_id ? '#' + c.ar_account_id : '')}" readonly style="background:var(--bg-body);color:var(--text-muted)"></div>
                        <div class="form-group"><label>مكتب الضرائب</label><input type="text" id="cf-tax-office" value="${h('', c.tax_office)}"></div>
                        <div class="form-group"><label>الحالة الضريبية</label><select id="cf-tax-status">${sel('ts', c.tax_status, [['','—'],['registered','مسجل'],['exempt','معفي'],['withholding','خصم تحت المنبع']])}</select></div>
                        <div class="form-group"><label>الرقم الضريبي (VAT)</label><input type="text" id="cf-vat-number" value="${h('', c.vat_number)}"></div>
                        <div class="form-group"><label>طريقة الدفع الافتراضية</label><select id="cf-default-payment-method">${sel('dpm', c.default_payment_method, [['','—'],['cash','نقدي'],['check','شيك'],['transfer','تحويل بنكي'],['credit','آجل']])}</select></div>
                        <div class="form-group"><label>المخزن الافتراضي</label><select id="cf-warehouse"><option value="">—</option>${(window.AppData?.stores || []).map(s => `<option value="${s.id}" ${c.default_warehouse_id == s.id ? 'selected' : ''}>${s.store_name}</option>`).join('')}</select></div>
                        <div class="form-group"><label>قائمة الأسعار</label><select id="cf-price-list"><option value="">—</option></select></div>
                        <div class="form-group" style="grid-column:span 2"><label>بيانات البنك</label></div>
                        <div class="form-group"><label>اسم البنك</label><input type="text" id="cf-bank-name" value="${h('', c.bank_name)}"></div>
                        <div class="form-group"><label>رقم الحساب</label><input type="text" id="cf-bank-account" value="${h('', c.bank_account_no)}"></div>
                        <div class="form-group" style="grid-column:span 2"><label>رقم IBAN</label><input type="text" id="cf-bank-iban" value="${h('', c.bank_iban)}"></div>
                    </div>
                </div>
                <div class="modal-tab-content" id="mtab5">
                    <div class="form-grid">
                        <div class="form-group"><label>نوع المستند</label><select id="cf-id-type">${sel('idt', c.id_type, [['','—'],['national_id','رقم قومي'],['passport','جواز سفر'],['drivers_license','رخصة قيادة'],['other','أخرى']])}</select></div>
                        <div class="form-group"><label>رقم المستند</label><input type="text" id="cf-id-number" value="${h('', c.id_number)}"></div>
                        <div class="form-group"><label>تاريخ انتهاء المستند</label><input type="date" id="cf-id-expiry" value="${h('', c.id_expiry ? new Date(c.id_expiry).toISOString().slice(0,10) : '')}"></div>
                        <div class="form-group"><label>رقم البطاقة الضريبية</label><input type="text" id="cf-tax-card" value="${h('', c.tax_card_no)}"></div>
                        <div class="form-group"><label>تاريخ انتهاء البطاقة الضريبية</label><input type="date" id="cf-tax-card-expiry" value="${h('', c.tax_card_expiry ? new Date(c.tax_card_expiry).toISOString().slice(0,10) : '')}"></div>
                        <div class="form-group"><label>جهة إصدار السجل التجاري</label><input type="text" id="cf-commercial-issuer" value="${h('', c.commercial_register_issuer)}"></div>
                        <div class="form-group"><label>تاريخ انتهاء السجل التجاري</label><input type="date" id="cf-commercial-expiry" value="${h('', c.commercial_register_expiry ? new Date(c.commercial_register_expiry).toISOString().slice(0,10) : '')}"></div>
                        <div class="form-group"><label>رقم العقد</label><input type="text" id="cf-contract-no" value="${h('', c.contract_no)}"></div>
                        <div class="form-group"><label>تاريخ العقد</label><input type="date" id="cf-contract-date" value="${h('', c.contract_date ? new Date(c.contract_date).toISOString().slice(0,10) : '')}"></div>
                        <div class="form-group"><label>تاريخ انتهاء العقد</label><input type="date" id="cf-contract-expiry" value="${h('', c.contract_expiry ? new Date(c.contract_expiry).toISOString().slice(0,10) : '')}"></div>
                    </div>
                    <div style="margin-top:16px;padding:12px;background:var(--bg-body);border-radius:8px">
                        <label style="font-weight:600;font-size:0.85rem;margin-bottom:8px;display:block"><i class="fa-solid fa-paperclip"></i> المرفقات</label>
                        <div id="cf-attachments-list" style="margin-bottom:8px;font-size:0.82rem">${isEdit ? 'جاري التحميل...' : 'سيتم تفعيل المرفقات بعد الحفظ'}</div>
                        ${isEdit ? `
                        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                            <input type="file" id="cf-attachment-file" style="font-size:0.82rem">
                            <input type="text" id="cf-attachment-desc" placeholder="وصف الملف (اختياري)" style="font-size:0.82rem;padding:4px 8px;flex:1;min-width:120px">
                            <button class="btn btn-primary" onclick="uploadAttachment(${customer.id})" style="font-size:0.82rem;padding:4px 12px"><i class="fa-solid fa-upload"></i> رفع</button>
                        </div>
                        ` : ''}
                    </div>
                </div>
                <div class="modal-tab-content" id="mtab6">
                    <div class="form-grid">
                        <div class="form-group" style="grid-column:span 2"><label>ملاحظات عامة</label><textarea id="cf-notes" rows="3">${h('', c.notes)}</textarea></div>
                        <div class="form-group" style="grid-column:span 2"><label>ملاحظات داخلية (محاسبة)</label><textarea id="cf-internal-notes" rows="3">${h('', c.internal_notes)}</textarea></div>
                        <div class="form-group" style="grid-column:span 2"><label>ملاحظات المبيعات</label><textarea id="cf-sales-notes" rows="3">${h('', c.sales_notes)}</textarea></div>
                        <div class="form-group" style="grid-column:span 2"><label>ملاحظات العميل</label><textarea id="cf-customer-notes" rows="3">${h('', c.customer_notes)}</textarea></div>
                        <div class="form-group" style="grid-column:span 2"><label>ملاحظات محاسبية</label><textarea id="cf-accounting-notes" rows="3">${h('', c.accounting_notes)}</textarea></div>
                        <div class="form-group" style="grid-column:span 2"><label>تحذيرات</label><textarea id="cf-warnings" rows="2">${h('', c.warnings_field)}</textarea></div>
                        <div class="form-group" style="grid-column:span 2"><label>تعليمات خاصة</label><textarea id="cf-special-instructions" rows="2">${h('', c.special_instructions)}</textarea></div>
                    </div>
                </div>`;
                document.getElementById('modal-body').innerHTML = body;

                // Wire modal tabs
                document.querySelectorAll('.modal-tab').forEach(tab => {
                    tab.addEventListener('click', () => {
                        document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
                        document.querySelectorAll('.modal-tab-content').forEach(tc => tc.classList.remove('active'));
                        tab.classList.add('active');
                        document.getElementById(tab.dataset.mtab).classList.add('active');
                    });
                });

                // Load reps and price lists into selects
                (async () => {
                    try {
                        const repsRes = await window.API.getSalesReps();
                        if (repsRes.success) {
                            const repSel = document.getElementById('cf-rep');
                            if (repSel) {
                                repSel.innerHTML = '<option value="">—</option>' + repsRes.data.map(r => `<option value="${r.id}" ${c.rep_id == r.id ? 'selected' : ''}>${r.rep_name}</option>`).join('');
                            }
                        }
                    } catch (e) {}
                    try {
                        const plRes = await window.API.request('/products/price-lists', 'GET', null, { silent: true });
                        if (plRes.success) {
                            const plSel = document.getElementById('cf-price-list');
                            if (plSel) {
                                plSel.innerHTML = '<option value="">—</option>' + plRes.data.map(p => `<option value="${p.id}" ${c.price_list_id == p.id ? 'selected' : ''}>${p.list_name}</option>`).join('');
                            }
                        }
                    } catch (e) {}
                })();

                // Load attachments if editing
                if (isEdit) {
                    loadAttachmentList(customer.id);
                }

                // Save handler
                const saveBtn = document.getElementById('btn-modal-save');
                saveBtn.onclick = async () => {
                    const name = document.getElementById('cf-name').value.trim();
                    if (!name) { alert('اسم العميل مطلوب'); return; }
                    const data = {
                        customer_name: name,
                        customer_name_en: document.getElementById('cf-name-en')?.value || '',
                        customer_type: document.getElementById('cf-type')?.value || 'retail',
                        customer_group_id: document.getElementById('cf-group')?.value || null,
                        customer_category: document.getElementById('cf-category')?.value || '',
                        customer_code: document.getElementById('cf-code')?.value || '',
                        customer_since: document.getElementById('cf-since')?.value || null,
                        language: document.getElementById('cf-lang')?.value || 'ar',
                        currency: document.getElementById('cf-currency')?.value || 'EGP',
                        phone: document.getElementById('cf-phone')?.value || '',
                        phone2: document.getElementById('cf-phone2')?.value || '',
                        mobile: document.getElementById('cf-mobile')?.value || '',
                        whatsapp: document.getElementById('cf-whatsapp')?.value || '',
                        email: document.getElementById('cf-email')?.value || '',
                        website: document.getElementById('cf-website')?.value || '',
                        fax: document.getElementById('cf-fax')?.value || '',
                        primary_contact: document.getElementById('cf-primary-contact')?.value || '',
                        job_title: document.getElementById('cf-job-title')?.value || '',
                        secondary_contact: document.getElementById('cf-secondary-contact')?.value || '',
                        emergency_contact: document.getElementById('cf-emergency-contact')?.value || '',
                        country: document.getElementById('cf-country')?.value || '',
                        governorate: document.getElementById('cf-governorate')?.value || '',
                        city: document.getElementById('cf-city')?.value || '',
                        region: document.getElementById('cf-region')?.value || '',
                        district: document.getElementById('cf-district')?.value || '',
                        street: document.getElementById('cf-street')?.value || '',
                        building_no: document.getElementById('cf-building')?.value || '',
                        floor_no: document.getElementById('cf-floor')?.value || '',
                        apartment_no: document.getElementById('cf-apartment')?.value || '',
                        postal_code: document.getElementById('cf-postal')?.value || '',
                        landmark: document.getElementById('cf-landmark')?.value || '',
                        address: document.getElementById('cf-address')?.value || '',
                        shipping_address: document.getElementById('cf-shipping')?.value || '',
                        billing_address: document.getElementById('cf-billing')?.value || '',
                        gps_latitude: document.getElementById('cf-gps-lat')?.value || null,
                        gps_longitude: document.getElementById('cf-gps-lng')?.value || null,
                        google_maps_link: document.getElementById('cf-gmap')?.value || '',
                        credit_limit: parseFloat(document.getElementById('cf-credit')?.value) || 0,
                        opening_balance: parseFloat(document.getElementById('cf-opening')?.value) || 0,
                        payment_terms_days: parseInt(document.getElementById('cf-payment-terms')?.value) || 0,
                        tax_id: document.getElementById('cf-tax-id')?.value || '',
                        commercial_register: document.getElementById('cf-commercial')?.value || '',
                        tax_office: document.getElementById('cf-tax-office')?.value || '',
                        rep_id: document.getElementById('cf-rep')?.value || null,
                        default_warehouse_id: document.getElementById('cf-warehouse')?.value || null,
                        price_list_id: document.getElementById('cf-price-list')?.value || null,
                        notes: document.getElementById('cf-notes')?.value || '',
                        internal_notes: document.getElementById('cf-internal-notes')?.value || '',
                        customer_notes: document.getElementById('cf-customer-notes')?.value || '',
                        warnings_field: document.getElementById('cf-warnings')?.value || '',
                        special_instructions: document.getElementById('cf-special-instructions')?.value || '',
                        tax_card_no: document.getElementById('cf-tax-card')?.value || '',
                        tax_card_expiry: document.getElementById('cf-tax-card-expiry')?.value || null,
                        commercial_register_issuer: document.getElementById('cf-commercial-issuer')?.value || '',
                        commercial_register_expiry: document.getElementById('cf-commercial-expiry')?.value || null,
                        customer_status: document.getElementById('cf-customer-status')?.value || 'active',
                        branch: document.getElementById('cf-branch')?.value || '',
                        lead_source: document.getElementById('cf-lead-source')?.value || '',
                        credit_days: parseInt(document.getElementById('cf-credit-days')?.value) || 0,
                        credit_risk: document.getElementById('cf-risk-level')?.value || 'normal',
                        preferred_contact_method: document.getElementById('cf-preferred-contact-method')?.value || '',
                        opening_balance_date: document.getElementById('cf-opening-balance-date')?.value || null,
                        default_payment_method: document.getElementById('cf-default-payment-method')?.value || '',
                        tax_status: document.getElementById('cf-tax-status')?.value || '',
                        vat_number: document.getElementById('cf-vat-number')?.value || '',
                        bank_name: document.getElementById('cf-bank-name')?.value || '',
                        bank_account_no: document.getElementById('cf-bank-account')?.value || '',
                        bank_iban: document.getElementById('cf-bank-iban')?.value || '',
                        id_type: document.getElementById('cf-id-type')?.value || '',
                        id_number: document.getElementById('cf-id-number')?.value || '',
                        id_expiry: document.getElementById('cf-id-expiry')?.value || null,
                        contract_no: document.getElementById('cf-contract-no')?.value || '',
                        contract_date: document.getElementById('cf-contract-date')?.value || null,
                        contract_expiry: document.getElementById('cf-contract-expiry')?.value || null,
                        sales_notes: document.getElementById('cf-sales-notes')?.value || '',
                        accounting_notes: document.getElementById('cf-accounting-notes')?.value || '',
                    };
                    try {
                        if (isEdit) {
                            await window.API.updateCustomer(customer.id, data);
                        } else {
                            await window.API.createCustomer(data);
                        }
                        modal.classList.remove('active');
                        modal.classList.remove('modal-lg');
                        initDataFromServer();
                    } catch (e) {
                        alert('خطأ: ' + e.message);
                    }
                };
                modal.classList.add('active');
            };

            // ── Attachment list loader ──
            window.loadAttachmentList = async function(customerId) {
                const container = document.getElementById('cf-attachments-list');
                if (!container) return;
                try {
                    const res = await window.API.getCustomerAttachments(customerId);
                    if (!res.success) return;
                    const atts = res.data || [];
                    if (atts.length === 0) {
                        container.innerHTML = '<div style="color:var(--text-muted);padding:8px;font-size:0.82rem">لا توجد مرفقات</div>';
                        return;
                    }
                    container.innerHTML = atts.map(a => `
                        <div class="att-item" data-id="${a.id}" style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-color)">
                            <span><i class="fa-solid fa-file"></i> ${escapeHtml(a.file_name)} <span style="font-size:0.75rem;color:var(--text-muted)">(${a.uploaded_at || ''})</span></span>
                            <span>
                                <a href="${window.API.getCustomerAttachmentDownloadUrl(customerId, a.id)}" class="icon-btn" title="تحميل" style="color:var(--primary-color)" target="_blank"><i class="fa-solid fa-download"></i></a>
                                <button class="icon-btn btn-att-delete" data-id="${a.id}" data-name="${escapeHtml(a.file_name)}" title="حذف" style="color:var(--danger-color)"><i class="fa-solid fa-trash"></i></button>
                            </span>
                        </div>
                    `).join('');
                    container.querySelectorAll('.btn-att-delete').forEach(btn => {
                        btn.addEventListener('click', async () => {
                            if (!confirm(`حذف المرفق "${btn.dataset.name}"؟`)) return;
                            try {
                                await window.API.deleteCustomerAttachment(customerId, btn.dataset.id);
                                loadAttachmentList(customerId);
                            } catch (e) {
                                alert('خطأ: ' + e.message);
                            }
                        });
                    });
                } catch (e) {}
            };

            window.uploadAttachment = async function(customerId) {
                const input = document.getElementById('cf-attachment-file');
                const desc = document.getElementById('cf-attachment-desc');
                if (!input || !input.files || !input.files[0]) { alert('اختر ملفاً أولاً'); return; }
                const file = input.files[0];
                const maxSize = 5 * 1024 * 1024;
                if (file.size > maxSize) { alert('حجم الملف يجب أن لا يتجاوز 5 ميجابايت'); return; }
                const reader = new FileReader();
                reader.onload = async (e) => {
                    const base64 = e.target.result.split(',')[1];
                    try {
                        await window.API.uploadCustomerAttachment(customerId, file.name, base64, desc?.value || '');
                        alert('تم رفع الملف');
                        input.value = '';
                        if (desc) desc.value = '';
                        loadAttachmentList(customerId);
                    } catch (err) {
                        alert('خطأ في الرفع: ' + err.message);
                    }
                };
                reader.readAsDataURL(file);
            };
            window.openEditCustomerModal = window.openCustomerForm;

            // Wire "New Customer" button
            const newCustBtn = document.getElementById('btn-new-customer');
            if (newCustBtn) {
                if (!hasPerm('customers.create')) {
                    newCustBtn.style.display = 'none';
                } else {
                    newCustBtn.addEventListener('click', () => window.openCustomerForm());
                }
            }

            // Delete customer with confirmation
            window.deleteCustomerWithConfirm = async function(id, name) {
                if (!confirm(`هل أنت متأكد من حذف العميل "${name}"؟\n\nسيتم فحص التبعيات قبل الحذف.`)) return;
                try {
                    const res = await window.API.deleteCustomer(id);
                    if (res.success) {
                        initDataFromServer();
                    } else {
                        let msg = res.message || 'لا يمكن حذف العميل';
                        if (res.details) {
                            const reasons = Object.entries(res.details).filter(([k, v]) => v > 0).map(([k, v]) => `${k}: ${v}`);
                            if (reasons.length) msg += '\n\nالتبعيات:\n' + reasons.join('\n');
                        }
                        alert(msg);
                    }
                } catch (e) {
                    alert('خطأ: ' + e.message);
                }
            };

            window.toggleBlockCustomer = async function(id, name, isBlocked) {
                const action = isBlocked ? 'إلغاء حظر' : 'حظر';
                const reason = isBlocked ? '' : prompt(`أدخل سبب حظر العميل "${name}":`);
                if (!isBlocked && reason === null) return;
                if (!confirm(`هل أنت متأكد من ${action} العميل "${name}"؟`)) return;
                try {
                    const res = await window.API.blockCustomer(id, !isBlocked, reason || '');
                    if (res.success) {
                        initDataFromServer();
                    } else {
                        alert(res.message || 'فشلت العملية');
                    }
                } catch (e) {
                    alert('خطأ: ' + e.message);
                }
            };

            window.toggleActiveCustomer = async function(id, name, isActive) {
                const action = isActive ? 'إلغاء تنشيط' : 'تنشيط';
                if (!confirm(`هل أنت متأكد من ${action} العميل "${name}"؟`)) return;
                try {
                    const res = await window.API.toggleActiveCustomer(id, !isActive);
                    if (res.success) {
                        initDataFromServer();
                    } else {
                        alert(res.message || 'فشلت العملية');
                    }
                } catch (e) {
                    alert('خطأ: ' + e.message);
                }
            };

            // Export / Import handlers
            const exportBtn = document.getElementById('btn-export-customers');
            if (exportBtn) {
                if (hasPerm('customers.export')) {
                    exportBtn.style.display = '';
                    exportBtn.addEventListener('click', async () => {
                        try {
                            await window.API.exportCustomersCsv();
                        } catch (e) {
                            alert('خطأ في التصدير: ' + e.message);
                        }
                    });
                }
            }
            const importBtn = document.getElementById('btn-import-customers');
            if (importBtn) {
                if (hasPerm('customers.create')) {
                    importBtn.style.display = '';
                    importBtn.addEventListener('click', () => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = '.csv,.txt';
                        input.onchange = async (e) => {
                            const file = e.target.files[0];
                            if (!file) return;
                            const text = await file.text();
                            try {
                                const res = await window.API.importCustomersCsv(text);
                                alert(res.message || 'تم الاستيراد');
                                if (res.results && res.results.created > 0) initDataFromServer();
                            } catch (err) {
                                alert('خطأ في الاستيراد: ' + err.message);
                            }
                        };
                        input.click();
                    });
                }
            }

            // 3. Populate Products Table
            const prodTableBody = document.getElementById('products-table-body') || document.querySelector('#view-products tbody');
            
            function renderProductsTable(data) {
                if (!prodTableBody) return;
                if (!data || data.length === 0) {
                    prodTableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#888">لا يوجد أصناف مسجلة. اضغط "صنف جديد" لإضافة أول صنف.</td></tr>';
                    return;
                }
                prodTableBody.innerHTML = '';
                data.forEach(p => {
                    const stock = parseFloat(p.total_stock) || 0;
                    const stockClass = stock <= (parseFloat(p.min_stock) || 0) ? 'text-danger' : 'text-success';
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td><strong>${p.product_code}</strong></td>
                        <td>${p.product_name}</td>
                        <td>${p.unit_name || 'قطعة'}</td>
                        <td>${formatMoney(p.cost_price || 0)} ج.م</td>
                        <td style="color:var(--success-color);font-weight:bold">${formatMoney(p.sell_price || 0)} ج.م</td>
                        <td class="${stockClass}" style="font-weight:bold">${stock}</td>
                        <td>${p.min_stock || 0}</td>
                        <td class="actions-cell">
                            <button class="icon-btn btn-edit" title="تعديل"><i class="fa-solid fa-pen-to-square"></i></button>
                        </td>
                    `;
                    tr.querySelector('.btn-edit').addEventListener('click', () => openEditProductModal(p));
                    prodTableBody.appendChild(tr);
                });
            }
            renderProductsTable(products);
            
            // Search products
            const prodSearchInput = document.getElementById('products-search-input');
            if (prodSearchInput && !prodSearchInput.dataset.wired) {
                prodSearchInput.dataset.wired = '1';
                let prodSearchTimer;
                prodSearchInput.addEventListener('input', () => {
                    clearTimeout(prodSearchTimer);
                    prodSearchTimer = setTimeout(async () => {
                        const q = prodSearchInput.value.trim();
                        try {
                            const res = await fetch('/api/products' + (q ? '?q=' + encodeURIComponent(q) : ''));
                            const data = await res.json();
                            if (data.success) renderProductsTable(data.data);
                        } catch(e) { console.error(e); }
                    }, 300);
                });
            }

            // Add Product Button
            const btnAddProduct = document.getElementById('btn-add-product');
            if (btnAddProduct && !btnAddProduct.dataset.wired) {
                btnAddProduct.dataset.wired = '1';
                btnAddProduct.addEventListener('click', () => {
                    const modal = document.getElementById('global-modal');
                    if (!modal) return;
                    document.getElementById('modal-title').textContent = 'إضافة صنف جديد';
                    document.getElementById('modal-body').innerHTML = `
                        <div class="form-grid">
                            <div class="form-group"><label>اسم الصنف *</label><input type="text" id="np-name" placeholder="اسم الصنف" style="width:100%"></div>
                            <div class="form-group"><label>كود الصنف (اختياري)</label><input type="text" id="np-code" placeholder="يتولد تلقائياً إن تركته فارغاً" style="width:100%"></div>
                            <div class="form-group"><label>وحدة القياس</label><input type="text" id="np-unit" placeholder="قطعة" value="قطعة" style="width:100%"></div>
                            <div class="form-group"><label>باركود</label><input type="text" id="np-barcode" placeholder="اختياري" style="width:100%"></div>
                            <div class="form-group"><label>سعر التكلفة (ج.م) *</label><input type="number" id="np-cost" value="0" min="0" step="0.01" style="width:100%"></div>
                            <div class="form-group"><label>سعر البيع (ج.م) *</label><input type="number" id="np-sell" value="0" min="0" step="0.01" style="width:100%"></div>
                            <div class="form-group"><label>الحد الأدنى للمخزون</label><input type="number" id="np-min" value="0" min="0" style="width:100%"></div>
                        </div>`;
                    document.getElementById('btn-modal-save').onclick = async () => {
                        const name = document.getElementById('np-name').value.trim();
                        const cost = parseFloat(document.getElementById('np-cost').value) || 0;
                        const sell = parseFloat(document.getElementById('np-sell').value) || 0;
                        if (!name) { showAlert('اسم الصنف مطلوب', { title: 'تنبيه', type: 'warning', infoText: false }); return; }
                        if (sell <= 0) { showAlert('يجب إدخال سعر بيع صحيح', { title: 'تنبيه', type: 'warning', infoText: false }); return; }
                        const body = {
                            product_name: name,
                            product_code: document.getElementById('np-code').value.trim() || null,
                            unit_name: document.getElementById('np-unit').value.trim() || 'قطعة',
                            barcode: document.getElementById('np-barcode').value.trim() || null,
                            cost_price: cost,
                            sell_price: sell,
                            min_stock: parseFloat(document.getElementById('np-min').value) || 0
                        };
                        try {
                            const res = await window.API.request('/products', 'POST', body);
                            if (res.success) {
                                modal.classList.remove('active');
                                showAlert(`تم إضافة الصنف "${name}" بنجاح`, { title: 'تمت العملية', type: 'success', infoText: false });
                                initDataFromServer();
                            } else {
                                showAlert('خطأ: ' + res.message, { title: 'خطأ', type: 'error', infoText: false });
                            }
                        } catch(e) {
                            if (e.message) showAlert(e.message, { title: 'خطأ', type: 'error', infoText: false });
                        }
                    };
                    modal.classList.add('active');
                });
            }

            // Edit Product Modal
            window.openEditProductModal = function(p) {
                const modal = document.getElementById('global-modal');
                if (!modal) return;
                document.getElementById('modal-title').textContent = 'تعديل بيانات الصنف';
                document.getElementById('modal-body').innerHTML = `
                    <div class="form-grid">
                        <div class="form-group"><label>اسم الصنف</label><input type="text" id="ep-name" value="${p.product_name}" style="width:100%"></div>
                        <div class="form-group"><label>وحدة القياس</label><input type="text" id="ep-unit" value="${p.unit_name || 'قطعة'}" style="width:100%"></div>
                        <div class="form-group"><label>سعر التكلفة (ج.م)</label><input type="number" id="ep-cost" value="${p.cost_price || 0}" min="0" step="0.01" style="width:100%"></div>
                        <div class="form-group"><label>سعر البيع (ج.م)</label><input type="number" id="ep-sell" value="${p.sell_price || 0}" min="0" step="0.01" style="width:100%"></div>
                        <div class="form-group"><label>باركود</label><input type="text" id="ep-barcode" value="${p.barcode || ''}" style="width:100%"></div>
                        <div class="form-group"><label>الحد الأدنى للمخزون</label><input type="number" id="ep-min" value="${p.min_stock || 0}" min="0" style="width:100%"></div>
                    </div>`;
                document.getElementById('btn-modal-save').onclick = async () => {
                    const name = document.getElementById('ep-name').value.trim();
                    if (!name) { showAlert('الاسم مطلوب', { title: 'تنبيه', type: 'warning', infoText: false }); return; }
                    const body = { product_name: name, unit_name: document.getElementById('ep-unit').value, cost_price: document.getElementById('ep-cost').value, sell_price: document.getElementById('ep-sell').value, barcode: document.getElementById('ep-barcode').value, min_stock: document.getElementById('ep-min').value };
                    try {
                        const res = await window.API.request(`/products/${p.id}`, 'PUT', body);
                        if (res.success) { modal.classList.remove('active'); initDataFromServer(); }
                        else showAlert('خطأ: ' + res.message, { title: 'خطأ', type: 'error', infoText: false });
                    } catch (e) {
                        if (e.message) showAlert(e.message, { title: 'خطأ', type: 'error', infoText: false });
                    }
                };
                modal.classList.add('active');
            };

            // 4. Populate Inventory Table
            const invTableBody = document.querySelector('#view-inventory tbody');
            if (invTableBody) {
                invTableBody.innerHTML = '';
                products.forEach(p => {
                    const stock = parseFloat(p.total_stock) || 0;
                    const min = parseFloat(p.min_stock) || 0;
                    let statusBadge = '<span class="badge-status paid">متوفر</span>';
                    if (stock <= min) statusBadge = '<span class="badge-status overdue">ناقص</span>';
                    
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>${p.product_code}</td>
                        <td>${p.product_name}</td>
                        <td>${p.unit_name || 'قطعة'}</td>
                        <td class="${stock <= min ? 'text-danger' : 'text-success'}" style="font-weight:bold">${stock}</td>
                        <td>${min}</td>
                        <td>${statusBadge}</td>
                    `;
                    invTableBody.appendChild(tr);
                });
            }

            // 5. Make Invoice Customer Select Searchable
            const invoiceCustSelect = document.querySelector('#inv-customer');
            if (invoiceCustSelect) {
                invoiceCustSelect.innerHTML = '<option value="">-- اختر العميل --</option>';
                mappedCustomers.forEach(c => {
                    invoiceCustSelect.innerHTML += `<option value="${c.id}">${c.name}</option>`;
                });
                makeSearchableSelect(invoiceCustSelect, mappedCustomers, "ابحث عن عميل (الاسم أو الكود)...");
            }

            // 6. Make Reports Customer Select Searchable
            const reportCustSelect = document.querySelector('#reports-cust-select');
            if (reportCustSelect) {
                reportCustSelect.innerHTML = '<option value="">الكل</option>';
                mappedCustomers.forEach(c => {
                    reportCustSelect.innerHTML += `<option value="${c.id}">${c.name}</option>`;
                });
                makeSearchableSelect(reportCustSelect, mappedCustomers, "ابحث عن عميل لطباعة كشف حسابه...");
            }

            // Fetch settings
            const settingsRes = await window.API.getSettings();
            let settingsObj = {};
            if (settingsRes.success && settingsRes.data) {
                settingsObj = settingsRes.data;
            }

            // Fetch stores
            const storesRes = await window.API.getStores();
            let storesArr = [];
            if (storesRes.success && storesRes.data) {
                storesArr = storesRes.data;
                const populateStoreSelect = (id) => {
                    const sel = document.getElementById(id);
                    if (sel) {
                        if (!sel.dataset) sel.dataset = {};
                        if (sel.dataset.searchable) { console.log(`[TRACE] populateStoreSelect(${id}): SKIP — already searchable`); return; }
                        sel.dataset.searchable = '1';
                        sel.innerHTML = '';
                        storesArr.forEach(st => {
                            sel.innerHTML += `<option value="${st.id}">${st.store_name}</option>`;
                        });
                        console.log(`[TRACE] populateStoreSelect(${id}): inserted ${sel.options.length} options into native select`);
                    } else {
                        console.log(`[TRACE] populateStoreSelect(${id}): Element NOT FOUND`);
                    }
                };
                populateStoreSelect('inv-store');
                populateStoreSelect('pinv-store');
                const invStoreSel = document.getElementById('inv-store');
                if (invStoreSel) { makeSearchableSelect(invStoreSel, storesArr.map(s => ({id: s.id, name: s.store_name})), 'ابحث عن مخزن...'); console.log(`[TRACE] inv-store: makeSearchableSelect called, wrapper=`, invStoreSel.nextElementSibling?.className); } else { console.log(`[TRACE] inv-store: Element NOT FOUND for makeSearchableSelect`); }
                const pinvStoreSel = document.getElementById('pinv-store');
                if (pinvStoreSel) { makeSearchableSelect(pinvStoreSel, storesArr.map(s => ({id: s.id, name: s.store_name})), 'ابحث عن مخزن...'); console.log(`[TRACE] pinv-store: makeSearchableSelect called, wrapper=`, pinvStoreSel.nextElementSibling?.className); } else { console.log(`[TRACE] pinv-store: Element NOT FOUND for makeSearchableSelect`); }
            }

            // Store globally for quick access
            window.AppData = { customers: mappedCustomers, products: products, settings: settingsObj, stores: storesArr };
            
            // 7. Populate Products Datalist for Search
            const productsList = document.getElementById('products-list');
            if (productsList) {
                productsList.innerHTML = '';
                products.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = `${p.product_code} | ${p.product_name}`;
                    productsList.appendChild(opt);
                });
            }

            // Fetch sales reps
            try {
                console.log('[TRACE] initReps: calling API.getSalesReps()...');
                const repsRes = await window.API.getSalesReps();
                console.log('[TRACE] initReps: API returned', repsRes?.data?.length || 0, 'reps, success=', repsRes?.success);
                if (repsRes.success) {
                    const reps = repsRes.data;
                    const invRepSelect = document.getElementById('inv-rep');
                    if (invRepSelect) {
                        invRepSelect.innerHTML = '<option value="">-- اختر المندوب --</option>';
                        reps.forEach(r => {
                            invRepSelect.innerHTML += `<option value="${r.id}">${r.rep_name}</option>`;
                        });
                        console.log('[TRACE] initReps: inv-rep now has', invRepSelect.options.length, 'options in native select');
                        if (!invRepSelect.dataset.searchable) {
                            makeSearchableSelect(invRepSelect, reps.map(r => ({id: r.id, name: r.rep_name})), "ابحث عن مندوب...");
                            invRepSelect.dataset.searchable = '1';
                            console.log('[TRACE] initReps: makeSearchableSelect called for inv-rep, nextSibling=', invRepSelect.nextElementSibling?.className);
                        } else {
                            console.log('[TRACE] initReps: inv-rep already has searchable wrapper, skipping');
                        }
                        console.log('[TRACE] initReps: FINAL — native options=', invRepSelect.options.length, 'wrapper exists=', !!invRepSelect.nextElementSibling?.classList?.contains('custom-select-wrapper'));
                    } else {
                        console.log('[TRACE] initReps: inv-rep element NOT FOUND in DOM');
                    }
                }
            } catch (e) { console.error('[TRACE] initReps: ERROR', e); }

            // Cache suppliers for dropdowns
            try {
                const supRes = await window.API.getSuppliers({active: '1', limit: '500'});
                window._cachedSuppliers = supRes.data || [];
                if (!window.AppData) window.AppData = {};
                window.AppData.suppliers = window._cachedSuppliers.map(s => ({id: s.id, name: s.supplier_name}));
            } catch (e) {
                console.error("Suppliers preload failed", e);
                window._cachedSuppliers = [];
                if (!window.AppData) window.AppData = {};
                window.AppData.suppliers = [];
            }

        } catch (err) {
            console.error("Failed to load initial data:", err);
        } finally {
            // Hide global loader smoothly
            setTimeout(() => {
                const loader = document.getElementById('global-loader');
                if (loader) loader.classList.add('hidden');
            }, 600);
        }
    }

    window.initDataFromServer = initDataFromServer;

    // Don't load protected data before login — checkAuth/handleLogin will call this


    // ============================================================
    // 2. SIDEBAR TOGGLE (MOBILE ONLY)
    // ============================================================
    const sidebar = document.getElementById('sidebar');
    const toggleSidebarBtn = document.getElementById('toggleSidebar');
    if (toggleSidebarBtn && sidebar) {
        const backdrop = document.createElement('div');
        backdrop.className = 'sidebar-backdrop';
        document.body.appendChild(backdrop);

        toggleSidebarBtn.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                sidebar.classList.toggle('open');
                backdrop.classList.toggle('active');
                document.body.style.overflow = sidebar.classList.contains('open') ? 'hidden' : '';
            }
        });
        backdrop.addEventListener('click', () => {
            sidebar.classList.remove('open');
            backdrop.classList.remove('active');
            document.body.style.overflow = '';
        });
        document.addEventListener('click', (e) => {
            if (window.innerWidth <= 768 && !sidebar.contains(e.target) && !toggleSidebarBtn.contains(e.target)) {
                sidebar.classList.remove('open');
                backdrop.classList.remove('active');
                document.body.style.overflow = '';
            }
        });
    }

    const navItems = document.querySelectorAll('.nav-item[data-target]');
    const breadcrumb = document.getElementById('breadcrumb');
    openActiveGroup();

    document.querySelectorAll('.view').forEach(v => { if (!v.classList.contains('active-view')) v.style.display = 'none'; });

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();

            // Update active nav
            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');

            // Update breadcrumb
            if (breadcrumb) {
                breadcrumb.textContent = item.querySelector('span') ? item.querySelector('span').textContent : '';
            }

            const targetId = item.getAttribute('data-target');
            localStorage.setItem('activeView', targetId);

            // Hide all views
            document.querySelectorAll('.view').forEach(v => {
                v.classList.remove('active-view');
                v.style.display = 'none';
            });

            // Show target view — remove inline display so CSS .active-view (flex) takes effect
            const targetView = document.getElementById('view-' + targetId);
            if (targetView) {
                targetView.dataset.bound = '';
                targetView.style.display = '';
                targetView.classList.add('active-view');
                
                // Trigger loaders if they exist
                if (targetId === 'dashboard' && typeof window.loadDashboard === 'function') {
                    window.loadDashboard();
                }
                if (targetId === 'collections' && typeof window.loadCollections === 'function') {
                    window.loadCollections();
                }
                if (targetId === 'aging' && typeof window.loadAging === 'function') {
                    window.loadAging();
                }
                if (targetId === 'sales-invoice' && typeof window.loadSalesInvoicesList === 'function') {
                    window.loadSalesInvoicesList();
                }
                if (targetId === 'sales-return' && typeof window.initSalesReturn === 'function') {
                    window.initSalesReturn();
                }
                if (targetId === 'ar-payment' && typeof window.initArPayment === 'function') {
                    window.initArPayment();
                }
                if (targetId === 'ar-cheques' && typeof window.initArCheques === 'function') {
                    window.initArCheques();
                }
                if (targetId === 'ar-security-cheques' && typeof window.initArSecurityCheques === 'function') {
                    window.initArSecurityCheques();
                }
                if (targetId === 'ar-notice' && typeof window.initArNotice === 'function') {
                    window.initArNotice();
                }
                if (targetId === 'ar-matching' && typeof window.initArMatching === 'function') {
                    window.initArMatching();
                }
                if (targetId === 'ap-payment' && typeof window.initApPayment === 'function') {
                    window.initApPayment();
                }
                if (targetId === 'ap-cheques' && typeof window.initApCheques === 'function') {
                    window.initApCheques();
                }
                if (targetId === 'ap-notice' && typeof window.initApNotice === 'function') {
                    window.initApNotice();
                }
                if (targetId === 'ap-matching' && typeof window.initApMatching === 'function') {
                    window.initApMatching();
                }
                if (targetId === 'supplier-payments' && typeof window.loadSupplierPayments === 'function') {
                    window.loadSupplierPayments();
                }
                if (targetId === 'stores-management' && typeof window.loadStoresManagement === 'function') {
                    window.loadStoresManagement();
                }
                if (targetId === 'suppliers') {
                    if (typeof window.loadSuppliersList === 'function') {
                        window.loadSuppliersList();
                    }
                }
                if (targetId === 'reports-purchases' && typeof window.initPurchasesReport === 'function') {
                    window.initPurchasesReport();
                }
                if (targetId === 'purchase-invoice') {
                    if (typeof window.initPurchaseInvoice === 'function') window.initPurchaseInvoice();
                    if (typeof window.loadPurchaseInvoicesList === 'function') window.loadPurchaseInvoicesList();
                }
                if (targetId === 'purchase-return') {
                    if (typeof window.initPurchaseReturn === 'function') window.initPurchaseReturn();
                    if (typeof window.loadPurchaseReturnsList === 'function') window.loadPurchaseReturnsList();
                }
                if (targetId === 'reports-inventory' && typeof window.initInventoryReport === 'function') {
                    window.initInventoryReport();
                }
                if (targetId === 'inventory-card' && typeof window.initInventoryCard === 'function') {
                    window.initInventoryCard();
                }
                if (targetId === 'inventory-transfers' && typeof window.initInventoryTransfers === 'function') {
                    window.initInventoryTransfers();
                }
                if (targetId === 'inventory-damaged' && typeof window.initInventoryDamaged === 'function') {
                    window.initInventoryDamaged();
                }
                if (targetId === 'activity-logs' && typeof window.loadActivityLogs === 'function') {
                    window.loadActivityLogs();
                }
            }

            // Close sidebar on mobile
            if (window.innerWidth <= 768 && sidebar) {
                sidebar.classList.remove('open');
                const bd = document.querySelector('.sidebar-backdrop');
                if (bd) bd.classList.remove('active');
                document.body.style.overflow = '';
            }
        });
        });



    // Saved view is restored after login via showApp -> restoreSavedView()

    // ============================================================
    // 5. SALES INVOICE (Validation on INV NO)
    // ============================================================
    const invNoInput = document.getElementById('inv-no');
    if (invNoInput) {
        invNoInput.addEventListener('blur', async () => {
            const val = invNoInput.value.trim();
            if (!val) return;
            const fullInvNo = `INV-${val.replace(/^INV-/, '')}`;
            try {
                const res = await window.API.getSalesInvoices({ q: fullInvNo });
                if (res.success && res.data && res.data.length > 0) {
                    const exists = res.data.find(i => i.invoice_no === fullInvNo);
                    if (exists) {
                        alert('تنبيه: الفاتورة بهذا الرقم (' + fullInvNo + ') موجودة مسبقاً في النظام. الرجاء تغيير الرقم لتجنب التكرار.');
                        invNoInput.value = '';
                        invNoInput.focus();
                    }
                }
            } catch (e) { console.error(e); }
        });
    }

    // ============================================================
    // 5. SALES INVOICE - Dynamic Rows + Calculations
    // ============================================================
    const invoiceBody = document.getElementById('invoice-items-body');
    const btnAddRow = document.getElementById('btn-add-row');
    const globalDiscountInput = document.getElementById('global-discount');
    const amountPaidInput = document.getElementById('amount-paid');

    function calcInvoice() {
        if (!invoiceBody) return;
        let subtotal = 0;
        invoiceBody.querySelectorAll('.invoice-row').forEach(row => {
            const searchInput = row.querySelector('.item-search');
            let product = null;
            if (searchInput && searchInput.value && window.AppData?.products) {
                const parts = searchInput.value.split('|').map(s => s.trim());
                product = window.AppData.products.find(p => p.product_code === parts[0] || p.product_name === searchInput.value.trim());
            }

            const qtyInput = row.querySelector('.item-qty');
            const priceInput = row.querySelector('.item-price');
            const discInput = row.querySelector('.item-discount');
            
            // Auto-fill price and show stock if product found and price is 0
            if (product && searchInput.dataset.lastVal !== searchInput.value) {
                searchInput.dataset.lastVal = searchInput.value;
                if (!parseFloat(priceInput.value)) {
                    priceInput.value = product.sell_price;
                }
                searchInput.title = `الرصيد المتاح: ${product.total_stock || 0}`;
                searchInput.dataset.productId = product.id;
                searchInput.dataset.stock = product.total_stock;
            } else if (!product) {
                searchInput.dataset.productId = '';
                searchInput.title = '';
            }

            let qty = parseFloat(qtyInput?.value) || 0;
            const price = parseFloat(priceInput?.value) || 0;
            const disc = parseFloat(discInput?.value) || 0;
            
            // Stock warning style
            if (product && qty > (product.total_stock || 0)) {
                qtyInput.style.backgroundColor = '#ffebee';
                qtyInput.title = 'تنبيه: الكمية المطلوبة تتجاوز رصيد المخزن!';
            } else if (qtyInput) {
                qtyInput.style.backgroundColor = '';
                qtyInput.title = '';
            }

            const lineTotal = qty * price * (1 - disc / 100);
            const totalCell = row.querySelector('.item-total');
            if (totalCell) totalCell.value = lineTotal.toFixed(2);
            subtotal += lineTotal;
        });
        const globalDisc = parseFloat(globalDiscountInput?.value) || 0;
        const afterDisc = subtotal * (1 - globalDisc / 100);
        
        const invType = document.getElementById('inv-type')?.value || 'normal';
        let taxRate = 14;
        if (window.AppData && window.AppData.settings && window.AppData.settings.tax_rate) {
            taxRate = parseFloat(window.AppData.settings.tax_rate);
        }
        const tax = invType === 'tax' ? afterDisc * (taxRate / 100) : 0;
        
        const grand = afterDisc + tax;
        const paid = parseFloat(amountPaidInput?.value) || 0;
        const remaining = grand - paid;
        if (document.getElementById('subtotal')) document.getElementById('subtotal').innerHTML =formatMoney(subtotal) + ' ج.م';
        if (document.getElementById('tax-amount')) document.getElementById('tax-amount').innerHTML =formatMoney(tax) + ' ج.م';
        if (document.getElementById('grand-total')) document.getElementById('grand-total').innerHTML =formatMoney(grand) + ' ج.م';
        if (document.getElementById('remaining')) document.getElementById('remaining').innerHTML =formatMoney(remaining) + ' ج.م';
    }

    if (document.getElementById('inv-type')) document.getElementById('inv-type').addEventListener('change', calcInvoice);


    if (invoiceBody) {
        invoiceBody.addEventListener('input', (e) => {
            if (e.target.classList.contains('calc-trigger')) calcInvoice();
        });
        invoiceBody.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-remove-row');
            if (btn) {
                btn.closest('tr').remove();
                calcInvoice();
            }
        });
    }
    if (globalDiscountInput) globalDiscountInput.addEventListener('input', calcInvoice);
    if (amountPaidInput) amountPaidInput.addEventListener('input', calcInvoice);

    // ============================================================
    // 5.1 UNDO & KEYBOARD SHORTCUTS LOGIC
    // ============================================================
    function saveInvoiceState() {
        if (!invoiceBody) return;
        // Keep last 20 states
        if (invoiceHistory.length > 20) invoiceHistory.shift();
        
        // Save the outerHTML of all rows
        const currentState = [];
        invoiceBody.querySelectorAll('.invoice-row').forEach(row => {
            currentState.push({
                qty: row.querySelector('.item-qty').value,
                price: row.querySelector('.item-price').value,
                discount: row.querySelector('.item-discount').value,
                search: row.querySelector('.item-search').value
            });
        });
        invoiceHistory.push(currentState);
    }
    
    function restoreInvoiceState() {
        if (!invoiceBody || invoiceHistory.length === 0) return;
        
        const lastState = invoiceHistory.pop();
        invoiceBody.innerHTML = ''; // Clear current
        
        lastState.forEach((stateObj, index) => {
            const tr = document.createElement('tr');
            tr.className = 'invoice-row';
            tr.innerHTML = `
                <td>${index + 1}</td>
                <td><input type="text" class="item-search calc-trigger" list="products-list" placeholder="ابحث عن صنف..." value="${stateObj.search}"></td>
                <td><input type="number" class="item-qty calc-trigger" value="${stateObj.qty}" min="1"></td>
                <td><input type="number" class="item-price calc-trigger" value="${stateObj.price}" min="0"></td>
                <td><input type="number" class="item-discount calc-trigger" value="${stateObj.discount}" min="0" max="100"></td>
                <td><input type="text" class="item-total disabled-input" value="0.00" disabled></td>
                <td class="actions-cell"><button class="icon-btn text-danger btn-remove-row"><i class="fa-solid fa-trash"></i></button></td>
            `;
            invoiceBody.appendChild(tr);
        });
        calcInvoice();
    }

    // Capture Undo (Ctrl+Z)
    document.addEventListener('keydown', (e) => {
        // Ctrl+Z Undo for Invoice
        if (e.ctrlKey && e.key.toLowerCase() === 'z') {
            const activeView = document.querySelector('.active-view');
            if (activeView && activeView.id === 'view-sales-invoice') {
                e.preventDefault();
                restoreInvoiceState();
            }
        }
        
        // F2 to Save
        if (e.key === 'F2') {
            e.preventDefault();
            const saveBtn = document.getElementById('btn-save-invoice');
            if (saveBtn) saveBtn.click();
        }
        
        // F3 to Save & Print
        if (e.key === 'F3') {
            e.preventDefault();
            const printBtn = document.getElementById('btn-save-print-invoice');
            if (printBtn) printBtn.click();
        }
    });

    if (btnAddRow && invoiceBody) {
        btnAddRow.addEventListener('click', () => {
            saveInvoiceState(); // Save state before adding row
            const rowCount = invoiceBody.querySelectorAll('.invoice-row').length + 1;
            const tr = document.createElement('tr');
            tr.className = 'invoice-row';
            tr.innerHTML = `
                <td>${rowCount}</td>
                <td><input type="text" class="item-search calc-trigger" list="products-list" placeholder="ابحث عن صنف..."></td>
                <td><input type="number" class="item-qty calc-trigger" value="1" min="1"></td>
                <td><input type="number" class="item-price calc-trigger" value="0" min="0"></td>
                <td><input type="number" class="item-discount calc-trigger" value="0" min="0" max="100"></td>
                <td><input type="text" class="item-total disabled-input" value="0.00" disabled></td>
                <td class="actions-cell"><button class="icon-btn text-danger btn-remove-row"><i class="fa-solid fa-trash"></i></button></td>
            `;
            invoiceBody.appendChild(tr);
        });
    }

    // Barcode Scanner Logic (Simulated by rapid typing ending with Enter)
    let barcodeString = '';
    let barcodeTimer;
    document.addEventListener('keypress', (e) => {
        const activeView = document.querySelector('.active-view');
        if (activeView && activeView.id === 'view-sales-invoice') {
            // If typing rapidly
            if (barcodeTimer) clearTimeout(barcodeTimer);
            if (e.key === 'Enter') {
                e.preventDefault();
                if (barcodeString.length > 3) {
                    saveInvoiceState();
                    // Auto add row and put barcode in it
                    btnAddRow.click();
                    const rows = invoiceBody.querySelectorAll('.invoice-row');
                    const lastRowSearch = rows[rows.length - 1].querySelector('.item-search');
                    if (lastRowSearch) lastRowSearch.value = barcodeString;
                    barcodeString = '';
                }
            } else {
                barcodeString += e.key;
                barcodeTimer = setTimeout(() => { barcodeString = ''; }, 100); // Reset if slow typing
            }
        }
    });

    if (invoiceBody) {
        invoiceBody.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-remove-row');
            if (btn) {
                saveInvoiceState(); // Save state before removing row
                btn.closest('tr').remove();
                calcInvoice();
            }
        });
    }


    // NOTE: Legacy purchase invoice handler REMOVED.
    // All purchase invoice functionality is now handled by
    // initPurchaseInvoice() at line ~3022.

    // Set today's date on date fields
    document.querySelectorAll('input[type="date"]').forEach(d => {
        if (!d.value) {
            if (d.id && (d.id.includes('from') || d.id.includes('start'))) {
                d.value = new Date().getFullYear() + '-01-01';
            } else {
                d.value = new Date().toISOString().split('T')[0];
            }
        }
        });



    // ============================================================
    // 7. PRINTING
    // ============================================================

    const btnSavePrintInvoice = document.getElementById('btn-save-print-invoice');
    if (btnSavePrintInvoice) {
        btnSavePrintInvoice.addEventListener('click', async () => {
            // Trigger save, and tell it to print on success
            const btnSaveInvoice = document.getElementById('btn-save-invoice');
            if (btnSaveInvoice) {
                // We can set a flag on window to print after save
                window._printAfterSave = true;
                btnSaveInvoice.click();
            }
        });
    }

    // ============================================================
    // 8. FINANCIAL STATEMENT ENGINE (Running Balance Logic)
    // ============================================================
    const btnRunStatement = document.getElementById('btn-run-sales-statement');
    const custSelectReports = document.getElementById('reports-cust-select');
    const tbodyStatement = document.getElementById('report-sales-tbody');
    const tfootStatement = document.getElementById('report-sales-tfoot');
    
    if (btnRunStatement && tbodyStatement) {
        btnRunStatement.addEventListener('click', () => {
            const custId = custSelectReports.value;
            const fromDate = document.getElementById('reports-from-date').value;
            const toDate = document.getElementById('reports-to-date').value;
            const invType = document.getElementById('reports-inv-type')?.value || '';
            
            if (!custId) {
                alert("الرجاء اختيار العميل أولاً");
                return;
            }

            // Real API Call
            const btnOriginalText = btnRunStatement.innerHTML;
            btnRunStatement.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري التحميل...';
            btnRunStatement.disabled = true;

            window.API.getCustomerStatement(custId, fromDate, toDate, invType).then(res => {
                // api.js يرجع {success, data} حيث data فيها customer, rows, ...
                const payload = res.data || res;
                const customer = payload.customer;
                const lines = payload.rows || payload.lines || [];
                const custName = customer ? customer.customer_name : "عميل غير معروف";

                document.getElementById('report-sales-title').textContent = `كشف حساب عميل - ${custName}`;
                tbodyStatement.innerHTML = '';

                let currentBalance = 0;
                let totalDebit = 0;
                let totalCredit = 0;

                if (lines.length === 0) {
                    tbodyStatement.innerHTML = '<tr><td colspan="6" class="text-center">لا توجد بيانات لعرضها المرجو التأكد أو البحث مجدداً</td></tr>';
                }

                lines.forEach(trx => {
                    const debit = parseFloat(trx.debit) || 0;
                    const credit = parseFloat(trx.credit) || 0;
                    totalDebit += debit;
                    totalCredit += credit;
                    currentBalance = trx.running_balance !== undefined ? trx.running_balance : (trx.balance !== undefined ? trx.balance : currentBalance + debit - credit);

                    const balColor = currentBalance > 0 ? 'color:var(--danger-color);' : (currentBalance < 0 ? 'color:var(--success-color);' : '');
                    const debitColor = debit > 0 ? 'color:var(--danger-color);' : '';
                    const creditColor = credit > 0 ? 'color:var(--success-color);' : '';

                    const formatNum = (num) => num === 0 ? "-" : num.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});

                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td style="font-weight:bold; ${balColor}">${formatNum(Math.abs(currentBalance))}</td>
                        <td style="${creditColor}">${formatNum(credit)}</td>
                        <td style="${debitColor}">${formatNum(debit)}</td>
                        <td>${trx.doc_no || '-'}</td>
                        <td>${trx.type || trx.doc_type || '-'}</td>
                        <td>${trx.date || trx.trans_date || '-'}</td>
                    `;
                    tbodyStatement.appendChild(tr);
                });

                // ----------------------------------------------------
                // 3. Update Footer Totals
                // ----------------------------------------------------
                if (tfootStatement) {
                    tfootStatement.style.display = 'table-footer-group';
                    
                    const formatNum = (num) => num === 0 ? "0.00" : num.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
                    
                    const finalBalElem = document.getElementById('stmt-total-balance');
                    finalBalElem.textContent = formatNum(Math.abs(currentBalance));
                    finalBalElem.style.color = currentBalance > 0 ? 'var(--danger-color)' : (currentBalance < 0 ? 'var(--success-color)' : '');

                    document.getElementById('stmt-total-debit').textContent = formatNum(totalDebit);
                    document.getElementById('stmt-total-credit').textContent = formatNum(totalCredit);
                }
            }).catch(err => {
                console.error(err);
            }).finally(() => {
                btnRunStatement.innerHTML = btnOriginalText;
                btnRunStatement.disabled = false;
            });
        });
    }

    // ============================================================
    // 8. SIMULATED SAVE / ADD LOGIC (API Wiring)
    // ============================================================
    
    // Save Sales Invoice
    const btnSaveInvoice = document.getElementById('btn-save-invoice');
    if (btnSaveInvoice) {
        btnSaveInvoice.addEventListener('click', async () => {
            // Check if there are items
            if (!invoiceBody || invoiceBody.querySelectorAll('.invoice-row').length === 0) {
                alert('عفواً، لا يمكن حفظ فاتورة فارغة. الرجاء إضافة أصناف أولاً.');
                return;
            }
            
            // Collect Data
            const customerId = document.getElementById('inv-customer')?.value;
            if (!customerId) {
                alert('الرجاء اختيار العميل أولاً');
                return;
            }

            const items = [];
            let valid = true;
            for (const row of invoiceBody.querySelectorAll('.invoice-row')) {
                const searchInput = row.querySelector('.item-search');
                const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
                const price = parseFloat(row.querySelector('.item-price').value) || 0;
                const discount = parseFloat(row.querySelector('.item-discount').value) || 0;
                
                const productId = searchInput.dataset.productId;
                const stock = parseFloat(searchInput.dataset.stock) || 0;

                // Skip completely empty rows
                if (!productId && searchInput.value.trim() === '') {
                    continue;
                }

                if (!productId) {
                    showAlert('هناك صنف غير صحيح أو لم يتم اختياره من القائمة', { title: 'تنبيه', type: 'warning', infoText: false });
                    valid = false;
                    break;
                }
                
                if (qty <= 0) {
                    showAlert('يجب إدخال كمية صحيحة للصنف', { title: 'تنبيه', type: 'warning', infoText: false });
                    valid = false;
                    break;
                }

                // Check stock for sales
                if (qty > stock) {
                    const goOn = await showConfirm(`الكمية المطلوبة من ${searchInput.value} أكبر من الرصيد المتاح (${stock})`, {
                        title: 'تحذير: نقص في المخزون',
                        infoText: 'الاستمرار سيؤدي إلى رصيد سالب في المخزون.'
                    });
                    if (!goOn) {
                        valid = false;
                        break;
                    }
                }

                items.push({
                    product_id: parseInt(productId),
                    quantity: qty,
                    unit_price: price,
                    discount_pct: discount
                });
            }

            if (!valid) return;
            
            if (items.length === 0) {
                showAlert('عفواً، لا يمكن حفظ فاتورة فارغة. الرجاء إضافة أصناف صحيحة.', { title: 'تنبيه', type: 'warning', infoText: false });
                return;
            }

            const globalDisc = parseFloat(document.getElementById('global-discount')?.value) || 0;
            const amountPaid = parseFloat(document.getElementById('amount-paid')?.value) || 0;
            const invType = document.getElementById('inv-type')?.value || 'normal';
            
            // Recalculate subtotal for tax
            let subtotalForTax = 0;
            items.forEach(it => {
                subtotalForTax += (it.quantity * it.unit_price) * (1 - it.discount_pct / 100);
            });
            const afterDiscForTax = subtotalForTax * (1 - globalDisc / 100);
            let taxRate = 14;
            if (window.AppData && window.AppData.settings && window.AppData.settings.tax_rate) {
                taxRate = parseFloat(window.AppData.settings.tax_rate);
            }
            const taxAmount = invType === 'tax' ? afterDiscForTax * (taxRate / 100) : 0;
            
            const grandTotal = afterDiscForTax + taxAmount;
            
            if (amountPaid > grandTotal + 0.01) {
                showAlert('المبلغ المدفوع لا يمكن أن يكون أكبر من إجمالي الفاتورة', { title: 'تنبيه', type: 'warning', infoText: false });
                return;
            }

            // Get payment type from select, but allow logic to override if fully paid
            let payType = document.getElementById('inv-paytype')?.value || 'credit';
            if (amountPaid > 0 && amountPaid >= grandTotal) {
                payType = 'cash';
            }

            const invoiceData = {
                invoice_no: document.getElementById('inv-no')?.value ? `INV-${document.getElementById('inv-no').value.replace(/^INV-/, '')}` : null,
                customer_id: customerId,
                invoice_date: document.getElementById('inv-date')?.value || new Date().toISOString().slice(0, 10),
                store_id: document.getElementById('inv-store')?.value ? parseInt(document.getElementById('inv-store').value) : (window.AppData?.stores?.[0]?.id || 1),
                payment_type: payType,
                invoice_type: invType,
                rep_id: document.getElementById('inv-rep')?.value,
                discount_pct: globalDisc,
                tax_amount: taxAmount,
                amount_paid: amountPaid,
                items: items
            };
            
            // Show loading state
            const originalText = btnSaveInvoice.innerHTML;
            btnSaveInvoice.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';
            btnSaveInvoice.disabled = true;

            try {
                const res = await window.API.saveSalesInvoice(invoiceData, window.editingInvoiceId);

                // Reset editing flag
                window.editingInvoiceId = null;

                // Check credit limit warning from server
                if (res.creditWarning) {
                    showAlert(`⚠️ تنبيه: العميل تجاوز حده الائتماني!\nالرصيد الحالي: ${formatMoney(res.newBalance||0)} ج.م\nالحد الائتماني: ${formatMoney(res.creditLimit||0)} ج.م`, { type: 'warning' });
                }

                // Show success with print button
                const invoiceArea = document.getElementById('view-sales-invoice');
                const successBanner = document.createElement('div');
                successBanner.className = 'alert-success-banner';
                successBanner.style.cssText = 'background:#d1fae5;border:1px solid #10b981;border-radius:8px;padding:12px 18px;margin:10px 0;display:flex;justify-content:space-between;align-items:center;';
                successBanner.innerHTML = `<span style="color:#065f46;font-weight:bold">✅ تم حفظ الفاتورة رقم: ${res.invoiceNo}</span><button onclick="window.API.openInvoicePrint(${res.invoiceId})" class="btn btn-primary" style="padding:6px 14px;font-size:0.85rem"><i class="fa-solid fa-print"></i> طباعة</button>`;
                if (invoiceArea) invoiceArea.prepend(successBanner);
                setTimeout(() => successBanner.remove(), 8000);

                if (window._printAfterSave) {
                    window.API.openInvoicePrint(res.invoiceId);
                    window._printAfterSave = false;
                }

                // Clear invoice
                invoiceBody.innerHTML = '';
                if(document.getElementById('inv-customer')) document.getElementById('inv-customer').value = '';
                if(document.getElementById('global-discount')) document.getElementById('global-discount').value = '';
                if(document.getElementById('amount-paid')) document.getElementById('amount-paid').value = '';
                calcInvoice();
                initDataFromServer(); // refresh balances
            } catch (err) {
                // API error already logged and alerted by wrapper
            } finally {
                btnSaveInvoice.innerHTML = originalText;
                btnSaveInvoice.disabled = false;
            }
        });
    }


    // ============================================================
    // 9. GLOBAL MODAL INTERACTIVITY
    // ============================================================
    const globalModal = document.getElementById('global-modal');
    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');
    const btnModalSave = document.getElementById('btn-modal-save');
    
    // Close Modal Logic
    document.querySelectorAll('.btn-close-modal').forEach(btn => {
        btn.addEventListener('click', () => {
            if (globalModal) globalModal.classList.remove('active');
        });
    });

    // Handle all generic Add buttons (e.g. New Customer, New Supplier)
    document.querySelectorAll('.btn-primary').forEach(btn => {
        if (!btn.dataset.action && btn.id !== 'btn-save-invoice' && btn.id !== 'btn-add-row' && btn.id !== 'btn-add-prow' && btn.id !== 'btn-modal-save' && btn.id !== 'btn-add-user' && btn.id !== 'btn-add-product' && btn.id !== 'stab-btn-add-rep' && btn.id !== 'stab-btn-add-user' && btn.id !== 'btn-new-transfer' && btn.id !== 'btn-new-disposal') {
            btn.addEventListener('click', (e) => {
                const btnText = btn.textContent.trim();
                
                if (btnText.includes('إضافة') || btnText.includes('جديد')) {
                    // Open Modal
                    if (globalModal) {
                        modalTitle.textContent = btnText;
                        const saveBtn = document.getElementById('btn-modal-save');
                        if (saveBtn) saveBtn.style.display = ''; // Reset display
                        
                        // Dynamically generate form based on context
                        if (btnText.includes('عميل')) {
                            btnModalSave.onclick = null;
                            if (typeof window.openCustomerForm === 'function') {
                                window.openCustomerForm();
                            }
                            return;
                        } else if (btnText.includes('تحصيل')) {
                            // NEW COLLECTION MODAL
                            const custOptions = window.AppData?.customers?.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
                            modalBody.innerHTML = `
                                <div class="form-grid">
                                    <div class="form-group"><label>العميل</label><select id="modal-col-customer"><option value="">-- اختر العميل --</option>${custOptions}</select></div>
                                    <div class="form-group"><label>المبلغ (ج.م)</label><input type="number" id="modal-col-amount" min="1" value="0"></div>
                                    <div class="form-group"><label>التاريخ</label><input type="date" id="modal-col-date" value="${new Date().toISOString().slice(0,10)}"></div>
                                    <div class="form-group"><label>طريقة الدفع</label><select id="modal-col-method"><option value="cash">نقدي</option><option value="check">شيك</option><option value="transfer">تحويل</option></select></div>
                                    <div class="form-group"><label>البيان / الملاحظات</label><input type="text" id="modal-col-notes" placeholder="أدخل البيان..."></div>
                                </div>
                            `;
                            setTimeout(() => {
                                const sel = document.getElementById('modal-col-customer');
                                if (sel && window.AppData) makeSearchableSelect(sel, window.AppData.customers, 'ابحث عن عميل...');
                            }, 50);

                            btnModalSave.onclick = async () => {
                                const customer_id = document.getElementById('modal-col-customer').value;
                                const amount = document.getElementById('modal-col-amount').value;
                                const collection_date = document.getElementById('modal-col-date').value;
                                const payment_method = document.getElementById('modal-col-method').value;
                                const notes = document.getElementById('modal-col-notes').value;

                                if (!customer_id) { alert('الرجاء اختيار العميل'); return; }
                                if (!amount || amount <= 0) { alert('المبلغ يجب أن يكون أكبر من صفر'); return; }

                                btnModalSave.disabled = true;
                                try {
                                    await window.API.createCollection({ customer_id, amount, collection_date, payment_method, notes });
                                    showAlert('تم حفظ التحصيل وخصمه من مديونية العميل بنجاح', { title: 'تمت العملية', type: 'success', infoText: false });
                                    globalModal.classList.remove('active');
                                    initDataFromServer(); // Refresh data globally
                                    if (typeof loadCollections === 'function') loadCollections();
                                } catch (e) {
                                    // API wrapper handles alert
                                } finally {
                                    btnModalSave.disabled = false;
                                }
                            };
                        } else {
                            // No specific handler for this button - do nothing
                            return;
                        }
                        
                        globalModal.classList.add('active');
                    }
                }
            });
        }
    });

    // Generic Edit Buttons - handled individually per module


});


// ---- Collections Logic ----
window.loadCollections = async function() {
    try {
        const res = await window.API.getCollections();
        const tbody = document.getElementById('collections-tbody');
        if (!tbody) return;
        tbody.innerHTML = '';
        let total = 0;
        res.data.forEach(c => {
            total += parseFloat(c.amount);
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td></td>
                <td></td>
                <td></td>
                <td style='color:var(--primary-color);font-weight:bold'> ج.م</td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
            `;
            tbody.appendChild(tr);
        });
        if (res.data.length === 0) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center">أ¯طںآ½أ¯طںآ½ أ¯طںآ½أ¯طںآ½أ¯طںآ½أ¯طںآ½ أ¯طںآ½أ¯طںآ½أ¯طںآ½أ¯طںآ½أ¯طںآ½أ¯طںآ½أ¯طںآ½</td></tr>';
        
        const countElem = document.getElementById('collections-count');
        const totalElem = document.getElementById('collections-month-total');
        if (countElem) countElem.textContent = res.data.length;
        if (totalElem) totalElem.innerHTML =formatMoney(total) + ' ج.م';
    } catch (e) {
        console.error(e);
    }
};



// ---- Aging Report Logic ----
window.loadAging = async function() {
    try {
        const res = await window.API.getAgingReport();
        const tbody = document.querySelector('#view-aging tbody');
        if (!tbody) return;
        tbody.innerHTML = '';
        
        let tot30=0, tot60=0, tot90=0, totPlus=0;
        
        res.data.forEach(c => {
            tot30 += c.age_0_30;
            tot60 += c.age_31_60;
            tot90 += c.age_61_90;
            totPlus += c.age_90_plus;
            
            const format = formatMoney;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${c.customer_code || ''}</td>
                <td>${c.customer_name || ''}</td>
                <td>${c.phone || ''}</td>
                <td>${formatMoney(c.credit_limit || 0)}</td>
                <td style=''>${formatMoney(c.age_0_30 || 0)}</td>
                <td style=''>${formatMoney(c.age_31_60 || 0)}</td>
                <td style=''>${formatMoney(c.age_61_90 || 0)}</td>
                <td style=''>${formatMoney(c.age_90_plus || 0)}</td>
                <td style='color:var(--danger-color);font-weight:bold'>${formatMoney((c.age_0_30||0)+(c.age_31_60||0)+(c.age_61_90||0)+(c.age_90_plus||0))}</td>
            `;
            tbody.appendChild(tr);
        });
        if (res.data.length === 0) tbody.innerHTML = '<tr><td colspan="9" style="text-align:center">لا توجد بيانات أعمار ديون</td></tr>';
        
        const setSum = (id, val) => { const el = document.getElementById(id); if (el) el.innerHTML = val; };
        setSum('aging-0-30', formatMoney(tot30) + ' ج.م');
        setSum('aging-31-60', formatMoney(tot60) + ' ج.م');
        setSum('aging-61-90', formatMoney(tot90) + ' ج.م');
        setSum('aging-90-plus', formatMoney(totPlus) + ' ج.م');
    } catch (e) {
        console.error(e);
    }
};


// ---- Sales Return Logic (ERP Design) ----
window.initSalesReturn = async function(invoiceNo) {
    const btnSave = document.getElementById('btn-save-sreturn');
    const btnSearch = document.getElementById('btn-search-sr-invoice');
    const btnClear = document.getElementById('sr-btn-clear');
    const srTbody = document.getElementById('sr-tbody');
    const srReason = document.getElementById('sr-reason');
    const srDateInput = document.getElementById('sr-date');
    const srInvoiceNo = document.getElementById('sr-invoice-no');
    const srInvoiceId = document.getElementById('sr-invoice-id');
    const srCustomerId = document.getElementById('sr-customer-id');
    const srCustomerName = document.getElementById('sr-customer-name');

    // ── Free-return DOM refs ──
    const frModeToggles = document.querySelectorAll('.sr-mode-btn');
    const frInvSearchGroup = document.getElementById('sr-invoice-search-group');
    const frFreeFields = document.getElementById('sr-free-fields');
    const srCustomerGroup = document.getElementById('sr-customer-group');
    const srInvoiceSelectGroup = document.getElementById('sr-invoice-select-group');
    const frCustomer = document.getElementById('sr-free-customer');
    const frStore = document.getElementById('sr-free-store');
    const frRef = document.getElementById('sr-free-ref');
    const frProduct = document.getElementById('sr-free-product');
    const frQty = document.getElementById('sr-free-qty');
    const frPrice = document.getElementById('sr-free-price');
    const frCond = document.getElementById('sr-free-cond');
    const frItemReason = document.getElementById('sr-free-item-reason');
    const frAddBtn = document.getElementById('sr-free-add-product');

    if (!srTbody) return;
    let _isFreeReturn = false;
    let _productCache = [];

    // ── UI helpers ──
    function showEl(id) { const e = document.getElementById(id); if (e) e.classList.remove('d-none'); }
    function hideEl(id) { const e = document.getElementById(id); if (e) e.classList.add('d-none'); }
    function textEl(id, val) { const e = document.getElementById(id); if (e) e.innerHTML = val; }
    function valEl(id, val) { const e = document.getElementById(id); if (e && e.tagName === 'INPUT') e.value = val; }

    const COND_OPTIONS = {
        saleable: 'سليم (قابل للبيع)',
        damaged: 'تالف',
        expired: 'منتهي الصلاحية',
        inspection: 'يحتاج فحص'
    };

    // ── Set default date ──
    if (srDateInput && !srDateInput.value) srDateInput.value = new Date().toISOString().slice(0, 10);

    // ── Load standard reasons ──
    let _returnReasons = [];
    (async () => {
        try {
            const rRes = await window.API.request('/sales/returns/reasons/list');
            if (rRes.success && srReason) {
                _returnReasons = rRes.data || [];
                const opts = '<option value="">-- اختر سبب المرتجع الأساسي --</option>' +
                    _returnReasons.map(r => `<option value="${r.code}">${r.label_ar}</option>`).join('');
                srReason.innerHTML = opts;
                if (frItemReason) frItemReason.innerHTML = '<option value="">—</option>' +
                    _returnReasons.map(r => `<option value="${r.code}">${r.label_ar}</option>`).join('');
                if (srReason) {
                    const oldWrapper = srReason.nextElementSibling;
                    if (oldWrapper && oldWrapper.classList.contains('custom-select-wrapper')) oldWrapper.remove();
                    makeSearchableSelect(srReason, _returnReasons.map(r => ({id: r.code, name: r.label_ar})), 'ابحث عن سبب...');
                    srReason.dataset.searchable = '1';
                }
                if (frItemReason) {
                    const oldWrapper2 = frItemReason.nextElementSibling;
                    if (oldWrapper2 && oldWrapper2.classList.contains('custom-select-wrapper')) oldWrapper2.remove();
                    makeSearchableSelect(frItemReason, _returnReasons.map(r => ({id: r.code, name: r.label_ar})), 'ابحث عن سبب...');
                    frItemReason.dataset.searchable = '1';
                }
            }
        } catch(e) { console.error('Failed to load return reasons', e); }
    })();

    // ── Load free-return dropdowns ──
    (async () => {
        try {
            if (frCustomer) {
                const custRes = await window.API.getCustomers();
                if (custRes.success && Array.isArray(custRes.data)) {
                    const custData = custRes.data.map(c => ({ id: c.id, name: c.customer_name }));
                    custData.sort((a, b) => a.name.localeCompare(b.name));
                    frCustomer.innerHTML = '<option value="">-- اختر العميل --</option>' +
                        custData.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
                    if (!frCustomer.dataset.searchable) {
                        makeSearchableSelect(frCustomer, custData, 'ابحث عن عميل...');
                        frCustomer.dataset.searchable = '1';
                    }
                }
            }
            if (frStore) {
                const storesRes = await window.API.getStores();
                if (storesRes.success && Array.isArray(storesRes.data)) {
                    frStore.innerHTML = '<option value="">-- اختر المخزن --</option>' +
                        storesRes.data.map(s => `<option value="${s.id}">${s.store_name}</option>`).join('');
                }
            }
            if (frProduct) {
                const prodRes = await window.API.getProducts('');
                if (prodRes.success && Array.isArray(prodRes.data)) {
                    _productCache = prodRes.data;
                    frProduct.innerHTML = '<option value="">-- اختر المنتج --</option>' +
                        _productCache.map(p => `<option value="${p.id}">${p.product_name}${p.product_code ? ' (' + p.product_code + ')' : ''}</option>`).join('');
                    if (!frProduct.dataset.searchable) {
                        makeSearchableSelect(frProduct, _productCache.map(p => ({id: p.id, name: p.product_name + ' (' + (p.product_code||'') + ')'})), 'ابحث عن منتج...');
                        frProduct.dataset.searchable = '1';
                    }
                }
            }
        } catch(e) { console.error('Failed to load free-return dropdowns', e); }
    })();

    // ── Customer → Invoices searchable select ──
    (async () => {
        const custSelect = document.getElementById('sr-customer-select');
        const invSelect = document.getElementById('sr-invoice-select');
        if (!custSelect) return;
        try {
            const custRes = await window.API.getCustomers();
            if (custRes.success && Array.isArray(custRes.data)) {
                const custData = custRes.data.map(c => ({ id: c.id, name: c.customer_name }));
                custData.sort((a, b) => a.name.localeCompare(b.name));
                custSelect.innerHTML = '<option value="">-- اختر العميل --</option>' +
                    custData.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
                makeSearchableSelect(custSelect, custData, 'ابحث عن عميل...');
                custSelect.addEventListener('change', async function() {
                    const cid = this.value;
                    if (!invSelect) return;
                    if (!cid) {
                        invSelect.innerHTML = '<option value="">-- اختر العميل أولاً --</option>';
                        invSelect.disabled = true;
                        return;
                    }
                    invSelect.disabled = true;
                    invSelect.innerHTML = '<option value="">جاري التحميل...</option>';
                    try {
                        const invRes = await window.API.getSalesInvoices({ customer_id: cid });
                        let invoices = invRes.data || [];
                        invoices = invoices.filter(inv => inv.status !== 'cancelled' && inv.status !== 'deleted');
                        if (invoices.length === 0) {
                            invSelect.innerHTML = '<option value="">لا توجد فواتير لهذا العميل</option>';
                        } else {
                            invSelect.innerHTML = '<option value="">-- اختر فاتورة --</option>' +
                                invoices.map(inv => `<option value="${inv.id}">${inv.invoice_no} (${inv.invoice_date || ''}) - ${window.formatMoney ? window.formatMoney(inv.grand_total) : inv.grand_total} [${inv.status}]</option>`).join('');
                            invSelect.disabled = false;
                        }
                    } catch(e) {
                        console.error('Failed to load invoices', e);
                        invSelect.innerHTML = '<option value="">خطأ في تحميل الفواتير</option>';
                    }
                });
                invSelect.addEventListener('change', function() {
                    const invId = this.value;
                    if (invId) {
                        if (srInvoiceNo) srInvoiceNo.value = '';
                        loadInvoiceForReturnById(invId);
                    }
                });
            }
        } catch(e) { console.error('Failed to init customer select', e); }
    })();

    // ── Invoice data cache ──
    let _loadedInvoice = null;
    let _loadedAvailItems = [];

    // ── Load invoice by ID helper ──
    async function loadInvoiceForReturnById(invoiceId) {
        showLoading(true);
        try {
            const detailRes = await window.API.getSalesInvoice(invoiceId);
            const detail = detailRes.data;
            if (!detail) { await window.showAlert('خطأ في جلب تفاصيل الفاتورة', { type: 'danger' }); return; }

            const returnStatus = detail.return_status || 'Normal';

            const availRes = await window.API.request('/sales/returns/available-qty/' + invoiceId);
            const availItems = availRes.success ? availRes.data : [];
            const hasReturnable = availItems.some(it => parseFloat(it.remaining_returnable) > 0);
            if (!hasReturnable) {
                await window.showAlert('لا توجد أصناف متاحة للإرجاع في هذه الفاتورة', { type: 'warning' });
                return;
            }

            _loadedInvoice = detail;
            _loadedAvailItems = availItems;

            if (srCustomerName) srCustomerName.value = detail.customer_name || '';
            if (srCustomerId) srCustomerId.value = detail.customer_id || '';
            if (srInvoiceId) srInvoiceId.value = detail.id || '';

            textEl('sr-inv-no', detail.invoice_no || '—');
            textEl('sr-inv-date', detail.invoice_date || '—');
            textEl('sr-inv-customer', detail.customer_name || 'نقدي');
            textEl('sr-inv-rep', detail.sales_rep_name || '—');
            textEl('sr-inv-branch', detail.branch_name || '—');
            textEl('sr-inv-warehouse', detail.warehouse_name || '—');
            textEl('sr-inv-payment', detail.payment_type === 'cash' ? 'نقدي' : 'آجل');
            const invStatusLabels = { active: 'نشطة', draft: 'مسودة', cancelled: 'ملغاة', completed: 'مكتملة' };
            const invStatusColors = { active: '#28a745', draft: '#ffc107', cancelled: '#dc3545', completed: '#10b981' };
            const iStat = detail.status || 'active';
            const statusBadge = document.getElementById('sr-invoice-status-badge');
            if (statusBadge) {
                statusBadge.textContent = invStatusLabels[iStat] || iStat;
                statusBadge.style.background = (invStatusColors[iStat] || '#888') + '22';
                statusBadge.style.color = invStatusColors[iStat] || '#888';
                statusBadge.style.padding = '3px 10px';
                statusBadge.style.borderRadius = '12px';
            }
            textEl('sr-inv-status', invStatusLabels[iStat] || iStat);

            const rsColors = { Normal: '#28a745', 'Partially Returned': '#ffc707', 'Fully Returned': '#6c757d' };
            const rsLabels = { Normal: 'عادي', 'Partially Returned': 'مرتجع جزئي', 'Fully Returned': 'مرتجع كلياً' };
            const rsPill = document.getElementById('sr-return-status-pill');
            if (rsPill) {
                rsPill.textContent = rsLabels[returnStatus] || returnStatus;
                rsPill.style.background = (rsColors[returnStatus] || '#28a745') + '22';
                rsPill.style.color = rsColors[returnStatus] || '#28a745';
                rsPill.style.padding = '3px 10px';
                rsPill.style.borderRadius = '12px';
            }

            const origTotal = parseFloat(detail.grand_total) || 0;
            const prevReturned = parseFloat(detail.returned_amount) || 0;
            const remReturnable = origTotal - prevReturned;
            textEl('sr-original-total', formatMoney(origTotal));
            textEl('sr-previous-returned', formatMoney(prevReturned));
            textEl('sr-remaining-returnable', formatMoney(Math.max(0, remReturnable)));

            showEl('sr-invoice-info-card');

            srTbody.innerHTML = '';
            let rowIndex = 0;
            availItems.forEach(item => {
                const remaining = parseFloat(item.remaining_returnable) || 0;
                if (remaining <= 0) return;
                rowIndex++;
                const tr = document.createElement('tr');
                tr.dataset.productId = item.product_id;
                tr.dataset.price = item.unit_price || 0;
                tr.dataset.discPct = item.discount_pct || 0;
                tr.dataset.taxPct = item.tax_pct || 14;
                tr.dataset.cost = item.cost_price || 0;
                if (item.already_returned > 0) tr.style.background = '#fffbeb';
                const condOpts = Object.entries(COND_OPTIONS).map(([v, l]) => '<option value="' + v + '">' + l + '</option>').join('');
                tr.innerHTML =
                    '<td style="text-align:center;color:var(--text-muted);font-size:0.8rem;">' + rowIndex + '</td>' +
                    '<td><div style="font-weight:600;font-size:0.85rem;">' + escapeHtml(item.product_name) + '</div><div style="font-size:0.7rem;color:var(--text-muted);">' + escapeHtml(item.product_code||'') + ' / ' + escapeHtml(item.unit_name||'') + (item.barcode ? ' / باركود: ' + escapeHtml(item.barcode) : '') + '</div></td>' +
                    '<td style="text-align:center;"><div style="width:36px;height:36px;background:var(--bg-body);border-radius:6px;display:inline-flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:0.8rem;"><i class="fa-solid fa-barcode"></i></div></td>' +
                    '<td style="text-align:center;font-weight:600;">' + item.sold_qty + '</td>' +
                    '<td style="text-align:center;color:' + (parseFloat(item.already_returned) > 0 ? 'var(--warning-color)' : '#888') + ';font-weight:600;">' + (item.already_returned || 0) + '</td>' +
                    '<td style="text-align:center;color:var(--success-color);font-weight:700;">' + remaining + '</td>' +
                    '<td style="text-align:center;"><input type="number" class="sr-qty" value="0" min="0" max="' + remaining + '" step="any" style="width:65px;text-align:center;border:1.5px solid var(--primary-color);border-radius:6px;padding:4px 6px;font-family:Cairo,sans-serif;"></td>' +
                    '<td><select class="sr-cond form-control" style="padding:3px 4px;font-size:0.8rem;">' + condOpts + '</select></td>' +
                    '<td style="text-align:center;font-weight:600;">' + formatMoney(item.unit_price) + '</td>' +
                    '<td class="sr-discount-cell" style="text-align:center;color:var(--text-muted);font-size:0.8rem;">' + formatMoney(0) + '</td>' +
                    '<td class="sr-tax-cell" style="text-align:center;color:var(--text-muted);font-size:0.8rem;">' + formatMoney(0) + '</td>' +
                    '<td class="sr-line-total" style="text-align:center;font-weight:700;color:var(--primary-color);">' + formatMoney(0) + '</td>' +
                    '<td class="sr-item-status" style="text-align:center;"></td>';
                srTbody.appendChild(tr);
            });

            showEl('sr-items-card');

            if (srTbody.children.length === 0) {
                srTbody.innerHTML = '<tr><td colspan="13" class="text-center" style="padding:20px;color:var(--danger-color);">الفاتورة تم إرجاعها بالكامل أو لا يوجد أصناف متاحة للإرجاع</td></tr>';
            } else {
                srTbody.querySelectorAll('.sr-qty').forEach(inp => {
                    inp.addEventListener('input', onQtyChange);
                    inp.addEventListener('change', onQtyChange);
                });
                srTbody.querySelectorAll('.sr-cond').forEach(sel => {
                    sel.addEventListener('change', onQtyChange);
                });
                recalcAll();
            }

            showEl('sr-details-card');
            showEl('sr-footer-bar');
            if (btnClear) btnClear.classList.remove('d-none');

            const warnings = generateWarnings(detail, availItems);
            const warnBody = document.getElementById('sr-warnings-body');
            if (warnBody) {
                warnBody.innerHTML = '';
                if (warnings.length > 0) {
                    showEl('sr-warnings-card');
                    warnings.forEach(w => {
                        const div = document.createElement('div');
                        div.className = 'sr-warning warning-' + w.type;
                        div.innerHTML = '<i class="fa-solid ' + (w.icon || 'fa-info-circle') + '"></i><span>' + w.msg + '</span>';
                        warnBody.appendChild(div);
                    });
                } else {
                    hideEl('sr-warnings-card');
                }
            }

            await loadReturnHistory(invoiceId);
        } catch(e) {
            console.error('Error loading invoice for return:', e);
            await window.showAlert('حدث خطأ أثناء جلب الفاتورة: ' + (e.message || ''), { type: 'danger' });
        } finally {
            showLoading(false);
        }
    }

    // ── Full recalculation engine ──
    function recalcAll() {
        const vatRate = 0.14;
        let subtotal = 0, discountTotal = 0, vatTotal = 0, grandTotal = 0;
        let itemCount = 0, balanceImpact = 0;
        const rows = srTbody.querySelectorAll('tr[data-product-id]');

        rows.forEach(tr => {
            const qtyInp = tr.querySelector('.sr-qty');
            const qty = parseFloat(qtyInp?.value) || 0;
            const price = parseFloat(tr.dataset.price || 0);
            const discPct = parseFloat(tr.dataset.discPct || 0);
            const taxPct = parseFloat(tr.dataset.taxPct || 0);
            const isFree = parseFloat(tr.dataset.cost || 0) === 0 && price === 0;

            if (qty > 0) itemCount++;
            const lineGross = qty * price;
            const lineDisc = lineGross * (discPct / 100);
            const lineAfterDisc = lineGross - lineDisc;
            const lineVat = lineAfterDisc * (taxPct / 100);
            const lineTotal = lineAfterDisc + lineVat;

            subtotal += lineGross;
            discountTotal += lineDisc;
            vatTotal += lineVat;
            grandTotal += lineTotal;

            // Update line total cell
            const ltEl = tr.querySelector('.sr-line-total');
            if (ltEl) ltEl.innerHTML = formatMoney(lineTotal);

            // Update discount cell
            const discEl = tr.querySelector('.sr-discount-cell');
            if (discEl) discEl.innerHTML = formatMoney(lineDisc);

            // Update tax cell
            const taxEl = tr.querySelector('.sr-tax-cell');
            if (taxEl) taxEl.innerHTML = formatMoney(lineVat);

            // Update status badge
            const badgeEl = tr.querySelector('.sr-item-status');
            if (badgeEl) {
                if (qty > 0) {
                    badgeEl.innerHTML = '<span style="color:var(--warning-color);font-size:0.75rem;"><i class="fa-solid fa-rotate-left"></i> للإرجاع</span>';
                } else {
                    badgeEl.innerHTML = '<span style="color:#888;font-size:0.75rem;">—</span>';
                }
            }
        });

        balanceImpact = grandTotal;
        textEl('sr-item-count', itemCount);
        textEl('sr-subtotal', formatMoney(subtotal));
        textEl('sr-discount-total', formatMoney(discountTotal));
        textEl('sr-vat-total', formatMoney(vatTotal));
        textEl('sr-grand-total', formatMoney(grandTotal));
        textEl('sr-balance-impact', formatMoney(balanceImpact));

        // Footer
        const origTotal = _loadedInvoice ? (parseFloat(_loadedInvoice.grand_total) || 0) : 0;
        const prevReturned = _loadedInvoice ? (parseFloat(_loadedInvoice.returned_amount) || 0) : 0;
        const remainingInv = origTotal - prevReturned - grandTotal;
        textEl('sr-footer-items', itemCount);
        if (_isFreeReturn) {
            textEl('sr-footer-original', '—');
            textEl('sr-footer-remaining-inv', '—');
            textEl('sr-footer-balance-after', '—');
        } else {
            textEl('sr-footer-original', formatMoney(origTotal));
            textEl('sr-footer-remaining-inv', formatMoney(Math.max(0, remainingInv)));
            const custBalAfter = origTotal - (prevReturned + grandTotal);
            textEl('sr-footer-balance-after', formatMoney(Math.max(0, custBalAfter)));
        }
        textEl('sr-footer-current', formatMoney(grandTotal));

        // ERP preview visible when items > 0
        if (grandTotal > 0) {
            showEl('sr-preview-card');
        } else {
            hideEl('sr-preview-card');
        }
    }

    // ── Live qty change handler ──
    function onQtyChange() { recalcAll(); }

    // ── Add product row (free-return mode) ──
    function addFreeReturnProduct() {
        const pid = parseInt(frProduct?.value);
        const qty = parseFloat(frQty?.value) || 1;
        const price = parseFloat(frPrice?.value) || 0;
        const cond = frCond?.value || 'saleable';
        const itemReason = frItemReason?.value || '';

        if (!pid) { window.showAlert('اختر منتجاً أولاً', { type: 'warning' }); return; }
        if (qty <= 0) { window.showAlert('الكمية يجب أن تكون أكبر من صفر', { type: 'warning' }); return; }

        // Check duplicate
        const existing = srTbody.querySelector(`tr[data-product-id="${pid}"]`);
        if (existing) {
            const qtyInp = existing.querySelector('.sr-qty');
            if (qtyInp) {
                qtyInp.value = parseFloat(qtyInp.value) + qty;
                recalcAll();
                window.showAlert('تم زيادة الكمية للمنتج الموجود', { type: 'info' });
                return;
            }
        }

        const prod = _productCache.find(p => String(p.id) === String(pid));
        const rowIndex = srTbody.querySelectorAll('tr[data-product-id]').length + 1;

        const tr = document.createElement('tr');
        tr.dataset.productId = pid;
        tr.dataset.price = price;
        tr.dataset.discPct = 0;
        tr.dataset.taxPct = 14;
        tr.dataset.cost = 0;

        const condOpts = Object.entries(COND_OPTIONS)
            .map(([v, l]) => `<option value="${v}"${v === cond ? ' selected' : ''}>${l}</option>`).join('');

        tr.innerHTML =
            '<td style="text-align:center;color:var(--text-muted);font-size:0.8rem;">' + rowIndex + '</td>' +
            '<td><div style="font-weight:600;font-size:0.85rem;">' + (prod ? escapeHtml(prod.product_name) : '#' + pid) + '</div><div style="font-size:0.7rem;color:var(--text-muted);">' + (prod && prod.product_code ? escapeHtml(prod.product_code) : '') + '</div></td>' +
            '<td style="text-align:center;"><div style="width:36px;height:36px;background:var(--bg-body);border-radius:6px;display:inline-flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:0.8rem;"><i class="fa-solid fa-barcode"></i></div></td>' +
            '<td style="text-align:center;font-weight:600;color:var(--text-muted);font-size:0.75rem;">—</td>' +
            '<td style="text-align:center;color:var(--text-muted);font-size:0.75rem;">—</td>' +
            '<td style="text-align:center;color:var(--success-color);font-weight:700;font-size:0.75rem;">—</td>' +
            '<td style="text-align:center;"><input type="number" class="sr-qty" value="' + qty + '" min="0" step="any" style="width:65px;text-align:center;border:1.5px solid var(--primary-color);border-radius:6px;padding:4px 6px;font-family:Cairo,sans-serif;"></td>' +
            '<td><select class="sr-cond form-control" style="padding:3px 4px;font-size:0.8rem;">' + condOpts + '</select></td>' +
            '<td style="text-align:center;"><input type="number" class="sr-price-input" value="' + price + '" min="0" step="any" style="width:80px;text-align:center;border:1px solid var(--border-color);border-radius:4px;padding:3px 4px;font-family:Cairo,sans-serif;font-size:0.8rem;"></td>' +
            '<td class="sr-discount-cell" style="text-align:center;color:var(--text-muted);font-size:0.8rem;">' + formatMoney(0) + '</td>' +
            '<td class="sr-tax-cell" style="text-align:center;color:var(--text-muted);font-size:0.8rem;">' + formatMoney(0) + '</td>' +
            '<td class="sr-line-total" style="text-align:center;font-weight:700;color:var(--primary-color);">' + formatMoney(qty * price) + '</td>' +
            '<td class="sr-item-status" style="text-align:center;"><button class="sr-remove-btn" style="background:none;border:none;color:var(--danger-color);cursor:pointer;font-size:0.85rem;" title="إزالة"><i class="fa-solid fa-xmark"></i></button></td>';

        srTbody.appendChild(tr);

        // Bind events
        const qtyInp = tr.querySelector('.sr-qty');
        if (qtyInp) {
            qtyInp.addEventListener('input', onQtyChange);
            qtyInp.addEventListener('change', onQtyChange);
        }
        const condSel = tr.querySelector('.sr-cond');
        if (condSel) condSel.addEventListener('change', onQtyChange);
        const priceInp = tr.querySelector('.sr-price-input');
        if (priceInp) {
            priceInp.addEventListener('input', function() {
                tr.dataset.price = parseFloat(this.value) || 0;
                recalcAll();
            });
            priceInp.addEventListener('change', function() {
                tr.dataset.price = parseFloat(this.value) || 0;
                recalcAll();
            });
        }
        const rmBtn = tr.querySelector('.sr-remove-btn');
        if (rmBtn) {
            rmBtn.addEventListener('click', function() {
                tr.remove();
                recalcAll();
                if (srTbody.querySelectorAll('tr[data-product-id]').length === 0) {
                    showEl('sr-items-card');
                    srTbody.innerHTML = '<tr><td colspan="13" class="text-center" style="padding:20px;color:#888;">أضف منتجات للمرتجع الحر</td></tr>';
                }
            });
        }

        showEl('sr-items-card');
        showEl('sr-details-card');
        showEl('sr-footer-bar');
        if (btnClear) btnClear.classList.remove('d-none');
        recalcAll();

        // Reset inputs
        if (frProduct) frProduct.value = '';
        if (frQty) frQty.value = 1;
        if (frPrice) frPrice.value = 0;
    }

    // ── Clear form ──
    function clearForm() {
        srInvoiceNo.value = '';
        valEl('sr-customer-name', '');
        valEl('sr-customer-id', '');
        valEl('sr-invoice-id', '');
        srReason.value = '';
        srDateInput.value = new Date().toISOString().slice(0, 10);
        if (frCustomer) frCustomer.value = '';
        if (frStore) frStore.value = '';
        if (frRef) frRef.value = '';
        if (frProduct) frProduct.value = '';
        if (frQty) frQty.value = 1;
        if (frPrice) frPrice.value = 0;
        srTbody.innerHTML = '<tr><td colspan="13" class="text-center" style="padding:20px;color:#888;">' + (_isFreeReturn ? 'أضف منتجات للمرتجع الحر' : 'الرجاء البحث عن فاتورة لإظهار الأصناف') + '</td></tr>';
        hideEl('sr-invoice-info-card');
        hideEl('sr-items-card');
        hideEl('sr-product-detail-card');
        hideEl('sr-warnings-card');
        hideEl('sr-details-card');
        hideEl('sr-preview-card');
        hideEl('sr-footer-bar');
        if (btnClear) btnClear.classList.add('d-none');
        _loadedInvoice = null;
        _loadedAvailItems = [];
        textEl('sr-grand-total', '0.00');
        textEl('sr-item-count', '0');
        textEl('sr-subtotal', '0.00');
        textEl('sr-discount-total', '0.00');
        textEl('sr-vat-total', '0.00');
        textEl('sr-balance-impact', '0.00');
        textEl('sr-footer-items', '0');
        textEl('sr-footer-original', '0.00');
        textEl('sr-footer-current', '0.00');
        textEl('sr-footer-remaining-inv', '0.00');
        textEl('sr-footer-balance-after', '0.00');
        document.getElementById('sr-reason-dynamic-group').innerHTML = '';
        hideEl('sr-approval-section');
    }

    // ── Generate warnings ──
    function generateWarnings(inv, availableItems) {
        const warnings = [];
        const totalReturned = parseFloat(inv.returned_amount) || 0;
        const grandTotal = parseFloat(inv.grand_total) || 1;

        if (parseFloat(inv.returned_amount) > 0) {
            warnings.push({ type: 'info', icon: 'fa-info-circle', msg: 'هذه الفاتورة لديه مرتجعات سابقة. يرجى مراجعة سجل المرتجعات أعلاه.' });
        }

        const returnRate = (totalReturned / grandTotal) * 100;
        if (returnRate > 30) {
            warnings.push({ type: 'info', icon: 'fa-chart-line', msg: 'نسبة مرتجعات هذه الفاتورة: ' + returnRate.toFixed(1) + '% (أعلى من 30%)' });
        }

        if (inv.status === 'cancelled') {
            warnings.push({ type: 'danger', icon: 'fa-ban', msg: 'الفاتورة ملغاة! لا يمكن عمل مرتجع لفاتورة ملغاة.' });
        }

        // Check products that were previously returned
        availableItems.forEach(item => {
            if (parseFloat(item.already_returned) > 0) {
                warnings.push({ type: 'warning', icon: 'fa-exclamation-triangle', msg: 'الصنف "' + item.product_name + '" تم إرجاعه سابقاً (' + item.already_returned + ' وحدة)' });
            }
        });

        return warnings;
    }

    // ── Load return history ──
    async function loadReturnHistory(invoiceId, searchQ) {
        try {
            const params = {};
            if (invoiceId) params.invoice_id = invoiceId;
            if (searchQ) params.q = searchQ;
            const histRes = await window.API.getSalesReturns(params);
            const returns = histRes.data || [];
            const tbody = document.getElementById('sr-history-body');
            if (!tbody) return;
            tbody.innerHTML = '';
            if (returns.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding:15px;color:#888;">لا توجد مرتجعات سابقة</td></tr>';
                return;
            }
            returns.forEach(r => {
                const tr = document.createElement('tr');
                tr.style.cursor = 'pointer';
                tr.onclick = () => window.showReturnDetail(r.id);
                const wfLabels = { approved: 'معتمد', pending_approval: 'بانتظار الاعتماد', reversed: 'ملغي', draft: 'مسودة', rejected: 'مرفوض' };
                const wfColors = { approved: '#28a745', pending_approval: '#ffc107', reversed: '#dc3545', draft: '#888', rejected: '#dc3545' };
                const wf = r.workflow_status || 'draft';
                tr.innerHTML = '<td>' + (r.return_no || '—') + '</td>' +
                    '<td>' + (r.return_date || '—') + '</td>' +
                    '<td>' + (r.customer_name || '—') + '</td>' +
                    '<td>' + formatMoney(r.grand_total) + '</td>' +
                    '<td><span style="color:' + (wfColors[wf] || '#888') + ';font-weight:700">' + (wfLabels[wf] || wf) + '</span></td>' +
                    '<td>' + (r.created_by_username || '—') + '</td>';
                tbody.appendChild(tr);
            });
        } catch(e) {
            console.error('Failed to load return history', e);
            const tbody = document.getElementById('sr-history-body');
            if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding:15px;color:#dc3545;">خطأ في تحميل البيانات</td></tr>';
        }
    }

    // ── Show loading state ──
    function showLoading(show) {
        const el = document.getElementById('sr-loading');
        if (el) {
            if (show) el.classList.remove('d-none'); else el.classList.add('d-none');
        }
        if (btnSearch) btnSearch.disabled = show;
        if (srInvoiceNo) srInvoiceNo.disabled = show;
    }

    // ── Main invoice loading function ──
    async function loadInvoiceForReturn(invoiceNo) {
        const invNo = invoiceNo || (srInvoiceNo ? srInvoiceNo.value.trim() : '');
        if (!invNo) { await window.showAlert('أدخل رقم الفاتورة أولاً', { type: 'warning' }); return; }

        showLoading(true);
        try {
            const res = await window.API.getSalesInvoices({ q: invNo });
            const inv = res.data && res.data.find(i => i.invoice_no === invNo || String(i.id) === String(invNo));
            if (!inv) { await window.showAlert('لم يتم العثور على الفاتورة', { type: 'warning' }); return; }

            // Check cancelled
            if (inv.status === 'cancelled') {
                await window.showAlert('الفاتورة ملغاة ولا يمكن عمل مرتجع لها', { type: 'danger' });
                return;
            }

            // Fetch full detail
            const detailRes = await window.API.getSalesInvoice(inv.id);
            const detail = detailRes.data;
            if (!detail) { await window.showAlert('خطأ في جلب تفاصيل الفاتورة', { type: 'danger' }); return; }

            // Get available quantities
            const availRes = await window.API.request('/sales/returns/available-qty/' + inv.id);
            const availItems = availRes.success ? availRes.data : [];
            const hasReturnable = availItems.some(it => parseFloat(it.remaining_returnable) > 0);
            if (!hasReturnable) {
                await window.showAlert('لا توجد أصناف متاحة للإرجاع في هذه الفاتورة', { type: 'warning' });
                return;
            }

            // ── Cache data ──
            _loadedInvoice = detail;
            _loadedAvailItems = availItems;

            // ── Populate hidden fields ──
            if (srCustomerName) srCustomerName.value = detail.customer_name || '';
            if (srCustomerId) srCustomerId.value = detail.customer_id || '';
            if (srInvoiceId) srInvoiceId.value = detail.id || '';

            // ── Populate invoice info card ──
            textEl('sr-inv-no', detail.invoice_no || '—');
            textEl('sr-inv-date', detail.invoice_date || '—');
            textEl('sr-inv-customer', detail.customer_name || 'نقدي');
            textEl('sr-inv-rep', detail.sales_rep_name || '—');
            textEl('sr-inv-branch', detail.branch_name || '—');
            textEl('sr-inv-warehouse', detail.warehouse_name || '—');
            textEl('sr-inv-payment', detail.payment_type === 'cash' ? 'نقدي' : 'آجل');
            // Invoice status
            const invStatusLabels = { active: 'نشطة', draft: 'مسودة', cancelled: 'ملغاة', completed: 'مكتملة' };
            const invStatusColors = { active: '#28a745', draft: '#ffc107', cancelled: '#dc3545', completed: '#10b981' };
            const iStat = detail.status || 'active';
            const statusBadge = document.getElementById('sr-invoice-status-badge');
            if (statusBadge) {
                statusBadge.textContent = invStatusLabels[iStat] || iStat;
                statusBadge.style.background = (invStatusColors[iStat] || '#888') + '22';
                statusBadge.style.color = invStatusColors[iStat] || '#888';
                statusBadge.style.padding = '3px 10px';
                statusBadge.style.borderRadius = '12px';
            }
            textEl('sr-inv-status', invStatusLabels[iStat] || iStat);

            // Return status pill
            const rsColors = { Normal: '#28a745', 'Partially Returned': '#ffc707', 'Fully Returned': '#6c757d' };
            const rsLabels = { Normal: 'عادي', 'Partially Returned': 'مرتجع جزئي', 'Fully Returned': 'مرتجع كلياً' };
            const rsPill = document.getElementById('sr-return-status-pill');
            if (rsPill) {
                rsPill.textContent = rsLabels[returnStatus] || returnStatus;
                rsPill.style.background = (rsColors[returnStatus] || '#28a745') + '22';
                rsPill.style.color = rsColors[returnStatus] || '#28a745';
                rsPill.style.padding = '3px 10px';
                rsPill.style.borderRadius = '12px';
            }

            // ── Summary stat cards ──
            const origTotal = parseFloat(detail.grand_total) || 0;
            const prevReturned = parseFloat(detail.returned_amount) || 0;
            const remReturnable = origTotal - prevReturned;
            textEl('sr-original-total', formatMoney(origTotal));
            textEl('sr-previous-returned', formatMoney(prevReturned));
            textEl('sr-remaining-returnable', formatMoney(Math.max(0, remReturnable)));

            showEl('sr-invoice-info-card');

            // ── Build items grid ──
            srTbody.innerHTML = '';
            let rowIndex = 0;
            availItems.forEach(item => {
                const remaining = parseFloat(item.remaining_returnable) || 0;
                if (remaining <= 0) return;

                rowIndex++;
                const tr = document.createElement('tr');
                tr.dataset.productId = item.product_id;
                tr.dataset.price = item.unit_price || 0;
                tr.dataset.discPct = item.discount_pct || 0;
                tr.dataset.taxPct = item.tax_pct || 14;
                tr.dataset.cost = item.cost_price || 0;
                if (item.already_returned > 0) tr.style.background = '#fffbeb';

                const condOpts = Object.entries(COND_OPTIONS)
                    .map(([v, l]) => '<option value="' + v + '">' + l + '</option>').join('');

                tr.innerHTML =
                    '<td style="text-align:center;color:var(--text-muted);font-size:0.8rem;">' + rowIndex + '</td>' +
                    '<td><div style="font-weight:600;font-size:0.85rem;">' + escapeHtml(item.product_name) + '</div><div style="font-size:0.7rem;color:var(--text-muted);">' + escapeHtml(item.product_code||'') + ' / ' + escapeHtml(item.unit_name||'') + (item.barcode ? ' / باركود: ' + escapeHtml(item.barcode) : '') + '</div></td>' +
                    '<td style="text-align:center;"><div style="width:36px;height:36px;background:var(--bg-body);border-radius:6px;display:inline-flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:0.8rem;"><i class="fa-solid fa-barcode"></i></div></td>' +
                    '<td style="text-align:center;font-weight:600;">' + item.sold_qty + '</td>' +
                    '<td style="text-align:center;color:' + (parseFloat(item.already_returned) > 0 ? 'var(--warning-color)' : '#888') + ';font-weight:600;">' + (item.already_returned || 0) + '</td>' +
                    '<td style="text-align:center;color:var(--success-color);font-weight:700;">' + remaining + '</td>' +
                    '<td style="text-align:center;"><input type="number" class="sr-qty" value="0" min="0" max="' + remaining + '" step="any" style="width:65px;text-align:center;border:1.5px solid var(--primary-color);border-radius:6px;padding:4px 6px;font-family:Cairo,sans-serif;"></td>' +
                    '<td><select class="sr-cond form-control" style="padding:3px 4px;font-size:0.8rem;">' + condOpts + '</select></td>' +
                    '<td style="text-align:center;font-weight:600;">' + formatMoney(item.unit_price) + '</td>' +
                    '<td class="sr-discount-cell" style="text-align:center;color:var(--text-muted);font-size:0.8rem;">' + formatMoney(0) + '</td>' +
                    '<td class="sr-tax-cell" style="text-align:center;color:var(--text-muted);font-size:0.8rem;">' + formatMoney(0) + '</td>' +
                    '<td class="sr-line-total" style="text-align:center;font-weight:700;color:var(--primary-color);">' + formatMoney(0) + '</td>' +
                    '<td class="sr-item-status" style="text-align:center;"></td>';

                srTbody.appendChild(tr);
            });

            showEl('sr-items-card');

            if (srTbody.children.length === 0) {
                srTbody.innerHTML = '<tr><td colspan="13" class="text-center" style="padding:20px;color:var(--danger-color);">الفاتورة تم إرجاعها بالكامل أو لا يوجد أصناف متاحة للإرجاع</td></tr>';
            } else {
                // Bind live calculation
                srTbody.querySelectorAll('.sr-qty').forEach(inp => {
                    inp.addEventListener('input', onQtyChange);
                    inp.addEventListener('change', onQtyChange);
                });
                srTbody.querySelectorAll('.sr-cond').forEach(sel => {
                    sel.addEventListener('change', onQtyChange);
                });
                // Trigger initial calc
                recalcAll();
            }

            // ── Show details card ──
            showEl('sr-details-card');
            showEl('sr-footer-bar');
            if (btnClear) btnClear.classList.remove('d-none');

            // ── Generate warnings ──
            const warnings = generateWarnings(detail, availItems);
            const warnBody = document.getElementById('sr-warnings-body');
            if (warnBody) {
                warnBody.innerHTML = '';
                if (warnings.length > 0) {
                    showEl('sr-warnings-card');
                    warnings.forEach(w => {
                        const div = document.createElement('div');
                        div.className = 'sr-warning warning-' + w.type;
                        div.innerHTML = '<i class="fa-solid ' + (w.icon || 'fa-info-circle') + '"></i><span>' + w.msg + '</span>';
                        warnBody.appendChild(div);
                    });
                } else {
                    hideEl('sr-warnings-card');
                }
            }

            // ── Load return history ──
            await loadReturnHistory(inv.id);

        } catch(e) {
            console.error('Error loading invoice for return:', e);
            await window.showAlert('حدث خطأ أثناء جلب الفاتورة: ' + (e.message || ''), { type: 'danger' });
        } finally {
            showLoading(false);
        }
    }

    // ── Reason-dependent dynamic fields ──
    if (srReason) {
        srReason.addEventListener('change', function() {
            const reason = this.value;
            const group = document.getElementById('sr-reason-dynamic-group');
            if (!group) return;
            let html = '';
            if (reason === 'damaged') {
                html = '<div class="form-grid" style="grid-column:1/-1;">' +
                    '<div class="form-group"><label>مستوى التلف</label><select id="sr-damage-level" class="form-control"><option value="minor">بسيط</option><option value="moderate">متوسط</option><option value="severe">كلي</option></select></div>' +
                    '<div class="form-group"><label>ملاحظات التلف</label><textarea id="sr-damage-notes" class="form-control" rows="1" placeholder="وصف التلف..."></textarea></div>' +
                    '<div class="form-group"><label>صور (رابط)</label><input type="text" id="sr-damage-photos" class="form-control" placeholder="رابط الصور إن وجدت"></div>' +
                '</div>';
            } else if (reason === 'expired') {
                html = '<div class="form-grid" style="grid-column:1/-1;">' +
                    '<div class="form-group"><label>رقم التشغيلة (Batch)</label><input type="text" id="sr-batch-no" class="form-control" placeholder="رقم التشغيلة"></div>' +
                    '<div class="form-group"><label>تاريخ انتهاء الصلاحية</label><input type="date" id="sr-expiry-date" class="form-control"></div>' +
                '</div>';
            } else if (reason === 'wrong_item') {
                html = '<div class="form-grid" style="grid-column:1/-1;">' +
                    '<div class="form-group"><label>المنتج الصحيح</label><input type="text" id="sr-correct-item" class="form-control" placeholder="اسم المنتج الصحيح"></div>' +
                '</div>';
            } else if (reason === 'customer_refused') {
                html = '<div class="form-grid" style="grid-column:1/-1;">' +
                    '<div class="form-group" style="grid-column:1/-1;"><label>ملاحظات العميل</label><textarea id="sr-customer-notes" class="form-control" rows="2" placeholder="سبب رفض العميل..."></textarea></div>' +
                '</div>';
            }
            group.innerHTML = html;
        });
    }

    // ── Search button ──
    if (btnSearch) {
        btnSearch.onclick = () => loadInvoiceForReturn();
    }
    if (srInvoiceNo) {
        srInvoiceNo.addEventListener('keypress', e => {
            if (e.key === 'Enter') loadInvoiceForReturn();
        });
    }

    // ── Clear button ──
    if (btnClear) {
        btnClear.onclick = clearForm;
    }

    // ── Auto-load invoice ──
    if (invoiceNo) {
        if (srInvoiceNo) srInvoiceNo.value = invoiceNo;
        setTimeout(() => loadInvoiceForReturn(invoiceNo), 400);
    }

    // ── Mode toggle ──
    function setReturnMode(freeMode) {
        _isFreeReturn = freeMode;
        frModeToggles.forEach(btn => btn.classList.toggle('active', btn.dataset.mode === (freeMode ? 'free' : 'linked')));
        if (frInvSearchGroup) frInvSearchGroup.style.display = freeMode ? 'none' : '';
        if (frFreeFields) frFreeFields.classList.toggle('d-none', !freeMode);
        if (srCustomerGroup) srCustomerGroup.style.display = freeMode ? 'none' : '';
        if (srInvoiceSelectGroup) srInvoiceSelectGroup.style.display = freeMode ? 'none' : '';
        clearForm();
        // Show/hide invoice-specific cards
        const invInfoCard = document.getElementById('sr-invoice-info-card');
        if (invInfoCard) invInfoCard.classList.add('d-none');
        loadReturnHistory();
        const warningsCard = document.getElementById('sr-warnings-card');
        if (warningsCard) warningsCard.classList.add('d-none');
        const footerBar = document.getElementById('sr-footer-bar');
        if (footerBar) footerBar.classList.add('d-none');
        // Update card title
        const cardTitle = document.querySelector('#sr-search-card .card-title span');
        if (cardTitle) cardTitle.textContent = freeMode ? 'مرتجع حر' : 'بيانات المرتجع';
    }

    frModeToggles.forEach(btn => {
        btn.addEventListener('click', function() {
            setReturnMode(this.dataset.mode === 'free');
        });
    });

    // ── Free-return: Add product ──
    if (frAddBtn) {
        frAddBtn.addEventListener('click', addFreeReturnProduct);
    }
    if (frProduct) {
        frProduct.addEventListener('change', function() {
            const pid = parseInt(this.value);
            if (pid && _productCache.length > 0) {
                const prod = _productCache.find(p => String(p.id) === String(pid));
                if (prod && frPrice) {
                    frPrice.value = parseFloat(prod.sell_price || prod.unit_price || 0) || 0;
                }
            }
        });
    }
    if (frQty) {
        frQty.addEventListener('keypress', e => { if (e.key === 'Enter' && frAddBtn) frAddBtn.click(); });
    }
    if (frPrice) {
        frPrice.addEventListener('keypress', e => { if (e.key === 'Enter' && frAddBtn) frAddBtn.click(); });
    }

    // ── Save handler ──
    if (btnSave) {
        btnSave.onclick = async function() {
            const notes = document.getElementById('sr-notes') ? document.getElementById('sr-notes').value : '';

            let customerId, invoiceId, returnDate, reasonCode, storeId, refNo;

            if (_isFreeReturn) {
                customerId = frCustomer ? frCustomer.value : '';
                storeId = frStore ? frStore.value : '';
                refNo = frRef ? frRef.value.trim() : '';
                returnDate = srDateInput ? srDateInput.value : '';
                reasonCode = srReason ? srReason.value : '';
                invoiceId = null;

                if (!customerId) {
                    await window.showAlert('يجب اختيار العميل', { type: 'warning' });
                    return;
                }
                if (!storeId) {
                    await window.showAlert('يجب اختيار المخزن', { type: 'warning' });
                    return;
                }
                if (!returnDate) {
                    await window.showAlert('يجب تحديد تاريخ المرتجع', { type: 'warning' });
                    return;
                }
                if (!reasonCode) {
                    await window.showAlert('يجب تحديد سبب المرتجع الأساسي', { type: 'warning' });
                    return;
                }
                // Permission check
                const _cu = typeof currentUser !== 'undefined' ? currentUser : null;
                if (_cu && _cu.role !== 'admin') {
                    const _perms = _cu.permissions || [];
                    if (!_perms.includes('*') && !_perms.includes('sales.free_return')) {
                        await window.showAlert('ليس لديك صلاحية إنشاء مرتجع بدون فاتورة', { type: 'danger' });
                        return;
                    }
                }
            } else {
                customerId = srCustomerId ? srCustomerId.value : '';
                invoiceId = srInvoiceId ? srInvoiceId.value : '';
                returnDate = srDateInput ? srDateInput.value : '';
                reasonCode = srReason ? srReason.value : '';

                if (!customerId || !invoiceId) {
                    await window.showAlert('ابحث عن فاتورة أولاً', { type: 'warning' });
                    return;
                }
                if (!reasonCode) {
                    await window.showAlert('يجب تحديد سبب المرتجع الأساسي', { type: 'warning' });
                    return;
                }
            }

            // Build items
            const items = [];
            let errorMsg = null;
            const grandTotalCalc = { val: 0 };
            srTbody.querySelectorAll('tr[data-product-id]').forEach(tr => {
                const qtyInp = tr.querySelector('.sr-qty');
                if (!qtyInp) return;
                const qty = parseFloat(qtyInp.value) || 0;
                if (qty > 0) {
                    const maxQty = parseFloat(qtyInp.getAttribute('max')) || 0;
                    if (!_isFreeReturn && maxQty > 0 && qty > maxQty) {
                        errorMsg = 'الكمية المرتجعة لا يمكن أن تتجاوز المتاح للإرجاع!';
                    }
                    const cond = tr.querySelector('.sr-cond');
                    const priceInp = tr.querySelector('.sr-price-input');
                    const unitPrice = priceInp ? (parseFloat(priceInp.value) || 0) : (parseFloat(tr.dataset.price) || 0);
                    grandTotalCalc.val += qty * unitPrice;
                    const item = {
                        product_id: parseInt(tr.dataset.productId),
                        quantity: qty,
                        product_condition: cond ? cond.value : 'saleable',
                        reason_code: reasonCode
                    };
                    if (_isFreeReturn && priceInp) {
                        item.unit_price = unitPrice;
                        item.cost_price = 0;
                    }
                    items.push(item);
                }
            });

            if (errorMsg) { await window.showAlert(errorMsg, { type: 'danger' }); return; }
            if (items.length === 0) { await window.showAlert('أدخل كمية مرتجعة لصنف واحد على الأقل', { type: 'warning' }); return; }

            // Extract extra reason fields
            const extraFields = {};
            if (reasonCode === 'damaged') {
                const dl = document.getElementById('sr-damage-level');
                const dn = document.getElementById('sr-damage-notes');
                const dp = document.getElementById('sr-damage-photos');
                if (dl) extraFields.damage_level = dl.value;
                if (dn) extraFields.damage_notes = dn.value;
                if (dp) extraFields.damage_photos = dp.value;
            } else if (reasonCode === 'expired') {
                const bn = document.getElementById('sr-batch-no');
                const ex = document.getElementById('sr-expiry-date');
                if (bn) extraFields.batch_no = bn.value;
                if (ex) extraFields.expiry_date = ex.value;
            } else if (reasonCode === 'wrong_item') {
                const ci = document.getElementById('sr-correct-item');
                if (ci) extraFields.correct_item = ci.value;
            } else if (reasonCode === 'customer_refused') {
                const cn = document.getElementById('sr-customer-notes');
                if (cn) extraFields.customer_notes = cn.value;
            }

            // Preview confirmation
            const confirmMsg = 'تأكيد إنشاء المرتجع\n\n' +
                '• حركة مخزنية: تحديث المخزون حسب حالة المنتج\n' +
                '• قيد محاسبي: عكس الإيراد + إثبات المخزون\n' +
                '• ' + (_isFreeReturn ? 'تحديث رصيد العميل' : 'تحديث رصيد العميل + حالة الفاتورة') + '\n\n' +
                'هل أنت متأكد من إنشاء المرتجع؟';

            const confirmed = await window.showConfirm(confirmMsg, {
                title: 'معاينة تأثير العملية',
                type: 'warning',
                confirmText: 'تأكيد الإنشاء'
            });
            if (!confirmed) return;

            btnSave.disabled = true;
            btnSave.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';
            try {
                const payload = {
                    customer_id: parseInt(customerId),
                    return_date: returnDate,
                    reason_code: reasonCode,
                    notes: notes || undefined,
                    items: items,
                    ...extraFields
                };
                if (_isFreeReturn) {
                    payload.is_free_return = true;
                    payload.store_id = parseInt(storeId);
                    if (refNo) {
                        payload.notes = (payload.notes ? payload.notes + '\n' : '') + 'المرجع: ' + refNo;
                    }
                } else {
                    payload.invoice_id = parseInt(invoiceId);
                }
                const res = await window.API.request('/sales/returns', 'POST', payload);
                if (res.success) {
                    await window.showAlert('تم إنشاء المرتجع بنجاح! رقم المرتجع: ' + (res.id || '') + (res.workflow_status === 'pending_approval' ? '\n(المرتجع بانتظار الاعتماد)' : ''), { type: 'success' });
                    clearForm();
                    EventBus.emit('sales:return:created', res);
                } else {
                    await window.showAlert('خطأ: ' + (res.message || 'فشل إنشاء المرتجع'), { type: 'danger' });
                }
            } catch(e) {
                console.error(e);
                await window.showAlert('خطأ: ' + (e.message || 'حدث خطأ أثناء الحفظ'), { type: 'danger' });
            } finally {
                btnSave.disabled = false;
                btnSave.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> حفظ المرتجع';
            }
        };
    }

    // ── Escape HTML helper ──
    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/[&<>"']/g, function(m) {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            if (m === '"') return '&quot;';
            if (m === "'") return '&#039;';
            return m;
        });
    }

    // ── Load all recent returns on init ──
    loadReturnHistory();

    // ── History search ──
    const histSearchInput = document.getElementById('sr-history-search-q');
    if (histSearchInput) {
        let histTimer;
        histSearchInput.addEventListener('input', function() {
            clearTimeout(histTimer);
            histTimer = setTimeout(() => loadReturnHistory(null, histSearchInput.value), 300);
        });
    }
};

// ---- Supplier Payments Logic ----
window.loadSupplierPayments = async function() {
    const selSup = document.getElementById('spay-supplier');
    const pDate = document.getElementById('spay-date');
    const btnSave = document.getElementById('btn-save-spay');
    
    if (!selSup || selSup.dataset.wired) return;
    selSup.dataset.wired = '1';
    
    if (pDate && !pDate.value) pDate.value = new Date().toISOString().slice(0, 10);
    
    if (window.AppData && window.AppData.suppliers) {
        selSup.innerHTML = '<option value="">-- اختر المورد --</option>';
        window.AppData.suppliers.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.name;
            selSup.appendChild(opt);
        });
    }
    
    const loadData = async () => {
        try {
            const tbody = document.getElementById('spay-tbody');
            if(!tbody) return;
            const res = await window.API.getSupplierPayments();
            tbody.innerHTML = '';
            res.data.forEach(p => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${p.payment_no}</td>
                    <td>${p.payment_date}</td>
                    <td>${p.supplier_name}</td>
                    <td>${formatMoney(p.amount)} ج.م</td>
                    <td>${p.payment_method === 'cash' ? 'نقدي' : (p.payment_method === 'bank' ? 'تحويل بنكي' : 'شيك')}</td>
                    <td><button class="icon-btn btn-print"><i class="fa-solid fa-print"></i></button></td>
                `;
                tbody.appendChild(tr);
            });
            if(res.data.length === 0) tbody.innerHTML = '<tr><td colspan="6" class="text-center">لا توجد بيانات لعرضها المرجو التأكد أو البحث مجدداً</td></tr>';
        } catch(e) {}
    };
    
    if (btnSave) {
        btnSave.onclick = async () => {
            const data = {
                supplier_id: selSup.value,
                payment_date: pDate.value,
                amount: parseFloat(document.getElementById('spay-amount').value) || 0,
                payment_method: document.getElementById('spay-method').value,
                notes: document.getElementById('spay-notes').value
            };
            
            if (!data.supplier_id || data.amount <= 0) {
                alert('الرجاء اختيار المورد وإدخال مبلغ صحيح');
                return;
            }
            
            btnSave.disabled = true;
            try {
                await window.API.saveSupplierPayment(data);
                showAlert('تم تسجيل الدفعة بنجاح', { title: 'تمت العملية', type: 'success', infoText: false });
                document.getElementById('spay-amount').value = '';
                document.getElementById('spay-notes').value = '';
                loadData();
                if (typeof window.loadSuppliers === 'function') window.loadSuppliers();
            } catch(e) {} finally {
                btnSave.disabled = false;
            }
        };
    }
    
    loadData();
};

// ---- Supplier Statement Logic ----
window.initSupplierStatement = function() {
    const selSup = document.getElementById('sup-stmt-select');
    const btnRun = document.getElementById('btn-run-sup-stmt');
    
    if (!selSup || !btnRun || btnRun.dataset.wired) return;
    btnRun.dataset.wired = '1';
    
    if (selSup.options.length <= 1 && window.AppData && window.AppData.suppliers) {
        window.AppData.suppliers.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.name;
            selSup.appendChild(opt);
        });
    }
    
    if (selSup && !selSup.dataset.searchable) {
        selSup.dataset.searchable = '1';
        makeSearchableSelect(selSup, window.AppData.suppliers, 'ابحث عن مورد...');
    }
    
    btnRun.addEventListener('click', async () => {
        const supId = selSup.value;
        if (!supId) { alert('الرجاء اختيار المورد'); return; }
        
        btnRun.disabled = true;
        btnRun.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        
        try {
            const from = document.getElementById('sup-stmt-from').value;
            const to = document.getElementById('sup-stmt-to').value;
            const params = {};
            if(from) params.from = from;
            if(to) params.to = to;
            
            const res = await window.API.request(`/payments/supplier/${supId}/statement${new URLSearchParams(params).toString() ? '?'+new URLSearchParams(params).toString() : ''}`);
            const data = res.data;
            
            document.getElementById('sup-stmt-name').textContent = data.supplier.supplier_name;
            document.getElementById('sup-stmt-period').textContent = (from ? from : 'بداية المدة') + ' إلى ' + (to ? to : 'اليوم');
            const bal = parseFloat(data.supplier.current_balance) || 0;
            document.getElementById('sup-stmt-balance').innerHTML =formatMoney(Math.abs(bal)) + ' ج.م';
            document.getElementById('sup-stmt-balance-type').textContent = bal > 0 ? 'دائن (له)' : (bal < 0 ? 'مدين (عليه)' : 'متاح');
            
            const tbody = document.getElementById('sup-stmt-tbody');
            tbody.innerHTML = '';
            
            let runningBalance = 0;
            
            const initTr = document.createElement('tr');
            initTr.innerHTML = `
                <td>-</td>
                <td>رصيد افتتاحي / سابق</td>
                <td>-</td>
                <td>-</td>
                <td>-</td>
                <td style="font-weight:bold;">0.00</td>
            `;
            tbody.appendChild(initTr);
            
            data.transactions.forEach(tx => {
                let credit = 0; // له (مشتريات)
                let debit = 0;  // عليه (مدفوعة / مرتجعة)
                let docType = '';
                
                if (tx.type === 'purchase') { credit = tx.amount; docType = 'فاتورة مشتريات'; }
                if (tx.type === 'payment') { debit = tx.amount; docType = 'سداد نقدي/بنكي'; }
                if (tx.type === 'return') { debit = tx.amount; docType = 'مرتجع مشتريات'; }
                
                runningBalance += credit - debit;
                
                let balColor = runningBalance > 0 ? 'color:var(--danger-color)' : (runningBalance < 0 ? 'color:var(--success-color)' : '');
                let creditColor = credit > 0 ? 'color:var(--danger-color)' : '';
                let debitColor = debit > 0 ? 'color:var(--success-color)' : '';
                
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${tx.date}</td>
                    <td>${docType}</td>
                    <td>${tx.doc_no || '-'}</td>
                    <td style="${creditColor}">${credit > 0 ? formatMoney(credit) : '-'}</td>
                    <td style="${debitColor}">${debit > 0 ? formatMoney(debit) : '-'}</td>
                    <td style="font-weight:bold; ${balColor}">${formatMoney(Math.abs(runningBalance))}</td>
                `;
                tbody.appendChild(tr);
            });
            
            document.getElementById('report-supplier-statement-results').style.display = 'block';
        } catch(e) {
            console.error(e);
        } finally {
            btnRun.disabled = false;
            btnRun.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> بحث';
        }
    });
};

// ---- Supplier List ----
let _supSearchTimer;
let _supSortBy = 'supplier_name';
let _supSortOrder = 'ASC';
let _supPage = 1;

window.loadSuppliersList = async function(q, active, page) {
    const tbody = document.getElementById('suppliers-list-body');
    if (!tbody) return;

    // One-time button wiring (handles both direct nav and popup nav paths)
    const supSection = document.getElementById('view-suppliers');
    if (supSection && !supSection.dataset.wired) {
        supSection.dataset.wired = '1';
        const btnAdd = document.getElementById('btn-add-supplier');
        if (btnAdd) btnAdd.addEventListener('click', () => window.openSupplierForm());
        const btnRefresh = document.getElementById('btn-refresh-suppliers');
        if (btnRefresh) btnRefresh.addEventListener('click', () => window.loadSuppliersList());
        const supSearch = document.getElementById('sup-search-q');
        if (supSearch) {
            supSearch.addEventListener('input', () => {
                clearTimeout(_supSearchTimer);
                _supSearchTimer = setTimeout(() => { _supPage = 1; window.loadSuppliersList(); }, 350);
            });
        }
        const supFilter = document.getElementById('sup-filter-active');
        if (supFilter) {
            supFilter.addEventListener('change', () => { _supPage = 1; window.loadSuppliersList(); });
        }
        document.querySelectorAll('#suppliers-table th[data-sort]').forEach(th => {
            th.addEventListener('click', () => {
                const col = th.dataset.sort;
                if (_supSortBy === col) {
                    _supSortOrder = _supSortOrder === 'ASC' ? 'DESC' : 'ASC';
                } else {
                    _supSortBy = col;
                    _supSortOrder = 'ASC';
                }
                document.querySelectorAll('#suppliers-table th[data-sort] i').forEach(i => i.className = 'fa-solid fa-sort');
                const icon = th.querySelector('i');
                if (icon) icon.className = 'fa-solid fa-sort-' + (_supSortOrder === 'ASC' ? 'up' : 'down');
                _supPage = 1;
                window.loadSuppliersList();
            });
        });
    }

    const searchQ = document.getElementById('sup-search-q');
    const filterActive = document.getElementById('sup-filter-active');

    if (q === undefined) q = searchQ ? searchQ.value : '';
    if (active === undefined) active = filterActive ? filterActive.value : '1';
    if (page !== undefined) _supPage = page;

    tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="padding:30px;color:#888;"><i class="fa-solid fa-spinner fa-spin" style="margin-left:6px"></i> جاري التحميل...</td></tr>';

    try {
        const params = { q, active, page: _supPage, limit: 15, sort_by: _supSortBy, sort_order: _supSortOrder };
        const res = await window.API.getSuppliers(params);
        const suppliers = res.data;
        const total = res.total || 0;

        tbody.innerHTML = '';

        suppliers.forEach(s => {
            const bal = parseFloat(s.current_balance) || 0;
            const tr = document.createElement('tr');
            tr.style.cursor = 'pointer';
            tr.innerHTML = `
                <td style="font-weight:bold;color:var(--primary-color)">${s.supplier_code}</td>
                <td><strong>${s.supplier_name}</strong>${!s.is_active ? ' <span class="badge-status" style="background:#dc2626;font-size:0.7rem;">غير نشط</span>' : ''}</td>
                <td>${s.phone || s.mobile || '<span style="color:#aaa">—</span>'}</td>
                <td style="font-weight:bold;color:${bal > 0 ? 'var(--danger-color)' : 'var(--success-color)'}">${formatMoney(bal)} ج.م</td>
                <td class="actions-cell">
                    <button class="icon-btn btn-view" title="عرض التفاصيل" data-id="${s.id}"><i class="fa-solid fa-eye"></i></button>
                    <button class="icon-btn btn-edit" title="تعديل" data-id="${s.id}"><i class="fa-solid fa-pen-to-square"></i></button>
                    ${window.AppData?.user?.role === 'admin' ? `<button class="icon-btn btn-delete" title="حذف" data-id="${s.id}"><i class="fa-solid fa-trash"></i></button>` : ''}
                </td>
            `;
            tr.querySelector('.btn-view').addEventListener('click', (e) => { e.stopPropagation(); window.showSupplierDetail(s.id); });
            tr.querySelector('.btn-edit').addEventListener('click', (e) => { e.stopPropagation(); window.openSupplierForm(s); });
            const delBtn = tr.querySelector('.btn-delete');
            if (delBtn) delBtn.addEventListener('click', (e) => { e.stopPropagation(); window.deleteSupplier(s.id, s.supplier_name); });
            tr.addEventListener('click', () => window.showSupplierDetail(s.id));
            tbody.appendChild(tr);
        });

        if (suppliers.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="padding:30px;color:#888;"><i class="fa-solid fa-circle-info" style="margin-left:6px"></i> لا توجد بيانات لعرضها</td></tr>';
        }

        // Pagination
        const pagDiv = document.getElementById('sup-pagination');
        if (pagDiv) {
            const totalPages = Math.ceil(total / 15);
            let pagHtml = '';
            if (totalPages > 1) {
                pagHtml = '<span style="margin-left:8px;color:#888;font-size:0.85rem;">صفحة ' + _supPage + ' من ' + totalPages + ' (' + total + ')</span>';
                if (_supPage > 1) pagHtml += '<button class="btn btn-outline btn-sm sup-page-btn" data-page="1"><i class="fa-solid fa-angles-right"></i></button> <button class="btn btn-outline btn-sm sup-page-btn" data-page="' + (_supPage - 1) + '"><i class="fa-solid fa-chevron-right"></i></button> ';
                pagHtml += '<span style="margin:0 5px;font-weight:bold;color:var(--primary-color)">' + _supPage + '</span> ';
                if (_supPage < totalPages) pagHtml += '<button class="btn btn-outline btn-sm sup-page-btn" data-page="' + (_supPage + 1) + '"><i class="fa-solid fa-chevron-left"></i></button> <button class="btn btn-outline btn-sm sup-page-btn" data-page="' + totalPages + '"><i class="fa-solid fa-angles-left"></i></button>';
            }
            pagDiv.innerHTML = pagHtml || '';
            pagDiv.querySelectorAll('.sup-page-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    _supPage = parseInt(btn.dataset.page);
                    window.loadSuppliersList();
                });
            });
        }
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger" style="padding:20px;"><i class="fa-solid fa-circle-exclamation" style="margin-left:6px"></i> خطأ في تحميل البيانات</td></tr>';
        console.error(e);
    }
};

// ---- Supplier Form Modal (Add / Edit) ----
window.openSupplierForm = function(supplier) {
    const isEdit = !!supplier;
    const modal = document.getElementById('global-modal');
    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');
    const btnSave = document.getElementById('btn-modal-save');
    if (!modal || !modalBody) return;

    modalTitle.textContent = isEdit ? 'تعديل بيانات المورد' : 'إضافة مورد جديد';
    modalBody.innerHTML = `
        <div class="form-grid" style="grid-template-columns:1fr 1fr;">
            <div class="form-group"><label>كود المورد</label><input type="text" id="sup-code" class="form-control" placeholder="تلقائي" value="${isEdit ? (supplier.supplier_code || '') : ''}" ${isEdit ? 'disabled' : ''}></div>
            <div class="form-group"><label>اسم المورد <span class="text-danger">*</span></label><input type="text" id="sup-name" class="form-control" value="${isEdit ? escapeHtml(supplier.supplier_name || '') : ''}"></div>
            <div class="form-group"><label>التليفون</label><input type="text" id="sup-phone" class="form-control" value="${isEdit ? escapeHtml(supplier.phone || '') : ''}"></div>
            <div class="form-group"><label>موبايل</label><input type="text" id="sup-mobile" class="form-control" value="${isEdit ? escapeHtml(supplier.mobile || '') : ''}"></div>
            <div class="form-group"><label>البريد الإلكتروني</label><input type="email" id="sup-email" class="form-control" value="${isEdit ? escapeHtml(supplier.email || '') : ''}"></div>
            <div class="form-group"><label>الرقم الضريبي</label><input type="text" id="sup-tax" class="form-control" value="${isEdit ? escapeHtml(supplier.tax_number || '') : ''}"></div>
            <div class="form-group"><label>الرصيد الافتتاحي</label><input type="number" id="sup-ob" class="form-control" value="${isEdit ? (supplier.opening_balance || 0) : 0}" min="0"></div>
            <div class="form-group" style="grid-column:1/-1;"><label>العنوان</label><input type="text" id="sup-address" class="form-control" value="${isEdit ? escapeHtml(supplier.address || '') : ''}"></div>
            <div class="form-group" style="grid-column:1/-1;"><label>ملاحظات</label><textarea id="sup-notes" class="form-control" rows="2">${isEdit ? escapeHtml(supplier.notes || '') : ''}</textarea></div>
            <div class="form-group d-flex align-items-center" style="gap:8px;">
                <label class="checkbox-label" style="margin:0"><input type="checkbox" id="sup-active" ${!isEdit || supplier.is_active ? 'checked' : ''}> <span>نشط</span></label>
            </div>
        </div>
    `;

    btnSave.style.display = 'inline-flex';
    btnSave.onclick = null; // clear previous
    const newBtn = btnSave.cloneNode(true);
    btnSave.parentNode.replaceChild(newBtn, btnSave);
    newBtn.innerHTML = '<i class="fa-solid fa-floppy-disk" style="margin-left:6px"></i> ' + (isEdit ? 'حفظ التعديلات' : 'إضافة المورد');
    newBtn.onclick = async () => {
        const name = document.getElementById('sup-name').value.trim();
        if (!name) { window.showAlert('اسم المورد مطلوب', { type: 'warning' }); return; }

        const data = {
            supplier_name: name,
            supplier_code: document.getElementById('sup-code').value.trim() || undefined,
            phone: document.getElementById('sup-phone').value.trim(),
            mobile: document.getElementById('sup-mobile').value.trim(),
            email: document.getElementById('sup-email').value.trim(),
            tax_number: document.getElementById('sup-tax').value.trim(),
            address: document.getElementById('sup-address').value.trim(),
            opening_balance: parseFloat(document.getElementById('sup-ob').value) || 0,
            notes: document.getElementById('sup-notes').value.trim(),
            is_active: document.getElementById('sup-active').checked ? 1 : 0
        };

        newBtn.disabled = true;
        newBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        try {
            const res = isEdit ? await window.API.saveSupplier(data, supplier.id) : await window.API.saveSupplier(data);
            if (res.success) {
                window.showAlert(isEdit ? 'تم تحديث بيانات المورد بنجاح' : 'تم إضافة المورد بنجاح', { type: 'success' });
                modal.classList.remove('active');
                window.loadSuppliersList();
            } else {
                window.showAlert(res.message || 'حدث خطأ', { type: 'danger' });
            }
        } catch (e) {
            window.showAlert(e.data?.message || e.message || 'حدث خطأ في الاتصال', { type: 'danger' });
        } finally {
            newBtn.disabled = false;
            newBtn.innerHTML = '<i class="fa-solid fa-floppy-disk" style="margin-left:6px"></i> ' + (isEdit ? 'حفظ التعديلات' : 'إضافة المورد');
        }
    };

    const cancelBtn = document.getElementById('btn-modal-cancel');
    if (cancelBtn) cancelBtn.textContent = 'إلغاء';
    modal.classList.add('active');
};

// ---- Supplier Detail Modal ----
window.showSupplierDetail = async function(id) {
    try {
        const res = await window.API.getSupplier(id);
        const s = res.data;
        if (!s) { window.showAlert('المورد غير موجود', { type: 'danger' }); return; }

        const modal = document.getElementById('global-modal');
        const modalTitle = document.getElementById('modal-title');
        const modalBody = document.getElementById('modal-body');
        const btnSave = document.getElementById('btn-modal-save');
        if (!modal || !modalBody) return;

        modalTitle.textContent = 'تفاصيل المورد: ' + s.supplier_name;
        const bal = parseFloat(s.current_balance) || 0;

        modalBody.innerHTML = `
            <div class="card" style="padding:15px;margin-bottom:15px;">
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:15px;">
                    <div><strong>الكود:</strong> ${s.supplier_code}</div>
                    <div><strong>الاسم:</strong> ${s.supplier_name}</div>
                    <div><strong>التليفون:</strong> ${s.phone || '—'}</div>
                    <div><strong>موبايل:</strong> ${s.mobile || '—'}</div>
                    <div><strong>البريد:</strong> ${s.email || '—'}</div>
                    <div><strong>الرقم الضريبي:</strong> ${s.tax_number || '—'}</div>
                    <div><strong>العنوان:</strong> ${s.address || '—'}</div>
                    <div><strong>الرصيد الافتتاحي:</strong> ${formatMoney(s.opening_balance || 0)} ج.م</div>
                </div>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:15px;">
                <div style="padding:12px;background:#f8f9fa;border-radius:8px;text-align:center;">
                    <div style="font-size:0.8rem;color:#888;">الرصيد الحالي</div>
                    <div style="font-size:1.2rem;font-weight:bold;color:${bal > 0 ? 'var(--danger-color)' : 'var(--success-color)'}">${formatMoney(bal)} ج.م</div>
                </div>
                <div style="padding:12px;background:#f0fdf4;border-radius:8px;text-align:center;">
                    <div style="font-size:0.8rem;color:#888;">إجمالي المشتريات</div>
                    <div style="font-size:1.1rem;font-weight:bold;color:var(--primary-color)" id="sd-total-purchases"><i class="fa-solid fa-spinner fa-spin"></i></div>
                </div>
                <div style="padding:12px;background:#fef2f2;border-radius:8px;text-align:center;">
                    <div style="font-size:0.8rem;color:#888;">إجمالي المدفوع</div>
                    <div style="font-size:1.1rem;font-weight:bold;color:var(--success-color)" id="sd-total-payments"><i class="fa-solid fa-spinner fa-spin"></i></div>
                </div>
                <div style="padding:12px;background:#fffbeb;border-radius:8px;text-align:center;">
                    <div style="font-size:0.8rem;color:#888;">المرتجعات</div>
                    <div style="font-size:1.1rem;font-weight:bold;color:var(--warning-color)" id="sd-total-returns"><i class="fa-solid fa-spinner fa-spin"></i></div>
                </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:15px;">
                <div>
                    <h4 style="margin:0 0 8px;font-size:0.9rem;color:var(--primary-color)"><i class="fa-solid fa-receipt"></i> آخر الفواتير</h4>
                    <div id="sd-recent-invoices" style="font-size:0.85rem;color:#888;"><i class="fa-solid fa-spinner fa-spin"></i></div>
                </div>
                <div>
                    <h4 style="margin:0 0 8px;font-size:0.9rem;color:var(--success-color)"><i class="fa-solid fa-money-bill-transfer"></i> آخر المدفوعات</h4>
                    <div id="sd-recent-payments" style="font-size:0.85rem;color:#888;"><i class="fa-solid fa-spinner fa-spin"></i></div>
                </div>
            </div>
        `;

        if (btnSave) btnSave.style.display = 'none';
        const cancelBtn = document.getElementById('btn-modal-cancel');
        if (cancelBtn) cancelBtn.textContent = 'إغلاق';

        const detail = s;
        const totals = detail.totals || {};
        const totalPurchases = parseFloat(totals.total_purchases || 0);
        const totalPayments = parseFloat(totals.total_payments || 0);
        const totalReturns = parseFloat(totals.total_returns || 0);

        document.getElementById('sd-total-purchases').innerHTML = formatMoney(totalPurchases) + ' ج.م';
        document.getElementById('sd-total-payments').innerHTML = formatMoney(totalPayments) + ' ج.م';
        document.getElementById('sd-total-returns').innerHTML = formatMoney(totalReturns) + ' ج.م';

        const invHtml = (detail.recent_invoices || []).map(i =>
            '<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #eee;">' +
            '<span>' + i.invoice_no + '</span><span style="font-weight:bold">' + formatMoney(i.grand_total) + ' ج.م</span></div>'
        ).join('') || '<div style="color:#aaa;">لا توجد فواتير</div>';
        document.getElementById('sd-recent-invoices').innerHTML = invHtml;

        const payHtml = (detail.recent_payments || []).map(p =>
            '<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #eee;">' +
            '<span>' + (p.payment_no || p.id) + '</span><span style="font-weight:bold">' + formatMoney(p.amount) + ' ج.م</span></div>'
        ).join('') || '<div style="color:#aaa;">لا توجد مدفوعات</div>';
        document.getElementById('sd-recent-payments').innerHTML = payHtml;

        const retHtml = (detail.recent_returns || []).map(r =>
            '<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #eee;">' +
            '<span>' + r.return_no + '</span><span style="font-weight:bold">' + formatMoney(r.grand_total) + ' ج.م</span></div>'
        ).join('') || '<div style="color:#aaa;">لا توجد مرتجعات</div>';
        document.getElementById('sd-recent-returns')?.remove();
        if ((detail.recent_returns || []).length > 0) {
            const retDiv = document.createElement('div');
            retDiv.innerHTML = '<h4 style="margin:8px 0;font-size:0.9rem;color:var(--warning-color)"><i class="fa-solid fa-undo"></i> آخر المرتجعات</h4><div style="font-size:0.85rem;">' + retHtml + '</div>';
            document.querySelector('#modal-body .card:last-child').appendChild(retDiv);
        }

        modal.classList.add('active');
    } catch (e) {
        console.error(e);
        window.showAlert('حدث خطأ في تحميل بيانات المورد', { type: 'danger' });
    }
};

// ---- Delete Supplier ----
window.deleteSupplier = async function(id, name) {
    const confirmed = await showConfirm('هل أنت متأكد من حذف المورد "' + name + '"؟\n\nملاحظة: هذا الإجراء نهائي.', {
        title: 'حذف مورد',
        confirmText: '<i class="fa-solid fa-trash" style="margin-left:6px"></i> حذف',
    });
    if (!confirmed) return;
    try {
        const res = await window.API.deleteSupplier(id);
        window.showAlert('تم حذف المورد بنجاح', { type: 'success' });
        window.loadSuppliersList();
    } catch (e) {
        const msg = e.data?.message || e.message || 'تعذر الحذف';
        window.showAlert(msg, { type: 'danger' });
    }
};

// ---- Backward-compatible loadSuppliers (refresh cache + list) ----
window.loadSuppliers = async function() {
    try {
        const supRes = await window.API.getSuppliers({active: '1', limit: '500'});
        window._cachedSuppliers = supRes.data || [];
        if (!window.AppData) window.AppData = {};
        window.AppData.suppliers = window._cachedSuppliers.map(s => ({id: s.id, name: s.supplier_name}));
    } catch (e) {
        console.error("Supplier cache refresh failed", e);
    }
    const supView = document.getElementById('view-suppliers');
    if (supView && supView.classList.contains('active') && typeof window.loadSuppliersList === 'function') {
        window.loadSuppliersList();
    }
};

// ---- Purchases Report Logic ----
window.initPurchasesReport = function() {
    const btnRun = document.getElementById('btn-run-pur-report');
    if (!btnRun || btnRun.dataset.wired) return;
    btnRun.dataset.wired = '1';
    
    const selSup = document.getElementById('rpt-pur-supplier');
    if (selSup && selSup.options.length <= 1 && window.AppData && window.AppData.suppliers) {
        window.AppData.suppliers.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.name;
            selSup.appendChild(opt);
        });
    }
    
    btnRun.addEventListener('click', async () => {
        btnRun.disabled = true;
        btnRun.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        
        try {
            const from = document.getElementById('rpt-pur-from').value;
            const to = document.getElementById('rpt-pur-to').value;
            const supId = document.getElementById('rpt-pur-supplier').value;
            
            const params = {};
            if (from) params.from = from;
            if (to) params.to = to;
            if (supId) params.supplier_id = supId;
            
            const res = await window.API.getPurchaseInvoices(params);
            
            document.getElementById('report-purchases-results').style.display = 'block';
            
            const tbody = document.getElementById('rpt-pur-tbody');
            tbody.innerHTML = '';
            
            let totalVal = 0, totalPaid = 0, totalRem = 0;
            
            res.data.forEach(inv => {
                totalVal += parseFloat(inv.grand_total) || 0;
                totalPaid += parseFloat(inv.amount_paid) || 0;
                totalRem += parseFloat(inv.remaining) || 0;
                
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${inv.invoice_no}</td>
                    <td>${inv.invoice_date}</td>
                    <td>${inv.supplier_name || 'نقدي'}</td>
                    <td>${formatMoney(inv.grand_total)} ج.م</td>
                    <td style="color:var(--success-color)">${formatMoney(inv.amount_paid)} ج.م</td>
                    <td style="color:var(--danger-color)">${formatMoney(inv.remaining)} ج.م</td>
                `;
                tbody.appendChild(tr);
            });
            
            if (res.data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="text-center">لا توجد بيانات لعرضها المرجو التأكد أو البحث مجدداً</td></tr>';
            }
            
            document.getElementById('rpt-pur-total-value').innerHTML =formatMoney(totalVal) + ' ج.م';
            document.getElementById('rpt-pur-total-paid').innerHTML =formatMoney(totalPaid) + ' ج.م';
            document.getElementById('rpt-pur-total-rem').innerHTML =formatMoney(totalRem) + ' ج.م';
            
        } catch(e) {
            console.error(e);
        } finally {
            btnRun.disabled = false;
            btnRun.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> بحث';
        }
    });
};

// ---- Purchase Invoice Logic ----
window.initPurchaseInvoice = function() {
    console.log('[TRACE] initPurchaseInvoice: ENTER');
    const btnAddRow = document.getElementById('btn-add-prow');
    const tbody = document.getElementById('pinvoice-items-body');
    const btnSave = document.getElementById('btn-save-pinvoice');
    const selSupplier = document.getElementById('pinv-supplier');
    const pDate = document.getElementById('pinv-date');
    const pPayment = document.getElementById('pinv-payment');
    const pAmountPaid = document.getElementById('p-amount-paid');
    
    console.log('[TRACE] initPurchaseInvoice: btnAddRow=', !!btnAddRow, 'tbody=', !!tbody, 'selSupplier=', !!selSupplier, 'wired=', btnAddRow?.dataset?.wired || 'NOT SET');
    if (!btnAddRow || !tbody || btnAddRow.dataset.wired) {
        console.log('[TRACE] initPurchaseInvoice: EARLY RETURN — btnAddRow=', !!btnAddRow, 'tbody=', !!tbody, 'wired=', btnAddRow?.dataset?.wired);
        return;
    }
    btnAddRow.dataset.wired = '1';

    if (pDate && !pDate.value) pDate.value = new Date().toISOString().slice(0, 10);

    // Search listener
    const searchQ = document.getElementById('pinv-search-q');
    if (searchQ && !searchQ.dataset.wired) {
        searchQ.dataset.wired = '1';
        let debounceTimer;
        searchQ.addEventListener('input', function() {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                if (typeof window.loadPurchaseInvoicesList === 'function') {
                    window.loadPurchaseInvoicesList(this.value);
                }
            }, 400);
        });
    }
    
    console.log('[TRACE] initPurchaseInvoice: supplier check — options.length=', selSupplier?.options?.length, 'AppData.suppliers=', window.AppData?.suppliers?.length || 0);
    if (selSupplier && selSupplier.options.length <= 1 && window.AppData && window.AppData.suppliers) {
        window.AppData.suppliers.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.name;
            selSupplier.appendChild(opt);
        });
        console.log('[TRACE] initPurchaseInvoice: populated supplier with', selSupplier.options.length, 'native options');
        if (!selSupplier.dataset.searchable) {
            makeSearchableSelect(selSupplier, window.AppData.suppliers, 'ابحث عن مورد...');
            selSupplier.dataset.searchable = '1';
            console.log('[TRACE] initPurchaseInvoice: makeSearchableSelect called, wrapper=', selSupplier.nextElementSibling?.className);
        } else {
            console.log('[TRACE] initPurchaseInvoice: supplier already has searchable, skipping');
        }
        console.log('[TRACE] initPurchaseInvoice: FINAL — native options=', selSupplier.options.length, 'wrapper=', !!selSupplier.nextElementSibling?.classList?.contains('custom-select-wrapper'));
    } else {
        console.log('[TRACE] initPurchaseInvoice: supplier populate SKIPPED — options.length=', selSupplier?.options?.length, 'hasAppDataSuppliers=', !!(window.AppData?.suppliers));
    }
    
    let dlist = document.getElementById('product-list');
    if (!dlist) {
        dlist = document.createElement('datalist');
        dlist.id = 'product-list';
        document.body.appendChild(dlist);
        if (window.AppData && window.AppData.products) {
            window.AppData.products.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.product_name;
                opt.dataset.id = p.id;
                opt.dataset.price = p.sell_price;
                opt.dataset.cost = p.cost_price;
                dlist.appendChild(opt);
            });
        }
    }
    
    function calcPTotals() {
        let grandTotal = 0;
        tbody.querySelectorAll('tr').forEach((tr, idx) => {
            tr.firstElementChild.textContent = idx + 1;
            const qty = parseFloat(tr.querySelector('.pitem-qty').value) || 0;
            const cost = parseFloat(tr.querySelector('.pitem-cost').value) || 0;
            const lineTotal = qty * cost;
            tr.querySelector('.pitem-total').value = lineTotal.toFixed(2);
            grandTotal += lineTotal;
        });
        
        document.getElementById('p-grand-total').innerHTML =formatMoney(grandTotal) + ' ج.م';
        
        let paid = parseFloat(pAmountPaid.value) || 0;
        if (pPayment.value === 'cash') {
            paid = grandTotal;
            pAmountPaid.value = grandTotal.toFixed(2);
            pAmountPaid.disabled = true;
        } else {
            pAmountPaid.disabled = false;
        }
        
        const rem = grandTotal - paid;
        document.getElementById('p-remaining').innerHTML =formatMoney(rem) + ' ج.م';
    }
    
    function addPRow() {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td></td>
            <td><input type="text" class="pitem-search" list="product-list" placeholder="ابحث عن صنف..."></td>
            <td><input type="number" class="pitem-qty pcalc" value="1" min="1"></td>
            <td><input type="number" class="pitem-cost pcalc" value="0" min="0"></td>
            <td><input type="number" class="pitem-sell" value="0" min="0" readonly title="يتم تعديل سعر البيع من شاشة الأصناف أو شاشة التسعير فقط" style="background:#f5f5f5;cursor:not-allowed;"></td>
            <td><input type="text" class="pitem-total disabled-input" value="0.00" disabled></td>
            <td><button class="icon-btn text-danger btn-remove-prow"><i class="fa-solid fa-trash"></i></button></td>
        `;
        
        const searchInput = tr.querySelector('.pitem-search');
        searchInput.addEventListener('input', (e) => {
            const val = e.target.value;
            const opt = dlist.querySelector(`option[value="${val}"]`);
            if (opt) {
                tr.dataset.productId = opt.dataset.id;
                tr.querySelector('.pitem-cost').value = opt.dataset.cost || 0;
                tr.querySelector('.pitem-sell').value = opt.dataset.price || 0;
                calcPTotals();
            } else {
                tr.dataset.productId = '';
            }
        });
        
        tr.querySelectorAll('.pcalc').forEach(inp => inp.addEventListener('input', calcPTotals));
        tr.querySelector('.btn-remove-prow').addEventListener('click', () => {
            tr.remove();
            calcPTotals();
        });
        
        tbody.appendChild(tr);
        calcPTotals();
    }
    
    btnAddRow.onclick = addPRow;
    pPayment.addEventListener('change', calcPTotals);
    pAmountPaid.addEventListener('input', calcPTotals);
    
    if (tbody.children.length === 0) addPRow();
    
    btnSave.onclick = async () => {
        const supplier_id = selSupplier.value;
        if (!supplier_id) { alert('اختر المورد'); return; }
        
        const items = [];
        let valid = true;
        tbody.querySelectorAll('tr').forEach(tr => {
            const pid = tr.dataset.productId;
            const qty = parseFloat(tr.querySelector('.pitem-qty').value) || 0;
            const cost = parseFloat(tr.querySelector('.pitem-cost').value) || 0;
            
            if (pid && qty > 0) {
                items.push({ product_id: pid, quantity: qty, cost_price: cost });
            } else if (tr.querySelector('.pitem-search').value.trim() !== '') {
                valid = false;
            }
        });
        
        if (!valid) { alert('يوجد أصناف غير صحيحة أو غير مسجلة'); return; }
        if (items.length === 0) { alert('الفاتورة فارغة'); return; }
        
        const data = {
            supplier_id,
            invoice_date: pDate.value,
            supplier_invoice_no: document.getElementById('pinv-supplier-doc').value,
            store_id: document.getElementById('pinv-store').value,
            payment_type: pPayment.value,
            amount_paid: parseFloat(pAmountPaid.value) || 0,
            items
        };
        
        const editId = window.editingPurchaseInvoiceId;
        
        btnSave.disabled = true;
        try {
            await window.API.savePurchaseInvoice(data, editId);
            showAlert((editId ? 'تم تعديل' : 'تم حفظ') + ' الفاتورة بنجاح وتحديث أرصدة المخزون وحساب المورد', { title: 'تمت العملية', type: 'success', infoText: false });
            window.editingPurchaseInvoiceId = null;
            tbody.innerHTML = '';
            addPRow();
            document.getElementById('pinv-supplier-doc').value = '';
            calcPTotals();
            if (typeof window.loadInventory === 'function') window.loadInventory();
            if (typeof window.loadSuppliers === 'function') window.loadSuppliers();
            if (typeof window.loadPurchaseInvoicesList === 'function') window.loadPurchaseInvoicesList();
        } catch(e) {} finally {
            btnSave.disabled = false;
        }
    };
};

// ---- Purchase Return Logic ----
window.initPurchaseReturn = async function(invoiceNo) {
    const btnSave = document.getElementById('btn-save-preturn');
    const btnSearch = document.getElementById('btn-search-pr-invoice');
    const btnClear = document.getElementById('pr-btn-clear');
    const prTbody = document.getElementById('pr-tbody');
    const prReason = document.getElementById('pr-reason');
    const prDateInput = document.getElementById('pr-date');
    const prInvoiceNo = document.getElementById('pr-invoice-no');
    const prInvoiceId = document.getElementById('pr-invoice-id');
    const prSupplierId = document.getElementById('pr-supplier-id');
    const prSupplierName = document.getElementById('pr-supplier-name');

    if (!prTbody) return;
    let _loadedInvoice = null;
    let _loadedAvailItems = [];

    function showEl(id) { const e = document.getElementById(id); if (e) e.classList.remove('d-none'); }
    function hideEl(id) { const e = document.getElementById(id); if (e) e.classList.add('d-none'); }
    function textEl(id, val) { const e = document.getElementById(id); if (e) e.innerHTML = val; }

    if (prDateInput && !prDateInput.value) prDateInput.value = new Date().toISOString().slice(0, 10);

    // ── Mode Toggle (linked vs manual) ──
    let _prMode = 'invoice';
    const prFreeFields = document.getElementById('pr-free-fields');
    const prLinkedFields = [
        document.getElementById('pr-invoice-select-group'),
        document.getElementById('pr-invoice-no')?.closest('.form-group'),
        document.getElementById('pr-supplier-group'),
        document.getElementById('pr-invoice-info-card'),
        document.getElementById('pr-items-card')
    ];
    document.querySelectorAll('.pr-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            _prMode = btn.dataset.mode;
            document.querySelectorAll('.pr-mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            if (_prMode === 'manual') {
                if (prFreeFields) prFreeFields.classList.remove('d-none');
                prLinkedFields.forEach(f => { if (f) f.classList.add('d-none'); });
            } else {
                if (prFreeFields) prFreeFields.classList.add('d-none');
                prLinkedFields.forEach(f => { if (f) f.classList.remove('d-none'); });
            }
        });
    });

    // ── Load products for free return ──
    let _prFreeProducts = [];
    const prFreeProduct = document.getElementById('pr-free-product');
    const prFreeCost = document.getElementById('pr-free-cost');
    const prFreeQty = document.getElementById('pr-free-qty');
    const prFreeTbody = document.getElementById('pr-free-items-tbody');
    const prFreeSupplier = document.getElementById('pr-free-supplier');
    const prFreeStore = document.getElementById('pr-free-store');
    const prFreeReason = document.getElementById('pr-free-reason');
    const prFreeReasonNote = document.getElementById('pr-free-reason-note');
    const prFreeReasonNoteGroup = document.getElementById('pr-free-reason-note-group');

    // Load suppliers for free return
    (async () => {
        if (!prFreeSupplier) return;
        try {
            const supRes = await window.API.getSuppliers();
            if (supRes.success && Array.isArray(supRes.data)) {
                _prFreeSuppliers = supRes.data;
                prFreeSupplier.innerHTML = '<option value="">-- اختر المورد --</option>' +
                    supRes.data.map(s => `<option value="${s.id}">${s.supplier_name || s.name}</option>`).join('');
                if (typeof makeSearchableSelect === 'function') {
                    makeSearchableSelect(prFreeSupplier, supRes.data.map(s => ({id: s.id, name: s.supplier_name || s.name})), 'ابحث عن مورد...');
                }
            }
        } catch(e) { console.error('Failed to load suppliers for free PR', e); }
    })();

    // Load stores for free return
    (async () => {
        if (!prFreeStore) return;
        try {
            const stRes = await window.API.request('/stores');
            if (stRes.success && Array.isArray(stRes.data)) {
                prFreeStore.innerHTML = '<option value="">-- اختر المخزن --</option>' +
                    stRes.data.map(s => `<option value="${s.id}">${s.store_name}</option>`).join('');
            }
        } catch(e) { console.error('Failed to load stores for free PR', e); }
    })();

    // Load reasons for free return
    (async () => {
        if (!prFreeReason) return;
        try {
            const rRes = await window.API.request('/purchases/returns/reasons/list');
            if (rRes.success && rRes.data) {
                prFreeReason.innerHTML = '<option value="">-- اختر السبب --</option>' +
                    rRes.data.map(r => `<option value="${r.id}">${r.reason_name}</option>`).join('');
            }
        } catch(e) { console.error('Failed to load purchase return reasons', e); }
    })();

    if (prFreeReason) {
        prFreeReason.addEventListener('change', () => {
            const sel = prFreeReason.options[prFreeReason.selectedIndex];
            const name = sel ? sel.textContent : '';
            if (name.includes('أخرى') || name.includes('Other')) {
                if (prFreeReasonNoteGroup) prFreeReasonNoteGroup.classList.remove('d-none');
            } else {
                if (prFreeReasonNoteGroup) prFreeReasonNoteGroup.classList.add('d-none');
            }
        });
    }

    // Load products for free return
    (async () => {
        if (!prFreeProduct) return;
        try {
            const pRes = await window.API.request('/products');
            if (pRes.success && Array.isArray(pRes.data)) {
                _prFreeProducts = pRes.data;
                prFreeProduct.innerHTML = '<option value="">-- اختر الصنف --</option>' +
                    pRes.data.map(p => `<option value="${p.id}" data-cost="${p.cost_price || 0}" data-name="${p.product_name}">${p.product_name} (${p.product_code || ''})</option>`).join('');
            }
        } catch(e) { console.error('Failed to load products for free PR', e); }
    })();

    if (prFreeProduct) {
        prFreeProduct.addEventListener('change', () => {
            const opt = prFreeProduct.options[prFreeProduct.selectedIndex];
            if (opt && opt.value && prFreeCost) {
                prFreeCost.value = opt.dataset.cost || 0;
            }
        });
    }

    // Add item to free return table
    const btnAddPrFreeItem = document.getElementById('btn-add-pr-free-item');
    if (btnAddPrFreeItem) {
        btnAddPrFreeItem.addEventListener('click', () => {
            const pid = prFreeProduct.value;
            const qty = parseFloat(prFreeQty.value) || 0;
            const cost = parseFloat(prFreeCost.value) || 0;
            if (!pid || qty <= 0) { window.showAlert('اختر صنف وأدخل كمية', { type: 'warning' }); return; }
            const opt = prFreeProduct.options[prFreeProduct.selectedIndex];
            const name = opt ? opt.dataset.name : '';
            const tr = document.createElement('tr');
            tr.dataset.productId = pid;
            tr.innerHTML = `<td></td><td>${name}</td><td class="pr-free-qty-cell">${qty}</td><td>${formatMoney(cost)}</td><td class="pr-free-total-cell">${formatMoney(qty * cost)}</td><td><button class="btn btn-sm text-danger btn-remove-pr-free"><i class="fa-solid fa-trash"></i></button></td>`;
            tr.querySelector('.btn-remove-pr-free').addEventListener('click', () => tr.remove());
            if (prFreeTbody) prFreeTbody.appendChild(tr);
            prFreeProduct.value = '';
            prFreeQty.value = 1;
            prFreeCost.value = 0;
        });
    }

    // ── Load reasons ──
    (async () => {
        try {
            const rRes = await window.API.request('/purchases/returns/reasons/list');
            if (rRes.success && prReason) {
                const reasons = rRes.data || [];
                prReason.innerHTML = '<option value="">-- اختر سبب المرتجع الأساسي --</option>' +
                    reasons.map(r => `<option value="${r.id}">${r.reason_name}</option>`).join('');
                if (prReason) {
                    const oldWrapper = prReason.nextElementSibling;
                    if (oldWrapper && oldWrapper.classList.contains('custom-select-wrapper')) oldWrapper.remove();
                    makeSearchableSelect(prReason, reasons.map(r => ({id: r.id, name: r.reason_name})), 'ابحث عن سبب...');
                    prReason.dataset.searchable = '1';
                }
            }
        } catch(e) { console.error('Failed to load return reasons', e); }
    })();

    // ── Supplier → Invoices searchable select ──
    (async () => {
        const supSelect = document.getElementById('pr-supplier-select');
        const invSelect = document.getElementById('pr-invoice-select');
        if (!supSelect) return;
        try {
            if (window.AppData && window.AppData.suppliers) {
                supSelect.innerHTML = '<option value="">-- اختر المورد --</option>' +
                    window.AppData.suppliers.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
                makeSearchableSelect(supSelect, window.AppData.suppliers, 'ابحث عن مورد...');
            } else {
                const supRes = await window.API.getSuppliers();
                if (supRes.success && Array.isArray(supRes.data)) {
                    const supData = supRes.data.map(s => ({ id: s.id, name: s.name || s.supplier_name }));
                    supData.sort((a, b) => a.name.localeCompare(b.name));
                    supSelect.innerHTML = '<option value="">-- اختر المورد --</option>' +
                        supData.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
                    makeSearchableSelect(supSelect, supData, 'ابحث عن مورد...');
                }
            }
            supSelect.addEventListener('change', async function() {
                const sid = this.value;
                if (!invSelect) return;
                if (!sid) {
                    invSelect.innerHTML = '<option value="">-- اختر المورد أولاً --</option>';
                    invSelect.disabled = true;
                    return;
                }
                invSelect.disabled = true;
                invSelect.innerHTML = '<option value="">جاري التحميل...</option>';
                try {
                    const invRes = await window.API.getPurchaseInvoices({ supplier_id: sid });
                    let invoices = invRes.data || [];
                    invoices = invoices.filter(inv => inv.status !== 'cancelled' && inv.status !== 'deleted');
                    if (invoices.length === 0) {
                        invSelect.innerHTML = '<option value="">لا توجد فواتير لهذا المورد</option>';
                    } else {
                        invSelect.innerHTML = '<option value="">-- اختر فاتورة --</option>' +
                            invoices.map(inv => `<option value="${inv.id}">${inv.invoice_no} (${inv.invoice_date || ''}) - ${window.formatMoney ? window.formatMoney(inv.grand_total) : inv.grand_total} [${inv.status}]</option>`).join('');
                        invSelect.disabled = false;
                    }
                } catch(e) {
                    console.error('Failed to load purchase invoices', e);
                    invSelect.innerHTML = '<option value="">خطأ في تحميل الفواتير</option>';
                }
            });
            invSelect.addEventListener('change', function() {
                const invId = this.value;
                if (invId) {
                    if (prInvoiceNo) prInvoiceNo.value = '';
                    loadInvoiceForReturnById(invId);
                }
            });
        } catch(e) { console.error('Failed to init supplier select', e); }
    })();

    // ── Load invoice by ID helper for purchase returns ──
    async function loadInvoiceForReturnById(invoiceId) {
        showEl('pr-loading');
        try {
            const detailRes = await window.API.request('/purchases/invoices/' + invoiceId);
            const detail = detailRes.data;
            if (!detail) { await window.showAlert('خطأ في جلب تفاصيل الفاتورة', { type: 'danger' }); return; }

            const returnStatus = detail.return_status || 'Normal';

            const availRes = await window.API.getPurchaseReturnAvailableQty(invoiceId);
            const availItems = availRes.success ? availRes.data : [];
            const hasReturnable = availItems.some(it => parseFloat(it.remaining_returnable) > 0);
            if (!hasReturnable) {
                await window.showAlert('لا توجد أصناف متاحة للإرجاع في هذه الفاتورة', { type: 'warning' });
                return;
            }

            _loadedInvoice = detail;
            _loadedAvailItems = availItems;

            if (prSupplierName) prSupplierName.value = detail.supplier_name || '';
            if (prSupplierId) prSupplierId.value = detail.supplier_id || '';
            if (prInvoiceId) prInvoiceId.value = detail.id || '';

            textEl('pr-inv-no', detail.invoice_no || '—');
            textEl('pr-inv-date', detail.invoice_date || '—');
            textEl('pr-inv-supplier', detail.supplier_name || '—');
            textEl('pr-inv-supplier-no', detail.supplier_invoice_no || '—');
            textEl('pr-inv-warehouse', detail.warehouse_name || '—');
            textEl('pr-inv-payment', detail.payment_type === 'cash' ? 'نقدي' : 'آجل');

            const invStatusLabels = { posted: 'نشطة', cancelled: 'ملغاة', deleted: 'محذوفة' };
            const invStatusColors = { posted: '#28a745', cancelled: '#dc3545', deleted: '#6c757d' };
            const iStat = detail.status || 'posted';
            const statusBadge = document.getElementById('pr-invoice-status-badge');
            if (statusBadge) {
                statusBadge.textContent = invStatusLabels[iStat] || iStat;
                statusBadge.style.background = (invStatusColors[iStat] || '#888') + '22';
                statusBadge.style.color = invStatusColors[iStat] || '#888';
                statusBadge.style.padding = '3px 10px';
                statusBadge.style.borderRadius = '12px';
            }
            textEl('pr-inv-status', invStatusLabels[iStat] || iStat);

            const rsColors = { Normal: '#28a745', 'Partially Returned': '#ffc707', 'Fully Returned': '#6c757d' };
            const rsLabels = { Normal: 'عادي', 'Partially Returned': 'مرتجع جزئي', 'Fully Returned': 'مرتجع كلياً' };
            const rsPill = document.getElementById('pr-return-status-pill');
            if (rsPill) {
                rsPill.textContent = rsLabels[returnStatus] || returnStatus;
                rsPill.style.background = (rsColors[returnStatus] || '#28a745') + '22';
                rsPill.style.color = rsColors[returnStatus] || '#28a745';
                rsPill.style.padding = '3px 10px';
                rsPill.style.borderRadius = '12px';
            }

            const origTotal = parseFloat(detail.grand_total) || 0;
            const prevReturned = parseFloat(detail.returned_amount) || 0;
            const remReturnable = origTotal - prevReturned;
            textEl('pr-original-total', formatMoney(origTotal));
            textEl('pr-previous-returned', formatMoney(prevReturned));
            textEl('pr-remaining-returnable', formatMoney(Math.max(0, remReturnable)));

            showEl('pr-invoice-info-card');

            // ── Build items grid ──
            prTbody.innerHTML = '';
            let rowIndex = 0;
            const invSubtotal = parseFloat(detail.subtotal) || 1;
            availItems.forEach(item => {
                const remaining = parseFloat(item.remaining_returnable) || 0;
                if (remaining <= 0) return;
                rowIndex++;
                const tr = document.createElement('tr');
                tr.dataset.productId = item.product_id;
                tr.dataset.price = item.cost_price || 0;
                tr.dataset.originalAvail = remaining;
                const itemRatio = (parseFloat(item.cost_price || 0) * remaining) / invSubtotal;
                tr.dataset.discShare = parseFloat(detail.discount_amount || 0) * itemRatio || 0;
                const taxRate = invSubtotal > 0 ? (parseFloat(detail.tax_amount || 0) / invSubtotal) : 0;
                tr.dataset.taxShare = taxRate * 100;
                const priceVal = parseFloat(item.cost_price || 0);
                tr.innerHTML =
                    '<td style="text-align:center;color:var(--text-muted);font-size:0.8rem;">' + rowIndex + '</td>' +
                    '<td><div style="font-weight:600;font-size:0.85rem;">' + escapeHtml(item.product_name) + '</div><div style="font-size:0.7rem;color:var(--text-muted);">' + escapeHtml(item.product_code||'') + '</div></td>' +
                    '<td style="text-align:center;font-weight:600;">' + item.purchased_qty + '</td>' +
                    '<td style="text-align:center;color:' + (parseFloat(item.already_returned) > 0 ? 'var(--warning-color)' : '#888') + ';font-weight:600;">' + (item.already_returned || 0) + '</td>' +
                    '<td style="text-align:center;color:var(--success-color);font-weight:700;">' + remaining + '</td>' +
                    '<td style="text-align:center;"><input type="number" class="pr-qty" value="0" min="0" max="' + remaining + '" step="any" style="width:65px;text-align:center;border:1.5px solid var(--primary-color);border-radius:6px;padding:4px 6px;font-family:Cairo,sans-serif;"></td>' +
                    '<td style="text-align:center;">' + formatMoney(priceVal) + '</td>' +
                    '<td class="pr-line-total" style="text-align:center;font-weight:700;color:var(--primary-color);">' + formatMoney(0) + '</td>';
                prTbody.appendChild(tr);
            });

            showEl('pr-items-card');
            if (prTbody.children.length === 0) {
                prTbody.innerHTML = '<tr><td colspan="8" class="text-center" style="padding:20px;color:var(--danger-color);">الفاتورة تم إرجاعها بالكامل أو لا يوجد أصناف متاحة للإرجاع</td></tr>';
            } else {
                prTbody.querySelectorAll('.pr-qty').forEach(inp => {
                    inp.addEventListener('input', onQtyChange);
                    inp.addEventListener('change', onQtyChange);
                });
                recalcAll();
            }

            showEl('pr-details-card');
            showEl('pr-footer-bar');
            if (btnClear) btnClear.classList.remove('d-none');

            // Load return history
            try {
                const histRes = await window.API.getPurchaseReturns({ invoice_id: invoiceId });
                const returns = histRes.data || [];
                const histBody = document.getElementById('pr-history-body');
                const histCard = document.getElementById('pr-history-card');
                if (histBody) {
                    if (returns.length > 0) {
                        showEl('pr-history-card');
                        histBody.innerHTML = '';
                        returns.forEach(r => {
                            const tr = document.createElement('tr');
                            tr.innerHTML = '<td>' + (r.return_no || '—') + '</td>' +
                                '<td>' + (r.return_date || '—') + '</td>' +
                                '<td>' + formatMoney(r.grand_total) + '</td>' +
                                '<td><span style="color:#28a745;font-weight:700">معتمد</span></td>' +
                                '<td>' + (r.reason_code || '—') + '</td>';
                            histBody.appendChild(tr);
                        });
                    }
                }
            } catch(e) { console.error('Failed to load return history', e); }
        } catch(e) {
            console.error('Error loading invoice for return:', e);
            await window.showAlert('حدث خطأ أثناء جلب الفاتورة: ' + (e.message || ''), { type: 'danger' });
        } finally {
            hideEl('pr-loading');
        }
    }

    // ── Recalculation engine ──
    function recalcAll() {
        let subtotal = 0, discountTotal = 0, vatTotal = 0, grandTotal = 0;
        let itemCount = 0;
        const rows = prTbody.querySelectorAll('tr[data-product-id]');

        rows.forEach(tr => {
            const qtyInp = tr.querySelector('.pr-qty');
            const qty = parseFloat(qtyInp?.value) || 0;
            const price = parseFloat(tr.dataset.price || 0);
            const discShare = parseFloat(tr.dataset.discShare || 0);
            const taxShare = parseFloat(tr.dataset.taxShare || 0);

            if (qty > 0) itemCount++;
            const lineGross = qty * price;
            const lineDisc = discShare * (qty / parseFloat(tr.dataset.originalAvail || qty));
            const lineAfterDisc = lineGross - lineDisc;
            const lineTax = lineAfterDisc * (taxShare / 100);
            const lineTotal = lineAfterDisc + lineTax;

            subtotal += lineGross;
            discountTotal += lineDisc;
            vatTotal += lineTax;
            grandTotal += lineTotal;

            const ltEl = tr.querySelector('.pr-line-total');
            if (ltEl) ltEl.innerHTML = formatMoney(lineTotal);
        });

        textEl('pr-item-count', itemCount);
        textEl('pr-subtotal', formatMoney(subtotal));
        textEl('pr-discount-total', formatMoney(discountTotal));
        textEl('pr-vat-total', formatMoney(vatTotal));
        textEl('pr-grand-total', formatMoney(grandTotal));
        textEl('pr-balance-impact', formatMoney(grandTotal));

        const origTotal = _loadedInvoice ? (parseFloat(_loadedInvoice.grand_total) || 0) : 0;
        const prevReturned = _loadedInvoice ? (parseFloat(_loadedInvoice.returned_amount) || 0) : 0;
        const remainingInv = origTotal - prevReturned - grandTotal;
        textEl('pr-footer-items', itemCount);
        textEl('pr-footer-original', formatMoney(origTotal));
        textEl('pr-footer-remaining-inv', formatMoney(Math.max(0, remainingInv)));
        textEl('pr-footer-current', formatMoney(grandTotal));

        if (grandTotal > 0) { showEl('pr-preview-card'); } else { hideEl('pr-preview-card'); }
    }

    function onQtyChange() { recalcAll(); }

    // ── Load invoice for return ──
    async function loadInvoiceForReturn(invNo) {
        invNo = invNo || (prInvoiceNo ? prInvoiceNo.value.trim() : '');
        if (!invNo) { await window.showAlert('أدخل رقم الفاتورة أولاً', { type: 'warning' }); return; }

        showEl('pr-loading');
        try {
            const res = await window.API.getPurchaseInvoices({ q: invNo });
            const inv = res.data && res.data.find(i => i.invoice_no === invNo || String(i.id) === String(invNo));
            if (!inv) { await window.showAlert('لم يتم العثور على الفاتورة', { type: 'warning' }); return; }

            if (inv.status === 'cancelled' || inv.status === 'deleted') {
                await window.showAlert('الفاتورة ملغاة ولا يمكن عمل مرتجع لها', { type: 'danger' });
                return;
            }

            const detailRes = await window.API.request('/purchases/invoices/' + inv.id);
            const detail = detailRes.data;
            if (!detail) { await window.showAlert('خطأ في جلب تفاصيل الفاتورة', { type: 'danger' }); return; }

            const returnStatus = detail.return_status || 'Normal';

            const availRes = await window.API.getPurchaseReturnAvailableQty(inv.id);
            const availItems = availRes.success ? availRes.data : [];
            const hasReturnable = availItems.some(it => parseFloat(it.remaining_returnable) > 0);
            if (!hasReturnable) {
                await window.showAlert('لا توجد أصناف متاحة للإرجاع في هذه الفاتورة', { type: 'warning' });
                return;
            }

            _loadedInvoice = detail;
            _loadedAvailItems = availItems;

            if (prSupplierName) prSupplierName.value = detail.supplier_name || '';
            if (prSupplierId) prSupplierId.value = detail.supplier_id || '';
            if (prInvoiceId) prInvoiceId.value = detail.id || '';

            // ── Populate invoice info card ──
            textEl('pr-inv-no', detail.invoice_no || '—');
            textEl('pr-inv-date', detail.invoice_date || '—');
            textEl('pr-inv-supplier', detail.supplier_name || '—');
            textEl('pr-inv-supplier-no', detail.supplier_invoice_no || '—');
            textEl('pr-inv-warehouse', detail.warehouse_name || '—');
            textEl('pr-inv-payment', detail.payment_type === 'cash' ? 'نقدي' : 'آجل');

            const invStatusLabels = { posted: 'نشطة', cancelled: 'ملغاة', deleted: 'محذوفة' };
            const invStatusColors = { posted: '#28a745', cancelled: '#dc3545', deleted: '#6c757d' };
            const iStat = detail.status || 'posted';
            const statusBadge = document.getElementById('pr-invoice-status-badge');
            if (statusBadge) {
                statusBadge.textContent = invStatusLabels[iStat] || iStat;
                statusBadge.style.background = (invStatusColors[iStat] || '#888') + '22';
                statusBadge.style.color = invStatusColors[iStat] || '#888';
                statusBadge.style.padding = '3px 10px';
                statusBadge.style.borderRadius = '12px';
            }
            textEl('pr-inv-status', invStatusLabels[iStat] || iStat);

            const rsColors = { Normal: '#28a745', 'Partially Returned': '#ffc707', 'Fully Returned': '#6c757d' };
            const rsLabels = { Normal: 'عادي', 'Partially Returned': 'مرتجع جزئي', 'Fully Returned': 'مرتجع كلياً' };
            const rsPill = document.getElementById('pr-return-status-pill');
            if (rsPill) {
                rsPill.textContent = rsLabels[returnStatus] || returnStatus;
                rsPill.style.background = (rsColors[returnStatus] || '#28a745') + '22';
                rsPill.style.color = rsColors[returnStatus] || '#28a745';
                rsPill.style.padding = '3px 10px';
                rsPill.style.borderRadius = '12px';
            }

            const origTotal = parseFloat(detail.grand_total) || 0;
            const prevReturned = parseFloat(detail.returned_amount) || 0;
            const remReturnable = origTotal - prevReturned;
            textEl('pr-original-total', formatMoney(origTotal));
            textEl('pr-previous-returned', formatMoney(prevReturned));
            textEl('pr-remaining-returnable', formatMoney(Math.max(0, remReturnable)));

            showEl('pr-invoice-info-card');

            // ── Build items grid ──
            prTbody.innerHTML = '';
            let rowIndex = 0;
            const invSubtotal = parseFloat(detail.subtotal) || 1;
            availItems.forEach(item => {
                const remaining = parseFloat(item.remaining_returnable) || 0;
                if (remaining <= 0) return;

                rowIndex++;
                const tr = document.createElement('tr');
                tr.dataset.productId = item.product_id;
                tr.dataset.price = item.cost_price || 0;
                tr.dataset.originalAvail = remaining;

                // Pro-rata discount and tax
                const itemRatio = (parseFloat(item.cost_price || 0) * remaining) / invSubtotal;
                tr.dataset.discShare = parseFloat(detail.discount_amount || 0) * itemRatio || 0;
                const taxRate = invSubtotal > 0 ? (parseFloat(detail.tax_amount || 0) / invSubtotal) : 0;
                tr.dataset.taxShare = taxRate * 100;

                const priceVal = parseFloat(item.cost_price || 0);
                tr.innerHTML =
                    '<td style="text-align:center;color:var(--text-muted);font-size:0.8rem;">' + rowIndex + '</td>' +
                    '<td><div style="font-weight:600;font-size:0.85rem;">' + escapeHtml(item.product_name) + '</div><div style="font-size:0.7rem;color:var(--text-muted);">' + escapeHtml(item.product_code||'') + '</div></td>' +
                    '<td style="text-align:center;font-weight:600;">' + item.purchased_qty + '</td>' +
                    '<td style="text-align:center;color:' + (parseFloat(item.already_returned) > 0 ? 'var(--warning-color)' : '#888') + ';font-weight:600;">' + (item.already_returned || 0) + '</td>' +
                    '<td style="text-align:center;color:var(--success-color);font-weight:700;">' + remaining + '</td>' +
                    '<td style="text-align:center;"><input type="number" class="pr-qty" value="0" min="0" max="' + remaining + '" step="any" style="width:65px;text-align:center;border:1.5px solid var(--primary-color);border-radius:6px;padding:4px 6px;font-family:Cairo,sans-serif;"></td>' +
                    '<td style="text-align:center;">' + formatMoney(priceVal) + '</td>' +
                    '<td class="pr-line-total" style="text-align:center;font-weight:700;color:var(--primary-color);">' + formatMoney(0) + '</td>';

                prTbody.appendChild(tr);
            });

            // Bind qty events
            prTbody.querySelectorAll('.pr-qty').forEach(inp => {
                inp.addEventListener('input', onQtyChange);
                inp.addEventListener('change', onQtyChange);
            });

            showEl('pr-items-card');
            showEl('pr-details-card');
            showEl('pr-footer-bar');
            if (btnClear) btnClear.classList.remove('d-none');

            // Load return history
            try {
                const histRes = await window.API.getPurchaseReturns({ invoice_id: inv.id });
                const returns = histRes.data || [];
                const histBody = document.getElementById('pr-history-body');
                if (histBody) {
                    if (returns.length > 0) {
                        showEl('pr-history-card');
                        histBody.innerHTML = '';
                        returns.forEach(r => {
                            const htr = document.createElement('tr');
                            htr.innerHTML = '<td>' + (r.return_no || '—') + '</td>' +
                                '<td>' + (r.return_date || '—') + '</td>' +
                                '<td>' + formatMoney(r.grand_total) + '</td>' +
                                '<td>' + (r.status === 'posted' ? 'مرحّل' : r.status) + '</td>' +
                                '<td>' + (r.return_reason || '—') + '</td>';
                            histBody.appendChild(htr);
                        });
                    }
                }
            } catch(e) { /* ignore history errors */ }

            recalcAll();
        } catch(e) {
            console.error('Error loading invoice for return:', e);
            await window.showAlert('حدث خطأ أثناء جلب الفاتورة: ' + (e.message || ''), { type: 'danger' });
        } finally {
            hideEl('pr-loading');
        }
    }

    // ── Clear form ──
    function clearForm() {
        prInvoiceNo.value = '';
        if (prSupplierName) prSupplierName.value = '';
        if (prSupplierId) prSupplierId.value = '';
        if (prInvoiceId) prInvoiceId.value = '';
        if (prReason) prReason.value = '';
        if (prDateInput) prDateInput.value = new Date().toISOString().slice(0, 10);
        prTbody.innerHTML = '<tr><td colspan="8" class="text-center" style="padding:20px;color:#888;">الرجاء البحث عن فاتورة لإظهار الأصناف</td></tr>';
        hideEl('pr-invoice-info-card');
        hideEl('pr-items-card');
        hideEl('pr-details-card');
        hideEl('pr-preview-card');
        hideEl('pr-history-card');
        hideEl('pr-footer-bar');
        if (btnClear) btnClear.classList.add('d-none');
        _loadedInvoice = null;
        _loadedAvailItems = [];
        textEl('pr-grand-total', '0.00');
        textEl('pr-item-count', '0');
        textEl('pr-subtotal', '0.00');
        textEl('pr-discount-total', '0.00');
        textEl('pr-vat-total', '0.00');
        textEl('pr-balance-impact', '0.00');
        textEl('pr-footer-items', '0');
        textEl('pr-footer-original', '0.00');
        textEl('pr-footer-current', '0.00');
        textEl('pr-footer-remaining-inv', '0.00');
    }

    // ── Wire events ──
    if (btnSearch && !btnSearch.dataset.wired) {
        btnSearch.dataset.wired = '1';
        btnSearch.addEventListener('click', () => loadInvoiceForReturn());
    }
    if (prInvoiceNo && !prInvoiceNo.dataset.wired) {
        prInvoiceNo.dataset.wired = '1';
        let prTimeout;
        prInvoiceNo.addEventListener('input', () => {
            clearTimeout(prTimeout);
            prTimeout = setTimeout(() => {
                if (prInvoiceNo.value.trim()) loadInvoiceForReturn();
            }, 600);
        });
        prInvoiceNo.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); loadInvoiceForReturn(); }
        });
    }
    if (btnClear && !btnClear.dataset.wired) {
        btnClear.dataset.wired = '1';
        btnClear.addEventListener('click', clearForm);
    }

    // Return list search
    const preturnSearchQ = document.getElementById('preturn-search-q');
    if (preturnSearchQ && !preturnSearchQ.dataset.wired) {
        preturnSearchQ.dataset.wired = '1';
        let debounceTimer;
        preturnSearchQ.addEventListener('input', function() {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                if (typeof window.loadPurchaseReturnsList === 'function') {
                    window.loadPurchaseReturnsList(this.value);
                }
            }, 400);
        });
    }

    // ── Save handler ──
    if (btnSave && !btnSave.dataset.wired) {
        btnSave.dataset.wired = '1';
        btnSave.addEventListener('click', async () => {
            const supplierId = prSupplierId?.value;
            const invoiceId = prInvoiceId?.value;
            const returnDate = prDateInput?.value;
            const returnReason = prReason?.value;
            const notes = document.getElementById('pr-notes')?.value || '';

            let payload = {};
            if (_prMode === 'manual') {
                const freeSid = prFreeSupplier?.value;
                const freeStId = prFreeStore?.value;
                const freeReasonId = prFreeReason?.value || null;
                const freeReasonNote = prFreeReasonNote?.value || '';
                if (!freeSid) { await window.showAlert('اختر المورد', { type: 'warning' }); return; }
                if (!freeStId) { await window.showAlert('اختر المخزن', { type: 'warning' }); return; }
                const freeItems = [];
                if (prFreeTbody) {
                    prFreeTbody.querySelectorAll('tr[data-product-id]').forEach(tr => {
                        const qtyCell = tr.querySelector('.pr-free-qty-cell');
                        const qty = parseFloat(qtyCell?.textContent) || 0;
                        if (qty > 0) {
                            freeItems.push({ product_id: parseInt(tr.dataset.productId), quantity: qty });
                        }
                    });
                }
                if (freeItems.length === 0) { await window.showAlert('أضف أصناف للمرتجع', { type: 'warning' }); return; }
                payload = {
                    supplier_id: parseInt(freeSid),
                    store_id: parseInt(freeStId),
                    source_type: 'manual',
                    return_date: returnDate,
                    return_reason: freeReasonId || null,
                    reason_note: freeReasonNote,
                    notes,
                    items: freeItems
                };
            } else {
                if (!supplierId || !invoiceId) {
                    await window.showAlert('يجب البحث عن فاتورة أولاً', { type: 'warning' });
                    return;
                }
                const items = [];
                prTbody.querySelectorAll('tr[data-product-id]').forEach(tr => {
                    const qtyInp = tr.querySelector('.pr-qty');
                    if (!qtyInp) return;
                    const qty = parseFloat(qtyInp.value) || 0;
                    if (qty > 0) {
                        items.push({
                            product_id: parseInt(tr.dataset.productId),
                            quantity: qty,
                            cost_price: parseFloat(tr.dataset.price || 0)
                        });
                    }
                });
                if (items.length === 0) { await window.showAlert('أدخل كميات المرتجع', { type: 'warning' }); return; }
                payload = {
                    supplier_id: parseInt(supplierId),
                    invoice_id: parseInt(invoiceId),
                    source_type: 'invoice',
                    return_date: returnDate,
                    return_reason: returnReason,
                    notes: notes,
                    items
                };
            }

            btnSave.disabled = true;
            try {
                const res = await window.API.request('/purchases/returns', 'POST', payload);
                if (res.success) {
                    await window.showAlert('تم تسجيل مرتجع المشتريات بنجاح', { type: 'success' });
                    window._lastPurchaseReturnId = res.id;
                    EventBus.emit('purchases:return:created', res);
                    const prBtnPrint = document.getElementById('pr-btn-print');
                    if (prBtnPrint) {
                        prBtnPrint.classList.remove('d-none');
                        prBtnPrint.onclick = () => {
                            window.API.openPurchaseReturnPrint(res.id);
                        };
                    }
                    clearForm();
                } else {
                    await window.showAlert(res.message || 'حدث خطأ', { type: 'danger' });
                }
            } catch(e) {
                const msg = e.data?.message || e.message || 'حدث خطأ في حفظ المرتجع';
                await window.showAlert(msg, { type: 'danger' });
            } finally {
                btnSave.disabled = false;
            }
        });
    }

    // If invoiceNo passed directly (from detail view link)
    if (invoiceNo) {
        prInvoiceNo.value = invoiceNo;
        loadInvoiceForReturn(invoiceNo);
    }
};

// ---- Purchase Invoice List ----
window.loadPurchaseInvoicesList = async function(q) {
    const tbody = document.getElementById('pinvoices-list-body');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="padding:20px;"><i class="fa-solid fa-spinner fa-spin"></i></td></tr>';

    try {
        const params = {};
        if (q) params.q = q;
        const res = await window.API.getPurchaseInvoices(params);
        tbody.innerHTML = '';

        res.data.forEach(inv => {
            const rem = parseFloat(inv.remaining) || 0;
            const paid = parseFloat(inv.amount_paid) || 0;
            const total = parseFloat(inv.grand_total) || 0;
            const isCancelled = inv.status === 'cancelled' || inv.status === 'deleted';

            let statusHtml = '';
            if (isCancelled) {
                statusHtml = '<span class="badge-status" style="background:#dc2626;">ملغاة</span>';
            } else if (rem <= 0) {
                statusHtml = '<span class="badge-status paid">مسدد</span>';
            } else if (paid > 0) {
                statusHtml = '<span class="badge-status pending">جزئي</span>';
            } else {
                statusHtml = '<span class="badge-status overdue">غير مسدد</span>';
            }

            const tr = document.createElement('tr');
            tr.style.cursor = 'pointer';

            const td1 = document.createElement('td'); td1.style.fontWeight = 'bold'; td1.style.color = 'var(--primary-color)'; td1.textContent = inv.invoice_no;
            const td2 = document.createElement('td'); td2.textContent = inv.invoice_date;
            const td3 = document.createElement('td'); td3.textContent = inv.supplier_name || '-';
            const td4 = document.createElement('td'); td4.style.fontWeight = 'bold'; td4.innerHTML = formatMoney(total) + ' ج.م';
            const td5 = document.createElement('td'); td5.style.color = 'var(--success-color)'; td5.innerHTML = formatMoney(paid) + ' ج.م';
            const td6 = document.createElement('td'); td6.style.color = rem > 0 ? 'var(--danger-color)' : 'inherit'; td6.innerHTML = formatMoney(rem) + ' ج.م';
            const td7 = document.createElement('td'); td7.innerHTML = statusHtml;
            const td8 = document.createElement('td');

            const viewBtn = document.createElement('button');
            viewBtn.className = 'btn btn-outline btn-sm';
            viewBtn.dataset.id = inv.id;
            viewBtn.innerHTML = '<i class="fa-solid fa-eye"></i> عرض';
            td8.appendChild(viewBtn);

            tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3); tr.appendChild(td4);
            tr.appendChild(td5); tr.appendChild(td6); tr.appendChild(td7); tr.appendChild(td8);
            tbody.appendChild(tr);

            viewBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await window.showPurchaseInvoiceDetail(inv.id);
            });
        });

        if (res.data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="padding:20px; color:#888;">لا توجد فواتير مسجلة</td></tr>';
        }
    } catch(e) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-danger">لا توجد بيانات لعرضها</td></tr>';
        console.error(e);
    }
};

// ---- Purchase Return List ----
window.loadPurchaseReturnsList = async function(q) {
    const tbody = document.getElementById('preturns-list-body');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding:20px;"><i class="fa-solid fa-spinner fa-spin"></i></td></tr>';

    try {
        const params = {};
        if (q) params.q = q;
        const res = await window.API.getPurchaseReturns(params);
        tbody.innerHTML = '';

        res.data.forEach(ret => {
            const isCancelled = ret.status === 'cancelled' || ret.status === 'deleted';

            let statusHtml = '';
            if (isCancelled) {
                statusHtml = '<span class="badge-status" style="background:#dc2626;">ملغي</span>';
            } else {
                statusHtml = '<span class="badge-status paid">نشط</span>';
            }

            const tr = document.createElement('tr');
            tr.style.cursor = 'pointer';

            const td1 = document.createElement('td'); td1.style.fontWeight = 'bold'; td1.style.color = 'var(--primary-color)'; td1.textContent = ret.return_no;
            const td2 = document.createElement('td'); td2.textContent = ret.return_date;
            const td3 = document.createElement('td'); td3.textContent = ret.invoice_no || '-';
            const td4 = document.createElement('td'); td4.textContent = ret.supplier_name || '-';
            const td5 = document.createElement('td'); td5.style.fontWeight = 'bold'; td5.innerHTML = formatMoney(ret.grand_total) + ' ج.م';
            const td6 = document.createElement('td'); td6.innerHTML = statusHtml;
            const td7 = document.createElement('td');

            const viewBtn = document.createElement('button');
            viewBtn.className = 'btn btn-outline btn-sm';
            viewBtn.dataset.id = ret.id;
            viewBtn.innerHTML = '<i class="fa-solid fa-eye"></i> عرض';
            td7.appendChild(viewBtn);

            const printBtn = document.createElement('button');
            printBtn.className = 'btn btn-outline btn-sm';
            printBtn.style.marginRight = '5px';
            printBtn.innerHTML = '<i class="fa-solid fa-print"></i>';
            printBtn.onclick = (e) => { e.stopPropagation(); window.API.openPurchaseReturnPrint(ret.id); };
            td7.appendChild(printBtn);

            tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3); tr.appendChild(td4);
            tr.appendChild(td5); tr.appendChild(td6); tr.appendChild(td7);
            tbody.appendChild(tr);

            viewBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await window.showPurchaseReturnDetail(ret.id);
            });
        });

        if (res.data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding:20px; color:#888;">لا توجد مرتجعات مسجلة</td></tr>';
        }
    } catch(e) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-danger">لا توجد بيانات لعرضها</td></tr>';
        console.error(e);
    }
};

window.showPurchaseInvoiceDetail = async function(id) {
    try {
        const detRes = await window.API.getPurchaseInvoice(id);
        const det = detRes.data;

        const modal = document.getElementById('global-modal');
        const modalTitle = document.getElementById('modal-title');
        const modalBody = document.getElementById('modal-body');
        const btnSave = document.getElementById('btn-modal-save');
        if (!modal || !modalBody) return;

        const isCancelled = det.status === 'cancelled' || det.status === 'deleted';
        const canDelete = !isCancelled && (window.AppData?.user?.role === 'admin');

        modalTitle.innerHTML = 'تفاصيل فاتورة المشتريات: ' + det.invoice_no;

        modalBody.innerHTML = '';

        const info = document.createElement('div');
        info.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:12px; padding:15px; background:#f8f9fa; border-radius:8px; margin-bottom:15px;';
        const infoItems = [
            ['رقم الفاتورة', det.invoice_no],
            ['رقم فاتورة المورد', det.supplier_invoice_no || '-'],
            ['التاريخ', det.invoice_date],
            ['استحقاق', det.due_date || '-'],
            ['المورد', det.supplier_name || '-'],
            ['طريقة الدفع', det.payment_type === 'cash' ? 'نقدي' : det.payment_type === 'credit' ? 'آجل' : det.payment_type],
            ['الحالة', isCancelled ? 'ملغاة' : 'منشورة'],
            ['المخزن', det.store_name || '-']
        ];
        infoItems.forEach(([label, val]) => {
            const d = document.createElement('div');
            d.innerHTML = '<strong>' + label + ':</strong> ' + val;
            info.appendChild(d);
        });
        modalBody.appendChild(info);

        const itemsTable = document.createElement('table');
        itemsTable.className = 'data-table';
        itemsTable.style.marginTop = '15px';
        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        ['#', 'الصنف', 'الكمية', 'سعر التكلفة', 'الإجمالي'].forEach(h => {
            const th = document.createElement('th'); th.textContent = h; headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        itemsTable.appendChild(thead);

        const tbdy = document.createElement('tbody');
        (det.items || []).forEach((it, i) => {
            const tr = document.createElement('tr');
            [(i + 1), it.product_name,
             formatMoney(parseFloat(it.quantity) || 0),
             formatMoney(parseFloat(it.cost_price) || 0),
             formatMoney(parseFloat(it.line_total) || 0)].forEach(val => {
                const td = document.createElement('td');
                if (typeof val === 'string' && val.includes('<')) { td.innerHTML = val; }
                else { td.textContent = val; }
                tr.appendChild(td);
            });
            tbdy.appendChild(tr);
        });
        itemsTable.appendChild(tbdy);
        modalBody.appendChild(itemsTable);

        const totalsDiv = document.createElement('div');
        totalsDiv.style.cssText = 'margin-top:15px; padding:15px; background:#f8f9fa; border-radius:8px; display:grid; grid-template-columns:1fr 1fr; gap:10px;';
        const tData = [
            ['إجمالي الأصناف', formatMoney(parseFloat(det.subtotal) || 0) + ' ج.م'],
            ['الخصم', formatMoney(parseFloat(det.discount_amount) || 0) + ' ج.م'],
            ['الضريبة', formatMoney(parseFloat(det.tax_amount) || 0) + ' ج.م'],
            ['الإجمالي النهائي', '<strong style="color:var(--primary-color);font-size:1.1rem">' + formatMoney(parseFloat(det.grand_total) || 0) + ' ج.م</strong>'],
            ['المدفوع', '<span style="color:var(--success-color)">' + formatMoney(parseFloat(det.amount_paid) || 0) + ' ج.م</span>'],
            ['المتبقي', '<span style="color:' + ((parseFloat(det.remaining) || 0) > 0 ? 'var(--danger-color)' : 'var(--success-color)') + '">' + formatMoney(parseFloat(det.remaining) || 0) + ' ج.م</span>'],
        ];
        tData.forEach(([label, val]) => {
            const d = document.createElement('div');
            d.innerHTML = '<strong>' + label + ':</strong> ' + val;
            totalsDiv.appendChild(d);
        });
        modalBody.appendChild(totalsDiv);

        if (det.notes) {
            const notesP = document.createElement('p');
            notesP.style.cssText = 'margin-top:10px; padding:10px; background:#fef3c7; border-radius:6px;';
            notesP.innerHTML = '<strong>ملاحظات:</strong> ' + det.notes;
            modalBody.appendChild(notesP);
        }

        // ── Action buttons ──
        const actionsDiv = document.createElement('div');
        actionsDiv.style.cssText = 'margin-top:20px; display:flex; gap:10px; justify-content:center; flex-wrap:wrap;';

        const printBtn = document.createElement('button');
        printBtn.className = 'btn btn-outline';
        printBtn.innerHTML = '<i class="fa-solid fa-print"></i> طباعة';
        printBtn.onclick = () => window.API.openPurchaseInvoicePrint(det.id);
        actionsDiv.appendChild(printBtn);

        if (!isCancelled) {
            const editBtn = document.createElement('button');
            editBtn.className = 'btn btn-outline';
            editBtn.style.color = 'var(--primary-color)';
            editBtn.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> تعديل';
            editBtn.onclick = () => window.editPurchaseInvoice(det);
            actionsDiv.appendChild(editBtn);

            const returnBtn = document.createElement('button');
            returnBtn.className = 'btn btn-outline';
            returnBtn.style.color = 'var(--warning-color)';
            returnBtn.innerHTML = '<i class="fa-solid fa-undo"></i> مرتجع';
            returnBtn.onclick = () => {
                document.getElementById('global-modal').classList.remove('active');
                if (window.initPurchaseReturn) window.initPurchaseReturn(det.invoice_no);
            };
            actionsDiv.appendChild(returnBtn);
        }

        if (canDelete) {
            const delBtn = document.createElement('button');
            delBtn.className = 'btn btn-danger';
            delBtn.innerHTML = '<i class="fa-solid fa-trash"></i> حذف الفاتورة';
            delBtn.onclick = () => window.deletePurchaseInvoice(det.id);
            actionsDiv.appendChild(delBtn);
        }

        modalBody.appendChild(actionsDiv);
        if (btnSave) btnSave.style.display = 'none';

        const cancelBtn = document.getElementById('btn-modal-cancel');
        if (cancelBtn) cancelBtn.textContent = 'إغلاق';

        // ── Return History container (empty shell — loads after modal shows) ──
        const histWrap = document.createElement('div');
        histWrap.id = 'purchase-return-history';
        histWrap.style.cssText = 'margin-top:15px; padding:15px; background:#fff; border:1px solid #ddd; border-radius:8px;';
        histWrap.innerHTML = '<div style="font-weight:bold;margin-bottom:10px;color:var(--primary-color)"><i class="fa-solid fa-clock-rotate-left"></i> سجل مرتجعات المشتريات</div><div style="text-align:center;padding:15px;color:#888;"><i class="fa-solid fa-spinner fa-spin"></i> جاري تحميل المرتجعات...</div>';
        modalBody.appendChild(histWrap);

        modal.classList.add('active');

        // ── Lazy-load return history after modal is visible ──
        loadPurchaseReturnHistory(id, histWrap);
    } catch(e) {
        console.error(e);
        await window.showAlert('حدث خطأ في تحميل تفاصيل الفاتورة', { type: 'danger' });
    }
};

window.loadPurchaseReturnHistory = async function(invoiceId, container) {
    try {
        const histRes = await window.API.getPurchaseReturns({ invoice_id: invoiceId });
        const returns = histRes.data || [];
        if (returns.length === 0) {
            container.innerHTML = '<div style="font-weight:bold;margin-bottom:10px;color:var(--primary-color)"><i class="fa-solid fa-clock-rotate-left"></i> سجل مرتجعات المشتريات</div>' +
                '<div style="text-align:center;padding:15px;color:#888;">لا توجد مرتجعات لهذه الفاتورة</div>';
            return;
        }
        let html = '<div style="font-weight:bold;margin-bottom:10px;color:var(--primary-color)"><i class="fa-solid fa-clock-rotate-left"></i> سجل مرتجعات المشتريات</div>';
        html += '<table class="data-table" style="font-size:0.9em"><thead><tr>';
        ['رقم المرتجع', 'التاريخ', 'القيمة', 'الحالة', 'إجراء'].forEach(h => { html += '<th>' + h + '</th>'; });
        html += '</tr></thead><tbody>';
        returns.forEach(r => {
            const rStatus = r.status === 'cancelled' || r.status === 'deleted' ? 'ملغي' : 'نشط';
            const rColor = r.status === 'cancelled' || r.status === 'deleted' ? '#dc2626' : '#28a745';
            html += '<tr style="cursor:pointer">';
            [r.return_no, r.return_date,
             '<span class="' + (parseFloat(r.grand_total) >= 0 ? 'amount-positive' : 'amount-negative') + '">' + Number(r.grand_total || 0).toLocaleString('en-US', { minimumFractionDigits: 2 }) + '</span> ج.م',
             '<span style="color:' + rColor + '">' + rStatus + '</span>',
             '<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();window.API.openPurchaseReturnPrint(' + r.id + ')"><i class="fa-solid fa-print"></i></button>'
            ].forEach(val => {
                if (typeof val === 'string' && val.includes('<')) { html += '<td>' + val + '</td>'; }
                else { html += '<td>' + (val || '') + '</td>'; }
            });
            html += '</tr>';
        });
        html += '</tbody></table>';
        container.innerHTML = html;
    } catch (e) {
        console.error('Return history error:', e);
        container.innerHTML = '<div style="font-weight:bold;margin-bottom:10px;color:var(--primary-color)"><i class="fa-solid fa-clock-rotate-left"></i> سجل مرتجعات المشتريات</div>' +
            '<div style="text-align:center;padding:15px;color:#dc2626;"><i class="fa-solid fa-circle-exclamation"></i> خطأ في تحميل سجل المرتجعات</div>';
    }
};

// ---- Purchase Return Detail Modal ----
window.showPurchaseReturnDetail = async function(id) {
    try {
        const detRes = await window.API.getPurchaseReturn(id);
        const det = detRes.data;

        const modal = document.getElementById('global-modal');
        const modalTitle = document.getElementById('modal-title');
        const modalBody = document.getElementById('modal-body');
        const btnSave = document.getElementById('btn-modal-save');
        if (!modal || !modalBody) return;

        const isCancelled = det.status === 'cancelled' || det.status === 'deleted';
        const canDelete = !isCancelled && (window.AppData?.user?.role === 'admin');

        modalTitle.innerHTML = 'تفاصيل مرتجع المشتريات: ' + det.return_no;

        modalBody.innerHTML = '';

        const info = document.createElement('div');
        info.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:12px; padding:15px; background:#f8f9fa; border-radius:8px; margin-bottom:15px;';
        const infoItems = [
            ['رقم المرتجع', det.return_no],
            ['التاريخ', det.return_date],
            ['الفاتورة الأصلية', det.invoice_no || '-'],
            ['المورد', det.supplier_name || '-'],
            ['سبب المرتجع', det.return_reason || '-'],
            ['الحالة', isCancelled ? 'ملغي' : 'نشط'],
        ];
        infoItems.forEach(([label, val]) => {
            const d = document.createElement('div');
            d.innerHTML = '<strong>' + label + ':</strong> ' + val;
            info.appendChild(d);
        });
        modalBody.appendChild(info);

        const itemsTable = document.createElement('table');
        itemsTable.className = 'data-table';
        itemsTable.style.marginTop = '15px';
        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        ['#', 'الصنف', 'الكمية', 'السعر', 'الإجمالي'].forEach(h => {
            const th = document.createElement('th'); th.textContent = h; headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        itemsTable.appendChild(thead);

        const tbdy = document.createElement('tbody');
        (det.items || []).forEach((it, i) => {
            const tr = document.createElement('tr');
            const vals = [
                (i + 1), it.product_name,
                formatMoney(parseFloat(it.quantity) || 0),
                formatMoney(parseFloat(it.cost_price) || 0),
                formatMoney(parseFloat(it.line_total) || 0)
            ];
            vals.forEach(val => {
                const td = document.createElement('td');
                if (typeof val === 'string' && val.includes('<')) { td.innerHTML = val; }
                else { td.textContent = val; }
                tr.appendChild(td);
            });
            tbdy.appendChild(tr);
        });
        itemsTable.appendChild(tbdy);
        modalBody.appendChild(itemsTable);

        const totalsDiv = document.createElement('div');
        totalsDiv.style.cssText = 'margin-top:15px; padding:15px; background:#f8f9fa; border-radius:8px; display:grid; grid-template-columns:1fr 1fr; gap:10px;';
        const tData = [
            ['إجمالي المرتجع', '<strong style="color:var(--primary-color);font-size:1.1rem">' + formatMoney(parseFloat(det.grand_total) || 0) + ' ج.م</strong>'],
        ];
        tData.forEach(([label, val]) => {
            const d = document.createElement('div');
            d.innerHTML = '<strong>' + label + ':</strong> ' + val;
            totalsDiv.appendChild(d);
        });
        modalBody.appendChild(totalsDiv);

        const actionsDiv = document.createElement('div');
        actionsDiv.style.cssText = 'margin-top:20px; display:flex; gap:10px; justify-content:center; flex-wrap:wrap;';

        const printBtn = document.createElement('button');
        printBtn.className = 'btn btn-outline';
        printBtn.innerHTML = '<i class="fa-solid fa-print"></i> طباعة';
        printBtn.onclick = () => window.API.openPurchaseReturnPrint(det.id);
        actionsDiv.appendChild(printBtn);

        if (canDelete) {
            const delBtn = document.createElement('button');
            delBtn.className = 'btn btn-danger';
            delBtn.innerHTML = '<i class="fa-solid fa-trash"></i> حذف المرتجع';
            delBtn.onclick = () => window.deletePurchaseReturn(det.id);
            actionsDiv.appendChild(delBtn);
        }

        modalBody.appendChild(actionsDiv);
        if (btnSave) btnSave.style.display = 'none';

        const cancelBtn = document.getElementById('btn-modal-cancel');
        if (cancelBtn) cancelBtn.textContent = 'إغلاق';

        modal.classList.add('active');
    } catch(e) {
        console.error(e);
        await window.showAlert('حدث خطأ في تحميل تفاصيل المرتجع', { type: 'danger' });
    }
};

window.deletePurchaseInvoice = async function(id) {
    const confirmed = await showConfirm('هل أنت متأكد من حذف فاتورة المشتريات هذه؟\n\nملاحظة: يشترط عدم وجود مرتجعات أو مدفوعات مسجلة.', {
        title: 'حذف فاتورة مشتريات',
        confirmText: '<i class="fa-solid fa-trash" style="margin-left:6px"></i> حذف',
    });
    if (confirmed) {
        try {
            await window.API.deletePurchaseInvoice(id);
            showAlert('تم حذف فاتورة المشتريات بنجاح', { title: 'تمت العملية', type: 'success', infoText: false });
            const modal = document.getElementById('global-modal');
            if (modal) modal.classList.remove('active');
            if (typeof window.loadPurchaseInvoicesList === 'function') window.loadPurchaseInvoicesList();
        } catch(e) {
            showAlert(e.message, { type: 'danger', title: 'تعذر الحذف' });
        }
    }
};

window.editPurchaseInvoice = function(det) {
    document.querySelectorAll('.view').forEach(v => { v.classList.remove('active-view'); v.style.display = 'none'; });
    const view = document.getElementById('view-purchase-invoice');
    if (view) { view.style.display = ''; view.classList.add('active-view'); }
    document.getElementById('global-modal').classList.remove('active');
    window.editingPurchaseInvoiceId = det.id;
    document.getElementById('pinv-date').value = det.invoice_date || '';
    document.getElementById('pinv-supplier-doc').value = det.supplier_invoice_no || '';
    const selSupplier = document.getElementById('pinv-supplier');
    if (selSupplier) {
        if (selSupplier.options.length > 0) {
            for (let opt of selSupplier.options) {
                if (opt.value == det.supplier_id) { selSupplier.value = det.supplier_id; break; }
            }
        }
    }
    const selStore = document.getElementById('pinv-store');
    if (selStore && det.store_id) selStore.value = det.store_id;
    const selPay = document.getElementById('pinv-payment');
    if (selPay && det.payment_type) selPay.value = det.payment_type;
    document.getElementById('p-amount-paid').value = det.amount_paid || 0;
    const tbody = document.getElementById('pinvoice-items-body');
    if (tbody && det.items) {
        tbody.innerHTML = '';
        det.items.forEach((item, idx) => {
            const tr = document.createElement('tr');
            tr.dataset.productId = item.product_id;
            const rowIdx = idx + 1;
            tr.innerHTML = '<td>' + rowIdx + '</td>' +
                '<td><input type="text" class="pitem-search" list="product-list" placeholder="ابحث عن صنف..." value="' + escapeHtml(item.product_name) + '"></td>' +
                '<td><input type="number" class="pitem-qty pcalc" value="' + item.quantity + '" min="1"></td>' +
                '<td><input type="number" class="pitem-cost pcalc" value="' + (item.cost_price || 0) + '" min="0"></td>' +
                '<td><input type="number" class="pitem-sell" value="' + (item.sell_price || 0) + '" min="0" readonly title="يتم تعديل سعر البيع من شاشة الأصناف أو شاشة التسعير فقط" style="background:#f5f5f5;cursor:not-allowed;"></td>' +
                '<td><input type="text" class="pitem-total disabled-input" value="' + (item.line_total || (item.quantity * (item.cost_price || 0))).toFixed(2) + '" disabled></td>' +
                '<td><button class="icon-btn text-danger btn-remove-prow"><i class="fa-solid fa-trash"></i></button></td>';
            tr.querySelector('.btn-remove-prow').addEventListener('click', () => { tr.remove(); if (typeof calcPTotals === 'function') calcPTotals(); });
            const si = tr.querySelector('.pitem-search');
            si.addEventListener('input', (e) => {
                const val = e.target.value;
                const dlist = document.getElementById('product-list');
                if (dlist) {
                    const opt = dlist.querySelector('option[value="' + val.replace(/"/g, '&quot;') + '"]');
                    if (opt) {
                        tr.dataset.productId = opt.dataset.id;
                        tr.querySelector('.pitem-cost').value = opt.dataset.cost || 0;
                        if (typeof calcPTotals === 'function') calcPTotals();
                    }
                }
            });
            tbody.appendChild(tr);
        });
    }
    if (typeof calcPTotals === 'function') calcPTotals();
};

window.deletePurchaseReturn = async function(id) {
    const confirmed = await showConfirm('هل أنت متأكد من حذف مرتجع المشتريات هذا؟\n\nملاحظة: سيتم عكس التأثيرات المخزنية والمحاسبية.', {
        title: 'حذف مرتجع مشتريات',
        confirmText: '<i class="fa-solid fa-trash" style="margin-left:6px"></i> حذف',
    });
    if (confirmed) {
        try {
            await window.API.deletePurchaseReturn(id);
            showAlert('تم حذف مرتجع المشتريات وعكس التأثيرات بنجاح', { title: 'تمت العملية', type: 'success', infoText: false });
            const modal = document.getElementById('global-modal');
            if (modal) modal.classList.remove('active');
            if (typeof window.loadPurchaseReturnsList === 'function') window.loadPurchaseReturnsList();
        } catch(e) {
            showAlert(e.message, { type: 'danger', title: 'تعذر الحذف' });
        }
    }
};

// ---- Inventory Report Logic ----
window.initInventoryReport = function() {
    const selType = document.getElementById('rpt-inv-type');
    const dateRanges = document.querySelectorAll('[id^="rpt-inv-date-range"]');
    const btnRun = document.getElementById('btn-run-inv-report');
    const tbody = document.getElementById('rpt-inv-tbody');
    const thead = document.getElementById('rpt-inv-thead');
    
    if (!selType || !btnRun || btnRun.dataset.wired) return;
    btnRun.dataset.wired = '1';
    
    selType.addEventListener('change', () => {
        if (selType.value === 'movements') dateRanges.forEach(el => el.style.display = 'block');
        else dateRanges.forEach(el => el.style.display = 'none');
    });
    
    btnRun.addEventListener('click', async () => {
        const type = selType.value;
        btnRun.disabled = true;
        btnRun.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        try {
            tbody.innerHTML = '';
            document.getElementById('report-inventory-results').style.display = 'block';
            if (type === 'balances' || type === 'low_stock') {
                thead.innerHTML = `<tr><th>كود الصنف</th><th>اسم الصنف</th><th>الرصيد الحالظٹ</th><th>الحد الأدنى</th><th>الحالة</th></tr>`;
                const params = type === 'low_stock' ? { low_stock: '1' } : {};
                const res = await window.API.getInventoryBalances(params);
                res.data.forEach(item => {
                    const stock = parseFloat(item.quantity) || 0;
                    const min = parseFloat(item.min_stock) || 0;
                    let statusLabel = '<span class="badge-status paid">متوفر</span>';
                    if (stock <= min) statusLabel = '<span class="badge-status overdue">ناقص</span>';
                    if (stock === 0) statusLabel = '<span class="badge-status overdue" style="background:#dc3545">منفذ</span>';
                    
                    const tr = document.createElement('tr');
                    tr.innerHTML = `<td>${item.product_code || '-'}</td><td>${item.product_name}</td><td style="${stock <= min ? 'color:var(--danger-color);font-weight:bold' : ''}">${stock}</td><td>${min}</td><td>${statusLabel}</td>`;
                    tbody.appendChild(tr);
                });
                if (res.data.length === 0) tbody.innerHTML = '<tr><td colspan="5" class="text-center">لا توجد بيانات لعرضها المرجو التأكد أو البحث مجدداً</td></tr>';
            } else if (type === 'movements') {
                thead.innerHTML = `<tr><th>تاريخ الحركة</th><th>نوع الحركة</th><th>رقم المستند</th><th>الصنف</th><th>منصرف</th><th>وارد</th><th>الرصيد بعد الحركة</th></tr>`;
                const params = { from: document.getElementById('rpt-inv-from')?.value, to: document.getElementById('rpt-inv-to')?.value };
                const res = await window.API.getInventoryMovements(params);
                res.data.forEach(mov => {
                    const isOut = mov.move_type === 'out';
                    let typeLabel = ({'in':'إدخال / مشتريات', 'out':'إخراج / مبيعات', 'transfer':'تحويل', 'adjust':'تسوية', 'damage':'تالف'})[mov.move_type] || 'أخرى';
                    const tr = document.createElement('tr');
                    tr.innerHTML = `<td>${mov.move_date}</td><td>${typeLabel}</td><td>${mov.document_no || '-'}</td><td>${mov.product_name || '-'}</td><td style="color:var(--danger-color)">${isOut ? mov.qty_out : '-'}</td><td style="color:var(--success-color)">${!isOut ? mov.qty_in : '-'}</td><td style="font-weight:bold">${mov.balance_after}</td>`;
                    tbody.appendChild(tr);
                });
                if (res.data.length === 0) tbody.innerHTML = '<tr><td colspan="7" class="text-center">لا توجد بيانات لعرضها المرجو التأكد أو البحث مجدداً</td></tr>';
            }
        } catch (e) { console.error(e); } finally { btnRun.disabled = false; btnRun.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> بحث'; }
    });
};

// ---- Inventory Card Logic ----
window.initInventoryCard = function() {
    const selProd = document.getElementById('inv-card-product');
    const btnShow = document.getElementById('btn-inv-card-show');
    const tbody = document.getElementById('inv-card-tbody');
    if (!selProd || !btnShow || btnShow.dataset.wired) return;
    btnShow.dataset.wired = '1';
    
    if (!selProd.dataset) selProd.dataset = {};
    if (selProd.dataset.searchable) return;
    selProd.dataset.searchable = '1';
    if (selProd.options.length <= 1 && window.AppData && window.AppData.products) {
        window.AppData.products.forEach(p => {
            const opt = document.createElement('option'); opt.value = p.id; opt.textContent = p.product_name + ' (' + p.product_code + ')';
            selProd.appendChild(opt);
        });
    }
    makeSearchableSelect(selProd, window.AppData.products.map(p => ({id: p.id, name: p.product_name + ' (' + p.product_code + ')'})), 'ابحث عن صنف...');
    
    btnShow.addEventListener('click', async () => {
        const prodId = selProd.value;
        if (!prodId) { alert('اختر الصنف'); return; }
        
        btnShow.disabled = true; btnShow.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        try {
            const res = await window.API.getProductCard(prodId);
            const p = res.data.product;
            document.getElementById('inv-card-stock').textContent = p.total_stock || 0;
            document.getElementById('inv-card-cost').innerHTML = formatMoney(p.cost_price || 0);
            document.getElementById('inv-card-sell').innerHTML = formatMoney(p.sell_price || 0);
            
            tbody.innerHTML = '';
            (res.data.movements || []).forEach(mov => {
                const typeLabel = ({'in':'إدخال / مشتريات', 'out':'إخراج / مبيعات', 'transfer':'تحويل', 'adjust':'تسوية', 'damage':'تالف'})[mov.move_type] || 'أخرى';
                const tr = document.createElement('tr');
                tr.innerHTML = `<td>${mov.move_date}</td><td>${typeLabel}</td><td>${mov.document_no || '-'}</td><td style="color:var(--success-color)">${mov.qty_in > 0 ? mov.qty_in : '-'}</td><td style="color:var(--danger-color)">${mov.qty_out > 0 ? mov.qty_out : '-'}</td><td style="font-weight:bold">${mov.balance_after}</td>`;
                tbody.appendChild(tr);
            });
            if (!res.data.movements || res.data.movements.length === 0) tbody.innerHTML = '<tr><td colspan="6" class="text-center">لا توجد بيانات لعرضها المرجو التأكد أو البحث مجدداً</td></tr>';
        } catch(e) { console.error(e); } finally { btnShow.disabled = false; btnShow.innerHTML = '<i class="fa-solid fa-list-check"></i> عرض الحركة'; }
    });
};

// ---- Inventory Transfers Logic ----
window.initInventoryTransfers = async function() {
    const btnNew = document.getElementById('btn-new-transfer');
    const formPanel = document.getElementById('form-new-transfer');
    const btnCancel = document.getElementById('btn-cancel-transfer');
    const btnSave = document.getElementById('btn-save-transfer');
    const tbody = document.getElementById('trn-tbody');
    const selProd = document.getElementById('trn-product');
    const dateInp = document.getElementById('trn-date');
    if (!btnNew || !tbody || btnNew.dataset.wired) return;
    btnNew.dataset.wired = '1';
    
    if (dateInp && !dateInp.value) dateInp.value = new Date().toISOString().slice(0,10);
    
    if (selProd && selProd.options.length <= 1 && window.AppData && window.AppData.products) {
        window.AppData.products.forEach(p => {
            const opt = document.createElement('option'); opt.value = p.id; opt.textContent = p.product_name;
            selProd.appendChild(opt);
        });
    }
    
    if (selProd && !selProd.dataset.searchable) {
        selProd.dataset.searchable = '1';
        makeSearchableSelect(selProd, window.AppData.products.map(p => ({id: p.id, name: p.product_name})), 'ابحث عن صنف...');
    }
    
    const selFrom = document.getElementById('trn-from-store'); const selTo = document.getElementById('trn-to-store');
    try {
        const stores = await window.API.getStores();
        if (stores && stores.data) {
            selFrom.innerHTML = ''; selTo.innerHTML = '';
            stores.data.forEach(st => {
                const opt1 = document.createElement('option'); opt1.value = st.id; opt1.textContent = st.store_name;
                const opt2 = document.createElement('option'); opt2.value = st.id; opt2.textContent = st.store_name;
                selFrom.appendChild(opt1); selTo.appendChild(opt2);
            });
            if (selTo.options.length > 1) selTo.selectedIndex = 1;
            if (selFrom && !selFrom.dataset.searchable) {
                selFrom.dataset.searchable = '1';
                makeSearchableSelect(selFrom, stores.data.map(s => ({id: s.id, name: s.store_name})), 'ابحث عن مخزن...');
            }
            if (selTo && !selTo.dataset.searchable) {
                selTo.dataset.searchable = '1';
                makeSearchableSelect(selTo, stores.data.map(s => ({id: s.id, name: s.store_name})), 'ابحث عن مخزن...');
            }
        }
    } catch(e) {}
    
    btnNew.addEventListener('click', () => { formPanel.style.display = 'block'; btnNew.style.display = 'none'; });
    btnCancel.addEventListener('click', () => { formPanel.style.display = 'none'; btnNew.style.display = 'block'; });
    
    btnSave.addEventListener('click', async () => {
        const fromId = selFrom.value, toId = selTo.value, prodId = selProd.value, qty = parseFloat(document.getElementById('trn-qty').value) || 0;
        if (!fromId || !toId || !prodId || qty <= 0) { alert('أكمل البيانات بكمية صحيحة'); return; }
        if (fromId === toId) { alert('لا يمكن التحويل لنظپس المخزن'); return; }
        
        btnSave.disabled = true;
        try {
            await window.API.createStockTransfer({ from_store_id: fromId, to_store_id: toId, items: [{ product_id: parseInt(prodId), quantity: qty }], transfer_date: dateInp.value, notes: document.getElementById('trn-notes').value });
            alert('طھم التحويل بنجاح');
            formPanel.style.display = 'none'; btnNew.style.display = 'block';
            document.getElementById('trn-qty').value = '1'; document.getElementById('trn-notes').value = '';
            // Trigger views.js handler to reload the table
            const v = document.getElementById('view-inventory-transfers');
            if (v) { v.dataset.bound = ''; if (window.TradeProViews) window.TradeProViews.reload('view-inventory-transfers'); }
        } catch(e) { if(e.message) showAlert(e.message, { title: 'خطأ', type: 'danger', infoText: false }); } finally { btnSave.disabled = false; }
    });
};

// ---- Stock Disposal (إعدام البضاعة) ----
window.initInventoryDamaged = async function() {
    const btnNew = document.getElementById('btn-new-disposal');
    const formPanel = document.getElementById('form-new-disposal');
    const btnCancel = document.getElementById('btn-cancel-disposal');
    const btnSave = document.getElementById('btn-save-disposal');
    const btnSavePrint = document.getElementById('btn-save-print-disposal');
    const tbody = document.getElementById('disp-tbody');
    const selStore = document.getElementById('disp-store');
    const dateInp = document.getElementById('disp-date');
    const itemsBody = document.getElementById('disposal-items-body');
    const btnAddRow = document.getElementById('btn-add-disposal-row');
    const totalQtySpan = document.getElementById('disp-total-qty');
    const totalValSpan = document.getElementById('disp-total-value');
    if (!btnNew || !itemsBody || btnNew.dataset.wired) return;
    btnNew.dataset.wired = '1';

    if (dateInp && !dateInp.value) dateInp.value = new Date().toISOString().slice(0, 10);

    // Populate store select
    try {
        const stores = await window.API.getStores();
        if (stores && stores.data) {
            selStore.innerHTML = '<option value="">-- اختر المخزن --</option>';
            stores.data.forEach(st => {
                const opt = document.createElement('option');
                opt.value = st.id;
                opt.textContent = st.store_name;
                selStore.appendChild(opt);
            });
            if (!selStore.dataset.searchable) {
                selStore.dataset.searchable = '1';
                makeSearchableSelect(selStore, stores.data.map(s => ({ id: s.id, name: s.store_name })), 'ابحث عن مخزن...');
            }
        }
    } catch (e) { console.log(e); }

    // Populate product datalist
    const dataList = document.getElementById('disp-products-list');
    let products = [];
    if (window.AppData && window.AppData.products) {
        products = window.AppData.products;
    } else {
        try {
            const pres = await window.API.getProducts();
            if (pres && pres.data) products = pres.data;
        } catch (e) {}
    }
    if (dataList) {
        dataList.innerHTML = '';
        products.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.product_name;
            opt.dataset.id = p.id;
            opt.dataset.cost = p.cost_price || 0;
            opt.dataset.unit = p.unit_name || '';
            dataList.appendChild(opt);
        });
    }

    function recalcRow(row) {
        const qty = parseFloat(row.querySelector('.disp-qty').value) || 0;
        const cost = parseFloat(row.querySelector('.disp-cost').value) || 0;
        row.querySelector('.disp-total').textContent = (qty * cost).toFixed(2);
        recalcTotals();
    }

    function recalcTotals() {
        let totalQty = 0, totalVal = 0;
        document.querySelectorAll('.disposal-row').forEach(r => {
            totalQty += parseFloat(r.querySelector('.disp-qty').value) || 0;
            totalVal += parseFloat(r.querySelector('.disp-total').textContent) || 0;
        });
        if (totalQtySpan) totalQtySpan.textContent = totalQty;
        if (totalValSpan) totalValSpan.textContent = totalVal.toFixed(2) + ' ج.م';
    }

    function addDisposalRow(data) {
        const rows = document.querySelectorAll('.disposal-row');
        const idx = rows.length + 1;
        const tr = document.createElement('tr');
        tr.className = 'disposal-row';
        let prodVal = '', prodId = '', prodCost = '', prodUnit = '';
        if (data) {
            prodVal = data.product_name || '';
            prodId = data.id || '';
            prodCost = data.cost_price || 0;
            prodUnit = data.unit_name || '';
        }
        tr.innerHTML = `
            <td>${idx}</td>
            <td><input type="text" class="disp-item-search" list="disp-products-list" placeholder="ابحث عن صنف..." style="width:180px" value="${prodVal}"></td>
            <td class="disp-unit">${prodUnit}</td>
            <td class="disp-balance">0</td>
            <td><input type="number" class="disp-qty" value="1" min="1" style="width:80px"></td>
            <td><input type="number" class="disp-cost" value="${prodCost}" min="0" step="0.01" style="width:100px"></td>
            <td class="disp-total">${prodCost > 0 ? Number(prodCost).toFixed(2) : '0.00'}</td>
            <td><input type="text" class="disp-item-reason" placeholder="سبب الإعدام" style="width:140px"></td>
            <td class="actions-cell"><button class="icon-btn text-danger btn-remove-disposal-row"><i class="fa-solid fa-trash"></i></button></td>`;
        itemsBody.appendChild(tr);

        const searchInp = tr.querySelector('.disp-item-search');
        searchInp.addEventListener('input', function() {
            const matched = Array.from(dataList.options).find(o => o.value === this.value);
            if (matched) {
                const pid = matched.dataset.id;
                const cost = matched.dataset.cost;
                const unit = matched.dataset.unit;
                tr.querySelector('.disp-cost').value = cost;
                tr.querySelector('.disp-unit').textContent = unit;
                tr.dataset.productId = pid;
                // Fetch balance for this product
                const sid = selStore.value;
                if (sid && pid) {
                    window.API.request('/inventory/balances?store_id=' + sid + '&product_id=' + pid).then(res => {
                        if (res.success && res.data && res.data[0]) {
                            tr.querySelector('.disp-balance').textContent = res.data[0].quantity;
                        } else {
                            tr.querySelector('.disp-balance').textContent = '0';
                        }
                    }).catch(() => {});
                }
                recalcRow(tr);
            } else {
                tr.dataset.productId = '';
            }
        });

        tr.querySelector('.disp-qty').addEventListener('input', () => recalcRow(tr));
        tr.querySelector('.disp-cost').addEventListener('input', () => recalcRow(tr));
        const rmBtn = tr.querySelector('.btn-remove-disposal-row');
        rmBtn.addEventListener('click', function() {
            tr.remove();
            renumberRows();
            recalcTotals();
        });

        recalcRow(tr);
    }

    function renumberRows() {
        document.querySelectorAll('.disposal-row').forEach((r, i) => {
            r.querySelector('td:first-child').textContent = i + 1;
        });
    }

    // Refresh balances when store changes
    selStore.addEventListener('change', function() {
        const sid = this.value;
        document.querySelectorAll('.disposal-row').forEach(tr => {
            const pid = tr.dataset.productId;
            if (sid && pid) {
                window.API.request('/inventory/balances?store_id=' + sid + '&product_id=' + pid).then(res => {
                    if (res.success && res.data && res.data[0]) {
                        tr.querySelector('.disp-balance').textContent = res.data[0].quantity;
                    } else {
                        tr.querySelector('.disp-balance').textContent = '0';
                    }
                }).catch(() => {});
            }
        });
    });

    // Wire Add Row
    btnAddRow.addEventListener('click', () => addDisposalRow());

    // Wire product search to fetch balance when product is selected (first row)
    document.querySelectorAll('.disp-item-search').forEach(inp => {
        inp.addEventListener('input', function() {
            const matched = Array.from(dataList.options).find(o => o.value === this.value);
            if (matched) {
                const tr = this.closest('tr');
                const pid = matched.dataset.id;
                const sid = selStore.value;
                tr.dataset.productId = pid;
                tr.querySelector('.disp-cost').value = matched.dataset.cost;
                tr.querySelector('.disp-unit').textContent = matched.dataset.unit;
                if (sid && pid) {
                    window.API.request('/inventory/balances?store_id=' + sid + '&product_id=' + pid).then(res => {
                        if (res.success && res.data && res.data[0]) {
                            tr.querySelector('.disp-balance').textContent = res.data[0].quantity;
                        } else {
                            tr.querySelector('.disp-balance').textContent = '0';
                        }
                    }).catch(() => {});
                }
                recalcRow(tr);
            } else {
                this.closest('tr').dataset.productId = '';
            }
        });
    });
    document.querySelectorAll('.disp-qty').forEach(inp => inp.addEventListener('input', () => recalcRow(inp.closest('tr'))));
    document.querySelectorAll('.disp-cost').forEach(inp => inp.addEventListener('input', () => recalcRow(inp.closest('tr'))));

    function resetDisposalForm() {
        const editIdInput = document.getElementById('disp-edit-id');
        if (editIdInput) editIdInput.value = '';
        document.getElementById('disp-committee').value = '';
        document.getElementById('disp-reason').value = '';
        document.getElementById('disp-notes').value = '';
        document.getElementById('disp-form-title').textContent = 'تسجيل إعدام جديد';
        itemsBody.innerHTML = '';
        addDisposalRow();
        if (dateInp) dateInp.value = new Date().toISOString().slice(0, 10);
        if (selStore) selStore.value = '';
    }

    async function saveDisposal(andPrint) {
        const sid = selStore.value;
        if (!sid) { showAlert('يجب اختيار المخزن', { title: 'تنبيه', type: 'warning', infoText: false }); return; }
        const rows = document.querySelectorAll('.disposal-row');
        const items = [];
        let hasError = false;
        rows.forEach((r, i) => {
            const pid = r.dataset.productId;
            if (!pid) { hasError = true; showAlert(`الصنف في البند ${i+1} غير صحيح أو لم يتم اختياره من القائمة`, { title: 'تنبيه', type: 'warning', infoText: false }); return; }
            const qty = parseFloat(r.querySelector('.disp-qty').value) || 0;
            if (qty <= 0) { hasError = true; showAlert(`الكمية في البند ${i+1} يجب أن تكون أكبر من صفر`, { title: 'تنبيه', type: 'warning', infoText: false }); return; }
            const cost = parseFloat(r.querySelector('.disp-cost').value) || 0;
            const reason = r.querySelector('.disp-item-reason').value || '';
            items.push({ product_id: parseInt(pid), quantity: qty, cost_price: cost, item_reason: reason });
        });
        if (hasError || items.length === 0) {
            if (!hasError) showAlert('يجب إضافة صنف واحد على الأقل', { title: 'تنبيه', type: 'warning', infoText: false });
            return;
        }
        btnSave.disabled = true;
        const editIdInput = document.getElementById('disp-edit-id');
        const editId = editIdInput ? editIdInput.value : '';
        const payload = {
            store_id: parseInt(sid),
            doc_date: dateInp.value,
            committee: document.getElementById('disp-committee').value,
            reason: document.getElementById('disp-reason').value,
            notes: document.getElementById('disp-notes').value,
            items
        };
        try {
            const res = editId
                ? await window.API.request('/inventory/disposals/' + editId, 'PUT', payload)
                : await window.API.createStockDisposal(payload);
            if (res.success) {
                showAlert(editId ? 'تم تعديل الإعدام بنجاح' : 'تم تسجيل الإعدام بنجاح', { title: 'تمت العملية', type: 'success', infoText: false });
                formPanel.style.display = 'none';
                btnNew.style.display = 'block';
                resetDisposalForm();
                const v = document.getElementById('view-inventory-damaged');
                if (v) { v.dataset.bound = ''; if (window.TradeProViews) window.TradeProViews.reload('view-inventory-damaged'); }
                if (andPrint && res.id) {
                    setTimeout(() => window.printDisposalDetail(res.id), 500);
                }
            } else {
                showAlert(res.message || 'حدث خطأ', { title: 'خطأ', type: 'danger', infoText: false });
            }
        } catch (e) {
            if (e.message) showAlert(e.message, { title: 'خطأ', type: 'danger', infoText: false });
        } finally {
            btnSave.disabled = false;
        }
    }

    btnNew.addEventListener('click', () => { formPanel.style.display = 'block'; btnNew.style.display = 'none'; });
    btnCancel.addEventListener('click', () => { formPanel.style.display = 'none'; btnNew.style.display = 'block'; });
    btnSave.addEventListener('click', () => saveDisposal(false));
    if (btnSavePrint) btnSavePrint.addEventListener('click', () => saveDisposal(true));
};

// ---- Show Disposal Detail ----
window.showDisposalDetail = async function(id) {
    const modal = document.getElementById('disp-detail-modal');
    const body = document.getElementById('disp-detail-body');
    if (!modal || !body) return;
    body.innerHTML = '<p style="text-align:center;padding:20px;"><i class="fa-solid fa-spinner fa-spin"></i> جاري التحميل...</p>';
    modal.classList.add('open');
    try {
        const res = await window.API.getStockDisposal(id);
        if (!res.success) { body.innerHTML = '<p class="text-danger">خطأ في تحميل التفاصيل</p>'; return; }
        const d = res.data;
        const items = res.items || [];
        let itemsHtml = '';
        items.forEach((it, i) => {
            itemsHtml += `<tr>
                <td>${i+1}</td>
                <td>${it.product_name || '-'} (${it.product_code || ''})</td>
                <td>${it.unit || '-'}</td>
                <td>${typeof it.current_balance !== 'undefined' ? it.current_balance : '-'}</td>
                <td>${it.quantity}</td>
                <td>${Number(it.cost_price || 0).toFixed(2)}</td>
                <td>${Number(it.total_value || 0).toFixed(2)}</td>
                <td>${it.item_reason || '-'}</td>
            </tr>`;
        });
        body.innerHTML = `
            <div>
                <div class="form-grid" style="margin-bottom:15px">
                    <div><strong>المستند:</strong> ${d.doc_no || '-'}</div>
                    <div><strong>التاريخ:</strong> ${d.doc_date || '-'}</div>
                    <div><strong>المخزن:</strong> ${d.store_name || '-'}</div>
                    <div><strong>لجنة الإعدام:</strong> ${d.committee || '-'}</div>
                    <div><strong>البيان:</strong> ${d.reason || '-'}</div>
                    <div><strong>ملاحظات:</strong> ${d.notes || '-'}</div>
                    <div><strong>بواسطة:</strong> ${d.created_by_name || '-'}</div>
                </div>
                <div class="table-responsive">
                    <table class="data-table">
                        <thead><tr><th>#</th><th>الصنف</th><th>الوحدة</th><th>الرصيد قبل</th><th>الكمية</th><th>تكلفة الوحدة</th><th>القيمة</th><th>سبب الإعدام</th></tr></thead>
                        <tbody>${itemsHtml}</tbody>
                        <tfoot><tr style="font-weight:bold"><td colspan="4">الإجمالي</td><td>${d.total_qty || 0}</td><td></td><td>${Number(d.total_value || 0).toFixed(2)} ج.م</td><td></td></tr></tfoot>
                    </table>
                </div>
                <span class="disp-detail-id" style="display:none">${id}</span>
            </div>`;
    } catch (e) {
        body.innerHTML = '<p class="text-danger">خطأ في تحميل التفاصيل: ' + (e.message || '') + '</p>';
    }
};

// ---- Edit Disposal (load data into form) ----
window.editDisposal = async function(id) {
    try {
        const res = await window.API.getStockDisposal(id);
        if (!res.success) { showAlert('خطأ في تحميل بيانات الإعدام', { type: 'danger' }); return; }
        const d = res.data;
        const items = res.items || [];
        const btnNew = document.getElementById('btn-new-disposal');
        const formPanel = document.getElementById('form-new-disposal');
        if (!btnNew || !formPanel) return;
        const editIdInput = document.getElementById('disp-edit-id');
        if (editIdInput) editIdInput.value = id;
        document.getElementById('disp-form-title').textContent = 'تعديل إذن إعدام - ' + d.doc_no;
        document.getElementById('disp-store').value = d.store_id || '';
        document.getElementById('disp-date').value = d.doc_date || '';
        document.getElementById('disp-committee').value = d.committee || '';
        document.getElementById('disp-reason').value = d.reason || '';
        document.getElementById('disp-notes').value = d.notes || '';
        const itemsBody = document.getElementById('disposal-items-body');
        if (itemsBody) {
            itemsBody.innerHTML = '';
            items.forEach(it => {
                const tr = document.createElement('tr');
                tr.className = 'disposal-row';
                tr.dataset.productId = it.product_id;
                tr.innerHTML = `
                    <td></td>
                    <td><input type="text" class="disp-item-search" list="disp-products-list" placeholder="ابحث عن صنف..." style="width:180px" value="${it.product_name || ''}"></td>
                    <td class="disp-unit">${it.unit || '-'}</td>
                    <td class="disp-balance">${typeof it.current_balance !== 'undefined' ? it.current_balance : '-'}</td>
                    <td><input type="number" class="disp-qty" value="${it.quantity}" min="1" style="width:80px"></td>
                    <td><input type="number" class="disp-cost" value="${Number(it.cost_price || 0).toFixed(2)}" min="0" step="0.01" style="width:100px"></td>
                    <td class="disp-total">${Number(it.total_value || 0).toFixed(2)}</td>
                    <td><input type="text" class="disp-item-reason" placeholder="سبب الإعدام" style="width:140px" value="${it.item_reason || ''}"></td>
                    <td class="actions-cell"><button class="icon-btn text-danger btn-remove-disposal-row"><i class="fa-solid fa-trash"></i></button></td>`;
                itemsBody.appendChild(tr);
                const searchInp = tr.querySelector('.disp-item-search');
                searchInp.addEventListener('input', function() {
                    const dl = document.getElementById('disp-products-list');
                    const matched = Array.from(dl.options).find(o => o.value === this.value);
                    if (matched) {
                        tr.dataset.productId = matched.dataset.id;
                        tr.querySelector('.disp-cost').value = matched.dataset.cost;
                        tr.querySelector('.disp-unit').textContent = matched.dataset.unit;
                    } else {
                        tr.dataset.productId = '';
                    }
                });
                tr.querySelector('.disp-qty').addEventListener('input', () => {
                    const qty = parseFloat(tr.querySelector('.disp-qty').value) || 0;
                    const cost = parseFloat(tr.querySelector('.disp-cost').value) || 0;
                    tr.querySelector('.disp-total').textContent = (qty * cost).toFixed(2);
                });
                tr.querySelector('.disp-cost').addEventListener('input', () => {
                    const qty = parseFloat(tr.querySelector('.disp-qty').value) || 0;
                    const cost = parseFloat(tr.querySelector('.disp-cost').value) || 0;
                    tr.querySelector('.disp-total').textContent = (qty * cost).toFixed(2);
                });
                tr.querySelector('.btn-remove-disposal-row').addEventListener('click', function() {
                    tr.remove();
                    document.querySelectorAll('.disposal-row').forEach((r, i) => { r.querySelector('td:first-child').textContent = i + 1; });
                });
            });
            document.querySelectorAll('.disposal-row').forEach((r, i) => { r.querySelector('td:first-child').textContent = i + 1; });
        }
        formPanel.style.display = 'block';
        btnNew.style.display = 'none';
    } catch (e) {
        showAlert('خطأ: ' + (e.message || ''), { type: 'danger' });
    }
};

// ---- Delete Disposal ----
window.deleteDisposal = async function(id, docNo) {
    const confirmed = await new Promise(resolve => {
        const modal = document.getElementById('disp-detail-modal');
        const body = document.getElementById('disp-detail-body');
        if (!modal || !body) { resolve(false); return; }
        body.innerHTML = `
            <div style="text-align:center;padding:20px;">
                <i class="fa-solid fa-exclamation-triangle" style="font-size:48px;color:var(--danger-color);margin-bottom:15px;"></i>
                <h3 style="margin-bottom:10px;">تأكيد حذف إذن الإعدام</h3>
                <p>هل أنت متأكد من حذف إذن الإعدام <strong>${docNo || ''}</strong>؟</p>
                <p style="color:var(--danger-color);font-size:0.9rem;">سيتم عكس جميع آثار الإذن: إعادة الرصيد للمخزن، عكس القيد المحاسبي، وحذف حركة المخزون.</p>
                <div style="display:flex;gap:10px;justify-content:center;margin-top:20px;">
                    <button class="btn btn-outline" id="btn-confirm-delete-no" style="min-width:100px;">إلغاء</button>
                    <button class="btn btn-primary" id="btn-confirm-delete-yes" style="background:var(--danger-color);border-color:var(--danger-color);min-width:100px;"><i class="fa-solid fa-trash"></i> تأكيد الحذف</button>
                </div>
            </div>`;
        modal.classList.add('open');
        document.getElementById('btn-confirm-delete-no').onclick = () => { modal.classList.remove('open'); resolve(false); };
        document.getElementById('btn-confirm-delete-yes').onclick = () => { modal.classList.remove('open'); resolve(true); };
    });
    if (!confirmed) return;
    try {
        const res = await window.API.request('/inventory/disposals/' + id, 'DELETE');
        if (res.success) {
            showAlert('تم حذف الإذن وعكس جميع آثاره', { type: 'success' });
            const v = document.getElementById('view-inventory-damaged');
            if (v) { v.dataset.bound = ''; if (window.TradeProViews) window.TradeProViews.reload('view-inventory-damaged'); }
        } else {
            showAlert(res.message || 'حدث خطأ', { type: 'danger' });
        }
    } catch (e) {
        showAlert('خطأ: ' + (e.message || ''), { type: 'danger' });
    }
};

// ---- Print Disposal ----
window.printDisposalDetail = async function(id) {
    if (!id) return;
    try {
        const [printRes, coRes] = await Promise.all([
            window.API.getStockDisposalPrint(id),
            window.API.request('/settings/company').catch(() => ({ data: {} }))
        ]);
        if (!printRes.success) { showAlert('خطأ في تحميل بيانات الطباعة', { type: 'danger' }); return; }
        const d = printRes.data;
        const items = printRes.items || [];
        const co = coRes.data || {};
        let rows = '';
        items.forEach((it, i) => {
            rows += `<tr>
                <td style="padding:6px 8px;border:1px solid #dee2e6;text-align:center">${i+1}</td>
                <td style="padding:6px 8px;border:1px solid #dee2e6;text-align:center">${it.product_code || ''}</td>
                <td style="padding:6px 8px;border:1px solid #dee2e6;text-align:right">${it.product_name || '-'}</td>
                <td style="padding:6px 8px;border:1px solid #dee2e6;text-align:center">${it.unit || '-'}</td>
                <td style="padding:6px 8px;border:1px solid #dee2e6;text-align:center">${it.quantity}</td>
                <td style="padding:6px 8px;border:1px solid #dee2e6;text-align:center">${Number(it.cost_price || 0).toFixed(2)}</td>
                <td style="padding:6px 8px;border:1px solid #dee2e6;text-align:center">${Number(it.total_value || 0).toFixed(2)}</td>
                <td style="padding:6px 8px;border:1px solid #dee2e6;text-align:right">${it.item_reason || '-'}</td>
            </tr>`;
        });
        const h = `<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>إذن إعدام ${d.doc_no}</title>
<style>
@page { margin: 10mm; }
body { font-family: 'Segoe UI', Tahoma, sans-serif; margin: 0; padding: 15px; color: #1e293b; font-size: 13px; }
.print-header { text-align: center; margin-bottom: 20px; }
.print-header .co-name { font-size: 20px; font-weight: 800; color: #1e293b; }
.print-header .co-info { font-size: 11px; color: #64748b; margin-top: 3px; }
.print-header .doc-title { font-size: 16px; font-weight: 700; color: #dc2626; margin-top: 8px; padding: 6px 20px; border: 2px solid #dc2626; display: inline-block; border-radius: 6px; }
.print-header .doc-ref { font-size: 11px; color: #64748b; margin-top: 5px; }
.info-section { display: flex; flex-wrap: wrap; gap: 8px 20px; margin-bottom: 15px; padding: 10px 12px; background: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0; font-size: 12px; }
.info-section div { min-width: 160px; }
.info-section strong { display: inline-block; min-width: 65px; color: #475569; }
table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 12px; }
th { background: #dc2626; color: #fff; padding: 8px 6px; border: 1px solid #dc2626; text-align: center; font-weight: 600; }
td { padding: 6px 8px; border: 1px solid #e2e8f0; text-align: center; }
tr:nth-child(even) { background: #f8fafc; }
tfoot td { background: #fef2f2; font-weight: 700; }
.totals-section { text-align: left; margin-top: 12px; padding: 10px 15px; background: #fef2f2; border-radius: 6px; border: 1px solid #fecaca; }
.totals-section strong { color: #dc2626; font-size: 15px; }
.signatures { margin-top: 40px; display: flex; justify-content: space-between; padding: 0 20px; }
.signatures .sig { text-align: center; width: 160px; }
.signatures .sig-line { border-top: 1px solid #94a3b8; padding-top: 6px; margin-top: 40px; font-size: 11px; color: #475569; }
.footer-print { text-align: center; font-size: 10px; color: #94a3b8; margin-top: 20px; border-top: 1px solid #e2e8f0; padding-top: 8px; }
.watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%) rotate(-30deg); font-size: 120px; opacity: 0.03; color: #dc2626; pointer-events: none; z-index: -1; font-weight: 900; }
@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>
<div class="watermark">إعدام</div>
<div class="print-header">
    ${co.logo_url ? '<img src="' + co.logo_url + '" style="max-height:55px;margin-bottom:5px">' : ''}
    <div class="co-name">${co.name || co.company_name || ''}</div>
    <div class="co-info">${[co.address || co.company_address, co.phone || co.company_phone].filter(Boolean).join(' | ')}</div>
    <div class="doc-title">إذن إعدام بضاعة</div>
    <div class="doc-ref">رقم: ${d.doc_no} | تاريخ: ${d.doc_date}</div>
</div>
<div class="info-section">
    <div><strong>المخزن:</strong> ${d.store_name || '-'}</div>
    <div><strong>لجنة الإعدام:</strong> ${d.committee || '-'}</div>
    <div><strong>البيان:</strong> ${d.reason || '-'}</div>
    <div><strong>ملاحظات:</strong> ${d.notes || '-'}</div>
</div>
<table>
<thead><tr><th>#</th><th>كود</th><th>الصنف</th><th>الوحدة</th><th>الكمية</th><th>تكلفة الوحدة</th><th>القيمة</th><th>سبب الإعدام</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr><td colspan="4">الإجمالي</td><td>${d.total_qty || 0}</td><td></td><td>${Number(d.total_value || 0).toFixed(2)}</td><td></td></tr></tfoot>
</table>
<div class="totals-section">إجمالي قيمة الإعدام: <strong>${Number(d.total_value || 0).toFixed(2)} ج.م</strong></div>
<div class="signatures">
    <div class="sig"><div class="sig-line">أمين المخزن</div></div>
    <div class="sig"><div class="sig-line">لجنة الإعدام</div></div>
    <div class="sig"><div class="sig-line">المدير المالي</div></div>
</div>
<div class="footer-print">TradePro ERP - نظام إدارة المؤسسات</div>
</body></html>`;
        const pw = window.open('', '_blank', 'width=1000,height=700,scrollbars=yes');
        if (pw) {
            pw.document.write(h);
            pw.document.close();
            pw.focus();
            setTimeout(() => { pw.print(); }, 500);
        } else {
            showAlert('الرجاء السماح للنوافذ المنبثقة للطباعة', { type: 'warning' });
        }
    } catch (e) {
        showAlert('خطأ في الطباعة: ' + (e.message || ''), { type: 'danger' });
    }
};

// ---- Sales Invoices List (In Sales Invoice view) ----
window.loadSalesInvoicesList = async function(q) {
    const tbody = document.getElementById('invoices-list-body');
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="padding:20px;"><i class="fa-solid fa-spinner fa-spin"></i></td></tr>';
    
    try {
        const params = {};
        if (q) params.q = q;
        const res = await window.API.getSalesInvoices(params);
        tbody.innerHTML = '';
        
        res.data.forEach(inv => {
            const rem = parseFloat(inv.remaining) || 0;
            const paid = parseFloat(inv.amount_paid) || 0;
            const total = parseFloat(inv.grand_total) || 0;
            
            const retStatus = (inv.return_status || 'Normal').replace(/^null$/i, 'Normal');
            const retLabels = { 'Normal': '', 'Partially Returned': '<span class="badge-status" style="background:#ffc107;color:#000;">مرتجع جزئي</span>', 'Fully Returned': '<span class="badge-status" style="background:#6c757d;">مرتجع كلياً</span>' };
            let statusHtml = '';
            if (rem <= 0) statusHtml = '<span class="badge-status paid">مسدد</span>';
            else if (paid > 0) statusHtml = '<span class="badge-status pending">جزئي</span>';
            else statusHtml = '<span class="badge-status overdue">غير مسدد</span>';
            if (retStatus !== 'Normal') statusHtml += ' ' + (retLabels[retStatus] || '');
            
            const tr = document.createElement('tr');
            tr.style.cursor = 'pointer';
            
            const td1 = document.createElement('td'); td1.style.fontWeight = 'bold'; td1.style.color = 'var(--primary-color)'; td1.textContent = inv.invoice_no;
            const td2 = document.createElement('td'); td2.textContent = inv.invoice_date;
            const td3 = document.createElement('td'); td3.textContent = inv.customer_name || 'نقدي';
            const td4 = document.createElement('td'); td4.style.fontWeight = 'bold'; td4.innerHTML =formatMoney(total) + ' ج.م';
            const td5 = document.createElement('td'); td5.style.color = 'var(--success-color)'; td5.innerHTML =formatMoney(paid) + ' ج.م';
            const td6 = document.createElement('td'); td6.style.color = rem > 0 ? 'var(--danger-color)' : 'inherit'; td6.innerHTML =formatMoney(rem) + ' ج.م';
            const td7 = document.createElement('td'); td7.innerHTML = statusHtml;
            const td8 = document.createElement('td');
            
            const viewBtn = document.createElement('button');
            viewBtn.className = 'btn btn-outline btn-sm';
            viewBtn.dataset.id = inv.id;
            viewBtn.innerHTML = '<i class="fa-solid fa-eye"></i> عرض';
            td8.appendChild(viewBtn);
            
            tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3); tr.appendChild(td4);
            tr.appendChild(td5); tr.appendChild(td6); tr.appendChild(td7); tr.appendChild(td8);
            tbody.appendChild(tr);
            
            viewBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await window.showSalesInvoiceDetail(inv.id);
            });
        });
        
        if (res.data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="padding:20px; color:#888;">لا توجد فواتير مسجلة</td></tr>';
        }
        
    } catch(e) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-danger">لا توجد بيانات لعرضها المرجو التأكد أو البحث مجدداً</td></tr>';
        console.error(e);
    }
};

window.showSalesInvoiceDetail = async function(id) {
    try {
        const detRes = await window.API.getSalesInvoice(id);
        const det = detRes.data;
        const returnStatus = det.return_status || 'Normal';
        const returnedAmount = parseFloat(det.returned_amount) || 0;
        const netTotal = parseFloat(det.net_total) || parseFloat(det.grand_total) - returnedAmount;
        const isFullyReturned = returnStatus === 'Fully Returned';

        const modal = document.getElementById('global-modal');
        const modalTitle = document.getElementById('modal-title');
        const modalBody = document.getElementById('modal-body');
        const btnSave = document.getElementById('btn-modal-save');
        if (!modal || !modalBody) return;

        const statusColors = { 'Normal': '#28a745', 'Partially Returned': '#ffc107', 'Fully Returned': '#6c757d' };
        const statusLabels = { 'Normal': 'عادي', 'Partially Returned': 'مرتجع جزئي', 'Fully Returned': 'مرتجع كلياً' };

        modalTitle.innerHTML = 'تفاصيل الفاتورة: ' + det.invoice_no +
            ' <span style="display:inline-block;font-size:0.65em;padding:3px 10px;border-radius:12px;background:' +
            (statusColors[returnStatus]||'#28a745') + ';color:#fff;margin-right:8px;vertical-align:middle">' +
            (statusLabels[returnStatus]||returnStatus) + '</span>';

        modalBody.innerHTML = '';

        // Header info with return status
        const info = document.createElement('div');
        info.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:12px; padding:15px; background:#f8f9fa; border-radius:8px; margin-bottom:15px;';
        const infoItems = [
            ['رقم الفاتورة', det.invoice_no],
            ['التاريخ', det.invoice_date],
            ['العميل', det.customer_name || 'نقدي'],
            ['نوع الدفع', det.payment_type === 'cash' ? 'نقدي' : 'آجل']
        ];
        infoItems.forEach(([label, val]) => {
            const d = document.createElement('div');
            d.innerHTML = '<strong>' + label + ':</strong> ' + val;
            info.appendChild(d);
        });
        modalBody.appendChild(info);

        // Items table with returned_qty and remaining_qty
        const itemsTable = document.createElement('table');
        itemsTable.className = 'data-table';
        itemsTable.style.marginTop = '15px';
        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        ['#', 'الصنف', 'الكمية', 'المسترجع', 'المتبقي', 'السعر', 'خصم%', 'الإجمالي', 'الحالة'].forEach(h => {
            const th = document.createElement('th'); th.textContent = h; headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        itemsTable.appendChild(thead);

        const tbdy = document.createElement('tbody');
        (det.items || []).forEach((it, i) => {
            const rqty = parseFloat(it.returned_qty) || 0;
            const remQty = parseFloat(it.remaining_qty) || (parseFloat(it.quantity) - rqty);
            const itemFullyReturned = rqty >= parseFloat(it.quantity);
            const row = document.createElement('tr');
            if (itemFullyReturned) {
                row.style.cssText = 'opacity:0.5; background:#f0f0f0;';
            }
            [i+1, it.product_name, it.quantity,
             '<strong style="color:' + (rqty > 0 ? '#dc3545' : '#888') + '">' + rqty + '</strong>',
             '<strong>' + remQty + '</strong>',
             formatMoney(it.unit_price) + ' ج.م',
             formatMoney(it.discount_pct||0) + '%',
             formatMoney(it.line_total) + ' ج.م',
             itemFullyReturned
                 ? '<span style="color:#6c757d;font-size:0.85em"><i class="fa-solid fa-check-circle"></i> مرتجع كلياً</span>'
                 : rqty > 0
                     ? '<span style="color:#ffc107;font-size:0.85em"><i class="fa-solid fa-rotate-left"></i> مرتجع جزئي</span>'
                     : '<span style="color:#28a745;font-size:0.85em">—</span>'
            ].forEach(val => {
                const td = document.createElement('td');
                if (typeof val === 'string' && val.includes('<')) { td.innerHTML = val; }
                else { td.textContent = val; }
                row.appendChild(td);
            });
            // Tooltip with return details
            row.title = it.product_name + ': تم إرجاع ' + rqty + ' من ' + it.quantity;
            tbdy.appendChild(row);
        });
        itemsTable.appendChild(tbdy);

        const wrap = document.createElement('div'); wrap.className = 'table-responsive';
        wrap.appendChild(itemsTable);
        modalBody.appendChild(wrap);

        // Totals with returned amount and net
        const rem = parseFloat(det.remaining) || 0;
        const totals = document.createElement('div');
        totals.style.cssText = 'margin-top:15px; padding:15px; background:#f8f9fa; border-radius:8px; display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:12px; text-align:center;';
        const totalsData = [
            ['إجمالي الفاتورة', det.grand_total, 'var(--primary-color)'],
            ['قيمة المرتجعات', returnedAmount, returnedAmount > 0 ? '#dc3545' : '#888'],
            ['صافي الفاتورة', netTotal, 'var(--primary-color)'],
            ['المدفوع', det.amount_paid, 'var(--success-color)'],
            ['المتبقي', det.remaining, rem > 0 ? 'var(--danger-color)' : 'var(--success-color)']
        ];
        totalsData.forEach(([lbl, val, color]) => {
            const d = document.createElement('div');
            d.innerHTML = '<div style="font-size:0.85em; color:#888;">' + lbl + '</div>' +
                          '<div style="font-size:1.3em; font-weight:bold; color:' + color + '">' + formatMoney(val||0) + ' ج.م';
            totals.appendChild(d);
        });
        modalBody.appendChild(totals);

        // Return History section
        const histWrap = document.createElement('div');
        histWrap.style.cssText = 'margin-top:15px; padding:15px; background:#fff; border:1px solid #ddd; border-radius:8px;';
        histWrap.innerHTML = '<div style="font-weight:bold;margin-bottom:10px;color:var(--primary-color)"><i class="fa-solid fa-clock-rotate-left"></i> سجل المرتجعات</div>';
        const histTable = document.createElement('table');
        histTable.className = 'data-table';
        histTable.style.fontSize = '0.9em';
        const hThead = document.createElement('thead');
        const hRow = document.createElement('tr');
        ['رقم المرتجع', 'التاريخ', 'المستخدم', 'السبب', 'الكمية', 'الإجمالي', 'الحالة'].forEach(h => {
            const th = document.createElement('th'); th.textContent = h; hRow.appendChild(th);
        });
        hThead.appendChild(hRow);
        histTable.appendChild(hThead);
        const hBody = document.createElement('tbody');
        try {
            const histRes = await window.API.getSalesReturns({ invoice_id: id });
            const returns = histRes.data || [];
            if (returns.length === 0) {
                const tr = document.createElement('tr');
                const td = document.createElement('td');
                td.colSpan = 7;
                td.style.cssText = 'text-align:center; color:#888;';
                td.textContent = 'لا توجد مرتجعات لهذه الفاتورة';
                tr.appendChild(td); hBody.appendChild(tr);
            } else {
                returns.forEach(r => {
                    const tr = document.createElement('tr');
                    const wfLabels = { 'approved': 'معتمد', 'pending_approval': 'بانتظار الاعتماد', 'reversed': 'ملغي', 'draft': 'مسودة', 'rejected': 'مرفوض' };
                    const wfColors = { 'approved': '#28a745', 'pending_approval': '#ffc107', 'reversed': '#dc3545', 'draft': '#888', 'rejected': '#dc3545' };
                    const wfLabel = wfLabels[r.workflow_status] || r.workflow_status;
                    const wfColor = wfColors[r.workflow_status] || '#888';
                    [r.return_no, r.return_date, r.created_by_username || '—', r.reason_code || r.return_reason || '—',
                     r.items_count || 0, formatMoney(r.grand_total) + ' ج.م',
                     '<span style="color:' + wfColor + '">' + wfLabel + '</span>'].forEach(val => {
                        const td = document.createElement('td');
                        if (typeof val === 'string' && val.includes('<')) { td.innerHTML = val; }
                        else { td.textContent = val; }
                        tr.appendChild(td);
                    });
                    tr.style.cursor = 'pointer';
                    tr.onclick = () => window.showReturnDetail(r.id);
                    hBody.appendChild(tr);
                });
            }
        } catch (e) {
            const tr = document.createElement('tr');
            const td = document.createElement('td'); td.colSpan = 7;
            td.textContent = 'خطأ في تحميل سجل المرتجعات';
            tr.appendChild(td); hBody.appendChild(tr);
        }
        histTable.appendChild(hBody);
        histWrap.appendChild(histTable);
        modalBody.appendChild(histWrap);

        // Action buttons
        const actions = document.createElement('div');
        actions.style.cssText = 'margin-top:20px; display:flex; gap:10px; justify-content:center; flex-wrap:wrap;';

        const btnPrint = document.createElement('button');
        btnPrint.className = 'btn btn-outline';
        btnPrint.innerHTML = '<i class="fa-solid fa-print"></i> طباعة';
        btnPrint.onclick = () => window.API.openInvoicePrint(det.id);
        actions.appendChild(btnPrint);

        const btnEdit = document.createElement('button');
        btnEdit.className = 'btn btn-outline';
        btnEdit.style.color = 'var(--primary-color)';
        btnEdit.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> تعديل';
        btnEdit.onclick = () => window.editSalesInvoice(det);
        actions.appendChild(btnEdit);

        // Return button (disabled if fully returned)
        const btnReturn = document.createElement('button');
        btnReturn.className = 'btn btn-outline';
        if (isFullyReturned) {
            btnReturn.disabled = true;
            btnReturn.style.cssText = 'opacity:0.4; cursor:not-allowed;';
            btnReturn.title = 'هذه الفاتورة مرتجعة بالكامل';
        } else {
            btnReturn.style.color = 'var(--warning-color,#ff9800)';
            btnReturn.onclick = () => { document.getElementById('modal-close')?.click(); window.initSalesReturn(det.invoice_no); };
        }
        btnReturn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> مرتجع';
        actions.appendChild(btnReturn);

        const btnDelete = document.createElement('button');
        btnDelete.className = 'btn btn-outline';
        btnDelete.style.color = 'var(--danger-color)';
        btnDelete.style.borderColor = 'var(--danger-color)';
        btnDelete.innerHTML = '<i class="fa-solid fa-trash"></i> حذف';
        btnDelete.onclick = () => window.deleteSalesInvoice(det.id);
        actions.appendChild(btnDelete);

        modalBody.appendChild(actions);

        if (btnSave) btnSave.style.display = 'none';
        modal.classList.add('active');
    } catch(e) { console.error(e); }
};

window.showReturnDetail = async function(returnId) {
    try {
        const r = await window.API.request('/sales/returns/' + returnId);
        if (!r.success) { alert(r.message); return; }
        const ret = r.data;
        const items = (ret && ret.items) || [];
        const modal = document.getElementById('global-modal');
        const modalTitle = document.getElementById('modal-title');
        const modalBody = document.getElementById('modal-body');
        const btnSave = document.getElementById('btn-modal-save');
        if (!modal || !modalBody) return;

        modalTitle.textContent = 'تفاصيل المرتجع: ' + ret.return_no;
        modalBody.innerHTML = '';

        const info = document.createElement('div');
        info.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:12px; padding:15px; background:#f8f9fa; border-radius:8px; margin-bottom:15px;';
        const wfLabels = { 'approved': 'معتمد', 'pending_approval': 'بانتظار الاعتماد', 'reversed': 'ملغي', 'draft': 'مسودة', 'rejected': 'مرفوض' };
        [
            ['رقم المرتجع', ret.return_no], ['التاريخ', ret.return_date],
            ['العميل', ret.customer_name || '—'], ['الحالة', wfLabels[ret.workflow_status] || ret.workflow_status],
            ['السبب', ret.reason_code || ret.return_reason || '—'], ['الإجمالي', formatMoney(ret.grand_total) + ' ج.م'],
            ['طريقة الإرجاع', ret.is_free_return ? 'بدون فاتورة' : 'مرتبط بالفاتورة']
        ].forEach(([label, val]) => {
            const d = document.createElement('div');
            d.innerHTML = '<strong>' + label + ':</strong> ' + val;
            info.appendChild(d);
        });
        modalBody.appendChild(info);

        // Items (included in single return API response)
        if (items.length > 0) {
            const tbl = document.createElement('table');
            tbl.className = 'data-table';
            const thd = document.createElement('thead');
            const thr = document.createElement('tr');
            ['#', 'الصنف', 'الكمية', 'السعر', 'الإجمالي', 'الحالة'].forEach(h => {
                const th = document.createElement('th'); th.textContent = h; thr.appendChild(th);
            });
            thd.appendChild(thr); tbl.appendChild(thd);
            const tbdy = document.createElement('tbody');
            items.forEach((it, i) => {
                const tr = document.createElement('tr');
                [i+1, it.product_name || '—', it.quantity,
                 formatMoney(it.unit_price) + ' ج.م', formatMoney(it.line_total) + ' ج.م',
                 it.product_condition === 'saleable' ? 'قابل للبيع' : it.product_condition === 'damaged' ? 'تالف' : it.product_condition === 'expired' ? 'منتهي' : 'فحص'
                ].forEach(val => {
                    const td = document.createElement('td'); td.textContent = val; tr.appendChild(td);
                });
                tbdy.appendChild(tr);
            });
            tbl.appendChild(tbdy);
            modalBody.appendChild(tbl);
        }

        if (btnSave) btnSave.style.display = 'none';
        modal.classList.add('active');
    } catch (e) { console.error(e); }
};

window.deleteSalesInvoice = async function(id) {
    const confirmed = await showConfirm('هل أنت متأكد من حذف هذه الفاتورة؟\n\nملاحظة: الحذف مشروط بعدم وجود تحصيلات أو مرتجعات أو قيود محاسبية مرتبطة بها.', {
        title: 'حذف الفاتورة',
        confirmText: '<i class="fa-solid fa-trash" style="margin-left:6px"></i> حذف',
    });
    if (confirmed) {
        try {
            await window.API.deleteSalesInvoice(id);
            showAlert('تم حذف الفاتورة بنجاح', { title: 'تمت العملية', type: 'success', infoText: false });
            const modal = document.getElementById('global-modal');
            if (modal) modal.classList.remove('active');
            if (typeof window.loadSalesInvoices === 'function') window.loadSalesInvoices();
        } catch(e) {
            showAlert(e.message, { type: 'danger', title: 'تعذر الحذف' });
        }
    }
};

window.editSalesInvoice = function(det) {
    // Switch to new invoice view
    document.querySelectorAll('.view').forEach(v => { v.classList.remove('active-view'); v.style.display = 'none'; });
    const view = document.getElementById('view-sales-invoice');
    if (view) { view.style.display = ''; view.classList.add('active-view'); }
    
    // Close modal
    document.getElementById('global-modal').classList.remove('active');
    
    // Set editing flag
    window.editingInvoiceId = det.id;
    
    // Populate header
    document.getElementById('inv-no').value = det.invoice_no;
    document.getElementById('inv-date').value = det.invoice_date;
    
    const custSearch = document.getElementById('inv-customer');
    if (custSearch) {
        custSearch.value = det.customer_name || '';
        custSearch.setAttribute('data-id', det.customer_id || '');
    }
    
    const repSelect = document.getElementById('inv-rep');
    if (repSelect) repSelect.value = det.rep_id || '';
    
    document.getElementById('inv-type').value = det.invoice_type || 'normal';
    document.getElementById('inv-paytype').value = det.payment_type || 'credit';
    document.getElementById('amount-paid').value = det.amount_paid || 0;
    
    // Populate items
    const tbody = document.getElementById('invoice-body');
    if (tbody) {
        tbody.innerHTML = '';
        (det.items || []).forEach(item => {
            const tr = document.createElement('tr');
            tr.className = 'invoice-row';
            tr.innerHTML = `
                <td><button class="icon-btn btn-danger btn-remove-row"><i class="fa-solid fa-trash"></i></button></td>
                <td>
                    <div class="search-box">
                        <input type="text" class="item-search" placeholder="ابحث عن صنف..." 
                            value="${item.product_name}" 
                            data-id="${item.product_id}" 
                            data-stock="999999">
                        <div class="search-results hidden"></div>
                    </div>
                </td>
                <td><input type="number" class="item-qty" value="${item.quantity}" min="1" style="width:70px"></td>
                <td><input type="number" class="item-price" value="${item.unit_price}" step="0.01" style="width:80px"></td>
                <td><input type="number" class="item-discount" value="${item.discount_pct || 0}" min="0" max="100" style="width:60px"></td>
                <td class="item-total">${item.line_total.toFixed(2)}</td>
            `;
            tbody.appendChild(tr);
        });
    }
    
    // Trigger recalculation
    const firstQty = tbody?.querySelector('.item-qty');
    if (firstQty) {
        const event = new Event('input', { bubbles: true });
        firstQty.dispatchEvent(event);
    }
};

// ---- Universal Dynamic Search & Debounce Logic ----
document.addEventListener('DOMContentLoaded', () => {
    // 1. Universal Table Filter for local search boxes
    document.addEventListener('input', (e) => {
        if (e.target.matches('.search-box input')) {
            const q = e.target.value.toLowerCase();
            const view = e.target.closest('.view');
            if (view) {
                const tbody = view.querySelector('.data-table tbody');
                if (tbody) {
                    tbody.querySelectorAll('tr').forEach(tr => {
                        // Skip if it's a "No data" row
                        if (tr.children.length === 1 && tr.children[0].colSpan > 1) return;
                        const text = tr.textContent.toLowerCase();
                        tr.style.display = text.includes(q) ? '' : 'none';
                    });
                }
            }
        }
    });

    // 2. Debounced search for Invoices List
    let invSearchTimeout;
    const invSearchQ = document.getElementById('inv-search-q');
    if (invSearchQ) {
        invSearchQ.addEventListener('input', (e) => {
            clearTimeout(invSearchTimeout);
            invSearchTimeout = setTimeout(() => {
                if (typeof window.loadSalesInvoicesList === 'function') {
                    window.loadSalesInvoicesList(e.target.value);
                }
            }, 400);
        });
    }
});

// ---- Dashboard Logic ----
let salesChartInstance = null;

window.loadDashboard = async function() {
    try {
        const statsRes = await window.API.request('/dashboard/stats');
        if (statsRes && statsRes.data) {
            const stats = statsRes.data;
            document.getElementById('dash-sales-today').innerHTML =formatMoney(stats.sales_today || 0) + ' ج.م';
            document.getElementById('dash-purchases-today').innerHTML =formatMoney(stats.purchases_today || 0) + ' ج.م';
            document.getElementById('dash-total-customers').textContent = stats.total_customers || 0;
            document.getElementById('dash-treasury').innerHTML =formatMoney(stats.treasury_balance || 0) + ' ج.م';
            
            if (document.getElementById('dash-sales-month')) document.getElementById('dash-sales-month').innerHTML = 'مبيعات الشهر: ' +formatMoney(stats.sales_month || 0) + ' ج.م';
            if (document.getElementById('dash-purchases-month')) document.getElementById('dash-purchases-month').innerHTML = 'مشتريات الشهر: ' +formatMoney(stats.purchases_month || 0) + ' ج.م';
            if (document.getElementById('dash-total-receivable')) document.getElementById('dash-total-receivable').innerHTML = 'إجمالي المديونيات: ' +formatMoney(stats.total_receivable || 0) + ' ج.م';
            if (document.getElementById('dash-collections-today')) document.getElementById('dash-collections-today').innerHTML = 'تحصيلات اليوم: ' +formatMoney(stats.collections_today || 0) + ' ج.م';
        }

        const recentRes = await window.API.request('/dashboard/recent');
        if (recentRes && recentRes.data) {
            const recent = recentRes.data;
            const dashInvoices = document.getElementById('dash-recent-invoices');
            if (dashInvoices) {
                dashInvoices.innerHTML = '';
                recent.invoices.slice(0,5).forEach(inv => {
                    const statusClass = inv.status === 'paid' ? 'background:#ecfdf5;color:#10b981;' : 
                                      (inv.status === 'partial' ? 'background:#eff6ff;color:#3b82f6;' : 'background:#fffbeb;color:#f59e0b;');
                    const statusText = inv.status === 'paid' ? 'مسدد' : (inv.status === 'partial' ? 'جزئي' : 'آجل');
                    const badge = `<span style="padding: 5px 12px; border-radius: 20px; font-size: 0.8rem; font-weight: 700; ${statusClass}">${statusText}</span>`;
                    
                    const dt = inv.invoice_date ? inv.invoice_date.split('T')[0] : '';
                    
                    dashInvoices.innerHTML += `<tr style="border-bottom: 1px solid #f8fafc;">
                        <td style="padding: 12px 0; font-weight: 600; color:#1e293b;">${inv.invoice_no}</td>
                        <td style="padding: 12px 0; color:#475569;">${inv.customer_name || 'غير مسجل'}</td>
                        <td style="padding: 12px 0; font-weight: 700; color:#1e293b;">${formatMoney(inv.grand_total)} ج.م</td>
                        <td style="padding: 12px 0; text-align:center;">${badge}</td>
                        <td style="padding: 12px 0; color:#64748b; font-size:0.85rem;">${dt}</td>
                        <td style="padding: 12px 0; text-align:left; color:#cbd5e1;"><i class="fa-regular fa-file-lines"></i></td>
                    </tr>`;
                });
                if(recent.invoices.length === 0) dashInvoices.innerHTML = '<tr><td colspan="6" class="text-center" style="padding:20px;color:#888;">لا توجد فواتير</td></tr>';
            }
        }

        const topRes = await window.API.request('/dashboard/top');
        if (topRes && topRes.data) {
            const topCustomers = document.getElementById('dash-top-customers');
            if (topCustomers) {
                topCustomers.innerHTML = '';
                topRes.data.customers.forEach((c, idx) => {
                    const badgeColor = idx === 0 ? '#fbbf24' : (idx === 1 ? '#94a3b8' : '#f87171');
                    topCustomers.innerHTML += `<li style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid #f1f5f9;">
                        <div style="display:flex; align-items:center; gap:10px;">
                            <span style="font-size:1.1rem; color:${badgeColor}"><i class="fa-solid fa-medal"></i></span>
                            <span style="font-weight:600; color:#1e293b; font-size:0.9rem;">${c.customer_name}</span>
                        </div>
                        <strong style="color:#64748b; font-size:0.85rem;">${formatMoney(c.total_sales)} ج.م</strong>
                    </li>`;
                });
            }

            const topProducts = document.getElementById('dash-top-products');
            if (topProducts) {
                topProducts.innerHTML = '';
                topRes.data.products.forEach(p => {
                    topProducts.innerHTML += `<li style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid #f1f5f9;">
                        <div style="display:flex; align-items:center; gap:10px;">
                            <span style="color:#3b82f6; background:#eff6ff; padding:5px; border-radius:6px;"><i class="fa-solid fa-box"></i></span>
                            <span style="font-weight:600; color:#1e293b; font-size:0.9rem;">${p.product_name}</span>
                        </div>
                        <span style="color:#64748b; font-size:0.85rem; font-weight:600;">${p.total_qty} وحدة</span>
                    </li>`;
                });
            }
        }

        // Render Chart
        const chartRes = await window.API.request('/dashboard/chart/sales?days=7');
        if (chartRes && chartRes.data) {
            const ctx = document.getElementById('salesChart');
            if (ctx && window.Chart) {
                if (salesChartInstance) salesChartInstance.destroy();
                
                let totalSales = 0;
                const labels = chartRes.data.map(d => {
                    totalSales += parseFloat(d.total);
                    const dt = new Date(d.date);
                    return dt.getDate() + ' ' + dt.toLocaleString('ar-EG', {month:'short'});
                });
                const data = chartRes.data.map(d => parseFloat(d.total));
                
                document.getElementById('chart-total-sales').innerHTML =formatMoney(totalSales) + ' ج.م';
                document.getElementById('chart-avg-sales').innerHTML = formatMoney(totalSales / (chartRes.data.length || 1)) + ' ج.م';

                salesChartInstance = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: 'المبيعات',
                            data: data,
                            borderColor: '#8b5cf6',
                            backgroundColor: 'rgba(139, 92, 246, 0.1)',
                            borderWidth: 3,
                            fill: true,
                            tension: 0.4,
                            pointBackgroundColor: '#fff',
                            pointBorderColor: '#8b5cf6',
                            pointBorderWidth: 2,
                            pointRadius: 4,
                            pointHoverRadius: 6
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: false }
                        },
                        scales: {
                            y: { beginAtZero: true, grid: { borderDash: [5, 5] }, ticks: { font: { family: 'Cairo' } } },
                            x: { grid: { display: false }, ticks: { font: { family: 'Cairo' } } }
                        }
                    }
                });
            }
        }

    } catch (e) {
        console.error("Dashboard Load Error", e);
    }
};
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => { if (typeof window.loadDashboard === 'function') window.loadDashboard(); }, 600);
});








// ============================================================
// CENTRAL NAVIGATION — opens any view by targetId
// ============================================================
window.navigateTo = function(targetId) {
  if (!targetId) return;
  // First try clicking the nav item (triggers full view setup)
  const navItem = document.querySelector('.nav-item[data-target="' + targetId + '"]');
  if (navItem) {
    navItem.click();
    return;
  }
  // Fallback: manually show the view
  const view = document.getElementById('view-' + targetId);
  if (view) {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => {
      v.classList.remove('active-view');
      v.style.display = 'none';
    });
    view.dataset.bound = '';
    view.style.display = '';
    view.classList.add('active-view');
    localStorage.setItem('activeView', targetId);
  }
};

// ============================================================
// PAGE NAVIGATION INDEX (Smart Search: /page_name)
// ============================================================
const PAGE_INDEX = [
  { id: 'dashboard', label: 'لوحة القيادة', icon: 'fa-chart-pie', keywords: 'dashboard لوحة القيادة' },
  { id: 'sales-invoice', label: 'فاتورة بيع', icon: 'fa-file-invoice', keywords: 'فاتورة بيع sales invoice مبيعات' },
  { id: 'sales-return', label: 'مرتجع بيع', icon: 'fa-undo', keywords: 'مرتجع بيع sales return' },
  { id: 'sales-credit', label: 'اشعار دائن', icon: 'fa-file-invoice', keywords: 'اشعار دائن credit' },
  { id: 'purchase-invoice', label: 'فاتورة شراء', icon: 'fa-file-invoice', keywords: 'فاتورة شراء purchase invoice مشتريات' },
  { id: 'purchase-return', label: 'مرتجع شراء', icon: 'fa-undo', keywords: 'مرتجع شراء purchase return' },
  { id: 'customers', label: 'العملاء', icon: 'fa-users', keywords: 'عملاء customers' },
  { id: 'suppliers', label: 'الموردين', icon: 'fa-truck', keywords: 'موردين suppliers' },
  { id: 'products', label: 'الأصناف', icon: 'fa-cube', keywords: 'اصناف products' },
  { id: 'stores-management', label: 'المخازن', icon: 'fa-warehouse', keywords: 'مخازن stores' },
  { id: 'treasury', label: 'الخزينة', icon: 'fa-wallet', keywords: 'خزينة treasury' },
  { id: 'accounting', label: 'قيد اليومية', icon: 'fa-book', keywords: 'قيود محاسبة accounting' },
  { id: 'chart-of-accounts', label: 'شجرة الحسابات', icon: 'fa-sitemap', keywords: 'حسابات شجرة coa' },
  { id: 'settings', label: 'الإعدادات', icon: 'fa-gear', keywords: 'اعدادات settings' },
  { id: 'collections', label: 'تحصيلات العملاء', icon: 'fa-hand-holding-dollar', keywords: 'تحصيلات collections' },
  { id: 'supplier-payments', label: 'مدفوعات الموردين', icon: 'fa-credit-card', keywords: 'مدفوعات suppliers payments' },
  { id: 'aging', label: 'اجال العملاء', icon: 'fa-clock', keywords: 'اجال تقادم aging' },
  { id: 'inventory', label: 'المخزون', icon: 'fa-clipboard-list', keywords: 'مخزون inventory جرد' },
  { id: 'inventory-transfers', label: 'تحويلات مخزنية', icon: 'fa-arrows-left-right', keywords: 'تحويلات مخزنية transfers' },
  { id: 'inventory-card', label: 'بطاقة صنف', icon: 'fa-clipboard', keywords: 'بطاقة صنف inventory card' },
  { id: 'stock-count', label: 'جرد المخزون', icon: 'fa-calculator', keywords: 'جرد stock count' },
  { id: 'stock-adjust', label: 'تسوية المخزون', icon: 'fa-scale-balanced', keywords: 'تسوية adjust' },
  { id: 'reports-sales', label: 'تقارير المبيعات', icon: 'fa-chart-bar', keywords: 'تقارير مبيعات reports sales' },
  { id: 'reports-purchases', label: 'تقارير المشتريات', icon: 'fa-chart-bar', keywords: 'تقارير مشتريات reports purchases' },
  { id: 'reports-inventory', label: 'تقارير المخزون', icon: 'fa-chart-bar', keywords: 'تقارير مخزون reports inventory' },
  { id: 'activity-logs', label: 'سجل الحركات', icon: 'fa-list-check', keywords: 'سجل حركات logs audit' },
  { id: 'license', label: 'إدارة الترخيص', icon: 'fa-key', keywords: 'ترخيص license' },
  { id: 'supplier-statement', label: 'كشف حساب مورد', icon: 'fa-file-lines', keywords: 'كشف حساب مورد supplier statement' },
  { id: 'crm-workplan', label: 'CRM خطة العمل', icon: 'fa-calendar-check', keywords: 'crm علاقات عملاء' },
  { id: 'fiscal-periods', label: 'الفترات المالية', icon: 'fa-calendar', keywords: 'فترات مالية fiscal periods' },
  { id: 'fixed-assets', label: 'الأصول الثابتة', icon: 'fa-building', keywords: 'اصول ثابتة fixed assets' },
  { id: 'hr', label: 'الموارد البشرية', icon: 'fa-users-gear', keywords: 'موارد بشرية hr' },
  { id: 'payroll', label: 'الرواتب', icon: 'fa-money-bill', keywords: 'رواتب payroll' },
];

// ============================================================
// GLOBAL SEARCH + HEADER DROPDOWNS
// ============================================================

// ─── Clock Update ───
function updateClock() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateEl = document.getElementById('header-date-text');
  const timeEl = document.getElementById('header-time-text');
  if (dateEl) dateEl.textContent = dateStr;
  if (timeEl) timeEl.textContent = timeStr;
}
setInterval(updateClock, 1000);
updateClock();

// ─── User Menu Dropdown ───
window.toggleUserMenu = function(e) {
  e.stopPropagation();
  const menu = document.querySelector('.user-menu-dropdown');
  if (!menu) return;
  closeAllHeaderDropdowns();
  menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
};

// ─── Notification Dropdown ───
window.toggleNotifDropdown = function(e) {
  e.stopPropagation();
  const dd = document.getElementById('notif-dropdown');
  if (!dd) return;
  closeAllHeaderDropdowns();
  dd.style.display = dd.style.display === 'block' ? 'none' : 'block';
  if (dd.style.display === 'block') fetchNotifications();
};

// ─── Support Dropdown ───
window.toggleSupportDropdown = function(e) {
  e.stopPropagation();
  const dd = document.getElementById('support-dropdown');
  if (!dd) return;
  closeAllHeaderDropdowns();
  dd.style.display = dd.style.display === 'block' ? 'none' : 'block';
};

// ─── Close all header dropdowns ───
window.closeAllHeaderDropdowns = function() {
  document.querySelectorAll('.user-menu-dropdown, #notif-dropdown, #support-dropdown').forEach(el => {
    if (el) el.style.display = 'none';
  });
};

document.addEventListener('click', closeAllHeaderDropdowns);
document.querySelector('.user-menu-dropdown')?.addEventListener('click', e => e.stopPropagation());
document.getElementById('notif-dropdown')?.addEventListener('click', e => e.stopPropagation());
document.getElementById('support-dropdown')?.addEventListener('click', e => e.stopPropagation());

// ─── Fetch Notifications ───
async function fetchNotifications() {
  try {
    const res = await fetch('/api/notifications', {
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('auth_token') }
    });
    // Handle non-JSON response gracefully
    let data;
    try { data = await res.json(); } catch (e) { data = { success: false }; }
    
    if (!data.success) {
      const list = document.getElementById('notif-list');
      if (list) list.innerHTML = '<div style="padding:20px; text-align:center; color:#94a3b8; font-size:0.8rem;">لا توجد إشعارات حالياً</div>';
      return;
    }
    
    const list = document.getElementById('notif-list');
    if (!list) return;
    const badge = document.getElementById('notif-badge-count');
    if (badge) {
      if (data.unread > 0) {
        badge.style.display = 'flex';
        badge.textContent = data.unread;
      } else {
        badge.style.display = 'none';
      }
    }
    if (!data.data || data.data.length === 0) {
      list.innerHTML = '<div style="padding:20px; text-align:center; color:#94a3b8; font-size:0.8rem;">لا توجد إشعارات حالياً</div>';
      return;
    }
    let html = '';
    data.data.forEach(n => {
      const bg = n.is_read ? '' : 'background:#eef2ff;';
      const dot = n.is_read ? '' : '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#4f46e5;margin-left:6px;flex-shrink:0;"></span>';
      const icons = { success: 'fa-circle-check', warning: 'fa-triangle-exclamation', error: 'fa-circle-xmark', info: 'fa-circle-info' };
      const icon = icons[n.type] || 'fa-circle-info';
      // Navigate to module on click if module is set
      const navAttr = n.module ? `window.navigateTo('${n.module}');` : '';
      html += `<div style="display:flex;align-items:flex-start;gap:10px;padding:12px 16px;border-bottom:1px solid #f1f5f9;cursor:pointer;${bg}transition:background 0.15s;" onclick="markNotifRead(${n.id}, this, '${n.module || ''}')" onmouseover="this.style.background='${n.is_read ? '#f8fafc' : '#e0e7ff'}'" onmouseout="this.style.background=''">
        <i class="fa-regular ${icon}" style="color:#4f46e5;font-size:1rem;margin-top:2px;"></i>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:0.8rem;color:#1e293b;display:flex;align-items:center;gap:4px;">${dot}${n.title}</div>
          <div style="font-size:0.75rem;color:#64748b;margin-top:2px;">${n.message || ''}</div>
          <div style="font-size:0.65rem;color:#94a3b8;margin-top:4px;">${n.created_at || ''}</div>
        </div>
      </div>`;
    });
    list.innerHTML = html;
  } catch (e) {
    const list = document.getElementById('notif-list');
    if (list) list.innerHTML = '<div style="padding:20px; text-align:center; color:#94a3b8; font-size:0.8rem;">لا توجد إشعارات حالياً</div>';
  }
}

window.markNotifRead = async function(id, el, module) {
  try {
    await fetch('/api/notifications/' + id + '/read', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('auth_token'), 'Content-Type': 'application/json' }
    });
    el.style.background = '';
    const dot = el.querySelector('span');
    if (dot) dot.style.display = 'none';
    // Navigate to module if specified
    if (module) { window.navigateTo(module); }
    // Update badge count after marking as read
    fetchNotifications();
  } catch (e) {}
};

window.markAllNotifRead = async function() {
  try {
    await fetch('/api/notifications/read-all', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('auth_token'), 'Content-Type': 'application/json' }
    });
    fetchNotifications();
  } catch (e) {}
};

// Poll notifications every 60s
setInterval(fetchNotifications, 60000);

// ─── Avatar Settings ───
window.openAvatarSettings = function() {
  closeAllHeaderDropdowns();
  const existing = document.getElementById('avatar-settings-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'avatar-settings-modal';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);z-index:9999;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:24px;width:380px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.2);direction:rtl;text-align:right;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h3 style="font-size:1.1rem;font-weight:800;color:#1e293b;margin:0;">الصورة الشخصية</h3>
        <button onclick="this.closest('#avatar-settings-modal').remove()" style="background:none;border:none;font-size:1.2rem;cursor:pointer;color:#94a3b8;">×</button>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:16px;">
        <div style="position:relative;">
          <img id="avatar-preview" src="https://ui-avatars.com/api/?name=%D9%85&background=4f46e5&color=fff&rounded=true&font-size=0.5" style="width:100px;height:100px;border-radius:50%;object-fit:cover;border:3px solid #e2e8f0;">
        </div>
        <input type="file" id="avatar-file-input" accept="image/*" style="display:none;" onchange="handleAvatarFile(this)">
        <button onclick="document.getElementById('avatar-file-input').click()" style="background:#4f46e5;color:#fff;border:none;padding:8px 20px;border-radius:8px;font-weight:600;cursor:pointer;font-size:0.85rem;">اختيار صورة</button>
        <button id="btn-remove-avatar" onclick="removeAvatar()" style="background:#fef2f2;color:#ef4444;border:1px solid #fecaca;padding:8px 20px;border-radius:8px;font-weight:600;cursor:pointer;font-size:0.85rem;">حذف الصورة</button>
        <div id="avatar-status" style="font-size:0.8rem;color:#64748b;"></div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  loadCurrentAvatar();
};

async function loadCurrentAvatar() {
  const preview = document.getElementById('avatar-preview');
  if (!preview) return;
  try {
    const user = currentUser || JSON.parse(localStorage.getItem('auth_user') || '{}');
    if (user.avatar) {
      preview.src = user.avatar;
    } else {
      const name = user.full_name || user.name || user.username || 'مستخدم';
      const char = encodeURIComponent(name.charAt(0) || 'م');
      preview.src = 'https://ui-avatars.com/api/?name=' + char + '&background=4f46e5&color=fff&rounded=true&font-size=0.5';
    }
  } catch (e) {}
}

async function apiFetch(url, method, body) {
  const token = localStorage.getItem('auth_token');
  const tenant = new URLSearchParams(window.location.search).get('tenant');
  const headers = { 'Authorization': token ? 'Bearer ' + token : '' };
  if (tenant) headers['x-tenant-id'] = tenant;
  const opts = { method, headers };
  if (body) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(url, opts);
  let data;
  try { data = await res.json(); } catch (e) { data = { success: false, message: 'استجابة غير صالحة' }; }
  if (!data.success) throw new Error(data.message || 'خطأ');
  return data;
}

window.handleAvatarFile = async function(input) {
  const file = input.files[0];
  if (!file) return;
  const status = document.getElementById('avatar-status');
  if (status) { status.style.color = '#64748b'; status.textContent = 'جاري الرفع...'; }

  const reader = new FileReader();
  reader.onload = async function(e) {
    const base64 = e.target.result;
    try {
      await apiFetch('/api/users/avatar', 'POST', { avatar: base64 });
      const preview = document.getElementById('avatar-preview');
      if (preview) preview.src = base64;
      const headerAvatar = document.getElementById('header-user-avatar');
      if (headerAvatar) headerAvatar.src = base64;
      if (currentUser) {
        currentUser.avatar = base64;
        localStorage.setItem('auth_user', JSON.stringify(currentUser));
      }
      if (status) { status.style.color = '#10b981'; status.textContent = '✓ تم حفظ الصورة'; }
    } catch (err) {
      if (status) { status.style.color = '#ef4444'; status.textContent = '✗ فشل الحفظ: ' + err.message; }
    }
  };
  reader.readAsDataURL(file);
};

window.removeAvatar = async function() {
  const status = document.getElementById('avatar-status');
  if (status) { status.style.color = '#64748b'; status.textContent = 'جاري الحذف...'; }
  try {
    await apiFetch('/api/users/avatar', 'DELETE');
    const preview = document.getElementById('avatar-preview');
    const userName = currentUser ? (currentUser.full_name || currentUser.name || currentUser.username || 'مستخدم') : 'مستخدم';
    const initial = encodeURIComponent(userName.charAt(0));
    const fallback = 'https://ui-avatars.com/api/?name=' + initial + '&background=4f46e5&color=fff&rounded=true&font-size=0.5';
    if (preview) preview.src = fallback;
    const headerAvatar = document.getElementById('header-user-avatar');
    if (headerAvatar) headerAvatar.src = fallback;
    if (currentUser) {
      currentUser.avatar = null;
      localStorage.setItem('auth_user', JSON.stringify(currentUser));
    }
    if (status) { status.style.color = '#10b981'; status.textContent = '✓ تم حذف الصورة'; }
  } catch (err) {
    if (status) { status.style.color = '#ef4444'; status.textContent = '✗ فشل الحذف: ' + err.message; }
  }
};

// ─── Global Search (Data + Page Navigation) ───
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'k') {
        e.preventDefault();
        const searchInput = document.getElementById('global-search-input');
        if (searchInput) searchInput.focus();
    }
});

const globalSearchInput = document.getElementById('global-search-input');
const globalSearchResults = document.getElementById('global-search-results');
const searchResultsContent = document.getElementById('search-results-content');
let searchTimeout = null;

if (globalSearchInput) {
    globalSearchInput.addEventListener('input', (e) => {
        const q = e.target.value.trim();
        if (q.length === 0) {
            globalSearchResults.style.display = 'none';
            return;
        }

        globalSearchResults.style.display = 'block';
        searchResultsContent.innerHTML = 'جاري البحث...';

        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(async () => {
            const qLower = q.toLowerCase();

            // Check for page navigation (if starts with / or matches page name)
            const pageResults = PAGE_INDEX.filter(p =>
              qLower.startsWith('/')
                ? p.id.includes(qLower.slice(1)) || p.label.includes(q.slice(1)) || p.keywords.includes(qLower.slice(1))
                : p.keywords.includes(qLower) || p.id.includes(qLower) || p.label.includes(q)
            ).slice(0, 5);

            let html = '';

            if (pageResults.length > 0) {
              html += '<div style="padding:8px 15px; background:#f8fafc; font-weight:700; font-size:0.78rem; color:#64748b;"><i class="fa-solid fa-arrow-right-arrow-left" style="margin-left:4px;"></i> التنقل السريع</div>';
              pageResults.forEach(p => {
                html += `<div style="padding:8px 15px; border-bottom:1px solid #f1f5f9; cursor:pointer; display:flex; align-items:center; gap:10px; transition:background 0.15s;" onclick="window.navigateTo('${p.id}'); document.getElementById('global-search-results').style.display='none';" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
                  <i class="fa-solid ${p.icon}" style="width:16px;color:#4f46e5;font-size:0.85rem;"></i>
                  <span style="font-weight:600; color:#1e293b; font-size:0.85rem;">${p.label}</span>
                </div>`;
              });
            }

            try {
                const res = await window.API.request('/dashboard/search?q=' + encodeURIComponent(q));
                if (res && res.data) {
                    const data = res.data;
                    const hasData = data.invoices?.length > 0 || data.customers?.length > 0 || data.products?.length > 0;
                    
                    if (!hasData && pageResults.length === 0) {
                      searchResultsContent.innerHTML = '<div style="padding:15px; text-align:center; color:#64748b; font-size:0.85rem;">لا توجد نتائج مطابقة</div>';
                      return;
                    }
                    
                    if (data.invoices?.length > 0) {
                        html += '<div style="padding:8px 15px; background:#f8fafc; font-weight:700; font-size:0.78rem; color:#64748b; border-top:' + (pageResults.length ? '1px solid #e2e8f0' : 'none') + ';">الفواتير</div>';
                        data.invoices.forEach(inv => {
                            html += `<div style="padding:8px 15px; border-bottom:1px solid #f1f5f9; cursor:pointer; transition:background 0.15s;" onclick="window.navigateTo('sales-invoice'); document.getElementById('global-search-results').style.display='none';" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
                                <div style="font-weight:600; font-size:0.85rem; color:#1e293b;">${inv.invoice_no}</div>
                                <div style="font-size:0.75rem; color:#64748b;">${inv.name || 'عميل نقدي'} - ${formatMoney(inv.grand_total)} ج.م</div>
                            </div>`;
                        });
                    }

                    if (data.customers?.length > 0) {
                        html += '<div style="padding:8px 15px; background:#f8fafc; font-weight:700; font-size:0.78rem; color:#64748b;">العملاء</div>';
                        data.customers.forEach(c => {
                            html += `<div style="padding:8px 15px; border-bottom:1px solid #f1f5f9; cursor:pointer; transition:background 0.15s;" onclick="window.navigateTo('customers'); document.getElementById('global-search-results').style.display='none';" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
                                <div style="font-weight:600; font-size:0.85rem; color:#1e293b;">${c.name}</div>
                                <div style="font-size:0.75rem; color:#64748b;">${c.code}</div>
                            </div>`;
                        });
                    }

                    if (data.products?.length > 0) {
                        html += '<div style="padding:8px 15px; background:#f8fafc; font-weight:700; font-size:0.78rem; color:#64748b;">الأصناف</div>';
                        data.products.forEach(p => {
                            html += `<div style="padding:8px 15px; border-bottom:1px solid #f1f5f9; cursor:pointer; transition:background 0.15s;" onclick="window.navigateTo('products'); document.getElementById('global-search-results').style.display='none';" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
                                <div style="font-weight:600; font-size:0.85rem; color:#1e293b;">${p.name}</div>
                                <div style="font-size:0.75rem; color:#64748b;">${p.code}</div>
                            </div>`;
                        });
                    }
                    
                    searchResultsContent.innerHTML = html;
                } else if (pageResults.length === 0) {
                    searchResultsContent.innerHTML = '<div style="padding:15px; text-align:center; color:#64748b; font-size:0.85rem;">لا توجد نتائج مطابقة</div>';
                }
            } catch (err) {
                if (pageResults.length > 0) {
                  searchResultsContent.innerHTML = html;
                } else {
                  searchResultsContent.innerHTML = '<div style="padding:15px; text-align:center; color:#64748b;">حدث خطأ أثناء البحث</div>';
                }
            }
        }, 500);
    });

    // Close on click outside
    document.addEventListener('click', (e) => {
        if (!globalSearchInput.contains(e.target) && !globalSearchResults.contains(e.target)) {
            globalSearchResults.style.display = 'none';
        }
    });
}


// ============================================================
// AUTHENTICATION LOGIC
// ============================================================
let currentUser = null;

window.showLogin = function() {
    // Always hide the loader first
    const loader = document.getElementById('global-loader');
    if (loader) loader.classList.add('hidden');
    document.getElementById('login-overlay').style.display = 'flex';
    document.getElementById('app').style.display = 'none';

    // Load saved credentials if Remember Me was checked
    const savedEmail = localStorage.getItem('remember_email');
    const savedPassword = localStorage.getItem('remember_password');
    const rememberMe = localStorage.getItem('remember_me');
    const emailField = document.getElementById('login-email');
    const passField = document.getElementById('login-password');
    const rememberCheckbox = document.getElementById('remember-me');
    if (rememberMe === 'true' && savedEmail && savedPassword) {
        if (emailField) emailField.value = savedEmail;
        if (passField) passField.value = savedPassword;
        if (rememberCheckbox) rememberCheckbox.checked = true;
    } else {
        if (emailField) emailField.value = '';
        if (passField) passField.value = '';
        if (rememberCheckbox) rememberCheckbox.checked = false;
    }
};

function getActiveUser() {
    if (currentUser) return currentUser;
    try {
        const stored = localStorage.getItem('auth_user');
        if (stored) return JSON.parse(stored);
    } catch (e) {}
    return null;
}

function isAdminUser(user) {
    if (!user) return false;
    if (user.role === 'admin') return true;
    const perms = user.permissions || [];
    return perms.includes('*');
}

function hasPerm(permId) {
    const user = getActiveUser();
    if (!user) return false;
    if (user.role === 'admin') return true;
    const perms = user.permissions || [];
    return perms.includes('*') || perms.includes(permId);
}

function updateAdminOnlyVisibility() {
    const adminElements = document.querySelectorAll('.admin-only');
    adminElements.forEach(el => {
        el.style.display = isAdminUser(getActiveUser()) ? '' : 'none';
    });
}

function restoreSavedView() {
    let savedView = localStorage.getItem('activeView');
    if (!savedView) return;
    // Redirect old dashboard to executive-dashboard
    if (savedView === 'dashboard') {
        savedView = 'executive-dashboard';
        localStorage.setItem('activeView', savedView);
    }
    // Try nav-item first (direct sidebar links)
    const savedNavItem = document.querySelector(`.nav-item[data-target="${savedView}"]`);
    if (savedNavItem) {
        savedNavItem.click();
        const group = savedNavItem.closest('.nav-group');
        if (group && !group.classList.contains('open')) {
            group.classList.add('open');
        }
        return;
    }
    // Fallback: popup-item navigation
    const savedPopupItem = document.querySelector(`.popup-item[data-target="${savedView}"]`);
    if (savedPopupItem && typeof window.showView === 'function') {
        window.showView(savedView);
    }
}

window.showApp = function() {
    // Always hide the loader first
    const loader = document.getElementById('global-loader');
    if (loader) loader.classList.add('hidden');
    document.getElementById('login-overlay').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    updateAdminOnlyVisibility();
    // استعادة الشاشة المحفوظة أولاً — لو موجودة، applyPermissions لن تعيد التوجيه للـ dashboard
    restoreSavedView();
    applyPermissions();
};

window.handleLogin = async function() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    const submitBtn = document.getElementById('login-submit-btn');
    const btnText = document.getElementById('login-btn-text');

    if (!email || !password) {
        errorEl.textContent = 'الرجاء إدخال البريد وكلمة المرور';
        errorEl.style.display = 'block';
        return;
    }

    if (submitBtn) submitBtn.disabled = true;
    if (btnText) btnText.textContent = 'جاري الدخول...';
    errorEl.style.display = 'none';

    try {
        const res = await window.API.login(email, password);
        localStorage.setItem('auth_token', res.token);
        localStorage.setItem('auth_user', JSON.stringify(res.user));
        currentUser = res.user;
        
        updateAdminOnlyVisibility();
        
        if (typeof window.initDataFromServer === 'function') {
            await window.initDataFromServer();
        }
        
        // Load company settings (customer data) for sidebar and title
        try {
            const settingsRes = await fetch('/api/settings/company', { headers: { 'Authorization': 'Bearer ' + localStorage.getItem('auth_token') } });
            const settingsData = await settingsRes.json();
            if (settingsData.success && settingsData.data) {
                const d = settingsData.data;
                const companyName = d.name || d.name_en || '';
                document.title = companyName ? companyName + ' - 3SM Company' : '3SM Company';
                if (document.getElementById('sidebar-company-name')) {
                    document.getElementById('sidebar-company-name').textContent = companyName || '3SM Company';
                }
                if (document.getElementById('sidebar-company-sub')) {
                    document.getElementById('sidebar-company-sub').textContent = d.name_en || companyName || 'ERP System';
                }
                if (d.logo && document.getElementById('sidebar-logo-img')) {
                    document.getElementById('sidebar-logo-img').src = d.logo;
                }
                // Do NOT touch login-footer-phone or login-footer-email — those are system branding
            }
        } catch (e) {}
        
        if (currentUser) {
            const name = currentUser.full_name || currentUser.name || currentUser.username || currentUser.email;
            const role = currentUser.role === 'admin' ? 'مدير النظام' : 'مستخدم';
            const nameEl = document.getElementById('header-user-name');
            const roleEl = document.getElementById('header-user-role');
            const nameDd = document.getElementById('header-user-name-dd');
            const roleDd = document.getElementById('header-user-role-dd');
            if (nameEl) nameEl.textContent = name;
            if (roleEl) roleEl.textContent = role;
            if (nameDd) nameDd.textContent = name;
            if (roleDd) roleDd.textContent = role;
            const avatarEl = document.getElementById('header-user-avatar');
            if (currentUser.avatar) {
              if (avatarEl) avatarEl.src = currentUser.avatar;
            } else {
              const initial = encodeURIComponent((name || 'م').charAt(0));
              if (avatarEl) avatarEl.src = 'https://ui-avatars.com/api/?name=' + initial + '&background=4f46e5&color=fff&rounded=true&font-size=0.5';
            }
        }

        // Check license state after login
        try {
            const licRes = await window.API.getLicenseStatus();
            const licData = licRes.data || licRes;
            if (licData.state === 'UNACTIVATED' || licData.state === 'EXPIRED' || licData.state === 'INVALID' || licData.state === 'TAMPERED') {
                showLicenseActivation(licData);
                return;
            }
        } catch (e) {}

        showApp();

        // Remember Me: save or clear credentials
        const rememberCheckbox = document.getElementById('remember-me');
        if (rememberCheckbox && rememberCheckbox.checked) {
            localStorage.setItem('remember_email', email);
            localStorage.setItem('remember_password', password);
            localStorage.setItem('remember_me', 'true');
        } else {
            localStorage.removeItem('remember_email');
            localStorage.removeItem('remember_password');
            localStorage.removeItem('remember_me');
        }
    } catch (err) {
        errorEl.textContent = err.message || 'بيانات الدخول غير صحيحة';
        errorEl.style.display = 'block';
    } finally {
        if (submitBtn) submitBtn.disabled = false;
        if (btnText) btnText.textContent = 'تسجيل الدخول';
    }
};

document.getElementById('login-form')?.addEventListener('submit', function(e) {
    e.preventDefault();
    window.handleLogin();
});

// Forgot Password: show dialog with instructions
document.getElementById('forgot-password-link')?.addEventListener('click', function(e) {
    e.preventDefault();
    if (typeof showAlert === 'function') {
        showAlert(
            'إذا كنت مستخدمًا داخل الشركة، يرجى التواصل مع مسؤول النظام (Admin) لإعادة تعيين كلمة المرور.\n\nأما إذا كنت مسؤول النظام (Admin)، فيرجى التواصل مع مطور البرنامج:\n\nد. محمد مصطفى عياد\n\nليتم إعادة تعيين كلمة المرور.',
            { title: 'نسيت كلمة المرور', type: 'info', infoText: false, confirmText: 'حسناً' }
        );
    }
});

// Remember Me: clear saved credentials when checkbox is unchecked
document.getElementById('remember-me')?.addEventListener('change', function() {
    if (!this.checked) {
        localStorage.removeItem('remember_email');
        localStorage.removeItem('remember_password');
        localStorage.removeItem('remember_me');
    }
});

window.logout = async function() {
    try { await fetch('/api/logs/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + localStorage.getItem('auth_token') } }); } catch (e) {}
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    localStorage.removeItem('remember_email');
    localStorage.removeItem('remember_password');
    localStorage.removeItem('remember_me');
    currentUser = null;
    showLogin();
};

window.checkAuth = async function() {
    console.log('[TRACE] checkAuth: ENTRY');
    const token = localStorage.getItem('auth_token');
    if (!token) {
        showLogin();
        return;
    }
    
    try {
        const res = await window.API.getMe();
        currentUser = res.user;
        localStorage.setItem('auth_user', JSON.stringify(currentUser));
        
        // Update header profile
        if (currentUser) {
            const name = currentUser.full_name || currentUser.name || currentUser.username || currentUser.email;
            const role = currentUser.role === 'admin' ? 'مدير النظام' : 'مستخدم';
            const nameEl = document.getElementById('header-user-name');
            const roleEl = document.getElementById('header-user-role');
            const nameDd = document.getElementById('header-user-name-dd');
            const roleDd = document.getElementById('header-user-role-dd');
            if (nameEl) nameEl.textContent = name;
            if (roleEl) roleEl.textContent = role;
            if (nameDd) nameDd.textContent = name;
            if (roleDd) roleDd.textContent = role;
            const avatarEl = document.getElementById('header-user-avatar');
            if (currentUser.avatar) {
              if (avatarEl) avatarEl.src = currentUser.avatar;
            } else {
              const initial = encodeURIComponent((name || 'م').charAt(0));
              if (avatarEl) avatarEl.src = 'https://ui-avatars.com/api/?name=' + initial + '&background=4f46e5&color=fff&rounded=true&font-size=0.5';
            }
        }

        // Check license state
        try {
            const licRes = await window.API.getLicenseStatus();
            const licData = licRes.data || licRes;
            if (licData.state === 'UNACTIVATED' || licData.state === 'EXPIRED' || licData.state === 'INVALID' || licData.state === 'TAMPERED') {
                showLicenseActivation(licData);
                return;
            }
        } catch (e) {}

        if (typeof window.initDataFromServer === 'function') {
            console.log('[TRACE] checkAuth: calling initDataFromServer...');
            await window.initDataFromServer();
            console.log('[TRACE] checkAuth: initDataFromServer completed');
        }

        console.log('[TRACE] checkAuth: calling showApp...');
        showApp();
    } catch (err) {
        console.error("Auth check failed", err);
        showLogin();
    }
};

function applyPermissions() {
    const user = getActiveUser();
    if (!user) return;
    const perms = user.permissions || [];
    const isAdmin = user.role === 'admin' || perms.includes('*');
    
    // Hide all nav items first if not admin
    if (!isAdmin) {
        document.querySelectorAll('.nav-item[data-target]').forEach(el => {
            const target = el.getAttribute('data-target');
            if (perms.includes(target)) {
                el.style.display = 'flex';
            } else {
                el.style.display = 'none';
            }
        });
        
        // Hide empty groups
        document.querySelectorAll('.nav-group').forEach(group => {
            const visibleItems = group.querySelectorAll('.nav-item[data-target][style*="display: flex"]');
            if (visibleItems.length === 0) {
                group.style.display = 'none';
            } else {
                group.style.display = 'block';
            }
        });
    } else {
        // Show everything
        document.querySelectorAll('.nav-item').forEach(el => el.style.display = 'flex');
        document.querySelectorAll('.nav-group').forEach(el => el.style.display = 'block');
    }
    
    // Default redirect to dashboard if allowed (unless a saved view exists)
    const savedView = localStorage.getItem('activeView');
    if (savedView && document.querySelector(`[data-target="${savedView}"]`)) {
        return;
    }
    const target = (isAdmin || perms.includes('dashboard')) ? 'dashboard' : (perms[0] || 'dashboard');
    if (document.querySelector(`[data-target="${target}"]`)) {
        document.querySelector(`[data-target="${target}"]`).click();
    }
}

// Intercept nav clicks to check permissions
const originalClick = document.onclick;
document.addEventListener('click', (e) => {
    const navItem = e.target.closest('.nav-item[data-target]');
    if (navItem && currentUser) {
        const targetId = navItem.getAttribute('data-target');
        const perms = currentUser.permissions || [];
        const isAdmin = currentUser.role === 'admin' || perms.includes('*');
        
        // Reset editing state if navigating away
        if (targetId !== 'sales-invoice') {
            window.editingInvoiceId = null;
        }

        if (!isAdmin && !perms.includes(targetId) && !(isAdminUser(getActiveUser()) && targetId === 'activity-logs')) {
            e.preventDefault();
            e.stopPropagation();
            alert('ليس لديك صلاحية للدخول إلى هذه الشاشة');
            return;
        }
    }
}, true); // Use capture phase to intercept



// ============================================================
// USERS MANAGEMENT LOGIC
// ============================================================
const availableScreens = [
    { id: 'dashboard', name: 'لوحة التحكم الرئيسية' },
    { id: 'executive-dashboard', name: 'لوحة القيادة التنفيذية (BI)' },
    { id: 'cash-flow', name: 'التدفقات النقدية (BI)' },
    { id: 'aging', name: 'أعمار الديون (BI)' },
    { id: 'inventory-analytics', name: 'تحليلات المخزون (BI)' },
    { id: 'profitability', name: 'تحليل الربحية (BI)' },
    { id: 'sales-invoices', name: 'فواتير المبيعات' },
    { id: 'sales-returns', name: 'مرتجعات المبيعات' },
    { id: 'customers', name: 'قائمة العملاء (دخول للشاشة)' },
    { id: 'customers.create', name: 'العملاء - إضافة' },
    { id: 'customers.update', name: 'العملاء - تعديل' },
    { id: 'customers.delete', name: 'العملاء - حذف' },
    { id: 'customers.export', name: 'العملاء - تصدير' },
    { id: 'customers.block', name: 'العملاء - حظر/إلغاء حظر' },
    { id: 'customer-payments', name: 'مقبوضات العملاء' },
    { id: 'purchase-invoices', name: 'فواتير المشتريات' },
    { id: 'purchase-returns', name: 'مرتجعات المشتريات' },
    { id: 'suppliers-list', name: 'قائمة الموردين' },
    { id: 'supplier-payments', name: 'مدفوعات الموردين' },
    { id: 'inventory-list', name: 'قائمة المنتجات (جرد)' },
    { id: 'inventory-transfers', name: 'التحويلات المخزنية' },
    { id: 'stores-management', name: 'إدارة المخازن' },
    { id: 'fiscal-periods', name: 'الفترات المالية' },
    { id: 'fiscal-periods.create', name: 'الفترات المالية - إنشاء' },
    { id: 'fiscal-periods.close', name: 'الفترات المالية - إغلاق' },
    { id: 'fiscal-periods.reopen', name: 'الفترات المالية - إعادة فتح' },
    { id: 'settings', name: 'الإعدادات' } // Settings allows access to all settings tabs except users management
];

async function loadUsersList() {
    try {
        const res = await window.API.getUsers();
        const tbody = document.querySelector('#users-table tbody');
        tbody.innerHTML = '';
        res.data.forEach(user => {
            const isSuperAdmin = user.id === 1 && user.role === 'admin';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${user.full_name} ${isSuperAdmin ? '<span class="badge-status paid">مدير أساسي</span>' : ''}</td>
                <td>${user.username}</td>
                <td>${user.role}</td>
                <td>${new Date(user.created_at).toLocaleDateString('ar-EG')}</td>
                <td class="actions-cell">
                    ${!isSuperAdmin ? `<button class="icon-btn btn-edit" title="تعديل الصلاحيات" onclick="showEditPermsModal(${user.id}, '${encodeURIComponent(user.permissions)}')"><i class="fa-solid fa-list-check"></i></button>` : ''}
                    ${!isSuperAdmin ? `<button class="icon-btn btn-edit" title="تغيير كلمة المرور" onclick="showEditPasswordModal(${user.id})"><i class="fa-solid fa-key"></i></button>` : ''}
                    ${!isSuperAdmin ? `<button class="icon-btn btn-delete" title="حذف" onclick="deleteUser(${user.id})"><i class="fa-solid fa-trash"></i></button>` : ''}
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        showAlert(e.message, { title: 'خطأ', type: 'danger', infoText: false });
    }
}

function renderPermCheckboxes(containerId, selectedPerms = []) {
    const container = document.getElementById(containerId);
    container.innerHTML = availableScreens.map(s => `
        <label style="display:flex; align-items:center; gap:8px;">
            <input type="checkbox" value="${s.id}" ${selectedPerms.includes(s.id) || selectedPerms.includes('*') ? 'checked' : ''}>
            ${s.name}
        </label>
    `).join('');
}

window.showAddUserModal = function() {
    renderPermCheckboxes('add-user-perms', []);
    document.getElementById('modal-user-add').classList.add('active');
};

window.showEditPermsModal = function(id, permsStr) {
    document.getElementById('edit-perm-user-id').value = id;
    let perms = [];
    try { perms = JSON.parse(decodeURIComponent(permsStr)); } catch(e){}
    renderPermCheckboxes('edit-user-perms-list', perms);
    document.getElementById('modal-user-perms').classList.add('active');
};

window.showEditPasswordModal = function(id) {
    document.getElementById('edit-pw-user-id').value = id;
    document.getElementById('modal-user-password').classList.add('active');
};

window.deleteUser = async function(id) {
    const confirmed = await showConfirm('هل أنت متأكد من حذف هذا المستخدم؟ لن يمكن التراجع عن هذا الإجراء.', {
        title: 'حذف المستخدم',
        confirmText: '<i class="fa-solid fa-trash" style="margin-left:6px"></i> حذف',
    });
    if (confirmed) {
        try {
            await window.API.deleteUser(id);
            showAlert('تم حذف المستخدم بنجاح', { title: 'تمت العملية', type: 'success', infoText: false });
            loadUsersList();
        } catch(e) { showAlert(e.message, { type: 'danger', title: 'خطأ' }); }
    }
};

// Form submissions
document.addEventListener('DOMContentLoaded', () => {
    const formAdd = document.getElementById('form-user-add');
    if (formAdd) {
        formAdd.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('add-user-name').value;
            const email = document.getElementById('add-user-email').value;
            const password = document.getElementById('add-user-password').value;
            const perms = Array.from(document.querySelectorAll('#add-user-perms input:checked')).map(cb => cb.value);
            
            try {
                await window.API.createUser({ name, email, password, permissions: perms });
                document.getElementById('modal-user-add').classList.remove('active');
                formAdd.reset();
                loadUsersList();
            } catch (err) { showAlert(err.message, { title: 'خطأ', type: 'danger', infoText: false }); }
        });
    }

    const formPerms = document.getElementById('form-user-perms');
    if (formPerms) {
        formPerms.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('edit-perm-user-id').value;
            const perms = Array.from(document.querySelectorAll('#edit-user-perms-list input:checked')).map(cb => cb.value);
            try {
                await window.API.updateUserPermissions(id, perms);
                document.getElementById('modal-user-perms').classList.remove('active');
                loadUsersList();
            } catch (err) { showAlert(err.message, { title: 'خطأ', type: 'danger', infoText: false }); }
        });
    }

    const formPw = document.getElementById('form-user-password');
    if (formPw) {
        formPw.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('edit-pw-user-id').value;
            const password = document.getElementById('edit-user-password-input').value;
            try {
                await window.API.updateUserPassword(id, password);
                document.getElementById('modal-user-password').classList.remove('active');
                formPw.reset();
            } catch (err) { showAlert(err.message, { title: 'خطأ', type: 'danger', infoText: false }); }
        });
    }
    
    // Load users if settings view is opened
    document.addEventListener('click', (e) => {
        const item = e.target.closest('.nav-item, .settings-nav li');
        if (item && item.getAttribute('data-target') === 'settings-users') {
            loadUsersList();
        }
    });
});


    // Generic modal close for any button with class .close-modal or .btn-close-modal
    document.addEventListener('click', (e) => {
        const closeBtn = e.target.closest('.close-modal') || e.target.closest('.btn-close-modal');
        if (closeBtn) {
            const overlay = closeBtn.closest('.modal-overlay');
            if (overlay) overlay.classList.remove('active');
        }
    });


// ============================================================
// ACTIVITY LOGS (Admin Only) - Enterprise Audit Trail
// ============================================================
let currentLogPage = 1;
let currentLogTotalPages = 1;

function setLogsTableMessage(message, colspan) {
    const tbody = document.querySelector('#logs-table tbody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="${colspan || 10}" style="text-align:center;padding:30px;color:#64748b;">${escapeHtml(message)}</td></tr>`;
}

window.loadActivityLogs = async function(page) {
    const user = getActiveUser();
    if (!isAdminUser(user)) {
        setLogsTableMessage('لا تملك صلاحية عرض سجل الحركات');
        return;
    }

    if (page !== undefined) currentLogPage = page;

    setLogsTableMessage('جاري تحميل السجل...', 10);

    try {
        const params = {
            page: currentLogPage,
            limit: document.getElementById('log-page-limit')?.value || 50,
            user_name: document.getElementById('log-search-user')?.value || '',
            module: document.getElementById('log-filter-module')?.value || '',
            operation: document.getElementById('log-filter-operation')?.value || '',
            status: document.getElementById('log-filter-status')?.value || '',
            date_from: document.getElementById('log-date-from')?.value || '',
            date_to: document.getElementById('log-date-to')?.value || '',
            ref_no: document.getElementById('log-ref-no')?.value || ''
        };

        const res = await window.API.getLogs(params);
        const logs = Array.isArray(res.data) ? res.data : [];
        currentLogPage = res.pagination?.page || 1;
        currentLogTotalPages = res.pagination?.totalPages || 1;
        renderLogsTable(logs, res.pagination);
    } catch (e) {
        console.error('Failed to load logs', e);
        setLogsTableMessage('تعذر تحميل السجل: ' + (e.message || 'خطأ غير معروف'), 10);
    }
};

function goLogPage(page) {
    if (page < 1 || page > currentLogTotalPages) return;
    loadActivityLogs(page);
}

function getOpBadge(op) {
    const map = {
        'LOGIN': '<span class="log-badge login" style="background:#dbeafe;color:#1d4ed8;padding:2px 8px;border-radius:4px;font-size:0.78rem;font-weight:600;white-space:nowrap">⇢ دخول</span>',
        'LOGOUT': '<span class="log-badge logout" style="background:#f3e8ff;color:#7c3aed;padding:2px 8px;border-radius:4px;font-size:0.78rem;font-weight:600;white-space:nowrap">⇠ خروج</span>',
        'CREATE': '<span class="log-badge create" style="background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:4px;font-size:0.78rem;font-weight:600;white-space:nowrap">✚ إضافة</span>',
        'UPDATE': '<span class="log-badge update" style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:4px;font-size:0.78rem;font-weight:600;white-space:nowrap">✎ تعديل</span>',
        'DELETE': '<span class="log-badge delete" style="background:#fce4ec;color:#b71c1c;padding:2px 8px;border-radius:4px;font-size:0.78rem;font-weight:600;white-space:nowrap">✕ حذف</span>',
        'APPROVE': '<span class="log-badge approve" style="background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:4px;font-size:0.78rem;font-weight:600;white-space:nowrap">✓ اعتماد</span>',
        'REJECT': '<span class="log-badge reject" style="background:#fce4ec;color:#b71c1c;padding:2px 8px;border-radius:4px;font-size:0.78rem;font-weight:600;white-space:nowrap">✗ رفض</span>',
        'REVERSE': '<span class="log-badge reverse" style="background:#fff3e0;color:#e65100;padding:2px 8px;border-radius:4px;font-size:0.78rem;font-weight:600;white-space:nowrap">↺ عكس</span>',
        'PRINT': '<span class="log-badge print" style="background:#e0f2fe;color:#0369a1;padding:2px 8px;border-radius:4px;font-size:0.78rem;font-weight:600;white-space:nowrap">🖨 طباعة</span>',
        'EXPORT': '<span class="log-badge export" style="background:#e0f2fe;color:#0369a1;padding:2px 8px;border-radius:4px;font-size:0.78rem;font-weight:600;white-space:nowrap">📤 تصدير</span>'
    };
    return map[op] || '<span style="padding:2px 6px;border-radius:4px;font-size:0.78rem;background:#f1f5f9;color:#475569">' + escapeHtml(op) + '</span>';
}

function getStatusBadge(st) {
    if (st === 'SUCCESS') return '<span style="color:#059669;font-weight:700;font-size:0.8rem">✓</span>';
    if (st === 'FAILED') return '<span style="color:#dc2626;font-weight:700;font-size:0.8rem">✗</span>';
    return '<span style="color:#9ca3af;font-size:0.8rem">-</span>';
}

function renderLogsTable(logs, pagination) {
    const tbody = document.querySelector('#logs-table tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!logs.length) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:30px;color:#64748b;">لا توجد حركات مطابقة</td></tr>';
        updatePagination(pagination);
        return;
    }

    logs.forEach((log, i) => {
        const tr = document.createElement('tr');
        const timeStr = window.formatLogDateTime ? window.formatLogDateTime(log.created_at) : (log.created_at || '-');
        tr.style.fontSize = '0.82rem';
        tr.innerHTML = `
            <td style="color:var(--text-muted);font-size:0.75rem">${(pagination ? (pagination.page - 1) * pagination.limit + i + 1 : i + 1)}</td>
            <td style="direction:ltr;text-align:right;white-space:nowrap;font-size:0.78rem;color:var(--text-muted)">${timeStr}</td>
            <td><strong style="color:var(--primary-color)">${escapeHtml(log.user_name || '-')}</strong></td>
            <td style="font-size:0.75rem;color:var(--text-muted)">${escapeHtml(log.role || '-')}</td>
            <td>${escapeHtml(log.module || '-')}</td>
            <td>${getOpBadge(log.operation)}</td>
            <td style="font-family:monospace;font-size:0.78rem;direction:ltr">${escapeHtml(log.ref_no || '-')}</td>
            <td style="text-align:center">${getStatusBadge(log.status)}</td>
            <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(log.affected_record || '')} ${log.reason ? '(' + escapeHtml(log.reason) + ')' : ''}">${escapeHtml((log.affected_record || '').substring(0, 80))}${log.reason ? '<br><span style="font-size:0.75rem;color:#dc2626">' + escapeHtml(log.reason.substring(0, 50)) + '</span>' : ''}</td>
            <td style="font-size:0.72rem;direction:ltr;color:var(--text-muted);font-family:monospace">${escapeHtml(log.ip_address || '-')}</td>
        `;
        tr.style.cursor = 'pointer';
        const details = log.affected_record || '';
        const oldV = log.old_values ? '\nالقيم القديمة: ' + escapeHtml(log.old_values) : '';
        const newV = log.new_values ? '\nالقيم الجديدة: ' + escapeHtml(log.new_values) : '';
        const dev = log.device ? '\nالجهاز: ' + escapeHtml(log.device.substring(0, 100)) : '';
        tr.title = details + oldV + newV + dev;
        tbody.appendChild(tr);
    });

    updatePagination(pagination);
}

function updatePagination(pagination) {
    const info = document.getElementById('log-page-info');
    const container = document.getElementById('log-pagination');
    if (!info || !container) return;
    if (pagination) {
        info.textContent = 'صفحة ' + pagination.page + ' من ' + pagination.totalPages + ' (' + pagination.total + ' سجل)';
        currentLogTotalPages = pagination.totalPages;
        container.style.display = 'flex';
    } else {
        container.style.display = 'none';
    }
}

window.printAuditLog = function() {
    const tbody = document.querySelector('#logs-table tbody');
    if (!tbody || !tbody.rows.length) return;
    const w = window.open('', '_blank', 'width=1024,height=768');
    if (!w) return;
    let html = '<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><title>سجل التدقيق</title>';
    html += '<style>body{font-family:Cairo,sans-serif;font-size:9pt;direction:rtl}table{width:100%;border-collapse:collapse}th{background:#1e3a5f;color:#fff;padding:6px;font-size:7pt}td{padding:5px;border-bottom:1px solid #e2e8f0;font-size:7.5pt}tr:nth-child(even){background:#f8fafc}</style></head><body>';
    html += '<h2 style="color:#1e3a5f">سجل التدقيق (Audit Trail)</h2>';
    html += '<table><thead><tr><th>#</th><th>التاريخ</th><th>المستخدم</th><th>الدور</th><th>الوحدة</th><th>العملية</th><th>المرجع</th><th>الحالة</th><th>البيان</th><th>IP</th></tr></thead><tbody>';
    for (let i = 0; i < tbody.rows.length; i++) {
        const cells = tbody.rows[i].cells;
        html += '<tr>' + Array.from(cells).map(c => '<td>' + c.textContent + '</td>').join('') + '</tr>';
    }
    html += '</tbody></table></body></html>';
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 300);
};

// ============================================================
// LICENSE ACTIVATION & MANAGEMENT (Control Center)
// ============================================================

let currentLicenseFile = null;

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val || '-';
}

window.translateState = function(state) {
    const map = { 'ACTIVE': 'نشط', 'DEVELOPER': 'مطور', 'GRACE_PERIOD': 'فترة سماح', 'CLOCK_WARNING': 'تحذير الساعة', 'UNACTIVATED': 'غير مفعل', 'EXPIRED': 'منتهي', 'INVALID': 'غير صالح', 'TAMPERED': 'مخترق' };
    return map[state] || state || 'غير معروف';
};

function capitalize(s) {
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
}

window.copyText = function(elId) {
    const el = document.getElementById(elId);
    if (!el) return;
    const text = el.textContent.replace(/نسخ|copy/gi, '').trim();
    navigator.clipboard.writeText(text).catch(() => {});
};

window.copyHardwareId = function() {
    const el = document.getElementById('act-hwid');
    if (!el) return;
    const text = el.textContent.replace(/نسخ|copy/gi, '').trim();
    navigator.clipboard.writeText(text).catch(() => {});
};

window.copyFingerprint = function() {
    const el = document.querySelector('#act-fingerprint');
    if (!el) return;
    const text = el.textContent.replace(/نسخ|copy/gi, '').trim();
    navigator.clipboard.writeText(text).catch(() => {});
};

// ═══ ACTIVATION OVERLAY ═══

window.showLicenseActivation = async function(errorData) {
    const overlay = document.getElementById('license-activation-overlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    try { const sr = await window.API.getLicenseStatus(); updateActivationUI(sr.data || sr); } catch (e) {}
    try {
        const hwRes = await window.API.getLicenseHardware();
        if (hwRes.success) {
            document.getElementById('activation-hw-loading').style.display = 'none';
            const grid = document.getElementById('activation-hw-grid');
            grid.style.display = 'flex'; grid.style.flexDirection = 'column';
            setText('act-computer', hwRes.data.computerName || '-');
            setText('act-os', hwRes.data.osVersion || '-');
            setText('act-cpu', hwRes.data.cpu || '-');
            setText('act-mb', hwRes.data.motherboard || '-');
            setText('act-disk', hwRes.data.diskModel || hwRes.data.disk || '-');
            const fp = hwRes.data.hardwareFingerprint || '-';
            const fpEl = document.querySelector('#act-fingerprint');
            if (fpEl) fpEl.innerHTML = fp + '<button class="copy-btn" onclick="copyFingerprint()" title="نسخ"><i class="fa-regular fa-copy"></i></button>';
        }
    } catch (e) {
        document.getElementById('activation-hw-loading').innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> تعذر تحميل معلومات الجهاز';
    }
    try {
        const sc = await window.API.getLicenseStatus();
        const b = (sc.data || sc).build_profile || '';
        const lbl = document.getElementById('activation-build-label');
        if (lbl) { lbl.textContent = b === 'development' ? 'DEVELOPMENT BUILD' : 'PRODUCTION BUILD'; lbl.style.background = b === 'development' ? 'rgba(245,158,11,0.15)' : 'rgba(79,70,229,0.15)'; lbl.style.color = b === 'development' ? '#fcd34d' : 'var(--primary-light)'; }
    } catch (e) {}
};

window.hideLicenseActivation = function() {
    const overlay = document.getElementById('license-activation-overlay');
    if (overlay) overlay.style.display = 'none';
    document.getElementById('app').style.display = 'flex';
};

function updateActivationUI(data) {
    if (!data) return;
    const isInactive = data.state === 'UNACTIVATED' || data.state === 'INVALID' || data.state === 'TAMPERED';
    const isActive = data.state === 'ACTIVE' || data.state === 'GRACE_PERIOD' || data.state === 'CLOCK_WARNING';
    setText('act-state', window.translateState(data.state));
    if (isInactive) {
        setText('act-edition', '---');
        setText('act-expiration', '---');
        setText('act-grace', '---');
    } else {
        setText('act-edition', data.edition || '---');
        setText('act-expiration', data.expiration || '---');
        setText('act-grace', data.grace_remaining !== undefined ? data.grace_remaining + ' يوم' : '---');
    }
    const fp = data.hardware_id || '---';
    const hwidEl = document.getElementById('act-hwid');
    if (hwidEl) hwidEl.innerHTML = fp + '<button class="copy-btn" onclick="copyHardwareId()" title="نسخ المعرف"><i class="fa-regular fa-copy"></i></button>';
    const badge = document.getElementById('activation-state-badge');
    const st = document.getElementById('activation-state-text');
    if (isActive && data.state === 'ACTIVE') {
        badge.className = 'license-state-badge active'; st.textContent = 'نشط';
    } else if (isActive && data.state === 'GRACE_PERIOD') {
        badge.className = 'license-state-badge warning'; st.textContent = 'سماح';
    } else if (isActive && data.state === 'CLOCK_WARNING') {
        badge.className = 'license-state-badge warning'; st.textContent = 'تحذير الوقت';
    } else {
        badge.className = 'license-state-badge'; st.textContent = 'غير مفعل';
    }
    if (isActive) {
        document.getElementById('activation-title').textContent = 'الترخيص نشط';
        document.getElementById('activation-subtitle').textContent = 'البرنامج مرخص وجاهز للاستخدام';
        document.getElementById('btn-activate-license').disabled = true;
        document.getElementById('btn-activate-license').innerHTML = '<i class="fa-solid fa-check-circle"></i><span>مفعل</span>';
        const ua = document.querySelector('.upload-area');
        if (ua) { ua.style.opacity = '0.4'; ua.style.pointerEvents = 'none'; }
    } else {
        document.getElementById('activation-title').textContent = 'تفعيل الترخيص';
        document.getElementById('activation-subtitle').textContent = 'يرجى تفعيل البرنامج لبدء الاستخدام';
        document.getElementById('btn-activate-license').disabled = false;
        document.getElementById('btn-activate-license').innerHTML = '<i class="fa-solid fa-check-circle"></i><span>تفعيل الترخيص</span><span class="btn-spinner"></span>';
        const ua = document.querySelector('.upload-area');
        if (ua) { ua.style.opacity = '1'; ua.style.pointerEvents = 'auto'; }
    }
}

// Activation overlay file handling
document.addEventListener('DOMContentLoaded', function() {
    const fi = document.getElementById('activation-file-input');
    const ua = document.getElementById('activation-upload-area');
    if (!fi) return;
    fi.addEventListener('change', function(e) {
        const f = e.target.files[0]; if (!f) return;
        currentLicenseFile = f;
        document.getElementById('activation-file-info').style.display = 'flex';
        document.getElementById('activation-file-name').textContent = f.name;
        document.getElementById('activation-validation').style.display = 'none';
        document.getElementById('btn-activate-license').disabled = false;
        if (f.size < 50 || f.size > 50000) {
            document.getElementById('activation-validation').className = 'validation-result error';
            document.getElementById('activation-validation').style.display = 'flex';
            document.getElementById('activation-validation-icon').className = 'fa-solid fa-circle-exclamation';
            document.getElementById('activation-validation-text').textContent = 'حجم الملف غير متوقع';
            document.getElementById('btn-activate-license').disabled = true;
        } else {
            document.getElementById('activation-validation').className = 'validation-result success';
            document.getElementById('activation-validation').style.display = 'flex';
            document.getElementById('activation-validation-icon').className = 'fa-solid fa-check-circle';
            document.getElementById('activation-validation-text').textContent = 'تم اختيار الملف';
        }
    });
    ua.addEventListener('dragover', function(e) { e.preventDefault(); this.classList.add('dragover'); });
    ua.addEventListener('dragleave', function() { this.classList.remove('dragover'); });
    ua.addEventListener('drop', function(e) { e.preventDefault(); this.classList.remove('dragover'); if (e.dataTransfer.files.length > 0) { fi.files = e.dataTransfer.files; fi.dispatchEvent(new Event('change')); } });
    ua.addEventListener('click', function(e) { if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') fi.click(); });
});

window.submitActivation = async function() {
    if (!currentLicenseFile) return;
    const btn = document.getElementById('btn-activate-license');
    btn.classList.add('loading'); btn.disabled = true;
    try {
        const b64 = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => { const x = r.result; resolve(x.split(',')[1] || x); };
            r.onerror = reject; r.readAsDataURL(currentLicenseFile);
        });
        const res = await window.API.activateLicense(b64);
        if (res.success) {
            const v = document.getElementById('activation-validation');
            v.className = 'validation-result success'; v.style.display = 'flex';
            document.getElementById('activation-validation-icon').className = 'fa-solid fa-circle-check';
            document.getElementById('activation-validation-text').textContent = 'تم التفعيل بنجاح!';
            btn.innerHTML = '<i class="fa-solid fa-check-circle"></i><span>مفعل ✓</span>';
            btn.disabled = true; btn.classList.remove('loading');
            setTimeout(async () => {
                try {
                    const sr = await window.API.getLicenseStatus();
                    updateActivationUI(sr.data || sr);
                    const s = (sr.data || sr).state;
                    if (s === 'ACTIVE' || s === 'DEVELOPER' || s === 'GRACE_PERIOD') {
                        hideLicenseActivation(); showApp();
                        if (typeof window.initDataFromServer === 'function') window.initDataFromServer();
                    }
                } catch (e) {}
            }, 1500);
        } else { throw new Error(res.message || 'فشل التفعيل'); }
    } catch (err) {
        const v = document.getElementById('activation-validation');
        v.className = 'validation-result error'; v.style.display = 'flex';
        document.getElementById('activation-validation-icon').className = 'fa-solid fa-circle-xmark';
        document.getElementById('activation-validation-text').textContent = err.message || 'فشل التفعيل';
        btn.classList.remove('loading'); btn.disabled = false;
    }
};

// ═══ LICENSE MANAGEMENT CONTROL CENTER ═══

function showSkeleton() {
    const sk = document.getElementById('lm-skeleton');
    const main = document.getElementById('lm-main');
    if (sk) sk.style.display = 'block';
    if (main) main.style.display = 'none';
}

function hideSkeleton() {
    const sk = document.getElementById('lm-skeleton');
    const main = document.getElementById('lm-main');
    if (sk) sk.style.display = 'none';
    if (main) main.style.display = 'block';
}

window.loadLicenseView = async function() {
    showSkeleton();
    try {
        // Load all data in parallel
        const [statusRes, hwRes, diagRes, histRes] = await Promise.all([
            window.API.getLicenseStatus().catch(() => null),
            window.API.getLicenseHardware().catch(() => null),
            window.API.getLicenseDiagnostics ? window.API.getLicenseDiagnostics().catch(() => null) : null,
            window.API.getLicenseHistory ? window.API.getLicenseHistory().catch(() => null) : null
        ]);

        const data = statusRes?.data || statusRes || {};
        const hw = hwRes?.data || {};
        const diag = diagRes?.data || {};
        const hist = histRes?.data || {};

        // ── Banner ──
        const banner = document.getElementById('lm-banner');
        const bannerIcon = document.getElementById('lm-banner-icon');
        const bannerTitle = document.getElementById('lm-banner-title');
        const bannerSub = document.getElementById('lm-banner-sub');
        const bannerBadge = document.getElementById('lm-banner-badge');

        const isDev = data.build_profile === 'development';
        banner.className = 'lm-banner';
        if (data.state === 'ACTIVE' || data.state === 'DEVELOPER') {
            banner.classList.add(isDev ? 'developer' : '');
            bannerIcon.innerHTML = '<i class="fa-solid fa-' + (isDev ? 'flask' : 'circle-check') + '"></i>';
            bannerTitle.textContent = 'حالة الترخيص: ' + window.translateState(data.state);
            bannerSub.textContent = isDev ? 'ترخيص مطور — جميع الوحدات مفعلة' : (data.edition ? 'إصدار ' + data.edition : 'الترخيص نشط');
            bannerBadge.innerHTML = '<span>' + (isDev ? 'مطور' : 'نشط') + '</span>';
        } else if (data.state === 'GRACE_PERIOD' || data.state === 'CLOCK_WARNING') {
            banner.classList.add('warning');
            bannerIcon.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
            bannerTitle.textContent = 'تحذير: ' + window.translateState(data.state);
            bannerSub.textContent = data.state === 'GRACE_PERIOD' ? 'فترة السماح المتبقية: ' + (data.grace_remaining || 0) + ' يوم' : 'تم الكشف عن تلاعب في الساعة';
            bannerBadge.innerHTML = '<span>تحذير</span>';
        } else {
            banner.classList.add('inactive');
            bannerIcon.innerHTML = '<i class="fa-solid fa-circle-xmark"></i>';
            bannerTitle.textContent = 'الترخيص: ' + window.translateState(data.state);
            bannerSub.textContent = 'الرجاء تفعيل الترخيص لاستخدام النظام';
            bannerBadge.innerHTML = '<span>غير مفعل</span>';
        }

        // ── Timeline ──
        const tlItems = document.querySelectorAll('.lm-tl-item');
        tlItems.forEach((item, i) => {
            item.classList.remove('active', 'warning', 'inactive');
            if (data.state === 'ACTIVE' || data.state === 'DEVELOPER') {
                item.classList.add('active');
            } else if (data.state === 'GRACE_PERIOD') {
                if (i <= 1) item.classList.add('active'); else item.classList.add('warning');
            } else if (data.state === 'CLOCK_WARNING') {
                if (i <= 0) item.classList.add('active');
                if (i === 2) item.classList.add('warning');
            } else {
                if (i === 0) item.classList.add('active');
            }
        });

        // ── Info Grid ──
        const infoGrid = document.getElementById('lm-info-grid');
        const cust = data.customer || {};
        const customerName = cust.name || data.customer_name || '---';
        const companyName = cust.company || data.company_name || '---';
        const erpRange = data.erp_version_range ? (data.erp_version_range.min + ' - ' + data.erp_version_range.max) : '---';
        const exp = data.expiration || '---';
        const actDate = data.activation_date || '---';
        const lastVal = data.last_validation_time ? new Date(data.last_validation_time).toLocaleString('ar-EG') : '---';
        const fpPath = data.license_file_path || '---';
        const fpSize = data.license_file_size ? (data.license_file_size + ' بايت') : '---';
        const hwId = data.hardware_id || '---';

        infoGrid.innerHTML = `
            <div class="lm-info-row"><span class="il">معرف الترخيص</span><span class="iv iv-mono">${escapeHtml(data.license_id || '---')}</span></div>
            <div class="lm-info-row"><span class="il">اسم العميل</span><span class="iv">${escapeHtml(customerName)}</span></div>
            <div class="lm-info-row"><span class="il">الشركة</span><span class="iv">${escapeHtml(companyName)}</span></div>
            <div class="lm-info-row"><span class="il">الإصدار</span><span class="iv">${escapeHtml(data.edition || '---')}</span></div>
            <div class="lm-info-row"><span class="il">توافق الإصدار</span><span class="iv">${escapeHtml(erpRange)}</span></div>
            <div class="lm-info-row"><span class="il">تاريخ التفعيل</span><span class="iv">${escapeHtml(actDate)}</span></div>
            <div class="lm-info-row"><span class="il">تاريخ الانتهاء</span><span class="iv">${escapeHtml(exp)}</span></div>
            <div class="lm-info-row"><span class="il">أيام السماح</span><span class="iv">${data.grace_remaining !== undefined ? data.grace_remaining + ' يوم' : '---'}</span></div>
            <div class="lm-info-row"><span class="il">بيئة التشغيل</span><span class="iv">${isDev ? 'تطوير (Development)' : 'إنتاج (Production)'}</span></div>
            <div class="lm-info-row"><span class="il">الحالة</span><span class="iv">${escapeHtml(window.translateState(data.state))}</span></div>
            <div class="lm-info-row"><span class="il">آخر تحقق</span><span class="iv">${escapeHtml(lastVal)}</span></div>
            <div class="lm-info-row"><span class="il">حجم الملف</span><span class="iv">${escapeHtml(fpSize)}</span></div>
            <div class="lm-info-row" style="grid-column:span 2"><span class="il">مسار الملف</span><span class="iv iv-mono" style="font-size:0.65rem">${escapeHtml(fpPath)}</span></div>
            <div class="lm-info-row" style="grid-column:span 2;border-bottom:none"><span class="il">المعرف التعريفي</span><span class="iv iv-mono">${escapeHtml(hwId)} <button class="copy-btn" onclick="copyText('lm-hwid')" title="نسخ"><i class="fa-regular fa-copy"></i></button></span></div>
        `;

        // ── Modules & Features ──
        const enabledContainer = document.getElementById('lm-enabled-modules');
        const disabledContainer = document.getElementById('lm-disabled-modules');
        const featuresContainer = document.getElementById('lm-features');

        if (data.modules && data.modules.length > 0) {
            enabledContainer.innerHTML = data.modules.map(m => '<span class="lm-badge enabled"><i class="fa-solid fa-check-circle"></i> ' + escapeHtml(m) + '</span>').join('');
        } else {
            enabledContainer.innerHTML = '<span class="lm-empty">لا توجد وحدات مفعلة</span>';
        }
        if (data.disabled_modules && data.disabled_modules.length > 0) {
            disabledContainer.innerHTML = data.disabled_modules.map(m => '<span class="lm-badge disabled"><i class="fa-solid fa-minus-circle"></i> ' + escapeHtml(m) + '</span>').join('');
        } else {
            disabledContainer.innerHTML = '<span class="lm-empty">جميع الوحدات مفعلة</span>';
        }
        if (data.features && data.features.length > 0) {
            featuresContainer.innerHTML = data.features.map(f => '<span class="lm-badge feature"><i class="fa-solid fa-star"></i> ' + escapeHtml(f) + '</span>').join('');
        } else if (data.feature_flags) {
            const ff = data.feature_flags;
            const enabled = Object.keys(ff).filter(k => ff[k]);
            const disabled = Object.keys(ff).filter(k => !ff[k]);
            featuresContainer.innerHTML = enabled.map(f => '<span class="lm-badge feature"><i class="fa-solid fa-star"></i> ' + escapeHtml(f) + '</span>').join('') +
                disabled.map(f => '<span class="lm-badge disabled"><i class="fa-solid fa-star"></i> ' + escapeHtml(f) + '</span>').join('');
        } else {
            featuresContainer.innerHTML = '<span class="lm-empty">لا توجد ميزات إضافية</span>';
        }

        // ── Hardware ──
        const hwGrid = document.getElementById('lm-hw-grid');
        const hwLoading = document.getElementById('lm-hw-loading');
        if (hwLoading) hwLoading.style.display = 'none';
        if (hwGrid) {
            hwGrid.style.display = 'grid';
            const confidence = hw.confidenceScore !== null && hw.confidenceScore !== undefined ? (hw.confidenceScore * 100).toFixed(1) + '%' : '---';
            hwGrid.innerHTML = `
                <div class="lm-hw-item"><i class="fa-solid fa-display"></i><div><span class="lm-hw-label">اسم الجهاز</span><span class="lm-hw-value">${escapeHtml(hw.computerName || '---')}</span></div></div>
                <div class="lm-hw-item"><i class="fa-solid fa-windows"></i><div><span class="lm-hw-label">نظام التشغيل</span><span class="lm-hw-value">${escapeHtml(hw.osVersion || '---')}</span></div></div>
                <div class="lm-hw-item"><i class="fa-solid fa-microchip"></i><div><span class="lm-hw-label">المعالج</span><span class="lm-hw-value">${escapeHtml(hw.cpu || '---')}</span></div></div>
                <div class="lm-hw-item"><i class="fa-solid fa-layer-group"></i><div><span class="lm-hw-label">اللوحة الأم</span><span class="lm-hw-value">${escapeHtml(hw.motherboard || '---')}</span></div></div>
                <div class="lm-hw-item"><i class="fa-solid fa-memory"></i><div><span class="lm-hw-label">BIOS</span><span class="lm-hw-value">${escapeHtml(hw.bios || '---')}</span></div></div>
                <div class="lm-hw-item"><i class="fa-solid fa-hard-drive"></i><div><span class="lm-hw-label">القرص الصلب</span><span class="lm-hw-value">${escapeHtml(hw.diskModel || hw.disk || '---')}</span></div></div>
                <div class="lm-hw-item"><i class="fa-solid fa-barcode"></i><div><span class="lm-hw-label">رقم القرص</span><span class="lm-hw-value">${escapeHtml(hw.diskSerial || '---')}</span></div></div>
                <div class="lm-hw-item"><i class="fa-solid fa-qrcode"></i><div><span class="lm-hw-label">معرف الجهاز</span><span class="lm-hw-value">${escapeHtml(hw.machineGuid || '---')}</span></div></div>
                <div class="lm-hw-item"><i class="fa-solid fa-shield"></i><div><span class="lm-hw-label">نسبة الثقة</span><span class="lm-hw-value">${escapeHtml(confidence)}</span></div></div>
                <div class="lm-hw-item" style="grid-column:span 2"><i class="fa-solid fa-fingerprint"></i><div><span class="lm-hw-label">البصمة التعريفية</span><span class="lm-hw-value" style="font-family:monospace;direction:ltr;font-size:0.7rem">${escapeHtml(hw.hardwareFingerprint || '---')}</span></div></div>
            `;
        }

        // ── Hardware Change & Clock Status ──
        if (window.loadHardwareChangeStatus) {
            window.loadHardwareChangeStatus();
        }

        // ── Diagnostics ──
        const diagLoading = document.getElementById('lm-diag-loading');
        const diagGrid = document.getElementById('lm-diag-grid');
        if (diagLoading) diagLoading.style.display = 'none';
        if (diagGrid && diag.checks) {
            diagGrid.style.display = 'flex';
            const checkNames = {
                rsa_signature: 'توقيع RSA', aes_decryption: 'فك تشفير AES', license_format: 'صيغة الترخيص',
                version_compatibility: 'توافق الإصدار', hardware_validation: 'مطابقة الجهاز',
                expiration_check: 'صلاحية الترخيص', clock_validation: 'سلامة الساعة',
                modules_validation: 'الوحدات', feature_validation: 'الميزات'
            };
            diagGrid.innerHTML = '';
            for (const [key, check] of Object.entries(diag.checks)) {
                const status = (check.status || (check.pass ? 'PASS' : 'FAILED')).toLowerCase();
                const icon = status === 'pass' ? 'fa-circle-check' : (status === 'warning' ? 'fa-triangle-exclamation' : 'fa-circle-xmark');
                const statusText = status === 'pass' ? 'ناجح' : (status === 'warning' ? 'تحذير' : 'فشل');
                diagGrid.innerHTML += `
                    <div class="lm-diag-item">
                        <span class="lm-diag-name"><i class="fa-regular ${icon}" style="color:${status === 'pass' ? 'var(--success-color)' : (status === 'warning' ? 'var(--warning-color)' : 'var(--danger-color)')}"></i> ${checkNames[key] || key}</span>
                        <span class="lm-diag-status ${status}">${statusText}</span>
                    </div>`;
            }
        } else if (diagGrid) {
            diagGrid.style.display = 'flex';
            diagGrid.innerHTML = '<span class="lm-empty">التشخيص غير متاح</span>';
        }

        // ── History ──
        const histLoading = document.getElementById('lm-history-loading');
        const histGrid = document.getElementById('lm-history-grid');
        if (histLoading) histLoading.style.display = 'none';
        if (histGrid) {
            histGrid.style.display = 'flex';
            const actBy = hist.activated_by || '---';
            const actDate2 = hist.activation_date ? new Date(hist.activation_date).toLocaleString('ar-EG') : '---';
            const lastVal2 = hist.last_validation ? new Date(hist.last_validation).toLocaleString('ar-EG') : '---';
            const valCount = hist.validation_count || 0;
            const lastUpgrade = hist.last_upgrade || '---';
            const lastSelfTest = hist.last_self_test || '---';
            let eventsHtml = '';
            if (hist.events && hist.events.length > 0) {
                eventsHtml = hist.events.slice(0, 5).map(e =>
                    '<div class="lm-history-item"><span class="hl">' + escapeHtml(e.operation || '') + '</span><span class="hv">' + escapeHtml(e.user || '') + ' - ' + (e.time ? new Date(e.time).toLocaleString('ar-EG') : '') + '</span></div>'
                ).join('');
            }
            histGrid.innerHTML = `
                <div class="lm-history-item"><span class="hl">تم التفعيل في</span><span class="hv">${escapeHtml(actDate2)}</span></div>
                <div class="lm-history-item"><span class="hl">تم بواسطة</span><span class="hv">${escapeHtml(actBy)}</span></div>
                <div class="lm-history-item"><span class="hl">آخر ترقية</span><span class="hv">${escapeHtml(lastUpgrade)}</span></div>
                <div class="lm-history-item"><span class="hl">آخر تحقق</span><span class="hv">${escapeHtml(lastVal2)}</span></div>
                <div class="lm-history-item"><span class="hl">عدد مرات التحقق</span><span class="hv">${valCount}</span></div>
                ${eventsHtml ? '<div style="border-top:1px solid var(--border-color);padding-top:6px;margin-top:4px;font-size:0.75rem;color:var(--text-muted)">آخر الأحداث:</div>' + eventsHtml : ''}
            `;
        }

        hideSkeleton();
    } catch (e) {
        console.error('License view error', e);
        hideSkeleton();
        const infoGrid = document.getElementById('lm-info-grid');
        if (infoGrid) infoGrid.innerHTML = '<div style="color:var(--danger-color);text-align:center;padding:20px;">خطأ في تحميل بيانات الترخيص: ' + escapeHtml(e.message) + '</div>';
    }
};

window.loadLicenseHealth = async function() {
    try {
        const res = await window.API.getLicenseHealth();
        let msg = 'فحص الصحة: ';
        if (res.data && res.data.overall) msg += res.data.overall === 'ok' || res.data.overall === 'PASS' ? '✓ سليم' : '⚠ تحذير';
        else msg += '✓ تم';
        window.showAlert(msg, { title: 'فحص الصحة', type: 'success', infoText: false, confirmText: 'حسناً' });
    } catch (e) {
        window.showAlert('فشل فحص الصحة: ' + e.message, { title: 'خطأ', type: 'danger', infoText: false, confirmText: 'حسناً' });
    }
};

window.runLicenseSelfTest = async function() {
    const card = document.getElementById('lm-self-test-card');
    const results = document.getElementById('lm-self-test-results');
    if (!card || !results) return;
    card.style.display = 'block';
    results.innerHTML = '<div class="lm-loading"><i class="fa-solid fa-spinner fa-spin"></i> جاري تنفيذ الاختبار الشامل...</div>';
    try {
        const res = await window.API.runLicenseSelfTest();
        let html = '';
        const data = res.data;
        const r = data.results || data;
        if (typeof r === 'object' && !Array.isArray(r)) {
            for (const [key, val] of Object.entries(r)) {
                if (val && typeof val === 'object' && 'pass' in val) {
                    const ok = val.pass === true;
                    html += '<div class="lm-st-item"><span class="lm-st-name">' + escapeHtml(key) + '</span><span class="lm-st-status ' + (ok ? 'lh-ok' : 'lh-err') + '">' + (ok ? '✓ ناجح' : '✗ فشل') + '</span></div>';
                } else if (key !== 'overall') {
                    html += '<div class="lm-st-item"><span class="lm-st-name">' + escapeHtml(key) + '</span><span class="lm-st-status">' + escapeHtml(String(val)) + '</span></div>';
                }
            }
            if (data.overall !== undefined) {
                const ok = data.overall === true;
                html += '<div class="lm-st-item" style="border-top:2px solid var(--border-color);padding-top:10px;margin-top:8px;"><span class="lm-st-name" style="font-weight:800;">النتيجة العامة</span><span class="lm-st-status ' + (ok ? 'lh-ok' : 'lh-err') + '" style="font-weight:800;">' + (ok ? '✓ ناجح' : '✗ فشل') + '</span></div>';
            }
        } else if (Array.isArray(r)) {
            r.forEach(t => { const ok = t.status === 'ok' || t.passed; html += '<div class="lm-st-item"><span class="lm-st-name">' + escapeHtml(t.name || t.test || '') + '</span><span class="lm-st-status ' + (ok ? 'lh-ok' : 'lh-err') + '">' + (ok ? '✓ ناجح' : '✗ فشل') + '</span></div>'; });
        } else {
            html += '<div class="lm-loading">' + escapeHtml(JSON.stringify(data)) + '</div>';
        }
        results.innerHTML = html;
    } catch (e) {
        results.innerHTML = '<div style="color:var(--danger-color);text-align:center;padding:15px;">خطأ: ' + escapeHtml(e.message) + '</div>';
    }
};

window.revalidateLicense = async function() {
    try {
        const res = await window.API.revalidateLicense();
        if (res.success) {
            window.showAlert('تمت إعادة التحقق بنجاح. الحالة: ' + window.translateState(res.data.state), { title: 'إعادة التحقق', type: 'success', infoText: false, confirmText: 'حسناً' });
            loadLicenseView();
        }
    } catch (e) {
        window.showAlert('فشل إعادة التحقق: ' + e.message, { title: 'خطأ', type: 'danger', infoText: false, confirmText: 'حسناً' });
    }
};

window.refreshHardwareFingerprint = async function() {
    try {
        const res = await window.API.refreshHardware();
        if (res.success) {
            window.showAlert('تم تحديث بصمة الجهاز بنجاح', { title: 'تحديث الجهاز', type: 'success', infoText: false, confirmText: 'حسناً' });
            loadLicenseView();
        }
    } catch (e) {
        window.showAlert('فشل تحديث بصمة الجهاز: ' + e.message, { title: 'خطأ', type: 'danger', infoText: false, confirmText: 'حسناً' });
    }
};

window.loadHardwareChangeStatus = async function() {
    try {
        const [changeRes, clockRes] = await Promise.all([
            window.API.getHardwareChangeDetection().catch(() => null),
            window.API.getClockStatus().catch(() => null)
        ]);
        const changeEl = document.getElementById('lm-hw-change');
        const clockEl = document.getElementById('lm-clock-status');
        if (changeEl && changeRes?.data) {
            const d = changeRes.data;
            if (d.isFirstCollection) {
                changeEl.className = 'lm-hw-change first';
                changeEl.innerHTML = '<i class="fa-solid fa-circle-info"></i> هذه أول مرة يتم فيها تسجيل بصمة الجهاز';
                changeEl.style.display = 'block';
            } else if (d.changed) {
                changeEl.className = 'lm-hw-change changed';
                changeEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> تم اكتشاف تغيير في مكونات الجهاز (نسبة الثقة: ' + (d.confidence !== null ? (d.confidence * 100).toFixed(1) + '%' : '---') + ')';
                changeEl.style.display = 'block';
            } else if (d.fingerprintMatch) {
                changeEl.className = 'lm-hw-change unchanged';
                changeEl.innerHTML = '<i class="fa-solid fa-check-circle"></i> بصمة الجهاز مطابقة تماماً (نسبة الثقة: ' + (d.confidence !== null ? (d.confidence * 100).toFixed(1) + '%' : '100%') + ')';
                changeEl.style.display = 'block';
            } else {
                changeEl.className = 'lm-hw-change unchanged';
                changeEl.innerHTML = '<i class="fa-solid fa-check-circle"></i> الجهاز مطابق لنسبة عالية (نسبة الثقة: ' + (d.confidence !== null ? (d.confidence * 100).toFixed(1) + '%' : '---') + ')';
                changeEl.style.display = 'block';
            }
        }
        if (clockEl && clockRes?.data) {
            const d = clockRes.data;
            if (d.isFirstEntry) {
                clockEl.className = 'lm-clock-status first';
                clockEl.innerHTML = '<i class="fa-solid fa-circle-info"></i> ساعة النظام — جاري تسجيل القياسات الأولية';
                clockEl.style.display = 'block';
            } else if (d.tampered) {
                clockEl.className = 'lm-clock-status warning';
                clockEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> تلاعب بالساعة! انحراف: ' + (d.drift / 1000).toFixed(1) + ' ثانية | حالات شاذة: ' + d.anomalyCount;
                clockEl.style.display = 'block';
            } else {
                clockEl.className = 'lm-clock-status safe';
                clockEl.innerHTML = '<i class="fa-solid fa-check-circle"></i> ساعة النظام سليمة | أخر تحقق: ' + (d.lastVerified ? new Date(d.lastVerified).toLocaleString('ar-EG') : '---');
                clockEl.style.display = 'block';
            }
        }
    } catch (e) {
        console.error('Hardware/clock status error', e);
    }
};

window.exportDiagnostic = async function() {
    try {
        const res = await window.API.request('/license/export-diagnostic', 'GET', null, { silent: true });
        if (res.success) {
            const pkg = res.data;
            const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'diagnostic-' + new Date().toISOString().slice(0, 10) + '.json';
            document.body.appendChild(a); a.click(); a.remove();
            URL.revokeObjectURL(url);
        }
    } catch (e) {
        window.showAlert('فشل تصدير التشخيص: ' + e.message, { title: 'خطأ', type: 'danger', infoText: false, confirmText: 'حسناً' });
    }
};

// In-view upload
document.addEventListener('DOMContentLoaded', function() {
    const fi = document.getElementById('lm-file-input');
    const zone = document.getElementById('lm-upload-zone');
    if (!fi || !zone) return;

    fi.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;
        const pb = document.getElementById('lm-upload-progress');
        const fill = document.getElementById('lm-progress-fill');
        const txt = document.getElementById('lm-progress-text');
        const result = document.getElementById('lm-upload-result');
        pb.style.display = 'block'; result.style.display = 'none';
        fill.style.width = '0%'; txt.textContent = 'جاري قراءة الملف...';

        // Simulate progress
        let p = 0;
        const iv = setInterval(() => { p += Math.random() * 15; if (p > 90) p = 90; fill.style.width = p + '%'; }, 200);

        const reader = new FileReader();
        reader.onload = async function() {
            const b64 = reader.result.split(',')[1] || reader.result;
            txt.textContent = 'جاري التفعيل...';
            try {
                const res = await window.API.activateLicense(b64);
                clearInterval(iv);
                fill.style.width = '100%';
                txt.textContent = 'تم التفعيل بنجاح!';
                result.className = 'lm-upload-result success';
                result.innerHTML = '<i class="fa-solid fa-check-circle"></i> تم التفعيل بنجاح!';
                result.style.display = 'block';
                setTimeout(() => { pb.style.display = 'none'; loadLicenseView(); }, 1500);
            } catch (err) {
                clearInterval(iv);
                fill.style.width = '100%'; fill.style.background = 'var(--danger-color)';
                txt.textContent = 'فشل التفعيل';
                result.className = 'lm-upload-result error';
                result.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> ' + (err.message || 'فشل التفعيل');
                result.style.display = 'block';
                setTimeout(() => { pb.style.display = 'none'; }, 3000);
            }
        };
        reader.onerror = function() {
            clearInterval(iv);
            result.className = 'lm-upload-result error';
            result.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> فشل قراءة الملف';
            result.style.display = 'block';
        };
        reader.readAsDataURL(file);
    });

    zone.addEventListener('dragover', function(e) { e.preventDefault(); this.classList.add('dragover'); });
    zone.addEventListener('dragleave', function() { this.classList.remove('dragover'); });
    zone.addEventListener('drop', function(e) { e.preventDefault(); this.classList.remove('dragover'); if (e.dataTransfer.files.length > 0) { fi.files = e.dataTransfer.files; fi.dispatchEvent(new Event('change')); } });
    zone.addEventListener('click', function(e) { if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') fi.click(); });
});

window.refreshLicenseSettings = function() {
    const infoEl = document.getElementById('settings-license-info');
    const modEl = document.getElementById('settings-license-modules');
    if (!infoEl) return;
    infoEl.innerHTML = '<div class="lm-loading"><i class="fa-solid fa-spinner fa-spin"></i> جاري التحميل...</div>';
    modEl.innerHTML = '<div class="lm-loading"><i class="fa-solid fa-spinner fa-spin"></i> جاري التحميل...</div>';
    window.API.getLicenseStatus().then(res => {
        const d = res.data || res;
        let html = '<div class="lm-info-list">';
        html += '<div class="lm-info-item"><span class="lm-label">الحالة</span><span class="lm-value"><span class="lm-state-badge ' + (d.state === 'ACTIVE' || d.state === 'DEVELOPER' ? 'active' : d.state === 'DEVELOPER' ? 'developer' : 'inactive') + '" style="font-size:0.75rem;padding:2px 10px;display:inline-block;margin:0">' + window.translateState(d.state) + '</span></span></div>';
        html += '<div class="lm-info-item"><span class="lm-label">معرف الترخيص</span><span class="lm-value" style="font-size:0.75rem">' + escapeHtml(d.license_id || '---') + '</span></div>';
        html += '<div class="lm-info-item"><span class="lm-label">الإصدار</span><span class="lm-value">' + escapeHtml(d.edition || '---') + '</span></div>';
        html += '<div class="lm-info-item"><span class="lm-label">العميل</span><span class="lm-value">' + escapeHtml(d.customer_name || (d.customer ? d.customer.name : '') || '---') + '</span></div>';
        html += '<div class="lm-info-item"><span class="lm-label">تاريخ الانتهاء</span><span class="lm-value">' + escapeHtml(d.expiration || '---') + '</span></div>';
        html += '<div class="lm-info-item"><span class="lm-label">فترة السماح</span><span class="lm-value">' + (d.grace_remaining !== undefined ? d.grace_remaining + ' يوم' : '---') + '</span></div>';
        html += '<div class="lm-info-item"><span class="lm-label">المعرف التعريفي</span><span class="lm-value iv-mono" style="font-size:0.7rem;display:flex;align-items:center;gap:4px;direction:ltr">' + escapeHtml(d.hardware_id || '---') + '</span></div>';
        html += '</div>';
        infoEl.innerHTML = html;
        let mHtml = '<div style="display:flex;flex-wrap:wrap;gap:5px">';
        if (d.modules && d.modules.length > 0) {
            mHtml += d.modules.map(m => '<span class="lm-badge enabled" style="font-size:0.7rem">' + escapeHtml(m) + '</span>').join('');
        } else { mHtml += '<span class="lm-empty">لا توجد وحدات مفعلة</span>'; }
        mHtml += '</div>';
        if (d.features && d.features.length > 0) {
            mHtml += '<h4 class="lm-subtitle" style="margin-top:12px;">الميزات</h4><div style="display:flex;flex-wrap:wrap;gap:5px">';
            mHtml += d.features.map(f => '<span class="lm-badge feature" style="font-size:0.7rem">' + escapeHtml(f) + '</span>').join('');
            mHtml += '</div>';
        }
        modEl.innerHTML = mHtml;
    }).catch(() => {
        infoEl.innerHTML = '<div style="color:var(--danger-color);text-align:center;padding:15px;">تعذر تحميل معلومات الترخيص</div>';
    });
};

// Trigger license view on nav click
document.addEventListener('DOMContentLoaded', function() {
    const nav = document.querySelector('.nav-item[data-target="license"]');
    if (nav) {
        nav.addEventListener('click', function() { setTimeout(loadLicenseView, 100); });
    }
});

