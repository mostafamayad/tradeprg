-- Migration: 011_commission_coa
-- Chart of Accounts additions for commission system
-- Idempotent: checks system_code existence before insertion

-- Commission Expense
IF NOT EXISTS (SELECT * FROM chart_of_accounts WHERE system_code = 'SYS_COMMISSION_EXPENSE')
BEGIN
    INSERT INTO chart_of_accounts (account_code, account_name, parent_id, account_type, current_balance, is_active, system_code)
    SELECT '551', 'مصروف العمولات', id, 'expense', 0, 1, 'SYS_COMMISSION_EXPENSE'
    FROM chart_of_accounts WHERE system_code = 'SYS_EXPENSE' AND is_active = 1;
END
GO

-- Commission Payable
IF NOT EXISTS (SELECT * FROM chart_of_accounts WHERE system_code = 'SYS_COMMISSION_PAYABLE')
BEGIN
    INSERT INTO chart_of_accounts (account_code, account_name, parent_id, account_type, current_balance, is_active, system_code)
    SELECT '221', 'مستحقات المندوبين', id, 'liability', 0, 1, 'SYS_COMMISSION_PAYABLE'
    FROM chart_of_accounts WHERE system_code = 'SYS_AP' AND is_active = 1;
END
GO

-- Bonus Expense
IF NOT EXISTS (SELECT * FROM chart_of_accounts WHERE system_code = 'SYS_BONUS_EXPENSE')
BEGIN
    INSERT INTO chart_of_accounts (account_code, account_name, parent_id, account_type, current_balance, is_active, system_code)
    SELECT '552', 'مصروف مكافآت المندوبين', id, 'expense', 0, 1, 'SYS_BONUS_EXPENSE'
    FROM chart_of_accounts WHERE system_code = 'SYS_COMMISSION_EXPENSE' AND is_active = 1;
END
GO

-- Penalty Expense
IF NOT EXISTS (SELECT * FROM chart_of_accounts WHERE system_code = 'SYS_PENALTY_EXPENSE')
BEGIN
    INSERT INTO chart_of_accounts (account_code, account_name, parent_id, account_type, current_balance, is_active, system_code)
    SELECT '553', 'مصروف خصومات المندوبين', id, 'expense', 0, 1, 'SYS_PENALTY_EXPENSE'
    FROM chart_of_accounts WHERE system_code = 'SYS_COMMISSION_EXPENSE' AND is_active = 1;
END
GO

PRINT 'Migration 011_commission_coa completed successfully';
