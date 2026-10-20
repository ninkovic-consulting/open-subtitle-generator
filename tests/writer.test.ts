import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeSubtitleFile } from '../src/server/services/writer.js';
import { tempDir } from './helpers/fixtures.js';

const cues = [{ startMs: 0, endMs: 1500, text: 'Bok, Đuro!' }];

function setup() {
  const dir = tempDir();
  const video = path.join(dir, 'Show.S01E01.mkv');
  fs.writeFileSync(video, '');
  return { dir, video };
}

describe('writeSubtitleFile naming', () => {
  it('"both" writes Episode.hr.srt and the TV name Episode.srt with identical content', () => {
    const { dir, video } = setup();
    const r = writeSubtitleFile({
      videoPath: video,
      cues,
      targetLang: 'hr',
      encoding: 'utf8-bom',
      naming: 'both',
      overwrite: false,
    });
    expect(r.paths.map((p) => path.basename(p))).toEqual(['Show.S01E01.hr.srt', 'Show.S01E01.srt']);
    expect(fs.readFileSync(path.join(dir, 'Show.S01E01.srt'))).toEqual(
      fs.readFileSync(path.join(dir, 'Show.S01E01.hr.srt')),
    );
    expect(r.skipped).toEqual([]);
  });

  it('never replaces the subtitle used for timing', () => {
    const { dir, video } = setup();
    const source = path.join(dir, 'Show.S01E01.srt');
    fs.writeFileSync(source, 'english original');
    const r = writeSubtitleFile({
      videoPath: video,
      cues,
      targetLang: 'hr',
      encoding: 'utf8-bom',
      naming: 'both',
      overwrite: true,
      protectedPaths: [source],
    });
    expect(r.paths).toHaveLength(1);
    expect(r.skipped[0]).toContain('used for timing');
    expect(fs.readFileSync(source, 'utf8')).toBe('english original');
  });

  it('keeps an existing Episode.srt unless overwrite is on or OSG wrote it', () => {
    const { dir, video } = setup();
    const plain = path.join(dir, 'Show.S01E01.srt');
    fs.writeFileSync(plain, 'someone else');
    const first = writeSubtitleFile({
      videoPath: video,
      cues,
      targetLang: 'hr',
      encoding: 'utf8',
      naming: 'both',
      overwrite: false,
    });
    expect(first.skipped[0]).toContain('already exists');
    expect(fs.readFileSync(plain, 'utf8')).toBe('someone else');
    const own = writeSubtitleFile({
      videoPath: video,
      cues,
      targetLang: 'hr',
      encoding: 'utf8',
      naming: 'both',
      overwrite: false,
      ownPaths: [first.path, plain],
    });
    expect(own.paths).toHaveLength(2);
    expect(fs.readFileSync(plain, 'utf8')).toContain('Đuro');
  });
});
