// 器を動かす係。AI チャット(ChatGPT・Claude・Gemini)のタブの中で、計算上の 1 分ごとに tick する(service worker は 30 秒で止まるため)。
// デモの倍速では、実時間 60 秒 ÷ speed ごとに 1 分進める。同じ計算を通す。
import { applyPromptAction, type GateContext, type PromptAction, shouldPrompt } from '../core/gate';
import {
  breakMinutes,
  endBreak,
  load,
  observe,
  splitText,
  startBreak,
  tick,
  topContributor,
} from '../core/model';
import { type ElementKey, type EngineState, initialState, type Observation, type StretchId } from '../core/types';
import type { ClassifyResponse, ClassifyRequest } from '../shared/messages';
import {
  appendLog,
  type LogEntry,
  loadEngine,
  loadSettings,
  appendInbox,
  drainInbox,
  onInboxChanged,
  onEngineChanged,
  onSettingsChanged,
  paramsFrom,
  saveEngine,
  saveSettings,
  type Settings,
} from '../shared/settings';
import { ChatObserver, type CompletionMethod } from './observer';
import { detectSite } from './sites';
import { canClassify, CONSENT_VERSION } from '../shared/privacy';

export interface PromptInfo {
  load: number;
  minutes: number;
  top: ElementKey | null;
}

export interface FinishedBreak {
  memo: string;
  plannedMin: number;
  top: ElementKey | null;
}

export interface UiSnapshot {
  state: EngineState;
  /** 秒表示用の、計算時計と実時刻の対応 */
  clock: { minute: number; sampledAt: number };
  /** API キーは UI に渡さない(有無だけ) */
  settings: Omit<Settings, 'apiKey'> & { hasApiKey: boolean };
  load: number;
  prompt: PromptInfo | null;
  finishedBreak: FinishedBreak | null;
  confirmEndBreak: boolean;
  diagnostics: ChatObserver['diagnostics'];
  lastClassify: { ok: boolean; model: string; ms: number; error?: string } | null;
}

type Listener = (snap: UiSnapshot) => void;

export class Runner {
  private state!: EngineState;
  private settings!: Settings;
  private observer: ChatObserver;
  private listeners = new Set<Listener>();
  private tickTimer: number | null = null;
  private gateTimer: number | null = null;
  private prompt: PromptInfo | null = null;
  private needSinceReal: number | null = null;
  private finishedBreak: FinishedBreak | null = null;
  private confirmEndBreak = false;
  private previousTask = '';
  private classificationEpoch = 0;
  private lastClassify: UiSnapshot['lastClassify'] = null;
  private breakTopAtStart: ElementKey | null = null;
  private readonly tabId = Math.random().toString(36).slice(2);
  /** 最後に計算上の 1 分を進めた実時刻(ms) */
  private lastTickReal = Date.now();

  constructor() {
    this.observer = new ChatObserver(detectSite(location.hostname), {
      onPromptSent: (text) => this.onPromptSent(text),
      onResponseDone: (text, userText, continuation, method) => this.onResponseDone(text, userText, continuation, method),
      onErrorPaste: (lines) => {
        this.push({ kind: 'verification', t: this.state.minute, count: 1, source: 'paste' });
        void this.logIfEnabled({ type: 'observation', kind: 'error_paste', detail: { lines } });
      },
      onConversationSwitch: () => {
        this.push({ kind: 'switch', t: this.state.minute, source: 'url' });
        void this.logIfEnabled({ type: 'observation', kind: 'conversation_switch' });
      },
      onActivity: () => this.push({ kind: 'activity', t: this.state.minute }),
      // 記録だけ(計算には使わない)。30 分タイマーとの比べに使う
      onGenerationStart: () => void this.logIfEnabled({ type: 'observation', kind: 'generation_start' }),
      onTypingStart: () => void this.logIfEnabled({ type: 'observation', kind: 'typing_start' }),
      onTypingEnd: () => void this.logIfEnabled({ type: 'observation', kind: 'typing_end' }),
    });
  }

