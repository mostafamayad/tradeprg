// ============================================================
// TradePro ERP - Main Server Entry Point
// Node.js + Express + SQL Server
// Run: node server.js
// ============================================================

require('dotenv').config();

if (!process.env.JWT_SECRET) {
    console.error('\x1b[31m%s\x1b[0m', 'FATAL ERROR: JWT_SECRET is not defined in environment variables.');
    process.exit(1);
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const { syncTime } = require('./utils/time');

const app = express();
// Trust proxy for correct IP detection behind reverse proxies (IIS, Nginx, etc.)
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

process.on('unhandledRejection', (reason, promise) => {
    console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
    console.error('🚨 Uncaught Exception:', err?.message || err);
});

// ─── License Manager (non-blocking initialization) ────────────
const LicenseManager = require('./services/license/licenseManager');
const licenseManager = new LicenseManager({ buildProfile: process.env.BUILD_PROFILE });
licenseManager.initialize().catch(() => {});
app.licenseManager = licenseManager;
// License state accessible via app.licenseManager.getLicenseState()

// License audit events → audit_log table (non-blocking, DB-optional)
licenseManager.onEvent(async (entry) => {
    try {
        const { getPool, sql } = require('./database/mssql_db');
        const pool = await getPool();
        const data = entry.data || {};
        await pool.request()
            .input('user_id', sql.Int, 0)
            .input('user_name', sql.NVarChar(255), 'System')
            .input('role', sql.NVarChar(50), 'system')
            .input('module', sql.NVarChar(100), 'license')
            .input('operation', sql.NVarChar(50), entry.event)
            .input('ref_no', sql.NVarChar(255), '')
            .input('affected_record', sql.NVarChar(sql.MAX), JSON.stringify(data).substring(0, 2000))
            .input('old_values', sql.NVarChar(sql.MAX), null)
            .input('new_values', sql.NVarChar(sql.MAX), null)
            .input('ip_address', sql.NVarChar(50), '')
            .input('device', sql.NVarChar(500), '')
            .input('status', sql.NVarChar(20), 'SUCCESS')
            .input('reason', sql.NVarChar(sql.MAX), '')
            .input('created_at', sql.DateTime, new Date(entry.timestamp))
            .query(`
                IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[audit_log]') AND type in (N'U'))
                BEGIN
                    CREATE TABLE [dbo].[audit_log](
                        [id] [int] IDENTITY(1,1) NOT NULL PRIMARY KEY,
                        [user_id] [int] NULL,
                        [user_name] [nvarchar](255) NULL,
                        [role] [nvarchar](50) NULL,
                        [module] [nvarchar](100) NULL,
                        [operation] [nvarchar](50) NULL,
                        [ref_no] [nvarchar](255) NULL,
                        [affected_record] [nvarchar](max) NULL,
                        [old_values] [nvarchar](max) NULL,
                        [new_values] [nvarchar](max) NULL,
                        [ip_address] [nvarchar](50) NULL,
                        [device] [nvarchar](500) NULL,
                        [status] [nvarchar](20) NULL DEFAULT ('SUCCESS'),
                        [reason] [nvarchar](max) NULL,
                        [created_at] [datetime] NULL DEFAULT (getdate())
                    )
                END
                INSERT INTO audit_log (user_id, user_name, role, module, operation, ref_no, affected_record, old_values, new_values, ip_address, device, status, reason, created_at)
                VALUES (@user_id, @user_name, @role, @module, @operation, @ref_no, @affected_record, @old_values, @new_values, @ip_address, @device, @status, @reason, @created_at)
            `);
    } catch (e) {
        // Silent - license system never depends on DB
    }
});

// ─── Middleware ───────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false })); // Allow serving frontend
app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        // Or if origin is localhost/LAN IP
        if (!origin || origin.includes('localhost') || origin.match(/^http:\/\/(192\.168|10\.|172\.(1[6-9]|2[0-9]|3[0-1]))\./)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Health Check (public, no auth) ─────────────────────────
const { getHealth } = require('./database/mssql_db');
app.get('/health', (req, res) => { res.json(getHealth()); });

// ─── Serve Static Frontend ───────────────────────────────────
app.use(express.static(path.join(__dirname, '../frontend')));

// ─── Rate Limiting ────────────────────────────────────────────
const rateLimit = require('express-rate-limit');

// Login endpoint: 5 failed attempts/minute/IP (successful logins don't count)
const loginLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: { success: false, message: 'Too many requests', retryAfter: 60 },
    standardHeaders: false,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    handler: (req, res, next, opts) => {
        const retryAfter = Math.ceil(opts.windowMs / 1000);
        res.set('Retry-After', String(retryAfter));
        res.status(429).json({ success: false, message: 'Too many requests', retryAfter });
    }
});

