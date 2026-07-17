// ============================================================
// ROUTE: Dashboard (لوحة القيادة)
// ============================================================

const router = require('express').Router();
const { getPool, sql } = require('../database/mssql_db');
const asyncHandler = require('../utils/asyncHandler');

// ── Main Stats ──────────────────────────────────────────────
router.get('/stats', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const today = new Date().toISOString().slice(0, 10);
        
        // Execute all aggregate queries concurrently for maximum performance
        const [
            // Sales
            salesTodayRes, salesWeekRes, salesMonthRes, salesCountTodayRes,
            // Purchases
            purchasesTodayRes, purchasesMonthRes,
            // Counts
            customersCountRes, suppliersCountRes, productsCountRes, employeesCountRes, repsCountRes,
            // Balances
            receivableRes, payableRes, treasuryRes,
            // Inventory
            invValueRes, lowStockRes, outOfStockRes,
            // Collections
            colTodayRes, colMonthRes
        ] = await Promise.all([
            // Sales
            pool.request().input('t1', sql.NVarChar, today).query(`SELECT COALESCE(SUM(grand_total), 0) as v FROM sales_invoices WHERE invoice_date = @t1 AND status NOT IN ('cancelled', 'deleted')`),
            pool.request().query(`SELECT COALESCE(SUM(grand_total), 0) as v FROM sales_invoices WHERE CAST(invoice_date AS DATE) >= DATEADD(day, -7, GETDATE()) AND status NOT IN ('cancelled', 'deleted')`),
            pool.request().query(`SELECT COALESCE(SUM(grand_total), 0) as v FROM sales_invoices WHERE LEFT(invoice_date, 7) = LEFT(CONVERT(NVarChar(10), GETDATE(), 120), 7) AND status NOT IN ('cancelled', 'deleted')`),
            pool.request().input('t2', sql.NVarChar, today).query(`SELECT COUNT(*) as v FROM sales_invoices WHERE invoice_date = @t2 AND status NOT IN ('cancelled', 'deleted')`),
            // Purchases
            pool.request().input('t3', sql.NVarChar, today).query(`SELECT COALESCE(SUM(grand_total), 0) as v FROM purchase_invoices WHERE invoice_date = @t3 AND status NOT IN ('cancelled', 'deleted')`),
            pool.request().query(`SELECT COALESCE(SUM(grand_total), 0) as v FROM purchase_invoices WHERE LEFT(invoice_date, 7) = LEFT(CONVERT(NVarChar(10), GETDATE(), 120), 7) AND status NOT IN ('cancelled', 'deleted')`),
            // Counts
            pool.request().query(`SELECT COUNT(*) as v FROM customers WHERE is_active = 1`),
            pool.request().query(`SELECT COUNT(*) as v FROM suppliers WHERE is_active = 1`),
            pool.request().query(`SELECT COUNT(*) as v FROM products WHERE is_active = 1`),
            pool.request().query(`SELECT COUNT(*) as v FROM employees WHERE status = 'active'`),
            pool.request().query(`SELECT COUNT(*) as v FROM sales_reps WHERE is_active = 1`),
            // Balances
            pool.request().query(`SELECT COALESCE(SUM(current_balance), 0) as v FROM customers WHERE current_balance > 0`),
            pool.request().query(`SELECT COALESCE(SUM(current_balance), 0) as v FROM suppliers WHERE current_balance > 0`),
            pool.request().query(`SELECT COALESCE(SUM(current_balance), 0) as v FROM treasury_accounts`),
            // Inventory
            pool.request().query(`SELECT COALESCE(SUM(ib.quantity * p.cost_price), 0) as v FROM inventory_balances ib JOIN products p ON ib.product_id = p.id`),
            pool.request().query(`SELECT COUNT(DISTINCT ib.product_id) as v FROM inventory_balances ib JOIN products p ON ib.product_id = p.id WHERE ib.quantity <= p.min_stock AND ib.quantity > 0`),
            pool.request().query(`SELECT COUNT(*) as v FROM products p WHERE p.is_active = 1 AND NOT EXISTS (SELECT 1 FROM inventory_balances ib WHERE ib.product_id = p.id AND ib.quantity > 0)`),
            // Collections
            pool.request().input('t4', sql.NVarChar, today).query(`SELECT COALESCE(SUM(amount), 0) as v FROM customer_collections WHERE collection_date = @t4 AND amount > 0`),
            pool.request().query(`SELECT COALESCE(SUM(amount), 0) as v FROM customer_collections WHERE LEFT(collection_date, 7) = LEFT(CONVERT(NVarChar(10), GETDATE(), 120), 7) AND amount > 0`)
        ]);

        const stats = {
            sales_today: salesTodayRes.recordset[0].v,
            sales_week: salesWeekRes.recordset[0].v,
            sales_month: salesMonthRes.recordset[0].v,
            sales_count_today: salesCountTodayRes.recordset[0].v,
            purchases_today: purchasesTodayRes.recordset[0].v,
            purchases_month: purchasesMonthRes.recordset[0].v,
            total_customers: customersCountRes.recordset[0].v,
            total_suppliers: suppliersCountRes.recordset[0].v,
            total_products: productsCountRes.recordset[0].v,
            total_employees: employeesCountRes.recordset[0].v,
            total_sales_reps: repsCountRes.recordset[0].v,
            total_receivable: receivableRes.recordset[0].v,
            total_payable: payableRes.recordset[0].v,
            treasury_balance: treasuryRes.recordset[0].v,
            inventory_value: invValueRes.recordset[0].v,
            low_stock_count: lowStockRes.recordset[0].v,
            out_of_stock_count: outOfStockRes.recordset[0].v,
            collections_today: colTodayRes.recordset[0].v,
            collections_month: colMonthRes.recordset[0].v,
        };

        res.json({ success: true, data: stats });
    } catch (e) {
        console.error('Error fetching dashboard stats:', e);
        e.status = 500;
        e.message = 'حدث خطأ في الخادم';
        throw e;
    }
}));

