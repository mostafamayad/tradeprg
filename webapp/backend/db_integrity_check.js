const { getPool, sql } = require('./database/mssql_db');

async function check() {
    const pool = await getPool();
    console.log('=== TradePro Purchase Module Integrity Check ===\n');
    
    try {
        // 1. Orphan purchase_return_items (no parent return)
        const orphan1 = await pool.request().query(`
            SELECT pri.* FROM purchase_return_items pri
            LEFT JOIN purchase_returns pr ON pri.return_id = pr.id
            WHERE pr.id IS NULL
        `);
        console.log('1. Orphan purchase_return_items (no parent return):', orphan1.recordset.length, 'rows');
        if (orphan1.recordset.length > 0) {
            console.log('   Details:', JSON.stringify(orphan1.recordset, null, 4));
        }
    } catch (e) { console.log('1. Orphan return items - ERROR:', e.message); }

    try {
        // 2. Orphan purchase_returns (no parent invoice, excluding free returns)
        const orphan2 = await pool.request().query(`
            SELECT pr.* FROM purchase_returns pr
            LEFT JOIN purchase_invoices pi ON pr.invoice_id = pi.id
            WHERE pr.invoice_id IS NOT NULL AND pi.id IS NULL
        `);
        console.log('\n2. Orphan purchase_returns (no parent invoice):', orphan2.recordset.length, 'rows');
        if (orphan2.recordset.length > 0) {
            console.log('   Details:', JSON.stringify(orphan2.recordset, null, 4));
        }
    } catch (e) { console.log('\n2. Orphan returns - ERROR:', e.message); }

    try {
        // 3. Negative stock
        const negStock = await pool.request().query(`
            SELECT ib.*, p.product_name FROM inventory_balances ib
            JOIN products p ON ib.product_id = p.id
            WHERE ib.quantity < 0
        `);
        console.log('\n3. Negative stock items:', negStock.recordset.length, 'rows');
        if (negStock.recordset.length > 0) {
            console.log('   Details:', JSON.stringify(negStock.recordset, null, 4));
        }
    } catch (e) { console.log('\n3. Negative stock - ERROR:', e.message); }

    try {
        // 4. Supplier balances with issues
        const badBal = await pool.request().query(`
            SELECT COUNT(*) as cnt FROM suppliers
            WHERE ISNULL(current_balance, 0) < 0 OR current_balance IS NULL
        `);
        console.log('\n4. Suppliers with balance issues (NULL or negative):', badBal.recordset[0].cnt);
    } catch (e) { console.log('\n4. Supplier balances - ERROR:', e.message); }

    try {
        // 5. Duplicate stock_movements reversal entries
        const dupRev = await pool.request().query(`
            SELECT reference_id, COUNT(*) as cnt FROM stock_movements
            WHERE move_type = 'return_reversal'
            GROUP BY reference_id
            HAVING COUNT(*) > 1
        `);
        console.log('\n5. Duplicate return_reversal entries:', dupRev.recordset.length, 'rows');
        if (dupRev.recordset.length > 0) {
            console.log('   Details:', JSON.stringify(dupRev.recordset, null, 4));
        }
    } catch (e) { console.log('\n5. Duplicate reversals - ERROR:', e.message); }

    try {
        // 6. Invoice return_status consistency
        const inconsistent = await pool.request().query(`
            SELECT pi.id, pi.invoice_no, pi.return_status,
                   (SELECT COUNT(*) FROM purchase_returns pr WHERE pr.invoice_id = pi.id AND pr.status NOT IN ('cancelled','deleted')) as actual_returns
            FROM purchase_invoices pi
            WHERE pi.return_status IS NOT NULL
        `);
        console.log('\n6. Invoice return_status vs actual returns:');
        console.log('   Total invoices with return_status:', inconsistent.recordset.length);
        const mismatches = inconsistent.recordset.filter(r => {
            if (r.return_status === 'Normal' && r.actual_returns > 0) return true;
            if (r.return_status === 'Returned' && r.actual_returns === 0) return true;
            return false;
        });
        console.log('   Mismatches:', mismatches.length);
        if (mismatches.length > 0) {
            console.log('   Details:', JSON.stringify(mismatches, null, 4));
        }
    } catch (e) { console.log('\n6. return_status consistency - ERROR:', e.message); }

    try {
        // 7. Recent stock movements sample
        const stockMovements = await pool.request().query(`
            SELECT TOP 10 sm.*, p.product_name 
            FROM stock_movements sm
            JOIN products p ON sm.product_id = p.id
            WHERE sm.move_type IN ('in', 'out', 'return', 'return_reversal')
            ORDER BY sm.id DESC
        `);
        console.log('\n7. Recent stock movements (last 10 rows):', stockMovements.recordset.length, 'rows');
        if (stockMovements.recordset.length > 0) {
            console.log('   Details:', JSON.stringify(stockMovements.recordset, null, 4));
        }
    } catch (e) { console.log('\n7. Stock movements - ERROR:', e.message); }

    // Summary
    console.log('\n=== Integrity Check Complete ===');

    try { await pool.close(); } catch (e) {}
}

check().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
});
