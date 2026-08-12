# 202607 bridge.py route/service 分解タスク

## 位置づけ

この文書は、現行 `app/gui/bridge.py` を 202607 版の localhost API route / service 単位へ分解するための詳細タスクである。

正本仕様は `.docs/future/202607-localhost-api.md`、`.docs/future/202607-localhost-server-structure.md`、`.docs/future/api/security-policy-profile.md` を参照する。

## 結論

`bridge.py` は localhost API の正本にしない。

202607 版では、frontend は QWebChannel command ではなく localhost API を呼ぶ。`bridge.py` にある処理は、次の責務へ移す。

```text
HTTP route
  -> security / validation
  -> service
  -> core / connectors / host capability
  -> response envelope / event
```

## 行数見込み

| 観点 | 見込み |
| --- | --- |
| `app/gui/bridge.py` 単体 | 大幅に減る。最終的には削除、または薄い互換なしの host glue にする |
| backend 全体 | 短期的には微増する可能性がある |
| 微増理由 | localhost server、security middleware、request validation、route ファイル、response envelope、SSE event hub が新設されるため |
| 最終判断 | 旧 QWebChannel 経路を消した後に総量を見る |

重要なのは、**業務ロジックを増やさないこと**である。

増えてよい行は、明示的な境界、security、validation、test に限る。既存処理の copy によって同じ責務が二重化している場合は、移行未完了と判断する。

## 現行 bridge.py 棚卸し

| 項目 | 現状 |
| --- | ---: |
| 対象 | `app/gui/bridge.py` |
| 行数 | 2254 |
| 中心クラス | `BridgeRuntime`、`WebViewBridge` |
| command dispatcher | `BridgeRuntime.handle_message` |
| 主な混在 | command dispatch、workspace、flow、run、result、preview、hidden value、event、host callback、QWebChannel |

## 現行責務の分解先

| 現行責務 | 現行位置 | 202607 分解先 |
| --- | --- | --- |
| QWebChannel 受付 | `WebViewBridge.postMessage` | 削除対象。通常導線にしない |
| command dispatch | `BridgeRuntime.handle_message` | HTTP route 登録と routing framework |
| success/error envelope | `_success_response`、`_error_response` | `app/server/response.py` |
| app status | `_handle_app_get_status` | `routes/session_app.py` + `app_status_service` |
| UI event log | `_handle_app_log_ui_event` | `routes/session_app.py` + `app_event_service` |
| window control | `_handle_app_window_control` | `routes/session_app.py` + `host_capability_service` |
| external open | `_handle_app_open_external` | `routes/session_app.py` + `host_capability_service` |
| Google auth | `_handle_app_google_auth_login/status` | `routes/auth.py` + `auth_service` |
| flow list/load/save | `_handle_flow_*` | `routes/flow.py` + `flow_service` |
| run start/cancel | `_handle_flow_run`、`_handle_run_cancel` | `routes/run.py` + `run_service` |
| result summary/schema/preview/datavolume | `_handle_result_*` | `routes/run.py` + `result_service` |
| workspace root/list/read/write/delete | `_handle_workspace_*`、`_resolve_workspace_path` | `routes/workspace.py` + `workspace_service` |
| file dialog | `_handle_file_pick_*` | `routes/file_dialog.py` + `host_capability_service` + `hidden_value_service` |
| preview | `_handle_preview_read_*` | `routes/preview.py` + `preview_service` |
| mouse coordinate capture | `_handle_mouse_coordinate_capture_start` | `routes/input.py` + `host_capability_service` + `events.py` |
| hidden values | `_hide_sensitive_values`、`_restore_hidden_values`、`_store_hidden_value` | `hidden_value_service` |
| event emit | `emit_event`、`_emit_step_status` | `events.py` |
| run worker | `_run_flow_worker` | `run_service` |
| run log masking | `_RunLogHandler`、`mask_log_message` | `run_service` + `events.py` |

## target module 構成

```text
app/
  server/
    localhost_server.py
    context.py
    session.py
    security.py
    events.py
    response.py
    routes/
      session_app.py
      auth.py
      flow.py
      run.py
      workspace.py
      file_dialog.py
      preview.py
      input.py
    services/
      app_status_service.py
      app_event_service.py
      auth_service.py
      flow_service.py
      run_service.py
      result_service.py
      workspace_service.py
      preview_service.py
      hidden_value_service.py
      host_capability_service.py
```

