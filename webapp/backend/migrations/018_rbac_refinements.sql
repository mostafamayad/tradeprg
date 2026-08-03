-- Migration: 018_rbac_refinements
-- Granular permissions, special permissions, system_info table

-- ============================================================
-- 1. Add new granular user permissions (replace old users.*)
-- ============================================================
IF NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'users.view')
BEGIN
    INSERT INTO permissions (code, display_name, module) VALUES
    ('users.view', N'مشاهدة المستخدمين', 'users'),
    ('users.create', N'إضافة مستخدم', 'users'),
    ('users.edit', N'تعديل مستخدم', 'users'),
    ('users.delete', N'حذف مستخدم', 'users'),
    ('users.reset_password', N'إعادة تعيين كلمة المرور', 'users'),
    ('users.assign_roles', N'تعيين الأدوار للمستخدمين', 'users'),
    ('users.assign_permissions', N'تعيين الصلاحيات للمستخدمين', 'users');

    -- Remove old users permissions if they exist (they have generic names)
    DELETE FROM permissions WHERE code IN ('users.roles', 'users.update');
END

-- ============================================================
-- 2. Add granular inventory permissions
-- ============================================================
IF NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'inventory.count')
BEGIN
    INSERT INTO permissions (code, display_name, module) VALUES
    ('inventory.count', N'الجرد الفعلي', 'inventory'),
    ('inventory.disposal', N'توالف ومخلفات', 'inventory'),
    ('inventory.damaged', N'توالف ورواكد', 'inventory');
END

-- ============================================================
-- 3. Add granular sales permissions
-- ============================================================
IF NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'sales.reverse')
BEGIN
    INSERT INTO permissions (code, display_name, module) VALUES
    ('sales.reverse', N'عكس فاتورة بيع', 'sales'),
    ('sales.discount_approve', N'اعتماد خصم', 'sales');
END

-- ============================================================
-- 4. Add granular purchase permissions
-- ============================================================
IF NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'purchases.reverse')
BEGIN
    INSERT INTO permissions (code, display_name, module) VALUES
    ('purchases.reverse', N'عكس فاتورة شراء', 'purchases');
END

-- ============================================================
-- 5. Add journal permissions
-- ============================================================
IF NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'journals.view')
BEGIN
    INSERT INTO permissions (code, display_name, module) VALUES
    ('journals.view', N'مشاهدة قيود اليومية', 'journals'),
    ('journals.create', N'إنشاء قيد يومية', 'journals'),
    ('journals.edit', N'تعديل قيد يومية', 'journals'),
    ('journals.delete', N'حذف قيد يومية', 'journals'),
    ('journals.reverse', N'عكس قيد يومية', 'journals'),
    ('journals.approve', N'اعتماد قيد يومية', 'journals'),
    ('journals.post', N'ترحيل قيد يومية', 'journals');
END

-- ============================================================
-- 6. Add special/admin permissions
-- ============================================================
IF NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'special.close_period')
BEGIN
    INSERT INTO permissions (code, display_name, module, description) VALUES
    ('special.close_period', N'إقفال فترة مالية', 'special', N'صلاحية إقفال الفترات المالية'),
    ('special.reopen_period', N'إعادة فتح فترة مالية', 'special', N'صلاحية إعادة فتح الفترات المالية المغلقة'),
    ('special.reverse_journal', N'عكس قيد محاسبي', 'special', N'صلاحية عكس أي قيد محاسبي'),
    ('special.delete_journal', N'حذف قيد محاسبي', 'special', N'صلاحية حذف أي قيد محاسبي'),
    ('special.edit_chart_of_accounts', N'تعديل دليل الحساسبات', 'special', N'صلاحية إضافة/تعديل/حذف حسابات في دليل الحسابات'),
    ('special.fiscal_year', N'إدارة السنة المالية', 'special', N'صلاحية فتح وإقفال السنوات المالية'),
    ('special.database_backup', N'النسخ الاحتياطي', 'special', N'صلاحية أخذ نسخة احتياطية من قاعدة البيانات'),
    ('special.database_restore', N'استعادة نسخة احتياطية', 'special', N'صلاحية استعادة قاعدة البيانات من نسخة احتياطية'),
    ('special.license_manage', N'إدارة الترخيص', 'special', N'صلاحية إدارة ترخيص البرنامج'),
    ('special.company_settings', N'إعدادات الشركة', 'special', N'صلاحية تعديل إعدادات الشركة'),
    ('special.system_settings', N'إعدادات النظام', 'special', N'صلاحية تعديل إعدادات النظام العامة'),
    ('special.view_logs', N'مشاهدة سجل العمليات', 'special', N'صلاحية مشاهدة كامل سجل العمليات'),
    ('special.export_data', N'تصدير البيانات', 'special', N'صلاحية تصدير البيانات من النظام'),
    ('special.import_data', N'استيراد البيانات', 'special', N'صلاحية استيراد البيانات إلى النظام');
