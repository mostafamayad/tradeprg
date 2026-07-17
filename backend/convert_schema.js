const fs = require('fs');

const sqliteSchema = JSON.parse(fs.readFileSync('schema.json', 'utf8'));
let sqlServerScript = '-- SQL Server Schema Migration for TradePro ERP\n\n';

for (const table of sqliteSchema) {
    if (table.name === 'sqlite_sequence') continue;

    let sql = table.sql;
    
    sql = sql.replace(/IF NOT EXISTS/gi, '');
    
    // Auto increment
    sql = sql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'INT IDENTITY(1,1) PRIMARY KEY');
    sql = sql.replace(/INTEGER PRIMARY KEY/gi, 'INT IDENTITY(1,1) PRIMARY KEY');
    
    // Remove DEFAULT on IDENTITY columns (e.g. company_info id)
    sql = sql.replace(/INT IDENTITY\(1,1\) PRIMARY KEY DEFAULT 1/gi, 'INT IDENTITY(1,1) PRIMARY KEY');
    
    // SQLite types to SQL Server types
    sql = sql.replace(/INTEGER/gi, 'INT');
    sql = sql.replace(/REAL/gi, 'DECIMAL(18,4)');
    
    // TEXT replacements
    sql = sql.replace(/TEXT/gi, 'NVARCHAR(255)');
    
    // SQLite defaults datetime to 'YYYY-MM-DD HH:MM:SS'
    sql = sql.replace(/DEFAULT \(datetime\('now', 'localtime'\)\)/gi, "DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120)");
    sql = sql.replace(/DEFAULT \(datetime\('now'\)\)/gi, "DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120)");
    
    // MAX for specific large texts
    sql = sql.replace(/notes NVARCHAR\(255\)/gi, 'notes NVARCHAR(MAX)');
    sql = sql.replace(/description NVARCHAR\(255\)/gi, 'description NVARCHAR(MAX)');
    sql = sql.replace(/details NVARCHAR\(255\)/gi, 'details NVARCHAR(MAX)');
    sql = sql.replace(/permissions NVARCHAR\(255\)/gi, 'permissions NVARCHAR(MAX)');
    sql = sql.replace(/address NVARCHAR\(255\)/gi, 'address NVARCHAR(1000)');

    // Replace double quotes with single quotes for DEFAULT constraints
    sql = sql.replace(/"/g, "'");

    sqlServerScript += sql + ';\nGO\n\n';
}

fs.writeFileSync('schema.sql', sqlServerScript);
console.log('Schema converted to schema.sql with correct datetime format and quotes');
