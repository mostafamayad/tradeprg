// ── Central Document Numbering Engine ──
// Single source of truth for generating sequential document numbers.
// Replaces duplicate nextDocNoAsync in 9+ route files.
// Must run inside an existing transaction.

const { sql } = require('../database/mssql_db');

async function nextDocNoAsync(txRequest, counterName, defaultPrefix) {
    const sfx = Math.random().toString(36).substring(2, 9);
    txRequest.input(`cn_${sfx}`, sql.NVarChar, counterName);
    const row = await txRequest.query(`
        SELECT prefix, last_number 
        FROM invoice_counters WITH (UPDLOCK) 
        WHERE counter_name = @cn_${sfx}
    `);
    if (!row.recordset[0]) {
        const prefix = defaultPrefix || counterName.toUpperCase().substring(0, 4);
        txRequest.input(`cn_ins_prefix_${sfx}`, sql.NVarChar, prefix);
        txRequest.input(`cn_ins_name_${sfx}`, sql.NVarChar, counterName);
        await txRequest.query(`
            INSERT INTO invoice_counters (counter_name, prefix, last_number) 
            VALUES (@cn_ins_name_${sfx}, @cn_ins_prefix_${sfx}, 1)
        `);
        return `${prefix}-0001`;
    }
    const next = row.recordset[0].last_number + 1;
    txRequest.input(`cn_next_${sfx}`, sql.Int, next);
    await txRequest.query(`
        UPDATE invoice_counters 
        SET last_number = @cn_next_${sfx} 
        WHERE counter_name = @cn_${sfx}
    `);
    return `${row.recordset[0].prefix}-${String(next).padStart(4, '0')}`;
}

module.exports = { nextDocNoAsync };