  async start(): Promise<void> {
    this.settings = await loadSettings();
    const saved = await loadEngine();
    this.state = saved.state;
    this.lastTickReal = saved.lastTickReal ?? saved.realSavedAt;
    this.state.llmAvailable = false;
    onSettingsChanged((s) => {
      const speedChanged = s.speed !== this.settings.speed;
      // 倍速を切り替える前に、今までの分を元の速さで進めておく(切り替えた瞬間に跳ねないように)
      if (speedChanged) {
        this.onTick();
        this.lastTickReal = Date.now();
      }
      this.settings = s;
      this.classificationEpoch++;
      this.previousTask = '';
      this.lastClassify = null;
      this.state.llmAvailable = false;
      if (speedChanged) this.restartTick();
      this.emit();
    });
    onInboxChanged(() => {
      if (this.isLeader()) void this.drain();
    });
    // ほかのタブの保存を取り込む(タブごとに別々の器にならないように)
    onEngineChanged((saved) => {
      if (saved === null) {
        // 「記録を消す」で消えた
        this.state = { ...initialState(), llmAvailable: this.state.llmAvailable };
        this.lastTickReal = Date.now();
        this.prompt = null;
        this.finishedBreak = null;
        this.emit();
        return;
      }
      if (saved.writer === this.tabId) return;
      const before = this.state;
      this.state = { ...saved.state, llmAvailable: this.state.llmAvailable };
      if (saved.lastTickReal) this.lastTickReal = saved.lastTickReal;
      // ほかのタブで休憩を始めた・提案に答えた → このタブに残った古い提案を消す
      if (saved.state.breakState || saved.state.prompt.notBefore !== before.prompt.notBefore || saved.state.prompt.waitingForUser !== before.prompt.waitingForUser) {
        this.prompt = null;
      }
      this.emit();
    });
    // 表に出たら、裏にあった間の時間をすぐ進める
    document.addEventListener('visibilitychange', () => this.onTick());
    this.observer.start();
    this.restartTick();
    // 閉じていた間の時間を、壁時計の差で進める(作業していないので器は動かない。休憩中なら減る。3 時間で 0 に戻る)
    this.onTick();
    this.gateTimer = window.setInterval(() => this.checkGate(), 1000);
    this.emit();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => this.listeners.delete(fn);
  }

