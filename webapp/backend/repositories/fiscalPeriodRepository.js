const { getPool, sql } = require('../database/mssql_db');

async function getAll() {
    const pool = await getPool();
    const r = await pool.request().query(`
        SELECT fp.*, u1.full_name AS opened_by_name, u2.full_name AS closed_by_name
        FROM fiscal_periods fp
        LEFT JOIN users u1 ON u1.id = fp.opened_by
        LEFT JOIN users u2 ON u2.id = fp.closed_by
        ORDER BY fp.start_date DESC
    `);
    return r.recordset;
}

async function getById(id) {
    const pool = await getPool();
    const r = await pool.request()
        .input('id', sql.Int, id)
        .query(`
            SELECT fp.*, u1.full_name AS opened_by_name, u2.full_name AS closed_by_name
            FROM fiscal_periods fp
            LEFT JOIN users u1 ON u1.id = fp.opened_by
            LEFT JOIN users u2 ON u2.id = fp.closed_by
            WHERE fp.id = @id
        `);
    return r.recordset[0] || null;
}

async function getActive() {
    const pool = await getPool();
    const r = await pool.request().query(`
        SELECT TOP 1 fp.*, u1.full_name AS opened_by_name, u2.full_name AS closed_by_name
        FROM fiscal_periods fp
        LEFT JOIN users u1 ON u1.id = fp.opened_by
        LEFT JOIN users u2 ON u2.id = fp.closed_by
        WHERE fp.status = 'open'
        ORDER BY fp.start_date DESC
    `);
    return r.recordset[0] || null;
}

async function create({ name, startDate, endDate, userId }) {
    const pool = await getPool();
    const r = await pool.request()
        .input('name', sql.NVarChar(100), name)
        .input('startDate', sql.Date, startDate)
        .input('endDate', sql.Date, endDate)
        .input('openedBy', sql.Int, userId)
        .query(`
            INSERT INTO fiscal_periods (name, start_date, end_date, status, opened_by)
            OUTPUT INSERTED.*
            VALUES (@name, @startDate, @endDate, 'open', @openedBy)
        `);
    return r.recordset[0];
}

async function close(id, userId) {
    const pool = await getPool();
    const r = await pool.request()
        .input('id', sql.Int, id)
        .input('closedBy', sql.Int, userId)
        .query(`
            UPDATE fiscal_periods
            SET status = 'closed', closed_by = @closedBy, closed_at = GETDATE()
            OUTPUT INSERTED.*
            WHERE id = @id AND status = 'open'
        `);
    return r.recordset[0] || null;
}

async function open(id, userId) {
    const pool = await getPool();
    const target = await getById(id);
    if (!target) return null;
    if (target.status === 'open') return target;

    const active = await getActive();
    if (active) {
        await pool.request()
            .input('activeId', sql.Int, active.id)
            .input('closedBy', sql.Int, userId)
            .query(`
                UPDATE fiscal_periods
                SET status = 'closed', closed_by = @closedBy, closed_at = GETDATE()
                WHERE id = @activeId AND status = 'open'
            `);
    }

    const r = await pool.request()
        .input('id', sql.Int, id)
        .input('openedBy', sql.Int, userId)
        .query(`
            UPDATE fiscal_periods
            SET status = 'open', opened_by = @openedBy, opened_at = GETDATE(), closed_by = NULL, closed_at = NULL
            OUTPUT INSERTED.*
            WHERE id = @id AND status = 'closed'
        `);
    return r.recordset[0] || null;
}

async function isDateInClosedPeriod(dateStr) {
    const pool = await getPool();
    const r = await pool.request()
        .input('date', sql.Date, dateStr)
        .query(`
            SELECT COUNT(*) AS cnt FROM fiscal_periods
            WHERE status = 'closed' AND @date BETWEEN start_date AND end_date
        `);
    return r.recordset[0].cnt > 0;
}

async function getPeriodForDate(dateStr) {
    const pool = await getPool();
    const r = await pool.request()
        .input('date', sql.Date, dateStr)
        .query(`
            SELECT * FROM fiscal_periods
            WHERE @date BETWEEN start_date AND end_date
        `);
    return r.recordset[0] || null;
}

module.exports = { getAll, getById, getActive, create, close, open, isDateInClosedPeriod, getPeriodForDate };
