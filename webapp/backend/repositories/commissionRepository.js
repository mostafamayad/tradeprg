const { getPool, sql } = require('../database/mssql_db');

class CommissionRepository {

    // ─── Plans ───────────────────────────────────────────────
    async getActivePlan(companyId = null) {
        const pool = await getPool();
        const r = await pool.request()
            .input('companyId', sql.Int, companyId)
            .query(`SELECT * FROM commission_plans
                    WHERE is_active = 1
                    AND effective_from <= GETDATE()
                    AND (effective_to IS NULL OR effective_to >= GETDATE())
                    AND (company_id = @companyId OR @companyId IS NULL)
                    ORDER BY id DESC`);
        return r.recordset[0] || null;
    }

    async getTiersForPlan(planId) {
        const pool = await getPool();
        const r = await pool.request()
            .input('planId', sql.Int, planId)
            .query(`SELECT * FROM commission_tiers
                    WHERE plan_id = @planId
                    AND effective_from <= GETDATE()
                    AND (effective_to IS NULL OR effective_to >= GETDATE())
                    ORDER BY from_percent ASC`);
        return r.recordset;
    }

    async getPlanById(planId) {
        const pool = await getPool();
        const r = await pool.request()
            .input('planId', sql.Int, planId)
            .query('SELECT * FROM commission_plans WHERE id = @planId');
        return r.recordset[0] || null;
    }

    async getAllPlans(companyId = null) {
        const pool = await getPool();
        const r = await pool.request()
            .input('companyId', sql.Int, companyId)
            .query(`SELECT * FROM commission_plans
                    WHERE company_id = @companyId OR @companyId IS NULL
                    ORDER BY id DESC`);
        return r.recordset;
    }

    async createPlan(data) {
        const pool = await getPool();
        const r = await pool.request()
            .input('companyId', sql.Int, data.company_id)
            .input('planName', sql.NVarChar, data.plan_name)
            .input('baseRate', sql.Decimal(18, 4), data.base_rate)
            .input('effectiveFrom', sql.Date, data.effective_from)
            .input('effectiveTo', sql.Date, data.effective_to || null)
            .query(`INSERT INTO commission_plans (company_id, plan_name, base_rate, effective_from, effective_to, is_active)
                    VALUES (@companyId, @planName, @baseRate, @effectiveFrom, @effectiveTo, 1);
                    SELECT SCOPE_IDENTITY() AS id;`);
        return r.recordset[0].id;
    }

    async updatePlan(id, data) {
        const pool = await getPool();
        await pool.request()
            .input('id', sql.Int, id)
            .input('planName', sql.NVarChar, data.plan_name)
            .input('baseRate', sql.Decimal(18, 4), data.base_rate)
            .input('effectiveTo', sql.Date, data.effective_to || null)
            .query(`UPDATE commission_plans
                    SET plan_name = @planName, base_rate = @baseRate, effective_to = @effectiveTo
                    WHERE id = @id`);
    }

    async createTier(data) {
        const pool = await getPool();
        const r = await pool.request()
            .input('planId', sql.Int, data.plan_id)
            .input('fromPct', sql.Decimal(18, 4), data.from_percent)
            .input('toPct', sql.Decimal(18, 4), data.to_percent)
            .input('multiplier', sql.Decimal(18, 4), data.multiplier)
            .input('label', sql.NVarChar, data.tier_label)
            .input('effFrom', sql.Date, data.effective_from)
            .input('effTo', sql.Date, data.effective_to || null)
            .query(`INSERT INTO commission_tiers (plan_id, from_percent, to_percent, multiplier, tier_label, effective_from, effective_to)
                    VALUES (@planId, @fromPct, @toPct, @multiplier, @label, @effFrom, @effTo);
                    SELECT SCOPE_IDENTITY() AS id;`);
        return r.recordset[0].id;
    }

