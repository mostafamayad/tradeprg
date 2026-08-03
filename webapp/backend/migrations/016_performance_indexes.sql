-- Migration: 016_performance_indexes
-- Adds critical performance indexes for accounting, inventory, and reporting queries
-- Idempotent: each CREATE INDEX checks for existence first

-- journal_entry_lines: FK lookups and GL reporting
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_jel_entry_id')
    CREATE NONCLUSTERED INDEX IX_jel_entry_id ON journal_entry_lines(entry_id) INCLUDE (account_id, debit, credit);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_jel_account_id')
    CREATE NONCLUSTERED INDEX IX_jel_account_id ON journal_entry_lines(account_id) INCLUDE (debit, credit, entry_id);

-- journal_entries: date range queries and reference lookups
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_je_entry_date')
    CREATE NONCLUSTERED INDEX IX_je_entry_date ON journal_entries(entry_date) INCLUDE (total_debit, total_credit);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_je_reference')
    CREATE NONCLUSTERED INDEX IX_je_reference ON journal_entries(reference_type, reference_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_je_source')
    CREATE NONCLUSTERED INDEX IX_je_source ON journal_entries(source_module, source_action, source_document);

-- sales_invoice_items: product sales reports
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sii_invoice_id')
    CREATE NONCLUSTERED INDEX IX_sii_invoice_id ON sales_invoice_items(invoice_id) INCLUDE (product_id, quantity, line_total, cost_price);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sii_product_id')
    CREATE NONCLUSTERED INDEX IX_sii_product_id ON sales_invoice_items(product_id) INCLUDE (quantity, line_total, cost_price);

-- purchase_invoice_items
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_pii_invoice_id')
    CREATE NONCLUSTERED INDEX IX_pii_invoice_id ON purchase_invoice_items(invoice_id) INCLUDE (product_id, quantity, cost_price, line_total);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_pii_product_id')
    CREATE NONCLUSTERED INDEX IX_pii_product_id ON purchase_invoice_items(product_id) INCLUDE (quantity, cost_price);

-- stock_movements: inventory queries
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sm_store_product')
    CREATE NONCLUSTERED INDEX IX_sm_store_product ON stock_movements(store_id, product_id) INCLUDE (move_date, move_type, qty_in, qty_out, balance_after);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sm_move_date')
    CREATE NONCLUSTERED INDEX IX_sm_move_date ON stock_movements(move_date) INCLUDE (store_id, product_id, move_type);

-- inventory_balances: balance lookups
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ib_store_product')
    CREATE UNIQUE NONCLUSTERED INDEX IX_ib_store_product ON inventory_balances(store_id, product_id) INCLUDE (quantity);

-- customer_collections: date range and customer lookups
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_cc_customer_date')
    CREATE NONCLUSTERED INDEX IX_cc_customer_date ON customer_collections(customer_id, collection_date) INCLUDE (amount);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_cc_rep_id')
    CREATE NONCLUSTERED INDEX IX_cc_rep_id ON customer_collections(rep_id) INCLUDE (amount) WHERE rep_id IS NOT NULL;

-- supplier_payments: date range and supplier lookups
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sp_supplier_date')
    CREATE NONCLUSTERED INDEX IX_sp_supplier_date ON supplier_payments(supplier_id, payment_date) INCLUDE (amount);

-- sales_invoices: customer and date lookups
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_si_customer_date')
    CREATE NONCLUSTERED INDEX IX_si_customer_date ON sales_invoices(customer_id, invoice_date) INCLUDE (grand_total, status, remaining);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_si_rep_id_status')
    CREATE NONCLUSTERED INDEX IX_si_rep_id_status ON sales_invoices(rep_id, status) INCLUDE (grand_total) WHERE rep_id IS NOT NULL;

-- purchase_invoices: supplier and date lookups
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_pi_supplier_date')
    CREATE NONCLUSTERED INDEX IX_pi_supplier_date ON purchase_invoices(supplier_id, invoice_date) INCLUDE (grand_total, status);

-- sales_returns: customer lookups
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sr_customer_date')
    CREATE NONCLUSTERED INDEX IX_sr_customer_date ON sales_returns(customer_id, return_date) INCLUDE (grand_total, status);

-- purchase_returns: supplier lookups
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_pr_supplier_date')
    CREATE NONCLUSTERED INDEX IX_pr_supplier_date ON purchase_returns(supplier_id, return_date) INCLUDE (grand_total, status);

-- checks: payment/collection lookups
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_chk_payment')
    CREATE NONCLUSTERED INDEX IX_chk_payment ON checks(payment_id) WHERE payment_id IS NOT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_chk_collection')
    CREATE NONCLUSTERED INDEX IX_chk_collection ON checks(collection_id) WHERE collection_id IS NOT NULL;

-- chart_of_accounts: hierarchy lookups
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_coa_parent')
    CREATE NONCLUSTERED INDEX IX_coa_parent ON chart_of_accounts(parent_id) WHERE parent_id IS NOT NULL;
