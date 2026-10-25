// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { appendLog, loadSettings, saveSettings } from './settings';
import { canClassify, CONSENT_VERSION } from './privacy';

afterEach(() => vi.unstubAllGlobals());
it('以前の自動タイマー設定も、ほかの設定を保って通知方式に移行する', async () => {
  const set = vi.fn();
  vi.stubGlobal('browser', { storage: { local: {
    get: vi.fn().mockResolvedValue({ 'hitoiki:settings': { mode: 'auto_timer', threshold: 90, breakScale: 0.5, llmEnabled: false } }),
    set,
  } } });
  const settings = await loadSettings();
  expect(settings.mode).toBe('notify');
  expect(settings.threshold).toBe(90);
  expect(settings.breakScale).toBe(0.5);
  expect(settings.llmEnabled).toBe(false);
  await saveSettings({ speed: 30 });
  expect(set).toHaveBeenCalledWith({ 'hitoiki:settings': { ...settings, speed: 30 } });
});

it('既存キーを保持して直接接続へ移行するが、改めて同意するまでは送信しない', async () => {
  const store: Record<string, unknown> = { 'hitoiki:settings': { apiKey: 'test-key', model: 'claude-existing', threshold: 95 } };
  vi.stubGlobal('browser', { storage: { local: {
    get: vi.fn(async (key: string) => ({ [key]: store[key] })),
    set: vi.fn(async (value: Record<string, unknown>) => { Object.assign(store, value); }),
  } } });
  const old = await loadSettings();
  expect(old.classifierMode).toBe('direct'); expect(old.apiKey).toBe('test-key');
  expect(old.threshold).toBe(95); expect(canClassify(old)).toBe(false);
  const accepted = await saveSettings({ classificationConsent: 'accepted', classificationConsentVersion: CONSENT_VERSION });
  expect(canClassify(accepted)).toBe(true);
  expect(canClassify(await saveSettings({ classificationConsent: 'declined' }))).toBe(false);
});

it('記録を同時にいくつ足しても消えない(書き込みを順番に流す)', async () => {
  const store: Record<string, unknown> = {};
  vi.stubGlobal('browser', { storage: { local: {
    get: vi.fn(async (key: string) => {
      await new Promise((r) => setTimeout(r, 5)); // 読むのに時間がかかる
      return { [key]: store[key] };
    }),
    set: vi.fn(async (obj: Record<string, unknown>) => { Object.assign(store, obj); }),
  } } });
  await Promise.all([
    appendLog({ type: 'observation', kind: 'typing_end' }, 1, 'claude'),
    appendLog({ type: 'observation', kind: 'generation_start' }, 1, 'claude'),
    appendLog({ type: 'observation', kind: 'prompt_sent' }, 1, 'claude'),
  ]);
  const log = store['hitoiki:log'] as { kind: string; site: string }[];
  expect(log.map((e) => e.kind)).toEqual(['typing_end', 'generation_start', 'prompt_sent']);
  expect(log.every((e) => e.site === 'claude')).toBe(true);
});
