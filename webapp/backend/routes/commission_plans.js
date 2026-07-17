const router = require('express').Router();
const repo = require('../repositories/commissionRepository');
const asyncHandler = require('../utils/asyncHandler');

router.get('/', asyncHandler(async (req, res) => {
    const plans = await repo.getAllPlans();
    res.json({ success: true, data: plans });
}));

router.get('/:id', asyncHandler(async (req, res) => {
    const plan = await repo.getPlanById(parseInt(req.params.id));
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });
    const tiers = await repo.getTiersForPlan(plan.id);
    res.json({ success: true, data: { ...plan, tiers } });
}));

router.post('/', asyncHandler(async (req, res) => {
    const id = await repo.createPlan(req.body);
    res.json({ success: true, data: { id } });
}));

router.put('/:id', asyncHandler(async (req, res) => {
    await repo.updatePlan(parseInt(req.params.id), req.body);
    res.json({ success: true, message: 'Plan updated' });
}));

router.post('/:id/tiers', asyncHandler(async (req, res) => {
    const id = await repo.createTier({ ...req.body, plan_id: parseInt(req.params.id) });
    res.json({ success: true, data: { id } });
}));

module.exports = router;
