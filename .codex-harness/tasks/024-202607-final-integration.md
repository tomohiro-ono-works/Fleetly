# Task 024: 202607最終integration

## 状態

完了

## 目的

Phase 12として、202607仕様とproduction実装の残差を解消し、
Windows版のPySide／QWebChannel、security、process、resource、log、
run lifecycleを自動検証へ固定する。

## 実装対象

### ProcessRunner

- connectorが待機する外部processの共通componentを追加する。
- process起動、stdout／stderr分離取得、exit code、timeout、cancel、
  Windows process tree終了、encoding、cwd、environmentを共通化する。
- stdout／stderrは上限付きで保持し、secretをmaskする。
- stdoutは通常run log、stderrはwarning／診断logへ転送する。
- `PythonConnector.execute_python`と`ShellConnector.execute_bat`を移行する。
- Pythonはapp同居venvの`sys.executable`へ固定する。
- Chrome、Selenium、Plotlyは直接process管理の明示的例外を維持する。

### Resource lifecycle

- Selenium runtimeをrun／documentの所有関係で追跡する。
- flow runはrun終了、error、cancelを上限として解放する。
- step runは最新resourceとして保持し、同step再実行、無効化、
  document close、app終了時に解放する。
- driver本体をfrontendへ返さない。

### GUI／log

- 同じWindows userでZizai GUIを単一instanceに制限する。
- 2つ目のprocessはbackendと`session_id`を作らず終了する。
- GUI entrypointはhostの終了codeを返す。
- app logの保持期間を10日に統一する。
- `gui_app_log`、`cli_app_log`、`debug_log`を別file名にし、
  debug logはdebug mode時だけ作成する。
- `run_log`は既存`RunLogStore`を正本として維持する。

### Integration test

- 実Qt WebEngineへlocal pageを読み込み、QWebChannelの
  `backendBridge`を通してcommand／responseを往復するsmokeを追加する。
- 1 QObject／1 slot／1 signal、production entry制限、remote resource遮断、
  shutdown後command拒否を既存testと合わせて固定する。
- `bin/ziz.bat`相当のentrypoint、単一instance、process cancel、
  log rotation／種別分離を自動testする。

## 対象外

- 外部BigQuery、Google認証、実browser、実Excel appへの接続
- connector固有の業務結果を変更すること
- localhost server、HTTP、SSE、WebSocket
- macOS／Linux向け分岐

## 完了条件

- ProcessRunner経由でPython／BATの出力、失敗、cancel、上限が制御される。
- Selenium resourceが仕様の終了点で解放される。
- 2つ目のGUI processがbackend作成前に拒否される。
- app logが種別別・日別・10日保持で作成される。
- 実Qt WebEngine／QWebChannel smokeがWindows環境で成功する。
- Python、Playwright、JavaScript構文、差分検査がすべて成功する。

## 完了結果

- `shared/process_runner.py`へ待機型外部process実行を共通化した。
- Selenium runtimeをmanaged resourceとしてrun／step／document／app終了境界へ接続した。
- Windows GUI単一起動、host終了code、GUI／CLI／debug log分離、10日保持を実装した。
- 旧`execution.log`への二重保存を削除し、run log／app logへ統一した。
- 実Qt WebEngine上のQWebChannel往復とproduction host起動終了を自動test化した。
- Python 144件成功・2件skip、Playwright 93件成功、JavaScript構文、
  `git diff --check`、配布用`.env`のnative smokeが成功した。

実装報告は
`.codex-harness/reports/areas/202607/final-integration-20260729.md`
を参照する。
