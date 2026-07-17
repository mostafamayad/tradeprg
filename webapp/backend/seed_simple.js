// ============================================================
// Seed Simple Test Data
// ============================================================
// يمسح كل البيانات ويضيف داتا بسيطة جداً للتجربة
// التشغيل: node seed_simple.js
// ============================================================

const db = require('./database/db');

console.log('=====================================================');
console.log('  تنظيف قاعدة البيانات وإضافة داتا تجريبية بسيطة');
console.log('=====================================================\n');

// ═══════════════════════════════════════════════════════════
// 1. مسح كل البيانات
// ═══════════════════════════════════════════════════════════

console.log('[1/8] جاري مسح البيانات القديمة...');

const tablesToClear = [
    'sales_invoice_items',
    'sales_invoices',
    'sales_return_items',
    'sales_returns',
    'customer_collections',
    'purchase_invoice_items',
    'purchase_invoices',
    'purchase_return_items',
    'purchase_returns',
    'supplier_payments',
    'stock_transfer_items',
    'stock_transfers',
    'stock_count_items',
    'stock_count',
    'stock_adjustments',
    'damaged_stock',
    'stock_movements',
    'inventory_balances',
    'treasury_transactions',
    'treasury_accounts',
    'expenses',
    'journal_entry_lines',
    'journal_entries',
    'salary_slips',
    'emp_loans',
    'checks',
    'customer_notes',
    'customer_visits',
    'rep_targets',
    'rep_settlements',
    'products',
    'categories',
    'customers',
    'suppliers',
    'sales_reps',
    'employees',
    'stores',
    'invoice_counters',
    'settings'
];

db.transaction(() => {
    tablesToClear.forEach(t => {
        try {
            db.prepare(`DELETE FROM ${t}`).run();
            db.prepare(`DELETE FROM sqlite_sequence WHERE name=?`).run(t);
        } catch (e) {
            console.log(`  ! ${t}: ${e.message}`);
        }
    });
})();

console.log('  ✓ تم مسح البيانات القديمة\n');

// ═══════════════════════════════════════════════════════════
// 2. إعدادات الشركة
// ═══════════════════════════════════════════════════════════

console.log('[2/8] إضافة الإعدادات...');

const insertSetting = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`);
const settings = [
        ['company_name', 'شركة العميل'],
        ['company_phone', '01000000000'],
    ['company_address', 'القاهرة، مصر'],
    ['currency', 'ج.م'],
    ['tax_rate', '14'],
    ['invoice_prefix', 'INV']
];
settings.forEach(([k, v]) => insertSetting.run(k, v));
console.log('  ✓ تم إضافة الإعدادات\n');

// ═══════════════════════════════════════════════════════════
// 3. المخازن والمناديب
// ═══════════════════════════════════════════════════════════

console.log('[3/8] إضافة المخازن والمناديب...');

const insertStore = db.prepare(`INSERT INTO stores (store_code, store_name, store_type, notes) VALUES (?, ?, ?, ?)`);
insertStore.run('ST001', 'المخزن الرئيسي', 'main', 'القاهرة - المقر الرئيسي');
insertStore.run('ST002', 'مخزن الفرع',    'sub',  'الإسكندرية');
console.log('  ✓ تم إضافة 2 مخازن');

const insertRep = db.prepare(`INSERT INTO sales_reps (rep_code, rep_name, phone) VALUES (?, ?, ?)`);
insertRep.run('R1', 'محمد علي', '01011111111');
insertRep.run('R2', 'حسن إبراهيم', '01022222222');
console.log('  ✓ تم إضافة 2 مناديب\n');

// ═══════════════════════════════════════════════════════════
// 4. التصنيفات
// ═══════════════════════════════════════════════════════════

console.log('[4/8] إضافة التصنيفات...');

const insertCategory = db.prepare(`INSERT INTO categories (category_name) VALUES (?)`);
const categories = ['مواد غذائية', 'مشروبات', 'منظفات', 'ألبان', 'حلويات'];
categories.forEach(c => insertCategory.run(c));
console.log('  ✓ تم إضافة 5 تصنيفات\n');

// ═══════════════════════════════════════════════════════════
// 5. العملاء (10)
// ═══════════════════════════════════════════════════════════

console.log('[5/8] إضافة العملاء...');

const insertCustomer = db.prepare(`
    INSERT INTO customers (customer_code, customer_name, customer_type, phone, opening_balance, current_balance)
    VALUES (?, ?, ?, ?, ?, ?)
