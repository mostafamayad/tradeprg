// ============================================================
// TradePro ERP - SQLite Database Initialization
// Creates all tables on first run
// ============================================================

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

// Database file path (local SQLite file)
const DB_PATH = path.join(__dirname, 'tradeprodb.sqlite');

const db = new DatabaseSync(DB_PATH);

// Helper for transaction
db.transaction = function(func) {
    return function(...args) {
        db.exec('BEGIN IMMEDIATE');
        try {
            const result = func(...args);
            db.exec('COMMIT');
            return result;
        } catch (err) {
            db.exec('ROLLBACK');
            throw err;
        }
    };
};

// Enable WAL mode for better performance
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// ─── Create All Tables ─────────────────────────────────────
db.exec(`

-- ============================================================
-- SETTINGS & FOUNDATION
-- ============================================================

CREATE TABLE IF NOT EXISTS company_info (
    id INTEGER PRIMARY KEY DEFAULT 1,
    company_name TEXT NOT NULL DEFAULT 'شركتي',
    company_address TEXT,
    company_phone TEXT,
    company_email TEXT,
    tax_number TEXT,
    currency TEXT DEFAULT 'ج.م',
    fiscal_year_start TEXT DEFAULT '01-01',
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS branches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_code TEXT NOT NULL UNIQUE,
    branch_name TEXT NOT NULL,
    manager_name TEXT,
    phone TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT DEFAULT 'user',  -- admin, manager, user, sales
    branch_id INTEGER,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_code TEXT NOT NULL UNIQUE,
    store_name TEXT NOT NULL,
    store_type TEXT DEFAULT 'main',
    branch_id INTEGER,
    notes TEXT
);

-- ============================================================
-- CRM: CUSTOMERS, SUPPLIERS, SALES REPS
-- ============================================================

CREATE TABLE IF NOT EXISTS sales_reps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rep_code TEXT UNIQUE,
    rep_name TEXT NOT NULL,
    phone TEXT,
    region TEXT,
    target_amount REAL DEFAULT 0,
    commission_rate REAL DEFAULT 0,
    is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_code TEXT NOT NULL UNIQUE,
    customer_name TEXT NOT NULL,
    customer_type TEXT DEFAULT 'retail',   -- retail, wholesale, vip
    phone TEXT,
    phone2 TEXT,
    address TEXT,
    region TEXT,
    credit_limit REAL DEFAULT 0,
    opening_balance REAL DEFAULT 0,        -- الرصيد الافتتاحي
    current_balance REAL DEFAULT 0,        -- يُحسب تلقائياً
    rep_id INTEGER REFERENCES sales_reps(id),
    notes TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_code TEXT NOT NULL UNIQUE,
    supplier_name TEXT NOT NULL,
    phone TEXT,
    phone2 TEXT,
    address TEXT,
    opening_balance REAL DEFAULT 0,
    current_balance REAL DEFAULT 0,
    notes TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- PRODUCTS & INVENTORY
-- ============================================================

CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_name TEXT NOT NULL,
    parent_id INTEGER
);

CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_code TEXT NOT NULL UNIQUE,
    product_name TEXT NOT NULL,
    category_id INTEGER REFERENCES categories(id),
    unit_name TEXT DEFAULT 'قطعة',
    alt_unit TEXT,
    unit_factor REAL DEFAULT 1,
    cost_price REAL DEFAULT 0,
    sell_price REAL DEFAULT 0,
    sell_price2 REAL DEFAULT 0,
    sell_price3 REAL DEFAULT 0,
    min_stock REAL DEFAULT 0,
    max_stock REAL DEFAULT 0,
    barcode TEXT,
    shelf_no TEXT,
    tax_rate REAL DEFAULT 0,
    notes TEXT,
    is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS inventory_balances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL REFERENCES stores(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity REAL DEFAULT 0,
    UNIQUE(store_id, product_id)
);

CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    move_date TEXT NOT NULL,
    move_type TEXT NOT NULL,   -- in, out, transfer, adjust, damaged
    document_no TEXT,
    store_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    qty_in REAL DEFAULT 0,
    qty_out REAL DEFAULT 0,
    cost_price REAL DEFAULT 0,
    sell_price REAL DEFAULT 0,
    balance_after REAL DEFAULT 0,
    reference_id INTEGER,      -- invoice_id or transfer_id
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- SALES
-- ============================================================

CREATE TABLE IF NOT EXISTS sales_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_no TEXT NOT NULL UNIQUE,
    invoice_date TEXT NOT NULL,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    rep_id INTEGER REFERENCES sales_reps(id),
    store_id INTEGER NOT NULL,
    payment_type TEXT DEFAULT 'cash',   -- cash, credit
    subtotal REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    discount_pct REAL DEFAULT 0,
    tax_amount REAL DEFAULT 0,
    grand_total REAL DEFAULT 0,
    amount_paid REAL DEFAULT 0,
    remaining REAL DEFAULT 0,
    notes TEXT,
    status TEXT DEFAULT 'posted',       -- draft, posted, cancelled
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sales_invoice_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity REAL NOT NULL,
    unit_price REAL NOT NULL,
    cost_price REAL DEFAULT 0,
    discount_pct REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    line_total REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS sales_returns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    return_no TEXT NOT NULL UNIQUE,
    return_date TEXT NOT NULL,
    invoice_id INTEGER REFERENCES sales_invoices(id),
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    store_id INTEGER NOT NULL,
    grand_total REAL DEFAULT 0,
    return_reason TEXT,
    notes TEXT,
    status TEXT DEFAULT 'posted',
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sales_return_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    return_id INTEGER NOT NULL REFERENCES sales_returns(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL,
    quantity REAL NOT NULL,
    unit_price REAL NOT NULL,
    line_total REAL NOT NULL
);

-- تحصيلات العملاء
CREATE TABLE IF NOT EXISTS customer_collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    collection_no TEXT NOT NULL UNIQUE,
    collection_date TEXT NOT NULL,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    rep_id INTEGER REFERENCES sales_reps(id),
    amount REAL NOT NULL,
    payment_method TEXT DEFAULT 'cash',  -- cash, check, transfer
    check_no TEXT,
    check_date TEXT,
    bank_name TEXT,
    notes TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS collection_allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    collection_id INTEGER NOT NULL REFERENCES customer_collections(id) ON DELETE CASCADE,
    invoice_id INTEGER NOT NULL REFERENCES sales_invoices(id),
    amount REAL NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- PURCHASES
-- ============================================================

CREATE TABLE IF NOT EXISTS purchase_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_no TEXT NOT NULL UNIQUE,
    supplier_invoice_no TEXT,
    invoice_date TEXT NOT NULL,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    store_id INTEGER NOT NULL,
    payment_type TEXT DEFAULT 'cash',
    subtotal REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    tax_amount REAL DEFAULT 0,
    grand_total REAL DEFAULT 0,
    amount_paid REAL DEFAULT 0,
    remaining REAL DEFAULT 0,
    notes TEXT,
    status TEXT DEFAULT 'posted',
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchase_invoice_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity REAL NOT NULL,
    cost_price REAL NOT NULL,
    sell_price REAL DEFAULT 0,
    line_total REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_returns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    return_no TEXT NOT NULL UNIQUE,
    return_date TEXT NOT NULL,
    invoice_id INTEGER REFERENCES purchase_invoices(id),
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    store_id INTEGER NOT NULL,
    grand_total REAL DEFAULT 0,
    return_reason TEXT,
    notes TEXT,
    status TEXT DEFAULT 'posted',
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchase_return_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    return_id INTEGER NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL,
    quantity REAL NOT NULL,
    cost_price REAL NOT NULL,
    line_total REAL NOT NULL
);

-- مدفوعات للموردين
CREATE TABLE IF NOT EXISTS supplier_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_no TEXT NOT NULL UNIQUE,
    payment_date TEXT NOT NULL,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    amount REAL NOT NULL,
    payment_method TEXT DEFAULT 'cash',
    check_no TEXT,
    check_date TEXT,
    bank_name TEXT,
    notes TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- CHECKS (CHEQUES) — inward & outward management
-- ============================================================
CREATE TABLE IF NOT EXISTS checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    check_no TEXT NOT NULL,
    check_date TEXT NOT NULL,
    due_date TEXT,
    amount REAL NOT NULL,
    direction TEXT DEFAULT 'inward',  -- inward (from customer) | outward (to supplier)
    status TEXT DEFAULT 'pending',     -- pending, collected, returned, deposited, endorsed, bounced, cancelled
    customer_id INTEGER REFERENCES customers(id),
    supplier_id INTEGER REFERENCES suppliers(id),
    bank_name TEXT,
    account_no TEXT,
    collection_id INTEGER REFERENCES customer_collections(id),
    payment_id INTEGER REFERENCES supplier_payments(id),
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- INVENTORY ENHANCEMENTS — stock transfers, damaged, count
-- ============================================================
CREATE TABLE IF NOT EXISTS stock_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transfer_no TEXT NOT NULL UNIQUE,
    transfer_date TEXT NOT NULL,
    from_store_id INTEGER NOT NULL,
    to_store_id INTEGER NOT NULL,
    notes TEXT,
    status TEXT DEFAULT 'posted',
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stock_transfer_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transfer_id INTEGER NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL,
    quantity REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS damaged_stock (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_no TEXT NOT NULL UNIQUE,
    doc_date TEXT NOT NULL,
    store_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity REAL NOT NULL,
    reason TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stock_count (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    count_no TEXT NOT NULL UNIQUE,
    count_date TEXT NOT NULL,
    store_id INTEGER NOT NULL,
    status TEXT DEFAULT 'in_progress',  -- in_progress, completed, cancelled
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stock_count_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    count_id INTEGER NOT NULL REFERENCES stock_count(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL,
    system_qty REAL DEFAULT 0,
    counted_qty REAL DEFAULT 0,
    diff REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stock_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    adj_no TEXT NOT NULL UNIQUE,
    adj_date TEXT NOT NULL,
    store_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity REAL NOT NULL,           -- signed (+/-)
    reason TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- CRM: customer notes, visits, work plans
-- ============================================================
CREATE TABLE IF NOT EXISTS customer_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    note_date TEXT NOT NULL,
    note_text TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customer_visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    rep_id INTEGER REFERENCES sales_reps(id),
    visit_date TEXT NOT NULL,
    purpose TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rep_targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rep_id INTEGER NOT NULL REFERENCES sales_reps(id),
    period TEXT NOT NULL,         -- e.g. '2026-06'
    target_amount REAL DEFAULT 0,
    notes TEXT,
    UNIQUE(rep_id, period)
);

CREATE TABLE IF NOT EXISTS rep_settlements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rep_id INTEGER NOT NULL REFERENCES sales_reps(id),
    period TEXT NOT NULL,
    sales_amount REAL DEFAULT 0,
    collections_amount REAL DEFAULT 0,
    commission REAL DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- ACCOUNTING: Chart of accounts, journal entries
-- ============================================================
CREATE TABLE IF NOT EXISTS chart_of_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_code TEXT NOT NULL UNIQUE,
    account_name TEXT NOT NULL,
    parent_id INTEGER,
    account_type TEXT NOT NULL,   -- asset, liability, equity, revenue, expense
    current_balance REAL DEFAULT 0,
    is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS journal_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_no TEXT NOT NULL UNIQUE,
    entry_date TEXT NOT NULL,
    description TEXT,
    reference_type TEXT,         -- sales, purchase, collection, payment, manual
    reference_id INTEGER,
    total_debit REAL DEFAULT 0,
    total_credit REAL DEFAULT 0,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS journal_entry_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES chart_of_accounts(id),
    debit REAL DEFAULT 0,
    credit REAL DEFAULT 0,
    description TEXT
);

-- Expenses / receipts (other than customer/supplier)
CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    expense_no TEXT NOT NULL UNIQUE,
    expense_date TEXT NOT NULL,
    expense_type TEXT DEFAULT 'general',  -- general, salary, rent, utility
    account_id INTEGER REFERENCES chart_of_accounts(id),
    treasury_id INTEGER REFERENCES treasury_accounts(id),
    amount REAL NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- HR: salary slips, loans, attendance
-- ============================================================
CREATE TABLE IF NOT EXISTS salary_slips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slip_no TEXT NOT NULL UNIQUE,
    period TEXT NOT NULL,            -- e.g. '2026-06'
    emp_id INTEGER NOT NULL REFERENCES employees(id),
    basic_salary REAL DEFAULT 0,
    allowances REAL DEFAULT 0,
    deductions REAL DEFAULT 0,
    loans REAL DEFAULT 0,
    net_salary REAL DEFAULT 0,
    status TEXT DEFAULT 'draft',     -- draft, posted, paid
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS emp_loans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    emp_id INTEGER NOT NULL REFERENCES employees(id),
    loan_date TEXT NOT NULL,
    amount REAL NOT NULL,
    paid_amount REAL DEFAULT 0,
    reason TEXT,
    status TEXT DEFAULT 'active',    -- active, settled
    created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- SETTINGS — extra
-- ============================================================
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    action_type TEXT,
    entity_type TEXT,
    entity_id TEXT,
    details TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- ============================================================
-- TREASURY & ACCOUNTING
-- ============================================================

CREATE TABLE IF NOT EXISTS treasury_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_name TEXT NOT NULL,
    account_type TEXT DEFAULT 'cash',   -- cash, bank
    bank_name TEXT,
    account_no TEXT,
    opening_balance REAL DEFAULT 0,
    current_balance REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS treasury_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trans_no TEXT UNIQUE,
    trans_date TEXT NOT NULL,
    trans_type TEXT NOT NULL,           -- in, out
    amount REAL NOT NULL,
    account_id INTEGER NOT NULL REFERENCES treasury_accounts(id),
    related_type TEXT,                  -- customer, supplier, expense
    related_id INTEGER,
    document_no TEXT,
    description TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- HR
-- ============================================================

CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    emp_code TEXT NOT NULL UNIQUE,
    emp_name TEXT NOT NULL,
    department TEXT,
    job_title TEXT,
    basic_salary REAL DEFAULT 0,
    hire_date TEXT,
    phone TEXT,
    national_id TEXT,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- SYSTEM: Invoice Counters
-- ============================================================

CREATE TABLE IF NOT EXISTS invoice_counters (
    id INTEGER PRIMARY KEY,
    counter_name TEXT NOT NULL UNIQUE,  -- sales, purchases, collections, payments, returns
    prefix TEXT DEFAULT '',
    last_number INTEGER DEFAULT 0
);

`);

