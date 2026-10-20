import path from 'node:path';
import { config, ensureDataDir } from '../../src/server/config.js';
import { openDb, type Db } from '../../src/server/db/client.js';

let counter = 0;

/** Opens a fresh migrated SQLite database inside the test data dir. */
export function freshDb(): Db {
  ensureDataDir();
  return openDb(path.join(config.dataDir, `test-${process.pid}-${counter++}.db`));
}
