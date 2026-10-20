import iconv from 'iconv-lite';
import { describe, expect, it } from 'vitest';
import {
  decodeSubtitle,
  encodeSubtitle,
  formatTimestamp,
  normalizeText,
  parseSrt,
  parseTimestamp,
  renderSrt,
  stripAssTags,
  wrapText,
} from '../src/server/services/srt.js';

describe('timestamps', () => {
  it('parses SRT, dot and short forms', () => {
    expect(parseTimestamp('00:01:02,345')).toBe(62_345);
    expect(parseTimestamp('01:02:03.5')).toBe(3_723_500);
    expect(parseTimestamp('02:03')).toBe(123_000);
    expect(Number.isNaN(parseTimestamp('nope'))).toBe(true);
  });
  it('formats and round-trips', () => {
    expect(formatTimestamp(3_723_456)).toBe('01:02:03,456');
    expect(formatTimestamp(-5)).toBe('00:00:00,000');
    expect(parseTimestamp(formatTimestamp(987_654))).toBe(987_654);
  });
});

describe('normalizeText', () => {
  it('NFC-normalises combining carons into single code points', () => {
    const decomposed = 'č' + 'ž'; // č ž as base + combining
    const out = normalizeText(decomposed);
    expect(out).toBe('čž');
    expect(out.length).toBe(2);
  });
  it('strips zero-width and control characters', () => {
    expect(normalizeText('a\u200Bb\u0007c\uFEFF')).toBe('abc');
  });
  it('removes ASS override tags', () => {
    expect(stripAssTags('{\\an8}Hello\\NWorld')).toBe('Hello\nWorld');
  });
});

describe('wrapText', () => {
  it('keeps short text on one line', () => {
    expect(wrapText('Short line.')).toBe('Short line.');
  });
  it('wraps into two balanced lines of at most 42 chars', () => {
    const out = wrapText(
      'Ovo je jedna poprilično duga rečenica koja se mora prelomiti u dva retka.',
    );
    const lines = out.split('\n');
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(42);
    expect(Math.abs(lines[0]!.length - lines[1]!.length)).toBeLessThan(15);
  });
  it('keeps dialogue-dash lines as they are', () => {
    expect(wrapText('- Jesi li spremna?\n- Jesam.')).toBe('- Jesi li spremna?\n- Jesam.');
  });
  it('never breaks inside tags', () => {
    const out = wrapText(
      '<font color="#ffffff">This is a fairly long subtitle line that needs wrapping</font>',
    );
    expect(out).toContain('<font color="#ffffff">');
  });
});

describe('parse / render', () => {
  const sample =
    '\uFEFF1\r\n00:00:01,000 --> 00:00:02,500\r\nPrvi redak\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000 X1:10 X2:20\r\n<i>Drugi</i>\r\nredak\r\n\r\n\r\n3\r\n00:00:05.000 --> 00:00:06.000\r\nTreći\r\n';
  it('parses tolerant input', () => {
    const cues = parseSrt(sample);
    expect(cues).toHaveLength(3);
    expect(cues[1]).toEqual({ startMs: 3000, endMs: 4000, text: '<i>Drugi</i>\nredak' });
    expect(cues[2]!.text).toBe('Treći');
  });
  it('renders with CRLF and sequential numbering', () => {
    const out = renderSrt(parseSrt(sample));
    expect(out.startsWith('1\r\n00:00:01,000 --> 00:00:02,500\r\nPrvi redak\r\n')).toBe(true);
    expect(out.includes('\n') && !/[^\r]\n/.test(out)).toBe(true);
    expect(parseSrt(out)).toHaveLength(3);
  });
});

describe('encoding matrix', () => {
  const cases: [string, string, string][] = [
    ['hr', 'Čačak, ćevapi, đak, šuma, žaba — ČĆĐŠŽ', 'cp1250'],
    ['sr-Cyrl', 'Ђорђе је отишао у Београд', 'cp1251'],
    ['ru', 'Привет, как дела?', 'cp1251'],
    ['el', 'Καλημέρα κόσμε', 'cp1253'],
    ['tr', 'Günaydın, nasılsın? İyiyim.', 'cp1254'],
    ['ja', 'こんにちは、元気ですか', 'cp932'],
    ['zh-Hans', '你好，世界', 'gb18030'],
    ['ko', '안녕하세요', 'cp949'],
  ];
  for (const [lang, text, cp] of cases) {
    it(`legacy ${lang} → ${cp} round-trips`, () => {
      const enc = encodeSubtitle(text, 'legacy', lang);
      expect(enc.encoding).toBe(cp);
      expect(enc.fellBack).toBe(false);
      expect(iconv.decode(enc.buffer, cp)).toBe(text);
    });
  }
  it('UTF-8 with BOM is the default and decodes cleanly', () => {
    const enc = encodeSubtitle('Čćđšž', 'utf8-bom', 'hr');
    expect([...enc.buffer.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(decodeSubtitle(enc.buffer)).toEqual({ text: 'Čćđšž', encoding: 'utf-8-bom' });
  });
  it('falls back to UTF-8 with BOM instead of writing "?"', () => {
    const enc = encodeSubtitle('Bok 😀 — 日本', 'legacy', 'hr');
    expect(enc.fellBack).toBe(true);
    expect(enc.encoding).toBe('utf-8-bom');
    expect(enc.buffer.includes(Buffer.from('?'))).toBe(false);
  });
  it('writes NFC even when input is decomposed', () => {
    const enc = encodeSubtitle('č', 'utf8', 'hr');
    expect(enc.buffer.toString('utf8')).toBe('č');
  });
});

describe('decodeSubtitle', () => {
  it('detects UTF-16LE with BOM', () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), iconv.encode('Šišmiš', 'utf-16le')]);
    expect(decodeSubtitle(buf)).toEqual({ text: 'Šišmiš', encoding: 'utf-16le' });
  });
  it('reads strict UTF-8 without BOM', () => {
    expect(decodeSubtitle(Buffer.from('Đurđevak', 'utf8')).encoding).toBe('utf-8');
  });
  it('falls back to cp1250 for legacy Croatian files', () => {
    const text = '1\r\n00:00:01,000 --> 00:00:02,000\r\nŠto ćeš? Žena je otišla.\r\n';
    const buf = iconv.encode(text, 'cp1250');
    const out = decodeSubtitle(buf);
    expect(out.text).toBe(text);
  });
});
