const { getMasterPool, sql } = require('../database/master_db');

async function tenantResolver(req, res, next) {
    try {
        let tenantDbName = 'TradePro';
        
        const parts = req.hostname.split('.');
        if (parts.length >= 3) { 
            const sub = parts[0].toLowerCase();
            if (sub !== 'www' && sub !== 'app') {
                tenantDbName = sub;
            }
        }
        
        if (req.headers['x-tenant-id']) {
            tenantDbName = req.headers['x-tenant-id'];
        }

        const masterPool = await getMasterPool();
        const tenantRes = await masterPool.request()
            .input('dbName', sql.NVarChar, tenantDbName)
            .query('SELECT * FROM tenants WHERE db_name = @dbName');
            
        if (tenantRes.recordset.length === 0) {
            if (tenantDbName === 'TradePro' || tenantDbName === 'localhost' || tenantDbName === '127') {
                req.tenant = { db_name: 'TradePro', plan_name: 'pro', is_active: true };
                return next();
            }
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
        next();
    } catch (err) {
        console.error('[TenantResolver] Error:', err);
        res.status(500).json({ success: false, message: 'خطأ في خادم النظام (Tenant Resolver): ' + err.message });
    }
}

module.exports = tenantResolver;
