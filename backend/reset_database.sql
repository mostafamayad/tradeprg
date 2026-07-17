USE [TradePro];
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

PRINT 'Step 1: Disabling all FK constraints...';

-- تعطيل كل قيود العلاقات ديناميكياً
DECLARE @sql NVARCHAR(MAX) = N'';
SELECT @sql += 'ALTER TABLE [' + OBJECT_NAME(parent_object_id) + '] NOCHECK CONSTRAINT [' + name + '];' + CHAR(13)
FROM sys.foreign_keys;
EXEC sp_executesql @sql;

PRINT 'Step 2: Deleting all data from all tables...';

-- مسح كل الجداول ديناميكياً
SET @sql = N'';
SELECT @sql += 'DELETE FROM [' + TABLE_NAME + '];' + CHAR(13)
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_TYPE = 'BASE TABLE'
  AND TABLE_NAME NOT IN ('schema_versions'); -- الجداول التي لا تُمسح
EXEC sp_executesql @sql;

PRINT 'Step 3: Re-enabling all FK constraints...';

-- إعادة تفعيل قيود العلاقات
SET @sql = N'';
SELECT @sql += 'ALTER TABLE [' + OBJECT_NAME(parent_object_id) + '] WITH CHECK CHECK CONSTRAINT [' + name + '];' + CHAR(13)
FROM sys.foreign_keys;
EXEC sp_executesql @sql;

PRINT 'Step 4: Re-seeding default data...';

-- معلومات الشركة
INSERT INTO company_info (company_name, currency)
VALUES (N'شركتي للتجارة', 'EGP');

-- المخزن الرئيسي
INSERT INTO stores (store_code, store_name, store_type)
VALUES ('ST001', N'المخزن الرئيسي', 'main');

-- الخزينة الرئيسية
INSERT INTO treasury_accounts (account_name, account_type, opening_balance, current_balance)
VALUES (N'الخزينة الرئيسية', 'cash', 0, 0);

-- حساب الأدمن (الباسوورد: admin123)
INSERT INTO users (username, password_hash, full_name, role)
VALUES (
    'admin@3smcompany.com',
    '$2a$10$OTHmPcWF4NOF0iY9R8mXievWrlsYONqpJ0cRpTvSc7UjD.41Q0r2G',
    N'مدير النظام',
    'admin'
);

PRINT '';
PRINT '============================================';
PRINT 'Reset Complete! Database is 100% clean.';
PRINT 'Login:    admin@3smcompany.com';
PRINT 'Password: admin123';
PRINT '============================================';
GO
