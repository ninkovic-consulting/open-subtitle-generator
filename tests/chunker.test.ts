import { describe, expect, it } from 'vitest';
import { planChunks } from '../src/server/services/chunker.js';
import { parseSilences } from '../src/server/services/media.js';

describe('parseSilences', () => {
  it('reads silencedetect output', () => {
    const stderr = `[silencedetect @ 0x1] silence_start: 12.5\n[silencedetect @ 0x1] silence_end: 13.4 | silence_duration: 0.9\n[silencedetect @ 0x1] silence_start: -0.01\n[silencedetect @ 0x1] silence_end: 0.6 | silence_duration: 0.6`;
    expect(parseSilences(stderr)).toEqual([
      { start: 12.5, end: 13.4 },
      { start: 0, end: 0.6 },
    ]);
  });
});

describe('planChunks', () => {
  it('returns one chunk for short audio', () => {
    expect(planChunks(300, [])).toEqual([{ index: 0, start: 0, end: 300 }]);
  });
  it('cuts at the silence midpoint nearest each target', () => {
    const chunks = planChunks(2700, [
      { start: 580, end: 582 },
      { start: 640, end: 641 },
      { start: 1195, end: 1205 },
    ]);
    expect(chunks[0]).toEqual({ index: 0, start: 0, end: 581 });
    expect(chunks[1]!.end).toBe(1200);
    expect(chunks.at(-1)!.end).toBe(2700);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i]!.start).toBe(chunks[i - 1]!.end);
  });
  it('hard-cuts when no silence is near', () => {
    const chunks = planChunks(1500, [{ start: 100, end: 101 }]);
    expect(chunks[0]!.end).toBe(600);
  });
  it('does not leave a tiny final chunk', () => {
    const chunks = planChunks(640, []);
    expect(chunks).toHaveLength(1);
  });
});

describe('findSidecars', () => {
  it('finds language-suffixed subtitles and ignores video extensions as languages', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { findSidecars } = await import('../src/server/services/media.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osg-side-'));
    for (const n of [
      'Ep.mkv',
      'Ep.srt',
      'Ep.en.srt',
      'Ep.eng.forced.srt',
      'Ep.mkv.srt',
      'Other.srt',
    ])
      fs.writeFileSync(path.join(dir, n), '');
    const found = findSidecars(path.join(dir, 'Ep.mkv'))
      .map((s) => [path.basename(s.path), s.language])
      .sort();
    expect(found).toEqual([
      ['Ep.en.srt', 'en'],
      ['Ep.eng.forced.srt', 'en'],
      ['Ep.mkv.srt', null],
      ['Ep.srt', null],
    ]);
  });
});