    // ─── Transactions ────────────────────────────────────────
    async createTransaction(data) {
        const pool = await getPool();
        const r = await pool.request()
            .input('companyId', sql.Int, data.company_id)
            .input('repId', sql.Int, data.rep_id)
            .input('planId', sql.Int, data.plan_id)
            .input('collectionId', sql.Int, data.collection_id)
            .input('collectionAmount', sql.Decimal(18, 4), data.collection_amount)
            .input('repName', sql.NVarChar, data.rep_name)
            .input('customerName', sql.NVarChar, data.customer_name)
            .input('invoiceNo', sql.NVarChar, data.invoice_no)
            .input('collectionNo', sql.NVarChar, data.collection_no)
            .input('invoiceDate', sql.NVarChar, data.invoice_date)
            .input('collectionDate', sql.NVarChar, data.collection_date)
            .input('period', sql.NVarChar, data.period)
            .input('baseRate', sql.Decimal(18, 4), data.base_rate)
            .input('achievementPct', sql.Decimal(18, 4), data.achievement_pct)
            .input('tierMultiplier', sql.Decimal(18, 4), data.tier_multiplier)
            .input('effectiveRate', sql.Decimal(18, 4), data.effective_rate)
            .input('commissionAmount', sql.Decimal(18, 4), data.commission_amount)
            .input('snapshot', sql.NVarChar(sql.MAX), data.snapshot)
            .input('notes', sql.NVarChar(sql.MAX), data.notes || null)
            .query(`INSERT INTO commission_transactions
                    (company_id, rep_id, plan_id, collection_id, collection_amount,
                     rep_name, customer_name, invoice_no, collection_no,
                     invoice_date, collection_date, period,
                     base_rate, achievement_pct, tier_multiplier, effective_rate,
                     commission_amount, snapshot, workflow_status, notes)
                    VALUES
                    (@companyId, @repId, @planId, @collectionId, @collectionAmount,
                     @repName, @customerName, @invoiceNo, @collectionNo,
                     @invoiceDate, @collectionDate, @period,
                     @baseRate, @achievementPct, @tierMultiplier, @effectiveRate,
                     @commissionAmount, @snapshot, 0, @notes);
                    SELECT SCOPE_IDENTITY() AS id;`);
        return r.recordset[0].id;
    }

    async updateTransactionStatus(id, status, userId = null, action = null) {
        const pool = await getPool();
        const now = new Date().toISOString();
        let query = '';
        switch (status) {
            case 1: // reviewed
                query = `UPDATE commission_transactions SET workflow_status = 1, reviewed_by = @userId, reviewed_at = GETDATE() WHERE id = @id`;
                break;
            case 2: // approved
                query = `UPDATE commission_transactions SET workflow_status = 2, approved_by = @userId, approved_at = GETDATE() WHERE id = @id`;
                break;
            case 3: // locked
                query = `UPDATE commission_transactions SET workflow_status = 3, locked_at = GETDATE() WHERE id = @id`;
                break;
            case 5: // cancelled
                query = `UPDATE commission_transactions SET workflow_status = 5 WHERE id = @id`;
                break;
            default:
                return;
        }
        await pool.request()
            .input('id', sql.Int, id)
            .input('userId', sql.Int, userId)
            .query(query);
    }

    async bulkUpdateStatus(ids, status, userId = null) {
        const pool = await getPool();
        const table = new sql.Table();
        table.create = false;
        table.columns.add('id', sql.Int, { nullable: false });
        for (const id of ids) table.rows.add(id);

        let setClause = '';
        switch (status) {
            case 2: setClause = 'workflow_status = 2, approved_by = @userId, approved_at = GETDATE()'; break;
            case 3: setClause = 'workflow_status = 3, locked_at = GETDATE()'; break;
            case 4: setClause = 'workflow_status = 4, settled_at = GETDATE()'; break;
            case 5: setClause = 'workflow_status = 5'; break;
            default: return;
        }

        await pool.request()
            .input('ids', table)
            .input('userId', sql.Int, userId)
            .query(`UPDATE commission_transactions SET ${setClause} WHERE id IN (SELECT id FROM @ids)`);
    }

    async getTransactionsByPeriod(period, companyId = null) {
        const pool = await getPool();
        const r = await pool.request()
            .input('period', sql.NVarChar, period)
            .input('companyId', sql.Int, companyId)
            .query(`SELECT ct.*, sr.rep_code
                    FROM commission_transactions ct
                    LEFT JOIN sales_reps sr ON ct.rep_id = sr.id
                    WHERE ct.period = @period
                    AND (ct.company_id = @companyId OR @companyId IS NULL)
                    ORDER BY ct.created_at DESC`);
        return r.recordset;
    }

