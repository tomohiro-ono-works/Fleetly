# 202607 runtime data lifetime 仕様

## 位置づけ

この文書は、workflow 実行中に backend が保持する DataFrame / tabular data の初期化、保持、解放、data area 表示用 cache の扱いを定義する。

`.zizd`は保存形式、`run／result／events`はbridge contractであり、DataFrameの実体管理はruntime仕様として分ける。

## 結論

workflow 実行ごとに runtime context は初期化する。

ステップが生成した DataFrame の実体は、後続ステップへ渡すための一時データとして runtime context に保持する。

DataFrame の実体は frontend へ直接返さない。data area には `schema`、`preview`、`row_count` の表示用 result cache を返す。

`cli-flow-run` / `gui-flow-run` の DataFrame 実体は、最後の既知 consumer が完了した時点で runtime context から解放し、run 終了を保持期限の上限とする。

`gui-step-run` の成功結果は、flow 内の step 別 latest raw cache として別管理する。

解放タイミングは `step_id` や `steps` 配列順ではなく、参照関係と実行グラフに基づいて決める。

## 用語

| 用語 | 意味 |
| --- | --- |
| runtime context | 1 回の run 中だけ backend が保持する一時変数領域 |
| output variable | step 結果を runtime context に保存する key |
| producer | DataFrame を生成する step |
| consumer | producer の output variable を参照する step |
| latest raw cache | `gui-step-run` の成功結果を flow 内の step ごとに保持する領域 |
| data area cache | data area 表示用に保存する `schema`、`preview`、`row_count` |
| raw result | DataFrame 実体や connector が返した生結果 |

## 現行実装の確認結果

| 項目 | 現行 |
| --- | --- |
| run 開始時の初期化 | `core/workflow_engine.py` の `_run_config` で `self.context = {}` にする |
| 初期値 | `initial_context`、start variables、system variables を context に追加する |
| step result 保持 | `output_variable` があれば `self.context[output_variable] = result` で保持する |
| DataFrame UI cache | DataFrame result は `schema`、`preview`、`row_count` を `ui_cache` に作る |
| report の raw result | DataFrame の場合、report entry の `result` は `None` にする |
| 寿命計画 | `_build_sequential_lifetime_plan` が params 内の参照を見て consumer 数を作る |
| 解放 | `_decrement_lifetime_after_step` が最後の consumer 完了後に `self.context` から output variable を削除する |
| loop_tasks | `source_step_id` / `input_data` も参照として扱う |
| DAG 実行 | reachable step から寿命計画を作り、step 完了時に解放判定する |

## 202607 方針

### runtime context 初期化

- `cli-flow-run` / `gui-flow-run` の runtime context は run 単位で新規作成する。
- 前回 run の DataFrame 実体を次回 run へ持ち越さない。
- `initial_context` や system variables は明示された値だけを追加する。
- 1つのGUI sessionでは①ワークフロー実行を同時に1件だけ許可するため、別flow／別documentを含むworkflow runtime context同士の競合は作らない。

### DataFrame 保持

- `cli-flow-run` / `gui-flow-run` の DataFrame 実体は backend runtime context 内にだけ保持する。
- `gui-step-run` の成功した DataFrame 実体は backend の step 別 latest raw cache に保持する。
- DataFrame実体をbridge responseやeventへ直接載せない。
- connector、core、execution managerの層間ではDataFrameをPython native objectとして受け渡し、層をまたぐためだけのJSON化、dictionary／list化、deep copyを行わない。
- DataFrameのcopyや変換はactionの処理内容またはconsumer isolationとして必要な箇所だけで明示的に行い、controller／serviceの責務分離を理由に重複copyしない。
- executable step の result は `step_id` をkeyとしてruntime contextへ保持する。
- `.zizd`に`output_variable`は保存せず、step resultの別名も設けない。
- 後続stepの`input_data`、`source_step_id`等には参照元の`step_id`を保存する。
- 通常の名前付きscalar変数は開始変数または`define_values`等で管理し、step resultのidentityと分ける。

### data area cache

