const router = require('express').Router();
const asyncHandler = require('../../utils/asyncHandler');
const { num, loadCompanyData, escapeHtml, validatePagination, applyDateFilter, getSysAccId, getPool, sql, SYS_SALES, SYS_SALES_RETURNS, SYS_AR, SYS_AP, SYS_VAT_OUTPUT, SYS_VAT_INPUT, SYS_COGS, SYS_PURCHASES, SYS_PURCHASE_RETURNS, SYS_INVENTORY, SYS_INVENTORY_SHORTAGE } = require('./shared');
// =====================================================================
// INVENTORY REPORTS MODULE
// =====================================================================

// ─── 1) Inventory Dashboard ─────────────────────────────────────────
router.get('/inventory/dashboard', asyncHandler(async (req, res) => {
  try {
    const pool = await getPool();
    const rq = pool.request();
    const { from, to } = req.query;

    // Total inventory value (cost)
    const valRes = await rq.query(`
      SELECT COALESCE(SUM(ib.quantity * COALESCE(p.cost_price, 0)), 0) AS total_value,
             COUNT(DISTINCT ib.product_id) AS total_products
      FROM inventory_balances ib
      JOIN products p ON ib.product_id = p.id
      WHERE ib.quantity != 0
    `);

    // Low stock products
    const lowRes = await rq.query(`
      SELECT COUNT(*) AS cnt FROM (
        SELECT ib.product_id FROM inventory_balances ib
        JOIN products p ON ib.product_id = p.id
        WHERE ib.quantity <= COALESCE(p.min_stock, 0) AND ib.quantity > 0
        GROUP BY ib.product_id
      ) low
    `);

    // Out of stock products
    const oosRes = await rq.query(`
      SELECT COUNT(*) AS cnt FROM (
        SELECT ib.product_id FROM inventory_balances ib
        GROUP BY ib.product_id HAVING COALESCE(SUM(ib.quantity), 0) <= 0
      ) oos
    `);

    // Transfer count
    let transferSql = `SELECT COUNT(*) AS cnt FROM stock_transfers WHERE status = 'posted'`;
    const tParts = [];
    if (from) { tParts.push(` AND transfer_date >= @tfrom`); rq.input('tfrom', sql.NVarChar, from); }
    if (to)   { tParts.push(` AND transfer_date <= @tto`);   rq.input('tto',   sql.NVarChar, to);   }
    const trnRes = await rq.query(transferSql + tParts.join(''));

    // Disposal count
    let dispSql = `SELECT COUNT(*) AS cnt, COALESCE(SUM(total_value), 0) AS disp_value FROM stock_disposals WHERE status = 'posted'`;
    const dParts = [];
    if (from) { dParts.push(` AND doc_date >= @dfrom`); rq.input('dfrom', sql.NVarChar, from); }
    if (to)   { dParts.push(` AND doc_date <= @dto`);   rq.input('dto',   sql.NVarChar, to);   }
    const dispRes = await rq.query(dispSql + dParts.join(''));

    // Stock count count
    const cntRes = await rq.query(`SELECT COUNT(*) AS cnt FROM stock_count WHERE status = 'completed'`);

    // Adjustment count
    let adjSql = `SELECT COUNT(*) AS cnt, COALESCE(SUM(ABS(quantity)), 0) AS adj_qty FROM stock_adjustments WHERE status = 'posted'`;
    const aParts = [];
    if (from) { aParts.push(` AND adj_date >= @afrom`); rq.input('afrom', sql.NVarChar, from); }
    if (to)   { aParts.push(` AND adj_date <= @ato`);   rq.input('ato',   sql.NVarChar, to);   }
    const adjRes = await rq.query(adjSql + aParts.join(''));

    // Top store by value
    const topStoreRes = await rq.query(`
      SELECT TOP 1 s.id, s.store_name,
             COALESCE(SUM(ib.quantity * COALESCE(p.cost_price, 0)), 0) AS store_value
      FROM stores s
      JOIN inventory_balances ib ON s.id = ib.store_id
      JOIN products p ON ib.product_id = p.id
      WHERE ib.quantity != 0
      GROUP BY s.id, s.store_name
      ORDER BY store_value DESC
    `);

    // Bottom store by value
    const botStoreRes = await rq.query(`
      SELECT TOP 1 s.id, s.store_name,
             COALESCE(SUM(ib.quantity * COALESCE(p.cost_price, 0)), 0) AS store_value
      FROM stores s
      JOIN inventory_balances ib ON s.id = ib.store_id
      JOIN products p ON ib.product_id = p.id
      WHERE ib.quantity != 0
      GROUP BY s.id, s.store_name
      ORDER BY store_value ASC
    `);

    // Store count
    const stCntRes = await rq.query(`SELECT COUNT(*) AS cnt FROM stores WHERE status IS NULL OR status = 'active'`);

    res.json({
      success: true,
      data: {
        total_value: num(valRes.recordset[0].total_value),
        total_products: num(valRes.recordset[0].total_products),
        low_stock_count: num(lowRes.recordset[0].cnt),
        out_of_stock_count: num(oosRes.recordset[0].cnt),
        transfer_count: num(trnRes.recordset[0].cnt),
        disposal_count: num(dispRes.recordset[0].cnt),
        disposal_value: num(dispRes.recordset[0].disp_value),
        count_count: num(cntRes.recordset[0].cnt),
        adjustment_count: num(adjRes.recordset[0].cnt),
        adjustment_qty: num(adjRes.recordset[0].adj_qty),
        top_store: topStoreRes.recordset[0] || null,
        bottom_store: botStoreRes.recordset[0] || null,
        store_count: num(stCntRes.recordset[0].cnt)
      }
    });
  } catch (err) {
    console.error('inventory/dashboard error:', err);
    res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
  }
}));

