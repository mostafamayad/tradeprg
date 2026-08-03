const express = require('express');
const jwt = require('jsonwebtoken');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const logActivity = require('../middleware/logger');
const { encrypt } = require('../utils/encryption');
const { getPool, sql } = require('../database/mssql_db');
const router = express.Router();

const RATE_LIMIT_FILE = path.join(__dirname, '..', 'storage', '.rate_limit_store');
const MAX_ATTEMPTS = parseInt(process.env.LICENSE_ACTIVATION_LIMIT, 10) || 5;
const WINDOW_HOURS = parseFloat(process.env.LICENSE_ACTIVATION_WINDOW_HOURS) || 1;

function loadRateLimitStore() {
    try {
        if (fs.existsSync(RATE_LIMIT_FILE)) {
            const data = JSON.parse(fs.readFileSync(RATE_LIMIT_FILE, 'utf8'));
            const now = Date.now();
            const windowMs = WINDOW_HOURS * 60 * 60 * 1000;
            const cleaned = {};
            for (const [ip, timestamps] of Object.entries(data)) {
                const valid = timestamps.filter(t => now - t < windowMs);
                if (valid.length > 0) cleaned[ip] = valid;
            }
            return cleaned;
        }
    } catch (e) {}
    return {};
}

function saveRateLimitStore(store) {
    try {
        const dir = path.dirname(RATE_LIMIT_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const tmp = RATE_LIMIT_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(store), 'utf8');
        fs.renameSync(tmp, RATE_LIMIT_FILE);
    } catch (e) {}
}

const _rateStore = loadRateLimitStore();

function rateLimitActivation(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowMs = WINDOW_HOURS * 60 * 60 * 1000;
    if (!_rateStore[ip]) _rateStore[ip] = [];
    const valid = _rateStore[ip].filter(t => now - t < windowMs);
    valid.push(now);
    _rateStore[ip] = valid;
    saveRateLimitStore(_rateStore);
    if (valid.length > MAX_ATTEMPTS) {
        logActivity(req, 'RATE_LIMIT', 'license', null, 'Rate limit exceeded for activation', null, null, 'FAILED', 'Exceeded ' + MAX_ATTEMPTS + ' attempts/' + WINDOW_HOURS + 'h from IP ' + ip);
        return res.status(429).json({ success: false, message: 'محاولات تفعيل كثيرة. الرجاء الانتظار ساعة.' });
    }
    next();
}

function verifyAdmin(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(403).json({ success: false, message: 'غير مصرح' });
    try {
        const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
        if (decoded.role !== 'admin' && decoded.id !== 1) return res.status(403).json({ success: false, message: 'غير مصرح' });
        req.user = decoded;
        next();
    } catch (e) {
        return res.status(403).json({ success: false, message: 'غير مصرح' });
    }
}

router.get('/status', (req, res) => {
    const lm = req.app.licenseManager;
    const state = lm.getLicenseState();
    const info = lm.getLicenseInfo();
    const buildProfile = lm._config ? lm._config.buildProfile : (process.env.BUILD_PROFILE || 'production');
    const hwFingerprint = typeof lm.getHardwareFingerprint === 'function' ? lm.getHardwareFingerprint() : null;
    const cust = info ? info.customer : null;
    const data = {
        state,
        edition: lm.getEdition(),
        license_id: info ? info.licenseId : null,
        customer: cust,
        customer_name: cust ? (cust.name || cust.contactName || '') : '',
        company_name: cust ? (cust.company || cust.organization || '') : '',
        erp_version_range: info ? info.erpVersionRange : null,
        activation_date: info ? info.activationDate : null,
        expiration: info ? info.expirationDate : null,
        grace_remaining: info ? info.graceDays : 0,
        hardware_id: hwFingerprint,
        modules: info ? info.enabledModules : [],
        disabled_modules: info && info.disabledModules ? info.disabledModules : [],
        features: info && info.featureFlags ? Object.keys(info.featureFlags).filter(k => info.featureFlags[k]) : [],
        feature_flags: info ? info.featureFlags : {},
        build_profile: buildProfile,
        last_validation_time: lm.getLastValidationTime ? new Date(lm.getLastValidationTime()).toISOString() : null,
        license_file_size: lm.getLicenseFileSize ? lm.getLicenseFileSize() : null,
        is_developer: info ? info.isDeveloper : false,
        key_id: info ? info.keyId : null,
        verified_by_key: info ? info.verifiedByKey : null,
        is_revoked: info ? info.isRevoked : false
    };
    res.json({ success: true, data });
});

