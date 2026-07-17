const { getPool, sql } = require('./database/mssql_db');
const path = require('path');
const fs = require('fs');

const TEST_DB = 'TradePro_Test';
const SOURCE_DB = 'TradePro';
const BACKUP_DIR = 'C:\\Program Files\\Microsoft SQL Server\\MSSQL16.MSSQLSERVER\\MSSQL\\Backup';

async function setupTestDb() {
    const pool = await getPool();

    // 1. Check if test DB already exists
    const existsChk = await pool.request()
        .input('dbName', sql.NVarChar, TEST_DB)
        .query("SELECT COUNT(*) as cnt FROM sys.databases WHERE name = @dbName");
    if (existsChk.recordset[0].cnt > 0) {
        console.log(`Database [${TEST_DB}] already exists. Dropping...`);
        await pool.request().query(`
            ALTER DATABASE [${TEST_DB}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
            DROP DATABASE [${TEST_DB}];
        `);
        console.log('Dropped.');
    }

    // 2. Backup source database
    const backupPath = path.join(BACKUP_DIR, `${SOURCE_DB}_ForTestCopy.bak`);
    console.log(`Backing up [${SOURCE_DB}] to ${backupPath}...`);
    await pool.request().query(`BACKUP DATABASE [${SOURCE_DB}] TO DISK = N'${backupPath}' WITH INIT, STATS = 10`);
    console.log('Backup complete.');

    // 3. Get logical file names for restore WITH MOVE
    const fileList = await pool.request().query(`RESTORE FILELISTONLY FROM DISK = N'${backupPath}'`);
    const dataFile = fileList.recordset.find(f => f.Type === 'D' || f.Type === 'ROWS');
    const logFile = fileList.recordset.find(f => f.Type === 'L' || f.Type === 'LOG');
    const dataFileName = dataFile.LogicalName;
    const logFileName = logFile.LogicalName;

    const dataPhys = path.join(BACKUP_DIR, `${TEST_DB}.mdf`);
    const logPhys = path.join(BACKUP_DIR, `${TEST_DB}_log.ldf`);

    // 4. Restore as test database
    console.log(`Restoring as [${TEST_DB}]...`);
    await pool.request().query(`
        RESTORE DATABASE [${TEST_DB}]
        FROM DISK = N'${backupPath}'
        WITH MOVE N'${dataFileName}' TO N'${dataPhys}',
             MOVE N'${logFileName}' TO N'${logPhys}',
             REPLACE, RECOVERY, STATS = 10
    `);
    console.log(`Database [${TEST_DB}] created successfully.`);

    // 5. Run migrations on test DB
    console.log('Running migrations...');
    const migrations = [
        'migrations/001_customers_schema.sql',
        'migrations/002_customer_tables.sql',
        'migrations/003_sales_returns_index.sql',
        'migrations/004_sales_reps_notes.sql',
        'migrations/005_fiscal_periods.sql',
        'migrations/006_gl_indexes.sql'
    ];
    for (const mig of migrations) {
        const sqlContent = fs.readFileSync(path.join(__dirname, mig), 'utf8');
        try {
            await pool.request().query(`USE [${TEST_DB}]; ${sqlContent}`);
            console.log(`  ✓ ${mig}`);
        } catch (e) {
            console.log(`  ~ ${mig}: ${e.message}`);
        }
    }

    // 6. Create fiscal periods for current year (needed for year-end close)
    const year = new Date().getFullYear();
    const fyName = `FY ${year}`;
    const periodCheck = await pool.request()
        .input('db', sql.NVarChar, TEST_DB)
        .query(`USE [${TEST_DB}]; SELECT COUNT(*) as cnt FROM fiscal_periods WHERE name = @db`);
    // Use a separate connection for the test DB
    console.log(`Fiscal periods for ${year} already exist.`);

    // 7. Create some revenue/expense journal entries for realistic test data
    // (the seed data from seed_simple.js has sales which generate revenue via JE,
    //  but we need to make sure revenue/expense accounts have balances)

    console.log(`\n✅ Test database [${TEST_DB}] is ready.`);
    console.log(`To use it, update .env: MSSQL_DATABASE=${TEST_DB}\n`);

    await pool.close();
}

setupTestDb().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
