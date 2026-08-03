-- Migration: 017_rbac_system
-- Complete Role-Based Access Control system
-- Idempotent: each operation checks existence first

-- ============================================================
-- 1. Add is_super_admin column to users
-- ============================================================
IF COL_LENGTH('users', 'is_super_admin') IS NULL
    ALTER TABLE users ADD is_super_admin BIT DEFAULT 0;

IF COL_LENGTH('users', 'avatar') IS NULL
    ALTER TABLE users ADD avatar NVARCHAR(500) NULL;

-- ============================================================
-- 2. Create roles table
-- ============================================================
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[roles]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[roles] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [name] NVARCHAR(100) NOT NULL UNIQUE,
        [display_name] NVARCHAR(255) NOT NULL,
        [description] NVARCHAR(500) NULL,
        [is_system] BIT DEFAULT 0,
        [created_at] DATETIME DEFAULT GETDATE()
    );
END

-- ============================================================
-- 3. Create permissions table
-- ============================================================
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[permissions]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[permissions] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [code] NVARCHAR(100) NOT NULL UNIQUE,
        [display_name] NVARCHAR(255) NOT NULL,
        [module] NVARCHAR(100) NOT NULL,
        [description] NVARCHAR(500) NULL,
        [created_at] DATETIME DEFAULT GETDATE()
    );
END

-- ============================================================
-- 4. Create role_permissions pivot table
-- ============================================================
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[role_permissions]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[role_permissions] (
        [role_id] INT NOT NULL,
        [permission_id] INT NOT NULL,
        PRIMARY KEY (role_id, permission_id),
        FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
        FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
    );
END