router.post('/activate', rateLimitActivation, async (req, res) => {
    try {
        const buf = req.body && req.body.license ? Buffer.from(req.body.license, 'base64') : null;
        if (!buf) {
            logActivity(req, 'ACTIVATE', 'license', null, 'Activation failed: missing file', null, null, 'FAILED', 'Missing license file');
            return res.status(400).json({ success: false, message: 'ملف الترخيص مطلوب' });
        }
        const result = await req.app.licenseManager.activate(buf);
        if (result.success) {
            const info = result.info || {};
            const licenseStr = req.body.license;
            const hwFp = typeof req.app.licenseManager.getHardwareFingerprint === 'function' ? req.app.licenseManager.getHardwareFingerprint() : null;
            try {
                const pool = await getPool();
                const existing = await pool.request().query("SELECT COUNT(*) AS cnt FROM system_info");
                if (existing.recordset[0].cnt > 0) {
                    await pool.request()
                        .input('encrypted_license', sql.NVarChar(sql.MAX), encrypt(licenseStr))
                        .input('machine_fingerprint_hash', sql.NVarChar(128), hwFp ? require('crypto').createHash('sha256').update(hwFp).digest('hex') : null)
                        .input('edition', sql.NVarChar(50), info.edition || result.edition)
                        .input('max_users', sql.Int, info.enabledModules ? (info.edition === 'enterprise' ? 100 : info.edition === 'professional' ? 25 : 10) : 10)
                        .query("UPDATE system_info SET license_code = @edition, encrypted_license = @encrypted_license, machine_fingerprint_hash = @machine_fingerprint_hash, updated_at = GETDATE()");
                }
            } catch (dbErr) {
                console.error('[License] Failed to save to system_info:', dbErr.message);
            }
            logActivity(req, 'ACTIVATE', 'license', null, 'License activated: ' + result.state, null, { state: result.state, edition: result.edition }, 'SUCCESS', null);
            res.json({ success: true, data: { state: result.state, edition: result.edition } });
        } else {
            logActivity(req, 'ACTIVATE', 'license', null, 'Activation failed', null, null, 'FAILED', result.reason);
            res.status(400).json({ success: false, message: result.reason || 'فشل التفعيل' });
        }
    } catch (e) {
        logActivity(req, 'ACTIVATE', 'license', null, 'Activation error', null, null, 'FAILED', e.message);
        res.status(500).json({ success: false, message: 'خطأ في تفعيل الرخصة' });
    }
});

router.get('/health', verifyAdmin, (req, res) => {
    const health = req.app.licenseManager.getHealth();
    res.json({ success: true, data: health });
});

router.post('/self-test', verifyAdmin, async (req, res) => {
    const result = await req.app.licenseManager.selfTest();
    res.json({ success: true, data: result });
});

router.get('/hardware', verifyAdmin, (req, res) => {
    try {
        const lm = req.app.licenseManager;
        let info;
        if (typeof lm.getHardwareInfo === 'function') {
            info = lm.getHardwareInfo();
        } else {
            info = { computerName: os.hostname(), platform: os.platform(), release: os.release(), arch: os.arch(), totalMem: os.totalmem(), freeMem: os.freemem() };
            try { const cpus = os.cpus(); if (cpus.length > 0) info.cpu = cpus[0].model.trim(); } catch (e) { info.cpu = '-'; }
            try {
                const ps = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_ComputerSystemProduct | Select-Object -ExpandProperty UUID"', { encoding: 'utf8', timeout: 5000 }).trim();
                info.machineGuid = ps || '-';
            } catch (e) { info.machineGuid = '-'; }
            try {
                const mb = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_BaseBoard | ForEach-Object { $_.Manufacturer+\' \'+$_.Product }"', { encoding: 'utf8', timeout: 5000 }).trim();
                const lines = mb.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('-') && !l.startsWith('Product'));
                info.motherboard = lines[0] || mb || '-';
            } catch (e) { info.motherboard = '-'; }
            try {
                const disk = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_DiskDrive | Select-Object -First 1 -ExpandProperty Model"', { encoding: 'utf8', timeout: 5000 }).trim();
                info.diskModel = disk || '-';
            } catch (e) { info.diskModel = '-'; }
            try {
                const diskSerial = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_DiskDrive | Select-Object -First 1 -ExpandProperty SerialNumber"', { encoding: 'utf8', timeout: 5000 }).trim();
                info.diskSerial = diskSerial || '-';
            } catch (e) { info.diskSerial = '-'; }
            try {
                const bios = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_BIOS | ForEach-Object { $_.Manufacturer+\' \'+$_.SMBIOSBIOSVersion }"', { encoding: 'utf8', timeout: 5000 }).trim();
                info.bios = bios || '-';
            } catch (e) { info.bios = '-'; }
            try {
                const winVer = execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).Caption"', { encoding: 'utf8', timeout: 5000 }).trim();
                info.osVersion = winVer || os.platform() + ' ' + os.release();
            } catch (e) { info.osVersion = os.platform() + ' ' + os.release(); }
            info.osBits = os.arch();
        }
        if (info && !info.hardwareFingerprint && !info.fingerprint) {
            try {
                const health = lm.getHealth();
                info.hardwareFingerprint = (health && health.sections && health.sections.hardware && health.sections.hardware.details) ? health.sections.hardware.details.fingerprint : '-';
            } catch (e) { info.hardwareFingerprint = '-'; }
        }
        if (info && info.confidenceScore === undefined) {
            try {
                if (typeof lm.computeHardwareConfidence === 'function') {
                    info.confidenceScore = lm.computeHardwareConfidence();
                }
            } catch (e) { info.confidenceScore = null; }
        }
        res.json({ success: true, data: info });
    } catch (e) {
        res.status(500).json({ success: false, message: 'فشل جمع معلومات الجهاز' });
    }
});

