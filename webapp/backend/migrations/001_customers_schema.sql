-- Migration: 001_customers_schema
-- Adds extended columns and performance indexes to the customers table
-- Idempotent: each operation checks existence first

-- Columns
IF COL_LENGTH('customers', 'governorate') IS NULL ALTER TABLE customers ADD governorate NVARCHAR(100) NULL;
IF COL_LENGTH('customers', 'city') IS NULL ALTER TABLE customers ADD city NVARCHAR(100) NULL;
IF COL_LENGTH('customers', 'district') IS NULL ALTER TABLE customers ADD district NVARCHAR(100) NULL;
IF COL_LENGTH('customers', 'street') IS NULL ALTER TABLE customers ADD street NVARCHAR(255) NULL;
IF COL_LENGTH('customers', 'building_no') IS NULL ALTER TABLE customers ADD building_no NVARCHAR(50) NULL;
IF COL_LENGTH('customers', 'floor_no') IS NULL ALTER TABLE customers ADD floor_no NVARCHAR(50) NULL;
IF COL_LENGTH('customers', 'apartment_no') IS NULL ALTER TABLE customers ADD apartment_no NVARCHAR(50) NULL;
IF COL_LENGTH('customers', 'postal_code') IS NULL ALTER TABLE customers ADD postal_code NVARCHAR(50) NULL;
IF COL_LENGTH('customers', 'landmark') IS NULL ALTER TABLE customers ADD landmark NVARCHAR(255) NULL;
IF COL_LENGTH('customers', 'gps_latitude') IS NULL ALTER TABLE customers ADD gps_latitude DECIMAL(10,7) NULL;
IF COL_LENGTH('customers', 'gps_longitude') IS NULL ALTER TABLE customers ADD gps_longitude DECIMAL(10,7) NULL;
IF COL_LENGTH('customers', 'google_maps_link') IS NULL ALTER TABLE customers ADD google_maps_link NVARCHAR(500) NULL;
IF COL_LENGTH('customers', 'billing_address') IS NULL ALTER TABLE customers ADD billing_address NVARCHAR(MAX) NULL;
IF COL_LENGTH('customers', 'shipping_address') IS NULL ALTER TABLE customers ADD shipping_address NVARCHAR(MAX) NULL;
IF COL_LENGTH('customers', 'default_warehouse_id') IS NULL ALTER TABLE customers ADD default_warehouse_id INT NULL;
IF COL_LENGTH('customers', 'price_list_id') IS NULL ALTER TABLE customers ADD price_list_id INT NULL;
IF COL_LENGTH('customers', 'language') IS NULL ALTER TABLE customers ADD language NVARCHAR(10) DEFAULT 'ar';
IF COL_LENGTH('customers', 'currency') IS NULL ALTER TABLE customers ADD currency NVARCHAR(10) DEFAULT 'EGP';
IF COL_LENGTH('customers', 'tax_office') IS NULL ALTER TABLE customers ADD tax_office NVARCHAR(255) NULL;
IF COL_LENGTH('customers', 'cost_center_id') IS NULL ALTER TABLE customers ADD cost_center_id INT NULL;
IF COL_LENGTH('customers', 'ar_account_id') IS NULL ALTER TABLE customers ADD ar_account_id INT NULL;
IF COL_LENGTH('customers', 'credit_risk') IS NULL ALTER TABLE customers ADD credit_risk NVARCHAR(50) DEFAULT 'normal';
IF COL_LENGTH('customers', 'customer_category') IS NULL ALTER TABLE customers ADD customer_category NVARCHAR(100) NULL;
IF COL_LENGTH('customers', 'payment_terms_days') IS NULL ALTER TABLE customers ADD payment_terms_days INT DEFAULT 0;
IF COL_LENGTH('customers', 'customer_group_id') IS NULL ALTER TABLE customers ADD customer_group_id INT NULL;
IF COL_LENGTH('customers', 'blocked_status') IS NULL ALTER TABLE customers ADD blocked_status NVARCHAR(50) DEFAULT 'unblocked';
IF COL_LENGTH('customers', 'blocked_reason') IS NULL ALTER TABLE customers ADD blocked_reason NVARCHAR(500) NULL;
IF COL_LENGTH('customers', 'blocked_at') IS NULL ALTER TABLE customers ADD blocked_at NVARCHAR(50) NULL;
IF COL_LENGTH('customers', 'blocked_by') IS NULL ALTER TABLE customers ADD blocked_by INT NULL;
IF COL_LENGTH('customers', 'internal_notes') IS NULL ALTER TABLE customers ADD internal_notes NVARCHAR(MAX) NULL;
IF COL_LENGTH('customers', 'customer_notes') IS NULL ALTER TABLE customers ADD customer_notes NVARCHAR(MAX) NULL;
IF COL_LENGTH('customers', 'warnings_field') IS NULL ALTER TABLE customers ADD warnings_field NVARCHAR(MAX) NULL;
IF COL_LENGTH('customers', 'special_instructions') IS NULL ALTER TABLE customers ADD special_instructions NVARCHAR(MAX) NULL;
IF COL_LENGTH('customers', 'customer_since') IS NULL ALTER TABLE customers ADD customer_since NVARCHAR(50) NULL;
IF COL_LENGTH('customers', 'modified_at') IS NULL ALTER TABLE customers ADD modified_at NVARCHAR(50) NULL;
IF COL_LENGTH('customers', 'modified_by') IS NULL ALTER TABLE customers ADD modified_by INT NULL;
IF COL_LENGTH('customers', 'last_invoice_date') IS NULL ALTER TABLE customers ADD last_invoice_date NVARCHAR(50) NULL;
IF COL_LENGTH('customers', 'last_return_date') IS NULL ALTER TABLE customers ADD last_return_date NVARCHAR(50) NULL;
IF COL_LENGTH('customers', 'last_payment_date') IS NULL ALTER TABLE customers ADD last_payment_date NVARCHAR(50) NULL;
IF COL_LENGTH('customers', 'total_sales') IS NULL ALTER TABLE customers ADD total_sales DECIMAL(18,4) DEFAULT 0;
IF COL_LENGTH('customers', 'total_returns') IS NULL ALTER TABLE customers ADD total_returns DECIMAL(18,4) DEFAULT 0;
IF COL_LENGTH('customers', 'total_payments') IS NULL ALTER TABLE customers ADD total_payments DECIMAL(18,4) DEFAULT 0;
IF COL_LENGTH('customers', 'customer_status') IS NULL ALTER TABLE customers ADD customer_status NVARCHAR(50) DEFAULT 'active';
IF COL_LENGTH('customers', 'branch') IS NULL ALTER TABLE customers ADD branch NVARCHAR(255) NULL;
IF COL_LENGTH('customers', 'lead_source') IS NULL ALTER TABLE customers ADD lead_source NVARCHAR(100) NULL;
IF COL_LENGTH('customers', 'credit_days') IS NULL ALTER TABLE customers ADD credit_days INT DEFAULT 0;
IF COL_LENGTH('customers', 'preferred_contact_method') IS NULL ALTER TABLE customers ADD preferred_contact_method NVARCHAR(50) NULL;
IF COL_LENGTH('customers', 'opening_balance_date') IS NULL ALTER TABLE customers ADD opening_balance_date NVARCHAR(50) NULL;
IF COL_LENGTH('customers', 'default_payment_method') IS NULL ALTER TABLE customers ADD default_payment_method NVARCHAR(50) NULL;
IF COL_LENGTH('customers', 'tax_status') IS NULL ALTER TABLE customers ADD tax_status NVARCHAR(50) NULL;
IF COL_LENGTH('customers', 'vat_number') IS NULL ALTER TABLE customers ADD vat_number NVARCHAR(255) NULL;
IF COL_LENGTH('customers', 'bank_name') IS NULL ALTER TABLE customers ADD bank_name NVARCHAR(255) NULL;
IF COL_LENGTH('customers', 'bank_account_no') IS NULL ALTER TABLE customers ADD bank_account_no NVARCHAR(255) NULL;
IF COL_LENGTH('customers', 'bank_iban') IS NULL ALTER TABLE customers ADD bank_iban NVARCHAR(255) NULL;
IF COL_LENGTH('customers', 'id_type') IS NULL ALTER TABLE customers ADD id_type NVARCHAR(50) NULL;
IF COL_LENGTH('customers', 'id_number') IS NULL ALTER TABLE customers ADD id_number NVARCHAR(255) NULL;
IF COL_LENGTH('customers', 'id_expiry') IS NULL ALTER TABLE customers ADD id_expiry NVARCHAR(50) NULL;
IF COL_LENGTH('customers', 'contract_no') IS NULL ALTER TABLE customers ADD contract_no NVARCHAR(255) NULL;
IF COL_LENGTH('customers', 'contract_date') IS NULL ALTER TABLE customers ADD contract_date NVARCHAR(50) NULL;
IF COL_LENGTH('customers', 'contract_expiry') IS NULL ALTER TABLE customers ADD contract_expiry NVARCHAR(50) NULL;
IF COL_LENGTH('customers', 'sales_notes') IS NULL ALTER TABLE customers ADD sales_notes NVARCHAR(MAX) NULL;
IF COL_LENGTH('customers', 'accounting_notes') IS NULL ALTER TABLE customers ADD accounting_notes NVARCHAR(MAX) NULL;

-- Indexes
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_customers_email')
    CREATE INDEX IX_customers_email ON customers(email) WHERE email IS NOT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_customers_phone')
    CREATE INDEX IX_customers_phone ON customers(phone) WHERE phone IS NOT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_customers_tax_id')
    CREATE INDEX IX_customers_tax_id ON customers(tax_id) WHERE tax_id IS NOT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_customers_customer_type')
    CREATE INDEX IX_customers_customer_type ON customers(customer_type);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_customers_rep_id')
    CREATE INDEX IX_customers_rep_id ON customers(rep_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_customers_is_active')
    CREATE INDEX IX_customers_is_active ON customers(is_active);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_customers_city')
    CREATE INDEX IX_customers_city ON customers(city) WHERE city IS NOT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_customers_credit_limit')
    CREATE INDEX IX_customers_credit_limit ON customers(credit_limit);
