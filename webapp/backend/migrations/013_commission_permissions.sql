-- Migration: 013_commission_permissions
-- Permissions for commission module
-- Idempotent: checks permission existence before insertion

-- View Commission
IF OBJECT_ID('permissions') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT * FROM permissions WHERE code = 'commission.view')
    BEGIN
        INSERT INTO permissions (code, name, module, description, is_active)
        VALUES ('commission.view', N'عرض العمولات', 'commissions', N'عرض كشف عمولات المندوبين', 1);
    END
END
GO

-- Review Commission
IF OBJECT_ID('permissions') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT * FROM permissions WHERE code = 'commission.review')
    BEGIN
        INSERT INTO permissions (code, name, module, description, is_active)
        VALUES ('commission.review', N'مراجعة العمولات', 'commissions', N'مراجعة وتأكيد العمولات قبل الاعتماد', 1);
    END
END
GO

-- Approve Commission
IF OBJECT_ID('permissions') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT * FROM permissions WHERE code = 'commission.approve')
    BEGIN
        INSERT INTO permissions (code, name, module, description, is_active)
        VALUES ('commission.approve', N'اعتماد العمولات', 'commissions', N'اعتماد العمولات للصرف', 1);
    END
END
GO

-- Lock Commission Period
IF OBJECT_ID('permissions') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT * FROM permissions WHERE code = 'commission.lock')
    BEGIN
        INSERT INTO permissions (code, name, module, description, is_active)
        VALUES ('commission.lock', N'قفل فترة العمولات', 'commissions', N'قفل فترة لمنع تعديل العمولات', 1);
    END
END
GO

-- Unlock Commission Period
IF OBJECT_ID('permissions') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT * FROM permissions WHERE code = 'commission.unlock')
    BEGIN
        INSERT INTO permissions (code, name, module, description, is_active)
        VALUES ('commission.unlock', N'فتح فترة العمولات', 'commissions', N'فتح فترة مقفلة (Admin فقط)', 1);
    END
END
GO

-- Pay Commission
IF OBJECT_ID('permissions') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT * FROM permissions WHERE code = 'commission.pay')
    BEGIN
        INSERT INTO permissions (code, name, module, description, is_active)
        VALUES ('commission.pay', N'صرف العمولات', 'commissions', N'إنشاء سند صرف وصرف العمولات', 1);
    END
END
GO

-- Create Adjustment
IF OBJECT_ID('permissions') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT * FROM permissions WHERE code = 'commission.adjust')
    BEGIN
        INSERT INTO permissions (code, name, module, description, is_active)
        VALUES ('commission.adjust', N'تعديلات العمولات', 'commissions', N'إنشاء تعديلات يدوية (مكافآت/خصومات)', 1);
    END
END
GO

-- Edit Commission Plan
IF OBJECT_ID('permissions') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT * FROM permissions WHERE code = 'commission.plan.edit')
    BEGIN
        INSERT INTO permissions (code, name, module, description, is_active)
        VALUES ('commission.plan.edit', N'تعديل خطة العمولات', 'commissions', N'إنشاء وتعديل خطط ونسب العمولات', 1);
    END
END
GO

-- Commission Reports
IF OBJECT_ID('permissions') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT * FROM permissions WHERE code = 'commission.report')
    BEGIN
        INSERT INTO permissions (code, name, module, description, is_active)
        VALUES ('commission.report', N'تقارير العمولات', 'commissions', N'عرض تقارير العمولات والتسوية', 1);
    END
END
GO

PRINT 'Migration 013_commission_permissions completed successfully';