// ─── 2) Inventory Balances Report ────────────────────────────────────
router.get('/inventory/balances', asyncHandler(async (req, res) => {
  try {
    const { store_id, category_id, stock_status } = req.query;
    const pool = await getPool();
    const rq = pool.request();

    let where = 'WHERE ib.quantity != 0';
    if (store_id) { where += ' AND ib.store_id = @sid'; rq.input('sid', sql.Int, store_id); }
    if (category_id) { where += ' AND p.category_id = @cat'; rq.input('cat', sql.Int, category_id); }
    if (stock_status === 'low') { where += ' AND ib.quantity <= COALESCE(p.min_stock, 0)'; }
    if (stock_status === 'out') { where += ' AND ib.quantity <= 0'; }
    if (stock_status === 'normal') { where += ' AND ib.quantity > COALESCE(p.min_stock, 0)'; }

    const result = await rq.query(`
      SELECT ib.store_id, s.store_name,
             ib.product_id, p.product_code, p.product_name, p.unit_name,
             ib.quantity, COALESCE(p.cost_price, 0) AS cost_price,
             (ib.quantity * COALESCE(p.cost_price, 0)) AS total_value,
             COALESCE(p.min_stock, 0) AS min_stock,
             CASE WHEN ib.quantity <= 0 THEN 'out'
                  WHEN ib.quantity <= COALESCE(p.min_stock, 0) THEN 'low'
                  ELSE 'normal' END AS stock_status
      FROM inventory_balances ib
      JOIN stores s ON ib.store_id = s.id
      JOIN products p ON ib.product_id = p.id
      ${where}
      ORDER BY s.store_name, p.product_name
    `);

    const totals = { total_qty: 0, total_value: 0, product_count: 0 };
    result.recordset.forEach(r => {
      totals.total_qty += num(r.quantity);
      totals.total_value += num(r.total_value);
      totals.product_count++;
    });

    res.json({ success: true, data: result.recordset, totals });
  } catch (err) {
    console.error('inventory/balances error:', err);
    res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
  }
}));