  private snapshot(): UiSnapshot {
    const sampledAt = Date.now();
    return {
      state: this.state,
      clock: {
        minute: this.state.minute + Math.max(0, ((sampledAt - this.lastTickReal) / 60_000) * this.settings.speed),
        sampledAt,
      },
      settings: (({ apiKey, ...rest }) => ({ ...rest, hasApiKey: !!apiKey }))(this.settings),
      load: load(this.state),
      prompt: this.prompt,
      finishedBreak: this.finishedBreak,
      confirmEndBreak: this.confirmEndBreak,
      diagnostics: { ...this.observer.diagnostics, matched: { ...this.observer.diagnostics.matched } },
      lastClassify: this.lastClassify,
    };
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const fn of this.listeners) fn(snap);
  }

  private restartTick(): void {
    if (this.tickTimer !== null) clearInterval(this.tickTimer);
    const intervalMs = Math.max(250, 60_000 / Math.max(1, this.settings.speed) / 4);
    this.tickTimer = window.setInterval(() => this.onTick(), intervalMs);
  }

  private async log(entry: LogEntry): Promise<void> {
    await appendLog(entry, this.state.minute, this.observer.site.id);
  }

  private async logIfEnabled(entry: LogEntry): Promise<void> {
    if (this.settings?.enabled) await this.log(entry);
  }

  /** 常駐ボタンの位置合わせに使う、入力欄の外枠(サイトごとに違う) */
  composerContainer(): HTMLElement | null {
    return this.observer.composerContainer();
  }

  /** 表に出ているタブが器を持つ(ほかのタブは受け箱に出来事を足すだけ) */
  private isLeader(): boolean {
    return document.visibilityState === 'visible';
  }

  private push(obs: Observation): void {
    if (!this.settings.enabled) return;
    if (!this.isLeader()) {
      void appendInbox(obs);
      return;
    }
    this.state = observe(this.state, obs, paramsFrom(this.settings));
    this.saveSoon();
    this.emit();
  }

  /** 裏のタブで起きた出来事を取り込む。時刻は今の計算上の分に合わせる */
  private draining = false;
  private async drain(): Promise<void> {
    // onTick と onInboxChanged の両方から呼ばれるので、同じ出来事を 2 回取り込まないよう 1 本にする
    if (this.draining) return;
    this.draining = true;
    try {
      const box = await drainInbox();
      if (!box.length) return;
      const p = paramsFrom(this.settings);
      for (const obs of box) this.state = observe(this.state, { ...obs, t: this.state.minute }, p);
      this.save();
      this.emit();
    } finally {
      this.draining = false;
    }
  }

  /** 計算上の 1 分を進める。休憩の予定時間が過ぎたら休憩を終える。
   *  present: 目の前に人がいる 1 分か(最後の 1 分だけ true。閉じていた間の補正では false) */
  private advance(present: boolean): void {
    const res = tick(this.state, paramsFrom(this.settings));
    this.state = res.state;
    if (res.dayReset) {
      this.prompt = null;
      void this.log({ type: 'day_reset' });
    }
    const b = this.state.breakState;
    if (b && this.state.minute - b.startedAt >= b.plannedMin) this.finishBreak(true, present);
  }

  private onTick(): void {
    // 複数のタブで同じ 1 分を 2 回数えないよう、表に出ているタブだけが進める。
    // 裏にあった間の時間は、表に戻った時にまとめて進める(作業していないので器は動かず、3 時間で 0 に戻る)
    if (!this.isLeader()) return;
    void this.drain();
    if (!this.settings.enabled) {
      this.lastTickReal = Date.now();
      return;
    }
    const due = Math.floor(((Date.now() - this.lastTickReal) / 60_000) * this.settings.speed);
    if (due < 1) return;
    const n = Math.min(due, 24 * 60);
    for (let i = 0; i < n; i++) this.advance(i === n - 1 && due <= 2);
    this.lastTickReal += (due * 60_000) / this.settings.speed;
    this.save();
    this.emit();
  }

  private save(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    void saveEngine(this.state, this.tabId, this.lastTickReal);
  }

  private saveTimer: number | null = null;
  /** 出来事のたびに保存すると多いので、少しまとめる */
  private saveSoon(): void {
    if (this.saveTimer !== null) return;
    this.saveTimer = window.setTimeout(() => this.save(), 1500);
  }

  private gateContext(): GateContext {
    const doneAt = this.observer.lastResponseDoneAt;
    return {
      generating: this.observer.isGenerating(),
      typing: this.observer.isTyping(),
      composerHasText: this.observer.composerText().length > 0,
      tabVisible: document.visibilityState === 'visible',
      secondsSinceResponse: doneAt === null ? null : ((Date.now() - doneAt) / 1000) * this.settings.speed,
      quietSeconds: 10,
    };
  }

  private checkGate(): void {
    // 提案を出すのは表のタブだけ(タブの数だけ提案・記録が出ないように)
    if (!this.isLeader()) return;
    if (!this.settings.enabled || this.prompt || this.state.breakState || this.finishedBreak || this.state.prompt.waitingForUser) return;
    const p = paramsFrom(this.settings);
    const ctx = this.gateContext();
    const needNow = load(this.state) >= p.threshold && this.state.minute >= this.state.prompt.notBefore;
    if (needNow && this.needSinceReal === null) this.needSinceReal = Date.now();
    if (!needNow) this.needSinceReal = null;
    if (!shouldPrompt(this.state, p, ctx)) return;

    const l = load(this.state);
    const top = topContributor(this.state);
    const minutes = breakMinutes(l, this.settings.breakScale);
    this.prompt = { load: l, minutes, top };
    const waitedSec = this.needSinceReal === null ? null : Math.round((Date.now() - this.needSinceReal) / 1000);
    void this.log({ type: 'prompt_shown', load: Math.round(l), mode: this.settings.mode, waitedSec, top });
    this.emit();
  }

  // ---- 画面からの操作 ----

  respondToPrompt(action: PromptAction, memo = ''): void {
    this.onTick();
    if (!this.prompt) return;
    void this.log({ type: 'prompt_action', action });
    if (action === 'now') {
      if (!this.state.breakState) this.beginBreak(breakMinutes(load(this.state), this.settings.breakScale), memo);
    } else {
      this.state = applyPromptAction(this.state, action);
    }
    this.prompt = null;
    this.needSinceReal = null;
    this.save();
    this.emit();
  }

  /** 器が低くても自分で休憩を始める */
  startManualBreak(memo: string): void {
    if (!this.settings.enabled || this.state.breakState) return;
    this.onTick();
    this.prompt = null;
    this.beginBreak(breakMinutes(Math.max(80, load(this.state)), this.settings.breakScale), memo);
  }

  /** 待っている間は計測を継続。押した時点の器に合わせて休憩を始める。 */
  startDeferredBreak(): void {
    if (!this.settings.enabled || !this.state.prompt.waitingForUser || this.state.breakState) return;
    this.onTick();
    if (!this.state.prompt.waitingForUser) return;
    void this.log({ type: 'prompt_action', action: 'now' });
    this.prompt = null;
    this.beginBreak(breakMinutes(load(this.state), this.settings.breakScale), '');
  }

  setMemo(memo: string): void {
    if (!this.state.breakState) return;
    this.state = { ...this.state, breakState: { ...this.state.breakState, memo } };
    this.saveSoon();
    this.emit();
  }

  private beginBreak(minutes: number, memo: string): void {
    this.breakTopAtStart = topContributor(this.state);
    void this.log({ type: 'break_start', plannedMin: minutes, hasMemo: memo.length > 0, load: Math.round(load(this.state)) });
    const stretches: StretchId[] = ['reach', 'shoulder', 'sway'];
    const stretch = stretches[Math.floor(Math.random() * stretches.length)]!;
    this.state = startBreak(this.state, minutes, memo, stretch);
    this.confirmEndBreak = false;
    this.save();
    this.emit();
  }

  private finishBreak(completed: boolean, present = true): void {
    const b = this.state.breakState;
    if (!b) return;
    void this.log({
      type: 'break_end',
      plannedMin: b.plannedMin,
      actualMin: this.state.minute - b.startedAt,
      completed,
    });
    this.finishedBreak = { memo: b.memo, plannedMin: b.plannedMin, top: this.breakTopAtStart };
    this.state = endBreak(this.state, present);
    this.confirmEndBreak = false;
    this.prompt = null;
    this.save();
    this.emit();
  }

  /** 休憩を途中で終える(確認の後) */
  endBreakEarly(): void {
    this.finishBreak(false);
  }

  askEndBreak(): void {
    this.confirmEndBreak = true;
    this.emit();
  }

  cancelEndBreak(): void {
    this.confirmEndBreak = false;
    this.emit();
  }

  sendFeedback(value: 'good' | 'ok' | 'unneeded'): void {
    void this.log({ type: 'feedback', value });
    this.finishedBreak = null;
    this.emit();
  }

  dismissFinished(): void {
    this.finishedBreak = null;
    this.emit();
  }

  openOptions(): void {
    void browser.runtime.sendMessage({ type: 'open_options' });
  }

  // ---- AI チャットからの出来事 ----

  private onPromptSent(text: string): void {
    this.push({ kind: 'prompt_sent', t: this.state.minute, chars: text.length });
    void this.logIfEnabled({ type: 'observation', kind: 'prompt_sent', detail: { chars: text.length } });
    // 休憩中に送信したら、休憩を終えるか確認する(決定)
    if (this.state.breakState) this.askEndBreak();
  }

  /** continuation: 終わったと思った回答が、その後も伸びた分(読む量だけ足し、分類はしない)。end: 終わりをどちらで決めたか */
  private onResponseDone(text: string, userText: string, continuation: boolean, end: CompletionMethod): void {
    // 計測を止めている時は、記録も API への送信もしない
    if (!this.settings.enabled) return;
    const { jaChars, enWords } = splitText(text);
    this.push({ kind: 'response_done', t: this.state.minute, chars: jaChars, enWords });
    void this.log({ type: 'observation', kind: 'response_done', detail: { jaChars, enWords, continuation, end } });
    if (!continuation) void this.classify(userText, text);
  }

  private async classify(userText: string, assistantText: string): Promise<void> {
    if (!canClassify(this.settings)) return;
    const epoch = this.classificationEpoch;
    const req: ClassifyRequest = { type: 'classify', userText, assistantText, previousTask: this.previousTask };
    let res: ClassifyResponse;
    try {
      res = await browser.runtime.sendMessage(req);
    } catch {
      res = { ok: false, error: 'classification_unavailable', model: this.settings.classifierMode === 'proxy' ? 'proxy' : this.settings.model, ms: 0 };
    }
    // 同意の取消・停止・接続先の変更より前に始まった応答を適用しない。
    if (!canClassify(this.settings) || epoch !== this.classificationEpoch) return;
    this.lastClassify = res.ok
      ? { ok: true, model: res.model, ms: res.ms }
      : { ok: false, model: res.model, ms: res.ms, error: res.error };
    void this.log({
      type: 'classify',
      ok: res.ok,
      model: res.model,
      ms: res.ms,
      error: res.ok ? undefined : res.error,
      inputTokens: res.ok ? res.inputTokens : undefined,
      outputTokens: res.ok ? res.outputTokens : undefined,
    });
    // 使えなかった時は、内部で判断を「未計測」とする(器は ÷5 のまま遅めにたまる)
    this.state.llmAvailable = res.ok;
    if (!res.ok) return this.emit();

    const t = this.state.minute;
    const r = res.result;
    if (r.decision_requests.length) this.push({ kind: 'decision', t, count: r.decision_requests.length });
    if (r.verification_events.length) {
      this.push({ kind: 'verification', t, count: r.verification_events.length, source: 'llm' });
    }
    if (r.topic_shift.shift) this.push({ kind: 'switch', t, source: 'llm' });
    if (r.topic_shift.current_task) this.previousTask = r.topic_shift.current_task;
    void this.log({
      type: 'observation',
      kind: 'classified',
      detail: {
        decisions: r.decision_requests.length,
        verifications: r.verification_events.length,
        shift: r.topic_shift.shift,
      },
    });
    this.emit();
  }

  async setClassificationConsent(accepted: boolean): Promise<void> {
    this.settings = await saveSettings({ classificationConsent: accepted ? 'accepted' : 'declined', classificationConsentVersion: CONSENT_VERSION });
    this.classificationEpoch++;
    this.previousTask = '';
    this.lastClassify = null;
    this.state.llmAvailable = false;
    this.emit();
  }
}
