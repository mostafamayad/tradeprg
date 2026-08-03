// ============================================================
// Diagnosis Script: Database Connection & Schema Check
// Run: node diagnose.js
// ============================================================
require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });

console.log('====================================================');
console.log('  DATABASE CONNECTION DIAGNOSIS');
console.log('====================================================\n');

// ---- Step 1: Print Config ----
console.log('--- 1. ENVIRONMENT CONFIG ---');
console.log('MSSQL_SERVER:', process.env.MSSQL_SERVER);
console.log('MSSQL_DATABASE:', process.env.MSSQL_DATABASE);
console.log('MSSQL_USER:', process.env.MSSQL_USER || '(not set)');
console.log('MSSQL_PASSWORD:', process.env.MSSQL_PASSWORD ? '(set)' : '(not set)');
console.log('MSSQL_USE_WINDOWS_AUTH:', process.env.MSSQL_USE_WINDOWS_AUTH);
console.log('JWT_SECRET:', process.env.JWT_SECRET ? '(set)' : '(NOT SET!)');
console.log('BUILD_PROFILE:', process.env.BUILD_PROFILE);
console.log('');

// ---- Step 2: Test Driver Availability ----
console.log('--- 2. DRIVER CHECK ---');
const useWindowsAuth = process.env.MSSQL_USE_WINDOWS_AUTH === 'true';
console.log('Using Windows Auth:', useWindowsAuth);

if (useWindowsAuth) {
    try {
        const sql = require('mssql/msnodesqlv8');
        console.log('msnodesqlv8 loaded successfully');
        
        // Check which ODBC drivers are available
        const { execSync } = require('child_process');
        try {
            const drivers = execSync('odbcconf /S', { encoding: 'utf8', timeout: 5000 });
            console.log('ODBC Drivers list available');
        } catch (e) {
            console.log('Cannot list ODBC drivers via odbcconf');
        }
    } catch (e) {
        console.error('FAILED to load msnodesqlv8:', e.message);
        console.error('Stack:', e.stack);
    }
} else {
    try {
        const sql = require('mssql');
        console.log('mssql (tedious) loaded successfully');
    } catch (e) {
        console.error('FAILED to load mssql:', e.message);
    }
}
console.log('');

// ---- Step 3: Test Connection ----
console.log('--- 3. CONNECTION TEST ---');
const server = process.env.MSSQL_SERVER || '.';
const database = process.env.MSSQL_DATABASE || 'TradePro';

async function testConnection() {
    const drivers = [
        'ODBC Driver 17 for SQL Server',
        'SQL Server Native Client 11.0',
        'ODBC Driver 13 for SQL Server',
        'SQL Server',
        'ODBC Driver 18 for SQL Server'
    ];

    for (const driver of drivers) {
        try {
            const sql = require('mssql/msnodesqlv8');
            const localServer = server.replace(/^localhost/i, '.');
            const connStr = `Driver={${driver}};Server=${localServer};Database=${database};Trusted_Connection=yes;Encrypt=no;TrustServerCertificate=yes;Connection Timeout=3;`;
            
            console.log(`Trying driver: ${driver}`);
            console.log(`Connection string: Driver={${driver}};Server=${localServer};Database=${database};Trusted_Connection=yes;...`);
            
            const pool = new sql.ConnectionPool({ connectionString: connStr });
            await pool.connect();
            console.log(`  -> CONNECTED SUCCESSFULLY using ${driver}`);
            
            // Test query
            const result1 = await pool.request().query('SELECT 1 AS test_val');
            console.log(`  -> SELECT 1: ${JSON.stringify(result1.recordset[0])}`);
            
            const result2 = await pool.request().query('SELECT COUNT(*) AS cnt FROM users');
            console.log(`  -> COUNT users: ${result2.recordset[0].cnt}`);
            
            // Check tables exist
            console.log('\n--- 4. SCHEMA CHECK ---');
            const tables = ['permissions', 'roles', 'user_roles', 'role_permissions', 'users'];
            for (const table of tables) {
                try {
                    const r = await pool.request()
                        .input('tbl', require('mssql/msnodesqlv8').NVarChar, table)
                        .query(`SELECT COUNT(*) AS cnt FROM sys.tables WHERE name = @tbl`);
                    console.log(`Table "${table}": ${r.recordset[0].cnt > 0 ? 'EXISTS' : 'MISSING!'}`);
                } catch (e) {
                    console.log(`Table "${table}": CHECK FAILED - ${e.message}`);
                }
            }

            // Check is_super_admin column
            try {
                const colCheck = await pool.request().query(`
                    SELECT COUNT(*) AS cnt FROM sys.columns 
                    WHERE object_id = OBJECT_ID('users') AND name = 'is_super_admin'
                `);
                console.log(`Column users.is_super_admin: ${colCheck.recordset[0].cnt > 0 ? 'EXISTS' : 'MISSING!'}`);
            } catch (e) {
                console.log(`Column users.is_super_admin: CHECK FAILED - ${e.message}`);
            }

            // Check if admin user exists
            try {
                const adminCheck = await pool.request().query(`
                    SELECT id, username, is_super_admin, is_active FROM users WHERE id = 1
                `);
                if (adminCheck.recordset.length > 0) {
                    const u = adminCheck.recordset[0];
                    console.log(`User ID 1: username=${u.username}, is_super_admin=${u.is_super_admin}, is_active=${u.is_active}`);
                } else {
                    console.log('User ID 1: NOT FOUND');
                }
            } catch (e) {
                console.log(`User ID 1 check: FAILED - ${e.message}`);
            }

            pool.close();
            console.log('\n=== DIAGNOSIS COMPLETE ===');
            return;
        } catch (e) {
            console.log(`  -> FAILED: ${e.message}`);
        }
    }
    
    console.error('\n!!! ALL DRIVERS FAILED !!!');
    console.error('Could not connect to SQL Server with any driver.');
    console.error('Check that:');
    console.error('1. SQL Server is running (Services > SQL Server)');
    console.error('2. Windows Authentication is enabled');
    console.error('3. The server name is correct:', server);
    console.error('4. The database exists:', database);
    console.error('5. You have permission to access it');
}

testConnection().catch(e => {
    console.error('\nFATAL ERROR:', e.message);
    console.error(e.stack);
    process.exit(1);
});
