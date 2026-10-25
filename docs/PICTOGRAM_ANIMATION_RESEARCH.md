# ピクトグラムの動きの調査

調査日: 2026-10-24。今回は調査のみ。ライブラリの追加、運動のSVG、アニメーションの実装は変更していない。

2026-10-25追記: Issue #12の条件とユーザーの実装指示に合わせ、SVG＋CSSで3種類の動きを実装した。以下は調査時点の比較。現在の設計・検証・動画は [PICTOGRAM_MOTION.md](PICTOGRAM_MOTION.md) を参照。

## 今の動きが不自然に見える理由

コードを確認した結果に基づく見立て。

- 肩回しは、ひと続きの腕のパスを肩の周りで360度回している。肩・肘・手首の曲がりを別々に表現できず、腕が大きく振り回されて見える。
- 背伸びは体全体の縦方向の拡縮で表現している。腕を上げる動作よりも、体そのものが伸び縮みして見える。
- 左右に倒す動きは、脚も含む全身を腰付近から回転させている。足を地面に残して上半身を倒す構造になっていない。

該当箇所は `src/ui/Pictogram.tsx` と `src/ui/style.css` の `hi-picto-*` / `hi-spin` / `hi-reach` / `hi-sway`。

ライブラリを入れるだけでは解消しない。まず足・脚・胴体・頭・上腕・前腕を分け、関節の回転軸と動かす順番を設計する必要がある。

## 候補と、この拡張での使い分け

以下の適性は、公式資料と現在のReact・SVG構成からの判断。容量や実機負荷の比較計測はまだ行っていない。

| 候補 | できること・向く場面 | 導入時に必要なこと | 今回の評価 |
|---|---|---|---|
| SVG + CSS / Web Animations API | 関節ごとの回転と少数のキーフレーム。外部ライブラリを追加せずに扱える | SVGの部品分け、回転軸、動作のタイミングを自分で設計する | 3種類の簡単な動作を軽く保つ案 |
| SVG + Motion for React | React内でSVGの変形やキーフレーム、繰り返し、動きの緩急を指定できる | SVGを関節ごとに分け、Motionを追加する。人体の構造は自動では作られない | 現在のコードから進める第一候補 |
| SVG + GSAP | SVG座標で回転軸を指定でき、複数部位の動作をタイムラインで揃えられる | SVGの部品分けとタイムラインの作成、Reactからの生成・破棄を管理する | 複数部位の細かい演出が増える場合の候補 |
| Rive | ボーン・IKなどを使ってキャラクターを組み、ビジュアルに動きを調整できる。React用ランタイムもある | Riveでの素材制作、`.riv`ファイルとJS/WASMランタイムの組み込み、描画方式の選択 | デザイン側で動きを作り込むなら有力 |
| Lottie / lottie-web | 制作済みのアニメーションJSONをSVGやCanvasで再生し、ループ・停止・速度を制御できる | アニメーション素材の制作・調達。公式の代表的な制作経路はAfter Effects + Bodymovin | 完成した運動素材を受け取れるなら向く |

公式資料:

- [Web Animations API: Element.animate()](https://developer.mozilla.org/en-US/docs/Web/API/Element/animate)
- [Motion: React SVG animation](https://motion.dev/docs/react-svg-animation)、[Transitions](https://motion.dev/docs/react-transitions)
- [GSAP: SVGのtransformOrigin / svgOrigin](https://gsap.com/docs/v3/GSAP/CorePlugins/CSS/#svg)
- [Rive: ボーン・IKなどの機能](https://rive.app/features)、[React](https://rive.app/docs/runtimes/react/react)、[Web JS/WASMランタイム](https://rive.app/docs/runtimes/web/web-js)
- [lottie-web公式リポジトリ・制作と再生の説明](https://github.com/airbnb/lottie-web)

## おすすめの進め方

今のSVGとReactを使い続けるなら、**関節で部品を分けたSVG + Motion**を第一候補にする。追加依存を避けたい場合は、同じ部品構造をCSSまたはWeb Animations APIで動かせる。まず1種類の動きを小さく試作してから選ぶ。

デザイナーが画面を見ながら動きを調整したいなら、Riveで人物のボーンと動作を制作し、Reactで再生する方向を検討する。完成済みの素材を使う運用ならLottieが候補になる。

いずれも、足を固定し、肩・肘・腰を適切な位置で曲げ、「準備 → 動作 → 少し止める → 戻る」という流れを作ることが先。3種類を同時に作り直す前に、肩回し1種類で見え方を確認する。

## Chrome拡張として確認すること

- JavaScriptと必要な素材を拡張に同梱する。CDNからスクリプトを読み込む構成を前提にしない。
- RiveではWASMと`.riv`の読み込み経路も確認する。現在のUIはコンテンツスクリプトのShadow DOM内で動くので、拡張ページのCSPと混同しない。Chromeの公式資料では、isolated worldのCSPは`wasm-unsafe-eval`を含み、外部スクリプトや`eval()`には制限がある。Riveが使えないと判断できる根拠にはならず、実際の組み込み確認が必要。
- Lottieの素材も含め、画像・フォント・ランタイムの外部取得や式の利用を確認し、実際の拡張環境で再生を確かめる。
- ライト／ダークで色が合うこと、`prefers-reduced-motion`で静止表示できること、休憩終了時に再生を停止・破棄できることを確認する。

根拠: [Chrome: Content scripts / Content Security Policy](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts#content_security_policy)、[Chrome: 拡張ページのCSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)。

この段階では依存追加や実装は行わず、次の作業でSVG + Motionによる試作と、Riveでの素材制作のどちらに進むかを決める。
