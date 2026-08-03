const fs = require('fs');
let code = fs.readFileSync('routes/reports.js', 'utf8');

// 1. Customer statement
const custOld = `    // -- Build UNION of all transaction types --
    let wFrom = from ? ' AND invoice_date >= @from' : '';
    let wTo   = to   ? ' AND invoice_date <= @to' : '';
    let wFromR = from ? ' AND return_date >= @from' : '';
    let wToR   = to   ? ' AND return_date <= @to' : '';
    let wFromC = from ? ' AND collection_date >= @from' : '';
    let wToC   = to   ? ' AND collection_date <= @to' : '';

    let parts = [];
    parts.push(\`
      SELECT invoice_date AS trans_date, invoice_no AS doc_no,
             N'فاتورة مبيعات' AS doc_type,
             N'فاتورة' AS doc_type_short,
             grand_total AS debit, 0 AS credit, 0 AS qty, 0 AS unit_price,
             tax_amount, discount_amount,
             'sales_invoice' AS ref_type, id AS ref_id,
             ISNULL(notes,'') AS description, '' AS created_by_name, store_id
      FROM sales_invoices
      WHERE customer_id = @cid AND status NOT IN ('cancelled','deleted')\${wFrom}\${wTo}
    \`);
    parts.push(\`
      SELECT return_date AS trans_date, return_no AS doc_no,
             N'مرتجع مبيعات' AS doc_type,
             N'مرتجع' AS doc_type_short,
             0 AS debit, grand_total AS credit, 0 AS qty, 0 AS unit_price,
             NULL AS tax_amount, NULL AS discount_amount,
             'sales_return' AS ref_type, id AS ref_id,
             ISNULL(return_reason,'') AS description, '' AS created_by_name, NULL AS store_id
      FROM sales_returns
      WHERE customer_id = @cid AND status NOT IN ('cancelled','deleted')\${wFromR}\${wToR}
    \`);
    parts.push(\`
      SELECT collection_date AS trans_date, collection_no AS doc_no,
             N'تحصيل' AS doc_type,
             N'سند قبض' AS doc_type_short,
             0 AS debit, amount AS credit, 0 AS qty, 0 AS unit_price,
             NULL AS tax_amount, NULL AS discount_amount,
             'collection' AS ref_type, id AS ref_id,
             ISNULL(notes,'') AS description, '' AS created_by_name, NULL AS store_id
      FROM customer_collections
      WHERE customer_id = @cid\${wFromC}\${wToC}
    \`);

    if (arAcc) {
      let wJeFrom = from ? ' AND je.entry_date >= @from' : '';
      let wJeTo   = to   ? ' AND je.entry_date <= @to' : '';
      parts.push(\`
        SELECT je.entry_date AS trans_date, je.entry_no AS doc_no,
               CASE WHEN jl.debit > 0 THEN N'قيد مدين' ELSE N'قيد دائن' END AS doc_type,
               CASE WHEN jl.debit > 0 THEN N'مدين' ELSE N'دائن' END AS doc_type_short,
               jl.debit, jl.credit, 0 AS qty, 0 AS unit_price,
               NULL AS tax_amount, NULL AS discount_amount,
               'journal_entry' AS ref_type, je.id AS ref_id,
               ISNULL(jl.description,'') AS description,
               ISNULL(u.full_name,'') AS created_by_name, NULL AS store_id
        FROM journal_entry_lines jl
        JOIN journal_entries je ON je.id = jl.entry_id
        LEFT JOIN users u ON je.created_by = u.id
        WHERE jl.account_id = \${arAcc}
          AND je.reference_type IS NULL
          AND (jl.description LIKE N'%' + CAST(@cid AS NVARCHAR) + N'%'
               OR jl.description LIKE N'%عميل%' + CAST(@cid AS NVARCHAR)
               OR jl.description LIKE N'%' + CAST(@cid AS NVARCHAR) + N'%')
          \${wJeFrom}\${wJeTo}
      \`);
    }`;

