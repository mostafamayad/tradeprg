require('dotenv').config();
const sql = require('mssql'), fs = require('fs');
(async () => {
    const pool = await sql.connect({server:'localhost',port:1433,user:'sa',password:'YourStr0ngPass123',database:'tradedb',options:{encrypt:false}});
    const schema = fs.readFileSync('schema_fixed.sql','utf8');
    const stmts = schema.split(/\bGO\b/i).filter(s => s.trim());
    let ok = 0, fail = 0;
    for (const s of stmts) {
        try { await pool.request().query(s); ok++; }
        catch(e) { fail++; if(e.message.indexOf('already exists') === -1) console.log('ERR:', e.message.substring(0,200)); }
    }
    console.log('Done:', ok, 'ok,', fail, 'failed');
    await sql.close();
})().catch(e => console.error(e));
