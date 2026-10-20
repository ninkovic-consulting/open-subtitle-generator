/**
 * Languages offered in the UI.
 * - `code`: stable id used in the DB and API (BCP-47-ish, e.g. `hr`, `sr-Cyrl`).
 * - `iso`: ISO 639-1 code used for file names (`Show.S01E01.hr.srt`) and as the STT language hint.
 * - `codepage`: legacy Windows code page for old TVs, or `null` when only Unicode works.
 */
export interface Language {
  code: string;
  iso: string;
  name: string;
  native: string;
  codepage: string | null;
  rtl?: boolean;
}

export const LANGUAGES: Language[] = [
  { code: 'hr', iso: 'hr', name: 'Croatian', native: 'Hrvatski', codepage: 'cp1250' },
  { code: 'en', iso: 'en', name: 'English', native: 'English', codepage: 'cp1252' },
  { code: 'bs', iso: 'bs', name: 'Bosnian', native: 'Bosanski', codepage: 'cp1250' },
  { code: 'sr-Latn', iso: 'sr', name: 'Serbian (Latin)', native: 'Srpski', codepage: 'cp1250' },
  { code: 'sr-Cyrl', iso: 'sr', name: 'Serbian (Cyrillic)', native: 'Српски', codepage: 'cp1251' },
  { code: 'sl', iso: 'sl', name: 'Slovenian', native: 'Slovenščina', codepage: 'cp1250' },
  { code: 'mk', iso: 'mk', name: 'Macedonian', native: 'Македонски', codepage: 'cp1251' },
  { code: 'de', iso: 'de', name: 'German', native: 'Deutsch', codepage: 'cp1252' },
  { code: 'fr', iso: 'fr', name: 'French', native: 'Français', codepage: 'cp1252' },
  { code: 'es', iso: 'es', name: 'Spanish', native: 'Español', codepage: 'cp1252' },
  { code: 'it', iso: 'it', name: 'Italian', native: 'Italiano', codepage: 'cp1252' },
  { code: 'pt', iso: 'pt', name: 'Portuguese', native: 'Português', codepage: 'cp1252' },
  {
    code: 'pt-BR',
    iso: 'pt',
    name: 'Portuguese (Brazil)',
    native: 'Português (Brasil)',
    codepage: 'cp1252',
  },
  { code: 'nl', iso: 'nl', name: 'Dutch', native: 'Nederlands', codepage: 'cp1252' },
  { code: 'pl', iso: 'pl', name: 'Polish', native: 'Polski', codepage: 'cp1250' },
  { code: 'cs', iso: 'cs', name: 'Czech', native: 'Čeština', codepage: 'cp1250' },
  { code: 'sk', iso: 'sk', name: 'Slovak', native: 'Slovenčina', codepage: 'cp1250' },
  { code: 'hu', iso: 'hu', name: 'Hungarian', native: 'Magyar', codepage: 'cp1250' },
  { code: 'ro', iso: 'ro', name: 'Romanian', native: 'Română', codepage: 'cp1250' },
  { code: 'sq', iso: 'sq', name: 'Albanian', native: 'Shqip', codepage: 'cp1250' },
  { code: 'bg', iso: 'bg', name: 'Bulgarian', native: 'Български', codepage: 'cp1251' },
  { code: 'ru', iso: 'ru', name: 'Russian', native: 'Русский', codepage: 'cp1251' },
  { code: 'uk', iso: 'uk', name: 'Ukrainian', native: 'Українська', codepage: 'cp1251' },
  { code: 'be', iso: 'be', name: 'Belarusian', native: 'Беларуская', codepage: 'cp1251' },
  { code: 'el', iso: 'el', name: 'Greek', native: 'Ελληνικά', codepage: 'cp1253' },
  { code: 'tr', iso: 'tr', name: 'Turkish', native: 'Türkçe', codepage: 'cp1254' },
  { code: 'he', iso: 'he', name: 'Hebrew', native: 'עברית', codepage: 'cp1255', rtl: true },
  { code: 'ar', iso: 'ar', name: 'Arabic', native: 'العربية', codepage: 'cp1256', rtl: true },
  { code: 'fa', iso: 'fa', name: 'Persian', native: 'فارسی', codepage: 'cp1256', rtl: true },
  { code: 'lt', iso: 'lt', name: 'Lithuanian', native: 'Lietuvių', codepage: 'cp1257' },
  { code: 'lv', iso: 'lv', name: 'Latvian', native: 'Latviešu', codepage: 'cp1257' },
  { code: 'et', iso: 'et', name: 'Estonian', native: 'Eesti', codepage: 'cp1257' },
  { code: 'fi', iso: 'fi', name: 'Finnish', native: 'Suomi', codepage: 'cp1252' },
  { code: 'sv', iso: 'sv', name: 'Swedish', native: 'Svenska', codepage: 'cp1252' },
  { code: 'da', iso: 'da', name: 'Danish', native: 'Dansk', codepage: 'cp1252' },
  { code: 'nb', iso: 'no', name: 'Norwegian', native: 'Norsk', codepage: 'cp1252' },
  { code: 'is', iso: 'is', name: 'Icelandic', native: 'Íslenska', codepage: 'cp1252' },
  { code: 'ca', iso: 'ca', name: 'Catalan', native: 'Català', codepage: 'cp1252' },
  { code: 'vi', iso: 'vi', name: 'Vietnamese', native: 'Tiếng Việt', codepage: 'cp1258' },
  { code: 'th', iso: 'th', name: 'Thai', native: 'ไทย', codepage: 'cp874' },
  { code: 'ja', iso: 'ja', name: 'Japanese', native: '日本語', codepage: 'cp932' },
  { code: 'ko', iso: 'ko', name: 'Korean', native: '한국어', codepage: 'cp949' },
  {
    code: 'zh-Hans',
    iso: 'zh',
    name: 'Chinese (Simplified)',
    native: '简体中文',
    codepage: 'gb18030',
  },
  {
    code: 'zh-Hant',
    iso: 'zh',
    name: 'Chinese (Traditional)',
    native: '繁體中文',
    codepage: 'big5',
  },
  { code: 'hi', iso: 'hi', name: 'Hindi', native: 'हिन्दी', codepage: null },
  { code: 'id', iso: 'id', name: 'Indonesian', native: 'Bahasa Indonesia', codepage: 'cp1252' },
  { code: 'ms', iso: 'ms', name: 'Malay', native: 'Bahasa Melayu', codepage: 'cp1252' },
  { code: 'tl', iso: 'tl', name: 'Filipino', native: 'Filipino', codepage: 'cp1252' },
  { code: 'sw', iso: 'sw', name: 'Swahili', native: 'Kiswahili', codepage: 'cp1252' },
  { code: 'ka', iso: 'ka', name: 'Georgian', native: 'ქართული', codepage: null },
  { code: 'hy', iso: 'hy', name: 'Armenian', native: 'Հայերեն', codepage: null },
  { code: 'bn', iso: 'bn', name: 'Bengali', native: 'বাংলা', codepage: null },
  { code: 'ta', iso: 'ta', name: 'Tamil', native: 'தமிழ்', codepage: null },
  { code: 'ur', iso: 'ur', name: 'Urdu', native: 'اردو', codepage: 'cp1256', rtl: true },
];