// ─── MIGRATIONS: ensure legacy columns exist ──────────────
// These ALTER statements must run outside the big CREATE block.
try { db.exec("ALTER TABLE sales_returns ADD COLUMN notes TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE purchase_returns ADD COLUMN notes TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE sales_invoices ADD COLUMN notes TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE purchase_invoices ADD COLUMN notes TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE customer_collections ADD COLUMN check_no TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE customer_collections ADD COLUMN check_date TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE customer_collections ADD COLUMN bank_name TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE customer_collections ADD COLUMN payment_method TEXT DEFAULT 'cash'"); } catch(e) {}
try { db.exec("ALTER TABLE sales_invoices ADD COLUMN invoice_type TEXT DEFAULT 'normal'"); } catch(e) {}

// ─── Insert Default Data (if empty) ────────────────────────

// Default company info
const companyExists = db.prepare('SELECT id FROM company_info LIMIT 1').get();
if (!companyExists) {
    db.prepare(`INSERT INTO company_info (id, company_name, currency) VALUES (1, 'شركتي للتجارة', 'ج.م')`).run();
}

// Default main store
const storeExists = db.prepare('SELECT id FROM stores LIMIT 1').get();
if (!storeExists) {
    db.prepare(`INSERT INTO stores (store_code, store_name, store_type) VALUES ('ST001', 'المخزن الرئيسي', 'main')`).run();
}

