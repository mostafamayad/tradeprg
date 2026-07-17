// ============================================================
// Helper: Generate next sequential document number
// ============================================================
const db = require('../database/db');

function nextDocNo(counterName) {
    const row = db.prepare('SELECT prefix, last_number FROM invoice_counters WHERE counter_name = ?').get(counterName);
    if (!row) return `DOC-0001`;
    const next = row.last_number + 1;
    db.prepare('UPDATE invoice_counters SET last_number = ? WHERE counter_name = ?').run(next, counterName);
    return `${row.prefix}-${String(next).padStart(4, '0')}`;
}

// Helper: update customer balance (recalculate from scratch)
function recalcCustomerBalance(customerId) {
    const c = db.prepare('SELECT opening_balance FROM customers WHERE id = ?').get(customerId);
    if (!c) return;

    const sales = db.prepare(`SELECT COALESCE(SUM(grand_total), 0) as total FROM sales_invoices WHERE customer_id = ? AND status != 'cancelled'`).get(customerId);
    const returns = db.prepare(`SELECT COALESCE(SUM(grand_total), 0) as total FROM sales_returns WHERE customer_id = ? AND status != 'cancelled'`).get(customerId);
    const collections = db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM customer_collections WHERE customer_id = ?`).get(customerId);

    const balance = (c.opening_balance || 0) + (sales.total || 0) - (returns.total || 0) - (collections.total || 0);
    db.prepare('UPDATE customers SET current_balance = ? WHERE id = ?').run(balance, customerId);
    return balance;
}

// Helper: update supplier balance
function recalcSupplierBalance(supplierId) {
    const s = db.prepare('SELECT opening_balance FROM suppliers WHERE id = ?').get(supplierId);
    if (!s) return;

    const purchases = db.prepare(`SELECT COALESCE(SUM(grand_total), 0) as total FROM purchase_invoices WHERE supplier_id = ? AND status != 'cancelled'`).get(supplierId);
    const returns = db.prepare(`SELECT COALESCE(SUM(grand_total), 0) as total FROM purchase_returns WHERE supplier_id = ? AND status != 'cancelled'`).get(supplierId);
    const payments = db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM supplier_payments WHERE supplier_id = ?`).get(supplierId);

    const balance = (s.opening_balance || 0) + (purchases.total || 0) - (returns.total || 0) - (payments.total || 0);
    db.prepare('UPDATE suppliers SET current_balance = ? WHERE id = ?').run(balance, supplierId);
    return balance;
}

// Helper: update inventory balance
function updateStockBalance(storeId, productId, qtyChange) {
    // Ensure row exists
    db.prepare(`INSERT OR IGNORE INTO inventory_balances (store_id, product_id, quantity) VALUES (?, ?, 0)`).run(storeId, productId);
    db.prepare(`UPDATE inventory_balances SET quantity = quantity + ? WHERE store_id = ? AND product_id = ?`).run(qtyChange, storeId, productId);
    const bal = db.prepare('SELECT quantity FROM inventory_balances WHERE store_id = ? AND product_id = ?').get(storeId, productId);
    return bal ? bal.quantity : 0;
}

module.exports = { nextDocNo, recalcCustomerBalance, recalcSupplierBalance, updateStockBalance };