-- ============================================================
-- 5. Create user_roles pivot table
-- ============================================================
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[user_roles]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[user_roles] (
        [user_id] INT NOT NULL,
        [role_id] INT NOT NULL,
        PRIMARY KEY (user_id, role_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
    );
END

-- ============================================================
-- 6. Seed all system permissions
-- ============================================================
IF NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'dashboard.view')
BEGIN
    INSERT INTO permissions (code, display_name, module) VALUES
    -- Dashboard
    ('dashboard.view', N'مشاهدة لوحة التحكم', 'dashboard'),

    -- Sales
    ('sales.view', N'مشاهدة فواتير المبيعات', 'sales'),
    ('sales.create', N'إنشاء فاتورة بيع', 'sales'),
    ('sales.update', N'تعديل فاتورة بيع', 'sales'),
    ('sales.delete', N'حذف فاتورة بيع', 'sales'),
    ('sales.approve', N'اعتماد فاتورة بيع', 'sales'),
    ('sales.print', N'طباعة فاتورة بيع', 'sales'),
    ('sales.export', N'تصدير فواتير المبيعات', 'sales'),

    -- Sales Returns
    ('sales_returns.view', N'مشاهدة مرتجعات المبيعات', 'sales_returns'),
    ('sales_returns.create', N'إنشاء مرتجع بيع', 'sales_returns'),
    ('sales_returns.update', N'تعديل مرتجع بيع', 'sales_returns'),
    ('sales_returns.delete', N'حذف مرتجع بيع', 'sales_returns'),
    ('sales_returns.approve', N'اعتماد مرتجع بيع', 'sales_returns'),

    -- Purchases
    ('purchases.view', N'مشاهدة فواتير المشتريات', 'purchases'),
    ('purchases.create', N'إنشاء فاتورة شراء', 'purchases'),
    ('purchases.update', N'تعديل فاتورة شراء', 'purchases'),
    ('purchases.delete', N'حذف فاتورة شراء', 'purchases'),
    ('purchases.approve', N'اعتماد فاتورة شراء', 'purchases'),
    ('purchases.print', N'طباعة فاتورة شراء', 'purchases'),

    -- Purchase Returns
    ('purchase_returns.view', N'مشاهدة مرتجعات المشتريات', 'purchase_returns'),
    ('purchase_returns.create', N'إنشاء مرتجع شراء', 'purchase_returns'),
    ('purchase_returns.update', N'تعديل مرتجع شراء', 'purchase_returns'),
    ('purchase_returns.delete', N'حذف مرتجع شراء', 'purchase_returns'),
    ('purchase_returns.approve', N'اعتماد مرتجع شراء', 'purchase_returns'),

    -- Customers
    ('customers.view', N'مشاهدة العملاء', 'customers'),
    ('customers.create', N'إضافة عميل', 'customers'),
    ('customers.update', N'تعديل عميل', 'customers'),
    ('customers.delete', N'حذف عميل', 'customers'),
    ('customers.export', N'تصدير العملاء', 'customers'),
    ('customers.block', N'حظر/إلغاء حظر عميل', 'customers'),

    -- Collections (Customer Payments)
    ('collections.view', N'مشاهدة التحصيلات', 'collections'),
    ('collections.create', N'تسجيل تحصيل', 'collections'),
    ('collections.update', N'تعديل تحصيل', 'collections'),
    ('collections.delete', N'حذف تحصيل', 'collections'),

    -- Suppliers
    ('suppliers.view', N'مشاهدة الموردين', 'suppliers'),
    ('suppliers.create', N'إضافة مورد', 'suppliers'),
    ('suppliers.update', N'تعديل مورد', 'suppliers'),
    ('suppliers.delete', N'حذف مورد', 'suppliers'),

    -- Payments (Supplier Payments)
    ('payments.view', N'مشاهدة مدفوعات الموردين', 'payments'),
    ('payments.create', N'تسجيل دفعة مورد', 'payments'),
    ('payments.update', N'تعديل دفعة مورد', 'payments'),
    ('payments.delete', N'حذف دفعة مورد', 'payments'),

    -- Products / Inventory
    ('products.view', N'مشاهدة المنتجات', 'products'),
    ('products.create', N'إضافة منتج', 'products'),
    ('products.update', N'تعديل منتج', 'products'),
    ('products.delete', N'حذف منتج', 'products'),
    ('inventory.view', N'مشاهدة المخزون', 'inventory'),
    ('inventory.adjust', N'تسوية مخزون', 'inventory'),
    ('inventory.transfer', N'تحويل مخزون', 'inventory'),

    -- Stores
    ('stores.view', N'مشاهدة المخازن', 'stores'),
    ('stores.create', N'إضافة مخزن', 'stores'),
    ('stores.update', N'تعديل مخزن', 'stores'),
    ('stores.delete', N'حذف مخزن', 'stores'),

    -- Sales Reps
    ('reps.view', N'مشاهدة المندوبين', 'reps'),
    ('reps.create', N'إضافة مندوب', 'reps'),
    ('reps.update', N'تعديل مندوب', 'reps'),
    ('reps.delete', N'حذف مندوب', 'reps'),

    -- Treasury
    ('treasury.view', N'مشاهدة الخزينة', 'treasury'),
    ('treasury.create', N'إيداع/صرف خزينة', 'treasury'),
    ('treasury.update', N'تعديل حركة خزينة', 'treasury'),
    ('treasury.delete', N'حذف حركة خزينة', 'treasury'),

    -- Accounting
    ('accounting.view', N'مشاهدة الحسابات', 'accounting'),
    ('accounting.journals', N'إدارة قيود اليومية', 'accounting'),
    ('accounting.trial_balance', N'ميزان المراجعة', 'accounting'),
    ('accounting.income_statement', N'قائمة الدخل', 'accounting'),
    ('accounting.balance_sheet', N'الميزانية العمومية', 'accounting'),
    ('accounting.ledger', N'الأستاذ العام', 'accounting'),
    ('accounts.view', N'مشاهدة دليل الحسابات', 'accounts'),
    ('accounts.create', N'إضافة حساب', 'accounts'),
    ('accounts.update', N'تعديل حساب', 'accounts'),
    ('accounts.delete', N'حذف حساب', 'accounts'),

    -- Reports
    ('reports.view', N'مشاهدة التقارير', 'reports'),
    ('reports.sales', N'تقارير المبيعات', 'reports'),
    ('reports.purchases', N'تقارير المشتريات', 'reports'),
    ('reports.inventory', N'تقارير المخزون', 'reports'),
    ('reports.profit', N'تقارير الأرباح', 'reports'),
    ('reports.customers', N'تقارير العملاء', 'reports'),
    ('reports.suppliers', N'تقارير الموردين', 'reports'),

    -- Users & Roles
    ('users.view', N'مشاهدة المستخدمين', 'users'),
    ('users.create', N'إضافة مستخدم', 'users'),
    ('users.update', N'تعديل مستخدم', 'users'),
    ('users.delete', N'حذف مستخدم', 'users'),
    ('users.roles', N'إدارة الأدوار والصلاحيات', 'users'),

    -- Settings
    ('settings.view', N'مشاهدة الإعدادات', 'settings'),
    ('settings.update', N'تعديل الإعدادات', 'settings'),

    -- Logs
    ('logs.view', N'مشاهدة سجل العمليات', 'logs'),

    -- Commission
    ('commission.view', N'مشاهدة العمولات', 'commission'),
    ('commission.manage', N'إدارة العمولات', 'commission'),

    -- Fiscal Periods
    ('fiscal_periods.view', N'مشاهدة الفترات المالية', 'fiscal_periods'),
    ('fiscal_periods.create', N'إنشاء فترة مالية', 'fiscal_periods'),
    ('fiscal_periods.close', N'إغلاق فترة مالية', 'fiscal_periods'),
    ('fiscal_periods.reopen', N'إعادة فتح فترة مالية', 'fiscal_periods'),

    -- HR
    ('hr.view', N'مشاهدة شؤون الموظفين', 'hr'),
    ('hr.manage', N'إدارة شؤون الموظفين', 'hr');
