import { expect, it } from 'vitest';
import { shouldPrompt } from '../core/gate';
import { load, tick, topContributor } from '../core/model';
import { DEFAULT_PARAMS, initialState } from '../core/types';
import { demoState } from './demoStates';

const quiet = { generating: false, typing: false, composerHasText: false, tabVisible: true, secondsSinceResponse: null, quietSeconds: 0 };
const current = { ...initialState(), minute: 500, rf: 40, uf: 3, llmAvailable: true };

it('器 0 から: 器が空で、時計と LLM の状態は引き継ぐ', () => {
  const s = demoState('empty', current);
  expect(load(s)).toBe(0);
  expect([s.minute, s.llmAvailable]).toEqual([500, true]);
});

it('器 75% から: まだ提案は出ず、本物の計算で数分たまると提案が出る', () => {
  let s = demoState('near', current);
  expect(load(s)).toBeCloseTo(75);
  expect(shouldPrompt(s, DEFAULT_PARAMS, quiet)).toBe(false);
  for (let i = 0; i < 10 && !shouldPrompt(s, DEFAULT_PARAMS, quiet); i++) s = tick(s, DEFAULT_PARAMS).state;
  expect(shouldPrompt(s, DEFAULT_PARAMS, quiet)).toBe(true);
  expect(topContributor(s)).toBe('verification');
});

it('休憩の直前: 80% を超えていて、読む残りが終われば区切りで提案が出る', () => {
  let s = demoState('before_break', current);
  expect(load(s)).toBeGreaterThan(80);
  expect(shouldPrompt(s, DEFAULT_PARAMS, quiet)).toBe(false);
  s = tick(tick(s, DEFAULT_PARAMS).state, DEFAULT_PARAMS).state;
  expect(shouldPrompt(s, DEFAULT_PARAMS, quiet)).toBe(true);
});
