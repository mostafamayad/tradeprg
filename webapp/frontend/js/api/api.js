// ============================================================
// TradePro ERP - Frontend API Client
// Connects the UI to the local Node.js Server
// ============================================================

// Dynamic base URL  works on localhost AND on any device on the same network
const BASE_URL = `/api`;

window.API = {
    // ---- Generic Fetch Wrapper ----
    async request(endpoint, method = 'GET', body = null, options = {}) {
        const silent = !!options.silent;
        let data = {};
        let parseFailed = false;
        try {
            const token = localStorage.getItem('auth_token');
            const tenant = new URLSearchParams(window.location.search).get('tenant');
            const headers = { 
                'Content-Type': 'application/json',
                'Authorization': token ? 'Bearer ' + token : ''
            };
            if (tenant) headers['x-tenant-id'] = tenant;
            const fetchOptions = {
                method,
                headers
            };
            if (body) {
                fetchOptions.body = JSON.stringify(body);
            }

            const response = await fetch(`${BASE_URL}${endpoint}`, fetchOptions);
            try {
                data = await response.json();
            } catch (e) {
                data = { success: false, message: 'استجابة غير صالحة من الخادم' };
                parseFailed = true;
            }

            if (response.status === 401) {
                localStorage.removeItem('auth_token');
                localStorage.removeItem('auth_user');
                if (window.showLogin) window.showLogin();
                throw new Error(data.message || 'انتهت صلاحية الجلسة، الرجاء تسجيل الدخول مجدداً');
            }
            if (response.status === 402) {
                if (window.showLicenseActivation) {
                    window.showLicenseActivation(data);
                }
                throw new Error(data.message || 'الرجاء غير مفعلة');
            }
            if (!data.success) {
                throw new Error(data.message || 'خطأ في العملية');
            }
            return data;
        } catch (error) {
            console.error(`API Error [${method} ${endpoint}]:`, error);
            if (!silent) {
                if (window.showAlert) {
                    window.showAlert(error.message, { type: 'danger', title: 'خطأ' });
                } else {
                    alert('خطأ: ' + error.message);
                }
            }
            throw error;
        }
    },

    
    // ---- Auth ----
    async login(email, password) {
        const tenant = new URLSearchParams(window.location.search).get('tenant');
        const headers = { 'Content-Type': 'application/json' };
        if (tenant) headers['x-tenant-id'] = tenant;
        const res = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ email, password })
        });
        let data = {};
        try {
            data = await res.json();
        } catch (e) {
            throw new Error('تعذر الاتصال بالخادم. طھتأكد أن السيرفر يعمل على http://localhost:3000');
        }
        if (!res.ok || !data.success) {
            throw new Error(data.message || 'بيانات الدخون غير صحيحة');
        }
        return data;
    },
    async getMe() {
        return await this.request('/auth/me', 'GET', null, { silent: true });
    },
    async getLogs(params = {}) {
        const qs = Object.keys(params).filter(k => params[k]).map(k => k + '=' + encodeURIComponent(params[k])).join('&');
        return await this.request('/logs' + (qs ? '?' + qs : ''));
    },
    async exportLogs() {
        const token = localStorage.getItem('auth_token');
        const res = await fetch('/api/logs/export', { headers: { 'Authorization': token ? 'Bearer ' + token : '' } });
        if (!res.ok) throw new Error('Export failed');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'audit_log.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },
    async logout() {
        // Log the logout event
        try { await this.request('/logs/logout', 'POST'); } catch (e) {}
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user');
        location.reload();
    },
    // ---- Users ----
    async getUsers() {
        return await this.request('/users');
    },
    async createUser(data) {
        return await this.request('/users', 'POST', data);
    },
    async updateUserPermissions(id, permissions) {
        return await this.request(`/users/${id}/permissions`, 'PUT', { permissions });
    },
    async updateUserPassword(id, password) {
        return await this.request(`/users/${id}/password`, 'PUT', { password });
    },
    async deleteUser(id) {
        return await this.request(`/users/${id}`, 'DELETE');
    },
    // ---- Customers ----
    async getCustomers(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return await this.request('/customers' + (qs ? '?' + qs : ''));
    },
    async getCustomer(id) {
        return await this.request(`/customers/${id}`);
    },
    async getCustomerStatement(id, fromDate = null, toDate = null, invType = null) {
        let url = `/reports/customer-statement/${id}`;
        const params = new URLSearchParams();
        if (fromDate) params.append('from', fromDate);
        if (toDate) params.append('to', toDate);
        if (invType) params.append('inv_type', invType);
        if (params.toString()) url += '?' + params.toString();
        return await this.request(url);
    },
    async createCustomer(data) {
        return await this.request('/customers', 'POST', data);
    },
    async updateCustomer(id, data) {
        return await this.request(`/customers/${id}`, 'PUT', data);
    },
    async deleteCustomer(id) {
        return await this.request(`/customers/${id}`, 'DELETE');
    },
    async getCustomerActivity(id) {
        return await this.request(`/customers/${id}/activity`);
    },
    async getCustomerAnalytics(id) {
        return await this.request(`/customers/${id}/analytics`);
    },
    async getCustomerRelated(id) {
        return await this.request(`/customers/${id}/related`);
    },
    async logCustomerActivity(id, data) {
        return await this.request(`/customers/${id}/log`, 'POST', data);
    },
    async getCustomerGroups() {
        return await this.request('/customers/groups/list');
    },
    async updateCreditLimit(id, data) {
        return await this.request(`/customers/${id}/credit`, 'PATCH', data);
    },
    async blockCustomer(id, block, reason) {
        return await this.request(`/customers/${id}/block`, 'PATCH', { block, reason });
    },
    async toggleActiveCustomer(id, isActive) {
        return await this.request(`/customers/${id}/active`, 'PATCH', { is_active: isActive });
    },
    async exportCustomersCsv() {
        const token = localStorage.getItem('auth_token');
        const response = await fetch('/api/customers/export/csv', {
            headers: { 'Authorization': token ? 'Bearer ' + token : '' }
        });
        if (!response.ok) throw new Error('فشل التصدير');
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'customers.csv';
        document.body.appendChild(a); a.click();
        a.remove(); window.URL.revokeObjectURL(url);
        return { success: true };
    },
    async importCustomersCsv(csvText) {
        return await this.request('/customers/import', 'POST', { csv: csvText });
    },
    async getCustomerAttachments(id) {
        return await this.request(`/customers/${id}/attachments`);
    },
    async uploadCustomerAttachment(id, file_name, file_data, description) {
        return await this.request(`/customers/${id}/attachments`, 'POST', { file_name, file_data, description });
    },
    async deleteCustomerAttachment(id, attachId) {
        return await this.request(`/customers/${id}/attachments/${attachId}`, 'DELETE');
    },
    getCustomerAttachmentDownloadUrl(id, attachId) {
        return `/api/customers/${id}/attachments/${attachId}/download`;
    },

    // ---- Suppliers ----
    async getSuppliers(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return await this.request('/suppliers' + (qs ? '?' + qs : ''));
    },
    async getSupplier(id) {
        return await this.request(`/suppliers/${id}`);
    },
    async saveSupplier(data, id) {
        if (id) return await this.request('/suppliers/' + id, 'PUT', data);
        return await this.request('/suppliers', 'POST', data);
    },
    async deleteSupplier(id) {
        return await this.request('/suppliers/' + id, 'DELETE');
    },

    // ---- Products ----
    async getProducts(query = '') {
        const url = query ? `/products?q=${encodeURIComponent(query)}` : '/products';
        return await this.request(url);
    },
    async getProduct(id) {
        return await this.request(`/products/${id}`);
    },
    async createProduct(data) {
        return await this.request('/products', 'POST', data);
    },

    // ---- Sales Reps ----
    async getSalesReps() {
        return await this.request('/reps');
    },
    async getManageReps(params = {}) {
        const qs = Object.entries(params).filter(([_,v]) => v !== undefined && v !== null && v !== '').map(([k,v]) => k + '=' + encodeURIComponent(v)).join('&');
        return await this.request('/reps/manage' + (qs ? '?' + qs : ''));
    },
    async getRep(id) {
        return await this.request('/reps/' + id);
    },
    async createRep(data) {
        return await this.request('/reps', 'POST', data);
    },
    async updateRep(id, data) {
        return await this.request('/reps/' + id, 'PUT', data);
    },
    async toggleRep(id) {
        return await this.request('/reps/' + id + '/toggle', 'PUT');
    },
    async getRepStatement(id, params = {}) {
        const qs = Object.entries(params).filter(([_,v]) => v !== undefined && v !== null && v !== '').map(([k,v]) => k + '=' + encodeURIComponent(v)).join('&');
        return await this.request('/reps/' + id + '/statement' + (qs ? '?' + qs : ''));
    },

    // ---- Stores ----
    async getStores() {
        return await this.request('/stores');
    },
    async createStore(data) {
        return await this.request('/stores', 'POST', data);
    },
    async updateStore(id, data) {
        return await this.request('/stores/' + id, 'PUT', data);
    },
    async deleteStore(id) {
        return await this.request('/stores/' + id, 'DELETE');
    },
    async getStoreDependencies(id) {
        return await this.request('/stores/dependencies/' + id);
    },

    // ---- Sales ----
    async getSalesInvoices(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return await this.request('/sales/invoices' + (qs ? '?' + qs : ''));
    },
    async getSalesInvoice(id) {
        return await this.request(`/sales/invoices/${id}`);
    },
    async saveSalesInvoice(invoiceData, invoiceId = null) {
        if (invoiceId) {
            return await this.request(`/sales/invoices/${invoiceId}`, 'PUT', invoiceData);
        }
        return await this.request('/sales/invoices', 'POST', invoiceData);
    },
    async deleteSalesInvoice(id) {
        return await this.request(`/sales/invoices/${id}`, 'DELETE');
    },
    async cancelSalesInvoice(id) {
        return await this.request(`/sales/invoices/${id}/cancel`, 'PUT');
    },
    async saveSalesReturn(returnData) {
        return await this.request('/sales/returns', 'POST', returnData);
    },

    // ---- Sales Returns ----
    async getSalesReturns(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return await this.request('/sales/returns' + (qs ? '?' + qs : ''));
    },
    async createSalesReturn(data) {
        return await this.request('/sales/returns', 'POST', data);
    },

    // ---- Purchases ----
    async getPurchaseInvoices(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return await this.request('/purchases/invoices' + (qs ? '?' + qs : ''));
    },
    async savePurchaseInvoice(invoiceData, id) {
        if (id) {
            return await this.request('/purchases/invoices/' + id, 'PUT', invoiceData);
        }
        return await this.request('/purchases/invoices', 'POST', invoiceData);
    },
    async savePurchaseReturn(returnData) {
        return await this.request('/purchases/returns', 'POST', returnData);
    },
    async getPurchaseReturns(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return await this.request('/purchases/returns' + (qs ? '?' + qs : ''));
    },
    async getPurchaseReturn(id) {
        return await this.request('/purchases/returns/' + id);
    },
    async getPurchaseReturnAvailableQty(invoiceId) {
        return await this.request('/purchases/returns/available-qty/' + invoiceId);
    },
    async getPurchaseInvoice(id) {
        return await this.request('/purchases/invoices/' + id);
    },
    async deletePurchaseInvoice(id) {
        return await this.request('/purchases/invoices/' + id, 'DELETE');
    },
    async deletePurchaseReturn(id) {
        return await this.request('/purchases/returns/' + id, 'DELETE');
    },
    getPurchaseInvoicePrintUrl(id) {
        return BASE_URL + '/reports/purchase-invoice/' + id + '/print';
    },
    openPurchaseInvoicePrint(id) {
        return this.printInIframe(this.getPurchaseInvoicePrintUrl(id));
    },
    getPurchaseReturnPrintUrl(id) {
        return BASE_URL + '/reports/purchase-return/' + id + '/print';
    },
    openPurchaseReturnPrint(id) {
        return this.printInIframe(this.getPurchaseReturnPrintUrl(id));
    },

    // ---- Collections (تحصيل العملاء) ----
    async getCollections(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return await this.request('/collections' + (qs ? '?' + qs : ''));
    },
    async getCollection(id) {
        return await this.request(`/collections/${id}`);
    },
    async createCollection(data) {
        return await this.request('/collections', 'POST', data);
    },
    async deleteCollection(id) {
        return await this.request(`/collections/${id}`, 'DELETE');
    },
    async getCustomerUnpaidInvoices(customerId) {
        return await this.request(`/collections/customer/${customerId}/unpaid`);
    },

    // ---- Treasury / Collections / Payments ----
    async getCollections(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return await this.request('/collections' + (qs ? '?' + qs : ''));
    },
    async createCollection(data) {
        return await this.request('/collections', 'POST', data);
    },
    async getSupplierPayments(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return await this.request('/payments' + (qs ? '?' + qs : ''));
    },
    async createSupplierPayment(data) {
        return await this.request('/payments', 'POST', data);
    },
    async getPayments(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return await this.request('/payments' + (qs ? '?' + qs : ''));
    },
    async createPayment(data) {
        return await this.request('/payments', 'POST', data);
    },
    async deletePayment(id) {
        return await this.request(`/payments/${id}`, 'DELETE');
    },
    async updatePayment(id, data) {
        return await this.request(`/payments/${id}`, 'PUT', data);
    },
    saveSupplierPayment(data) {
        return this.createSupplierPayment(data);
    },
    async getSupplierStatement(supplierId, params = {}) {
        const qs = new URLSearchParams(params).toString();
        return await this.request(`/payments/supplier/${supplierId}/statement` + (qs ? '?' + qs : ''));
    },

    // ---- Treasury ----
    async getTreasuryAccounts() {
        return await this.request('/treasury/accounts');
    },
    async createTreasuryAccount(data) {
        return await this.request('/treasury/accounts', 'POST', data);
    },
    async getTreasuryTransactions(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return await this.request('/treasury/transactions' + (qs ? '?' + qs : ''));
    },
    async createTreasuryTransaction(data) {
        return await this.request('/treasury/transactions', 'POST', data);
    },
    async getTreasurySummary() {
        return await this.request('/treasury/summary');
    },
    async getExpenses(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return await this.request('/treasury/expenses' + (qs ? '?' + qs : ''));
    },
    async createExpense(data) {
        return await this.request('/treasury/expenses', 'POST', data);
    },

    // ---- Inventory ----
    async getInventoryBalances(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return await this.request('/inventory/balances' + (qs ? '?' + qs : ''));
    },
    async getInventoryMovements(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return await this.request('/inventory/movements' + (qs ? '?' + qs : ''));
    },
    async getProductCard(productId) {
        return await this.request(`/inventory/card/${productId}`);
    },
    async getStockTransfers() {
        return await this.request('/inventory/transfers');
    },
    async createStockTransfer(data) {
        return await this.request('/inventory/transfer', 'POST', data);
    },
    async getDamagedStock() {
        return await this.request('/inventory/damaged');
    },
    async createDamagedStock(data) {
        return await this.request('/inventory/damaged', 'POST', data);
    },
    async getStockDisposals() {
        return await this.request('/inventory/disposals');
    },
    async getStockDisposal(id) {
        return await this.request(`/inventory/disposals/${id}`);
    },
    async createStockDisposal(data) {
        return await this.request('/inventory/disposals', 'POST', data);
    },
    async getStockDisposalPrint(id) {
        return await this.request(`/inventory/disposals/${id}/print`);
    },
    async adjustStock(data) {
        return await this.request('/inventory/adjust', 'POST', data);
    },
    async getStockCounts() {
        return await this.request('/inventory/count');
    },
    async createStockCount(data) {
        return await this.request('/inventory/count', 'POST', data);
    },
    async completeStockCount(id, data) {
        return await this.request(`/inventory/count/${id}/complete`, 'POST', data);
    },

    // ---- Reports ----
    async getReportsCustomerList() {
        return await this.request('/reports/customer-list');
    },
    async getSalesByPeriod(from, to) {
        const params = new URLSearchParams();
        if (from) params.append('from', from);
        if (to) params.append('to', to);
        return await this.request('/reports/sales-by-period' + (params.toString() ? '?' + params : ''));
    },
    async getSalesByProduct() {
        return await this.request('/reports/sales-by-product');
    },
    async getSalesByRep() {
        return await this.request('/reports/sales-by-rep');
    },
    async getSalesMonthly() {
        return await this.request('/reports/sales-monthly');
    },
    async getInventorySummary() {
        return await this.request('/reports/inventory-summary');
    },
    async getInventoryValue() {
        return await this.request('/reports/inventory-value');
    },
    async getSlowMoving() {
        return await this.request('/reports/slow-moving');
    },
    async getProfitReport(from, to) {
        const params = new URLSearchParams();
        if (from) params.append('from', from);
        if (to) params.append('to', to);
        return await this.request('/reports/profit' + (params.toString() ? '?' + params : ''));
    },
    async getAgingReport() {
        return await this.request('/collections/reports/aging');
    },
    async getTaxReport(from, to) {
        const params = new URLSearchParams();
        if (from) params.append('from', from);
        if (to) params.append('to', to);
        return await this.request('/reports/tax' + (params.toString() ? '?' + params : ''));
    },
    async getSalesReturnsReport() {
        return await this.request('/reports/sales-returns');
    },
    async getSalesSummary(from, to) {
        const params = new URLSearchParams();
        if (from) params.append('from', from);
        if (to) params.append('to', to);
        return await this.request('/reports/sales-summary' + (params.toString() ? '?' + params : ''));
    },
    //  طباعة عبر Modal (الحل C المضمون) 
    // السبب: window.open() لا يُرسل ترخيص Authorization.
    // الحل: نطلب الـ HTML عبر fetch مع الترخيص، نعرضها في modal مرئي
    //       ثم نطبعها (تلقائياً + زر يدوي كتابياً).
    async printInIframe(url, label) {
        const token = localStorage.getItem('auth_token');
        const sep = url.includes('?') ? '&' : '?';
        const cacheBustUrl = url + sep + '_t=' + Date.now();

        // ملاحظة: لو مفتاح الدخول ينتهي قريباً
        if (!token) {
            alert('لم تسجل الدخول بعد. سجل الدخول للمتابعة.');
            if (window.showLogin) window.showLogin();
            return;
        }
        console.log('[Print] Fetching:', cacheBustUrl, 'with token:', token.substring(0, 20) + '...');

        const modalId = '__pm_' + Date.now();
        const modal = document.createElement('div');
        modal.id = modalId;
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.75);z-index:2147483647;display:flex;flex-direction:column;align-items:center;padding:14px;backdrop-filter:blur(4px);font-family:Cairo,sans-serif;';

        const toolbar = document.createElement('div');
        toolbar.style.cssText = 'background:#1e3a8a;color:#fff;padding:12px 20px;border-radius:10px;margin-bottom:12px;display:flex;gap:12px;align-items:center;box-shadow:0 8px 24px rgba(0,0,0,0.4);max-width:900px;width:100%;justify-content:space-between;flex-wrap:wrap;';
        const _lbl = label || 'الفاتورة';
        toolbar.innerHTML = '<div style="display:flex;align-items:center;gap:10px;font-weight:700;font-size:15px"><i class="fa-solid fa-print"></i> معاينة ' + _lbl + '</div><div id="__st_' + modalId + '" style="font-size:12px;opacity:0.85">⏳ تحميل...</div><div style="display:flex;gap:8px"><button id="__pb_' + modalId + '" style="background:#10b981;color:#fff;border:none;padding:9px 22px;border-radius:8px;cursor:pointer;font-weight:700;font-family:inherit;font-size:14px;opacity:0.4;pointer-events:none"><i class="fa-solid fa-print"></i> طباعة ' + _lbl + '</button><button id="__cb_' + modalId + '" style="background:#dc2626;color:#fff;border:none;padding:9px 18px;border-radius:8px;cursor:pointer;font-weight:700;font-family:inherit;font-size:14px">✖️ إغلاق</button></div>';

        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'width:min(900px,95vw);height:calc(100vh - 100px);background:#fff;border:none;border-radius:10px;box-shadow:0 20px 50px rgba(0,0,0,0.4);';

        modal.appendChild(toolbar);
        modal.appendChild(iframe);
        document.body.appendChild(modal);

        const removeModal = () => { if (modal.parentNode) modal.parentNode.removeChild(modal); };
        toolbar.querySelector('#__cb_' + modalId).onclick = removeModal;
        const statusEl = toolbar.querySelector('#__st_' + modalId);
        const printBtn = toolbar.querySelector('#__pb_' + modalId);

        try {
            console.log('[Print] Starting fetch...');
            const res = await fetch(cacheBustUrl, {
                method: 'GET',
                cache: 'no-store',
                headers: { 'Authorization': token ? 'Bearer ' + token : '', 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
            });
            console.log('[Print] Response:', res.status, res.statusText);

            if (res.status === 401) {
                localStorage.removeItem('auth_token');
                removeModal();
                if (window.showLogin) window.showLogin();
                throw new Error('401 - غير مسرح. سجل دخول تاني.');
            }
            if (!res.ok) {
                const errBody = await res.text().catch(() => '');
                console.error('[Print] API error:', res.status, errBody.substring(0, 200));
                statusEl.textContent = '❌ HTTP ' + res.status + ' - افتح Console (F12)';
                throw new Error('HTTP ' + res.status);
            }

            const html = await res.text();
            // إدخال زر الطباعة الداخلي ظپظٹ الـ iframe (عرض مفتاح تداخل مع زرنا)
            const safeHtml = html.replace(/onclick="window\.print\(\)"/g, 'style="display:none"').replace(/<div class="no-print">[\s\S]*?<\/div>/g, '');
            const blob = new Blob([safeHtml], { type: 'text/html;charset=utf-8' });
            const blobUrl = URL.createObjectURL(blob);
            iframe.src = blobUrl;

            iframe.addEventListener('load', () => {
                statusEl.textContent = '✅ جاهز';
                printBtn.style.opacity = '1';
                printBtn.style.pointerEvents = 'auto';
                setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
            });

            printBtn.onclick = () => {
                try { iframe.contentWindow.focus(); iframe.contentWindow.print(); }
                catch (e) { alert('فشل. اضغط Ctrl+P داخل الفاتورة.'); }
            };
        } catch (err) {
            statusEl.textContent = '❌ ' + (err.message || 'خطأ');
            console.error(err);
        }
    },

    openInvoicePrint(invoiceId) {
        return this.printInIframe(`${BASE_URL}/reports/invoice/${invoiceId}/print`);
    },
    openCollectionPrint(collectionId) {
        return this.printInIframe(`${BASE_URL}/reports/collection/${collectionId}/print`, 'سند القبض');
    },
    openApPaymentPrint(paymentId) {
        return this.printInIframe(`${BASE_URL}/reports/payment/${paymentId}/print`, 'سند الدفع');
    },
    openCustomerStatementPrint(customerId, from, to) {
        const params = new URLSearchParams();
        if (from) params.append('from', from);
        if (to) params.append('to', to);
        const qs = params.toString();
        return this.printInIframe(`${BASE_URL}/reports/customer-statement/${customerId}/print${qs ? '?' + qs : ''}`);
    },

    // ---- Dashboard ----
    async getDashboardStats() {
        return await this.request('/dashboard/stats');
    },
    async getDashboardRecent() {
        return await this.request('/dashboard/recent');
    },
    async getDashboardAlerts() {
        return await this.request('/dashboard/alerts');
    },
    async getSalesChart() {
        return await this.request('/dashboard/chart/sales');
    },

    // ---- Settings ----
    async getSettings() {
        return await this.request('/settings');
    },
    async updateSetting(key, value) {
        return await this.request('/settings', 'POST', { key, value });
    },

    // ============ ENTERPRISE REPORTS ============

    async getCustomerStatementReport(id, from, to) {
        const p = new URLSearchParams();
        if (from) p.append('from', from);
        if (to) p.append('to', to);
        const qs = p.toString();
        return await this.request(`/reports/customer-statement/${id}${qs ? '?' + qs : ''}`);
    },

    async getSalesByPeriodReport(params = {}) {
        const p = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) if (v) p.append(k, v);
        return await this.request(`/reports/sales-by-period?${p.toString()}`);
    },

    async getProductSalesReport(params = {}) {
        const p = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) if (v) p.append(k, v);
        return await this.request(`/reports/product-sales?${p.toString()}`);
    },

    async getVatReport(from, to) {
        const p = new URLSearchParams();
        if (from) p.append('from', from);
        if (to) p.append('to', to);
        return await this.request(`/reports/vat-report?${p.toString()}`);
    },

    async getReceivablesReport() {
        return await this.request('/reports/receivables');
    },

    async getTopCustomersReport(params = {}) {
        const p = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) if (v) p.append(k, v);
        return await this.request(`/reports/top-customers?${p.toString()}`);
    },

    async getRepPerformanceReport(params = {}) {
        const p = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) if (v) p.append(k, v);
        return await this.request(`/reports/rep-performance?${p.toString()}`);
    },

    async getDashboardCardsReport(from, to) {
        const p = new URLSearchParams();
        if (from) p.append('from', from);
        if (to) p.append('to', to);
        return await this.request(`/reports/dashboard-cards?${p.toString()}`);
    },

    // ============ INVENTORY REPORTS ============

    async getInvDashboardReport(params = {}) {
        const p = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) if (v) p.append(k, v);
        return await this.request(`/reports/inventory/dashboard?${p.toString()}`);
    },
    async getInvBalancesReport(params = {}) {
        const p = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) if (v) p.append(k, v);
        return await this.request(`/reports/inventory/balances?${p.toString()}`);
    },
    async getInvMovementReport(productId, params = {}) {
        const p = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) if (v) p.append(k, v);
        return await this.request(`/reports/inventory/movement/${productId}?${p.toString()}`);
    },
    async getInvTransfersReport(params = {}) {
        const p = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) if (v) p.append(k, v);
        return await this.request(`/reports/inventory/transfers?${p.toString()}`);
    },
    async getInvDisposalsReport(params = {}) {
        const p = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) if (v) p.append(k, v);
        return await this.request(`/reports/inventory/disposals?${p.toString()}`);
    },
    async getInvCountsReport(params = {}) {
        const p = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) if (v) p.append(k, v);
        return await this.request(`/reports/inventory/counts?${p.toString()}`);
    },
    async getInvAdjustmentsReport(params = {}) {
        const p = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) if (v) p.append(k, v);
        return await this.request(`/reports/inventory/adjustments?${p.toString()}`);
    },
    async getInvSlowMovingReport(params = {}) {
        const p = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) if (v) p.append(k, v);
        return await this.request(`/reports/inventory/slow-moving?${p.toString()}`);
    },
    async getInvFastMovingReport(params = {}) {
        const p = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) if (v) p.append(k, v);
        return await this.request(`/reports/inventory/fast-moving?${p.toString()}`);
    },
    async getInvValuationReport() {
        return await this.request('/reports/inventory/valuation');
    },

    //  License 
    async getLicenseStatus() {
        const res = await fetch(`${BASE_URL}/license/status`);
        return await res.json();
    },
    async getLicenseHardware() {
        return await this.request('/license/hardware', 'GET', null, { silent: true });
    },
    async activateLicense(licenseBase64) {
        const res = await fetch(`${BASE_URL}/license/activate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ license: licenseBase64 })
        });
        return await res.json();
    },
    async getLicenseHealth() {
        return await this.request('/license/health');
    },
    async getLicenseDiagnostics() {
        return await this.request('/license/diagnostics');
    },
    async getLicenseHistory() {
        return await this.request('/license/history');
    },
    async runLicenseSelfTest() {
        return await this.request('/license/self-test', 'POST');
    },
    async revalidateLicense() {
        return await this.request('/license/revalidate', 'POST');
    },
    async exportDiagnostic() {
        return await this.request('/license/export-diagnostic');
    },
    async refreshHardware() {
        return await this.request('/license/hardware/refresh', 'POST');
    },
    async getHardwareChangeDetection() {
        return await this.request('/license/hardware/change-detection');
    },
    async getClockStatus() {
        return await this.request('/license/hardware/clock-status');
    },

    // ---- AR Payments ----
    async getARPayments(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return await this.request('/ar/payments' + (qs ? '?' + qs : ''));
    },
    async getARPayment(id) {
        return await this.request('/ar/payments/' + id);
    },
    async createARPayment(data) {
        return await this.request('/ar/payments', 'POST', data);
    },
    async reverseARPayment(id) {
        return await this.request('/ar/payments/' + id, 'DELETE');
    },
    async getARUnpaidInvoices(customerId) {
        return await this.request('/ar/payments/customer/' + customerId + '/unpaid');
    },
    async getARStatement(customerId, params = {}) {
        const qs = new URLSearchParams(params).toString();
        return await this.request('/ar/payments/customer/' + customerId + '/statement' + (qs ? '?' + qs : ''));
    },

    // ---- AR Matching (Phase 3) ----
    async getARMatchingCustomers() {
        return await this.request('/ar/payments/matching/customers');
    },
    async getARMatchingData(customerId) {
        return await this.request('/ar/payments/matching/data/' + customerId);
    },
    async saveARMatching(data) {
        return await this.request('/ar/payments/matching/save', 'POST', data);
    },

    // ---- AR Cheques ----
    async getARCheques(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return await this.request('/ar/cheques' + (qs ? '?' + qs : ''));
    },
    async getARCheque(id) {
        return await this.request('/ar/cheques/' + id);
    },
    async createARCheque(data) {
        return await this.request('/ar/cheques', 'POST', data);
    },
    async updateARCheque(id, data) {
        return await this.request('/ar/cheques/' + id, 'PUT', data);
    },
    async deleteARCheque(id) {
        return await this.request('/ar/cheques/' + id, 'DELETE');
    },
    async updateARChequeStatus(id, status, notes) {
        return await this.request('/ar/cheques/' + id + '/status', 'PATCH', { status, notes });
    },
    async depositARCheque(id) {
        return await this.request('/ar/cheques/' + id + '/deposit', 'PATCH');
    },
    async collectARCheque(id) {
        return await this.request('/ar/cheques/' + id + '/collect', 'PATCH');
    },
    async returnARCheque(id) {
        return await this.request('/ar/cheques/' + id + '/return', 'PATCH');
    },
    async cancelARCheque(id) {
        return await this.request('/ar/cheques/' + id + '/cancel', 'PATCH');
    },

    // ---- AR Security Cheques ----
    async getARSecurityCheques(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return await this.request('/ar/security-cheques' + (qs ? '?' + qs : ''));
    },
    async createARSecurityCheque(data) {
        return await this.request('/ar/security-cheques', 'POST', data);
    },
    async returnARSecurityCheque(id) {
        return await this.request('/ar/security-cheques/' + id + '/return', 'PATCH');
    },
    async cashARSecurityCheque(id) {
        return await this.request('/ar/security-cheques/' + id + '/cash', 'PATCH');
    },

    // ---- AR Notes ----
    async getARNotes(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return await this.request('/ar/notes' + (qs ? '?' + qs : ''));
    },
    async createARNote(data) {
        return await this.request('/ar/notes', 'POST', data);
    },
    async reverseARNote(id) {
        return await this.request('/ar/notes/' + id, 'DELETE');
    },

    // ---- AP Matching ----
    async getAPMatchingSuppliers() {
        return await this.request('/ap/payments/matching/suppliers');
    },
    async getAPMatchingData(supplierId) {
        return await this.request('/ap/payments/matching/data/' + supplierId);
    },
    async saveAPMatching(data) {
        return await this.request('/ap/payments/matching/save', 'POST', data);
    },

    // ---- AP Payments ----
    async getAPPayments(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return await this.request('/ap/payments' + (qs ? '?' + qs : ''));
    },
    async getAPPayment(id) {
        return await this.request('/ap/payments/' + id);
    },
    async createAPPayment(data) {
        return await this.request('/ap/payments', 'POST', data);
    },
    async reverseAPPayment(id) {
        return await this.request('/ap/payments/' + id, 'DELETE');
    },
    async getAPUnpaidInvoices(supplierId) {
        return await this.request('/ap/payments/supplier/' + supplierId + '/unpaid');
    },
    async getAPStatement(supplierId, params = {}) {
        const qs = new URLSearchParams(params).toString();
        return await this.request('/ap/payments/supplier/' + supplierId + '/statement' + (qs ? '?' + qs : ''));
    },

    // ---- AP Cheques ----
    async getAPCheques(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return await this.request('/ap/cheques' + (qs ? '?' + qs : ''));
    },
    async createAPCheque(data) {
        return await this.request('/ap/cheques', 'POST', data);
    },
    async updateAPChequeStatus(id, status, notes) {
        return await this.request('/ap/cheques/' + id + '/status', 'PATCH', { status, notes });
    },
    async clearAPCheque(id) {
        return await this.request('/ap/cheques/' + id + '/clear', 'PATCH');
    },
    async returnAPCheque(id) {
        return await this.request('/ap/cheques/' + id + '/return', 'PATCH');
    },
    async cancelAPCheque(id) {
        return await this.request('/ap/cheques/' + id + '/cancel', 'PATCH');
    },

    // ---- AP Notes ----
    async getAPNotes(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return await this.request('/ap/notes' + (qs ? '?' + qs : ''));
    },
    async createAPNote(data) {
        return await this.request('/ap/notes', 'POST', data);
    },
    async reverseAPNote(id) {
        return await this.request('/ap/notes/' + id, 'DELETE');
    },

    // ---- HR / Employees ----
    async getHREmployees(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return await this.request('/hr/employees' + (qs ? '?' + qs : ''));
    },
    async getHREmployee(id) {
        return await this.request('/hr/employees/' + id);
    },
    async createHREmployee(data) {
        return await this.request('/hr/employees', 'POST', data);
    },
    async updateHREmployee(id, data) {
        return await this.request('/hr/employees/' + id, 'PUT', data);
    },
    async deleteHREmployee(id) {
        return await this.request('/hr/employees/' + id, 'DELETE');
    },
    async toggleHREmployee(id) {
        return await this.request('/hr/employees/' + id + '/toggle', 'PATCH');
    },
    async getHRDepartments() {
        return await this.request('/hr/employees/departments');
    },
    async getHRStats() {
        return await this.request('/hr/stats');
    },

    // ---- HR / Loans ----
    async getHRLoans(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return await this.request('/hr/loans' + (qs ? '?' + qs : ''));
    },
    async createHRLoan(data) {
        return await this.request('/hr/loans', 'POST', data);
    },
    async updateHRLoan(id, data) {
        return await this.request('/hr/loans/' + id, 'PUT', data);
    },
    async repayHRLoan(id, amount) {
        return await this.request('/hr/loans/' + id + '/repay', 'POST', { amount });
    },
    async deleteHRLoan(id) {
        return await this.request('/hr/loans/' + id, 'DELETE');
    },

    // ---- HR / Payroll ----
    async getHRPayroll(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return await this.request('/hr/payroll' + (qs ? '?' + qs : ''));
    },
    async generateHRPayroll(period) {
        return await this.request('/hr/payroll/generate', 'POST', { period });
    },
    async updateHRPayrollSlip(id, data) {
        return await this.request('/hr/payroll/' + id, 'PUT', data);
    },
    async postHRPayrollSlip(id) {
        return await this.request('/hr/payroll/' + id + '/post', 'POST');
    },
    async cancelHRPayrollSlip(id) {
        return await this.request('/hr/payroll/' + id + '/cancel', 'POST');
    },
    async deleteHRPayrollSlip(id) {
        return await this.request('/hr/payroll/' + id, 'DELETE');
    },
    async getHRPayrollPeriods() {
        return await this.request('/hr/payroll/periods');
    },

    // ---- HR / Attendance ----
    async getHRAttendance(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return await this.request('/hr/attendance' + (qs ? '?' + qs : ''));
    },
    async getHRAttendanceSummary(month) {
        return await this.request('/hr/attendance/summary?month=' + encodeURIComponent(month));
    },
    async createHRAttendance(data) {
        return await this.request('/hr/attendance', 'POST', data);
    },
    async createHRAttendanceBulk(records) {
        return await this.request('/hr/attendance/bulk', 'POST', { records });
    },
    async updateHRAttendance(id, data) {
        return await this.request('/hr/attendance/' + id, 'PUT', data);
    },
    async deleteHRAttendance(id) {
        return await this.request('/hr/attendance/' + id, 'DELETE');
    },

    // ---- HR / Vacations ----
    async getHRVacations(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return await this.request('/hr/vacations' + (qs ? '?' + qs : ''));
    },
    async getHRVacationBalance() {
        return await this.request('/hr/vacations/balance');
    },
    async createHRVacation(data) {
        return await this.request('/hr/vacations', 'POST', data);
    },
    async updateHRVacation(id, data) {
        return await this.request('/hr/vacations/' + id, 'PUT', data);
    },
    async approveHRVacation(id) {
        return await this.request('/hr/vacations/' + id + '/approve', 'PATCH');
    },
    async rejectHRVacation(id, reason) {
        return await this.request('/hr/vacations/' + id + '/reject', 'PATCH', { reason });
    },
    async deleteHRVacation(id) {
        return await this.request('/hr/vacations/' + id, 'DELETE');
    },

    // ---- HR / Penalties ----
    async getHRPenalties(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return await this.request('/hr/penalties' + (qs ? '?' + qs : ''));
    },
    async createHRPenalty(data) {
        return await this.request('/hr/penalties', 'POST', data);
    },
    async updateHRPenalty(id, data) {
        return await this.request('/hr/penalties/' + id, 'PUT', data);
    },
    async deleteHRPenalty(id) {
        return await this.request('/hr/penalties/' + id, 'DELETE');
    },

    // ---- HR / Rewards ----
    async getHRRewards(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return await this.request('/hr/rewards' + (qs ? '?' + qs : ''));
    },
    async createHRReward(data) {
        return await this.request('/hr/rewards', 'POST', data);
    },
    async updateHRReward(id, data) {
        return await this.request('/hr/rewards/' + id, 'PUT', data);
    },
    async deleteHRReward(id) {
        return await this.request('/hr/rewards/' + id, 'DELETE');
    }
};


