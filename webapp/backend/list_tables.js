const { getPool } = require('./database/mssql_db');

async function run() {
  const p = await getPool();
  const tables = await p.request().query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'");
  console.log("All Tables:");
  console.log(tables.recordset.map(t => t.TABLE_NAME).join(', '));
  process.exit(0);
}

run();
