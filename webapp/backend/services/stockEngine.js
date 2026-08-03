// ── Central Stock Engine ──
// Single source of truth for inventory balance updates.
// Used by: Sales, Purchases, Inventory routes.
// Replaces duplicate copies in sales.js, purchases.js, inventory.js.

const { sql } = require('../database/mssql_db');

/**
 * Update stock balance for a product in a store.
 * Must run inside an existing transaction (txRequest).
 * @param {object} txRequest - mssql transaction request
 * @param {number} storeId - store/warehouse ID
 * @param {number} productId - product ID
 * @param {number} qtyChange - quantity change (+ for inbound, - for outbound)
 * @param {string} [suffix] - unique suffix for parameter names (auto-generated if omitted)
 * @param {boolean} [allowNegative=false] - allow negative balance
 * @returns {Promise<number>} new balance
 */
async function updateStockBalanceAsync(txRequest, storeId, productId, qtyChange, suffix, allowNegative = false) {
    const sfx = suffix || `${storeId}_${productId}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    txRequest.input(`usb_sid_${sfx}`, sql.Int, storeId);
    txRequest.input(`usb_pid_${sfx}`, sql.Int, productId);
    txRequest.input(`usb_qty_${sfx}`, sql.Decimal(18, 4), qtyChange);

    // Atomic UPDATE+OUTPUT: acquire UPDLOCK, apply change, return old+new in one round-trip.
    const upd = await txRequest.query(`
        UPDATE inventory_balances
        SET quantity = quantity + @usb_qty_${sfx}
        OUTPUT DELETED.quantity AS old_qty, INSERTED.quantity AS new_qty
        WHERE store_id = @usb_sid_${sfx} AND product_id = @usb_pid_${sfx}
    `);
    if (upd.recordset[0]) {
        const newQty = parseFloat(upd.recordset[0].new_qty);
        if (!allowNegative && newQty < -0.0001) {
            const pRes = await txRequest.query(`SELECT product_name FROM products WHERE id = @usb_pid_${sfx}`);
            const pName = pRes.recordset[0] ? pRes.recordset[0].product_name : `#${productId}`;
            throw new Error(`الرصيد غير كافٍ للصنف "${pName}". المطلوب: ${Math.abs(qtyChange)}، المتاح: ${parseFloat(upd.recordset[0].old_qty)}`);
        }
        return newQty;
    }
    // No row exists — insert with initial 0, then update
    const pRes = await txRequest.query(`SELECT product_name FROM products WHERE id = @usb_pid_${sfx}`);
    const pName = pRes.recordset[0] ? pRes.recordset[0].product_name : `#${productId}`;
    if (!allowNegative && qtyChange < -0.0001) {
        throw new Error(`الرصيد غير كافٍ للصنف "${pName}". المطلوب: ${Math.abs(qtyChange)}، المتاح: 0`);
    }
    await txRequest.query(`
        INSERT INTO inventory_balances (store_id, product_id, quantity)
        VALUES (@usb_sid_${sfx}, @usb_pid_${sfx}, @usb_qty_${sfx})
    `);
    return qtyChange;
}

module.exports = { updateStockBalanceAsync };