`catalog` は別タスク `catalog-config-migration-breakdown.md` で扱う。

## command / endpoint / service 対応

| 現行 command | endpoint | route | service | profile |
| --- | --- | --- | --- | --- |
| `app.getStatus` | `GET /api/session/status` | `session_app.py` | `app_status_service` | `read` |
| `app.logUiEvent` | `POST /api/app/ui-events` | `session_app.py` | `app_event_service` | `write` |
| `app.windowControl` | `POST /api/app/window-control` | `session_app.py` | `host_capability_service` | `host` |
| `app.openExternal` | `POST /api/app/open-external` | `session_app.py` | `host_capability_service` | `dangerous` |
| `app.googleAuthLogin` | `POST /api/auth/google/login` | `auth.py` | `auth_service` | `dangerous` |
| `app.googleAuthStatus` | `GET /api/auth/google/status` | `auth.py` | `auth_service` | `read` |
| `app.getSuggestIndex` | `GET /api/app/suggest-index` | `session_app.py` | `app_status_service` | `read` |
| `flow.list` | `GET /api/flows` | `flow.py` | `flow_service` | `read` |
| `flow.load` | `POST /api/flows/load` | `flow.py` | `flow_service` | `read_path` |
| `flow.save` | `POST /api/flows/save` | `flow.py` | `flow_service` | `write` |
| `flow.tabClosed` | `POST /api/flows/tabs/closed` | `flow.py` | `flow_service` | `write` |
| `flow.run` | `POST /api/runs/start` | `run.py` | `run_service` | `dangerous` |
| `run.cancel` | `POST /api/runs/cancel` | `run.py` | `run_service` | `write` |
| `result.getSummary` | `GET /api/runs/{run_id}/summary` | `run.py` | `result_service` | `read` |
| `result.getSchema` | `GET /api/runs/{run_id}/steps/{step_id}/schema` | `run.py` | `result_service` | `read` |
| `result.getPreview` | `GET /api/runs/{run_id}/steps/{step_id}/preview` | `run.py` | `result_service` | `read` |
| `result.getDatavolume` | `GET /api/runs/{run_id}/steps/{step_id}/datavolume` | `run.py` | `result_service` | `read` |
| `file.pickFile` | `POST /api/file-dialogs/pick-file` | `file_dialog.py` | `host_capability_service` / `hidden_value_service` | `host` |
| `file.pickFolder` | `POST /api/file-dialogs/pick-folder` | `file_dialog.py` | `host_capability_service` / `hidden_value_service` | `host` |
| `workspace.pickRoot` | `POST /api/workspace/root/pick` | `workspace.py` | `host_capability_service` / `workspace_service` | `host` |
| `workspace.getRoot` | `GET /api/workspace/root` | `workspace.py` | `workspace_service` | `read` |
| `workspace.setRoot` | `POST /api/workspace/root` | `workspace.py` | `workspace_service` | `write` |
| `workspace.list` | `POST /api/workspace/list` | `workspace.py` | `workspace_service` | `read_path` |
| `workspace.stat` | `POST /api/workspace/stat` | `workspace.py` | `workspace_service` | `read_path` |
| `workspace.readText` | `POST /api/workspace/read-text` | `workspace.py` | `workspace_service` | `read_path` |
| `workspace.writeText` | `POST /api/workspace/write-text` | `workspace.py` | `workspace_service` | `write` |
| `workspace.mkdir` | `POST /api/workspace/mkdir` | `workspace.py` | `workspace_service` | `write` |
| `workspace.delete` | `POST /api/workspace/delete` | `workspace.py` | `workspace_service` | `dangerous` |
| `preview.readExcel` | `POST /api/previews/excel/read` | `preview.py` | `preview_service` | `read_path` |
| `preview.readCsv` | `POST /api/previews/csv/read` | `preview.py` | `preview_service` | `read_path` |
| `mouse.coordinateCapture.start` | `POST /api/input/mouse-coordinate-captures/start` | `input.py` | `host_capability_service` | `host` |

## 詳細タスク

### 1. app context を作る

目的:

- `BridgeRuntime` の instance state を server 起動単位の context に移す。

対象 state:

- `base_dir`
- `workspace_root`
- `config_root`
- `current_flow_path`
- `current_file_name`
- `current_mode`
- `_flow_tokens`
- `_hidden_sessions`
- `runs`
- `latest_by_flow`
- `active_run_by_flow`
- host callback 群

