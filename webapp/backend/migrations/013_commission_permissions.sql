-- Migration: 013_commission_permissions
-- Permissions for commission module
-- Idempotent: checks permission existence before insertion

-- View Commission
IF NOT EXISTS (SELECT * FROM permissions WHERE code = 'commission.view')
BEGIN
    INSERT INTO permissions (code, name, module, description, is_active)
    VALUES ('commission.view', 'عرض العمولات', 'commissions', 'عرض كشف عمولات المندوبين', 1);
END
GO

-- Review Commission
IF NOT EXISTS (SELECT * FROM permissions WHERE code = 'commission.review')
BEGIN
    INSERT INTO permissions (code, name, module, description, is_active)
    VALUES ('commission.review', 'مراجعة العمولات', 'commissions', 'مراجعة وتأكيد العمولات قبل الاعتماد', 1);
END
GO

-- Approve Commission
IF NOT EXISTS (SELECT * FROM permissions WHERE code = 'commission.approve')
BEGIN
    INSERT INTO permissions (code, name, module, description, is_active)
    VALUES ('commission.approve', 'اعتماد العمولات', 'commissions', 'اعتماد العمولات للصرف', 1);
END
GO

-- Lock Commission Period
IF NOT EXISTS (SELECT * FROM permissions WHERE code = 'commission.lock')
BEGIN
    INSERT INTO permissions (code, name, module, description, is_active)
    VALUES ('commission.lock', 'قفل فترة العمولات', 'commissions', 'قفل فترة لمنع تعديل العمولات', 1);
END
GO

-- Unlock Commission Period
IF NOT EXISTS (SELECT * FROM permissions WHERE code = 'commission.unlock')
BEGIN
    INSERT INTO permissions (code, name, module, description, is_active)
    VALUES ('commission.unlock', 'فتح فترة العمولات', 'commissions', 'فتح فترة مقفلة (Admin فقط)', 1);
END
GO

-- Pay Commission
IF NOT EXISTS (SELECT * FROM permissions WHERE code = 'commission.pay')
BEGIN
    INSERT INTO permissions (code, name, module, description, is_active)
    VALUES ('commission.pay', 'صرف العمولات', 'commissions', 'إنشاء سند صرف وصرف العمولات', 1);
END
GO

-- Create Adjustment
IF NOT EXISTS (SELECT * FROM permissions WHERE code = 'commission.adjust')
BEGIN
    INSERT INTO permissions (code, name, module, description, is_active)
    VALUES ('commission.adjust', 'تعديلات العمولات', 'commissions', 'إنشاء تعديلات يدوية (مكافآت/خصومات)', 1);
END
GO

-- Edit Commission Plan
IF NOT EXISTS (SELECT * FROM permissions WHERE code = 'commission.plan.edit')
BEGIN
    INSERT INTO permissions (code, name, module, description, is_active)
    VALUES ('commission.plan.edit', 'تعديل خطة العمولات', 'commissions', 'إنشاء وتعديل خطط ونسب العمولات', 1);
END
GO

-- Commission Reports
IF NOT EXISTS (SELECT * FROM permissions WHERE code = 'commission.report')
BEGIN
    INSERT INTO permissions (code, name, module, description, is_active)
    VALUES ('commission.report', 'تقارير العمولات', 'commissions', 'عرض تقارير العمولات والتسوية', 1);
END
GO

PRINT 'Migration 013_commission_permissions completed successfully';
