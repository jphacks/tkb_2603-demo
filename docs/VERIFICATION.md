# 実機の確認(issue #16)

issue #16 の確認について、対象のビルド、これまでの結果、続きを行う手順をまとめます。記録の JSON はこのリポジトリに入れません(公開のため)。ここに書くのは件数と時刻だけです。

## 1. 確かめる対象のビルド

- 対象は **Releases v1.1.0 の `hitoiki-chrome.zip`** です。タグ `v1.1.0` は `4ae9678`(PR #13 のマージ)を指しています
- v1.1.0 から今の main までの変更は README と docs だけです。`src/`・`entrypoints/`・`wxt.config.ts` には差がありません(`git diff --stat v1.1.0 origin/main -- src entrypoints wxt.config.ts` が空)。v1.1.0 で確かめた結果は、今の main にもそのまま当てはまります
- `gaku/pictogram-motion`(#12)から作ったビルドは、ピクトグラムの部分だけが違います。画面の読み取り(`src/content/`)、分類(`src/shared/`)、background は v1.1.0 と同じです。手元で作った background.js は、v1.1.0 の zip の中のものと一致しました。どちらで試しても、3 と 4 の結果は変わりません
- zip の中には API キーが入っていません(`sk-ant-` で検索して 0 件)。入っている接続先は `api.anthropic.com` と中継の URL だけです。中継の `GET /health` は `{"ok":true,"enabled":true}` を返しました(10/25 10:20 頃)
- **v1.1.0 の後に、拡張の動きの直しが 2 つ入りました**(PR「ChatGPT の取りこぼしを直す+計測停止中の記録」)。v1.1.0 の zip にはまだ入っていません。v1.1.0 で 4 を行うと、次の 2 か所が直しの前の動きになります
  - 停止ボタンが取れない画面での回答の終わり: v1.1.0 は「ページ全体の変化が 2.5 秒止まった時」、直した版は「最後の回答の字数が 2.5 秒変わらない時」。check-log の「終わりの決め方」は、v1.1.0 の記録ではすべて「不明」になります
  - 計測を止めている間の記録: v1.1.0 は送信・エラーの貼り付け・会話の切替を記録してしまいます(器は動きません)。4-4 の「計測を止めていた間」に送信が 1 件出るのは、v1.1.0 では直しの前の動きです
- **食い違いが 1 つあります**: zip の `manifest.json` の version が `1.0.0` です(`package.json` が `1.0.0` のため)。`chrome://extensions` では 1.0.0 と表示されます。直す場合は Release の出し直しになります

## 2. これまでの結果(がく、10/25)

### ふだんの Chrome(1 の記録、10/24 11:01〜10/25 10:17)
- 10/24・10/25 とも、使ったのは ChatGPT だけです。10/24 の記録にサイト名が無いのは、PR #2 より前の版で取ったためです
- 10/25 9:33〜9:37 の ChatGPT: 生成の始まり 4 回・回答 4 回・分類 4 回成功(Haiku 5.5。判断は 1・3・2・2 件)。一方で、**送信は 1 回しか取れていません**

### 新しく入れた拡張(3 の途中まで、10/25 11:38〜11:46)

| 項目 | 結果 |
| --- | --- |
| 初めて開いたときに同意の説明が出る | ✅ |
| 同意 → 1 往復 → 判断が % で出る | Claude では ✅(1 往復・分類成功・判断 1 件)。**ChatGPT では ❌**(下を参照) |
| 同意を取り消しても器はたまる | ✅(見た目で確認。記録での確認は未) |
| 自分のキー方式 | 未 |
| 「計測する」を外すと増えない | 未 |

記録の取れ方(`node scripts/check-log.ts` の出力):

| サイト | 送信 | 回答(続きを除く) | 続き | 生成の始まり | 分類の成功 / 失敗 |
| --- | --- | --- | --- | --- | --- |
| chatgpt | 7 | 0 | 0 | 0 | 0 / 0 |
| claude | 1 | 1 | 1 | 1 | 1 / 0 |

### 分かったこと
1. **この時の ChatGPT では、回答の終わりが一度も取れていません。** 回答が取れないと、読む量が増えず、分類も呼ばれません。そのため、器は作業時間だけでたまり、判断・確認・切替の分類も動きませんでした。がくには「接続を確認」を押すまで作業時間しか計測されていないように見えましたが、記録では、押した前後も ChatGPT の回答は 0 回です。分類が動いた 11:40 の 1 往復は Claude で行っています。「接続を確認」は固定の例文を送るだけで、計測の状態は変えません(`entrypoints/background.ts` の `test_key`)
2. **ChatGPT は、環境によって取れない所が逆になっています。** ふだんの Chrome では生成と回答は取れて、送信を取りこぼしました。新しく入れた方では送信は取れて、生成と回答が取れていません。ChatGPT の画面が、ログインの有無やアカウント(A/B テスト)で違う可能性があります。どちらの条件で起きるかは、下の 4-2 で確かめます
3. **判断・確認・切替が 0 のままでも、壊れているとは限りません。** 次の 3 つの理由で、短い挨拶だけでは 0 のままです
   - 判断・確認・切替は、回答の中に出来事があったときだけ増えます
   - 確認のうちエラーの貼り付けは、入力欄に**貼り付けた**ときだけ数えます
   - 判断は、設定を変えるたびに次の分類が成功するまで「未計測」に戻ります(`runner.ts` の `llmAvailable`。#14 とも関係)

   確かめるときは、4-3 のテスト文を使ってください

## 3. るーはさんの PC でできるか

| 確認 | 要るもの | ビルド |
| --- | --- | --- |
| 2〜4(本番の zip) | Chrome(Windows・macOS のどちらでもよい)、ChatGPT・Claude・Gemini のアカウント | 要らない |
| 記録の確認(`scripts/check-log.ts`) | このリポジトリの clone、Node.js 22.19 以上(`.ts` をそのまま動かすため。手元の 22.19 で動作を確認。CI も 22)、`npm ci` | 要らない |
| 5・7(デモ版) | Git、Node.js 22、npm | `tkb_2603-demo` を作る |
| 6(VS Code 版) | VS Code。Marketplace で「ひといき」を検索して入れられる | 要らない |

ChatGPT のプロファイルによる違いを確かめるには、ふだんのプロファイルと新しいプロファイルを両方使える PC が向いています。

## 4. るーはさんへの手順(Chrome での実証実験)

所要時間は約 1 時間です。結果は #16 にコメントしてください。記録の JSON は issue に貼らずに、Drive で共有します。

- ⏱ の時刻は**秒まで**メモしてください(例: `11:05:40`)。押した後に時計を見ます。分までしか書かないと、その分の 0 秒から数えるので、押す前の記録が混ざります。秒が見えない時は、開発者ツールの Console で `new Date().toLocaleTimeString()` を打つと出ます
- **ChatGPT の確認はログインして行ってください。** がくの新しいプロファイルの ChatGPT では回答が取れませんでした。ログインの有無によるのか、アカウントごとの画面の違いによるのかは、まだ分かっていません(4-2 で確かめます。取れない画面への対応はハッカソンの後です)

### 4-1. 準備(10 分)
1. Chrome で新しいプロファイル(例: 「ひといき確認」)を作る
2. そのプロファイルで https://github.com/jphacks/tkb_2603/releases/tag/v1.1.0 から `hitoiki-chrome.zip` を落とし、展開する
3. `chrome://extensions` →「デベロッパー モード」をオン →「パッケージ化されていない拡張機能を読み込む」→ `manifest.json` のあるフォルダを選ぶ
4. chatgpt.com を開き、右下に「計測中 0%」が出ることと、同意の説明が出ることを確かめる →「同意して使う」

### 4-2. ChatGPT の取りこぼしの切り分け(20 分)
ログインの有無で ChatGPT の画面が変わるかを見ます。

1. **ログインしない状態で** ChatGPT を開く。⏱ 始めた時刻
2. 開発者ツール(Windows は F12、macOS は ⌘⌥I)→「Console」に、次の文を貼って Enter を押す。初めて貼るときは、Chrome が `allow pasting` と打つように求めるので、打ってから貼り直す
   ```js
   (() => {
     const S = {
       assistant: ['[data-message-author-role="assistant"]', '[data-markdown-text-style="assistant-message"]', '[data-content-search-unit-key$=":assistant"]', '[class*="prose"]', '.markdown'],
       user: ['[data-message-author-role="user"]', '[data-user-message-bubble="true"]', '[data-content-search-unit-key$=":user"]'],
       composer: ['#prompt-textarea', 'form[data-chatgpt-composer] [contenteditable="true"]', '[contenteditable="true"][role="textbox"]', 'textarea'],
       stop: ['[data-testid="stop-button"]', 'button[aria-label*="Stop"]', 'button[aria-label*="停止"]', '[data-is-streaming="true"]', '.result-streaming', '[data-streaming-response-status="streaming"]'],
       send: ['[data-testid="send-button"]', '#composer-submit-button', 'button[aria-label="Send prompt"]'],
     };
     const max = {};
     const id = setInterval(() => {
       for (const list of Object.values(S)) for (const s of list) max[s] = Math.max(max[s] ?? 0, document.querySelectorAll(s).length);
     }, 200);
     let last = Date.now(), gap = 0;
     const mo = new MutationObserver(() => { const n = Date.now(); gap = Math.max(gap, n - last); last = n; });
     mo.observe(document.body, { childList: true, subtree: true, characterData: true });
     setTimeout(() => {
       clearInterval(id);
       mo.disconnect();
       gap = Math.max(gap, Date.now() - last);
       console.table(Object.entries(S).flatMap(([group, list]) => list.map((selector) => ({ group, selector, max: max[selector] }))));
       console.log('いちばん長い静かな間(ms)', gap);
     }, 30000);
     console.log('30 秒以内に、長めの回答になる質問を送ってください(例: 1 から 100 まで数えて)');
   })();
   ```
   この文は、画面にある要素の数と、画面が変わった時刻だけを見ます。本文は読みません。セレクタは `src/content/sites.ts` の ChatGPT と同じです
3. 30 秒以内に「1 から 100 まで数えて」を送る。回答が終わっても、表が出るまで(貼ってから 30 秒)待つ。表と「いちばん長い静かな間」が出るので、スクショを撮る
4. そのまま 3 往復する(1 回ごとに回答が最後まで出るのを待つ)。⏱ 終えた時刻
5. オプションの「記録を書き出す(JSON)」を押す(ログインなしの分。ファイル名に `ログインなし` と足しておく)
6. **ログインして**、1〜4 をもう一度行う。⏱ 始めた時刻・終えた時刻
7. もう一度「記録を書き出す(JSON)」を押す(ログインありの分。前の分も入っているので、4-6 で時刻で区切ります)

表の見方:
- `stop` の行がどれも 0 → 生成中が取れていません。回答の終わりは、停止ボタンの代わりの決め方に頼ることになります
  - v1.1.0: ページ全体の変化が 2.5 秒止まった時。**「いちばん長い静かな間」が 2500 未満なら、その画面では v1.1.0 は回答の終わりが取れません**
  - 直した版: 最後の回答の字数が 2.5 秒変わらない時。`assistant` の 1〜3 行目のどれかが 1 以上なら取れます
- `assistant` の行がどれも 0 → 回答が取れていません(読む量・分類が動かない原因)
- `user` の行がどれも 0 → 送信の取りこぼしを、吹き出しの数から補えません

### 4-3. 判断・確認・切替が動くか(10 分)
ログインした ChatGPT で、次を 1 つずつ送ります。送るたびに右下を押してパネルを開き、5 項目のバーを見ます。

| 見るもの | 送る文 | 期待 |
| --- | --- | --- |
| 判断 | 「新しいアプリの名前の案を 3 つ出して、どれにするか私に選ばせて」 | 判断が「未計測」でなくなり、% が上がる |
| 確認 | 下のエラー文を入力欄に**貼り付けて**から、「動かないので見て」と書き足して送る | 確認・検証が上がる |
| 切替 | 左上から新しい会話を開き、別の話題(「夕飯の献立を考えて」)を送る | 切替が上がる |

確認に使うエラー文:
```
TypeError: Cannot read properties of undefined (reading 'map')
    at App (App.tsx:12:5)
```

### 4-4. 同意と計測を止める(10 分)
1. `chrome://extensions` →「ひといき」の「詳細」→「拡張機能のオプション」→「同意を取り消す」。⏱ 取り消した時刻
2. ChatGPT で 1 往復する → 器がたまり続けることを見る
3. オプションで「計測する」を外す。⏱ 止めた時刻
4. 1 往復する → 器が動かないことを見る
5. 「計測する」を戻す。⏱ 戻した時刻。続けて「同意して分類を使う」を押す。⏱ 同意しなおした時刻

### 4-5. Gemini(10 分)
1. Gemini を日本語の画面で開く(英語なら `https://gemini.google.com/app?hl=ja`)。⏱ 時刻
2. ちょうど 5 往復する

### 4-6. 記録を書き出して確かめる(5 分)
1. オプションの「記録を書き出す(JSON)」(隣の赤い「記録を消す」は押さない)
2. このリポジトリで次を実行する(時刻は ⏱ のメモに置き換える。間は `始め〜終わり` で、秒まで書く。終わりの日付は省ける)
   ```sh
   npm ci
   # 全体と、4-4 の 2 つの間
   node scripts/check-log.ts ~/Downloads/hitoiki-log-○○.json "2026-10-25 取り消した時刻〜同意しなおした時刻" "2026-10-25 止めた時刻〜戻した時刻"
   # 4-2 のログインなし(4-2 の 5 で書き出した分)
   node scripts/check-log.ts ~/Downloads/hitoiki-log-ログインなし.json
   # 4-2 のログインあり(4-2 の 7 で書き出した分を、ログインして始めた時刻〜終えた時刻で区切る)
   node scripts/check-log.ts ~/Downloads/hitoiki-log-○○.json "" "" "2026-10-25 始めた時刻〜終えた時刻"
   ```
3. 見るところ:
   - サイト別の表: chatgpt と gemini の「送信」と「回答(続きを除く)」が同じか。「終わりの決め方」で、停止ボタンと字数のどちらで終わりが取れたか
   - 「同意を取り消していた間」: classify が 0 件か
   - 「計測を止めていた間」: 0 件か(v1.1.0 では送信が 1 件出ます。1 を参照)

### 4-7. 報告のしかた
#16 に、次の 4 つを書いてください。
- 4-2 の表のスクショ 2 枚(ログインなし・あり)と、check-log の表
- 4-3 の 3 つのバーが上がったか(✅ / ❌)
- 4-4 と 4-5 の結果(✅ / ❌)
- 崩れや読めない所があればスクショ

4-2 で当たらないセレクタが分かったら、`src/content/sites.ts` の ChatGPT に、当たるセレクタを足します。
