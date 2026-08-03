const express = require('express');
const router = express.Router();
const { getPool } = require('../database/mssql_db');
const AccountingValidator = require('../services/accountingValidator');
const asyncHandler = require('../utils/asyncHandler');

// Middleware to ensure user is logged in
const authenticate = require('../middleware/auth');

/**
 * POST /api/system/integrity-check
 * Runs a deep accounting validation and cross-checks financials.
 */
router.post('/integrity-check', authenticate, asyncHandler(async (req, res) => {
    if (!['super_admin', 'admin'].includes(req.user.role)) {
        return res.status(403).json({ success: false, message: 'Forbidden: Requires admin role' });
    }
    const pool = await getPool();
    const validator = new AccountingValidator(pool);
    
    // Log initiation
    console.log('[SYSTEM] Integrity Check started by user:', req.user.id);
    
    const results = await validator.runFullIntegrityCheck();
    
    if (!results.success) {
        console.error('[SYSTEM] CRITICAL: Integrity Check Failed!', JSON.stringify(results.checks, null, 2));
        // You could also write this to an audit_log table or external monitoring
    } else {
        console.log('[SYSTEM] Integrity Check Passed. GL is perfectly balanced.');
    }

    res.json({
        success: true,
        message: results.success ? 'System Integrity Verified' : 'System Integrity Check Failed (See logs)',
        data: results
    });
}));

module.exports = router;
