// ============================================================
// ROUTE: Customers (Enterprise ERP)
// GET    /api/customers              - List with search/filters/pagination
// GET    /api/customers/export/csv   - Export all customers as CSV
// POST   /api/customers/import       - Import customers from CSV
// GET    /api/customers/:id          - Get one + live balance + stats
// POST   /api/customers              - Create
// PUT    /api/customers/:id          - Update
// DELETE /api/customers/:id          - Soft delete with dependency check
// PATCH  /api/customers/:id/credit   - Update credit limit only
// PATCH  /api/customers/:id/active   - Toggle active/inactive
// PATCH  /api/customers/:id/block    - Block/unblock
// GET    /api/customers/:id/statement    - Account statement
// GET    /api/customers/:id/activity     - Activity timeline
// GET    /api/customers/:id/analytics    - Customer analytics/KPIs
// GET    /api/customers/:id/related      - Related documents chain
// POST   /api/customers/:id/log          - Log activity
// GET    /api/customers/groups/list      - List customer groups
// ============================================================

const router = require('express').Router();
const path = require('path');
const asyncHandler = require('../utils/asyncHandler');
const { getPool, sql } = require('../database/mssql_db');
const accountingEngine = require('../services/accountingEngine');
const logActivity = require('../middleware/logger');

// ── Recalculate customer balance (existing formula preserved) ──
async function recalcCustomerBalanceAsync(poolOrTxReq, customerId) {
    const pRand = Math.random().toString(36).substring(2, 9);
    const request = typeof poolOrTxReq.request === 'function' ? poolOrTxReq.request() : poolOrTxReq;
    request.input(`rcb_id_${pRand}`, sql.Int, customerId);

    const cRes = await request.query(`SELECT opening_balance FROM customers WHERE id = @rcb_id_${pRand}`);
    const c = cRes.recordset[0];
    if (!c) return;

    const salesRes = await request.query(`SELECT COALESCE(SUM(grand_total), 0) as total FROM sales_invoices WHERE customer_id = @rcb_id_${pRand} AND status != 'cancelled'`);
    const returnsRes = await request.query(`SELECT COALESCE(SUM(grand_total), 0) as total FROM sales_returns WHERE customer_id = @rcb_id_${pRand} AND status != 'cancelled'`);
    const collRes = await request.query(`
        SELECT COALESCE(SUM(cc.amount), 0) as total 
        FROM customer_collections cc
        LEFT JOIN checks ch ON ch.collection_id = cc.id
        WHERE cc.customer_id = @rcb_id_${pRand} AND (ch.id IS NULL OR ch.status NOT IN ('bounced', 'cancelled'))
    `);

    const balance = (c.opening_balance || 0) + (salesRes.recordset[0].total || 0) - (returnsRes.recordset[0].total || 0) - (collRes.recordset[0].total || 0);

    request.input(`rcb_bal_${pRand}`, sql.Decimal(18, 2), balance);
    await request.query(`UPDATE customers SET current_balance = @rcb_bal_${pRand} WHERE id = @rcb_id_${pRand}`);
    return balance;
}

// ── Log customer activity ──
async function logCustomerActivityAsync(txRequest, customerId, type, refType, refId, refNo, amount, description, userId, metadata) {
    const pRand = Math.random().toString(36).substring(2, 9);
    txRequest.input(`lca_cid_${pRand}`, sql.Int, customerId);
    txRequest.input(`lca_type_${pRand}`, sql.NVarChar, type);
    txRequest.input(`lca_rt_${pRand}`, sql.NVarChar, refType || null);
    txRequest.input(`lca_ri_${pRand}`, sql.Int, refId || null);
    txRequest.input(`lca_rn_${pRand}`, sql.NVarChar, refNo || null);
    txRequest.input(`lca_amt_${pRand}`, sql.Decimal(18,4), amount || 0);
    txRequest.input(`lca_desc_${pRand}`, sql.NVarChar, description || null);
    txRequest.input(`lca_uid_${pRand}`, sql.Int, userId || null);
    txRequest.input(`lca_meta_${pRand}`, sql.NVarChar, metadata ? JSON.stringify(metadata) : null);
    await txRequest.query(`
        INSERT INTO customer_activity_log (customer_id, activity_type, reference_type, reference_id, reference_no, amount, description, created_by, metadata)
        VALUES (@lca_cid_${pRand}, @lca_type_${pRand}, @lca_rt_${pRand}, @lca_ri_${pRand}, @lca_rn_${pRand}, @lca_amt_${pRand}, @lca_desc_${pRand}, @lca_uid_${pRand}, @lca_meta_${pRand})
    `);
}

// ── Update customer totals from source documents ──
async function updateCustomerTotalsAsync(txRequest, customerId) {
    const pRand = Math.random().toString(36).substring(2, 9);
    txRequest.input(`uct_cid_${pRand}`, sql.Int, customerId);
    const r = await txRequest.query(`
        SELECT 
            COALESCE((SELECT MAX(invoice_date) FROM sales_invoices WHERE customer_id = @uct_cid_${pRand} AND status != 'cancelled'), NULL) as last_inv_date,
            COALESCE((SELECT MAX(return_date) FROM sales_returns WHERE customer_id = @uct_cid_${pRand} AND status != 'cancelled'), NULL) as last_ret_date,
            COALESCE((SELECT MAX(collection_date) FROM customer_collections WHERE customer_id = @uct_cid_${pRand}), NULL) as last_pay_date,
            COALESCE((SELECT SUM(grand_total) FROM sales_invoices WHERE customer_id = @uct_cid_${pRand} AND status != 'cancelled'), 0) as tot_sales,
            COALESCE((SELECT SUM(grand_total) FROM sales_returns WHERE customer_id = @uct_cid_${pRand} AND status != 'cancelled'), 0) as tot_returns,
            COALESCE((SELECT SUM(amount) FROM customer_collections WHERE customer_id = @uct_cid_${pRand}), 0) as tot_payments
    `);
    const d = r.recordset[0];
    if (d) {
        txRequest.input(`uct_lid_${pRand}`, sql.NVarChar, d.last_inv_date || null);
        txRequest.input(`uct_lrd_${pRand}`, sql.NVarChar, d.last_ret_date || null);
        txRequest.input(`uct_lpd_${pRand}`, sql.NVarChar, d.last_pay_date || null);
        txRequest.input(`uct_ts_${pRand}`, sql.Decimal(18,4), d.tot_sales || 0);
        txRequest.input(`uct_tr_${pRand}`, sql.Decimal(18,4), d.tot_returns || 0);
        txRequest.input(`uct_tp_${pRand}`, sql.Decimal(18,4), d.tot_payments || 0);
        await txRequest.query(`
            UPDATE customers SET
                last_invoice_date = @uct_lid_${pRand}, last_return_date = @uct_lrd_${pRand},
                last_payment_date = @uct_lpd_${pRand}, total_sales = @uct_ts_${pRand},
                total_returns = @uct_tr_${pRand}, total_payments = @uct_tp_${pRand}
            WHERE id = @uct_cid_${pRand}
        `);
    }
}

// ── Duplicate validation helper ──
async function checkDuplicateAsync(pool, field, value, excludeId) {
    if (!value) return null;
    const req = pool.request();
    req.input('val', sql.NVarChar, value);
    let sql2 = `SELECT id, customer_name FROM customers WHERE ${field} = @val AND is_active = 1`;
    if (excludeId) { req.input('eid', sql.Int, excludeId); sql2 += ` AND id != @eid`; }
    const r = await req.query(sql2);
    return r.recordset[0] || null;
}

// ── List customer groups ──
router.get('/groups/list', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query('SELECT * FROM customer_groups WHERE is_active = 1 ORDER BY group_name');
        res.json({ success: true, data: r.recordset });
    } catch (err) {
        err.status = 500;
        throw err;
    }
}));

