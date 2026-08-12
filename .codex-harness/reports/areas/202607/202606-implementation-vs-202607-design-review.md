# 202606 実装と 202607 詳細設計の照合レビュー

## 位置づけ

この文書は、`release/202606` 上の現行実装を確認し、`.docs/future/` の
202607 仕様と照合した設計レビューである。

仕様の正本ではない。未決事項をユーザーと確認する前に、`.docs/future/`
の確定仕様へ反映しない。

実装変更とテスト変更は行っていない。

## 調査基準

- branch は `release/202606`。
- 実行可能な現在の状態を確認するため working tree を基準にした。
- working tree には connector、engine、frontend の未commit変更がある。
- `core/workflow_engine.py` の未commit差分は `define_values` の結果反映に関する
  小変更であり、本レポートの主要な構造判断は HEAD と共通する。
- 実装事実はコードを根拠にし、`.docs/future/` は移行先仕様として扱った。

主な確認対象:

- `zizai.py`
- `app/main.py`
- `app/gui/host.py`
- `app/gui/bridge.py`
- `core/workflow_engine.py`
- `core/logger.py`
- `core/type_registry.py`
- `connectors/`
- `static/`
- `template/*.zizd`
- `tests/`
- `.docs/architecture.md`
- `.docs/areas/`
- `.docs/future/`

## 結論

202607 の基本方針は実現可能である。

特に、202606 ですでに PySide WebView と QWebChannel を使っているため、
localhost 方式からの transport 全置換は不要である。

一方、現時点の 202607 文書は、そのままでは実装へ入れない。
主な理由は次のとおり。

1. 1つの `.zizd` に複数 flow を持たせた結果、document と flow の identity が
   API 上で混同されている。
2. `START` / `END`、edge、loop iteration の識別方法が public contract 上で
   一意になっていない。
3. catalog の ID と connector 実装の対応、schema と connector params の
   受け渡し境界が未定義である。
4. GUI 再読込後に active run の `run_id` を再発見する command がない。
5. GUI step run の raw cache が、document 編集後に stale になる問題を扱っていない。
6. 202607 文書間に、field 名、型表記、state 構造、実装順序の矛盾が残っている。

## 202606 実装の確認結果

### 起動と GUI transport

| 項目 | 202606 実装 |
| --- | --- |
| 起動入口 | `zizai.py` |
| GUI | flow path なしで PySide WebView を起動 |
| CLI | flow path ありで `app.main.run_cli()` を実行 |
| GUI transport | QWebChannel |
| localhost server | 起動しない |
| QObject | `backendBridge` 1個 |
| 公開面 | `postMessage` / `messageToFrontend` |

`app/gui/host.py` は remote URL request を遮断し、
`LocalContentCanAccessRemoteUrls` を無効にしている。

ただし main-frame navigation は `file`、`qrc`、`data`、`blob`、`about` を許可し、
static directory 配下の任意 file へ遷移できる。202607 の「固定 app entry」
より広い。

### backend

| 対象 | 202606 実装 |
| --- | --- |
| `app/gui/bridge.py` | 2254行 |
| `app/gui/host.py` | 795行 |
| `core/workflow_engine.py` | 1139行 |

`BridgeRuntime` が command dispatch、flow load/save、workspace、preview、
hidden value、run、result cache、log、host helper を同時に持つ。

GUI run ごとに `WorkflowEngine` を作るが、CLI は module global の engine を使う。

### `.zizd`

- 202606 は `connector` / `action` を保存する。
- connector 値は `bigquery_connector` のような module/export ID が中心である。
- schema は `steps[].params.schema` の JSON 配列文字列である。
- start variables は top-level `variables.start` にある。
- main graph は `flows.edges` にある。
- loop graph は新旧2経路を読み取る。
- sticky note は `notes` に保存する。

### runtime

