# Task 024 202607最終integration

## 結果

Phase 12として、Windows版の外部process、managed resource、GUI単一起動、
log lifecycle、実Qt WebEngine／QWebChannelをproduction経路へ実装し、
202607版の自動回帰検証を固定した。

## 実装

- `shared/process_runner.py`へstdout／stderr、exit code、timeout、cancel、
  Windows process tree終了、secret mask、1 MiB出力量上限を共通化した。
- `PythonConnector.execute_python`と`ShellConnector.execute_bat`を
  `ProcessRunner`へ移行し、Pythonはapp同居`sys.executable`へ固定した。
- `app/runtime/managed_resources.py`を追加し、Selenium driverを
  flow終了、step再実行／無効化、document close、app終了時に解放する。
- `app/gui/single_instance.py`を追加し、2つ目のGUIをbackend作成前に拒否する。
  CLIはGUI lockを使用しない。
- app logを`gui_app_log`／`cli_app_log`／`debug_log`へ分離し、
  debug logはdebug modeだけ、全logは日別・10日保持・合計1 GiB soft上限とした。
- 旧`execution.log`への二重保存を削除し、run関連は`run_log`、
  GUI制御は`gui_app_log`へ統一した。
- 実Qt WebEngineのQWebChannel往復とproduction `home.html`の
  起動／終了smokeを追加した。

## 検証

- Python compileall: 成功
- Python unit／integration: 144件成功、2件skip
- Playwright Chromium: 93件成功
- production JavaScript構文: 成功
- `bin\ziz.bat --help`: 成功
- 配布用`.env` QWebChannel smoke: 成功
- 配布用`.env` production GUI host smoke: 成功
- `git diff --check`: 成功

## 残存注意

- Python test中に既存`core/type_registry.py`のPandas 4 deprecation warningが出るが、
  今回の202607機能に失敗はない。将来のPandas 4対応taskで置換する。
- 外部BigQuery、Google認証、実browser操作、実Excel app接続はTask 024対象外であり、
  Task 025のWindows外部環境受け入れ確認で後続確認した。
