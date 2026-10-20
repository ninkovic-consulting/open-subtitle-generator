import fs from 'node:fs';
import path from 'node:path';
import { fileLanguageCode } from '../../shared/languages.js';
import type { Naming, OutputEncoding } from '../../shared/types.js';
import { encodeSubtitle, renderSrt, type SrtCue } from './srt.js';

export class OutputExistsError extends Error {
  constructor(readonly outputPath: string) {
    super(
      `Subtitle already exists: ${outputPath}. Enable "Overwrite existing subtitles" to replace it.`,
    );
    this.name = 'OutputExistsError';
  }
}

/** `<dir>/<base>.<lang>.srt` (default) or `<dir>/<base>.srt`, always next to the video. */
export function outputPathFor(videoPath: string, targetLang: string, naming: Naming): string {
  const dir = path.dirname(videoPath);
  const base = path.basename(videoPath, path.extname(videoPath));
  return naming === 'plain'
    ? path.join(dir, `${base}.srt`)
    : path.join(dir, `${base}.${fileLanguageCode(targetLang)}.srt`);
}

export interface WriteOptions {
  videoPath: string;
  cues: SrtCue[];
  targetLang: string;
  encoding: OutputEncoding;
  naming: Naming;
  overwrite: boolean;
  /** Files that must never be overwritten (e.g. the subtitle used as timing source). */
  protectedPaths?: string[];
}

export interface WriteResult {
  path: string;
  encoding: string;
  fellBack: boolean;
  bytes: number;
}

/** Renders, encodes and atomically writes the subtitle next to the video (`.part` → rename). */
export function writeSubtitleFile(o: WriteOptions): WriteResult {
  let target = outputPathFor(o.videoPath, o.targetLang, o.naming);
  const protectedSet = new Set((o.protectedPaths ?? []).map((p) => path.resolve(p).toLowerCase()));
  if (protectedSet.has(path.resolve(target).toLowerCase())) {
    target = target.replace(/\.srt$/i, '.osg.srt');
  }
  if (
    path.extname(target).toLowerCase() !== '.srt' ||
    path.dirname(target) !== path.dirname(o.videoPath)
  ) {
    throw new Error('Refusing to write outside the video folder');
  }
  if (fs.existsSync(target) && !o.overwrite) throw new OutputExistsError(target);
  const encoded = encodeSubtitle(renderSrt(o.cues), o.encoding, o.targetLang);
  const tmp = `${target}.part`;
  fs.writeFileSync(tmp, encoded.buffer);
  fs.renameSync(tmp, target);
  return {
    path: target,
    encoding: encoded.encoding,
    fellBack: encoded.fellBack,
    bytes: encoded.buffer.length,
  };
}
