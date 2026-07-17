-- Migration: 014_commission_settings
-- Commission module settings
-- Idempotent: checks setting existence before insertion

-- Collection allocation method
IF NOT EXISTS (SELECT * FROM settings WHERE setting_key = 'commission.collection_allocation')
BEGIN
    INSERT INTO settings (setting_key, setting_value, setting_category, description)
    VALUES ('commission.collection_allocation', 'fifo', 'commission', 'طريقة توزيع التحصيل على الفواتير (fifo/manual)');
END
GO

-- Overdue block days
IF NOT EXISTS (SELECT * FROM settings WHERE setting_key = 'commission.overdue_block_days')
BEGIN
    INSERT INTO settings (setting_key, setting_value, setting_category, description)
    VALUES ('commission.overdue_block_days', '30', 'commission', 'عدد أيام التأخير المسموحة قبل حظر العمولة');
END
GO

-- Default plan ID
IF NOT EXISTS (SELECT * FROM settings WHERE setting_key = 'commission.default_plan_id')
BEGIN
    INSERT INTO settings (setting_key, setting_value, setting_category, description)
    VALUES ('commission.default_plan_id', '1', 'commission', 'معرف الخطة الافتراضية للمندوبين الجدد');
END
GO

-- Commission who receives
IF NOT EXISTS (SELECT * FROM settings WHERE setting_key = 'commission.who_receives')
BEGIN
    INSERT INTO settings (setting_key, setting_value, setting_category, description)
    VALUES ('commission.who_receives', 'rep', 'commission', 'من يستحق العمولة (rep/collector/split)');
END
GO

-- Commission split percentage (if who_receives = split)
IF NOT EXISTS (SELECT * FROM settings WHERE setting_key = 'commission.split_rep_pct')
BEGIN
    INSERT INTO settings (setting_key, setting_value, setting_category, description)
    VALUES ('commission.split_rep_pct', '50', 'commission', 'نسبة المندوب عند التقسيم (%)');
END
GO

-- Schema version for commission snapshot
IF NOT EXISTS (SELECT * FROM settings WHERE setting_key = 'commission.snapshot_schema_version')
BEGIN
    INSERT INTO settings (setting_key, setting_value, setting_category, description)
    VALUES ('commission.snapshot_schema_version', '1.0', 'commission', 'إصدار الـ snapshot schema');
END
GO

-- Calculation version
IF NOT EXISTS (SELECT * FROM settings WHERE setting_key = 'commission.calculation_version')
BEGIN
    INSERT INTO settings (setting_key, setting_value, setting_category, description)
    VALUES ('commission.calculation_version', '1.0', 'commission', 'إصدار خوارزمية الحساب');
END
GO

PRINT 'Migration 014_commission_settings completed successfully';
