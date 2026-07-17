const router = require('express').Router();
const { sql, getPool } = require('../database/mssql_db');
const path = require('path');
const os = require('os');
const logActivity = require('../middleware/logger');
const asyncHandler = require('../utils/asyncHandler');

// ─── Helper: upsert a setting ───
async function upsertSetting(pool, key, value) {
  const rq = pool.request();
  rq.input('key', sql.NVarChar, key);
  rq.input('value', sql.NVarChar, value != null ? String(value) : '');
  await rq.query(`
    IF EXISTS (SELECT 1 FROM settings WHERE [key] = @key)
      UPDATE settings SET [value] = @value, updated_at = FORMAT(GETDATE(), 'yyyy-MM-dd HH:mm:ss') WHERE [key] = @key
    ELSE
      INSERT INTO settings ([key], [value], updated_at) VALUES (@key, @value, FORMAT(GETDATE(), 'yyyy-MM-dd HH:mm:ss'))
  `);
}

// ─── GET /api/settings - all settings grouped ───
router.get('/', asyncHandler(async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query('SELECT * FROM settings');
    const all = {};
    result.recordset.forEach(s => all[s.key] = s.value);

    // Group by section
    const group = {
      company: {},
      print: {},
      system: {},
      email: {},
      security: {},
      backup: {}
    };
    for (const [k, v] of Object.entries(all)) {
      if (k.startsWith('company_')) group.company[k.replace('company_', '')] = v;
      else if (k.startsWith('print_')) group.print[k.replace('print_', '')] = v;
      else if (k.startsWith('email_')) group.email[k.replace('email_', '')] = v;
      else if (k.startsWith('security_')) group.security[k.replace('security_', '')] = v;
      else if (k.startsWith('backup_')) group.backup[k.replace('backup_', '')] = v;
      else group.system[k] = v;
    }

    res.json({ success: true, data: all, groups: group });
  } catch (err) {
    console.error('Settings GET Error:', err);
    err.status = 500;
    err.message = 'خطأ في سيرفر قاعدة البيانات';
    throw err;
  }
}));

// ─── POST /api/settings - save one setting ───
router.post('/', asyncHandler(async (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ success: false, message: 'Missing key' });
  try {
    const pool = await getPool();
    await upsertSetting(pool, key, value);
    logActivity(req, 'UPDATE', 'settings', null, 'Setting: ' + key, null, { [key]: value }, 'SUCCESS', null);
    res.json({ success: true, message: 'تم حفظ الإعداد' });
  } catch (err) {
    console.error('Settings POST Error:', err);
    err.status = 500;
    err.message = 'خطأ في حفظ الإعدادات';
    throw err;
  }
}));

// ─── POST /api/settings/bulk - save multiple settings at once ───
router.post('/bulk', asyncHandler(async (req, res) => {
  const { settings } = req.body;
  if (!settings || typeof settings !== 'object') return res.status(400).json({ success: false, message: 'Invalid settings object' });
  try {
    const pool = await getPool();
    for (const [key, value] of Object.entries(settings)) {
      await upsertSetting(pool, key, value);
    }
    logActivity(req, 'UPDATE', 'settings', null, 'Updated ' + Object.keys(settings).length + ' settings', null, settings, 'SUCCESS', null);
    res.json({ success: true, message: 'تم حفظ جميع الإعدادات' });
  } catch (err) {
    console.error('Settings BULK Error:', err);
    err.status = 500;
    err.message = 'خطأ في حفظ الإعدادات';
    throw err;
  }
}));

// ─── GET /api/settings/company - company info for print engine / invoices ───
router.get('/company', asyncHandler(async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query("SELECT * FROM settings WHERE [key] LIKE 'company_%'");
    const data = {};
    result.recordset.forEach(s => data[s.key.replace('company_', '')] = s.value);
    res.json({ success: true, data });
  } catch (err) {
    console.error('Company GET Error:', err);
    err.status = 500;
    err.message = 'خطأ في سيرفر قاعدة البيانات';
    throw err;
  }
}));

