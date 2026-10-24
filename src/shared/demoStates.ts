// デモ用: 器を決まった状態から始める。作るのは core の状態(EngineState)だけで、
// その後の計算は本物と同じ。デモ repo(DEMO = true)の設定画面と VS Code のコマンドから使う
import { type EngineState, type ElementValues, DEFAULT_PARAMS, initialState } from '../core/types';

export type DemoStateId = 'empty' | 'near' | 'before_break';

export const DEMO_STATES: { id: DemoStateId; label: string; hint: string }[] = [
  { id: 'empty', label: '器 0 から', hint: '何もたまっていない状態' },
  { id: 'near', label: '器 75% から', hint: 'すぐ提案が出る手前' },
  { id: 'before_break', label: '休憩の直前', hint: '80% を超えて、区切りを待っている' },
];

/** 器の量(RF + UF)を、core と同じ割合(rho)で 2 層に分ける */
function fill(load: number): Pick<EngineState, 'rf' | 'uf'> {
  const uf = load * DEFAULT_PARAMS.rho;
  return { rf: load - uf, uf };
}

/** ここまでにたまった内訳(理由の文に使う)。確認・検証が一番多い作業にしておく */
function contrib(load: number): ElementValues {
  return { reading: load * 0.25, decision: 0, verification: load * 0.35, switching: load * 0.15, time: load * 0.25 };
}

/**
 * 今の状態から、デモの状態を作る。時計(minute)と LLM が使えるかは引き継ぐ。
 * 作業中(直近に操作あり)にしておくので、そのまま器が動く
 */
export function demoState(id: DemoStateId, current: EngineState): EngineState {
  const t = current.minute;
  const base: EngineState = {
    ...initialState(),
    minute: t,
    lastActivityAt: t,
    lastWorkAt: t,
    llmAvailable: current.llmAvailable,
  };
  if (id === 'empty') return base;
  if (id === 'near') return { ...base, ...fill(75), contribSinceBreak: contrib(75), recent: { ...base.recent, verification: [t, t] } };
  // 80% を超えている。読む残りを少し残し、計算上 2 分ほどで区切りになる
  return { ...base, ...fill(84), contribSinceBreak: contrib(84), readBacklogMin: 2, recent: { ...base.recent, verification: [t, t] } };
}
