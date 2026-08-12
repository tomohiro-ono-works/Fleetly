# フロント独自ライブラリ 現行実装棚卸し

## 対象

- AppShell 相当: `static/js/app-shell.js`、`static/js/workspace.shell.js`、`static/js/workspace.manager.js`、関連 CSS。
- WorkflowDesigner 相当: `static/js/ui.node*.js`、`static/js/ui.renderer.js`、`static/js/state.js` の node/state 操作、関連 CSS。
- public API 相当: `window.zizShell`、`window.zizWorkspaceShell`、`window.renderer`、`window.uiNode*`、`window.zizPackages.ui.*`。
- 再利用境界: shell / workspace / designer / property detail / app bridge / catalog / state の混在箇所。

## 調査範囲

- 起動時指定: `AGENTS.md`、`.codex-harness/subagents/README.md`、`.codex-harness/subagents/06-frontend-library.md`。
- 202607 方針: `.docs/future/202607-frontend-library.md`、`.docs/future/202607-appshell-api.md`、`.docs/future/202607-workflow-designer-api.md`。
- 正本規約の要点: `.docs/architecture.md`、`.docs/coding-rules.md`、`.docs/refactor-policy.md`。
- 実装確認: `static/dataflow.html`、`static/home.html`、`static/settings.html`、対象 JS/CSS。
- 実装変更、`.docs/` 更新、仕様確定、他レポート編集は行っていない。

## 現行実装の事実

### AppShell 相当

- `static/js/app-shell.js` は IIFE で即時実行され、`body.dataset.shellPage`、`data-shell-title`、URL query の `embedded=1`、`data-*-url` を読んで shell DOM を構築する。
- `renderSidebar()` は「プロジェクト選択」「エクスプローラー」「設定」など app 固有メニューと icon path を固定で持つ。
- `renderWindowActions()` は診断、最小化、最大化、閉じるの window 操作ボタンを固定で持つ。
- `renderRightSidebar()` は dataflow ページ専用の `#rightSidebar` / `#nodeDetail` を生成する。
- `window.zizShell` として `bindSidebar`、`bindHeader`、`bindRightSidebar`、`updateHeader`、sidebar/right sidebar の開閉・幅・active 更新、`loadScriptOnce` を公開している。
- 現行 API は `createAppShell()` / `mount()` / `destroy()` / `on()` / `off()` ではなく、global object と callback binding で app 側から使われている。
- `static/js/workspace.shell.js` は dataflow ページだけで `main` と `rightSidebar` を `workspace-layout` / `workspace-dataflow-view` / hidden host へ移し、`window.zizWorkspaceShell` に DOM refs を公開する。
- `static/js/workspace.manager.js` は tab、dirty、保存、reload、close、flow iframe、workspace tree、project root、context menu、global shortcut、run event を管理し、`workspace.*` / `flow.*` bridge API を直接呼ぶ。
- `static/js/app.js`、`static/js/app.home.js`、`static/js/app.static.js` は `window.zizShell` の callback に navigation、save/run、workspace action、header state 更新を接続している。

### WorkflowDesigner 相当

