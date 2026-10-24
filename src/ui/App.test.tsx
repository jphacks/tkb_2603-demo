// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatObserver } from '../content/observer';
import type { Runner, UiSnapshot } from '../content/runner';
import { CHATGPT } from '../content/sites';
import { initialState } from '../core/types';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { App } from './App';

// DEMO の切り替え(src/shared/flags.ts)の両方の値で、同じ画面のテストを通す
const flags = vi.hoisted(() => ({ demo: false }));
vi.mock('../shared/flags', () => ({
  get DEMO() {
    return flags.demo;
  },
}));

let root: Root;
let container: HTMLDivElement;
let update: (snapshot: UiSnapshot) => void;
let snap: UiSnapshot;

const runner = {
  subscribe: vi.fn((listener: (snapshot: UiSnapshot) => void) => { update = listener; listener(snap); return () => {}; }),
  respondToPrompt: vi.fn(), startManualBreak: vi.fn(), startDeferredBreak: vi.fn(), openOptions: vi.fn(),
  setMemo: vi.fn(), askEndBreak: vi.fn(), cancelEndBreak: vi.fn(), endBreakEarly: vi.fn(),
  sendFeedback: vi.fn(), dismissFinished: vi.fn(),
  // 位置合わせは本物の読み取り(ChatGPT の定義)で入力欄の外枠を探す
  composerContainer: () => new ChatObserver(CHATGPT, { onPromptSent() {}, onResponseDone() {}, onErrorPaste() {}, onConversationSwitch() {}, onActivity() {} }).composerContainer(),
};
const button = (label: string) => {
  const found = [...container.querySelectorAll('button')].find((element) => element.getAttribute('aria-label') === label || element.textContent === label);
  if (!found) throw new Error(`Button missing: ${label}`);
  return found;
};
const click = async (label: string) => { await act(async () => button(label).click()); };
const publish = async () => { await act(async () => update(snap)); };

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-24T03:00:00Z'));
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  document.documentElement.className = 'light';
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  const { apiKey: _, ...settings } = DEFAULT_SETTINGS;
  snap = {
    state: initialState(), settings: { ...settings, hasApiKey: false }, load: 0,
    clock: { minute: 0, sampledAt: Date.now() }, prompt: null, finishedBreak: null,
    confirmEndBreak: false, lastClassify: null,
    diagnostics: { site: 'chatgpt', matched: {}, assistantCount: 0, userCount: 0, generating: false, lastResponseChars: 0, lastResponseHead: '', completionMethod: null },
  };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<App runner={runner as unknown as Runner} />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.documentElement.className = '';
  vi.useRealTimers();
});

