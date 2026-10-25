import { expect, it } from 'vitest';
import { type GateContext, shouldPrompt } from '../core/gate';
import { breakMinutes, load, observe, tick, topContributor } from '../core/model';
import { DEFAULT_PARAMS, type EngineState, initialState } from '../core/types';
import { DEMO_SETTINGS, demoState } from './demoStates';

const quiet = { generating: false, typing: false, composerHasText: false, tabVisible: true, secondsSinceResponse: null, quietSeconds: 0 };
const current = { ...initialState(), minute: 500, rf: 40, uf: 3, llmAvailable: true };

it('器 0 から: 器が空で、時計と LLM の状態は引き継ぐ', () => {
  const s = demoState('empty', current);
  expect(load(s)).toBe(0);
  expect([s.minute, s.llmAvailable]).toEqual([500, true]);
});

it('器 75% から: まだ提案は出ず、操作を続けると本物の計算で数分たまって提案が出る', () => {
  let s = demoState('near', current);
  expect(load(s)).toBeCloseTo(75);
  expect(shouldPrompt(s, DEFAULT_PARAMS, quiet)).toBe(false);
  for (let i = 0; i < 10 && !shouldPrompt(s, DEFAULT_PARAMS, quiet); i++) {
    s = tick(observe(s, { kind: 'activity', t: s.minute }, DEFAULT_PARAMS), DEFAULT_PARAMS).state;
  }
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

// ---- 30 秒のデモの台本(30 倍速なので、計算上の 1 分 = 実時間 2 秒) ----
const demoParams = { ...DEFAULT_PARAMS, threshold: DEMO_SETTINGS.threshold, g: DEMO_SETTINGS.g };
const typing: GateContext = { ...quiet, typing: true, composerHasText: true };
const generating: GateContext = { ...quiet, generating: true };

/** 器 75% から、エラーを貼って入力 → 送信 → 生成 → 回答。回答の後、提案が出るまでの tick 数を返す */
function runScript(typingMin: number, generatingMin: number, replyChars: number) {
  const p = demoParams;
  let s: EngineState = demoState('near', current);
  s = observe(s, { kind: 'verification', t: s.minute, count: 1, source: 'paste' }, p);
  for (let i = 0; i < typingMin; i++) {
    s = tick(observe(s, { kind: 'activity', t: s.minute }, p), p).state;
    expect(shouldPrompt(s, p, typing)).toBe(false);
  }
  s = observe(s, { kind: 'prompt_sent', t: s.minute, chars: 200 }, p);
  for (let i = 0; i < generatingMin; i++) {
    s = tick(s, p).state;
    expect(shouldPrompt(s, p, generating)).toBe(false);
  }
  s = observe(s, { kind: 'response_done', t: s.minute, chars: replyChars, enWords: 0 }, p);
  let ticksAfter = 0;
  while (!shouldPrompt(s, p, quiet) && ticksAfter < 30) {
    s = tick(s, p).state;
    ticksAfter++;
  }
  return { ticksAfter, load: load(s) };
}

it.each([
  { name: '台本どおり(入力 10 秒・生成 10 秒・短い回答)', typingMin: 5, generatingMin: 5, replyChars: 400 },
  { name: '回答が長め(約 1300 字)', typingMin: 5, generatingMin: 5, replyChars: 1300 },
  { name: '手早い(入力 4 秒・生成 2 秒)', typingMin: 2, generatingMin: 1, replyChars: 400 },
  { name: 'ゆっくり(入力 20 秒・生成 20 秒)', typingMin: 10, generatingMin: 10, replyChars: 400 },
])('デモの台本: $name でも、回答の後 3 tick(6 秒)以内に提案が出る', ({ typingMin, generatingMin, replyChars }) => {
  const r = runScript(typingMin, generatingMin, replyChars);
  expect(r.ticksAfter).toBeLessThanOrEqual(3);
  expect(r.load).toBeGreaterThanOrEqual(80);
  // 「今○分休む」の休憩は実時間 10 秒前後で終わり、おかえりまで見せられる
  expect((breakMinutes(r.load, DEMO_SETTINGS.breakScale) * 60) / DEMO_SETTINGS.speed).toBeLessThanOrEqual(12);
});

it('デモの台本: 入力欄が空のまま操作していても、計算上 7 分(14 秒)は提案が出ない', () => {
  let s = demoState('near', current);
  for (let i = 0; i < 7; i++) {
    s = tick(observe(s, { kind: 'activity', t: s.minute }, demoParams), demoParams).state;
    expect(shouldPrompt(s, demoParams, quiet)).toBe(false);
  }
});
