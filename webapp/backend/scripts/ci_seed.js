#!/usr/bin/env node
/**
 * TradePro ERP — CI Baseline Seed (Phase 1)
 * ------------------------------------------------------------
 * Builds an audit-clean baseline on a FRESH TradePro database so the
 * Phase 1 integration suite and `scripts/integrity_audit.js` can run
 * against a known, self-consistent state (target: 0 issues / 0 errors).
 *
 * Design requirements (see scripts/integrity_audit.js):
 *   - inventory_balances.quantity == SUM(stock_movements qty_in - qty_out) per product/store
 *   - balance_after chain consistent (single opening movement per product)
 *   - stock value (qty × cost) == SYS_INVENTORY GL balance
 *   - every COA current_balance == GL balance (opening JE balanced, TB balanced)
 *   - customers / suppliers current_balance == 0 == GL (no AR/AP docs)
 *   - an OPEN fiscal period exists covering today (no closed periods)
 *
 * SAFETY: refuses to run on any database that already contains data
 * (journal_entries rows, sales invoices, ...). Intended for CI only —
 * never run against the production TradePro database.
 *
 * Usage:
 *   node scripts/ci_seed.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { getPool, sql } = require('../database/mssql_db');

const STORE_ID = 1; // main store (ST001) — seeded by the server
const OPENING_DOC = 'CI-OPENING-STOCK';
const OPENING_ENTRY = 'JE-CI-OPENING';

const PRODUCTS = [
  { id: 1, code: 'نيمو', name: 'نيمو', cost: 190.00, sell: 230, qty: 31 },   // prodA (id 1)
  { id: 2, code: 'اوكسي', name: 'اوكسي', cost: 187.94, sell: 220, qty: 10 }  // prodB (id 2)
];

const EXTRA_TABLES = {
  fiscal_periods: `
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'fiscal_periods')
    BEGIN
        CREATE TABLE fiscal_periods (
            id INT IDENTITY(1,1) PRIMARY KEY,
            name NVARCHAR(100) NOT NULL,
            start_date DATE NOT NULL,
            end_date DATE NOT NULL,
            status NVARCHAR(20) NOT NULL DEFAULT 'open',
            opened_by INT NULL,
            closed_by INT NULL,
            opened_at DATETIME DEFAULT GETDATE(),
            closed_at DATETIME NULL,
            notes NVARCHAR(MAX) NULL,
            CONSTRAINT uq_fiscal_period_name UNIQUE (name),
            CONSTRAINT ck_fiscal_period_dates CHECK (end_date >= start_date),
            CONSTRAINT ck_fiscal_period_status CHECK (status IN ('open', 'closed'))
        );
    END`,
  ar_payments: `
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ar_payments')
    BEGIN
        CREATE TABLE ar_payments (
            id INT IDENTITY(1,1) PRIMARY KEY,
            payment_no NVARCHAR(50) NOT NULL,
            payment_date DATE NOT NULL,
            customer_id INT NOT NULL,
            amount DECIMAL(18,4) NOT NULL,
            payment_method NVARCHAR(20) DEFAULT 'cash',
            check_no NVARCHAR(100) NULL,
            check_date DATE NULL,
            bank_name NVARCHAR(255) NULL,
            notes NVARCHAR(500) NULL,
            status NVARCHAR(20) DEFAULT 'active',
            created_by INT NULL,
            created_at DATETIME DEFAULT GETDATE(),
            reversed_at DATETIME NULL,
            reversed_by INT NULL
        );
    END`,
  ap_payments: `
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ap_payments')
    BEGIN
        CREATE TABLE ap_payments (
            id INT IDENTITY(1,1) PRIMARY KEY,
            payment_no NVARCHAR(50) NOT NULL,
            payment_date DATE NOT NULL,
            supplier_id INT NOT NULL,
            amount DECIMAL(18,4) NOT NULL,
            payment_method NVARCHAR(20) DEFAULT 'cash',
            check_no NVARCHAR(100) NULL,
            check_date DATE NULL,
            bank_name NVARCHAR(255) NULL,
            notes NVARCHAR(500) NULL,
            status NVARCHAR(20) DEFAULT 'active',
            created_by INT NULL,
            created_at DATETIME DEFAULT GETDATE(),
            reversed_at DATETIME NULL,
            reversed_by INT NULL
        );
    END`,
  ar_payment_allocations: `
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ar_payment_allocations')
    BEGIN
        CREATE TABLE ar_payment_allocations (
            id INT IDENTITY(1,1) PRIMARY KEY,
            payment_id INT NOT NULL,
            invoice_id INT NOT NULL,
            allocated_amount DECIMAL(18,4) NOT NULL
        );
    END`,
  ap_payment_allocations: `
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ap_payment_allocations')
    BEGIN
        CREATE TABLE ap_payment_allocations (
            id INT IDENTITY(1,1) PRIMARY KEY,
            payment_id INT NOT NULL,
            invoice_id INT NOT NULL,
            allocated_amount DECIMAL(18,4) NOT NULL
        );
    END`,
  ar_cheques: `
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ar_cheques')
    BEGIN
        CREATE TABLE ar_cheques (
            id INT IDENTITY(1,1) PRIMARY KEY,
            cheque_no NVARCHAR(100) NOT NULL,
            cheque_date DATE NOT NULL,
            due_date DATE NULL,
            amount DECIMAL(18,4) NOT NULL,
            bank_name NVARCHAR(255) NULL,
            customer_id INT NULL,
            payment_id INT NULL,
            status NVARCHAR(20) NULL,
            status_date DATE NULL,
            notes NVARCHAR(500) NULL,
            created_by INT NULL,
            created_at DATETIME DEFAULT GETDATE(),
            account_no NVARCHAR(100) NULL,
            updated_at NVARCHAR(100) NULL
        );
    END`,
  ar_notes: `
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ar_notes')
    BEGIN
        CREATE TABLE ar_notes (
            id INT IDENTITY(1,1) PRIMARY KEY,
            note_no NVARCHAR(50) NOT NULL,
            note_date DATE NOT NULL,
            customer_id INT NOT NULL,
            note_type NVARCHAR(10) NOT NULL,
            amount DECIMAL(18,4) NOT NULL,
            reason NVARCHAR(500) NULL,
            notes NVARCHAR(500) NULL,
            status NVARCHAR(20) DEFAULT 'active',
            created_by INT NULL,
            created_at DATETIME DEFAULT GETDATE(),
            reversed_at DATETIME NULL,
            reversed_by INT NULL
        );
    END`,
  ap_cheques: `
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ap_cheques')
    BEGIN
        CREATE TABLE ap_cheques (
            id INT IDENTITY(1,1) PRIMARY KEY,
            cheque_no NVARCHAR(100) NOT NULL,
            cheque_date DATE NOT NULL,
            due_date DATE NULL,
            amount DECIMAL(18,4) NOT NULL,
            bank_name NVARCHAR(255) NULL,
            supplier_id INT NULL,
            payment_id INT NULL,
            status NVARCHAR(20) NULL,
            status_date DATE NULL,
            notes NVARCHAR(500) NULL,
            created_by INT NULL,
            created_at DATETIME DEFAULT GETDATE()
        );
    END`,
  ap_notes: `
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ap_notes')
    BEGIN
        CREATE TABLE ap_notes (
            id INT IDENTITY(1,1) PRIMARY KEY,
            note_no NVARCHAR(50) NOT NULL,
            note_date DATE NOT NULL,
            supplier_id INT NOT NULL,
            note_type NVARCHAR(10) NOT NULL,
            amount DECIMAL(18,4) NOT NULL,
            reason NVARCHAR(500) NULL,
            notes NVARCHAR(500) NULL,
            status NVARCHAR(20) DEFAULT 'active',
            created_by INT NULL,
            created_at DATETIME DEFAULT GETDATE(),
            reversed_at DATETIME NULL,
            reversed_by INT NULL
        );
    END`
};

async function q(pool, sqlText, inputs = {}) {
  const req = pool.request();
  for (const [k, v] of Object.entries(inputs)) {
    req.input(k, typeof v === 'number' ? sql.Float : sql.NVarChar, v);
  }
  const r = await req.query(sqlText);
  return r.recordset;
}

async function ensureExtraTables(pool) {
  for (const [name, ddl] of Object.entries(EXTRA_TABLES)) {
    const r = await q(pool, `SELECT COUNT(*) AS cnt FROM sys.tables WHERE name = @t`, { t: name });
    if (r[0].cnt > 0) { console.log(`  ~ table ${name} exists`); continue; }
    await q(pool, ddl);
    console.log(`  + created table ${name}`);
  }
}

async function ensureCoreColumns(pool) {
  // journal_entries sub-ledger + tracking columns (mirror server.js + migration 019)
  await q(pool, `
    IF COL_LENGTH('journal_entries', 'source_module') IS NULL ALTER TABLE journal_entries ADD source_module NVARCHAR(50) NULL;
    IF COL_LENGTH('journal_entries', 'source_action') IS NULL ALTER TABLE journal_entries ADD source_action NVARCHAR(50) NULL;
    IF COL_LENGTH('journal_entries', 'source_document') IS NULL ALTER TABLE journal_entries ADD source_document NVARCHAR(50) NULL;
    IF COL_LENGTH('journal_entries', 'is_system_generated') IS NULL ALTER TABLE journal_entries ADD is_system_generated INT DEFAULT 0;
    IF COL_LENGTH('journal_entries', 'is_reversed') IS NULL ALTER TABLE journal_entries ADD is_reversed INT DEFAULT 0;
    IF COL_LENGTH('journal_entries', 'reversed_by') IS NULL ALTER TABLE journal_entries ADD reversed_by INT NULL;
    IF COL_LENGTH('journal_entries', 'reversal_of_id') IS NULL ALTER TABLE journal_entries ADD reversal_of_id INT NULL;
    IF COL_LENGTH('journal_entries', 'customer_id') IS NULL ALTER TABLE journal_entries ADD customer_id INT NULL;
    IF COL_LENGTH('journal_entries', 'supplier_id') IS NULL ALTER TABLE journal_entries ADD supplier_id INT NULL;
    IF COL_LENGTH('chart_of_accounts', 'system_code') IS NULL ALTER TABLE chart_of_accounts ADD system_code NVARCHAR(50) NULL;
  `);
  console.log('  ~ core columns ensured');
}

async function ensureSystemAccounts(pool) {
  const { seedRequiredSystemAccountsAsync } = require('../services/accountingEngine');
  await seedRequiredSystemAccountsAsync(pool);
  console.log('  ~ system accounts ensured');
}

async function ensureOpenFiscalPeriod(pool) {
  const today = new Date();
  const year = today.getFullYear();
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const chk = await q(pool,
    `SELECT COUNT(*) AS cnt FROM fiscal_periods WHERE @start BETWEEN start_date AND end_date OR @end BETWEEN start_date AND end_date`,
    { start, end });
  if (chk[0].cnt > 0) { console.log('  ~ open fiscal period exists'); return; }
  await q(pool,
    `INSERT INTO fiscal_periods (name, start_date, end_date, status)
     VALUES (@name, @start, @end, 'open')`,
    { name: `CI FY ${year}`, start, end });
  console.log('  + open fiscal period created');
}

async function ensureProducts(pool) {
  const r = await q(pool, `SELECT id, product_code FROM products ORDER BY id`);
  if (r.length > 0) {
    for (let i = 0; i < PRODUCTS.length; i++) {
      const row = r.find(x => x.id === i + 1);
      if (!row || String(row.product_code).trim() !== String(PRODUCTS[i].code).trim()) {
        throw new Error(`products baseline mismatch: expected id ${i + 1} = code '${PRODUCTS[i].code}'. Database is not the expected CI baseline.`);
      }
    }
    console.log('  ~ products baseline present (ids 1..' + PRODUCTS.length + ')');
    return;
  }
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const req = tx.request();
    await req.query(`SET IDENTITY_INSERT products ON`);
    for (const p of PRODUCTS) {
      await req.query(`INSERT INTO products (id, product_code, product_name, cost_price, sell_price, is_active)
        VALUES (${p.id}, N'${p.code}', N'${p.name}', ${p.cost}, ${p.sell}, 1)`);
    }
    await req.query(`SET IDENTITY_INSERT products OFF`);
    await tx.commit();
  } catch (e) {
    try { await tx.rollback(); } catch (rb) {}
    throw e;
  }
  console.log('  + products seeded (ids 1..' + PRODUCTS.length + ')');
}

async function ensureCustomers(pool) {
  const r = await q(pool, `SELECT id, customer_code FROM customers ORDER BY id`);
  if (r.length > 0) {
    const c2 = r.find(x => x.id === 2);
    if (!c2) throw new Error('customer id 2 (C-0002) missing from existing customers — not the expected CI baseline.');
    console.log('  ~ customers baseline present (id 2 = C-0002)');
    return;
  }
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const req = tx.request();
    await req.query(`SET IDENTITY_INSERT customers ON`);
    await req.query(`INSERT INTO customers (id, customer_code, customer_name, customer_type, is_active, current_balance, opening_balance)
      VALUES (1, N'C-0001', N'زبون تجريبي CI', 'retail', 1, 0, 0)`);
    await req.query(`INSERT INTO customers (id, customer_code, customer_name, customer_type, is_active, current_balance, opening_balance)
      VALUES (2, N'C-0002', N'الحج متولي سعيد', 'retail', 1, 0, 0)`);
    await req.query(`SET IDENTITY_INSERT customers OFF`);
    await tx.commit();
  } catch (e) {
    try { await tx.rollback(); } catch (rb) {}
    throw e;
  }
  console.log('  + customers seeded (id 2 = C-0002)');
}

async function ensureInventory(pool) {
  let stockValue = 0;
  for (const p of PRODUCTS) stockValue += p.qty * p.cost;
  stockValue = Math.round(stockValue * 100) / 100;

  const mov = await q(pool, `SELECT COUNT(*) AS cnt FROM stock_movements WHERE document_no = @doc`, { doc: OPENING_DOC });
  if (mov[0].cnt === 0) {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const req = tx.request();
      const today = new Date().toISOString().slice(0, 10);
      for (const p of PRODUCTS) {
        await req.query(`
          INSERT INTO inventory_balances (store_id, product_id, quantity) VALUES (${STORE_ID}, ${p.id}, ${p.qty})`);
        await req.query(`
          INSERT INTO stock_movements (move_date, move_type, document_no, store_id, product_id,
            qty_in, qty_out, cost_price, sell_price, balance_after, notes)
          VALUES ('${today}', N'opening', N'${OPENING_DOC}', ${STORE_ID}, ${p.id},
            ${p.qty}, 0, ${p.cost}, ${p.sell}, ${p.qty}, N'CI opening stock')`);
      }
      await tx.commit();
    } catch (e) {
      try { await tx.rollback(); } catch (rb) {}
      throw e;
    }
    console.log(`  + inventory balances + opening movements seeded (value ${stockValue})`);
  } else {
    console.log('  ~ inventory baseline present');
  }
  return stockValue;
}

async function ensureOpeningGL(pool, stockValue) {
  const exists = await q(pool, `SELECT COUNT(*) AS cnt FROM journal_entries WHERE source_document = @doc`, { doc: OPENING_DOC });
  if (exists[0].cnt > 0) { console.log('  ~ opening GL entry present'); return; }

  const inv = await q(pool, `SELECT id FROM chart_of_accounts WHERE system_code = 'SYS_INVENTORY'`);
  const ret = await q(pool, `SELECT id FROM chart_of_accounts WHERE system_code = 'SYS_RETAINED_EARNINGS'`);
  if (!inv[0] || !ret[0]) throw new Error('Required system accounts missing (SYS_INVENTORY / SYS_RETAINED_EARNINGS).');
  const invId = inv[0].id;
  const retId = ret[0].id;

  const today = new Date().toISOString().slice(0, 10);
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const req = tx.request();
    const je = await req.query(`
      INSERT INTO journal_entries (entry_no, entry_date, description, reference_type, total_debit, total_credit,
        created_by, created_at, source_module, source_action, source_document, is_system_generated, is_reversed)
      OUTPUT INSERTED.id
      VALUES (N'${OPENING_ENTRY}', N'${today}', N'CI opening stock (${stockValue})', N'opening',
        ${stockValue}, ${stockValue}, 1, CONVERT(VARCHAR(19), GETDATE(), 120), N'ci_seed', N'seed', N'${OPENING_DOC}', 1, 0)`);
    const jeId = je.recordset[0].id;
    await req.query(`INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, description)
      VALUES (${jeId}, ${invId}, ${stockValue}, 0, N'CI opening stock')`);
    await req.query(`INSERT INTO journal_entry_lines (entry_id, account_id, debit, credit, description)
      VALUES (${jeId}, ${retId}, 0, ${stockValue}, N'CI opening stock (equity)')`);
    await tx.commit();
  } catch (e) {
    try { await tx.rollback(); } catch (rb) {}
    throw e;
  }

  await q(pool, `UPDATE chart_of_accounts SET current_balance = ${stockValue} WHERE system_code = 'SYS_INVENTORY'`);
  await q(pool, `UPDATE chart_of_accounts SET current_balance = ${stockValue} WHERE system_code = 'SYS_RETAINED_EARNINGS'`);
  console.log(`  + opening GL entry + COA balances (${stockValue})`);
}

async function main() {
  const pool = await getPool();

  // Fresh-only guard: refuse to run against a database that already has data.
  const je = await q(pool, `SELECT COUNT(*) AS cnt FROM journal_entries`);
  const si = await q(pool, `SELECT COUNT(*) AS cnt FROM sales_invoices`);
  if (je[0].cnt > 0 || si[0].cnt > 0) {
    console.error('ci_seed refuses to run: database is not empty (production / non-fresh DB). Use a fresh database for CI.');
    await pool.close();
    process.exit(2);
  }
  console.log('✓ empty database confirmed — proceeding');

  console.log('Ensuring extra tables...');
  await ensureExtraTables(pool);
  console.log('Ensuring core columns...');
  await ensureCoreColumns(pool);
  console.log('Ensuring system accounts...');
  await ensureSystemAccounts(pool);
  console.log('Ensuring fiscal period...');
  await ensureOpenFiscalPeriod(pool);
  console.log('Ensuring products...');
  await ensureProducts(pool);
  console.log('Ensuring customers...');
  await ensureCustomers(pool);
  console.log('Ensuring inventory baseline...');
  const stockValue = await ensureInventory(pool);
  console.log('Ensuring opening GL + COA balances...');
  await ensureOpeningGL(pool, stockValue);

  console.log('\n✅ CI baseline seed complete.');
  await pool.close();
  process.exit(0);
}

main().catch(async (e) => {
  console.error('ci_seed FAILED:', e.message);
  try { const p = await getPool(); await p.close(); } catch (x) {}
  process.exit(1);
});