- step が DataFrame を返したら、step 完了時点で data area cache を作る。
- data area cache は `run_id + step_id` で取得する。
- cache 対象は `schema`、`preview`、`row_count` とする。
- preview は先頭100行を上限とし、100行を超える場合は `truncated: true` を返す。
- 1stepのpreview全体はUTF-8 JSON換算2 MiB、1セルの表示値は64 KiBを上限とする。超過部分は表示用previewだけを切り詰めて`truncated: true`を返し、raw DataFrameと後続stepへの入力には影響させない。
- byte数はQWebChannel送信用payloadを構築する1回のserialize処理中に加算し、上限到達時点で停止する。全体serializeと縮小serializeを繰り返さない。
- data area cache が作成済みであれば、raw DataFrame を解放した後でも data area に表示できる。
- loop内stepのdata area cacheは反復ごとに同じ`run_id + step_id`へ上書きし、最後に完了した反復のschema、preview、row_countだけを残す。
- `gui-flow-run`のterminal summaryとdata area cacheはflowごとに最新run 1件だけ保持する。同じflowの新しいrunを開始した時点で前回run分を破棄し、以前のrunへfallbackしない。
- document close時は、そのdocumentに属する全flowのterminal summaryとdata area cacheを破棄する。
- GUI session全体の表示用cacheはUTF-8 JSON換算128 MiBを標準上限とし、backend設定で変更可能にする。
- session上限を超える場合は、完了時刻が古いflowからpreviewだけを破棄し、terminal summary、schema、row_countは残す。
- active runのcacheだけで上限へ達し、破棄可能なterminal previewがない場合は新しいpreviewを保存しない。画面にはcache上限で表示できないことを返し、raw DataFrameとrun自体は停止しない。
- `datavolume`の生成、保存、表示、bridge commandは202607版では実装しない。
- full DataFrame を永続保存する仕様にはしない。必要な場合は出力アクションで明示保存する。

②ワークフロー外の単体実行である`gui-standalone-run`は、このworkflow step用backend data area cacheの対象外とし、後述の単体実行result方針を使う。

### 解放タイミング

- `cli-flow-run` / `gui-flow-run` の DataFrame 実体は、最後の既知 consumer が terminal 状態になった後に解放する。
- terminal 状態は `success`、`error`、`cancelled`、`skipped` を含む。
- backend は `.zizd` の `flows.<flow_id>.edges` と catalog の input ref 定義から run ごとの実依存を構築し、実際に解決した依存関係を解放判定の正本にする。
- 解放判定は loop、通常flowの並列／AND合流構造、明示 input refs も含める。Zizaiのloop内部では並列／合流を許可しない。
- `step_id` の文字列順、`steps` 配列順、UI 表示順、`edge.order` から解放タイミングを推測しない。
- producer の consumer が存在しない場合、data area cache 作成後に解放してよい。
- 実行中または未実行の consumer が残っている場合は解放しない。
- run が terminal 状態になった時点で、runtime context に残る DataFrame 実体を全て解放する。
- `cli-flow-run` は process 終了時にも全て破棄する。

### GUI 単一 step 実行

- `gui-step-run` は consumer 数による早期解放の対象にせず、成功結果を flow 内の step 別 latest raw cache として保持する。
- 保持期限は、次の同一 step 実行による更新、flow close、または app 終了までとする。
- 上流入力には、各上流 step の latest `gui-step-run` が `success` で、raw DataFrame が保持されている場合だけ利用する。
- 上流 step が未実行、最新実行が `error` / `cancelled`、参照先が不存在、または raw cache が利用不能なら実行前 error にする。
- 以前の成功結果への fallback と上流 step の自動実行は行わない。
- 最新の同一 step 実行が `error` / `cancelled` の場合は、以前の成功結果へ戻さず、その step の latest raw cache を無効化する。
- `cli-flow-run` / `gui-flow-run` の raw DataFrame は `gui-step-run` の上流入力に利用しない。
- connector、action、params、schemaの変更は、変更stepと依存graph上の全下流stepのlatest raw cacheとdata area cacheを無効化する。
- edge、入力参照、開始変数の変更は、その影響を受けるstepと依存graph上の全下流stepのcacheを無効化する。step削除時はそのstepのcacheも削除する。
- label、node位置、色、sticky note等、実行内容へ影響しない変更ではcacheを維持する。
- 無効化したraw DataFrameはmemoryから解放し、必要な上流cacheがない下流step実行は上流の再実行が必要なことを示す実行前errorにする。
- `.zizd`、明示的に出力済みのfile、保存済みrun logはcache無効化の対象にしない。

