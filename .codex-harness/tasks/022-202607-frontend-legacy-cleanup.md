# Task 022: frontend legacy cleanup

## 状態

完了

## 目的

Phase 11のfrontend境界として、productionで使われない旧flow UI実装と
`window`直下の旧公開先を削除する。frontend module間の正本は
`window.zizPackages`とし、host通信は`zizPackages.core.bridge`だけを使う。

## 対象

- BridgeClientの公開先を`zizPackages.core.bridge`へ一本化
- catalog、dialog、utils、code editor、field／suggest APIのpackage正本化
- embedded documentからparent BridgeClientを参照するpackage経路
- home画面描画をapp専用viewへ分離
- 旧`CONFIG`、`stateOps`、canvas、node detail、renderer、旧`app.js`の削除
- 旧実装だけを検証するPlaywright specの削除

## 維持する正本

- `zizPackages.core.bridge`
- `zizPackages.app.catalog`
- `zizPackages.app.*` adapter／app API
- `zizPackages.ui.fields`／`zizPackages.ui.suggest`
- AppShell、TabularImportAssistant、WorkflowDesignerのinstance API
- production `WorkflowDocumentStore`

## 対象外

- workflow外単体実行UI
- AppShell／TabularImportAssistant／WorkflowDesignerの公開契約変更
- 旧CSSの全面整理
- backend／connector／CLI変更
- PySide host最終integration test

## 完了条件

- production sourceに`window.zizBridge`、`window.zizCatalog`、旧`CONFIG`参照がない。
- production HTMLとJavaScriptから旧flow UI assetへの参照がない。
- 旧flow UI assetが物理削除されている。
- embedded画面がparentのpackage BridgeClientを使用できる。
- home／workflow／adapterのfocused Playwright testが成功する。
- JavaScript構文確認とPython全体testが成功する。

## 検証結果

- JavaScript全体`node --check`: 成功
- Playwright全体: 90件成功
- Python全体: 126件成功、2件skip
- legacy global／削除asset参照検査: 成功
- `git diff --check`: 成功
