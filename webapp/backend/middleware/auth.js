const jwt = require('jsonwebtoken');

function authenticate(req, res, next) {
    const publicPaths = ['/auth/login', '/time'];
    if (publicPaths.some(p => req.path === p || req.path.startsWith(p + '/'))) {
        return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'غير مصرح - الرجاء تسجيل الدخول' });
    }

    const token = authHeader.split(' ')[1];
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        const lm = req.app.licenseManager;
        if (lm) lm._ensureCacheValid();
        req.license = lm ? {
            state: lm.getLicenseState(),
            edition: lm.getEdition(),
            licenseInfo: lm.getLicenseInfo(),
            isModuleEnabled: (m) => lm.isModuleEnabled(m),
            isFeatureEnabled: (f) => lm.isFeatureEnabled(f)
        } : {};
        next();
    } catch (err) {
        return res.status(401).json({ success: false, message: 'انتهت صلاحية الجلسة أو الرمز غير صالح' });
    }
}

module.exports = authenticate;