`);

const customers = [
    ['C001', 'أحمد محمد',       'retail',    '01011111111', 0, 0],
    ['C002', 'سارة علي',         'retail',    '01022222222', 0, 0],
    ['C003', 'محمود حسن',        'wholesale', '01033333333', 0, 0],
    ['C004', 'فاطمة إبراهيم',    'retail',    '01044444444', 0, 0],
    ['C005', 'خالد عبد الله',    'vip',       '01055555555', 0, 0],
    ['C006', 'منى السيد',        'retail',    '01066666666', 0, 0],
    ['C007', 'يوسف عمر',         'retail',    '01077777777', 0, 0],
    ['C008', 'نورا أحمد',        'wholesale', '01088888888', 0, 0],
    ['C009', 'طارق فؤاد',        'retail',    '01099999999', 0, 0],
    ['C010', 'هدى مصطفى',        'retail',    '01100000000', 0, 0]
];
db.transaction(() => customers.forEach(c => insertCustomer.run(...c)))();
console.log(`  ✓ تم إضافة ${customers.length} عملاء\n`);

// ═══════════════════════════════════════════════════════════
// 6. الموردين (5)
// ═══════════════════════════════════════════════════════════

console.log('[6/8] إضافة الموردين...');

const insertSupplier = db.prepare(`
    INSERT INTO suppliers (supplier_code, supplier_name, phone, opening_balance, current_balance)
    VALUES (?, ?, ?, ?, ?)
`);

const suppliers = [
    ['S001', 'شركة النور للتوريدات',    '01211111111', 0, 0],
    ['S002', 'مصنع الأمل',              '01222222222', 0, 0],
    ['S003', 'موزع السلام',             '01233333333', 0, 0],
    ['S004', 'المؤسسة المصرية',         '01244444444', 0, 0],
    ['S005', 'التوريدات الذهبية',       '01255555555', 0, 0]
];
db.transaction(() => suppliers.forEach(s => insertSupplier.run(...s)))();
console.log(`  ✓ تم إضافة ${suppliers.length} موردين\n`);

// ═══════════════════════════════════════════════════════════
// 7. الأصناف (15) + أرصدة المخزون
// ═══════════════════════════════════════════════════════════

console.log('[7/8] إضافة الأصناف والأرصدة...');

const insertProduct = db.prepare(`
    INSERT INTO products (product_code, product_name, category_id, unit_name, sell_price, cost_price, min_stock)
    VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const products = [
    ['P001', 'أرز أبو الوليد 1 كجم',     1, 'كيس',  35.00, 28.00, 20],
    ['P002', 'سكر فاخر 1 كجم',          1, 'كيس',  25.00, 20.00, 20],
    ['P003', 'زيت عافية 1 لتر',          1, 'زجاجة', 60.00, 50.00, 15],
    ['P004', 'شاي ليبتون 250 جم',        1, 'علبة',  45.00, 36.00, 10],
    ['P005', 'كوكاكولا 1.5 لتر',        2, 'زجاجة', 20.00, 15.00, 30],
    ['P006', 'بيبسي 1 لتر',             2, 'زجاجة', 15.00, 11.00, 30],
    ['P007', 'لبن جهينة 1 لتر',          4, 'علبة',  25.00, 19.00, 15],
    ['P008', 'زبادي 1 كجم',             4, 'علبة',  30.00, 23.00, 10],
    ['P009', 'جبنة بيضاء 250 جم',        4, 'علبة',  35.00, 27.00, 10],
    ['P010', 'بسكويت أوريو',            5, 'علبة',  25.00, 19.00, 20],
    ['P011', 'معجون أسنان سيجنال',     3, 'علبة',  35.00, 26.00, 10],
    ['P012', 'شامبو هيد آند شولدرز',    3, 'زجاجة', 75.00, 58.00, 10],
    ['P013', 'صابون لوكس 3 قطع',         3, 'علبة',  45.00, 34.00, 15],
    ['P014', 'كيس قمامة كبير',          3, 'كيس',  20.00, 14.00, 25],
    ['P015', 'مناديل فاين',              3, 'علبة',  15.00, 10.00, 30]
];
db.transaction(() => products.forEach(p => insertProduct.run(...p)))();

// أرصدة المخزون الابتدائية
const insertBalance = db.prepare(`
    INSERT INTO inventory_balances (product_id, store_id, quantity)
    VALUES (?, 1, ?)
`);
const initialStocks = [
    [1, 100], [2, 150], [3, 80], [4, 50], [5, 200],
    [6, 180], [7, 60], [8, 40], [9, 35], [10, 80],
    [11, 45], [12, 30], [13, 50], [14, 100], [15, 150]
];
db.transaction(() => initialStocks.forEach(s => insertBalance.run(...s)))();
console.log(`  ✓ تم إضافة ${products.length} صنف بأرصدتهم\n`);