router.get('/hardware/change-detection', verifyAdmin, (req, res) => {
    try {
        const lm = req.app.licenseManager;
        const result = typeof lm.getHardwareChangeStatus === 'function' ? lm.getHardwareChangeStatus() : { error: 'Not available' };
        res.json({ success: true, data: result });
    } catch (e) {
        res.status(500).json({ success: false, message: 'فشل فحص تغييرات الجهاز' });
    }
});

router.post('/hardware/refresh', verifyAdmin, (req, res) => {
    try {
        const lm = req.app.licenseManager;
        const result = typeof lm.refreshHardware === 'function' ? lm.refreshHardware() : null;
        res.json({ success: true, data: { collected: !!result, fingerprint: result ? result.fingerprint : null, componentCount: result ? result.componentCount : 0 } });
    } catch (e) {
        res.status(500).json({ success: false, message: 'فشل تحديث معلومات الجهاز' });
    }
});

router.get('/hardware/clock-status', verifyAdmin, (req, res) => {
    try {
        const lm = req.app.licenseManager;
        const result = typeof lm.getClockStatus === 'function' ? lm.getClockStatus() : { error: 'Not available' };
        res.json({ success: true, data: result });
    } catch (e) {
        res.status(500).json({ success: false, message: 'فشل فحص حالة الساعة' });
    }
});

router.post('/revalidate', verifyAdmin, (req, res) => {
    try {
        const lm = req.app.licenseManager;
        lm.forceRevalidate();
        const state = lm.getLicenseState();
        res.json({ success: true, data: { state } });
    } catch (e) {
        res.status(500).json({ success: false, message: 'فشل إعادة التحقق' });
    }
});

router.get('/diagnostics', verifyAdmin, (req, res) => {
    try {
        const lm = req.app.licenseManager;
        const result = lm.runDiagnostics ? lm.runDiagnostics() : { error: 'Diagnostics not available' };
        res.json({ success: true, data: result });
    } catch (e) {
        res.status(500).json({ success: false, message: 'فشل التشخيص' });
    }
});

router.get('/history', verifyAdmin, async (req, res) => {
    try {
        const lm = req.app.licenseManager;
        const info = lm.getLicenseInfo();
        const state = lm.getLicenseState();
        const history = {
            activation_date: info ? info.activationDate : null,
            last_validation: lm.getLastValidationTime ? new Date(lm.getLastValidationTime()).toISOString() : null,
            last_self_test: null,
            validation_count: lm.getValidationCount ? lm.getValidationCount() : 0,
            activated_by: null,
            last_upgrade: null
        };
        try {
            const sql = req.app.mssql || require('mssql');
            const pool = req.app.dbPool || global.dbPool;
            if (pool) {
                const result = await pool.request()
                    .query("SELECT TOP 20 created_at, user_name, operation, details, status FROM audit_log WHERE module='license' ORDER BY created_at DESC");
                if (result.recordset) {
                    history.events = result.recordset.map(r => ({
                        time: r.created_at,
                        user: r.user_name,
                        operation: r.operation,
                        details: r.details,
                        status: r.status
                    }));
                }
                const actResult = await pool.request()
                    .query("SELECT TOP 1 created_at, user_name FROM audit_log WHERE module='license' AND operation='ACTIVATE' AND status='SUCCESS' ORDER BY created_at ASC");
                if (actResult.recordset && actResult.recordset.length > 0) {
                    history.activated_by = actResult.recordset[0].user_name;
                    history.activation_date = actResult.recordset[0].created_at;
                }
                const valResult = await pool.request()
                    .query("SELECT COUNT(*) AS cnt FROM audit_log WHERE module='license' AND operation='VALIDATION'");
                if (valResult.recordset && valResult.recordset.length > 0) {
                    history.validation_count = valResult.recordset[0].cnt;
                }
            }
        } catch (dbErr) {
            history.db_error = 'Could not query audit log';
        }
        res.json({ success: true, data: history });
    } catch (e) {
        res.status(500).json({ success: false, message: 'فشل تحميل تاريخ التفعيل' });
    }
});

