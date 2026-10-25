// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, getInstallationId } from './settings';
import { classifyExchange } from './classifier';
import { classifyViaProxy } from './proxy-client';
import { classifyInBackground } from './classification-service';
import { CONSENT_VERSION } from './privacy';

vi.mock('./settings', async (original) => ({ ...await original<typeof import('./settings')>(), loadSettings: vi.fn(), getInstallationId: vi.fn() }));
vi.mock('./classifier', () => ({ classifyExchange: vi.fn() }));
vi.mock('./proxy-client', () => ({ classifyViaProxy: vi.fn() }));
const input = { userText: 'private user', assistantText: 'private response', previousTask: '' };
const result = { decision_requests: [], verification_events: [], topic_shift: { shift: false, current_task: 'task' } };
const accepted = { ...DEFAULT_SETTINGS, classificationConsent: 'accepted' as const, classificationConsentVersion: CONSENT_VERSION };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadSettings).mockResolvedValue({ ...accepted });
  vi.mocked(getInstallationId).mockResolvedValue('install-id');
  vi.mocked(classifyViaProxy).mockResolvedValue({ ok: true, result, model: 'proxy-model', ms: 1, inputTokens: 1, outputTokens: 2 });
  vi.mocked(classifyExchange).mockResolvedValue({ result, inputTokens: 1, outputTokens: 2 });
});
it.each([
  { classificationConsent: 'pending' as const }, { classificationConsent: 'declined' as const },
  { classificationConsentVersion: 0 }, { enabled: false }, { llmEnabled: false },
])('同意前・取消・停止時には両方の経路で送信しない: %j', async (patch) => {
  for (const classifierMode of ['proxy', 'direct'] as const) {
    vi.mocked(loadSettings).mockResolvedValue({ ...accepted, classifierMode, apiKey: 'test-only', ...patch });
    expect((await classifyInBackground(input)).ok).toBe(false);
  }
  expect(classifyViaProxy).not.toHaveBeenCalled(); expect(classifyExchange).not.toHaveBeenCalled();
  expect(getInstallationId).not.toHaveBeenCalled();
});
it('同意後はキーなしで中継を使い、保存された個人キーを中継へ送らない', async () => {
  vi.mocked(loadSettings).mockResolvedValue({ ...accepted, apiKey: 'private-direct-key' });
  expect((await classifyInBackground(input, undefined, 'https://service.example')).ok).toBe(true);
  expect(classifyViaProxy).toHaveBeenCalledWith(expect.objectContaining({ installationId: 'install-id', url: 'https://service.example' }));
  expect(JSON.stringify(vi.mocked(classifyViaProxy).mock.calls)).not.toContain('private-direct-key');
  expect(classifyExchange).not.toHaveBeenCalled();
});
it('自分のキーを選んだ場合だけ直接呼ぶ', async () => {
  vi.mocked(loadSettings).mockResolvedValue({ ...accepted, classifierMode: 'direct', apiKey: 'test-only' });
  expect((await classifyInBackground(input)).ok).toBe(true);
  expect(classifyExchange).toHaveBeenCalledOnce(); expect(classifyViaProxy).not.toHaveBeenCalled();
});
it('送信中に同意を取り消した場合は遅れて来た結果を返さない', async () => {
  vi.mocked(loadSettings).mockResolvedValueOnce(accepted).mockResolvedValueOnce({ ...accepted, classificationConsent: 'declined' });
  expect(await classifyInBackground(input)).toMatchObject({ ok: false, error: 'classification_disabled' });
});
it('上流エラーの本文を応答やログに渡さない', async () => {
  vi.mocked(loadSettings).mockResolvedValue({ ...accepted, classifierMode: 'direct', apiKey: 'test-only' });
  vi.mocked(classifyExchange).mockRejectedValue(new Error('private user private key'));
  expect(await classifyInBackground(input)).toMatchObject({ ok: false, error: 'classification_unavailable' });
});