// ─── 3) Inventory Movement (Stock Card) ──────────────────────────────
router.get('/inventory/movement/:productId', asyncHandler(async (req, res) => {
  try {
    const { from, to, store_id } = req.query;
    const productId = req.params.productId;
    const pool = await getPool();
    const rq = pool.request();
    rq.input('pid', sql.Int, productId);

    // Product info
    const prodRes = await rq.query(`SELECT * FROM products WHERE id = @pid`);
    if (!prodRes.recordset[0]) return res.status(404).json({ success: false, message: 'الصنف غير موجود' });
    const product = prodRes.recordset[0];

    // Opening balance before the period
    let opening = 0;
    if (from) {
      rq.input('opfrom', sql.NVarChar, from);
      const opRes = await rq.query(`
        SELECT COALESCE(SUM(qty_in), 0) - COALESCE(SUM(qty_out), 0) AS balance
        FROM stock_movements
        WHERE product_id = @pid AND move_date < @opfrom
        ${store_id ? 'AND store_id = @op_sid' : ''}
      `);
      if (store_id) rq.input('op_sid', sql.Int, store_id);
      opening = num(opRes.recordset[0].balance);
    } else {
      // Get balance from inventory_balances
      const balRes = await rq.query(`
        SELECT COALESCE(SUM(quantity), 0) AS qty FROM inventory_balances WHERE product_id = @pid
        ${store_id ? 'AND store_id = @bal_sid' : ''}
      `);
      if (store_id) rq.input('bal_sid', sql.Int, store_id);
      // We'll compute opening as 0 and movements as the full history
      opening = 0;
    }

    // Movements
    let movWhere = 'WHERE sm.product_id = @pid';
    if (from) { movWhere += ' AND sm.move_date >= @mfrom'; rq.input('mfrom', sql.NVarChar, from); }
    if (to)   { movWhere += ' AND sm.move_date <= @mto';   rq.input('mto',   sql.NVarChar, to);   }
    if (store_id) { movWhere += ' AND sm.store_id = @msid'; rq.input('msid', sql.Int, store_id); }

    const movRes = await rq.query(`
      SELECT sm.id, sm.move_date, sm.move_type, sm.document_no, sm.store_id,
             s.store_name, sm.qty_in, sm.qty_out, sm.cost_price, sm.sell_price,
             sm.balance_after, sm.notes, sm.created_at
      FROM stock_movements sm
      LEFT JOIN stores s ON sm.store_id = s.id
      ${movWhere}
      ORDER BY sm.move_date ASC, sm.id ASC
    `);

    // Closing balance = opening + net movements
    let runningBalance = opening;
    const rows = movRes.recordset.map(m => {
      const qtyIn = num(m.qty_in);
      const qtyOut = num(m.qty_out);
      runningBalance += qtyIn - qtyOut;
      return {
        ...m,
        qty_in: qtyIn,
        qty_out: qtyOut,
        cost_price: num(m.cost_price),
        running_balance: runningBalance
      };
    });
    const closingBalance = runningBalance;

    // Store info
    let stores = [];
    if (store_id) {
      const sRes = await pool.request()
        .input('stId', sql.Int, parseInt(store_id))
        .query(`SELECT id, store_name FROM stores WHERE id = @stId`);
      stores = sRes.recordset;
    }

    res.json({
      success: true,
      data: {
        product: { id: product.id, product_code: product.product_code, product_name: product.product_name, unit_name: product.unit_name, cost_price: num(product.cost_price) },
        opening_balance: opening,
        closing_balance: closingBalance,
        movements: rows,
        total_qty_in: rows.reduce((s, r) => s + r.qty_in, 0),
        total_qty_out: rows.reduce((s, r) => s + r.qty_out, 0)
      }
    });
  } catch (err) {
    console.error('inventory/movement error:', err);
    res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
  }
}));

// ─── 4) Transfer Report ──────────────────────────────────────────────
router.get('/inventory/transfers', asyncHandler(async (req, res) => {
  try {
    const { from, to, store_id } = req.query;
    const pool = await getPool();
    const rq = pool.request();

    let where = 'WHERE 1=1';
    if (from) { where += ' AND t.transfer_date >= @from'; rq.input('from', sql.NVarChar, from); }
    if (to)   { where += ' AND t.transfer_date <= @to';   rq.input('to',   sql.NVarChar, to);   }
    if (store_id) { where += ' AND (t.from_store_id = @sid OR t.to_store_id = @sid)'; rq.input('sid', sql.Int, store_id); }

    const result = await rq.query(`
      SELECT t.id, t.transfer_no, t.transfer_date, t.status, t.notes, t.created_at,
             fs.store_name AS from_store, ts.store_name AS to_store,
             (SELECT COUNT(*) FROM stock_transfer_items WHERE transfer_id = t.id) AS item_count,
             (SELECT COALESCE(SUM(quantity), 0) FROM stock_transfer_items WHERE transfer_id = t.id) AS total_qty,
             u.username AS created_by_name
      FROM stock_transfers t
      JOIN stores fs ON t.from_store_id = fs.id
      JOIN stores ts ON t.to_store_id = ts.id
      LEFT JOIN users u ON t.created_by = u.id
      ${where}
      ORDER BY t.id DESC
    `);

    const totals = { transfer_count: result.recordset.length, total_qty: 0 };
    result.recordset.forEach(r => { totals.total_qty += num(r.total_qty); });

    res.json({ success: true, data: result.recordset, totals });
  } catch (err) {
    console.error('inventory/transfers error:', err);
    res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
  }
}));

