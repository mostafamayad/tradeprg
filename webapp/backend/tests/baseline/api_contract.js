const Suite = require('../lib/runner');
const { login, headers, BASE_URL } = require('../lib/auth');

function api(path) { return `${BASE_URL}${path}`; }

async function get(path) {
    const r = await fetch(api(path), { headers: headers() });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = { success: false, raw: text.substring(0, 200) }; }
    return { status: r.status, data, text };
}

async function post(path, body) {
    const r = await fetch(api(path), { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    const data = await r.json();
    return { status: r.status, data };
}

async function put(path, body) {
    const r = await fetch(api(path), { method: 'PUT', headers: headers(), body: JSON.stringify(body) });
    const data = await r.json();
    return { status: r.status, data };
}

async function resolveFirstId(endpoint) {
    const r = await get(endpoint);
    if (r.data.success && Array.isArray(r.data.data) && r.data.data.length > 0) {
        return r.data.data[0].id;
    }
    return null;
}

module.exports = async function apiContractSuite() {
    await login();

    // Resolve valid IDs dynamically
    const firstCustomerId = await resolveFirstId('/customers');
    const firstSupplierId = await resolveFirstId('/suppliers');
    const firstProductId = await resolveFirstId('/products');
    const firstRepId = (await get('/reps/manage')).data.data?.[0]?.id || 1;
    const firstUserId = (await get('/users')).data.data?.[0]?.id || 1;
    const firstStoreId = (await get('/stores')).data.data?.[0]?.id || 1;

    console.log(`     IDs: rep=${firstRepId} customer=${firstCustomerId} supplier=${firstSupplierId} product=${firstProductId}`);

    const suite = new Suite('Layer 1 — API Contract');

    await suite.run([

        // ── Public ──
        { name: 'GET /api/company/info returns company info', fn: async () => {
            const r = await fetch(api('/company/info'));
            const d = await r.json();
            if (r.status !== 200 || d.success !== true) throw new Error(`Expected success, got ${r.status}`);
        }},

        // ── Auth ──
        { name: 'POST /auth/login valid → 200 + token', fn: async () => {
            const { status, data } = await post('/auth/login', { email: 'admin@3smcompany.com', password: 'admin123' });
            if (status !== 200) throw new Error(`Expected 200, got ${status}`);
            if (!data.token && !data.data?.token) throw new Error('No token');
        }},
        { name: 'POST /auth/login invalid → 401', fn: async () => {
            const { status, data } = await post('/auth/login', { email: 'x@y.com', password: 'wrong' });
            if (status !== 401 || data.success !== false) throw new Error('Expected 401 + success:false');
        }},

        // ── 401 Protection (all major endpoints) ──
        { name: 'Protected endpoints reject unauthenticated requests', fn: async () => {
            const routes = ['/reps', '/reps/manage', '/customers', '/products', '/stores', '/users', '/settings', '/logs', '/dashboard/stats', '/inventory/balances', '/accounting/accounts', '/collections', '/payments'];
            for (const route of routes) {
                const r = await fetch(api(route));
                if (r.status !== 401 && r.status !== 404) throw new Error(`${route}: expected 401/404, got ${r.status}`);
            }
        }},

        // ── Sales Reps (our code — full coverage) ──
        { name: 'GET /reps → active reps array', fn: async () => {
            const { status, data } = await get('/reps');
            if (status !== 200 || !data.success) throw new Error(`Expected 200, got ${status}`);
            if (!Array.isArray(data.data)) throw new Error('Expected array');
            for (const r of data.data) if (r.is_active !== 1) throw new Error('Only active reps allowed');
        }},
        { name: 'GET /reps/manage → all reps + optional pagination', fn: async () => {
            const { status, data } = await get('/reps/manage');
            if (status !== 200 || !data.success) throw new Error(`Expected 200, got ${status}`);
            if (!Array.isArray(data.data)) throw new Error('Expected array');
        }},
        { name: 'GET /reps/manage with filters → works', fn: async () => {
            const { status, data } = await get('/reps/manage?q=م&status=1&page=1&limit=10&sort=rep_name&order=ASC');
            if (status !== 200 || !data.success) throw new Error(`Expected 200, got ${status}`);
            if (data.pagination && data.pagination.limit > 200) throw new Error('Limit exceeded 200');
        }},
        { name: `GET /reps/${firstRepId} → single rep`, fn: async () => {
            const { status, data } = await get(`/reps/${firstRepId}`);
            if (status !== 200 || !data.success) throw new Error(`Expected 200, got ${status}`);
            if (!data.data.rep_name) throw new Error('Missing rep_name');
        }},
        { name: 'GET /reps/99999 → 404', fn: async () => {
            const { status, data } = await get('/reps/99999');
            if (status !== 404 || data.success !== false) throw new Error('Expected 404');
        }},
        { name: 'POST /reps → 201 + id + rep_code', fn: async () => {
            const { status, data } = await post('/reps', { rep_name: 'API Baseline Test', phone: '01111111111', region: 'اختبار' });
            if (status !== 201) throw new Error(`Expected 201, got ${status}`);
            if (!data.id || !data.rep_code) throw new Error('Missing id or rep_code');
            const pool = require('../../database/mssql_db'); const p = await pool.getPool();
            await p.request().input('id', (await pool.sql).Int, data.id).query('DELETE FROM sales_reps WHERE id = @id');
        }},
        { name: 'POST /reps without name → 400', fn: async () => {
            const { status, data } = await post('/reps', { phone: '01111111111' });
            if (status !== 400 || data.success !== false) throw new Error('Expected 400');
        }},
        { name: 'POST /reps duplicate code → 409', fn: async () => {
            const { status: s1, data: d1 } = await post('/reps', { rep_code: 'API-CONFLICT', rep_name: 'Conflict Test' });
            if (s1 !== 201) throw new Error('Setup failed');
            const { status, data } = await post('/reps', { rep_code: 'API-CONFLICT', rep_name: 'Conflict Test 2' });
            if (status !== 409 || data.success !== false) throw new Error('Expected 409');
            const pool = require('../../database/mssql_db'); const p = await pool.getPool();
            await p.request().input('id', (await pool.sql).Int, d1.id).query('DELETE FROM sales_reps WHERE id = @id');
        }},
        { name: `PUT /reps/${firstRepId} → updates rep`, fn: async () => {
            const r0 = await get(`/reps/${firstRepId}`);
            const code = r0.data.data.rep_code;
            const { status, data } = await put(`/reps/${firstRepId}`, { rep_code: code, rep_name: r0.data.data.rep_name, region: 'تحديث', target_amount: 50000, commission_rate: 5 });
            if (status !== 200 || !data.success) throw new Error(`Expected 200, got ${status}`);
        }},
        { name: `PUT /reps/${firstRepId}/toggle → changes status`, fn: async () => {
            const r0 = await get(`/reps/${firstRepId}`);
            const origStatus = r0.data.data.is_active;
            const { status, data } = await put(`/reps/${firstRepId}/toggle`, {});
            if (status !== 200 || !data.success) throw new Error(`Expected 200, got ${status}`);
            if (data.is_active === undefined) throw new Error('Missing is_active');
            // Toggle back
            await put(`/reps/${firstRepId}/toggle`, {});
        }},
        { name: `GET /reps/${firstRepId}/statement → full shape`, fn: async () => {
            const { status, data } = await get(`/reps/${firstRepId}/statement`);
            if (status !== 200 || !data.success) throw new Error(`Expected 200, got ${status}`);
            const s = data.data;
            if (!s.entity || !s.entity.id) throw new Error('Missing entity');
            if (!Array.isArray(s.movements)) throw new Error('Missing movements array');
            if (!s.summary || s.summary.totalSales === undefined) throw new Error('Missing summary');
            // Running balance continuity
            let bal = s.openingBalance || 0;
            for (const m of s.movements) {
                bal += (m.debit || 0) - (m.credit || 0);
                if (Math.abs(bal - m.balance) > 0.01) throw new Error(`Balance mismatch at ${m.doc_no}: ${bal} vs ${m.balance}`);
            }
        }},
        { name: `GET /reps/${firstRepId}/statement with filters → paginated`, fn: async () => {
            const { status, data } = await get(`/reps/${firstRepId}/statement?from=2026-01-01&to=2026-12-31&page=1&limit=50`);
            if (status !== 200 || !data.success) throw new Error('Failed');
            if (data.data.pagination && data.data.pagination.limit > 200) throw new Error('Limit not clamped');
        }},
        { name: `GET /reps/1/statement far-future → empty`, fn: async () => {
            const { status, data } = await get('/reps/1/statement?from=2099-01-01&to=2099-12-31');
            if (data.data.movements.length !== 0) throw new Error('Expected empty');
            if (data.data.summary.totalSales !== 0) throw new Error('Expected zero sales');
        }},

        // ── Other Modules (basic shape checks) ──
        ...(firstCustomerId ? [
            { name: `GET /customers/${firstCustomerId} → single customer`, fn: async () => {
                const { status, data } = await get(`/customers/${firstCustomerId}`);
                if (status !== 200 || !data.success) throw new Error(`Expected 200, got ${status}`);
            }},
            { name: `GET /customers/${firstCustomerId}/statement → statement shape`, fn: async () => {
                const { status, data } = await get(`/customers/${firstCustomerId}/statement`);
                if (status !== 200 || !data.success) throw new Error(`Expected 200, got ${status}`);
                if (!data.customer && !data.data?.customer) throw new Error('Missing customer info');
            }},
        ] : []),

        { name: 'GET /customers → array', fn: async () => {
            const { status, data } = await get('/customers');
            if (status !== 200 || !data.success) throw new Error(`Expected 200, got ${status}`);
            if (!Array.isArray(data.data)) throw new Error('Expected array');
        }},

        { name: 'GET /suppliers → array', fn: async () => {
            const { status, data } = await get('/suppliers');
            if (status !== 200 || !data.success) throw new Error(`Expected 200, got ${status}`);
            if (!Array.isArray(data.data)) throw new Error('Expected array');
        }},
        { name: 'GET /products → array', fn: async () => {
            const { status, data } = await get('/products');
            if (status !== 200 || !data.success) throw new Error(`Expected 200, got ${status}`);
            if (!Array.isArray(data.data)) throw new Error('Expected array');
        }},
        { name: 'GET /stores → array', fn: async () => {
            const { status, data } = await get('/stores');
            if (status !== 200 || !data.success) throw new Error(`Expected 200, got ${status}`);
            if (!Array.isArray(data.data)) throw new Error('Expected array');
        }},
        { name: 'GET /sales/invoices → array', fn: async () => {
            const { status, data } = await get('/sales/invoices');
            if (status !== 200) throw new Error(`Expected 200, got ${status}`);
            if (data.success !== true) throw new Error(`Unexpected: ${JSON.stringify(data).substring(0,100)}`);
        }},
        { name: 'GET /collections → array', fn: async () => {
            const { status, data } = await get('/collections');
            if (status !== 200 || !data.success) throw new Error(`Expected 200, got ${status}`);
        }},
        { name: 'GET /payments → array', fn: async () => {
            const { status, data } = await get('/payments');
            if (status !== 200 || !data.success) throw new Error(`Expected 200, got ${status}`);
        }},
        { name: 'GET /dashboard/stats → object', fn: async () => {
            const { status, data } = await get('/dashboard/stats');
            if (status !== 200 || !data.success) throw new Error(`Expected 200, got ${status}`);
        }},
        { name: 'GET /users → array', fn: async () => {
            const { status, data } = await get('/users');
            if (status !== 200 || !data.success) throw new Error(`Expected 200, got ${status}`);
            if (!Array.isArray(data.data)) throw new Error('Expected array');
        }},
        { name: 'GET /settings → object/array', fn: async () => {
            const { status, data } = await get('/settings');
            if (status !== 200 || !data.success) throw new Error(`Expected 200, got ${status}`);
        }},
        { name: 'GET /logs → array', fn: async () => {
            const { status, data } = await get('/logs');
            if (status !== 200 || !data.success) throw new Error(`Expected 200, got ${status}`);
            if (!Array.isArray(data.data)) throw new Error('Expected array');
        }},
        { name: 'GET /inventory/balances → array', fn: async () => {
            const { status, data } = await get('/inventory/balances');
            if (status !== 200) throw new Error(`Expected 200, got ${status}`);
        }},
        { name: 'GET /accounting/accounts → array', fn: async () => {
            const { status, data } = await get('/accounting/accounts');
            if (status !== 200 || !data.success) throw new Error(`Expected 200, got ${status}`);
            if (!Array.isArray(data.data)) throw new Error('Expected array');
        }},
        { name: 'GET /treasury/accounts → array', fn: async () => {
            const { status, data } = await get('/treasury/accounts');
            if (status !== 200) throw new Error(`Expected 200, got ${status}`);
            if (data.success !== true) throw new Error(`Expected success`);
        }},
        { name: 'GET /license/status → 200', fn: async () => {
            const { status } = await get('/license/status');
            if (status !== 200) throw new Error(`Expected 200, got ${status}`);
        }},
        { name: 'GET /reports/dashboard-cards → 200', fn: async () => {
            const { status, data } = await get('/reports/dashboard-cards');
            if (status !== 200) throw new Error(`Expected 200, got ${status}`);
        }},

        ...(firstSupplierId ? [
            { name: `GET /payments/supplier/${firstSupplierId}/statement → statement shape`, fn: async () => {
                const { status, data } = await get(`/payments/supplier/${firstSupplierId}/statement`);
                if (status !== 200 || !data.success) throw new Error(`Expected 200, got ${status}`);
            }},
        ] : []),

        ...(firstCustomerId ? [
            { name: `GET /collections/customer/${firstCustomerId}/statement → statement shape`, fn: async () => {
                const { status, data } = await get(`/collections/customer/${firstCustomerId}/statement`);
                if (status !== 200 || !data.success) throw new Error(`Expected 200, got ${status}`);
            }},
        ] : []),
    ]);

    return suite;
};