// Default admin user
const userExists = db.prepare('SELECT id FROM users LIMIT 1').get();
if (!userExists) {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare(`INSERT INTO users (username, password_hash, full_name, role) VALUES ('admin', ?, 'المدير العام', 'admin')`).run(hash);
    console.log('[DB] Default admin user created. Please change the default password immediately.');
}

// Default invoice counters
const counters = ['sales', 'purchases', 'collections', 'supplier_payments', 'sales_returns', 'purchase_returns', 'treasury',
                  'transfer', 'damaged', 'adjustment', 'count', 'journal', 'expense'];
const insertCounter = db.prepare(`INSERT OR IGNORE INTO invoice_counters (counter_name, prefix, last_number) VALUES (?, ?, 0)`);
counters.forEach(c => {
    const prefixes = {
        sales: 'INV', purchases: 'PUR', collections: 'REC', supplier_payments: 'PAY',
        sales_returns: 'SRT', purchase_returns: 'PRT', treasury: 'TRS',
        transfer: 'TRF', damaged: 'DMG', adjustment: 'ADJ', count: 'CNT', journal: 'JV',
        expense: 'EXP'
    };
    insertCounter.run(c, prefixes[c] || 'DOC');
});

// Default treasury account (الخزينة الرئيسية)
const treasuryExists = db.prepare('SELECT id FROM treasury_accounts LIMIT 1').get();
if (!treasuryExists) {
    db.prepare(`INSERT INTO treasury_accounts (account_name, account_type, opening_balance, current_balance) VALUES ('الخزينة الرئيسية', 'cash', 0, 0)`).run();
}

console.log('[DB] Database initialized at:', DB_PATH);

module.exports = db;