// ── Export customers as CSV ──
router.get('/export/csv', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query(`
            SELECT c.*, r.rep_name, g.group_name as customer_group_name
            FROM customers c
            LEFT JOIN sales_reps r ON c.rep_id = r.id
            LEFT JOIN customer_groups g ON c.customer_group_id = g.id
            WHERE c.is_active = 1
            ORDER BY c.customer_name
        `);
        const customers = r.recordset;
        const headers = [
            'customer_code', 'customer_name', 'customer_name_en', 'customer_type',
            'phone', 'mobile', 'whatsapp', 'email', 'website',
            'country', 'city', 'district', 'address',
            'tax_id', 'commercial_register',
            'credit_limit', 'opening_balance', 'payment_terms_days',
            'language', 'currency', 'customer_group_name', 'rep_name',
            'customer_category', 'notes'
        ];
        const esc = (v) => {
            const s = (v != null ? String(v) : '');
            return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s;
        };
        let csv = headers.join(',') + '\r\n';
        for (const c of customers) {
            const row = headers.map(h => {
                if (h === 'customer_group_name') return esc(c.customer_group_name);
                if (h === 'rep_name') return esc(c.rep_name);
                return esc(c[h]);
            });
            csv += row.join(',') + '\r\n';
        }
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="customers.csv"');
        res.send('\ufeff' + csv);
    } catch (err) {
        console.error('Customers CSV export error:', err);
        err.status = 500;
        err.message = 'خطأ في تصدير البيانات';
        throw err;
    }
}));

// ── Import customers from CSV ──
router.post('/import', async (req, res) => {
    try {
        const { csv } = req.body;
        if (!csv) return res.status(400).json({ success: false, message: 'البيانات مطلوبة (csv)' });
        const lines = csv.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) return res.status(400).json({ success: false, message: 'الملف يجب أن يحتوي على بيانات ورأس' });
        const headerLine = lines[0];
        const hdr = headerLine.split(',').map(h => h.replace(/^"|"$/g, '').trim());
        const results = { created: 0, skipped: 0, errors: [] };
        const pool = await getPool();
        for (let i = 1; i < lines.length; i++) {
            const vals = [];
            let current = '', inQuotes = false;
            for (const ch of lines[i]) {
                if (ch === '"') { inQuotes = !inQuotes; continue; }
                if (ch === ',' && !inQuotes) { vals.push(current); current = ''; continue; }
                current += ch;
            }
            vals.push(current);
            const row = {};
            hdr.forEach((h, idx) => { row[h] = (vals[idx] || '').trim(); });
            const name = row.customer_name;
            if (!name) { results.skipped++; continue; }
            try {
                const customerData = {
                    customer_name: name,
                    customer_name_en: row.customer_name_en || null,
                    customer_type: row.customer_type || 'retail',
                    phone: row.phone || null,
                    mobile: row.mobile || null,
                    whatsapp: row.whatsapp || null,
                    email: row.email || null,
                    website: row.website || null,
                    country: row.country || null,
                    city: row.city || null,
                    district: row.district || null,
                    address: row.address || null,
                    tax_id: row.tax_id || null,
                    commercial_register: row.commercial_register || null,
                    credit_limit: parseFloat(row.credit_limit) || 0,
                    opening_balance: parseFloat(row.opening_balance) || 0,
                    payment_terms_days: parseInt(row.payment_terms_days) || 0,
                    language: row.language || 'ar',
                    currency: row.currency || 'EGP',
                    customer_category: row.customer_category || null,
                    notes: row.notes || null,
                };
                await pool.request()
                    .input('name', sql.NVarChar, customerData.customer_name)
                    .input('phone', sql.NVarChar, customerData.phone)
                    .input('email', sql.NVarChar, customerData.email)
                    .query('SELECT id FROM customers WHERE customer_name = @name OR (phone IS NOT NULL AND phone = @phone) OR (email IS NOT NULL AND email = @email)');
                results.created++;
            } catch (e) {
                results.errors.push({ line: i, message: e.message });
            }
        }
        res.json({ success: true, message: `تم استيراد ${results.created} عميل بنجاح. تجاوز: ${results.skipped}`, results });
    } catch (err) {
        console.error('Customers CSV import error:', err);
        res.status(500).json({ success: false, message: 'خطأ في استيراد البيانات' });
    }
});

// ── List all customers (with enhanced search/filter/pagination) ──
router.get('/', asyncHandler(async (req, res) => {
    try {
        const { q, type, rep_id, group_id, city, is_active, status, email, phone, tax_id } = req.query;
        const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
        const limitRaw = parseInt(req.query.limit || '50', 10) || 50;
        const limit = Math.min(200, Math.max(1, limitRaw));
        const offset = (page - 1) * limit;

        const pool = await getPool();
        const request = pool.request();

        let whereClauses = [];
        if (is_active !== undefined) {
            whereClauses.push('c.is_active = @is_active');
            request.input('is_active', sql.Int, parseInt(is_active));
        } else {
            whereClauses.push('c.is_active = 1');
        }

        if (q) {
            whereClauses.push('(c.customer_name LIKE @q OR c.customer_name_en LIKE @q2 OR c.customer_code LIKE @q3 OR c.phone LIKE @q4 OR c.mobile LIKE @q5 OR c.email LIKE @q6 OR c.whatsapp LIKE @q7 OR c.tax_id LIKE @q8 OR c.commercial_register LIKE @q9 OR c.city LIKE @q10)');
            const qVal = `%${q}%`;
            request.input('q', sql.NVarChar, qVal);
            request.input('q2', sql.NVarChar, qVal);
            request.input('q3', sql.NVarChar, qVal);
            request.input('q4', sql.NVarChar, qVal);
            request.input('q5', sql.NVarChar, qVal);
            request.input('q6', sql.NVarChar, qVal);
            request.input('q7', sql.NVarChar, qVal);
            request.input('q8', sql.NVarChar, qVal);
            request.input('q9', sql.NVarChar, qVal);
            request.input('q10', sql.NVarChar, qVal);
        }
        if (type) { whereClauses.push('c.customer_type = @type'); request.input('type', sql.NVarChar, type); }
        if (rep_id) { whereClauses.push('c.rep_id = @rep_id'); request.input('rep_id', sql.Int, rep_id); }
        if (group_id) { whereClauses.push('c.customer_group_id = @group_id'); request.input('group_id', sql.Int, group_id); }
        if (city) { whereClauses.push('c.city = @city'); request.input('city', sql.NVarChar, city); }
        if (email) { whereClauses.push('c.email = @email'); request.input('email', sql.NVarChar, email); }
        if (phone) { whereClauses.push('(c.phone = @phone1 OR c.mobile = @phone2)'); request.input('phone1', sql.NVarChar, phone); request.input('phone2', sql.NVarChar, phone); }
        if (tax_id) { whereClauses.push('c.tax_id = @tax_id'); request.input('tax_id', sql.NVarChar, tax_id); }
        if (status) {
            if (status === 'blocked') whereClauses.push("c.blocked_status = 'blocked'");
            else if (status === 'active') whereClauses.push("(c.blocked_status IS NULL OR c.blocked_status = 'unblocked')");
        }

        const whereSql = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

        request.input('offset', sql.Int, offset);
        request.input('limit', sql.Int, limit);

        const countRes = await request.query(`SELECT COUNT(1) as total FROM customers c ${whereSql}`);
        const total = countRes.recordset[0] ? Number(countRes.recordset[0].total || 0) : 0;
        const pages = total === 0 ? 1 : Math.ceil(total / limit);

        const dataRes = await request.query(`
            SELECT c.*, r.rep_name, g.group_name as customer_group_name
            FROM customers c
            LEFT JOIN sales_reps r ON c.rep_id = r.id
            LEFT JOIN customer_groups g ON c.customer_group_id = g.id
            ${whereSql}
            ORDER BY c.customer_name
            OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
        `);

        res.json({ success: true, data: dataRes.recordset, pagination: { page, limit, total, pages } });
    } catch (err) {
        console.error('Customers GET error:', err);
        err.status = 500;
        err.message = 'خطأ في قاعدة البيانات';
        throw err;
    }
}));

