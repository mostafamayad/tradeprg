const sql = require('mssql/msnodesqlv8');
const fs = require('fs');
require('dotenv').config({path: './webapp/backend/.env'});

async function run() {
    const pool = new sql.ConnectionPool({ connectionString: 'Driver={ODBC Driver 17 for SQL Server};Server=.;Database=TradePro;Trusted_Connection=yes;TrustServerCertificate=yes;Encrypt=no;' });
    await pool.connect();
    
    console.log('Dropping existing tables...');
    await pool.request().batch(`
        DECLARE @sql NVARCHAR(MAX) = N''; 
        SELECT @sql += 'ALTER TABLE ' + QUOTENAME(OBJECT_SCHEMA_NAME(parent_object_id)) + '.' + QUOTENAME(OBJECT_NAME(parent_object_id)) + ' DROP CONSTRAINT ' + QUOTENAME(name) + ';' 
        FROM sys.foreign_keys; 
        EXEC sp_executesql @sql; 
        
        SET @sql = N''; 
        SELECT @sql += 'DROP TABLE ' + QUOTENAME(TABLE_SCHEMA) + '.' + QUOTENAME(TABLE_NAME) + ';' 
        FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'; 
        EXEC sp_executesql @sql;
    `);
    
    console.log('Tables dropped. Applying schema...');
    let content = fs.readFileSync('./webapp/backend/schema.sql', 'utf8');
    let statements = content.split(/^GO\s*$/im).map(s=>s.trim()).filter(s=>s);
    
    let changed = true;
    while(statements.length > 0 && changed) {
        changed = false;
        let remaining = [];
        for(let s of statements) {
            try {
                await pool.request().batch(s);
                changed = true;
            } catch(e) {
                remaining.push(s);
            }
        }
        statements = remaining;
    }
    
    if (statements.length > 0) {
        throw new Error('Unresolved FKs or syntax errors: ' + statements.length + ' statements remaining.');
    }
    
    console.log('Schema created successfully!');
    process.exit(0);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
