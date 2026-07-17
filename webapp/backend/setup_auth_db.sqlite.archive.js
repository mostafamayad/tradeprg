const db = require('./database/db');
const bcrypt = require('bcryptjs');

try {
    // 1. Add permissions column if it doesn't exist
    try {
        db.prepare('ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT "[]"').run();
        console.log("Added 'permissions' column to users table.");
    } catch (e) {
        if (e.message.includes('duplicate column name')) {
            console.log("'permissions' column already exists.");
        } else {
            console.error("Error adding column:", e);
        }
    }

    // 2. Check for default admin user
    const admin = db.prepare('SELECT * FROM users WHERE username = ?').get('admin@3smcompany.com');
    if (!admin) {
        const passwordHash = bcrypt.hashSync('admin123', 10);
        // Default permissions: all main views. We can define an empty array or '*' for all. 
        // Let's use '["*"]' to denote all access.
        db.prepare(`
            INSERT INTO users (username, password_hash, full_name, role, permissions) 
            VALUES (?, ?, ?, ?, ?)
        `).run('admin@3smcompany.com', passwordHash, 'مدير النظام', 'admin', JSON.stringify(['*']));
        console.log("Created default admin user: admin@3smcompany.com / admin123");
    } else {
        console.log("Default admin user already exists.");
        // Make sure admin has all permissions
        db.prepare('UPDATE users SET permissions = ? WHERE username = ?').run(JSON.stringify(['*']), 'admin@3smcompany.com');
    }

} catch (err) {
    console.error("Database setup failed:", err);
}
