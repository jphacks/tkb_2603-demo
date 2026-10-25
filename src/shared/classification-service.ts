import { classifyExchange } from './classifier';
import { clip } from './classification';
import { canClassify } from './privacy';
import { classifyViaProxy } from './proxy-client';
import { PROXY_URL } from './proxy-url';
import { getInstallationId, loadSettings } from './settings';
import type { ClassifyResponse } from './messages';

/** 設定画面の接続確認も同じ同意・停止判定を通す。会話や上流エラーを保存しない。 */
export async function classifyInBackground(input: { userText: string; assistantText: string; previousTask: string }, signal?: AbortSignal, proxyUrl = PROXY_URL): Promise<ClassifyResponse> {
  const settings = await loadSettings();
  const model = settings.classifierMode === 'proxy' ? 'proxy' : settings.model;
  const started = performance.now();
  const failed = (error: string): ClassifyResponse => ({ ok: false, error, model, ms: Math.round(performance.now() - started) });
  if (!canClassify(settings) || signal?.aborted) return failed('classification_disabled');
  // IPCからの入力も制限。送信前に本文の量を絞り、モデルやURLをメッセージから受け取らない。
  if (!input || !['userText', 'assistantText', 'previousTask'].every((key) => typeof input[key as keyof typeof input] === 'string')) return failed('invalid_request');
  const bounded = { userText: clip(input.userText, 4000), assistantText: clip(input.assistantText, 8000), previousTask: clip(input.previousTask, 300) };
  try {
    let result: ClassifyResponse;
    if (settings.classifierMode === 'proxy') {
      result = await classifyViaProxy({ url: proxyUrl, installationId: await getInstallationId(), ...bounded, signal });
    } else {
      const out = await classifyExchange({ apiKey: settings.apiKey, model: settings.model, ...bounded, signal });
      result = { ok: true, ...out, model, ms: Math.round(performance.now() - started) };
    }
    const current = await loadSettings();
    if (!canClassify(current) || signal?.aborted || current.classifierMode !== settings.classifierMode
      || current.apiKey !== settings.apiKey || current.model !== settings.model) return failed('classification_disabled');
    return result;
  } catch { return failed('classification_unavailable'); }
}
