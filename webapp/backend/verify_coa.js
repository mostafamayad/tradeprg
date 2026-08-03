const { getPool, sql } = require('./database/mssql_db');
(async () => {
    const pool = await getPool();

    // ── 1. Print current COA state ──
    const r = await pool.request().query("SELECT id, account_code, account_name, account_type, system_code, parent_id FROM chart_of_accounts ORDER BY account_code");
    console.log('=== CURRENT COA STATE ===');
    console.log('Total accounts:', r.recordset.length);
    const sys = r.recordset.filter(a => a.system_code);
    console.log('With system_code:', sys.length);
    console.log('');
    r.recordset.forEach(a => {
        const sc = a.system_code ? a.system_code.padEnd(25) : '(no sys-code)'.padEnd(25);
        const pid = a.parent_id ? 'pid:'+String(a.parent_id).padEnd(5) : '         ';
        console.log('  '+a.account_code.padEnd(6)+sc+pid+a.account_name.padEnd(30)+a.account_type);
    });
    console.log('');

    // ── 2. Verify all required system codes exist ──
    const expected = ['SYS_CASH','SYS_BANK','SYS_AR','SYS_INVENTORY','SYS_VAT_INPUT',
        'SYS_DAMAGED_INVENTORY','SYS_AP','SYS_VAT_OUTPUT','SYS_RETAINED_EARNINGS',
        'SYS_SALES','SYS_INVENTORY_SURPLUS','SYS_PURCHASE_RETURNS',
        'SYS_COGS','SYS_PURCHASES','SYS_EXPENSE','SYS_INVENTORY_SHORTAGE','SYS_SALES_RETURNS',
        'SYS_SALES_DISCOUNT'];
    const missing = [];
    for (const code of expected) {
        const chk = await pool.request()
            .input('sc', sql.NVarChar, code)
            .query("SELECT id FROM chart_of_accounts WHERE system_code = @sc");
        if (chk.recordset.length === 0) missing.push(code);
    }
    if (missing.length === 0) {
        console.log('✅ ALL '+expected.length+' system accounts exist');
    } else {
        console.log('❌ MISSING: '+missing.join(', '));
    }

    // ── 3. Verify no duplicate system_codes ──
    const dup = await pool.request().query("SELECT system_code, COUNT(*) as cnt FROM chart_of_accounts WHERE system_code IS NOT NULL GROUP BY system_code HAVING COUNT(*) > 1");
    if (dup.recordset.length === 0) {
        console.log('✅ No duplicate system_codes');
    } else {
        console.log('❌ DUPLICATES: '+dup.recordset.map(d=>d.system_code+' ('+d.cnt+'x)').join(', '));
    }

    // ── 4. Verify hierarchy integrity ──
    const allAcc = r.recordset;
    let broken = 0;
    for (const a of allAcc) {
        if (a.parent_id) {
            const pid = Number(a.parent_id);
            const parent = allAcc.find(p => Number(p.id) === pid);
            if (!parent) {
                console.log('❌ Orphan: '+a.account_code+' has parent_id='+a.parent_id+' which does not exist');
                broken++;
            }
        }
    }
    if (broken === 0) console.log('✅ All parent references valid');

    pool.close();
})();
