const sql = require('mssql/msnodesqlv8');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: './webapp/backend/.env' });

function splitByGo(content) {
    return content
        .split(/^GO\s*$/gim)
        .map(s => s.trim())
        .filter(Boolean);
}

async function run() {
    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.existsSync(migrationsDir)
        ? fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()
        : [];

    if (files.length === 0) {
        console.log('No migrations found.');
        return;
    }

    const pool = new sql.ConnectionPool({
        connectionString: process.env.MSSQL_CONNECTION_STRING || 'Driver={ODBC Driver 17 for SQL Server};Server=.;Database=TradePro;Trusted_Connection=yes;TrustServerCertificate=yes;Encrypt=no;'
    });
    await pool.connect();

    for (const f of files) {
        const fullPath = path.join(migrationsDir, f);
        const content = fs.readFileSync(fullPath, 'utf8');
        const statements = splitByGo(content);
        console.log(`Applying ${f} (${statements.length} statements)`);
        for (const s of statements) {
            await pool.request().batch(s);
        }
    }

    await pool.close();
    console.log('Migrations applied.');
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});

