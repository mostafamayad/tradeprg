-- Migration 004: HR Module - Attendance, Vacations, Penalties, Rewards
-- All new tables for the complete HR module

-- 1. ATTENDANCE TABLE
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[emp_attendance]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[emp_attendance] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [emp_id] INT NOT NULL,
        [att_date] NVARCHAR(255) NOT NULL,
        [check_in] NVARCHAR(255),
        [check_out] NVARCHAR(255),
        [status] NVARCHAR(255) DEFAULT 'present',
        [late_minutes] INT DEFAULT 0,
        [overtime_minutes] INT DEFAULT 0,
        [notes] NVARCHAR(MAX),
        [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120),
        CONSTRAINT [FK_emp_attendance_employees_emp_id] FOREIGN KEY ([emp_id]) REFERENCES [dbo].[employees] ([id])
    );
    CREATE UNIQUE INDEX IX_emp_attendance_emp_date ON emp_attendance(emp_id, att_date);
    PRINT 'Created emp_attendance table';
END
GO

-- 2. VACATIONS TABLE
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[emp_vacations]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[emp_vacations] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [emp_id] INT NOT NULL,
        [vac_type] NVARCHAR(255) DEFAULT 'annual',
        [start_date] NVARCHAR(255) NOT NULL,
        [end_date] NVARCHAR(255) NOT NULL,
        [days] INT NOT NULL DEFAULT 1,
        [reason] NVARCHAR(MAX),
        [status] NVARCHAR(255) DEFAULT 'pending',
        [approved_by] NVARCHAR(255),
        [approved_at] NVARCHAR(255),
        [notes] NVARCHAR(MAX),
        [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120),
        CONSTRAINT [FK_emp_vacations_employees_emp_id] FOREIGN KEY ([emp_id]) REFERENCES [dbo].[employees] ([id])
    );
    PRINT 'Created emp_vacations table';
END
GO

-- 3. PENALTIES TABLE
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[emp_penalties]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[emp_penalties] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [emp_id] INT NOT NULL,
        [penalty_type] NVARCHAR(255) NOT NULL,
        [penalty_date] NVARCHAR(255) NOT NULL,
        [amount] DECIMAL(18,4) DEFAULT 0,
        [reason] NVARCHAR(MAX),
        [status] NVARCHAR(255) DEFAULT 'active',
        [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120),
        CONSTRAINT [FK_emp_penalties_employees_emp_id] FOREIGN KEY ([emp_id]) REFERENCES [dbo].[employees] ([id])
    );
    PRINT 'Created emp_penalties table';
END
GO

-- 4. REWARDS TABLE
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[emp_rewards]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[emp_rewards] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [emp_id] INT NOT NULL,
        [reward_type] NVARCHAR(255) NOT NULL,
        [reward_date] NVARCHAR(255) NOT NULL,
        [amount] DECIMAL(18,4) DEFAULT 0,
        [reason] NVARCHAR(MAX),
        [status] NVARCHAR(255) DEFAULT 'active',
        [created_at] NVARCHAR(255) DEFAULT CONVERT(VARCHAR(19), GETDATE(), 120),
        CONSTRAINT [FK_emp_rewards_employees_emp_id] FOREIGN KEY ([emp_id]) REFERENCES [dbo].[employees] ([id])
    );
    PRINT 'Created emp_rewards table';
END
GO

PRINT 'HR Migration 004 completed successfully';
