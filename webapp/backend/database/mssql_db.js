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

async function createPool() {
    if (!useWindowsAuth) {
        const config = {
            server: server,
            database: database,
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
            const connStr = `Driver={${driver}};Server=${localServer};Database=${database};Trusted_Connection=yes;Encrypt=no;TrustServerCertificate=yes;Connection Timeout=3;`;
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
            pool = await createPool();
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
