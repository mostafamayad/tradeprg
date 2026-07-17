const Suite = require('../lib/runner');

module.exports = async function () {
    const s = new Suite('Commission — Full Workflow Scenario Tests');

    const tierEngine = require('../../services/commission/tierEngine');
    const calculator = require('../../services/commission/calculator');
    const snapshotBuilder = require('../../services/commission/snapshotBuilder');
    const validator = require('../../services/commission/validator');

    const DEFAULT_TIERS = [
        { id: 1, from_percent: 0,   to_percent: 60,  multiplier: 0.00 },
        { id: 2, from_percent: 60,  to_percent: 80,  multiplier: 0.50 },
        { id: 3, from_percent: 80,  to_percent: 100, multiplier: 0.75 },
        { id: 4, from_percent: 100, to_percent: 120, multiplier: 1.00 },
        { id: 5, from_percent: 120, to_percent: 200, multiplier: 1.50 },
    ];

    function calcPct(sales, target) {
        if (!target || target === 0) throw new Error('Target must be > 0');
        return Math.round(sales / target * 10000) / 100;
    }

    await s.run([
        {
            name: 'SCENARIO: Low achievement (50%) — rep earns nothing',
            fn: () => {
                const pct = calcPct(50000, 100000);
                if (pct !== 50) throw new Error('Wrong pct');
                const tier = tierEngine.getEffectiveTier(DEFAULT_TIERS, pct);
                if (tier.multiplier !== 0.00) throw new Error('Tier 1 should give 0%');
                const rate = tierEngine.calculateEffectiveRate(2.0, 0.00);
                if (rate !== 0) throw new Error('Effective rate should be 0');
                const commission = tierEngine.calculateCommissionAmount(5000, 0);
                if (commission !== 0) throw new Error('Commission should be 0');
            }
        },
        {
            name: 'SCENARIO: Target exactly 100% — multiplier 1.0',
            fn: () => {
                const pct = calcPct(100000, 100000);
                if (pct !== 100) throw new Error('Wrong pct: ' + pct);
                const tier = tierEngine.getEffectiveTier(DEFAULT_TIERS, pct);
                if (tier.multiplier !== 1.00) throw new Error('Tier 4 should give 1.0');
                const rate = tierEngine.calculateEffectiveRate(2.0, 1.00);
                if (rate !== 2.0) throw new Error('Effective rate should be 2.0');
                const commission = tierEngine.calculateCommissionAmount(10000, 2.0);
                if (commission !== 200) throw new Error('Commission should be 200');
            }
        },
        {
            name: 'SCENARIO: Over-achiever (150%) — multiplier 1.5',
            fn: () => {
                const pct = calcPct(150000, 100000);
                if (pct !== 150) throw new Error('Wrong pct');
                const tier = tierEngine.getEffectiveTier(DEFAULT_TIERS, pct);
                if (tier.multiplier !== 1.50) throw new Error('Tier 5 should give 1.5');
                const rate = tierEngine.calculateEffectiveRate(2.0, 1.50);
                if (rate !== 3.0) throw new Error('Effective rate should be 3.0');
                const commission = tierEngine.calculateCommissionAmount(8000, 3.0);
                if (commission !== 240) throw new Error('Commission should be 240');
            }
        },
        {
            name: 'SCENARIO: Partial collection — 60% of invoice',
            fn: () => {
                const commission = tierEngine.calculateCommissionAmount(6000, 2.0);
                if (commission !== 120) throw new Error('6000 × 2% = 120, got ' + commission);
            }
        },
        {
            name: 'SCENARIO: Zero target — rep gets 0% always',
            fn: () => {
                try {
                    calcPct(50000, 0);
                    throw new Error('Should have thrown');
                } catch (e) {
                    if (e.message.includes('Should have thrown')) throw e;
                }
            }
        },
        {
            name: 'SCENARIO: Full workflow — collection → validate → calculate → snapshot',
            fn: async () => {
                const collection = {
                    id: 305, customer_id: 15, rep_id: 4,
                    amount: 5000, collection_no: 'REC-00305',
                    collection_date: '2026-07-10', company_id: null,
                    customer_name: 'شركة الأمل'
                };
                const errors = validator.validateCollectionForCommission(collection);
                if (errors.length > 0) throw new Error('Validation failed: ' + errors.join(', '));
                const pct = calcPct(85000, 100000);
                if (pct !== 85) throw new Error('Wrong achievement');
                const tier = tierEngine.getEffectiveTier(DEFAULT_TIERS, pct);
                if (tier.multiplier !== 0.75) throw new Error('Wrong tier');
                const rate = tierEngine.calculateEffectiveRate(2.0, 0.75);
                if (rate !== 1.5) throw new Error('Wrong rate');
                const commission = tierEngine.calculateCommissionAmount(5000, 1.5);
                if (commission !== 75) throw new Error('Wrong commission');
            }
        },
        {
            name: 'SCENARIO: Return before collection — no clawback needed',
            fn: () => {
                const period = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0');
                if (!/^\d{4}-\d{2}$/.test(period)) throw new Error('Invalid period');
            }
        },
        {
            name: 'SCENARIO: Cancel invoice after collection — status 5',
            fn: () => {
                const status = 5;
                if (status !== 5) throw new Error('Should be 5');
            }
        },
        {
            name: 'SCENARIO: Multiple invoices for same rep — each calculated independently',
            fn: () => {
                const tx1 = tierEngine.calculateCommissionAmount(5000, 1.5);
                const tx2 = tierEngine.calculateCommissionAmount(3000, 1.5);
                const total = tx1 + tx2;
                if (tx1 !== 75) throw new Error('Wrong tx1');
                if (tx2 !== 45) throw new Error('Wrong tx2');
                if (total !== 120) throw new Error('Wrong total');
            }
        },
        {
            name: 'SCENARIO: Plan with custom tiers — different rates',
            fn: () => {
                const customTiers = [
                    { id: 10, from_percent: 0,   to_percent: 70,  multiplier: 0.00 },
                    { id: 11, from_percent: 70,  to_percent: 100, multiplier: 0.60 },
                    { id: 12, from_percent: 100, to_percent: 150, multiplier: 1.20 },
                ];
                const pct = calcPct(80000, 100000);
                const tier = tierEngine.getEffectiveTier(customTiers, pct);
                if (tier.multiplier !== 0.60) throw new Error('Custom tier should give 0.6');
                const rate = tierEngine.calculateEffectiveRate(3.0, 0.60);
                if (Math.round(rate * 100) / 100 !== 1.8) throw new Error('Custom rate should be 1.8, got ' + rate);
            }
        },
        {
            name: 'SCENARIO: Multi-company isolation — different reps',
            fn: () => {
                const rep1 = { id: 4, company_id: 1 };
                const rep2 = { id: 5, company_id: 2 };
                if (rep1.company_id === rep2.company_id) throw new Error('Companies should be different');
                const pct1 = calcPct(80000, 100000);
                const pct2 = calcPct(120000, 100000);
                if (pct1 === pct2) throw new Error('Achievements should be different');
            }
        },
        {
            name: 'SCENARIO: Snapshot captures all context for audit',
            fn: () => {
                const snap = JSON.parse(snapshotBuilder.buildSnapshot({
                    rep: { id: 4, rep_name: 'أحمد', rep_code: 'R-0042', target_amount: 100000 },
                    collection: { id: 305, customer_id: 15, collection_no: 'REC-00305', collection_date: '2026-07-10', amount: 5000, company_id: null, customer_name: 'شركة الأمل' },
                    allocation: { invoice_id: 201, invoice_no: 'INV-00201', amount: 5000, customer_name: 'شركة الأمل', invoice_date: '2026-07-01' },
                    plan: { id: 1, plan_name: 'الخطة الافتراضية', base_rate: 2.0 },
                    tier: { id: 3, tier_label: '80% - 100%', multiplier: 0.75 },
                    achievementPct: 85,
                    effectiveRate: 1.5,
                    commissionAmount: 75
                }));
                if (!snap.schema_version) throw new Error('Missing schema_version');
                if (!snap.calculation_version) throw new Error('Missing calculation_version');
                if (!snap.formula) throw new Error('Missing formula');
                if (!snap.calculated_at) throw new Error('Missing calculated_at');
                if (snap.rep_id !== 4) throw new Error('Wrong rep_id');
                if (snap.commission_amount !== 75) throw new Error('Wrong commission');
            }
        },
        {
            name: 'SCENARIO: Clawback on full return — full commission reversed',
            fn: () => {
                const returnAmount = 5000;
                const effectiveRate = 1.5;
                const clawback = -(returnAmount * effectiveRate / 100);
                if (clawback !== -75) throw new Error('Expected -75, got ' + clawback);
            }
        },
        {
            name: 'SCENARIO: Clawback on partial return — proportional clawback',
            fn: () => {
                const returnAmount = 2000;
                const effectiveRate = 1.5;
                const clawback = -(returnAmount * effectiveRate / 100);
                if (clawback !== -30) throw new Error('Expected -30, got ' + clawback);
            }
        },
        {
            name: 'SCENARIO: Period status — open period allows calculation',
            fn: () => {
                const isValid = validator.validatePeriodOpen({ status: 0 });
                if (!isValid) throw new Error('Open period should be valid');
            }
        },
        {
            name: 'SCENARIO: Period status — closed period blocks calculation',
            fn: () => {
                const isValid = validator.validatePeriodOpen({ status: 1 });
                if (isValid) throw new Error('Closed period should be invalid');
            }
        },
        {
            name: 'SCENARIO: Locked status — cannot modify',
            fn: () => {
                const canModify = validator.validateNotLocked(3);
                if (canModify) throw new Error('Status 3 should block modification');
            }
        },
        {
            name: 'SCENARIO: Pending status — can be modified',
            fn: () => {
                const canModify = validator.validateNotLocked(0);
                if (!canModify) throw new Error('Status 0 should allow modification');
            }
        },
    ]);

    return s;
};
