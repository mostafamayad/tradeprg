-- Migration: 005_fiscal_periods
-- Add fiscal period management for accounting period control
-- Idempotent: checks table existence first

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'fiscal_periods')
BEGIN
    CREATE TABLE fiscal_periods (
        id INT IDENTITY(1,1) PRIMARY KEY,
        name NVARCHAR(100) NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        status NVARCHAR(20) NOT NULL DEFAULT 'open',
        opened_by INT NULL REFERENCES users(id),
        closed_by INT NULL REFERENCES users(id),
        opened_at DATETIME DEFAULT GETDATE(),
        closed_at DATETIME NULL,
        notes NVARCHAR(MAX) NULL,
        CONSTRAINT uq_fiscal_period_name UNIQUE (name),
        CONSTRAINT ck_fiscal_period_dates CHECK (end_date >= start_date),
        CONSTRAINT ck_fiscal_period_status CHECK (status IN ('open', 'closed'))
    );
END