END

-- ============================================================
-- 7. Create system_info table for licensing
-- ============================================================
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[system_info]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[system_info] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [company_name] NVARCHAR(255) NULL,
        [license_code] NVARCHAR(255) NULL,
        [customer_code] NVARCHAR(100) NULL,
        [machine_fingerprint] NVARCHAR(500) NULL,
        [build_id] NVARCHAR(100) NULL,
        [edition] NVARCHAR(50) NULL,
        [installed_at] DATETIME DEFAULT GETDATE(),
        [owner_name] NVARCHAR(255) NULL,
        [owner_email] NVARCHAR(255) NULL,
        [notes] NVARCHAR(MAX) NULL,
        [updated_at] DATETIME DEFAULT GETDATE()
    );

    INSERT INTO system_info (company_name, build_id, installed_at)
    VALUES (N'شركتي', 'build-001', GETDATE());
END

-- ============================================================
-- 8. Create user_audit_log table for user-specific audit trail
-- ============================================================
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[user_audit_log]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[user_audit_log] (
        [id] BIGINT IDENTITY(1,1) PRIMARY KEY,
        [actor_id] INT NULL,
        [actor_name] NVARCHAR(255) NULL,
        [action] NVARCHAR(100) NOT NULL,
        [target_type] NVARCHAR(100) NULL,
        [target_id] INT NULL,
        [target_name] NVARCHAR(255) NULL,
        [old_value] NVARCHAR(MAX) NULL,
        [new_value] NVARCHAR(MAX) NULL,
        [details] NVARCHAR(MAX) NULL,
        [ip_address] NVARCHAR(50) NULL,
        [created_at] DATETIME DEFAULT GETDATE()
    );

    CREATE NONCLUSTERED INDEX IX_user_audit_log_actor ON user_audit_log(actor_id) INCLUDE (created_at);
    CREATE NONCLUSTERED INDEX IX_user_audit_log_target ON user_audit_log(target_type, target_id) INCLUDE (created_at);
    CREATE NONCLUSTERED INDEX IX_user_audit_log_action ON user_audit_log(action) INCLUDE (created_at);
END

-- ============================================================
-- 9. Grant all new permissions to super_admin and admin
-- ============================================================
IF EXISTS (SELECT 1 FROM roles WHERE name = 'super_admin')
BEGIN
    DECLARE @sa_id INT = (SELECT id FROM roles WHERE name = 'super_admin');
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT @sa_id, id FROM permissions p
    WHERE (p.code LIKE 'special.%' OR p.code LIKE 'journals.%' OR p.code IN ('inventory.count', 'inventory.disposal', 'inventory.damaged', 'sales.reverse', 'sales.discount_approve', 'purchases.reverse', 'users.view', 'users.create', 'users.edit', 'users.delete', 'users.reset_password', 'users.assign_roles', 'users.assign_permissions'))
    AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = @sa_id AND rp.permission_id = p.id);
END

IF EXISTS (SELECT 1 FROM roles WHERE name = 'admin')
BEGIN
    DECLARE @admin_id INT = (SELECT id FROM roles WHERE name = 'admin');
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT @admin_id, id FROM permissions p
    WHERE (p.code LIKE 'special.%' OR p.code LIKE 'journals.%' OR p.code IN ('inventory.count', 'inventory.disposal', 'inventory.damaged', 'sales.reverse', 'sales.discount_approve', 'purchases.reverse', 'users.view', 'users.create', 'users.edit', 'users.delete', 'users.reset_password', 'users.assign_roles', 'users.assign_permissions'))
    AND p.code NOT IN ('special.database_restore', 'special.license_manage')
    AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = @admin_id AND rp.permission_id = p.id);
END