const custNew = `    let wJeFrom = from ? ' AND je.entry_date >= @from' : '';
    let wJeTo   = to   ? ' AND je.entry_date <= @to' : '';
    
    // 1. Calculate Dynamic Opening Balance from GL
    let op_bal = Number(cust.opening_balance || 0);
    if (from && arAcc) {
        const obRes = await rq.query(\`
            SELECT SUM(jl.debit - jl.credit) AS bal
            FROM journal_entry_lines jl
            JOIN journal_entries je ON je.id = jl.entry_id
            WHERE je.customer_id = @cid
              AND jl.account_id = \${arAcc}
              AND (je.is_reversed = 0 OR je.is_reversed IS NULL)
              AND je.entry_date < @from
        \`);
        if (obRes.recordset[0] && obRes.recordset[0].bal) {
            op_bal += Number(obRes.recordset[0].bal);
        }
    }

    // 2. Fetch Period Transactions exclusively from GL
    let parts = [];
    if (arAcc) {
        parts.push(\`
          SELECT je.entry_date AS trans_date, je.entry_no AS doc_no,
                 CASE 
                    WHEN je.reference_type = 'sales' THEN N'فاتورة مبيعات'
                    WHEN je.reference_type = 'sales_return' THEN N'مرتجع مبيعات'
                    WHEN je.reference_type = 'collection' THEN N'تحصيل'
                    WHEN je.reference_type = 'opening_balance' THEN N'رصيد افتتاحي'
                    ELSE N'قيد تسوية' 
                 END AS doc_type,
                 CASE 
                    WHEN je.reference_type = 'sales' THEN N'فاتورة'
                    WHEN je.reference_type = 'sales_return' THEN N'مرتجع'
                    WHEN je.reference_type = 'collection' THEN N'سند قبض'
                    WHEN je.reference_type = 'opening_balance' THEN N'افتتاحي'
                    ELSE N'قيد' 
                 END AS doc_type_short,
                 jl.debit, jl.credit, 0 AS qty, 0 AS unit_price,
                 NULL AS tax_amount, NULL AS discount_amount,
                 ISNULL(je.reference_type, 'journal_entry') AS ref_type, 
                 ISNULL(je.reference_id, je.id) AS ref_id,
                 ISNULL(jl.description, je.description) AS description,
                 ISNULL(u.full_name,'') AS created_by_name, NULL AS store_id
          FROM journal_entry_lines jl
          JOIN journal_entries je ON je.id = jl.entry_id
          LEFT JOIN users u ON je.created_by = u.id
          WHERE je.customer_id = @cid
            AND jl.account_id = \${arAcc}
            AND (je.is_reversed = 0 OR je.is_reversed IS NULL)
            \${wJeFrom}\${wJeTo}
        \`);
    }`;

code = code.replace(custOld, custNew);
code = code.replace('let runningBalance = num(cust.opening_balance);', 'let runningBalance = op_bal;');
code = code.replace('const periodOpening = 0;', 'const periodOpening = op_bal;');

// 2. Supplier statement
const supOld = `        let wStr = '';
        if (from) wStr += \` AND invoice_date >= @from\`;
        if (to)   wStr += \` AND invoice_date <= @to\`;

        let parts = [];
        parts.push(\`
            SELECT invoice_date AS trans_date, invoice_no AS doc_no,
                   N'فاتورة مشتريات' AS doc_type, N'فاتورة' AS doc_type_short,
                   grand_total AS debit, 0 AS credit,
                   'purchase_invoice' AS ref_type, id AS ref_id,
                   ISNULL(notes,'') AS description, '' AS created_by_name
            FROM purchase_invoices
            WHERE supplier_id = @sid AND status NOT IN ('cancelled', 'deleted')\${wStr}
        \`);

        let wStrR = '';
        if (from) wStrR += \` AND return_date >= @from\`;
        if (to)   wStrR += \` AND return_date <= @to\`;

        parts.push(\`
            SELECT return_date AS trans_date, return_no AS doc_no,
                   N'مرتجع مشتريات' AS doc_type, N'مرتجع' AS doc_type_short,
                   0 AS debit, grand_total AS credit,
                   'purchase_return' AS ref_type, id AS ref_id,
                   ISNULL(return_reason,'') AS description, '' AS created_by_name
            FROM purchase_returns
            WHERE supplier_id = @sid AND status NOT IN ('cancelled', 'deleted')\${wStrR}
        \`);

        let wStrP = '';
        if (from) wStrP += \` AND payment_date >= @from\`;
        if (to)   wStrP += \` AND payment_date <= @to\`;

        parts.push(\`
            SELECT payment_date AS trans_date, payment_no AS doc_no,
                   N'سند صرف' AS doc_type, N'سند صرف' AS doc_type_short,
                   0 AS debit, amount AS credit,
                   'supplier_payment' AS ref_type, id AS ref_id,
                   ISNULL(notes,'') AS description, '' AS created_by_name
            FROM supplier_payments
            WHERE supplier_id = @sid\${wStrP}
        \`);

        if (apAcc) {
            let wStrJ = '';
            if (from) wStrJ += \` AND je.entry_date >= @from\`;
            if (to)   wStrJ += \` AND je.entry_date <= @to\`;

            parts.push(\`
                SELECT je.entry_date AS trans_date, je.entry_no AS doc_no,
                       CASE WHEN jl.debit > 0 THEN N'قيد مدين' ELSE N'قيد دائن' END AS doc_type,
                       CASE WHEN jl.debit > 0 THEN N'مدين' ELSE N'دائن' END AS doc_type_short,
                       jl.debit, jl.credit,
                       'journal_entry' AS ref_type, je.id AS ref_id,
                       ISNULL(jl.description,'') AS description,
                       ISNULL(u.full_name,'') AS created_by_name
                FROM journal_entry_lines jl
                JOIN journal_entries je ON je.id = jl.entry_id
                LEFT JOIN users u ON je.created_by = u.id
                WHERE jl.account_id = @apAccId
                  AND je.reference_type IS NULL
                  AND (jl.description LIKE N'%' + CAST(@sid AS NVARCHAR) + N'%'
                       OR jl.description LIKE N'%المورد%' + CAST(@sid AS NVARCHAR)
                       OR jl.description LIKE N'%' + CAST(@sid AS NVARCHAR) + N'%')
                  \${wStrJ}
            \`);
        }`;