const byCode = new Map(LANGUAGES.map((l) => [l.code.toLowerCase(), l]));
const byIso = new Map<string, Language>();
for (const l of LANGUAGES) if (!byIso.has(l.iso)) byIso.set(l.iso, l);

/** Finds a language by code (`sr-Cyrl`), ISO code (`sr`) or English name (`croatian`). */
export function findLanguage(value: string | null | undefined): Language | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  return (
    byCode.get(v) ??
    byIso.get(v) ??
    LANGUAGES.find((l) => l.name.toLowerCase() === v || l.native.toLowerCase() === v)
  );
}

/** Human-readable name for a language code, falling back to the raw value for custom languages. */
export function languageName(value: string | null | undefined): string {
  if (!value) return '—';
  if (value === 'auto') return 'Auto-detect';
  return findLanguage(value)?.name ?? value;
}

/** Code used in output file names, e.g. `hr` → `Show.S01E01.hr.srt`. */
export function fileLanguageCode(value: string): string {
  const lang = findLanguage(value);
  if (lang) return lang.iso;
  const cleaned = value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z-]/g, '');
  return cleaned.slice(0, 8) || 'sub';
}

/** ISO 639-1 hint for the speech-to-text model, or undefined when unknown/auto. */
export function sttLanguageHint(value: string | null | undefined): string | undefined {
  if (!value || value === 'auto') return undefined;
  return findLanguage(value)?.iso;
}
