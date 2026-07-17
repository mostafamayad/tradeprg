const { getPool } = require('./database/mssql_db');
(async () => {
    const pool = await getPool();
    const r = await pool.request().query("SELECT id, account_code, account_name, parent_id, system_code FROM chart_of_accounts ORDER BY account_code");
    console.log('=== ID MAP ===');
    r.recordset.forEach(a => {
        console.log(`  id=${String(a.id).padEnd(3)} code=${a.account_code.padEnd(5)} parent=${a.parent_id}  ${a.account_name.padEnd(30)} sys=${a.system_code || '-'}`);
    });
    pool.close();
})();
