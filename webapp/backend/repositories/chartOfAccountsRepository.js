const { getPool } = require('../database/mssql_db');

function cmpByCode(a, b) {
    return a.account_code.localeCompare(b.account_code, 'ar', { numeric: true });
}

class ChartOfAccountsRepository {
    async getAll() {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT a.*, p.account_name as parent_name
            FROM chart_of_accounts a
            LEFT JOIN chart_of_accounts p ON a.parent_id = p.id
            ORDER BY a.account_code ASC
        `);
        return result.recordset.map(row => ({
            ...row,
            id: Number(row.id),
            parent_id: row.parent_id == null ? null : Number(row.parent_id)
        }));
    }

    buildTree(accounts) {
        const map = new Map();
        const roots = [];

        for (const acc of accounts) {
            map.set(acc.id, { ...acc, children: [] });
        }

        for (const node of map.values()) {
            if (node.parent_id && map.has(node.parent_id)) {
                map.get(node.parent_id).children.push(node);
            } else {
                roots.push(node);
            }
        }

        roots.sort(cmpByCode);
        const sortStack = [...roots];
        while (sortStack.length > 0) {
            const current = sortStack.pop();
            if (current.children.length > 1) {
                current.children.sort(cmpByCode);
            }
            for (let i = current.children.length - 1; i >= 0; i--) {
                sortStack.push(current.children[i]);
            }
        }

        return roots;
    }

    async getTree() {
        const accounts = await this.getAll();
        return this.buildTree(accounts);
    }
}

module.exports = new ChartOfAccountsRepository();
