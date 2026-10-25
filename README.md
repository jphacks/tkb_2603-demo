> **これはデモ用の repo です。本体は [jphacks/tkb_2603](https://github.com/jphacks/tkb_2603) です。**
> 計算は本体と同じです。違いは `src/shared/flags.ts` の `DEMO = true`(時計の速さ・たまる速さ g・診断を画面に出す)と、器を決まった状態から始めるボタン(設定画面の「デモ」節と、VS Code のコマンド「ひといき(デモ): …」)だけです。

# ひといき

[![IMAGE ALT TEXT HERE](https://jphacks.com/wp-content/uploads/2026/07/IMG_5316.png)](https://www.youtube.com/watch?v=piaNsc6ilBI)

<!-- デモ動画ができたら、上の画像と YouTube の URL を差し替える -->

## 製品概要
### 背景(製品開発のきっかけ、課題等）
AI でコードを書くのは速くなりました。でも人の仕事は消えず、AI が出したものを**読んで、確かめて、判断する**側に移りました。速くなった分、こなす量も増えています。
- 2026 年の調査では、開発者の 75% が「検証の責任が増えた」と答え(Atlassian State of Developer Experience 2026)、85% が「詰まる場所がレビューと検証に移った」と答えています(GitLab 2026)。どちらも自己申告の業界調査です
- AI を使うと 1 回の課題の負荷は下がります。それでも、確認の負荷が高いほど疲れが強くなっていた、という研究があります(Fan et al., CHI 2026)

私たち自身も、AI を並列で動かして開発するうちに、確認と判断が詰まって頭がぐったりする経験をしてきました。それなのに、休むタイミングは多くが時計か気合で決まっています。

### 製品説明（具体的な製品の説明）
**ChatGPT・Claude・Gemini** の Web 画面の上で動く Chrome 拡張です。AI とのやりとりの中身から「脳にかかる負担の目安」を器のようにためていきます。器がいっぱいになったら、**作業の途中ではなく区切りのいい瞬間に**「○分休もう」と声をかけます。

1. AI チャットでのやりとりから、**読む量・判断を求められた回数・確認や検証(エラーとの格闘)・話題の切替・作業時間**の 5 つを取ります
2. 5 つの平均で、器に負担がたまります。中身が重いと速く、軽いと遅くたまります
3. 器が 80% を超えたら、生成中でも入力中でもない区切りを待って、休憩を提案します。どの要素がためたかの内訳(例: 「確認・検証 38% / 読む量 27% / 作業時間 20%」)と、それに合わせた声かけ(例: 「ひと息、休憩しませんか。確認や指示が続いています。」)を出します。**休憩は本人が始めます**(自動では始まりません)
4. 休憩中は円のタイマーとストレッチのピクトグラムを出します。休憩中に「戻ったら何をする?」を 1 行メモできます(VS Code 版は休む前に聞きます)
5. 戻ったら、メモと励ましの声かけを出します。最後に「この休憩どうだった?」と聞きます

- 判断と確認の一部は、本文の送信に同意すると共有中継を通じて会話を分類して取ります。自分の API キーで直接接続することもできます。同意前や通信できない時もローカルの手がかりで動きます(判断は「未計測」になります)
- **対応しているサイト**: ChatGPT(chatgpt.com。ログインして使う)・Claude(claude.ai)・Gemini(gemini.google.com)。Hack Day 中の記録で、3 サイトとも送信と回答が取れたことを確かめました。サイトごとの違いは画面の読み取り方だけで、[`src/content/sites.ts`](src/content/sites.ts) の定義を足せば広げられます。計算・画面・分類はどのサイトでも同じです
- **VS Code でも動きます**([`vscode/`](vscode/)): 同じ計算([`src/core/`](src/core/))を、エディタの出来事で動かします。読む量(まとまった挿入)・確認(ターミナルやタスクで動かしたテスト・ビルドの失敗)・ファイルの切替・作業時間でたまり、ステータスバーに「ひといき ○%」を出します。提案・休憩・おかえりは Chrome 版と同じ文と流れです。判断は VS Code では未計測で、器は Chrome 版と別々です(1 人に 1 つの器にまとめるのが次)

**試す: [入れ方と配布ページ](https://jphacks.github.io/tkb_2603-demo/)**(Chrome 版の zip は [Releases](https://github.com/jphacks/tkb_2603/releases/latest)。VS Code 版は [Marketplace](https://marketplace.visualstudio.com/items?itemName=koubeyapurin.hitoiki) で「ひといき」と検索)

### 特長
#### 1. 時間ではなく「何をしているか」で休憩を決める
休憩アプリの多くは時間で通知します(25 分、30 分など)。ひといきは、AI に判断を求められた回数や、エラーを貼った回数でたまる速さが変わります。同じ計算で、いちばん重い作業なら 25 分、作業時間のほかに何も無いなら 125 分で通知が出ます。同じ時間でも、中身でたまる速さが約 5 倍変わります(どちらもテストで確かめた値。[`src/core/model.test.ts`](src/core/model.test.ts))。

#### 2. 作業の邪魔をしない
区切りまで待つ考え方は、既存の休憩アプリにもあります。ひといきは、AI が生成している間と、**長い回答を読み終えるまで**を見て待ちます。入力中や書きかけがある間も声をかけません。提案には「今 ○ 分休む」と「区切りがついたら休む」の 2 つのボタンがあり、後者を選ぶと、右下のボタンを押すまで計測を続けて待ちます。いつ休むかは本人が決められます。作業の途中で割り込むと苛立ちや再開のコストが増える、という通知の研究(Iqbal & Bailey ほか)の考え方を、休憩に当てはめました。

#### 3. なぜ休もうと言われたかが分かる
計算は足し算なので、どの要素がどれだけ器をためたかを、そのまま理由として見せられます。カメラは使いません。会話の本文は拡張に保存しません(記録は件数・文字数・時刻・操作だけ)。本文の送信に同意して分類を使う場合は、1 往復ごとに本文を Anthropic の API に送ります。公開設定済みの共有中継、または自分のキーでの直接接続を選べます。

### 解決出来ること
- 疲れ切る前に、区切りのいいところで止まるきっかけを作る
- 確認や判断が続いていることに、理由つきで気づくきっかけを作る
- **動いた記録**(Hack Day 中、2 人の Chrome の記録から): 10/24〜10/25 に、ChatGPT で 64 回、Claude で 5 回、Gemini で 8 回の送信を記録できました
- **API キー無しの中継での分類**(同じ記録から): 4 回中 4 回成功、平均 1.7 秒、モデルは Haiku 5.5 で **1 回 約 $0.0003**(実測)。自分のキーで Opus 5.5 を使った時(10 回中 10 回成功、平均 2.6 秒、1 回 約 $0.0065)の約 20 分の 1 です
- 集計は [`scripts/analyze-log.ts`](scripts/analyze-log.ts) で、設定画面から書き出した記録をそのまま読めます

### 今後の展望
- **開発の現場に広げる**: VS Code では同じ計算が動きました。次は Claude Code・Codex の hooks です。承認待ちやテストの失敗まで取れるので、出来事の形を合わせれば同じ計算につなげられます
- **1 人に 1 つの器にする**: 今は Chrome と VS Code で器が別々です。頭は 1 つなので、まとめてためるのが次です
- **本人に合わせる**: 「役立った?」の答えや「あとで」を押した回数から、たまる速さを本人に合わせます

### 注力したこと（こだわり等）
* **根拠のある所と、仮置きの所を分けた**: 2 層の器(すぐ回復する負担と、その日は残る負担)は疲労の研究(Müller et al., Nature Communications 2021。体の努力の実験で、頭の作業で確かめられたものではない)の形を参考にしました。読む速さは日本語 653 字/分(小林・川嶋 2018)、英語 238 語/分(Brysbaert 2019)です。休憩の長さは、厚生労働省「情報機器作業における労働衛生管理のためのガイドライン」の「連続作業は 1 時間以内、10〜15 分の作業休止」に合わせました。要素ごとの重みには研究の根拠がないので、等重みの仮置きにして、そうはっきり書いています
* **LLM に点数を出させない**: LLM には「判断を求めた箇所」「動かないという報告」「別の話題に移ったか」という**出来事**だけを抜き出させます。負担の計算は、拡張の中の決まった式で行います
* **先行研究との位置づけ**: 作業ログから休憩の好機を予測する研究はあります(Kaur et al., CHI 2020)。ひといきは、AI との開発で増えた確認・判断の手がかりを、カメラなしで使います
* 表示は「ログから推定した作業の負担の目安」です。疲労を測っているわけではありません

## 開発技術
### 活用した技術
#### API・データ
* Anthropic Claude API(会話の 1 往復ごとに、判断・確認・切替の出来事を構造化出力(JSON schema)で抜き出す)
* 研究と公的な目安の値(上の「注力したこと」を参照)

#### フレームワーク・ライブラリ・モジュール
* WXT(Chrome 拡張のフレームワーク)、React、TypeScript
* @anthropic-ai/sdk
* Vitest、happy-dom(計算と画面の読み取りのテスト)
* VS Code Extension API、esbuild、@vscode/test-electron(VS Code 版と、実際の VS Code で動かす確認)

#### デバイス
* PC(Google Chrome、VS Code)

### 独自技術
#### ハッカソンで開発した独自機能・技術
**特に力を入れた所**(どれも Hack Day 中に作りました)

1. **API キー無しで、安全に分類を使える中継**(PR #13、commit `4ae9678`、[`proxy/src/handler.ts`](proxy/src/handler.ts)・[`proxy/src/quota.ts`](proxy/src/quota.ts)・[`src/shared/classification-service.ts`](src/shared/classification-service.ts))
   - 公開 URL は誰でも叩ける前提で作りました。中継が受けるのは本文 2 つと直前の作業名だけで、ほかの項目があれば断ります。モデル・出力の上限・指示文・JSON Schema は中継側で固定し、「誰でも使える Claude の入口」にならないようにしました
   - 回数の上限は、Durable Object(SQLite)で 1 インストールごと・全体の両方を、同時に来ても数え間違えない形で予約します。端末 ID は自己申告なので、最後の守りは全体の上限(1 日 1,000 回・1 分 30 回)と、Anthropic Console の月の金額の上限です。リダイレクトは失敗として扱い、キーや本文をほかの URL へ渡しません。本文はログにも残しません
   - 拡張の側は、最初に説明を出して同意を取ってから送ります。同意を取り消したり設定を変えたりすると、途中の通信も止め、古い分類の結果は使いません
2. **画面の作りが違っても、送信と回答の終わりを取りこぼさない観測係**(PR #2・#20、commit `356a159`・`488b054`、[`src/content/observer.ts`](src/content/observer.ts)・[`src/content/sites.ts`](src/content/sites.ts))
   - サイトごとの違いは読み取り方の定義だけにして、ChatGPT・Claude・Gemini で同じ観測係を使います
   - 回答の終わりは「停止ボタンが消えた」で決め、停止ボタンが取れない時は「**最後の回答の字数が 2.5 秒変わらない**」で決めます。送信した時点の最後の回答を覚えておき、それとは別の回答のときだけ終わりとみなすので、前の回答を新しい回答と取り違えません。送信の取りこぼしは、吹き出しが 1 つ増えたことから補います
   - 実際の画面で取りこぼした場面(前の回答が残っている会話で送る、吹き出しが遅れて出る など)は、テストにして直しました
3. **同じ計算を、VS Code の出来事で動かす**(PR #5、commit `40f78c0`、[`vscode/src/tracker.ts`](vscode/src/tracker.ts))
   - 同じ計算([`src/core/`](src/core/))を使い(読む量の上限だけエディタ向けに変えて)、エディタの出来事を同じ形に直して入れます。まとまった挿入は読む量、ターミナルやタスクの失敗は確認・検証、ファイルの切替は切替です
   - 区切りの判定もエディタ向けに作りました。入力が 3 秒止まり、終わる種類のタスクもデバッグも動いておらず、窓が前にある時だけ声をかけます
   - [Marketplace に公開](https://marketplace.visualstudio.com/items?itemName=koubeyapurin.hitoiki)し、「ひといき」と検索して入れられます

**Hack Day 中に作ったもの(主なもの)**(開会時刻のタグ `hackday-start` より後)
- **画面を参照デザインに合わせて作り直し、休憩を本人が始める形にした**(PR #1): [`src/ui/App.tsx`](src/ui/App.tsx)、[`src/ui/useDockPosition.ts`](src/ui/useDockPosition.ts)、[`src/ui/Pictogram.tsx`](src/ui/Pictogram.tsx)
- **Claude・Gemini に対応**(PR #2): 画面の読み取りをサイト別の定義([`src/content/sites.ts`](src/content/sites.ts))と共通の観測係([`src/content/observer.ts`](src/content/observer.ts))に分けた。新しい会話の 1 通目を取り逃さない
- **記録を足した**(PR #2): どのサイトか、入力の始まりと終わり、生成の始まり、分類のトークン数
- **記録の集計と、30 分タイマーとの比べ**(PR #3): [`scripts/analyze-log.ts`](scripts/analyze-log.ts)
- **VS Code 拡張**(PR #5): 同じ計算をエディタの出来事で動かし、提案・休憩・おかえりまで Chrome と同じ流れにした。[`vscode/src/tracker.ts`](vscode/src/tracker.ts)、[`vscode/src/extension.ts`](vscode/src/extension.ts)。動かし方は [`vscode/DEVELOPMENT.md`](vscode/DEVELOPMENT.md)
- **本番とデモを分けた**(PR #8): 倍速・たまる速さ・診断は本番では隠し([`src/shared/flags.ts`](src/shared/flags.ts))、パネルの詳細に「30 分ごとのタイマーだったら」の今日の比べを 1 行出す([`src/shared/timerCompare.ts`](src/shared/timerCompare.ts))。デモ用は [jphacks/tkb_2603-demo](https://github.com/jphacks/tkb_2603-demo)
- **API キー無しで全部使える**(PR #13): Cloudflare Workers の中継([`proxy/`](proxy/))を作り、初回の同意で判断・確認・切替の分類が動く。中継の公開・停止の手順は [`docs/KEYLESS_SETUP.md`](docs/KEYLESS_SETUP.md)
- **ChatGPT の取りこぼしを直した**(PR #20): 回答の終わりの決め方と、送信の補い
- **実機確認の手順と、記録を確かめるスクリプト**(PR #18): [`docs/VERIFICATION.md`](docs/VERIFICATION.md)、[`scripts/check-log.ts`](scripts/check-log.ts)
- **判断の表示**(PR #19): 計測を始めた直後は 0% と出し、分類できない時は「未計測」と理由を出して区別する
- **配布**(PR #6・#7・#11): CI でテストとビルドを回し、Chrome の zip を [Releases](https://github.com/jphacks/tkb_2603/releases/latest) に置き、VS Code 版を [Marketplace に公開](https://marketplace.visualstudio.com/items?itemName=koubeyapurin.hitoiki)した。入れ方は [配布ページ](https://jphacks.github.io/tkb_2603-demo/)

**開会前に作った土台**(事前の開発。評価の対象は上の Hack Day 中の差分です)
- コミット fac9ea6・b7d760a・1f5a4ff(10/24 未明)
- 負担の計算(2 層の器と区切りの判定): [`src/core/model.ts`](src/core/model.ts)、[`src/core/gate.ts`](src/core/gate.ts)。テストは [`src/core/model.test.ts`](src/core/model.test.ts)
- ChatGPT の画面から手がかりを取る(Hack Day 中に `observer.ts`・`sites.ts` へ作り直した)
- LLM で会話の出来事を抜き出す: [`src/shared/classifier.ts`](src/shared/classifier.ts)

開発の仕方は [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) にあります。
