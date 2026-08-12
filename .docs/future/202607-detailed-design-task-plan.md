# 202607 詳細設計タスク計画

## 位置づけ

この文書は、202607 版の詳細設計を章ごとに進めるためのタスク一覧である。

実装タスクではなく、実装前に固定する詳細設計タスクを管理する。

各章は、次の順序で進める。

1. 現行実装の事実を確認する。
2. 202607 で目指す仕様との差分を整理する。
3. 判断が必要な点を相談する。
4. 合意後に詳細仕様として確定する。

## 章別タスク

| 順番 | 章 | 対象範囲 | 主な確認対象 | 成果物 | 状態 |
| --- | --- | --- | --- | --- | --- |
| 1 | `.zizd` 保存形式 | `metadata`、`variables`、`steps`、`params`、`schema`、`flows`、`loop`、`notes`、path/hidden 値 | `static/js/app.js`、`app/gui/bridge.py`、既存 `.zizd` | `202607-zizd-format.md`、`202607-column-schema.md`、`202607-yaml-style.md` | 完了 |
| 2 | runtime 実行仕様 | run context、DataFrame 寿命、step result、cancel、log、result cache | `core/workflow_engine.py`、`app/gui/bridge.py`、connector 戻り値 | `202607-runtime-data-lifetime.md`、`qwebchannel/run-result-events.md` | 完了 |
| 3 | QWebChannel bridge 詳細 | command/response/event、error、security、画面復旧、GUI backend 責務 | `app/gui/host.py`、`app/gui/bridge.py`、frontend bridge 呼出し | `202607-qwebchannel-bridge.md`、`202607-qwebchannel-contract.md`、`202607-qwebchannel-security.md`、`202607-gui-backend-structure.md`、`qwebchannel/` | 完了 |
| 4 | connector 詳細 | data connector / workflow connector、入力/加工/出力、出力結果メタデータ、例外 | `connectors/*`、`.docs/areas/connectors.md` | `202607-design-questionnaire.md` と関連仕様 | 完了 |
| 5 | フロント app 専用 | data area、schema editor、run UI、状態管理、catalog adapter | `static/js/app.js`、`ui.fields.js`、`ui.node.detail.js` | `202607-frontend-app.md`、`202607-state-ux.md` | 完了 |
| 6 | フロント独自ライブラリ | AppShell、TabularImportAssistant、WorkflowDesigner、public API、再利用境界 | `static/js/app-shell.js`、`static/modal/*`、`ui.node.*` | `202607-frontend-library.md`、3ライブラリのpublic API | 完了 |

## 1. `.zizd` 保存形式

確認すること:

- 現行 `.zizd` の top-level key。
- `steps[].params` に保存されている値。
- `params.schema` JSON 文字列の現行仕様。
- 202607 の `steps[].schema` YAML 配列化。
- 入力 schema は `origin_name` / `ziz_datatype` の 2 項目保存。
- 出力 schema は `origin_name` / `new_name` / `ziz_datatype` を保存。
- `description` の扱い。
- hidden ref / 実 path の保存方針。
- `flows.edges`、`loop.flows`、`edge.order` の扱い。

回答状況:

- 質問表と成果物へ反映済み。未決事項はない。

## 2. runtime 実行仕様

確認すること:

- run 開始時の context 初期化。
- `initial_context`、start variables、system variables の投入順。
- `step_id` を正本keyとするstep resultとDataFrame保持。
- DataFrame UI cache の生成タイミング。
- DataFrame 解放タイミング。
- DAG / loop / 並列時の lifetime 管理。
- cancel の interrupt-first と cooperative checkpoint。
- log 種別、保存、復元。

回答状況:

- 質問表と成果物へ反映済み。未決事項はない。

## 3. QWebChannel bridge 詳細

確認すること:

- 現行 `postMessage` / `messageToFrontend` と 202607 command の対応。
- `run_id + step_id` の result key。
- command / response / event envelope。
- error code、`trace_id`、response correlation。
- event 名、間引き、channel 再接続後の画面復旧。
- WebView navigation、QObject 公開面、command allowlist、payload validation。
- transport、dispatcher、application service、runtime、core、connector の責務境界。

確定事項:

- GUI は PySide WebView と QWebChannel を使用し、localhost server は起動しない。
- frontend component は `backendBridge` を直接参照せず、`BridgeClient` を使用する。
- WebView へ登録する QObject は `backendBridge` 1 個とする。
- command は JSON、response / event は共通 signal の JSON とする。
- event の完全 replay は行わず、summary / schema / preview / logs を command で再取得する。
- CLI は WebView / QWebChannel を起動せず、application service / execution manager / core を直接利用する。

## 4. connector 詳細

確認すること:

- connector/action の現行分類。
- dataflow input / transform / output の schema 動作。
- workflow static / dynamic / scenario control の結果表示。
- 出力結果メタデータ 4 カラム。
- `Selenium.web_session_id`、`loop_tasks`、`define_values` の例外方針。
- stdout/stderr を結果として取得しない方針。

回答状況:

- 質問表と関連仕様へ反映済み。未決事項はない。

## 5. フロント app 専用

確認すること:

- data area 4 tab の現行挙動。
- schema editor の表示項目と保存項目。
- JSON editor の扱い。
- data output / log の取得経路。
- 状態管理の正本。
- catalog/config の backend 移行。

回答状況:

- `202607-frontend-app.md`、`202607-state-ux.md`、質問表へ反映済み。未決事項はない。

## 6. フロント独自ライブラリ

確認すること:

- AppShell と app 専用ロジックの境界。
- TabularImportAssistantとfile picker／preview／schema adapterの境界。
- WorkflowDesigner と catalog/action 定義の境界。
- 既存 `ui.node.*` の分割単位。
- public API に含めるイベント、command、state。
- 300 行ルールの例外範囲。

回答状況:

- `202607-frontend-library.md`、AppShell／TabularImportAssistant／WorkflowDesigner public API、質問表へ反映済み。未決事項はない。

## 進行ルール

- 仕様書だけを根拠に現行仕様と言わない。
- 現行仕様は実装確認を根拠にする。
- 現行と 202607 方針の乖離は必ず分けて書く。
- 判断が必要な変更はユーザーへ相談してから確定する。
- 合意前に実装しない。
