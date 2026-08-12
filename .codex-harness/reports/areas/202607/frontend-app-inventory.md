# フロント app 専用 現行実装棚卸し

## 対象

- zizai 固有フロント app layer の data area、schema editor、run UI、状態管理、catalog/config 参照。
- 対象は現行実装の棚卸しであり、仕様確定・実装変更・`.docs/` 更新は行っていない。

## 調査範囲

- 最初に `AGENTS.md`、`.codex-harness/subagents/README.md`、`.codex-harness/subagents/05-frontend-app.md` を確認した。
- 指定対象の `static/js/app.js`、`static/js/ui.fields.js`、`static/js/ui.node.detail.js`、`static/js/ui.node.shared.js`、`static/js/state.js`、`static/js/workspace.manager.js`、`static/config/config.js` を確認した。
- 方針比較用に `.docs/future/202607-frontend-app.md`、`.docs/future/202607-state-ux.md`、`.docs/areas/ui.md` を確認した。
- `ui-analysis-review` 手順に従い `tests/ui_analysis/out/reports/summary.md` は読んだ。ただし `ui_analysis.ps1` は解析生成物を更新するため、今回の「出力先はこの1ファイルだけ」に合わせて実行していない。
- run UI の実行ボタン起点確認に限り、補助的に `static/js/ui.node.canvas.js` の該当箇所を確認した。

## 現行実装の事実

### 全体構成

- `static/config/config.js` が `CONFIG` を定義し、`window.CONFIG` と `window.zizPackages.core.CONFIG` へ直接公開している。
- `static/js/app.js` は `window.zizPackages.core.CONFIG`、`stateOps`、`ui.renderer`、`bridge` を取得して起動する。`buildConfigForMode()` は `CONFIG.modes[mode].connectorIds` に基づき `connectors`、`actions`、`forms` を絞り込む。
- `static/js/state.js` も `getConfigObject()` で `window.zizPackages.core.CONFIG` を直接参照し、初期 connector/action/default flow name を決めている。
- `static/js/ui.renderer.js` の `renderApp()` は `renderFlowChart()` と `renderNodeDetail()` を呼び、分割レイアウトでは右詳細に `detail/yaml/variables`、下部に `data` だけを描画する。
- `static/js/workspace.manager.js` は flow を iframe の `dataflow.html?embedded=1` として開き、`flow.load` の結果を `ziz:workspace-flow-open` で iframe へ渡す。

### data area

- `.docs/areas/ui.md` は data area の 4 タブを `スキーマ定義`、`スキーマ定義（JSON）`、`データ出力`、`ログ` としている。
- 実装上の上位タブは `ui.node.detail.js` の `detail/yaml/data/variables` であり、分割レイアウトの下部は `data` タブだけを hidden tab header で表示する。
- 4つの表示切替は `ui.fields.js` の `renderSchemaEditor()` 内の mode button として実装されている。schema field がない node では schema editor 自体が出ず、4切替も出ない。
- `ui.node.detail.js` の data pane は schema editor wrap と preview table を持つが、schema field がある場合は `root.__nodeDetailDataView` が `schema` に戻され、preview wrap は通常 hidden になる。
- data pane の同期処理 `syncDataView()` は data タブ表示時に `result.getSchema` と `result.getPreview` を bridge 経由で呼ぶ。結果は `root.__nodeDetailDataCacheState` に最大 24 件キャッシュされる。
- data pane の cache key は `appMode/fileName/flowName/stepId` ベースで、`lastRunSummary.run_id` は同期判定キーには含まれるが、実データ cache key には含まれない。

### schema editor

