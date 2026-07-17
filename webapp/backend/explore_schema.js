const sql = require('mssql/msnodesqlv8');
const connStr = 'Driver={ODBC Driver 17 for SQL Server};Server=.;Database=TradePro;Trusted_Connection=yes;Encrypt=no;TrustServerCertificate=yes;Connection Timeout=5;';

async function run() {
    const pool = new sql.ConnectionPool({connectionString: connStr});
    await pool.connect();
    console.log('===== CONNECTED TO TradePro DATABASE =====\n');

    // Query 1: List all tables
    console.log('========== QUERY 1: ALL TABLES ==========');
    const tablesResult = await pool.request().query(
        "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME"
    );
    console.log(JSON.stringify(tablesResult.recordset, null, 2));
    const tableNames = tablesResult.recordset.map(r => r.TABLE_NAME);
    console.log('Total tables:', tableNames.length);
    console.log('');

    // Query 2: Columns for each table
    console.log('========== QUERY 2: COLUMNS FOR EACH TABLE ==========');
    for (const tn of tableNames) {
        const colResult = await pool.request()
            .input('tn', sql.NVarChar, tn)
            .query("SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @tn ORDER BY ORDINAL_POSITION");
        console.log('--- Table: ' + tn + ' ---');
        console.log(JSON.stringify(colResult.recordset, null, 2));
        console.log('');
    }

    // Close pool
    await pool.close();
    console.log('===== DONE =====');
}

run().catch(e => { console.error('ERROR:', e); process.exit(1); });
