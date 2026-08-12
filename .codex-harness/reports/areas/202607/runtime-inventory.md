# runtime 実行仕様 現行実装棚卸し

## 対象

- runtime 実行仕様、run context、DataFrame 寿命、step result、cancel、log、result cache。
- 202607 方針との差分確認対象は `.docs/future/202607-runtime-data-lifetime.md` と `.docs/future/api/run-result-events.md`。

## 調査範囲

- 必須確認: `AGENTS.md`、`.codex-harness/subagents/README.md`、`.codex-harness/subagents/02-runtime.md`。
- 実装確認: `core/workflow_engine.py`、`app/gui/bridge.py`、`connectors/base_connector.py`、`connectors/*.py`。
- 呼び出し側確認: `static/js/app.js`、`static/js/ui.node.detail.js` の result/run event 呼び出し箇所。
- 補助確認: `tests/python/test_bridge_latest_context.py`、`tests/python/test_step_run_bridge.py`。

## 現行実装の事実

- run 開始時、`WorkflowEngine._run_config()` は `self.context = {}` で初期化し、`initial_context`、start variables、system variables の順に投入する。system variables は `current_date` と `user_name`。
- `BridgeRuntime._handle_flow_run()` は `run_id`、`trace_id`、`cancel_event`、`seed_context` を作り、同一 `flow_key` の実行中 run を `active_run_by_flow` で拒否する。拒否コードは `E_CONFLICT`。
- フロー全体実行の `seed_context` は空だが、単一 step 実行では `_get_latest_flow_context(flow_key)` を seed にする。`tests/python/test_bridge_latest_context.py` は前回 run の context を次の単一 step 実行へ渡す挙動を期待している。
- step 実行時、connector には `copy.copy(self.context)` が渡る。connector 内で context を直接書き換えても engine 本体の context へは戻らず、通常は `output_variable` 保存または `define_values` の後処理で反映される。
- `output_variable` がある場合、step result は `self.context[output_variable] = result` に保存される。`define_values` は result attrs から変数を展開して context に追加する。
- DataFrame result は report の `result` を `None` にし、`ui_cache` に `schema`、`preview`、`row_count` を作る。preview は `head(100)` で、超過時 `truncated` を立てる。
- datavolume は engine の `ui_cache` には保存されない。Bridge は raw DataFrame があれば集計し、raw がなく `ui_cache` のみなら schema 列と `row_count` だけ返し、各列の `items` は空になる。
- lifetime plan は `_build_sequential_lifetime_plan()` が `output_variable -> producer step` を作り、params 内の `{{var}}` / `${var}` と `loop_tasks` の `source_step_id` / `input_data` から consumer 数を数える。
- plain な `input_data: step1` は lifetime の参照検出に入らない。多くの connector は実行時には `context.get(input_data)` または `context[input_data]` で plain key を読む。
- `_decrement_lifetime_after_step()` は consumer step 完了後に producer の残 consumer 数を減らし、0 なら `self.context` から producer の `output_variable` を削除する。
- consumer が存在しない producer は `remaining_consumers` に入らないため、cache 作成直後には解放されない。run terminal 時に context 全体を明示解放する処理も見当たらない。
- DAG 実行は `flows.edges` から reachable step を作り、`ThreadPoolExecutor` で ready queue を実行する。並行実行中の同一 `output_variable` は検出して error にする。
- DAG では成功した future のみ `_decrement_lifetime_after_step()` を呼ぶ。future が例外になった consumer では producer 参照の減算が行われない。
- `loop_tasks` は source を records 化し、iteration ごとに `current_item`、`current_index`、source ref を context に置いて child step を逐次実行し、finally で復元または削除する。child step には lifetime plan が渡らない。
- cancel は Bridge の `run.cancel` が session の `cancel_event` を set し、`run.progress` の `cancel_requested` を送る。実行中 connector への interrupt / terminate は行わない。
- engine は step 開始前、loop iteration 間、DAG ready queue 周辺で cancel event を確認する。Python connector は `subprocess.Popen` 後に stdout loop と `process.wait()` を行うが、cancel token や terminate は受け取らない。
- cancel terminal は Bridge で `session["status"] = "cancelled"` になるが、送信 event は `run.failed` で payload status が `cancelled`。`run.cancelled` event は実装されていない。
- log は `_RunLogHandler` が logger record を `run.log` event として送る。payload は `run_id`、`ts`、`level`、`message` で、`step_id` と `log_seq` は含まない。
- event envelope は WebView bridge 形式の `{v, kind, type, ts, payload}`。202607 方針の `{event_id, type, ts, data}` とは異なる。
- execution/performance log は `logs/execution.log` へ JSON Lines 追記する。1日単位 rotation、10日保持、`ui_log` / `audit_log` / `debug_log` 分離、log 復元 API は見当たらない。
- run session の `report` は worker 完了時に status/error/step_id/status へ縮約される。DataFrame raw result や step ui_cache は per-run session ではなく `latest_by_flow` に保存される。
- `result.getSchema` / `result.getPreview` / `result.getDatavolume` は `run_id` を使わず、`flow_key + step_id` の latest result を読む。frontend 側にも `run_id` なしで呼ぶ箇所がある。
- `latest_by_flow` は `context`、`step_data`、`step_ui_cache`、`step_status` を保持する。`final_context` から raw DataFrame が `context` に残り、次回の単一 step 実行 seed になり得る。
- connector 共通 API は `execute(action, params, context)` で cancel token はない。CSV/Excel/BigQuery/DuckDB/Plotly/Vector/Dataintegration は `input_data` から context を読む実装がある。
- Selenium は `SESSION_STORE` に driver runtime を保持し、Bridge worker finally で `clear_session_runtime()` を呼ぶ。Chrome/Selenium の `output_var` param は connector に渡された context copy に書くため、engine context へは直接反映されない。