describe.each([false, true])('DEMO = %s', (demo) => {
  beforeEach(() => {
    flags.demo = demo;
  });

  describe('画像に合わせたUIの操作', () => {
    it('詳細の開閉、設定、手動休憩をつなぎ、閉じたらページ幅を戻す', async () => {
      await click('作業モニターを開く');
      expect(container.querySelectorAll('[role="meter"]')).toHaveLength(6);
      expect(container.querySelector('.hi-load-heading')?.textContent).toContain('0%');
      expect(container.querySelector<HTMLDetailsElement>('.hi-history')?.open).toBe(false);
      expect(container.textContent).toContain('未計測');
      expect(document.head.textContent).toContain('384px');
      await click('設定を開く');
      expect(runner.openOptions).toHaveBeenCalledOnce();
      await act(async () => container.querySelector('aside')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      expect(document.head.textContent).not.toContain('384px');
      expect(container.querySelector('aside')).toBeNull();
      await click('作業モニターを開く');
      await click('休憩する');
      expect(runner.startManualBreak).toHaveBeenCalledWith('');
    });

    it('通知は今休むか開始待ちの2択。待っている間も％と開始ボタンを表示する', async () => {
      snap = { ...snap, load: 85, prompt: { load: 85, minutes: 11, top: 'verification' } };
      await publish();
      await click('今11分休む');
      expect(runner.respondToPrompt).toHaveBeenLastCalledWith('now');
      await click('区切りがついたら休む');
      expect(runner.respondToPrompt).toHaveBeenLastCalledWith('next_breakpoint');
      snap = { ...snap, prompt: null, load: 95, state: { ...snap.state, prompt: { ...snap.state.prompt, waitingForUser: true } } };
      await publish();
      expect(container.querySelector('.hi-pill-percent')?.textContent).toBe('95%');
      expect(container.firstElementChild?.getAttribute('data-load-level')).toBe('warning');
      expect(container.querySelector('.hi-ready small')?.textContent).toBe('区切りがついたら');
      expect(container.querySelector('.hi-ready strong')?.textContent).toBe('14分休む');
      await click('区切りがついたら、14分休む');
      expect(runner.startDeferredBreak).toHaveBeenCalledOnce();
      snap = { ...snap, load: 100 };
      await publish();
      expect(container.firstElementChild?.getAttribute('data-load-level')).toBe('critical');
      expect(container.querySelector('.hi-ready strong')?.textContent).toBe('15分休む');
      expect(container.querySelector('.hi-ready')?.getAttribute('title')).toBe('15分の休憩を始める');
    });

    it('入力欄全体の上に配置し、画面変更と会話切替で入力欄が置き換わっても追従する', async () => {
      const form = document.createElement('form');
      form.innerHTML = '<div id="prompt-textarea" contenteditable="true"></div>';
      document.body.append(form);
      vi.spyOn(form, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 500, 600, 100));
      const refresh = async () => {
        await act(async () => {
          window.dispatchEvent(new Event('resize'));
          await vi.advanceTimersByTimeAsync(50);
        });
      };
      const bottom = () => parseFloat(container.querySelector<HTMLElement>('.hi-dock')!.style.bottom);
      await refresh();
      expect(bottom()).toBe(window.innerHeight - 500 + 16);
      const next = form.cloneNode(true) as HTMLFormElement;
      vi.spyOn(next, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 360, 600, 240));
      form.replaceWith(next);
      await refresh();
      expect(bottom()).toBe(window.innerHeight - 360 + 16);
      next.remove();
      await refresh();
      expect(bottom()).toBe(144);
      vi.restoreAllMocks();
    });

    it('80%未満ではアイコンに折りたため、80%以上では自動で数値に戻して詳細を開ける', async () => {
      snap = { ...snap, load: 79 };
      await publish();
      await click('計測表示を折りたたむ');
      expect(container.querySelector('.hi-pill-percent')).toBeNull();
      expect(container.querySelector('.hi-pill')?.getAttribute('title')).toContain('79%');
      await click('計測表示を広げる');
      expect(container.querySelector('.hi-pill-percent')?.textContent).toBe('79%');
      await click('計測表示を折りたたむ');
      for (const value of [80, 120]) {
        snap = { ...snap, load: value };
        await publish();
        expect(container.querySelector('.hi-pill-percent')?.textContent).toBe(`${value}%`);
        expect(container.querySelector('.hi-collapse-btn')).toBeNull();
        expect(container.querySelector('.hi-measure-collapsed')).toBeNull();
      }
      await click('作業モニターを開く');
      await click('作業モニターを閉じる');
      expect(container.querySelector('.hi-pill-percent')?.textContent).toBe('120%');
      // 詳細を開閉しても折りたたみの選択を保ち、80%未満に戻ったら適用する。
      snap = { ...snap, load: 30 };
      await publish();
      expect(container.querySelector('.hi-measure-collapsed')).not.toBeNull();
      await click('計測表示を広げる');
      expect(container.querySelector('.hi-pill-percent')?.textContent).toBe('30%');
      await click('作業モニターを開く');
      expect(container.querySelector('aside')).not.toBeNull();
    });

    it('秒表示は操作による再描画で戻らず、倍速と新しい時計に追従する', async () => {
      snap = { ...snap, settings: { ...snap.settings, speed: 10 }, clock: { minute: 2.5, sampledAt: Date.now() }, state: { ...snap.state, minute: 2, breakState: { startedAt: 0, plannedMin: 10, memo: '' } } };
      await publish();
      expect(container.querySelector('[role="timer"]')?.textContent).toBe('07:30');
      await act(async () => vi.advanceTimersByTime(1000));
      expect(container.querySelector('[role="timer"]')?.textContent).toBe('07:20');
      snap = { ...snap, state: { ...snap.state, breakState: { ...snap.state.breakState!, memo: 'テストを確認' } } };
      await publish();
      expect(container.querySelector('[role="timer"]')?.textContent).toBe('07:20');
      snap = { ...snap, clock: { minute: 2 + 40 / 60, sampledAt: Date.now() } };
      await publish();
      expect(container.querySelector('[role="timer"]')?.textContent).toBe('07:20');
      await click('休憩を終える');
      expect(runner.askEndBreak).toHaveBeenCalledOnce();
      snap = { ...snap, confirmEndBreak: true };
      await publish();
      await click('続ける');
      expect(runner.cancelEndBreak).toHaveBeenCalledOnce();
      await click('終える');
      expect(runner.endBreakEarly).toHaveBeenCalledOnce();
    });

    it.each([[118, 2], [0, 120]])('120%%を数値で表示し、器とリングは100%%に収める（RF=%s UF=%s）', async (rf, uf) => {
      snap = { ...snap, load: 120, state: { ...snap.state, rf, uf, history: [{ t: 0, load: 120 }] } };
      await publish();
      expect(container.querySelector('.hi-pill-percent')?.textContent).toBe('120%');
      const ring = container.querySelector('.hi-load-ring circle:last-child')!;
      expect(ring.getAttribute('stroke-dasharray')?.split(' ').map(Number)).toEqual([2 * Math.PI * 8, 2 * Math.PI * 8]);
      await click('作業モニターを開く');
      expect(container.querySelector('.hi-load-heading')?.textContent).toContain('120%');
      expect(container.querySelector('.hi-load-overflow')?.textContent).toContain('100%を超えています！ 現在120%');
      const meter = container.querySelector('.hi-load-bar')!;
      expect(meter.getAttribute('aria-valuenow')).toBe('100');
      expect(meter.getAttribute('aria-valuetext')).toContain('120%');
      const widths = ['.hi-load-uf', '.hi-load-rf'].map((selector) => parseFloat(container.querySelector<HTMLElement>(selector)!.style.width));
      expect(widths.every((width) => width >= 0)).toBe(true);
      expect(widths[0]! + widths[1]!).toBe(100);
      expect(container.querySelector('.hi-spark')?.getAttribute('aria-label')).toContain('150%');
      expect(Number(container.querySelector('.hi-spark-dot')?.getAttribute('cy'))).toBeGreaterThan(0);
    });

    it('休憩では1種類の運動を案内し、再描画で変えず、復帰メモと評価を扱える', async () => {
      snap = { ...snap, state: { ...snap.state, breakState: { startedAt: 0, plannedMin: 10, memo: 'テストを確認', stretch: 'shoulder' } } };
      await publish();
      expect(container.querySelector('input')?.value).toBe('テストを確認');
      expect(container.textContent).toContain('肩を回しましょう');
      expect(container.querySelector('.hi-tabs')).toBeNull();
      expect(container.querySelector('.hi-picto-shoulder')).not.toBeNull();
      snap = { ...snap, clock: { ...snap.clock, minute: 1 } };
      await publish();
      expect(container.querySelector('.hi-picto-shoulder')).not.toBeNull();
      snap = { ...snap, prompt: null, state: { ...snap.state, breakState: null }, finishedBreak: { memo: 'テストを確認', plannedMin: 10, top: 'reading' } };
      await publish();
      expect(container.textContent).toContain('テストを確認');
      await click('よかった');
      expect(runner.sendFeedback).toHaveBeenCalledWith('good');
    });

    it('ChatGPTのテーマ変更に追従し、計測停止時はパネルの領域も解除する', async () => {
      expect(container.firstElementChild?.getAttribute('data-theme')).toBe('light');
      await act(async () => { document.documentElement.className = 'dark'; });
      expect(container.firstElementChild?.getAttribute('data-theme')).toBe('dark');
      await click('作業モニターを開く');
      snap = { ...snap, settings: { ...snap.settings, enabled: false } };
      await publish();
      expect(container.innerHTML).toBe('');
      expect(document.head.textContent).not.toContain('384px');
    });
  });

  it('診断は DEMO の時だけ出す', async () => {
    await click('作業モニターを開く');
    expect(container.querySelector('.hi-diagnostics') !== null).toBe(demo);
  });
});

describe('30 分ごとのタイマーとの比べ', () => {
  it('今日の記録が十分なら、パネルの詳細に 1 行出す', async () => {
    const base = Date.now() - 70 * 60_000;
    const log = [0, 29, 31, 61].map((min, i) => ({
      type: 'observation', kind: ['prompt_sent', 'typing_start', 'typing_end', 'prompt_sent'][i], at: base + min * 60_000, minute: min,
    }));
    vi.stubGlobal('browser', { storage: { local: { get: vi.fn().mockResolvedValue({ 'hitoiki:log': log }) } } });
    try {
      await click('作業モニターを開く');
      await act(async () => {});
      expect(container.querySelector('.hi-timer-compare')?.textContent).toBe(
        '30 分ごとのタイマーだったら、今日 2 回のうち 1 回は入力中か AI の生成中に鳴っていました。ひといきは 0 回、区切りで提案しました。',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('記録が読めない・少ない時は出さない', async () => {
    await click('作業モニターを開く');
    await act(async () => {});
    expect(container.querySelector('.hi-timer-compare')).toBeNull();
  });
});
