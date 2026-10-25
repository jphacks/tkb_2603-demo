import { describe, expect, it, vi } from 'vitest';
import { handleRequest } from '../src/handler';
import type { Env } from '../src/config';

const result = { decision_requests: [{ span: 'A or B?' }], verification_events: [], topic_shift: { shift: false, current_task: 'test' } };
const upstream = () => vi.fn<typeof fetch>().mockResolvedValue(Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(result) }], usage: { input_tokens: 10, output_tokens: 20 } }));
const request = (body: unknown = { userText: 'hello', assistantText: 'A or B?', previousTask: '' }, id: string = crypto.randomUUID()) => new Request('https://proxy/classify', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hitoiki-Install-Id': id }, body: JSON.stringify(body) });
function environment() {
  const reserve = vi.fn().mockImplementation(async () => Response.json({ allowed: true, retryAfter: 0 }));
  return { reserve, env: {
    CLASSIFICATION_ENABLED: 'true', ANTHROPIC_MODEL: 'claude-test', ANTHROPIC_API_KEY: 'test-only',
    INSTALL_DAILY_LIMIT: '100', GLOBAL_DAILY_LIMIT: '1000', INSTALL_MINUTE_LIMIT: '6', GLOBAL_MINUTE_LIMIT: '30',
    QUOTA_LIMITER: { idFromName: vi.fn((name) => name), get: () => ({ fetch: reserve }) },
  } as unknown as Env };
}

describe('公開する分類API', () => {
  it('指示・モデル・出力量をサーバーで固定し、トークン数と検証済みの結果だけを返す', async () => {
    const { env, reserve } = environment(); const fetcher = upstream();
    const response = await handleRequest(request({ userText: 'u'.repeat(8000), assistantText: 'a'.repeat(16000), previousTask: 'p'.repeat(1000) }), env, undefined, fetcher);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, result, model: 'claude-test', inputTokens: 10, outputTokens: 20 });
    const sent = JSON.parse(String(fetcher.mock.calls[0]![1]!.body));
    expect(sent.model).toBe('claude-test'); expect(sent.max_tokens).toBe(1024);
    expect(sent.thinking).toEqual({ type: 'disabled' });
    expect(sent.output_config.effort).toBe('low');
    expect(fetcher.mock.calls[0]![1]!.redirect).toBe('manual');
    expect(sent.system).toContain('DECISION_REQUEST');
    expect(sent.messages[0].content.length).toBeLessThan(13000);
    expect(reserve).toHaveBeenCalledOnce();
  });
  it.each(['CLASSIFICATION_ENABLED', 'ANTHROPIC_MODEL', 'ANTHROPIC_API_KEY', 'GLOBAL_DAILY_LIMIT'] as const)('設定が未完なら課金APIを呼ばない: %s', async (key) => {
    const { env, reserve } = environment(); env[key] = ''; const fetcher = upstream();
    expect((await handleRequest(request(), env, undefined, fetcher)).status).toBe(503);
    expect(reserve).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('任意のモデル・指示の持ち込みと不正IDを受け付けない', async () => {
    const { env, reserve } = environment(); const fetcher = upstream();
    expect((await handleRequest(request({ userText: '', assistantText: '', previousTask: '', model: 'other' }), env, undefined, fetcher)).status).toBe(400);
    expect((await handleRequest(request(undefined, 'bad-id'), env, undefined, fetcher)).status).toBe(400);
    expect(reserve).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('Content-Lengthのない巨大なリクエストも拒否する', async () => {
    const { env, reserve } = environment();
    expect((await handleRequest(request({ userText: 'a'.repeat(70000), assistantText: '', previousTask: '' }), env)).status).toBe(413);
    expect(reserve).not.toHaveBeenCalled();
  });
  it('枠を超えたら429を返し、Anthropicを呼ばない', async () => {
    const { env, reserve } = environment(); const fetcher = upstream();
    reserve.mockResolvedValue(Response.json({ allowed: false, retryAfter: 45 }));
    const response = await handleRequest(request(), env, undefined, fetcher);
    expect(response.status).toBe(429); expect(response.headers.get('Retry-After')).toBe('45');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('上流のエラーや拒否・壊れた結果を本文つきで返さない', async () => {
    for (const response of [new Response('private upstream details', { status: 429 }), Response.json({ stop_reason: 'refusal' }), Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }] })]) {
      const { env } = environment(); const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
      const out = await handleRequest(request(), env, undefined, fetcher);
      expect(out.status).toBeGreaterThanOrEqual(500);
      expect(await out.text()).not.toContain('private');
    }
  });
  it('認証エラーはステータスだけ返し、上流の本文やキーを返さない', async () => {
    const { env } = environment();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('private upstream key and request', { status: 401 }));
    const out = await handleRequest(request(), env, undefined, fetcher);
    expect(out.status).toBe(502);
    expect(await out.json()).toEqual({ error: 'upstream_unavailable', upstreamStatus: 401 });
  });
  it('リダイレクトは追跡せず、別のURLへキーや本文を転送しない', async () => {
    const { env } = environment();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 302, headers: { Location: 'https://another.example' } }));
    const out = await handleRequest(request(), env, undefined, fetcher);
    expect(await out.json()).toEqual({ error: 'upstream_unavailable', upstreamStatus: 302 });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]![1]!.redirect).toBe('manual');
  });
  it('クォータ基盤の障害、通信障害、出力打ち切りを固定コードで区別する', async () => {
    const { env, reserve } = environment();
    reserve.mockRejectedValueOnce(new Error('private infrastructure details'));
    expect(await (await handleRequest(request(), env, undefined, upstream())).json()).toEqual({ error: 'quota_unavailable' });
    const unavailable = vi.fn<typeof fetch>().mockRejectedValue(new Error('private error'));
    expect(await (await handleRequest(request(), env, undefined, unavailable)).json()).toEqual({ error: 'upstream_unavailable' });
    const truncated = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ stop_reason: 'max_tokens', content: [] }));
    expect(await (await handleRequest(request(), env, undefined, truncated)).json()).toEqual({ error: 'classification_truncated' });
  });
});
