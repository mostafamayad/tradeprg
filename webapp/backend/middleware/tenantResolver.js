const { getMasterPool, sql } = require('../database/master_db');
const { tenantStorage } = require('../database/mssql_db');
const jwt = require('jsonwebtoken');

async function tenantResolver(req, res, next) {
    try {
        let tenantDbName = 'TradePro';

        if (req.headers['x-tenant-id']) {
            tenantDbName = req.headers['x-tenant-id'];
        } else if (req.query.tenant) {
            tenantDbName = req.query.tenant;
        } else {
            // Check Authorization Bearer token for tenant_db
            const authHeader = req.headers.authorization;
            if (authHeader && authHeader.startsWith('Bearer ')) {
                try {
                    const token = authHeader.split(' ')[1];
                    const decoded = jwt.decode(token);
                    if (decoded && decoded.tenant_db) {
                        tenantDbName = decoded.tenant_db;
                    }
                } catch(e) {}
            }
            if (tenantDbName === 'TradePro') {
                const parts = (req.hostname || '').split('.');
                if (parts.length >= 3) { 
                    const sub = parts[0].toLowerCase();
                    if (sub !== 'www' && sub !== 'app') {
                        tenantDbName = sub;
                    }
                }
            }
        }

        if (tenantDbName === 'TradePro' || tenantDbName === 'localhost' || tenantDbName === '127') {
            req.tenant = { db_name: 'TradePro', company_name: 'الشركة الرئيسية', plan_name: 'pro', is_active: true };
            return tenantStorage.run({ db_name: 'TradePro' }, () => next());
        }

        const masterPool = await getMasterPool();
        const tenantRes = await masterPool.request()
            .input('dbName', sql.NVarChar, tenantDbName)
            .query('SELECT * FROM tenants WHERE db_name = @dbName');
            
        if (tenantRes.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'الشركة غير مسجلة في النظام' });
        }
        
        const tenant = tenantRes.recordset[0];
        if (!tenant.is_active) {
            return res.status(403).json({ success: false, message: 'تم إيقاف حساب الشركة. يرجى التواصل مع الإدارة.' });
        }
        
        if (tenant.expires_at && new Date(tenant.expires_at) < new Date()) {
            return res.status(403).json({ success: false, message: 'انتهى اشتراك الشركة. يرجى التجديد.' });
        }
        
        req.tenant = tenant;
        tenantStorage.run({ db_name: tenant.db_name }, () => next());
    } catch (err) {
        console.error('[TenantResolver] Error:', err);
        res.status(500).json({ success: false, message: 'خطأ في خادم النظام (Tenant Resolver): ' + err.message });
    }
}

module.exports = tenantResolver;
