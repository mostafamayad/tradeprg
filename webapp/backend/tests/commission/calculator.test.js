const Suite = require('../lib/runner');

module.exports = async function () {
    const s = new Suite('Commission — Calculator (Unit Tests)');

    const { calculateForCollection } = require('../../services/commission/calculator');

    // Mock repo calls to avoid DB
    const origGetRepById = require('../../repositories/commissionRepository').getRepById;
    const origGetPlanById = require('../../repositories/commissionRepository').getPlanById;
    const origGetTiersForPlan = require('../../repositories/commissionRepository').getTiersForPlan;
    const origGetPeriodStatus = require('../../repositories/commissionRepository').getPeriodStatus;
    const origGetRepAchievement = require('../../repositories/commissionRepository').getRepAchievement;
    const origGetAllocationsForCollection = require('../../repositories/commissionRepository').getAllocationsForCollection;

    const mockRepo = {
        getRepById: async () => ({
            id: 4, rep_name: 'أحمد', rep_code: 'R-0042', plan_id: 1,
            target_amount: 100000, commission_rate: 2.0
        }),
        getPlanById: async () => ({
            id: 1, plan_name: 'الخطة الافتراضية', base_rate: 2.0
        }),
        getTiersForPlan: async () => [
            { id: 1, from_percent: 0,   to_percent: 60,  multiplier: 0.00 },
            { id: 2, from_percent: 60,  to_percent: 80,  multiplier: 0.50 },
            { id: 3, from_percent: 80,  to_percent: 100, multiplier: 0.75 },
            { id: 4, from_percent: 100, to_percent: 120, multiplier: 1.00 },
            { id: 5, from_percent: 120, to_percent: 200, multiplier: 1.50 },
        ],
        getPeriodStatus: async () => ({ status: 0 }),
        getRepAchievement: async () => ({ total_sales: 85000, total_returns: 0 }),
        getAllocationsForCollection: async () => [{ invoice_id: 1, invoice_no: 'INV-001', amount: 5000, customer_name: 'test', invoice_date: '2026-07-01' }]
    };

    // Temporarily override repo
    const repo = require('../../repositories/commissionRepository');
    Object.assign(repo, mockRepo);

    const mockCollection = {
        id: 305,
        customer_id: 15,
        rep_id: 4,
        amount: 5000,
        collection_no: 'REC-00305',
        collection_date: '2026-07-10',
        company_id: null,
        customer_name: 'شركة الأمل',
        invoice_no: 'INV-001',
        invoice_date: '2026-07-01'
    };

    await s.run([
        {
            name: 'calculateForCollection returns array with results',
            fn: async () => {
                const results = await calculateForCollection(mockCollection);
                if (!Array.isArray(results)) throw new Error('Expected array');
                if (results.length === 0) throw new Error('Expected at least 1 result');
            }
        },
        {
            name: 'Rep name is included in result',
            fn: async () => {
                const results = await calculateForCollection(mockCollection);
                if (results[0].rep_name !== 'أحمد') throw new Error('Wrong rep_name: ' + results[0].rep_name);
            }
        },
        {
            name: 'Plan base_rate is 2%',
            fn: async () => {
                const results = await calculateForCollection(mockCollection);
                if (results[0].base_rate !== 2.0) throw new Error('Wrong base_rate');
            }
        },
        {
            name: '85% achievement → tier multiplier 0.75 → effective_rate 1.5',
            fn: async () => {
                const results = await calculateForCollection(mockCollection);
                if (results[0].achievement_pct !== 85) throw new Error('Wrong achievement: ' + results[0].achievement_pct);
                if (results[0].tier_multiplier !== 0.75) throw new Error('Wrong tier_multiplier: ' + results[0].tier_multiplier);
                if (results[0].effective_rate !== 1.5) throw new Error('Wrong effective_rate: ' + results[0].effective_rate);
            }
        },
        {
            name: 'Commission amount: 5000 × 1.5% = 75',
            fn: async () => {
                const results = await calculateForCollection(mockCollection);
                if (results[0].commission_amount !== 75) throw new Error('Wrong commission: ' + results[0].commission_amount);
            }
        },
        {
            name: 'Period is YYYY-MM format',
            fn: async () => {
                const results = await calculateForCollection(mockCollection);
                if (!/^\d{4}-\d{2}$/.test(results[0].period)) throw new Error('Invalid period: ' + results[0].period);
            }
        },
        {
            name: 'Snapshot is valid JSON string',
            fn: async () => {
                const results = await calculateForCollection(mockCollection);
                const snap = JSON.parse(results[0].snapshot);
                if (!snap.schema_version) throw new Error('Missing schema_version in snapshot');
            }
        },
        {
            name: 'Collection without rep_id throws error',
            fn: async () => {
                try {
                    await calculateForCollection({ id: 1, customer_id: 1, amount: 1000 });
                    throw new Error('Should have thrown');
                } catch (e) {
                    if (e.message.includes('Should have thrown')) throw e;
                    if (!e.message.toLowerCase().includes('rep')) throw new Error('Wrong error: ' + e.message);
                }
            }
        },
        {
            name: 'Collection with 0 amount throws error',
            fn: async () => {
                try {
                    await calculateForCollection({ id: 1, customer_id: 1, rep_id: 4, amount: 0 });
                    throw new Error('Should have thrown');
                } catch (e) {
                    if (e.message.includes('Should have thrown')) throw e;
                }
            }
        },
    ]);

    // Restore original repo methods
    repo.getRepById = origGetRepById;
    repo.getPlanById = origGetPlanById;
    repo.getTiersForPlan = origGetTiersForPlan;
    repo.getPeriodStatus = origGetPeriodStatus;
    repo.getRepAchievement = origGetRepAchievement;
    repo.getAllocationsForCollection = origGetAllocationsForCollection;

    return s;
};