END

-- ============================================================
-- 7. Seed system roles
-- ============================================================
IF NOT EXISTS (SELECT 1 FROM roles WHERE name = 'super_admin')
BEGIN
    INSERT INTO roles (name, display_name, description, is_system) VALUES
    ('super_admin', N'مدير النظام', N'صلاحية كاملة على جميع أجزاء النظام', 1),
    ('admin', N'مدير', N'صلاحية كاملة على معظم أجزاء النظام', 1),
    ('accountant', N'محاسب', N'صلاحية على الحسابات والقيود والتقارير المالية', 0),
    ('sales_manager', N'مدير مبيعات', N'صلاحية على المبيعات والعملاء والتحصيلات', 0),
    ('sales_rep', N'مندوب مبيعات', N'صلاحية محدودة على المبيعات والعملاء', 0),
    ('purchasing_manager', N'مدير مشتريات', N'صلاحية على المشتريات والموردين', 0),
    ('store_keeper', N'أمين مخزن', N'صلاحية على المخزون والمنتجات', 0),
    ('viewer', N'مشاهد فقط', N'صلاحية مشاهدة فقط لجميع التقارير', 0);
END

-- ============================================================
-- 8. Assign all permissions to super_admin and admin roles
-- ============================================================
IF NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id = (SELECT id FROM roles WHERE name = 'super_admin'))
BEGIN
    DECLARE @sa_id INT = (SELECT id FROM roles WHERE name = 'super_admin');
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT @sa_id, id FROM permissions;
END

IF NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id = (SELECT id FROM roles WHERE name = 'admin'))
BEGIN
    DECLARE @admin_id INT = (SELECT id FROM roles WHERE name = 'admin');
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT @admin_id, id FROM permissions
    WHERE code NOT IN ('users.roles');
END

-- ============================================================
-- 9. Mark user ID 1 (default admin) as super_admin
-- ============================================================
UPDATE users SET is_super_admin = 1 WHERE id = 1;

-- ============================================================
-- 10. Create indexes for performance
-- ============================================================
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_role_permissions_role_id')
    CREATE NONCLUSTERED INDEX IX_role_permissions_role_id ON role_permissions(role_id) INCLUDE (permission_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_role_permissions_permission_id')
    CREATE NONCLUSTERED INDEX IX_role_permissions_permission_id ON role_permissions(permission_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_user_roles_user_id')
    CREATE NONCLUSTERED INDEX IX_user_roles_user_id ON user_roles(user_id) INCLUDE (role_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_permissions_module')
    CREATE NONCLUSTERED INDEX IX_permissions_module ON permissions(module) INCLUDE (code, display_name);