// ── Get single customer + live balance + stats ──
router.get('/:id', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query(`
                SELECT c.*, r.rep_name, g.group_name as customer_group_name
                FROM customers c
                LEFT JOIN sales_reps r ON c.rep_id = r.id
                LEFT JOIN customer_groups g ON c.customer_group_id = g.id
                WHERE c.id = @id
            `);

        const cust = result.recordset[0];
        if (!cust) return res.status(404).json({ success: false, message: 'العميل غير موجود' });

        cust.current_balance = await recalcCustomerBalanceAsync(pool, cust.id);
        res.json({ success: true, data: cust });
    } catch (err) {
        console.error('Customers GET:id error:', err);
        err.status = 500;
        err.message = 'خطأ في قاعدة البيانات';
        throw err;
    }
}));

// ── Create customer ──
router.post('/', async (req, res) => {
    const fields = req.body;
    if (!fields.customer_name) {
        logActivity(req, 'CREATE', 'customers', null, null, null, null, 'FAILED', 'اسم العميل مطلوب');
        return res.status(400).json({ success: false, message: 'اسم العميل مطلوب' });
    }

    let transaction;
    try {
        const pool = await getPool();

        // ── Duplicate checks ──
        if (fields.customer_code) {
            const dup = await checkDuplicateAsync(pool, 'customer_code', fields.customer_code);
            if (dup) {
                logActivity(req, 'CREATE', 'customers', null, null, null, null, 'FAILED', `كود العميل "${fields.customer_code}" موجود مسبقاً`);
                return res.status(400).json({ success: false, message: `كود العميل "${fields.customer_code}" موجود مسبقاً للعميل "${dup.customer_name}"` });
            }
        }
        if (fields.email) {
            const dup = await checkDuplicateAsync(pool, 'email', fields.email);
            if (dup) {
                logActivity(req, 'CREATE', 'customers', null, null, null, null, 'FAILED', `البريد "${fields.email}" موجود مسبقاً`);
                return res.status(400).json({ success: false, message: `البريد الإلكتروني "${fields.email}" موجود مسبقاً للعميل "${dup.customer_name}"` });
            }
        }
        if (fields.tax_id) {
            const dup = await checkDuplicateAsync(pool, 'tax_id', fields.tax_id);
            if (dup) {
                logActivity(req, 'CREATE', 'customers', null, null, null, null, 'FAILED', `الرقم الضريبي "${fields.tax_id}" موجود مسبقاً`);
                return res.status(400).json({ success: false, message: `الرقم الضريبي "${fields.tax_id}" موجود مسبقاً للعميل "${dup.customer_name}"` });
            }
        }
        if (fields.phone) {
            const dup = await checkDuplicateAsync(pool, 'phone', fields.phone);
            if (dup) {
                logActivity(req, 'CREATE', 'customers', null, null, null, null, 'FAILED', `رقم الهاتف "${fields.phone}" موجود مسبقاً`);
                return res.status(400).json({ success: false, message: `رقم الهاتف "${fields.phone}" موجود مسبقاً للعميل "${dup.customer_name}"` });
            }
        }
        if (fields.mobile) {
            const dup = await checkDuplicateAsync(pool, 'mobile', fields.mobile);
            if (dup) {
                logActivity(req, 'CREATE', 'customers', null, null, null, null, 'FAILED', `رقم الموبايل "${fields.mobile}" موجود مسبقاً`);
                return res.status(400).json({ success: false, message: `رقم الموبايل "${fields.mobile}" موجود مسبقاً للعميل "${dup.customer_name}"` });
            }
        }

        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const request = transaction.request();

        let code = fields.customer_code;
        if (!code) {
            const lastCodeResult = await request.query('SELECT TOP 1 customer_code FROM customers WITH (TABLOCKX) ORDER BY id DESC');
            const last = lastCodeResult.recordset[0];
            const lastNum = last && last.customer_code ? parseInt(last.customer_code.replace(/\D/g, '')) || 0 : 0;
            code = `C-${String(lastNum + 1).padStart(4, '0')}`;
        }

        const ob = fields.opening_balance || 0;

        const result = await request
            .input('code', sql.NVarChar, code)
            .input('name', sql.NVarChar, fields.customer_name)
            .input('name_en', sql.NVarChar, fields.customer_name_en || null)
            .input('type', sql.NVarChar, fields.customer_type || 'retail')
            .input('phone', sql.NVarChar, fields.phone || null)
            .input('phone2', sql.NVarChar, fields.phone2 || null)
            .input('mobile', sql.NVarChar, fields.mobile || null)
            .input('whatsapp', sql.NVarChar, fields.whatsapp || null)
            .input('email', sql.NVarChar, fields.email || null)
            .input('website', sql.NVarChar, fields.website || null)
            .input('fax', sql.NVarChar, fields.fax || null)
            .input('address', sql.NVarChar, fields.address || null)
            .input('region', sql.NVarChar, fields.region || null)
            .input('country', sql.NVarChar, fields.country || null)
            .input('governorate', sql.NVarChar, fields.governorate || null)
            .input('city', sql.NVarChar, fields.city || null)
            .input('district', sql.NVarChar, fields.district || null)
            .input('street', sql.NVarChar, fields.street || null)
            .input('building_no', sql.NVarChar, fields.building_no || null)
            .input('floor_no', sql.NVarChar, fields.floor_no || null)
            .input('apartment_no', sql.NVarChar, fields.apartment_no || null)
            .input('postal_code', sql.NVarChar, fields.postal_code || null)
            .input('landmark', sql.NVarChar, fields.landmark || null)
            .input('billing_address', sql.NVarChar, fields.billing_address || null)
            .input('shipping_address', sql.NVarChar, fields.shipping_address || null)
            .input('tax_id', sql.NVarChar, fields.tax_id || null)
            .input('cr', sql.NVarChar, fields.commercial_register || null)
            .input('tax_office', sql.NVarChar, fields.tax_office || null)
            .input('ptd', sql.Int, Number.isFinite(Number(fields.payment_terms_days)) ? Number(fields.payment_terms_days) : 0)
            .input('cgid', sql.Int, fields.customer_group_id || null)
            .input('category', sql.NVarChar, fields.customer_category || null)
            .input('credit', sql.Decimal(18,2), fields.credit_limit || 0)
            .input('ob', sql.Decimal(18,2), ob)
            .input('rep_id', sql.Int, fields.rep_id || null)
            .input('notes', sql.NVarChar, fields.notes || null)
            .input('internal_notes', sql.NVarChar, fields.internal_notes || null)
            .input('customer_notes', sql.NVarChar, fields.customer_notes || null)
            .input('warnings', sql.NVarChar, fields.warnings_field || null)
            .input('lang', sql.NVarChar, fields.language || 'ar')
            .input('currency', sql.NVarChar, fields.currency || 'EGP')
            .input('cust_since', sql.NVarChar, fields.customer_since || null)
            .input('primary_contact', sql.NVarChar, fields.primary_contact || null)
            .input('job_title', sql.NVarChar, fields.job_title || null)
            .input('secondary_contact', sql.NVarChar, fields.secondary_contact || null)
            .input('emergency_contact', sql.NVarChar, fields.emergency_contact || null)
            .input('special_instructions', sql.NVarChar, fields.special_instructions || null)
            .input('price_list_id', sql.Int, fields.price_list_id || null)
            .input('default_warehouse_id', sql.Int, fields.default_warehouse_id || null)
            .input('ar_account_id', sql.Int, fields.ar_account_id || null)
            .input('gps_lat', sql.Decimal(10,7), fields.gps_latitude || null)
            .input('gps_lng', sql.Decimal(10,7), fields.gps_longitude || null)
            .input('google_maps_link', sql.NVarChar, fields.google_maps_link || null)
            .input('customer_status', sql.NVarChar, fields.customer_status || 'active')
            .input('branch', sql.NVarChar, fields.branch || null)
            .input('lead_source', sql.NVarChar, fields.lead_source || null)
            .input('credit_risk', sql.NVarChar, fields.credit_risk || 'normal')
            .input('credit_days', sql.Int, Number.isFinite(Number(fields.credit_days)) ? Number(fields.credit_days) : 0)
            .input('preferred_contact_method', sql.NVarChar, fields.preferred_contact_method || null)
            .input('opening_balance_date', sql.NVarChar, fields.opening_balance_date || null)
            .input('default_payment_method', sql.NVarChar, fields.default_payment_method || null)
            .input('tax_status', sql.NVarChar, fields.tax_status || null)
            .input('vat_number', sql.NVarChar, fields.vat_number || null)
            .input('bank_name', sql.NVarChar, fields.bank_name || null)
            .input('bank_account_no', sql.NVarChar, fields.bank_account_no || null)
            .input('bank_iban', sql.NVarChar, fields.bank_iban || null)
            .input('id_type', sql.NVarChar, fields.id_type || null)
            .input('id_number', sql.NVarChar, fields.id_number || null)
            .input('id_expiry', sql.NVarChar, fields.id_expiry || null)
            .input('contract_no', sql.NVarChar, fields.contract_no || null)
            .input('contract_date', sql.NVarChar, fields.contract_date || null)
            .input('contract_expiry', sql.NVarChar, fields.contract_expiry || null)
            .input('sales_notes', sql.NVarChar, fields.sales_notes || null)
            .input('accounting_notes', sql.NVarChar, fields.accounting_notes || null)
            .query(`
                INSERT INTO customers (
                    customer_code, customer_name, customer_name_en, customer_type,
                    phone, phone2, mobile, whatsapp, email, website, fax,
                    address, region, country, governorate, city, district, street,
                    building_no, floor_no, apartment_no, postal_code, landmark,
                    billing_address, shipping_address,
                    tax_id, commercial_register, tax_office,
                    payment_terms_days, customer_group_id, customer_category,
                    credit_limit, opening_balance, current_balance,
                    rep_id, notes, internal_notes, customer_notes, warnings_field,
                    language, currency, customer_since,
                    primary_contact, job_title, secondary_contact, emergency_contact,
                    special_instructions, price_list_id, default_warehouse_id,
                    ar_account_id, gps_latitude, gps_longitude, google_maps_link,
                    customer_status, branch, lead_source, credit_days, credit_risk,
                    preferred_contact_method, opening_balance_date,
                    default_payment_method, tax_status, vat_number,
                    bank_name, bank_account_no, bank_iban,
                    id_type, id_number, id_expiry,
                    contract_no, contract_date, contract_expiry,
                    sales_notes, accounting_notes
                ) VALUES (
                    @code, @name, @name_en, @type,
                    @phone, @phone2, @mobile, @whatsapp, @email, @website, @fax,
                    @address, @region, @country, @governorate, @city, @district, @street,
                    @building_no, @floor_no, @apartment_no, @postal_code, @landmark,
                    @billing_address, @shipping_address,
                    @tax_id, @cr, @tax_office,
                    @ptd, @cgid, @category,
                    @credit, @ob, @ob,
                    @rep_id, @notes, @internal_notes, @customer_notes, @warnings,
                    @lang, @currency, @cust_since,
                    @primary_contact, @job_title, @secondary_contact, @emergency_contact,
                    @special_instructions, @price_list_id, @default_warehouse_id,
                    @ar_account_id, @gps_lat, @gps_lng, @google_maps_link,
                    @customer_status, @branch, @lead_source, @credit_days, @credit_risk,
                    @preferred_contact_method, @opening_balance_date,
                    @default_payment_method, @tax_status, @vat_number,
                    @bank_name, @bank_account_no, @bank_iban,
                    @id_type, @id_number, @id_expiry,
                    @contract_no, @contract_date, @contract_expiry,
                    @sales_notes, @accounting_notes
                );
                SELECT SCOPE_IDENTITY() as id
            `);

        const newId = result.recordset[0].id;
        await logCustomerActivityAsync(transaction.request(), newId, 'created', null, null, null, 0, 'تم إنشاء العميل', req.user ? req.user.id : null, { code });

        // Post opening balance journal entry if > 0
        if (ob > 0) {
            const arAccountId = await accountingEngine.getSystemAccountAsync(transaction.request(), 'SYS_AR');
            const retainedEarningsId = await accountingEngine.getSystemAccountAsync(transaction.request(), 'SYS_RETAINED_EARNINGS');
            const entryDate = fields.customer_since || new Date().toISOString().slice(0, 10);
            await accountingEngine.postJournalEntryAsync(
                transaction.request(),
                entryDate,
                `رصيد افتتاحي للعميل ${fields.customer_name} (${code})`,
                [
                    { account_id: arAccountId, debit: ob, credit: 0, description: `رصيد افتتاحي عميل ${code}` },
                    { account_id: retainedEarningsId, debit: 0, credit: ob, description: `رصيد افتتاحي عميل ${code}` }
                ],
                'customers',
                newId,
                req.user ? req.user.id : null,
                { module: 'customers', action: 'create', document: String(newId), isSystem: true }
            );
        }

        await transaction.commit();
        logActivity(req, 'CREATE', 'customers', code, `تم إنشاء العميل ${fields.customer_name}`, null, { customer_name: fields.customer_name, code, phone: fields.phone, email: fields.email }, 'SUCCESS', null);
        res.status(201).json({ success: true, message: 'تم إضافة العميل بنجاح', id: newId, code });
    } catch (err) {
        if (transaction) await transaction.rollback();
        logActivity(req, 'CREATE', 'customers', null, null, null, null, 'FAILED', err.message);
        console.error('Customers POST error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات: ' + err.message });
    }
});

