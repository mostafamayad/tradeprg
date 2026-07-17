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

    const checkRes = await txRequest.query(`
        SELECT ib.quantity, p.product_name 
        FROM inventory_balances ib WITH (UPDLOCK) 
        LEFT JOIN products p ON p.id = ib.product_id
        WHERE ib.store_id = @usb_sid_${sfx} AND ib.product_id = @usb_pid_${sfx}
    `);
    
    let currentQty = 0;
    let pName = `الصنف #${productId}`;
    if (!checkRes.recordset[0]) {
        const pRes = await txRequest.query(`SELECT product_name FROM products WHERE id = @usb_pid_${sfx}`);
        pName = pRes.recordset[0] ? pRes.recordset[0].product_name : pName;
        await txRequest.query(`
            INSERT INTO inventory_balances (store_id, product_id, quantity) VALUES (@usb_sid_${sfx}, @usb_pid_${sfx}, 0)
        `);
    } else {
        currentQty = checkRes.recordset[0].quantity;
        pName = checkRes.recordset[0].product_name || pName;
    }

    const newQty = currentQty + qtyChange;
    if (!allowNegative && newQty < -0.0001) {
        throw new Error(`الرصيد غير كافٍ للصنف "${pName}". المطلوب: ${Math.abs(qtyChange)}، المتاح: ${currentQty}`);
    }

    await txRequest.query(`
        UPDATE inventory_balances
        SET quantity = quantity + @usb_qty_${sfx}
        WHERE store_id = @usb_sid_${sfx} AND product_id = @usb_pid_${sfx}
    `);
    const balRes = await txRequest.query(`SELECT quantity FROM inventory_balances WHERE store_id = @usb_sid_${sfx} AND product_id = @usb_pid_${sfx}`);
    return balRes.recordset[0] ? balRes.recordset[0].quantity : 0;
}

module.exports = { updateStockBalanceAsync };