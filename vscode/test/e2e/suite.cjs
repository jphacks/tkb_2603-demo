// 開発ホストの中で動く。時計を速め、わざと失敗するタスクを繰り返し、器がたまって提案が出るかを見る。
const vscode = require('vscode');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[hitoiki-e2e]', ...a);

async function runFailingTask(i) {
  const folder = vscode.workspace.workspaceFolders[0];
  const task = new vscode.Task({ type: 'shell', id: `fail-${i}` }, folder, `fail-${i}`, 'hitoiki-e2e', new vscode.ShellExecution('exit 1'));
  task.presentationOptions = { reveal: vscode.TaskRevealKind.Never };
  const done = new Promise((resolve) => {
    const sub = vscode.tasks.onDidEndTaskProcess((e) => {
      if (e.execution.task.name === task.name) {
        sub.dispose();
        resolve(e.exitCode);
      }
    });
  });
  await vscode.tasks.executeTask(task);
  return done;
}

/** ターミナルで失敗するコマンドを 1 回動かす(シェル統合が使えなければ null) */
async function runFailingTerminalCommand() {
  const term = vscode.window.createTerminal({ name: 'hitoiki-e2e' });
  term.show();
  for (let i = 0; i < 50 && !term.shellIntegration; i++) await sleep(200);
  if (!term.shellIntegration) return null;
  const done = new Promise((resolve) => {
    const sub = vscode.window.onDidEndTerminalShellExecution((e) => {
      if (e.terminal === term) {
        sub.dispose();
        resolve(e.exitCode);
      }
    });
  });
  term.shellIntegration.executeCommand('false');
  return Promise.race([done, sleep(10_000).then(() => 'timeout')]);
}

exports.run = async function run() {
  try {
    await main();
  } catch (e) {
    log('失敗', e && e.stack ? e.stack : String(e));
    throw e;
  }
};

async function main() {
  const ext = vscode.extensions.getExtension('koubeyapurin.hitoiki');
  const api = await ext.activate();
  const config = vscode.workspace.getConfiguration('hitoiki');
  // 120 倍速: 実時間 1 秒で計算上の 2 分
  await config.update('speed', 120, vscode.ConfigurationTarget.Global);
  await sleep(500);

  const t0 = Date.now();
  const status = () => `minute=${api.tracker.state.minute} load=${api.tracker.load().toFixed(1)} 失敗(直近)=${api.tracker.state.recent.verification.length}`;
  log('開始', status());

  const before = api.tracker.state.recent.verification.length;
  const termCode = await runFailingTerminalCommand();
  log('ターミナル', termCode === null ? 'シェル統合が使えない' : `終了コード=${termCode}`, `確認・検証 +${api.tracker.state.recent.verification.length - before}`);

  let i = 0;
  let codes = [];
  while (api.tracker.load() < 80 && i < 150) {
    codes.push(await runFailingTask(i++));
    if (i % 5 === 0) log(`タスク ${i} 回`, status());
    await sleep(300);
  }
  log('失敗するタスクを止めた', `回数=${i}`, `終了コード=${[...new Set(codes)].join(',')}`, status());
  if (api.tracker.load() < 80) throw new Error('器が 80 に届かなかった');

  // 区切り(タスクが走っていない・入力していない)で提案が出るのを待つ
  const t1 = Date.now();
  while (api.promptsShown() === 0 && Date.now() - t1 < 15_000) await sleep(200);
  log('窓が前にあるか', vscode.window.state.focused);
  log('提案の数', api.promptsShown(), `待った秒数=${((Date.now() - t1) / 1000).toFixed(1)}`, status());
  if (api.promptsShown() === 0) throw new Error('提案が出なかった');

  // 提案 → 今休む → 倍速で休憩が終わる → 器が下がっている → おかえりが出る
  const loadBefore = api.tracker.load();
  await api.choosePrompt('今休む', 'テストを確認');
  const brk = api.tracker.state.breakState;
  if (!brk) throw new Error('「今休む」で休憩が始まらなかった');
  log('休憩を始めた', `予定=${brk.plannedMin} 分`, `ストレッチ=${brk.stretch}`, `メモ=${brk.memo}`, status());
  const t3 = Date.now();
  while (api.tracker.state.breakState && Date.now() - t3 < 30_000) await sleep(200);
  if (api.tracker.state.breakState) throw new Error('休憩が終わらなかった');
  const welcomes = api.welcomes();
  log('休憩が終わった', `実時間=${((Date.now() - t3) / 1000).toFixed(1)} 秒`, `器 ${loadBefore.toFixed(1)} → ${api.tracker.load().toFixed(1)}`);
  log('おかえり', JSON.stringify(welcomes.at(-1)));
  if (!(api.tracker.load() < loadBefore - 40)) throw new Error('休憩の後に器が下がっていない');
  if (welcomes.length !== 1 || !welcomes[0].includes('おかえりなさい') || !welcomes[0].includes('テストを確認')) {
    throw new Error('おかえりの通知が出なかった');
  }

  // 補完を何回も受け入れた後(まとまった挿入が続いた後)でも、止まれば提案が出るか
  await vscode.commands.executeCommand('hitoiki.reset');
  const doc = await vscode.workspace.openTextDocument({ language: 'typescript', content: '' });
  await vscode.window.showTextDocument(doc);
  // 日本語の説明つきの補完(1 回 500 字を超える)を、1 周に 3 回受け入れる。読む残りは上限(2 分)まで積まれる
  const snippet = '// 二つの数を足した値を返します。引数は数値で、結果も数値です。\nexport const add = (a: number, b: number) => a + b;\n'.repeat(20);
  let maxBacklog = 0;
  let j = 0;
  while (api.tracker.load() < 80 && j < 150) {
    for (let k = 0; k < 3; k++) {
      const edit = new vscode.WorkspaceEdit();
      edit.insert(doc.uri, doc.lineAt(doc.lineCount - 1).range.end, snippet);
      await vscode.workspace.applyEdit(edit);
    }
    maxBacklog = Math.max(maxBacklog, api.tracker.state.readBacklogMin);
    await runFailingTask(`c${j++}`);
    await sleep(300);
  }
  log('補完を止めた', `回数=${j}`, `読む残りの最大=${maxBacklog.toFixed(2)} 分`, status());
  if (maxBacklog < 1) throw new Error('まとまった挿入で読む残りが 1 分以上にならなかった');
  if (maxBacklog > 2) throw new Error('読む残りが上限(2 分)を超えた');
  const before2 = api.promptsShown();
  const t2 = Date.now();
  while (api.promptsShown() === before2 && Date.now() - t2 < 15_000) await sleep(200);
  log('補完の後の提案', api.promptsShown() - before2, `窓が前=${vscode.window.state.focused}`, `待っている=${api.tracker.state.prompt.waitingForUser}`, `次まで=${api.tracker.state.prompt.notBefore}`, `待った秒数=${((Date.now() - t2) / 1000).toFixed(1)}`, status());
  if (api.promptsShown() === before2) throw new Error('補完の後に提案が出なかった');

  // デモの「状態から始める」(DEMO = true の時だけ登録される)
  if ((await vscode.commands.getCommands(true)).includes('hitoiki.demo.near')) {
    await vscode.commands.executeCommand('hitoiki.demo.near');
    log('デモ: 器 75% から', status());
    if (Math.abs(api.tracker.load() - 75) > 1 || api.tracker.state.breakState) throw new Error('デモの状態にならなかった');
    await vscode.commands.executeCommand('hitoiki.demo.beforeBreak');
    log('デモ: 休憩の直前', status());
    if (!(api.tracker.load() > 80)) throw new Error('デモの状態にならなかった');
  }

  // 通知を撮る(E2E_SHOT にファイルの場所を渡した時だけ)
  if (process.env.E2E_SHOT) {
    await sleep(1500);
    try {
      require('node:child_process').execFileSync('screencapture', ['-x', process.env.E2E_SHOT]);
      log('スクリーンショット', process.env.E2E_SHOT);
    } catch (e) {
      // macOS で画面収録の許可が無いと撮れない。確かめた内容には関係しないので止めない
      log('スクリーンショットを撮れなかった(画面収録の許可が要る)', String(e.message).split('\n')[0]);
    }
  }
}
