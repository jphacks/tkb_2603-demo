import type { ClassifyResponse } from './messages';
import { clip, isClassifyResult, readLimitedJson } from './classification';
import { proxyOrigin } from './proxy-url';

let cooldownUntil = 0;
export async function classifyViaProxy(opts: {
  url: string; installationId: string; userText: string; assistantText: string; previousTask: string; signal?: AbortSignal;
}): Promise<ClassifyResponse> {
  const failed = (error: string): ClassifyResponse => ({ ok: false, error, model: 'proxy', ms: 0 });
  const origin = proxyOrigin(opts.url);
  if (!origin) return failed('proxy_not_configured');
  if (Date.now() < cooldownUntil) return failed('proxy_cooldown');
  try {
    const response = await fetch(`${origin}/classify`, {
      method: 'POST', redirect: 'error', credentials: 'omit',
      signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json', 'X-Hitoiki-Install-Id': opts.installationId },
      body: JSON.stringify({ userText: clip(opts.userText, 4000), assistantText: clip(opts.assistantText, 8000), previousTask: clip(opts.previousTask, 300) }),
    });
    if (!response.ok) {
      const retry = Number(response.headers.get('Retry-After'));
      cooldownUntil = Date.now() + (response.status === 429 && Number.isFinite(retry) ? Math.min(86400, Math.max(30, retry)) : 60) * 1000;
      await response.body?.cancel();
      return failed(response.status === 429 ? 'proxy_rate_limited' : 'proxy_unavailable');
    }
    const data = await readLimitedJson(response, 65_536) as Record<string, unknown>;
    if (data?.ok !== true || !isClassifyResult(data.result) || typeof data.model !== 'string'
      || !Number.isSafeInteger(data.inputTokens) || Number(data.inputTokens) < 0
      || !Number.isSafeInteger(data.outputTokens) || Number(data.outputTokens) < 0
      || typeof data.ms !== 'number' || !Number.isFinite(data.ms) || data.ms < 0) return failed('proxy_invalid_response');
    return data as unknown as ClassifyResponse;
  } catch { return failed('proxy_unavailable'); }
}
