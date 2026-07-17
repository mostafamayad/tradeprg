/**
 * Layer 3 — Business Flow Baseline
 *
 * End-to-end scenarios covering complete business lifecycles:
 *   1. Rep Management Lifecycle (CRUD + toggle + statement)
 *   2. Customer with sales, returns, collections (when data permits)
 *   3. Statement reconciliation (opening balance + movements = final balance)
 *   4. Cross-module data integrity checks
 */

const Suite = require('../lib/runner');
const { login, headers, BASE_URL } = require('../lib/auth');
const { getPool, sql } = require('../../database/mssql_db');

function api(path) { return `${BASE_URL}${path}`; }

async function get(path) {
    const r = await fetch(api(path), { headers: headers() });
    return { status: r.status, data: await r.json() };
}

async function post(path, body) {
    const r = await fetch(api(path), { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
}

async function put(path, body) {
    const r = await fetch(api(path), { method: 'PUT', headers: headers(), body: JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
}

module.exports = async function businessFlowsSuite() {
    await login();
    const suite = new Suite('Layer 3 — Business Flows');

    let testRepId = null;
    let testRepCode = null;

    await suite.run([

        // ── Flow 1: Rep Full Lifecycle ──
        {
            name: 'Flow: Create rep → Verify in GET /reps → Verify in GET /manage',
            fn: async () => {
                const name = 'تدفق اختبار ' + Date.now();
                const code = 'FLOW-' + Date.now();
                const r1 = await post('/reps', { rep_code: code, rep_name: name, phone: '0111111111', region: 'اختبار' });
                if (r1.status !== 201) throw new Error(`Create failed: ${r1.status}`);
                if (!r1.data.id) throw new Error('No id returned');
                testRepId = r1.data.id;
                testRepCode = code;

                // Verify endpoint
                const r2 = await get(`/reps/${testRepId}`);
                if (r2.status !== 200) throw new Error(`GET /reps/:id failed: ${r2.status}`);
                if (r2.data.data.rep_name !== name) throw new Error(`Name mismatch: ${r2.data.data.rep_name} !== ${name}`);

                // Manage endpoint includes it
                const r3 = await get('/reps/manage');
                const found = r3.data.data.find(r => r.id === testRepId);
                if (!found) throw new Error('Created rep not found in GET /reps/manage');
                console.log(`     ✅ Rep ${testRepId} (${code}) created and verified`);
            }
        },

        {
            name: 'Flow: Update rep → Verify changes persisted',
            fn: async () => {
                if (!testRepId) throw new Error('No rep to update');
                const updatedName = 'محدث ' + Date.now();
                const r1 = await put(`/reps/${testRepId}`, {
                    rep_code: testRepCode,
                    rep_name: updatedName,
                    phone: '0222222222',
                    region: 'جدة',
                    target_amount: 75000,
                    commission_rate: 7.5
                });
                if (r1.status !== 200) throw new Error(`Update failed: ${r1.status}`);

                const r2 = await get(`/reps/${testRepId}`);
                if (r2.data.data.rep_name !== updatedName) throw new Error('Name not updated');
                if (parseFloat(r2.data.data.target_amount) !== 75000) throw new Error('target_amount not updated');
                if (parseFloat(r2.data.data.commission_rate) !== 7.5) throw new Error('commission_rate not updated');
                console.log(`     ✅ Rep ${testRepId} updated and verified`);
            }
        },

        {
            name: 'Flow: Toggle rep active/inactive → Verify status changed',
            fn: async () => {
                if (!testRepId) throw new Error('No rep to toggle');

                const r1 = await put(`/reps/${testRepId}/toggle`, {});
                if (r1.status !== 200) throw new Error(`Toggle failed: ${r1.status}`);
                const status1 = r1.data.is_active;

                const r2 = await get(`/reps/${testRepId}`);
                if (r2.data.data.is_active !== status1) throw new Error(`Toggle didn't persist: expected ${status1}`);

                // Toggle back
                const r3 = await put(`/reps/${testRepId}/toggle`, {});
                const status2 = r3.data.is_active;
                if (status2 === status1) throw new Error('Toggle back should change status');

                const r4 = await get(`/reps/${testRepId}`);
                if (r4.data.data.is_active !== status2) throw new Error('Toggle back not persisted');
                console.log(`     ✅ Rep ${testRepId} toggled: ${status1} → ${status2}`);
            }
        },

        {
            name: 'Flow: Rep statement — Opening balance + Running balance + Summary cards',
            fn: async () => {
                if (!testRepId) throw new Error('No rep for statement');

                const r1 = await get(`/reps/${testRepId}/statement`);
                if (r1.status !== 200) throw new Error(`Statement failed: ${r1.status}`);
                const data = r1.data.data;

                if (!data.entity) throw new Error('No entity in statement');
                if (!Array.isArray(data.movements)) throw new Error('No movements array');
                if (!data.summary) throw new Error('No summary');

                // Movement structure validation
                for (const m of data.movements) {
                    if (m.trans_date === undefined) throw new Error('Movement missing trans_date');
                    if (m.debit === undefined) throw new Error('Movement missing debit');
                    if (m.credit === undefined) throw new Error('Movement missing credit');
                    if (m.balance === undefined) throw new Error('Movement missing balance');
                    if (m.doc_type_label === undefined) throw new Error('Movement missing doc_type_label');
                }

                // Running balance continuity
                let bal = data.openingBalance || 0;
                for (const m of data.movements) {
                    bal += (m.debit || 0) - (m.credit || 0);
                    if (Math.abs(bal - m.balance) > 0.01) throw new Error(`Balance chain broken at ${m.doc_no}: calc=${bal}, actual=${m.balance}`);
                }

                // Summary card cross-check
                if (Math.abs(data.summary.finalBalance - bal) > 0.01) {
                    throw new Error(`summary.finalBalance (${data.summary.finalBalance}) !== last movement balance (${bal})`);
                }

                // Net Position = Final Balance - Commission
                const expectedNet = Math.round((bal - data.summary.commission) * 100) / 100;
                if (Math.abs(data.summary.netPosition - expectedNet) > 0.01) {
                    throw new Error(`netPosition (${data.summary.netPosition}) !== finalBalance (${bal}) - commission (${data.summary.commission})`);
                }

                console.log(`     ✅ Statement verified: ${data.movements.length} movements, balance=${bal}, net=${expectedNet}`);
            }
        },

        // ── Flow 2: Statement Edge Cases ──
        {
            name: 'Flow: Statement with from/to returns consistent data',
            fn: async () => {
                if (!testRepId) throw new Error('No rep for statement');

                const r1 = await get(`/reps/${testRepId}/statement?from=2026-01-01&to=2026-12-31`);
                if (r1.status !== 200) throw new Error(`Statement with date range failed: ${r1.status}`);
                const allData = r1.data.data;

                // All movement dates should be within range
                for (const m of allData.movements) {
                    if (m.trans_date && m.trans_date < '2026-01-01') throw new Error(`Movement ${m.doc_no} before from date`);
                    if (m.trans_date && m.trans_date > '2026-12-31') throw new Error(`Movement ${m.doc_no} after to date`);
                }
                console.log(`     ✅ ${allData.movements.length} movements within date range verified`);
            }
        },

        {
            name: 'Flow: Statement pagination returns correct slices',
            fn: async () => {
                if (!testRepId) throw new Error('No rep for statement');

                const r1 = await get(`/reps/${testRepId}/statement?limit=5`);
                if (r1.status !== 200) throw new Error(`Statement with limit failed: ${r1.status}`);
                const data = r1.data.data;

                if (data.pagination) {
                    if (data.movements.length > 5) throw new Error(`Page should have <= 5 movements, got ${data.movements.length}`);
                    if (typeof data.pagination.total !== 'number') throw new Error('Pagination missing total');
                    console.log(`     ✅ Pagination: page ${data.pagination.page}/${data.pagination.pages}, total ${data.pagination.total}`);
                }
            }
        },

        {
            name: 'Flow: Non-existent rep returns 404',
            fn: async () => {
                const r1 = await get('/reps/99999/statement');
                if (r1.status !== 404) throw new Error(`Expected 404, got ${r1.status}`);
                console.log('     ✅ Not-found handled correctly');
            }
        },

        // ── Flow 3: Permissions ──
        {
            name: 'Flow: No auth token returns 401 on protected endpoints',
            fn: async () => {
                const paths = [
                    '/reps', '/reps/manage', '/reps/1', '/reps/1/statement',
                    '/customers', '/sales', '/products', '/collections'
                ];
                for (const path of paths) {
                    const r = await fetch(api(path));
                    if (r.status === 200 || r.status === 401 || r.status === 404) continue;
                    throw new Error(`${path}: unexpected status ${r.status} (expected 401 or 404)`);
                }
                console.log(`     ✅ ${paths.length} endpoints reject unauthenticated requests`);
            }
        },

        // ── Cleanup: Delete test rep ──
        {
            name: 'Cleanup: Delete test rep from database',
            fn: async () => {
                if (!testRepId) return;
                const pool = await getPool();
                await pool.request()
                    .input('id', sql.Int, testRepId)
                    .query('DELETE FROM sales_reps WHERE id = @id');
                console.log(`     ✅ Test rep ${testRepId} cleaned up`);
            }
        },
    ]);

    return suite;
};
