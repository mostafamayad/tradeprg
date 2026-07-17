const http = require('http');

function req(port, method, apiPath, headers, body) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: '127.0.0.1', port, path: apiPath, method, headers: { ...headers } };
    const r = http.request(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ raw: d, status: res.statusCode }); } });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

let passed = 0;
let failed = 0;

function resetCounters() { passed = 0; failed = 0; }

function getCounters() { return { passed, failed }; }

function test(name, fn) {
  process.stdout.write('  ' + name + '... ');
  return Promise.resolve().then(() => fn()).then(result => {
    if (result) { passed++; console.log('PASS'); }
    else { failed++; console.log('FAIL'); }
  }).catch(e => { failed++; console.log('FAIL (' + e.message + ')'); });
}

async function waitForServer(port, label, maxRetries) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await req(port, 'GET', '/api/info');
      console.log('  ' + label + ' ready on port ' + port);
      return true;
    } catch {
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw new Error(label + ' not ready after ' + maxRetries + ' retries');
}

module.exports = { req, test, waitForServer, resetCounters, getCounters };
