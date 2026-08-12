# Workflow Document Store Implementation Report

## Result

Task 016を完了した。

`.zizd`と同じparse済みdocumentを唯一の正本として保持するapp document storeと、`WorkflowDesigner`をcontrolled componentとして接続するadapterを実装した。対象はWindows PC版のみである。

## Store

- documentと`doc_session_id`／`document_ref`／`file_name` metadataをcloneして保持する。
- `patch`と`inversePatch`の往復を適用前に検証し、不正transactionをatomicに拒否する。
- transaction単位のundo／redoとredo branch破棄を実装した。
- dirtyは全文serialize／hashではなく、現在revision IDと保存済みrevision IDで判定する。
- 保存済みrevisionへundo／redoで戻った場合はdirtyを解除する。
- 同じ`transactionId`の再適用を拒否する。

## Adapter

- store documentを変換せず`WorkflowDesigner`へ渡す。
- Designerの`document:change`をstoreへ適用し、確定snapshotをDesignerへ戻す。
- store側の外部transaction、undo／redo、loadもDesignerへ同期する。
- selection、viewport、run、delete、connect、external link等はapp callbackへ委譲する。
- BridgeClient、QWebChannel、backend、YAML、connector/action固有判定は持たない。

## Structure

- `static/js/workflow-document.store-patch.js`: patch／inverse／atomic検証
- `static/js/workflow-document.store.js`: revision／history／dirty／subscription
- `static/js/workflow-designer.adapter.js`: controlled component接続

各実装は187行、260行、144行である。

## Verification

- WorkflowDesigner + document store focused Playwright: 18件成功
- document store固有contract: 4件成功
- JavaScript `node --check`: 成功
- transport／backend／YAML／固有ID判定dependency scan: 該当なし
- UI analysis: state write 55、canvas redraw 11、layout recalc 24、高頻度render 19で変更前から増加なし
- `git diff --check`: errorなし、既存LF／CRLF warningのみ

## Deferred

- production `dataflow.html`／app bootstrapの202607経路への切替
- property panel／data areaの202607 document対応
- flow追加、connect、delete等のZizai固有document command
- 旧`state.nodes`／旧canvas経路の削除

## Next

Task 017としてZizai固有workflow document commandを実装し、flow追加、edge接続、削除、property変更を同じdocument store transactionへ統一する。
