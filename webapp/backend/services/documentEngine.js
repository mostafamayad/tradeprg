// ── Central Document Numbering Engine ──
// Single source of truth for generating sequential document numbers.
// Replaces duplicate nextDocNoAsync in 9+ route files.
// Must run inside an existing transaction.

const { sql } = require('../database/mssql_db');

async function nextDocNoAsync(txRequest, counterName, defaultPrefix) {
    const sfx = Math.random().toString(36).substring(2, 9);
    txRequest.input(`cn_${sfx}`, sql.NVarChar, counterName);

    // Single atomic UPDATE+OUTPUT eliminates separate SELECT+UPDATE round-trips.
    const upd = await txRequest.query(`
        UPDATE invoice_counters
        SET last_number = last_number + 1
        OUTPUT INSERTED.prefix, INSERTED.last_number
        WHERE counter_name = @cn_${sfx}
    `);
    if (upd.recordset[0]) {
        const prefix = upd.recordset[0].prefix;
        const next = upd.recordset[0].last_number;
        return `${prefix}-${String(next).padStart(4, '0')}`;
    }
    // First use — insert and return 0001
    const prefix = defaultPrefix || counterName.toUpperCase().substring(0, 4);
    txRequest.input(`cn_ins_prefix_${sfx}`, sql.NVarChar, prefix);
    await txRequest.query(`
        INSERT INTO invoice_counters (counter_name, prefix, last_number)
        VALUES (@cn_${sfx}, @cn_ins_prefix_${sfx}, 1)
    `);
    return `${prefix}-0001`;
}

module.exports = { nextDocNoAsync };