const supNew = `        let op_bal = Number(sup.opening_balance || 0);
        if (from && apAcc) {
            const obRes = await rq.query(\`
                SELECT SUM(jl.credit - jl.debit) AS bal
                FROM journal_entry_lines jl
                JOIN journal_entries je ON je.id = jl.entry_id
                WHERE je.supplier_id = @sid
                  AND jl.account_id = \${apAcc}
                  AND (je.is_reversed = 0 OR je.is_reversed IS NULL)
                  AND je.entry_date < @from
            \`);
            if (obRes.recordset[0] && obRes.recordset[0].bal) {
                op_bal += Number(obRes.recordset[0].bal);
            }
        }

        let parts = [];
        if (apAcc) {
            let wJeFrom = from ? ' AND je.entry_date >= @from' : '';
            let wJeTo   = to   ? ' AND je.entry_date <= @to' : '';
            parts.push(\`
              SELECT je.entry_date AS trans_date, je.entry_no AS doc_no,
                     CASE 
                        WHEN je.reference_type = 'purchase' THEN N'فاتورة مشتريات'
                        WHEN je.reference_type = 'purchase_return' THEN N'مرتجع مشتريات'
                        WHEN je.reference_type = 'payment' THEN N'سند صرف'
                        WHEN je.reference_type = 'opening_balance' THEN N'رصيد افتتاحي'
                        ELSE N'قيد تسوية' 
                     END AS doc_type,
                     CASE 
                        WHEN je.reference_type = 'purchase' THEN N'فاتورة'
                        WHEN je.reference_type = 'purchase_return' THEN N'مرتجع'
                        WHEN je.reference_type = 'payment' THEN N'سند صرف'
                        WHEN je.reference_type = 'opening_balance' THEN N'افتتاحي'
                        ELSE N'قيد' 
                     END AS doc_type_short,
                     jl.debit, jl.credit,
                     ISNULL(je.reference_type, 'journal_entry') AS ref_type, 
                     ISNULL(je.reference_id, je.id) AS ref_id,
                     ISNULL(jl.description, je.description) AS description,
                     ISNULL(u.full_name,'') AS created_by_name
              FROM journal_entry_lines jl
              JOIN journal_entries je ON je.id = jl.entry_id
              LEFT JOIN users u ON je.created_by = u.id
              WHERE je.supplier_id = @sid
                AND jl.account_id = \${apAcc}
                AND (je.is_reversed = 0 OR je.is_reversed IS NULL)
                \${wJeFrom}\${wJeTo}
            \`);
        }`;
code = code.replace(supOld, supNew);
code = code.replace('let running = num(sup.opening_balance);', 'let running = op_bal;');

const supBalanceOld = `        const statement = rows.map(r => {
            running += num(r.debit) - num(r.credit);
            return {
                date: r.trans_date, doc_no: r.doc_no, doc_type: r.doc_type,
                doc_type_short: r.doc_type_short, debit: num(r.debit), credit: num(r.credit),
                balance: running, description: r.description, created_by: r.created_by_name,
                ref_type: r.ref_type, ref_id: r.ref_id
            };
        });`;
const supBalanceNew = `        const statement = [{
            date: null, doc_no: '\\u2014',
            doc_type: '\\u0631\\u0635\\u064A\\u062F \\u0627\\u0641\\u062A\\u062A\\u0627\\u062D\\u064A',
            doc_type_short: '\\u0631\\u0635\\u064A\\u062F \\u0627\\u0641\\u062A\\u062A\\u0627\\u062D\\u064A',
            debit: 0, credit: 0, balance: op_bal,
            description: '\\u0631\\u0635\\u064A\\u062F \\u0627\\u0641\\u062A\\u062A\\u0627\\u062D\\u064A \\u0644\\u0644\\u0641\\u062A\\u0631\\u0629',
            created_by: null, ref_type: 'opening', ref_id: null
        }];

        for (const r of rows) {
            running += num(r.credit) - num(r.debit);
            statement.push({
                date: r.trans_date, doc_no: r.doc_no, doc_type: r.doc_type,
                doc_type_short: r.doc_type_short, debit: num(r.debit), credit: num(r.credit),
                balance: running, description: r.description, created_by: r.created_by_name,
                ref_type: r.ref_type, ref_id: r.ref_id
            });
        }`;
