const logActivity = require('./logger');

const EXCLUDED_PATHS = ['/logs', '/login', '/logout'];

function autoLogger(req, res, next) {
    if (req.method === 'GET' || req.method === 'OPTIONS') return next();
    if (EXCLUDED_PATHS.some(p => req.path.includes(p))) return next();

    const authPath = req.path.startsWith('/auth/');
    if (authPath) return next();

    // Capture module and entityId BEFORE next(), while req.path still has the
    // full mount prefix.  Sub-routers (products, reps, users, …) strip their
    // prefix from req.path, so reading it at res.json time gives the wrong
    // segment (e.g. "15" instead of "reps").
    const segments = req.path.split('/').filter(Boolean);
    const module = segments[0] || 'system';
    const entityId = segments[1] || '';

    const originalJson = res.json.bind(res);
    res.json = function (data) {
        if (data && data.success !== false) {
            let operation = 'UPDATE';
            if (req.method === 'POST') operation = 'CREATE';
            if (req.method === 'DELETE') operation = 'DELETE';
            if (req.method === 'PATCH') operation = 'UPDATE';

            let affectedRecord = data.message || `Operation on ${module}`;
            let newValues = null;
            if (req.body && Object.keys(req.body).length > 0) {
                const safeBody = { ...req.body };
                delete safeBody.password;
                delete safeBody.old_password;
                delete safeBody.new_password;
                delete safeBody.token;
                if (Object.keys(safeBody).length) newValues = safeBody;
            }

            logActivity(req, operation, module, entityId, affectedRecord, null, newValues, 'SUCCESS', null);
        }
        return originalJson(data);
    };
    next();
}

module.exports = autoLogger;
