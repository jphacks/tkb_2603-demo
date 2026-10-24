// 「30 分ごとのタイマーだったら」の比べ。記録(StoredLogEntry[])だけから計算する純粋な関数。
// パネルの詳細と scripts/analyze-log.ts の両方から使う。
// Node(scripts/)からそのまま動かすため、相対 import に .ts を付けている
import { DEFAULT_PARAMS } from '../core/types.ts';
import type { StoredLogEntry } from './settings.ts';

const MIN = 60_000;
/** 30 分ごとのタイマーの間隔 */
export const TIMER_INTERVAL_MIN = 30;
/** この時間記録が無ければ別の作業の回とみなす(器を 0 に戻す時間と同じ) */
export const SESSION_GAP_MIN = DEFAULT_PARAMS.dayResetIdleMin;

type Observation = Extract<StoredLogEntry, { type: 'observation' }>;

function observations(log: StoredLogEntry[], kind: string): Observation[] {
  return log.filter((e): e is Observation => e.type === 'observation' && e.kind === kind);
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export interface Interval {
  start: number;
  end: number;
}

/** start の出来事から、次の end の出来事までを区間にする。end が来なかったものは数えない */
function pairIntervals(log: StoredLogEntry[], startKind: string, endKind: string): Interval[] {
  const out: Interval[] = [];
  let open: number | null = null;
  for (const e of log) {
    if (e.type !== 'observation') continue;
    if (e.kind === startKind && open === null) open = e.at;
    else if (e.kind === endKind && open !== null) {
      out.push({ start: open, end: e.at });
      open = null;
    }
  }
  return out;
}

/** 回答を読む時間: response_done から、日本語 653 字/分 + 英語 238 語/分(core と同じ速さ) */
function readingIntervals(log: StoredLogEntry[]): Interval[] {
  return observations(log, 'response_done').map((e) => {
    const min = num(e.detail?.jaChars) / DEFAULT_PARAMS.jaCharsPerMin + num(e.detail?.enWords) / DEFAULT_PARAMS.enWordsPerMin;
    return { start: e.at, end: e.at + min * MIN };
  });
}

/** 記録が SESSION_GAP_MIN 以上途切れたところで分け、各回の初めから 30 分ごとの時刻を作る */
export function timerTicks(log: StoredLogEntry[], intervalMin = TIMER_INTERVAL_MIN): number[] {
  const times = log.map((e) => e.at).sort((a, b) => a - b);
  const ticks: number[] = [];
  let i = 0;
  while (i < times.length) {
    const start = times[i]!;
    let end = start;
    while (i + 1 < times.length && times[i + 1]! - times[i]! < SESSION_GAP_MIN * MIN) end = times[++i]!;
    i++;
    for (let t = start + intervalMin * MIN; t <= end; t += intervalMin * MIN) ticks.push(t);
  }
  return ticks;
}

export interface TimerComparison {
  ticks: number;
  generating: number;
  typing: number;
  reading: number;
  /** どれか 1 つでも当たった数(重なりは 1 回と数える) */
  anyBusy: number;
  /** 生成中か入力中に当たった数。読んでいる最中は推定なので入れない(パネルの 1 行はこれを使う) */
  genOrTyping: number;
  /** 記録にその出来事があったか(無いと 0 になるのは当然なので、表で区別する) */
  hasGeneration: boolean;
  hasTyping: boolean;
}

const inside = (t: number, xs: Interval[]) => xs.some((x) => x.start <= t && t < x.end);

export function compareTimer(log: StoredLogEntry[], intervalMin = TIMER_INTERVAL_MIN): TimerComparison {
  const sorted = [...log].sort((a, b) => a.at - b.at);
  const gen = pairIntervals(sorted, 'generation_start', 'response_done');
  const typ = pairIntervals(sorted, 'typing_start', 'typing_end');
  const read = readingIntervals(sorted);
  const ticks = timerTicks(sorted, intervalMin);
  let generating = 0;
  let typing = 0;
  let reading = 0;
  let anyBusy = 0;
  let genOrTyping = 0;
  for (const t of ticks) {
    const g = inside(t, gen);
    const ty = inside(t, typ);
    const r = inside(t, read);
    if (g) generating++;
    if (ty) typing++;
    if (r) reading++;
    if (g || ty || r) anyBusy++;
    if (g || ty) genOrTyping++;
  }
  return {
    ticks: ticks.length,
    generating,
    typing,
    reading,
    anyBusy,
    genOrTyping,
    hasGeneration: observations(sorted, 'generation_start').length > 0,
    hasTyping: observations(sorted, 'typing_start').length > 0,
  };
}

// ---- パネルの詳細に出す 1 行 ----

/** この数より鳴った回数が少ない日は出さない(記録が少なく、比べにならない) */
export const MIN_TICKS_TO_SHOW = 2;

export interface TodayTimerSummary {
  /** 30 分ごとのタイマーが鳴った回数 */
  ticks: number;
  /** そのうち、入力中か AI の生成中だった回数 */
  interrupted: number;
  /** ひといきが区切りで提案した回数 */
  prompts: number;
}

/** 今日(端末の時刻で 0 時から)の記録で比べる。記録が少なければ null */
export function todayTimerSummary(log: StoredLogEntry[], now = Date.now()): TodayTimerSummary | null {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const today = log.filter((e) => e.at >= midnight.getTime() && e.at <= now);
  const c = compareTimer(today);
  if (c.ticks < MIN_TICKS_TO_SHOW) return null;
  return { ticks: c.ticks, interrupted: c.genOrTyping, prompts: today.filter((e) => e.type === 'prompt_shown').length };
}
