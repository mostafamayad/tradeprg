-- 019_add_subledger_tracking.sql
-- Add customer_id and supplier_id to journal_entries for direct sub-ledger querying

-- 1. Add Columns
IF COL_LENGTH('journal_entries', 'customer_id') IS NULL
BEGIN
    ALTER TABLE journal_entries ADD customer_id INT NULL;
    ALTER TABLE journal_entries ADD supplier_id INT NULL;
END
GO

-- 2. Backfill existing data
UPDATE je
SET je.customer_id = si.customer_id
FROM journal_entries je
JOIN sales_invoices si ON je.reference_type = 'sales' AND je.reference_id = si.id
WHERE je.customer_id IS NULL;

UPDATE je
SET je.customer_id = cc.customer_id
FROM journal_entries je
JOIN customer_collections cc ON je.reference_type = 'collection' AND je.reference_id = cc.id
WHERE je.customer_id IS NULL;

UPDATE je
SET je.customer_id = sr.customer_id
FROM journal_entries je
JOIN sales_returns sr ON je.reference_type = 'sales_return' AND je.reference_id = sr.id
WHERE je.customer_id IS NULL;

UPDATE je
SET je.supplier_id = pi.supplier_id
FROM journal_entries je
JOIN purchase_invoices pi ON je.reference_type = 'purchase' AND je.reference_id = pi.id
WHERE je.supplier_id IS NULL;

UPDATE je
SET je.supplier_id = sp.supplier_id
FROM journal_entries je
JOIN supplier_payments sp ON je.reference_type = 'payment' AND je.reference_id = sp.id
WHERE je.supplier_id IS NULL;

UPDATE je
SET je.supplier_id = pr.supplier_id
FROM journal_entries je
JOIN purchase_returns pr ON je.reference_type = 'purchase_return' AND je.reference_id = pr.id
WHERE je.supplier_id IS NULL;
GO

-- 3. Create Covering Indexes
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_JournalLine_Account_Date')
BEGIN
    CREATE NONCLUSTERED INDEX IX_JournalLine_Account_Date 
    ON journal_entry_lines (account_id) -- Removed tenant_id since schema doesn't seem to have tenant_id in lines yet
    INCLUDE (entry_id, debit, credit, description);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Journal_Date_Reversed')
BEGIN
    CREATE NONCLUSTERED INDEX IX_Journal_Date_Reversed 
    ON journal_entries (entry_date, is_reversed)
    INCLUDE (id, entry_no, reference_type, reference_id, total_debit, total_credit, customer_id, supplier_id);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Journal_Customer_Date')
BEGIN
    CREATE NONCLUSTERED INDEX IX_Journal_Customer_Date 
    ON journal_entries (customer_id, entry_date, is_reversed)
    INCLUDE (id, total_debit, total_credit);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Journal_Supplier_Date')
BEGIN
    CREATE NONCLUSTERED INDEX IX_Journal_Supplier_Date 
    ON journal_entries (supplier_id, entry_date, is_reversed)
    INCLUDE (id, total_debit, total_credit);
END
GO
