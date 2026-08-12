# 202607 詳細設計 統合レポート

## 対象

202607 詳細設計のサブエージェント調査 6 件を統合し、現行実装の事実、202607 方針との乖離、ユーザー相談事項を章横断で整理する。

この文書は調査レポートであり、仕様の正本ではない。

## 入力レポート

| 章 | レポート |
| --- | --- |
| `.zizd` 保存形式 | `.codex-harness/reports/areas/202607/zizd-schema-inventory.md` |
| runtime 実行仕様 | `.codex-harness/reports/areas/202607/runtime-inventory.md` |
| localhost API 詳細 | `.codex-harness/reports/areas/202607/localhost-api-inventory.md` |
| connector 詳細 | `.codex-harness/reports/areas/202607/connectors-inventory.md` |
| フロント app 専用 | `.codex-harness/reports/areas/202607/frontend-app-inventory.md` |
| フロント独自ライブラリ | `.codex-harness/reports/areas/202607/frontend-library-inventory.md` |

## 全体状況

6 件のサブエージェント調査は完了した。

各サブエージェントは、指定レポートのみを作成し、実装変更と `.docs/` 更新は行っていない。

## 現行実装の主要事実

### `.zizd` / schema

- `.zizd` は YAML ファイルで、主な top-level key は `metadata`、`variables`、`steps`、`flows`、条件付き `loop`、`notes`。
- `steps[].schema` は現行実装にはない。
- schema の現行保存位置は `steps[].params.schema`。
- schema の現行保存形式は JSON 配列文字列。
- 通常 UI 経由の schema item は `origin_name`、`new_name`、`description`、`ziz_datatype` の 4 項目を持つ。
- 入力系の画面表示は主に `origin_name` と `ziz_datatype` だが、保存値には `new_name` と `description` も残る。
- `is_disabled` は UI 内部の非選択状態で、export 時に除外される。
- `step_id` は `node.stepName` 由来で、表示名と安定 ID が分離されていない。
- `output_variable` は現行 export では原則 `step_id` と同じ値になる。

### path / hidden

- UI では file / dir picker の結果を `{{hidden.<scope>.varN}}` として保持する。
- hidden ref の実値は bridge の session memory に保存される。
- `.zizd` 保存時は `_restore_hidden_values()` により hidden ref が実 path へ戻される。
- そのため現行の `.zizd` 保存結果には hidden ref ではなく実 path が入る。
- load 時は一部 key を `_hide_sensitive_values()` で hidden ref 化して UI へ渡す。
- hidden 化対象 key は固定リストであり、すべての file / dir field と一致していない。

### flow graph

- 現行 export は `flows.edges` を生成する。
- loop flow は top-level `loop.flows.<owner_step_id>.edges` として export される。
- import/runtime は `loop.flows` と `flows.loop.flows` の両方を読む。
- import は `flows.edges` 必須だが、runtime は `flows.edges` が無い場合に `steps` 配列順の sequential fallback を持つ。
- `edge.order` は表示順だけでなく、DAG runtime の ready queue tie-breaker にも影響する。

### runtime / result

- run 開始時に `WorkflowEngine._run_config()` が `self.context = {}` で初期化する。
- フロー全体実行は空 context から始まる。
- 単一 step 実行は `latest_by_flow.context` を seed として前回結果を引き継ぐ。
- step result は `output_variable` があれば `self.context[output_variable]` に保存される。
- DataFrame result は report の raw `result` を `None` にし、`ui_cache` に `schema`、`preview`、`row_count` を作る。
- `datavolume` は engine の `ui_cache` には保存されていない。
- `latest_by_flow` は `context`、`step_data`、`step_ui_cache`、`step_status` を持つ。
- 現行 result API は `run_id + step_id` ではなく、`flow_key + step_id` の latest result を読む。
- DataFrame lifetime は params 参照から consumer 数を推定するが、plain `input_data: step1` は検出対象に入っていない。
- consumer が無い producer は run 中に明示解放されない。
- loop child step には lifetime plan が渡らない。

### cancel / log / event

- `run.cancel` は存在するが、実行中 connector へ interrupt / terminate は送らない。
- cancel は engine checkpoint による協調停止が中心。
- cancel terminal event は `run.cancelled` ではなく、`run.failed` payload `status: "cancelled"`。
- `run.log` event は `run_id`、`ts`、`level`、`message` を持つ。
- `run.log` に `step_id`、`log_seq` は無い。
- event envelope は QWebChannel 用の `{ v, kind, type, ts, payload }`。
- 日次 run log store、10 日保持、log restore API、`ui_log` / `audit_log` / `debug_log` 分離は未実装。

