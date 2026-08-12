# Task 021: legacy backend run cleanup

## 状態

完了

## 目的

Phase 11の最初の境界として、productionで使用しない旧`flow.run`経路と
`BridgeRuntime`内の重複run実装を物理削除する。

## 対象

- `flow.run` command／security ruleの削除
- `_handle_flow_run`と旧専用worker／result／log helperの削除
- `_RunLogHandler`の削除
- `current_flow_path`／`current_file_name`／`current_mode`の削除
- `runs`／`latest_by_flow`／`active_run_by_flow`のBridge別名削除
- 旧private method依存testを`run.start`／RunService経路へ移行

## 維持する正本

- workflow／step／standalone実行commandは`run.start`
- lifecycleは`RunService`
- runtime stateは`ExecutionManager`
- result cache／logは`ResultService`とruntime store
- QWebChannel transportとevent contract

## 対象外

- 旧frontend global／assetの削除
- AppShell／TabularImportAssistant／WorkflowDesigner変更
- PySide host最終integration test
- CLI実行経路

## 完了条件

- backend command一覧に`flow.run`が存在しない。
- `BridgeRuntime`がcore実行threadを直接生成しない。
- 単一document前提のcurrent stateを保持しない。
- step runのlatest contextが`run.start`経路で維持される。
- Python全体が成功する。

## 検証結果

- focused Python test: 39件成功
- Python全体: 126件成功、2件skip
- production run／result Playwright: 7件成功
- `py_compile`／`git diff --check`: 成功