// ── Recent Activity ─────────────────────────────────────────
router.get('/recent', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const [invRes, colRes, purRes] = await Promise.all([
            pool.request().query(`
                SELECT TOP 10 i.id, i.invoice_no, i.invoice_date, i.grand_total, i.status, c.customer_name
                FROM sales_invoices i
                LEFT JOIN customers c ON i.customer_id = c.id
                ORDER BY i.id DESC
            `),
            pool.request().query(`
                SELECT TOP 10 cc.id, cc.collection_no, cc.collection_date, cc.amount, c.customer_name, cc.payment_method
                FROM customer_collections cc
                LEFT JOIN customers c ON cc.customer_id = c.id
                WHERE cc.amount > 0
                ORDER BY cc.id DESC
            `),
            pool.request().query(`
                SELECT TOP 10 pi.id, pi.invoice_no, pi.invoice_date, pi.grand_total, s.supplier_name
                FROM purchase_invoices pi
                LEFT JOIN suppliers s ON pi.supplier_id = s.id
                ORDER BY pi.id DESC
            `)
        ]);

        res.json({ success: true, data: {
            invoices: invRes.recordset,
            collections: colRes.recordset,
            purchases: purRes.recordset
        }});
    } catch (e) {
        console.error('Error fetching dashboard recent:', e);
        e.status = 500;
        e.message = 'حدث خطأ في الخادم';
        throw e;
    }
}));

// ── Alerts (التنبيهات) ──────────────────────────────────────
router.get('/alerts', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const [lowStockRes, outOfStockRes, overdueRes] = await Promise.all([
            pool.request().query(`
                SELECT TOP 20 p.id, p.product_code, p.product_name, ib.quantity, p.min_stock, p.unit_name
                FROM inventory_balances ib
                JOIN products p ON ib.product_id = p.id
                WHERE ib.quantity <= p.min_stock
                ORDER BY (ib.quantity - p.min_stock) ASC
            `),
            pool.request().query(`
                SELECT TOP 20 p.id, p.product_code, p.product_name, p.unit_name
                FROM products p
                WHERE p.is_active = 1 AND NOT EXISTS (
                    SELECT 1 FROM inventory_balances ib WHERE ib.product_id = p.id AND ib.quantity > 0
                )
            `),
            pool.request().query(`
                SELECT TOP 20 c.id, c.customer_name, COUNT(i.id) as overdue_count,
                       SUM(i.grand_total - i.amount_paid) as overdue_amount
                FROM sales_invoices i
                JOIN customers c ON i.customer_id = c.id
                WHERE i.status NOT IN ('cancelled', 'deleted') AND CAST(i.invoice_date AS DATE) < DATEADD(day, -60, GETDATE())
                  AND (i.grand_total - i.amount_paid) > 0
                GROUP BY c.id, c.customer_name
                ORDER BY overdue_amount DESC
            `)
        ]);

        res.json({ success: true, data: {
            low_stock: lowStockRes.recordset,
            out_of_stock: outOfStockRes.recordset,
            overdue_customers: overdueRes.recordset
        }});
    } catch (e) {
        console.error('Error fetching dashboard alerts:', e);
        e.status = 500;
        e.message = 'حدث خطأ في الخادم';
        throw e;
    }
}));