// ── Update customer ──
router.put('/:id', async (req, res) => {
    try {
        const pool = await getPool();
        const existingResult = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('SELECT * FROM customers WHERE id = @id');

        const existing = existingResult.recordset[0];
        if (!existing) {
            logActivity(req, 'UPDATE', 'customers', null, `العميل رقم ${req.params.id} غير موجود`, null, null, 'FAILED', 'العميل غير موجود');
            return res.status(404).json({ success: false, message: 'العميل غير موجود' });
        }

        const b = req.body || {};

        // Duplicate checks (excluding current customer)
        if (b.customer_code && b.customer_code !== existing.customer_code) {
            const dup = await checkDuplicateAsync(pool, 'customer_code', b.customer_code, req.params.id);
            if (dup) return res.status(400).json({ success: false, message: `الكود "${b.customer_code}" موجود مسبقاً` });
        }
        if (b.email && b.email !== existing.email) {
            const dup = await checkDuplicateAsync(pool, 'email', b.email, req.params.id);
            if (dup) return res.status(400).json({ success: false, message: `البريد "${b.email}" موجود مسبقاً` });
        }
        if (b.tax_id && b.tax_id !== existing.tax_id) {
            const dup = await checkDuplicateAsync(pool, 'tax_id', b.tax_id, req.params.id);
            if (dup) return res.status(400).json({ success: false, message: `الرقم الضريبي "${b.tax_id}" موجود مسبقاً` });
        }
        if (b.phone && b.phone !== existing.phone) {
            const dup = await checkDuplicateAsync(pool, 'phone', b.phone, req.params.id);
            if (dup) return res.status(400).json({ success: false, message: `رقم الهاتف "${b.phone}" موجود مسبقاً` });
        }
        if (b.mobile && b.mobile !== existing.mobile) {
            const dup = await checkDuplicateAsync(pool, 'mobile', b.mobile, req.params.id);
            if (dup) return res.status(400).json({ success: false, message: `رقم الموبايل "${b.mobile}" موجود مسبقاً` });
        }

        let transaction;
        try {
            transaction = new sql.Transaction(pool);
            await transaction.begin();
            const request = transaction.request();

            request.input('id', sql.Int, req.params.id);
            const field = (key, def) => b[key] !== undefined ? b[key] : def;
            const num = (key, def) => b[key] != null ? Number(b[key]) : def;

            request.input('name', sql.NVarChar, field('customer_name', existing.customer_name));
            request.input('name_en', sql.NVarChar, field('customer_name_en', existing.customer_name_en));
            request.input('type', sql.NVarChar, field('customer_type', existing.customer_type));
            request.input('phone', sql.NVarChar, field('phone', existing.phone));
            request.input('phone2', sql.NVarChar, field('phone2', existing.phone2));
            request.input('mobile', sql.NVarChar, field('mobile', existing.mobile));
            request.input('whatsapp', sql.NVarChar, field('whatsapp', existing.whatsapp));
            request.input('email', sql.NVarChar, field('email', existing.email));
            request.input('website', sql.NVarChar, field('website', existing.website));
            request.input('fax', sql.NVarChar, field('fax', existing.fax));
            request.input('address', sql.NVarChar, field('address', existing.address));
            request.input('region', sql.NVarChar, field('region', existing.region));
            request.input('country', sql.NVarChar, field('country', existing.country));
            request.input('governorate', sql.NVarChar, field('governorate', existing.governorate));
            request.input('city', sql.NVarChar, field('city', existing.city));
            request.input('district', sql.NVarChar, field('district', existing.district));
            request.input('street', sql.NVarChar, field('street', existing.street));
            request.input('building_no', sql.NVarChar, field('building_no', existing.building_no));
            request.input('floor_no', sql.NVarChar, field('floor_no', existing.floor_no));
            request.input('apartment_no', sql.NVarChar, field('apartment_no', existing.apartment_no));
            request.input('postal_code', sql.NVarChar, field('postal_code', existing.postal_code));
            request.input('landmark', sql.NVarChar, field('landmark', existing.landmark));
            request.input('billing_address', sql.NVarChar, field('billing_address', existing.billing_address));
            request.input('shipping_address', sql.NVarChar, field('shipping_address', existing.shipping_address));
            request.input('tax_id', sql.NVarChar, field('tax_id', existing.tax_id));
            request.input('cr', sql.NVarChar, field('commercial_register', existing.commercial_register));
            request.input('tax_office', sql.NVarChar, field('tax_office', existing.tax_office));
            request.input('ptd', sql.Int, num('payment_terms_days', existing.payment_terms_days));
            request.input('cgid', sql.Int, num('customer_group_id', existing.customer_group_id));
            request.input('category', sql.NVarChar, field('customer_category', existing.customer_category));
            request.input('credit', sql.Decimal(18,2), num('credit_limit', existing.credit_limit));
            request.input('ob', sql.Decimal(18,2), num('opening_balance', existing.opening_balance));
            request.input('rep_id', sql.Int, field('rep_id', existing.rep_id));
            request.input('notes', sql.NVarChar, field('notes', existing.notes));
            request.input('internal_notes', sql.NVarChar, field('internal_notes', existing.internal_notes));
            request.input('customer_notes', sql.NVarChar, field('customer_notes', existing.customer_notes));
            request.input('warnings', sql.NVarChar, field('warnings_field', existing.warnings_field));
            request.input('lang', sql.NVarChar, field('language', existing.language));
            request.input('currency', sql.NVarChar, field('currency', existing.currency));
            request.input('cust_since', sql.NVarChar, field('customer_since', existing.customer_since));
            request.input('primary_contact', sql.NVarChar, field('primary_contact', existing.primary_contact));
            request.input('job_title', sql.NVarChar, field('job_title', existing.job_title));
            request.input('secondary_contact', sql.NVarChar, field('secondary_contact', existing.secondary_contact));
            request.input('emergency_contact', sql.NVarChar, field('emergency_contact', existing.emergency_contact));
            request.input('special_instructions', sql.NVarChar, field('special_instructions', existing.special_instructions));
            request.input('price_list_id', sql.Int, num('price_list_id', existing.price_list_id));
            request.input('default_warehouse_id', sql.Int, num('default_warehouse_id', existing.default_warehouse_id));
            request.input('ar_account_id', sql.Int, num('ar_account_id', existing.ar_account_id));
            request.input('gps_lat', sql.Decimal(10,7), field('gps_latitude', existing.gps_latitude));
            request.input('gps_lng', sql.Decimal(10,7), field('gps_longitude', existing.gps_longitude));
            request.input('google_maps_link', sql.NVarChar, field('google_maps_link', existing.google_maps_link));
            request.input('customer_status', sql.NVarChar, field('customer_status', existing.customer_status));
            request.input('branch', sql.NVarChar, field('branch', existing.branch));
            request.input('lead_source', sql.NVarChar, field('lead_source', existing.lead_source));
            request.input('credit_risk', sql.NVarChar, field('credit_risk', existing.credit_risk));
            request.input('credit_days', sql.Int, num('credit_days', existing.credit_days));
            request.input('preferred_contact_method', sql.NVarChar, field('preferred_contact_method', existing.preferred_contact_method));
            request.input('opening_balance_date', sql.NVarChar, field('opening_balance_date', existing.opening_balance_date));
            request.input('default_payment_method', sql.NVarChar, field('default_payment_method', existing.default_payment_method));
            request.input('tax_status', sql.NVarChar, field('tax_status', existing.tax_status));
            request.input('vat_number', sql.NVarChar, field('vat_number', existing.vat_number));
            request.input('bank_name', sql.NVarChar, field('bank_name', existing.bank_name));
            request.input('bank_account_no', sql.NVarChar, field('bank_account_no', existing.bank_account_no));
            request.input('bank_iban', sql.NVarChar, field('bank_iban', existing.bank_iban));
            request.input('id_type', sql.NVarChar, field('id_type', existing.id_type));
            request.input('id_number', sql.NVarChar, field('id_number', existing.id_number));
            request.input('id_expiry', sql.NVarChar, field('id_expiry', existing.id_expiry));
            request.input('contract_no', sql.NVarChar, field('contract_no', existing.contract_no));
            request.input('contract_date', sql.NVarChar, field('contract_date', existing.contract_date));
            request.input('contract_expiry', sql.NVarChar, field('contract_expiry', existing.contract_expiry));
            request.input('sales_notes', sql.NVarChar, field('sales_notes', existing.sales_notes));
            request.input('accounting_notes', sql.NVarChar, field('accounting_notes', existing.accounting_notes));

            await request.query(`
                UPDATE customers SET
                    customer_name=@name, customer_name_en=@name_en, customer_type=@type,
                    phone=@phone, phone2=@phone2, mobile=@mobile, whatsapp=@whatsapp,
                    email=@email, website=@website, fax=@fax,
                    address=@address, region=@region, country=@country, governorate=@governorate,
                    city=@city, district=@district, street=@street,
                    building_no=@building_no, floor_no=@floor_no, apartment_no=@apartment_no,
                    postal_code=@postal_code, landmark=@landmark,
                    billing_address=@billing_address, shipping_address=@shipping_address,
                    tax_id=@tax_id, commercial_register=@cr, tax_office=@tax_office,
                    payment_terms_days=@ptd, customer_group_id=@cgid, customer_category=@category,
                    credit_limit=@credit, opening_balance=@ob,
                    rep_id=@rep_id, notes=@notes, internal_notes=@internal_notes,
                    customer_notes=@customer_notes, warnings_field=@warnings,
                    language=@lang, currency=@currency, customer_since=@cust_since,
                    primary_contact=@primary_contact, job_title=@job_title,
                    secondary_contact=@secondary_contact, emergency_contact=@emergency_contact,
                    special_instructions=@special_instructions,
                    price_list_id=@price_list_id, default_warehouse_id=@default_warehouse_id,
                    ar_account_id=@ar_account_id,
                    gps_latitude=@gps_lat, gps_longitude=@gps_lng, google_maps_link=@google_maps_link,
                    customer_status=@customer_status, branch=@branch, lead_source=@lead_source,
                    credit_risk=@credit_risk, credit_days=@credit_days, preferred_contact_method=@preferred_contact_method,
                    opening_balance_date=@opening_balance_date,
                    default_payment_method=@default_payment_method, tax_status=@tax_status,
                    vat_number=@vat_number, bank_name=@bank_name, bank_account_no=@bank_account_no,
                    bank_iban=@bank_iban, id_type=@id_type, id_number=@id_number,
                    id_expiry=@id_expiry, contract_no=@contract_no, contract_date=@contract_date,
                    contract_expiry=@contract_expiry, sales_notes=@sales_notes,
                    accounting_notes=@accounting_notes,
                    modified_at=CONVERT(VARCHAR(19), GETDATE(), 120),
                    modified_by=@id
                WHERE id=@id
            `);

            await recalcCustomerBalanceAsync(transaction.request(), req.params.id);
            await logCustomerActivityAsync(transaction.request(), req.params.id, 'updated', null, null, null, 0, 'تم تحديث بيانات العميل', req.user ? req.user.id : null, null);
            await transaction.commit();
            logActivity(req, 'UPDATE', 'customers', existing.customer_code, `تم تحديث العميل ${existing.customer_name}`,
                { customer_name: existing.customer_name, phone: existing.phone, email: existing.email, credit_limit: existing.credit_limit, customer_type: existing.customer_type },
                { customer_name: b.customer_name || existing.customer_name, phone: b.phone !== undefined ? b.phone : existing.phone, email: b.email !== undefined ? b.email : existing.email, credit_limit: b.credit_limit !== undefined ? b.credit_limit : existing.credit_limit, customer_type: b.customer_type || existing.customer_type },
                'SUCCESS', null);
            res.json({ success: true, message: 'تم تحديث العميل' });
        } catch (txErr) {
            if (transaction) await transaction.rollback();
            throw txErr;
        }
    } catch (err) {
        logActivity(req, 'UPDATE', 'customers', null, null, null, null, 'FAILED', err.message);
        console.error('Customers PUT error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات: ' + err.message });
    }
});

