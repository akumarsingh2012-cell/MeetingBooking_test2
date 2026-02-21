// scripts/reset-admin.js
// Run this to reset admin credentials:
//   node scripts/reset-admin.js
// Or with custom email/password:
//   node scripts/reset-admin.js admin@email.com newpassword

require('dotenv').config();
const Database = require('better-sqlite3');
const bcrypt   = require('bcryptjs');
const path     = require('path');
const fs       = require('fs');

const DB_PATH = process.env.DB_PATH || './data/mrb.sqlite';

if (!fs.existsSync(DB_PATH)) {
  console.error('❌ Database not found at:', DB_PATH);
  console.error('   Start the server first (npm start) to create it.');
  process.exit(1);
}

const db    = new Database(DB_PATH);
const email = process.argv[2] || process.env.ADMIN_EMAIL || 'abhishek.s@slmgbev.com';
const pass  = process.argv[3] || process.env.ADMIN_PASSWORD || 'admin@123';
const name  = 'Abhishek';

const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

if (existing) {
  const hash = bcrypt.hashSync(pass, 10);
  db.prepare("UPDATE users SET password = ?, active = 1, role = 'admin', name = ? WHERE email = ?")
    .run(hash, name, email);
  console.log('✅ Password reset for:', email);
} else {
  // Check if any admin exists and update their email
  const anyAdmin = db.prepare("SELECT * FROM users WHERE role = 'admin'").get();
  if (anyAdmin) {
    const hash = bcrypt.hashSync(pass, 10);
    db.prepare("UPDATE users SET email = ?, password = ?, name = ?, active = 1 WHERE id = ?")
      .run(email, hash, name, anyAdmin.id);
    console.log('✅ Admin updated → email:', email);
  } else {
    // Create fresh admin
    const id   = `u_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const hash = bcrypt.hashSync(pass, 10);
    db.prepare("INSERT INTO users (id, name, email, password, role, active) VALUES (?, ?, ?, ?, 'admin', 1)")
      .run(id, name, email, hash);
    console.log('✅ Admin created:', email);
  }
}

console.log('\n📋 Login credentials:');
console.log('   Email   :', email);
console.log('   Password:', pass);
console.log('\nRestart the server and login.\n');
