# localhost API 詳細 現行実装棚卸し

## 対象

- 担当範囲は、現行 QWebChannel bridge message と 202607 localhost API 方針との差分棚卸し。
- 本レポートは現行実装の事実、202607 方針との乖離、ユーザー相談事項を分ける。endpoint 名や security policy はここでは確定しない。
- 出力先は本ファイルのみ。実装変更、`.docs/` 更新、他サブエージェントのレポート編集は行っていない。

## 調査範囲

- 指示書で指定された `app/gui/bridge.py`、`static/js/bridge.js`、`static/js/app.js`、`static/js/workspace.manager.js` を確認した。
- 202607 方針として `.docs/future/202607-localhost-api.md`、`.docs/future/202607-localhost-security.md`、`.docs/future/202607-localhost-server-structure.md`、`.docs/future/api/` 配下を確認した。
- message の実利用箇所確認のため、追加で `app/gui/host.py`、`static/js/ui.fields.js`、`static/js/ui.node.detail.js`、`static/modal/excel_modal.js`、`static/modal/csv_modal.js` を限定参照した。
- 調査方法は静的読取と `rg` による限定検索のみ。実行テスト、E2E、ブラウザ表示確認はしていない。

## 現行実装の事実

### bridge transport / envelope

- 現行 frontend は `static/js/bridge.js` で `window.zizBridge` / `window.zizPackages.core.bridge` を作り、Qt の `QWebChannel` 経由で `backendBridge.postMessage(JSON.stringify(envelope))` を呼ぶ。
- request envelope は `{ v: "1.0", kind: "cmd", type, id, ts, payload }`。backend は `BridgeRuntime.PROTOCOL_VERSION = "1.0"` と `kind === "cmd"` を検査する。
- response は `{ v, kind: "res", type, id, ts, payload }` または `{ v, kind: "res", type, id, ts, error }`。event は `{ v, kind: "evt", type, ts, payload }`。
- `static/js/bridge.js` は pending request を `id` で管理し、通常 45 秒、preview 180 秒、bridge 初期化待ち 10 秒の timeout を持つ。`file.pickFile` / `file.pickFolder` は user interaction として timeout 無し。
- backend 側は `WebViewBridge.postMessage` が同期処理する。ただし `preview.readExcel` / `preview.readCsv` だけ `_ASYNC_MESSAGE_TYPES` として別 thread で処理する。
- Qt 側は `app/gui/host.py` で `QWebChannel(page)` を作り、`backendBridge` として `WebViewBridge` を登録している。
- 現行画面は `file://` の HTML を `QWebEngineView` に読み込む。`LockedDownRequestInterceptor` / `LockedDownPage` が `file`, `qrc`, `data`, `blob`, `about` 以外を拒否し、`LocalContentCanAccessRemoteUrls` は `False`。

### 現行 message type 一覧

