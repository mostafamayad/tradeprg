// ============================================================
// TradePro ERP - Views Wiring Layer
// ============================================================
// يربط شاشات الواجهة الأمامية بالـ APIs الحقيقية
// ============================================================

(function () {
    'use strict';

    const BASE = '/api';
    const fmt = (n) => {
        const v = Number(n || 0);
        const cls = v > 0 ? 'amount-positive' : v < 0 ? 'amount-negative' : '';
        const formatted = v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return cls ? '<span class="' + cls + '">' + formatted + '</span>' : formatted;
    };
    const fmtPlain = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtInt = (n) => Number(n || 0).toLocaleString('en-US');
    const esc = (v) => String(v || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

    // Export utilities globally for extracted views
    window.req = req;
    window.fmt = fmt;
    window.fmtPlain = fmtPlain;
    window.fmtInt = fmtInt;
    window.esc = esc;
    window.num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

    // Make viewHandlers global so extracted files can add to it
    window.viewHandlers = window.viewHandlers || {};
    const viewHandlers = window.viewHandlers;
    async function req(endpoint, method = 'GET', body = null) {
        try {
            const token = localStorage.getItem('auth_token');
            const opt = { method, headers: { 'Content-Type': 'application/json' } };
            if (token) opt.headers['Authorization'] = 'Bearer ' + token;
            if (body) opt.body = JSON.stringify(body);
            const res = await fetch(`${BASE}${endpoint}`, opt);
            const data = await res.json();
            if (!data.success) throw new Error(data.message || 'خطأ في العملية');
            return data;
        } catch (e) {
            console.error(`API [${method} ${endpoint}]`, e);
            return { success: false, message: e.message, data: [] };
        }
    }

    // ============================================================
    // NAVIGATION HOOK - تحميل بيانات الـ view عند فتحها
    // ============================================================
    

    // ============================================================
    // يتم إعادة تحميل الـ handler عبر classList.remove('active-view') +
    // classList.add('active-view') في app.js — لا حاجة لإعادة تعيين dataset.bound هنا
    // ============================================================

    document.addEventListener('DOMContentLoaded', () => {
        // رصد تغيير class/style على كل view — هذا هو المصدر الوحيد لتحميل البيانات
        const observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                if (m.type === 'attributes' && (m.attributeName === 'class' || m.attributeName === 'style')) {
                    const view = m.target;
                    if (view.classList.contains('view') && view.classList.contains('active-view')) {
                        const handler = viewHandlers[view.id];
                        if (handler && !view.dataset.bound) {
                            view.dataset.bound = '1';
                            try { handler(); } catch (e) { console.error(e); }
                        }
                    }
                }
            }
        });
        document.querySelectorAll('.view').forEach(v => observer.observe(v, { attributes: true, attributeFilter: ['style', 'class'] }));

        // فحص احتياطي كل ثانيتين — فقط في حال فشل الـ observer
        setInterval(() => {
            const active = document.querySelector('.view.active-view');
            if (!active || active.dataset.bound) return;
            const handler = viewHandlers[active.id];
            if (handler) {
                active.dataset.bound = '1';
                try { handler(); } catch (e) { console.error(e); }
            }
        }, 2000);
    });

    // ============================================================
    // VIEW: EXECUTIVE DASHBOARD (BI)
    // ============================================================
    
    // viewHandlers['view-executive-dashboard'] extracted to viewDashboards.js
    
    // window.loadExecutiveDashboard = function extracted to viewDashboards.js

    // ============================================================
    // VIEW: CASH FLOW (BI-2)
    // ============================================================

    // viewHandlers['view-cash-flow'] extracted to viewFinance.js

    // window.loadCashFlow = function extracted to viewFinance.js

    // ============================================================
    // VIEW: COLLECTIONS
    // ============================================================
    // viewHandlers['view-collections'] extracted to viewFinance.js

    // function openCollectionModal() extracted to viewFinance.js

    // ============================================================
    // VIEW: AGING DASHBOARD (BI-3)
    // ============================================================

    // viewHandlers['view-aging'] extracted to viewFinance.js

    // window.loadAging = function extracted to viewFinance.js

    // ============================================================
    // VIEW: INVENTORY ANALYTICS (BI-4)
    // ============================================================

    // viewHandlers['view-inventory-analytics'] extracted to viewInventoryManagement.js

    // window.loadInventoryAnalytics = function extracted to viewInventoryManagement.js

    // ============================================================
    // VIEW: PROFITABILITY ANALYTICS (BI-5)
    // ============================================================

    // viewHandlers['view-profitability'] extracted to viewFinance.js

    // window.loadProfitability = function extracted to viewFinance.js

    // ============================================================
    // VIEW: INVENTORY
    // ============================================================
    // viewHandlers['view-inventory'] extracted to viewInventoryManagement.js

    // ============================================================
    // VIEW: INVENTORY CARD
    // ============================================================
    // viewHandlers['view-inventory-card'] extracted to viewInventoryManagement.js

    // viewHandlers['view-inventory-transfers'] extracted to viewInventoryManagement.js

    // ============================================================
    // VIEW: INVENTORY DAMAGED
    // ============================================================
    // viewHandlers['view-inventory-damaged'] extracted to viewInventoryManagement.js

    // ============================================================
    // VIEW: STOCK COUNT
    // ============================================================
    // viewHandlers['view-stock-count'] extracted to viewInventoryManagement.js

    // ============================================================
    // VIEW: STOCK ADJUST
    // ============================================================
    // viewHandlers['view-stock-adjust'] extracted to viewInventoryManagement.js

    // ============================================================
    // VIEW: SUPPLIER PAYMENTS
    // ============================================================
    // viewHandlers['view-supplier-payments'] extracted to viewSupplierFinance.js

    // function showPaymentDetail(id extracted to viewSupplierFinance.js

    // function openPaymentModal(payData) extracted to viewSupplierFinance.js

    // ============================================================
    // VIEW: SUPPLIER STATEMENT
    // ============================================================
    // viewHandlers['view-supplier-statement'] extracted to viewSupplierFinance.js

    // ============================================================
    // VIEW: TREASURY
    // ============================================================
    // viewHandlers['view-treasury'] removed

    // ============================================================
    // VIEW: REPORTS SALES - ربط روابط التقارير
    // ============================================================
    // viewHandlers['view-reports-sales'] removed

    // ============================================================
    // VIEW: REPORTS PURCHASES
    // ============================================================
    // viewHandlers['view-reports-purchases'] removed

    // ============================================================
    // VIEW: REPORTS INVENTORY
    // ============================================================
    // ============================================================
    // البحث التلقائي عن الصنف في فاتورة المبيعات/المشتريات
    // ============================================================
    document.addEventListener('input', async (e) => {
        if (!e.target.classList.contains('item-search')) return;
        const input = e.target;
        const val = input.value.trim();
        if (val.length < 2) return;
        if (input.dataset.lastSearch === val) return;
        input.dataset.lastSearch = val;

        const r = await req('/products?q=' + encodeURIComponent(val));
        if (!r.success || !r.data || r.data.length === 0) return;
        const row = input.closest('.invoice-row, .pinvoice-row');
        if (!row) return;
        const match = r.data[0];
        const priceInput = row.querySelector('.item-price, .pitem-cost');
        if (priceInput) priceInput.value = match.sell_price || match.cost_price || 0;
        const sellInput = row.querySelector('.pitem-sell');
        if (sellInput) sellInput.value = match.sell_price || 0;
        row.dataset.productId = match.id;
        input.dataset.matchedId = match.id;
        input.dataset.matchedName = match.product_name;

        if (typeof calcInvoice === 'function') calcInvoice();
        else if (window.calcInvoice) window.calcInvoice();
    });

    // ============================================================
    // تصدير الـ handlers
    // ============================================================
    window.TradeProViews = {
        handlers: viewHandlers,
        reload: (viewId) => {
            const v = document.getElementById(viewId);
            if (v) v.dataset.bound = '';
            if (viewHandlers[viewId]) viewHandlers[viewId]();
        }
    };

    console.log('[TradePro] Views wiring loaded âœ“');





    // ============================================================
    // VIEW: SALES CREDIT LIMITS
    // ============================================================
    // viewHandlers['view-sales-credit'] extracted to viewSalesSettings.js

    // ============================================================
    // VIEW: STORES MANAGEMENT
    // ============================================================
    // viewHandlers['view-stores-management'] extracted to viewSalesSettings.js

    // window.loadStoresManagement = function extracted to viewSalesSettings.js

    // function openStoreForm(storeData) extracted to viewSalesSettings.js

    // Wire store form save
    document.addEventListener('click', (e) => {
        const saveBtn = e.target.closest('#btn-save-store');
        if (!saveBtn) return;
        const id = document.getElementById('sf-id')?.value;
        const code = document.getElementById('sf-code')?.value?.trim();
        const name = document.getElementById('sf-name')?.value?.trim();
        const type = document.getElementById('sf-type')?.value;
        const status = document.getElementById('sf-status')?.value;
        const notes = document.getElementById('sf-notes')?.value?.trim();
        if (!code || !name) { alert('الكود والاسم مطلوبان'); return; }
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';
        const payload = { store_code: code, store_name: name, store_type: type, status, notes };
        const method = id ? window.API.updateStore(id, payload) : window.API.createStore(payload);
        method.then(r => {
            if (r.success) {
                alert(r.message || (id ? 'تم التعديل' : 'تم الإضافة'));
                document.getElementById('modal-store-form').classList.remove('open');
                if (window.TradeProViews) window.TradeProViews.reload('view-stores-management');
            } else {
                alert(r.message || 'حدث خطأ');
            }
        }).catch(e => alert('خطأ في الاتصال')).finally(() => {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> حفظ المخزن';
        });
    });

    // ============================================================
    // VIEW: SETTINGS - Enterprise Configuration Center
    // ============================================================
    // viewHandlers['view-settings'] removed

    // ============================================================
    // VIEW: INVENTORY REPORTS
    // ============================================================
    // viewHandlers['view-reports-inventory'] removed

    // ============================================================
    // VIEW: USERS MANAGEMENT (RBAC)
    // ============================================================
    viewHandlers['view-view-users'] = function() {
        var mainEl = document.getElementById('view-users-content');
        if (mainEl && typeof window.viewUsers === 'function') {
            window.viewUsers(mainEl);
        }
    };

    // ── Auto-loader wrappers for views without explicit window.load ──
    var _autoLoadViews = ['inventory', 'stock-count', 'stock-adjust', 'supplier-statement', 'crm-settlements', 'crm-settlements-report', 'crm-targets', 'crm-workplan', 'sales-serials', 'sales-credit', 'new-year', 'fixed-assets', 'fiscal-periods', 'hr', 'payroll', 'hr-loans', 'license', 'collections'];
    _autoLoadViews.forEach(function (id) {
        var fnName = 'load' + id.charAt(0).toUpperCase() + id.slice(1).replace(/-([a-z])/g, function (g) { return g[1].toUpperCase(); });
        if (typeof window[fnName] !== 'function') {
            window[fnName] = function () {
                var handler = viewHandlers['view-' + id];
                if (handler) handler();
            };
        }
    });

})();
