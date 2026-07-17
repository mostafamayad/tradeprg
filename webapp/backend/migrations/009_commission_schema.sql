-- Migration: 009_commission_schema
-- Commission System: Plans, Tiers, Transactions, Adjustments, Vouchers, Periods, Audit
-- Idempotent: checks table existence before creation

-- ============================================================
-- 1. Commission Plans (versioned)
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[commission_plans]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[commission_plans] (
        [id]              INT IDENTITY(1,1) PRIMARY KEY,
        [company_id]      INT NULL,
        [plan_name]       NVARCHAR(255) NOT NULL,
        [base_rate]       DECIMAL(18,4) NOT NULL DEFAULT 0,
        [effective_from]  DATE NOT NULL,
        [effective_to]    DATE NULL,
        [is_active]       INT DEFAULT 1,
        [created_at]      DATETIME DEFAULT GETDATE()
    );
END
GO

-- ============================================================
-- 2. Commission Tiers (per plan, versioned)
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[commission_tiers]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[commission_tiers] (
        [id]              INT IDENTITY(1,1) PRIMARY KEY,
        [plan_id]         INT NOT NULL,
        [from_percent]    DECIMAL(18,4) NOT NULL DEFAULT 0,
        [to_percent]      DECIMAL(18,4) NOT NULL DEFAULT 100,
        [multiplier]      DECIMAL(18,4) NOT NULL DEFAULT 1.0,
        [tier_label]      NVARCHAR(255) NULL,
        [effective_from]  DATE NOT NULL,
        [effective_to]    DATE NULL,
        CONSTRAINT FK_commission_tiers_plan FOREIGN KEY (plan_id) REFERENCES commission_plans(id)
    );
END
GO

-- ============================================================
-- 3. Commission Transactions (main ledger)
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[commission_transactions]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[commission_transactions] (
        [id]                    INT IDENTITY(1,1) PRIMARY KEY,
        [company_id]            INT NULL,
        [rep_id]                INT NOT NULL,
        [plan_id]               INT NOT NULL,
        [collection_id]         INT NULL,
        [collection_amount]     DECIMAL(18,4) NOT NULL DEFAULT 0,
        [rep_name]              NVARCHAR(255) NULL,
        [customer_name]         NVARCHAR(255) NULL,
        [invoice_no]            NVARCHAR(255) NULL,
        [collection_no]         NVARCHAR(255) NULL,
        [invoice_date]          NVARCHAR(255) NULL,
        [collection_date]       NVARCHAR(255) NULL,
        [period]                NVARCHAR(20) NOT NULL,
        [base_rate]             DECIMAL(18,4) NOT NULL DEFAULT 0,
        [achievement_pct]       DECIMAL(18,4) NOT NULL DEFAULT 0,
        [tier_multiplier]       DECIMAL(18,4) NOT NULL DEFAULT 1.0,
        [effective_rate]        DECIMAL(18,4) NOT NULL DEFAULT 0,
        [commission_amount]     DECIMAL(18,4) NOT NULL DEFAULT 0,
        [snapshot]              NVARCHAR(MAX) NULL,
        [workflow_status]       INT NOT NULL DEFAULT 0,
        [is_posted_to_gl]       INT NOT NULL DEFAULT 0,
        [is_paid]               INT NOT NULL DEFAULT 0,
        [reviewed_by]           INT NULL,
        [reviewed_at]           DATETIME NULL,
        [approved_by]           INT NULL,
        [approved_at]           DATETIME NULL,
        [locked_at]             DATETIME NULL,
        [settled_at]            DATETIME NULL,
        [journal_entry_id]      INT NULL,
        [notes]                 NVARCHAR(MAX) NULL,
        [created_at]            DATETIME DEFAULT GETDATE()
    );
END
GO

