// sql.js (SQLite compiled to WASM): pure JS, no native build on Termux.
import initSqlJs from 'sql.js';
import { MIGRATIONS } from '../shared/migrations.js';

let sqlPromise;
const loadSql = () => (sqlPromise ??= initSqlJs());

export async function openDatabase(bytes) {
  const SQL = await loadSql();
  const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');
  return db;
}

// Returns the number of migrations applied.
export function migrate(db, migrations = MIGRATIONS) {
  db.run('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const current = db.exec('SELECT COALESCE(MAX(version), 0) FROM schema_migrations')[0].values[0][0];
  let applied = 0;
  for (const m of migrations.filter(x => x.version > current).sort((a, b) => a.version - b.version)) {
    db.run('BEGIN');
    try {
      db.run(m.sql);
      db.run('INSERT INTO schema_migrations VALUES (?, ?, ?)', [m.version, m.name, new Date().toISOString()]);
      db.run('COMMIT');
      applied++;
    } catch (e) {
      db.run('ROLLBACK');
      throw new Error(`migration ${m.version} failed: ${e.message}`);
    }
  }
  return applied;
}

export function schemaVersion(db) {
  return db.exec('SELECT COALESCE(MAX(version), 0) FROM schema_migrations')[0].values[0][0];
}
