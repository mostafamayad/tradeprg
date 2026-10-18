/**
 * Recursively sanitizes user input to prevent XSS and clean whitespace.
 */
function sanitizeString(str) {
    if (typeof str !== 'string') return str;
    let clean = str.trim();
    clean = clean.replace(/\0/g, '');
    clean = clean.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    clean = clean.replace(/javascript:[^"']*/gi, '');
    clean = clean.replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');
    clean = clean.replace(/on\w+\s*=\s*[^>\s]+/gi, '');
    return clean;
}

function sanitizeObject(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) {
        return obj.map(item => sanitizeObject(item));
    }
    const cleanObj = {};
    for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string') {
            cleanObj[key] = sanitizeString(value);
        } else if (typeof value === 'object' && value !== null) {
            cleanObj[key] = sanitizeObject(value);
        } else {
            cleanObj[key] = value;
        }
    }
    return cleanObj;
}

module.exports = function sanitizeInput(req, res, next) {
    if (req.body && typeof req.body === 'object') {
        req.body = sanitizeObject(req.body);
    }
    if (req.query && typeof req.query === 'object') {
        req.query = sanitizeObject(req.query);
    }
    if (req.params && typeof req.params === 'object') {
        req.params = sanitizeObject(req.params);
    }
    next();
};
