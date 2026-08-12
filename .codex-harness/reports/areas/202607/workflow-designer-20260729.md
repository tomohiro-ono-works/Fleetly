# WorkflowDesigner Implementation Report

## Result

Task 014を完了した。

`.zizd`と同じ`steps`、`flows`、`unassigned`、`loop.flows`、`notes`を直接扱う`createWorkflowDesigner()` instance APIを実装した。旧`state.nodes`、`parentId`、top-level editor用`nodes`／`edges`への変換は入れていない。

## Contract

- path配列を使う`add`／`replace`／`remove` document patchを定義した。
- `document:change`は`patch`、`inversePatch`、`reason`、`transactionId`を1操作につき1回通知する。
- appからの`setDocument()`／`updateDocument()`だけを確定入力とするcontrolled componentにした。
- 通常step、flow START／END、unassigned仮START、main／loop／unassigned edgeのselection参照を定義した。
- sticky noteは`note_id`、`ui_position`、`size`、`text`、`color`を正本とした。
- step／flow／noteの標準IDを別scopeで`'01'`から発番し、削除済みIDを再利用しない。

## Library

`static/js/workflow-designer/`へ責務を分割した。

- document patch／inverse／差分
- graph render model
- DOM／SVG renderer
- selection／viewport／status overlay
- pointer／keyboard／context command
- node／note drag、note resize／inline編集
- connect request／graph constraint
- ID allocator
- node／flow duplicate、copy／paste、reference rewrite
- loop枠／loop-back edge、unassigned、sticky note

entryの`workflow_designer.js`だけを300行規則の例外とし、内部moduleは最大290行である。

browser namespaceは`window.zizPackages.workflowDesigner`とし、`createWorkflowDesigner`と`applyDocumentPatch`を公開する。`window.uiNode*`は参照または公開しない。

## Zizai Adapter

`static/js/workflow-designer.zizai-renderers.js`へcatalog由来のnode rendererを分離した。

- `connector_id`／`action_id`からlabel／iconを解決するのはadapterだけである。
- WorkflowDesigner本体はcatalog、connector、action、BridgeClient、QWebChannel、YAMLを解釈しない。
- detail、run、delete、external linkはpublic request eventでappへ委譲する。

## Editing Semantics

- flow全体copyはSTART、END、配下全stepを含むselectionで判定し、新しいflow／step IDへ更新する。
- 部分graphのcross-document pasteは既存flowへ自動接続せず、範囲内edgeだけを保持して`unassigned`へ追加する。
- 同一documentの部分duplicateは元graph scopeを保ち、境界edgeを作らない。
- loop graph key、edge、`loop_owner_id`は共通ID mapで更新する。
- app固有fieldは欠落させず、参照更新だけ同期`referenceRewriter`へ委譲する。
- callback error、不正ID、重複IDではdocumentを変更せずeventも通知しない。

## Verification

- WorkflowDesigner standalone Playwright: 14件成功
- AppShell／TabularImportAssistant／catalogを含むfocused Playwright: 35件成功
- desktop 1440 x 960／mobile 390 x 844 screenshot: overlap、文字切れ、非対象validation badge表示なし
- selection／status／viewport更新: document node DOM再生成なし
- drag: pointer up時に1 transaction、inverse patchで復元
- partial paste／flow copy／loop参照更新／ID非再利用: 成功
- readonly／constraint拒否／custom allocator／reference rewriter rollback: 成功
- library内app固有dependency静的検査: 該当なし
- trailing whitespace: 該当なし
- UI analysis: 新libraryはtop hotspotへ入らず、旧canvas hotspotが引き続き上位

証跡:

- `tests/playwright/artifacts/workflow-designer-desktop.png`
- `tests/playwright/artifacts/workflow-designer-mobile.png`
- `tests/ui_analysis/out/reports/summary.md`

## Deferred

production appの正本を旧`state.nodes`からparse済みdocument storeへ切り替える作業はPhase 8で行う。旧`ui.node.*` canvas public経路の削除は、二重正本を作らず切替確認後のPhase 11で行う。

Task 014内では旧canvasをWorkflowDesignerへ変換するcompatibility adapterを作成していない。

## Next

Task 015としてrun／event lifecycleへ進み、`run.start`、scheduler、cancel、event sequence、cache上限、run indexを実装する。
