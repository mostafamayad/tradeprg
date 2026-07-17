// ============================================================
// ROUTE: Sales Collections (Payments from Customers)
// ============================================================

const router = require('express').Router();
const { getPool, sql } = require('../../database/mssql_db');
const { postJournalEntryAsync, reverseJournalEntryAsync, getSystemAccountAsync, recalcCustomerBalanceAsync } = require('../../services/accountingEngine');
const { updateStockBalanceAsync } = require('../../services/stockEngine');
const { nextDocNoAsync } = require('../../services/documentEngine');
const { userHasPermission } = require('../../middleware/permissions');
const logActivity = require('../../middleware/logger');
const asyncHandler = require('../../utils/asyncHandler');

// ── Collections (Payments from Customers) ─────────────────
router.get('/collections', async (req, res) => {
    try {
        const { q, customer_id, from, to } = req.query;
        const pool = await getPool();
        const request = pool.request();
        let sqlQuery = `SELECT cc.*, c.customer_name FROM customer_collections cc LEFT JOIN customers c ON cc.customer_id = c.id WHERE 1=1`;
        
        if (q) { sqlQuery += ` AND (cc.collection_no LIKE @q OR c.customer_name LIKE @q)`; request.input('q', sql.NVarChar, `%${q}%`); }
        if (customer_id) { sqlQuery += ` AND cc.customer_id = @customerId`; request.input('customerId', sql.Int, customer_id); }
        if (from) { sqlQuery += ` AND cc.collection_date >= @from`; request.input('from', sql.NVarChar, from); }
        if (to) { sqlQuery += ` AND cc.collection_date <= @to`; request.input('to', sql.NVarChar, to); }
        
        sqlQuery += ` ORDER BY cc.id DESC`;
        const result = await request.query(sqlQuery);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        console.error('Sales collections GET error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
});

module.exports = router;