### GUIのワークフロー外単体実行

- `gui-standalone-run`はBigQuery、DuckDB、Python等のconnector actionを直接実行し、workflow runtime context、step、edge、flowを作らない。
- DataFrameを返すactionでは、実行前に`preview`または`excel`のresult modeを選択する。
- `preview`では上限付きpreviewを生成して完了eventへ載せた後、raw DataFrameを即時解放する。backendにはraw、schema、previewのresult cacheを作らない。
- `excel`では保存先と上書き可否を実行前に確定し、actionの戻り値を単体実行resultのexport処理でExcelへ保存する。Excel出力をworkflow stepとして扱わない。
- `excel`では出力の成功／失敗にかかわらず、export処理終了時にraw DataFrameを解放する。
- 単体実行resultを後続runや`.zizd` stepから参照できるlatest raw cacheは作らない。
- previewはfrontendが実行元documentのtab単位で保持し、tab／panel切替では維持する。次回実行で上書きし、tab close、app終了、WebView reloadで破棄する。

### DataFrame以外のmanaged resource

- `gui-flow-run`／`cli-flow-run`のSelenium browser session等は、実行graphとcatalogのinput refから既知consumerを解決し、最後のconsumer完了後にcleanupする。run終了、error、cancelを保持期限の上限とする。
- `gui-step-run`では利用者が後続stepを後から単独実行するため、現在run内の参照数0を解放条件にしない。
- `gui-step-run`で生成したbrowser session等は、`doc_session_id + 生成step_id`のlatest resourceとしてbackendに保持する。
- latest resourceは、同じ生成stepの再実行、生成stepまたは依存関係のcache無効化、document close、app終了時にcleanupする。
- 同じ生成stepの再実行がerrorまたはcancelledになった場合は以前のresourceへfallbackしない。
- frontendへは`web_session_id`等の識別子だけを返し、WebDriver等のresource本体は返さない。

### 参照検出

- 202607 では、connector が利用する runtime context 参照を catalog の input ref 定義で明示する。
- backend は `.zizd` の `flows.<flow_id>.edges`、正規化済み params と catalog の input ref 定義から、参照値を`step_id`として実依存を解決する。
- connector 内部で runtime context を暗黙参照する実装は避ける。
- 参照検出できない値は実行前 validation error にする。
- frontend は同じ edges / catalog を使って依存関係を表示・検証できるが、DataFrame の解放判断は行わない。

### 並列実行

- 1つのGUI `session_id`で、①ワークフロー実行は同時に1件だけ許可する。保存済み／未保存およびflow／step実行を区別しない。
- ②ワークフロー外の単体実行にはsession単位の論理的な件数上限を設けず、①と同時にも、②同士でも開始できる。
- ②の各runは独立した`run_id`を持つ。backendは同一resourceの汎用lock、action固有の競合validation、強制直列化を行わない。
- 1 runあたりの同時実行step数は標準4とし、backend設定で変更できるようにする。
- schedulerはready step数が上限を超えた場合、`edge.order`等のtie-breakerに従って空きworkerへ順次投入する。
- 通常actionは並列実行可能とする。同一resourceへの競合をconnectorまたは外部システムがerrorとして返した場合は、通常のstep failureとして処理する。
- errorにならない上書きや操作干渉はbackendでは検知しない。desktop操作中は、利用者および他の自動化toolが対象desktopを操作しないことを利用条件とする。
- 並列実行では、consumer が起動済みか、未起動だが依存関係上まだ実行予定かを区別する。
- producer は、参照する consumer が全て terminal 状態になるまで解放しない。
- `.zizd`全体で`step_id`を一意にし、並列branch間でもresult keyを競合させない。
- consumer 起動時の input snapshot をどう渡すかは backend 実装詳細だが、解放判定は snapshot 取得後ではなく consumer terminal 後を基準にする。

### loop 実行

