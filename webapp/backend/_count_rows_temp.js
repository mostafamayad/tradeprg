const sql = require('mssql/msnodesqlv8');
const connStr = 'Driver={ODBC Driver 17 for SQL Server};Server=.;Database=TradePro;Trusted_Connection=yes;Encrypt=no;TrustServerCertificate=yes;Connection Timeout=5;';
async function run() {
    const pool = new sql.ConnectionPool({connectionString: connStr});
    await pool.connect();
    const tables = 'chart_of_accounts,customers,suppliers,treasury_accounts,treasury_transactions,expenses,journal_entries,journal_entry_lines,sales_invoices,sales_invoice_items,purchase_invoices,purchase_invoice_items,fiscal_periods,users,products,categories,inventory_balances,stock_movements,sales_returns,sales_return_items,customer_collections,collection_allocations,supplier_payments,checks,sales_reps,stores,activity_logs,invoice_counters,company_info'.split(',');
    console.log('=== TABLE ROW COUNTS ===');
    for (const t of tables) {
        try {
            const r = await pool.request().query('SELECT COUNT(*) as cnt FROM ' + t);
            console.log(t + ': ' + r.recordset[0].cnt);
        } catch(e) { console.log(t + ': NOT FOUND'); }
    }
    await pool.close();
}
run().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