- `static/js/ui.renderer.js` の `renderApp()` が home / flow editor / detail panel の描画入口で、`uiNode.normalizeSteps()`、`uiNode.renderFlowChart()`、`uiNode.renderNodeDetail()` を呼ぶ。
- `static/js/ui.node.runtime.js` は `window.uiNode` / `window.zizPackages.ui.node` に `normalizeSteps`、`renderFlowChart`、`renderNodeDetail`、`destroyFlowCanvas`、`refreshFlowStatus` を集約する。
- `static/js/ui.node.js` は `ui.node.*` を順次動的読み込みする loader で、既存 HTML では dataflow ページが同じファイル群を静的にも読み込んでいる。
- `static/js/ui.node.canvas.layout.js` は `state.nodes` と `state.stickyNotes` から model を作り、`config.connectors` / `config.actions` から connector/action label を解決する。
- `static/js/ui.node.canvas.js` は canvas view、selection、drag、pan/scroll、context menu、sticky note、copy/paste、add/delete/merge/run を扱い、`root.__flowRuntime = { state, config, model, onStateChanged }` を保持する。
- `static/js/ui.node.canvas.js` は `window.dispatchEvent("ziz:flow-selection-gesture")`、`window.parent.postMessage({ source: "ziz-embedded", type: "shortcut" })`、`window.zizEmbeddedApi`、`window.zizBridge` / parent bridge を直接使う箇所がある。
- `static/js/ui.node.shared.js` は node 操作補助、connector/action label、connector flyout、modal 起動、run request、delete confirmation、YAML dump、log 表示などをまとめて持つ。
- `static/js/ui.node.detail.js` は node property、YAML、data、variables の detail panel を描画し、`result.getSchema` / `result.getPreview` bridge API で実行結果 preview を取得する。
- `static/js/ui.fields.js` は field renderer だが、file/dir picker、mouse capture、Google auth、schema autoextract、result schema/preview など bridge と action 固有挙動も含む。
- `static/js/state.js` の `stateOps` は `createDefaultState`、node add/remove/move/duplicate、selection、merge、loop node、canvas position、hidden binding copy を提供し、`window.stateOps` / `window.zizPackages.core.stateOps` に公開される。
- 現行 state は `version`、`appMode`、`flowName`、`nodes`、`stickyNotes`、`startParameters`、`selectedNodeId(s)`、`pendingMergeSourceId`、`nextStepSeq`、`hiddenBindings`、`stepStatuses` などを持つ app state で、WorkflowDesigner 専用 document ではない。
- `static/js/app.js` は `.zizd` import/export、validation、bridge load/save/run、history、home view、right sidebar、workspace event を持ち、`renderApp()` へ state/config/callback を渡す。

### public API 化できそうな現行要素

- AppShell 候補: sidebar action、header command（undo/redo/run/save/import/title）、right panel select、sidebar/right panel resize、window control、layout snapshot。
- WorkflowDesigner 候補: document/state set、selection set/get、status overlay 更新、node add/delete/duplicate/connect request、run request、external link open request、detail tab change、sticky note change、destroy。
- 現行 API で残すか adapter 化の判断が必要なもの: `stateOps` の graph editing、`ui.fields` の form renderer、detail data preview、modal picker、workspace tab manager。

### 300 行ルールの例外候補

- `static/js/app-shell.js`: 378 行。AppShell entry file の例外候補だが、現状は app 固有 sidebar/window/right panel も含む。
- `static/js/ui.node.canvas.js`: 1824 行。WorkflowDesigner entry というより canvas interaction 一式で、entry 例外だけでは吸収しにくい。
- `static/js/ui.node.shared.js`: 1156 行、`static/js/ui.node.detail.js`: 1098 行、`static/js/ui.node.canvas.draw.js`: 810 行、`static/js/ui.node.canvas.layout.js`: 463 行。責務単位 module としては 300 行超の分割候補。
- CSS も `20_node-detail.css`: 1552 行、`40_detail-panel.css`: 1013 行、`06_workspace.css`: 582 行、`30_flowchart.css`: 397 行で大きい。

## 202607 方針との乖離

- 202607 は instance API（`createAppShell` / `createWorkflowDesigner`）と `mount/destroy/on/off` を想定するが、現行は global `window.*` と callback binding が中心。
- 202607 は AppShell 内に app 固有文言、route、icon、connector/workflow/bridge を持たない方針だが、現行 AppShell は sidebar item、settings/dataflow URL、window action、dataflow right sidebar を固定で持つ。
- 202607 は AppShell state を layout/active tab/visible region に限定する方針だが、現行 workspace manager は tab dirty/save/run/workspace root/flow iframe/bridge 呼び出しまで同じ shell 周辺にある。
- 202607 は WorkflowDesigner が connector/action catalog、property form、bridge、保存形式に直接依存しない方針だが、現行 `ui.node.*` は `config.connectors` / `config.actions`、connector icon path、action type、modal、result preview、bridge を参照する。
- 202607 は `WorkflowDocument` と overlay status を分ける方針だが、現行は app state の `nodes`、`stickyNotes`、`startParameters`、`selectedNodeIds`、`stepStatuses` を各 UI が直接読み書きする。
- 202607 は delete/run/external-link などを request event として app 側へ委譲する方針だが、現行は delete が state を直接変更し、run request は runtime log 追記後に `zizai:node-run-request` を dispatch する。
- 202607 は `.zizd` 形式への直接依存を持たない方針だが、現行 state/node 形状は `.zizd` import/export と近く、`app.js` の保存/読込変換と密接。
- CSS は token 使用もある一方、workspace/flow/detail に直書き色や app 固有 selector（`#flowchart`、`.flow-layout-page`、`.right-sidebar-content` など）があり、再利用 library CSS と app CSS の境界が未分離。

