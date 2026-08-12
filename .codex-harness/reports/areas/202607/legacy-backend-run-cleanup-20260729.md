# Legacy Backend Run Cleanup Report

## Result

Task 021を完了した。

productionで使用しない旧`flow.run` commandと、
`BridgeRuntime`内に残っていた直接実行worker／result集約／run log処理を削除した。
workflow、step、standaloneの実行入口は`run.start`へ統一した。

## Deleted

- `flow.run` command handler／security rule
- `_handle_flow_run`
- `_run_flow_worker`
- Bridge専用run performance／step status／result集約helper
- `_RunLogHandler`
- `current_flow_path`／`current_file_name`／`current_mode`
- `runs`／`latest_by_flow`／`active_run_by_flow`のBridge別名
- security層の旧catalog execution hook

## Canonical Ownership

- command: `run.start`
- lifecycle／worker／run log: `RunService`
- runtime state／latest context: `ExecutionManager`
- result: `ResultCache`／`ResultService`
- connector／action validation: application service／catalog service

`documents.load`／`save`／`close`はdocument sessionだけを更新し、
単一のcurrent document stateをBridgeに複製しない。

## Test Migration

旧Bridge private methodを直接呼ぶlatest context testを削除し、
`run.start`でstep 01、step 02を順に実行するintegration testへ置き換えた。
1回目の`define_values`結果がExecutionManagerのlatest contextへ残り、
2回目のstep runで参照されることを確認した。

## Verification

- focused Python: 39件成功
- Python全体: 126件成功、2件skip
- production run／result Playwright: 7件成功
- `py_compile`: 成功
- `git diff --check`: 成功
- `app/gui/bridge.py`: 1450行から844行

## Remaining Phase 11

`static/js/app.js`と旧一時E2Eには`flow.run`参照が残るが、
production HTMLからは読み込まれていない。
旧frontend global、未参照asset、旧test fixtureと合わせてTask 022で削除する。
