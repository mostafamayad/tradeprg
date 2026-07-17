const express = require('express');
const router = express.Router();
const { getPool, sql } = require('../database/mssql_db');

router.get('/', async (req, res) => {
    try {
        const { customer_id } = req.query;
        const pool = await getPool();
        const request = pool.request();
        let sqlQuery = `SELECT sc.*, c.customer_name FROM ar_security_cheques sc LEFT JOIN customers c ON sc.customer_id = c.id WHERE 1=1`;
        if (customer_id) { sqlQuery += ` AND sc.customer_id = @cid`; request.input('cid', sql.Int, customer_id); }
        sqlQuery += ` ORDER BY sc.id DESC`;
        const result = await request.query(sqlQuery);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        console.error('AR Security Cheques GET error:', err);
        res.status(500).json({ success: false, message: 'خطأ في جلب الشيكات التأمينية', error_detail: err.message });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('scid', sql.Int, req.params.id)
            .query(`SELECT sc.*, c.customer_name FROM ar_security_cheques sc LEFT JOIN customers c ON sc.customer_id = c.id WHERE sc.id = @scid`);
        if (!result.recordset[0]) return res.status(404).json({ success: false, message: 'الشيك التأميني غير موجود' });
        res.json({ success: true, data: result.recordset[0] });
    } catch (err) {
        console.error('AR Security Cheque GET detail error:', err);
        res.status(500).json({ success: false, message: 'خطأ في جلب تفاصيل الشيك التأميني', error_detail: err.message });
    }
});

module.exports = router;
