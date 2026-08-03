const { sql } = require('../database/mssql_db');

/**
 * Accounting Validator Service
 * Performs deep cross-validations on the general ledger to ensure data integrity.
 * Based on Enterprise ERP Rule: Single Source of Truth (journal_entry_lines).
 */

class AccountingValidator {
    constructor(pool) {
        this.pool = pool;
    }

    /**
     * Checks if Total Debit == Total Credit across the entire GL
     */
    async validateTrialBalance() {
        const query = `
            SELECT 
                SUM(jel.debit) as total_debit, 
                SUM(jel.credit) as total_credit
            FROM journal_entry_lines jel
            JOIN journal_entries je ON jel.entry_id = je.id
            WHERE (je.is_reversed = 0 OR je.is_reversed IS NULL)
        `;
        const result = await this.pool.request().query(query);
        const { total_debit, total_credit } = result.recordset[0];
        const diff = Math.abs((total_debit || 0) - (total_credit || 0));

        return {
            passed: diff < 0.01,
            total_debit: total_debit || 0,
            total_credit: total_credit || 0,
            difference: diff,
            message: diff < 0.01 ? 'Trial Balance is balanced.' : 'CRITICAL: Trial Balance is out of balance!'
        };
    }

    /**
     * Validates that Customer and Supplier Statement sums match the AR/AP Control Accounts
     */
    async validateSubLedgers() {
        // 1. Get AR Control Balance
        const arQuery = `
            SELECT 
                SUM(jel.debit - jel.credit) as ar_gl_balance
            FROM journal_entry_lines jel
            JOIN journal_entries je ON jel.entry_id = je.id
            JOIN chart_of_accounts coa ON jel.account_id = coa.id
            WHERE coa.system_code = 'SYS_AR' 
              AND (je.is_reversed = 0 OR je.is_reversed IS NULL)
        `;
        const arResult = await this.pool.request().query(arQuery);
        const ar_gl_balance = arResult.recordset[0].ar_gl_balance || 0;

        // 2. Get Sum of all Customer Balances (from subledger)
        const custQuery = `
            SELECT 
                SUM(je.total_debit - je.total_credit) as subledger_ar_balance
            FROM journal_entries je
            WHERE je.customer_id IS NOT NULL 
              AND (je.is_reversed = 0 OR je.is_reversed IS NULL)
        `;
        // Wait, total_debit - total_credit of the ENTIRE journal entry is always 0.
        // We must query the specific lines hitting the AR account, but grouped by customer.
        // Since customer_id is on journal_entries and the AR line is in journal_entry_lines:
        const custAccQuery = `
            SELECT 
                SUM(jel.debit - jel.credit) as subledger_ar_balance
            FROM journal_entry_lines jel
            JOIN journal_entries je ON jel.entry_id = je.id
            JOIN chart_of_accounts coa ON jel.account_id = coa.id
            WHERE coa.system_code = 'SYS_AR' 
              AND je.customer_id IS NOT NULL
              AND (je.is_reversed = 0 OR je.is_reversed IS NULL)
        `;
        const custAccResult = await this.pool.request().query(custAccQuery);
        const subledger_ar_balance = custAccResult.recordset[0].subledger_ar_balance || 0;
        
        const ar_diff = Math.abs(ar_gl_balance - subledger_ar_balance);

        // Do the same for AP
        const apQuery = `
            SELECT 
                SUM(jel.credit - jel.debit) as ap_gl_balance
            FROM journal_entry_lines jel
            JOIN journal_entries je ON jel.entry_id = je.id
            JOIN chart_of_accounts coa ON jel.account_id = coa.id
            WHERE coa.system_code = 'SYS_AP' 
              AND (je.is_reversed = 0 OR je.is_reversed IS NULL)
        `;
        const apResult = await this.pool.request().query(apQuery);
        const ap_gl_balance = apResult.recordset[0].ap_gl_balance || 0;

        const supAccQuery = `
            SELECT 
                SUM(jel.credit - jel.debit) as subledger_ap_balance
            FROM journal_entry_lines jel
            JOIN journal_entries je ON jel.entry_id = je.id
            JOIN chart_of_accounts coa ON jel.account_id = coa.id
            WHERE coa.system_code = 'SYS_AP' 
              AND je.supplier_id IS NOT NULL
              AND (je.is_reversed = 0 OR je.is_reversed IS NULL)
        `;
        const supAccResult = await this.pool.request().query(supAccQuery);
        const subledger_ap_balance = supAccResult.recordset[0].subledger_ap_balance || 0;
        
        const ap_diff = Math.abs(ap_gl_balance - subledger_ap_balance);

        return {
            passed: ar_diff < 0.01 && ap_diff < 0.01,
            ar: {
                gl_balance: ar_gl_balance,
                subledger_balance: subledger_ar_balance,
                difference: ar_diff,
                passed: ar_diff < 0.01
            },
            ap: {
                gl_balance: ap_gl_balance,
                subledger_balance: subledger_ap_balance,
                difference: ap_diff,
                passed: ap_diff < 0.01
            }
        };
    }

