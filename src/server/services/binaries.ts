import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';

/**
 * ffmpeg-static normally downloads its binary in an install script. OSG installs dependencies
 * without running scripts (see .npmrc), so the download happens here, once, on first start.
 */
export async function ensureFfmpeg(log: (msg: string) => void = () => undefined): Promise<void> {
  if (process.env.FFMPEG_PATH) return;
  const target = ffmpegStatic as unknown as string | null;
  // No bundled build for this platform: rely on an ffmpeg on PATH.
  if (!target || fs.existsSync(target)) return;
  const pkgDir = path.dirname(createRequire(import.meta.url).resolve('ffmpeg-static/package.json'));
  log('Downloading ffmpeg (first start only)…');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['install.js'], { cwd: pkgDir, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 && fs.existsSync(target)
        ? resolve()
        : reject(
            new Error(
              `Could not download ffmpeg (exit code ${code}). Check your network or proxy, or set FFMPEG_PATH to an existing ffmpeg binary.`,
            ),
          ),
    );
  });
}
