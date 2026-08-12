# 202607 Service / Runtime Extraction Result

## 結果

202607実装の最初のコード変更として、workflow実行とrun state管理のQWebChannel非依存境界を追加した。

現行GUI command、response／event、connector／coreの挙動は変更していない。

## 追加した責務

| ファイル | 責務 |
| --- | --- |
| `app/services/workflow_execution_service.py` | `WorkflowEngine`生成、file／configからの1回のworkflow実行、reportとcontextの返却 |
| `app/services/errors.py` | transport非依存のapplication service error |
| `app/runtime/execution_manager.py` | run session、flow単位active run、cancel、latest context／step result |

`app/services`と`app/runtime`はPySide6、QWebChannel、`app.gui`をimportしない。

## 既存経路への接続

- GUI workerは`WorkflowExecutionService.run_config`を利用する。
- CLIは`WorkflowExecutionService.run_file`を利用する。
- `BridgeRuntime.runs`、`latest_by_flow`、`active_run_by_flow`は互換参照として維持する。
- `BridgeRuntime`の既存helper名は`ExecutionManager`への薄い委譲として維持する。
- DataFrame等のruntime objectはJSON化せず、同じPython objectをcontext／result storeへ保持する。

## 規模

| ファイル | 変更前 | 変更後 |
| --- | ---: | ---: |
| `app/gui/bridge.py` | 2254 | 2153 |
| `app/services/workflow_execution_service.py` | 0 | 71 |
| `app/runtime/execution_manager.py` | 0 | 166 |

## Verification

- `py_compile`: success
- 新規service／runtime unit test: 6 tests success
- 変更前baseline対象: 12 tests success、2 skipped
- `tests/python`全体: 52 tests success、2 skipped、failed 0
- `git diff --check`: errorなし

既存の`Pandas4Warning`とFAISSのAVX2 fallback logは出力されたが、test failureではない。

## 変更していない既存差分

作業開始前から変更されていたconnector、`core/workflow_engine.py`、`static/js/ui.fields.js`、`static/js/ui.node.detail.js`、`static/js/ui.node.shared.js`には変更を加えていない。

## 次の境界

次はtask 007でQWebChannel transport、envelope validation、dispatcherの骨格を分離する。

run workerのthread生成、event／log生成、result response整形はまだ`BridgeRuntime`に残るため、後続のrun／result taskで分離する。