    /**
     * Cross-Validation: Income Statement Net Profit == Balance Sheet Current Year Earnings
     */
    async validateFinancialStatements() {
        // Calculate Net Profit (Revenues - Expenses)
        const plQuery = `
            SELECT 
                SUM(CASE WHEN coa.account_type = 'revenue' THEN jel.credit - jel.debit ELSE 0 END) as total_revenue,
                SUM(CASE WHEN coa.account_type = 'expense' THEN jel.debit - jel.credit ELSE 0 END) as total_expense
            FROM journal_entry_lines jel
            JOIN journal_entries je ON jel.entry_id = je.id
            JOIN chart_of_accounts coa ON jel.account_id = coa.id
            WHERE coa.account_type IN ('revenue', 'expense')
              AND (je.is_reversed = 0 OR je.is_reversed IS NULL)
        `;
        const plResult = await this.pool.request().query(plQuery);
        const { total_revenue, total_expense } = plResult.recordset[0];
        const net_profit = (total_revenue || 0) - (total_expense || 0);

        // Calculate Balance Sheet Equation (Assets = Liabilities + Equity)
        const bsQuery = `
            SELECT 
                SUM(CASE WHEN coa.account_type = 'asset' THEN jel.debit - jel.credit ELSE 0 END) as total_assets,
                SUM(CASE WHEN coa.account_type = 'liability' THEN jel.credit - jel.debit ELSE 0 END) as total_liabilities,
                SUM(CASE WHEN coa.account_type = 'equity' THEN jel.credit - jel.debit ELSE 0 END) as total_equity
            FROM journal_entry_lines jel
            JOIN journal_entries je ON jel.entry_id = je.id
            JOIN chart_of_accounts coa ON jel.account_id = coa.id
            WHERE coa.account_type IN ('asset', 'liability', 'equity')
              AND (je.is_reversed = 0 OR je.is_reversed IS NULL)
        `;
        const bsResult = await this.pool.request().query(bsQuery);
        const { total_assets, total_liabilities, total_equity } = bsResult.recordset[0];
        
        // Assets should equal Liabilities + Equity + Net Profit
        const bs_equation_diff = Math.abs((total_assets || 0) - ((total_liabilities || 0) + (total_equity || 0) + net_profit));

        return {
            passed: bs_equation_diff < 0.01,
            net_profit: net_profit,
            balance_sheet: {
                assets: total_assets || 0,
                liabilities: total_liabilities || 0,
                equity: total_equity || 0,
                expected_assets: (total_liabilities || 0) + (total_equity || 0) + net_profit,
                difference: bs_equation_diff
            }
        };
    }

    /**
     * Run all checks
     */
    async runFullIntegrityCheck() {
        const tb = await this.validateTrialBalance();
        const sub = await this.validateSubLedgers();
        const fin = await this.validateFinancialStatements();

        const allPassed = tb.passed && sub.passed && fin.passed;

        return {
            success: allPassed,
            timestamp: new Date().toISOString(),
            checks: {
                trial_balance: tb,
                subledgers: sub,
                financial_statements: fin
            }
        };
    }
}

module.exports = AccountingValidator;
