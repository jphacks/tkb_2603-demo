// 会話の 1 往復から出来事を抜き出す(background で動かす)。LLM には点数を出させない(DR05)。
import Anthropic from '@anthropic-ai/sdk';
import type { ClassifyResult } from './messages';

import { CLASSIFICATION_SYSTEM as SYSTEM, CLASSIFICATION_SCHEMA as SCHEMA, clip, isClassifyResult } from './classification';

/** サーバー側のフォールバックを使える(Opus 5.5 / Sonnet 5.5)。Haiku 5.5 には無い */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

export async function classifyExchange(opts: {
  apiKey: string;
  model: string;
  userText: string;
  assistantText: string;
  previousTask: string;
  signal?: AbortSignal;
}): Promise<{ result: ClassifyResult; inputTokens: number; outputTokens: number }> {
  const client = new Anthropic({
    apiKey: opts.apiKey,
    // 拡張(自分たちだけで使う)から直接呼ぶ。配るときはサーバー経由に変える
    dangerouslyAllowBrowser: true,
    // service worker は fetch が 30 秒を超えると止まるので短めにする
    timeout: 12_000,
    maxRetries: 1,
  });

  const content = [
    `PREVIOUS_TASK: ${opts.previousTask || '(none)'}`,
    `USER:\n${clip(opts.userText, 4000)}`,
    `ASSISTANT:\n${clip(opts.assistantText, 8000)}`,
  ].join('\n\n');

  const base = {
    model: opts.model,
    max_tokens: 4096,
    system: SYSTEM,
    messages: [{ role: 'user' as const, content }],
    output_config: { effort: 'low' as const, format: { type: 'json_schema' as const, schema: SCHEMA } },
  };

  const response = FALLBACK_MODELS.has(opts.model)
    ? await client.beta.messages.create({
        ...base,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      }, { signal: opts.signal })
    : await client.messages.create(base, { signal: opts.signal });

  if (response.stop_reason === 'refusal') throw new Error('refusal');
  if (response.stop_reason === 'max_tokens') throw new Error('truncated');
  const text = response.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') throw new Error('no text block');
  const result: unknown = JSON.parse(text.text);
  if (!isClassifyResult(result)) throw new Error('invalid_result');
  return {
    result,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}
