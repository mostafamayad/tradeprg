const Suite = require('../lib/runner');

module.exports = async function () {
    const s = new Suite('Commission — Snapshot Builder (Unit Tests)');

    const { buildSnapshot, buildClawbackSnapshot } = require('../../services/commission/snapshotBuilder');

    const mockData = {
        rep: { id: 4, rep_name: 'أحمد محمد', rep_code: 'R-0042', target_amount: 100000 },
        collection: { id: 305, customer_id: 15, collection_no: 'REC-00305', collection_date: '2026-07-10', amount: 5000, company_id: null, customer_name: 'شركة الأمل', invoice_no: null, invoice_date: null },
        allocation: { invoice_id: 201, invoice_no: 'INV-00201', amount: 5000, customer_name: 'شركة الأمل', invoice_date: '2026-07-01' },
        plan: { id: 1, plan_name: 'الخطة الافتراضية', base_rate: 2.0 },
        tier: { id: 3, tier_label: '80% - 100%', multiplier: 0.75 },
        achievementPct: 85,
        effectiveRate: 1.5,
        commissionAmount: 75
    };

    await s.run([
        {
            name: 'buildSnapshot returns valid JSON with all required fields',
            fn: () => {
                const snap = JSON.parse(buildSnapshot(mockData));
                if (!snap.schema_version) throw new Error('Missing schema_version');
                if (!snap.calculation_version) throw new Error('Missing calculation_version');
                if (snap.rep_id !== 4) throw new Error('Wrong rep_id');
                if (snap.rep_name !== 'أحمد محمد') throw new Error('Wrong rep_name');
                if (snap.invoice_no !== 'INV-00201') throw new Error('Wrong invoice_no');
                if (snap.collection_no !== 'REC-00305') throw new Error('Wrong collection_no');
                if (snap.plan_name !== 'الخطة الافتراضية') throw new Error('Wrong plan_name');
                if (snap.tier_label !== '80% - 100%') throw new Error('Wrong tier_label');
                if (snap.effective_rate !== 1.5) throw new Error('Wrong effective_rate');
                if (snap.commission_amount !== 75) throw new Error('Wrong commission_amount');
            }
        },
        {
            name: 'buildSnapshot formula is correct',
            fn: () => {
                const snap = JSON.parse(buildSnapshot(mockData));
                if (!snap.formula.includes('5000')) throw new Error('Formula missing amount');
                if (!snap.formula.includes('2%')) throw new Error('Formula missing base_rate');
                if (!snap.formula.includes('0.75')) throw new Error('Formula missing multiplier');
            }
        },
        {
            name: 'buildClawbackSnapshot returns negative amount',
            fn: () => {
                const originalTx = { id: 1, commission_amount: 75, effective_rate: 1.5 };
                const snap = JSON.parse(buildClawbackSnapshot({ originalTx, returnAmount: 3000 }));
                if (snap.type !== 'clawback') throw new Error('Missing type clawback');
                if (snap.original_transaction_id !== 1) throw new Error('Wrong original_transaction_id');
                const expected = -(3000 * 1.5 / 100);
                if (snap.clawback_amount !== expected) throw new Error(`Expected ${expected}, got ${snap.clawback_amount}`);
                if (snap.clawback_amount >= 0) throw new Error('Clawback should be negative');
            }
        },
        {
            name: 'Snapshot includes calculated_at timestamp',
            fn: () => {
                const snap = JSON.parse(buildSnapshot(mockData));
                if (!snap.calculated_at) throw new Error('Missing calculated_at');
                if (isNaN(Date.parse(snap.calculated_at))) throw new Error('Invalid date format');
            }
        },
        {
            name: 'Snapshot includes engine_version',
            fn: () => {
                const snap = JSON.parse(buildSnapshot(mockData));
                if (!snap.engine_version) throw new Error('Missing engine_version');
            }
        },
    ]);

    return s;
};