// ─── 5) Disposal Report ──────────────────────────────────────────────
router.get('/inventory/disposals', asyncHandler(async (req, res) => {
  try {
    const { from, to, store_id } = req.query;
    const pool = await getPool();
    const rq = pool.request();

    let where = 'WHERE d.status = \'posted\'';
    if (from) { where += ' AND d.doc_date >= @from'; rq.input('from', sql.NVarChar, from); }
    if (to)   { where += ' AND d.doc_date <= @to';   rq.input('to',   sql.NVarChar, to);   }
    if (store_id) { where += ' AND d.store_id = @sid'; rq.input('sid', sql.Int, store_id); }

    const result = await rq.query(`
      SELECT d.id, d.doc_no, d.doc_date, d.store_id, s.store_name, d.committee,
             d.reason, d.notes, d.total_qty, d.total_value, d.status, d.created_at,
             u.username AS created_by_name,
             (SELECT COUNT(*) FROM stock_disposal_items WHERE disposal_id = d.id) AS item_count
      FROM stock_disposals d
      LEFT JOIN stores s ON d.store_id = s.id
      LEFT JOIN users u ON d.created_by = u.id
      ${where}
      ORDER BY d.id DESC
    `);

    const totals = { disposal_count: result.recordset.length, total_qty: 0, total_value: 0 };
    result.recordset.forEach(r => {
      totals.total_qty += num(r.total_qty);
      totals.total_value += num(r.total_value);
    });

    res.json({ success: true, data: result.recordset, totals });
  } catch (err) {
    console.error('inventory/disposals error:', err);
    res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
  }
}));

// ─── 6) Stock Count Report ────────────────────────────────────────────
router.get('/inventory/counts', asyncHandler(async (req, res) => {
  try {
    const { from, to, store_id } = req.query;
    const pool = await getPool();
    const rq = pool.request();

    let where = 'WHERE 1=1';
    if (from) { where += ' AND c.count_date >= @from'; rq.input('from', sql.NVarChar, from); }
    if (to)   { where += ' AND c.count_date <= @to';   rq.input('to',   sql.NVarChar, to);   }
    if (store_id) { where += ' AND c.store_id = @sid'; rq.input('sid', sql.Int, store_id); }

    const result = await rq.query(`
      SELECT c.id, c.count_no, c.count_date, c.store_id, s.store_name, c.status, c.notes, c.created_at,
             (SELECT COUNT(*) FROM stock_count_items WHERE count_id = c.id) AS item_count,
             (SELECT COUNT(*) FROM stock_count_items WHERE count_id = c.id AND diff != 0) AS diff_count,
             (SELECT COALESCE(SUM(ABS(diff)), 0) FROM stock_count_items WHERE count_id = c.id) AS total_diff_qty,
             (SELECT COALESCE(SUM(ABS(diff) * COALESCE(p.cost_price, 0)), 0)
              FROM stock_count_items ci
              JOIN products p ON ci.product_id = p.id
              WHERE ci.count_id = c.id) AS total_diff_value
      FROM stock_count c
      LEFT JOIN stores s ON c.store_id = s.id
      ${where}
      ORDER BY c.id DESC
    `);

    const totals = { count_count: result.recordset.length, total_diff_qty: 0, total_diff_value: 0 };
    result.recordset.forEach(r => {
      totals.total_diff_qty += num(r.total_diff_qty);
      totals.total_diff_value += num(r.total_diff_value);
    });

    res.json({ success: true, data: result.recordset, totals });
  } catch (err) {
    console.error('inventory/counts error:', err);
    res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
  }
}));

