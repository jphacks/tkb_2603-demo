// VS Code 拡張の入り口。出来事を Tracker に渡し、1 分ごとに器を進め、区切りで休憩を提案する。
// 休憩の流れは Chrome 版(src/content/runner.ts)に揃える: 提案 → 今休む(メモ)→ 休憩タイマー → おかえり
import * as vscode from 'vscode';
import type { PromptAction } from '../../src/core/gate';
import { contributionShares } from '../../src/core/model';
import { ELEMENT_KEYS, ELEMENT_LABELS, type ElementKey, type EngineState, type ModelParams } from '../../src/core/types';
import { SNOOZE_COPY } from '../../src/ui/copy';
import { registerDemoCommands } from './demo';
import { type FinishedBreak, Tracker, VSCODE_PARAMS, stretchMessage, welcomeMessage } from './tracker';

const STATE_KEY = 'hitoiki:engine';
/** 区切りかどうか・休憩の残りを見る間隔(実時間 ms) */
const GATE_INTERVAL_MS = 1000;

/** 提案の通知のボタン(Chrome 版と同じ 3 つ) */
const PROMPT_BUTTONS: Record<string, PromptAction> = {
  今休む: 'now',
  次の区切りで: 'next_breakpoint',
  今回は不要: 'decline',
};

interface SavedEngine {
  state: EngineState;
  /** 保存した実時刻(ms)。旧データの取り戻しに使う */
  realSavedAt: number;
  /** 最後に計算上の 1 分を進めた実時刻(ms)。開き直した時に、休憩のタイマーを続けるため */
  lastTickReal?: number;
  /** 休憩を始めた時に一番効いていた要素(おかえりの文に使う) */
  breakTop?: ElementKey | null;
}

interface Settings {
  speed: number;
  threshold: number;
  breakScale: number;
}

function readSettings(): Settings {
  const c = vscode.workspace.getConfiguration('hitoiki');
  return {
    speed: Math.max(1, c.get<number>('speed', 1)),
    // settings.json に直接書かれた範囲外の値も、Chrome 版と同じ 50〜95 に収める
    threshold: Math.min(95, Math.max(50, c.get<number>('threshold', VSCODE_PARAMS.threshold))),
    breakScale: c.get<number>('breakScale', 1),
  };
}

function paramsFrom(s: Settings): ModelParams {
  return { ...VSCODE_PARAMS, threshold: s.threshold };
}

/** 動作確認(結合テスト)から中を見る・通知のボタンの代わりに押すための口 */
export interface HitoikiApi {
  tracker: Tracker;
  promptsShown(): number;
  /** 提案の通知のボタンを押したのと同じ(「今休む」のメモ入力欄は飛ばして memo を使う。id を省くと最後の提案) */
  choosePrompt(label: string | undefined, memo?: string, id?: number): Promise<void>;
  welcomes(): string[];
}

export function activate(context: vscode.ExtensionContext): HitoikiApi {
  let settings = readSettings();
  const saved = context.globalState.get<SavedEngine>(STATE_KEY);
  const tracker = new Tracker(saved?.state, paramsFrom(settings));
  tracker.breakScale = settings.breakScale;
  tracker.breakTopAtStart = saved?.breakTop ?? null;
  let lastTickReal = Date.now();
  let promptsShown = 0;
  const welcomes: string[] = [];

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.name = 'ひといき';
  status.show();
  context.subscriptions.push(status);

  const save = () =>
    context.globalState.update(STATE_KEY, {
      state: tracker.state,
      realSavedAt: Date.now(),
      lastTickReal,
      breakTop: tracker.breakTopAtStart,
    } satisfies SavedEngine);

  const render = () => {
    const b = tracker.state.breakState;
    if (b) {
      // 残り(実時間)= 残りの計算上の分 − 前の 1 分からの経過、を時計の速さで割る
      const remainMin = Math.max(0, (tracker.breakRemainingMin() ?? 0) - ((Date.now() - lastTickReal) / 60_000) * settings.speed);
      const sec = Math.ceil((remainMin * 60) / settings.speed);
      status.text = `ひといき 休憩中 あと ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
      status.tooltip = `${stretchMessage(b.stretch)}${b.memo ? `\n戻ったらやること: ${b.memo}` : ''}\nクリックで休憩を終える`;
      status.command = 'hitoiki.endBreak';
      return;
    }
    const waiting = tracker.state.prompt.waitingForUser;
    status.text = `ひといき ${Math.round(tracker.load())}%${waiting ? ' ・休憩を始める' : ''}`;
    const shares = contributionShares(tracker.state);
    const lines = ELEMENT_KEYS.map((k) => {
      if (k === 'decision') return `${ELEMENT_LABELS[k]}: 未計測`;
      return `${ELEMENT_LABELS[k]}: ${shares ? Math.round(shares[k] * 100) : 0}%`;
    });
    status.tooltip = `負担の目安(しきい値 ${settings.threshold})\n今日の内訳\n${lines.join('\n')}${waiting ? '\nクリックで休憩を始める' : ''}`;
    status.command = waiting ? 'hitoiki.startDeferredBreak' : undefined;
  };

  /** 休憩が終わったら、落ち着いたおかえりの通知を出す(Chrome 版のおかえりの画面と同じ文) */
  const welcome = (f: FinishedBreak | null) => {
    if (!f) return;
    const message = welcomeMessage(f, tracker.state.uf);
    welcomes.push(message);
    void vscode.window.showInformationMessage(message);
  };

  const breakStarted = () => {
    const b = tracker.state.breakState;
    if (!b) return;
    void vscode.window.showInformationMessage(`休憩を始めました(${b.plannedMin} 分)。${stretchMessage(b.stretch)}`);
  };

  const askMemo = async () =>
    (await vscode.window.showInputBox({
      title: 'ひと休み',
      prompt: '戻ったらやること(空でもかまいません)',
      placeHolder: '例:テスト結果を確認する',
    })) ?? '';

  const choosePrompt = async (label: string | undefined, memo?: string, id = tracker.latestPromptId) => {
    // 古い通知のボタンは、メモを聞く前に断る
    if (id !== tracker.latestPromptId) return;
    const action = label ? PROMPT_BUTTONS[label] : undefined;
    const m = action === 'now' ? (memo ?? (await askMemo())) : '';
    if (!tracker.respondToPrompt(id, action, m)) return;
    if (action === 'now') breakStarted();
    if (action === 'next_breakpoint') void vscode.window.showInformationMessage(SNOOZE_COPY.next_breakpoint);
    render();
    await save();
  };

  // 閉じていた間の分を進める(休憩中ならタイマーが続く。作業していないので器は増えない)
  if (saved) {
    welcome(tracker.catchUp(((Date.now() - (saved.lastTickReal ?? saved.realSavedAt)) / 60_000) * settings.speed));
  }

  let tickTimer: ReturnType<typeof setInterval> | undefined;
  const restartTick = () => {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(() => {
      lastTickReal = Date.now();
      welcome(tracker.tick().finished);
      render();
      void save();
    }, 60_000 / settings.speed);
  };
  restartTick();

  const gateTimer = setInterval(() => {
    const prompt = tracker.checkPrompt(Date.now(), {
      // tsc --watch・npm run dev のような終わらないタスクは、実行中に数えない
      taskRunning: vscode.tasks.taskExecutions.some((e) => !e.task.isBackground),
      focused: vscode.window.state.focused,
      debugging: vscode.debug.activeDebugSession !== undefined,
    });
    if (prompt) {
      promptsShown++;
      void save();
      void vscode.window
        .showInformationMessage(prompt.message, ...Object.keys(PROMPT_BUTTONS))
        .then((label) => choosePrompt(label, undefined, prompt.id));
    }
    render(); // 休憩の残り時間を秒で動かす
  }, GATE_INTERVAL_MS);

  context.subscriptions.push(
    { dispose: () => (clearInterval(gateTimer), tickTimer && clearInterval(tickTimer)) },
    vscode.workspace.onDidChangeTextDocument((e) => tracker.onTextChange(e, Date.now())),
    vscode.window.onDidChangeActiveTextEditor((ed) => tracker.onActiveEditor(ed?.document.uri, Date.now())),
    // ターミナルはシェル統合が有効な時だけ届く
    vscode.window.onDidStartTerminalShellExecution(() => tracker.activity(Date.now(), true)),
    vscode.window.onDidEndTerminalShellExecution((e) => tracker.onCommandEnd(e.exitCode, Date.now())),
    vscode.tasks.onDidStartTaskProcess(() => tracker.activity(Date.now(), true)),
    vscode.tasks.onDidEndTaskProcess((e) => tracker.onCommandEnd(e.exitCode, Date.now())),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('hitoiki')) return;
      const prevSpeed = settings.speed;
      settings = readSettings();
      tracker.params = paramsFrom(settings);
      tracker.breakScale = settings.breakScale;
      if (settings.speed !== prevSpeed) restartTick();
      render();
    }),
    vscode.commands.registerCommand('hitoiki.breakNow', async () => {
      if (tracker.state.breakState) return;
      const memo = await askMemo();
      if (!tracker.startManualBreak(memo)) return;
      breakStarted();
      render();
      await save();
    }),
    vscode.commands.registerCommand('hitoiki.startDeferredBreak', async () => {
      if (!tracker.startDeferredBreak(await askMemo())) return;
      breakStarted();
      render();
      await save();
    }),
    vscode.commands.registerCommand('hitoiki.endBreak', async () => {
      if (!tracker.state.breakState) return;
      // Chrome 版の「休憩を終えますか?」の確認に揃える
      const answer = await vscode.window.showInformationMessage('休憩を終えますか?', '終える', '続ける');
      if (answer !== '終える') return;
      welcome(tracker.finishBreak(false));
      render();
      await save();
    }),
    vscode.commands.registerCommand('hitoiki.reset', async () => {
      const fresh = new Tracker(undefined, tracker.params);
      tracker.state = fresh.state;
      tracker.breakTopAtStart = null;
      render();
      await save();
    }),
  );

  registerDemoCommands(context, tracker, () => (render(), void save()));

  // 起動時に開いていたファイルを、切替の起点にする
  tracker.onActiveEditor(vscode.window.activeTextEditor?.document.uri, Date.now());
  render();
  void save();
  return { tracker, promptsShown: () => promptsShown, choosePrompt, welcomes: () => [...welcomes] };
}

export function deactivate(): void {
  // 保存は 1 分ごとと、操作のたびに行っている(globalState は deactivate の中で待てない場合がある)
}
