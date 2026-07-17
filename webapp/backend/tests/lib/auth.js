const BASE = 'http://localhost:3000/api';

let token = null;

async function login(force = false) {
    if (token && !force) return token;
    const r = await fetch(`${BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@3smcompany.com', password: 'admin123' })
    });
    const d = await r.json();
    if (!d.success) throw new Error('Login failed: ' + (d.message || 'unknown'));
    token = d.token || d.data?.token;
    return token;
}

function getToken() { return token; }

function headers(extras = {}) {
    return {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
        ...extras
    };
}

module.exports = { login, getToken, headers, BASE_URL: BASE };
