-- Migration: 014_commission_settings
-- Commission module settings
-- Idempotent: checks setting existence before insertion

-- Collection allocation method
IF OBJECT_ID('settings') IS NOT NULL AND NOT EXISTS (SELECT * FROM settings WHERE [key] = 'commission.collection_allocation')
BEGIN
    INSERT INTO settings ([key], [value])
    VALUES ('commission.collection_allocation', 'fifo');
END
GO

-- Overdue block days
IF OBJECT_ID('settings') IS NOT NULL AND NOT EXISTS (SELECT * FROM settings WHERE [key] = 'commission.overdue_block_days')
BEGIN
    INSERT INTO settings ([key], [value])
    VALUES ('commission.overdue_block_days', '30');
END
GO

-- Default plan ID
IF OBJECT_ID('settings') IS NOT NULL AND NOT EXISTS (SELECT * FROM settings WHERE [key] = 'commission.default_plan_id')
BEGIN
    INSERT INTO settings ([key], [value])
    VALUES ('commission.default_plan_id', '1');
END
GO

-- Commission who receives
IF OBJECT_ID('settings') IS NOT NULL AND NOT EXISTS (SELECT * FROM settings WHERE [key] = 'commission.who_receives')
BEGIN
    INSERT INTO settings ([key], [value])
    VALUES ('commission.who_receives', 'rep');
END
GO

-- Commission split percentage (if who_receives = split)
IF OBJECT_ID('settings') IS NOT NULL AND NOT EXISTS (SELECT * FROM settings WHERE [key] = 'commission.split_rep_pct')
BEGIN
    INSERT INTO settings ([key], [value])
    VALUES ('commission.split_rep_pct', '50');
END
GO

-- Schema version for commission snapshot
IF OBJECT_ID('settings') IS NOT NULL AND NOT EXISTS (SELECT * FROM settings WHERE [key] = 'commission.snapshot_schema_version')
BEGIN
    INSERT INTO settings ([key], [value])
    VALUES ('commission.snapshot_schema_version', '1.0');
END
GO

-- Calculation version
IF OBJECT_ID('settings') IS NOT NULL AND NOT EXISTS (SELECT * FROM settings WHERE [key] = 'commission.calculation_version')
BEGIN
    INSERT INTO settings ([key], [value])
    VALUES ('commission.calculation_version', '1.0');
END
GO

PRINT 'Migration 014_commission_settings completed successfully';
