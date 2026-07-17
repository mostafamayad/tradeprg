const m = require('./database/mssql_db');
m.getPool().then(p => {
    return p.request().query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE' AND (TABLE_NAME LIKE '%expense%' OR TABLE_NAME LIKE '%salary%' OR TABLE_NAME LIKE '%payroll%' OR TABLE_NAME LIKE '%payment%' OR TABLE_NAME LIKE '%collection%' OR TABLE_NAME LIKE '%treasury%' OR TABLE_NAME LIKE '%cash%' OR TABLE_NAME LIKE '%asset%' OR TABLE_NAME LIKE '%loan%' OR TABLE_NAME LIKE '%capital%') ORDER BY TABLE_NAME");
}).then(r => {
    console.log('Cash-related tables:', r.recordset.map(t => t.TABLE_NAME).join(', '));
    // Check expense table columns if it exists
    if (r.recordset.some(t => t.TABLE_NAME === 'expenses')) {
        return p.request().query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='expenses' ORDER BY ORDINAL_POSITION");
    }
    return null;
}).then(cr => {
    if (cr) console.log('expenses columns:', cr.recordset.map(c => c.COLUMN_NAME).join(', '));
    process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