## 202607 方針との乖離

- 202607 方針は result API を `run_id + step_id` 正本にするが、現行 result API は latest flow result を読むため、過去 run や並行/再実行後の run 固有 result を指定できない。
- 202607 方針は runtime context を run 単位に閉じ、前回 run の DataFrame を持ち越さないが、現行は `latest_by_flow.context` に raw DataFrame が残り単一 step 実行へ渡る。
- DataFrame raw result は report/API には直接出さないが、Bridge の latest context に保持されるため、runtime 一時データと result seed/cache の責務が混ざっている。
- data area cache は `schema`、`preview`、`datavolume` 方針だが、現行 engine cache は datavolume 集計を持たない。
- consumer なし producer の解放、run cancel/failure terminal 時の raw DataFrame 全解放が現行では明示されていない。
- lifetime 参照検出は connector catalog の input ref 定義を使わず、plain `input_data` 参照を検出しないため、実行時参照と寿命計画が一致しない。
- DAG failure 時は失敗 consumer の producer 減算が行われず、terminal 状態を基準にした解放と一致しない可能性がある。
- loop child step には lifetime plan が渡らず、loop 内一時 DataFrame の iteration/loop graph 単位解放は明示されていない。
- cancel は cooperative checkpoint 中心で、Python/BigQuery/Selenium wait/CSV/Excel chunk などへの interrupt-first や connector cleanup contract は未整備。
- cancel terminal event は `run.failed` であり、202607 方針の `run.cancelled` と異なる。terminal 済み run への cancel も `accepted: false` を返さない。
- log/event envelope、`event_id`、`log_seq`、run log store、log restore API、`ui_log` / `audit_log` / `debug_log` 分離は未実装。
- error code は `E_CONFLICT`、`E_NOT_FOUND` など bridge 汎用コードで、202607 方針の `E_RUN_CONFLICT`、`E_RESULT_NOT_READY`、`E_RESULT_NOT_FOUND` と一致していない。
- `flow.run` response は `accepted` と `run_id` のみで、202607 方針の `trace_id`、`status`、`started_at` を返していない。

## 相談事項

