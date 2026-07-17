/**
 * Layer 4 — Performance Baseline
 *
 * For each major endpoint, captures:
 *   - Average Response Time (3 samples)
 *   - Max Response Time
 *   - Payload Size (bytes)
 *   - Row Count / Object Size
 *
 * After any refactor, re-run to detect performance regressions.
 */

const Suite = require('../lib/runner');
const { login, headers, BASE_URL } = require('../lib/auth');

function api(path) { return `${BASE_URL}${path}`; }

const ENDPOINTS = [
    { name: 'GET /reps', path: '/reps', samples: 3 },
    { name: 'GET /reps/manage', path: '/reps/manage', samples: 3 },
    { name: 'GET /reps/1', path: '/reps/1', samples: 3 },
    { name: 'GET /reps/1/statement', path: '/reps/1/statement', samples: 3 },
    { name: 'GET /reps/1/statement (with filter)', path: '/reps/1/statement?from=2026-01-01&to=2026-12-31', samples: 3 },
    { name: 'GET /customers', path: '/customers', samples: 3 },
    { name: 'GET /customers/1', path: '/customers/1', samples: 3 },
    { name: 'GET /customers/1/statement', path: '/customers/1/statement', samples: 3 },
    { name: 'GET /suppliers', path: '/suppliers', samples: 3 },
    { name: 'GET /products', path: '/products', samples: 3 },
    { name: 'GET /sales', path: '/sales', samples: 3 },
    { name: 'GET /collections', path: '/collections', samples: 3 },
    { name: 'GET /payments', path: '/payments', samples: 3 },
    { name: 'GET /dashboard/stats', path: '/dashboard/stats', samples: 3 },
    { name: 'GET /users', path: '/users', samples: 3 },
    { name: 'GET /settings', path: '/settings', samples: 3 },
    { name: 'GET /logs', path: '/logs', samples: 3 },
    { name: 'GET /inventory/balances', path: '/inventory/balances', samples: 3 },
    { name: 'GET /accounting/accounts', path: '/accounting/accounts', samples: 3 },
];

module.exports = async function performanceSuite() {
    await login();
    const suite = new Suite('Layer 4 — Performance Baseline');

    const results = [];

    await suite.run(
        ENDPOINTS.map(ep => ({
            name: `${ep.name} — avg response time`,
            fn: async () => {
                let totalTime = 0;
                let maxTime = 0;
                let payloadSize = 0;
                let rowCount = 0;

                for (let i = 0; i < ep.samples; i++) {
                    const start = Date.now();
                    const r = await fetch(api(ep.path), { headers: headers() });
                    const elapsed = Date.now() - start;
                    totalTime += elapsed;
                    if (elapsed > maxTime) maxTime = elapsed;

                    const text = await r.text();
                    payloadSize = text.length;

                    try {
                        const data = JSON.parse(text);
                        if (data.data && Array.isArray(data.data)) rowCount = data.data.length;
                    } catch (e) { /* ignore parse errors for non-JSON responses */ }
                }

                const avg = Math.round(totalTime / ep.samples);

                results.push({
                    endpoint: ep.path,
                    avgMs: avg,
                    maxMs: maxTime,
                    payloadBytes: payloadSize,
                    rowCount
                });

                console.log(`     avg=${avg}ms max=${maxTime}ms rows=${rowCount} size=${(payloadSize / 1024).toFixed(1)}KB`);
            }
        }))
    );

    // Save performance baseline
    const fs = require('fs');
    const path = require('path');
    const reportPath = path.resolve(__dirname, '../reports/performance-baseline.json');
    fs.writeFileSync(reportPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        endpoints: results
    }, null, 2));
    console.log(`📁  Performance baseline saved: ${reportPath}`);

    return suite;
};