// ─── 7) Adjustment Report ────────────────────────────────────────────
router.get('/inventory/adjustments', asyncHandler(async (req, res) => {
  try {
    const { from, to, store_id } = req.query;
    const pool = await getPool();
    const rq = pool.request();

    let where = 'WHERE a.status = \'posted\'';
    if (from) { where += ' AND a.adj_date >= @from'; rq.input('from', sql.NVarChar, from); }
    if (to)   { where += ' AND a.adj_date <= @to';   rq.input('to',   sql.NVarChar, to);   }
    if (store_id) { where += ' AND a.store_id = @sid'; rq.input('sid', sql.Int, store_id); }

    const result = await rq.query(`
      SELECT a.id, a.adj_no, a.adj_date, a.store_id, s.store_name, a.product_id,
             p.product_code, p.product_name, p.unit_name,
             a.quantity, (a.quantity * COALESCE(p.cost_price, 0)) AS total_value,
             a.reason, a.status, a.created_at,
             u.username AS created_by_name
      FROM stock_adjustments a
      LEFT JOIN stores s ON a.store_id = s.id
      LEFT JOIN products p ON a.product_id = p.id
      LEFT JOIN users u ON a.created_by = u.id
      ${where}
      ORDER BY a.id DESC
    `);

    const totals = { adjustment_count: result.recordset.length, total_qty: 0, total_value: 0 };
    result.recordset.forEach(r => {
      totals.total_qty += num(r.quantity);
      totals.total_value += num(r.total_value);
    });

    res.json({ success: true, data: result.recordset, totals });
  } catch (err) {
    console.error('inventory/adjustments error:', err);
    res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
  }
}));

// ─── 8) Slow-Moving Items Report ─────────────────────────────────────
router.get('/inventory/slow-moving', asyncHandler(async (req, res) => {
  try {
    const { days, store_id } = req.query;
    const threshold = parseInt(days) || 90;
    const pool = await getPool();
    const rq = pool.request();
    rq.input('days', sql.Int, threshold);

    let where = '';
    if (store_id) { where = ' AND sm.store_id = @sid'; rq.input('sid', sql.Int, store_id); }

    const result = await rq.query(`
      SELECT p.id, p.product_code, p.product_name, p.unit_name, p.cost_price,
             COALESCE(ib.qty, 0) AS current_qty,
             (COALESCE(ib.qty, 0) * COALESCE(p.cost_price, 0)) AS total_value,
             last_mv.last_move_date,
             DATEDIFF(DAY, last_mv.last_move_date, GETDATE()) AS days_since_move
      FROM products p
      OUTER APPLY (
        SELECT TOP 1 sm.move_date AS last_move_date
        FROM stock_movements sm
        WHERE sm.product_id = p.id ${where}
          AND (sm.qty_in > 0 OR sm.qty_out > 0)
        ORDER BY sm.move_date DESC
      ) last_mv
      OUTER APPLY (
        SELECT COALESCE(SUM(quantity), 0) AS qty FROM inventory_balances ib
        WHERE ib.product_id = p.id ${store_id ? 'AND ib.store_id = @sid' : ''}
      ) ib
      WHERE last_mv.last_move_date IS NOT NULL
        AND DATEDIFF(DAY, last_mv.last_move_date, GETDATE()) >= @days
        AND COALESCE(ib.qty, 0) > 0
      ORDER BY days_since_move DESC
    `);

    const totals = { product_count: result.recordset.length, total_qty: 0, total_value: 0 };
    result.recordset.forEach(r => {
      totals.total_qty += num(r.current_qty);
      totals.total_value += num(r.total_value);
    });

    res.json({ success: true, data: result.recordset, totals });
  } catch (err) {
    console.error('inventory/slow-moving error:', err);
    res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
  }
}));

