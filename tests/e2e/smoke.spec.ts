import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import ffmpeg from 'ffmpeg-static';
import { startMockOpenAI, type MockOpenAI } from '../helpers/mock-openai.js';

let mock: MockOpenAI;
let folder: string;

test.beforeAll(async () => {
  mock = await startMockOpenAI({ apiKey: 'e2e-key' });
  folder = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'osg-e2e-media-')), 'E2E Show');
  fs.mkdirSync(folder, { recursive: true });
  const res = spawnSync(ffmpeg as unknown as string, [
    '-nostdin',
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=0x1b2130:s=160x90:r=10:d=24',
    '-f',
    'lavfi',
    '-i',
    "aevalsrc='if(lt(mod(t\\,6)\\,4)\\,0.5*sin(2*PI*440*t)\\,0)':s=16000:d=24",
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    path.join(folder, 'E2E.Show.S01E01.mp4'),
  ]);
  expect(res.status).toBe(0);
});

test.afterAll(async () => {
  await mock.close();
});

test('configure local endpoints, translate an episode and review it', async ({ page }) => {
  // Settings: point both steps at the local OpenAI-compatible server.
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  const custom = page.getByRole('radio', { name: 'Custom endpoint' });
  await custom.nth(0).click();
  await page.locator('#stt-url').fill(mock.url);
  await page.locator('#stt-key').fill('e2e-key');
  await custom.nth(1).click();
  await page.locator('#translation-url').fill(mock.url);
  await page.locator('#translation-key').fill('e2e-key');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();

  // Wizard
  await page.goto('/new');
  const pathInput = page.getByLabel('Folder path');
  await pathInput.fill(folder);
  await pathInput.press('Enter');
  await page.getByText('Select all 1 video in this folder').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Output file:')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('E2E.Show.S01E01.mp4')).toBeVisible();
  await page.getByRole('button', { name: /Start translation/ }).click();

  // Job page updates live until done.
  await expect(page).toHaveURL(/\/jobs\/\d+$/);
  await expect(page.getByText('Done', { exact: true })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('link', { name: 'Review & edit' }).click();

  // Editor shows source and translated lines side by side.
  await expect(page.getByText('Local line 1.')).toBeVisible();
  await expect(page.getByText('Lokalni redak 1 — žđčćš')).toBeVisible();
  expect(fs.existsSync(path.join(folder, 'E2E.Show.S01E01.hr.srt'))).toBe(true);
});
