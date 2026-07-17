-- ============================================================
-- ERP-Standard Sales Return Workflow Migration
-- Implements: validation rules, snapshot pricing, item condition,
-- store routing, approval workflow, audit trail, permissions.
-- Idempotent: safe to run multiple times.
-- ============================================================

-- 1) Ensure special stores exist (Damaged & Inspection)
IF NOT EXISTS (SELECT 1 FROM stores WHERE store_type = 'damaged')
BEGIN
    INSERT INTO stores (store_code, store_name, store_type, notes)
    VALUES ('ST-DAMAGED', 'مخزن التوالف', 'damaged', 'مخزن البضاعة التالفة / المنتهية');
END
IF NOT EXISTS (SELECT 1 FROM stores WHERE store_type = 'inspection')
BEGIN
    INSERT INTO stores (store_code, store_name, store_type, notes)
    VALUES ('ST-INSP', 'مخزن الفحص', 'inspection', 'مخزن البضاعة بانتظار الفحص والاعتماد');
END
GO

-- 2) Extend sales_returns with workflow + audit fields
IF COL_LENGTH('sales_returns', 'workflow_status') IS NULL
    ALTER TABLE sales_returns ADD workflow_status NVARCHAR(50) DEFAULT 'approved'; -- draft|pending_approval|approved|reversed
IF COL_LENGTH('sales_returns', 'created_by') IS NULL
    ALTER TABLE sales_returns ADD created_by INT NULL;
IF COL_LENGTH('sales_returns', 'approved_by') IS NULL
    ALTER TABLE sales_returns ADD approved_by INT NULL;
IF COL_LENGTH('sales_returns', 'approved_at') IS NULL
    ALTER TABLE sales_returns ADD approved_at NVARCHAR(50) NULL;
IF COL_LENGTH('sales_returns', 'reversed_by') IS NULL
    ALTER TABLE sales_returns ADD reversed_by INT NULL;
IF COL_LENGTH('sales_returns', 'reversed_at') IS NULL
    ALTER TABLE sales_returns ADD reversed_at NVARCHAR(50) NULL;
IF COL_LENGTH('sales_returns', 'reversal_of_id') IS NULL
    ALTER TABLE sales_returns ADD reversal_of_id INT NULL;
IF COL_LENGTH('sales_returns', 'reason_code') IS NULL
    ALTER TABLE sales_returns ADD reason_code NVARCHAR(50) NULL;
IF COL_LENGTH('sales_returns', 'client_ip') IS NULL
    ALTER TABLE sales_returns ADD client_ip NVARCHAR(100) NULL;
IF COL_LENGTH('sales_returns', 'device_info') IS NULL
    ALTER TABLE sales_returns ADD device_info NVARCHAR(255) NULL;
IF COL_LENGTH('sales_returns', 'is_free_return') IS NULL
    ALTER TABLE sales_returns ADD is_free_return BIT DEFAULT 0; -- return without invoice
IF COL_LENGTH('sales_returns', 'tax_amount') IS NULL
    ALTER TABLE sales_returns ADD tax_amount DECIMAL(18,4) DEFAULT 0;
IF COL_LENGTH('sales_returns', 'discount_amount') IS NULL
    ALTER TABLE sales_returns ADD discount_amount DECIMAL(18,4) DEFAULT 0;
IF COL_LENGTH('sales_returns', 'subtotal') IS NULL
    ALTER TABLE sales_returns ADD subtotal DECIMAL(18,4) DEFAULT 0;
GO

-- 3) Extend sales_return_items with snapshot, condition, store routing
IF COL_LENGTH('sales_return_items', 'original_invoice_item_id') IS NULL
    ALTER TABLE sales_return_items ADD original_invoice_item_id INT NULL;
IF COL_LENGTH('sales_return_items', 'cost_price_snapshot') IS NULL
    ALTER TABLE sales_return_items ADD cost_price_snapshot DECIMAL(18,4) DEFAULT 0;
IF COL_LENGTH('sales_return_items', 'discount_pct_snapshot') IS NULL
    ALTER TABLE sales_return_items ADD discount_pct_snapshot DECIMAL(18,4) DEFAULT 0;
IF COL_LENGTH('sales_return_items', 'discount_amount_snapshot') IS NULL
    ALTER TABLE sales_return_items ADD discount_amount_snapshot DECIMAL(18,4) DEFAULT 0;
IF COL_LENGTH('sales_return_items', 'tax_pct_snapshot') IS NULL
    ALTER TABLE sales_return_items ADD tax_pct_snapshot DECIMAL(18,4) DEFAULT 0;
IF COL_LENGTH('sales_return_items', 'tax_amount_snapshot') IS NULL
    ALTER TABLE sales_return_items ADD tax_amount_snapshot DECIMAL(18,4) DEFAULT 0;
IF COL_LENGTH('sales_return_items', 'product_condition') IS NULL
    ALTER TABLE sales_return_items ADD product_condition NVARCHAR(50) DEFAULT 'saleable'; -- saleable|damaged|expired|inspection
IF COL_LENGTH('sales_return_items', 'destination_store_id') IS NULL
    ALTER TABLE sales_return_items ADD destination_store_id INT NULL;
IF COL_LENGTH('sales_return_items', 'reason_code') IS NULL
    ALTER TABLE sales_return_items ADD reason_code NVARCHAR(50) NULL;
IF COL_LENGTH('sales_return_items', 'reason_notes') IS NULL
    ALTER TABLE sales_return_items ADD reason_notes NVARCHAR(500) NULL;
GO

-- 4) Audit Trail table for sales returns
IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name='sales_return_audit' AND xtype='U')
BEGIN
    CREATE TABLE sales_return_audit (
        id INT IDENTITY(1,1) PRIMARY KEY,
        return_id INT NOT NULL,
        action NVARCHAR(50) NOT NULL,           -- created|approved|reversed|item_added|item_updated
        actor_user_id INT NULL,
        actor_username NVARCHAR(100) NULL,
        action_at NVARCHAR(50) NOT NULL,        -- ISO datetime
        reason NVARCHAR(500) NULL,
        from_status NVARCHAR(50) NULL,
        to_status NVARCHAR(50) NULL,
        metadata NVARCHAR(MAX) NULL,            -- JSON snapshot
        client_ip NVARCHAR(100) NULL,
        device_info NVARCHAR(255) NULL
    );
    CREATE INDEX IX_sales_return_audit_return_id ON sales_return_audit(return_id);
END
GO

-- 5) Standard return reasons reference table
IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name='return_reasons' AND xtype='U')
BEGIN
    CREATE TABLE return_reasons (
        code NVARCHAR(50) PRIMARY KEY,
        label_ar NVARCHAR(255) NOT NULL,
        is_active BIT DEFAULT 1
    );
    INSERT INTO return_reasons (code, label_ar) VALUES
        ('DAMAGED',     'المنتج تالف'),
        ('WRONG_ITEM',  'خطأ في الشحن / صنف خاطئ'),
        ('CUSTOMER_REFUSED','العميل رفض المنتج'),
        ('EXPIRED',     'انتهاء صلاحية'),
        ('INVOICE_ERR', 'خطأ في الفاتورة'),
        ('OTHER',       'أخرى');
END
GO

-- 6) Add sales-return permissions to users.permissions (JSON array)
-- We don't need to migrate existing rows since the new permissions are optional flags.
-- Application code will check via JSON parsing.

PRINT 'Sales Return ERP migration completed successfully.';
GO