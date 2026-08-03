const router = require('express').Router();
const repo = require('../repositories/commissionRepository');
const commission = require('../services/commission/index');
const asyncHandler = require('../utils/asyncHandler');

// ─── Transactions ───────────────────────────────────────────
router.get('/transactions', asyncHandler(async (req, res) => {
    const { period, rep_id } = req.query;
    let data;
    if (rep_id) {
        data = await repo.getTransactionsByRep(parseInt(rep_id), period || null);
    } else if (period) {
        data = await repo.getTransactionsByPeriod(period);
    } else {
        const now = new Date();
        const currentPeriod = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
        data = await repo.getTransactionsByPeriod(currentPeriod);
    }
    res.json({ success: true, data });
}));

router.get('/transactions/:id', asyncHandler(async (req, res) => {
    const tx = await repo.getTransactionById(req.params.id);
    if (!tx) return res.status(404).json({ success: false, message: 'Transaction not found' });
    res.json({ success: true, data: tx });
}));

router.get('/transactions/:id/audit', asyncHandler(async (req, res) => {
    const logs = await repo.getAuditLog('commission_transaction', req.params.id);
    res.json({ success: true, data: logs });
}));

// ─── Review ─────────────────────────────────────────────────
router.post('/transactions/:id/review', asyncHandler(async (req, res) => {
    const tx = await repo.getTransactionById(req.params.id);
    if (!tx) return res.status(404).json({ success: false, message: 'Transaction not found' });
    if (tx.workflow_status !== 0) return res.status(400).json({ success: false, message: 'Only pending transactions can be reviewed' });
    await repo.updateTransactionStatus(tx.id, 1, req.user ? req.user.id : null);
    await repo.logAudit(tx.company_id, 'commission_transaction', tx.id, 'reviewed', { workflow_status: 0 }, { workflow_status: 1 }, req.user ? req.user.id : null);
    res.json({ success: true, message: 'Transaction reviewed' });
}));

// ─── Approve (review only, no GL) ──────────────────────────
router.post('/transactions/approve', asyncHandler(async (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ success: false, message: 'ids array is required' });
    }
    const result = await commission.settlementEngine.approveTransactions(ids, req.user ? req.user.id : null);
    res.json({ success: true, message: `${result.approved} transaction(s) approved`, data: result });
}));

// ─── Post to GL (separate from approve) ─────────────────────
router.post('/transactions/post-to-gl', asyncHandler(async (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ success: false, message: 'ids array is required' });
    }
    const result = await commission.settlementEngine.postToGL(ids, req.user ? req.user.id : null);
    res.json({ success: true, message: `${result.posted} transaction(s) posted to GL (JE #${result.jeId})`, data: result });
}));

// ─── Lock Period ────────────────────────────────────────────
router.post('/period/lock', asyncHandler(async (req, res) => {
    const { period } = req.body;
    if (!period) return res.status(400).json({ success: false, message: 'period is required (YYYY-MM)' });
    const result = await commission.settlementEngine.lockPeriod(period, req.user ? req.user.id : null);
    res.json({ success: true, message: `Period ${period} locked (${result.locked} transactions)`, data: result });
}));

router.post('/period/unlock', asyncHandler(async (req, res) => {
    const { period } = req.body;
    if (!period) return res.status(400).json({ success: false, message: 'period is required' });
    const result = await commission.settlementEngine.unlockPeriod(period, req.user ? req.user.id : null);
    res.json({ success: true, message: `Period ${period} unlocked`, data: result });
}));

router.get('/period/status', asyncHandler(async (req, res) => {
    const { period } = req.query;
    if (!period) return res.status(400).json({ success: false, message: 'period is required' });
    const status = await repo.getPeriodStatus(period);
    res.json({ success: true, data: status || { period, status: 0 } });
}));

// ─── Settlement ─────────────────────────────────────────────
router.get('/settlement/:period', asyncHandler(async (req, res) => {
    const data = await commission.settlementEngine.getSettlementBatch(req.params.period);
    res.json({ success: true, data });
}));

router.post('/settle', asyncHandler(async (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ success: false, message: 'ids array is required' });
    }
    const result = await commission.settlementEngine.settleTransactions(ids, req.user ? req.user.id : null);
    res.json({ success: true, message: `${result.settled} transaction(s) settled`, data: result });
}));

// ─── Payment Vouchers ───────────────────────────────────────
router.post('/vouchers', asyncHandler(async (req, res) => {
    const { rep_id, transaction_ids } = req.body;
    if (!rep_id || !transaction_ids || !Array.isArray(transaction_ids)) {
        return res.status(400).json({ success: false, message: 'rep_id and transaction_ids are required' });
    }
    const result = await commission.settlementEngine.createPaymentVoucher(
        rep_id, transaction_ids, req.user ? req.user.id : null
    );
    res.json({ success: true, data: result });
}));

