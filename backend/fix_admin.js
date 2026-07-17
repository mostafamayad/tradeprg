require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const bcrypt = require('bcryptjs');
const sql = require('mssql/msnodesqlv8');
const server = process.env.MSSQL_SERVER || 'localhost';
const drivers = ['ODBC Driver 17 for SQL Server', 'SQL Server Native Client 11.0', 'SQL Server', 'ODBC Driver 18 for SQL Server'];

async function fixAdmin() {
    const hash = bcrypt.hashSync('admin123', 10);
    console.log('Generated hash:', hash, '(length:', hash.length, ')');

    const localServer = server.replace(/^localhost/i, '.');
    let pool;
    for (const driver of drivers) {
        try {
            const connStr = `Driver={${driver}};Server=${localServer};Database=TradePro;Trusted_Connection=yes;Encrypt=no;TrustServerCertificate=yes;`;
            pool = new sql.ConnectionPool({ connectionString: connStr });
            await pool.connect();
            console.log('Connected with driver:', driver);
            break;
        } catch (e) { pool = null; }
    }
    if (!pool) { console.error('Could not connect!'); process.exit(1); }

    const req = pool.request();
    req.input('hash', sql.NVarChar(100), hash);
    req.input('username', sql.NVarChar(255), 'admin@3smcompany.com');

    // Delete and re-insert
    await pool.request().query("DELETE FROM users");
    await req.query(`
        INSERT INTO users (username, password_hash, full_name, role, is_active)
        VALUES (@username, @hash, N'مدير النظام', 'admin', 1)
    `);

    // Verify
    const check = await pool.request()
        .input('u', sql.NVarChar(255), 'admin@3smcompany.com')
        .query('SELECT username, is_active, LEN(password_hash) as hash_len FROM users WHERE username = @u');
    console.log('User record:', check.recordset[0]);
    
    const match = bcrypt.compareSync('admin123', hash);
    console.log('Hash verification:', match ? 'OK' : 'FAILED');
    
    pool.close();
    console.log('Done!');
    process.exit(0);
}

fixAdmin().catch(e => { console.error(e); process.exit(1); });
