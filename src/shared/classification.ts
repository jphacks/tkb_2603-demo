// ブラウザと中継で共有する、本文を保存しない分類契約。
import type { ClassifyResult } from './messages';

export const CLASSIFICATION_SYSTEM = `You classify one developer–AI exchange from an AI chat service (ChatGPT, Claude, or Gemini). Use ONLY the definitions below.
Do not infer events that are not explicitly supported by the text.

DECISION_REQUEST: each independent point where the ASSISTANT asks the user to choose, approve, or decide
(e.g. "Which do you prefer, React or Vue?", "Shall I proceed with this approach?"). Do not count requests for factual information.

VERIFICATION_EVENT: each independent event in the USER message where the user reports an error/failure,
says something does not work after trying it, asks whether something is correct, or asks to verify a test/result.
Types: error_report (pasted error/stack trace), failure_after_attempt ("I tried it but it doesn't work"),
correctness_check ("Is this right?"), test_or_result_check ("Does this test result mean success?").
Do not count a first-time request or "tell me more".

TOPIC_SHIFT: true only if the USER message starts an independent new goal, unrelated to PREVIOUS_TASK.
Refinements, debugging, clarification, and implementation subtasks of the previous goal are NOT topic shifts.
If PREVIOUS_TASK is empty, shift is false.
Also return current_task: a short (max 15 words) description of the current goal, in the user's language.

Return only the schema-constrained JSON.`;

export const CLASSIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    decision_requests: {
      type: 'array',
      items: {
        type: 'object',
        properties: { span: { type: 'string' } },
        required: ['span'],
        additionalProperties: false,
      },
    },
    verification_events: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['error_report', 'failure_after_attempt', 'correctness_check', 'test_or_result_check'],
          },
        },
        required: ['type'],
        additionalProperties: false,
      },
    },
    topic_shift: {
      type: 'object',
      properties: { shift: { type: 'boolean' }, current_task: { type: 'string' } },
      required: ['shift', 'current_task'],
      additionalProperties: false,
    },
  },
  required: ['decision_requests', 'verification_events', 'topic_shift'],
  additionalProperties: false,
} as const;

/** 1 往復が長すぎるときは先頭と末尾を残す(判断の要求は回答の末尾に出やすい) */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.4);
  return `${text.slice(0, head)}\n…(中略 ${text.length - max} 文字)…\n${text.slice(-(max - head))}`;
}

export function classificationContent(userText: string, assistantText: string, previousTask: string): string {
  return [`PREVIOUS_TASK: ${clip(previousTask, 300) || '(none)'}`, `USER:\n${clip(userText, 4000)}`, `ASSISTANT:\n${clip(assistantText, 8000)}`].join('\n\n');
}

export function isClassifyResult(value: unknown): value is ClassifyResult {
  if (!value || typeof value !== 'object') return false;
  const r = value as ClassifyResult;
  const types = ['error_report', 'failure_after_attempt', 'correctness_check', 'test_or_result_check'];
  return Array.isArray(r.decision_requests) && r.decision_requests.length <= 50
    && r.decision_requests.every((v) => v && typeof v.span === 'string' && v.span.length <= 4000)
    && Array.isArray(r.verification_events) && r.verification_events.length <= 50
    && r.verification_events.every((v) => v && types.includes(v.type))
    && !!r.topic_shift && typeof r.topic_shift.shift === 'boolean'
    && typeof r.topic_shift.current_task === 'string' && r.topic_shift.current_task.length <= 1000;
}

/** リクエストも応答も、宣言されたサイズと実際のストリームの両方に上限を設ける。 */
export async function readLimitedJson(message: Request | Response, maxBytes: number): Promise<unknown> {
  if (Number(message.headers.get('content-length')) > maxBytes) throw new Error('body_too_large');
  const reader = message.body?.getReader();
  if (!reader) throw new Error('invalid_json');
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error('body_too_large'); }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { reader.releaseLock(); }
}
