#!/usr/bin/env bash
# 配る物を作る: Chrome 拡張の zip と VS Code 拡張の .vsix を dist-release/ に、決まった名前で置く
# 使い方: bash scripts/package.sh(リポジトリのルートで)
set -euo pipefail
cd "$(dirname "$0")/.."
out=dist-release
rm -rf "$out" && mkdir -p "$out"

rm -rf .output
npm ci
npm run zip
cp .output/*-chrome.zip "$out/hitoiki-chrome.zip"

(cd vscode && npm ci && npm run build && npx -y @vscode/vsce@3.6.0 package --no-dependencies -o "../$out/hitoiki-vscode.vsix")

ls -la "$out"