    async getTransactionsByRep(repId, period = null, companyId = null) {
        const pool = await getPool();
        const r = await pool.request()
            .input('repId', sql.Int, repId)
            .input('period', sql.NVarChar, period)
            .input('companyId', sql.Int, companyId)
            .query(`SELECT ct.*, sr.rep_code, sr.rep_name
                    FROM commission_transactions ct
                    LEFT JOIN sales_reps sr ON ct.rep_id = sr.id
                    WHERE ct.rep_id = @repId
                    AND (@period IS NULL OR ct.period = @period)
                    AND (ct.company_id = @companyId OR @companyId IS NULL)
                    ORDER BY ct.created_at DESC`);
        return r.recordset;
    }

    async getTransactionById(id) {
        const pool = await getPool();
        const r = await pool.request()
            .input('id', sql.Int, id)
            .query(`SELECT ct.*, sr.rep_code, sr.rep_name, sr.commission_rate, sr.target_amount, sr.plan_id AS rep_plan_id
                    FROM commission_transactions ct
                    LEFT JOIN sales_reps sr ON ct.rep_id = sr.id
                    WHERE ct.id = @id`);
        return r.recordset[0] || null;
    }

    async getTransactionsByIds(ids) {
        const pool = await getPool();
        const table = new sql.Table();
        table.create = false;
        table.columns.add('id', sql.Int, { nullable: false });
        for (const id of ids) table.rows.add(id);

        const r = await pool.request()
            .input('ids', table)
            .query(`SELECT ct.*, sr.rep_code, sr.rep_name
                    FROM commission_transactions ct
                    LEFT JOIN sales_reps sr ON ct.rep_id = sr.id
                    WHERE ct.id IN (SELECT id FROM @ids)`);
        return r.recordset;
    }

    async getTransactionsForSettlement(repId, companyId = null) {
        const pool = await getPool();
        const r = await pool.request()
            .input('repId', sql.Int, repId)
            .input('companyId', sql.Int, companyId)
            .query(`SELECT ct.*, sr.rep_code, sr.rep_name
                    FROM commission_transactions ct
                    LEFT JOIN sales_reps sr ON ct.rep_id = sr.id
                    WHERE ct.rep_id = @repId
                    AND ct.workflow_status = 3
                    AND ct.is_paid = 0
                    AND (ct.company_id = @companyId OR @companyId IS NULL)
                    ORDER BY ct.period, ct.created_at`);
        return r.recordset;
    }

    // ─── Adjustments ─────────────────────────────────────────
    async createAdjustment(data) {
        const pool = await getPool();
        const r = await pool.request()
            .input('companyId', sql.Int, data.company_id)
            .input('repId', sql.Int, data.rep_id)
            .input('period', sql.NVarChar, data.period)
            .input('type', sql.NVarChar, data.type)
            .input('amount', sql.Decimal(18, 4), data.amount)
            .input('reason', sql.NVarChar(sql.MAX), data.reason)
            .input('referenceType', sql.NVarChar, data.reference_type || null)
            .input('referenceId', sql.Int, data.reference_id || null)
            .input('createdBy', sql.Int, data.created_by)
            .query(`INSERT INTO commission_adjustments
                    (company_id, rep_id, period, type, amount, reason, reference_type, reference_id, workflow_status, created_by)
                    VALUES (@companyId, @repId, @period, @type, @amount, @reason, @referenceType, @referenceId, 0, @createdBy);
                    SELECT SCOPE_IDENTITY() AS id;`);
        return r.recordset[0].id;
    }

    async updateAdjustmentStatus(id, status, userId) {
        const pool = await getPool();
        let setClause = '';
        switch (status) {
            case 2: setClause = 'workflow_status = 2, approved_by = @userId, approved_at = GETDATE()'; break;
            case 5: setClause = 'workflow_status = 5'; break;
            default: return;
        }
        await pool.request()
            .input('id', sql.Int, id)
            .input('userId', sql.Int, userId)
            .query(`UPDATE commission_adjustments SET ${setClause} WHERE id = @id`);
    }

    async getAdjustmentsByPeriod(period, companyId = null) {
        const pool = await getPool();
        const r = await pool.request()
            .input('period', sql.NVarChar, period)
            .input('companyId', sql.Int, companyId)
            .query(`SELECT ca.*, sr.rep_code, sr.rep_name
                    FROM commission_adjustments ca
                    LEFT JOIN sales_reps sr ON ca.rep_id = sr.id
                    WHERE ca.period = @period
                    AND (ca.company_id = @companyId OR @companyId IS NULL)
                    ORDER BY ca.created_at DESC`);
        return r.recordset;
    }

    async getAdjustmentsByRep(repId, companyId = null) {
        const pool = await getPool();
        const r = await pool.request()
            .input('repId', sql.Int, repId)
            .input('companyId', sql.Int, companyId)
            .query(`SELECT ca.*, sr.rep_code, sr.rep_name
                    FROM commission_adjustments ca
                    LEFT JOIN sales_reps sr ON ca.rep_id = sr.id
                    WHERE ca.rep_id = @repId
                    AND (ca.company_id = @companyId OR @companyId IS NULL)
                    ORDER BY ca.created_at DESC`);
        return r.recordset;
    }

    // ─── Payment Vouchers ────────────────────────────────────
    async createVoucher(data) {
        const pool = await getPool();
        const r = await pool.request()
            .input('companyId', sql.Int, data.company_id)
            .input('voucherNo', sql.NVarChar, data.voucher_no)
            .input('voucherDate', sql.NVarChar, data.voucher_date)
            .input('repId', sql.Int, data.rep_id)
            .input('period', sql.NVarChar, data.period)
            .input('totalAmount', sql.Decimal(18, 4), data.total_amount)
            .input('createdBy', sql.Int, data.created_by)
            .query(`INSERT INTO commission_payment_vouchers
                    (company_id, voucher_no, voucher_date, rep_id, period, total_amount, workflow_status, created_by)
                    VALUES (@companyId, @voucherNo, @voucherDate, @repId, @period, @totalAmount, 0, @createdBy);
                    SELECT SCOPE_IDENTITY() AS id;`);
        return r.recordset[0].id;
    }

    async createVoucherLine(voucherId, transactionId, amount) {
        const pool = await getPool();
        await pool.request()
            .input('voucherId', sql.Int, voucherId)
            .input('transactionId', sql.Int, transactionId)
            .input('amount', sql.Decimal(18, 4), amount)
            .query(`INSERT INTO commission_voucher_lines (voucher_id, transaction_id, amount)
                    VALUES (@voucherId, @transactionId, @amount)`);
    }

    async updateVoucherStatus(id, status, userId = null) {
        const pool = await getPool();
        let setClause = '';
        switch (status) {
            case 1: setClause = 'workflow_status = 1'; break; // submitted
            case 2: setClause = 'workflow_status = 2'; break; // approved
            case 3: setClause = 'workflow_status = 3, paid_by = @userId, paid_at = GETDATE()'; break; // paid
            case 5: setClause = 'workflow_status = 5'; break; // cancelled
            default: return;
        }
        await pool.request()
            .input('id', sql.Int, id)
            .input('userId', sql.Int, userId)
            .query(`UPDATE commission_payment_vouchers SET ${setClause} WHERE id = @id`);
    }

    async getVoucherById(id) {
        const pool = await getPool();
        const r = await pool.request()
            .input('id', sql.Int, id)
            .query(`SELECT cpv.*, sr.rep_code, sr.rep_name
                    FROM commission_payment_vouchers cpv
                    LEFT JOIN sales_reps sr ON cpv.rep_id = sr.id
                    WHERE cpv.id = @id`);
        const voucher = r.recordset[0];
        if (!voucher) return null;

        const lines = await pool.request()
            .input('voucherId', sql.Int, id)
            .query(`SELECT cvl.*, ct.period AS tx_period, ct.commission_amount AS tx_amount
                    FROM commission_voucher_lines cvl
                    JOIN commission_transactions ct ON cvl.transaction_id = ct.id
                    WHERE cvl.voucher_id = @voucherId`);
        voucher.lines = lines.recordset;
        return voucher;
    }

    async getVouchersByPeriod(period, companyId = null) {
        const pool = await getPool();
        const r = await pool.request()
            .input('period', sql.NVarChar, period)
            .input('companyId', sql.Int, companyId)
            .query(`SELECT cpv.*, sr.rep_code, sr.rep_name
                    FROM commission_payment_vouchers cpv
                    LEFT JOIN sales_reps sr ON cpv.rep_id = sr.id
                    WHERE cpv.period = @period
                    AND (cpv.company_id = @companyId OR @companyId IS NULL)
                    ORDER BY cpv.created_at DESC`);
        return r.recordset;
    }

    // ─── Period Status ───────────────────────────────────────
    async getPeriodStatus(period, companyId = null) {
        const pool = await getPool();
        const r = await pool.request()
            .input('period', sql.NVarChar, period)
            .input('companyId', sql.Int, companyId)
            .query(`SELECT * FROM commission_period_status
                    WHERE period = @period
                    AND (company_id = @companyId OR @companyId IS NULL)`);
        return r.recordset[0] || null;
    }

    async closePeriod(period, userId, companyId = null) {
        const pool = await getPool();
        const existing = await this.getPeriodStatus(period, companyId);
        if (existing) {
            await pool.request()
                .input('period', sql.NVarChar, period)
                .input('userId', sql.Int, userId)
                .input('companyId', sql.Int, companyId)
                .query(`UPDATE commission_period_status
                        SET status = 1, closed_by = @userId, closed_at = GETDATE()
                        WHERE period = @period AND (company_id = @companyId OR @companyId IS NULL)`);
        } else {
            await pool.request()
                .input('period', sql.NVarChar, period)
                .input('userId', sql.Int, userId)
                .input('companyId', sql.Int, companyId)
                .query(`INSERT INTO commission_period_status (company_id, period, status, closed_by, closed_at)
                        VALUES (@companyId, @period, 1, @userId, GETDATE())`);
        }
    }

    async openPeriod(period, companyId = null) {
        const pool = await getPool();
        await pool.request()
            .input('period', sql.NVarChar, period)
            .input('companyId', sql.Int, companyId)
            .query(`UPDATE commission_period_status
                    SET status = 0, closed_by = NULL, closed_at = NULL
                    WHERE period = @period AND (company_id = @companyId OR @companyId IS NULL)`);
    }

    // ─── Audit Log ───────────────────────────────────────────
    async logAudit(companyId, entityType, entityId, action, oldValue, newValue, performedBy) {
        const pool = await getPool();
        await pool.request()
            .input('companyId', sql.Int, companyId)
            .input('entityType', sql.NVarChar, entityType)
            .input('entityId', sql.Int, entityId)
            .input('action', sql.NVarChar, action)
            .input('oldValue', sql.NVarChar(sql.MAX), oldValue ? JSON.stringify(oldValue) : null)
            .input('newValue', sql.NVarChar(sql.MAX), newValue ? JSON.stringify(newValue) : null)
            .input('performedBy', sql.Int, performedBy)
            .query(`INSERT INTO commission_audit_log
                    (company_id, entity_type, entity_id, action, old_value, new_value, performed_by)
                    VALUES (@companyId, @entityType, @entityId, @action, @oldValue, @newValue, @performedBy)`);
    }

    async getAuditLog(entityType, entityId) {
        const pool = await getPool();
        const r = await pool.request()
            .input('entityType', sql.NVarChar, entityType)
            .input('entityId', sql.Int, entityId)
            .query(`SELECT cal.*, u.username AS performed_by_name
                    FROM commission_audit_log cal
                    LEFT JOIN users u ON cal.performed_by = u.id
                    WHERE cal.entity_type = @entityType AND cal.entity_id = @entityId
                    ORDER BY cal.performed_at DESC`);
        return r.recordset;
    }

    // ─── Rep Ledger ──────────────────────────────────────────
    async getRepLedger(repId, period, companyId = null) {
        const pool = await getPool();

        const commissions = await pool.request()
            .input('repId', sql.Int, repId)
            .input('period', sql.NVarChar, period)
            .input('companyId', sql.Int, companyId)
            .query(`SELECT commission_amount, workflow_status, period, created_at, 'commission' AS type
                    FROM commission_transactions
                    WHERE rep_id = @repId AND period = @period
                    AND (company_id = @companyId OR @companyId IS NULL)
                    AND workflow_status NOT IN (5)`);

        const adjustments = await pool.request()
            .input('repId', sql.Int, repId)
            .input('period', sql.NVarChar, period)
            .input('companyId', sql.Int, companyId)
            .query(`SELECT amount, type, period, created_at
                    FROM commission_adjustments
                    WHERE rep_id = @repId AND period = @period
                    AND (company_id = @companyId OR @companyId IS NULL)
                    AND workflow_status NOT IN (5)`);

        const payments = await pool.request()
            .input('repId', sql.Int, repId)
            .input('period', sql.NVarChar, period)
            .input('companyId', sql.Int, companyId)
            .query(`SELECT total_amount, period, paid_at, voucher_no
                    FROM commission_payment_vouchers
                    WHERE rep_id = @repId AND period = @period
                    AND (company_id = @companyId OR @companyId IS NULL)
                    AND workflow_status = 3`);

        return {
            commissions: commissions.recordset,
            adjustments: adjustments.recordset,
            payments: payments.recordset
        };
    }

    // ─── Dashboard / Summary ─────────────────────────────────
    async getCommissionSummary(period, companyId = null) {
        const pool = await getPool();
        const r = await pool.request()
            .input('period', sql.NVarChar, period)
            .input('companyId', sql.Int, companyId)
            .query(`SELECT
                        ct.rep_id,
                        sr.rep_code,
                        sr.rep_name,
                        COUNT(*) AS tx_count,
                        SUM(ct.commission_amount) AS total_commission,
                        SUM(CASE WHEN ct.workflow_status = 0 THEN ct.commission_amount ELSE 0 END) AS pending_amount,
                        SUM(CASE WHEN ct.workflow_status = 2 THEN ct.commission_amount ELSE 0 END) AS approved_amount,
                        SUM(CASE WHEN ct.workflow_status = 3 THEN ct.commission_amount ELSE 0 END) AS locked_amount,
                        SUM(CASE WHEN ct.is_posted_to_gl = 1 THEN ct.commission_amount ELSE 0 END) AS payable_amount,
                        SUM(CASE WHEN ct.is_paid = 1 THEN ct.commission_amount ELSE 0 END) AS paid_amount
                    FROM commission_transactions ct
                    LEFT JOIN sales_reps sr ON ct.rep_id = sr.id
                    WHERE ct.period = @period
                    AND (ct.company_id = @companyId OR @companyId IS NULL)
                    AND ct.workflow_status NOT IN (5)
                    GROUP BY ct.rep_id, sr.rep_code, sr.rep_name
                    ORDER BY sr.rep_name`);
        return r.recordset;
    }

    // ─── Settings ────────────────────────────────────────────
    async getSetting(key) {
        const pool = await getPool();
        const r = await pool.request()
            .input('key', sql.NVarChar, key)
            .query(`SELECT setting_value FROM settings WHERE setting_key = @key`);
        return r.recordset[0] ? r.recordset[0].setting_value : null;
    }

    // ─── Rep info ────────────────────────────────────────────
    async getRepById(repId) {
        const pool = await getPool();
        const r = await pool.request()
            .input('repId', sql.Int, repId)
            .query(`SELECT sr.*, cp.plan_name, cp.base_rate AS plan_base_rate
                    FROM sales_reps sr
                    LEFT JOIN commission_plans cp ON sr.plan_id = cp.id
                    WHERE sr.id = @repId`);
        return r.recordset[0] || null;
    }

    async getRepAchievement(repId, period) {
        const pool = await getPool();
        const r = await pool.request()
            .input('repId', sql.Int, repId)
            .input('period', sql.NVarChar, period)
            .query(`SELECT
                        ISNULL(SUM(si.grand_total), 0) AS total_sales,
                        ISNULL(SUM(sr.grand_total), 0) AS total_returns
                    FROM sales_invoices si
                    LEFT JOIN sales_returns sr ON sr.invoice_id = si.id AND sr.status = 'posted'
                    WHERE si.rep_id = @repId
                    AND FORMAT(si.invoice_date, 'yyyy-MM') = @period
                    AND si.status = 'confirmed'`);
        const row = r.recordset[0];
        return row;
    }

    // ─── Collection allocation ───────────────────────────────
    async getAllocationsForCollection(collectionId) {
        const pool = await getPool();
        const r = await pool.request()
            .input('collectionId', sql.Int, collectionId)
            .query(`SELECT ca.*, si.invoice_no, si.grand_total AS invoice_total
                    FROM collection_allocations ca
                    JOIN sales_invoices si ON ca.invoice_id = si.id
                    WHERE ca.collection_id = @collectionId`);
        return r.recordset;
    }

    // ─── Overdue check ──────────────────────────────────────
    async hasOverdueInvoices(customerId, maxDays) {
        const pool = await getPool();
        const r = await pool.request()
            .input('customerId', sql.Int, customerId)
            .input('maxDays', sql.Int, maxDays)
            .query(`SELECT COUNT(*) AS overdue_count
                    FROM sales_invoices
                    WHERE customer_id = @customerId
                    AND status = 'confirmed'
                    AND remaining > 0
                    AND DATEDIFF(DAY, invoice_date, GETDATE()) > @maxDays`);
        return r.recordset[0].overdue_count > 0;
    }

    // ─── Clawback check ─────────────────────────────────────
    async getClawbackEligible(repId, period) {
        const pool = await getPool();
        const r = await pool.request()
            .input('repId', sql.Int, repId)
            .input('period', sql.NVarChar, period)
            .query(`SELECT ct.id, ct.commission_amount, ct.effective_rate
                    FROM commission_transactions ct
                    WHERE ct.rep_id = @repId
                    AND ct.workflow_status = 5
                    AND ct.is_paid = 1
                    AND ct.period >= @period
                    AND NOT EXISTS (
                        SELECT 1 FROM commission_adjustments ca
                        WHERE ca.reference_type = 'clawback'
                        AND ca.reference_id = ct.id
                        AND ca.workflow_status != 5
                    )`);
        return r.recordset;
    }

    // ─── Aging ───────────────────────────────────────────────
    async getCommissionAging(companyId = null) {
        const pool = await getPool();
        const r = await pool.request()
            .input('companyId', sql.Int, companyId)
            .query(`SELECT
                        ct.rep_id,
                        sr.rep_name,
                        ct.workflow_status,
                        ct.commission_amount,
                        ct.created_at,
                        DATEDIFF(DAY, ct.created_at, GETDATE()) AS age_days
                    FROM commission_transactions ct
                    LEFT JOIN sales_reps sr ON ct.rep_id = sr.id
                    WHERE ct.workflow_status NOT IN (5)
                    AND (ct.company_id = @companyId OR @companyId IS NULL)
                    ORDER BY ct.created_at ASC`);
        return r.recordset;
    }

    // ─── Forecast ────────────────────────────────────────────
    async getRepMonthToDateSales(repId, period) {
        const pool = await getPool();
        const r = await pool.request()
            .input('repId', sql.Int, repId)
            .input('period', sql.NVarChar, period)
            .query(`SELECT ISNULL(SUM(grand_total), 0) AS mtd_sales
                    FROM sales_invoices
                    WHERE rep_id = @repId
                    AND FORMAT(invoice_date, 'yyyy-MM') = @period
                    AND status = 'confirmed'`);
        return r.recordset[0].mtd_sales;
    }

    async getRepMonthCollections(repId, period) {
        const pool = await getPool();
        const r = await pool.request()
            .input('repId', sql.Int, repId)
            .input('period', sql.NVarChar, period)
            .query(`SELECT ISNULL(SUM(amount), 0) AS mtd_collections
                    FROM customer_collections
                    WHERE rep_id = @repId
                    AND FORMAT(collection_date, 'yyyy-MM') = @period`);
        return r.recordset[0].mtd_collections;
    }

    // ─── Voucher number generator ────────────────────────────
    async getNextVoucherNo() {
        const pool = await getPool();
        const r = await pool.request()
            .query(`SELECT ISNULL(MAX(CAST(SUBSTRING(voucher_no, 5, LEN(voucher_no)) AS INT)), 0) + 1 AS next_no
                    FROM commission_payment_vouchers`);
        const no = r.recordset[0].next_no;
        return `CPV-${String(no).padStart(6, '0')}`;
    }
}

module.exports = new CommissionRepository();
