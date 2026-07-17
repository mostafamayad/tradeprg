/**
 * FULL VFP → SQLite Migration Script
 * Reads ALL .DBF files from D:/tradeprg/Datatrial and migrates to SQLite
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const iconv = require('./node_modules/iconv-lite');

const DBF_DIR = 'D:/tradeprg/Datatrial';
const DB_PATH = 'D:/tradeprg/webapp/backend/database/tradeprodb.sqlite';

// Ensure schema is created before migration runs
require('./database/db');
const db = new DatabaseSync(DB_PATH);

// ── DBF Reader ──────────────────────────────────────────────────────────────
function readDBF(fileName, includeDeleted = true) {
    const filePath = path.join(DBF_DIR, fileName);
    if (!fs.existsSync(filePath)) { console.warn('  SKIP (not found):', fileName); return []; }
    
    const buf = fs.readFileSync(filePath);
    const numRecords = buf.readUInt32LE(4);
    const headerSize = buf.readUInt16LE(8);
    const recordSize = buf.readUInt16LE(10);

    // Parse field descriptors
    const fields = [];
    let offset = 32;
    while (offset < headerSize - 1 && buf[offset] !== 0x0D) {
        const nameBytes = buf.slice(offset, offset + 11);
        let nameEnd = nameBytes.indexOf(0);
        if (nameEnd === -1) nameEnd = 11;
        const name = nameBytes.slice(0, nameEnd).toString('ascii');
        const type = String.fromCharCode(buf[offset + 11]);
        const length = buf[offset + 16];
        const decimal = buf[offset + 17];
        fields.push({ name, type, length, decimal });
        offset += 32;
    }

    // Read records
    const records = [];
    for (let i = 0; i < numRecords; i++) {
        const recStart = headerSize + i * recordSize;
        if (recStart + recordSize > buf.length) break;
        
        const deletionFlag = String.fromCharCode(buf[recStart]);
        if (!includeDeleted && deletionFlag === '*') continue;

        let recOffset = recStart + 1; // skip deletion flag
        const record = {};
        for (const field of fields) {
            const rawBytes = buf.slice(recOffset, recOffset + field.length);
            if (field.type === 'N' || field.type === 'F') {
                const str = rawBytes.toString('ascii').trim();
                record[field.name] = (str === '' || str === '.') ? null : parseFloat(str) || 0;
            } else if (field.type === 'D') {
                const str = rawBytes.toString('ascii').trim();
                record[field.name] = (str && str.length === 8 && str !== '00000000')
                    ? `${str.slice(0,4)}-${str.slice(4,6)}-${str.slice(6,8)}`
                    : null;
            } else if (field.type === 'L') {
                const ch = String.fromCharCode(rawBytes[0]).toUpperCase();
                record[field.name] = (ch === 'T' || ch === 'Y') ? 1 : 0;
            } else {
                record[field.name] = iconv.decode(rawBytes, 'cp1256').trimEnd();
            }
            recOffset += field.length;
        }
        records.push(record);
    }
    return records;
}

// ── Main Migration ───────────────────────────────────────────────────────────
async function migrate() {
    const db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA foreign_keys = OFF; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');

    console.log('\n══════════════════════════════════════════');
    console.log('  TradePro VFP → SQLite Migration');
    console.log('══════════════════════════════════════════\n');

    // ── 1. CUSTOMERS ──────────────────────────────────────────────────────
    console.log('📋 Migrating CUSTOMERS...');
    db.exec('DELETE FROM customers;');
    const customers = readDBF('customers.DBF');
    const insertCust = db.prepare(`
        INSERT OR REPLACE INTO customers 
        (id, customer_code, customer_name, phone, address, credit_limit, opening_balance, current_balance, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);
    const custStmt = db.prepare('BEGIN');
    db.exec('BEGIN');
    let custCount = 0;
    for (const c of customers) {
        if (!c.CUSTID || !c.CUSTNAME?.trim()) continue;
        const name = c.CUSTNAME.trim();
        const balance = (c.DEBIT || 0) - (c.CREDIT || 0);
        const opening = c.SLSTART || 0;
        try {
            insertCust.run(c.CUSTID, String(c.CUSTID), name, c.CUSTPHONE?.trim() || '', 
                          c.CUSTADD?.trim() || '', c.CREDITLIMT || 0, opening, balance);
            custCount++;
        } catch(e) { /* duplicate, skip */ }
    }
    db.exec('COMMIT');
    console.log(`  ✅ ${custCount} customers migrated`);

    // ── 2. SUPPLIERS ──────────────────────────────────────────────────────
    console.log('📋 Migrating SUPPLIERS...');
    db.exec('DELETE FROM suppliers;');
    const suppliers = readDBF('suppliers.DBF');
    const insertSupp = db.prepare(`
        INSERT OR REPLACE INTO suppliers
        (id, supplier_code, supplier_name, phone, opening_balance, current_balance, is_active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
    `);
    db.exec('BEGIN');
    let suppCount = 0;
    for (const s of suppliers) {
        if (!s.SUPPID || !s.SUPPNAME?.trim()) continue;
        const name = (s.SUPPARABIC?.trim() || s.SUPPNAME?.trim());
        const balance = (s.DEBIT || 0) - (s.CREDIT || 0);
        try {
            insertSupp.run(s.SUPPID, String(s.SUPPID), name, s.SUPPHONE?.trim() || '',
                          s.PRBAL || 0, balance);
            suppCount++;
        } catch(e) { /* skip */ }
    }
    db.exec('COMMIT');
    console.log(`  ✅ ${suppCount} suppliers migrated`);

    // ── 3. PRODUCTS ───────────────────────────────────────────────────────
    console.log('📋 Migrating PRODUCTS...');
    db.exec('DELETE FROM products;');
    const products = readDBF('products.DBF');
    const insertProd = db.prepare(`
        INSERT OR REPLACE INTO products
        (id, product_code, product_name, unit_name, cost_price, sell_price, min_stock, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `);
    db.exec('BEGIN');
    let prodCount = 0;
    for (const p of products) {
        if (p.PRODCODE === null || p.PRODCODE === undefined) continue;
        const code = String(p.PRODCODE).trim();
        if (!code) continue;
        const name = (p.ARABNAME ? String(p.ARABNAME).trim() : null) || (p.ENGNAME ? String(p.ENGNAME).trim() : null) || code;
        try {
            insertProd.run(p.AA || prodCount + 1, code, name, p.UNIT ? String(p.UNIT).trim() : 'قطعة',
                          p.UNIT_COST || 0, p.PHPRICE || 0, 0);
            prodCount++;
        } catch(e) { /* skip */ }
    }
    db.exec('COMMIT');
    console.log(`  ✅ ${prodCount} products migrated`);

    // ── 4. SALES INVOICES ─────────────────────────────────────────────────
    console.log('📋 Migrating SALES INVOICES...');
    db.exec('DELETE FROM sales_invoice_items; DELETE FROM sales_invoices;');
    
    const salesHdr = readDBF('salesinv1.DBF');
    const salesItems = readDBF('salesinv2.DBF');
    
    // Build product code → id map
    const prodMap = {};
    db.prepare('SELECT id, product_code FROM products').all().forEach(p => {
        prodMap[p.product_code.trim()] = p.id;
    });
    
    const insertSalesInv = db.prepare(`
        INSERT OR REPLACE INTO sales_invoices
        (id, invoice_no, customer_id, invoice_date, grand_total, discount_amount, tax_amount, 
         amount_paid, payment_type, status, notes, store_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, 1)
    `);
    const insertSalesItem = db.prepare(`
        INSERT INTO sales_invoice_items
        (invoice_id, product_id, quantity, unit_price, discount_pct, line_total)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    db.exec('BEGIN');
    let invCount = 0;
    const invSet = new Set();
    for (const hdr of salesHdr) {
        if (!hdr.INVNO || invSet.has(hdr.INVNO)) continue;
        invSet.add(hdr.INVNO);
        const total = hdr.VALUEINV || 0;
        const tax = (hdr.TAX14 || 0) + (hdr.TAX1 || 0);
        const paid = hdr.PAID ? total : 0;
        const payType = hdr.PAID ? 'cash' : 'credit';
        try {
            insertSalesInv.run(hdr.INVNO, `INV-${String(hdr.INVNO).padStart(6,'0')}`, 
                              hdr.CUSTID || 0, hdr.ISSUE || '2024-01-01',
                              total, 0, tax, paid, payType,
                              hdr.REMARKS?.trim() || '');
            invCount++;
        } catch(e) { /* skip */ }
    }
    db.exec('COMMIT');
    
    // Insert items
    db.exec('BEGIN');
    let itemCount = 0;
    for (const item of salesItems) {
        if (!invSet.has(item.INVNO)) continue;
        const prodId = prodMap[(item.PRODCODE != null ? String(item.PRODCODE).trim() : null)] || null;
        if (!prodId) continue;
        try {
            insertSalesItem.run(item.INVNO, prodId, item.SLQTY || 0, 
                               item.SALEPRICE || 0, 0, item.SUBTOTAL || 0);
            itemCount++;
        } catch(e) { /* skip */ }
    }
    db.exec('COMMIT');
    console.log(`  ✅ ${invCount} sales invoices, ${itemCount} items migrated`);

    // ── 5. CUSTOMER COLLECTIONS (PAYMENTS) ───────────────────────────────
    console.log('📋 Migrating CUSTOMER PAYMENTS...');
    db.exec('DELETE FROM customer_collections;');
    const payments = readDBF('salespay.DBF');
    const insertPay = db.prepare(`
        INSERT INTO customer_collections
        (customer_id, collection_no, collection_date, amount, notes, payment_method, check_no, bank_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    db.exec('BEGIN');
    let payCount = 0;
    const seenRefs = new Set();
    for (const p of payments) {
        if (!p.CUSTID || !p.PAYVALUE) continue;
        // Build unique collection_no to avoid UNIQUE conflicts
        let ref = (p.PAYREF != null ? String(p.PAYREF).trim() : '') || `PAY-${payCount+1}`;
        if (seenRefs.has(ref)) ref = `${ref}-${payCount}`;
        seenRefs.add(ref);
        const payMethod = (p.CASH === 'T' || p.CASH === 'Y') ? 'cash' : 'check';
        try {
            insertPay.run(p.CUSTID, ref, p.PAYDATE || '2024-01-01', p.PAYVALUE, p.REMARKS?.trim() || '',
                          payMethod, p.CHECKID || null, p.BANK || null);
            payCount++;
        } catch(e) {
            // Skip on error (foreign key, etc.)
        }
    }
    db.exec('COMMIT');
    console.log(`  ✅ ${payCount} customer payments migrated`);

    // ── 6. OPENING BALANCES FOR CUSTOMERS ────────────────────────────────
    console.log('📋 Migrating CUSTOMER OPENING BALANCES...');
    const salStart = readDBF('salstart.DBF');
    const insertOpening = db.prepare(`
        INSERT INTO customer_collections
        (customer_id, collection_no, collection_date, amount, notes)
        VALUES (?, ?, ?, ?, 'رصيد افتتاحي')
    `);
    db.exec('BEGIN');
    let obCount = 0;
    const seenOB = new Set();
    for (const s of salStart) {
        if (!s.CUSTID || !s.STVALUE) continue;
        let ref = `OB-${s.CUSTID}`;
        if (seenOB.has(ref)) ref = `${ref}-${obCount}`;
        seenOB.add(ref);
        try {
            insertOpening.run(s.CUSTID, ref, s.STDATE || '2020-01-01', -s.STVALUE);
            obCount++;
        } catch(e) {}
    }
    db.exec('COMMIT');
    console.log(`  ✅ ${obCount} opening balances migrated`);

    // ── 7. PURCHASE INVOICES ──────────────────────────────────────────────
    console.log('📋 Migrating PURCHASE INVOICES...');
    db.exec('DELETE FROM purchase_invoice_items; DELETE FROM purchase_invoices;');
    
    const purchHdr = readDBF('prchinv1.DBF');
    const purchItems = readDBF('prchinv2.DBF');
    
    const insertPurchInv = db.prepare(`
        INSERT OR REPLACE INTO purchase_invoices
        (id, invoice_no, supplier_id, invoice_date, grand_total, discount_amount, tax_amount,
         amount_paid, payment_type, status, notes, store_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, 1)
    `);
    const insertPurchItem = db.prepare(`
        INSERT INTO purchase_invoice_items
        (invoice_id, product_id, quantity, cost_price, sell_price, line_total)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    db.exec('BEGIN');
    let purchCount = 0;
    const purchSet = new Set();
    for (const hdr of purchHdr) {
        if (!hdr.INVNO || purchSet.has(hdr.INVNO)) continue;
        purchSet.add(hdr.INVNO);
        const total = hdr.VALUEINV || 0;
        const tax = (hdr.TAX14 || 0) + (hdr.TAX1 || 0);
        const paid = hdr.PAID ? total : 0;
        try {
            insertPurchInv.run(hdr.INVNO, `PINV-${String(hdr.INVNO).padStart(5,'0')}`,
                              hdr.SUPPID || 0, hdr.ISSUE || '2024-01-01',
                              total, 0, tax, paid, hdr.PAID ? 'cash' : 'credit',
                              hdr.REMARKS?.trim() || '');
            purchCount++;
        } catch(e) {}
    }
    db.exec('COMMIT');
    
    db.exec('BEGIN');
    let purchItemCount = 0;
    for (const item of purchItems) {
        if (!purchSet.has(item.INVNO)) continue;
        const prodId = prodMap[(item.PRODCODE != null ? String(item.PRODCODE).trim() : null)] || null;
        if (!prodId) continue;
        try {
            insertPurchItem.run(item.INVNO, prodId, item.PRCHQTY || 0,
                               item.UNIT_COST || 0, 0, item.SUBTOTAL || 0);
            purchItemCount++;
        } catch(e) {}
    }
    db.exec('COMMIT');
    console.log(`  ✅ ${purchCount} purchase invoices, ${purchItemCount} items migrated`);

    // ── 8. INVENTORY (from prodstrt + salesinv2 - salesret2 - prchret2 + prchinv2) ──
    console.log('📋 Calculating INVENTORY BALANCES...');
    db.exec('DELETE FROM inventory_balances;');
    
    // Start with opening stock
    const prodStart = readDBF('prodstrt.DBF');
    const stockMap = {}; // prodcode -> qty
    
    for (const s of prodStart) {
        const code = (s.PRODCODE != null ? String(s.PRODCODE).trim() : null);
        if (!code) continue;
        stockMap[code] = (stockMap[code] || 0) + (s.STQTY || 0);
    }
    
    // Add purchases
    for (const item of purchItems) {
        const code = (item.PRODCODE != null ? String(item.PRODCODE).trim() : null);
        if (!code) continue;
        stockMap[code] = (stockMap[code] || 0) + (item.PRCHQTY || 0);
    }
    
    // Subtract sales
    for (const item of salesItems) {
        const code = (item.PRODCODE != null ? String(item.PRODCODE).trim() : null);
        if (!code) continue;
        stockMap[code] = (stockMap[code] || 0) - (item.SLQTY || 0);
    }
    
    // Add sales returns
    const sRet2 = readDBF('salesret2.DBF');
    for (const item of sRet2) {
        const code = (item.PRODCODE != null ? String(item.PRODCODE).trim() : null);
        if (!code) continue;
        stockMap[code] = (stockMap[code] || 0) + (item.RETQTY || 0);
    }
    
    // Subtract purchase returns
    const pRet2 = readDBF('prchret2.DBF');
    for (const item of pRet2) {
        const code = (item.PRODCODE != null ? String(item.PRODCODE).trim() : null);
        if (!code) continue;
        stockMap[code] = (stockMap[code] || 0) - (item.RETQTY || 0);
    }
    
    // Insert into inventory_balances
    const insertInv = db.prepare(`
        INSERT OR REPLACE INTO inventory_balances (product_id, store_id, quantity)
        VALUES (?, 1, ?)
    `);
    db.exec('BEGIN');
    let invBalCount = 0;
    for (const [code, qty] of Object.entries(stockMap)) {
        const prodId = prodMap[code];
        if (!prodId) continue;
        insertInv.run(prodId, Math.max(0, qty));
        invBalCount++;
    }
    db.exec('COMMIT');
    console.log(`  ✅ ${invBalCount} product inventory balances calculated`);

    // ── 9. UPDATE PRODUCT STOCK ───────────────────────────────────────────
    console.log('📋 Updating product stock totals...');
    /*
    db.exec(`
        UPDATE products SET total_stock = (
            SELECT COALESCE(SUM(quantity), 0) 
            FROM inventory_balances 
            WHERE product_id = products.id
        )
    `);
    */
    
    // ── 10. SALES RETURNS ─────────────────────────────────────────────────
    console.log('📋 Migrating SALES RETURNS...');
    db.exec('DELETE FROM sales_return_items; DELETE FROM sales_returns;');
    const sRet1 = readDBF('salesret1.DBF');
    const insertSRet = db.prepare(`
        INSERT OR REPLACE INTO sales_returns
        (id, return_no, customer_id, return_date, grand_total, status, notes, store_id)
        VALUES (?, ?, ?, ?, ?, 'posted', ?, 1)
    `);
    db.exec('BEGIN');
    let sRetCount = 0;
    const sRetSet = new Set();
    for (const r of sRet1) {
        if (!r.INVNO || sRetSet.has(r.INVNO)) continue;
        sRetSet.add(r.INVNO);
        try {
            insertSRet.run(r.INVNO, `RET-${String(r.INVNO).padStart(5,'0')}`,
                          r.CUSTID, r.ISSUE || '2024-01-01',
                          r.VALUEINV || 0, r.REMARKS?.trim() || '');
            sRetCount++;
        } catch(e) {}
    }
    db.exec('COMMIT');
    console.log(`  ✅ ${sRetCount} sales returns migrated`);

    // ── 11. SUPPLIER PAYMENTS ─────────────────────────────────────────────
    console.log('📋 Migrating SUPPLIER PAYMENTS...');
    db.exec('DELETE FROM supplier_payments;');
    const suppPays = readDBF('prchpay.DBF');
    const insertSuppPay = db.prepare(`
        INSERT INTO supplier_payments
        (supplier_id, payment_no, payment_date, amount, notes, payment_method, check_no, bank_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    db.exec('BEGIN');
    let suppPayCount = 0;
    const seenRef = new Set();
    for (const p of suppPays) {
        if (!p.SUPPID || !p.PAYVALUE) continue;
        let ref = (p.PAYREF != null ? String(p.PAYREF).trim() : '') || `SPAY-${suppPayCount+1}`;
        if (seenRef.has(ref)) ref = `${ref}-${suppPayCount}`;
        seenRef.add(ref);
        const payMethod = (p.CASH === 'T' || p.CASH === 'Y') ? 'cash' : 'check';
        try {
            insertSuppPay.run(p.SUPPID, ref, p.PAYDATE || '2024-01-01', p.PAYVALUE, p.REMARKS?.trim() || '',
                             payMethod, p.CHECKID || null, p.BANK || null);
            suppPayCount++;
        } catch(e) {}
    }
    db.exec('COMMIT');
    console.log(`  ✅ ${suppPayCount} supplier payments migrated`);

    // ── 12. SUPPLIER OPENING BALANCES ────────────────────────────────────
    console.log('📋 Migrating SUPPLIER OPENING BALANCES...');
    const prchStart = readDBF('prchstart.DBF');
    const insertSuppOpening = db.prepare(`
        INSERT INTO supplier_payments
        (supplier_id, payment_no, payment_date, amount, notes)
        VALUES (?, ?, ?, ?, 'رصيد افتتاحي مورد')
    `);
    db.exec('BEGIN');
    let suppObCount = 0;
    const seenSuppOB = new Set();
    for (const s of prchStart) {
        if (!s.SUPPID || !s.STVALUE) continue;
        let ref = `SOB-${s.SUPPID}`;
        if (seenSuppOB.has(ref)) ref = `${ref}-${suppObCount}`;
        seenSuppOB.add(ref);
        try {
            insertSuppOpening.run(s.SUPPID, ref, s.STDATE || '2020-01-01', -s.STVALUE);
            suppObCount++;
        } catch(e) {}
    }
    db.exec('COMMIT');
    console.log(`  ✅ ${suppObCount} supplier opening balances migrated`);

    // ── 13. SALES REPS ───────────────────────────────────────────────────
    console.log('📋 Migrating SALES REPS...');
    db.exec('DELETE FROM sales_reps;');
    const slGroup = readDBF('slgroup.DBF');
    const insertRep = db.prepare(`
        INSERT OR IGNORE INTO sales_reps
        (rep_code, rep_name, is_active)
        VALUES (?, ?, 1)
    `);
    db.exec('BEGIN');
    let repCount = 0;
    for (const r of slGroup) {
        const code = r.SALESMAN || r.AA;
        const name = r.SLGNAME?.trim() || r.SLGNAME;
        if (!code || !name) continue;
        try {
            insertRep.run(String(code), name);
            repCount++;
        } catch(e) {}
    }
    db.exec('COMMIT');
    console.log(`  ✅ ${repCount} sales reps migrated`);

    // ── 14. CHECKS (cheque book) ─────────────────────────────────────────
    console.log('📋 Migrating CHECKS...');
    db.exec('DELETE FROM checks;');
    const salChk = readDBF('salchktam.DBF');
    const insertChk = db.prepare(`
        INSERT INTO checks
        (check_no, check_date, due_date, amount, direction, status, customer_id, bank_name, notes)
        VALUES (?, ?, ?, ?, 'inward', ?, ?, ?, ?)
    `);
    db.exec('BEGIN');
    let chkCount = 0;
    for (const c of salChk) {
        if (!c.CHECKID) continue;
        const amt = c.CHECKVAL || 0;
        if (!amt) continue;
        const status = c.RETCHK === 'T' ? 'returned' : (c.COLECTDATE ? 'collected' : 'pending');
        try {
            insertChk.run(c.CHECKID?.trim() || `CHK-${chkCount+1}`,
                          c.CHECKDATE || c.DUEDATE || '2024-01-01',
                          c.DUEDATE || null, amt, status,
                          c.CUSTID || null, c.BANK?.trim() || null, c.REMARKS?.trim() || '');
            chkCount++;
        } catch(e) {}
    }
    db.exec('COMMIT');
    console.log(`  ✅ ${chkCount} checks migrated`);

    // ── 15. EMPLOYEES ────────────────────────────────────────────────────
    console.log('📋 Migrating EMPLOYEES...');
    db.exec('DELETE FROM employees;');
    const emp = readDBF('employee.DBF');
    const insertEmp = db.prepare(`
        INSERT OR IGNORE INTO employees
        (emp_code, emp_name, department, job_title, basic_salary, hire_date, phone, national_id, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `);
    db.exec('BEGIN');
    let empCount = 0;
    for (const e of emp) {
        const code = e.EMPCODE || e.AA;
        const name = e.EMPNAME?.trim() || e.EMPARAB?.trim();
        if (!code || !name) continue;
        try {
            insertEmp.run(String(code), name, e.DEPT?.trim() || '', e.JOB?.trim() || '',
                         e.SALARY || 0, e.HIREDATE || null, e.PHONE?.trim() || '', e.NATID?.trim() || '');
            empCount++;
        } catch(e) {}
    }
    db.exec('COMMIT');
    console.log(`  ✅ ${empCount} employees migrated`);

    // ── 16. STORES ───────────────────────────────────────────────────────
    console.log('📋 Migrating STORES...');
    const storetbl = readDBF('storetbl.DBF');
    const insertStore = db.prepare(`
        INSERT OR IGNORE INTO stores
        (store_code, store_name, store_type)
        VALUES (?, ?, 'branch')
    `);
    db.exec('BEGIN');
    let storeCount = 0;
    for (const s of storetbl) {
        const code = s.STCODE || s.AA;
        const name = s.STNAME?.trim() || s.STNAME;
        if (!code || !name) continue;
        try {
            insertStore.run(String(code), name);
            storeCount++;
        } catch(e) {}
    }
    db.exec('COMMIT');
    console.log(`  ✅ ${storeCount} additional stores migrated`);

    // ── 17. CATEGORIES (PRODUCT GROUPS) ──────────────────────────────────
    console.log('📋 Migrating CATEGORIES...');
    db.exec('DELETE FROM categories;');
    const prodgrp = readDBF('prodgrp.DBF');
    const insertCat = db.prepare(`
        INSERT OR IGNORE INTO categories (category_name)
        VALUES (?)
    `);
    db.exec('BEGIN');
    let catCount = 0;
    for (const c of prodgrp) {
        const name = c.GRPNAME?.trim();
        if (!name) continue;
        try {
            insertCat.run(name);
            catCount++;
        } catch(e) {}
    }
    db.exec('COMMIT');
    console.log(`  ✅ ${catCount} categories migrated`);

    // ── 18. RECALCULATE ALL BALANCES ─────────────────────────────────────
    console.log('📋 Recalculating balances...');
    const allCustomers = db.prepare('SELECT id FROM customers').all();
    for (const c of allCustomers) {
        const obRow = db.prepare('SELECT opening_balance FROM customers WHERE id = ?').get(c.id);
        const sales = db.prepare(`SELECT COALESCE(SUM(grand_total),0) as t FROM sales_invoices WHERE customer_id=? AND status!='cancelled'`).get(c.id);
        const rets = db.prepare(`SELECT COALESCE(SUM(grand_total),0) as t FROM sales_returns WHERE customer_id=? AND status!='cancelled'`).get(c.id);
        const colls = db.prepare(`SELECT COALESCE(SUM(amount),0) as t FROM customer_collections WHERE customer_id=?`).get(c.id);
        const bal = (obRow?.opening_balance||0) + (sales?.t||0) - (rets?.t||0) - (colls?.t||0);
        db.prepare('UPDATE customers SET current_balance = ? WHERE id = ?').run(bal, c.id);
    }
    console.log(`  ✅ Recalculated ${allCustomers.length} customer balances`);

    // ── FINAL STATS ───────────────────────────────────────────────────────
    console.log('\n══════════════════════════════════════════');
    console.log('  Migration Complete! Final DB State:');
    console.log('══════════════════════════════════════════');
    const tables = ['customers','suppliers','products','categories','stores','sales_reps','employees',
                    'sales_invoices','sales_invoice_items','customer_collections',
                    'purchase_invoices','purchase_invoice_items','supplier_payments',
                    'inventory_balances','sales_returns','checks','inventory_balances'];
    for (const t of tables) {
        try {
            const n = db.prepare(`SELECT COUNT(*) as n FROM ${t}`).get().n;
            console.log(`  ${t}: ${n}`);
        } catch(e) {}
    }
    console.log('\n✅ Done! Refresh your browser.\n');

    db.close();
}

migrate().catch(err => {
    console.error('❌ Migration FAILED:', err.message);
    console.error(err.stack);
    process.exit(1);
});
