# 015 202607 Run / Event Lifecycle

## Status

完了

## Objective

202607版の`run.start`、cancel、event、result cache、run索引をtransport非依存のapplication service／runtimeへ実装する。

GUIとCLIは同じrun identity、execution manager、workflow execution serviceを利用し、QWebChannel bridgeはpayloadの復元とservice委譲だけを担当する。

## Scope

- platform:
  - Windows PC版のみを実装・検証対象とする
  - macOS／Linux向けの互換処理や動作保証は追加しない
- run identity:
  - UUIDv7を使う`gui_flw_`、`gui_stp_`、`gui_std_`、`cli_flw_`
  - runごとの`trace_id`
  - GUI起動単位の`session_id`
- runtime:
  - GUI session全体で①workflow runを1件に制限
  - ②standalone runを実行元`doc_session_id`ごとに1件に制限
  - active／latest run索引
  - cancel受付とterminal完了の分離
  - GUI session全体4 worker、workflow run内4 stepを標準上限とするbounded worker
- workflow:
  - 202607 `.zizd` documentから対象`flow_id`を選択
  - ID、所属、edge、DAG、loop child単独実行のvalidation
  - fail-fast、実行中stepへのcancel要求、未開始stepの`skipped`
  - step完了直後の表示用result格納
- standalone:
  - catalogの`standalone_allowed`／result mode／dry run metadataによる検証
  - connector actionの直接実行
  - preview／text／metadata terminal result
  - catalogで許可されたexport actionによるExcel出力
  - workflow plan／step／edge／result cacheを作らない
- result:
  - session全体128 MiBの表示用cache上限
  - terminal flowの古いpreviewから破棄
  - active runで格納不能なpreviewの明示
- QWebChannel:
  - `run.start`
  - `run.cancel`
  - `app.getStatus`の軽量run索引
  - domain eventの配信
- CLI:
  - WebView／QWebChannelを使わず同じrun serviceで保存済み`.zizd`を実行

## Out Of Scope

- production appの旧`state.nodes` document storeをWorkflowDesignerへ切り替える作業
- 旧`flow.run`を新documentへ変換するcompatibility adapter
- 旧canvasと旧`flow.run`経路の削除
- ProcessRunnerとconnector固有のinterrupt実装
- managed resourceの全connector対応
- GUI app log／CLI app log／debug logの全種別合算rotation

旧`flow.run`はproduction document store切替まで隔離して残す。新しい`run.start`は旧single-flow形式を受け付けず、自動変換しない。

## References

- `.docs/architecture.md`
- `.docs/future/202607-service-runtime-interface.md`
- `.docs/future/202607-runtime-data-lifetime.md`
- `.docs/future/202607-zizd-format.md`
- `.docs/future/202607-qwebchannel-bridge.md`
- `.docs/future/qwebchannel/run-result-events.md`

## Acceptance Criteria

- `run.start`が202607 documentのflow／stepとcatalog許可済みstandaloneを開始できる。
- reject時は`run_id`を発行しない。
- GUIの①はsession全体で1件、②は実行元documentごとに1件だけactiveになる。
- run IDはUUIDv7で、frontendは構造を解釈しない。
- workflow stepは標準4並列、全runのconnector処理は標準4 workerに制限される。
- 最初のstep failure後は新規stepを開始せず、未開始stepを`skipped`にし、runを`error`にする。
- cancel受付responseと`run.cancelled` terminal eventを区別する。
- flow runの完了済みstep resultをrun完了前に取得できる。
- session表示用cacheは128 MiBを超えて無制限に増えない。
- `app.getStatus`から開いているdocumentのactive／latest workflow runとactive standalone runを復元できる。
- service／runtimeはPySide6、QWebChannel、WebViewをimportしない。
- CLIは同じrun service／execution manager／workflow execution serviceを使用する。

## Verification

- UUIDv7／run index／conflict／cancel unit test
- worker上限／queue／fail-fast／skipped unit test
- document validation／flow selection／loop child拒否 unit test
- standalone catalog／result mode／dry run／export unit test
- progressive result／cache上限 unit test
- `run.start`／cancel／status／event bridge integration test
- CLI service boundary test
- Python `py_compile`
- JavaScript contract test
- `git diff --check`
