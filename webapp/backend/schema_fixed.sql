-- ============================================================
-- TradePro ERP - Complete Live Database Schema (MS SQL Server)
-- Generated: 2026-10-18T12:25:29.136Z
-- Total Tables: 95
-- ============================================================

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[activity_logs]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[activity_logs] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [user_id] INT,
        [username] NVARCHAR(255),
        [action_type] NVARCHAR(255),
        [entity_type] NVARCHAR(255),
        [entity_id] NVARCHAR(255),
        [details] NVARCHAR(MAX),
        [created_at] NVARCHAR(255) DEFAULT (CONVERT([varchar](19),getdate(),(120)))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[ap_cheques]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[ap_cheques] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [cheque_no] NVARCHAR(100) NOT NULL,
        [cheque_date] DATE NOT NULL,
        [due_date] DATE,
        [amount] DECIMAL(18, 4) NOT NULL,
        [bank_name] NVARCHAR(255),
        [supplier_id] INT,
        [payment_id] INT,
        [status] NVARCHAR(20) DEFAULT ('issued'),
        [status_date] DATE,
        [notes] NVARCHAR(500),
        [created_by] INT,
        [created_at] DATETIME DEFAULT (getdate())
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[ap_notes]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[ap_notes] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [note_no] NVARCHAR(50) NOT NULL,
        [note_date] DATE NOT NULL,
        [supplier_id] INT NOT NULL,
        [note_type] NVARCHAR(10) NOT NULL,
        [amount] DECIMAL(18, 4) NOT NULL,
        [reason] NVARCHAR(500),
        [notes] NVARCHAR(500),
        [status] NVARCHAR(20) DEFAULT ('active'),
        [created_by] INT,
        [created_at] DATETIME DEFAULT (getdate()),
        [reversed_at] DATETIME,
        [reversed_by] INT
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[ap_payment_allocations]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[ap_payment_allocations] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [payment_id] INT NOT NULL,
        [invoice_id] INT NOT NULL,
        [allocated_amount] DECIMAL(18, 4) NOT NULL,
        [discount_amount] DECIMAL(18, 4) NOT NULL DEFAULT ((0)),
        [net_amount] DECIMAL(18, 4) NOT NULL DEFAULT ((0)),
        [status] NVARCHAR(20) NOT NULL DEFAULT ('active'),
        [created_at] DATETIME DEFAULT (getdate()),
        [created_by] INT
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[ap_payments]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[ap_payments] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [payment_no] NVARCHAR(50) NOT NULL,
        [payment_date] DATE NOT NULL,
        [supplier_id] INT NOT NULL,
        [amount] DECIMAL(18, 4) NOT NULL,
        [payment_method] NVARCHAR(20) DEFAULT ('cash'),
        [check_no] NVARCHAR(100),
        [check_date] DATE,
        [bank_name] NVARCHAR(255),
        [notes] NVARCHAR(500),
        [status] NVARCHAR(20) DEFAULT ('active'),
        [created_by] INT,
        [created_at] DATETIME DEFAULT (getdate()),
        [reversed_at] DATETIME,
        [reversed_by] INT
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[ar_cheques]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[ar_cheques] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [cheque_no] NVARCHAR(100) NOT NULL,
        [cheque_date] DATE NOT NULL,
        [due_date] DATE,
        [amount] DECIMAL(18, 4) NOT NULL,
        [bank_name] NVARCHAR(255),
        [customer_id] INT,
        [payment_id] INT,
        [status] NVARCHAR(20) DEFAULT ('received'),
        [status_date] DATE,
        [notes] NVARCHAR(500),
        [created_by] INT,
        [created_at] DATETIME DEFAULT (getdate()),
        [account_no] NVARCHAR(100),
        [updated_at] NVARCHAR(50)
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[ar_notes]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[ar_notes] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [note_no] NVARCHAR(50) NOT NULL,
        [note_date] DATE NOT NULL,
        [customer_id] INT NOT NULL,
        [note_type] NVARCHAR(10) NOT NULL,
        [amount] DECIMAL(18, 4) NOT NULL,
        [reason] NVARCHAR(500),
        [notes] NVARCHAR(500),
        [status] NVARCHAR(20) DEFAULT ('active'),
        [created_by] INT,
        [created_at] DATETIME DEFAULT (getdate()),
        [reversed_at] DATETIME,
        [reversed_by] INT
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[ar_payment_allocations]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[ar_payment_allocations] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [payment_id] INT NOT NULL,
        [invoice_id] INT NOT NULL,
        [allocated_amount] DECIMAL(18, 4) NOT NULL,
        [discount_amount] DECIMAL(18, 4) NOT NULL DEFAULT ((0)),
        [net_amount] DECIMAL(18, 4) NOT NULL DEFAULT ((0)),
        [created_at] DATETIME DEFAULT (getdate()),
        [created_by] INT,
        [status] NVARCHAR(20) NOT NULL DEFAULT ('active')
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[ar_payments]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[ar_payments] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [payment_no] NVARCHAR(50) NOT NULL,
        [payment_date] DATE NOT NULL,
        [customer_id] INT NOT NULL,
        [amount] DECIMAL(18, 4) NOT NULL,
        [payment_method] NVARCHAR(20) DEFAULT ('cash'),
        [check_no] NVARCHAR(100),
        [check_date] DATE,
        [bank_name] NVARCHAR(255),
        [notes] NVARCHAR(500),
        [status] NVARCHAR(20) DEFAULT ('active'),
        [created_by] INT,
        [created_at] DATETIME DEFAULT (getdate()),
        [reversed_at] DATETIME,
        [reversed_by] INT
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[ar_security_cheques]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[ar_security_cheques] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [cheque_no] NVARCHAR(100) NOT NULL,
        [issue_date] DATE NOT NULL,
        [expiry_date] DATE NOT NULL,
        [amount] DECIMAL(18, 4) NOT NULL,
        [bank_name] NVARCHAR(255),
        [customer_id] INT NOT NULL,
        [reason] NVARCHAR(500),
        [status] NVARCHAR(20) DEFAULT ('kept'),
        [returned_date] DATE,
        [notes] NVARCHAR(500),
        [created_by] INT,
        [created_at] DATETIME DEFAULT (getdate())
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[asset_categories]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[asset_categories] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [name] NVARCHAR(200) NOT NULL,
        [description] NVARCHAR(500),
        [useful_life_months] DECIMAL(5, 1) NOT NULL,
        [depreciation_method] NVARCHAR(50) DEFAULT ('straight-line'),
        [parent_id] INT,
        [is_active] BIT DEFAULT ((1)),
        [created_by] INT,
        [updated_by] INT,
        [created_at] NVARCHAR(50) DEFAULT (CONVERT([varchar](19),getdate(),(120))),
        [updated_at] NVARCHAR(50),
        [deleted_at] NVARCHAR(50),
        [deleted_by] INT
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[asset_depreciation]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[asset_depreciation] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [asset_id] INT NOT NULL,
        [period_date] DATE NOT NULL,
        [depreciation_amount] DECIMAL(18, 2) NOT NULL,
        [accumulated_after] DECIMAL(18, 2) NOT NULL,
        [journal_entry_id] INT,
        [notes] NVARCHAR(500),
        [created_by] INT,
        [created_at] NVARCHAR(50) DEFAULT (CONVERT([varchar](19),getdate(),(120)))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[asset_movements]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[asset_movements] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [movement_no] NVARCHAR(50) NOT NULL,
        [asset_id] INT NOT NULL,
        [movement_type] NVARCHAR(50) NOT NULL,
        [movement_date] DATE NOT NULL,
        [amount] DECIMAL(18, 2),
        [buyer_name] NVARCHAR(200),
        [from_location] NVARCHAR(200),
        [to_location] NVARCHAR(200),
        [workflow_status] NVARCHAR(50) DEFAULT ('draft'),
        [journal_entry_id] INT,
        [notes] NVARCHAR(MAX),
        [created_by] INT,
        [updated_by] INT,
        [created_at] NVARCHAR(50) DEFAULT (CONVERT([varchar](19),getdate(),(120))),
        [updated_at] NVARCHAR(50),
        [deleted_at] NVARCHAR(50),
        [deleted_by] INT
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[audit_log]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[audit_log] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [user_id] INT,
        [user_name] NVARCHAR(255),
        [role] NVARCHAR(50),
        [module] NVARCHAR(100),
        [operation] NVARCHAR(50),
        [ref_no] NVARCHAR(255),
        [affected_record] NVARCHAR(MAX),
        [old_values] NVARCHAR(MAX),
        [new_values] NVARCHAR(MAX),
        [ip_address] NVARCHAR(50),
        [device] NVARCHAR(500),
        [status] NVARCHAR(20) DEFAULT ('SUCCESS'),
        [reason] NVARCHAR(MAX),
        [created_at] DATETIME DEFAULT (getdate()),
        [browser] NVARCHAR(50),
        [os] NVARCHAR(50),
        [device_type] NVARCHAR(50),
        [session_id] NVARCHAR(255),
        [machine_name] NVARCHAR(255)
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[branches]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[branches] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [branch_code] NVARCHAR(255) NOT NULL,
        [branch_name] NVARCHAR(255) NOT NULL,
        [manager_name] NVARCHAR(255),
        [phone] NVARCHAR(255),
        [created_at] NVARCHAR(255) DEFAULT (CONVERT([varchar](19),getdate(),(120)))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[categories]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[categories] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [category_name] NVARCHAR(255) NOT NULL,
        [parent_id] INT
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[chart_of_accounts]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[chart_of_accounts] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [account_code] NVARCHAR(255) NOT NULL,
        [account_name] NVARCHAR(255) NOT NULL,
        [parent_id] INT,
        [account_type] NVARCHAR(255) NOT NULL,
        [current_balance] DECIMAL(18, 4) DEFAULT ((0)),
        [is_active] INT DEFAULT ((1)),
        [system_code] NVARCHAR(50)
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[checks]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[checks] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [check_no] NVARCHAR(255) NOT NULL,
        [check_date] NVARCHAR(255) NOT NULL,
        [due_date] NVARCHAR(255),
        [amount] DECIMAL(18, 4) NOT NULL,
        [direction] NVARCHAR(255) DEFAULT ('inward'),
        [status] NVARCHAR(255) DEFAULT ('pending'),
        [customer_id] INT,
        [supplier_id] INT,
        [bank_name] NVARCHAR(255),
        [account_no] NVARCHAR(255),
        [collection_id] INT,
        [payment_id] INT,
        [notes] NVARCHAR(MAX),
        [created_at] NVARCHAR(255) DEFAULT (CONVERT([varchar](19),getdate(),(120)))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[collection_allocations]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[collection_allocations] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [collection_id] INT NOT NULL,
        [invoice_id] INT NOT NULL,
        [amount] DECIMAL(18, 4) NOT NULL,
        [created_at] NVARCHAR(255) DEFAULT (CONVERT([varchar](19),getdate(),(120)))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[commission_adjustments]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[commission_adjustments] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [company_id] INT,
        [rep_id] INT NOT NULL,
        [period] NVARCHAR(20) NOT NULL,
        [type] NVARCHAR(50) NOT NULL,
        [amount] DECIMAL(18, 4) NOT NULL DEFAULT ((0)),
        [reason] NVARCHAR(MAX) NOT NULL,
        [reference_type] NVARCHAR(100),
        [reference_id] INT,
        [workflow_status] INT NOT NULL DEFAULT ((0)),
        [is_posted_to_gl] INT NOT NULL DEFAULT ((0)),
        [is_paid] INT NOT NULL DEFAULT ((0)),
        [approved_by] INT,
        [approved_at] DATETIME,
        [journal_entry_id] INT,
        [created_by] INT,
        [created_at] DATETIME DEFAULT (getdate())
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[commission_audit_log]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[commission_audit_log] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [company_id] INT,
        [entity_type] NVARCHAR(100) NOT NULL,
        [entity_id] INT NOT NULL,
        [action] NVARCHAR(100) NOT NULL,
        [old_value] NVARCHAR(MAX),
        [new_value] NVARCHAR(MAX),
        [performed_by] INT,
        [performed_at] DATETIME DEFAULT (getdate())
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[commission_payment_vouchers]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[commission_payment_vouchers] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [company_id] INT,
        [voucher_no] NVARCHAR(255) NOT NULL,
        [voucher_date] NVARCHAR(255) NOT NULL,
        [rep_id] INT NOT NULL,
        [period] NVARCHAR(20),
        [total_amount] DECIMAL(18, 4) NOT NULL DEFAULT ((0)),
        [workflow_status] INT NOT NULL DEFAULT ((0)),
        [paid_by] INT,
        [paid_at] DATETIME,
        [treasury_account_id] INT,
        [journal_entry_id] INT,
        [notes] NVARCHAR(MAX),
        [created_by] INT,
        [created_at] DATETIME DEFAULT (getdate())
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[commission_period_status]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[commission_period_status] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [company_id] INT,
        [period] NVARCHAR(20) NOT NULL,
        [status] INT NOT NULL DEFAULT ((0)),
        [closed_by] INT,
        [closed_at] DATETIME
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[commission_plans]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[commission_plans] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [company_id] INT,
        [plan_name] NVARCHAR(255) NOT NULL,
        [base_rate] DECIMAL(18, 4) NOT NULL DEFAULT ((0)),
        [effective_from] DATE NOT NULL,
        [effective_to] DATE,
        [is_active] INT DEFAULT ((1)),
        [created_at] DATETIME DEFAULT (getdate())
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[commission_tiers]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[commission_tiers] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [plan_id] INT NOT NULL,
        [from_percent] DECIMAL(18, 4) NOT NULL DEFAULT ((0)),
        [to_percent] DECIMAL(18, 4) NOT NULL DEFAULT ((100)),
        [multiplier] DECIMAL(18, 4) NOT NULL DEFAULT ((1.0)),
        [tier_label] NVARCHAR(255),
        [effective_from] DATE NOT NULL,
        [effective_to] DATE
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[commission_transactions]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[commission_transactions] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [company_id] INT,
        [rep_id] INT NOT NULL,
        [plan_id] INT NOT NULL,
        [collection_id] INT,
        [collection_amount] DECIMAL(18, 4) NOT NULL DEFAULT ((0)),
        [rep_name] NVARCHAR(255),
        [customer_name] NVARCHAR(255),
        [invoice_no] NVARCHAR(255),
        [collection_no] NVARCHAR(255),
        [invoice_date] NVARCHAR(255),
        [collection_date] NVARCHAR(255),
        [period] NVARCHAR(20) NOT NULL,
        [base_rate] DECIMAL(18, 4) NOT NULL DEFAULT ((0)),
        [achievement_pct] DECIMAL(18, 4) NOT NULL DEFAULT ((0)),
        [tier_multiplier] DECIMAL(18, 4) NOT NULL DEFAULT ((1.0)),
        [effective_rate] DECIMAL(18, 4) NOT NULL DEFAULT ((0)),
        [commission_amount] DECIMAL(18, 4) NOT NULL DEFAULT ((0)),
        [snapshot] NVARCHAR(MAX),
        [workflow_status] INT NOT NULL DEFAULT ((0)),
        [is_posted_to_gl] INT NOT NULL DEFAULT ((0)),
        [is_paid] INT NOT NULL DEFAULT ((0)),
        [reviewed_by] INT,
        [reviewed_at] DATETIME,
        [approved_by] INT,
        [approved_at] DATETIME,
        [locked_at] DATETIME,
        [settled_at] DATETIME,
        [journal_entry_id] INT,
        [notes] NVARCHAR(MAX),
        [created_at] DATETIME DEFAULT (getdate())
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[commission_voucher_lines]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[commission_voucher_lines] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [voucher_id] INT NOT NULL,
        [transaction_id] INT NOT NULL,
        [amount] DECIMAL(18, 4) NOT NULL DEFAULT ((0))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[company_info]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[company_info] (
        [id] INT PRIMARY KEY DEFAULT ((1)),
        [company_name] NVARCHAR(255) NOT NULL DEFAULT ('شركتي'),
        [company_address] NVARCHAR(MAX),
        [company_phone] NVARCHAR(255),
        [company_email] NVARCHAR(255),
        [tax_number] NVARCHAR(255),
        [currency] NVARCHAR(255) DEFAULT ('ج.م'),
        [fiscal_year_start] NVARCHAR(255) DEFAULT ('01-01'),
        [updated_at] NVARCHAR(255) DEFAULT (CONVERT([varchar](19),getdate(),(120))),
        [iban] NVARCHAR(50),
        [bank_name] NVARCHAR(100),
        [swift_code] NVARCHAR(20),
        [website] NVARCHAR(200),
        [logo_url] NVARCHAR(500),
        [company_activity] NVARCHAR(200),
        [account_holder_name] NVARCHAR(200)
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[crm_settlements]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[crm_settlements] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [settlement_no] NVARCHAR(50) NOT NULL,
        [customer_id] INT NOT NULL,
        [settlement_date] DATE,
        [type] NVARCHAR(50) NOT NULL,
        [amount] DECIMAL(18, 2) DEFAULT ((0)),
        [reason] NVARCHAR(MAX),
        [reference_type] NVARCHAR(50),
        [reference_id] INT,
        [workflow_status] NVARCHAR(50) DEFAULT ('draft'),
        [created_by] INT,
        [updated_by] INT,
        [created_at] NVARCHAR(50) DEFAULT (CONVERT([varchar](19),getdate(),(120))),
        [updated_at] NVARCHAR(50),
        [deleted_at] NVARCHAR(50),
        [deleted_by] INT
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[crm_targets]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[crm_targets] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [rep_id] INT NOT NULL,
        [period_month] INT NOT NULL,
        [period_year] INT NOT NULL,
        [target_amount] DECIMAL(18, 2) DEFAULT ((0)),
        [achieved_amount] DECIMAL(18, 2) DEFAULT ((0)),
        [commission_pct] DECIMAL(5, 2) DEFAULT ((0)),
        [commission_amount] DECIMAL(18, 2) DEFAULT ((0)),
        [notes] NVARCHAR(MAX),
        [created_by] INT,
        [updated_by] INT,
        [created_at] NVARCHAR(50) DEFAULT (CONVERT([varchar](19),getdate(),(120))),
        [updated_at] NVARCHAR(50),
        [deleted_at] NVARCHAR(50),
        [deleted_by] INT
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[crm_workplan_customers]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[crm_workplan_customers] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [workplan_id] INT NOT NULL,
        [customer_id] INT NOT NULL,
        [visit_status] NVARCHAR(50) DEFAULT ('pending'),
        [visit_notes] NVARCHAR(MAX),
        [visited_at] NVARCHAR(50),
        [created_by] INT,
        [updated_by] INT,
        [created_at] NVARCHAR(50) DEFAULT (CONVERT([varchar](19),getdate(),(120))),
        [updated_at] NVARCHAR(50),
        [deleted_at] NVARCHAR(50),
        [deleted_by] INT
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[crm_workplans]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[crm_workplans] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [rep_id] INT,
        [route_name] NVARCHAR(255),
        [plan_date] DATE,
        [start_time] NVARCHAR(50),
        [end_time] NVARCHAR(50),
        [actual_duration] INT DEFAULT ((0)),
        [priority] NVARCHAR(50) DEFAULT ('medium'),
        [target_count] INT DEFAULT ((0)),
        [visited_count] INT DEFAULT ((0)),
        [status] NVARCHAR(50) DEFAULT ('pending'),
        [notes] NVARCHAR(MAX),
        [created_by] INT,
        [updated_by] INT,
        [created_at] NVARCHAR(50) DEFAULT (CONVERT([varchar](19),getdate(),(120))),
        [updated_at] NVARCHAR(50),
        [deleted_at] NVARCHAR(50),
        [deleted_by] INT
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[customer_activity_log]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[customer_activity_log] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [customer_id] INT NOT NULL,
        [activity_type] NVARCHAR(50) NOT NULL,
        [reference_type] NVARCHAR(50),
        [reference_id] INT,
        [reference_no] NVARCHAR(255),
        [amount] DECIMAL(18, 4) DEFAULT ((0)),
        [description] NVARCHAR(MAX),
        [created_by] INT,
        [created_at] NVARCHAR(50) DEFAULT (CONVERT([varchar](19),getdate(),(120))),
        [metadata] NVARCHAR(MAX)
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[customer_attachments]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[customer_attachments] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [customer_id] INT NOT NULL,
        [file_name] NVARCHAR(255) NOT NULL,
        [file_type] NVARCHAR(50),
        [file_path] NVARCHAR(500),
        [description] NVARCHAR(500),
        [uploaded_by] INT,
        [uploaded_at] NVARCHAR(50) DEFAULT (CONVERT([varchar](19),getdate(),(120)))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[customer_collections]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[customer_collections] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [collection_no] NVARCHAR(255) NOT NULL,
        [collection_date] NVARCHAR(255) NOT NULL,
        [customer_id] INT NOT NULL,
        [amount] DECIMAL(18, 4) NOT NULL,
        [payment_method] NVARCHAR(255) DEFAULT ('cash'),
        [check_no] NVARCHAR(255),
        [check_date] NVARCHAR(255),
        [bank_name] NVARCHAR(255),
        [notes] NVARCHAR(MAX),
        [created_by] INT,
        [created_at] NVARCHAR(255) DEFAULT (CONVERT([varchar](19),getdate(),(120))),
        [rep_id] INT
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[customer_groups]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[customer_groups] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [group_name] NVARCHAR(255) NOT NULL,
        [group_name_en] NVARCHAR(255),
        [is_active] INT DEFAULT ((1)),
        [created_at] NVARCHAR(50) DEFAULT (CONVERT([varchar](19),getdate(),(120)))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[customer_notes]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[customer_notes] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [customer_id] INT NOT NULL,
        [note_date] NVARCHAR(255) NOT NULL,
        [note_text] NVARCHAR(255),
        [created_by] INT,
        [created_at] NVARCHAR(255) DEFAULT (CONVERT([varchar](19),getdate(),(120)))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[customer_visits]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[customer_visits] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [customer_id] INT NOT NULL,
        [rep_id] INT,
        [visit_date] NVARCHAR(255) NOT NULL,
        [purpose] NVARCHAR(255),
        [notes] NVARCHAR(MAX),
        [created_at] NVARCHAR(255) DEFAULT (CONVERT([varchar](19),getdate(),(120)))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[customers]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[customers] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [customer_code] NVARCHAR(255) NOT NULL,
        [customer_name] NVARCHAR(255) NOT NULL,
        [customer_type] NVARCHAR(255) DEFAULT ('retail'),
        [phone] NVARCHAR(255),
        [phone2] NVARCHAR(255),
        [address] NVARCHAR(MAX),
        [region] NVARCHAR(255),
        [credit_limit] DECIMAL(18, 4) DEFAULT ((0)),
        [opening_balance] DECIMAL(18, 4) DEFAULT ((0)),
        [current_balance] DECIMAL(18, 4) DEFAULT ((0)),
        [rep_id] INT,
        [notes] NVARCHAR(MAX),
        [is_active] INT DEFAULT ((1)),
        [created_at] NVARCHAR(255) DEFAULT (CONVERT([varchar](19),getdate(),(120))),
        [tax_number] NVARCHAR(50),
        [customer_name_en] NVARCHAR(255),
        [email] NVARCHAR(255),
        [mobile] NVARCHAR(50),
        [whatsapp] NVARCHAR(50),
        [website] NVARCHAR(255),
        [fax] NVARCHAR(50),
        [primary_contact] NVARCHAR(255),
        [job_title] NVARCHAR(255),
        [secondary_contact] NVARCHAR(255),
        [emergency_contact] NVARCHAR(255),
        [country] NVARCHAR(100),
        [governorate] NVARCHAR(100),
        [city] NVARCHAR(100),
        [district] NVARCHAR(100),
        [street] NVARCHAR(255),
        [building_no] NVARCHAR(50),
        [floor_no] NVARCHAR(50),
        [apartment_no] NVARCHAR(50),
        [postal_code] NVARCHAR(50),
        [landmark] NVARCHAR(255),
        [gps_latitude] DECIMAL(10, 7),
        [gps_longitude] DECIMAL(10, 7),
        [google_maps_link] NVARCHAR(500),
        [billing_address] NVARCHAR(MAX),
        [shipping_address] NVARCHAR(MAX),
        [default_warehouse_id] INT,
        [price_list_id] INT,
        [language] NVARCHAR(10) DEFAULT ('ar'),
        [currency] NVARCHAR(10) DEFAULT ('EGP'),
        [tax_office] NVARCHAR(255),
        [cost_center_id] INT,
        [ar_account_id] INT,
        [credit_risk] NVARCHAR(50) DEFAULT ('normal'),
        [customer_category] NVARCHAR(100),
        [blocked_status] NVARCHAR(50) DEFAULT ('unblocked'),
        [blocked_reason] NVARCHAR(500),
        [blocked_at] NVARCHAR(50),
        [blocked_by] INT,
        [internal_notes] NVARCHAR(MAX),
        [customer_notes] NVARCHAR(MAX),
        [warnings_field] NVARCHAR(MAX),
        [special_instructions] NVARCHAR(MAX),
        [customer_since] NVARCHAR(50),
        [modified_at] NVARCHAR(50),
        [modified_by] INT,
        [last_invoice_date] NVARCHAR(50),
        [last_return_date] NVARCHAR(50),
        [last_payment_date] NVARCHAR(50),
        [total_sales] DECIMAL(18, 4) DEFAULT ((0)),
        [total_returns] DECIMAL(18, 4) DEFAULT ((0)),
        [total_payments] DECIMAL(18, 4) DEFAULT ((0)),
        [tax_id] NVARCHAR(255),
        [commercial_register] NVARCHAR(255),
        [payment_terms_days] INT DEFAULT ((0)),
        [customer_group_id] INT,
        [customer_status] NVARCHAR(50) DEFAULT ('active'),
        [branch] NVARCHAR(255),
        [lead_source] NVARCHAR(100),
        [credit_days] INT DEFAULT ((0)),
        [preferred_contact_method] NVARCHAR(50),
        [opening_balance_date] NVARCHAR(50),
        [default_payment_method] NVARCHAR(50),
        [tax_status] NVARCHAR(50),
        [vat_number] NVARCHAR(255),
        [bank_name] NVARCHAR(255),
        [bank_account_no] NVARCHAR(255),
        [bank_iban] NVARCHAR(255),
        [id_type] NVARCHAR(50),
        [id_number] NVARCHAR(255),
        [id_expiry] NVARCHAR(50),
        [contract_no] NVARCHAR(255),
        [contract_date] NVARCHAR(50),
        [contract_expiry] NVARCHAR(50),
        [sales_notes] NVARCHAR(MAX),
        [accounting_notes] NVARCHAR(MAX)
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[damaged_stock]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[damaged_stock] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [doc_no] NVARCHAR(255) NOT NULL,
        [doc_date] NVARCHAR(255) NOT NULL,
        [store_id] INT NOT NULL,
        [product_id] INT NOT NULL,
        [quantity] DECIMAL(18, 4) NOT NULL,
        [reason] NVARCHAR(MAX),
        [notes] NVARCHAR(MAX),
        [created_at] NVARCHAR(255) DEFAULT (CONVERT([varchar](19),getdate(),(120))),
        [status] NVARCHAR(20) DEFAULT ('posted')
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[emp_attendance]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[emp_attendance] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [emp_id] INT NOT NULL,
        [att_date] NVARCHAR(255) NOT NULL,
        [check_in] NVARCHAR(255),
        [check_out] NVARCHAR(255),
        [status] NVARCHAR(255) DEFAULT ('present'),
        [late_minutes] INT DEFAULT ((0)),
        [overtime_minutes] INT DEFAULT ((0)),
        [notes] NVARCHAR(MAX),
        [created_at] NVARCHAR(255) DEFAULT (CONVERT([varchar](19),getdate(),(120)))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[emp_loans]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[emp_loans] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [emp_id] INT NOT NULL,
        [loan_date] NVARCHAR(255) NOT NULL,
        [amount] DECIMAL(18, 4) NOT NULL,
        [paid_amount] DECIMAL(18, 4) DEFAULT ((0)),
        [reason] NVARCHAR(MAX),
        [status] NVARCHAR(255) DEFAULT ('active'),
        [created_at] NVARCHAR(255) DEFAULT (CONVERT([varchar](19),getdate(),(120))),
        [monthly_installment] DECIMAL(18, 4) DEFAULT ((0))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[emp_penalties]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[emp_penalties] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [emp_id] INT NOT NULL,
        [penalty_type] NVARCHAR(255) NOT NULL,
        [penalty_date] NVARCHAR(255) NOT NULL,
        [amount] DECIMAL(18, 4) DEFAULT ((0)),
        [reason] NVARCHAR(MAX),
        [status] NVARCHAR(255) DEFAULT ('active'),
        [created_at] NVARCHAR(255) DEFAULT (CONVERT([varchar](19),getdate(),(120)))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[emp_rewards]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[emp_rewards] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [emp_id] INT NOT NULL,
        [reward_type] NVARCHAR(255) NOT NULL,
        [reward_date] NVARCHAR(255) NOT NULL,
        [amount] DECIMAL(18, 4) DEFAULT ((0)),
        [reason] NVARCHAR(MAX),
        [status] NVARCHAR(255) DEFAULT ('active'),
        [created_at] NVARCHAR(255) DEFAULT (CONVERT([varchar](19),getdate(),(120)))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[emp_vacations]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[emp_vacations] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [emp_id] INT NOT NULL,
        [vac_type] NVARCHAR(255) DEFAULT ('annual'),
        [start_date] NVARCHAR(255) NOT NULL,
        [end_date] NVARCHAR(255) NOT NULL,
        [days] INT NOT NULL DEFAULT ((1)),
        [reason] NVARCHAR(MAX),
        [status] NVARCHAR(255) DEFAULT ('pending'),
        [approved_by] NVARCHAR(255),
        [approved_at] NVARCHAR(255),
        [notes] NVARCHAR(MAX),
        [created_at] NVARCHAR(255) DEFAULT (CONVERT([varchar](19),getdate(),(120)))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[employees]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[employees] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [emp_code] NVARCHAR(255) NOT NULL,
        [emp_name] NVARCHAR(255) NOT NULL,
        [department] NVARCHAR(255),
        [job_title] NVARCHAR(255),
        [basic_salary] DECIMAL(18, 4) DEFAULT ((0)),
        [hire_date] NVARCHAR(255),
        [phone] NVARCHAR(255),
        [national_id] NVARCHAR(255),
        [status] NVARCHAR(255) DEFAULT ('active'),
        [created_at] NVARCHAR(255) DEFAULT (CONVERT([varchar](19),getdate(),(120)))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[expenses]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[expenses] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [expense_no] NVARCHAR(255) NOT NULL,
        [expense_date] NVARCHAR(255) NOT NULL,
        [expense_type] NVARCHAR(255) DEFAULT ('general'),
        [account_id] INT,
        [treasury_id] INT,
        [amount] DECIMAL(18, 4) NOT NULL,
        [description] NVARCHAR(MAX),
        [created_at] NVARCHAR(255) DEFAULT (CONVERT([varchar](19),getdate(),(120)))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[fiscal_periods]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[fiscal_periods] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [name] NVARCHAR(100) NOT NULL,
        [start_date] DATE NOT NULL,
        [end_date] DATE NOT NULL,
        [status] NVARCHAR(20) NOT NULL DEFAULT ('open'),
        [opened_by] INT,
        [closed_by] INT,
        [opened_at] DATETIME DEFAULT (getdate()),
        [closed_at] DATETIME,
        [notes] NVARCHAR(MAX)
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[fixed_assets]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[fixed_assets] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [asset_code] NVARCHAR(50) NOT NULL,
        [asset_name] NVARCHAR(200) NOT NULL,
        [category_id] INT NOT NULL,
        [purchase_date] DATE NOT NULL,
        [purchase_cost] DECIMAL(18, 2) NOT NULL,
        [salvage_value] DECIMAL(18, 2) DEFAULT ((0)),
        [useful_life_months] DECIMAL(5, 1) NOT NULL,
        [depreciation_method] NVARCHAR(50) DEFAULT ('straight-line'),
        [accumulated_depreciation] DECIMAL(18, 2) DEFAULT ((0)),
        [asset_status] NVARCHAR(50) DEFAULT ('active'),
        [location] NVARCHAR(200),
        [serial_number] NVARCHAR(100),
        [purchase_invoice_id] INT,
        [supplier_id] INT,
        [notes] NVARCHAR(MAX),
        [created_by] INT,
        [updated_by] INT,
        [created_at] NVARCHAR(50) DEFAULT (CONVERT([varchar](19),getdate(),(120))),
        [updated_at] NVARCHAR(50),
        [deleted_at] NVARCHAR(50),
        [deleted_by] INT
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[inventory_balances]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[inventory_balances] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [store_id] INT NOT NULL,
        [product_id] INT NOT NULL,
        [quantity] DECIMAL(18, 4) DEFAULT ((0))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[invoice_counters]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[invoice_counters] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [counter_name] NVARCHAR(255) NOT NULL,
        [prefix] NVARCHAR(255) DEFAULT (''),
        [last_number] INT DEFAULT ((0))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[journal_entries]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[journal_entries] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [entry_no] NVARCHAR(255) NOT NULL,
        [entry_date] NVARCHAR(255) NOT NULL,
        [description] NVARCHAR(MAX),
        [reference_type] NVARCHAR(255),
        [reference_id] INT,
        [total_debit] DECIMAL(18, 4) DEFAULT ((0)),
        [total_credit] DECIMAL(18, 4) DEFAULT ((0)),
        [created_by] INT,
        [created_at] NVARCHAR(255) DEFAULT (CONVERT([varchar](19),getdate(),(120))),
        [source_module] NVARCHAR(50),
        [source_action] NVARCHAR(50),
        [source_document] NVARCHAR(50),
        [is_system_generated] INT DEFAULT ((0)),
        [is_reversed] INT DEFAULT ((0)),
        [reversed_by] INT,
        [reversal_of_id] INT,
        [customer_id] INT,
        [supplier_id] INT
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[journal_entry_lines]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[journal_entry_lines] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [entry_id] INT NOT NULL,
        [account_id] INT NOT NULL,
        [debit] DECIMAL(18, 4) DEFAULT ((0)),
        [credit] DECIMAL(18, 4) DEFAULT ((0)),
        [description] NVARCHAR(MAX)
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[notifications]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[notifications] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [user_id] INT,
        [title] NVARCHAR(255) NOT NULL,
        [message] NVARCHAR(MAX),
        [type] NVARCHAR(50) DEFAULT ('info'),
        [module] NVARCHAR(100),
        [reference_id] INT,
        [reference_no] NVARCHAR(255),
        [is_read] INT DEFAULT ((0)),
        [created_at] NVARCHAR(50) DEFAULT (CONVERT([varchar](19),getdate(),(120)))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[permissions]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[permissions] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [code] NVARCHAR(100) NOT NULL,
        [display_name] NVARCHAR(255) NOT NULL,
        [module] NVARCHAR(100) NOT NULL,
        [description] NVARCHAR(500),
        [created_at] DATETIME DEFAULT (getdate())
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[products]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[products] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [product_code] NVARCHAR(255) NOT NULL,
        [product_name] NVARCHAR(255) NOT NULL,
        [category_id] INT,
        [unit_name] NVARCHAR(255) DEFAULT ('قطعة'),
        [alt_unit] NVARCHAR(255),
        [unit_factor] DECIMAL(18, 4) DEFAULT ((1)),
        [cost_price] DECIMAL(18, 4) DEFAULT ((0)),
        [sell_price] DECIMAL(18, 4) DEFAULT ((0)),
        [sell_price2] DECIMAL(18, 4) DEFAULT ((0)),
        [sell_price3] DECIMAL(18, 4) DEFAULT ((0)),
        [min_stock] DECIMAL(18, 4) DEFAULT ((0)),
        [max_stock] DECIMAL(18, 4) DEFAULT ((0)),
        [barcode] NVARCHAR(255),
        [shelf_no] NVARCHAR(255),
        [tax_rate] DECIMAL(18, 4) DEFAULT ((0)),
        [notes] NVARCHAR(MAX),
        [is_active] INT DEFAULT ((1))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[purchase_invoice_items]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[purchase_invoice_items] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [invoice_id] INT NOT NULL,
        [product_id] INT NOT NULL,
        [quantity] DECIMAL(18, 4) NOT NULL,
        [cost_price] DECIMAL(18, 4) NOT NULL,
        [sell_price] DECIMAL(18, 4) DEFAULT ((0)),
        [line_total] DECIMAL(18, 4) NOT NULL,
        [returned_qty] DECIMAL(18, 4) DEFAULT ((0)),
        [snapshot_product_name] NVARCHAR(255),
        [snapshot_unit_name] NVARCHAR(100),
        [snapshot_barcode] NVARCHAR(100)
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[purchase_invoices]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[purchase_invoices] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [invoice_no] NVARCHAR(255) NOT NULL,
        [supplier_invoice_no] NVARCHAR(255),
        [invoice_date] NVARCHAR(255) NOT NULL,
        [supplier_id] INT NOT NULL,
        [store_id] INT NOT NULL,
        [payment_type] NVARCHAR(255) DEFAULT ('cash'),
        [subtotal] DECIMAL(18, 4) DEFAULT ((0)),
        [discount_amount] DECIMAL(18, 4) DEFAULT ((0)),
        [tax_amount] DECIMAL(18, 4) DEFAULT ((0)),
        [grand_total] DECIMAL(18, 4) DEFAULT ((0)),
        [amount_paid] DECIMAL(18, 4) DEFAULT ((0)),
        [remaining] DECIMAL(18, 4) DEFAULT ((0)),
        [notes] NVARCHAR(MAX),
        [status] NVARCHAR(255) DEFAULT ('posted'),
        [created_by] INT,
        [created_at] NVARCHAR(255) DEFAULT (CONVERT([varchar](19),getdate(),(120))),
        [due_date] NVARCHAR(20),
        [return_status] NVARCHAR(50) DEFAULT ('Normal'),
        [invoice_type] NVARCHAR(255) NOT NULL DEFAULT (N'normal'),
        [vat_rate] DECIMAL(18, 4) NOT NULL DEFAULT ((0))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[purchase_return_items]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[purchase_return_items] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [return_id] INT NOT NULL,
        [product_id] INT NOT NULL,
        [quantity] DECIMAL(18, 4) NOT NULL,
        [cost_price] DECIMAL(18, 4) NOT NULL,
        [line_total] DECIMAL(18, 4) NOT NULL,
        [original_invoice_item_id] INT,
        [cost_price_snapshot] DECIMAL(18, 4) DEFAULT ((0))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[purchase_returns]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[purchase_returns] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [return_no] NVARCHAR(255) NOT NULL,
        [return_date] NVARCHAR(255) NOT NULL,
        [invoice_id] INT,
        [supplier_id] INT NOT NULL,
        [store_id] INT NOT NULL,
        [grand_total] DECIMAL(18, 4) DEFAULT ((0)),
        [return_reason] NVARCHAR(255),
        [notes] NVARCHAR(MAX),
        [status] NVARCHAR(255) DEFAULT ('posted'),
        [created_at] NVARCHAR(255) DEFAULT (CONVERT([varchar](19),getdate(),(120))),
        [subtotal] DECIMAL(18, 4) DEFAULT ((0)),
        [discount_amount] DECIMAL(18, 4) DEFAULT ((0)),
        [tax_amount] DECIMAL(18, 4) DEFAULT ((0)),
        [reason_code] NVARCHAR(50),
        [workflow_status] NVARCHAR(50) DEFAULT ('approved'),
        [created_by] INT,
        [approved_by] INT,
        [approved_at] NVARCHAR(50),
        [client_ip] NVARCHAR(100),
        [device_info] NVARCHAR(255),
        [source_type] NVARCHAR(20) DEFAULT ('invoice'),
        [reason_id] INT,
        [reason_note] NVARCHAR(500)
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[rep_settlements]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[rep_settlements] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [rep_id] INT NOT NULL,
        [period] NVARCHAR(255) NOT NULL,
        [sales_amount] DECIMAL(18, 4) DEFAULT ((0)),
        [collections_amount] DECIMAL(18, 4) DEFAULT ((0)),
        [commission] DECIMAL(18, 4) DEFAULT ((0)),
        [notes] NVARCHAR(MAX),
        [created_at] NVARCHAR(255) DEFAULT (CONVERT([varchar](19),getdate(),(120)))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[rep_targets]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[rep_targets] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [rep_id] INT NOT NULL,
        [period] NVARCHAR(255) NOT NULL,
        [target_amount] DECIMAL(18, 4) DEFAULT ((0)),
        [notes] NVARCHAR(MAX)
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[return_reasons]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[return_reasons] (
        [code] NVARCHAR(50) PRIMARY KEY,
        [label_ar] NVARCHAR(255) NOT NULL,
        [is_active] BIT DEFAULT ((1))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[role_permissions]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[role_permissions] (
        [role_id] INT PRIMARY KEY,
        [permission_id] INT PRIMARY KEY
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[role_templates]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[role_templates] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [name] NVARCHAR(100) NOT NULL,
        [display_name] NVARCHAR(255) NOT NULL,
        [description] NVARCHAR(500),
        [is_system] BIT DEFAULT ((0)),
        [created_at] DATETIME DEFAULT (getdate()),
        [permission_ids] NVARCHAR(MAX)
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[roles]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[roles] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [name] NVARCHAR(100) NOT NULL,
        [display_name] NVARCHAR(255) NOT NULL,
        [description] NVARCHAR(500),
        [is_system] BIT DEFAULT ((0)),
        [created_at] DATETIME DEFAULT (getdate())
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[salary_slips]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[salary_slips] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [slip_no] NVARCHAR(255) NOT NULL,
        [period] NVARCHAR(255) NOT NULL,
        [emp_id] INT NOT NULL,
        [basic_salary] DECIMAL(18, 4) DEFAULT ((0)),
        [allowances] DECIMAL(18, 4) DEFAULT ((0)),
        [deductions] DECIMAL(18, 4) DEFAULT ((0)),
        [loans] DECIMAL(18, 4) DEFAULT ((0)),
        [net_salary] DECIMAL(18, 4) DEFAULT ((0)),
        [status] NVARCHAR(255) DEFAULT ('draft'),
        [notes] NVARCHAR(MAX),
        [created_at] NVARCHAR(255) DEFAULT (CONVERT([varchar](19),getdate(),(120)))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[sales_invoice_items]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[sales_invoice_items] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [invoice_id] INT NOT NULL,
        [product_id] INT NOT NULL,
        [quantity] DECIMAL(18, 4) NOT NULL,
        [unit_price] DECIMAL(18, 4) NOT NULL,
        [cost_price] DECIMAL(18, 4) DEFAULT ((0)),
        [discount_pct] DECIMAL(18, 4) DEFAULT ((0)),
        [discount_amount] DECIMAL(18, 4) DEFAULT ((0)),
        [line_total] DECIMAL(18, 4) NOT NULL,
        [tax_pct] DECIMAL(5, 2) DEFAULT ((0)),
        [returned_qty] DECIMAL(18, 4) DEFAULT ((0))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[sales_invoices]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[sales_invoices] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [invoice_no] NVARCHAR(255) NOT NULL,
        [invoice_date] NVARCHAR(255) NOT NULL,
        [customer_id] INT NOT NULL,
        [rep_id] INT,
        [store_id] INT NOT NULL,
        [payment_type] NVARCHAR(255) DEFAULT ('cash'),
        [subtotal] DECIMAL(18, 4) DEFAULT ((0)),
        [discount_amount] DECIMAL(18, 4) DEFAULT ((0)),
        [discount_pct] DECIMAL(18, 4) DEFAULT ((0)),
        [tax_amount] DECIMAL(18, 4) DEFAULT ((0)),
        [grand_total] DECIMAL(18, 4) DEFAULT ((0)),
        [amount_paid] DECIMAL(18, 4) DEFAULT ((0)),
        [remaining] DECIMAL(18, 4) DEFAULT ((0)),
        [notes] NVARCHAR(MAX),
        [status] NVARCHAR(255) DEFAULT ('posted'),
        [created_by] INT,
        [created_at] NVARCHAR(255) DEFAULT (CONVERT([varchar](19),getdate(),(120))),
        [invoice_type] NVARCHAR(255) DEFAULT ('normal'),
        [due_date] NVARCHAR(20),
        [po_number] NVARCHAR(50),
        [e_invoice_uuid] NVARCHAR(100),
        [invoice_type_code] NVARCHAR(10) DEFAULT ('normal'),
        [is_tax_invoice] BIT DEFAULT ((0)),
        [tax_pct] DECIMAL(5, 2) DEFAULT ((0)),
        [check_number] NVARCHAR(50),
        [check_bank] NVARCHAR(100),
        [check_due_date] DATE,
        [check_status] NVARCHAR(20),
        [payment_terms_days] INT DEFAULT ((0)),
        [payment_terms_text] NVARCHAR(200),
        [bank_name_snapshot] NVARCHAR(100),
        [iban_snapshot] NVARCHAR(50),
        [return_status] NVARCHAR(50) DEFAULT ('Normal')
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[sales_reps]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[sales_reps] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [rep_code] NVARCHAR(255),
        [rep_name] NVARCHAR(255) NOT NULL,
        [phone] NVARCHAR(255),
        [region] NVARCHAR(255),
        [target_amount] DECIMAL(18, 4) DEFAULT ((0)),
        [commission_rate] DECIMAL(18, 4) DEFAULT ((0)),
        [is_active] INT DEFAULT ((1)),
        [notes] NVARCHAR(MAX),
        [plan_id] INT
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[sales_return_audit]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[sales_return_audit] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [return_id] INT NOT NULL,
        [action] NVARCHAR(50) NOT NULL,
        [actor_user_id] INT,
        [actor_username] NVARCHAR(100),
        [action_at] NVARCHAR(50) NOT NULL,
        [reason] NVARCHAR(500),
        [from_status] NVARCHAR(50),
        [to_status] NVARCHAR(50),
        [metadata] NVARCHAR(MAX),
        [client_ip] NVARCHAR(100),
        [device_info] NVARCHAR(255)
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[sales_return_items]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[sales_return_items] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [return_id] INT NOT NULL,
        [product_id] INT NOT NULL,
        [quantity] DECIMAL(18, 4) NOT NULL,
        [unit_price] DECIMAL(18, 4) NOT NULL,
        [line_total] DECIMAL(18, 4) NOT NULL,
        [original_invoice_item_id] INT,
        [cost_price_snapshot] DECIMAL(18, 4) DEFAULT ((0)),
        [discount_pct_snapshot] DECIMAL(18, 4) DEFAULT ((0)),
        [discount_amount_snapshot] DECIMAL(18, 4) DEFAULT ((0)),
        [tax_pct_snapshot] DECIMAL(18, 4) DEFAULT ((0)),
        [tax_amount_snapshot] DECIMAL(18, 4) DEFAULT ((0)),
        [product_condition] NVARCHAR(50) DEFAULT ('saleable'),
        [destination_store_id] INT,
        [reason_code] NVARCHAR(50),
        [reason_notes] NVARCHAR(500),
        [batch_no] NVARCHAR(100),
        [expiry_date] DATE,
        [serial_no] NVARCHAR(100)
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[sales_returns]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[sales_returns] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [return_no] NVARCHAR(255) NOT NULL,
        [return_date] NVARCHAR(255) NOT NULL,
        [invoice_id] INT,
        [customer_id] INT NOT NULL,
        [store_id] INT NOT NULL,
        [grand_total] DECIMAL(18, 4) DEFAULT ((0)),
        [return_reason] NVARCHAR(255),
        [notes] NVARCHAR(MAX),
        [status] NVARCHAR(255) DEFAULT ('posted'),
        [created_at] NVARCHAR(255) DEFAULT (CONVERT([varchar](19),getdate(),(120))),
        [workflow_status] NVARCHAR(50) DEFAULT ('approved'),
        [created_by] INT,
        [approved_by] INT,
        [approved_at] NVARCHAR(50),
        [reversed_by] INT,
        [reversed_at] NVARCHAR(50),
        [reversal_of_id] INT,
        [reason_code] NVARCHAR(50),
        [client_ip] NVARCHAR(100),
        [device_info] NVARCHAR(255),
        [is_free_return] BIT DEFAULT ((0)),
        [tax_amount] DECIMAL(18, 4) DEFAULT ((0)),
        [discount_amount] DECIMAL(18, 4) DEFAULT ((0)),
        [subtotal] DECIMAL(18, 4) DEFAULT ((0))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[schema_versions]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[schema_versions] (
        [version] INT PRIMARY KEY,
        [name] NVARCHAR(255) NOT NULL,
        [applied_at] DATETIME DEFAULT (getdate()),
        [duration_ms] INT NOT NULL DEFAULT ((0)),
        [checksum] NVARCHAR(64) NOT NULL
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[settings]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[settings] (
        [key] NVARCHAR(255) PRIMARY KEY,
        [value] NVARCHAR(MAX),
        [updated_at] NVARCHAR(255) DEFAULT (CONVERT([varchar](19),getdate(),(120)))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[stock_adjustments]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[stock_adjustments] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [adj_no] NVARCHAR(255) NOT NULL,
        [adj_date] NVARCHAR(255) NOT NULL,
        [store_id] INT NOT NULL,
        [product_id] INT NOT NULL,
        [quantity] DECIMAL(18, 4) NOT NULL,
        [reason] NVARCHAR(MAX),
        [notes] NVARCHAR(MAX),
        [created_at] NVARCHAR(255) DEFAULT (CONVERT([varchar](19),getdate(),(120))),
        [status] NVARCHAR(20) DEFAULT ('posted')
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[stock_count]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[stock_count] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [count_no] NVARCHAR(255) NOT NULL,
        [count_date] NVARCHAR(255) NOT NULL,
        [store_id] INT NOT NULL,
        [status] NVARCHAR(255) DEFAULT ('in_progress'),
        [notes] NVARCHAR(MAX),
        [created_at] NVARCHAR(255) DEFAULT (CONVERT([varchar](19),getdate(),(120))),
        [total_difference] DECIMAL(18, 2) DEFAULT ((0))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[stock_count_items]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[stock_count_items] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [count_id] INT NOT NULL,
        [product_id] INT NOT NULL,
        [system_qty] DECIMAL(18, 4) DEFAULT ((0)),
        [counted_qty] DECIMAL(18, 4) DEFAULT ((0)),
        [diff] DECIMAL(18, 4) DEFAULT ((0))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[stock_disposal_items]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[stock_disposal_items] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [disposal_id] INT NOT NULL,
        [product_id] INT NOT NULL,
        [quantity] DECIMAL(18, 4) NOT NULL,
        [cost_price] DECIMAL(18, 2) DEFAULT ((0)),
        [total_value] DECIMAL(18, 2) DEFAULT ((0)),
        [item_reason] NVARCHAR(MAX),
        [unit] NVARCHAR(50)
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[stock_disposals]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[stock_disposals] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [doc_no] NVARCHAR(255) NOT NULL,
        [doc_date] NVARCHAR(10) NOT NULL,
        [store_id] INT NOT NULL,
        [committee] NVARCHAR(500),
        [reason] NVARCHAR(MAX),
        [notes] NVARCHAR(MAX),
        [total_qty] DECIMAL(18, 4) DEFAULT ((0)),
        [total_value] DECIMAL(18, 2) DEFAULT ((0)),
        [journal_entry_id] INT,
        [status] NVARCHAR(20) DEFAULT ('posted'),
        [created_by] INT,
        [created_at] NVARCHAR(19) DEFAULT (CONVERT([varchar](19),getdate(),(120)))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[stock_movements]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[stock_movements] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [move_date] NVARCHAR(255) NOT NULL,
        [move_type] NVARCHAR(255) NOT NULL,
        [document_no] NVARCHAR(255),
        [store_id] INT NOT NULL,
        [product_id] INT NOT NULL,
        [qty_in] DECIMAL(18, 4) DEFAULT ((0)),
        [qty_out] DECIMAL(18, 4) DEFAULT ((0)),
        [cost_price] DECIMAL(18, 4) DEFAULT ((0)),
        [sell_price] DECIMAL(18, 4) DEFAULT ((0)),
        [balance_after] DECIMAL(18, 4) DEFAULT ((0)),
        [reference_id] INT,
        [notes] NVARCHAR(MAX),
        [created_at] NVARCHAR(255) DEFAULT (CONVERT([varchar](19),getdate(),(120)))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[stock_transfer_items]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[stock_transfer_items] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [transfer_id] INT NOT NULL,
        [product_id] INT NOT NULL,
        [quantity] DECIMAL(18, 4) NOT NULL
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[stock_transfers]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[stock_transfers] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [transfer_no] NVARCHAR(255) NOT NULL,
        [transfer_date] NVARCHAR(255) NOT NULL,
        [from_store_id] INT NOT NULL,
        [to_store_id] INT NOT NULL,
        [notes] NVARCHAR(MAX),
        [status] NVARCHAR(255) DEFAULT ('posted'),
        [created_at] NVARCHAR(255) DEFAULT (CONVERT([varchar](19),getdate(),(120)))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[stores]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[stores] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [store_code] NVARCHAR(255) NOT NULL,
        [store_name] NVARCHAR(255) NOT NULL,
        [store_type] NVARCHAR(255) DEFAULT ('main'),
        [branch_id] INT,
        [notes] NVARCHAR(MAX),
        [status] NVARCHAR(50) DEFAULT ('active')
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[supplier_activity_log]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[supplier_activity_log] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [supplier_id] INT NOT NULL,
        [activity_type] NVARCHAR(100),
        [description] NVARCHAR(500),
        [reference_type] NVARCHAR(100),
        [reference_id] INT,
        [reference_no] NVARCHAR(255),
        [amount] DECIMAL(18, 4) DEFAULT ((0)),
        [created_by] INT,
        [created_at] NVARCHAR(50) DEFAULT (CONVERT([varchar](19),getdate(),(120)))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[supplier_payment_allocations]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[supplier_payment_allocations] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [payment_id] INT NOT NULL,
        [invoice_id] INT NOT NULL,
        [allocated_amount] DECIMAL(18, 2) NOT NULL DEFAULT ((0)),
        [created_at] DATETIME DEFAULT (getdate())
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[supplier_payments]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[supplier_payments] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [payment_no] NVARCHAR(255) NOT NULL,
        [payment_date] NVARCHAR(255) NOT NULL,
        [supplier_id] INT NOT NULL,
        [amount] DECIMAL(18, 4) NOT NULL,
        [payment_method] NVARCHAR(255) DEFAULT ('cash'),
        [check_no] NVARCHAR(255),
        [check_date] NVARCHAR(255),
        [bank_name] NVARCHAR(255),
        [notes] NVARCHAR(MAX),
        [created_by] INT,
        [created_at] NVARCHAR(255) DEFAULT (CONVERT([varchar](19),getdate(),(120)))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[suppliers]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[suppliers] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [supplier_code] NVARCHAR(255) NOT NULL,
        [supplier_name] NVARCHAR(255) NOT NULL,
        [phone] NVARCHAR(255),
        [phone2] NVARCHAR(255),
        [address] NVARCHAR(MAX),
        [opening_balance] DECIMAL(18, 4) DEFAULT ((0)),
        [current_balance] DECIMAL(18, 4) DEFAULT ((0)),
        [notes] NVARCHAR(MAX),
        [is_active] INT DEFAULT ((1)),
        [created_at] NVARCHAR(255) DEFAULT (CONVERT([varchar](19),getdate(),(120))),
        [mobile] NVARCHAR(50),
        [email] NVARCHAR(255),
        [tax_number] NVARCHAR(100)
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[system_info]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[system_info] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [company_name] NVARCHAR(255),
        [license_code] NVARCHAR(255),
        [customer_code] NVARCHAR(100),
        [machine_fingerprint] NVARCHAR(500),
        [build_id] NVARCHAR(100),
        [edition] NVARCHAR(50),
        [installed_at] DATETIME DEFAULT (getdate()),
        [owner_name] NVARCHAR(255),
        [owner_email] NVARCHAR(255),
        [notes] NVARCHAR(MAX),
        [updated_at] DATETIME DEFAULT (getdate()),
        [max_users] INT DEFAULT ((10)),
        [encrypted_license] NVARCHAR(MAX),
        [machine_fingerprint_hash] NVARCHAR(128)
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[treasury_accounts]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[treasury_accounts] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [account_name] NVARCHAR(255) NOT NULL,
        [account_type] NVARCHAR(255) DEFAULT ('cash'),
        [bank_name] NVARCHAR(255),
        [account_no] NVARCHAR(255),
        [opening_balance] DECIMAL(18, 4) DEFAULT ((0)),
        [current_balance] DECIMAL(18, 4) DEFAULT ((0)),
        [system_code] NVARCHAR(50)
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[treasury_transactions]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[treasury_transactions] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [trans_no] NVARCHAR(255),
        [trans_date] NVARCHAR(255) NOT NULL,
        [trans_type] NVARCHAR(255) NOT NULL,
        [amount] DECIMAL(18, 4) NOT NULL,
        [account_id] INT NOT NULL,
        [related_type] NVARCHAR(255),
        [related_id] INT,
        [document_no] NVARCHAR(255),
        [description] NVARCHAR(MAX),
        [created_by] INT,
        [created_at] NVARCHAR(255) DEFAULT (CONVERT([varchar](19),getdate(),(120)))
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[user_audit_log]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[user_audit_log] (
        [id] BIGINT IDENTITY(1,1) PRIMARY KEY,
        [actor_id] INT,
        [actor_name] NVARCHAR(255),
        [action] NVARCHAR(100) NOT NULL,
        [target_type] NVARCHAR(100),
        [target_id] INT,
        [target_name] NVARCHAR(255),
        [old_value] NVARCHAR(MAX),
        [new_value] NVARCHAR(MAX),
        [details] NVARCHAR(MAX),
        [ip_address] NVARCHAR(50),
        [created_at] DATETIME DEFAULT (getdate()),
        [browser] NVARCHAR(50),
        [session_id] NVARCHAR(255),
        [machine_name] NVARCHAR(255)
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[user_data_scopes]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[user_data_scopes] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [user_id] INT NOT NULL,
        [scope_type] NVARCHAR(50) NOT NULL,
        [scope_value] NVARCHAR(255) NOT NULL,
        [created_at] DATETIME DEFAULT (getdate())
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[user_roles]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[user_roles] (
        [user_id] INT PRIMARY KEY,
        [role_id] INT PRIMARY KEY
    );
END;
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[users]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[users] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [username] NVARCHAR(255) NOT NULL,
        [password_hash] NVARCHAR(255) NOT NULL,
        [full_name] NVARCHAR(255) NOT NULL,
        [role] NVARCHAR(255) DEFAULT ('user'),
        [branch_id] INT,
        [is_active] INT DEFAULT ((1)),
        [created_at] NVARCHAR(255) DEFAULT (CONVERT([varchar](19),getdate(),(120))),
        [permissions] NVARCHAR(MAX) DEFAULT ('[]'),
        [avatar] NVARCHAR(MAX),
        [is_super_admin] BIT DEFAULT ((0)),
        [permissions_version] INT DEFAULT ((1)),
        [last_login_at] DATETIME,
        [last_login_ip] NVARCHAR(50),
        [scope_type] NVARCHAR(50) DEFAULT ('company'),
        [scope_value] NVARCHAR(255)
    );
END;
GO

