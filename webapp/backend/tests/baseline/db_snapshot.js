/**
 * Layer 2 — Database Snapshot Baseline
 *
 * Captures:
 *   - Row counts for all tables
 *   - Checksums (COUNT + SUM of numeric columns) for key tables
 *   - Last identity IDs for high-volume tables
 *   - Schema version
 *   - Index existence check
 *
 * After any migration, run this to verify nothing changed unintentionally.
 */

const Suite = require('../lib/runner');

const KEY_TABLES = [
    'sales_reps', 'customers', 'suppliers', 'products', 'stores',
    'sales_invoices', 'sales_invoice_items',
    'customer_collections', 'collection_allocations',
    'sales_returns', 'sales_return_items',
    'purchase_invoices', 'purchase_invoice_items',
    'purchase_returns', 'purchase_return_items',
    'users', 'settings', 'activity_logs'
];

const COUNT_ONLY_TABLES = [
    'company_info', 'branches', 'categories', 'inventory_balances',
    'stock_movements', 'stock_transfers', 'stock_transfer_items',
    'damaged_stock', 'stock_count', 'stock_count_items',
    'stock_adjustments', 'journal_entries', 'journal_entry_lines',
    'chart_of_accounts', 'treasury_accounts', 'treasury_transactions',
    'expenses', 'salary_slips', 'emp_loans',
    'checks', 'customer_notes', 'customer_visits',
    'rep_targets', 'rep_settlements',
    'invoice_counters', 'customer_groups', 'customer_activity_log',
    'customer_attachments', 'return_reasons', 'sales_return_audit'
];

const TABLES_WITH_SUM = [
    { table: 'sales_invoices', column: 'grand_total' },
    { table: 'customer_collections', column: 'amount' },
    { table: 'sales_returns', column: 'grand_total' },
    { table: 'purchase_invoices', column: 'grand_total' },
];

const INDEXES_TO_VERIFY = [
    { name: 'IX_sales_invoices_rep_id_status', table: 'sales_invoices', cols: ['rep_id', 'status'] },
    { name: 'IX_customer_collections_rep_id', table: 'customer_collections', cols: ['rep_id'] },
    { name: 'IX_sales_returns_invoice_id', table: 'sales_returns', cols: ['invoice_id'] },
    { name: 'IX_customers_rep_id', table: 'customers', cols: ['rep_id'] },
];

module.exports = async function dbSnapshotSuite() {
    const pool = require('../../database/mssql_db');
    const p = await pool.getPool();
    const sql = pool.sql;

    const suite = new Suite('Layer 2 — Database Snapshot');

    // Snapshot data to be saved
    const snapshot = {
        timestamp: new Date().toISOString(),
        tableCounts: {},
        tableSums: {},
        lastIds: {},
        indexes: {},
        schemaVersion: null
    };

    // Helper: run a query and return recordset
    async function q(query) {
        const r = await p.request().query(query);
        return r.recordset;
    }

    await suite.run([

        // ── Table Row Counts ──
        {
            name: 'Row counts for all key tables',
            fn: async () => {
                const allTables = [...KEY_TABLES, ...COUNT_ONLY_TABLES];
                for (const table of allTables) {
                    const r = await q(`SELECT COUNT(*) AS cnt FROM ${table}`);
                    snapshot.tableCounts[table] = r[0].cnt;
                }
                // Log a summary
                const totalRows = Object.values(snapshot.tableCounts).reduce((a, b) => a + b, 0);
                console.log(`     ${allTables.length} tables checked, ${totalRows.toLocaleString()} total rows`);
            }
        },

        // ── Financial Checksums ──
        {
            name: 'Financial table checksums (SUM of key amount columns)',
            fn: async () => {
                for (const { table, column } of TABLES_WITH_SUM) {
                    const r = await q(`SELECT COALESCE(SUM(${column}), 0) AS total FROM ${table}`);
                    snapshot.tableSums[`${table}.${column}`] = parseFloat(r[0].total) || 0;
                    console.log(`     ${table}.${column}: ${r[0].total}`);
                }
            }
        },

        // ── Last Identity IDs ──
        {
            name: 'Last identity IDs for high-volume tables',
            fn: async () => {
                const idTables = ['sales_invoices', 'customer_collections', 'sales_returns', 'customers', 'sales_reps', 'products'];
                for (const table of idTables) {
                    const r = await q(`SELECT ISNULL(MAX(id), 0) AS last_id FROM ${table}`);
                    snapshot.lastIds[table] = r[0].last_id;
                }
            }
        },

        // ── Index Verification ──
        {
            name: 'Critical indexes exist',
            fn: async () => {
                for (const idx of INDEXES_TO_VERIFY) {
                    const colList = idx.cols.map(c => `'${c}'`).join(',');
                    const r = await q(`
                        SELECT COUNT(*) AS cnt FROM sys.indexes i
                        JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
                        JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
                        JOIN sys.tables t ON i.object_id = t.object_id
                        WHERE t.name = '${idx.table}' AND i.name = '${idx.name}'
                          AND c.name IN (${colList})
                        GROUP BY i.name
                    `);
                    const exists = r.length > 0;
                    snapshot.indexes[idx.name] = exists;
                    if (!exists) console.log(`     ⚠️  MISSING: ${idx.name} on ${idx.table}(${idx.cols.join(',')})`);
                }
            }
        },

        // ── Schema Version ──
        {
            name: 'Schema version and migration state',
            fn: async () => {
                // Check if schema_versions table exists
                const tableCheck = await q(`
                    SELECT COUNT(*) AS cnt FROM sys.tables WHERE name = 'schema_versions'
                `);
                if (tableCheck[0].cnt > 0) {
                    const versions = await q('SELECT * FROM schema_versions ORDER BY version');
                    snapshot.schemaVersion = versions;
                    console.log(`     ${versions.length} migration(s) applied`);
                } else {
                    snapshot.schemaVersion = null;
                    console.log('     No schema_versions table (pre-versioned-migration state)');
                }
            }
        },

        // ── SQL Server Version ──
        {
            name: 'SQL Server version and database info',
            fn: async () => {
                const r = await q("SELECT SERVERPROPERTY('ProductVersion') AS version, DB_NAME() AS db_name");
                console.log(`     SQL Server: ${r[0].version}, Database: ${r[0].db_name}`);
            }
        },
    ]);

    // Save snapshot to report
    const fs = require('fs');
    const path = require('path');
    const reportPath = path.resolve(__dirname, '../reports/db-snapshot.json');
    fs.writeFileSync(reportPath, JSON.stringify(snapshot, null, 2));
    console.log(`📁  DB snapshot saved: ${reportPath}`);

    return suite;
};
