# Playwright テスト

## 目的

- `zizai` の **browser-only で確認できる UI 動作** を回帰テストする
- ネイティブアプリ固有の処理と WebView 外の処理はここでは対象外とする

## 対象外

- `PySide6 + Qt WebEngine` のネイティブウィンドウ挙動
- `QFileDialog` / ネイティブパス編集ダイアログ
- WebView bridge の native callback 実処理
- 外部 Chrome / RPA 実行
- Windows 証明書ストア

## 実行対象

- `static/home.html` をローカル static server 上で開いた browser-only UI

## ローカルサーバー方針

- Playwright 実行時は `tests/playwright/playwright_static_server.py` を使う
- bind は `127.0.0.1` のみ
- 配信対象は `/static/` 配下のみ
- directory listing は無効
- `GET / HEAD` 以外は拒否
- `Cache-Control: no-store` を付ける

## 主要ファイル

- Playwright 設定: [playwright.config.js](/c:/Users/tomoh/Documents/Sandbox/zizai/tests/playwright/playwright.config.js)
- テスト本体: [ui-shell.spec.js](/c:/Users/tomoh/Documents/Sandbox/zizai/tests/playwright/specs/ui-shell.spec.js)
- テストケース一覧: [test-cases.md](/c:/Users/tomoh/Documents/Sandbox/zizai/tests/docs/playwright/test-cases.md)
- 最新結果: [latest-results.md](/c:/Users/tomoh/Documents/Sandbox/zizai/tests/docs/playwright/latest-results.md)

## 実行方法

```powershell
.\tests\playwright\node_modules\.bin\playwright.cmd test --config .\tests\playwright\playwright.config.js
```

UI runner を使う場合:

```powershell
.\tests\playwright\node_modules\.bin\playwright.cmd test --config .\tests\playwright\playwright.config.js --ui
```
