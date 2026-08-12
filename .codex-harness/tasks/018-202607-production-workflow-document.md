# Task 018: production workflow document route

## 目的

production `dataflow.html`のdocument正本を旧`state.nodes`から202607
`WorkflowDocumentStore`へ切り替え、load／save／runが同じparse済みdocumentを
参照するようにする。

## 対象

- production dataflow bootstrap
- `WorkflowDocumentStore`／`WorkflowDesigner`／document commandの接続
- `documents.load`／`documents.save`とembedded workspace tabの接続
- flow追加、undo／redo、save、flow／step runのapp command接続
- 新規`.zizd`の202607 canonical template
- `.zizd`保存時のYAML styleと外部更新競合検知
- focused Python／Playwright regression

## 対象外

- 旧canvas／旧`app.js`等の物理削除
- property form、data area、result previewの全面移行
- 旧single-flow `.zizd`の互換変換
- Windows以外のGUI対応

## 実装方針

1. app document storeを編集中documentの唯一の正本にする。
2. load payloadを旧`state.nodes`へ変換しない。
3. saveと`run.start`にはstore snapshotをそのまま渡す。
4. old `flows.edges`形式は自動変換せずload errorにする。
5. workspace parentとembedded dataflowは公開API／messageだけで連携する。
6. 新規flowは`START -> define_values -> END`をcommandで作成する。
7. 読込時mtimeを保存し、同一pathの外部更新後は`E_CONFLICT`で上書きを止める。
8. YAMLは固定keyをplain、文字列valueと動的ID keyをsingle quote、
   multilineをliteral block、collectionをblock styleで保存する。

## 完了条件

- production `dataflow.html`が旧`state.js`／旧canvas／`app.js`をloadしない。
- `.zizd` load後のstore snapshotとsave request documentが同一構造である。
- flow追加、undo／redo、save、runがstoreを経由する。
- workspace新規作成が202607 `.zizd`を生成する。
- 外部更新競合とcanonical YAMLのPython testが通る。
- production bootstrapのfocused Playwright testが通る。

## 完了記録

- 2026-07-29 完了
- Python全体: 112件成功、2件skip
- productionを含むcore Playwright: 43件成功
- 実装レポート:
  `.codex-harness/reports/areas/202607/production-workflow-document-20260729.md`
