const { getPool } = require('../database/mssql_db');

class ChartOfAccountsRepository {
    async getAll() {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT a.*, p.account_name as parent_name
            FROM chart_of_accounts a
            LEFT JOIN chart_of_accounts p ON a.parent_id = p.id
            ORDER BY a.account_code ASC
        `);
        return result.recordset;
    }

    buildTree(accounts) {
        const map = new Map();
        const roots = [];

        for (const acc of accounts) {
            map.set(acc.id, { ...acc, children: [] });
        }

        for (const node of map.values()) {
            const pid = node.parent_id != null ? String(node.parent_id) : null;
            if (pid && map.has(pid)) {
                map.get(pid).children.push(node);
            } else {
                roots.push(node);
            }
        }

        const sortStack = [...roots];
        while (sortStack.length > 0) {
            const current = sortStack.pop();
            if (current.children.length > 1) {
                current.children.sort((a, b) =>
                    a.account_code.localeCompare(b.account_code, 'ar', { numeric: true })
                );
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
