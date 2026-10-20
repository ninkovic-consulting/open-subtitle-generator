import {
  DEFAULT_SETTINGS,
  settingsSchema,
  type Settings,
  type SettingsResponse,
  type SettingsUpdate,
} from '../../shared/types.js';
import { config } from '../config.js';
import { getDb, schema } from '../db/client.js';

const SECRET_MARK = '•';

/** `sk-or-v1-abc…wxyz` → `sk-or-••••••••wxyz`. Empty stays empty. */
export function maskSecret(value: string): string {
  if (!value) return '';
  const tail = value.slice(-4);
  const head = value.slice(0, Math.min(6, Math.max(0, value.length - 8)));
  return `${head}${SECRET_MARK.repeat(8)}${tail}`;
}

function isMasked(value: string | undefined): boolean {
  return typeof value === 'string' && value.includes(SECRET_MARK);
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === undefined || patch === null) return base;
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return patch as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined) continue;
    out[k] = deepMerge(out[k], v);
  }
  return out as T;
}

/** Reads all settings, filling in defaults for anything missing or invalid. */
export function loadSettings(): Settings {
  const rows = getDb().select().from(schema.settings).all();
  let merged: Settings = structuredClone(DEFAULT_SETTINGS);
  for (const row of rows) {
    try {
      merged = deepMerge(merged, { [row.key]: JSON.parse(row.value) });
    } catch {
      // ignore corrupt rows
    }
  }
  const parsed = settingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : structuredClone(DEFAULT_SETTINGS);
}

function writeSettings(next: Settings): void {
  const db = getDb();
  db.transaction((tx) => {
    for (const [key, value] of Object.entries(next)) {
      tx.insert(schema.settings)
        .values({ key, value: JSON.stringify(value) })
        .onConflictDoUpdate({ target: schema.settings.key, set: { value: JSON.stringify(value) } })
        .run();
    }
  });
}

/** Applies a partial update. Masked secrets in the patch keep the stored value. */
export function updateSettings(patch: SettingsUpdate): Settings {
  const current = loadSettings();
  const clean = structuredClone(patch) as SettingsUpdate;
  if (isMasked(clean.openrouterApiKey)) delete clean.openrouterApiKey;
  if (clean.stt && isMasked(clean.stt.apiKey)) delete clean.stt.apiKey;
  if (clean.translation && isMasked(clean.translation.apiKey)) delete clean.translation.apiKey;
  const next = settingsSchema.parse(deepMerge(current, clean));
  writeSettings(next);
  return next;
}

/**
 * Restores defaults. `scope = 'providers'` resets only the AI provider/model configuration and
 * keeps the OpenRouter key and output preferences; `scope = 'all'` resets everything except the key.
 */
export function resetSettings(scope: 'providers' | 'all'): Settings {
  const current = loadSettings();
  const defaults = structuredClone(DEFAULT_SETTINGS);
  const next: Settings =
    scope === 'providers'
      ? {
          ...current,
          stt: defaults.stt,
          translation: defaults.translation,
          reasoningEffort: defaults.reasoningEffort,
          temperature: defaults.temperature,
        }
      : { ...defaults, openrouterApiKey: current.openrouterApiKey };
  writeSettings(next);
  return next;
}

/** OpenRouter key: Settings value wins, otherwise the environment / `.env`. */
export function resolveOpenRouterKey(settings: Settings = loadSettings()): string {
  return settings.openrouterApiKey.trim() || config.envOpenRouterKey;
}

export function toSettingsResponse(settings: Settings): SettingsResponse {
  const source = settings.openrouterApiKey.trim()
    ? 'settings'
    : config.envOpenRouterKey
      ? 'env'
      : null;
  return {
    settings: {
      ...settings,
      openrouterApiKey: maskSecret(settings.openrouterApiKey || config.envOpenRouterKey),
      stt: { ...settings.stt, apiKey: maskSecret(settings.stt.apiKey) },
      translation: { ...settings.translation, apiKey: maskSecret(settings.translation.apiKey) },
    },
    meta: {
      openrouterKeySource: source,
      dataDir: config.dataDir,
      version: config.version,
      defaults: DEFAULT_SETTINGS,
    },
  };
}
