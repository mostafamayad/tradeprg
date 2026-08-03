-- 015_coa_restructure.sql
-- Restructure Chart of Accounts for Perpetual Inventory
-- Part of Quick Release stabilization
-- Idempotent: safe to run multiple times

DECLARE @parent41 INT, @parent5 INT, @parent6 INT;

-- 1. Rename '5' from المصروفات to تكلفة المبيعات
UPDATE chart_of_accounts
SET account_name = N'تكلفة المبيعات'
WHERE account_code = '5' AND account_name != N'تكلفة المبيعات';

-- 2. Add '6' المصروفات as new top-level (if not exists)
IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = '6')
BEGIN
    INSERT INTO chart_of_accounts (account_code, account_name, account_type, is_active, current_balance)
    VALUES ('6', N'المصروفات', 'expense', 1, 0);
END

-- 3. Move SYS_SALES_RETURNS from 56/expense to 412/revenue under 41
SELECT @parent41 = id FROM chart_of_accounts WHERE account_code = '41';
IF @parent41 IS NOT NULL
BEGIN
    UPDATE chart_of_accounts
    SET account_code = '412',
        account_type = 'revenue',
        parent_id = @parent41
    WHERE system_code = 'SYS_SALES_RETURNS' AND account_code != '412';
END

-- 4. Add SYS_SALES_DISCOUNT as 413 under 41 (if not exists)
IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE system_code = 'SYS_SALES_DISCOUNT')
BEGIN
    INSERT INTO chart_of_accounts (account_code, account_name, parent_id, account_type, is_active, current_balance, system_code)
    SELECT '413', N'الخصومات المسموح بها', id, 'revenue', 1, 0, 'SYS_SALES_DISCOUNT'
    FROM chart_of_accounts WHERE account_code = '41';
END

-- 5. Move 53, 54, 55 from parent '5' to parent '6'
SELECT @parent6 = id FROM chart_of_accounts WHERE account_code = '6';
IF @parent6 IS NOT NULL
BEGIN
    UPDATE coa
    SET parent_id = @parent6
    FROM chart_of_accounts coa
    WHERE coa.account_code IN ('53', '54', '55')
      AND ISNULL(coa.parent_id, 0) != @parent6;
END

-- 6. Set SYS_PURCHASES is_active = 0 (legacy account)
UPDATE chart_of_accounts
SET is_active = 0
WHERE system_code = 'SYS_PURCHASES' AND is_active = 1;

-- 7. Create sub-groups under '6' (if they don't exist)
IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = '61')
    INSERT INTO chart_of_accounts (account_code, account_name, parent_id, account_type, is_active, current_balance)
    SELECT '61', N'مصروفات البيع والتوزيع', id, 'expense', 1, 0
    FROM chart_of_accounts WHERE account_code = '6';

IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = '62')
    INSERT INTO chart_of_accounts (account_code, account_name, parent_id, account_type, is_active, current_balance)
    SELECT '62', N'المصروفات العمومية والإدارية', id, 'expense', 1, 0
    FROM chart_of_accounts WHERE account_code = '6';

IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = '63')
    INSERT INTO chart_of_accounts (account_code, account_name, parent_id, account_type, is_active, current_balance)
    SELECT '63', N'المصروفات التشغيلية', id, 'expense', 1, 0
    FROM chart_of_accounts WHERE account_code = '6';

IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = '64')
    INSERT INTO chart_of_accounts (account_code, account_name, parent_id, account_type, is_active, current_balance)
    SELECT '64', N'المصروفات المالية', id, 'expense', 1, 0
    FROM chart_of_accounts WHERE account_code = '6';

IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = '65')
    INSERT INTO chart_of_accounts (account_code, account_name, parent_id, account_type, is_active, current_balance)
    SELECT '65', N'خسائر وانخفاضات', id, 'expense', 1, 0
    FROM chart_of_accounts WHERE account_code = '6';

IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = '66')
    INSERT INTO chart_of_accounts (account_code, account_name, parent_id, account_type, is_active, current_balance)
    SELECT '66', N'الإهلاك والإطفاء', id, 'expense', 1, 0
    FROM chart_of_accounts WHERE account_code = '6';
