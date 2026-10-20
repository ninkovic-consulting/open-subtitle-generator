import path from 'node:path';
import { config, ensureDataDir } from '../config.js';
import { openDb } from './client.js';

ensureDataDir();
const file = path.join(config.dataDir, 'app.db');
openDb(file);
console.log(`Migrations applied to ${file}`);
