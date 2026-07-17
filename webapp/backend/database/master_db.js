require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const useWindowsAuth = process.env.MSSQL_USE_WINDOWS_AUTH === 'true';
const sql = useWindowsAuth ? require('mssql/msnodesqlv8') : require('mssql');

const server = process.env.MSSQL_SERVER || 'localhost\\SQLEXPRESS';
const masterDatabase = process.env.MSSQL_MASTER_DATABASE || 'tradepro_master';
const user = process.env.MSSQL_USER || 'sa';
const password = process.env.MSSQL_PASSWORD || '';

let masterPool = null;

async function connectToDb(dbName) {
    let config;
    if (useWindowsAuth) {
        config = {
            server: server,
            database: dbName,
            driver: 'msnodesqlv8',
            options: {
                trustedConnection: true,
                enableArithAbort: true
            }
        };
    } else {
        config = {
            server: server,
            database: dbName,
            user: user,
            password: password,
            options: {
                encrypt: false,
                trustServerCertificate: true,
                enableArithAbort: true
            }
        };
    }
    
    // For msnodesqlv8 fallback
    if (useWindowsAuth) {
        const drivers = [
            'ODBC Driver 17 for SQL Server',
            'SQL Server Native Client 11.0',
            'ODBC Driver 13 for SQL Server',
            'SQL Server',
            'ODBC Driver 18 for SQL Server'
        ];
        const msnodesql = require('mssql/msnodesqlv8');
        const localServer = server.replace(/^localhost/i, '.');
        let lastError;
        for (const driver of drivers) {
            try {
                const connStr = `Driver={${driver}};Server=${localServer};Database=${dbName};Trusted_Connection=yes;Encrypt=no;TrustServerCertificate=yes;`;
                const testPool = new msnodesql.ConnectionPool({ connectionString: connStr });
                await testPool.connect();
                return testPool;
            } catch (e) {
                lastError = e;
                if (e.message.includes('Data source name not found') || e.message.includes('Invalid connection string attribute')) {
                    continue;
                }
                if (e.message.includes('Cannot open database') || e.message.includes('requested by the login')) {
                    throw e;
                }
            }
        }
        throw lastError;
    } else {
        return new sql.ConnectionPool(config).connect();
    }
}

async function getMasterPool() {
    if (masterPool) return masterPool;

    console.log(`[MASTER DB] Connecting to master database: ${masterDatabase}...`);
    
    try {
        masterPool = await connectToDb(masterDatabase);
    } catch (err) {
        if (err.message.includes('Cannot open database') || err.message.includes('requested by the login') || err.message.includes('Login failed')) {
            console.log(`[MASTER DB] Database ${masterDatabase} does not exist. Creating it...`);
            try {
                const systemPool = await connectToDb('master');
                await systemPool.request().query(`CREATE DATABASE [${masterDatabase}]`);
                systemPool.close();
                console.log(`[MASTER DB] Database ${masterDatabase} created successfully.`);
                
                masterPool = await connectToDb(masterDatabase);
            } catch (createErr) {
                console.error('[MASTER DB] Failed to create master database:', createErr.message);
                throw createErr;
            }
        } else {
            console.error('[MASTER DB] Failed to connect:', err.message);
            throw err;
        }
    }

    try {
        console.log('[MASTER DB] Connected successfully.');
        await ensureMasterSchema(masterPool);
        return masterPool;
    } catch (err) {
        console.error('[MASTER DB] Failed to initialize schema:', err);
        masterPool = null;
        throw err;
    }
}

async function ensureMasterSchema(pool) {
    const request = pool.request();
    
    const checkTable = await request.query(`SELECT 1 FROM sys.tables WHERE name = 'tenants'`);
    if (checkTable.recordset.length === 0) {
        console.log('[MASTER DB] Initializing Master Schema...');
        await request.query(`
            CREATE TABLE tenants (
                id INT IDENTITY(1,1) PRIMARY KEY,
                company_name NVARCHAR(255) NOT NULL,
                db_name NVARCHAR(100) UNIQUE NOT NULL,
                plan_name NVARCHAR(50) DEFAULT 'basic',
                max_users INT DEFAULT 5,
                is_active BIT DEFAULT 1,
                created_at DATETIME DEFAULT GETDATE(),
                expires_at DATETIME,
                contact_email NVARCHAR(255),
                contact_phone NVARCHAR(50)
            );

            CREATE TABLE subscriptions (
                id INT IDENTITY(1,1) PRIMARY KEY,
                tenant_id INT REFERENCES tenants(id),
                plan_name NVARCHAR(50),
                amount DECIMAL(10,2),
                start_date DATETIME,
                end_date DATETIME,
                status NVARCHAR(20) DEFAULT 'active'
            );
            
            INSERT INTO tenants (company_name, db_name, plan_name, expires_at)
            VALUES ('Default Local Company', 'TradePro', 'pro', '2099-12-31');
        `);
        console.log('[MASTER DB] Master Schema initialized.');
    }
}

module.exports = {
    sql,
    getMasterPool
};
