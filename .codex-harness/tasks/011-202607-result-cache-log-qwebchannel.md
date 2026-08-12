# 011 202607 Result Cache / Log Restore QWebChannel Commands

## Objective

result readとrun log復元を`BridgeRuntime`内のlatest flow参照から分離し、`run_id + step_id`をpublic contractの正本keyにする。

run開始／worker／eventの全面移行より先に、表示用result cacheとlog storeをtransport非依存runtime／serviceとして固定する。

## Scope

- 対象:
  - `app/runtime/result_cache.py`
  - `app/runtime/run_log_store.py`
  - `app/services/result_service.py`
  - bridge dispatcherのresult command
  - frontend result adapter
- command:
  - `result.getSummary`
  - `result.getSchema`
  - `result.getPreview`
  - `result.getLogs`
- 主な実装:
  - `run_id + step_id`によるschema／preview／row_count取得
  - terminal summary保持
  - preview 100行、1step 2 MiB、1セル64 KiB上限
  - run内単調増加`log_seq`
  - 最大500件のbefore／after cursor取得
  - 日次run log file、10日保持
  - document close時の表示cache解放
  - `result.getDatavolume`の削除

## Out Of Scope

- `flow.run`から`run.start`へのcommand移行
- UUIDv7 run IDとGUI session ID
- `gui-standalone-run`
- session全体worker queue、並列scheduler、fail-fast
- interrupt-first cancel
- step完了直後の途中result格納
- step完了途中cacheを含むGUI session全体128 MiB制御
- `app.getStatus`の再接続run索引
- `gui_app_log`、`cli_app_log`、`debug_log`
- connector外部processの`ProcessRunner`

上記はTask 012以降で扱う。

## References

- `.docs/future/qwebchannel/run-result-events.md`
- `.docs/future/202607-runtime-data-lifetime.md`
- `.docs/future/202607-gui-backend-structure.md`
- `.docs/future/202607-service-runtime-interface.md`
- `.docs/future/202607-implementation-sequence.md`

## Implementation Tasks

1. result cacheを`run_id`単位、step cacheを`run_id + step_id`単位で管理する。
2. raw DataFrameをresult cacheへ保存せず、schema／preview／row_countだけを保持する。
3. active runの未生成stepは`E_RESULT_NOT_READY`、不存在resultは`E_RESULT_NOT_FOUND`にする。
4. flow runの最新1件とstep runのstep別最新1件を識別し、更新時に旧表示cacheを破棄する。
5. document close時に対象documentのsummary／step cacheを破棄する。
6. run log itemをsanitized後にmemoryと日次fileへ保存する。
7. `result.getLogs`のcursor、500件上限、昇順responseを実装する。
8. frontendのresult呼出しをadapterへ集約し、appがstepごとの対象`run_id`を登録する。
9. `result.getDatavolume`をhandler、security rule、frontend表示経路から削除する。

## Acceptance Criteria

- result commandが`run_id`無しのrequestを拒否する。
- schema／preview responseに`run_id`と`step_id`が含まれる。
- raw DataFrameをbridge responseへ載せない。
- preview上限を超えてもrun結果本体へ影響せず、`truncated: true`になる。
- run logが`log_seq`、`level`、`category`、`message`を持つ。
- `result.getLogs`がbefore／after cursorを同時指定したrequestを拒否する。
- document close後は対象resultを取得できない。
- `result.getDatavolume`が未許可commandになる。
- frontend componentがresult command文字列を直接持たない。

## Verification

- unit:
  - running／ready／not found
  - preview row／cell／payload上限
  - latest flow／latest step置換
  - document close cleanup
  - log sequence／pagination／retention
- integration:
  - result summary／schema／preview／logs command
  - invalid payload
  - datavolume command拒否
- frontend:
  - adapterがstepに対応する`run_id`を付ける
  - flow run／step run後のschema／preview取得