- `ui.node.detail.js` は form schema から `schema` または `schema_add_description` の最初の field を schema editor 用 field として取り出し、それ以外を右詳細フォームに描画する。
- `renderSchemaEditor()` は form mode、JSON mode、output mode、log mode を持つ。
- form mode の保存対象は `node.form[field.key]` の JSON 文字列で、行項目は `origin_name`、`new_name`、`description`、`ziz_datatype`、`is_disabled` に正規化される。
- `description` 列は `schema_add_description` の場合だけ表示される。`origin_name` は readonly、`new_name` は policy が許す場合だけ編集可能。
- JSON mode の textarea も同じ `node.form[field.key]` を更新する。JSON が simple schema と判定できる場合は form mode に戻れる。
- schema policy は `ui.fields.js` 内の `SCHEMA_NO_RENAME_ACTIONS` と `SCHEMA_READONLY_ACTIONS` に hard-code されている。

### schema 読込、autoextract、autoload

- `static/config/config.js` の form 定義には `schema_autoextract:true` や `schema_autoload:true`、`schema_autoload_target` が直接書かれている。
- `schema_autoextract` は `renderSchemaEditor()` の初期化時と output mode 表示時に `result.getSchema` を呼び、取得 columns をローカル編集内容と merge して `node.form[field.key]` に書き戻す。
- `schema_autoload` は `input_data` 選択時に動く。上流 node の `form.schema_add_description` または `form.schema` を優先し、なければ `result.getSchema` から columns を取得して target field へ書く。

### data output / log の取得経路

- schema editor の `データ出力` mode は `result.getPreview` だけを取得し、最大 200 行を表示する。
- data pane 側の preview は `result.getSchema` と `result.getPreview` を取得し、schema に基づいて `DATE` の表示整形などを行う。
- `ログ` mode は backend log API ではなく `node.runtimeLogs` を textarea に表示する。`node.runtimeLogs` は `requestNodeRun()` が「ステップ実行/フロー実行をリクエストしました」を追加するローカルログ。
- `app.js` は `run.log` event を console に出すだけで、data area の log 表示には反映していない。
- flow run 完了時のログダイアログは `runLogsById` のローカル行から作られ、開始、stepStatus 成功/失敗、完了行を表示する。

### run UI

- header の実行は `app.js` の `onRun -> handleBridgeRun("header")`。
- node 詳細のステップ実行ボタンと canvas context menu の実行は `ui.node.shared.js` の `requestNodeRun()` / `requestNodeRunById()` から `zizai:node-run-request` を dispatch し、`app.js` が `flow.run` を `step_id` 付きで呼ぶ。
- canvas 上部 toolbar の実行ボタンは `ui.node.canvas.js` で pane shortcut `run` を発火し、最終的に app shell 側の run action に渡す構造。
- `handleBridgeRun()` は同時実行を `activeFlowRunId` で禁止し、実行中は header run button と `state.__runAllRunning` で編集 UI を lock する。
- `run.stepStatus` は `pendingStepStatuses` に入り、120ms 後に `state.stepStatuses` へ反映される。通常は `uiNode.refreshFlowStatus()` で canvas status だけ更新し、force 時だけ full render する。
- `run.completed` / `run.failed` は `result.getSummary` を取得し、lock 解除、必要に応じた full render、schema editor mode の `output` 切替、flow status 更新、ログダイアログ表示を行う。
- 指定ファイル内では実行停止/キャンセル API を呼ぶ UI は見つからなかった。`cancelled` 状態の表示分岐だけ存在する。

### state

- `stateOps.createDefaultState()` の正本は `version`、`appMode`、`flowName`、`nodes`、`stickyNotes`、`startParameters`、`selectedNodeId`、`selectedNodeIds`、`pendingMergeSourceId`、`nextStepSeq`。
- node は `connector`、`action`、`description`、`descriptionAuto`、`form`、`parentId`、`mergeParentIds`、`parallelOf`、`parallelOrder`、`outputs`、`nodeType` などを持つ。
- app runtime の一部は module 変数で管理される。例: `activeFlowRunId`、`currentRunId`、`runKindById`、`runMetaById`、`lastRunSummary`、`activeRightPanel`。
- 一方で UI/runtime 用の値も state/node に入る。例: `state.__runAllRunning`、`state.stepStatuses`、`node.__schemaEditorMode`、`node.runtimeLogs`、`state.hiddenBindings`。
- `.zizd` export は `buildCompiledFlowPayload()` / `buildExportSteps()` を通り、form schema に含まれる field だけを `params` へ出す。`stepStatuses`、`runtimeLogs`、`__schemaEditorMode` は export されない。
- session cache として `sessionStorage` に `ziz.modeStates.v1` と `ziz.pendingFlow.v1` を保存し、`beforeunload` / `pagehide` で削除する。