完了条件:

- service は global 変数に依存しない。
- app 終了時に context、run、event session を破棄できる。

### 2. response / error を分離する

目的:

- QWebChannel message envelope から HTTP response envelope へ切り替える。

作るもの:

- `ok_response(data, meta)`
- `error_response(code, message, detail, status)`
- exception to HTTP status mapping
- request id 付与

完了条件:

- route ごとに response shape がばらつかない。
- token、実 path、秘密値が error/log に出ない。

### 3. security middleware を先に作る

目的:

- service 呼び出し前に token、Origin/Referer、CORS、content-type、profile を検査する。

作るもの:

- session token check
- Origin / Referer check
- CORS deny by default
- JSON content-type check
- endpoint profile resolver
- dangerous/host/write audit log

完了条件:

- token 無し request が拒否される。
- 不正 Origin/Referer が拒否される。
- 状態変更 API の GET 実行が拒否される。
- frontend から送られた profile を信用しない。

### 4. session / app route を作る

対象:

- `GET /api/session/status`
- `POST /api/app/ui-events`
- `POST /api/app/window-control`
- `POST /api/app/open-external`
- `GET /api/app/suggest-index`

移す処理:

- `_handle_app_get_status`
- `_handle_app_log_ui_event`
- `_handle_app_window_control`
- `_handle_app_open_external`
- `_handle_app_get_suggest_index`

完了条件:

- app status が QWebChannel なしで取得できる。
- host capability が無い環境では window control が拒否される。

### 5. auth route を作る

対象:

- `POST /api/auth/google/login`
- `GET /api/auth/google/status`

移す処理:

- `_handle_app_google_auth_login`
- `_handle_app_google_auth_status`

完了条件:

- 認証 token や credential が response/log に出ない。
- `google/login` は dangerous profile と確認対象になる。

### 6. workspace route/service を作る

対象:

- `GET /api/workspace/root`
- `POST /api/workspace/root`
- `POST /api/workspace/root/pick`
- `POST /api/workspace/list`
- `POST /api/workspace/stat`
- `POST /api/workspace/read-text`
- `POST /api/workspace/write-text`
- `POST /api/workspace/mkdir`
- `POST /api/workspace/delete`

移す処理:

- `_handle_workspace_*`
- `_resolve_workspace_base`
- `_resolve_workspace_path`
- `_path_has_symlink`
- `_deny_workspace_access`
- `_read_text_with_fallback`

完了条件:

- workspace/config scope 外へ出られない。
- symlink 経由の逃げ道を拒否できる。
- `write-text` は conflict を検出する。
- `delete` は dangerous profile と確認を通る。

### 7. hidden value service を作る

対象:

- file path、folder path、secret などの hidden ref 管理
- tab close 時の session 破棄

移す処理:

- `_hide_sensitive_values`
- `_restore_hidden_values`
- `_store_hidden_value`
- `_allocate_hidden_ref`
- `_build_hidden_meta`
- `_collect_secret_values`
- `mask_log_message`

完了条件:

- flow save/run/preview/file dialog が同じ hidden value service を使う。
- log に hidden 実値が出ない。
- tab close で対象 hidden session が破棄される。

### 8. flow route/service を作る

対象:

- `GET /api/flows`
- `POST /api/flows/load`
- `POST /api/flows/save`
- `POST /api/flows/tabs/closed`

移す処理:

- `_handle_flow_list`
- `_handle_flow_load`
- `_handle_flow_save`
- `_handle_flow_tab_closed`
- `_register_flow_token`
- `_build_default_flow_file_name`
- `_resolve_mode`
- `_migrate_flow_state`

完了条件:

- flow load/save が QWebChannel なしで動く。
- hidden values が flow load/save の前後で維持される。
- 実 path の常用を避け、flow token / workspace path を標準にする。

### 9. run / result / events を作る

対象:

- `POST /api/runs/start`
- `POST /api/runs/cancel`
- `GET /api/runs/{run_id}/summary`
- `GET /api/runs/{run_id}/steps/{step_id}/schema`
- `GET /api/runs/{run_id}/steps/{step_id}/preview`
- `GET /api/runs/{run_id}/steps/{step_id}/datavolume`
- `GET /api/events`

移す処理:

