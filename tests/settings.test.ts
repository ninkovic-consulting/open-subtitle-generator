import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/types.js';
import {
  loadSettings,
  maskSecret,
  resetSettings,
  toSettingsResponse,
  updateSettings,
} from '../src/server/services/settings.js';
import { freshDb } from './helpers/db.js';

beforeAll(() => {
  freshDb();
});

describe('settings', () => {
  it('starts with OpenRouter + Whisper + Gemini defaults', () => {
    const s = loadSettings();
    expect(s.stt).toMatchObject({ provider: 'openrouter', model: 'openai/whisper-large-v3' });
    expect(s.translation).toMatchObject({
      provider: 'openrouter',
      model: 'google/gemini-3.1-flash-lite',
    });
    expect(s.defaultTargetLang).toBe('hr');
  });

  it('masks secrets and ignores masked values on save', () => {
    updateSettings({ openrouterApiKey: 'sk-or-v1-abcdefghijklmnop1234' });
    const res = toSettingsResponse(loadSettings());
    expect(res.settings.openrouterApiKey).toBe(maskSecret('sk-or-v1-abcdefghijklmnop1234'));
    expect(res.settings.openrouterApiKey).not.toContain('abcdefgh');
    expect(res.meta.openrouterKeySource).toBe('settings');
    updateSettings({ openrouterApiKey: res.settings.openrouterApiKey, defaultTargetLang: 'de' });
    expect(loadSettings().openrouterApiKey).toBe('sk-or-v1-abcdefghijklmnop1234');
    expect(loadSettings().defaultTargetLang).toBe('de');
  });

  it('stores custom endpoints and resets providers to defaults', () => {
    updateSettings({
      stt: {
        provider: 'custom',
        baseUrl: 'http://localhost:8000/v1',
        model: 'Systran/faster-whisper-large-v3',
        apiKey: 'local',
      },
      translation: {
        provider: 'custom',
        baseUrl: 'http://localhost:11434/v1',
        model: 'gemma3:12b',
        audioInput: false,
      },
      batchSize: 25,
    });
    expect(loadSettings().translation).toMatchObject({
      provider: 'custom',
      model: 'gemma3:12b',
      audioInput: false,
      structuredOutput: true,
    });
    const after = resetSettings('providers');
    expect(after.stt).toEqual(DEFAULT_SETTINGS.stt);
    expect(after.translation).toEqual(DEFAULT_SETTINGS.translation);
    expect(after.batchSize).toBe(25);
    expect(after.openrouterApiKey).toBe('sk-or-v1-abcdefghijklmnop1234');
    const all = resetSettings('all');
    expect(all.batchSize).toBe(DEFAULT_SETTINGS.batchSize);
    expect(all.openrouterApiKey).toBe('sk-or-v1-abcdefghijklmnop1234');
  });

  it('rejects invalid values', () => {
    expect(() => updateSettings({ batchSize: 1 })).toThrow();
  });
});
