import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { config } from '../config.js';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

let current: Db | null = null;

/** Opens (or creates) the SQLite DB, enables WAL + foreign keys and applies migrations. */
export function openDb(file = path.join(config.dataDir, 'app.db')): Db {
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema }) as Db;
  migrate(db, { migrationsFolder: config.migrationsDir });
  current = db;
  return db;
}

export function getDb(): Db {
  if (!current) throw new Error('Database not opened');
  return current;
}

export function setDb(db: Db): void {
  current = db;
}

export { schema };
