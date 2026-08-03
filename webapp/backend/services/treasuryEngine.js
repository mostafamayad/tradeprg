// ── Central Treasury Engine ──
// Single source of truth for treasury transaction creation.
// Ensures every treasury transaction has a corresponding Journal Entry.
// Used by: Treasury, Sales, Purchases, Collections, CRM, AR/AP modules.

const { sql } = require('../database/mssql_db');

/**
 * Create a treasury transaction.
 * NOTE: Journal Entry is NOT created here — calling modules are responsible
 * for posting their own JEs with correct chart_of_accounts IDs.
 * @param {object} txRequest - mssql transaction request
 * @param {object} params
 * @param {string} params.transNo - document number
 * @param {string} params.transDate - transaction date
 * @param {string} params.transType - 'in' or 'out'
 * @param {number} params.amount - transaction amount
 * @param {number} params.accountId - treasury account ID (cash/bank)
 * @param {string} [params.relatedType] - related document type
 * @param {number} [params.relatedId] - related document ID
 * @param {string} [params.documentNo] - related document number
 * @param {string} [params.description] - description
 * @returns {Promise<number>} new treasury transaction ID
 */
async function createTreasuryTransactionAsync(txRequest, params) {
    const { transNo, transDate, transType, amount, accountId, relatedType, relatedId, documentNo, description } = params;
    const sfx = Math.random().toString(36).substring(2, 9);

    txRequest.input(`tt_no_${sfx}`, sql.NVarChar, transNo);
    txRequest.input(`tt_date_${sfx}`, sql.NVarChar, transDate);
    txRequest.input(`tt_type_${sfx}`, sql.NVarChar, transType);
    txRequest.input(`tt_amt_${sfx}`, sql.Decimal(18, 2), amount);
    txRequest.input(`tt_acct_${sfx}`, sql.Int, accountId);
    txRequest.input(`tt_rtype_${sfx}`, sql.NVarChar, relatedType || null);
    txRequest.input(`tt_rid_${sfx}`, sql.Int, relatedId || null);
    txRequest.input(`tt_docno_${sfx}`, sql.NVarChar, documentNo || null);
    txRequest.input(`tt_desc_${sfx}`, sql.NVarChar, description || '');

    const ins = await txRequest.query(`
        INSERT INTO treasury_transactions (trans_no, trans_date, trans_type, amount, account_id, related_type, related_id, document_no, description)
        OUTPUT INSERTED.id
        VALUES (@tt_no_${sfx}, @tt_date_${sfx}, @tt_type_${sfx}, @tt_amt_${sfx}, @tt_acct_${sfx}, @tt_rtype_${sfx}, @tt_rid_${sfx}, @tt_docno_${sfx}, @tt_desc_${sfx})
    `);
    const ttId = ins.recordset[0].id;

    // Update treasury account balance
    const balOp = transType === 'in' ? '+' : '-';
    txRequest.input(`tt_bal_${sfx}`, sql.Decimal(18, 2), amount);
    await txRequest.query(`
        UPDATE treasury_accounts SET current_balance = current_balance ${balOp} @tt_bal_${sfx} WHERE id = @tt_acct_${sfx}
    `);

    return ttId;
}

/**
 * Reverse a treasury transaction (create offsetting entry).
 * NOTE: Journal Entry reversal must be handled by the calling module.
 * @param {object} txRequest - mssql transaction request
 * @param {number} treasuryId - treasury transaction ID
 */
async function reverseTreasuryTransactionAsync(txRequest, treasuryId) {
    const sfx = Math.random().toString(36).substring(2, 9);
    txRequest.input(`tt_id_${sfx}`, sql.Int, treasuryId);

    const orig = await txRequest.query(`SELECT * FROM treasury_transactions WHERE id = @tt_id_${sfx}`);
    if (!orig.recordset[0]) throw new Error('Treasury transaction not found');
    const t = orig.recordset[0];

    const revType = t.trans_type === 'in' ? 'out' : 'in';
    await createTreasuryTransactionAsync(txRequest, {
        transNo: `REV-${t.trans_no}`,
        transDate: new Date().toISOString().slice(0, 10),
        transType: revType,
        amount: t.amount,
        accountId: t.account_id,
        relatedType: 'reversal',
        relatedId: treasuryId,
        documentNo: t.trans_no,
        description: `عكس ${t.description || t.trans_no}`
    });
}

module.exports = { createTreasuryTransactionAsync, reverseTreasuryTransactionAsync };