import { beforeEach, expect, it, vi } from 'vitest';
import { classifyExchange } from './classifier';

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create }; beta = { messages: { create } }; } }));
const options = { apiKey: 'test-only', model: 'claude-test', userText: 'user', assistantText: 'assistant', previousTask: '' };
beforeEach(() => vi.resetAllMocks());
it('直接接続でも構造を検証してから結果とトークン数を返す', async () => {
  const result = { decision_requests: [], verification_events: [], topic_shift: { shift: false, current_task: '' } };
  create.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(result) }], usage: { input_tokens: 1, output_tokens: 2 } });
  expect(await classifyExchange(options)).toMatchObject({ result, inputTokens: 1, outputTokens: 2 });
});
it('壊れたJSON構造を計算側へ渡さない', async () => {
  create.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }], usage: { input_tokens: 1, output_tokens: 2 } });
  await expect(classifyExchange(options)).rejects.toThrow('invalid_result');
});
