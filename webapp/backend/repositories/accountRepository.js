const { getPool, sql } = require('../database/mssql_db');

const VALID_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'];
const MAX_DEPTH = 5;

function cmpByCode(a, b) {
    return a.account_code.localeCompare(b.account_code, 'ar', { numeric: true });
}

class AccountRepository {
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

    async getById(id) {
        const pool = await getPool();
        const result = await pool.request()
            .input('id', sql.Int, id)
            .query(`
                SELECT a.*, p.account_name as parent_name
                FROM chart_of_accounts a
                LEFT JOIN chart_of_accounts p ON a.parent_id = p.id
                WHERE a.id = @id
            `);
        if (!result.recordset[0]) return null;
        const row = result.recordset[0];
        return { ...row, id: Number(row.id), parent_id: row.parent_id == null ? null : Number(row.parent_id) };
    }

    async exists(id) {
        const pool = await getPool();
        const result = await pool.request()
            .input('id', sql.Int, id)
            .query('SELECT 1 as found FROM chart_of_accounts WHERE id = @id');
        return result.recordset.length > 0;
    }

    async hasChildren(id) {
        const pool = await getPool();
        const result = await pool.request()
            .input('id', sql.Int, id)
            .query('SELECT 1 as found FROM chart_of_accounts WHERE parent_id = @id');
        return result.recordset.length > 0;
    }

    async accountCodeExists(code, excludeId = null) {
        const pool = await getPool();
        const request = pool.request().input('code', sql.NVarChar, code);
        let q = 'SELECT 1 as found FROM chart_of_accounts WHERE account_code = @code';
        if (excludeId) {
            request.input('excludeId', sql.Int, excludeId);
            q += ' AND id != @excludeId';
        }
        const result = await request.query(q);
        return result.recordset.length > 0;
    }

    async accountNameExistsUnderParent(name, parentId, excludeId = null) {
        const pool = await getPool();
        const request = pool.request()
            .input('name', sql.NVarChar, name)
            .input('parentId', sql.Int, parentId);
        let q = "SELECT 1 as found FROM chart_of_accounts WHERE account_name = @name AND parent_id = @parentId";
        if (excludeId) {
            request.input('excludeId', sql.Int, excludeId);
            q += ' AND id != @excludeId';
        }
        const result = await request.query(q);
        return result.recordset.length > 0;
    }

    async getDepth(accountId) {
        let depth = 0;
        let currentId = accountId;
        const visited = new Set();
        while (currentId) {
            if (visited.has(currentId)) return -1;
            visited.add(currentId);
            const acc = await this.getById(currentId);
            if (!acc || !acc.parent_id) break;
            currentId = acc.parent_id;
            depth++;
        }
        return depth;
    }

    async validateCreate(data) {
        const errors = [];

        if (!data.account_code || !data.account_code.trim()) {
            errors.push('account_code مطلوب');
        }
        if (!data.account_name || !data.account_name.trim()) {
            errors.push('account_name مطلوب');
        }
        if (!VALID_TYPES.includes(data.account_type)) {
            errors.push('account_type يجب أن يكون واحداً من: ' + VALID_TYPES.join(', '));
        }

        if (errors.length > 0) return errors;

        if (await this.accountCodeExists(data.account_code.trim())) {
            errors.push('account_code "' + data.account_code.trim() + '" موجود مسبقاً');
        }

        const parentId = data.parent_id ? Number(data.parent_id) : null;

        if (parentId) {
            if (!await this.exists(parentId)) {
                errors.push('الحساب الأب (id=' + parentId + ') غير موجود');
            } else {
                const parent = await this.getById(parentId);
                if (!parent.is_active) {
                    errors.push('الحساب الأب "' + parent.account_name + '" غير نشط');
                }
                if (parent.system_code) {
                    errors.push('لا يمكن إنشاء حساب تابع لحساب نظامي ("' + parent.account_name + '")');
                }
                const parentDepth = await this.getDepth(parentId);
                if (parentDepth >= MAX_DEPTH - 1) {
                    errors.push('تم تجاوز العمق الأقصى (' + MAX_DEPTH + ' مستويات)');
                }
                if (await this.accountNameExistsUnderParent(data.account_name.trim(), parentId)) {
                    errors.push('يوجد حساب بنفس الاسم "' + data.account_name.trim() + '" تحت نفس الأب');
                }
            }
        } else {
            if (await this.accountNameExistsUnderParent(data.account_name.trim(), null)) {
                errors.push('يوجد حساب بنفس الاسم "' + data.account_name.trim() + '" في الجذر');
            }
        }

        return errors;
    }

    async create(data) {
        const pool = await getPool();
        const parentId = data.parent_id ? Number(data.parent_id) : null;
        const result = await pool.request()
            .input('code', sql.NVarChar, data.account_code.trim())
            .input('name', sql.NVarChar, data.account_name.trim())
            .input('type', sql.NVarChar, data.account_type)
            .input('parentId', sql.Int, parentId)
            .query(`
                INSERT INTO chart_of_accounts (account_code, account_name, account_type, parent_id, is_active, current_balance)
                OUTPUT INSERTED.id
                VALUES (@code, @name, @type, @parentId, 1, 0)
            `);
        return Number(result.recordset[0].id);
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

module.exports = new AccountRepository();
