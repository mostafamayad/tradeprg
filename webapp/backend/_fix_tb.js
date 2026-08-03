const fs = require('fs');
let code = fs.readFileSync('routes/accounting.js', 'utf8').replace(/\r\n/g, '\n');

const trialOld = `        const { from, to, accountType, includeZero } = req.query;
        const pool = await getPool();
        const request = pool.request();

        let openingWhere = ' WHERE 1=0';  // No opening balance without a "from" cutoff
        let periodWhere = ' WHERE 1=1';

        if (from) {
            openingWhere = ' WHERE j.entry_date < @from';
            periodWhere += ' AND j.entry_date >= @from';
            request.input('from', sql.NVarChar, from);
        }
        if (to) {
            periodWhere += ' AND j.entry_date <= @to';
            request.input('to', sql.NVarChar, to);
        }

        const accTypeFilter = accountType ? ' AND a.account_type = @accType' : '';
        if (accountType) request.input('accType', sql.NVarChar, accountType);

        const zeroFilter = includeZero === 'false' || includeZero === '0'
            ? ' AND (ISNULL(o.opening_debit, 0) + ISNULL(o.opening_credit, 0) + ISNULL(p.period_debit, 0) + ISNULL(p.period_credit, 0) <> 0)'
            : '';`.replace(/\r\n/g, '\n');

const trialNew = `        const { from, to, accountType, includeZero, show_zero_balances } = req.query;
        const pool = await getPool();
        const request = pool.request();

        let openingWhere = ' WHERE 1=0';  // No opening balance without a "from" cutoff
        let periodWhere = ' WHERE 1=1';

        if (from) {
            openingWhere = ' WHERE j.entry_date < @from AND (j.is_reversed = 0 OR j.is_reversed IS NULL)';
            periodWhere += ' AND (j.is_reversed = 0 OR j.is_reversed IS NULL) AND j.entry_date >= @from';
            request.input('from', sql.NVarChar, from);
        } else {
            periodWhere += ' AND (j.is_reversed = 0 OR j.is_reversed IS NULL)';
        }
        
        if (to) {
            periodWhere += ' AND j.entry_date <= @to';
            request.input('to', sql.NVarChar, to);
        }

        const accTypeFilter = accountType ? ' AND a.account_type = @accType' : '';
        if (accountType) request.input('accType', sql.NVarChar, accountType);

        const showZero = includeZero === 'true' || includeZero === '1' || show_zero_balances === 'true' || show_zero_balances === '1';
        const zeroFilter = !showZero
            ? ' AND (ISNULL(o.opening_debit, 0) + ISNULL(o.opening_credit, 0) + ISNULL(p.period_debit, 0) + ISNULL(p.period_credit, 0) <> 0)'
            : '';`.replace(/\r\n/g, '\n');

if (code.includes(trialOld)) {
    code = code.replace(trialOld, trialNew);
    fs.writeFileSync('routes/accounting.js', code);
    console.log("TRIAL BALANCE SUCCESS");
} else {
    console.log("TRIAL BALANCE NOT FOUND");
}
