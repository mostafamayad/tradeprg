const { getPool } = require('./database/mssql_db');
(async () => {
    const pool = await getPool();
    
    // Check customers table columns
    const r1 = await pool.request().query(`
        SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'customers' ORDER BY ORDINAL_POSITION
    `);
    console.log('=== customers columns ===');
    r1.recordset.forEach(c => console.log(`  ${c.COLUMN_NAME} (${c.DATA_TYPE})`));
    
    // Check sales_invoices columns
    const r2 = await pool.request().query(`
        SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'sales_invoices' ORDER BY ORDINAL_POSITION
    `);
    console.log('\n=== sales_invoices columns ===');
    r2.recordset.forEach(c => console.log(`  ${c.COLUMN_NAME} (${c.DATA_TYPE})`));
    
    // Check sales_invoice_items columns
    const r3 = await pool.request().query(`
        SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'sales_invoice_items' ORDER BY ORDINAL_POSITION
    `);
    console.log('\n=== sales_invoice_items columns ===');
    r3.recordset.forEach(c => console.log(`  ${c.COLUMN_NAME} (${c.DATA_TYPE})`));
    
    // Check sales_returns columns
    const r4 = await pool.request().query(`
        SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'sales_returns' ORDER BY ORDINAL_POSITION
    `);
    console.log('\n=== sales_returns columns ===');
    r4.recordset.forEach(c => console.log(`  ${c.COLUMN_NAME} (${c.DATA_TYPE})`));
    
    // Check customer_collections columns
    const r5 = await pool.request().query(`
        SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'customer_collections' ORDER BY ORDINAL_POSITION
    `);
    console.log('\n=== customer_collections columns ===');
    r5.recordset.forEach(c => console.log(`  ${c.COLUMN_NAME} (${c.DATA_TYPE})`));
    
    // Check sales_reps table
    const r6 = await pool.request().query(`
        SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'sales_reps' ORDER BY ORDINAL_POSITION
    `);
    console.log('\n=== sales_reps columns ===');
    r6.recordset.forEach(c => console.log(`  ${c.COLUMN_NAME} (${c.DATA_TYPE})`));
    
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
