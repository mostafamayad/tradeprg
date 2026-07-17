const { LicenseState } = require('../services/license/licenseValidators');
const logActivity = require('./logger');

const BYPASS_PATHS = ['/api/auth', '/api/license', '/api/company/info', '/api/time'];

function licenseEnforcer(req, res, next) {
    if (BYPASS_PATHS.some(p => req.path === p || req.path.startsWith(p + '/'))) {
        return next();
    }

    const lm = req.app.licenseManager;
    if (!lm) return next();

    lm._ensureCacheValid();
    const state = lm.getLicenseState();
    const info = lm.getLicenseInfo();

    req.license = {
        state,
        edition: lm.getEdition(),
        licenseInfo: info,
        isModuleEnabled: (m) => lm.isModuleEnabled(m),
        isFeatureEnabled: (f) => lm.isFeatureEnabled(f)
    };

    switch (state) {
        case LicenseState.ACTIVE:
            return next();
        case LicenseState.GRACE_PERIOD: {
            const remaining = info && info.graceDays ? info.graceDays : 0;
            res.set('X-License-Warning', String(remaining));
            return next();
        }
        case LicenseState.CLOCK_WARNING:
            res.set('X-License-Warning', 'clock_warning');
            return next();
        case LicenseState.UNACTIVATED:
            logActivity(req, 'ENFORCER', 'license', null, 'License enforcer blocked: UNACTIVATED', null, null, 'FAILED', 'Route: ' + req.path);
            return res.status(402).json({
                success: false,
                license_state: 'UNACTIVATED',
                hardware_id: null,
                message: 'الرخصة غير مفعلة. يرجى تفعيل النظام.',
                code: 'LICENSE_UNACTIVATED'
            });
        case LicenseState.EXPIRED:
            logActivity(req, 'ENFORCER', 'license', null, 'License enforcer blocked: EXPIRED', null, null, 'FAILED', 'Route: ' + req.path);
            return res.status(403).json({
                success: false,
                license_state: 'EXPIRED',
                hardware_id: null,
                message: 'رخصة النظام منتهية الصلاحية',
                code: 'LICENSE_EXPIRED'
            });
        case LicenseState.INVALID:
            logActivity(req, 'ENFORCER', 'license', null, 'License enforcer blocked: INVALID', null, null, 'FAILED', 'Route: ' + req.path);
            return res.status(403).json({
                success: false,
                license_state: 'INVALID',
                hardware_id: null,
                message: 'رخصة النظام غير صالحة',
                code: 'LICENSE_INVALID'
            });
        case LicenseState.TAMPERED:
            logActivity(req, 'ENFORCER', 'license', null, 'License enforcer blocked: TAMPERED', null, null, 'FAILED', 'Route: ' + req.path);
            return res.status(403).json({
                success: false,
                license_state: 'TAMPERED',
                hardware_id: null,
                message: 'تم العبث بملف الرخصة',
                code: 'LICENSE_TAMPERED'
            });
        default:
            return next();
    }
}

module.exports = licenseEnforcer;
