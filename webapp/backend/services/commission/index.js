const calculator = require('./calculator');
const validator = require('./validator');
const tierEngine = require('./tierEngine');
const snapshotBuilder = require('./snapshotBuilder');
const adjustmentEngine = require('./adjustmentEngine');
const settlementEngine = require('./settlementEngine');
const commissionEmitter = require('./emitter');
const repo = require('../../repositories/commissionRepository');

async function processCollectionCreated(collection) {
    try {
        const results = await calculator.calculateForCollection(collection);
        for (const txData of results) {
            const txId = await repo.createTransaction(txData);
            await repo.logAudit(
                txData.company_id,
                'commission_transaction',
                txId,
                'created',
                null,
                { rep_name: txData.rep_name, amount: txData.commission_amount, period: txData.period },
                null
            );
        }
        console.log(`[Commission] Processed collection ${collection.id}: ${results.length} transaction(s) created`);
        return results;
    } catch (err) {
        console.error(`[Commission] Error processing collection ${collection.id}:`, err.message);
        return [];
    }
}

async function processReturnPosted(returnData, repId) {
    try {
        if (!repId) {
            console.log('[Commission] Return has no rep_id, skipping clawback');
            return [];
        }

        const period = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0');
        const txs = await repo.getTransactionsByRep(repId, period);

        const relatedTxs = txs.filter(t =>
            t.invoice_no === returnData.invoice_no &&
            t.workflow_status >= 2 &&
            t.workflow_status <= 3
        );

        const results = [];
        for (const tx of relatedTxs) {
            const result = await adjustmentEngine.createClawback(tx, returnData.grand_total);
            results.push(result);
        }

        if (relatedTxs.length === 0) {
            console.log(`[Commission] No eligible transactions for clawback on return ${returnData.id}`);
        }

        return results;
    } catch (err) {
        console.error(`[Commission] Error processing return ${returnData.id}:`, err.message);
        return [];
    }
}

async function processInvoiceCancelled(invoiceId) {
    try {
        const { getPool, sql } = require('../../database/mssql_db');
        const pool = await getPool();
        const r = await pool.request()
            .input('invoiceId', sql.Int, invoiceId)
            .query(`SELECT * FROM commission_transactions WHERE invoice_id = @invoiceId AND workflow_status NOT IN (3, 5)`);

        for (const tx of r.recordset) {
            await repo.updateTransactionStatus(tx.id, 5, null, 'cancel');
            await repo.logAudit(tx.company_id, 'commission_transaction', tx.id, 'cancelled', { workflow_status: tx.workflow_status }, { workflow_status: 5 }, null);
        }

        return { cancelled: r.recordset.length };
    } catch (err) {
        console.error(`[Commission] Error cancelling commission for invoice ${invoiceId}:`, err.message);
        return [];
    }
}

commissionEmitter.on('collection.created', async (data) => {
    await processCollectionCreated(data.collection);
});

commissionEmitter.on('return.posted', async (data) => {
    await processReturnPosted(data.returnData, data.repId);
});

commissionEmitter.on('invoice.cancelled', async (data) => {
    await processInvoiceCancelled(data.invoiceId);
});

module.exports = {
    calculator,
    validator,
    tierEngine,
    snapshotBuilder,
    adjustmentEngine,
    settlementEngine,
    commissionEmitter,
    repo,
    processCollectionCreated,
    processReturnPosted,
    processInvoiceCancelled
};
