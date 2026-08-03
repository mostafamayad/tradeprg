// _backfill_subledger.js
// One-off migration: populate journal_entries.supplier_id / customer_id
// for existing entries so the GL can be the single source of truth for
// supplier/customer balances.
//
// Run: node _backfill_subledger.js
const { getPool, sql } = require('./database/mssql_db');

(async () => {
    let pool;
    try {
        pool = await getPool();
        const r = pool.request();

        // ── Supplier references (current reference_type values) ──
        const supplierMaps = [
            { rt: 'purchase_invoice', join: 'purchase_invoices', fk: 'id', col: 'supplier_id' },
            { rt: 'purchase_return',  join: 'purchase_returns',  fk: 'id', col: 'supplier_id' },
            { rt: 'supplier_payment', join: 'supplier_payments', fk: 'id', col: 'supplier_id' },
            { rt: 'ap_payment',       join: 'ap_payments',       fk: 'id', col: 'supplier_id' },
            { rt: 'ap_note',          join: 'ap_notes',          fk: 'id', col: 'supplier_id' },
            // legacy reference_type values
            { rt: 'purchase',         join: 'purchase_invoices', fk: 'id', col: 'supplier_id' },
            { rt: 'payment',          join: 'supplier_payments', fk: 'id', col: 'supplier_id' }
        ];

        for (const m of supplierMaps) {
            const up = await r.query(`
                UPDATE je
                SET je.supplier_id = s.supplier_id
                FROM journal_entries je
                JOIN ${m.join} s ON s.${m.fk} = je.reference_id
                WHERE je.reference_type = '${m.rt}'
                  AND je.supplier_id IS NULL
                  AND s.supplier_id IS NOT NULL
            `);
            console.log(`supplier ref '${m.rt}' updated rows:`, up.rowsAffected[0]);
        }

        // ── Customer references ──
        const customerMaps = [
            { rt: 'sales_invoice',      join: 'sales_invoices',      fk: 'id', col: 'customer_id' },
            { rt: 'sales_invoice_cogs', join: 'sales_invoices',      fk: 'id', col: 'customer_id' },
            { rt: 'sales_return',       join: 'sales_returns',       fk: 'id', col: 'customer_id' },
            { rt: 'ar_payment',         join: 'ar_payments',         fk: 'id', col: 'customer_id' },
            { rt: 'ar_note',            join: 'ar_notes',            fk: 'id', col: 'customer_id' },
            { rt: 'collection',         join: 'customer_collections',fk: 'id', col: 'customer_id' },
            // legacy
            { rt: 'sales',              join: 'sales_invoices',      fk: 'id', col: 'customer_id' },
            { rt: 'sales_return_legacy',join: 'sales_returns',       fk: 'id', col: 'customer_id' }
        ];

        for (const m of customerMaps) {
            // Skip if the referenced table doesn't exist (e.g. legacy aliases)
            const chk = await r.query(`SELECT 1 FROM sys.tables WHERE name = '${m.join}'`);
            if (chk.recordset.length === 0) continue;
            const up = await r.query(`
                UPDATE je
                SET je.customer_id = s.customer_id
                FROM journal_entries je
                JOIN ${m.join} s ON s.${m.fk} = je.reference_id
                WHERE je.reference_type = '${m.rt}'
                  AND je.customer_id IS NULL
                  AND s.customer_id IS NOT NULL
            `);
            console.log(`customer ref '${m.rt}' updated rows:`, up.rowsAffected[0]);
        }

        // ── Manual JEs: fall back to token-match of supplier/customer id in the SYS_AP/SYS_AR line description ──
        const accRes = await r.query(`SELECT id FROM chart_of_accounts WHERE system_code = 'SYS_AP'`);
        const apAcc = accRes.recordset[0] ? accRes.recordset[0].id : null;
        const arRes = await r.query(`SELECT id FROM chart_of_accounts WHERE system_code = 'SYS_AR'`);
        const arAcc = arRes.recordset[0] ? arRes.recordset[0].id : null;

        if (apAcc) {
            const sups = await r.query(`SELECT id FROM suppliers WHERE is_active = 1`);
            for (const s of sups.recordset) {
                const up = await r.query(`
                    UPDATE je SET je.supplier_id = ${s.id}
                    FROM journal_entries je
                    WHERE je.supplier_id IS NULL
                      AND (je.reference_type IS NULL OR je.reference_type = 'manual_je')
                      AND EXISTS (
                          SELECT 1 FROM journal_entry_lines l
                          WHERE l.entry_id = je.id AND l.account_id = ${apAcc}
                            AND (l.description LIKE N'% ' + '${s.id}' + N' %'
                                 OR l.description LIKE N'${s.id}' + N' %'
                                 OR l.description LIKE N'% ' + '${s.id}')
                      )
                `);
                if (up.rowsAffected[0] > 0) console.log(`manual-je supplier token '${s.id}' updated rows:`, up.rowsAffected[0]);
            }
        }

        if (arAcc) {
            const cus = await r.query(`SELECT id FROM customers WHERE is_active = 1`);
            for (const c of cus.recordset) {
                const up = await r.query(`
                    UPDATE je SET je.customer_id = ${c.id}
                    FROM journal_entries je
                    WHERE je.customer_id IS NULL
                      AND (je.reference_type IS NULL OR je.reference_type = 'manual_je')
                      AND EXISTS (
                          SELECT 1 FROM journal_entry_lines l
                          WHERE l.entry_id = je.id AND l.account_id = ${arAcc}
                            AND (l.description LIKE N'% ' + '${c.id}' + N' %'
                                 OR l.description LIKE N'${c.id}' + N' %'
                                 OR l.description LIKE N'% ' + '${c.id}')
                      )
                `);
                if (up.rowsAffected[0] > 0) console.log(`manual-je customer token '${c.id}' updated rows:`, up.rowsAffected[0]);
            }
        }

        const summary = await r.query(`
            SELECT
              SUM(CASE WHEN supplier_id IS NOT NULL THEN 1 ELSE 0 END) AS with_supplier,
              SUM(CASE WHEN customer_id IS NOT NULL THEN 1 ELSE 0 END) AS with_customer,
              COUNT(*) AS total
            FROM journal_entries
        `);
        console.log('summary:', summary.recordset[0]);
    } catch (e) {
        console.error('BACKFILL ERROR:', e.message);
        process.exitCode = 1;
    } finally {
        if (pool) pool.close();
        process.exit();
    }
})();
