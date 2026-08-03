const { getPool } = require('./database/mssql_db');

async function run() {
  const p = await getPool();
  const res = await p.request().query("SELECT id, system_code, account_name FROM chart_of_accounts WHERE system_code LIKE 'SYS_PURCHASE%' OR system_code LIKE 'SYS_AP%'");
  console.log("AP Accounts:");
  console.log(res.recordset);
  process.exit(0);
}

run();
