import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Every test file gets its own data dir and never reads the developer's .env / real API key.
process.env.OSG_SKIP_DOTENV = '1';
process.env.OPENROUTER_API_KEY = '';
process.env.OPEN_ROUTER_API = '';
process.env.LOG_LEVEL = 'silent';
process.env.OSG_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'osg-test-'));
