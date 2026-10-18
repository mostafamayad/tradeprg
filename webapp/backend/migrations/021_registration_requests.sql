-- Migration 021: Registration Requests & Subscription Packages
-- Self-registration / demo tour / WhatsApp lead flow

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'subscription_packages')
BEGIN
    CREATE TABLE subscription_packages (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        name        NVARCHAR(100) NOT NULL,
        description NVARCHAR(500),
        price       DECIMAL(10,2) NOT NULL DEFAULT 0,
        period      NVARCHAR(50)  NOT NULL DEFAULT N'شهري',
        features    NVARCHAR(MAX),
        is_active   BIT NOT NULL DEFAULT 1,
        sort_order  INT NOT NULL DEFAULT 0,
        created_at  DATETIME NOT NULL DEFAULT GETDATE()
    );
    INSERT INTO subscription_packages (name, description, price, period, features, sort_order) VALUES
    (N'أساسي', N'مناسب للشركات الصغيرة والأعمال الناشئة', 299, N'شهري',
     N'["المبيعات والمشتريات","إدارة المخزون","حسابات العملاء والموردين","التقارير الأساسية","مستخدم واحد","دعم فني عبر واتساب"]', 1),
    (N'احترافي', N'للشركات المتوسطة التي تحتاج ميزات متقدمة', 599, N'شهري',
     N'["جميع ميزات الأساسي","الحسابات والمحاسبة الكاملة","الموارد البشرية والرواتب","CRM وإدارة المبيعات","5 مستخدمين","تقارير متقدمة","دعم فني مخصص"]', 2),
    (N'مؤسسي', N'للشركات الكبيرة بدون قيود', 1299, N'شهري',
     N'["جميع ميزات الاحترافي","مستخدمون غير محدودون","الأصول الثابتة","التحليلات المتقدمة والتنبؤات","لوحة تحكم تنفيذية","تخصيص كامل","مدير حساب مخصص"]', 3);
    PRINT 'Created subscription_packages table with default packages.';
END ELSE PRINT 'subscription_packages already exists, skipping.';

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'registration_requests')
BEGIN
    CREATE TABLE registration_requests (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        full_name    NVARCHAR(200) NOT NULL,
        email        NVARCHAR(300) NOT NULL,
        phone        NVARCHAR(50),
        company_name NVARCHAR(300),
        package_id   INT REFERENCES subscription_packages(id),
        package_name NVARCHAR(100),
        status       NVARCHAR(20) NOT NULL DEFAULT 'pending',
        notes        NVARCHAR(MAX),
        activated_by INT,
        activated_at DATETIME,
        ip_address   NVARCHAR(50),
        created_at   DATETIME NOT NULL DEFAULT GETDATE(),
        updated_at   DATETIME NOT NULL DEFAULT GETDATE()
    );
    CREATE INDEX IX_reg_requests_status ON registration_requests(status);
    CREATE INDEX IX_reg_requests_email  ON registration_requests(email);
    PRINT 'Created registration_requests table.';
END ELSE PRINT 'registration_requests already exists, skipping.';
