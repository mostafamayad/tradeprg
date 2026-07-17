const { execSync } = require('child_process');
const fs = require('fs');

const tables = execSync('sqlcmd -S localhost -d TradePro -Q "SELECT name FROM sys.tables WHERE name NOT NOT IN (\'sysdiagrams\') ORDER BY name" -h -1 -W', { encoding: 'utf8' })
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('-') && l !== '');

console.log('Found', tables.length, 'tables');

let dump = '';
let totalRows = 0;

for (const tbl of tables) {
    try {
        const rows = execSync(`sqlcmd -S localhost -d TradePro -Q "SELECT * FROM [${tbl}]" -s "|||" -W -h -1 -b`, { encoding: 'utf8', timeout: 30000 });
        const lines = rows.split('\n').filter(l => l.trim());
        if (lines.length === 0) {
            console.log(`  ${tbl}: 0 rows`);
            continue;
        }

        const cols = execSync(`sqlcmd -S localhost -d TradePro -Q "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='${tbl}' ORDER BY ORDINAL_POSITION" -h -1 -W`, { encoding: 'utf8' })
            .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('-'));

        for (const line of lines) {
            const vals = line.split('|||').map(v => v.trim());
            const colList = cols.map(c => '[' + c + ']').join(', ');
            const valList = vals.map(v => {
                if (v === '' || v === 'NULL') return 'NULL';
                if (!isNaN(v) && v !== '') return v;
                return "N'" + v.replace(/'/g, "''") + "'";
            }).join(', ');
            dump += `INSERT INTO [${tbl}] (${colList}) VALUES (${valList});\n`;
        }
        console.log(`  ${tbl}: ${lines.length} rows`);
        totalRows += lines.length;
    } catch (e) {
        console.log(`  ${tbl}: ERROR - ${e.message.substring(0, 80)}`);
    }
}

fs.writeFileSync('dump.sql', dump, 'utf8');
console.log(`\nDone! ${totalRows} rows exported to dump.sql`);
