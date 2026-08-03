const { getPool, sql } = require('../database/mssql_db');

const SCOPE_TYPES = ['company', 'branch', 'store', 'sales_rep', 'department'];

function scopeMiddleware(req, res, next) {
    if (req.user && req.user.is_super_admin) return next();
    req.scope = { type: 'company', values: [] };
    return next();
}

async function resolveUserScope(userId) {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('user_id', sql.Int, userId)
            .query('SELECT scope_type, scope_value FROM user_data_scopes WHERE user_id = @user_id');
        const scopes = result.recordset;
        if (scopes.length === 0) return { type: 'company', values: ['*'] };

        const grouped = {};
        for (const s of scopes) {
            if (!grouped[s.scope_type]) grouped[s.scope_type] = [];
            grouped[s.scope_type].push(s.scope_value);
        }

        const types = Object.keys(grouped);
        return {
            type: types.length === 1 ? types[0] : 'mixed',
            values: grouped,
            isScoped: true
        };
    } catch (e) {
        console.error('[Scope] Error resolving scope:', e.message);
        return { type: 'company', values: ['*'] };
    }
}

function applyScopeFilter(type, alias, scope) {
    if (!scope || !scope.isScoped) return '';
    if (scope.type === 'company' && scope.values['*']) return '';

    const values = scope.values[type] || scope.values['*'] || [];
    if (values.length === 0) return ' AND 1=0 ';
    if (values.includes('*')) return '';

    const escaped = values.map(v => `'${v.replace(/'/g, "''")}'`).join(',');
    return ` AND ${alias} IN (${escaped}) `;
}

module.exports = { scopeMiddleware, resolveUserScope, applyScopeFilter, SCOPE_TYPES };
