/**
 * يحوّل صيغة الصلاحيات من JSON string أو Array إلى Array نظيفة
 * @param {string|Array} raw - الصلاحيات من قاعدة البيانات أو الـ JWT
 * @returns {string[]}
 */
function parsePermissions(raw) {
    if (!raw) return [];
    try {
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
        return [];
    }
}

module.exports = parsePermissions;