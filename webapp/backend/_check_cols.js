const { getPool, sql } = require('./database/mssql_db');
(async () => {
    const pool = await getPool();
    const cols = await pool.request().query("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'chart_of_accounts'");
    console.log('COA columns:');
    cols.recordset.forEach(c => console.log('  ' + c.COLUMN_NAME + ' (' + c.DATA_TYPE + ')'));
    
    const colsJe = await pool.request().query("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'journal_entries'");
    console.log('\nJE columns:');
    colsJe.recordset.forEach(c => console.log('  ' + c.COLUMN_NAME + ' (' + c.DATA_TYPE + ')'));
    
    const colsT = await pool.request().query("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'treasury_accounts'");
    console.log('\nTreasury columns:');
    colsT.recordset.forEach(c => console.log('  ' + c.COLUMN_NAME + ' (' + c.DATA_TYPE + ')'));
    
    pool.close();
})();
