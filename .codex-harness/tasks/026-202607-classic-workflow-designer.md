# Task 026: ClassicWorkflowDesigner

## 状態

完了

## 目的

202606版のCanvas描画と操作感を、202607 canonical document契約を直接扱う
独立UI library `ClassicWorkflowDesigner`として実装し、production GUIへ接続する。

## 対象

- `static/js/classic-workflow-designer/`
- `static/css/classic-workflow-designer.css`
- 現行workflow designer adapterへのfactory注入
- production workflow sessionでのclassic factory選択
- 202606版のnode、edge、sticky note、selection、drag、context操作
- 202607の複数flow、START／END、loop、unassigned、status、validation、connect
- standalone fixtureとPlaywright regression

## 対象外

- `.zizd`、document store、document command、historyの別実装
- 旧`state.nodes`／`parentId`への変換
- property panel、data area、AppShell、QWebChannel、backendの変更
- UI種別の`.zizd`保存
- 現行`WorkflowDesigner`の削除

## 実装方針

1. 非visualなdocument／graph／ID／fragment helperは既存coreを共有する。
2. classic libraryはCanvas描画、hit test、gesture、feedbackだけを所有する。
3. current／classicのfactoryは同じinstance APIとevent名を提供する。
4. production app adapterがclassic factoryを明示的に選択する。
5. connector／action表示はcatalog由来presentation resolverから取得する。

## 完了条件

- production GUIが`ClassicWorkflowDesigner`を使用する。
- canonical documentを変換せず、node移動等が1 transactionでstoreへ反映される。
- node／edge／noteの選択、移動、接続、削除要求、複製、copy／pasteが動作する。
- 複数flow、loop、unassigned、status、validationが描画される。
- 現行designerとproduction workflowのfocused Playwright testが成功する。
- JavaScript構文確認と`git diff --check`が成功する。

## 実施結果

- 202606版のCanvas描画を202607 canonical documentへ直接接続した。
- production GUIはclassic factoryを明示的に選択し、AppShell、property panel、
  data area、code editorには変更を加えていない。
- node／edge／noteの選択、drag、接続要求、削除要求、複製、
  copy／paste、sticky note編集を確認した。
- 複数flow、START／END、loop、unassigned、status、validationを確認した。
- Playwright全98件、JavaScript構文確認、`git diff --check`が成功した。

実施報告は
`.codex-harness/reports/areas/202607/classic-workflow-designer-20260730.md`
を参照する。
