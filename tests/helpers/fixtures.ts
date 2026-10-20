import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FFMPEG, run } from '../../src/server/services/media.js';

/**
 * Generates a small test video: `seconds` long, a 440 Hz tone for 4 s then 2 s of silence, repeating.
 * With `embeddedSrt`, an English subtitle track is muxed in (MKV).
 */
export async function makeVideo(
  dir: string,
  name: string,
  opts: { seconds?: number; embeddedSrt?: string } = {},
): Promise<string> {
  fs.mkdirSync(dir, { recursive: true });
  const seconds = opts.seconds ?? 30;
  const out = path.join(dir, name);
  const args = [
    '-nostdin',
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    `color=c=0x1b2130:s=160x90:r=10:d=${seconds}`,
    '-f',
    'lavfi',
    '-i',
    `aevalsrc='if(lt(mod(t\\,6)\\,4)\\,0.5*sin(2*PI*440*t)\\,0)':s=16000:d=${seconds}`,
  ];
  if (opts.embeddedSrt) {
    const srt = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'osg-srt-')), 'embedded.srt');
    fs.writeFileSync(srt, opts.embeddedSrt);
    args.push(
      '-i',
      srt,
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-map',
      '2:s',
      '-c:s',
      'srt',
      '-metadata:s:s:0',
      'language=eng',
    );
  } else {
    args.push('-map', '0:v', '-map', '1:a');
  }
  args.push(
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '64k',
    '-shortest',
    out,
  );
  await run(FFMPEG, args);
  return out;
}

export function tempDir(prefix = 'osg-fixture-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