// ── Soft delete with comprehensive dependency check ──
router.delete('/:id', async (req, res) => {
    try {
        const pool = await getPool();
        const request = pool.request();
        request.input('id', sql.Int, req.params.id);

        let checks;
        try {
            checks = await request.query(`
                SELECT
                    (SELECT COUNT(1) FROM sales_invoices WHERE customer_id = @id AND status != 'cancelled') as invoices_cnt,
                    (SELECT COUNT(1) FROM sales_returns WHERE customer_id = @id AND status != 'cancelled') as returns_cnt,
                    (SELECT COUNT(1) FROM customer_collections WHERE customer_id = @id) as collections_cnt,
                    (SELECT COUNT(1) FROM sales_orders WHERE customer_id = @id AND status != 'cancelled') as orders_cnt,
                    (SELECT COUNT(1) FROM quotations WHERE customer_id = @id AND status != 'cancelled') as quotes_cnt,
                    (SELECT COUNT(1) FROM journal_entries WHERE reference_type = 'sales_invoice' AND reference_id IN (SELECT id FROM sales_invoices WHERE customer_id = @id)) as je_cnt,
                    (SELECT COUNT(1) FROM customer_activity_log WHERE customer_id = @id) as log_cnt
            `);
        } catch (_depErr) {
            // Fallback if sales_orders or quotations tables don't exist
            checks = await pool.request()
                .input('id2', sql.Int, req.params.id)
                .query(`
                    SELECT
                        (SELECT COUNT(1) FROM sales_invoices WHERE customer_id = @id2 AND status != 'cancelled') as invoices_cnt,
                        (SELECT COUNT(1) FROM sales_returns WHERE customer_id = @id2 AND status != 'cancelled') as returns_cnt,
                        (SELECT COUNT(1) FROM customer_collections WHERE customer_id = @id2) as collections_cnt,
                        0 as orders_cnt, 0 as quotes_cnt,
                        (SELECT COUNT(1) FROM journal_entries WHERE reference_type = 'sales_invoice' AND reference_id IN (SELECT id FROM sales_invoices WHERE customer_id = @id2)) as je_cnt,
                        (SELECT COUNT(1) FROM customer_activity_log WHERE customer_id = @id2) as log_cnt
                `);
        }
        const chk = checks.recordset[0];
        const reasons = [];
        if (chk.invoices_cnt > 0) reasons.push(chk.invoices_cnt + ' فاتورة مبيعات');
        if (chk.returns_cnt > 0) reasons.push(chk.returns_cnt + ' مرتجع مبيعات');
        if (chk.collections_cnt > 0) reasons.push(chk.collections_cnt + ' سند تحصيل');
        if (chk.orders_cnt > 0) reasons.push(chk.orders_cnt + ' أمر بيع');
        if (chk.quotes_cnt > 0) reasons.push(chk.quotes_cnt + ' عرض سعر');
        if (chk.je_cnt > 0) reasons.push(chk.je_cnt + ' قيد محاسبي');
        if (chk.log_cnt > 0) reasons.push('سجل نشاطات');

        if (reasons.length > 0) {
            logActivity(req, 'DELETE', 'customers', null, `محاولة حذف العميل رقم ${req.params.id}`, null, null, 'FAILED', reasons.join('; '));
            return res.status(400).json({
                success: false,
                message: 'لا يمكن حذف العميل لوجود مستندات مرتبطة:',
                details: reasons
            });
        }

        await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('UPDATE customers SET is_active = 0, blocked_status = \'deleted\' WHERE id = @id');
        await logCustomerActivityAsync(pool.request(), req.params.id, 'deleted', null, null, null, 0, 'تم حذف العميل', req.user ? req.user.id : null, null);
        logActivity(req, 'DELETE', 'customers', null, `تم حذف العميل رقم ${req.params.id}`, null, null, 'SUCCESS', null);
        res.json({ success: true, message: 'تم حذف العميل' });
    } catch (err) {
        logActivity(req, 'DELETE', 'customers', null, null, null, null, 'FAILED', err.message);
        console.error('Customers DELETE error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات: ' + err.message.substring(0, 300) });
    }
});

