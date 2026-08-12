# 016 202607 Workflow Document Store

## Status

完了

## Objective

`.zizd`と同じparse済みdocumentをfrontend appの唯一のdocument正本として保持し、`WorkflowDesigner`のdocument transactionをcontrolled inputとして接続する。

## Scope

- `static/js/workflow-document.store.js`
  - documentと`doc_session_id`／`document_ref`／`file_name` metadataの保持
  - `patch`／`inversePatch`単位のatomic transaction
  - document単位のundo／redo
  - 保存済みrevisionとの比較によるdirty判定
  - save成功時の保存済みrevision更新
  - subscriberへの局所的な変更通知
- `static/js/workflow-designer.adapter.js`
  - store snapshotを`WorkflowDesigner`へcontrolled inputとして渡す
  - `document:change`をstore transactionへ適用する
  - storeのundo／redo／外部transactionをDesignerへ反映する
  - selection／viewport／run／delete／connect等のpublic eventをapp callbackへ委譲する
- Windows PC版のみを実装・検証対象とする。

## Out Of Scope

- production `dataflow.html`／`app.js`の正本経路切替
- 旧`state.nodes`／旧canvasの削除
- property panel／data areaの202607 document対応
- flow追加、connect、delete等のZizai固有document command
- backend command、QWebChannel、YAML parse／serialize
- 旧形式から202607形式への変換

## Contract

- storeはdocumentをcloneして保持し、外部へ内部参照を返さない。
- transactionの`patch`と`inversePatch`は適用前documentに対して相互に復元可能でなければrejectし、documentとhistoryを変更しない。
- 同じ`transactionId`は2回適用しない。
- undo後に新規transactionを適用した場合はredo branchを破棄する。
- dirtyはYAML serializeや全文hashではなく、現在revision IDと保存済みrevision IDの一致で判定する。
- runtime stateとUI stateはstoreへ保存しない。
- adapterはgraph topologyを変換せず、store documentをそのままDesignerへ渡す。

## Acceptance Criteria

- Designerのnode移動1回がstoreのhistory 1件になる。
- store、Designer、保存対象documentが同じ202607 graph構造になる。
- undo／redoでdocumentとDesigner表示が同期する。
- 保存済みrevisionへundo／redoで戻るとdirtyが解除される。
- 不正transactionと重複transactionでdocumentが変わらない。
- store／adapterはBridgeClient、QWebChannel、backend、catalog固有判定、YAMLを参照しない。

## Verification

- Playwright document store／controlled adapter contract test
- JavaScript `node --check`
- dependency静的検査
- UI analysis
- `git diff --check`