## 相談事項

- AppShell の境界: `workspace.manager.js` の tab/persistence/bridge は AppShell ではなく app adapter に置く方針が妥当そう。AppShell は layout、activity、tabs 表示、resize、event 発火までに絞るか確認したい。
- WorkflowDesigner の境界: canvas/selection/viewport/connection と、property detail/data preview/field renderer を同一 library に含めるか分けるか要確認。推奨は designer core と property editor adapter の分離。
- Document 変換: 現行 app state をそのまま public `WorkflowDocument` にするか、中間 document へ変換する adapter を置くか要確認。推奨は `.zizd` / connector/action 固有 field を app adapter 側に寄せる。
- `stateOps` の扱い: graph editing の汎用部分は designer document module 候補だが、CONFIG/default connector/hiddenBindings は app 側責務に見える。切り分け単位の合意が必要。
- request event 化: delete、run、external link、file picker、result preview、modal 起動は app 側委譲に寄せる対象。互換のため、現行 `window.*` API に shim を残す移行順が必要。
- Playwright 境界: AppShell の pane resize/tab/command event、WorkflowDesigner の select/drag/connect/delete request/status overlay、detail adapter 分離、embedded iframe と standalone の両方を UI 境界テストにするのがよさそう。
- CSS 境界: shell layout tokens、designer canvas、app workspace、node detail/property editor を別 CSS に分けるか確認したい。特に `flow-layout-page` 前提 selector は app 側へ寄せる候補。

## 参照ファイル

- `AGENTS.md`
- `.codex-harness/subagents/README.md`
- `.codex-harness/subagents/06-frontend-library.md`
- `.docs/architecture.md`
- `.docs/coding-rules.md`
- `.docs/refactor-policy.md`
- `.docs/future/202607-frontend-library.md`
- `.docs/future/202607-appshell-api.md`
- `.docs/future/202607-workflow-designer-api.md`
- `static/dataflow.html`
- `static/home.html`
- `static/settings.html`
- `static/js/app-shell.js`: `renderSidebar`、`renderWindowActions`、`renderRightSidebar`、`bindSidebar`、`bindHeader`、`bindRightSidebar`、`window.zizShell`
- `static/js/workspace.shell.js`: `window.zizWorkspaceShell`
- `static/js/workspace.manager.js`: `activateTab`、`saveTab`、`createFlowView`、`dispatchFlowPayloadToFrame`、`renderTabs`、`bindSidebarActions`、`bindWorkspaceRunEvents`
- `static/js/ui.renderer.js`: `renderApp`
- `static/js/ui.node.js`: `ensureLoaded`
- `static/js/ui.node.runtime.js`: `window.uiNode`
- `static/js/ui.node.canvas.js`: `renderFlowChart`、`destroyFlowCanvas`、`refreshFlowStatus`
- `static/js/ui.node.canvas.layout.js`: `buildFlowModel`
- `static/js/ui.node.canvas.draw.js`: `drawFlowCanvas`
- `static/js/ui.node.canvas.hit.js`: `hitTask`、`hitSelectableNode`、`hitStickyNote`、`hitEdge`、`hitControl`
- `static/js/ui.node.shared.js`: `normalizeSteps`、`getActionConfig`、`requestNodeRun`、`removeNodeById`、`renderConnectorSelect`
- `static/js/ui.node.detail.js`: `renderNodeDetail`
- `static/js/ui.fields.js`: `renderField`
- `static/js/state.js`: `stateOps`
- `static/js/packages/ui.package.js`
- `static/js/packages/core.package.js`
- `static/css/01_base.css`
- `static/css/05_sidebar.css`
- `static/css/06_workspace.css`
- `static/css/10_header.css`
- `static/css/20_node-detail.css`
- `static/css/30_flowchart.css`
- `static/css/40_detail-panel.css`
- `static/css/90_responsive.css`

## 未確認事項

- ブラウザ / Playwright による描画確認は未実施。
- CSS の全 selector と直書き color の完全棚卸しは未実施。
- 実行時の event listener 解除漏れ、iframe 破棄、memory leak は静的確認のみで未検証。
- 外部から `window.uiNodeShared` / `window.uiNodeCanvasParts` を参照している非 static/js 経路は未確認。
- 202607 public API の最終形は未確定。本レポートは現行実装の棚卸しと相談候補に留める。
