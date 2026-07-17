require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const useWindowsAuth = process.env.MSSQL_USE_WINDOWS_AUTH === 'true';
const sql = useWindowsAuth ? require('mssql/msnodesqlv8') : require('mssql');
const bcrypt = require('bcryptjs');

const server = process.env.MSSQL_SERVER || 'localhost\\SQLEXPRESS';
const database = process.env.MSSQL_DATABASE || 'TradePro';

// ─── Health State ─────────────────────────────────────────────
const healthState = {
    status: 'INIT',
    database: 'INIT',
    degraded: false,
    retryCount: 0,
    lastError: null,
    reconnectTimer: null,
    startTime: Date.now()
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pool;

async function createPool(dbOverride) {
    const dbToUse = dbOverride || database;
    if (!useWindowsAuth) {
        const config = {
            server: server,
            database: dbToUse,
            user: process.env.MSSQL_USER,
            password: process.env.MSSQL_PASSWORD,
            options: {
                encrypt: false,
                trustServerCertificate: true,
                enableArithAbort: true
            }
        };
        return new sql.ConnectionPool(config).connect();
    }

    // Windows Auth with msnodesqlv8
    // Try multiple drivers if "Data source name not found" error occurs
    const drivers = [
        'ODBC Driver 17 for SQL Server',
        'SQL Server Native Client 11.0',
        'ODBC Driver 13 for SQL Server',
        'SQL Server', // Built-in Windows fallback
        'ODBC Driver 18 for SQL Server' // Put 18 last because it often hangs on local connections
    ];

    const fs = require('fs');
    const logFile = require('path').join(__dirname, 'mssql_debug.txt');
    fs.writeFileSync(logFile, '[MSSQL] Starting driver loop...\n');
    let lastError;
    for (const driver of drivers) {
        try {
            const msg1 = `[MSSQL] Attempting to connect using driver: ${driver}...`;
            console.log(msg1);
            fs.appendFileSync(logFile, msg1 + '\n');
            
            const localServer = server.replace(/^localhost/i, '.');
            const connStr = `Driver={${driver}};Server=${localServer};Database=${dbToUse};Trusted_Connection=yes;Encrypt=no;TrustServerCertificate=yes;Connection Timeout=3;`;
            const testPool = new sql.ConnectionPool({
                connectionString: connStr
            });
            await testPool.connect();
            
            const msg2 = `[MSSQL] Successfully connected using driver: ${driver}`;
            console.log(msg2);
            fs.appendFileSync(logFile, msg2 + '\n');
            return testPool;
        } catch (e) {
            fs.appendFileSync(logFile, `[MSSQL] Failed with driver ${driver}: ${e.message}\n`);
            lastError = e;
            if (e.message.includes('Data source name not found') || e.message.includes('Provider cannot be found')) {
                continue;
            }
            throw e;
        }
    }
    throw lastError;
}

async function initializeDatabase() {
    const backoff = [0, 1000, 2000, 4000, 8000, 16000];
    let lastErr;

    for (let attempt = 0; attempt < backoff.length; attempt++) {
        if (attempt > 0) {
            console.log(`[MSSQL] Retry #${attempt} in ${backoff[attempt]}ms...`);
            await sleep(backoff[attempt]);
        }
        try {
            // ─── Auto-Create Database if missing (first run for new client) ──
            try {
                pool = await createPool();
            } catch (connErr) {
                const isDbMissing = connErr.message && (
                    connErr.message.includes('Cannot open database') ||
                    connErr.message.includes('Login failed') ||
                    connErr.message.includes('database') && connErr.message.includes('does not exist')
                );
                if (isDbMissing) {
                    console.log(`[MSSQL] Database "${database}" not found. Auto-creating for first-time setup...`);
                    // Connect to master DB to create the new database
                    const masterPool = await createPool('master');
                    await masterPool.request().query(`
                        IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = '${database}')
                        CREATE DATABASE [${database}]
                    `);
                    masterPool.close();
                    console.log(`[MSSQL] Database "${database}" created successfully.`);

                    // Run schema on the new database
                    const schemaPath = require('path').join(__dirname, '../schema_fixed.sql');
                    const schemaSql = require('fs').readFileSync(schemaPath, 'utf8');
                    pool = await createPool();
                    const statements = schemaSql.split(/\bGO\b/i).map(s => s.trim()).filter(s => s.length > 0);
                    for (const stmt of statements) {
                        try { await pool.request().query(stmt); } catch(e) { /* ignore minor schema errors */ }
                    }
                    console.log('[MSSQL] Schema applied to new database successfully.');
                } else {
                    throw connErr;
                }
            }
            console.log('[MSSQL] Database connection pool established.');

            const schemaCheck = await pool.request().query(`
                SELECT 1 FROM sys.tables WHERE name = 'company_info'
            `);

            if (schemaCheck.recordset.length === 0) {
                console.log('[MSSQL] Schema not found. Waiting for schema creation before initializing defaults.');
            } else {
                const request = pool.request();
                const companyCheck = await request.query(`SELECT TOP 1 id FROM company_info`);
                if (companyCheck.recordset.length === 0) {
                    await pool.request().query(`
                        INSERT INTO company_info (company_name, currency) 
                        VALUES ('TradePro ERP', 'EGP')
                    `);
                    console.log('[MSSQL] Inserted default company info.');
                }
                const storeCheck = await request.query(`SELECT TOP 1 id FROM stores`);
                if (storeCheck.recordset.length === 0) {
                    await pool.request().query(`
                        INSERT INTO stores (store_code, store_name, store_type) 
                        VALUES ('ST001', 'المخزن الرئيسي', 'main')
                    `);
                    console.log('[MSSQL] Inserted default main store.');
                }
                const adminCheck = await request.query(`SELECT TOP 1 id FROM users`);
                if (adminCheck.recordset.length === 0) {
                    const hash = bcrypt.hashSync('admin123', 10);
                    const userReq = pool.request();
                    userReq.input('hash', sql.NVarChar, hash);
                    await userReq.query(`
                        INSERT INTO users (username, password_hash, full_name, role) 
                        VALUES ('admin@3smcompany.com', @hash, 'مدير النظام', 'admin')
                    `);
                    console.log('[MSSQL] Default admin user created. Please change the default password immediately.');
                }
                const treasuryCheck = await request.query(`SELECT TOP 1 id FROM treasury_accounts`);
                if (treasuryCheck.recordset.length === 0) {
                    await pool.request().query(`
                        INSERT INTO treasury_accounts (account_name, account_type, opening_balance, current_balance) 
                        VALUES ('الخزينة الرئيسية', 'cash', 0, 0)
                    `);
                    console.log('[MSSQL] Inserted default treasury account.');
                }
                // ── Fixed Assets Tables (auto-create if missing) ──
                const faTablesCheck = await pool.request().query(`SELECT 1 FROM sys.tables WHERE name = 'asset_categories'`);
                if (faTablesCheck.recordset.length === 0) {
                    console.log('[MSSQL] Creating fixed assets tables...');
                    await pool.request().query(`
                        CREATE TABLE asset_categories (
                            id INT IDENTITY(1,1) PRIMARY KEY,
                            name NVARCHAR(200) NOT NULL,
                            description NVARCHAR(500),
                            useful_life_months DECIMAL(7,1) NOT NULL DEFAULT 60,
                            depreciation_method NVARCHAR(50) DEFAULT 'straight-line',
                            parent_id INT,
                            created_by INT,
                            created_at DATETIME DEFAULT GETDATE(),
                            updated_by INT,
                            updated_at DATETIME,
                            deleted_by INT,
                            deleted_at DATETIME
                        );

                        CREATE TABLE fixed_assets (
                            id INT IDENTITY(1,1) PRIMARY KEY,
                            asset_code NVARCHAR(50) NOT NULL,
                            asset_name NVARCHAR(300) NOT NULL,
                            category_id INT,
                            purchase_date NVARCHAR(20),
                            purchase_cost DECIMAL(18,2) NOT NULL DEFAULT 0,
                            salvage_value DECIMAL(18,2) DEFAULT 0,
                            useful_life_months DECIMAL(7,1) NOT NULL DEFAULT 60,
                            depreciation_method NVARCHAR(50) DEFAULT 'straight-line',
                            accumulated_depreciation DECIMAL(18,2) DEFAULT 0,
                            location NVARCHAR(300),
                            serial_number NVARCHAR(200),
                            notes NVARCHAR(MAX),
                            asset_status NVARCHAR(30) DEFAULT 'active',
                            created_by INT,
                            created_at DATETIME DEFAULT GETDATE(),
                            updated_by INT,
                            updated_at DATETIME,
                            deleted_by INT,
                            deleted_at DATETIME
                        );

                        CREATE TABLE asset_depreciation (
                            id INT IDENTITY(1,1) PRIMARY KEY,
                            asset_id INT NOT NULL,
                            period_date NVARCHAR(20) NOT NULL,
                            depreciation_amount DECIMAL(18,2) NOT NULL,
                            accumulated_after DECIMAL(18,2) NOT NULL,
                            journal_entry_id INT,
                            created_by INT,
                            created_at DATETIME DEFAULT GETDATE()
                        );

                        CREATE TABLE asset_movements (
                            id INT IDENTITY(1,1) PRIMARY KEY,
                            movement_no NVARCHAR(50) NOT NULL,
                            asset_id INT NOT NULL,
                            movement_type NVARCHAR(50) NOT NULL,
                            movement_date NVARCHAR(20),
                            amount DECIMAL(18,2),
                            buyer_name NVARCHAR(300),
                            from_location NVARCHAR(300),
                            to_location NVARCHAR(300),
                            workflow_status NVARCHAR(30) DEFAULT 'draft',
                            journal_entry_id INT,
                            notes NVARCHAR(MAX),
                            created_by INT,
                            created_at DATETIME DEFAULT GETDATE(),
                            updated_by INT,
                            updated_at DATETIME,
                            deleted_at DATETIME
                        );

                        INSERT INTO invoice_counters (counter_name, prefix, last_number) VALUES ('fixed_assets', 'FA', 0);
                        INSERT INTO invoice_counters (counter_name, prefix, last_number) VALUES ('fa_movements', 'MV', 0);
                    `);
                    console.log('[MSSQL] Fixed assets tables created.');
                }

                // ── HR Tables (auto-create if missing) ──
                const hrTablesCheck = await pool.request().query(`SELECT 1 FROM sys.tables WHERE name = 'emp_attendance'`);
                if (hrTablesCheck.recordset.length === 0) {
                    console.log('[MSSQL] Creating HR tables (attendance, vacations, penalties, rewards)...');
                    await pool.request().query(`
                        IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[employees]') AND type in (N'U'))
                        BEGIN
                            CREATE TABLE [dbo].[employees] (
                                [id] INT IDENTITY(1,1) PRIMARY KEY,
                                [emp_code] NVARCHAR(255) NOT NULL UNIQUE,
                                [emp_name] NVARCHAR(255) NOT NULL,
                                [department] NVARCHAR(255),
                                [job_title] NVARCHAR(255),
                                [basic_salary] DECIMAL(18,4) DEFAULT 0,
                                [hire_date] NVARCHAR(255),
                                [phone] NVARCHAR(255),
                                [national_id] NVARCHAR(255),
                                [status] NVARCHAR(255) DEFAULT 'active',
                                [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120)
                            );
                        END;

                        IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[emp_loans]') AND type in (N'U'))
                        BEGIN
                            CREATE TABLE [dbo].[emp_loans] (
                                [id] INT IDENTITY(1,1) PRIMARY KEY,
                                [emp_id] INT NOT NULL,
                                [loan_date] NVARCHAR(255) NOT NULL,
                                [amount] DECIMAL(18,4) NOT NULL,
                                [monthly_installment] DECIMAL(18,4) DEFAULT 0,
                                [paid_amount] DECIMAL(18,4) DEFAULT 0,
                                [reason] NVARCHAR(MAX),
                                [status] NVARCHAR(255) DEFAULT 'active',
                                [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120),
                                CONSTRAINT [FK_emp_loans_emp] FOREIGN KEY ([emp_id]) REFERENCES [dbo].[employees] ([id])
                            );
                        END;

                        IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[salary_slips]') AND type in (N'U'))
                        BEGIN
                            CREATE TABLE [dbo].[salary_slips] (
                                [id] INT IDENTITY(1,1) PRIMARY KEY,
                                [slip_no] NVARCHAR(255) NOT NULL UNIQUE,
                                [period] NVARCHAR(255) NOT NULL,
                                [emp_id] INT NOT NULL,
                                [basic_salary] DECIMAL(18,4) DEFAULT 0,
                                [allowances] DECIMAL(18,4) DEFAULT 0,
                                [deductions] DECIMAL(18,4) DEFAULT 0,
                                [loans] DECIMAL(18,4) DEFAULT 0,
                                [net_salary] DECIMAL(18,4) DEFAULT 0,
                                [status] NVARCHAR(255) DEFAULT 'draft',
                                [notes] NVARCHAR(MAX),
                                [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120),
                                CONSTRAINT [FK_salary_slips_emp] FOREIGN KEY ([emp_id]) REFERENCES [dbo].[employees] ([id])
                            );
                        END;

                        IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[emp_attendance]') AND type in (N'U'))
                        BEGIN
                            CREATE TABLE [dbo].[emp_attendance] (
                                [id] INT IDENTITY(1,1) PRIMARY KEY,
                                [emp_id] INT NOT NULL,
                                [att_date] NVARCHAR(255) NOT NULL,
                                [check_in] NVARCHAR(255),
                                [check_out] NVARCHAR(255),
                                [status] NVARCHAR(255) DEFAULT 'present',
                                [late_minutes] INT DEFAULT 0,
                                [overtime_minutes] INT DEFAULT 0,
                                [notes] NVARCHAR(MAX),
                                [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120),
                                CONSTRAINT [FK_emp_attendance_emp] FOREIGN KEY ([emp_id]) REFERENCES [dbo].[employees] ([id])
                            );
                            CREATE UNIQUE INDEX IX_emp_attendance_emp_date ON emp_attendance(emp_id, att_date);
                        END;

                        IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[emp_vacations]') AND type in (N'U'))
                        BEGIN
                            CREATE TABLE [dbo].[emp_vacations] (
                                [id] INT IDENTITY(1,1) PRIMARY KEY,
                                [emp_id] INT NOT NULL,
                                [vac_type] NVARCHAR(255) DEFAULT 'annual',
                                [start_date] NVARCHAR(255) NOT NULL,
                                [end_date] NVARCHAR(255) NOT NULL,
                                [days] INT NOT NULL DEFAULT 1,
                                [reason] NVARCHAR(MAX),
                                [status] NVARCHAR(255) DEFAULT 'pending',
                                [approved_by] NVARCHAR(255),
                                [approved_at] NVARCHAR(255),
                                [notes] NVARCHAR(MAX),
                                [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120),
                                CONSTRAINT [FK_emp_vacations_emp] FOREIGN KEY ([emp_id]) REFERENCES [dbo].[employees] ([id])
                            );
                        END;

                        IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[emp_penalties]') AND type in (N'U'))
                        BEGIN
                            CREATE TABLE [dbo].[emp_penalties] (
                                [id] INT IDENTITY(1,1) PRIMARY KEY,
                                [emp_id] INT NOT NULL,
                                [penalty_type] NVARCHAR(255) NOT NULL,
                                [penalty_date] NVARCHAR(255) NOT NULL,
                                [amount] DECIMAL(18,4) DEFAULT 0,
                                [reason] NVARCHAR(MAX),
                                [status] NVARCHAR(255) DEFAULT 'active',
                                [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120),
                                CONSTRAINT [FK_emp_penalties_emp] FOREIGN KEY ([emp_id]) REFERENCES [dbo].[employees] ([id])
                            );
                        END;

                        IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[emp_rewards]') AND type in (N'U'))
                        BEGIN
                            CREATE TABLE [dbo].[emp_rewards] (
                                [id] INT IDENTITY(1,1) PRIMARY KEY,
                                [emp_id] INT NOT NULL,
                                [reward_type] NVARCHAR(255) NOT NULL,
                                [reward_date] NVARCHAR(255) NOT NULL,
                                [amount] DECIMAL(18,4) DEFAULT 0,
                                [reason] NVARCHAR(MAX),
                                [status] NVARCHAR(255) DEFAULT 'active',
                                [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120),
                                CONSTRAINT [FK_emp_rewards_emp] FOREIGN KEY ([emp_id]) REFERENCES [dbo].[employees] ([id])
                            );
                        END;
                    `);
                    console.log('[MSSQL] HR tables created.');
                }

                const counters = ['sales', 'purchases', 'collections', 'supplier_payments', 'sales_returns', 'purchase_returns', 'treasury',
                          'transfer', 'damaged', 'adjustment', 'count', 'journal', 'expense'];
                const prefixes = {
                    sales: 'INV', purchases: 'PUR', collections: 'REC', supplier_payments: 'PAY',
                    sales_returns: 'SRT', purchase_returns: 'PRT', treasury: 'TRS',
                    transfer: 'TRF', damaged: 'DMG', adjustment: 'ADJ', count: 'CNT', journal: 'JV',
                    expense: 'EXP'
                };
                for (const c of counters) {
                    const checkCount = await pool.request()
                        .input('name', sql.NVarChar, c)
                        .query(`SELECT id FROM invoice_counters WHERE counter_name = @name`);
                    if (checkCount.recordset.length === 0) {
                        await pool.request()
                            .input('name', sql.NVarChar, c)
                            .input('prefix', sql.NVarChar, prefixes[c] || 'DOC')
                            .query(`
                                INSERT INTO invoice_counters (counter_name, prefix, last_number) 
                                VALUES (@name, @prefix, 0)
                            `);
                    }
                }
            }

            healthState.status = 'UP';
            healthState.database = 'UP';
            healthState.degraded = false;
            healthState.retryCount = 0;
            healthState.lastError = null;
            console.log('[MSSQL] Database initialization complete.');
            return;
        } catch (err) {
            lastErr = err;
            healthState.retryCount = attempt + 1;
            healthState.lastError = err.message;
            console.error(`[MSSQL] Initialization attempt ${attempt + 1}/${backoff.length} failed: ${err.message}`);
            if (pool) { try { pool.close(); } catch (e) { /* ignore */ } pool = null; }
        }
    }

    console.error('======================================================');
    console.error('[MSSQL ERROR] All 6 connection attempts exhausted.');
    console.error(`[MSSQL] ${lastErr ? lastErr.message : 'Unknown error'}`);
    console.error('[MSSQL] Entering DEGRADED mode. Background retry every 30s.');
    console.error('======================================================');
    healthState.status = 'DEGRADED';
    healthState.database = 'DOWN';
    healthState.degraded = true;

    startReconnectLoop();
}

function startReconnectLoop() {
    healthState.reconnectTimer = setInterval(async () => {
        try {
            const newPool = await createPool();
            pool = newPool;
            console.log('[MSSQL] Background reconnect succeeded.');
            healthState.status = 'UP';
            healthState.database = 'UP';
            healthState.degraded = false;
            healthState.retryCount = 0;
            healthState.lastError = null;
            clearInterval(healthState.reconnectTimer);
            healthState.reconnectTimer = null;
        } catch (err) {
            healthState.retryCount++;
            healthState.lastError = err.message;
            console.error(`[MSSQL] Background reconnect failed: ${err.message}`);
        }
    }, 30000);
    if (healthState.reconnectTimer && healthState.reconnectTimer.unref) {
        healthState.reconnectTimer.unref();
    }
}

function getHealth() {
    return {
        status: healthState.status,
        database: healthState.database,
        degraded: healthState.degraded,
        retryCount: healthState.retryCount,
        lastError: healthState.lastError,
        uptime: Math.floor((Date.now() - healthState.startTime) / 1000),
        version: process.env.npm_package_version || '1.0.0',
        timestamp: new Date().toISOString()
    };
}

// Start async initialization, but don't block exports
const initPromise = initializeDatabase();

module.exports = {
    sql,
    getPool: async () => {
        await initPromise;
        if (!pool) {
            throw new Error('Database connection is not available (degraded mode)');
        }
        return pool;
    },
    getHealth
};
