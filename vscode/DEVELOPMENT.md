# ひといき(VS Code 版)— 開発の説明

利用者向けの説明は [README.md](README.md)(Marketplace のページになります)。ここは開発する人向けです。

Chrome 拡張と同じ計算(`../src/core/`)を、VS Code での作業の出来事で動かします。出来事 → 計算の変換は `src/tracker.ts`(vscode モジュールに依存しない)、VS Code とのつなぎは `src/extension.ts` です。文は Chrome 版と同じ `../src/ui/copy.ts` を使います。

## 動かし方

1. `npm install`
2. VS Code でこの `vscode/` フォルダを開き、F5(「ひといき(拡張機能の開発ホスト)」)
3. 開発ホストの設定で `hitoiki.speed` を 60〜120 にすると、1 秒で計算上 1〜2 分進みます
4. 失敗するコマンドやタスクを何回か動かすと、右下の「ひといき n%」が上がり、しきい値(`hitoiki.threshold`、既定 80)を超えると、区切りで提案が出ます

## 確かめ

- `npm test`: 出来事 → 計算の変換(VS Code の API をまねた形)
- `npm run e2e`: インストール済みの VS Code を使い捨てのプロファイルで開き、倍速で失敗するタスクを繰り返して、提案 → 今休む → 休憩が終わって器が下がる → おかえり、までを確かめます(ボタンは拡張の口から押します)。VS Code の窓が 1 分ほど画面に出るので、その間は触らないでください。窓が裏に回ると提案が出ないので失敗します

## 配る物を作る

- リポジトリのルートで `bash scripts/package.sh`(`dist-release/hitoiki-vscode.vsix` ができる)
- この中だけなら `npm run build && npx @vscode/vsce@3.6.0 package --no-dependencies`
- `.vsix` に入れる物は `.vscodeignore` で決める(`dist/`・`package.json`・`README.md`・`LICENSE`・`CHANGELOG.md`・`images/icon.png`)

## 試作としての注意

- 休憩の記録(Chrome 版の「どうだった?」や記録の書き出し)はありません
- 休憩中に VS Code を閉じても、開き直すと閉じていた間のぶんタイマーが進みます。開いたまま PC が眠った間は取り戻しません
- 拡張の ID は `koubeyapurin.hitoiki`。器の保存(globalState)は拡張の ID ごとなので、ID を変えると前の状態は引き継がれません