- engine は raw document `dict` を直接受け取る。
- `flows.edges` が無い、無効、STARTから到達不能の場合は sequential fallback する。
- cycle または未解決依存がある場合も、一部 step を到達順で補完実行する。
- ready step 数と同数の worker thread を作る。
- connector は `execute(action, params, context)` で呼ぶ。
- connector module/class は動的 scan し、scan 時に複数 connector module を
  importする可能性がある。
- loop は `action == "loop_tasks"` の文字列比較で判定する。

### result と cache

- GUI result の実質的な参照先は `flow_key + step_id` の latest result である。
- request の `run_id` は result lookup に使われていない。
- DataFrame は `schema`、先頭100行 preview、`row_count` を `ui_cache` に作る。
- report の DataFrame raw result は `None` にする。
- GUI step run は前回 `latest_by_flow.context` 全体を seed にする。
- `runs` と `latest_by_flow` に明示的な件数上限はない。

### log

| log | 202606 実装 |
| --- | --- |
| app log | `logs/app_YYYYMMDD.log` |
| app log保持 | 14日、総量1GB、日内size rotation |
| execution log | `logs/execution.log` JSONL |
| execution log rotation | なし |
| `run.log` fields | `run_id`, `ts`, `level`, `message` |
| log復元 | なし |

`run.log` は frontend event として送るが、data area の log 正本には接続されていない。

### frontend

| 対象 | 202606 実装 |
| --- | --- |
| `static/js/app.js` | 3401行 |
| `static/js/ui.node.canvas.js` | 1824行 |
| `static/js/ui.node.detail.js` | 1098行 |
| state | document/runtime/UI state が混在 |
| catalog | `static/config/config.js` global |
| bridge | 複数componentがglobal bridgeを直接参照 |
| workspace tab | `dataflow.html` iframeをtabごとに生成 |

現行は home、settings、dataflow の複数 HTML と、flow tab ごとの iframe を使う。
tabごとに frontend script、state、bridge client相当が分かれる構成である。

### test

- Python test file は13件。
- Playwright spec は41件だが、25件が `tmp-*`。
- `tests/docs/playwright/latest-results.md` は最新結果未記録。
- DAG edge/cycle/fallbackを固定する engine graph test はない。
- QWebChannel envelope/allowlist/security contract test はない。

## 推奨する 202607 実装境界

### 全体

```text
GUI frontend
  AppShell / WorkflowDesigner
    <- frontend app / adapters
      -> BridgeClient
        -> QWebChannel transport
          -> BridgeDispatcher
            -> ApplicationServices
              -> Document / Catalog / Workspace services
              -> ExecutionManager
                -> ExecutionPlanner / Scheduler
                  -> ConnectorRegistry
                    -> Connectors

CLI
  -> ApplicationServices
    -> DocumentLoader / CatalogSnapshot
    -> ExecutionManager
```

- GUI と CLI は document、catalog、execution、result、log の domain contract を共有する。
- CLI は Qt、WebView、QWebChannel、host capability を起動しない。
- engine は YAML file や catalog file を直接読まず、validation済み
  `ExecutionPlan` を受け取る。
- connector は `.zizd`、YAML、QWebChannel を認識しない。

### document load/save

backend に次の境界を置く。

```text
YAML text
  -> parse
  -> structural validation
  -> semantic/graph validation
  -> DocumentSnapshot + ValidationIssue[]
```

- YAML syntax errorやroot型不正は file-level error とする。
- graph参照、cycle、loop、merge等の修正可能な問題は、GUIでは
  `ValidationIssue[]` とともにdocumentを開く。
- 認識可能な新multi-flow形式でedgeだけが欠落した場合は recovery patchを作り、
  GUIをdirtyにする。
- CLIは recoveryせずerrorにする。
- run開始時は current GUI draftをdeep copyし、immutable snapshotとして固定する。
- 保存済みfileをGUIで編集した場合も、実行対象はdisk snapshotではなく
  current draftにする。
- saveは `expected_mtime_ns` による競合検知と、temporary fileからのatomic replaceを使う。
- save responseはbackendがcanonicalizeしたdocument revisionを返し、
  frontendと保存結果の差を残さない。