| 分類 | type | backend handler | 現行 request/response の主な事実 |
| --- | --- | --- | --- |
| app | `app.getStatus` | `_handle_app_get_status` | request payload なし。`app`, `host`, `protocol_version`, `gui_mode`, `security`, `capabilities`, `security_policies`, `runtime_context_defaults` を返す。 |
| app | `app.logUiEvent` | `_handle_app_log_ui_event` | `action`, `source`, `elapsed_ms`, `detail` を log に出す。`action` が `run.*` の場合は execution log にも書く。 |
| app | `app.windowControl` | `_handle_app_window_control` | `action` は `minimize/maximize/close/drag`。host callback 呼び出し後 `accepted`, `action`, `state` を返す。 |
| input | `mouse.coordinateCapture.start` | `_handle_mouse_coordinate_capture_start` | `capture_id` 必須。host overlay を開始し、結果は event で返す。 |
| app | `app.openExternal` | `_handle_app_open_external` | `url` は http/https 必須、`prefer` 既定は `chrome`。Chrome または既定ブラウザを起動し、`accepted`, `url`, `opened_via` を返す。 |
| auth | `app.googleAuthLogin` | `_handle_app_google_auth_login` | `mode` は `application-default` のみ。`gcloud auth application-default login` を別プロセスで起動し、`launched`, `command`, `mode` を返す。 |
| auth | `app.googleAuthStatus` | `_handle_app_google_auth_status` | `gcloud config get-value account` と `gcloud auth application-default print-access-token` で状態確認し、access token は返さない。 |
| app | `app.getSuggestIndex` | `_handle_app_get_suggest_index` | `connector` は英数字と `_`。`config/suggest_index/suggest_index_<connector>.yml` を読み、`path` を含む response を返す。 |
| flow | `flow.list` | `_handle_flow_list` | `scope` は `local/workspace` を受け付けるが、現行の取得元は `kind` に応じた local recent/template。`flow_token`, `display_name`, `display_hint`, `modified_at` を返す。 |
| flow | `flow.load` | `_handle_flow_load` | `ref`/`flow_token`、または `scope + rel_path`、または open dialog。成功時 `selected`, `mode`, `file_name`, `flow`, `hidden_bindings` を返す。`flow_ref` は無い。 |
| flow | `flow.save` | `_handle_flow_save` | `workspace_tab_id` 必須。`mode`, `file_name`, `flow`, 任意の `scope + rel_path` を受ける。hidden ref を実値へ戻して YAML 保存し、`saved`, `file_name` を返す。 |
| run | `flow.run` | `_handle_flow_run` | `workspace_tab_id`, `mode`, `flow`, 任意の `step_id`。`run_id` / `trace_id` / `flow_key` を生成し worker thread を開始する。response は `run_id`, `accepted` のみ。 |
| flow | `flow.tabClosed` | `_handle_flow_tab_closed` | `workspace_tab_id` 必須。該当 hidden session を削除し、`closed`, `workspace_tab_id` を返す。 |
| run | `run.cancel` | `_handle_run_cancel` | `run_id` 必須。`cancel_event` を set し、`run.progress` の `cancel_requested` を emit して `accepted`, `run_id` を返す。frontend 呼び出し箇所は今回の限定検索では見つからなかった。 |
| result | `result.getSummary` | `_handle_result_get_summary` | `run_id` で `self.runs` を引き、summary を返す。 |
| result | `result.getSchema` | `_handle_result_get_schema` | `step_id` 必須。`mode` と任意 `flow_key`、なければ current flow から作る `flow_key` で latest result を探す。`run_id` は使わない。 |
| result | `result.getPreview` | `_handle_result_get_preview` | `step_id` 必須。latest result から最大 100 行の `columns`, `rows`, `row_count`, `truncated` を返す。`run_id` は使わない。 |
| result | `result.getDatavolume` | `_handle_result_get_datavolume` | `step_id`, 任意 `top_n`。latest result から value counts を返す。frontend 呼び出し箇所は今回の限定検索では見つからなかった。 |
| file | `file.pickFile` | `_handle_file_pick_file` | `workspace_tab_id`, `title`, `filters`, `current_ref/current_value`, `step_name`, `field_key`。選択 path を hidden ref 化し、`ref`, `display_name`, `display_hint`, `selected` を返す。 |
| file | `file.pickFolder` | `_handle_file_pick_folder` | `file.pickFile` と同様に folder path を hidden ref 化する。 |
| workspace | `workspace.pickRoot` | `_handle_workspace_pick_root` | host folder dialog で root を選ぶ。root symlink と root 配下 symlink を拒否し、`root_path`, `config_path` を返す。 |
| workspace | `workspace.getRoot` | `_handle_workspace_get_root` | `workspace_root` 未設定時、`base_dir/workflows` があれば自動設定。無ければ picker を呼ぶ。 |
| workspace | `workspace.setRoot` | `_handle_workspace_set_root` | `root_path` を設定/解除する。symlink root と symlink 含有 root は拒否。 |
| workspace | `workspace.list` | `_handle_workspace_list` | `scope`, `rel_path`。root/config 配下に解決し、entry 一覧を返す。response に `base_path`, 絶対 `path` を含む。 |
| workspace | `workspace.stat` | `_handle_workspace_stat` | `scope`, `rel_path`。file の `mtime_ns`, `size`, `exists` を返す。 |
| workspace | `workspace.readText` | `_handle_workspace_read_text` | `.md/.sql/.py/.json/.zizd` のみ読む。`content`, `encoding`, `mtime_ns`, `size` を返す。 |
| workspace | `workspace.writeText` | `_handle_workspace_write_text` | `scope`, `rel_path`, `content`, `force`, `expected_mtime_ns`。既存 file の拡張子制限と mtime conflict 検知あり。新規 file の拡張子制限は `target.exists()` 条件内でのみ確認される。 |
| workspace | `workspace.mkdir` | `_handle_workspace_mkdir` | `scope`, `rel_path`。既存同名を拒否して folder 作成。 |
| workspace | `workspace.delete` | `_handle_workspace_delete` | `scope`, `rel_path`。symlink は拒否するが、directory は `recursive` field なしで `shutil.rmtree` する。 |
| preview | `preview.readExcel` | `_handle_preview_read_excel` | `workspace_tab_id`, `field_key`, `current_ref/current_value`, `sheet_name`。hidden/current path を実 path に解決して Excel preview を返す。 |
| preview | `preview.readCsv` | `_handle_preview_read_csv` | `workspace_tab_id`, `field_key`, `current_ref/current_value`, `encoding`, `delimiter`。CSV preview を返す。encoding/delimiter の厳密 allowlist は無い。 |

