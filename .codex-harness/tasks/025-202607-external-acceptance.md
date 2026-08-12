# Task 025: 202607外部環境受け入れ確認

## 状態

完了

## 目的

Task 024で対象外としたGoogle Cloud SDK、BigQuery API、実Chrome、
実ExcelファイルをWindows配布用`.env`から確認し、実環境だけで発生する
問題を修正する。

## 確認対象

- Google Cloud SDK実行fileの解決とADC状態確認
- BigQuery `SELECT 1` dry runによるread-only API確認
- Selenium headless Chromeによるallowlist URL遷移、DOM取得、resource解放
- ExcelConnectorによる一時`.xlsx`の書出し／再読込

## 安全条件

- Google account、project ID、access tokenをreportや会話へ出さない。
- BigQueryはdry runだけとし、table作成／更新／削除を行わない。
- Seleniumはsecurity policyで許可済みのURLだけを使用する。
- Excelは一時directoryだけへ出力し、確認後に削除する。

## 現在の結果

- Windowsで`gcloud`がPowerShell scriptへ解決される一方、
  Python `subprocess`では拡張子なしcommandを起動できない問題を検出した。
- `shared/google_cloud_cli.py`で`gcloud.cmd`を明示解決し、
  `GoogleAuthService`と`BQConnector`へ適用した。
- Python全145件成功、2件skip。
- Selenium実Chromeの遷移、DOM取得、resource解放は成功した。
- Excel実ファイルの書出し、2行再読込、値一致は成功した。
- sandbox外の通常Windows環境でADC認証済みを確認した。
- BigQuery `SELECT 1 AS value` dry runは検証成功、実行なし、
  推定処理量0 bytesだった。

実施報告は
`.codex-harness/reports/areas/202607/external-acceptance-20260730.md`
を参照する。
