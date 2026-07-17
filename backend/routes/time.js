const router = require('express').Router();
const { syncTime, getSnapshot } = require('../utils/time');
const asyncHandler = require('../utils/asyncHandler');

router.get('/', asyncHandler(async (req, res) => {
    try {
        const snapshot = await syncTime(true);
        res.json({ success: true, ...snapshot });
    } catch (err) {
        console.error('[TIME] Route error:', err);
        const snapshot = getSnapshot();
        res.json({ success: true, ...snapshot, fallback: true });
    }
}));

module.exports = router;
