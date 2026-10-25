# ひといき分類中継

公開と初回設定の手順は [KEYLESS_SETUP.md](../docs/KEYLESS_SETUP.md) に記載。

`npm ci` → `npm test` → `npm run check` → `npm run build` で公開せずに確認できる。
`npm run deploy` はCloudflareへの公開を行う。現在はユーザー指定の `claude-haiku-5-5` を設定し、次のdeployで分類を有効にする設定。新しい環境で停止状態から準備する場合は `CLASSIFICATION_ENABLED` を `false` に変更してから公開する。

`POST /classify` のJSONは `userText` / `assistantText` / `previousTask` の3つのみ。端末IDは `X-Hitoiki-Install-Id` ヘッダーにUUID v4で渡す。全体の枠を満たすと、新しいIDでも429になる。`GET /health` はキーや本文を返さず、稼働状態だけ返す。
