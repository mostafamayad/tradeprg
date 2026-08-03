const { getPool } = require('./database/mssql_db');

async function run() {
  const p = await getPool();
  try {
    const res = await p.request().query("SELECT * FROM chart_of_accounts WHERE system_code = 'SYS_PURCHASE_DISCOUNT'");
    if (res.recordset.length === 0) {
      await p.request().query(`
        INSERT INTO chart_of_accounts (account_code, account_name, account_type, parent_id, system_code)
        VALUES ('4200', N'خصم مكتسب', 'revenue', (SELECT TOP 1 id FROM chart_of_accounts WHERE account_type = 'revenue'), 'SYS_PURCHASE_DISCOUNT')
      `);
      console.log("Created SYS_PURCHASE_DISCOUNT");
    } else {
      console.log("SYS_PURCHASE_DISCOUNT already exists.");
    }
  } catch (err) {
    console.error(err);
  }
  process.exit(0);
}

run();