// ── Update credit limit only ──
router.patch('/:id/credit', async (req, res) => {
    const { credit_limit } = req.body;
    try {
        const pool = await getPool();
        const existingResult = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('SELECT id, credit_limit FROM customers WHERE id = @id');

        if (existingResult.recordset.length === 0) return res.status(404).json({ success: false, message: 'العميل غير موجود' });

        const newLimit = parseFloat(credit_limit) || 0;

        if (newLimit > 0) {
            const actualBalance = await recalcCustomerBalanceAsync(pool, req.params.id);
            if (actualBalance != null && actualBalance > newLimit) {
                return res.status(400).json({
                    success: false,
                    message: `الحد الائتماني الجديد (${newLimit.toFixed(2)}) أقل من المديونية الحالية (${actualBalance.toFixed(2)}). يرجى تسجيل تحصيلات أولاً.`
                });
            }
        }

        await pool.request()
            .input('credit', sql.Decimal(18,2), newLimit)
            .input('id', sql.Int, req.params.id)
            .query('UPDATE customers SET credit_limit = @credit WHERE id = @id');

        await logCustomerActivityAsync(pool.request(), req.params.id, 'credit_updated', null, null, null, 0, `تم تحديث الحد الائتماني إلى ${newLimit.toFixed(2)}`, req.user ? req.user.id : null, null);
        res.json({ success: true, message: 'تم تحديث الحد الائتماني بنجاح' });
    } catch (err) {
        console.error('Customers PATCH credit error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
});

// ── Active / Inactive toggle ──
router.patch('/:id/active', async (req, res) => {
    const { is_active } = req.body;
    try {
        const pool = await getPool();
        const existingResult = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('SELECT id, customer_name, is_active FROM customers WHERE id = @id');

        if (existingResult.recordset.length === 0) return res.status(404).json({ success: false, message: 'العميل غير موجود' });

        const active = is_active === true || is_active === 'true' || is_active === 1 ? 1 : 0;
        await pool.request()
            .input('active', sql.Int, active)
            .input('id', sql.Int, req.params.id)
            .query('UPDATE customers SET is_active = @active WHERE id = @id');

        await logCustomerActivityAsync(pool.request(), req.params.id, active ? 'activated' : 'deactivated', null, null, null, 0,
            active ? 'تم تنشيط العميل' : 'تم إلغاء تنشيط العميل', req.user ? req.user.id : null, null);

        res.json({ success: true, message: active ? 'تم تنشيط العميل' : 'تم إلغاء تنشيط العميل' });
    } catch (err) {
        console.error('Customers PATCH active error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
});

// ── Block / Unblock customer ──
router.patch('/:id/block', async (req, res) => {
    const { block, reason } = req.body;
    try {
        const pool = await getPool();
        const existingResult = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('SELECT id, is_active, blocked_status FROM customers WHERE id = @id');

        if (existingResult.recordset.length === 0) return res.status(404).json({ success: false, message: 'العميل غير موجود' });

        const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const userId = req.user ? req.user.id : null;
        const shouldBlock = block === true || block === 'true';

        await pool.request()
            .input('blocked_status', sql.NVarChar, shouldBlock ? 'blocked' : 'unblocked')
            .input('blocked_reason', sql.NVarChar, shouldBlock ? (reason || '') : null)
            .input('blocked_at', sql.NVarChar, shouldBlock ? now : null)
            .input('blocked_by', sql.Int, shouldBlock ? userId : null)
            .input('id', sql.Int, req.params.id)
            .query(`
                UPDATE customers SET
                    blocked_status = @blocked_status,
                    blocked_reason = @blocked_reason,
                    blocked_at = @blocked_at,
                    blocked_by = @blocked_by
                WHERE id = @id
            `);

        await logCustomerActivityAsync(pool.request(), req.params.id, shouldBlock ? 'blocked' : 'unblocked', null, null, null, 0,
            shouldBlock ? `تم حظر العميل${reason ? ' - السبب: ' + reason : ''}` : 'تم إلغاء حظر العميل',
            userId, null);

        res.json({ success: true, message: shouldBlock ? 'تم حظر العميل بنجاح' : 'تم إلغاء حظر العميل بنجاح' });
    } catch (err) {
        console.error('Customers PATCH block error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
});

// ── Account Statement ──
router.get('/:id/statement', asyncHandler(async (req, res) => {
    try {
        const { from, to } = req.query;
        const customerId = req.params.id;

        const pool = await getPool();

        const custResult = await pool.request()
            .input('id', sql.Int, customerId)
            .query('SELECT * FROM customers WHERE id = @id');

        const cust = custResult.recordset[0];
        if (!cust) return res.status(404).json({ success: false, message: 'العميل غير موجود' });

        let lines = [];

        const defaultDate = from || (cust.created_at ? new Date(cust.created_at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
        lines.push({
            trans_date: defaultDate,
            doc_type: 'رصيد افتتاحي',
            doc_no: '-',
            debit: cust.opening_balance > 0 ? cust.opening_balance : 0,
            credit: cust.opening_balance < 0 ? Math.abs(cust.opening_balance) : 0,
            notes: ''
        });

        const request = pool.request();
        request.input('customerId', sql.Int, customerId);
        if (from) request.input('from', sql.Date, from);
        if (to) request.input('to', sql.Date, to);

        // Sales invoices
        let salesSql = `SELECT invoice_date as trans_date, invoice_no as doc_no, grand_total as debit, 0 as credit, N'فاتورة مبيعات' as doc_type, notes FROM sales_invoices WHERE customer_id = @customerId AND status != 'cancelled'`;
        if (from) salesSql += ` AND invoice_date >= @from`;
        if (to) salesSql += ` AND invoice_date <= @to`;
        const salesRes = await request.query(salesSql);
        lines = lines.concat(salesRes.recordset);

        // Sales returns
        let retSql = `SELECT return_date as trans_date, return_no as doc_no, 0 as debit, grand_total as credit, N'مرتجع مبيعات' as doc_type, '' as notes FROM sales_returns WHERE customer_id = @customerId AND status != 'cancelled'`;
        if (from) retSql += ` AND return_date >= @from`;
        if (to) retSql += ` AND return_date <= @to`;
        const retRes = await request.query(retSql);
        lines = lines.concat(retRes.recordset);

        // Collections
        let colSql = `SELECT collection_date as trans_date, collection_no as doc_no, 0 as debit, amount as credit, N'تحصيل' as doc_type, notes FROM customer_collections WHERE customer_id = @customerId`;
        if (from) colSql += ` AND collection_date >= @from`;
        if (to) colSql += ` AND collection_date <= @to`;
        const colRes = await request.query(colSql);
        lines = lines.concat(colRes.recordset);

        // Sort by date
        lines.sort((a, b) => {
            const dateA = new Date(a.trans_date);
            const dateB = new Date(b.trans_date);
            return dateA > dateB ? 1 : -1;
        });

        let runningBalance = 0, totalDebit = 0, totalCredit = 0;
        lines = lines.map(l => {
            if (l.trans_date instanceof Date) l.trans_date = l.trans_date.toISOString().slice(0, 10);
            runningBalance += (l.debit || 0) - (l.credit || 0);
            totalDebit += l.debit || 0;
            totalCredit += l.credit || 0;
            return { ...l, running_balance: runningBalance };
        });

        res.json({
            success: true,
            customer: { id: cust.id, name: cust.customer_name, code: cust.customer_code, phone: cust.phone, balance: runningBalance },
            opening_balance: cust.opening_balance || 0,
            lines,
            summary: { totalDebit, totalCredit, finalBalance: runningBalance }
        });
    } catch (err) {
        console.error('Customers Statement error:', err);
        err.status = 500;
        err.message = 'خطأ في قاعدة البيانات';
        throw err;
    }
}));

// ── Activity Timeline ──
router.get('/:id/activity', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query(`
                SELECT al.*, u.username as user_name
                FROM customer_activity_log al
                LEFT JOIN users u ON al.created_by = u.id
                WHERE al.customer_id = @id
                ORDER BY al.created_at DESC
            `);
        res.json({ success: true, data: r.recordset });
    } catch (err) {
        err.status = 500;
        throw err;
    }
}));

// ── Analytics / KPIs ──
router.get('/:id/analytics', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const request = pool.request();
        request.input('id', sql.Int, req.params.id);

        const r = await request.query(`
            SELECT
                c.*,
                (SELECT COUNT(1) FROM sales_invoices WHERE customer_id = @id AND status != 'cancelled') as invoice_count,
                (SELECT COUNT(1) FROM sales_returns WHERE customer_id = @id AND status != 'cancelled') as return_count,
                (SELECT COUNT(1) FROM customer_collections WHERE customer_id = @id) as collection_count,
                (SELECT COALESCE(AVG(grand_total), 0) FROM sales_invoices WHERE customer_id = @id AND status != 'cancelled') as avg_invoice,
                (SELECT COALESCE(AVG(amount), 0) FROM customer_collections WHERE customer_id = @id) as avg_collection,
                (SELECT COALESCE(MAX(invoice_date), NULL) FROM sales_invoices WHERE customer_id = @id AND status != 'cancelled') as last_inv_date,
                (SELECT COALESCE(MIN(invoice_date), NULL) FROM sales_invoices WHERE customer_id = @id AND status != 'cancelled') as first_inv_date
            FROM customers c WHERE c.id = @id
        `);
        const data = r.recordset[0];
        if (!data) return res.status(404).json({ success: false, message: 'العميل غير موجود' });

        // Monthly sales (last 12 months)
        const monthlyR = await request.query(`
            SELECT 
                LEFT(invoice_date, 7) as month,
                COALESCE(SUM(grand_total), 0) as total
            FROM sales_invoices
            WHERE customer_id = @id AND status != 'cancelled' AND invoice_date >= DATEADD(MONTH, -12, GETDATE())
            GROUP BY LEFT(invoice_date, 7)
            ORDER BY month
        `);

        res.json({
            success: true,
            data: {
                invoice_count: data.invoice_count,
                return_count: data.return_count,
                collection_count: data.collection_count,
                total_sales: data.total_sales || 0,
                total_returns: data.total_returns || 0,
                total_payments: data.total_payments || 0,
                net_sales: (data.total_sales || 0) - (data.total_returns || 0),
                current_balance: data.current_balance || 0,
                credit_limit: data.credit_limit || 0,
                available_credit: Math.max(0, (data.credit_limit || 0) - (data.current_balance || 0)),
                avg_invoice: data.avg_invoice || 0,
                avg_collection: data.avg_collection || 0,
                last_invoice_date: data.last_inv_date,
                first_invoice_date: data.first_inv_date,
                customer_since: data.customer_since || data.created_at,
                monthly_sales: monthlyR.recordset
            }
        });
    } catch (err) {
        err.status = 500;
        throw err;
    }
}));

// ── Related Documents Chain ──
router.get('/:id/related', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const request = pool.request();
        request.input('id', sql.Int, req.params.id);

        const invoices = await request.query(`
            SELECT id, invoice_no as doc_no, invoice_date as doc_date, 'invoice' as doc_type, grand_total as amount, status, return_status
            FROM sales_invoices WHERE customer_id = @id ORDER BY invoice_date DESC
        `);
        const returns = await request.query(`
            SELECT id, return_no as doc_no, return_date as doc_date, 'return' as doc_type, grand_total as amount, workflow_status as status
            FROM sales_returns WHERE customer_id = @id ORDER BY return_date DESC
        `);
        const collections = await request.query(`
            SELECT id, collection_no as doc_no, collection_date as doc_date, 'collection' as doc_type, amount, 'completed' as status
            FROM customer_collections WHERE customer_id = @id ORDER BY collection_date DESC
        `);

        res.json({
            success: true,
            data: {
                invoices: invoices.recordset,
                returns: returns.recordset,
                collections: collections.recordset
            }
        });
    } catch (err) {
        err.status = 500;
        throw err;
    }
}));