- `_handle_flow_run`
- `_handle_run_cancel`
- `_run_flow_worker`
- `_handle_result_*`
- `_require_run_session`
- `_build_flow_key`
- `_get_latest_flow_context`
- `_update_latest_by_flow`
- `_get_latest_step_payload`
- `_emit_step_status`
- `_handle_run_performance_event`
- `_cleanup_selenium_session_runtime`

完了条件:

- run 開始が `run_id` を返す。
- result 取得は `run_id + step_id` を public contract にする。
- progress/log/step status/completed/failed が SSE で届く。
- cancel で同一 session の run だけ止められる。

### 10. file dialog route を作る

対象:

- `POST /api/file-dialogs/pick-file`
- `POST /api/file-dialogs/pick-folder`

移す処理:

- `_handle_file_pick_file`
- `_handle_file_pick_folder`
- `_resolve_picker_initial_value`

完了条件:

- host capability が無い環境では拒否する。
- 返却 path は hidden ref 化する。
- 実 path を log に出さない。

### 11. preview route/service を作る

対象:

- `POST /api/previews/excel/read`
- `POST /api/previews/csv/read`

移す処理:

- `_handle_preview_read_excel`
- `_handle_preview_read_csv`
- `_resolve_hidden_or_current_path`
- `_load_csv_rows`
- `_normalize_preview_encoding`
- `_normalize_preview_delimiter`
- `_pad_row`
- `_col_index_to_letters`

完了条件:

- hidden ref/current path から preview できる。
- workspace 外 path は policy を通す。
- preview rows に上限を持つ。

### 12. input route を作る

対象:

- `POST /api/input/mouse-coordinate-captures/start`

移す処理:

- `_handle_mouse_coordinate_capture_start`

完了条件:

- host capability が無い環境では拒否する。
- 結果は `/api/events` で配信する。

### 13. WebView host を server lifecycle に接続する

目的:

- `host.py` が localhost server を起動し、WebView で `http://127.0.0.1:<random_port>/` を開く。

完了条件:

- `127.0.0.1` のみに bind する。
- 起動ごとに random port と session token を使う。
- 終了時に server を止める。
- 通常導線で `file://` を使わない。

### 14. QWebChannel 旧経路を削除する

削除対象:

- `WebViewBridge.postMessage`
- `BridgeRuntime.handle_message`
- QWebChannel command dispatcher
- frontend の `window.zizBridge` 直接依存
- 旧 command envelope

完了条件:

- 通常導線に QWebChannel command が残らない。
- localhost API client だけで app が動く。

## 実装順序

1. app context、response、security、server skeleton を作る。
2. 低リスクな `session/status` と catalog を接続する。
3. workspace read 系を接続し、path guard を固める。
4. flow load/save を接続する。
5. hidden value service を flow/file dialog/preview で共有する。
6. result read 系を接続する。
7. run/events を接続する。
8. host 依存 API を接続する。
9. dangerous API の確認フローを固定する。
10. QWebChannel と旧 bridge client を削除する。

## テスト方針

| 対象 | テスト |
| --- | --- |
| security | token 無し、不正 token、不正 Origin/Referer、GET 状態変更、CORS |
| workspace | scope 外拒否、symlink 拒否、read/write/stat/list、conflict、delete 確認 |
| flow | list/load/save/tab close、hidden value restore |
| run/result | start/cancel/summary/schema/preview/datavolume |
| events | run.log、run.progress、run.stepStatus、run.completed、run.failed |
| host | file dialog、window control、coordinate capture capability |
| lifecycle | random port、session token、server stop |

Playwright 全面 baseline は UI 再設計と localhost 化の後に行う。

## 行数を増やさないための制約

- route は validation と service 呼び出しだけにする。
- service は既存 `_handle_*` を copy して並べるのではなく、責務単位に再配置する。
- 旧 QWebChannel 互換 layer を残さない。
- `BridgeRuntime` 相当の巨大 class を `ServerRuntime` として作り直さない。
- path 正規化、hidden value、response envelope、security は共通化する。
- endpoint ごとに同じ try/except を書かず、middleware / response helper に寄せる。

## 完了条件

- `app/gui/bridge.py` が通常導線から外れる。
- frontend は localhost API client のみを使う。
- route が core/connector/host callback を直接呼ばない。
- service は frontend と HTTP framework を知らない。
- security profile は service 呼び出し前に評価される。
- server 終了時に run/event/host session が停止する。
