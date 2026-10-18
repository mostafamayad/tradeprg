// ─── Public Registration & Packages Routes ────────────────────────────────
// Mounted BEFORE authenticate middleware, no auth required.

const express = require('express');
const router = express.Router();
const { getPool, sql } = require('../database/mssql_db');
const { verifyCaptcha } = require('../utils/captcha');

// GET /api/packages - Return active subscription packages
router.get('/packages', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT id, name, description, price, period, features, sort_order
            FROM subscription_packages WHERE is_active = 1 ORDER BY sort_order ASC
        `);
        const packages = result.recordset.map(p => ({
            ...p,
            features: (() => { try { return JSON.parse(p.features); } catch { return []; } })()
        }));
        res.json({ success: true, data: packages });
    } catch (err) {
        console.error('[Packages] Error:', err.message);
        res.json({ success: true, data: [
            { id: 1, name: 'أساسي',   price: 299,  period: 'شهري', description: 'مناسب للشركات الصغيرة', features: ['المبيعات والمشتريات','إدارة المخزون','مستخدم واحد','دعم واتساب'] },
            { id: 2, name: 'احترافي', price: 599,  period: 'شهري', description: 'للشركات المتوسطة',      features: ['كل ميزات الأساسي','الموارد البشرية','CRM','5 مستخدمين'] },
            { id: 3, name: 'مؤسسي',  price: 1299, period: 'شهري', description: 'للشركات الكبيرة',       features: ['كل الميزات','مستخدمون غير محدودون','دعم مخصص','تحليلات متقدمة'] }
        ]});
    }
});

// POST /api/register - Save registration request
router.post('/register', async (req, res) => {
    try {
        const { full_name, email, phone, company_name, package_id, package_name, captcha_token, captcha_answer } = req.body;
        if (!full_name || !email) {
            return res.status(400).json({ success: false, message: 'الاسم والبريد الإلكتروني مطلوبان' });
        }

        if (captcha_token !== undefined || captcha_answer !== undefined) {
            if (!captcha_token || !captcha_answer || !verifyCaptcha(captcha_token, captcha_answer)) {
                return res.status(400).json({ success: false, message: 'رمز التحقق (CAPTCHA) غير صحيح أو انتهت صلاحيته' });
            }
        }

        const emailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ success: false, message: 'البريد الإلكتروني غير صحيح' });
        }

        const ip = req.ip || req.connection?.remoteAddress || '';
        const pool = await getPool();

        // Check for duplicate email (pending or activated)
        const existing = await pool.request()
            .input('email', sql.NVarChar(300), email.trim().toLowerCase())
            .query("SELECT id FROM registration_requests WHERE email = @email AND status IN ('pending','activated')");

        if (existing.recordset.length > 0) {
            return res.status(409).json({ success: false, message: 'هذا البريد الإلكتروني مسجل بالفعل. يمكنك متابعة الجولة واختيار الباقة.' });
        }

        await pool.request()
            .input('full_name',    sql.NVarChar(200), full_name.trim())
            .input('email',        sql.NVarChar(300), email.trim().toLowerCase())
            .input('phone',        sql.NVarChar(50),  phone || null)
            .input('company_name', sql.NVarChar(300), company_name || null)
            .input('package_id',   sql.Int,           package_id || null)
            .input('package_name', sql.NVarChar(100), package_name || null)
            .input('ip_address',   sql.NVarChar(50),  ip.substring(0, 50))
            .query(`
                INSERT INTO registration_requests
                    (full_name, email, phone, company_name, package_id, package_name, ip_address)
                VALUES
                    (@full_name, @email, @phone, @company_name, @package_id, @package_name, @ip_address)
            `);

        res.json({ success: true, message: 'تم تسجيل طلبك بنجاح!' });
    } catch (err) {
        console.error('[Register] Error:', err.message);
        res.status(500).json({ success: false, message: 'حدث خطأ أثناء الحفظ، يرجى المحاولة مرة أخرى.' });
    }
});

module.exports = router;
