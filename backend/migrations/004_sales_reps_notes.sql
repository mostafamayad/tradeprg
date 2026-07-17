-- Migration: 004_sales_reps_notes
-- Add notes column to sales_reps for rep management
-- Idempotent: checks column existence first

IF COL_LENGTH('sales_reps', 'notes') IS NULL
BEGIN
    ALTER TABLE sales_reps ADD notes NVARCHAR(MAX) NULL;
END
