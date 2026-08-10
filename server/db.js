// Local storage for sessions + per-account settings (AI key).
// Real trading data comes from MT5 via mt5_bridge.py — nothing is simulated here.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, '..', 'journal.db'));

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  account_key TEXT PRIMARY KEY,
  ai_key TEXT DEFAULT '',
  ai_base_url TEXT DEFAULT '',
  ai_model TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  account_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`);
// migrate older DBs that lack the new columns
for (const col of ['ai_base_url', 'ai_model']) {
  try { db.exec(`ALTER TABLE settings ADD COLUMN ${col} TEXT DEFAULT ''`); } catch { /* already exists */ }
}

const acctKey = (server, id) => `${server}|${id}`;

function prep(sql) {
  const stmt = db.prepare(sql);
  return {
    get: (...a) => stmt.get(...a),
    all: (...a) => stmt.all(...a),
    run: (...a) => stmt.run(...a),
  };
}

const stmts = {
  createSession: prep('INSERT INTO sessions (token, account_key, created_at) VALUES (?, ?, ?)'),
  getSession: prep('SELECT * FROM sessions WHERE token = ?'),
  deleteSession: prep('DELETE FROM sessions WHERE token = ?'),
  setAiSettings: prep(`INSERT INTO settings (account_key, ai_key, ai_base_url, ai_model) VALUES (?, ?, ?, ?)
    ON CONFLICT(account_key) DO UPDATE SET ai_key = excluded.ai_key, ai_base_url = excluded.ai_base_url, ai_model = excluded.ai_model`),
  getAccountByKey: prep('SELECT account_key, ai_key, ai_base_url, ai_model FROM settings WHERE account_key = ?'),
};

module.exports = { db, stmts, acctKey };