### localhost API / bridge

- 現行 transport は `file://` + QWebChannel。
- localhost HTTP API、session token、Origin / Referer check、CORS policy は未実装。
- frontend は `flow.run`、`result.getSchema` など bridge command 文字列を複数ファイルから直接呼ぶ。
- `app/gui/bridge.py` が dispatch、flow、run、workspace、preview、hidden value、event を 1 ファイルに持つ。
- `flow.run` response は `run_id` と `accepted` のみで、`trace_id`、`status`、`started_at` は返さない。
- `result.getSchema` / `getPreview` / `getDatavolume` request は `run_id` を使わない。
- dangerous operation の backend security policy / confirmation gate は未整備。

### connectors

- UI 定義上の connector は 12 種類。
- data connector / workflow connector の分類は文書にはあるが、実装上の完全な source はない。
- runtime は connector 分類では分岐していない。
- `BaseConnector.build_execution_metadata()` は `job_id`、`target`、`path`、`executed_at` の 4 カラムを返す。
- データ connector の出力 action は概ね 4 カラムメタデータを返す。
- `BQConnector.execute_sql` / `DuckConnector.execute_sql` は入力系に見えるが、非表結果ではメタデータを返す。
- `WindowsConnector.search_files_by_name`、`search_text_in_files`、`SeleniumConnector.dom_get`、`VectorConnector.search_vector_db` は結果本体を DataFrame として返す。
- `ShellConnector.execute_bat` は成功時 stdout/stderr を結果本体にせず、メタデータのみ返す。ただし失敗時 error message には stdout/stderr が入る。
- `PythonConnector.execute_python` は stdout marker `__ZIZ_RESULT__` から main 戻り値を結果として解釈する。
- `loop_tasks` は engine 処理で list を返し、DataFrame `ui_cache` は作らない。

### frontend app

- `static/config/config.js` が global `CONFIG` を公開し、app / state / UI が直接読む。
- data area 4 tab は独立 data area tab ではなく、schema editor 内 mode として実装されている。
- schema field がない node では 4 mode は出ない。
- `ui.node.detail.js` / `ui.fields.js` が bridge 呼び出し、cache、preview 整形、schema merge を直接行う。
- data pane cache key は `appMode/fileName/flowName/stepId` ベースで、実データ cache key に `run_id` は入っていない。
- data area の log mode は backend log ではなく `node.runtimeLogs` を表示する。
- `run.log` event は console に出るが、data area の log 表示には反映されない。
- 実行停止 / cancel UI は確認範囲では見つかっていない。
- app state と UI runtime state が混在している。

### frontend library

- AppShell 相当は `window.zizShell` と callback binding が中心で、instance API ではない。
- AppShell に app 固有 sidebar、URL、window action、dataflow right sidebar が混在している。
- WorkflowDesigner 相当は `ui.node.*` に canvas、selection、drag、context menu、property detail、modal、bridge、catalog 依存が混在している。
- `stateOps` は graph editing と app 固有 default / hidden bindings を同時に扱う。
- public API と app adapter の境界は未分離。
- 300 行超の大きい JS/CSS ファイルが複数ある。

## 202607 方針との主要乖離

| 領域 | 乖離 |
| --- | --- |
| `.zizd` | `steps[].schema` YAML 配列方針に対し、現行は `params.schema` JSON 文字列 |
| schema | 入力 schema 2 項目保存方針に対し、現行通常保存は 4 項目 |
| path | hidden ref 保存方針に対し、現行保存は実 path へ復元 |
| flow | runtime が `flows.edges` なし sequential fallback を持つ |
| result | `run_id + step_id` 方針に対し、現行は `flow_key + step_id` latest result |
| DataFrame | runtime context と latest result seed/cache が混在 |
| lifetime | plain `input_data` 参照、failure/cancel、loop child の lifetime が未整備 |
| cancel | interrupt-first 方針に対し、現行は checkpoint 中心で connector interrupt なし |
| log | `log_seq`、復元 API、日次 store、ui/audit/debug 分離が未実装 |
| API | localhost HTTP API ではなく QWebChannel command |
| security | token / Origin / Referer / CORS / backend confirmation が未実装 |
| connector 分類 | 分類の実装正本がなく、runtime も分類で分岐しない |
| data area | 4 tab が schema editor 内 mode で、log は backend log ではない |
| frontend state | 保存 state と runtime/UI state が混在 |
| library | AppShell / Designer が app 固有 logic、catalog、bridge に依存 |