### catalog と connector

catalog snapshotにはfrontend向けmetadataとbackend内部metadataを分けて持つ。

backend内部に必要な項目:

- `connector_id`
- `action_id`
- lazy factory reference
- form schema
- result contract
- input ref definition
- node type
- security profile
- cancel capability
- concurrency policy

connector module path/class pathはfrontendへ返さない。

catalog取得時にBigQuery、VectorDB等の重いSDKをimportしない。
connector classは対象action実行時にlazy loadする。

`steps[].schema.columns` は保存上 `params` と分けるが、
connector入口 `execute(action, params, context)` は維持する。
ExecutionManagerがconnector呼出し直前に、schemaをnative listとして
予約済みの実行用 `params["schema"]` へ投影する。

202607 catalog formでは通常param名として `schema` を定義せず、
保存済み `params.schema` も受け付けない。

### connector実行結果

action名のhardcodeを減らすため、connectorの内部戻り値を共通化する。

```text
ActionResult
  data                 result本体
  context_updates      define_values等の明示的な変数更新
  resource_handles     cleanup対象
  diagnostics          backend内の診断情報
```

`execute(action, params, context)` の入口は維持し、戻り値を
ExecutionManagerが `ActionResult` へ正規化する。

DataFrame attrsやaction名比較で `define_values` 等を特別扱いしない。

### execution

1. `DocumentSnapshot` から対象 `flow_id` を選ぶ。
2. graphとcatalog input refsを検証する。
3. `ExecutionPlan` を構築する。
4. runごとのcontext、result store、resource scopeを作る。
5. bounded schedulerでready stepを実行する。
6. terminal後にraw dataとresourceをcleanupする。

control dependencyとdata dependencyは分ける。

- edgeは実行可否と到達順を表す。
- catalog input refは実際にDataFrame等を消費する参照を表す。
- data refのproducerは同じgraph内のupstreamでなければならない。
- control edgeがあるだけではDataFrame consumerと数えない。

### GUI step run cache

raw cache keyはbackend内部で次を含める。

```text
document session + flow_id + step_id
```

cache recordには、少なくとも次を持つ。

- source run_id
- status
- raw result
- execution fingerprint
- created_at

execution fingerprintはconnector/action/params/schema/start variables/input refs等の
実行結果へ影響するfieldから作る。

current draftのfingerprintと一致しないcacheは上流入力に使わず、
stale errorにする。label、position、note等の表示変更はfingerprintへ含めない。

### connector runtime resource

DataFrame以外に、Selenium driver等のresource寿命も必要である。

- `gui-flow-run` / `cli-flow-run`: run resource scopeで管理しterminal時に閉じる。
- `gui-step-run`: document/flow resource scopeで管理し、tab close、明示close、
  app終了時に閉じる。
- connectorは共通cleanup hookへresourceを登録する。
- bridgeやengineで `SeleniumConnector` 名を比較してcleanupしない。

### result / log

- public result keyは確定どおり `run_id + step_id`。
- active runは常にRunStoreへ保持する。
- terminal eventより先にsummary/result cache/logを確定する。
- channel再接続用に、backendのrunを再発見する `run.list` 相当が必要である。
- `result.getLogs` には `limit`、`has_more` を追加し、無制限responseを避ける。
- run logの `log_seq` は中央のRunLogStoreがlock/queue内で採番する。
- `run_log`、`gui_app_log`、`cli_app_log`、`debug_log` は別sinkにする。
- 全sinkの前に共通secret sanitizerを通す。
- 10日保持に加えて、disk枯渇防止の総量上限とfile size rotationを維持する。

明示的なfile picker、workspace root、data output metadata等、
機能上pathを表示するresponseは実pathを返してよい。
通常log、error detail、app status等の非path機能では実pathをmaskする。

### frontend

推奨は、Zizai GUIを1つのbundled app entryへまとめる構成である。