// ─── 9) Fast-Moving Items Report ──────────────────────────────────────
router.get('/inventory/fast-moving', asyncHandler(async (req, res) => {
  try {
    const { from, to, store_id, sort_by } = req.query;
    const pool = await getPool();
    const rq = pool.request();

    let where = 'WHERE 1=1';
    if (from) { where += ' AND sm.move_date >= @from'; rq.input('from', sql.NVarChar, from); }
    if (to)   { where += ' AND sm.move_date <= @to';   rq.input('to',   sql.NVarChar, to);   }
    if (store_id) { where += ' AND sm.store_id = @sid'; rq.input('sid', sql.Int, store_id); }

    const orderBy = sort_by === 'value' ? 'total_movement_value DESC' : 'total_movement_qty DESC';

    const result = await rq.query(`
      SELECT TOP 100 p.id, p.product_code, p.product_name, p.unit_name, p.cost_price,
             COALESCE(SUM(sm.qty_in + sm.qty_out), 0) AS total_movement_qty,
             COALESCE(SUM((sm.qty_in + sm.qty_out) * COALESCE(sm.cost_price, 0)), 0) AS total_movement_value,
             COALESCE(ib.qty, 0) AS current_qty,
             MAX(sm.move_date) AS last_move_date,
             COUNT(*) AS movement_count
      FROM stock_movements sm
      JOIN products p ON sm.product_id = p.id
      OUTER APPLY (
        SELECT COALESCE(SUM(quantity), 0) AS qty FROM inventory_balances ib
        WHERE ib.product_id = p.id ${store_id ? 'AND ib.store_id = @sid' : ''}
      ) ib
      ${where}
      GROUP BY p.id, p.product_code, p.product_name, p.unit_name, p.cost_price, ib.qty
      ORDER BY ${orderBy}
    `);

    const totals = { product_count: result.recordset.length, total_movement_qty: 0, total_movement_value: 0 };
    result.recordset.forEach(r => {
      totals.total_movement_qty += num(r.total_movement_qty);
      totals.total_movement_value += num(r.total_movement_value);
    });

    res.json({ success: true, data: result.recordset, totals });
  } catch (err) {
    console.error('inventory/fast-moving error:', err);
    res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
  }
}));

// ─── 10) Inventory Valuation Report ──────────────────────────────────
router.get('/inventory/valuation', asyncHandler(async (req, res) => {
  try {
    const pool = await getPool();
    const rq = pool.request();

    // Value by store
    const byStoreRes = await rq.query(`
      SELECT s.id AS store_id, s.store_name,
             COUNT(DISTINCT ib.product_id) AS product_count,
             COALESCE(SUM(ib.quantity), 0) AS total_qty,
             COALESCE(SUM(ib.quantity * COALESCE(p.cost_price, 0)), 0) AS total_value
      FROM stores s
      LEFT JOIN inventory_balances ib ON s.id = ib.store_id AND ib.quantity != 0
      LEFT JOIN products p ON ib.product_id = p.id
      WHERE s.is_active IS NULL OR s.is_active = 1
      GROUP BY s.id, s.store_name
      ORDER BY total_value DESC
    `);

    // Value by category
    const byCatRes = await rq.query(`
      SELECT COALESCE(p.category_id, 0) AS category_id,
             COALESCE(c.category_name, 'غير مصنف') AS category_name,
             COUNT(DISTINCT p.id) AS product_count,
             COALESCE(SUM(ib.quantity), 0) AS total_qty,
             COALESCE(SUM(ib.quantity * COALESCE(p.cost_price, 0)), 0) AS total_value
      FROM products p
      LEFT JOIN inventory_balances ib ON p.id = ib.product_id AND ib.quantity != 0
      LEFT JOIN categories c ON p.category_id = c.id
      GROUP BY p.category_id, c.category_name
      ORDER BY total_value DESC
    `);

    // Grand total
    const grandRes = await rq.query(`
      SELECT COUNT(DISTINCT ib.product_id) AS product_count,
             COALESCE(SUM(ib.quantity), 0) AS total_qty,
             COALESCE(SUM(ib.quantity * COALESCE(p.cost_price, 0)), 0) AS total_value
      FROM inventory_balances ib
      JOIN products p ON ib.product_id = p.id
      WHERE ib.quantity != 0
    `);

    // Accounting validation
    const invAccId = await getSysAccId(rq, SYS_INVENTORY);
    let accValue = 0;
    if (invAccId) {
      rq.input('invId', sql.Int, invAccId);
      const accRes = await rq.query(`
        SELECT COALESCE(current_balance, 0) AS balance FROM chart_of_accounts WHERE id = @invId
      `);
      accValue = num(accRes.recordset[0]?.balance);
    }

    res.json({
      success: true,
      data: {
        by_store: byStoreRes.recordset,
        by_category: byCatRes.recordset,
        grand_total: {
          product_count: num(grandRes.recordset[0].product_count),
          total_qty: num(grandRes.recordset[0].total_qty),
          total_value: num(grandRes.recordset[0].total_value)
        },
        accounting_balance: accValue,
        difference: num(grandRes.recordset[0].total_value) - accValue
      }
    });
  } catch (err) {
    console.error('inventory/valuation error:', err);
    res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
  }
}));

module.exports = router;

module.exports = router;