# Run / Event Lifecycle Implementation Report

## Result

Task 015を完了した。

202607 `.zizd` documentを直接受け取る`run.start`を追加し、workflow／step／standalone／CLIのrun identity、実行管理、cancel、event、result cache、run索引をapplication service／runtimeへ実装した。対象platformはWindows PC版のみである。

## Runtime

- UUIDv7を使う`gui_flw_`、`gui_stp_`、`gui_std_`、`cli_flw_` run IDを実装した。
- GUI session全体でworkflow 1件、standaloneは実行元documentごとに1件へ制限した。
- session全体4 worker、workflow内4 stepを標準上限とする公平なbounded workerを実装した。
- step失敗時は新しいstepを開始せず、未開始stepを`skipped`にするfail-fastへ統一した。
- cancel受付とterminal eventを分離し、queued中のcancelにも対応した。
- workflow完了前からstep resultをcacheへ格納し、session cacheを128 MiBへ制限した。

## Execution

- `WorkflowDocumentService`が複数flow形式から対象`flow_id`を選択し、ID、所属、edge、DAG、loop child単独実行を検証する。
- `StandaloneExecutionService`がcatalog metadataに従い、connector action、dry run、preview／text／metadata、Excel Exportを実行する。
- BigQueryはnative dry run、DuckDBは`EXPLAIN`またはinput validation、PythonはAST／import validationを使用する。
- CLIはWebView／QWebChannelを起動せず、GUIと同じ`RunService`、`ExecutionManager`、workflow serviceを直接利用する。
- connector生成とtabular preview生成を共通部品へ抽出した。

## QWebChannel / Frontend

- bridgeへ`run.start`を追加し、`run.cancel`と`app.getStatus.run_index`を新runtimeへ接続した。
- `static/js/run.adapter.js`にworkflow／step／standalone開始、cancel、status取得の薄いBridgeClient adapterを追加した。
- 旧`flow.run`はproduction document store切替まで隔離して残し、旧形式から202607形式への変換は追加していない。

## Verification

- Task015 focused Python test: 27件成功
- Python全体確認: 109件中、旧内部属性を使うtest 1件のみ失敗
- 上記testをConnectorFactory注入へ更新後、該当test成功
- run adapter Playwright: 1件成功
- Python `py_compile`: 成功
- JavaScript `node --check`: 成功
- `git diff --check`: errorなし、既存のLF／CRLF warningのみ

## Deferred

- production appの旧document stateをWorkflowDesigner document storeへ切り替える作業
- 旧`flow.run`と旧canvas経路の削除
- ProcessRunnerとconnector固有interruptの完全実装
- managed resourceの全connector対応
- GUI／CLI／debug log全種別を合算するrotation

## Next

production document storeとWorkflowDesignerを接続し、保存・編集・実行が同じ202607 documentを正本として扱うようにする。