## 相談事項

### 優先度 A: 先に決めないと後続設計が揺れるもの

1. `.zizd` の path 保存方針

- 選択肢 A: 現行どおり `.zizd` に実 path を保存する。
- 選択肢 B: `.zizd` には hidden ref / path ref を保存し、実 path は別管理する。
- 影響: save/load/run、preview、workspace 外ファイル、共有時の扱い、security policy。

2. schema の保存形式

- 確定済み寄り: `params.schema` JSON 文字列から `steps[].schema.columns` YAML 配列へ移す。
- 未確認: 旧 `params.schema` import 互換を作るか。以前の方針では互換は不要だが、移行時の読み込み対象をどう扱うか確認が必要。

3. 入力 / 出力 / 加工 schema の保存項目

- 入力: `origin_name` / `ziz_datatype` の 2 項目保存で合意済み。
- 出力: `origin_name` / `new_name` / `ziz_datatype` は必要。
- 未確認: 出力 `description` を保存するか。
- 未確認: transform schema を `.zizd` に保存するか、result cache 表示だけにするか。

4. result store の正本

- 方針: `run_id + step_id`。
- 現行: `latest_by_flow`.
- 決めること: run 完了後の raw DataFrame を保持するか、schema/preview/datavolume cache のみにするか。

5. 単一 step 実行の前回 context 引き継ぎ

- 現行: 前回 `latest_by_flow.context` を seed にする。
- 202607 方針: runtime context は run 単位で初期化。
- 決めること: 単一 step 実行で上流結果をどう解決するか。

### 優先度 B: API / runtime 詳細で決めるもの

6. lifetime 管理の参照正本

- `input_data`、`source_step_id`、connector 固有参照を catalog / contract として明示するか。
- plain `input_data` 参照を lifetime plan に入れる必要がある。

7. datavolume cache

- raw DataFrame 解放後も datavolume を返すなら、step 完了時に cache 化が必要。

8. cancel 仕様

- `run.cancelled` terminal event へ変更するか。
- connector API に cancel token / interrupt hook / cleanup hook を追加するか。

9. log 仕様

- run log store を `logs/execution.log` と統合するか分離するか。
- `log_seq`、`step_id`、10 日保持、復元 API をどう実装するか。

10. error code mapping

- 現行 `E_CONFLICT` / `E_NOT_FOUND` 等を、202607 の `E_RUN_CONFLICT` / `E_RESULT_NOT_READY` / `E_RESULT_NOT_FOUND` 等へどう寄せるか。

### 優先度 C: frontend / library で決めるもの

11. data area 4 tab の実体

- 現行: schema editor 内 mode。
- 202607候補: data area component の正式 tab。

12. backend log と data area log の接続

- 現行: `node.runtimeLogs`。
- 202607候補: backend run log / log restore API。

13. catalog / config の正本

- 現行: `static/config/config.js` global。
- 202607方針: backend catalog API。
- 決めること: schema policy、action分類、data area policy をどこに置くか。

14. AppShell / WorkflowDesigner の境界

- AppShell は layout / tab / sidebar / header event までに絞るか。
- WorkflowDesigner は canvas core と property/data adapter を分けるか。

15. state の正本化

- document state、runtime state、UI view state を分けるか。
- `stepStatuses`、`__schemaEditorMode`、`runtimeLogs`、`hiddenBindings` の置き場を決める。

## 推奨する次の進め方

次は `.zizd` 保存形式を完了させる。

理由:

- path、schema、flow、step_id はすべて `.zizd` に依存する。
- runtime / API / frontend は `.zizd` の正本が決まらないと詳細が揺れる。

`.zizd` 章で先に決める順番:

1. path 保存方針。
2. schema 保存位置と旧形式扱い。
3. input / output / transform schema field。
4. `step_id` / `label` / `description`。
5. `flows.edges` / `loop.flows` / `edge.order`。

## 未確認事項

- ブラウザ / Playwright による UI 表示確認は未実施。
- 実行テストは未実施。
- 202607 形式 `.zizd` を現行 UI へ読み込ませる実動作確認は未実施。
- localhost HTTP server 実装はまだ無い前提。
- 互換を作らない方針は会話上あるが、既存 `.zizd` を完全に読まない前提でよいかは再確認が必要。
