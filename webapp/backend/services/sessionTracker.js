const crypto = require('crypto');
const { getMasterPool, sql } = require('../database/master_db');
const { getTenantPool } = require('../database/mssql_db');

class SessionTracker {
    constructor() {
        this.sessions = new Map();       // key: `${tenantDb}:${userId}` => session object
        this.aliases = new Map();        // key: `${tenantDb}:${userId}` => { alias_name, notes }
        this.blockedUsers = new Set();   // set of `${tenantDb}:${userId}`
        this.revokedTokens = new Set();  // set of token hashes
        this.initialized = false;
    }

    async init() {
        if (this.initialized) return;
        try {
            await this.ensureSchema();
            await this.loadAliasesAndBlocks();
            this.initialized = true;
            console.log('[SessionTracker] Initialized with', this.aliases.size, 'aliases and', this.blockedUsers.size, 'blocked users.');
        } catch (err) {
            console.error('[SessionTracker] Init warning:', err.message);
        }
    }

    async ensureSchema() {
        try {
            const masterPool = await getMasterPool();
            await masterPool.request().query(`
                IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'user_aliases')
                BEGIN
                    CREATE TABLE user_aliases (
                        id INT IDENTITY(1,1) PRIMARY KEY,
                        tenant_db NVARCHAR(100) NOT NULL,
                        user_id INT NOT NULL,
                        username NVARCHAR(255),
                        full_name NVARCHAR(255),
                        alias_name NVARCHAR(255) NOT NULL,
                        notes NVARCHAR(500),
                        is_blocked BIT DEFAULT 0,
                        last_action NVARCHAR(255),
                        last_seen DATETIME DEFAULT GETDATE(),
                        created_at DATETIME DEFAULT GETDATE(),
                        updated_at DATETIME DEFAULT GETDATE(),
                        CONSTRAINT UQ_user_aliases_tenant_user UNIQUE (tenant_db, user_id)
                    );
                    CREATE INDEX IX_user_aliases_tenant ON user_aliases(tenant_db);
                END
            `);
        } catch (e) {
            console.error('[SessionTracker] Error ensuring schema in master DB:', e.message);
        }
    }

    async loadAliasesAndBlocks() {
        try {
            const masterPool = await getMasterPool();
            const res = await masterPool.request().query(`
                SELECT tenant_db, user_id, alias_name, notes, is_blocked 
                FROM user_aliases
            `);
            for (const row of res.recordset) {
                const key = `${row.tenant_db.toLowerCase()}:${row.user_id}`;
                this.aliases.set(key, {
                    alias_name: row.alias_name,
                    notes: row.notes || ''
                });
                if (row.is_blocked) {
                    this.blockedUsers.add(key);
                }
            }
        } catch (e) {
            console.error('[SessionTracker] Load aliases error:', e.message);
        }
    }

    hashToken(token) {
        if (!token) return '';
        return crypto.createHash('sha256').update(token).digest('hex').substring(0, 32);
    }

    parseUserAgent(ua = '') {
        let browser = 'المتصفح';
        let os = 'جهاز غير معروف';
        let device = 'كمبيوتر';

        if (ua.includes('Edg/')) browser = 'Edge';
        else if (ua.includes('Chrome/')) browser = 'Chrome';
        else if (ua.includes('Firefox/')) browser = 'Firefox';
        else if (ua.includes('Safari/') && !ua.includes('Chrome/')) browser = 'Safari';

        if (ua.includes('Windows')) os = 'Windows';
        else if (ua.includes('Mac OS')) os = 'macOS';
        else if (ua.includes('Android')) { os = 'Android'; device = 'هاتف'; }
        else if (ua.includes('iPhone') || ua.includes('iPad')) { os = 'iOS'; device = 'iPhone/iPad'; }
        else if (ua.includes('Linux')) os = 'Linux';

        if (ua.includes('Mobile') && device === 'كمبيوتر') device = 'هاتف';

        return { browser, os, device, raw: ua };
    }

