import { expect, it } from 'vitest';
import type { StoredLogEntry } from '../src/shared/settings';
import { checkReport, entriesIn, parseLocalTime, parseRange, siteFlow } from './check-log';

const m = 60_000;
const o = (min: number, kind: string, site: string, detail?: Record<string, number | boolean | string>): StoredLogEntry =>
  ({ type: 'observation', kind, detail, at: min * m, minute: min, site });
const c = (min: number, ok: boolean, site: string): StoredLogEntry =>
  ({ type: 'classify', ok, model: 'claude-haiku-5-5', ms: 1000, at: min * m, minute: min, site });

it('サイトごとに、送信・続きを除いた回答・生成の始まり・終わりの決め方・分類を数える', () => {
  const log = [
    o(1, 'prompt_sent', 'chatgpt'),
    o(2, 'prompt_sent', 'chatgpt'),
    o(2, 'response_done', 'chatgpt', { continuation: false, end: 'quiet' }),
    o(3, 'prompt_sent', 'claude'),
    o(3, 'generation_start', 'claude'),
    o(4, 'response_done', 'claude', { continuation: false, end: 'stop_button' }),
    c(4, true, 'claude'),
    o(5, 'response_done', 'claude', { continuation: true }),
  ];
  expect(siteFlow(log)).toEqual({
    chatgpt: { sent: 2, responses: 1, continuations: 0, generationStarts: 0, endStopButton: 0, endQuiet: 1, endUnknown: 0, classifyOk: 0, classifyFailed: 0 },
    claude: { sent: 1, responses: 1, continuations: 1, generationStarts: 1, endStopButton: 1, endQuiet: 0, endUnknown: 1, classifyOk: 1, classifyFailed: 0 },
  });
  expect(checkReport(log, null, null)).toContain('| chatgpt | 2 | 1 | 0 | 0 | 0 / 1 / 0 | 0 / 0 |');
});

it('取り消していた間・止めていた間だけを数え、戻した後の記録は入れない', () => {
  const log = [c(1, true, 'chatgpt'), o(5, 'response_done', 'chatgpt', { continuation: false }), c(6, true, 'chatgpt'), c(20, true, 'gemini'), o(21, 'prompt_sent', 'gemini')];
  expect(entriesIn(log, { from: 3 * m, to: 10 * m }, 'classify')).toHaveLength(1);
  expect(entriesIn(log, { from: 3 * m, to: Infinity })).toHaveLength(4);
  const text = checkReport(log, { from: 7 * m, to: 10 * m }, { from: 7 * m, to: 10 * m });
  expect(text).toContain('classify 0 件');
  expect(text).toContain('計測を止めていた間');
  expect(text).toContain('0 件(0 件なら OK)');
});

it('表を数える間を決めると、その間の記録だけでサイト別の表を作る', () => {
  const log = [o(1, 'prompt_sent', 'chatgpt'), o(10, 'prompt_sent', 'chatgpt'), o(11, 'prompt_sent', 'chatgpt')];
  expect(checkReport(log, null, null, { from: 10 * m, to: Infinity })).toContain('| chatgpt | 2 |');
});

it('時刻は手元の時刻として秒まで読み、読めなければ null', () => {
  expect(parseLocalTime('2026-10-25 11:05')).toBe(new Date(2026, 9, 25, 11, 5).getTime());
  expect(parseLocalTime('2026-10-25 11:05:40')).toBe(new Date(2026, 9, 25, 11, 5, 40).getTime());
  expect(parseLocalTime('')).toBeNull();
  expect(parseLocalTime('あとで')).toBeNull();
});

it('間は「始め〜終わり」で読み、終わりの日付は省ける。時刻 1 つなら最後まで', () => {
  expect(parseRange('2026-10-25 11:05:40〜11:12:10')).toEqual({
    from: new Date(2026, 9, 25, 11, 5, 40).getTime(),
    to: new Date(2026, 9, 25, 11, 12, 10).getTime(),
  });
  expect(parseRange('2026-10-25 11:05:40 ~ 2026-10-25 11:12')).toEqual({
    from: new Date(2026, 9, 25, 11, 5, 40).getTime(),
    to: new Date(2026, 9, 25, 11, 12).getTime(),
  });
  expect(parseRange('2026-10-25 11:05:40')).toEqual({ from: new Date(2026, 9, 25, 11, 5, 40).getTime(), to: Infinity });
  expect(parseRange('')).toBeNull();
  expect(parseRange('あとで〜11:00')).toBeNull();
});
