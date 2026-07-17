// ============================================================
// Seed Data from legacy real_data.js
// ============================================================
const fs = require('fs');
const path = require('path');
const db = require('./db');

const dataPath = path.join(__dirname, '../../frontend/js/real_data.js');

try {
    const rawContent = fs.readFileSync(dataPath, 'utf-8');
    // Simple regex to extract JSON array
    
    // We will evaluate the script safely to get the object
    let LegacyData = null;
    const sandbox = { window: {} };
    const script = new Function('window', rawContent + '\n return window.LegacyData;');
    LegacyData = script(sandbox.window);

    console.log('--- Starting Data Migration from Legacy FoxPro ---');

    // 1. Insert Customers
    if (LegacyData && LegacyData.customers) {
        let added = 0;
        const insertCust = db.prepare(`INSERT OR IGNORE INTO customers (customer_code, customer_name, customer_type, phone, opening_balance, current_balance) VALUES (?, ?, ?, ?, ?, ?)`);
        
        db.transaction(() => {
            LegacyData.customers.forEach((c, idx) => {
                const code = c.code || "C-" + String(idx+1).padStart(4, '0');
                // Extract balance if it exists in name (e.g. "Ahmed (-150)")
                let name = c.name;
                let balance = 0;
                // Just use name directly for now, we'll keep opening balance 0 until we have actual numbers
                const res = insertCust.run(code, name, 'retail', '', balance, balance);
                if (res.changes > 0) added++;
            });
        })();
        console.log(`Migrated \${added} Customers.`);
    }

    // 2. Insert Products
    if (LegacyData && LegacyData.products) {
        let added = 0;
        const insertProd = db.prepare(`INSERT OR IGNORE INTO products (product_code, product_name, category_id, sell_price, cost_price) VALUES (?, ?, ?, ?, ?)`);
        
        db.transaction(() => {
            LegacyData.products.forEach((p, idx) => {
                const code = p.code || "P-" + String(idx+1).padStart(4, '0');
                const price = parseFloat(p.price) || 0;
                const cost = price * 0.8; // Estimated cost for now
                const res = insertProd.run(code, p.name, null, price, cost);
                if (res.changes > 0) added++;
            });
        })();
        console.log(`Migrated \${added} Products.`);
    }

    console.log('--- Migration Completed Successfully ---');

} catch (e) {
    console.error('Error migrating data:', e.message);
}