- `loop_owner_id`を持つloop内child stepは単独の`gui-step-run`対象にせず、frontendの単独実行操作を無効化し、backendも直接requestをvalidation errorにする。
- loop親の`gui-step-run`は、外部から見た入力、status、result、cache、error、cancelのcontractに通常stepと同じルールを適用する。loop内部では既存の反復context、child graph実行、反復ごとの上書き／解放、loop error／cancel規則を使用し、`gui-step-run`専用の別ルールは追加しない。
- `loop_tasks` の input DataFrame は loop 全体が terminal になるまで保持する。
- loop開始前に総反復件数を確定する。
- 総反復件数が0の場合はloop内stepを実行せず、loopを正常終了にする。
- loop内の同じstep resultは反復ごとに同じ`step_id`の領域へ上書きし、全反復分を蓄積しない。
- 上書き前の一時DataFrameは、その反復内の最後のconsumer完了後に解放する。
- loop外へ明示的に渡すresultは最終反復の値だけとし、loop内部だけで使ったresultはloop終了時までに解放する。
- `current_item`、`current_index` など loop 用一時変数は iteration 終了時に復元または削除する。
- loop 内 step の `step_id` は実行順を意味しない。

### cancel / failure

- 並列実行中に1つのstepが失敗したらfail-fastとし、新しいstepを開始しない。
- すでに実行中の並列stepにはcancelを要求し、terminal状態とcleanup完了を待つ。
- 未開始stepは、失敗stepとの直接の依存有無にかかわらず`skipped`にする。
- cancel要求を受けた並列stepが`cancelled`になっても、起点がstep failureであるrun全体の最終statusは`error`にする。
- 最初のstep failureをrunのprimary errorとして保持し、cancel中の追加errorは診断情報として扱う。
- `cli-flow-run` / `gui-flow-run` が cancel または failure で terminal になった場合、runtime context の DataFrame 実体は解放する。
- `gui-step-run` の最新実行が cancel または failure になった場合、その step の以前の latest raw cache を無効化する。
- 完了済み step の data area cache は保持し、未完了 step は `E_RESULT_NOT_READY` または `E_RESULT_NOT_FOUND` を返す。
- cancel 時に外部出力やファイル書き込みが途中の場合は、各 connector の cleanup 方針に従う。
- document close時に利用者がcancelして閉じることを選んだ場合、runのterminal状態とcleanup完了後にraw cacheとdocument session scopeを破棄する。
- 閉じずに続行を選んだ場合はclose要求だけを取り消し、runとcacheの寿命を変更しない。

## 現行の問題点

| 問題 | 内容 | 202607 方針 |
| --- | --- | --- |
| 名称が sequential | `_build_sequential_lifetime_plan` という名前だが DAG 実行にも使われる | graph/reference based lifetime として命名を変える |
| params 依存 | 参照検出が params 内 template ref 中心 | `flows.<flow_id>.edges` と connector catalog の input ref から実依存を構築する |
| 暗黙参照に弱い | connector 内部で context を直接見ると寿命管理が漏れる | runtime context 参照を公開 contract 化する |
| DataFrame と表示 cache が混ざる | raw result と UI cache の責務が読み取りにくい | raw runtime data と data area cache を分ける |
| 並列時の解放意図が読み取りにくい | step 完了時に減算するため、graph 依存との関係が明確でない | consumer terminal based と明記する |
| 実行方法ごとの寿命が未分離 | flow run と単一 step 実行が同じ latest context に依存する | flow run の一時 context と GUI step の latest raw cache を分ける |

## bridgeとの関係

- frontend は raw DataFrame の存在を前提にしない。
- frontendは`result.getSchema`と`result.getPreview`を使う。
- data area 表示は data area cache を使う。
- run summary は raw DataFrame を含めない。
- logs は DataFrame 実体ではなく、処理件数、進捗、error summary を記録する。

## 確定事項

- runtime context は run 単位で初期化する。
- `cli-flow-run` / `gui-flow-run` の DataFrame 実体は runtime context に一時保持し、最後の既知 consumer 完了後に解放する。
- flow run 終了時と CLI process 終了時には、残る DataFrame 実体を全て破棄する。
- `gui-step-run` の成功結果は step 別 latest raw cache として保持し、以前の成功結果へ fallback しない。
- `gui-standalone-run`はworkflowを作らずconnector actionを直接実行し、raw DataFrameはpreview生成後またはExcel result export終了時に即時解放してbackend result cacheへ保持しない。
- DataFrame 実体は frontend へ直接返さない。
- data area は `schema`、`preview`、`row_count` cache を表示する。
- `datavolume`は生成、保存、表示、bridge commandの全てを202607版から削除する。
- 解放は step 順ではなく、参照関係と実行グラフに基づく。
- full DataFrame 永続保存は標準にしない。
