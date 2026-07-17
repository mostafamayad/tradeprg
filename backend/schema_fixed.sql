-- SQL Server Schema Migration for TradePro ERP
-- Generated automatically

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[company_info]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[company_info] (
        [id] INT PRIMARY KEY DEFAULT 1,
        [company_name] NVARCHAR(255) NOT NULL DEFAULT 'شركتي',
        [company_address] NVARCHAR(MAX),
        [company_phone] NVARCHAR(255),
        [company_email] NVARCHAR(255),
        [tax_number] NVARCHAR(255),
        [currency] NVARCHAR(255) DEFAULT 'ج.م',
        [fiscal_year_start] NVARCHAR(255) DEFAULT '01-01',
        [updated_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120)
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[branches]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[branches] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [branch_code] NVARCHAR(255) NOT NULL UNIQUE,
        [branch_name] NVARCHAR(255) NOT NULL,
        [manager_name] NVARCHAR(255),
        [phone] NVARCHAR(255),
        [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120)
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[users]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[users] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [username] NVARCHAR(255) NOT NULL UNIQUE,
        [password_hash] NVARCHAR(255) NOT NULL,
        [full_name] NVARCHAR(255) NOT NULL,
        [role] NVARCHAR(255) DEFAULT 'user',
        [branch_id] INT,
        [is_active] INT DEFAULT 1,
        [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120),
        [permissions] NVARCHAR(MAX) DEFAULT '[]'
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[stores]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[stores] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [store_code] NVARCHAR(255) NOT NULL UNIQUE,
        [store_name] NVARCHAR(255) NOT NULL,
        [store_type] NVARCHAR(255) DEFAULT 'main',
        [branch_id] INT,
        [notes] NVARCHAR(MAX)
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[sales_reps]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[sales_reps] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [rep_code] NVARCHAR(255) UNIQUE,
        [rep_name] NVARCHAR(255) NOT NULL,
        [phone] NVARCHAR(255),
        [region] NVARCHAR(255),
        [target_amount] DECIMAL(18,4) DEFAULT 0,
        [commission_rate] DECIMAL(18,4) DEFAULT 0,
        [is_active] INT DEFAULT 1
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[customers]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[suppliers] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [supplier_code] NVARCHAR(255) NOT NULL UNIQUE,
        [supplier_name] NVARCHAR(255) NOT NULL,
        [phone] NVARCHAR(255),
        [phone2] NVARCHAR(255),
        [mobile] NVARCHAR(50),
        [email] NVARCHAR(255),
        [address] NVARCHAR(MAX),
        [tax_number] NVARCHAR(100),
        [opening_balance] DECIMAL(18,4) DEFAULT 0,
        [current_balance] DECIMAL(18,4) DEFAULT 0,
        [notes] NVARCHAR(MAX),
        [is_active] INT DEFAULT 1,
        [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120)
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[categories]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[categories] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [category_name] NVARCHAR(255) NOT NULL,
        [parent_id] INT
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[products]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[stock_movements] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [move_date] NVARCHAR(255) NOT NULL,
        [move_type] NVARCHAR(255) NOT NULL,
        [document_no] NVARCHAR(255),
        [store_id] INT NOT NULL,
        [product_id] INT NOT NULL,
        [qty_in] DECIMAL(18,4) DEFAULT 0,
        [qty_out] DECIMAL(18,4) DEFAULT 0,
        [cost_price] DECIMAL(18,4) DEFAULT 0,
        [sell_price] DECIMAL(18,4) DEFAULT 0,
        [balance_after] DECIMAL(18,4) DEFAULT 0,
        [reference_id] INT,
        [notes] NVARCHAR(MAX),
        [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120)
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[sales_invoices]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[stock_transfers] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [transfer_no] NVARCHAR(255) NOT NULL UNIQUE,
        [transfer_date] NVARCHAR(255) NOT NULL,
        [from_store_id] INT NOT NULL,
        [to_store_id] INT NOT NULL,
        [notes] NVARCHAR(MAX),
        [status] NVARCHAR(255) DEFAULT 'posted',
        [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120)
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[stock_transfer_items]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[damaged_stock] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [doc_no] NVARCHAR(255) NOT NULL UNIQUE,
        [doc_date] NVARCHAR(255) NOT NULL,
        [store_id] INT NOT NULL,
        [product_id] INT NOT NULL,
        [quantity] DECIMAL(18,4) NOT NULL,
        [reason] NVARCHAR(MAX),
        [notes] NVARCHAR(MAX),
        [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120)
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[stock_count]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[stock_count] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [count_no] NVARCHAR(255) NOT NULL UNIQUE,
        [count_date] NVARCHAR(255) NOT NULL,
        [store_id] INT NOT NULL,
        [status] NVARCHAR(255) DEFAULT 'in_progress',
        [notes] NVARCHAR(MAX),
        [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120)
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[stock_count_items]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[stock_adjustments] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [adj_no] NVARCHAR(255) NOT NULL UNIQUE,
        [adj_date] NVARCHAR(255) NOT NULL,
        [store_id] INT NOT NULL,
        [product_id] INT NOT NULL,
        [quantity] DECIMAL(18,4) NOT NULL,
        [reason] NVARCHAR(MAX),
        [notes] NVARCHAR(MAX),
        [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120)
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[customer_notes]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[chart_of_accounts] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [account_code] NVARCHAR(255) NOT NULL UNIQUE,
        [account_name] NVARCHAR(255) NOT NULL,
        [parent_id] INT,
        [account_type] NVARCHAR(255) NOT NULL,
        [current_balance] DECIMAL(18,4) DEFAULT 0,
        [is_active] INT DEFAULT 1
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[journal_entries]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[journal_entries] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [entry_no] NVARCHAR(255) NOT NULL UNIQUE,
        [entry_date] NVARCHAR(255) NOT NULL,
        [description] NVARCHAR(MAX),
        [reference_type] NVARCHAR(255),
        [reference_id] INT,
        [total_debit] DECIMAL(18,4) DEFAULT 0,
        [total_credit] DECIMAL(18,4) DEFAULT 0,
        [created_by] INT,
        [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120)
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[journal_entry_lines]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[settings] (
        [key] NVARCHAR(255) PRIMARY KEY,
        [value] NVARCHAR(255),
        [updated_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120)
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[treasury_accounts]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[treasury_accounts] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [account_name] NVARCHAR(255) NOT NULL,
        [account_type] NVARCHAR(255) DEFAULT 'cash',
        [bank_name] NVARCHAR(255),
        [account_no] NVARCHAR(255),
        [opening_balance] DECIMAL(18,4) DEFAULT 0,
        [current_balance] DECIMAL(18,4) DEFAULT 0
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[treasury_transactions]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[employees] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [emp_code] NVARCHAR(255) NOT NULL UNIQUE,
        [emp_name] NVARCHAR(255) NOT NULL,
        [department] NVARCHAR(255),
        [job_title] NVARCHAR(255),
        [basic_salary] DECIMAL(18,4) DEFAULT 0,
        [hire_date] NVARCHAR(255),
        [phone] NVARCHAR(255),
        [national_id] NVARCHAR(255),
        [status] NVARCHAR(255) DEFAULT 'active',
        [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120)
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[invoice_counters]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[invoice_counters] (
        [id] INT PRIMARY KEY,
        [counter_name] NVARCHAR(255) NOT NULL UNIQUE,
        [prefix] NVARCHAR(255) DEFAULT '',
        [last_number] INT DEFAULT 0
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[collection_allocations]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[customers] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [customer_code] NVARCHAR(255) NOT NULL UNIQUE,
        [customer_name] NVARCHAR(255) NOT NULL,
        [customer_type] NVARCHAR(255) DEFAULT 'retail',
        [phone] NVARCHAR(255),
        [phone2] NVARCHAR(255),
        [address] NVARCHAR(MAX),
        [region] NVARCHAR(255),
        [tax_id] NVARCHAR(255),
        [commercial_register] NVARCHAR(255),
        [payment_terms_days] INT DEFAULT 0,
        [customer_group_id] INT,
        [credit_limit] DECIMAL(18,4) DEFAULT 0,
        [opening_balance] DECIMAL(18,4) DEFAULT 0,
        [current_balance] DECIMAL(18,4) DEFAULT 0,
        [rep_id] INT,
        [notes] NVARCHAR(MAX),
        [is_active] INT DEFAULT 1,
        [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120),
        CONSTRAINT [FK_customers_sales_reps_rep_id] FOREIGN KEY ([rep_id]) REFERENCES [dbo].[sales_reps] ([id])
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[suppliers]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[products] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [product_code] NVARCHAR(255) NOT NULL UNIQUE,
        [product_name] NVARCHAR(255) NOT NULL,
        [category_id] INT,
        [unit_name] NVARCHAR(255) DEFAULT 'قطعة',
        [alt_unit] NVARCHAR(255),
        [unit_factor] DECIMAL(18,4) DEFAULT 1,
        [cost_price] DECIMAL(18,4) DEFAULT 0,
        [sell_price] DECIMAL(18,4) DEFAULT 0,
        [sell_price2] DECIMAL(18,4) DEFAULT 0,
        [sell_price3] DECIMAL(18,4) DEFAULT 0,
        [min_stock] DECIMAL(18,4) DEFAULT 0,
        [max_stock] DECIMAL(18,4) DEFAULT 0,
        [barcode] NVARCHAR(255),
        [sku] NVARCHAR(255),
        [shelf_no] NVARCHAR(255),
        [tax_rate] DECIMAL(18,4) DEFAULT 0,
        [notes] NVARCHAR(MAX),
        [is_active] INT DEFAULT 1,
        CONSTRAINT [FK_products_categories_category_id] FOREIGN KEY ([category_id]) REFERENCES [dbo].[categories] ([id])
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[inventory_balances]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[inventory_balances] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [store_id] INT NOT NULL,
        [product_id] INT NOT NULL,
        [quantity] DECIMAL(18,4) DEFAULT 0,
        CONSTRAINT [FK_inventory_balances_products_product_id] FOREIGN KEY ([product_id]) REFERENCES [dbo].[products] ([id]),
        CONSTRAINT [FK_inventory_balances_stores_store_id] FOREIGN KEY ([store_id]) REFERENCES [dbo].[stores] ([id])
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[stock_movements]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[sales_invoices] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [invoice_no] NVARCHAR(255) NOT NULL UNIQUE,
        [invoice_date] NVARCHAR(255) NOT NULL,
        [due_date] DATE,
        [customer_id] INT NOT NULL,
        [rep_id] INT,
        [store_id] INT NOT NULL,
        [payment_type] NVARCHAR(255) DEFAULT 'cash',
        [subtotal] DECIMAL(18,4) DEFAULT 0,
        [discount_amount] DECIMAL(18,4) DEFAULT 0,
        [discount_pct] DECIMAL(18,4) DEFAULT 0,
        [tax_amount] DECIMAL(18,4) DEFAULT 0,
        [grand_total] DECIMAL(18,4) DEFAULT 0,
        [amount_paid] DECIMAL(18,4) DEFAULT 0,
        [remaining] DECIMAL(18,4) DEFAULT 0,
        [notes] NVARCHAR(MAX),
        [status] NVARCHAR(255) DEFAULT 'posted',
        [created_by] INT,
        [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120),
        [invoice_type] NVARCHAR(255) DEFAULT 'normal',
        CONSTRAINT [FK_sales_invoices_sales_reps_rep_id] FOREIGN KEY ([rep_id]) REFERENCES [dbo].[sales_reps] ([id]),
        CONSTRAINT [FK_sales_invoices_customers_customer_id] FOREIGN KEY ([customer_id]) REFERENCES [dbo].[customers] ([id])
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[sales_invoice_items]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[sales_invoice_items] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [invoice_id] INT NOT NULL,
        [product_id] INT NOT NULL,
        [quantity] DECIMAL(18,4) NOT NULL,
        [unit_price] DECIMAL(18,4) NOT NULL,
        [cost_price] DECIMAL(18,4) DEFAULT 0,
        [discount_pct] DECIMAL(18,4) DEFAULT 0,
        [discount_amount] DECIMAL(18,4) DEFAULT 0,
        [line_total] DECIMAL(18,4) NOT NULL,
        CONSTRAINT [FK_sales_invoice_items_products_product_id] FOREIGN KEY ([product_id]) REFERENCES [dbo].[products] ([id]),
        CONSTRAINT [FK_sales_invoice_items_sales_invoices_invoice_id] FOREIGN KEY ([invoice_id]) REFERENCES [dbo].[sales_invoices] ([id]) ON DELETE CASCADE
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[sales_returns]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[sales_returns] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [return_no] NVARCHAR(255) NOT NULL UNIQUE,
        [return_date] NVARCHAR(255) NOT NULL,
        [invoice_id] INT,
        [customer_id] INT NOT NULL,
        [store_id] INT NOT NULL,
        [grand_total] DECIMAL(18,4) DEFAULT 0,
        [return_reason] NVARCHAR(255),
        [notes] NVARCHAR(MAX),
        [status] NVARCHAR(255) DEFAULT 'posted',
        [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120),
        CONSTRAINT [FK_sales_returns_customers_customer_id] FOREIGN KEY ([customer_id]) REFERENCES [dbo].[customers] ([id]),
        CONSTRAINT [FK_sales_returns_sales_invoices_invoice_id] FOREIGN KEY ([invoice_id]) REFERENCES [dbo].[sales_invoices] ([id])
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[sales_return_items]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[sales_return_items] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [return_id] INT NOT NULL,
        [product_id] INT NOT NULL,
        [quantity] DECIMAL(18,4) NOT NULL,
        [unit_price] DECIMAL(18,4) NOT NULL,
        [line_total] DECIMAL(18,4) NOT NULL,
        CONSTRAINT [FK_sales_return_items_sales_returns_return_id] FOREIGN KEY ([return_id]) REFERENCES [dbo].[sales_returns] ([id]) ON DELETE CASCADE
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[customer_collections]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[customer_collections] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [collection_no] NVARCHAR(255) NOT NULL UNIQUE,
        [collection_date] NVARCHAR(255) NOT NULL,
        [customer_id] INT NOT NULL,
        [amount] DECIMAL(18,4) NOT NULL,
        [payment_method] NVARCHAR(255) DEFAULT 'cash',
        [check_no] NVARCHAR(255),
        [check_date] NVARCHAR(255),
        [bank_name] NVARCHAR(255),
        [notes] NVARCHAR(MAX),
        [created_by] INT,
        [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120),
        [rep_id] INT,
        CONSTRAINT [FK_customer_collections_sales_reps_rep_id] FOREIGN KEY ([rep_id]) REFERENCES [dbo].[sales_reps] ([id]),
        CONSTRAINT [FK_customer_collections_customers_customer_id] FOREIGN KEY ([customer_id]) REFERENCES [dbo].[customers] ([id])
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[purchase_invoices]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[purchase_invoices] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [invoice_no] NVARCHAR(255) NOT NULL UNIQUE,
        [supplier_invoice_no] NVARCHAR(255),
        [invoice_date] NVARCHAR(255) NOT NULL,
        [supplier_id] INT NOT NULL,
        [store_id] INT NOT NULL,
        [payment_type] NVARCHAR(255) DEFAULT 'cash',
        [subtotal] DECIMAL(18,4) DEFAULT 0,
        [discount_amount] DECIMAL(18,4) DEFAULT 0,
        [tax_amount] DECIMAL(18,4) DEFAULT 0,
        [grand_total] DECIMAL(18,4) DEFAULT 0,
        [amount_paid] DECIMAL(18,4) DEFAULT 0,
        [remaining] DECIMAL(18,4) DEFAULT 0,
        [notes] NVARCHAR(MAX),
        [status] NVARCHAR(255) DEFAULT 'posted',
        [created_by] INT,
        [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120),
        CONSTRAINT [FK_purchase_invoices_suppliers_supplier_id] FOREIGN KEY ([supplier_id]) REFERENCES [dbo].[suppliers] ([id])
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[purchase_invoice_items]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[purchase_invoice_items] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [invoice_id] INT NOT NULL,
        [product_id] INT NOT NULL,
        [quantity] DECIMAL(18,4) NOT NULL,
        [cost_price] DECIMAL(18,4) NOT NULL,
        [sell_price] DECIMAL(18,4) DEFAULT 0,
        [line_total] DECIMAL(18,4) NOT NULL,
        CONSTRAINT [FK_purchase_invoice_items_products_product_id] FOREIGN KEY ([product_id]) REFERENCES [dbo].[products] ([id]),
        CONSTRAINT [FK_purchase_invoice_items_purchase_invoices_invoice_id] FOREIGN KEY ([invoice_id]) REFERENCES [dbo].[purchase_invoices] ([id]) ON DELETE CASCADE
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[purchase_returns]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[purchase_returns] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [return_no] NVARCHAR(255) NOT NULL UNIQUE,
        [return_date] NVARCHAR(255) NOT NULL,
        [invoice_id] INT,
        [supplier_id] INT NOT NULL,
        [store_id] INT NOT NULL,
        [grand_total] DECIMAL(18,4) DEFAULT 0,
        [return_reason] NVARCHAR(255),
        [notes] NVARCHAR(MAX),
        [status] NVARCHAR(255) DEFAULT 'posted',
        [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120),
        CONSTRAINT [FK_purchase_returns_suppliers_supplier_id] FOREIGN KEY ([supplier_id]) REFERENCES [dbo].[suppliers] ([id]),
        CONSTRAINT [FK_purchase_returns_purchase_invoices_invoice_id] FOREIGN KEY ([invoice_id]) REFERENCES [dbo].[purchase_invoices] ([id])
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[purchase_return_items]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[purchase_return_items] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [return_id] INT NOT NULL,
        [product_id] INT NOT NULL,
        [quantity] DECIMAL(18,4) NOT NULL,
        [cost_price] DECIMAL(18,4) NOT NULL,
        [line_total] DECIMAL(18,4) NOT NULL,
        CONSTRAINT [FK_purchase_return_items_purchase_returns_return_id] FOREIGN KEY ([return_id]) REFERENCES [dbo].[purchase_returns] ([id]) ON DELETE CASCADE
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[supplier_payments]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[supplier_payments] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [payment_no] NVARCHAR(255) NOT NULL UNIQUE,
        [payment_date] NVARCHAR(255) NOT NULL,
        [supplier_id] INT NOT NULL,
        [amount] DECIMAL(18,4) NOT NULL,
        [payment_method] NVARCHAR(255) DEFAULT 'cash',
        [check_no] NVARCHAR(255),
        [check_date] NVARCHAR(255),
        [bank_name] NVARCHAR(255),
        [notes] NVARCHAR(MAX),
        [created_by] INT,
        [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120),
        CONSTRAINT [FK_supplier_payments_suppliers_supplier_id] FOREIGN KEY ([supplier_id]) REFERENCES [dbo].[suppliers] ([id])
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[checks]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[checks] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [check_no] NVARCHAR(255) NOT NULL,
        [check_date] NVARCHAR(255) NOT NULL,
        [due_date] NVARCHAR(255),
        [amount] DECIMAL(18,4) NOT NULL,
        [direction] NVARCHAR(255) DEFAULT 'inward',
        [status] NVARCHAR(255) DEFAULT 'pending',
        [customer_id] INT,
        [supplier_id] INT,
        [bank_name] NVARCHAR(255),
        [account_no] NVARCHAR(255),
        [collection_id] INT,
        [payment_id] INT,
        [notes] NVARCHAR(MAX),
        [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120),
        CONSTRAINT [FK_checks_supplier_payments_payment_id] FOREIGN KEY ([payment_id]) REFERENCES [dbo].[supplier_payments] ([id]),
        CONSTRAINT [FK_checks_customer_collections_collection_id] FOREIGN KEY ([collection_id]) REFERENCES [dbo].[customer_collections] ([id]),
        CONSTRAINT [FK_checks_suppliers_supplier_id] FOREIGN KEY ([supplier_id]) REFERENCES [dbo].[suppliers] ([id]),
        CONSTRAINT [FK_checks_customers_customer_id] FOREIGN KEY ([customer_id]) REFERENCES [dbo].[customers] ([id])
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[stock_transfers]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[stock_transfer_items] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [transfer_id] INT NOT NULL,
        [product_id] INT NOT NULL,
        [quantity] DECIMAL(18,4) NOT NULL,
        CONSTRAINT [FK_stock_transfer_items_stock_transfers_transfer_id] FOREIGN KEY ([transfer_id]) REFERENCES [dbo].[stock_transfers] ([id]) ON DELETE CASCADE
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[damaged_stock]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[stock_count_items] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [count_id] INT NOT NULL,
        [product_id] INT NOT NULL,
        [system_qty] DECIMAL(18,4) DEFAULT 0,
        [counted_qty] DECIMAL(18,4) DEFAULT 0,
        [diff] DECIMAL(18,4) DEFAULT 0,
        CONSTRAINT [FK_stock_count_items_stock_count_count_id] FOREIGN KEY ([count_id]) REFERENCES [dbo].[stock_count] ([id]) ON DELETE CASCADE
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[stock_adjustments]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[customer_notes] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [customer_id] INT NOT NULL,
        [note_date] NVARCHAR(255) NOT NULL,
        [note_text] NVARCHAR(255),
        [created_by] INT,
        [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120),
        CONSTRAINT [FK_customer_notes_customers_customer_id] FOREIGN KEY ([customer_id]) REFERENCES [dbo].[customers] ([id])
    );
END
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
        [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120),
        CONSTRAINT [FK_customer_visits_sales_reps_rep_id] FOREIGN KEY ([rep_id]) REFERENCES [dbo].[sales_reps] ([id]),
        CONSTRAINT [FK_customer_visits_customers_customer_id] FOREIGN KEY ([customer_id]) REFERENCES [dbo].[customers] ([id])
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[rep_targets]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[rep_targets] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [rep_id] INT NOT NULL,
        [period] NVARCHAR(255) NOT NULL,
        [target_amount] DECIMAL(18,4) DEFAULT 0,
        [notes] NVARCHAR(MAX),
        CONSTRAINT [FK_rep_targets_sales_reps_rep_id] FOREIGN KEY ([rep_id]) REFERENCES [dbo].[sales_reps] ([id])
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[rep_settlements]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[rep_settlements] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [rep_id] INT NOT NULL,
        [period] NVARCHAR(255) NOT NULL,
        [sales_amount] DECIMAL(18,4) DEFAULT 0,
        [collections_amount] DECIMAL(18,4) DEFAULT 0,
        [commission] DECIMAL(18,4) DEFAULT 0,
        [notes] NVARCHAR(MAX),
        [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120),
        CONSTRAINT [FK_rep_settlements_sales_reps_rep_id] FOREIGN KEY ([rep_id]) REFERENCES [dbo].[sales_reps] ([id])
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[chart_of_accounts]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[journal_entry_lines] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [entry_id] INT NOT NULL,
        [account_id] INT NOT NULL,
        [debit] DECIMAL(18,4) DEFAULT 0,
        [credit] DECIMAL(18,4) DEFAULT 0,
        [description] NVARCHAR(MAX),
        CONSTRAINT [FK_journal_entry_lines_chart_of_accounts_account_id] FOREIGN KEY ([account_id]) REFERENCES [dbo].[chart_of_accounts] ([id]),
        CONSTRAINT [FK_journal_entry_lines_journal_entries_entry_id] FOREIGN KEY ([entry_id]) REFERENCES [dbo].[journal_entries] ([id]) ON DELETE CASCADE
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[expenses]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[expenses] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [expense_no] NVARCHAR(255) NOT NULL UNIQUE,
        [expense_date] NVARCHAR(255) NOT NULL,
        [expense_type] NVARCHAR(255) DEFAULT 'general',
        [account_id] INT,
        [treasury_id] INT,
        [amount] DECIMAL(18,4) NOT NULL,
        [description] NVARCHAR(MAX),
        [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120),
        CONSTRAINT [FK_expenses_treasury_accounts_treasury_id] FOREIGN KEY ([treasury_id]) REFERENCES [dbo].[treasury_accounts] ([id]),
        CONSTRAINT [FK_expenses_chart_of_accounts_account_id] FOREIGN KEY ([account_id]) REFERENCES [dbo].[chart_of_accounts] ([id])
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[salary_slips]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[salary_slips] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [slip_no] NVARCHAR(255) NOT NULL UNIQUE,
        [period] NVARCHAR(255) NOT NULL,
        [emp_id] INT NOT NULL,
        [basic_salary] DECIMAL(18,4) DEFAULT 0,
        [allowances] DECIMAL(18,4) DEFAULT 0,
        [deductions] DECIMAL(18,4) DEFAULT 0,
        [loans] DECIMAL(18,4) DEFAULT 0,
        [net_salary] DECIMAL(18,4) DEFAULT 0,
        [status] NVARCHAR(255) DEFAULT 'draft',
        [notes] NVARCHAR(MAX),
        [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120),
        CONSTRAINT [FK_salary_slips_employees_emp_id] FOREIGN KEY ([emp_id]) REFERENCES [dbo].[employees] ([id])
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[emp_loans]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[emp_loans] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [emp_id] INT NOT NULL,
        [loan_date] NVARCHAR(255) NOT NULL,
        [amount] DECIMAL(18,4) NOT NULL,
        [paid_amount] DECIMAL(18,4) DEFAULT 0,
        [reason] NVARCHAR(MAX),
        [status] NVARCHAR(255) DEFAULT 'active',
        [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120),
        CONSTRAINT [FK_emp_loans_employees_emp_id] FOREIGN KEY ([emp_id]) REFERENCES [dbo].[employees] ([id])
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[settings]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[treasury_transactions] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [trans_no] NVARCHAR(255) UNIQUE,
        [trans_date] NVARCHAR(255) NOT NULL,
        [trans_type] NVARCHAR(255) NOT NULL,
        [amount] DECIMAL(18,4) NOT NULL,
        [account_id] INT NOT NULL,
        [related_type] NVARCHAR(255),
        [related_id] INT,
        [document_no] NVARCHAR(255),
        [description] NVARCHAR(MAX),
        [created_by] INT,
        [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120),
        CONSTRAINT [FK_treasury_transactions_treasury_accounts_account_id] FOREIGN KEY ([account_id]) REFERENCES [dbo].[treasury_accounts] ([id])
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[employees]') AND type in (N'U'))
BEGIN
    
CREATE TABLE [dbo].[collection_allocations] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [collection_id] INT NOT NULL,
        [invoice_id] INT NOT NULL,
        [amount] DECIMAL(18,4) NOT NULL,
        [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120),
        CONSTRAINT [FK_collection_allocations_sales_invoices_invoice_id] FOREIGN KEY ([invoice_id]) REFERENCES [dbo].[sales_invoices] ([id]),
        CONSTRAINT [FK_collection_allocations_customer_collections_collection_id] FOREIGN KEY ([collection_id]) REFERENCES [dbo].[customer_collections] ([id]) ON DELETE CASCADE
    );
END
GO

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
        [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120)
    );
END
GO


/* =========================================================================
   VALIDATION SUMMARY
   =========================================================================
   Total Tables Created: 45
   Total Foreign Keys Generated: 40
   Total Explicit Indexes Generated: 0
   Un-translated Objects: None
   =========================================================================
*/
