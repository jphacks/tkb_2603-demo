// デモ用(src/shared/flags.ts の DEMO = true の時だけ): 器を決まった状態から始めるコマンド。
// Chrome 版の設定画面の「状態から始める」と同じ状態を作る(src/shared/demoStates.ts)
import * as vscode from 'vscode';
import { DEMO } from '../../src/shared/flags';
import { DEMO_STATES, type DemoStateId, demoState } from '../../src/shared/demoStates';
import type { Tracker } from './tracker';

const COMMANDS: Record<DemoStateId, string> = {
  empty: 'hitoiki.demo.empty',
  near: 'hitoiki.demo.near',
  before_break: 'hitoiki.demo.beforeBreak',
};

/** changed: 状態を変えた後に、表示と保存をやり直す */
export function registerDemoCommands(context: vscode.ExtensionContext, tracker: Tracker, changed: () => void): void {
  if (!DEMO) return;
  for (const d of DEMO_STATES) {
    context.subscriptions.push(
      vscode.commands.registerCommand(COMMANDS[d.id], () => {
        tracker.state = demoState(d.id, tracker.state);
        tracker.breakTopAtStart = null;
        changed();
        void vscode.window.showInformationMessage(`「${d.label}」にしました(${d.hint})。`);
      }),
    );
  }
}
