# 202607 Result Cache / Log Restore QWebChannel Result

## 結果

result readとrun log復元を`run_id + step_id`のpublic contractへ移行し、表示用cacheとlog storeをtransport非依存runtime／serviceへ分離した。

## 実装

| 領域 | 成果物 |
| --- | --- |
| result cache | `app/runtime/result_cache.py` |
| run log | `app/runtime/run_log_store.py` |
| service | `app/services/result_service.py` |
| bridge / security | `app/gui/bridge.py`、`app/gui/bridge_security.py` |
| frontend | `static/js/result.adapter.js` |
| test | `tests/python/test_result_cache_log_service.py`、`tests/playwright/specs/result-adapter.spec.js` |

## Contract

- summaryは`run_id`、schema／previewは`run_id + step_id`で取得する。
- raw DataFrameは表示cacheへ保持せず、schema／preview／row_countだけを保持する。
- previewは100行、1step 2 MiB、1セル64 KiBで制限し、超過時は`truncated: true`にする。
- flow runは同一`doc_session_id + flow_id`の最新1件、step runはstep別最新1件の表示cacheだけを残す。
- document close時に対象summary／step cache／画面復元用log memoryを破棄する。日次log fileは破棄しない。
- run logはrun内単調増加`log_seq`を持ち、最新／before／afterを最大500件、昇順で返す。
- run log fileは日次JSONL、当日を含む10日保持、run log内で1 GiB soft上限とする。
- `result.getDatavolume`はhandler／security rule／frontend経路から削除した。
- cancellation terminal eventを`run.failed`ではなく`run.cancelled`としてfrontendまで維持する。

## 実行境界の修正

- `flow_key`はpathではなく`doc_session_id + flow_id`で作る。
- 実行pathはglobalな`current_flow_path`ではなく、対象document sessionから解決する。
- terminal eventを送る前にresult cacheへsummary／schema／previewを格納する。
- frontend componentはresult command文字列を持たず、result adapterがstepごとの対象`run_id`を付与する。

## Verification

- Python全体: 100 success、2 skipped、failed 0
- Task 011 Python: 10 success
- Playwright focused: 4 success、failed 0
- Python `py_compile`: success
- JavaScript `node --check`: success
- `git diff --check`: errorなし
- production内`result.getDatavolume`: 残存0

旧`tmp-data-*`系4 specは旧catalog response、旧connector ID、`payload.flow`を使うためapp初期化前に停止する。Task 011のresult経路へ到達しない既存specであり、現行contractのfocused specとは分離した。

## 後続task

AppShell、TabularImportAssistant、WorkflowDesignerのlibrary分離後、Task 015で`flow.run`を`run.start`へ移行し、UUIDv7 ID、step完了直後の逐次result格納、GUI session全体128 MiB制御、`app.getStatus`のrun索引、cancel／event lifecycleを実装する。

`gui_app_log`／`cli_app_log`／`debug_log`と全log種別合算1 GiB制御は、run log以外のlog storeを追加する後続taskで扱う。
