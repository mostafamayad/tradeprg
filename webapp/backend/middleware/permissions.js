const parsePermissions = require('../utils/parsePermissions');

const LEGACY_MAPPING = {
    'dashboard': ['dashboard.view'],
    'sales-invoices': ['sales.view', 'sales.create', 'sales.update', 'sales.delete'],
    'sales-returns': ['sales_returns.view', 'sales_returns.create', 'sales_returns.update', 'sales_returns.delete'],
    'customers': ['customers.view', 'customers.create', 'customers.update', 'customers.delete', 'customers.export', 'customers.block'],
    'customers-list': ['customers.view', 'customers.create', 'customers.update', 'customers.delete', 'customers.export', 'customers.block'],
    'customer-payments': ['collections.view', 'collections.create', 'collections.update', 'collections.delete'],
    'purchase-invoices': ['purchases.view', 'purchases.create', 'purchases.update', 'purchases.delete'],
    'purchase-returns': ['purchase_returns.view', 'purchase_returns.create', 'purchase_returns.update', 'purchase_returns.delete'],
    'suppliers-list': ['suppliers.view', 'suppliers.create', 'suppliers.update', 'suppliers.delete'],
    'supplier-payments': ['payments.view', 'payments.create', 'payments.update', 'payments.delete'],
    'inventory-list': ['inventory.view', 'inventory.create', 'inventory.update', 'inventory.delete', 'products.view', 'products.create', 'products.update', 'products.delete'],
    'inventory-transfers': ['inventory.view', 'inventory.create', 'inventory.update', 'inventory.delete'],
    'stores-management': ['stores.view', 'stores.create', 'stores.update', 'stores.delete'],
    'settings': ['settings.view', 'settings.create', 'settings.update', 'settings.delete',
                 'users.view', 'users.create', 'users.update', 'users.delete',
                 'stores.view', 'stores.create', 'stores.update', 'stores.delete',
                 'reps.view', 'reps.create', 'reps.update', 'reps.delete',
                 'reports.view', 'logs.view', 'treasury.view', 'treasury.create', 'treasury.update', 'treasury.delete']
};

function requirePermission(permission) {
    return checkPermission(permission);
}

function checkPermission(requiredPermission) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ success: false, message: 'غير مصرح' });
        }

        if (req.user.is_super_admin) {
            return next();
        }

        if (req.user.role === 'admin') {
            return next();
        }

        const perms = parsePermissions(req.user.permissions);

        if (perms.includes('*')) {
            return next();
        }

        if (perms.includes(requiredPermission)) {
            return next();
        }

        let hasLegacyAccess = false;
        for (const [legacyKey, granularPerms] of Object.entries(LEGACY_MAPPING)) {
            if (perms.includes(legacyKey) && granularPerms.includes(requiredPermission)) {
                hasLegacyAccess = true;
                break;
            }
        }

        if (hasLegacyAccess) {
            return next();
        }

        return res.status(403).json({ success: false, message: 'ليس لديك صلاحية لإجراء هذه العملية' });
    };
}

function userHasPermission(req, permission) {
    if (!req.user) return false;
    if (req.user.is_super_admin) return true;
    if (req.user.role === 'admin') return true;
    const perms = parsePermissions(req.user.permissions);
    if (perms.includes('*')) return true;
    for (const [legacyKey, granularPerms] of Object.entries(LEGACY_MAPPING)) {
        if (perms.includes(legacyKey) && granularPerms.includes(permission)) return true;
    }
    return perms.includes(permission);
}

module.exports = checkPermission;
module.exports.requirePermission = requirePermission;
module.exports.userHasPermission = userHasPermission;