### run / result / log event の現行経路

- run start は `flow.run` response で `run_id` を返したあと、worker thread が `run.progress`, `run.log`, `run.stepStatus`, `run.completed`, `run.failed` を `messageToFrontend` 経由で emit する。
- `_RunLogHandler` は `logging.INFO` 以上を `run.log` として emit し、payload は `run_id`, `ts`, `level`, `message`。`log_seq` は無い。
- `run.stepStatus` payload は `run_id`, `step_id`, `status`, `message`。
- 成功時 terminal event は `run.completed`。失敗時は `run.failed`。cancel 時も `run.failed` with `status: "cancelled"` を emit し、`run.cancelled` event は現行実装に無い。
- frontend は `ziz:evt` を受け、`run.completed` / `run.failed` 後に `result.getSummary` を再取得して最終表示する。
- result data は `self.latest_by_flow[flow_key]` の `step_data` / `step_ui_cache` に保存される。`result.getSchema/getPreview/getDatavolume` は `run_id + step_id` ではなく、latest の `flow_key + step_id` で探す。
- execution log は `logs/execution.log` に NDJSON 追記する。`run.start`, `run.core.finish`, `run.result.store`, `run.finish`, `run.step`, `run.ui` などがある。

### hidden / session / current flow state の保持場所

- `BridgeRuntime` が `current_flow_path`, `current_file_name`, `current_mode`, `workspace_root`, `config_root` を持つ。
- `BridgeRuntime._flow_tokens` は recent/template list の path を `flow:<uuid>` に対応づける。
- `BridgeRuntime._hidden_sessions` は `workspace_tab_id` ごとに `{ values, meta, counters }` を持ち、file path / folder path / output path / bucket などを `{{hidden.<scope>.varN}}` に置換する。
- `BridgeRuntime.runs` は run session、`active_run_by_flow` は同一 flow の実行中 conflict 検知、`latest_by_flow` は latest result/context を保持する。
- frontend 側では `static/js/workspace.manager.js` が tab id を `workspace_tab_id` として使い、iframe 内 `app.js` と `window.postMessage` / CustomEvent で load/state/run-state を連携する。

### 現行 error response

- bridge contract 不一致は `E_CONTRACT_VERSION_MISMATCH`、JSON 不正や必須項目不足は `E_VALIDATION`。
- handler 内の `BridgeApiError` はその code を返す。現行で確認できた domain code は `E_CONFLICT`。
- `FileNotFoundError` は `E_NOT_FOUND`、`PermissionError` は `E_ACCESS_DENIED`、その他例外は `E_INTERNAL`。
- 未許可 message type は `E_ACCESS_DENIED`。
- error envelope は `code`, `message`, 空 `detail`, `retryable: false`, 毎回生成の `trace_id` を持つ。
- frontend 側の送信前/timeout error として `E_NOT_READY`, `E_SEND_FAILED`, `E_QUEUE_OVERFLOW`, `E_NOT_READY_TIMEOUT`, `E_RESPONSE_TIMEOUT` がある。