// ─── POST /api/settings/company - save company info ───
router.post('/company', asyncHandler(async (req, res) => {
  const { settings } = req.body;
  if (!settings || typeof settings !== 'object') return res.status(400).json({ success: false, message: 'Invalid' });
  try {
    const pool = await getPool();
    for (const [key, value] of Object.entries(settings)) {
      await upsertSetting(pool, 'company_' + key, value);
    }
    logActivity(req, 'UPDATE', 'settings', null, 'Company info updated', null, req.body.settings || null, 'SUCCESS', null);
    res.json({ success: true, message: 'تم حفظ بيانات الشركة' });
  } catch (err) {
    console.error('Company POST Error:', err);
    err.status = 500;
    err.message = 'خطأ في حفظ بيانات الشركة';
    throw err;
  }
}));

// ─── POST /api/settings/logo - upload company logo (base64) ───
router.post('/logo', asyncHandler(async (req, res) => {
  const { logo } = req.body;
  if (!logo) return res.status(400).json({ success: false, message: 'No logo data' });
  try {
    const pool = await getPool();
    await upsertSetting(pool, 'company_logo', logo);
    logActivity(req, 'UPDATE', 'settings', null, 'Company logo updated', null, null, 'SUCCESS', null);
    res.json({ success: true, message: 'تم حفظ الشعار' });
  } catch (err) {
    console.error('Logo Error:', err);
    err.status = 500;
    err.message = 'خطأ في حفظ الشعار';
    throw err;
  }
}));

// ─── DELETE /api/settings/logo - remove company logo ───
router.delete('/logo', asyncHandler(async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input('key', sql.NVarChar, 'company_logo').query("DELETE FROM settings WHERE [key] = @key");
    logActivity(req, 'DELETE', 'settings', null, 'Company logo removed', null, null, 'SUCCESS', null);
    res.json({ success: true, message: 'تم حذف الشعار' });
  } catch (err) {
    console.error('Logo DELETE Error:', err);
    err.status = 500;
    err.message = 'خطأ في حذف الشعار';
    throw err;
  }
}));

// ─── GET /api/settings/print - print settings ───
router.get('/print', asyncHandler(async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query("SELECT * FROM settings WHERE [key] LIKE 'print_%'");
    const data = {};
    result.recordset.forEach(s => data[s.key.replace('print_', '')] = s.value);
    res.json({ success: true, data });
  } catch (err) {
    console.error('Print GET Error:', err);
    err.status = 500;
    err.message = 'خطأ في سيرفر قاعدة البيانات';
    throw err;
  }
}));

// ─── POST /api/settings/print - save print settings ───
router.post('/print', asyncHandler(async (req, res) => {
  const { settings } = req.body;
  if (!settings || typeof settings !== 'object') return res.status(400).json({ success: false, message: 'Invalid' });
  try {
    const pool = await getPool();
    for (const [key, value] of Object.entries(settings)) {
      await upsertSetting(pool, 'print_' + key, value);
    }
    logActivity(req, 'UPDATE', 'settings', null, 'Print settings updated', null, req.body.settings || null, 'SUCCESS', null);
    res.json({ success: true, message: 'تم حفظ إعدادات الطباعة' });
  } catch (err) {
    console.error('Print POST Error:', err);
    err.status = 500;
    err.message = 'خطأ في حفظ الإعدادات';
    throw err;
  }
}));

// ─── GET /api/settings/backup - list backups ───
router.get('/backup', asyncHandler(async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query("SELECT * FROM settings WHERE [key] LIKE 'backup_%'");
    const data = {};
    result.recordset.forEach(s => data[s.key.replace('backup_', '')] = s.value);
    // Check for backup history table
    let history = [];
    try {
      const hist = await pool.request().query("SELECT TOP 50 * FROM backup_history ORDER BY id DESC");
      history = hist.recordset;
    } catch (e) { /* table may not exist */ }
    res.json({ success: true, data, history });
  } catch (err) {
    console.error('Backup GET Error:', err);
    err.status = 500;
    err.message = 'خطأ';
    throw err;
  }
}));

// ─── POST /api/settings/backup/run - run manual backup ───
router.post('/backup/run', asyncHandler(async (req, res) => {
  try {
    const pool = await getPool();
    // Get database name from SQL Server
    const dbRes = await pool.request().query('SELECT DB_NAME() AS db');
    const dbName = dbRes.recordset[0]?.db || 'TradePro';
    const backupPath = path.join(os.tmpdir(), dbName + '_' + Date.now() + '.bak');

    // Run SQL backup
    await pool.request().query(`BACKUP DATABASE [${dbName}] TO DISK = N'${backupPath}' WITH INIT, COMPRESSION`);

    // Ensure backup_history table exists
    await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='backup_history')
      CREATE TABLE backup_history (
        id INT IDENTITY(1,1) PRIMARY KEY,
        file_path NVARCHAR(500),
        file_size BIGINT,
        status NVARCHAR(50),
        created_by NVARCHAR(255),
        created_at NVARCHAR(50)
      )
    `);

    const fs = require('fs');
    const stats = fs.statSync(backupPath);
    await pool.request()
      .input('path', sql.NVarChar, backupPath)
      .input('size', sql.BigInt, stats.size)
      .input('status', sql.NVarChar, 'completed')
      .input('user', sql.NVarChar, req.user?.name || req.user?.email || 'system')
      .query(`
        INSERT INTO backup_history (file_path, file_size, status, created_by, created_at)
        VALUES (@path, @size, @status, @user, FORMAT(GETDATE(), 'yyyy-MM-dd HH:mm:ss'))
      `);

    logActivity(req, 'CREATE', 'backup', null, 'Manual backup created', null, { path: backupPath }, 'SUCCESS', null);
    res.json({ success: true, message: 'تم إنشاء النسخة الاحتياطية', data: { path: backupPath, size: stats.size } });
  } catch (err) {
    console.error('Backup RUN Error:', err);
    err.status = 500;
    err.message = 'خطأ في إنشاء النسخة الاحتياطية: ' + err.message;
    throw err;
  }
}));

// ─── GET /api/settings/health - system health ───
router.get('/health', asyncHandler(async (req, res) => {
  try {
    const pool = await getPool();
    const dbCheck = await pool.request().query('SELECT 1 AS ok');
    const dbOk = dbCheck.recordset.length > 0;

    // DB size
    let dbSize = 'N/A';
    try {
      const sizeRes = await pool.request().query(`
        SELECT CAST(SUM(size * 8 / 1024) AS NVARCHAR) + ' MB' AS db_size
        FROM sys.database_files
      `);
      dbSize = sizeRes.recordset[0]?.db_size || 'N/A';
    } catch (e) { /* not accessible on all SQL Server configs */ }

    // Settings count
    const settingsCount = await pool.request().query('SELECT COUNT(*) AS cnt FROM settings');
    // User count
    const userCount = await pool.request().query('SELECT COUNT(*) AS cnt FROM users');

    // Disk space
    let diskFree = 'N/A';
    try {
      const drive = path.parse(process.cwd()).root;
      diskFree = Math.floor(os.freemem() / 1024 / 1024) + ' MB free';
    } catch (e) {}

    const pkg = require('../package.json');

    res.json({
      success: true,
      data: {
        database: { status: dbOk ? 'Connected' : 'Disconnected', size: dbSize },
        server: { uptime: Math.floor(process.uptime()), node: process.version, platform: process.platform },
        app: { version: pkg.version || '1.0.0', name: pkg.name || 'TradePro ERP' },
        storage: { memory: diskFree, settings: settingsCount.recordset[0]?.cnt || 0, users: userCount.recordset[0]?.cnt || 0 }
      }
    });
  } catch (err) {
    console.error('Health Error:', err);
    err.status = 500;
    err.message = 'خطأ';
    throw err;
  }
}));

module.exports = router;
