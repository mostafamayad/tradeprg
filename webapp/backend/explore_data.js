const sql = require('mssql/msnodesqlv8');
const connStr = 'Driver={ODBC Driver 17 for SQL Server};Server=.;Database=TradePro;Trusted_Connection=yes;Encrypt=no;TrustServerCertificate=yes;Connection Timeout=5;';

async function run() {
    const pool = new sql.ConnectionPool({connectionString: connStr});
    await pool.connect();
    console.log('===== CONNECTED TO TradePro DATABASE =====\n');

    // ========== QUERY 3: SAMPLE DATA ==========
    console.log('========== QUERY 3: SAMPLE DATA FROM KEY TABLES ==========\n');

    // sales_invoices (top 3)
    console.log('--- sales_invoices (top 3) ---');
    let r = await pool.request().query('SELECT TOP 3 * FROM sales_invoices');
    console.log(JSON.stringify(r.recordset, null, 2));
    console.log('');

    // sales_invoice_items (top 5)
    console.log('--- sales_invoice_items (top 5) ---');
    r = await pool.request().query('SELECT TOP 5 * FROM sales_invoice_items');
    console.log(JSON.stringify(r.recordset, null, 2));
    console.log('');

    // sales_returns (top 3)
    console.log('--- sales_returns (top 3) ---');
    r = await pool.request().query('SELECT TOP 3 * FROM sales_returns');
    console.log(JSON.stringify(r.recordset, null, 2));
    console.log('');

    // sales_return_items (top 5)
    console.log('--- sales_return_items (top 5) ---');
    r = await pool.request().query('SELECT TOP 5 * FROM sales_return_items');
    console.log(JSON.stringify(r.recordset, null, 2));
    console.log('');

    // customer_collections
    console.log('--- customer_collections (top 3) ---');
    r = await pool.request().query('SELECT TOP 3 * FROM customer_collections');
    console.log(JSON.stringify(r.recordset, null, 2));
    console.log('');

    // journal_entries (top 3)
    console.log('--- journal_entries (top 3) ---');
    r = await pool.request().query('SELECT TOP 3 * FROM journal_entries');
    console.log(JSON.stringify(r.recordset, null, 2));
    console.log('');

    // journal_entry_lines (top 5)
    console.log('--- journal_entry_lines (top 5) ---');
    r = await pool.request().query('SELECT TOP 5 * FROM journal_entry_lines');
    console.log(JSON.stringify(r.recordset, null, 2));
    console.log('');

    // customers (top 3)
    console.log('--- customers (top 3) ---');
    r = await pool.request().query('SELECT TOP 3 * FROM customers');
    console.log(JSON.stringify(r.recordset, null, 2));
    console.log('');

    // products (top 3)
    console.log('--- products (top 3) ---');
    r = await pool.request().query('SELECT TOP 3 * FROM products');
    console.log(JSON.stringify(r.recordset, null, 2));
    console.log('');

    // sales_reps (top 3)
    console.log('--- sales_reps (top 3) ---');
    r = await pool.request().query('SELECT TOP 3 * FROM sales_reps');
    console.log(JSON.stringify(r.recordset, null, 2));
    console.log('');

    // stores (all rows)
    console.log('--- stores (all rows) ---');
    r = await pool.request().query('SELECT * FROM stores');
    console.log(JSON.stringify(r.recordset, null, 2));
    console.log('');

    // invoice_counters (all rows)
    console.log('--- invoice_counters (all rows) ---');
    r = await pool.request().query('SELECT * FROM invoice_counters');
    console.log(JSON.stringify(r.recordset, null, 2));
    console.log('');

    // ========== QUERY 4: INDEXES ==========
    console.log('========== QUERY 4: INDEXES ON KEY TABLES ==========');
    r = await pool.request().query(`
        SELECT TAB.name AS table_name, IND.name AS index_name, COL.name AS column_name
        FROM sys.indexes IND 
        INNER JOIN sys.index_columns IC ON IND.object_id = IC.object_id AND IND.index_id = IC.index_id
        INNER JOIN sys.columns COL ON IC.object_id = COL.object_id AND IC.column_id = COL.column_id
        INNER JOIN sys.tables TAB ON IND.object_id = TAB.object_id
        WHERE TAB.name IN ('sales_invoices','sales_invoice_items','sales_returns','sales_return_items','customer_collections','journal_entries','journal_entry_lines','customers')
        ORDER BY table_name, index_name
    `);
    console.log(JSON.stringify(r.recordset, null, 2));
    console.log('');

    await pool.close();
    console.log('===== DONE =====');
}

run().catch(e => { console.error('ERROR:', e); process.exit(1); });
