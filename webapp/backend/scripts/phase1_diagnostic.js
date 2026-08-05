// ============================================================
// PHASE 1 — LEGACY SYSTEM USAGE AUDIT (READ-ONLY, no writes)
// ------------------------------------------------------------
// Purpose: Determine whether the legacy collection/allocation
// tables are actually used before deciding on any migration.
// Run from the backend directory where .env is located:
//    node scripts/phase1_diagnostic.js
// ============================================================

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const path = require('path');
const useWindowsAuth = process.env.MSSQL_USE_WINDOWS_AUTH === 'true';
const sql = useWindowsAuth ? require('mssql/msnodesqlv8') : require('mssql');

async function main() {
    const server = process.env.MSSQL_SERVER || '.';
    const database = process.env.MSSQL_DATABASE || 'TradePro';

    const config = {
        server: server.replace(/^localhost/i, '.'),
        database: database,
        options: { trustedConnection: true, enableArithAbort: true, trustServerCertificate: true, encrypt: false },
        pool: { max: 5, min: 1 }
    };
    if (!useWindowsAuth) { config.user = process.env.MSSQL_USER; config.password = process.env.MSSQL_PASSWORD; }

    const pool = await new sql.ConnectionPool(config).connect();
    const r = async (q) => (await pool.request().query(q)).recordset;

    console.log('\n=== PHASE 1: LEGACY vs MODERN ALLOCATION USAGE ===\n');

    // 1. Row counts
    console.log('--- 1) ROW COUNTS ---');
    for (const t of ['customer_collections', 'collection_allocations', 'ar_payments', 'ar_payment_allocations',
                     'supplier_payments', 'ap_payments', 'supplier_payment_allocations', 'ap_payment_allocations']) {
        try { const x = await r(`SELECT COUNT(*) AS cn FROM ${t}`); console.log(`   ${t}: ${x[0].cn}`); }
        catch (e) { console.log(`   ${t}: ERROR (${e.message})`); }
    }

    console.log('\n--- 1b) COUNTERS (ar_payments / collections / ap_payments / supplier_payments) ---');
    for (const c of ['ar_payments', 'ap_payments', 'collections', 'supplier_payments']) {
        try {
            const x = await r(`SELECT counter_name, prefix, last_number FROM invoice_counters WHERE counter_name = '${c}'`);
            if (x.length === 0) console.log(`   counter '${c}': MISSING`);
            else console.log(`   counter '${c}': prefix='${x[0].prefix}' last_number=${x[0].last_number}`);
        } catch (e) { console.log(`   counter '${c}': ERROR (${e.message})`); }
    }

    // 2. Date ranges (to judge real vs test data)
    console.log('\n--- 2) DATE RANGES ---');
    try { const x = await pool.request().query(`SELECT MIN(created_at) AS mn, MAX(created_at) AS mx FROM collection_allocations`); console.log(`   collection_allocations created: ${x.recordset[0].mn}  =>  ${x.recordset[0].mx}`); } catch(e){console.log('   (no created_at or empty)');}
    try { const x = await r(`SELECT MIN(payment_date) AS mn, MAX(payment_date) AS mx FROM ar_payments`); console.log(`   ar_payments payment_date: ${x[0].mn}  =>  ${x[0].mx}`); } catch(e){}
    try { const x = await r(`SELECT MIN(collection_date) AS mn, MAX(collection_date) AS mx FROM customer_collections`); console.log(`   customer_collections date: ${x[0].mn}  =>  ${x[0].mx}`); } catch(e){}

    // 3. Invoices distributed in BOTH tables
    console.log('\n--- 3) INVOICES IN BOTH ALLOCATION TABLES (overlap risk) ---');
    try {
        const x = await r(`
            SELECT COUNT(*) AS overlap FROM (
                SELECT ca.invoice_id FROM collection_allocations ca
                INTERSECT
                SELECT apa.invoice_id FROM ar_payment_allocations apa
            ) ov`);
        console.log(`   Invoices with allocations in BOTH tables: ${x[0].overlap}`);
    } catch (e) { console.log('   ERROR: ' + e.message); }

    // 4. old-only vs new-only payments
    console.log('\n--- 4) OLD-ONLY vs NEW-ONLY COLLECTIONS ---');
    try {
        const oldOnly = await r(`
            SELECT COUNT(*) AS cn FROM customer_collections cc
            WHERE NOT EXISTS (SELECT 1 FROM ar_payments ap WHERE ap.customer_id = cc.customer_id AND ap.amount = cc.amount AND ap.payment_date = cc.collection_date)`);
        console.log(`   customer_collections with NO ar_payment twin: ${oldOnly[0].cn} (LOBILITY to migrate)`);
    } catch (e) { console.log('   ERROR: ' + e.message); }

    // 5. Legacy invoices / total scaled
    console.log('\n--- 5) LEGACY ALLOCATION MAGNITUDE ---');
    try {
        const x = await r(`SELECT COUNT(DISTINCT invoice_id) AS inv, SUM(amount) AS amt FROM collection_allocations`);
        console.log(`   distinct invoices in collection_allocations: ${x[0].inv}, total amount: ${x[0].amt}`);
    } catch (e) { console.log('   ERROR: ' + e.message); }

    // 6. Empty / test detection: any customer_collections at all + referenced by checks
    console.log('\n--- 6) SANITY / TEST-DATA HINTS ---');
    try {
        const x = await r(`SELECT COUNT(DISTINCT collection_id) AS cc FROM collection_allocations`);
        console.log(`   distinct customer_collections referenced in collection_allocations: ${x[0].cc}`);
    } catch (e) { console.log('   ERROR: ' + e.message); }

    // 7. AP STRUCTURAL HAZARD: payment_id collision between ap_payments & supplier_payments
    console.log('\n--- 7) AP ID-COLLISION PROOF (supplier_payment_allocations) ---');
    try {
        const x = await r(`
            SELECT COUNT(*) AS collided FROM supplier_payment_allocations spa
            WHERE EXISTS (SELECT 1 FROM ap_payments ap WHERE ap.id = spa.payment_id)
              AND EXISTS (SELECT 1 FROM supplier_payments sp WHERE sp.id = spa.payment_id)
        `);
        const y = await r(`SELECT COUNT(*) AS total FROM supplier_payment_allocations`);
        console.log(`   total rows in supplier_payment_allocations: ${y[0].total}`);
        console.log(`   rows whose payment_id matches BOTH ap_payments.id AND supplier_payments.id (collision): ${x[0].collided}`);
    } catch (e) { console.log('   ERROR: ' + e.message); }

    await pool.close();
    console.log('\n=== END AUDIT ===\n');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });