const router = require('express').Router();
const { sql, getPool } = require('../database/mssql_db');

// Auto-create notifications table on first use (self-healing)
async function ensureTable(pool) {
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name='notifications' AND xtype='U')
    BEGIN
      CREATE TABLE notifications (
        id INT IDENTITY(1,1) PRIMARY KEY,
        user_id INT NULL,
        title NVARCHAR(255) NOT NULL,
        message NVARCHAR(MAX) NULL,
        type NVARCHAR(50) DEFAULT 'info',
        module NVARCHAR(100) NULL,
        reference_id INT NULL,
        reference_no NVARCHAR(255) NULL,
        is_read INT DEFAULT 0,
        created_at NVARCHAR(50) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120)
      );
      CREATE INDEX IX_notifications_user_id ON notifications(user_id);
      INSERT INTO notifications (user_id, title, message, type) VALUES
        (NULL, N'مرحباً بك في نظام 3SM', N'تم تفعيل حسابك بنجاح. يمكنك الآن البدء في استخدام النظام.', 'success'),
        (NULL, N'نسخة احتياطية', N'يوصى بعمل نسخة احتياطية أسبوعياً لضمان سلامة بياناتك.', 'warning');
    END
  `);
}

// GET /api/notifications
router.get('/', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTable(pool);
    const userId = req.user?.id || 0;
    const result = await pool.request()
      .input('user_id', sql.Int, userId)
      .query(`
        SELECT id, title, message, type, module, reference_id, reference_no, is_read, created_at
        FROM notifications
        WHERE user_id = @user_id OR user_id IS NULL OR user_id = 0
        ORDER BY created_at DESC
      `);
    const unread = result.recordset.filter(n => !n.is_read).length;
    return res.json({ success: true, data: result.recordset, unread });
  } catch (e) {
    console.error('[Notifications GET]', e.message);
    return res.json({ success: true, data: [], unread: 0 });
  }
});

// POST /api/notifications/:id/read
router.post('/:id/read', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTable(pool);
    await pool.request()
      .input('id', sql.Int, req.params.id)
      .query("UPDATE notifications SET is_read = 1 WHERE id = @id AND is_read = 0");
    res.json({ success: true });
  } catch (e) {
    console.error('[Notifications Read]', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /api/notifications/read-all
router.post('/read-all', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTable(pool);
    const userId = req.user?.id || 0;
    await pool.request()
      .input('user_id', sql.Int, userId)
      .query("UPDATE notifications SET is_read = 1 WHERE (user_id = @user_id OR user_id IS NULL OR user_id = 0) AND is_read = 0");
    res.json({ success: true });
  } catch (e) {
    console.error('[Notifications ReadAll]', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
