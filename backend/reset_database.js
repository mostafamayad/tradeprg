require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const { getPool } = require('./database/mssql_db');
const sql = require('mssql');

async function clearAllData() {
    console.log('[RESET] Connecting to database...');
    const pool = await getPool();
    console.log('[RESET] Connected. Starting data cleanup...\n');

    // Disable all foreign key constraints first
    await pool.request().query(`EXEC sp_MSforeachtable 'ALTER TABLE ? NOCHECK CONSTRAINT ALL'`);

    const tables = [
        'inventory_adjustments',
        'inventory_adjustment_items',
        'purchase_returns',
        'purchase_return_items',
        'sale_returns',
        'sale_return_items',
        'payment_receipts',
        'payment_vouchers',
        'journal_entries',
        'journal_entry_lines',
        'account_transactions',
        'treasury_transactions',
        'invoice_items',
        'invoices',
        'purchase_items',
        'purchases',
        'stock_movements',
        'products',
        'product_categories',
        'customers',
        'suppliers',
        'sales_reps',
        'stores',
        'treasury_accounts',
        'accounts',
        'users',
        'company_info',
        'settings',
        'activity_logs',
        'license_info',
    ];

    for (const table of tables) {
        try {
            await pool.request().query(`
                IF OBJECT_ID('${table}', 'U') IS NOT NULL
                DELETE FROM [${table}]
            `);
            console.log(`[OK] Cleared: ${table}`);
        } catch (e) {
            console.log(`[!] Skipped: ${table} - ${e.message}`);
        }
    }

    // Re-enable all foreign key constraints
    await pool.request().query(`EXEC sp_MSforeachtable 'ALTER TABLE ? WITH CHECK CHECK CONSTRAINT ALL'`);

    // Re-seed defaults
    console.log('\n[RESET] Re-seeding default data...');

    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync('admin123', 10);

    await pool.request().query(`INSERT INTO company_info (company_name, currency) VALUES (N'شركتي للتجارة', 'EGP')`);
    console.log('[OK] Company info seeded.');

    await pool.request().query(`INSERT INTO stores (store_code, store_name, store_type) VALUES ('ST001', N'المخزن الرئيسي', 'main')`);
    console.log('[OK] Default store seeded.');

    await pool.request().query(`INSERT INTO treasury_accounts (account_name, account_type, opening_balance, current_balance) VALUES (N'الخزينة الرئيسية', 'cash', 0, 0)`);
    console.log('[OK] Default treasury seeded.');

    const req = pool.request();
    req.input('hash', sql.NVarChar, hash);
    await req.query(`INSERT INTO users (username, password_hash, full_name, role) VALUES ('admin@3smcompany.com', @hash, N'مدير النظام', 'admin')`);
    console.log('[OK] Admin user seeded.');

    console.log('\n=============================================');
    console.log('  Reset Complete! Database is clean.');
    console.log('  Login: admin@3smcompany.com');
    console.log('  Password: admin123');
    console.log('=============================================');
    process.exit(0);
}

clearAllData().catch(e => {
    console.error('[RESET] Error:', e.message);
    process.exit(1);
});
