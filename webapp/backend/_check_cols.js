require('dotenv').config({ path: 'D:/tradeprg/webapp/backend/.env' });
const sql = require('mssql/msnodesqlv8');
const drivers = ['ODBC Driver 17 for SQL Server', 'SQL Server Native Client 11.0', 'ODBC Driver 13 for SQL Server', 'SQL Server', 'ODBC Driver 18 for SQL Server'];
(async () => {
  let p, lastErr;
  for (const driver of drivers) {
    try {
      p = await new sql.ConnectionPool({ server: '.', database: 'TradeProCI', driver, options: { trustedConnection: true, trustServerCertificate: true, encrypt: false } }).connect();
      break;
    } catch (e) { lastErr = e; if (!String(e.message).match(/Data source name not found|Provider cannot be found|Invalid connection string attribute|does not exist/)) throw e; }
  }
  if (!p) throw lastErr;
  const r = await p.request().query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ar_payment_allocations' ORDER BY ORDINAL_POSITION");
  console.log('ar_payment_allocations columns:', r.recordset.map(x => x.COLUMN_NAME).join(' | '));
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });