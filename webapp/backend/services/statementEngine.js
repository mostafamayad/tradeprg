const sql = require('mssql');
const { getPool } = require('../database/mssql_db');

class StatementEngine {
    constructor(config) {
        this.entityTable = config.entityTable;
        this.entityIdColumn = config.entityIdColumn;
        this.entityLabelColumn = config.entityLabelColumn;
        this.entityCodeColumn = config.entityCodeColumn;
        this.sources = config.sources;
    }

    async generate(entityId, params = {}) {
        const pool = await getPool();
        const { from, to, page, limit } = params;

        const entityReq = pool.request().input('id', sql.Int, entityId);
        const entityRes = await entityReq.query(
            `SELECT * FROM ${this.entityTable} WHERE ${this.entityIdColumn} = @id`
        );
        const entity = entityRes.recordset[0];
        if (!entity) return { notFound: true };

        const openingBalance = from ? await this._openingBalance(pool, entityId, from) : 0;

        let allRows = [];
        for (const src of this.sources) {
            const rows = await src.query(pool, entityId, from, to);
            allRows = allRows.concat(rows);
        }

        allRows.sort((a, b) => {
            const dA = a.trans_date || '';
            const dB = b.trans_date || '';
            if (dA !== dB) return dA < dB ? -1 : 1;
            return (a._sort || 0) - (b._sort || 0);
        });

        let running = openingBalance;
        const movements = allRows.map(r => {
            const debit = parseFloat(r.debit) || 0;
            const credit = parseFloat(r.credit) || 0;
            running += debit - credit;
            return {
                trans_date: r.trans_date ? String(r.trans_date).slice(0, 10) : '',
                doc_no: r.doc_no || '',
                doc_type_label: r.doc_type_label || '',
                movement_type: r.movement_type || '',
                partner_name: r.partner_name || '',
                notes: r.notes || '',
                debit,
                credit,
                balance: Math.round(running * 100) / 100,
                ref_id: r.ref_id
            };
        });

        const summary = this._summary(movements, entity);

        let paginatedMovements = movements;
        let pagination = null;
        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.max(0, parseInt(limit) || 0);
        if (limitNum > 0 && limitNum <= 200) {
            const total = movements.length;
            const pages = Math.ceil(total / limitNum);
            const start = (pageNum - 1) * limitNum;
            paginatedMovements = movements.slice(start, start + limitNum);
            pagination = { page: pageNum, limit: limitNum, total, pages };
        }

        return {
            entity: {
                id: entity[this.entityIdColumn],
                name: entity[this.entityLabelColumn],
                code: entity[this.entityCodeColumn]
            },
            openingBalance,
            movements: paginatedMovements,
            summary: { ...summary, openingBalance },
            pagination
        };
    }

    async _openingBalance(pool, entityId, beforeDate) {
        let totalDebit = 0;
        let totalCredit = 0;

        for (const src of this.sources) {
            if (typeof src.openingBalance === 'function') {
                const bal = await src.openingBalance(pool, entityId, beforeDate);
                totalDebit += bal.debit || 0;
                totalCredit += bal.credit || 0;
            }
        }

        return Math.round((totalDebit - totalCredit) * 100) / 100;
    }

    _summary(movements, entity) {
        let totalSales = 0;
        let totalCollections = 0;
        let totalReturns = 0;

        for (const m of movements) {
            switch (m.movement_type) {
                case 'sales':
                    totalSales += m.debit;
                    break;
                case 'collection':
                    totalCollections += m.credit;
                    break;
                case 'return':
                    totalReturns += m.credit;
                    break;
            }
        }

        const netSales = Math.round((totalSales - totalReturns) * 100) / 100;
        const commission = Math.round((netSales * (parseFloat(entity.commission_rate) || 0) / 100) * 100) / 100;
        const lastBalance = movements.length > 0 ? movements[movements.length - 1].balance : 0;

        return {
            totalSales: Math.round(totalSales * 100) / 100,
            totalCollections: Math.round(totalCollections * 100) / 100,
            totalReturns: Math.round(totalReturns * 100) / 100,
            netSales,
            commission,
            commissionRate: parseFloat(entity.commission_rate) || 0,
            finalBalance: lastBalance,
            netPosition: Math.round((lastBalance - commission) * 100) / 100
        };
    }
}

module.exports = StatementEngine;