// ── Sales Chart (مخطط المبيعات اليومي) ──────────────────────
router.get('/chart/sales', asyncHandler(async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const pool = await getPool();
        const dataRes = await pool.request()
            .input('days', sql.Int, days)
            .query(`
                SELECT invoice_date as date, SUM(grand_total) as total, COUNT(*) as count
                FROM sales_invoices
                WHERE status NOT IN ('cancelled', 'deleted') AND CAST(invoice_date AS DATE) >= DATEADD(day, -@days, GETDATE())
                GROUP BY invoice_date
                ORDER BY invoice_date
            `);
        res.json({ success: true, data: dataRes.recordset });
    } catch (e) {
        console.error('Error fetching dashboard chart:', e);
        e.status = 500;
        e.message = 'حدث خطأ في الخادم';
        throw e;
    }
}));

// ── Top Customers and Products ──────────────────────────────
router.get('/top', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const [topCustRes, topProdRes] = await Promise.all([
            pool.request().query(`
                SELECT TOP 5 c.id, c.customer_name, SUM(i.grand_total) as total_sales
                FROM sales_invoices i
                JOIN customers c ON i.customer_id = c.id
                WHERE i.status NOT IN ('cancelled', 'deleted')
                GROUP BY c.id, c.customer_name
                ORDER BY total_sales DESC
            `),
            pool.request().query(`
                SELECT TOP 5 p.id, p.product_name, SUM(si.quantity) as total_qty
                FROM sales_invoice_items si
                JOIN sales_invoices i ON si.invoice_id = i.id
                JOIN products p ON si.product_id = p.id
                WHERE i.status NOT IN ('cancelled', 'deleted')
                GROUP BY p.id, p.product_name
                ORDER BY total_qty DESC
            `)
        ]);

        res.json({ success: true, data: { customers: topCustRes.recordset, products: topProdRes.recordset } });
    } catch (e) {
        console.error('Error fetching dashboard top stats:', e);
        e.status = 500;
        e.message = 'حدث خطأ في الخادم';
        throw e;
    }
}));

// ── Global Search ───────────────────────────────────────────
router.get('/search', asyncHandler(async (req, res) => {
    try {
        const q = req.query.q;
        if (!q) return res.json({ success: true, data: { invoices: [], customers: [], products: [] }});
        
        const pool = await getPool();
        const request = pool.request();
        
        // Use a static parameter name but we must create a request per query or use one request and same param.
        // It's safe to use one request object with the parameter bound once.
        request.input('searchTerm', sql.NVarChar, `%${q}%`);

        const [invRes, custRes, prodRes] = await Promise.all([
            request.query(`SELECT TOP 5 i.id, i.invoice_no, i.grand_total, c.customer_name as name FROM sales_invoices i LEFT JOIN customers c ON i.customer_id = c.id WHERE invoice_no LIKE @searchTerm ORDER BY i.id DESC`),
            request.query(`SELECT TOP 5 id, customer_code as code, customer_name as name FROM customers WHERE customer_name LIKE @searchTerm OR customer_code LIKE @searchTerm`),
            request.query(`SELECT TOP 5 id, product_code as code, product_name as name FROM products WHERE product_name LIKE @searchTerm OR product_code LIKE @searchTerm`)
        ]);

        res.json({ success: true, data: { invoices: invRes.recordset, customers: custRes.recordset, products: prodRes.recordset } });
    } catch (e) {
        console.error('Error fetching dashboard search:', e);
        e.status = 500;
        e.message = 'حدث خطأ في الخادم';
        throw e;
    }
}));

module.exports = router;
