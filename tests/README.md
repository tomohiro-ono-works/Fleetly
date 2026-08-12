# tests

テスト関連の資産をこの配下へ集約する。

## 構成

- `tests/python`
  - Python unit test
  - テストケース定義
  - エビデンス生成スクリプト
- `tests/playwright`
  - Playwright 設定
  - Node.js 依存
  - spec
  - レポート / 実行結果
- `tests/docs`
  - テストケース
  - 実行結果メモ
  - 手動チェックリスト

## 主な実行例

```powershell
.\.env\Scripts\python.exe -m unittest discover -s tests\python -p "test_*.py" -v
.\tests\playwright\node_modules\.bin\playwright.cmd test --config .\tests\playwright\playwright.config.js
```
