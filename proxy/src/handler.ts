import { CLASSIFICATION_SCHEMA, CLASSIFICATION_SYSTEM, classificationContent, isClassifyResult, readLimitedJson } from '../../src/shared/classification';
import { limitsFrom, type Env } from './config';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
}

/** 本文・上流のエラーメッセージ・秘密キーはログや応答に含めない。 */
export async function handleRequest(request: Request, env: Env, _ctx?: unknown, upstream: typeof fetch = fetch): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (request.method === 'GET' && path === '/health') return json({ ok: true, enabled: env.CLASSIFICATION_ENABLED === 'true' });
  if (path !== '/classify') return json({ error: 'not_found' }, 404);
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  // Originや端末IDは認証ではない。全体の枠は必ず単一のDOで消費する。
  if (env.CLASSIFICATION_ENABLED !== 'true') return json({ error: 'service_disabled' }, 503);
  try {
    if (!env.ANTHROPIC_API_KEY?.trim() || !/^claude-[a-z0-9-]{1,100}$/.test(env.ANTHROPIC_MODEL ?? '')) throw new Error('config');
    limitsFrom(env);
  } catch { return json({ error: 'service_not_configured' }, 503); }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return json({ error: 'invalid_request' }, 415);
  const id = request.headers.get('X-Hitoiki-Install-Id') ?? '';
  if (!UUID.test(id)) return json({ error: 'invalid_request' }, 400);
  let body: { userText: string; assistantText: string; previousTask: string };
  try {
    const value = await readLimitedJson(request, 65_536);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
    const object = value as Record<string, unknown>;
    const keys = ['userText', 'assistantText', 'previousTask'];
    if (Object.keys(object).length !== 3 || !keys.every((key) => typeof object[key] === 'string')) throw new Error('invalid');
    body = object as typeof body;
  } catch (e) { return json({ error: e instanceof Error && e.message === 'body_too_large' ? 'body_too_large' : 'invalid_request' }, e instanceof Error && e.message === 'body_too_large' ? 413 : 400); }

  let stage: 'quota' | 'upstream' | 'response' = 'quota';
  try {
    const limiter = env.QUOTA_LIMITER.get(env.QUOTA_LIMITER.idFromName('global-v1'));
    const reserved = await limiter.fetch(new Request('https://quota/reserve', { method: 'POST', body: JSON.stringify({ id: id.toLowerCase() }) }));
    if (!reserved.ok) return json({ error: 'quota_unavailable' }, 503);
    const quota = await reserved.json() as { allowed: boolean; retryAfter: number };
    if (quota.allowed === false && Number.isFinite(quota.retryAfter)) return json({ error: 'rate_limited' }, 429, { 'Retry-After': String(Math.max(1, Math.ceil(quota.retryAfter))) });
    if (quota.allowed !== true) return json({ error: 'quota_unavailable' }, 503);

    stage = 'upstream';
    const started = performance.now();
    const response = await upstream('https://api.anthropic.com/v1/messages', {
      // Workersはredirect:errorを実装していない。manualで3xxをエラーとして扱い、キーを転送しない。
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(12_000),
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL, max_tokens: 1024, system: CLASSIFICATION_SYSTEM,
        // Haiku 5.5の既定の思考で出力枠を使い切らないよう、短い抽出専用に固定する。
        thinking: { type: 'disabled' },
        messages: [{ role: 'user', content: classificationContent(body.userText, body.assistantText, body.previousTask) }],
        output_config: { effort: 'low', format: { type: 'json_schema', schema: CLASSIFICATION_SCHEMA } },
      }),
    });
    if (!response.ok) { await response.body?.cancel(); return json({ error: 'upstream_unavailable', upstreamStatus: response.status }, 502); }
    stage = 'response';
    const out = await readLimitedJson(response, 65_536) as { stop_reason?: string; content?: { type: string; text?: string }[]; usage?: { input_tokens: number; output_tokens: number } };
    if (out.stop_reason === 'max_tokens') return json({ error: 'classification_truncated' }, 502);
    if (out.stop_reason === 'refusal') return json({ error: 'classification_refused' }, 502);
    if (out.stop_reason !== 'end_turn' || !Array.isArray(out.content)) throw new Error('invalid_result');
    const text = out.content.find((block) => block.type === 'text')?.text;
    const result: unknown = JSON.parse(text ?? '');
    if (!isClassifyResult(result)) throw new Error('invalid_result');
    const inputTokens = out.usage?.input_tokens;
    const outputTokens = out.usage?.output_tokens;
    if (!Number.isSafeInteger(inputTokens) || inputTokens! < 0 || !Number.isSafeInteger(outputTokens) || outputTokens! < 0) throw new Error('invalid_usage');
    return json({ ok: true, result, model: env.ANTHROPIC_MODEL, ms: Math.round(performance.now() - started), inputTokens, outputTokens });
  } catch {
    // 返すのは固定の工程名とHTTPステータスだけ。例外の文字列や上流本文は返さない。
    return json({ error: stage === 'quota' ? 'quota_unavailable' : stage === 'upstream' ? 'upstream_unavailable' : 'invalid_classification' }, stage === 'quota' ? 503 : 502);
  }
}