// General API: 300 requests/minute/IP (applied to all /api routes)
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    message: { success: false, message: 'Too many requests', retryAfter: 60 },
    standardHeaders: false,
    legacyHeaders: false,
    handler: (req, res, next, opts) => {
        const retryAfter = Math.ceil(opts.windowMs / 1000);
        res.set('Retry-After', String(retryAfter));
        res.status(429).json({ success: false, message: 'Too many requests', retryAfter });
    }
});

// Apply login limiter before general API limiter (more specific takes precedence)
app.use('/api/auth/login', loginLimiter);
app.use('/api', apiLimiter);

// ─── API Routes ──────────────────────────────────────────────
const authenticate = require('./middleware/auth');
const autoLogger = require('./middleware/autoLogger');
const checkPermission = require('./middleware/permissions');
const licenseEnforcer = require('./middleware/licenseEnforcer');

// Public routes (no auth required)
app.use('/api/time', require('./routes/time'));
app.use('/api/auth', require('./routes/auth'));

// Public company info for login page (no auth needed)
app.get('/api/company/info', async (req, res) => {
    try {
        const pool = await require('./database/mssql_db').getPool();
        const result = await pool.request().query("SELECT * FROM settings WHERE [key] LIKE 'company_%'");
        const data = {};
        result.recordset.forEach(s => data[s.key.replace('company_', '')] = s.value);
        res.json({ success: true, data });
    } catch (e) {
        res.json({ success: true, data: { name: 'ERP System', logo: '' } });
    }
});

app.use('/api/license', require('./routes/license'));

app.use('/api', authenticate); // Protect all API routes
app.use('/api', autoLogger); // Automatically log all modifications
app.use('/api', licenseEnforcer); // License state enforcement (after auth)

function applyPermissions(moduleName) {
    return (req, res, next) => {
        let action = 'view';
        if (req.method === 'POST') action = 'create';
        if (req.method === 'PUT' || req.method === 'PATCH') action = 'update';
        if (req.method === 'DELETE') action = 'delete';
        return checkPermission(`${moduleName}.${action}`)(req, res, next);
    };
}

app.use('/api/customers',   applyPermissions('customers'),   require('./routes/customers'));
app.use('/api/suppliers',   applyPermissions('suppliers'),   require('./routes/suppliers'));
app.use('/api/products',    applyPermissions('products'),    require('./routes/products'));
app.use('/api/stores',      applyPermissions('stores'),      require('./routes/stores'));
app.use('/api/sales',       applyPermissions('sales'),       require('./routes/sales'));
app.use('/api/purchases',   applyPermissions('purchases'),   require('./routes/purchases'));
app.use('/api/collections', applyPermissions('collections'), require('./routes/collections'));
app.use('/api/payments',    applyPermissions('payments'),    require('./routes/payments'));
app.use('/api/treasury',    applyPermissions('treasury'),    require('./routes/treasury'));
app.use('/api/accounting',  applyPermissions('accounting'),  require('./routes/accounting'));
app.use('/api/inventory',   applyPermissions('inventory'),   require('./routes/inventory'));
app.use('/api/reports',     applyPermissions('reports'),     require('./routes/reports'));
app.use('/api/reps',        applyPermissions('reps'),        require('./routes/reps'));
app.use('/api/dashboard',   applyPermissions('dashboard'),   require('./routes/dashboard'));
app.use('/api/users',       applyPermissions('users'),       require('./routes/users'));
app.use('/api/settings',    applyPermissions('settings'),    require('./routes/settings'));
app.use('/api/logs',        applyPermissions('logs'),        require('./routes/logs'));