router.get('/revocation-status', verifyAdmin, (req, res) => {
    try {
        const lm = req.app.licenseManager;
        const result = typeof lm.getRevocationStatus === 'function' ? lm.getRevocationStatus() : { enabled: false, error: 'Not available' };
        res.json({ success: true, data: result });
    } catch (e) {
        res.status(500).json({ success: false, message: 'فشل تحميل حالة الإلغاء' });
    }
});

router.post('/revocation-list/upload', verifyAdmin, (req, res) => {
    try {
        const lm = req.app.licenseManager;
        const b64 = req.body && req.body.revocationList;
        if (!b64) return res.status(400).json({ success: false, message: 'ملف الإلغاء مطلوب' });
        const buf = Buffer.from(b64, 'base64');
        const parsed = JSON.parse(buf.toString('utf8'));
        const { verifyRevocationList } = require('../services/license/licenseCrypto');
        const tmpPath = lm._config.revocationListPath + '.tmp';
        const targetPath = lm._config.revocationListPath;
        require('fs').writeFileSync(tmpPath, buf);
        const check = verifyRevocationList(tmpPath);
        if (!check.valid) {
            require('fs').unlinkSync(tmpPath);
            return res.status(400).json({ success: false, message: 'توقيع قائمة الإلغاء غير صالح' });
        }
        require('fs').renameSync(tmpPath, targetPath);
        if (typeof lm.reloadRevocationList === 'function') lm.reloadRevocationList();
        require('../middleware/logger')(req, 'REVOCATION_LIST', 'license', null, 'Revocation list uploaded', null, { revokedCount: parsed.revoked_licenses ? parsed.revoked_licenses.length : 0 }, 'SUCCESS', null);
        res.json({ success: true, data: { revokedCount: parsed.revoked_licenses ? parsed.revoked_licenses.length : 0, issuedAt: parsed.issued_at } });
    } catch (e) {
        res.status(500).json({ success: false, message: 'فشل رفع قائمة الإلغاء' });
    }
});

router.get('/export-diagnostic', verifyAdmin, (req, res) => {
    try {
        const lm = req.app.licenseManager;
        const info = lm.getLicenseInfo();
        const state = lm.getLicenseState();
        const health = lm.getHealth();
        const diagnostics = lm.runDiagnostics ? lm.runDiagnostics() : {};
        const buildProfile = lm._config ? lm._config.buildProfile : 'production';

        const pkg = {
            exportedAt: new Date().toISOString(),
            environment: {
                nodeVersion: process.version,
                platform: process.platform,
                arch: process.arch,
                hostname: os.hostname(),
                buildProfile
            },
            licenseInformation: {
                state,
                edition: lm.getEdition(),
                licenseId: info ? info.licenseId : null,
                customer: info ? info.customer : null,
                erpVersionRange: info ? info.erpVersionRange : null,
                activationDate: info ? info.activationDate : null,
                expirationDate: info ? info.expirationDate : null,
                graceDays: info ? info.graceDays : 0,
                enabledModules: info ? info.enabledModules : [],
                disabledModules: info ? info.disabledModules : [],
                featureFlags: info ? info.featureFlags : {},
                isDeveloper: info ? info.isDeveloper : false
            },
            machineInformation: typeof lm.getHardwareInfo === 'function' ? lm.getHardwareInfo() : {
                computerName: os.hostname(),
                platform: os.platform(),
                release: os.release(),
                arch: os.arch(),
                totalMem: os.totalmem(),
                freeMem: os.freemem()
            },
            hardwareChangeStatus: typeof lm.getHardwareChangeStatus === 'function' ? lm.getHardwareChangeStatus() : null,
            clockStatus: typeof lm.getClockStatus === 'function' ? lm.getClockStatus() : null,
            healthReport: health.sections || health,
            diagnosticReport: diagnostics,
            validationResults: {
                lastValidationTime: lm.getLastValidationTime ? new Date(lm.getLastValidationTime()).toISOString() : null,
                selfTestResults: null
            }
        };
        res.json({ success: true, data: pkg });
    } catch (e) {
        res.status(500).json({ success: false, message: 'فشل تصدير التشخيص' });
    }
});

if (process.env.BUILD_PROFILE === 'development') {
    router.post('/reset-rate-limit', verifyAdmin, (req, res) => {
        Object.keys(_rateStore).forEach(k => delete _rateStore[k]);
        try { fs.unlinkSync(RATE_LIMIT_FILE); } catch (e) {}
        res.json({ success: true, message: 'تم إعادة تعيين حد المحاولات' });
    });
}

module.exports = router;
