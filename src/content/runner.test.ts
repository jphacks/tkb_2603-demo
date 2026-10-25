// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState } from '../core/types';
import { DEFAULT_SETTINGS, loadEngine, loadSettings, saveEngine, onEngineChanged, onSettingsChanged, appendLog, drainInbox } from '../shared/settings';
import { Runner, type UiSnapshot } from './runner';

vi.mock('../shared/settings', async (original) => ({
  ...await original<typeof import('../shared/settings')>(),
  loadEngine: vi.fn(), loadSettings: vi.fn(), saveEngine: vi.fn(), appendLog: vi.fn(),
  drainInbox: vi.fn(), onEngineChanged: vi.fn(), onSettingsChanged: vi.fn(), onInboxChanged: vi.fn(),
}));
vi.mock('./observer', () => ({
  ChatObserver: class {
    constructor(_site: unknown, callbacks: typeof observerCallbacks) { observerCallbacks = callbacks; }
    site = { id: 'chatgpt' };
    composerContainer() { return null; }
    diagnostics = { site: 'chatgpt', matched: {}, assistantCount: 0, userCount: 0, generating: false, lastResponseChars: 0, lastResponseHead: '', completionMethod: null };
    lastResponseDoneAt = null;
    start() {}
    isGenerating() { return false; }
    isTyping() { return false; }
    composerText() { return ''; }
  },
}));

let observerCallbacks: {
  onResponseDone(text: string, user: string, continuation: boolean, method?: 'stop_button' | 'quiet'): void;
  onPromptSent(text: string): void;
  onErrorPaste(lines: number): void;
  onConversationSwitch(): void;
};