### catalog / config adapter

- 独立した catalog adapter は現状ない。
- connector/action 表示は `ui.node.shared.js` の `renderConnectorSelect()` が `config.connectors`、`config.actions`、`action.rpaType` を直接見て構築する。
- action 分類は `ACTION_TYPE_TABS = Extract/Load/Transform` と `normalizeActionType()` / `getActionTypeItems()` に hard-code されている。
- connector icon は `connector.icon` / `connector.iconSrc`、なければ `./img/${connectorId}.jpg`、失敗時 `./img/noimage.jpg` に fallback する。
- connector/action 選択時は UI component 内で `node.connector`、`node.action`、`node.form`、`node.nodeType`、`node.description` を直接変更する。

## 202607 方針との乖離

- 202607 方針では frontend は `static/config/config.js` を直接読まないが、現行は `config.js` が global `CONFIG` を公開し、`app.js` / `state.js` / UI component が直接参照している。
- 202607 方針の `app/bootstrap.js`、`app_state.js`、`selectors`、各 adapter/view への責務分離は未実装で、現行は `app.js` と UI component に app layer、adapter、view、state mutation が混在している。
- data area 4 tab は現行では独立した data area tab ではなく、schema editor 内 mode として実装されている。schema field がない node では 4 mode が出ない。
- 202607 方針では app layer は backend から取得した schema/preview/log を UI 部品へ渡すだけだが、現行は `ui.node.detail.js` / `ui.fields.js` が bridge 呼び出し、cache、preview 整形、schema merge を直接行う。
- `.docs/areas/ui.md` は data output のメタデータ表示や workflow 例外を定義しているが、現行 frontend は connector/action 別の出力 policy を持たず、backend preview の columns/rows をそのまま表にする。
- 202607 方針では connector/action 分類ロジックを UI component に入れないが、現行は `rpaType` 分類、action type tab、icon fallback、loop action 制御が `ui.node.shared.js` に入っている。
- 202607 状態管理方針では state 正本を最小化し派生 state を selector/helper で計算するが、現行は `__runAllRunning`、`stepStatuses`、`__schemaEditorMode`、`runtimeLogs` など UI/runtime 値が state/node に混在している。
- event 方針では handler は command を発行し mutation を集中管理するとされるが、現行は `renderConnectorSelect()`、`renderField()`、`renderSchemaEditor()` などが `node.form` や node 属性を直接変更して `onStateChanged()` を呼ぶ。
- run status 更新は一部 `refreshFlowStatus()` で局所化されているが、lock 変更や schema editor mode 変更では `onStateChanged()` による `renderApp()` 全体再描画が残る。
- 202607 方針では log/API 分離が想定されるが、現行 data area の log は backend log ではなく node local log と console 出力が中心。
- 実行停止 UI は指定ファイル内で確認できず、run UI の「実行、停止、状態表示、結果反映」のうち停止操作は未実装に見える。
- data pane cache は `lastRunSummary.run_id` で再同期判定はするが、実データ cache key には run id が含まれないため、同じ step の再実行後に古い preview cache を再利用する可能性がある。

## 相談事項