- BridgeClientはapp process内で1instance。
- catalogは起動時に1回取得する。
- tabごとのdocument stateはapp state mapで管理する。
- iframeごとのbridge初期化とglobal stateを廃止する。
- home/settings/workflowは同一app内のviewとして切り替える。
- AppShellのgeneric topbar regionは維持するが、Zizai adapterでは非表示にし、
  現行どおり独立headerを設けない。

frontend state:

```text
document state
  documentsByTab / dirty / validation / revision

runtime state
  runsById / latestResultRunByStep / logs / result summaries

UI view state
  activeTab / activeFlow / selection / viewport / panel / layout
```

`WorkflowDesigner` はcontrolled componentにする。

- documentの正本とundo/redo historyはapp reducerが持つ。
- Designerはselection、viewport、drag中previewだけを内部保持する。
- document変更はsemantic operationとしてappへrequestする。
- property panel編集とcanvas編集を同じhistoryへ入れる。

frontend libraryはTypeScript導入を前提にせず、framework-freeのbrowser-native
ES moduleとscoped CSSを正本にする。

- Zizai内ではrelative importを使う。
- 別appへは同じES module directoryを配布できる。
- bare package名やbuild toolは必須にしない。
- public data shapeは文書中でJSON object例として示す。

### test

各実装段階で次を固定する。

| layer | 必須test |
| --- | --- |
| YAML/document | parse、quote、multi-flow、missing edge recovery、invalid graph、atomic save |
| catalog | ID参照、form、result contract、input refs、lazy factory、例外action |
| planner | flow scope、DAG、cycle、loop、merge、data dependency、no fallback |
| runtime | parallel、failure、cancel、lifetime、stale step cache、resource cleanup |
| result/log | run key、cache eviction、log_seq、pagination、10日rotation、mask |
| CLI | multi-flow選択、exit code、Qt/QWebChannel非起動 |
| bridge | envelope、unknown command、payload、thread dispatch、run recovery |
| host | fixed entry、remote navigation、popup、devtools |
| libraries | AppShell/Designer public API、graph refs、history request、notes |
| frontend | mock BridgeClientによるPlaywright |
| integration | PySide WebView + QWebChannel |

## 合意済み内容から修正できる文書矛盾

以下は新しい仕様判断ではなく、既回答内容と現行実装根拠から修正できる。

| 不整合 | 修正方針 |
| --- | --- |
| `.zizd` sampleが `connector` / `action` | `connector_id` / `action_id` に統一 |
| `ziz_datatype` が `string` と `STRING` で混在 | `core/type_registry.py` に合わせてuppercaseを正本化 |
| `document.nodes` / `document.edges` | `.zizd`と同じ `steps` / `flows` / `loop.flows` に修正 |
| public API sampleがTypeScript `type` | JSON object例へ変更 |
| YAML sampleの未quote string | single quote規則へ合わせる |
| 不要な `params: {}` sample | paramがないstepでは省略する |
| sticky note schemaが未定義 | 現行 `id/x/y/w/h/text/color/anchorNodeId` を明記 |
| GUI saved flowはdisk snapshotで実行 | current GUI draft snapshotで実行へ修正 |
| `flow.load`にvalidation issueがない | `validation`, `dirty`, `revision`, `mtime_ns` を追加 |
| `flow.save`に競合検知がない | `expected_mtime_ns` とcanonical revisionを追加 |
| QWebChannel復旧時にrunを発見できない | `run.list` 相当を追加 |
| pathを全responseでmaskする記述 | 明示的path機能とlog/errorを分ける |
| AppShell topbarとZizaiの独立headerなしが混在 | generic capabilityとZizai設定を分ける |
| `202607-state-ux.md`のstateが2分離寄り | document/runtime/UI viewの3分離へ修正 |
| implementation sequenceがG-2回答と不一致 | `.zizd -> catalog -> runtime/CLI -> bridge -> libraries -> app -> integration`へ統一 |
| `.docs/architecture.md`がcurrent/futureを混在 | 202606実装事実と202607移行先を文書上で分離 |
| orchestration progressがfrontend未着手のまま | 現在の設計進捗へ更新 |