    translateAction(method, path) {
        const p = (path || '').toLowerCase();
        const m = (method || 'GET').toUpperCase();

        if (p.includes('/auth/login')) return 'تسجيل الدخول إلى النظام';
        if (p.includes('/sales')) {
            if (m === 'POST' && p.includes('return')) return 'تسجيل مرتجع مبيعات';
            if (m === 'POST') return 'إصدار فاتورة مبيعات جديدة';
            if (m === 'PUT' || m === 'PATCH') return 'تعديل فاتورة مبيعات';
            if (m === 'DELETE') return 'حذف فاتورة مبيعات';
            return 'تصفح فواتير المبيعات';
        }
        if (p.includes('/purchases')) {
            if (m === 'POST') return 'تسجيل فاتورة مشتريات واردة';
            if (m === 'PUT') return 'تعديل فاتورة مشتريات';
            return 'تصفح فواتير المشتريات';
        }
        if (p.includes('/reports')) {
            if (p.includes('customer-statement')) return 'استعراض كشف حساب عميل';
            if (p.includes('supplier-statement')) return 'استعراض كشف حساب مورد';
            if (p.includes('profit')) return 'استعراض تقارير الأرباح والخسائر';
            if (p.includes('inventory') || p.includes('stock')) return 'استعراض تقرير جرد المخزون';
            return 'استعراض التقارير والتحليلات';
        }
        if (p.includes('/customers')) {
            if (m === 'POST') return 'إضافة عميل جديد';
            if (m === 'PUT') return 'تعديل بيانات عميل';
            return 'تصفح قائمة العملاء';
        }
        if (p.includes('/suppliers')) {
            if (m === 'POST') return 'إضافة مورد جديد';
            if (m === 'PUT') return 'تعديل بيانات مورد';
            return 'تصفح قائمة الموردين';
        }
        if (p.includes('/products')) {
            if (m === 'POST') return 'إضافة صنف جديد بالمخزن';
            if (m === 'PUT') return 'تعديل سعر / بيانات صنف';
            return 'استعراض دليل الأصناف والأسعار';
        }
        if (p.includes('/inventory') || p.includes('/stores')) {
            if (m === 'POST') return 'تسجيل إذن حركة مخزنية (صرف/إضافة)';
            return 'مراجعة أرصدة المخازن';
        }
        if (p.includes('/accounting')) {
            if (m === 'POST') return 'تسجيل قيد يومية محاسبي';
            return 'استعراض شجرة الحسابات والقيود';
        }
        if (p.includes('/collections') || p.includes('/ar/')) {
            if (m === 'POST') return 'تسجيل سند قبض / تحصيل نقدية';
            return 'مراجعة سندات القبض والشيكات';
        }
        if (p.includes('/payments') || p.includes('/ap/')) {
            if (m === 'POST') return 'تسجيل سند صرف نقدية لمورد';
            return 'مراجعة سندات الصرف';
        }
        if (p.includes('/treasury')) return 'متابعة حركة الخزينة والبنوك';
        if (p.includes('/dashboard')) return 'متابعة لوحة المؤشرات الرئيسية';
        if (p.includes('/users')) return 'إدارة المستخدمين والصلاحيات';
        if (p.includes('/settings')) return 'تعديل إعدادات النظام';

        return m === 'GET' ? 'تصفح النظام' : 'تحديث بيانات بالسيستم';
    }

    recordActivity(req, customAction = null) {
        if (!req.user) return;
        const tenantDb = (req.tenant?.db_name || req.user?.tenant_db || 'TradePro').toLowerCase();
        const userId = req.user.id;
        const key = `${tenantDb}:${userId}`;

        const authHeader = req.headers.authorization || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : '';
        const tokenHash = this.hashToken(token);

        const ip = req.ip || req.connection?.remoteAddress || req.headers['x-forwarded-for'] || '127.0.0.1';
        const ua = req.headers['user-agent'] || '';
        const deviceParsed = this.parseUserAgent(ua);
        const action = customAction || this.translateAction(req.method, req.path || req.originalUrl);

        const existingAlias = this.aliases.get(key);
        const aliasName = existingAlias ? existingAlias.alias_name : '';
        const aliasNotes = existingAlias ? existingAlias.notes : '';

        const now = new Date();

        const session = {
            key,
            tenant_db: req.tenant?.db_name || req.user?.tenant_db || 'TradePro',
            company_name: req.tenant?.company_name || 'الشركة الرئيسية',
            user_id: userId,
            username: req.user.username || req.user.email || 'مستخدم',
            full_name: req.user.full_name || req.user.name || req.user.username || 'مستخدم',
            role: req.user.role || 'user',
            alias_name: aliasName,
            alias_notes: aliasNotes,
            is_blocked: this.blockedUsers.has(key),
            last_action: action,
            last_path: req.originalUrl || req.path || '',
            method: req.method,
            ip_address: ip,
            browser: deviceParsed.browser,
            os: deviceParsed.os,
            device: deviceParsed.device,
            device_full: ua,
            token_hash: tokenHash,
            last_seen: now,
            first_seen: this.sessions.get(key)?.first_seen || now
        };

        this.sessions.set(key, session);

        // Async update in background for master DB if alias exists
        if (existingAlias) {
            this.updateAliasLastSeen(tenantDb, userId, action, now).catch(() => {});
        }
    }

    async updateAliasLastSeen(tenantDb, userId, lastAction, lastSeen) {
        try {
            const masterPool = await getMasterPool();
            await masterPool.request()
                .input('tenant', sql.NVarChar, tenantDb)
                .input('userId', sql.Int, userId)
                .input('action', sql.NVarChar, lastAction)
                .input('now', sql.DateTime, lastSeen)
                .query(`
                    UPDATE user_aliases 
                    SET last_action = @action, last_seen = @now, updated_at = @now 
                    WHERE LOWER(tenant_db) = LOWER(@tenant) AND user_id = @userId
                `);
        } catch (e) {}
    }

    isUserBlocked(tenantDb, userId, token = null) {
        const key = `${(tenantDb || 'tradepro').toLowerCase()}:${userId}`;
        if (this.blockedUsers.has(key)) return true;
        if (token) {
            const hash = this.hashToken(token);
            if (this.revokedTokens.has(hash)) return true;
        }
        return false;
    }