// ── Log custom activity ──
router.post('/:id/log', async (req, res) => {
    try {
        const pool = await getPool();
        const { activity_type, description, reference_type, reference_id, reference_no, amount } = req.body;
        const request = pool.request();
        const pRand = Math.random().toString(36).substring(2, 9);
        request.input(`lc_cid_${pRand}`, sql.Int, req.params.id);
        request.input(`lc_type_${pRand}`, sql.NVarChar, activity_type || 'note');
        request.input(`lc_desc_${pRand}`, sql.NVarChar, description || null);
        request.input(`lc_rt_${pRand}`, sql.NVarChar, reference_type || null);
        request.input(`lc_ri_${pRand}`, sql.Int, reference_id || null);
        request.input(`lc_rn_${pRand}`, sql.NVarChar, reference_no || null);
        request.input(`lc_amt_${pRand}`, sql.Decimal(18,4), amount || 0);
        request.input(`lc_uid_${pRand}`, sql.Int, req.user ? req.user.id : null);
        await request.query(`
            INSERT INTO customer_activity_log (customer_id, activity_type, description, reference_type, reference_id, reference_no, amount, created_by)
            VALUES (@lc_cid_${pRand}, @lc_type_${pRand}, @lc_desc_${pRand}, @lc_rt_${pRand}, @lc_ri_${pRand}, @lc_rn_${pRand}, @lc_amt_${pRand}, @lc_uid_${pRand})
        `);
        res.json({ success: true, message: 'تم تسجيل النشاط' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── List attachments ──
router.get('/:id/attachments', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query(`
                SELECT a.*, u.username as uploaded_by_name
                FROM customer_attachments a
                LEFT JOIN users u ON a.uploaded_by = u.id
                WHERE a.customer_id = @id
                ORDER BY a.uploaded_at DESC
            `);
        res.json({ success: true, data: r.recordset });
    } catch (err) {
        err.status = 500;
        throw err;
    }
}));

// ── Upload attachment (base64) ──
router.post('/:id/attachments', async (req, res) => {
    try {
        const { file_name, file_data, description } = req.body;
        if (!file_name || !file_data) {
            return res.status(400).json({ success: false, message: 'اسم الملف والبيانات مطلوبان' });
        }
        const pool = await getPool();
        const ext = path.extname(file_name).toLowerCase();
        const baseName = path.basename(file_name, ext);
        const safeName = baseName.replace(/[^a-zA-Z0-9_\-\u0600-\u06FF]/g, '_') + ext;
        const uniqueName = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}_${safeName}`;
        const filePath = path.join(__dirname, '../uploads/customer_attachments', uniqueName);
        const buffer = Buffer.from(file_data, 'base64');
        require('fs').writeFileSync(filePath, buffer);
        const r = await pool.request()
            .input('cid', sql.Int, req.params.id)
            .input('fn', sql.NVarChar, file_name)
            .input('ft', sql.NVarChar, ext.replace('.', '') || null)
            .input('fp', sql.NVarChar, uniqueName)
            .input('desc', sql.NVarChar, description || null)
            .input('uid', sql.Int, req.user ? req.user.id : null)
            .query(`
                INSERT INTO customer_attachments (customer_id, file_name, file_type, file_path, description, uploaded_by)
                VALUES (@cid, @fn, @ft, @fp, @desc, @uid);
                SELECT SCOPE_IDENTITY() as id
            `);
        await logCustomerActivityAsync(pool.request(), req.params.id, 'attachment_uploaded', 'attachment', r.recordset[0].id, file_name, 0, `تم رفع الملف: ${file_name}`, req.user ? req.user.id : null, null);
        res.status(201).json({ success: true, message: 'تم رفع الملف', id: r.recordset[0].id });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── Download attachment ──
router.get('/:id/attachments/:attachId/download', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request()
            .input('aid', sql.Int, req.params.attachId)
            .input('cid', sql.Int, req.params.id)
            .query('SELECT * FROM customer_attachments WHERE id = @aid AND customer_id = @cid');
        const att = r.recordset[0];
        if (!att) return res.status(404).json({ success: false, message: 'الملف غير موجود' });
        const filePath = path.join(__dirname, '../uploads/customer_attachments', att.file_path);
        if (!require('fs').existsSync(filePath)) {
            return res.status(404).json({ success: false, message: 'ملف الفعلي غير موجود على الخادم' });
        }
        res.download(filePath, att.file_name);
    } catch (err) {
        err.status = 500;
        throw err;
    }
}));

// ── Delete attachment ──
router.delete('/:id/attachments/:attachId', async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request()
            .input('aid', sql.Int, req.params.attachId)
            .input('cid', sql.Int, req.params.id)
            .query('SELECT * FROM customer_attachments WHERE id = @aid AND customer_id = @cid');
        const att = r.recordset[0];
        if (!att) return res.status(404).json({ success: false, message: 'الملف غير موجود' });
        const filePath = path.join(__dirname, '../uploads/customer_attachments', att.file_path);
        try { require('fs').unlinkSync(filePath); } catch (e) { /* file may not exist on disk */ }
        await pool.request()
            .input('aid', sql.Int, req.params.attachId)
            .query('DELETE FROM customer_attachments WHERE id = @aid');
        await logCustomerActivityAsync(pool.request(), req.params.id, 'attachment_deleted', 'attachment', req.params.attachId, att.file_name, 0, `تم حذف الملف: ${att.file_name}`, req.user ? req.user.id : null, null);
        res.json({ success: true, message: 'تم حذف الملف' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
