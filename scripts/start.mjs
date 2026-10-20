// `npm start`: builds the app when the build is missing or older than the sources, then runs it.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverEntry = path.join(root, 'dist', 'node', 'server', 'index.js');
const webIndex = path.join(root, 'dist', 'web', 'index.html');

function newestMtime(dir) {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestMtime(full));
    else newest = Math.max(newest, fs.statSync(full).mtimeMs);
  }
  return newest;
}

const builtAt =
  fs.existsSync(serverEntry) && fs.existsSync(webIndex)
    ? Math.min(fs.statSync(serverEntry).mtimeMs, fs.statSync(webIndex).mtimeMs)
    : 0;
const sourceAt = Math.max(
  newestMtime(path.join(root, 'src')),
  fs.statSync(path.join(root, 'package.json')).mtimeMs,
);

if (builtAt < sourceAt) {
  console.log('Building OSG (first run or sources changed)…');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const res = spawnSync(npm, ['run', 'build'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

const child = spawnSync(process.execPath, [serverEntry, ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(child.status ?? 0);