code = code.replace(supBalanceOld, supBalanceNew);
code = code.replace('closing_balance: num(sup.opening_balance) + totalDebit - totalCredit', 'closing_balance: running');
code = code.replace('current_balance: num(sup.current_balance)', 'current_balance: running');
code = code.replace('opening_balance: num(sup.opening_balance)', 'opening_balance: op_bal');

// 3. Inventory Valuation
const invStoreOld = `    // Value by store
    const byStoreRes = await rq.query(\`
      SELECT s.id AS store_id, s.store_name,
             COUNT(DISTINCT ib.product_id) AS product_count,
             COALESCE(SUM(ib.quantity), 0) AS total_qty,
             COALESCE(SUM(ib.quantity * COALESCE(p.cost_price, 0)), 0) AS total_value
      FROM stores s
      LEFT JOIN inventory_balances ib ON s.id = ib.store_id AND ib.quantity != 0
      LEFT JOIN products p ON ib.product_id = p.id
      WHERE s.status IS NULL OR s.status = 'active'
      GROUP BY s.id, s.store_name
      ORDER BY total_value DESC
    \`);`;
const invStoreNew = `    const wacCTE = \`
      WITH product_wac AS (
        SELECT p.id AS product_id,
               COALESCE(
                 (SELECT CASE WHEN SUM(qty_in) > 0 THEN SUM(qty_in * cost_price) / SUM(qty_in) ELSE p.cost_price END 
                  FROM stock_movements 
                  WHERE product_id = p.id AND qty_in > 0 AND move_type IN ('in', 'purchase', 'transfer')),
                 p.cost_price, 0
               ) AS wac
        FROM products p
      )
    \`;

    // Value by store
    const byStoreRes = await rq.query(\`
      \${wacCTE}
      SELECT s.id AS store_id, s.store_name,
             COUNT(DISTINCT ib.product_id) AS product_count,
             COALESCE(SUM(ib.quantity), 0) AS total_qty,
             COALESCE(SUM(ib.quantity * pw.wac), 0) AS total_value
      FROM stores s
      LEFT JOIN inventory_balances ib ON s.id = ib.store_id AND ib.quantity != 0
      LEFT JOIN product_wac pw ON ib.product_id = pw.product_id
      WHERE s.status IS NULL OR s.status = 'active'
      GROUP BY s.id, s.store_name
      ORDER BY total_value DESC
    \`);`;
code = code.replace(invStoreOld, invStoreNew);

const invCatOld = `    // Value by category
    const byCatRes = await rq.query(\`
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
    \`);`;
const invCatNew = `    // Value by category
    const byCatRes = await rq.query(\`
      \${wacCTE}
      SELECT COALESCE(p.category_id, 0) AS category_id,
             COALESCE(c.category_name, 'غير مصنف') AS category_name,
             COUNT(DISTINCT p.id) AS product_count,
             COALESCE(SUM(ib.quantity), 0) AS total_qty,
             COALESCE(SUM(ib.quantity * pw.wac), 0) AS total_value
      FROM products p
      LEFT JOIN inventory_balances ib ON p.id = ib.product_id AND ib.quantity != 0
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN product_wac pw ON p.id = pw.product_id
      GROUP BY p.category_id, c.category_name
      ORDER BY total_value DESC
    \`);`;
code = code.replace(invCatOld, invCatNew);

const invGrandOld = `    // Grand total
    const grandRes = await rq.query(\`
      SELECT COUNT(DISTINCT ib.product_id) AS product_count,
             COALESCE(SUM(ib.quantity), 0) AS total_qty,
             COALESCE(SUM(ib.quantity * COALESCE(p.cost_price, 0)), 0) AS total_value
      FROM inventory_balances ib
      JOIN products p ON ib.product_id = p.id
      WHERE ib.quantity != 0
    \`);`;
const invGrandNew = `    // Grand total
    const grandRes = await rq.query(\`
      \${wacCTE}
      SELECT COUNT(DISTINCT ib.product_id) AS product_count,
             COALESCE(SUM(ib.quantity), 0) AS total_qty,
             COALESCE(SUM(ib.quantity * pw.wac), 0) AS total_value
      FROM inventory_balances ib
      JOIN products p ON ib.product_id = p.id
      LEFT JOIN product_wac pw ON ib.product_id = pw.product_id
      WHERE ib.quantity != 0
    \`);`;
code = code.replace(invGrandOld, invGrandNew);

fs.writeFileSync('routes/reports.js', code);
console.log("SUCCESS");
