const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { login, headers, BASE_URL } = require('../tests/lib/auth');
const { getPool, sql } = require('../database/mssql_db');

const API = (p) => `${BASE_URL}${p}`;
async function call(method, p, body) {
    const r = await fetch(API(p), {
        method,
        headers: headers(),
        body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await r.json(); } catch (e) { data = { raw: true }; }
    return { status: r.status, data };
}
async function db(sqlText, params = {}) {
    const p = await getPool();
    const r = p.request();
    for (const [k, v] of Object.entries(params)) r.input(k, sql.Int, v);
    const x = await r.query(sqlText);
    return x.recordset;
}
(async () => {
    await login();

    // 1. Customer statement (GL-based) for customer 2
    const st = await call('GET', `/collections/customer/2/statement`, null);
    const rows = (st.data && st.data.data && st.data.data.rows) || (st.data && st.data.rows) || null;
    const closing = (st.data && (st.data.data && st.data.data.closing_balance)) || (st.data && st.data.closing_balance);
    console.log('\n[Kشف الحساب — customer 2]');
    console.log(JSON.stringify({ status: st.status, rows, closing_balance: closing }, null, 2));

    // 2. GL: net AR per customer + overall trial balance
    const gl = await db(`
        SELECT COALESCE(SUM(jl.debit - jl.credit),0) AS net_ar
        FROM journal_entry_lines jl
        JOIN journal_entries je ON je.id = jl.entry_id
        LEFT JOIN chart_of_accounts ca ON ca.id = jl.account_id AND ca.system_code='SYS_AR'
        WHERE je.customer_id = @c AND (je.is_reversed IS NULL OR je.is_reversed=0)
    `, { c: 2 });

    const tb = await db(`
        SELECT
          (SELECT COALESCE(SUM(total_debit),0) FROM journal_entries WHERE is_reversed IS NULL OR is_reversed=0) AS debit,
          (SELECT COALESCE(SUM(total_credit),0) FROM journal_entries WHERE is_reversed IS NULL OR is_reversed=0) AS credit
    `);

    const arAccount = await db(`
        SELECT ca.id, ca.account_code, ca.account_name, ca.current_balance
        FROM chart_of_accounts ca WHERE ca.system_code='SYS_AR'
    `);

    const cust = await db(`SELECT id, current_balance FROM customers WHERE id = @c`, { c: 2 });

    const balanced = Math.abs(tb[0].debit - tb[0].credit) < 0.01;

    console.log('\n[A generality/GL/TB]');
    console.log(JSON.stringify({
        GL_net_AR_customer2: gl[0].net_ar,
        customer_current_balance: cust[0].current_balance,
        SYS_AR_account: arAccount[0],
        trial_balance: tb[0],
        trial_balance_balanced: balanced ? 'PASS (debit==credit)' : 'FAIL'
    }, null, 2));
    process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });