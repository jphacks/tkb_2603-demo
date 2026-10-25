# キーなしで使うための中継と公開手順

Issue #4。Cloudflare WorkersとSQLite Durable Objectで分類を中継する。公開URL・使用モデルを設定し、公開APIで合成会話の分類を確認済み。実際のAIチャット上での拡張の確認は残っている。

## 公開準備の状況

2026-10-24に `https://hitoiki-proxy.gaku-fujio.workers.dev/health` が200で `{"ok":true,"enabled":false}` を返すことを確認した。Workerの公開・共有キーの登録は公開担当者が実施済み。拡張の接続先は `.env.example` に記載し、ローカルの `.env` に設定してビルドする。

2026-10-25に使用モデルを `claude-haiku-5-5` と確定し、公開Workerへ反映した。金額の上限は、Anthropic Console の専用ワークスペースで月 $20 にしている。乱用防止の回数制限はそれとは別に維持する。公開APIに合成会話を送信し、HTTP 200・指定モデル・応答形式の検証に成功した。実際のAIチャットに読み込んだ拡張の動作確認を終えてからZIPを配布する。

有効化後の初回分類テストは503で失敗した。公開版のモデル・有効化フラグ・回数制限・Secret名は確認済み。工程別エラーで上流fetchの呼び出し前後に切り分け、Workersがサポートしない `redirect: "error"` を指定していた実装を修正した。`redirect: "manual"` で3xxをエラーとして扱い、APIキーや本文を別のURLへ転送しない。ローカルHTTP検証でも実際のWorkersのRequestコンストラクターを通す。

Haiku 5.5の既定の思考が出力枠を消費することにも対応し、短い抽出用に `thinking: { type: "disabled" }` と `output_config.effort: "low"` を指定した。

修正版の公開バージョンは `86328dd0-a48e-4def-985f-9b3165218cf6`。2026-10-25の合成会話による公開確認で、モデル `claude-haiku-5-5`、処理時間2425ms、入力1077・出力103トークン、判断1件・確認1件・話題切替なしを取得した。実際の利用者の会話や秘密キーの値は、この検証に使っていない。

失敗時は固定のエラーコードで工程を判別する。`quota_unavailable`は回数制限基盤、`upstream_unavailable`は上流への通信やHTTPエラー、`classification_truncated`は出力枠の不足、`invalid_classification`は応答形式の不一致。上流HTTPエラーでは数値の`upstreamStatus`だけ追加する。会話・キー・上流エラー本文は公開応答やログに含めない。

## 公開設定と保護

- `proxy/wrangler.jsonc` の `CLASSIFICATION_ENABLED` は `true`、`ANTHROPIC_MODEL` は `claude-haiku-5-5`。deployすると、同意した利用者の分類を受け付ける。停止するときは `CLASSIFICATION_ENABLED` を `false` にしてdeployする。
- 回数上限は、1インストールにつき1分6回・UTC日100回、全体で1分30回・UTC日1000回。金額の上限(Console の月 $20)とは別の乱用よけ。運用に合わせて変更する。
- 利用者の匿名IDは認証ではない。作り直されることを前提に、すべてのIDで単一のDurable Objectの全体枠を共有する。
- 枠は上流APIを呼ぶ前に原子的に予約し、上流の失敗でも消費する。UTC日・分の境界で復帰する。期限の切れたID別カウンターは削除する。
- 中継に保存するのは匿名IDのカウンターだけ。会話本文・作業名・APIキーはSQLに保存せず、ログ出力もしない。Workersのobservabilityとinvocation logsも無効にする。
- 初回は外部送信に同意するまでローカル計測のみ。設定で取り消せる。既存の個人キーは維持して直接接続に移行するが、新しい説明への同意が必要。

## 1. 公開担当者の準備

Cloudflareへの登録とメール確認を済ませる。Anthropic側の担当者から専用キーを受け取り、使用するモデルの正確なAPI IDと利用上限の方針を確認する。金額の上限は Console の専用ワークスペースで月 $20。キーをチャット・Issue・コード・WXT_/VITE_の環境変数へ貼り付けない。

## 2. Workerを停止状態で作成する

リポジトリのPowerShellで実行する。

```powershell
Set-Location C:\Users\gaku1\dev\tkb_2603\proxy
npm ci
npx wrangler login
```

ブラウザでCloudflareにログインして権限を許可する。新しい環境で停止状態から準備する場合は、`proxy/wrangler.jsonc`の `CLASSIFICATION_ENABLED` を一度 `false` に変更してから公開する。

```powershell
npm run deploy
```

表示される `https://hitoiki-proxy.<自分のサブドメイン>.workers.dev` を控える。`/health` を開くと `{"ok":true,"enabled":false}` になる。停止中は会話を送っても分類しない。

## 3. 共有キーを登録する

`proxy/`で次のコマンドを実行する。

```powershell
npx wrangler secret put ANTHROPIC_API_KEY
```

対話式の入力欄にキーを貼り付け、Enterで登録する。コマンド引数やファイルへキーの値を書かない。Cloudflareの画面からは、Worker → Settings → Variables and Secrets → Add → 種類Secret、名前 `ANTHROPIC_API_KEY` でも登録できる。Secretの登録は新しいバージョンの公開を伴い、その時点の公開設定を維持する。

## 4. モデル・上限を確定して分類を有効にする

担当者がモデルと利用上限の方針を確認した後に、`proxy/wrangler.jsonc`の公開設定を変更する。現在の確定値は上の「公開設定と保護」を参照。

| 変数 | 設定内容 |
| --- | --- |
| `ANTHROPIC_MODEL` | 確認できたモデルの正確なAPI ID。構造化出力への対応を確認する |
| `INSTALL_DAILY_LIMIT` / `INSTALL_MINUTE_LIMIT` | 1インストールのUTC日・分の上限 |
| `GLOBAL_DAILY_LIMIT` / `GLOBAL_MINUTE_LIMIT` | 全体のUTC日・分の上限 |
| `CLASSIFICATION_ENABLED` | 確認後に `true` |

モデル・出力上限1024トークン・指示文・JSON Schemaはサーバー側で固定。リクエストは本文2つと直前の作業名のみ受け付け、追加のモデル指定などは拒否する。本文はリクエスト全体64KiB、分類に使う量はユーザー4000字・回答8000字・作業名300字を基本に切り詰める。

```powershell
npm run deploy
```

ダッシュボードだけで公開変数を変更すると、後のdeployでファイルの値に戻るため、運用設定はファイルにも反映する。止めるときは `CLASSIFICATION_ENABLED` を `false` に戻してdeployする。

## 5. 拡張へ公開URLを設定してビルドする

リポジトリのルートで、実際のWorkerのURLを設定する。下のサブドメイン部分は置き換える。

```powershell
Set-Location C:\Users\gaku1\dev\tkb_2603
$env:WXT_PROXY_URL = 'https://hitoiki-proxy.<自分のサブドメイン>.workers.dev'
npm run build
```

URLはHTTPSのルートURLのみ。パス・ユーザー名・パスワード・クエリ文字列を含めない。WXTが公開URLをコードに埋め込み、同じoriginへのhost permissionをmanifestに追加する。キーを公開する仕組みではない。`.env.example`を参考に、ローカルの`.env`へURLだけを設定する方法もある。

URL未設定なら中継へ送信せず、ローカル計測と同意済みの個人キー方式を利用できる。開発時だけ `http://localhost` / `http://127.0.0.1` を許可する。

## 6. 実機確認と配布

1. Chromeで拡張を更新し、AIチャットのタブを再読み込みする。新規プロファイルなど個人キーのない状態でも確認する。
2. 初回説明で「ローカル計測だけ使う」を選び、分類APIへ本文を送らずに読む量・作業時間などが動くことを確認する。
3. 設定で「キーなしで使う」を選び、本文の送信に同意する。「接続を確認する」が成功することを確認する。
4. ChatGPT・Claude・Geminiで各1往復し、分類と運動・休憩の操作を確認する。「診断」で分類OKを確認する場合は、`src/shared/flags.ts` の `DEMO` を一時的に `true` にしてビルドする。本番では診断・既定の倍速・たまる速さの設定を隠すmainの仕様を維持する。配布前に `DEMO` を `false` に戻す。
5. 同意を取り消して以後は送信しないことを確認する。共有サービス停止時や429でも、読む量・作業時間の計測が継続することを確認する。
6. 個人キー方式を選んだ場合だけ、保存された自分のキーで直接呼び出せることを確認する。接続方式を切り替えると再同意が必要。

公開URLを設定した同じPowerShellで次を実行する。

```powershell
npm run zip
```

`.output/`のChrome用ZIPを配布する。受け取った人はZIPを展開し、`chrome://extensions`でデベロッパーモードを有効にして、manifest.jsonのあるフォルダを「パッケージ化されていない拡張機能を読み込む」から選ぶ。

公開URLなし・HTTP・テンプレートのURLではZIP作成を止める。配布前にZIP内へ `.env` / `.dev.vars` / `proxy/` / 実際の共有キーが混ざっていないことを確認する。公開URL確定前のビルドは配布版ではない。

## この段階の確認結果

- 最新mainを取り込み、本番用の診断・デモ設定の表示条件と30分タイマー比較を維持。拡張: 11ファイル・92件のテストと型チェック、Chrome用ビルド・ZIP作成成功。
- 中継: 15件のテスト、型チェック、Wranglerのドライランと公開更新成功。
- ローカルのWorkerとSQLite Durable ObjectをHTTP経由で呼び、端末ごと・全体の枠と同時予約を確認。
- Chromeの確認用画面（1440pxライト／390pxダーク）で、初回説明・ローカルのみ・同意・取消・接続方式の切替を確認。
- 公開Workerと登録済み共有キーによる合成会話の分類成功を確認。実際のAIチャット上で拡張から行う確認は残っている。
- CIにも独立したproxyジョブを追加し、共有キーなしで中継の型チェック・テスト・ドライランを行う。

## 開発・検証

拡張と中継の依存・型チェック・テストを分離している。

```powershell
# ルート
npm test
npm run compile
npm run build
# proxy/
npm test
npm run check
npm run build  # dry-run。公開しない
```

実際のローカルWorkerとSQLite Durable ObjectによるHTTP検証は、`proxy/`で `npm run dev:test` を起動し、別のターミナルの同じフォルダで `node test/http-check.mjs` を実行する。Anthropicへは接続しない。このHTTP検証をやり直すときは、日次のカウンターが残るため、新しい `--persist-to` の場所で起動する。

公式資料: [Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)、[Durable Objects](https://developers.cloudflare.com/durable-objects/get-started/)、[SQLite transactionSync](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)、[構造化出力](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)、[WXT環境変数](https://wxt.dev/guide/essentials/config/environment-variables.html)、[AnthropicのAPI保存期間](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data)。

モデルIDと構造化出力の互換性は [Haiku 5.5移行ガイド](https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide) と上の構造化出力の資料で確認した。

思考の既定値と無効化は [Effort](https://platform.claude.com/docs/en/build-with-claude/effort) を参照。

WorkersのRequestの制約は [Request](https://developers.cloudflare.com/workers/runtime-apis/request/) を参照。