## ユーザー判断が必要な課題

### Q1. document と flow の名称・CLI選択

1つの `.zizd` に複数flowを持つため、現在の `flow.load` と `flow_ref` は
実際にはdocument fileを指している。

推奨:

- commandを `document.list/load/save/tabClosed` にする。
- `flow_ref` を `document_ref`、`flow_token` を `document_token` にする。
- `flow_id` はdocument内の実行対象だけを指す。
- CLIは `ziz file.zizd --flow <flow_id>` を追加する。
- flowが1件だけなら `--flow` を省略可、複数なら必須とする。
- run summaryは `document_name`、`flow_id`、`flow_label` を分ける。

影響:

- `.zizd`
- flow/document bridge command
- run conflict key
- GUI tab state
- CLI
- log/summary

### Q2. Zizai frontendをsingle entryにするか

202606はflow tabごとのiframeである。

推奨:

- 202607はsingle bundled app entry、1 BridgeClient、1 catalog cacheにする。
- AppShell内でtabごとのdocument/viewを切り替える。
- iframeはlegacy pathとして削除する。

iframe維持を選ぶ場合、tabごとのQWebChannel lifecycle、catalog cache、
run recovery、cross-frame event、state同期を追加設計する必要がある。

影響:

- QWebChannel security
- AppShell
- frontend state
- run recovery
- performance
- Playwright/PySide integration

### Q3. `output_variable` を残すか

202607文書は、step参照に `step_id` を使う記述と、
runtime contextを `output_variable` で引く記述が混在している。

推奨:

- saved step outputのidentityは `step_id` に統一する。
- `output_variable` は202607保存形式から削除する。
- `input_data` / `source_step_id` はcatalog上 `step_ref` 型にし、
  `step_id` を保存する。
- named scalar variableはstart variables / `define_values` として分ける。

残す場合は、`step_id`との重複、rename、重複禁止、参照更新、
cache keyとの関係を追加定義する必要がある。

影響:

- `.zizd`
- catalog input refs
- runtime context
- DataFrame lifetime
- GUI step cache
- property form

### Q4. graph上のnode/edge参照

複数flowでは `START` / `END` が重複する。
現在のDesigner APIの `nodeIds` / `edgeIds` では一意に指定できない。

推奨:

- stepは `{ kind: "step", step_id }`。
- terminalは `{ kind: "start"|"end", flow_id }`。
- edgeは `{ graph_kind, flow_id|loop_owner_id, from, to }`。
- 同じgraph内の重複 `from + to` edgeは禁止する。
- 保存用 `edge_id` は追加しない。
- `edge.kind` はruntime意味が未定義のため削除し、複数incomingをAND mergeとする。
- Designer patchは上記参照を使うsemantic operationにする。

edgeごとに保存済み `edge_id` を追加する案も可能だが、
保存fieldとID生成規則が増える。

影響:

- `.zizd` validation
- WorkflowDesigner selection/patch
- validation overlay
- undo/redo
- loop graph

### Q5. loop child result

loop childは同じ `run_id + step_id` で複数回実行されるため、
現在のresult keyだけではiteration別resultを区別できない。

推奨する202607最小仕様:

- loop childのdata area cacheは最後に完了したiterationだけを保持する。
- cache responseに `iteration_index` を追加する。
- logには任意の `iteration_path` を追加する。
- loop child単独の `gui-step-run` はiteration contextがないため禁止する。
- loop親の `gui-step-run` はloop全体を実行する。
- iteration中のchild raw resultはiteration終了時に解放する。

全iterationのresult閲覧が必要なら、result keyへiteration identityを追加する
別設計が必要である。

影響:

- run/result contract
- loop runtime
- data area
- log
- GUI step run

### Q6. schedulerとfailure/concurrency

202606はready step数だけthreadを作り、別flowの同時実行やWindows/RPA resource競合を
制御しない。

