-- Migration: 002_customer_tables
-- Creates auxiliary tables for customers: groups, activity log, attachments
-- Idempotent: each table creation checks existence

IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name='customer_groups' AND xtype='U')
BEGIN
    CREATE TABLE customer_groups (
        id INT IDENTITY(1,1) PRIMARY KEY,
        group_name NVARCHAR(255) NOT NULL,
        group_name_en NVARCHAR(255) NULL,
        is_active INT DEFAULT 1,
        created_at NVARCHAR(50) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120)
    );
    INSERT INTO customer_groups (group_name, group_name_en) VALUES
        (N'عامة', 'General'),
        (N'موزعين', 'Distributors'),
        (N'تجار', 'Retailers'),
        (N'شركات', 'Corporate');
END

GO

IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name='customer_activity_log' AND xtype='U')
BEGIN
    CREATE TABLE customer_activity_log (
        id INT IDENTITY(1,1) PRIMARY KEY,
        customer_id INT NOT NULL,
        activity_type NVARCHAR(50) NOT NULL,
        reference_type NVARCHAR(50) NULL,
        reference_id INT NULL,
        reference_no NVARCHAR(255) NULL,
        amount DECIMAL(18,4) DEFAULT 0,
        description NVARCHAR(MAX) NULL,
        created_by INT NULL,
        created_at NVARCHAR(50) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120),
        metadata NVARCHAR(MAX) NULL
    );
    CREATE INDEX IX_cust_activity_customer_id ON customer_activity_log(customer_id);
END

GO

IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name='customer_attachments' AND xtype='U')
BEGIN
    CREATE TABLE customer_attachments (
        id INT IDENTITY(1,1) PRIMARY KEY,
        customer_id INT NOT NULL,
        file_name NVARCHAR(255) NOT NULL,
        file_type NVARCHAR(50) NULL,
        file_path NVARCHAR(500) NULL,
        description NVARCHAR(500) NULL,
        uploaded_by INT NULL,
        uploaded_at NVARCHAR(50) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120)
    );
    CREATE INDEX IX_cust_attach_customer_id ON customer_attachments(customer_id);
END