### Origin / Referer / token / CORS 相当

- 現行は HTTP localhost API ではないため、session token、Origin check、Referer check、CORS、`Content-Type: application/json` check は存在しない。
- 代替的な制限は Qt WebEngine の request/navigation lock と QWebChannel object の WebView 内閉じ込め。`app.getStatus` も `external_requests_blocked`, `navigation_locked`, `remote_debugging_disabled` などを返すだけで、API 認可ではない。
- `app.openExternal`、`app.googleAuthLogin`、`workspace.delete`、`flow.run` は backend 側の security policy / confirmation gate を通さず実行される。`workspace.delete` は UI 側 `window.confirm` があるが backend 必須確認ではない。
- 現行 log/response には実 path が出る箇所がある。例: `workspace.list` の `base_path/path`、`workspace.getRoot` の `root_path/config_path`、`app.getSuggestIndex` の `path`、`flow.save` の save trace、workspace error log の `root_path`。

## 202607 方針との乖離

### transport / API contract

- 202607 方針は `http://127.0.0.1:<random_port>` の localhost API、header/cookie token、Origin/Referer、HTTP method、JSON content-type、`ok/data/meta` envelope。現行は `file://` + QWebChannel + `v/kind/type/id/payload` envelope。
- 202607 方針は frontend API client 集約と endpoint 名の UI component 直書き禁止。現行は `app.js`、`workspace.manager.js`、`ui.fields.js`、modal、node detail などが bridge command 文字列を直接呼ぶ。
- 202607 server structure は route / service / runtime state 分割。現行 `app/gui/bridge.py` は dispatch、flow、run、workspace、preview、hidden value、event、QWebChannel を 1 file に持つ。

### command と endpoint 対応の差分

- 202607 docs 上の対応は、概ね `app.getStatus -> GET /api/session/status`、`flow.run -> POST /api/runs/start`、`result.* -> GET /api/runs/{run_id}/...`、`workspace.* -> /api/workspace/...`、`preview.* -> /api/previews/...`、event -> `GET /api/events`。
- 現行 response は 202607 schema と一致しない箇所がある。代表例:
  - `app.getStatus` は `protocol_version` と WebView lock 状態を返すが、`api_version`, `bind`, `origin_check`, `cors`, `token_transport` は無い。
  - `flow.load/save` は `flow_ref` を返さない。
  - `flow.run` response は `trace_id`, `status`, `started_at` を返さない。
  - `result.getSchema/getPreview/getDatavolume` response は `run_id`, `step_id` を含まず、request も `run_id` を使わない。
  - `workspace.list` は `mtime_ns` ではなく `modified_at` に ns integer を入れ、さらに `base_path` と絶対 `path` を返す。
  - `workspace.delete` は request に `recursive` が無く、folder 削除時も backend は即 recursive delete する。
  - `app.getSuggestIndex` は設定 file の実 path を response に含むが、202607 schema は含めない方針。
  - `app.googleAuthLogin` は `command` を返すが、202607 schema は `provider` などを想定している。

### run / result / events

- 202607 方針は result API の正本 key を `run_id + step_id` とし、latest result を frontend が推測しない。現行は `flow_key + step_id` の latest store が result 取得の実体。
- 202607 方針は `E_RUN_CONFLICT`, `E_RUN_NOT_FOUND`, `E_RESULT_NOT_READY`, `E_RESULT_NOT_FOUND` などを区別する。現行は多くが `E_NOT_FOUND` / `E_VALIDATION` / `E_CONFLICT` に丸まる。
- 202607 方針は SSE event envelope に `event_id`, `type`, `ts`, `data` を必須化し、log に `log_seq` を持たせる。現行 event は QWebChannel `kind: "evt"` で `event_id` / `log_seq` が無い。
- 202607 方針は cancel 後 terminal event を `run.cancelled` とする。現行は cancel を `run.failed` with `status: "cancelled"` で通知する。
- 202607 方針は再接続後に log 復元 API `GET /api/runs/{run_id}/logs?after_seq=...` を使う。現行に API と sequence は無い。

