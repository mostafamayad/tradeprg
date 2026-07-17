-- Migration: Add monthly_installment to emp_loans + ensure HR tables exist
-- Run this if tables already exist without the monthly_installment column

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[emp_loans]') AND name = 'monthly_installment')
BEGIN
    ALTER TABLE [dbo].[emp_loans] ADD [monthly_installment] DECIMAL(18,4) DEFAULT 0;
    PRINT 'Added monthly_installment column to emp_loans';
END
ELSE
    PRINT 'monthly_installment column already exists';
GO

-- Ensure employees table exists
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[employees]') AND type in (N'U'))
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
    PRINT 'Created employees table';
END
GO

-- Ensure salary_slips table exists
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
    PRINT 'Created salary_slips table';
END
GO

-- Ensure emp_loans table exists
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[emp_loans]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[emp_loans] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [emp_id] INT NOT NULL,
        [loan_date] NVARCHAR(255) NOT NULL,
        [amount] DECIMAL(18,4) NOT NULL,
        [monthly_installment] DECIMAL(18,4) DEFAULT 0,
        [paid_amount] DECIMAL(18,4) DEFAULT 0,
        [reason] NVARCHAR(MAX),
        [status] NVARCHAR(255) DEFAULT 'active',
        [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120),
        CONSTRAINT [FK_emp_loans_employees_emp_id] FOREIGN KEY ([emp_id]) REFERENCES [dbo].[employees] ([id])
    );
    PRINT 'Created emp_loans table';
END
GO

PRINT 'HR migration completed successfully';
