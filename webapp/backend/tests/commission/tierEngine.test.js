const Suite = require('../lib/runner');

module.exports = async function () {
    const s = new Suite('Commission — Tier Engine (Unit Tests)');

    const { getEffectiveTier, calculateEffectiveRate, calculateCommissionAmount } = require('../../services/commission/tierEngine');

    const defaultTiers = [
        { id: 1, from_percent: 0,   to_percent: 60,  multiplier: 0.00, tier_label: 'أقل من 60%' },
        { id: 2, from_percent: 60,  to_percent: 80,  multiplier: 0.50, tier_label: '60% - 80%' },
        { id: 3, from_percent: 80,  to_percent: 100, multiplier: 0.75, tier_label: '80% - 100%' },
        { id: 4, from_percent: 100, to_percent: 120, multiplier: 1.00, tier_label: '100% - 120%' },
        { id: 5, from_percent: 120, to_percent: 200, multiplier: 1.50, tier_label: 'أكثر من 120%' },
        { id: 6, from_percent: 200, to_percent: 999, multiplier: 2.00, tier_label: 'نخبة المندوبين' },
    ];

    await s.run([
        {
            name: '50% achievement → 0% multiplier (Tier 1)',
            fn: () => {
                const tier = getEffectiveTier(defaultTiers, 50);
                if (!tier) throw new Error('No tier returned');
                if (tier.multiplier !== 0) throw new Error(`Expected 0, got ${tier.multiplier}`);
            }
        },
        {
            name: '60% achievement → 0.50 multiplier (Tier 2 boundary)',
            fn: () => {
                const tier = getEffectiveTier(defaultTiers, 60);
                if (!tier) throw new Error('No tier returned');
                if (tier.multiplier !== 0.50) throw new Error(`Expected 0.50, got ${tier.multiplier}`);
            }
        },
        {
            name: '70% achievement → 0.50 multiplier (Tier 2)',
            fn: () => {
                const tier = getEffectiveTier(defaultTiers, 70);
                if (!tier) throw new Error('No tier returned');
                if (tier.multiplier !== 0.50) throw new Error(`Expected 0.50, got ${tier.multiplier}`);
            }
        },
        {
            name: '80% achievement → 0.75 multiplier (Tier 3 boundary)',
            fn: () => {
                const tier = getEffectiveTier(defaultTiers, 80);
                if (!tier) throw new Error('No tier returned');
                if (tier.multiplier !== 0.75) throw new Error(`Expected 0.75, got ${tier.multiplier}`);
            }
        },
        {
            name: '90% achievement → 0.75 multiplier (Tier 3)',
            fn: () => {
                const tier = getEffectiveTier(defaultTiers, 90);
                if (!tier) throw new Error('No tier returned');
                if (tier.multiplier !== 0.75) throw new Error(`Expected 0.75, got ${tier.multiplier}`);
            }
        },
        {
            name: '100% achievement → 1.00 multiplier (Tier 4 boundary)',
            fn: () => {
                const tier = getEffectiveTier(defaultTiers, 100);
                if (!tier) throw new Error('No tier returned');
                if (tier.multiplier !== 1.00) throw new Error(`Expected 1.00, got ${tier.multiplier}`);
            }
        },
        {
            name: '110% achievement → 1.00 multiplier (Tier 4)',
            fn: () => {
                const tier = getEffectiveTier(defaultTiers, 110);
                if (!tier) throw new Error('No tier returned');
                if (tier.multiplier !== 1.00) throw new Error(`Expected 1.00, got ${tier.multiplier}`);
            }
        },
        {
            name: '120% achievement → 1.50 multiplier (Tier 5 boundary)',
            fn: () => {
                const tier = getEffectiveTier(defaultTiers, 120);
                if (!tier) throw new Error('No tier returned');
                if (tier.multiplier !== 1.50) throw new Error(`Expected 1.50, got ${tier.multiplier}`);
            }
        },
        {
            name: '150% achievement → 1.50 multiplier (Tier 5)',
            fn: () => {
                const tier = getEffectiveTier(defaultTiers, 150);
                if (!tier) throw new Error('No tier returned');
                if (tier.multiplier !== 1.50) throw new Error(`Expected 1.50, got ${tier.multiplier}`);
            }
        },
        {
            name: '250% achievement → 2.00 multiplier (Tier 6 — elite)',
            fn: () => {
                const tier = getEffectiveTier(defaultTiers, 250);
                if (!tier) throw new Error('No tier returned');
                if (tier.multiplier !== 2.00) throw new Error(`Expected 2.00, got ${tier.multiplier}`);
            }
        },
        {
            name: '0% achievement → 0% multiplier',
            fn: () => {
                const tier = getEffectiveTier(defaultTiers, 0);
                if (!tier) throw new Error('No tier returned');
                if (tier.multiplier !== 0) throw new Error(`Expected 0, got ${tier.multiplier}`);
            }
        },
        {
            name: 'Empty tiers → returns null',
            fn: () => {
                const tier = getEffectiveTier([], 50);
                if (tier !== null) throw new Error(`Expected null, got ${tier}`);
            }
        },
        {
            name: 'calculateEffectiveRate: 2% × 0.75 = 1.5%',
            fn: () => {
                const rate = calculateEffectiveRate(2.0, 0.75);
                if (rate !== 1.5) throw new Error(`Expected 1.5, got ${rate}`);
            }
        },
        {
            name: 'calculateEffectiveRate: 2% × 1.0 = 2.0%',
            fn: () => {
                const rate = calculateEffectiveRate(2.0, 1.0);
                if (rate !== 2.0) throw new Error(`Expected 2.0, got ${rate}`);
            }
        },
        {
            name: 'calculateCommissionAmount: 10000 × 2% = 200',
            fn: () => {
                const amt = calculateCommissionAmount(10000, 2.0);
                if (amt !== 200) throw new Error(`Expected 200, got ${amt}`);
            }
        },
        {
            name: 'calculateCommissionAmount: 3000 × 1.5% = 45',
            fn: () => {
                const amt = calculateCommissionAmount(3000, 1.5);
                if (amt !== 45) throw new Error(`Expected 45, got ${amt}`);
            }
        },
        {
            name: 'calculateCommissionAmount: 0 amount → 0',
            fn: () => {
                const amt = calculateCommissionAmount(0, 2.0);
                if (amt !== 0) throw new Error(`Expected 0, got ${amt}`);
            }
        },
    ]);

    return s;
};