### workspace / path / preview

- 202607 方針は path を含む参照でも POST + token/Origin/Referer + path 正規化 + scope 制限。現行は path 正規化と workspace/config 配下チェックはあるが、HTTP request 制約と session 認可は無い。
- 202607 方針は `workspace.delete` を dangerous + 必須確認 + folder は `recursive: true` 必須。現行 backend は `recursive` を要求せず、UI confirmation に依存している。
- 202607 方針は `workspace.write-text` で許可拡張子のみ。現行は既存 file の拡張子だけ確認しており、新規 file 作成時の拡張子確認が弱い可能性がある。
- 202607 方針は preview read を hidden ref/current path のみ、workspace 外 path は policy 対象。現行 preview は hidden/current path を実 path に解決して読むが、workspace 外 path に対する policy/confirmation gate は無い。

### security / dangerous operation

- 202607 方針は session token、Origin/Referer、CORS 原則拒否、POST content-type、security profile、audit log、dangerous confirmation を組み合わせる。現行は WebView lock が主で、API 単位の security profile 判定は無い。
- 202607 方針で dangerous/host に分類される `flow.run`, `workspace.delete`, `app.openExternal`, `app.googleAuthLogin`, `mouse.coordinateCapture.start`, `file.pick*`, `windowControl` は、現行 backend では capability callback や簡易 validation の後に実行される。
- 202607 方針は token、実 path、秘密情報を log/error に出さない。現行は hidden value の log mask はあるが、workspace/flow/root/suggest index などで実 path が log/response に出る。

### QWebChannel / postMessage / localhost API 移行時の削除候補

- localhost API 移行時の主削除候補は `static/js/bridge.js` の QWebChannel client、`WebViewBridge` の `postMessage` / `messageToFrontend`、`BridgeRuntime.handle_message` の command dispatcher。
- `app/gui/host.py` の `QWebChannel` 登録と `file://` main page 読み込みは、202607 方針の `localhost server -> WebView http://127.0.0.1:<port>/` に置き換わる想定。
- `workspace.manager.js` と iframe `app.js` の `window.postMessage` は backend API ではなく UI 内部連携として使われている。削除対象に含めるか、UI 内部 protocol として残すかは未確定。

## 相談事項

- result store の正本をどう移行するか。推奨案: `run_service/result_service` で `run_id + step_id` の result store を先に作り、`flow_key` は backend 内部の conflict/context 用に限定する。
- `flow_ref` の発行責務を決める必要がある。推奨案: `flow_service` が load/save 時に `flow_ref` を返し、path/current state を frontend から隠す。
- dangerous operation の確認 UI と backend policy の責務分担が必要。推奨案: backend が `E_CONFIRMATION_REQUIRED` を返し、frontend は確認後に confirmation token/decision を再送する形を検討する。
- `workspace.delete` の互換をどう扱うか。推奨案: 202607 では `recursive` 必須とし、現行 UI の `window.confirm` は補助表示に格下げする。
- QWebChannel removal と iframe `postMessage` の境界を分ける必要がある。推奨案: backend 通信は localhost API に統一し、iframe 連携は UI 内部 event として名前空間を分けて残すか別途整理する。
- run cancel の event 名をどう移行するか。推奨案: 202607 方針に合わせ `run.cancelled` を terminal event にし、旧 `run.failed status=cancelled` 互換は作らない前提で UI 側を更新する。
- 実 path の response 表示範囲を決める必要がある。推奨案: `workspace/root` の UI 表示用 path は許容しつつ、list/stat/suggest/log から不要な絶対 path を落とす。
- error code mapping を先に固定する必要がある。推奨案: route 層で `E_RUN_NOT_FOUND`, `E_RESULT_NOT_READY`, `E_RESULT_NOT_FOUND`, `E_SECURITY_POLICY`, `E_CONFIRMATION_REQUIRED` へ明示変換する。
- `flow.list` の `scope=workspace` をどう扱うか。現行は受け付けるが local list と同じ経路に見えるため、202607 で workspace flow list を提供するか相談が必要。
- preview の workspace 外 path 取り扱いが未確定。推奨案: hidden ref の発行時点で source と policy を持ち、preview 側は hidden ref metadata で許可判定する。

