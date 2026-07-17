-- Migration: 010_commission_indexes
-- Performance indexes for commission tables
-- Idempotent: checks index existence before creation

-- commission_transactions indexes
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_commission_tx_company_period' AND object_id = OBJECT_ID('commission_transactions'))
BEGIN
    CREATE INDEX IX_commission_tx_company_period ON commission_transactions(company_id, period);
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_commission_tx_rep_status' AND object_id = OBJECT_ID('commission_transactions'))
BEGIN
    CREATE INDEX IX_commission_tx_rep_status ON commission_transactions(rep_id, workflow_status);
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_commission_tx_collection' AND object_id = OBJECT_ID('commission_transactions'))
BEGIN
    CREATE INDEX IX_commission_tx_collection ON commission_transactions(collection_id);
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_commission_tx_period_status' AND object_id = OBJECT_ID('commission_transactions'))
BEGIN
    CREATE INDEX IX_commission_tx_period_status ON commission_transactions(period, workflow_status);
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_commission_tx_plan' AND object_id = OBJECT_ID('commission_transactions'))
BEGIN
    CREATE INDEX IX_commission_tx_plan ON commission_transactions(plan_id);
END
GO

-- commission_adjustments indexes
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_commission_adj_rep_period' AND object_id = OBJECT_ID('commission_adjustments'))
BEGIN
    CREATE INDEX IX_commission_adj_rep_period ON commission_adjustments(rep_id, period);
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_commission_adj_status' AND object_id = OBJECT_ID('commission_adjustments'))
BEGIN
    CREATE INDEX IX_commission_adj_status ON commission_adjustments(workflow_status);
END
GO

-- commission_payment_vouchers indexes
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_commission_voucher_rep_period' AND object_id = OBJECT_ID('commission_payment_vouchers'))
BEGIN
    CREATE INDEX IX_commission_voucher_rep_period ON commission_payment_vouchers(rep_id, period);
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_commission_voucher_status' AND object_id = OBJECT_ID('commission_payment_vouchers'))
BEGIN
    CREATE INDEX IX_commission_voucher_status ON commission_payment_vouchers(workflow_status);
END
GO

-- commission_voucher_lines indexes
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_voucher_lines_voucher' AND object_id = OBJECT_ID('commission_voucher_lines'))
BEGIN
    CREATE INDEX IX_voucher_lines_voucher ON commission_voucher_lines(voucher_id);
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_voucher_lines_transaction' AND object_id = OBJECT_ID('commission_voucher_lines'))
BEGIN
    CREATE INDEX IX_voucher_lines_transaction ON commission_voucher_lines(transaction_id);
END
GO

-- commission_audit_log indexes
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_commission_audit_entity' AND object_id = OBJECT_ID('commission_audit_log'))
BEGIN
    CREATE INDEX IX_commission_audit_entity ON commission_audit_log(entity_type, entity_id);
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_commission_audit_performed' AND object_id = OBJECT_ID('commission_audit_log'))
BEGIN
    CREATE INDEX IX_commission_audit_performed ON commission_audit_log(performed_at);
END
GO

-- commission_tiers index
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_commission_tiers_plan' AND object_id = OBJECT_ID('commission_tiers'))
BEGIN
    CREATE INDEX IX_commission_tiers_plan ON commission_tiers(plan_id);
END
GO

PRINT 'Migration 010_commission_indexes completed successfully';
