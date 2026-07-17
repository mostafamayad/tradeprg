const { getPool, sql } = require('./database/mssql_db');
(async () => {
    try {
        const pool = await getPool();
        await pool.request().query("DELETE FROM stock_adjustments WHERE adj_no='ADJ-0001'");
        await pool.request().query("UPDATE invoice_counters SET last_number=100 WHERE counter_name='adjustment'");
        await pool.request().query("IF NOT EXISTS(SELECT 1 FROM inventory_balances WHERE store_id=6 AND product_id=10) BEGIN INSERT INTO inventory_balances(store_id, product_id, quantity) VALUES(6, 10, 100) END ELSE BEGIN UPDATE inventory_balances SET quantity=100 WHERE store_id=6 AND product_id=10 END");
        await pool.request().query("INSERT INTO stock_movements(move_date, move_type, document_no, store_id, product_id, qty_in, qty_out, cost_price, balance_after, notes) VALUES(GETDATE(), 'initial', 'INIT-001', 6, 10, 100, 0, 10, 100, 'Test stock')");
        console.log('Stock ready');
        process.exit(0);
    } catch (e) { console.error(e.message); process.exit(1); }
})();