## 参照ファイル

- `AGENTS.md`
- `.codex-harness/subagents/README.md`
- `.codex-harness/subagents/03-localhost-api.md`
- `app/gui/bridge.py`
  - `BridgeRuntime.handle_message`
  - `_handle_app_get_status`
  - `_handle_flow_list`
  - `_handle_flow_load`
  - `_handle_flow_save`
  - `_handle_flow_run`
  - `_handle_run_cancel`
  - `_handle_result_get_summary`
  - `_handle_result_get_schema`
  - `_handle_result_get_preview`
  - `_handle_result_get_datavolume`
  - `_handle_file_pick_file`
  - `_handle_file_pick_folder`
  - `_handle_workspace_get_root`
  - `_handle_workspace_set_root`
  - `_handle_workspace_list`
  - `_handle_workspace_read_text`
  - `_handle_workspace_write_text`
  - `_handle_workspace_delete`
  - `_handle_preview_read_excel`
  - `_handle_preview_read_csv`
  - `_get_latest_step_payload`
  - `_ensure_hidden_session`
  - `_success_response`
  - `_error_response`
  - `WebViewBridge.postMessage`
- `app/gui/host.py`
  - `LockedDownRequestInterceptor`
  - `LockedDownPage`
  - `QWebChannel` / `backendBridge` 登録
  - coordinate capture event emit
- `static/js/bridge.js`
  - `createBridgeApi`
  - `handleIncoming`
  - `loadQtWebChannel`
- `static/js/app.js`
  - `handleBridgeLoad`
  - `handleBridgeSave`
  - `handleBridgeRun`
  - `fetchRunSummary`
  - `handleBridgeEvent`
  - `postEmbeddedEvent`
- `static/js/workspace.manager.js`
  - `fetchFlowPayloadByPath`
  - `fetchFlowMtime`
  - `invokeTabAction`
  - `deleteExplorerTarget`
  - `changeWorkspaceRootByPicker`
  - `loadTreeEntries`
  - iframe `message` listener
- `static/js/ui.fields.js`
  - `handleCoordinateCaptureEvent`
  - `result.getSchema` / `result.getPreview` 呼び出し
  - `mouse.coordinateCapture.start`
  - `app.googleAuthLogin`
  - `file.pickFile` / `file.pickFolder`
- `static/js/ui.node.detail.js`
  - `result.getSchema` / `result.getPreview` 呼び出し
- `static/modal/excel_modal.js`
  - `preview.readExcel`
  - `file.pickFile`
- `static/modal/csv_modal.js`
  - `preview.readCsv`
  - `file.pickFile`
- `.docs/future/202607-localhost-api.md`
- `.docs/future/202607-localhost-security.md`
- `.docs/future/202607-localhost-server-structure.md`
- `.docs/future/api/common.md`
- `.docs/future/api/flow.md`
- `.docs/future/api/workspace.md`
- `.docs/future/api/run-result-events.md`
- `.docs/future/api/file-dialog-preview.md`
- `.docs/future/api/session-app-auth-input.md`
- `.docs/future/api/security-policy-profile.md`
- `.docs/future/api/catalog-config.md`

## 未確認事項

- 実行テスト、Playwright、WebView 起動、API 呼び出しの実動作確認はしていない。
- `static/` 全体の全 bridge caller を完全監査したわけではない。今回は `rg` による bridge command 関連の限定検索。
- `core.workflow_engine` の cancel 実効性、途中 result 生成タイミング、connector 別 log 内容は未確認。
- `core.security_policies.load_security_policies` が読む policy file の詳細は未確認。現行では `app.getStatus` の count 表示に使われる範囲のみ確認した。
- 202607 の `202607-legacy-path-removal.md`、`202607-runtime-data-lifetime.md`、catalog 配信詳細は今回の担当外として未確認。
- 外部ブラウザ表示時に host 操作をどう許可/拒否するかは未確認。
- endpoint 名、security profile、移行順序は本レポートでは確定していない。