// ═══════════════════════════════════════════════════════════
// 8. الخزينة + الفواتير + التحصيلات
// ═══════════════════════════════════════════════════════════

console.log('[8/8] إضافة فواتير مبيعات وتحصيلات وخزينة...');

// الخزينة
const insertTreasury = db.prepare(`
    INSERT INTO treasury_accounts (account_name, account_type, bank_name, opening_balance, current_balance)
    VALUES (?, ?, ?, ?, ?)
`);
insertTreasury.run('الخزينة الرئيسية', 'cash', null, 50000, 50000);
insertTreasury.run('البنك الأهلي',     'bank', 'البنك الأهلي المصري', 100000, 100000);

// رصيد افتتاحي خزينة (حركة افتتاحية)
db.prepare(`
    INSERT INTO treasury_transactions (trans_no, trans_date, trans_type, amount, account_id, description)
    VALUES ('TR-OPN-001', date('now'), 'in', 50000, 1, 'رصيد افتتاحي')
`).run();
db.prepare(`
    INSERT INTO treasury_transactions (trans_no, trans_date, trans_type, amount, account_id, description)
    VALUES ('TR-OPN-002', date('now'), 'in', 100000, 2, 'رصيد افتتاحي')
`).run();

// 5 فواتير مبيعات بسيطة
const salesInvoices = [
    { cust: 1, items: [[1, 2, 35], [2, 1, 25]], paid: 0,   desc: 'أحمد - شراء مواد' },
    { cust: 2, items: [[5, 3, 20], [6, 2, 15]], paid: 90,  desc: 'سارة - مشروبات' },
    { cust: 3, items: [[3, 5, 60], [4, 2, 45]], paid: 0,   desc: 'محمود - مواد تموين' },
    { cust: 5, items: [[11, 3, 35], [12, 2, 75]], paid: 0, desc: 'خالد - منظفات' },
    { cust: 4, items: [[7, 4, 25], [8, 2, 30]], paid: 0,   desc: 'فاطمة - ألبان' }
];

const insertInvoice = db.prepare(`
    INSERT INTO sales_invoices (invoice_no, invoice_date, customer_id, store_id, payment_type, subtotal, tax_amount, grand_total, amount_paid, remaining, notes, status)
    VALUES (?, date('now', ?), ?, 1, ?, ?, 0, ?, ?, ?, ?, 'posted')
`);
const insertInvItem = db.prepare(`
    INSERT INTO sales_invoice_items (invoice_id, product_id, quantity, unit_price, cost_price, discount_pct, discount_amount, line_total)
    VALUES (?, ?, ?, ?, ?, 0, 0, ?)
`);
const updateInvBal = db.prepare(`UPDATE inventory_balances SET quantity = quantity - ? WHERE product_id = ? AND store_id = 1`);
const insertStockMove = db.prepare(`
    INSERT INTO stock_movements (move_date, move_type, document_no, store_id, product_id, qty_out, balance_after, reference_id)
    VALUES (date('now', ?), 'out', ?, 1, ?, ?, (SELECT quantity FROM inventory_balances WHERE product_id = ? AND store_id = 1), ?)
`);
const updateCustBalance = db.prepare(`UPDATE customers SET current_balance = current_balance + ? WHERE id = ?`);

salesInvoices.forEach((inv, idx) => {
    const invoiceNo = 'INV-' + String(idx + 1).padStart(3, '0');
    const daysAgo = `-${salesInvoices.length - idx} days`;

    let subtotal = 0;
    inv.items.forEach(it => subtotal += it[1] * it[2]);
    const total = subtotal;
    const remaining = total - inv.paid;

    const invResult = insertInvoice.run(
        invoiceNo, daysAgo, inv.cust,
        inv.paid > 0 ? 'cash' : 'credit',
        subtotal, total, inv.paid, remaining, inv.desc
    );
    const invoiceId = invResult.lastInsertRowid;

    inv.items.forEach(([prodId, qty, price]) => {
        const lineTotal = qty * price;
        insertInvItem.run(invoiceId, prodId, qty, price, price * 0.8, lineTotal);
        updateInvBal.run(qty, prodId);
        insertStockMove.run(daysAgo, invoiceNo, prodId, qty, prodId, invoiceId);
    });

    if (remaining > 0) updateCustBalance.run(remaining, inv.cust);

    if (inv.paid > 0) {
        const currentBal = db.prepare(`SELECT current_balance FROM treasury_accounts WHERE id = 1`).get().current_balance;
        const newBal = currentBal + inv.paid;
        db.prepare(`UPDATE treasury_accounts SET current_balance = ? WHERE id = 1`).run(newBal);
        db.prepare(`
            INSERT INTO treasury_transactions (trans_no, trans_date, trans_type, amount, account_id, related_type, related_id, document_no, description)
            VALUES (?, date('now', ?), 'in', ?, 1, 'customer', ?, ?, 'دفعة نقدية فورية')
        `).run('TR-S-' + invoiceNo, daysAgo, inv.paid, inv.cust, invoiceNo);
    }
});console.log(`  ✓ تم إضافة ${salesInvoices.length} فواتير مبيعات`);

