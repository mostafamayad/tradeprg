const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class MigrationRunner {
    constructor(pool, sql) {
        this.pool = pool;
        this.sql = sql;
        this.dir = path.join(__dirname, '..', 'migrations');
    }

    async ensureTable() {
        await this.pool.request().query(`
            IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'schema_versions')
            BEGIN
                CREATE TABLE schema_versions (
                    version INT NOT NULL PRIMARY KEY,
                    name NVARCHAR(255) NOT NULL,
                    applied_at DATETIME DEFAULT GETDATE(),
                    duration_ms INT NOT NULL DEFAULT 0,
                    checksum NVARCHAR(64) NOT NULL
                );
            END
        `);
    }

    async getExecuted() {
        try {
            const r = await this.pool.request().query(
                'SELECT version, name, checksum FROM schema_versions ORDER BY version'
            );
            return r.recordset;
        } catch (e) {
            if (e.message.includes('schema_versions')) return [];
            throw e;
        }
    }

    async getPending() {
        const files = fs.readdirSync(this.dir)
            .filter(f => /^\d+_.*\.sql$/.test(f))
            .sort();

        const executed = await this.getExecuted();
        const executedVersions = new Map(executed.map(e => [e.version, e]));

        const pending = [];
        for (const file of files) {
            const version = parseInt(file.match(/^(\d+)/)[1], 10);
            const content = fs.readFileSync(path.join(this.dir, file), 'utf8');
            const checksum = crypto.createHash('sha256').update(content).digest('hex').substring(0, 32);

            if (executedVersions.has(version)) {
                const ex = executedVersions.get(version);
                if (ex.checksum !== checksum) {
                    console.warn(`[MIGRATIONS] ⚠️  ${file}: checksum changed (was ${ex.checksum}, now ${checksum})`);
                }
                continue;
            }

            pending.push({ version, file, content, checksum });
        }

        return pending;
    }

    async runOne(m) {
        const start = Date.now();
        console.log(`[MIGRATIONS] ▶ ${m.file}...`);

        const isTransactional = !m.content.toUpperCase().includes('GO');
        let transaction = null;

        try {
            if (isTransactional) {
                transaction = new this.sql.Transaction(this.pool);
                await transaction.begin();
            }

            if (isTransactional) {
                const req = new this.sql.Request(transaction);
                await req.query(m.content);
                await transaction.commit();
            } else {
                const batches = m.content.split(/\nGO\s*\n/i).map(b => b.trim()).filter(b => b);
                for (const batch of batches) {
                    await this.pool.request().query(batch);
                }
            }

            const duration = Date.now() - start;
            await this.pool.request()
                .input('version', this.sql.Int, m.version)
                .input('name', this.sql.NVarChar(255), m.file.replace('.sql', ''))
                .input('duration_ms', this.sql.Int, duration)
                .input('checksum', this.sql.NVarChar(64), m.checksum)
                .query(`
                    INSERT INTO schema_versions (version, name, applied_at, duration_ms, checksum)
                    VALUES (@version, @name, GETDATE(), @duration_ms, @checksum)
                `);

            console.log(`[MIGRATIONS] ✅ ${m.file} (${duration}ms)`);
        } catch (e) {
            if (transaction) {
                try { await transaction.rollback(); } catch (rb) { /* ignore */ }
            }
            console.error(`[MIGRATIONS] ❌ ${m.file} FAILED: ${e.message}`);
            throw e;
        }
    }

    async run() {
        console.log('[MIGRATIONS] Starting migration runner...');
        await this.ensureTable();

        const pending = await this.getPending();
        if (pending.length === 0) {
            console.log('[MIGRATIONS] No pending migrations.');
            return [];
        }

        console.log(`[MIGRATIONS] ${pending.length} pending migration(s) found.`);
        const results = [];
        for (const m of pending) {
            await this.runOne(m);
            results.push({ version: m.version, name: m.file, success: true });
        }
        console.log(`[MIGRATIONS] All ${pending.length} migration(s) completed successfully.`);
        return results;
    }
}

module.exports = MigrationRunner;
