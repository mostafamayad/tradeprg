-- 020_validate_accounting_schema.sql
-- Validation of Chart of Accounts for ERP integrity

-- 1. Ensure Inventory Control Account exists
IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE system_code = 'SYS_INVENTORY')
BEGIN
    PRINT 'WARNING: System Code SYS_INVENTORY is missing from Chart of Accounts.';
    -- Try to auto-link if standard code '113' exists
    UPDATE chart_of_accounts SET system_code = 'SYS_INVENTORY' WHERE account_code = '113' AND system_code IS NULL;
END
GO

-- 2. Ensure Accounts Receivable (AR) exists
IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE system_code = 'SYS_AR')
BEGIN
    PRINT 'WARNING: System Code SYS_AR is missing from Chart of Accounts.';
    UPDATE chart_of_accounts SET system_code = 'SYS_AR' WHERE account_code = '112' AND system_code IS NULL;
END
GO

-- 3. Ensure Accounts Payable (AP) exists
IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE system_code = 'SYS_AP')
BEGIN
    PRINT 'WARNING: System Code SYS_AP is missing from Chart of Accounts.';
    UPDATE chart_of_accounts SET system_code = 'SYS_AP' WHERE account_code = '211' AND system_code IS NULL;
END
GO

-- 4. Check for duplicate control accounts
IF EXISTS (SELECT system_code FROM chart_of_accounts WHERE system_code IS NOT NULL GROUP BY system_code HAVING COUNT(*) > 1)
BEGIN
    PRINT 'CRITICAL ERROR: Duplicate System Codes found in Chart of Accounts! This will cause reporting errors.';
END
GO