- data area 4 tab を「schema editor 内 mode」として維持するか、「下部 data area の正式タブ」として切り出すか。推奨は 202607 方針に合わせ、`data_area_view` 側で 4 tab を持ち、schema editor は schema 表示/編集部品に限定する案。
- data output の connector/action 別 policy を frontend で持つか、backend/catalog から取得するか。推奨は catalog/config 側に表示 policy を寄せ、UI component 内の分類・例外 hard-code を減らす案。
- `node.__schemaEditorMode`、`state.__runAllRunning`、`state.stepStatuses`、`node.runtimeLogs` を document state から app runtime state へ分離するか。推奨は保存形式の正本と UI runtime state を明確に分ける案。
- `run.log` event と data area の `ログ` mode をどう接続するか。推奨は backend log endpoint または run event store を正本にし、node local log は操作リクエスト履歴に限定する案。
- 実行停止/キャンセル UI を 202607 run UI に含めるか。含める場合は `flow.run` と対になる cancel endpoint、lock 解除、step status の扱いを別途決める必要がある。
- data pane cache は run 完了時に破棄するか、cache key に `run_id` を含めるか。推奨は result 系 cache を run id 単位にする案。
- schema policy の hard-code set を config/catalog に移すか。推奨は `allowRename`、`readOnly`、`descriptionColumn`、`autoextract/autoload` を catalog 側の field policy として扱う案。

## 参照ファイル

- `AGENTS.md`
- `.codex-harness/subagents/README.md`
- `.codex-harness/subagents/05-frontend-app.md`
- `tests/ui_analysis/out/reports/summary.md`
- `.docs/future/202607-frontend-app.md`
- `.docs/future/202607-state-ux.md`
- `.docs/areas/ui.md`
- `static/config/config.js`: `CONFIG`、`forms`、`schema_autoextract`、`schema_autoload`、`window.zizPackages.core.CONFIG`
- `static/js/state.js`: `stateOps.createDefaultState()`、`getConfigObject()`、`createDefaultNode()`、`createNewNode()`
- `static/js/app.js`: `buildConfigForMode()`、`runOnStateChanged()`、`onStateChanged()`、`handleBridgeRun()`、`handleBridgeEvent()`、`queueStepStatus()`、`flushStepStatusUpdates()`、`fetchRunSummary()`、`buildStateFromYaml()`、`buildExportSteps()`、`buildCompiledFlowPayload()`
- `static/js/ui.renderer.js`: `renderApp()`
- `static/js/ui.node.detail.js`: `renderNodeDetail()`、`syncDataView()`、`ensureDataViewSynced()`
- `static/js/ui.fields.js`: `renderSchemaEditor()`、`resolveSchemaTextFromInputData()`、`applySchemaAutoloadFromInputData()`、`syncSchemaAutoextractFromResult()`、`syncOutputPreview()`、`syncRuntimeLog()`
- `static/js/ui.node.shared.js`: `renderConnectorSelect()`、`requestNodeRun()`、`requestNodeRunById()`、`getActionTypeItems()`、`getConnectorImageSrc()`、`getActionConfig()`
- `static/js/workspace.manager.js`: `buildEmbeddedFlowUrl()`、`dispatchFlowPayloadToFrame()`、`fetchFlowPayloadByPath()`、`bindWorkspaceRunEvents()`
- `static/js/ui.node.canvas.js`: pane run button と context menu run の起点のみ補助確認

## 未確認事項

- ブラウザ表示・実操作・Playwright による data area / run UI の動作確認は未実施。
- `ui_analysis.ps1` は生成物更新を避けるため未実行。既存 `summary.md` の静的ヒューリスティックだけ参照した。
- backend 側の `result.getSchema`、`result.getPreview`、`result.getSummary`、`flow.run`、将来 localhost API の実装は未確認。
- `.docs/areas/connectors.md`、`202607-catalog-config-delivery.md`、`202607-localhost-api.md` は今回の指定調査対象外として未確認。
- `static/js/ui.node.canvas.js` は run button 起点のみ確認し、canvas 全体の state/render 詳細は未調査。
- schema editor の実際の入力可否、cache stale の再現、run 完了後の data output 更新可否は実機確認していない。
