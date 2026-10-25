import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { proxyOrigin } from './proxy-url';

const args = { url: 'https://service.example', installationId: 'id', userText: 'user', assistantText: 'assistant', previousTask: '' };
const result = { decision_requests: [], verification_events: [], topic_shift: { shift: false, current_task: '' } };
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());
it.each(['', 'http://service.example', 'https://user:password@service.example', 'https://service.example/path', 'https://service.example/?token=secret'])('接続先はHTTPSのルートURLだけ: %s', (url) => { expect(proxyOrigin(url)).toBeNull(); });
it('本文以外のモデル・秘密キーを渡さず、応答を検証する', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true, result, model: 'fixed', ms: 1, inputTokens: 1, outputTokens: 2 })); vi.stubGlobal('fetch', fetcher);
  const { classifyViaProxy } = await import('./proxy-client');
  expect((await classifyViaProxy(args)).ok).toBe(true);
  expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({ userText: 'user', assistantText: 'assistant', previousTask: '' });
  expect(fetcher.mock.calls[0]![1].redirect).toBe('error');
});
it('429の後はRetry-Afterに従い、毎往復の再送を止める', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '100' } })); vi.stubGlobal('fetch', fetcher);
  const { classifyViaProxy } = await import('./proxy-client');
  expect(await classifyViaProxy(args)).toMatchObject({ ok: false, error: 'proxy_rate_limited' });
  expect(await classifyViaProxy(args)).toMatchObject({ ok: false, error: 'proxy_cooldown' });
  expect(fetcher).toHaveBeenCalledOnce();
});
it('壊れた応答や通信障害ではローカル計測用の失敗結果を返す', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true, result: {} })); vi.stubGlobal('fetch', fetcher);
  const { classifyViaProxy } = await import('./proxy-client');
  expect(await classifyViaProxy(args)).toMatchObject({ ok: false, error: 'proxy_invalid_response' });
  fetcher.mockRejectedValue(new Error('network failure'));
  expect(await classifyViaProxy(args)).toMatchObject({ ok: false, error: 'proxy_unavailable' });
});