// ─── SPA Fallback (for direct URL access) ────────────────────
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ─── Global Error Handler ─────────────────────────────────────
app.use((err, req, res, next) => {
    console.error('[ERROR]', err.message);
    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'حدث خطأ في الخادم'
    });
});

// ─── Start Server ─────────────────────────────────────────────
const os = require('os');
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal && !name.includes('VMware') && !name.includes('Hamachi') && !name.includes('ZeroTier') && !name.includes('Tailscale')) {
                return iface.address;
            }
        }
    }
    return '0.0.0.0';
}

app.listen(PORT, '0.0.0.0', async () => {
    await syncTime(true);
    setInterval(() => syncTime(true), 30 * 60 * 1000);

    // Auto-run critical migrations on startup
    try {
        const { getPool } = require('./database/mssql_db');
        const pool = await getPool();

        // ── Versioned Migration Runner (Phase 7.4) ──
        const dbModule = require('./database/mssql_db');
        const MigrationRunner = require('./services/migrationRunner');
        const mr = new MigrationRunner(pool, dbModule.sql);
        await mr.run();

        // ── Column migrations (idempotent, legacy — runs alongside versioned system) ──
        // journal_entries: source tracking
        await pool.request().query(`
            IF COL_LENGTH('journal_entries', 'source_module') IS NULL
            BEGIN
                ALTER TABLE journal_entries ADD source_module NVARCHAR(50) NULL;
                ALTER TABLE journal_entries ADD source_action NVARCHAR(50) NULL;
                ALTER TABLE journal_entries ADD source_document NVARCHAR(50) NULL;
                ALTER TABLE journal_entries ADD is_system_generated INT DEFAULT 0;
            END
        `);
        // chart_of_accounts: system_code
        await pool.request().query(`
            IF COL_LENGTH('chart_of_accounts', 'system_code') IS NULL
            BEGIN
                ALTER TABLE chart_of_accounts ADD system_code NVARCHAR(50) NULL;
            END
        `);
        // journal_entries: reversal tracking
        await pool.request().query(`
            IF COL_LENGTH('journal_entries', 'is_reversed') IS NULL
            BEGIN
                ALTER TABLE journal_entries ADD is_reversed INT DEFAULT 0;
                ALTER TABLE journal_entries ADD reversed_by INT NULL;
            END
        `);
        // journal_entries: reversal_of_id for audit chain
        await pool.request().query(`
            IF COL_LENGTH('journal_entries', 'reversal_of_id') IS NULL
            BEGIN
                ALTER TABLE journal_entries ADD reversal_of_id INT NULL;
            END
        `);
        // sales_returns: ERP workflow columns
        await pool.request().query(`
            IF COL_LENGTH('sales_returns', 'workflow_status') IS NULL
            BEGIN
                ALTER TABLE sales_returns ADD workflow_status NVARCHAR(50) DEFAULT 'approved';
                ALTER TABLE sales_returns ADD created_by INT NULL;
                ALTER TABLE sales_returns ADD approved_by INT NULL;
                ALTER TABLE sales_returns ADD approved_at NVARCHAR(50) NULL;
                ALTER TABLE sales_returns ADD reversed_by INT NULL;
                ALTER TABLE sales_returns ADD reversed_at NVARCHAR(50) NULL;
                ALTER TABLE sales_returns ADD reason_code NVARCHAR(50) NULL;
                ALTER TABLE sales_returns ADD client_ip NVARCHAR(100) NULL;
                ALTER TABLE sales_returns ADD device_info NVARCHAR(255) NULL;
                ALTER TABLE sales_returns ADD is_free_return BIT DEFAULT 0;
                ALTER TABLE sales_returns ADD tax_amount DECIMAL(18,4) DEFAULT 0;
                ALTER TABLE sales_returns ADD discount_amount DECIMAL(18,4) DEFAULT 0;
                ALTER TABLE sales_returns ADD subtotal DECIMAL(18,4) DEFAULT 0;
            END
        `);
        // sales_return_items: ERP columns
        await pool.request().query(`
            IF COL_LENGTH('sales_return_items', 'original_invoice_item_id') IS NULL
            BEGIN
                ALTER TABLE sales_return_items ADD original_invoice_item_id INT NULL;
                ALTER TABLE sales_return_items ADD cost_price_snapshot DECIMAL(18,4) DEFAULT 0;
                ALTER TABLE sales_return_items ADD discount_pct_snapshot DECIMAL(18,4) DEFAULT 0;
                ALTER TABLE sales_return_items ADD discount_amount_snapshot DECIMAL(18,4) DEFAULT 0;
                ALTER TABLE sales_return_items ADD tax_pct_snapshot DECIMAL(18,4) DEFAULT 0;
                ALTER TABLE sales_return_items ADD tax_amount_snapshot DECIMAL(18,4) DEFAULT 0;
                ALTER TABLE sales_return_items ADD product_condition NVARCHAR(50) DEFAULT 'saleable';
                ALTER TABLE sales_return_items ADD destination_store_id INT NULL;
                ALTER TABLE sales_return_items ADD reason_code NVARCHAR(50) NULL;
                ALTER TABLE sales_return_items ADD reason_notes NVARCHAR(500) NULL;
            END
        `);
        // ── Batch/Serial/Expiry tracking on return items ──
        await pool.request().query(`
            IF COL_LENGTH('sales_return_items', 'batch_no') IS NULL
                ALTER TABLE sales_return_items ADD batch_no NVARCHAR(100) NULL;
            IF COL_LENGTH('sales_return_items', 'expiry_date') IS NULL
                ALTER TABLE sales_return_items ADD expiry_date DATE NULL;
            IF COL_LENGTH('sales_return_items', 'serial_no') IS NULL
                ALTER TABLE sales_return_items ADD serial_no NVARCHAR(100) NULL;
        `);
        // sales_return_audit: index on return_id
        await pool.request().query(`
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sales_return_audit_return_id')
            BEGIN
                CREATE INDEX IX_sales_return_audit_return_id ON sales_return_audit(return_id);
            END
        `);
        // ── CRITICAL: Performance indexes on sales_returns ──
        await pool.request().query(`
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sales_returns_invoice_id')
                CREATE INDEX IX_sales_returns_invoice_id ON sales_returns(invoice_id);
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sales_returns_workflow_status')
                CREATE INDEX IX_sales_returns_workflow_status ON sales_returns(workflow_status);
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sales_returns_customer_id')
                CREATE INDEX IX_sales_returns_customer_id ON sales_returns(customer_id);
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sales_returns_return_date')
                CREATE INDEX IX_sales_returns_return_date ON sales_returns(return_date);
        `);
        await pool.request().query(`
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sales_return_items_return_id')
                CREATE INDEX IX_sales_return_items_return_id ON sales_return_items(return_id);
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sales_return_items_product_id')
                CREATE INDEX IX_sales_return_items_product_id ON sales_return_items(product_id);
            IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sales_return_items_condition')
                CREATE INDEX IX_sales_return_items_condition ON sales_return_items(product_condition);
        `);
        // ── CRITICAL: Remove ON DELETE CASCADE on sales_return_items FK ──
        await pool.request().query(`
            IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_sales_return_items_sales_returns_return_id')
            BEGIN
                DECLARE @fkDynSql NVARCHAR(MAX);
                SELECT @fkDynSql = 'ALTER TABLE sales_return_items DROP CONSTRAINT ' + name FROM sys.foreign_keys WHERE name = 'FK_sales_return_items_sales_returns_return_id';
                EXEC sp_executesql @fkDynSql;
                ALTER TABLE sales_return_items ADD CONSTRAINT FK_sales_return_items_sales_returns_return_id
                    FOREIGN KEY (return_id) REFERENCES sales_returns(id);
            END
        `);
        // ── CRITICAL: Add store_id FK on sales_returns ──
        await pool.request().query(`
            IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_sales_returns_stores_store_id')
            BEGIN
                ALTER TABLE sales_returns ADD CONSTRAINT FK_sales_returns_stores_store_id
                    FOREIGN KEY (store_id) REFERENCES stores(id);
            END
        `);
        // Special stores (damaged, inspection, main)
        await pool.request().query(`
            IF NOT EXISTS (SELECT 1 FROM stores WHERE store_type = 'damaged')
                INSERT INTO stores (store_code, store_name, store_type, notes) VALUES ('ST-DAMAGED', 'مخزن التوالف', 'damaged', 'مخزن البضاعة التالفة');
            IF NOT EXISTS (SELECT 1 FROM stores WHERE store_type = 'inspection')
                INSERT INTO stores (store_code, store_name, store_type, notes) VALUES ('ST-INSP', 'مخزن الفحص', 'inspection', 'مخزن البضاعة بانتظار الفحص');
            IF NOT EXISTS (SELECT 1 FROM stores WHERE store_type = 'main')
                INSERT INTO stores (store_code, store_name, store_type, notes) VALUES ('ST-MAIN', 'المخزن الرئيسي', 'main', 'المخزن الرئيسي');
        `);
        // sales_return_audit table
        await pool.request().query(`
            IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name='sales_return_audit' AND xtype='U')
            BEGIN
                CREATE TABLE sales_return_audit (
                    id INT IDENTITY(1,1) PRIMARY KEY,
                    return_id INT NOT NULL,
                    action NVARCHAR(50) NOT NULL,
                    actor_user_id INT NULL,
                    actor_username NVARCHAR(100) NULL,
                    action_at NVARCHAR(50) NOT NULL,
                    reason NVARCHAR(500) NULL,
                    from_status NVARCHAR(50) NULL,
                    to_status NVARCHAR(50) NULL,
                    metadata NVARCHAR(MAX) NULL,
                    client_ip NVARCHAR(100) NULL,
                    device_info NVARCHAR(255) NULL
                );
            END
        `);
        // return_reasons table
        await pool.request().query(`
            IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name='return_reasons' AND xtype='U')
            BEGIN
                CREATE TABLE return_reasons (
                    code NVARCHAR(50) PRIMARY KEY,
                    label_ar NVARCHAR(255) NOT NULL,
                    is_active BIT DEFAULT 1
                );
                INSERT INTO return_reasons (code, label_ar) VALUES
                    ('DAMAGED','المنتج تالف'),('WRONG_ITEM','خطأ في الشحن'),('CUSTOMER_REFUSED','العميل رفض المنتج'),
                    ('EXPIRED','انتهاء صلاحية'),('INVOICE_ERR','خطأ في الفاتورة'),('OTHER','أخرى');
            END
        `);
        // sales_invoices: ERP return tracking
        await pool.request().query(`
            IF COL_LENGTH('sales_invoices', 'return_status') IS NULL
            BEGIN
                ALTER TABLE sales_invoices ADD return_status NVARCHAR(50) DEFAULT 'Normal';
            END
        `);
        // sales_invoice_items: returned quantity tracking (idempotent update)
        await pool.request().query(`
            IF COL_LENGTH('sales_invoice_items', 'returned_qty') IS NULL
            BEGIN
                ALTER TABLE sales_invoice_items ADD returned_qty DECIMAL(18,4) DEFAULT 0;
            END
        `);
        // Fix null return_status on old invoices (set to Normal)
        await pool.request().query(`
            UPDATE sales_invoices SET return_status = 'Normal' WHERE return_status IS NULL OR return_status = 'null'
        `);
        // Recalculate return_status for invoices with active returns
        await pool.request().query(`
            UPDATE si SET si.return_status =
                CASE WHEN (
                    SELECT COUNT(*) FROM sales_invoice_items ii
                    WHERE ii.invoice_id = si.id AND COALESCE(ii.returned_qty, 0) > 0
                ) > 0 THEN
                    CASE WHEN (
                        SELECT COUNT(*) FROM sales_invoice_items ii
                        WHERE ii.invoice_id = si.id AND COALESCE(ii.returned_qty, 0) >= ii.quantity
                    ) = (
                        SELECT COUNT(*) FROM sales_invoice_items ii WHERE ii.invoice_id = si.id
                    ) THEN 'Fully Returned' ELSE 'Partially Returned' END
                ELSE 'Normal' END
            FROM sales_invoices si
            WHERE si.id IN (SELECT DISTINCT invoice_id FROM sales_returns WHERE status != 'cancelled')
        `);
        // ── Enterprise Customer Management columns ──
        const custCols = [
            ['customer_name_en', 'NVARCHAR(255)'],
            ['email', 'NVARCHAR(255)'],
            ['mobile', 'NVARCHAR(50)'],
            ['whatsapp', 'NVARCHAR(50)'],
            ['website', 'NVARCHAR(255)'],
            ['fax', 'NVARCHAR(50)'],
            ['tax_id', 'NVARCHAR(255)'],
            ['commercial_register', 'NVARCHAR(255)'],
            ['primary_contact', 'NVARCHAR(255)'],
            ['job_title', 'NVARCHAR(255)'],
            ['secondary_contact', 'NVARCHAR(255)'],
            ['emergency_contact', 'NVARCHAR(255)'],
            ['country', 'NVARCHAR(100)'],
            ['governorate', 'NVARCHAR(100)'],
            ['city', 'NVARCHAR(100)'],
            ['district', 'NVARCHAR(100)'],
            ['street', 'NVARCHAR(255)'],
            ['building_no', 'NVARCHAR(50)'],
            ['floor_no', 'NVARCHAR(50)'],
            ['apartment_no', 'NVARCHAR(50)'],
            ['postal_code', 'NVARCHAR(50)'],
            ['landmark', 'NVARCHAR(255)'],
            ['gps_latitude', 'DECIMAL(10,7)'],
            ['gps_longitude', 'DECIMAL(10,7)'],
            ['google_maps_link', 'NVARCHAR(500)'],
            ['billing_address', 'NVARCHAR(MAX)'],
            ['shipping_address', 'NVARCHAR(MAX)'],
            ['default_warehouse_id', 'INT'],
            ['price_list_id', 'INT'],
            ['language', "NVARCHAR(10) DEFAULT 'ar'"],
            ['currency', "NVARCHAR(10) DEFAULT 'EGP'"],
            ['tax_office', 'NVARCHAR(255)'],
            ['cost_center_id', 'INT'],
            ['ar_account_id', 'INT'],
            ['credit_risk', "NVARCHAR(50) DEFAULT 'normal'"],
            ['customer_category', 'NVARCHAR(100)'],
            ['payment_terms_days', 'INT DEFAULT 0'],
            ['customer_group_id', 'INT'],
            ['blocked_status', "NVARCHAR(50) DEFAULT 'unblocked'"],
            ['blocked_reason', 'NVARCHAR(500)'],
            ['blocked_at', 'NVARCHAR(50)'],
            ['blocked_by', 'INT'],
            ['internal_notes', 'NVARCHAR(MAX)'],
            ['customer_notes', 'NVARCHAR(MAX)'],
            ['warnings_field', 'NVARCHAR(MAX)'],
            ['special_instructions', 'NVARCHAR(MAX)'],
            ['customer_since', 'NVARCHAR(50)'],
            ['modified_at', 'NVARCHAR(50)'],
            ['modified_by', 'INT'],
            ['last_invoice_date', 'NVARCHAR(50)'],
            ['last_return_date', 'NVARCHAR(50)'],
            ['last_payment_date', 'NVARCHAR(50)'],
            ['total_sales', 'DECIMAL(18,4) DEFAULT 0'],
            ['total_returns', 'DECIMAL(18,4) DEFAULT 0'],
            ['total_payments', 'DECIMAL(18,4) DEFAULT 0'],
            ['customer_status', "NVARCHAR(50) DEFAULT 'active'"],
            ['branch', 'NVARCHAR(255)'],
            ['lead_source', 'NVARCHAR(100)'],
            ['credit_days', 'INT DEFAULT 0'],
            ['preferred_contact_method', 'NVARCHAR(50)'],
            ['opening_balance_date', 'NVARCHAR(50)'],
            ['default_payment_method', 'NVARCHAR(50)'],
            ['tax_status', 'NVARCHAR(50)'],
            ['vat_number', 'NVARCHAR(255)'],
            ['bank_name', 'NVARCHAR(255)'],
            ['bank_account_no', 'NVARCHAR(255)'],
            ['bank_iban', 'NVARCHAR(255)'],
            ['id_type', 'NVARCHAR(50)'],
            ['id_number', 'NVARCHAR(255)'],
            ['id_expiry', 'NVARCHAR(50)'],
            ['contract_no', 'NVARCHAR(255)'],
            ['contract_date', 'NVARCHAR(50)'],
            ['contract_expiry', 'NVARCHAR(50)'],
            ['sales_notes', 'NVARCHAR(MAX)'],
            ['accounting_notes', 'NVARCHAR(MAX)']
        ];
        for (const col of custCols) {
            try {
                await pool.request().query(`IF COL_LENGTH('customers', '${col[0]}') IS NULL ALTER TABLE customers ADD ${col[0]} ${col[1]}`);
            } catch (e) { /* column may already exist */ }
        }
        // Customers: performance indexes (each wrapped in try/catch so one failure does not block others)
        const custIdx = [
            { name: 'IX_customers_email',       sql: 'CREATE INDEX IX_customers_email ON customers(email) WHERE email IS NOT NULL' },
            { name: 'IX_customers_phone',       sql: 'CREATE INDEX IX_customers_phone ON customers(phone) WHERE phone IS NOT NULL' },
            { name: 'IX_customers_tax_id',      sql: 'CREATE INDEX IX_customers_tax_id ON customers(tax_id) WHERE tax_id IS NOT NULL' },
            { name: 'IX_customers_customer_type', sql: 'CREATE INDEX IX_customers_customer_type ON customers(customer_type)' },
            { name: 'IX_customers_rep_id',      sql: 'CREATE INDEX IX_customers_rep_id ON customers(rep_id)' },
            { name: 'IX_customers_is_active',   sql: 'CREATE INDEX IX_customers_is_active ON customers(is_active)' },
            { name: 'IX_customers_city',        sql: 'CREATE INDEX IX_customers_city ON customers(city) WHERE city IS NOT NULL' },
            { name: 'IX_customers_credit_limit', sql: 'CREATE INDEX IX_customers_credit_limit ON customers(credit_limit)' }
        ];
        for (const idx of custIdx) {
            try {
                await pool.request().query(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = '${idx.name}') ${idx.sql}`);
            } catch (e) {
                console.warn(`⚠️ Index ${idx.name} could not be created: ${e.message}`);
            }
        }
        // Sales returns: composite index for statement queries (join on invoice_id + filter on status)
        const srIdx = [
            { name: 'IX_sales_returns_invoice_id_status', sql: 'CREATE INDEX IX_sales_returns_invoice_id_status ON sales_returns(invoice_id, status)' }
        ];
        for (const idx of srIdx) {
            try {
                await pool.request().query(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = '${idx.name}') ${idx.sql}`);
            } catch (e) {
                console.warn(`⚠️ Index ${idx.name} could not be created: ${e.message}`);
            }
        }
        // ── Customer groups table ──
        await pool.request().query(`
            IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name='customer_groups' AND xtype='U')
            BEGIN
                CREATE TABLE customer_groups (
                    id INT IDENTITY(1,1) PRIMARY KEY,
                    group_name NVARCHAR(255) NOT NULL,
                    group_name_en NVARCHAR(255) NULL,
                    is_active INT DEFAULT 1,
                    created_at NVARCHAR(50) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120)
                );
                INSERT INTO customer_groups (group_name, group_name_en) VALUES
                    (N'عامة', 'General'),
                    (N'موزعين', 'Distributors'),
                    (N'تجار', 'Retailers'),
                    (N'شركات', 'Corporate');
            END
        `);
        // ── Customer activity log for timeline ──
        await pool.request().query(`
            IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name='customer_activity_log' AND xtype='U')
            BEGIN
                CREATE TABLE customer_activity_log (
                    id INT IDENTITY(1,1) PRIMARY KEY,
                    customer_id INT NOT NULL,
                    activity_type NVARCHAR(50) NOT NULL,
                    reference_type NVARCHAR(50) NULL,
                    reference_id INT NULL,
                    reference_no NVARCHAR(255) NULL,
                    amount DECIMAL(18,4) DEFAULT 0,
                    description NVARCHAR(MAX) NULL,
                    created_by INT NULL,
                    created_at NVARCHAR(50) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120),
                    metadata NVARCHAR(MAX) NULL
                );
                CREATE INDEX IX_cust_activity_customer_id ON customer_activity_log(customer_id);
            END
        `);
        // ── Customer attachments table ──
        await pool.request().query(`
            IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name='customer_attachments' AND xtype='U')
            BEGIN
                CREATE TABLE customer_attachments (
                    id INT IDENTITY(1,1) PRIMARY KEY,
                    customer_id INT NOT NULL,
                    file_name NVARCHAR(255) NOT NULL,
                    file_type NVARCHAR(50) NULL,
                    file_path NVARCHAR(500) NULL,
                    description NVARCHAR(500) NULL,
                    uploaded_by INT NULL,
                    uploaded_at NVARCHAR(50) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120)
                );
                CREATE INDEX IX_cust_attach_customer_id ON customer_attachments(customer_id);
            END
        `);
        console.log('✅ Schema migrations completed');

        // ── Seed all ERP system accounts (idempotent, hierarchical, transactional) ──
        const { seedRequiredSystemAccountsAsync } = require('./services/accountingEngine');
        await seedRequiredSystemAccountsAsync(pool);
        console.log('✅ System accounts verified');

    } catch (e) {
        console.error('⚠️ Startup migration warning:', e.message);
    }

    const localIP = getLocalIP();
    console.log('');
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║           TradePro ERP - Server Running              ║');
    console.log('╠══════════════════════════════════════════════════════╣');
    console.log(`║  Local   : http://localhost:${PORT}                    ║`);
    console.log(`║  Network : http://${localIP}:${PORT}  (اجهزة الشبكة)  ║`);
    console.log('╠══════════════════════════════════════════════════════╣');
    console.log('║  افتح الرابط ده من اي جهاز على نفس الشبكة           ║');
    console.log('║  اضغط Ctrl+C لايقاف السيرفر                         ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('');
});