- 単一 step 実行のために前回 context を seed する現行互換を残すか。推奨案: raw DataFrame の自動持ち越しはやめ、必要な入力は `run_id + step_id` または明示 input ref から解決する方針へ寄せる。
- `input_data`、`source_step_id`、connector 固有の context 参照を catalog/contract 化するか。推奨案: plain `input_data` も first-class input ref とし、lifetime plan と validation の入力にする。
- DataFrame cache の保存単位を `latest_by_flow` から `run_id + step_id` へ移すか。推奨案: raw runtime context と data area cache store を分離し、frontend result API は run_id 必須にする。
- datavolume cache の形をどう固定するか。推奨案: step 完了時に `row_count` と列ごとの上位値集計を cache 化し、raw 解放後も同じ応答を返せるようにする。
- cancel token を connector API に渡すか、interrupt/cleanup hook を別 contract にするか。推奨案: engine-level token と connector cleanup hook を追加し、Python/BigQuery/Selenium/ファイル書き込みから優先して扱う。
- run log store を `logs/execution.log` と統合するか分離するか。推奨案: UI 復元用 run log は `run_id` 単位または日次ファイル内 seq 付きで保存し、audit/debug とは論理的に分ける。
- terminal event 名を `run.cancelled` に変更する際、既存 frontend の `run.failed(status=cancelled)` 互換をどこまで残すか。
- producer consumer なし時の即時解放、DAG error/cancel 時の terminal consumer 減算、loop child lifetime を一括で graph/reference based lifetime として再設計するか。

## 参照ファイル

- `.codex-harness/subagents/README.md`: サブエージェント共通ルール、レポート形式。
- `.codex-harness/subagents/02-runtime.md`: runtime 調査対象と確認項目。
- `.docs/future/202607-runtime-data-lifetime.md`: runtime context、DataFrame lifetime、data area cache、cancel/failure 方針。
- `.docs/future/api/run-result-events.md`: run/result/cancel/SSE/log API 方針。
- `core/workflow_engine.py`: `WorkflowEngine._run_config()`、`_execute_step()`、`_run_step_sequential()`、`_run_ready_queue()`、`_build_dataframe_ui_cache()`、`_build_sequential_lifetime_plan()`、`_decrement_lifetime_after_step()`、`_mark_cancelled()`。
- `app/gui/bridge.py`: `BridgeRuntime._handle_flow_run()`、`_run_flow_worker()`、`_handle_run_cancel()`、`_handle_result_get_summary()`、`_handle_result_get_schema()`、`_handle_result_get_preview()`、`_handle_result_get_datavolume()`、`_update_latest_by_flow()`、`_get_latest_step_payload()`、`_RunLogHandler.emit()`、`emit_event()`、`_append_execution_log()`。
- `connectors/base_connector.py`: `BaseConnector.execute()`、`set_execution_logger()`、`log_execution()`、`attach_dataframe_schema()`。
- `connectors/csv_connector.py`: `CSVConnector.execute()`、`write_csv()`。
- `connectors/excel_connector.py`: `ExcelConnector.execute()`、`write_excel()`。
- `connectors/dataintegration_connector.py`: `_resolve_input_dataframe()`。
- `connectors/bigquery_connector.py`: `BQConnector.execute()`、`load_data()`。
- `connectors/duckdb_connector.py`: `DuckConnector.execute()`、`create_table()`。
- `connectors/plotly_connector.py`: `_get_input_data()`。
- `connectors/vector_connector.py`: `embedding_vector_db()`。
- `connectors/python_connector.py`: `execute_python()`。
- `connectors/selenium_connector.py`: `clear_session_runtime()`、`_ensure_runtime()`、`_store_runtime()`、`_restore_runtime()`、`_resolve_source_session_key()`、`_save_output()`。
- `connectors/chrome_connector.py`: `open_in_chrome()`。
- `connectors/windows_connector.py`: `define_values()`。
- `static/js/app.js`: `flow.run`、`result.getSummary`、run event handling。
- `static/js/ui.node.detail.js`: `result.getSchema` / `result.getPreview` 呼び出し。
- `tests/python/test_bridge_latest_context.py`: latest context を単一 step 実行 seed にする期待挙動。
- `tests/python/test_step_run_bridge.py`: DataFrame report result が `None` で ui_cache に入る期待挙動。

## 未確認事項

- connector catalog / config 側に input ref 定義が存在するかは未確認。
- 大容量 DataFrame での memory release 実測、GC タイミング、Bridge latest context の保持量は未計測。
- WebView bridge 以外に `/api/runs/*` や `/api/events` 相当の HTTP/SSE 実装があるかは未確認。
- BigQuery job cancel、Selenium wait 中断、CSV/Excel chunk 中断の実運用上の安全な停止方法は未検証。
- `result.getDatavolume` の frontend 利用箇所は今回の検索範囲では見つからなかったが、未検索の生成物や外部呼び出しは未確認。
