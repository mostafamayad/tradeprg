const { getPool, sql, resetPool, createDirectConnection } = require('./database/mssql_db');

async function run() {
    const pool = await getPool();
    const BACKUP_PATH = 'C:\\Program Files\\Microsoft SQL Server\\MSSQL16.MSSQLSERVER\\MSSQL\\Backup\\e2e_restore_test.bak';
    const dbRes = await pool.request().query('SELECT DB_NAME() AS db');
    const dbName = dbRes.recordset[0].db;

    async function step(msg, fn) {
        try {
            await fn();
            console.log(`  ✓ ${msg}`);
        } catch (e) {
            console.log(`  ✗ ${msg}: ${e.originalError?.message || e.message}`);
            throw e;
        }
    }

    console.log('=== E2E RESTORE TEST ===');
    console.log(`Database: ${dbName}`);

    const ts = Date.now();
    // 1. Create a test customer
    console.log('\n--- 1. Create test customer ---');
    const c = await pool.request()
        .input('name', sql.NVarChar, 'TEST_CUSTOMER_FOR_RESTORE')
        .query(`
            INSERT INTO customers (customer_code, customer_name, phone, current_balance, opening_balance)
            OUTPUT INSERTED.id
            VALUES ('TC-RESTORE-${ts}', @name, '0111111111', 5000, 0)
        `);
    const customerId = c.recordset[0].id;
    console.log(`  Created customer id=${customerId}, code=TC-RESTORE-${ts}`);

    // 2. Also create a test supplier
    const s = await pool.request()
        .input('name', sql.NVarChar, 'TEST_SUPPLIER_FOR_RESTORE')
        .query(`
            INSERT INTO suppliers (supplier_code, supplier_name, phone, current_balance, opening_balance)
            OUTPUT INSERTED.id
            VALUES ('TS-RESTORE-${ts}', @name, '0222222222', 3000, 0)
        `);
    const supplierId = s.recordset[0].id;
    console.log(`  Created supplier id=${supplierId}, code=TS-RESTORE-${ts}`);

    // 3. Take backup
    console.log('\n--- 2. Take backup ---');
    await step('BACKUP DATABASE', () =>
        pool.request().query(`BACKUP DATABASE [${dbName}] TO DISK = N'${BACKUP_PATH}' WITH INIT, STATS = 10`)
    );

    // 4. Verify backup via SQL Server
    const sizeRes = await pool.request().query(`
        SELECT TOP 1 backup_size/1048576.0 as size_mb, backup_size as size_bytes
        FROM msdb.dbo.backupset WHERE database_name = '${dbName}'
        ORDER BY backup_finish_date DESC
    `);
    const fileSize = sizeRes.recordset[0]?.size_bytes || 0;
    console.log(`  Backup confirmed: ${(fileSize/1048576).toFixed(2)} MB`);

    // 5. Verify backup with RESTORE VERIFYONLY
    await step('RESTORE VERIFYONLY', () =>
        pool.request().query(`RESTORE VERIFYONLY FROM DISK = N'${BACKUP_PATH}'`)
    );

    // 6. Delete the customer and supplier
    console.log('\n--- 3. Delete test records ---');
    await step('Delete test customer', () =>
        pool.request().query(`DELETE FROM customers WHERE id = ${customerId}`)
    );
    await step('Delete test supplier', () =>
        pool.request().query(`DELETE FROM suppliers WHERE id = ${supplierId}`)
    );

    // Confirm they're gone
    const checkDel = await pool.request().query(`SELECT COUNT(*) as cnt FROM customers WHERE id = ${customerId}`);
    console.log(`  Customer exists after delete: ${checkDel.recordset[0].cnt > 0}`);

    // 7. RESTORE via dedicated connection to master
    console.log('\n--- 4. RESTORE DATABASE ---');
    let restoreConn;
    try {
        restoreConn = await createDirectConnection('master');
        await restoreConn.request().query(`
            ALTER DATABASE [${dbName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
        `);
        console.log('  ✓ SET SINGLE_USER');
        await restoreConn.request().query(`
            RESTORE DATABASE [${dbName}] FROM DISK = N'${BACKUP_PATH}' WITH REPLACE, RECOVERY;
        `);
        console.log('  ✓ RESTORE DATABASE');
        await restoreConn.request().query(`
            ALTER DATABASE [${dbName}] SET MULTI_USER;
        `);
        console.log('  ✓ SET MULTI_USER');
    } catch (e) {
        console.log(`  ✗ RESTORE failed: ${e.originalError?.message || e.message}`);
        throw e;
    } finally {
        if (restoreConn) try { await restoreConn.close(); } catch (ex) { /* ignore */ }
    }

    // 8. Reset connection pool
    console.log('\n--- 5. Reset connection pool ---');
    await step('resetPool()', () => resetPool());

    // 9. Verify data
    console.log('\n--- 6. Verify restored data ---');
    const newPool = await getPool();

    const custCheck = await newPool.request()
        .input('id', sql.Int, customerId)
        .query(`SELECT id, customer_name, current_balance FROM customers WHERE id = @id`);

    if (custCheck.recordset.length > 0) {
        console.log(`  ✓ Customer '${custCheck.recordset[0].customer_name}' EXISTS (balance=${custCheck.recordset[0].current_balance})`);
    } else {
        console.log('  ✗ CUSTOMER NOT FOUND AFTER RESTORE!');
        process.exit(1);
    }

    const supCheck = await newPool.request()
        .input('id', sql.Int, supplierId)
        .query(`SELECT id, supplier_name, current_balance FROM suppliers WHERE id = @id`);

    if (supCheck.recordset.length > 0) {
        console.log(`  ✓ Supplier '${supCheck.recordset[0].supplier_name}' EXISTS (balance=${supCheck.recordset[0].current_balance})`);
    } else {
        console.log('  ✗ SUPPLIER NOT FOUND AFTER RESTORE!');
        process.exit(1);
    }

    // 10. Verify key table row counts
    console.log('\n--- 7. Health check ---');
    const tables = ['users','customers','suppliers','products','stores','sales_invoices','chart_of_accounts'];
    for (const t of tables) {
        const r = await newPool.request().query(`SELECT COUNT(*) as cnt FROM [${t}]`);
        console.log(`  ${t}: ${r.recordset[0].cnt} rows`);
    }

    console.log('\n========================================');
    console.log('  E2E RESTORE TEST: PASSED');
    console.log('========================================');
    process.exit(0);
}

run().catch(e => {
    console.error('\nE2E TEST FAILED:', e.message);
    if (e.originalError) console.error('SQL:', e.originalError.message);
    process.exit(1);
});