router.get('/vouchers/:id', asyncHandler(async (req, res) => {
    const voucher = await repo.getVoucherById(req.params.id);
    if (!voucher) return res.status(404).json({ success: false, message: 'Voucher not found' });
    res.json({ success: true, data: voucher });
}));

router.get('/vouchers', asyncHandler(async (req, res) => {
    const { period } = req.query;
    if (!period) return res.status(400).json({ success: false, message: 'period is required' });
    const data = await repo.getVouchersByPeriod(period);
    res.json({ success: true, data });
}));

router.post('/vouchers/:id/approve', asyncHandler(async (req, res) => {
    await commission.settlementEngine.approveVoucher(req.params.id, req.user ? req.user.id : null);
    res.json({ success: true, message: 'Voucher approved' });
}));

router.post('/vouchers/:id/pay', asyncHandler(async (req, res) => {
    await commission.settlementEngine.payVoucher(req.params.id, req.user ? req.user.id : null);
    res.json({ success: true, message: 'Voucher paid' });
}));

// ─── Adjustments ────────────────────────────────────────────
router.post('/adjustments', asyncHandler(async (req, res) => {
    const data = { ...req.body, created_by: req.user ? req.user.id : null };
    const id = await commission.adjustmentEngine.createManualAdjustment(data);
    res.json({ success: true, data: { id } });
}));

router.get('/adjustments', asyncHandler(async (req, res) => {
    const { period, rep_id } = req.query;
    let data;
    if (rep_id) {
        data = await repo.getAdjustmentsByRep(parseInt(rep_id));
    } else if (period) {
        data = await repo.getAdjustmentsByPeriod(period);
    } else {
        data = await repo.getAdjustmentsByPeriod(null);
    }
    res.json({ success: true, data });
}));

router.post('/adjustments/:id/approve', asyncHandler(async (req, res) => {
    await commission.adjustmentEngine.approveAdjustment(parseInt(req.params.id), req.user ? req.user.id : null);
    res.json({ success: true, message: 'Adjustment approved' });
}));

// ─── Ledger ─────────────────────────────────────────────────
router.get('/ledger/:repId', asyncHandler(async (req, res) => {
    const { period } = req.query;
    if (!period) return res.status(400).json({ success: false, message: 'period is required' });
    const data = await commission.settlementEngine.getRepLedger(parseInt(req.params.repId), period);
    res.json({ success: true, data });
}));

// ─── Summary ────────────────────────────────────────────────
router.get('/summary/:period', asyncHandler(async (req, res) => {
    const data = await repo.getCommissionSummary(req.params.period);
    res.json({ success: true, data });
}));

// ─── Aging ──────────────────────────────────────────────────
router.get('/aging', asyncHandler(async (req, res) => {
    const data = await repo.getCommissionAging();
    res.json({ success: true, data });
}));

// ─── Forecast ───────────────────────────────────────────────
router.get('/forecast/:repId', asyncHandler(async (req, res) => {
    const now = new Date();
    const period = req.query.period || now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

    const rep = await repo.getRepById(parseInt(req.params.repId));
    if (!rep) return res.status(404).json({ success: false, message: 'Rep not found' });

    const mtdSales = await repo.getRepMonthToDateSales(rep.id, period);
    const mtdCollections = await repo.getRepMonthCollections(rep.id, period);

    const target = rep.target_amount || 0;
    const achievementPct = target > 0 ? Math.round(mtdCollections / target * 100 * 100) / 100 : 0;

    const plan = await repo.getPlanById(rep.plan_id);
    const baseRate = plan ? plan.base_rate : rep.commission_rate || 0;

    const tiers = plan ? await repo.getTiersForPlan(plan.id) : [];
    const tierEngine = require('../services/commission/tierEngine');
    const tier = tierEngine.getEffectiveTier(tiers, achievementPct);
    const effectiveRate = tier ? baseRate * tier.multiplier : baseRate;

    const expectedCommission = Math.round(mtdCollections * effectiveRate / 100 * 100) / 100;

    res.json({
        success: true,
        data: {
            rep_id: rep.id,
            rep_name: rep.rep_name,
            period,
            target,
            mtd_sales: mtdSales,
            mtd_collections: mtdCollections,
            achievement_pct: achievementPct,
            base_rate: baseRate,
            effective_rate: effectiveRate,
            tier_label: tier ? tier.tier_label : 'Flat',
            expected_commission: expectedCommission
        }
    });
}));

module.exports = router;
