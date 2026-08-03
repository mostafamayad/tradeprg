const { getPool, sql } = require('./database/mssql_db');
(async () => {
    const pool = await getPool();
    // FK constraints
    const fk = await pool.request().query(`SELECT OBJECT_NAME(fk.parent_object_id) as t, COL_NAME(fkc.parent_object_id, fkc.parent_column_id) as c, OBJECT_NAME(fk.referenced_object_id) as rt, COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) as rc FROM sys.foreign_keys fk JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id WHERE OBJECT_NAME(fk.parent_object_id) = 'journal_entry_lines'`);
    console.log('FK on journal_entry_lines:', JSON.stringify(fk.recordset, null, 2));
    // Treasury accounts
    const ta = await pool.request().query('SELECT * FROM treasury_accounts');
    console.log('\nTreasury accounts:', JSON.stringify(ta.recordset, null, 2));
    // Chart of accounts system codes
    const coa = await pool.request().query('SELECT id, account_code, account_name, account_type, system_code, current_balance FROM chart_of_accounts ORDER BY account_code');
    console.log('\nChart of accounts:');
    coa.recordset.forEach(a => console.log(`  ${a.id}\t${a.account_code}\t${a.system_code || '-'}\t${a.account_name}\tbal=${a.current_balance}`));
    // Journal entries count
    const je = await pool.request().query('SELECT COUNT(*) as c FROM journal_entries');
    console.log('\nJournal entries:', je.recordset[0].c);
    const jel = await pool.request().query('SELECT COUNT(*) as c FROM journal_entry_lines');
    console.log('Journal entry lines:', jel.recordset[0].c);
    // Check if journal_entry_lines has account_type from chart
    const sample = await pool.request().query('SELECT TOP 5 jel.*, coa.account_name, coa.account_code FROM journal_entry_lines jel JOIN chart_of_accounts coa ON jel.account_id = coa.id');
    console.log('\nSample JEL entries:', JSON.stringify(sample.recordset, null, 2));
    // Check if there are any with account_id not matching chart_of_accounts
    const orphan = await pool.request().query('SELECT COUNT(*) as c FROM journal_entry_lines WHERE account_id NOT IN (SELECT id FROM chart_of_accounts)');
    console.log('Orphan JEL lines (bad FK):', orphan.recordset[0].c);
    // Check current state of the system
    const coaBal = await pool.request().query("SELECT SUM(CASE WHEN account_type IN ('asset','expense') THEN current_balance ELSE 0 END) as dr, SUM(CASE WHEN account_type IN ('liability','equity','revenue') THEN current_balance ELSE 0 END) as cr FROM chart_of_accounts");
    console.log('COA balance total:', JSON.stringify(coaBal.recordset[0]));
    pool.close();
})();
