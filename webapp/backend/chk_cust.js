const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { getPool } = require('./database/mssql_db');
(async () => {
  const pool = await getPool();
  const r = await pool.request().query(`SELECT id, entry_no, source_module, source_action, reference_type, reference_id, customer_id, supplier_id, created_at FROM journal_entries ORDER BY id`);
  console.table(r.recordset);
  process.exit(0);
})();
