import { expect, it } from 'vitest';
import type { StoredLogEntry } from './settings';
import { todayTimerSummary } from './timerCompare';

const M = 60_000;
// 端末の時刻で今日の 10:00
const base = new Date(2026, 9, 25, 10, 0, 0).getTime();
const obs = (min: number, kind: string, detail?: Record<string, number>): StoredLogEntry =>
  ({ type: 'observation', kind, detail, at: base + min * M, minute: min }) as StoredLogEntry;

it('今日の記録で、30 分ごとのタイマーが入力中か AI の生成中に鳴った回数と、提案の回数を出す', () => {
  const log: StoredLogEntry[] = [
    obs(-24 * 60, 'prompt_sent'), // 昨日(数えない)
    obs(0, 'prompt_sent'),
    obs(29, 'typing_start'),
    obs(31, 'typing_end'), // 30 分: 入力中
    { type: 'prompt_shown', load: 82, mode: 'notify', waitedSec: 5, top: null, at: base + 45 * M, minute: 45 },
    obs(61, 'prompt_sent'), // 60 分: 何もしていない
  ];
  expect(todayTimerSummary(log, base + 70 * M)).toEqual({ ticks: 2, interrupted: 1, prompts: 1 });
});

it('記録が少ない(鳴った回数が 2 回未満)なら出さない', () => {
  expect(todayTimerSummary([obs(0, 'prompt_sent'), obs(40, 'prompt_sent')], base + 50 * M)).toBeNull();
  expect(todayTimerSummary([], base)).toBeNull();
});

it('回答を読んでいる最中(推定)にだけ鳴った回は、割り込みに数えない', () => {
  const log: StoredLogEntry[] = [
    obs(0, 'prompt_sent'),
    obs(25, 'response_done', { jaChars: 6530 }), // 25〜35 分は読む時間(推定)。30 分はここに当たる
    obs(61, 'prompt_sent'),
  ];
  expect(todayTimerSummary(log, base + 70 * M)).toEqual({ ticks: 2, interrupted: 0, prompts: 0 });
});
