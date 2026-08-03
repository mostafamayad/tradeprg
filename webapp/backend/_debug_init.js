const sql = require('mssql/msnodesqlv8');
const connStr = "Driver={ODBC Driver 17 for SQL Server};Server=.;Database=TradePro;Trusted_Connection=yes;Encrypt=no;TrustServerCertificate=yes;Connection Timeout=3;";
const pool = new sql.ConnectionPool({ 
    connectionString: connStr, 
    pool: { max: 2, min: 1, acquireTimeoutMillis: 15000 }, 
    options: { validateConnection: false } 
});

async function test() {
    const p = await pool.connect();
    console.log('pool connected, has .on:', typeof p.on);
    
    // Test schema check
    const r1 = await p.request().query("SELECT 1 AS t FROM sys.tables WHERE name = 'company_info'");
    console.log('Schema check:', r1.recordset.length);
    
    // Test logger.js setup
    console.log('Testing logger...');
    const logger = require('./middleware/logger');
    console.log('Logger loaded OK');
    
    process.exit(0);
}

test().catch(e => {
    console.error('Error:', e.message);
    console.error(e.stack);
    process.exit(1);
});
