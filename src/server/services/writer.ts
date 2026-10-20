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

/**
 * Primary output next to the video: `<base>.<lang>.srt` (default and "both") or `<base>.srt`.
 * With "both", `<base>.srt` is written as well for TVs that only load an identically named file.
 */
export function outputPathFor(videoPath: string, targetLang: string, naming: Naming): string {
  const dir = path.dirname(videoPath);
  const base = path.basename(videoPath, path.extname(videoPath));
  return naming === 'plain'
    ? path.join(dir, `${base}.srt`)
    : path.join(dir, `${base}.${fileLanguageCode(targetLang)}.srt`);
}

/** `<base>.srt`: the name TVs (Samsung, LG, …) look for. */
export function plainPathFor(videoPath: string): string {
  return path.join(
    path.dirname(videoPath),
    `${path.basename(videoPath, path.extname(videoPath))}.srt`,
  );
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
  /** Files this job wrote before; they can always be replaced. */
  ownPaths?: string[];
}

export interface WriteResult {
  /** Primary file. */
  path: string;
  /** Every file written (primary first). */
  paths: string[];
  /** Secondary files that were not written, with the reason. */
  skipped: string[];
  encoding: string;
  fellBack: boolean;
  bytes: number;
}

const same = (a: string, b: string) =>
  path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

function writeAtomic(target: string, buffer: Buffer): void {
  const tmp = `${target}.part`;
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, target);
}

/** Renders, encodes and atomically writes the subtitle next to the video (`.part` → rename). */
export function writeSubtitleFile(o: WriteOptions): WriteResult {
  const isProtected = (p: string) => (o.protectedPaths ?? []).some((x) => same(x, p));
  const isOwn = (p: string) => (o.ownPaths ?? []).some((x) => same(x, p));
  let target = outputPathFor(o.videoPath, o.targetLang, o.naming);
  if (isProtected(target)) target = target.replace(/\.srt$/i, '.osg.srt');
  const insideVideoFolder = (p: string) =>
    path.extname(p).toLowerCase() === '.srt' && path.dirname(p) === path.dirname(o.videoPath);
  if (!insideVideoFolder(target)) throw new Error('Refusing to write outside the video folder');
  if (fs.existsSync(target) && !o.overwrite && !isOwn(target)) throw new OutputExistsError(target);

  const encoded = encodeSubtitle(renderSrt(o.cues), o.encoding, o.targetLang);
  writeAtomic(target, encoded.buffer);
  const paths = [target];
  const skipped: string[] = [];

  if (o.naming === 'both') {
    const plain = plainPathFor(o.videoPath);
    if (isProtected(plain)) {
      skipped.push(
        `${path.basename(plain)} is the subtitle used for timing, so it was not replaced`,
      );
    } else if (fs.existsSync(plain) && !o.overwrite && !isOwn(plain)) {
      skipped.push(`${path.basename(plain)} already exists; enable overwrite to replace it`);
    } else {
      writeAtomic(plain, encoded.buffer);
      paths.push(plain);
    }
  }
  return {
    path: target,
    paths,
    skipped,
    encoding: encoded.encoding,
    fellBack: encoded.fellBack,
    bytes: encoded.buffer.length,
  };
}