-- ============================================================
-- 4. Commission Adjustments (bonuses, penalties, manual, clawbacks)
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[commission_adjustments]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[commission_adjustments] (
        [id]                INT IDENTITY(1,1) PRIMARY KEY,
        [company_id]        INT NULL,
        [rep_id]            INT NOT NULL,
        [period]            NVARCHAR(20) NOT NULL,
        [type]              NVARCHAR(50) NOT NULL,
        [amount]            DECIMAL(18,4) NOT NULL DEFAULT 0,
        [reason]            NVARCHAR(MAX) NOT NULL,
        [reference_type]    NVARCHAR(100) NULL,
        [reference_id]      INT NULL,
        [workflow_status]   INT NOT NULL DEFAULT 0,
        [is_posted_to_gl]   INT NOT NULL DEFAULT 0,
        [is_paid]           INT NOT NULL DEFAULT 0,
        [approved_by]       INT NULL,
        [approved_at]       DATETIME NULL,
        [journal_entry_id]  INT NULL,
        [created_by]        INT NULL,
        [created_at]        DATETIME DEFAULT GETDATE()
    );
END
GO

-- ============================================================
-- 5. Commission Payment Vouchers
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[commission_payment_vouchers]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[commission_payment_vouchers] (
        [id]                    INT IDENTITY(1,1) PRIMARY KEY,
        [company_id]            INT NULL,
        [voucher_no]            NVARCHAR(255) NOT NULL UNIQUE,
        [voucher_date]          NVARCHAR(255) NOT NULL,
        [rep_id]                INT NOT NULL,
        [period]                NVARCHAR(20) NULL,
        [total_amount]          DECIMAL(18,4) NOT NULL DEFAULT 0,
        [workflow_status]       INT NOT NULL DEFAULT 0,
        [paid_by]               INT NULL,
        [paid_at]               DATETIME NULL,
        [treasury_account_id]   INT NULL,
        [journal_entry_id]      INT NULL,
        [notes]                 NVARCHAR(MAX) NULL,
        [created_by]            INT NULL,
        [created_at]            DATETIME DEFAULT GETDATE()
    );
END
GO

-- ============================================================
-- 6. Commission Voucher Lines
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[commission_voucher_lines]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[commission_voucher_lines] (
        [id]              INT IDENTITY(1,1) PRIMARY KEY,
        [voucher_id]      INT NOT NULL,
        [transaction_id]  INT NOT NULL,
        [amount]          DECIMAL(18,4) NOT NULL DEFAULT 0,
        CONSTRAINT FK_voucher_lines_voucher FOREIGN KEY (voucher_id) REFERENCES commission_payment_vouchers(id),
        CONSTRAINT FK_voucher_lines_transaction FOREIGN KEY (transaction_id) REFERENCES commission_transactions(id)
    );
END
GO

-- ============================================================
-- 7. Commission Period Status
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[commission_period_status]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[commission_period_status] (
        [id]          INT IDENTITY(1,1) PRIMARY KEY,
        [company_id]  INT NULL,
        [period]      NVARCHAR(20) NOT NULL,
        [status]      INT NOT NULL DEFAULT 0,
        [closed_by]   INT NULL,
        [closed_at]   DATETIME NULL,
        CONSTRAINT UQ_commission_period UNIQUE (company_id, period)
    );
END
GO

-- ============================================================
-- 8. Commission Audit Log
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[commission_audit_log]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[commission_audit_log] (
        [id]              INT IDENTITY(1,1) PRIMARY KEY,
        [company_id]      INT NULL,
        [entity_type]     NVARCHAR(100) NOT NULL,
        [entity_id]       INT NOT NULL,
        [action]          NVARCHAR(100) NOT NULL,
        [old_value]       NVARCHAR(MAX) NULL,
        [new_value]       NVARCHAR(MAX) NULL,
        [performed_by]    INT NULL,
        [performed_at]    DATETIME DEFAULT GETDATE()
    );
END
GO

-- ============================================================
-- 9. Add plan_id to sales_reps
-- ============================================================
IF COL_LENGTH('sales_reps', 'plan_id') IS NULL
BEGIN
    ALTER TABLE sales_reps ADD plan_id INT NULL;
END
GO

PRINT 'Migration 009_commission_schema completed successfully';
