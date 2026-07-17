-- Migration: 012_commission_seed
-- Default commission plan and tiers
-- Idempotent: checks plan existence before insertion

-- Default Commission Plan
IF NOT EXISTS (SELECT * FROM commission_plans WHERE plan_name = N'الخطة الافتراضية')
BEGIN
    SET IDENTITY_INSERT commission_plans ON;

    INSERT INTO commission_plans (id, company_id, plan_name, base_rate, effective_from, effective_to, is_active)
    VALUES (1, NULL, N'الخطة الافتراضية', 2.0, '2020-01-01', NULL, 1);

    SET IDENTITY_INSERT commission_plans OFF;

    -- Default Tiers (6 tiers covering the full range)
    INSERT INTO commission_tiers (plan_id, from_percent, to_percent, multiplier, tier_label, effective_from, effective_to)
    VALUES
        (1, 0,   60,  0.00, N'أقل من 60%',  '2020-01-01', NULL),
        (1, 60,  80,  0.50, N'60% - 80%',   '2020-01-01', NULL),
        (1, 80,  100, 0.75, N'80% - 100%',  '2020-01-01', NULL),
        (1, 100, 120, 1.00, N'100% - 120%', '2020-01-01', NULL),
        (1, 120, 200, 1.50, N'أكثر من 120%', '2020-01-01', NULL),
        (1, 200, 999, 2.00, N'نخبة المندوبين', '2020-01-01', NULL);
END
GO

PRINT 'Migration 012_commission_seed completed successfully';
