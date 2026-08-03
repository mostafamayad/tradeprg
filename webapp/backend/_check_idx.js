const { getPool } = require('./database/mssql_db');
(async () => {
    const p = await getPool();
    const idx = await p.request().query("SELECT name, type_desc, is_unique FROM sys.indexes WHERE object_id = OBJECT_ID('chart_of_accounts')");
    idx.recordset.forEach(i => console.log(i.name, i.type_desc, i.is_unique));
    p.close();
})();
