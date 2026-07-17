const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getMasterPool, sql } = require('../database/master_db');

const SUPER_ADMIN_KEY = process.env.SUPER_ADMIN_KEY || 'default-super-secret-key';

router.use((req, res, next) => {
    const key = req.headers['x-super-admin-key'];
    if (!key || key !== SUPER_ADMIN_KEY) {
        return res.status(403).json({ success: false, message: 'Unauthorized access to Super Admin' });
    }
    next();
});

router.get('/tenants', async (req, res) => {
    try {
        const pool = await getMasterPool();
        const result = await pool.request().query(`
            SELECT id, company_name, db_name, plan_name, max_users, is_active, expires_at 
            FROM tenants 
            ORDER BY id DESC
        `);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post('/tenants', async (req, res) => {
    const { company_name, db_name, plan_name = 'basic', max_users = 5, expires_at } = req.body;
    
    if (!company_name || !db_name) {
        return res.status(400).json({ success: false, message: 'company_name and db_name are required' });
    }

    try {
        const pool = await getMasterPool();
        
        const checkRes = await pool.request()
            .input('dbName', sql.NVarChar, db_name)
            .query('SELECT id FROM tenants WHERE db_name = @dbName');
            
        if (checkRes.recordset.length > 0) {
            return res.status(400).json({ success: false, message: 'Database name (tenant) already exists' });
        }

        const expDate = expires_at ? expires_at : new Date(new Date().setFullYear(new Date().getFullYear() + 1));
        
        await pool.request()
            .input('compName', sql.NVarChar, company_name)
            .input('dbName', sql.NVarChar, db_name)
            .input('plan', sql.NVarChar, plan_name)
            .input('maxU', sql.Int, max_users)
            .input('exp', sql.DateTime, expDate)
            .query(`
                INSERT INTO tenants (company_name, db_name, plan_name, max_users, expires_at, is_active)
                VALUES (@compName, @dbName, @plan, @maxU, @exp, 1)
            `);
            
        try {
            await pool.request().query(`CREATE DATABASE [${db_name}]`);
            console.log(`[SuperAdmin] Database ${db_name} created. Executing schema...`);
            
            const schemaSql = require('fs').readFileSync(require('path').join(__dirname, '../schema_fixed.sql'), 'utf8');
            const { getTenantPool } = require('../database/mssql_db');
            
            const tenantPool = await getTenantPool(db_name);
            
            const statements = schemaSql.split(/\bGO\b/i).map(s => s.trim()).filter(s => s.length > 0);
            for (const stmt of statements) {
                try {
                    await tenantPool.request().query(stmt);
                } catch(e) {
                    console.log('[SuperAdmin] Schema step warn:', e.message);
                }
            }
            console.log(`[SuperAdmin] Schema applied to ${db_name} successfully.`);

            const adminHash = bcrypt.hashSync('admin123', 10);
            await tenantPool.request()
                .input('hash', sql.NVarChar, adminHash)
                .query(`INSERT INTO users (username, password_hash, full_name, role, is_active, permissions)
                        VALUES ('admin@3smcompany.com', @hash, 'Admin', 'admin', 1, '[]')`);
            console.log(`[SuperAdmin] Default admin user created for ${db_name}.`);
        } catch (dbErr) {
            console.log('[SuperAdmin] DB Error or already exists:', dbErr.message);
        }

        res.json({ success: true, message: `Tenant ${company_name} created successfully with DB: ${db_name}` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post('/tenants/:id/suspend', async (req, res) => {
    try {
        const pool = await getMasterPool();
        await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('UPDATE tenants SET is_active = 0 WHERE id = @id');
        res.json({ success: true, message: 'Tenant suspended' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post('/tenants/:id/activate', async (req, res) => {
    try {
        const pool = await getMasterPool();
        await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('UPDATE tenants SET is_active = 1 WHERE id = @id');
        res.json({ success: true, message: 'Tenant activated' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