推奨:

- worker数は設定可能な上限付きにする。
- 同じdocument/flowの同時runは禁止する。
- action catalogに `concurrency_scope` / `resource_key` を持たせ、
  Windows操作、clipboard、Selenium等を直列化できるようにする。
- 1 step failure後は新しいstepを開始しない。
- 実行中siblingにはcancelを要求し、terminalまで待つ。
- downstreamは `skipped` にする。
- 即時停止不能actionでは `cancel_requested` を表示し、完了まで待つ。

確認が必要:

- default worker上限。
- 異なるflow runを同時許可するか。
- failure時に独立branchを最後まで続けるか、停止要求するか。

影響:

- runtime
- cancel
- catalog
- run status
- log
- resource lifetime

### Q7. terminal run/result cache保持

202607は `run_id + step_id` で取得するが、memory cacheの保持上限がない。

推奨:

- active runは必ず保持する。
- open documentの最新runは必ず保持する。
- terminal runはLRU件数上限とmemory byte上限の早い方でevictする。
- tab closeで該当documentのdisplay cacheとstep raw cacheを解放する。
- evict後のsummary/resultは `E_RUN_NOT_FOUND`。
- file run logだけは10日保持する。

確認が必要:

- terminal runの件数上限。
- memory byte上限。
- tab close後もsummary/resultをmemory保持するか。

影響:

- run store
- result cache
- reconnect
- data area
- memory使用量

### Q8. `step_id` / `flow_id` の生成規則

stable IDであることは確定しているが、生成元と再採番規則が未定義である。

確認が必要:

- `step1` / `flow1` のようなdocument内連番にするか。
- UUID系opaque IDにするか。
- delete後の番号を再利用するか。
- copy/paste、flow複製、別document import時の再ID規則。
- frontendで生成するか、backend commandで生成するか。

推奨は、編集を通信待ちにしないためfrontendでcollision-resistant IDを生成し、
backend save/run時に一意性を検証する方式である。

## 仕様間の波及確認

| 課題 | `.zizd` | catalog | runtime | bridge | frontend/library | test |
| --- | --- | --- | --- | --- | --- | --- |
| Q1 document/flow identity | 要 | - | 要 | 要 | 要 | 要 |
| Q2 single entry | - | cache | - | lifecycle | 要 | 要 |
| Q3 output identity | 要 | input refs | 要 | result | form/selector | 要 |
| Q4 graph refs | validation | - | plan | validation payload | 要 | 要 |
| Q5 loop result | loop | result contract | 要 | result/log | data area | 要 |
| Q6 scheduler | edge semantics | concurrency | 要 | status/cancel | run UI | 要 |
| Q7 cache保持 | - | - | store | errors/recovery | data area | 要 |
| Q8 ID生成 | 要 | - | validation | draft/save | Designer | 要 |

## 実装順序の再設計

G-2の回答を正本として、次の順序へ統一する。

1. 202606 baselineとtest fixtureを固定する。
2. `.zizd` document model、load/save、validation、ID、graph refsを実装する。
3. catalog snapshot、connector registry、input refs、result contractを実装する。
4. execution plan、runtime、result/log store、ProcessRunner、CLIを実装する。
5. application service、QWebChannel dispatcher、host securityを実装する。
6. AppShell、WorkflowDesignerをpublic APIとsmoke test付きで実装する。
7. single-entry frontend app、adapter、data areaを実装する。
8. legacy global/iframe/config direct read/fallbackを削除する。
9. PySide integration、Playwright、security、lifecycle E2Eを固定する。

各段階でunit/contract testを追加し、最後までtestを後回しにしない。

## 次の相談順

後続仕様への影響が大きい順に、次で確認する。

1. Q1 document/flow identityとCLI選択。
2. Q3 output identity。
3. Q4 graph refs。
4. Q5 loop child result。
5. Q2 single-entry frontend。
6. Q6 scheduler/concurrency。
7. Q7 cache保持。
8. Q8 ID生成。