let snap: UiSnapshot;
let unsubscribe: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-24T04:00:00Z'));
  vi.clearAllMocks();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.mocked(loadSettings).mockResolvedValue({ ...DEFAULT_SETTINGS });
  vi.mocked(loadEngine).mockResolvedValue({ state: { ...initialState(), rf: 85, lastActivityAt: 0 }, realSavedAt: Date.now(), lastTickReal: Date.now() });
  vi.mocked(drainInbox).mockResolvedValue([]);
});
afterEach(() => {
  unsubscribe?.();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('同意後は個人キーなしでも分類し、障害時には読む量などのローカル計測を保つ', async () => {
  vi.mocked(loadSettings).mockResolvedValue({ ...DEFAULT_SETTINGS, classificationConsent: 'accepted', classificationConsentVersion: 1 });
  const sendMessage = vi.fn().mockResolvedValue({ ok: false, error: 'proxy_rate_limited', model: 'proxy', ms: 0 });
  vi.stubGlobal('browser', { runtime: { sendMessage } });
  const runner = new Runner(); await runner.start();
  unsubscribe = runner.subscribe((value) => { snap = value; });
  observerCallbacks.onResponseDone('テスト'.repeat(300), '質問', false);
  await Promise.resolve(); await Promise.resolve();
  expect(sendMessage).toHaveBeenCalledOnce();
  expect(snap.state.readBacklogMin).toBeGreaterThan(0);
  expect(snap.state.llmAvailable).toBe(false);
});

it('同意を取り消す前に開始した遅い分類結果を反映しない', async () => {
  const accepted = { ...DEFAULT_SETTINGS, classificationConsent: 'accepted' as const, classificationConsentVersion: 1 };
  vi.mocked(loadSettings).mockResolvedValue(accepted);
  let resolve!: (value: unknown) => void;
  vi.stubGlobal('browser', { runtime: { sendMessage: vi.fn(() => new Promise((done) => { resolve = done; })) } });
  const runner = new Runner(); await runner.start();
  unsubscribe = runner.subscribe((value) => { snap = value; });
  observerCallbacks.onResponseDone('回答', '質問', false);
  vi.mocked(onSettingsChanged).mock.calls.at(-1)![0]({ ...accepted, classificationConsent: 'declined' });
  resolve({ ok: true, result: { decision_requests: [{ span: 'choose' }], verification_events: [], topic_shift: { shift: true, current_task: 'private' } }, model: 'test', ms: 1, inputTokens: 1, outputTokens: 1 });
  await Promise.resolve(); await Promise.resolve();
  expect(snap.state.llmAvailable).toBe(false);
  expect(snap.state.recent.decision).toHaveLength(0);
  expect(snap.lastClassify).toBeNull();
  expect(vi.mocked(appendLog).mock.calls.some(([entry]) => entry.type === 'observation' && entry.kind === 'classified')).toBe(false);
});

it('計測を止めている時は、送信・エラーの貼り付け・会話の切替を記録しない(設定画面の「止めると何も記録しません」)', async () => {
  vi.mocked(loadSettings).mockResolvedValue({ ...DEFAULT_SETTINGS, enabled: false });
  vi.stubGlobal('browser', { runtime: { sendMessage: vi.fn() } });
  const runner = new Runner(); await runner.start();
  vi.mocked(appendLog).mockClear();
  observerCallbacks.onPromptSent('質問');
  observerCallbacks.onErrorPaste(3);
  observerCallbacks.onConversationSwitch();
  observerCallbacks.onResponseDone('回答', '質問', false, 'quiet');
  await Promise.resolve();
  expect(appendLog).not.toHaveBeenCalled();
});

it('回答の記録に、終わりをどちらで決めたかを入れる', async () => {
  vi.stubGlobal('browser', { runtime: { sendMessage: vi.fn() } });
  const runner = new Runner(); await runner.start();
  observerCallbacks.onPromptSent('質問');
  observerCallbacks.onResponseDone('回答', '質問', false, 'quiet');
  const kinds = vi.mocked(appendLog).mock.calls.map(([e]) => e).filter((e) => e.type === 'observation');
  expect(kinds.map((e) => e.type === 'observation' && e.kind)).toEqual(['prompt_sent', 'response_done']);
  expect(kinds[1]!.type === 'observation' && kinds[1]!.detail?.end).toBe('quiet');
});

describe('休憩の開始をユーザーに任せる', () => {
  it('待機を保存し、再読込しても通知やタイマーを重ねず、現在の器で開始する', async () => {
    const runner = new Runner();
    await runner.start();
    unsubscribe = runner.subscribe((value) => { snap = value; });
    await vi.advanceTimersByTimeAsync(1000);
    expect(snap.prompt).not.toBeNull();
    expect(snap.state.breakState).toBeNull();
    runner.respondToPrompt('next_breakpoint');
    expect(snap.state.prompt.waitingForUser).toBe(true);
    const saved = vi.mocked(saveEngine).mock.calls.at(-1)!;
    expect(saved[0].prompt.waitingForUser).toBe(true);

    // 再読込: 保存された開始待ちの状態を新しいRunnerで復元する。
    vi.mocked(loadEngine).mockResolvedValue({ state: structuredClone(saved[0]), realSavedAt: Date.now(), lastTickReal: Date.now() });
    const restored = new Runner();
    await restored.start();
    unsubscribe();
    unsubscribe = restored.subscribe((value) => { snap = value; });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(snap.prompt).toBeNull();
    expect(snap.state.breakState).toBeNull();
    expect(snap.load).toBeGreaterThan(85);

    // ほかのタブの計測で100%を超えた場合も、実値を保ち、開始操作までは休憩しない。
    const receive = vi.mocked(onEngineChanged).mock.calls.at(-1)![0];
    receive({ state: { ...snap.state, rf: 118, uf: 2 }, realSavedAt: Date.now(), lastTickReal: Date.now(), writer: 'another-tab' });
    expect(snap.load).toBe(120);
    expect(snap.state.breakState).toBeNull();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    restored.startDeferredBreak();
    expect(snap.state.breakState?.plannedMin).toBe(15);
    expect(snap.state.breakState?.stretch).toBe('shoulder');
    expect(snap.state.prompt.waitingForUser).toBe(false);
    expect(vi.mocked(saveEngine).mock.calls.at(-1)![0].breakState?.stretch).toBe('shoulder');
    expect(vi.mocked(saveEngine).mock.calls.at(-1)![0].rf).toBe(118);
    random.mockRestore();
    const starts = vi.mocked(appendLog).mock.calls.filter(([entry]) => entry.type === 'break_start').length;
    restored.startDeferredBreak();
    expect(vi.mocked(appendLog).mock.calls.filter(([entry]) => entry.type === 'break_start')).toHaveLength(starts);
  });

  it.each([[0, 'reach'], [0.5, 'shoulder'], [0.99, 'sway']] as const)('運動を休憩開始時に1回だけ選んで保存する (%s)', async (randomValue, expected) => {
    const runner = new Runner();
    await runner.start();
    unsubscribe = runner.subscribe((value) => { snap = value; });
    vi.spyOn(Math, 'random').mockReturnValue(randomValue);
    runner.startManualBreak('続きの確認');
    expect(snap.state.breakState?.stretch).toBe(expected);
    runner.setMemo('メモを編集');
    await vi.advanceTimersByTimeAsync(2000);
    expect(snap.state.breakState?.stretch).toBe(expected);
    expect(vi.mocked(saveEngine).mock.calls.at(-1)![0].breakState?.stretch).toBe(expected);
  });
});
