-- Migration: 006_gl_indexes
-- Add performance indexes for General Ledger queries
-- Idempotent: checks index existence first

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_journal_entries_entry_date')
BEGIN
    CREATE NONCLUSTERED INDEX IX_journal_entries_entry_date
    ON journal_entries (entry_date)
    INCLUDE (description, reference_type, entry_no);
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_journal_entry_lines_entry_id')
BEGIN
    CREATE NONCLUSTERED INDEX IX_journal_entry_lines_entry_id
    ON journal_entry_lines (entry_id)
    INCLUDE (account_id, debit, credit, description);
END
