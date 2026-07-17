const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');

const db = new DatabaseSync('database/tradeprodb.sqlite');

const tables = db.prepare(`SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all();

let report = `# TradePro ERP - SQLite Database Analysis Report\n\n`;

for (const table of tables) {
    report += `## Table: ${table.name}\n`;
    
    // Columns
    const columns = db.prepare(`PRAGMA table_info(${table.name})`).all();
    report += `### Columns\n`;
    report += `| Name | Type | PK | Not Null | Default |\n`;
    report += `|---|---|---|---|---|\n`;
    for (const col of columns) {
        report += `| ${col.name} | ${col.type} | ${col.pk ? 'Yes' : 'No'} | ${col.notnull ? 'Yes' : 'No'} | ${col.dflt_value || 'None'} |\n`;
    }
    
    // Foreign Keys
    const fks = db.prepare(`PRAGMA foreign_key_list(${table.name})`).all();
    if (fks.length > 0) {
        report += `\n### Foreign Keys\n`;
        report += `| From Column | To Table | To Column | On Update | On Delete |\n`;
        report += `|---|---|---|---|---|\n`;
        for (const fk of fks) {
            report += `| ${fk.from} | ${fk.table} | ${fk.to} | ${fk.on_update} | ${fk.on_delete} |\n`;
        }
    }
    
    // Indexes
    const indexes = db.prepare(`PRAGMA index_list(${table.name})`).all();
    if (indexes.length > 0) {
        report += `\n### Indexes\n`;
        report += `| Name | Unique | Origin |\n`;
        report += `|---|---|---|\n`;
        for (const idx of indexes) {
            report += `| ${idx.name} | ${idx.unique ? 'Yes' : 'No'} | ${idx.origin} |\n`;
        }
    }
    
    report += `\n### Auto-Increment / Primary Key Note\n`;
    if (table.sql && table.sql.includes('AUTOINCREMENT')) {
        report += `- Uses AUTOINCREMENT for primary key.\n`;
    } else {
        report += `- Does NOT use AUTOINCREMENT explicitly in CREATE TABLE (may rely on standard rowid).\n`;
    }
    
    report += `\n---\n\n`;
}

// Triggers
const triggers = db.prepare(`SELECT name, tbl_name, sql FROM sqlite_master WHERE type='trigger'`).all();
if (triggers.length > 0) {
    report += `## Triggers\n`;
    for (const trigger of triggers) {
        report += `### Trigger: ${trigger.name} (on ${trigger.tbl_name})\n`;
        report += "```sql\n" + trigger.sql + "\n```\n\n";
    }
} else {
    report += `## Triggers\nNo triggers found in the database.\n\n`;
}

fs.writeFileSync('C:/Users/ayad/.gemini/antigravity/brain/27544352-a178-456f-b80e-7ce6035430ab/sqlite_analysis_report.md', report);
console.log('Report generated successfully.');
