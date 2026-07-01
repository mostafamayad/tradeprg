-- Migration: 003_sales_returns_index
-- Composite index for sales returns statement queries (join on invoice_id + filter on status)
-- Idempotent: checks existence first

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sales_returns_invoice_id_status')
    CREATE INDEX IX_sales_returns_invoice_id_status ON sales_returns(invoice_id, status);