// 3 تحصيلات (دفعات آجل)
const collections = [
    { cust: 1, amount: 50,  days: -2, desc: 'دفعة من أحمد' },
    { cust: 3, amount: 200, days: -1, desc: 'دفعة من محمود' },
    { cust: 5, amount: 100, days: -3, desc: 'دفعة من خالد' }
];

collections.forEach((c, idx) => {
    const colNo = 'COL-' + String(idx + 1).padStart(3, '0');
    const daysAgo = c.days + ' days';
    db.prepare(`
        INSERT INTO customer_collections (collection_no, collection_date, customer_id, amount, payment_method, notes)
        VALUES (?, date('now', ?), ?, ?, 'cash', ?)
    `).run(colNo, daysAgo, c.cust, c.amount, c.desc);

    db.prepare(`UPDATE customers SET current_balance = current_balance - ? WHERE id = ?`).run(c.amount, c.cust);

    // تحديث الخزينة + تسجيل الحركة
    const cur = db.prepare(`SELECT current_balance FROM treasury_accounts WHERE id = 1`).get().current_balance;
    const newBal = cur + c.amount;
    db.prepare(`UPDATE treasury_accounts SET current_balance = ? WHERE id = 1`).run(newBal);
    db.prepare(`
        INSERT INTO treasury_transactions (trans_no, trans_date, trans_type, amount, account_id, related_type, related_id, document_no, description)
        VALUES (?, date('now', ?), 'in', ?, 1, 'customer', ?, ?, 'سند قبض - تحصيل')
    `).run('TR-' + colNo, daysAgo, c.amount, c.cust, colNo);
});
console.log(`  ✓ تم إضافة ${collections.length} تحصيلات\n`);

// ═══════════════════════════════════════════════════════════
// ملخص
// ═══════════════════════════════════════════════════════════

console.log('=====================================================');
console.log('  ✓ تم بنجاح! البيانات البسيطة جاهزة');
console.log('=====================================================');

const summary = {
    customers: db.prepare(`SELECT COUNT(*) as c FROM customers`).get().c,
    suppliers: db.prepare(`SELECT COUNT(*) as c FROM suppliers`).get().c,
    products: db.prepare(`SELECT COUNT(*) as c FROM products`).get().c,
    invoices: db.prepare(`SELECT COUNT(*) as c FROM sales_invoices`).get().c,
    collections: db.prepare(`SELECT COUNT(*) as c FROM customer_collections`).get().c,
    inventory_items: db.prepare(`SELECT COUNT(*) as c FROM inventory_balances`).get().c,
    treasury: db.prepare(`SELECT SUM(current_balance) as s FROM treasury_accounts`).get().s,
    inv_value: db.prepare(`
        SELECT SUM(ib.quantity * p.cost_price) as s
        FROM inventory_balances ib
        JOIN products p ON p.id = ib.product_id
    `).get().s
};

console.log(`  • ${summary.customers} عملاء`);
console.log(`  • ${summary.suppliers} موردين`);
console.log(`  • ${summary.products} أصناف`);
console.log(`  • ${summary.invoices} فواتير مبيعات`);
console.log(`  • ${summary.collections} تحصيلات`);
console.log(`  • ${summary.inventory_items} أرصدة مخزون`);
console.log(`  • إجمالي الخزينة: ${summary.treasury.toFixed(2)} ج.م`);
console.log(`  • إجمالي المخزون: ${summary.inv_value.toFixed(2)} ج.م`);
console.log('=====================================================\n');

console.log('📋 العملاء وأرصدتهم:');
const finalCustomers = db.prepare(`SELECT customer_name, current_balance FROM customers WHERE current_balance != 0 ORDER BY current_balance DESC`).all();
finalCustomers.forEach(c => {
    const status = c.current_balance > 0 ? 'مديون' : 'دائن';
    console.log(`   ${c.customer_name}: ${c.current_balance.toFixed(2)} ج.م (${status})`);
});

console.log('\n🚀 افتح http://localhost:3000 واضغط Ctrl+F5 لتحديث الصفحة');