    getActiveSessions() {
        const now = Date.now();
        const list = [];

        for (const [key, s] of this.sessions.entries()) {
            const diffMs = now - new Date(s.last_seen).getTime();
            const diffMins = Math.floor(diffMs / 60000);
            const diffSecs = Math.floor(diffMs / 1000);

            let status = 'online';
            let statusText = 'متصل الآن 🟢';
            if (diffMins >= 15) {
                status = 'offline';
                statusText = 'غير متصل (منذ أكثر من ربع ساعة) ⚪';
            } else if (diffMins >= 3) {
                status = 'idle';
                statusText = `خامل منذ ${diffMins} دقيقة 🟡`;
            } else if (diffSecs < 60) {
                statusText = 'نشط الآن (منذ لحظات) 🟢';
            } else {
                statusText = `نشط منذ ${diffMins} دقيقة 🟢`;
            }

            // Sync latest alias
            const alias = this.aliases.get(key);
            s.alias_name = alias ? alias.alias_name : '';
            s.alias_notes = alias ? alias.notes : '';
            s.is_blocked = this.blockedUsers.has(key);
            s.status = status;
            s.status_text = statusText;
            s.seconds_ago = diffSecs;

            list.push(s);
        }

        // Sort: online first, then by last_seen desc
        return list.sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen));
    }

    async setAlias(tenantDb, userId, username, fullName, aliasName, notes = '') {
        const tDb = (tenantDb || 'tradepro').toLowerCase();
        const key = `${tDb}:${userId}`;

        this.aliases.set(key, { alias_name: aliasName.trim(), notes: (notes || '').trim() });

        // Update active session if present
        if (this.sessions.has(key)) {
            const s = this.sessions.get(key);
            s.alias_name = aliasName.trim();
            s.alias_notes = (notes || '').trim();
        }

        // Persist to master DB
        const masterPool = await getMasterPool();
        await masterPool.request()
            .input('tenant', sql.NVarChar, tDb)
            .input('userId', sql.Int, userId)
            .input('user', sql.NVarChar, username || null)
            .input('name', sql.NVarChar, fullName || null)
            .input('alias', sql.NVarChar, aliasName.trim())
            .input('notes', sql.NVarChar, (notes || '').trim())
            .query(`
                MERGE user_aliases AS target
                USING (SELECT @tenant AS tenant_db, @userId AS user_id) AS source
                ON (LOWER(target.tenant_db) = LOWER(source.tenant_db) AND target.user_id = source.user_id)
                WHEN MATCHED THEN
                    UPDATE SET alias_name = @alias, notes = @notes, username = COALESCE(@user, target.username), full_name = COALESCE(@name, target.full_name), updated_at = GETDATE()
                WHEN NOT MATCHED THEN
                    INSERT (tenant_db, user_id, username, full_name, alias_name, notes, updated_at)
                    VALUES (@tenant, @userId, @user, @name, @alias, @notes, GETDATE());
            `);

        return { success: true, key, alias_name: aliasName, notes };
    }

    kickSession(tenantDb, userId) {
        const tDb = (tenantDb || 'tradepro').toLowerCase();
        const key = `${tDb}:${userId}`;
        if (this.sessions.has(key)) {
            const s = this.sessions.get(key);
            if (s.token_hash) {
                this.revokedTokens.add(s.token_hash);
            }
            this.sessions.delete(key);
        }
        return { success: true, message: 'تم طرد الجلسة بنجاح' };
    }

    async blockUser(tenantDb, userId, block = true) {
        const tDb = (tenantDb || 'tradepro').toLowerCase();
        const key = `${tDb}:${userId}`;

        if (block) {
            this.blockedUsers.add(key);
            this.kickSession(tDb, userId);
        } else {
            this.blockedUsers.delete(key);
        }

        // 1. Update in master database
        try {
            const masterPool = await getMasterPool();
            await masterPool.request()
                .input('tenant', sql.NVarChar, tDb)
                .input('userId', sql.Int, userId)
                .input('blocked', sql.Bit, block ? 1 : 0)
                .query(`
                    UPDATE user_aliases 
                    SET is_blocked = @blocked, updated_at = GETDATE() 
                    WHERE LOWER(tenant_db) = LOWER(@tenant) AND user_id = @userId
                `);
        } catch (e) {
            console.error('[SessionTracker] Error updating block in master DB:', e.message);
        }

        // 2. Also update `is_active` directly in the tenant database
        try {
            const tenantPool = await getTenantPool(tenantDb);
            await tenantPool.request()
                .input('userId', sql.Int, userId)
                .input('active', sql.Int, block ? 0 : 1)
                .query('UPDATE users SET is_active = @active WHERE id = @userId');
        } catch (e) {
            console.error('[SessionTracker] Error updating tenant users table:', e.message);
        }

        return { 
            success: true, 
            message: block ? 'تم حظر المستخدم ومنعه من الدخول تماماً' : 'تم فك الحظر عن المستخدم وتنشيط حسابه' 
        };
    }
}

const tracker = new SessionTracker();
// Initialize on module load
tracker.init().catch(e => console.error('[SessionTracker] Failed to init:', e));

module.exports = tracker;