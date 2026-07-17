// Run ERP sales return migration
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { sql, getPool } = require('./database/mssql_db');

(async () => {
    try {
        const pool = await getPool();
        const sqlText = fs.readFileSync(path.join(__dirname, 'migrate_sales_returns_erp.sql'), 'utf8');

        // Split on GO statement (case insensitive, line-aware)
        const batches = sqlText.split(/^\s*GO\s*$/gim).map(s => s.trim()).filter(s => s.length > 0);

        for (let i = 0; i < batches.length; i++) {
            try {
                await pool.request().batch(batches[i]);
                console.log(`[OK] Batch ${i + 1}/${batches.length}`);
            } catch (e) {
                console.error(`[FAIL] Batch ${i + 1}/${batches.length}:`, e.message);
                throw e;
            }
        }

        // Verify
        const checks = [
            { t: 'sales_returns', c: 'workflow_status' },
            { t: 'sales_return_items', c: 'product_condition' },
            { t: 'sales_return_items', c: 'cost_price_snapshot' },
        ];
        for (const ch of checks) {
            const r = await pool.request().query(`
                SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME='${ch.t}' AND COLUMN_NAME='${ch.c}'
            `);
            console.log(`  Column ${ch.t}.${ch.c}: ${r.recordset.length > 0 ? 'EXISTS' : 'MISSING'}`);
        }
        const reasonCount = await pool.request().query('SELECT COUNT(*) as c FROM return_reasons');
        console.log(`  return_reasons count: ${reasonCount.recordset[0].c}`);
        const damaged = await pool.request().query("SELECT id, store_name FROM stores WHERE store_type IN ('damaged','inspection')");
        console.log('  Special stores:', damaged.recordset);

        process.exit(0);
    } catch (e) {
        console.error('Migration error:', e.message);
        process.exit(1);
    }
})();