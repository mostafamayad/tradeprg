require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const useWindowsAuth = process.env.MSSQL_USE_WINDOWS_AUTH === 'true';
const sql = useWindowsAuth ? require('mssql/msnodesqlv8') : require('mssql');

async function main() {
    const server = process.env.MSSQL_SERVER || '.';
    const database = process.env.MSSQL_DATABASE || 'TradePro';

    const config = {
        server: server.replace(/^localhost/i, '.'),
        database: database,
        options: { trustedConnection: true, enableArithAbort: true, trustServerCertificate: true, encrypt: false },
        pool: { max: 5, min: 1, acquireTimeoutMillis: 15000, idleTimeoutMillis: 30000 }
    };
    if (!useWindowsAuth) {
        config.user = process.env.MSSQL_USER;
        config.password = process.env.MSSQL_PASSWORD;
    }

    const pool = await new sql.ConnectionPool(config).connect();
    console.log('=== Checking ar_payments table ===');
    let r = await pool.request().query(`SELECT 1 FROM sys.tables WHERE name = 'ar_payments'`);
    console.log('ar_payments exists:', r.recordset.length > 0);

    r = await pool.request().query(`SELECT 1 FROM sys.tables WHERE name = 'ar_payment_allocations'`);
    console.log('ar_payment_allocations exists:', r.recordset.length > 0);

    r = await pool.request().query(`SELECT 1 FROM sys.tables WHERE name = 'customer_collections'`);
    console.log('customer_collections exists:', r.recordset.length > 0);

    r = await pool.request().query(`SELECT 1 FROM sys.tables WHERE name = 'collection_allocations'`);
    console.log('collection_allocations exists:', r.recordset.length > 0);

    if (await tableExists(pool, 'ar_payments')) {
        console.log('\n=== ar_payments columns ===');
        r = await pool.request().query(`SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'ar_payments' ORDER BY ORDINAL_POSITION`);
        r.recordset.forEach(c => console.log(`  ${c.COLUMN_NAME} ${c.DATA_TYPE}(${c.CHARACTER_MAXIMUM_LENGTH || 'max'}) ${c.IS_NULLABLE === 'NO' ? 'NOT NULL' : 'NULL'} ${c.COLUMN_DEFAULT || ''}`));
    }

    if (await tableExists(pool, 'ar_payment_allocations')) {
        console.log('\n=== ar_payment_allocations columns ===');
        r = await pool.request().query(`SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'ar_payment_allocations' ORDER BY ORDINAL_POSITION`);
        r.recordset.forEach(c => console.log(`  ${c.COLUMN_NAME} ${c.DATA_TYPE}(${c.CHARACTER_MAXIMUM_LENGTH || 'max'}) ${c.IS_NULLABLE === 'NO' ? 'NOT NULL' : 'NULL'} ${c.COLUMN_DEFAULT || ''}`));
    }

    if (await tableExists(pool, 'customer_collections')) {
        console.log('\n=== customer_collections columns ===');
        r = await pool.request().query(`SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'customer_collections' ORDER BY ORDINAL_POSITION`);
        r.recordset.forEach(c => console.log(`  ${c.COLUMN_NAME} ${c.DATA_TYPE}(${c.CHARACTER_MAXIMUM_LENGTH || 'max'}) ${c.IS_NULLABLE === 'NO' ? 'NOT NULL' : 'NULL'} ${c.COLUMN_DEFAULT || ''}`));
    }

    if (await tableExists(pool, 'collection_allocations')) {
        console.log('\n=== collection_allocations columns ===');
        r = await pool.request().query(`SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'collection_allocations' ORDER BY ORDINAL_POSITION`);
        r.recordset.forEach(c => console.log(`  ${c.COLUMN_NAME} ${c.DATA_TYPE}(${c.CHARACTER_MAXIMUM_LENGTH || 'max'}) ${c.IS_NULLABLE === 'NO' ? 'NOT NULL' : 'NULL'} ${c.COLUMN_DEFAULT || ''}`));
    }

    // Check foreign keys
    console.log('\n=== ar_payments FK ===');
    r = await pool.request().query(`
        SELECT fk.name AS fk_name, tp.name AS parent_table, ref.name AS referenced_table, c.name AS col, rc.name AS ref_col
        FROM sys.foreign_keys fk
        INNER JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
        INNER JOIN sys.tables tp ON fk.parent_object_id = tp.object_id
        INNER JOIN sys.tables ref ON fk.referenced_object_id = ref.object_id
        INNER JOIN sys.columns c ON fkc.parent_column_id = c.column_id AND fkc.parent_object_id = c.object_id
        INNER JOIN sys.columns rc ON fkc.referenced_column_id = rc.column_id AND fkc.referenced_object_id = rc.object_id
        WHERE tp.name = 'ar_payments'
    `);
    if (r.recordset.length === 0) console.log('  No FK found (table may not exist or has no FKs)');
    r.recordset.forEach(fk => console.log(`  ${fk.fk_name}: ${fk.col} -> ${fk.referenced_table}.${fk.ref_col}`));

    console.log('\n=== customer_collections FK ===');
    r = await pool.request().query(`
        SELECT fk.name AS fk_name, tp.name AS parent_table, ref.name AS referenced_table, c.name AS col, rc.name AS ref_col
        FROM sys.foreign_keys fk
        INNER JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
        INNER JOIN sys.tables tp ON fk.parent_object_id = tp.object_id
        INNER JOIN sys.tables ref ON fk.referenced_object_id = ref.object_id
        INNER JOIN sys.columns c ON fkc.parent_column_id = c.column_id AND fkc.parent_object_id = c.object_id
        INNER JOIN sys.columns rc ON fkc.referenced_column_id = rc.column_id AND fkc.referenced_object_id = rc.object_id
        WHERE tp.name = 'customer_collections'
    `);
    r.recordset.forEach(fk => console.log(`  ${fk.fk_name}: ${fk.col} -> ${fk.referenced_table}.${fk.ref_col}`));

    // Row counts
    for (const tbl of ['ar_payments', 'ar_payment_allocations', 'customer_collections', 'collection_allocations']) {
        if (await tableExists(pool, tbl)) {
            r = await pool.request().query(`SELECT COUNT(*) as cnt FROM ${tbl}`);
            console.log(`\n${tbl} row count:`, r.recordset[0].cnt);
        }
    }

    // Check for any triggers on ar_payments
    if (await tableExists(pool, 'ar_payments')) {
        r = await pool.request().query(`SELECT name FROM sys.triggers WHERE parent_id = OBJECT_ID('ar_payments')`);
        console.log('\nar_payments triggers:', r.recordset.map(t => t.name).join(', ') || 'none');
    }

    await pool.close();
}

async function tableExists(pool, name) {
    const r = await pool.request().query(`SELECT 1 FROM sys.tables WHERE name = '${name}'`);
    return r.recordset.length > 0;
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
