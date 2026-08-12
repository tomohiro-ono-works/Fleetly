# 017 202607 Workflow Document Commands

## Status

完了

## Objective

Zizai固有のworkflow編集をapp document storeへのcommandとして集約し、flow追加、edge接続、選択削除、property変更を1操作1 transactionで適用する。

## Scope

- Zizai app側のworkflow document command
  - catalogのdataflow初期値を使うflow追加
  - 通常flow、loop、未所属graphの接続判定とedge追加
  - 未所属componentを通常flowへ接続した場合の所属確定
  - 選択step／edge／sticky noteの削除とdangling edge除去
  - step／flow property変更
  - 実行内容へ影響する変更のresult無効化対象算出
- `WorkflowDesigner` adapter
  - `connect:create-request`と`delete:request`をcommandへ接続
  - commandの接続可否を`graphConstraints`へ接続
  - commandとDesignerで同じID発番器を使用
- Windows PC版のみを実装・検証対象とする。

## Out Of Scope

- production `dataflow.html`／`app.js`の正本経路切替
- property panelの202607 form rendering
- backend result cacheの実削除
- QWebChannel、YAML parse／serialize、file保存
- node palette、flow削除、flow複製、別document間clipboard
- 旧形式から202607形式への変換

## Contract

- commandはstoreの現在documentを読み、変更全体を1回の`store.applyPatch`で適用する。
- flow追加は`catalog.modes.dataflow.nodeDefaults`から初期connector／actionを取得し、`START -> initial step -> END`を生成する。共通`WorkflowDesigner`へZizai固有IDをハードコードしない。
- `step_id`／`flow_id`は既存最大値の次から最小2桁10進で発番し、commandとDesignerで同じsession内high-water markを共有する。
- 通常flowはDAGを維持し、branch／AND合流を許可する。loop内部はDAGに加えて各nodeのincoming／outgoingを最大1件とする。
- 通常flowから未所属componentの先頭stepへ接続した場合、component全体へ`flow_id`を付与し、内部edgeを通常flowへ移す。未所属stepが0件なら`unassigned`を削除する。
- 選択削除は選択対象とそれに接続するedgeを削除し、前後nodeを自動再接続しない。START／END／未所属仮STARTは削除しない。
- connector、action、params、schema、edge、開始変数の変更は、対象stepと依存graph上の下流stepを無効化対象として返す。label、description、位置、sticky noteは対象外とする。
- commandはtransport、YAML、backend runtimeを参照しない。

## Acceptance Criteria

- flow追加で新しい`flow_id`、初期step、START／END、2本のedgeが1 transactionで追加される。
- 通常flowの重複edge、cross-flow edge、cycleを拒否する。
- loop内部のbranch、merge、cycleを拒否する。
- 未所属component接続でstep所属とedge保存先が同じtransactionで更新される。
- step削除でdangling edgeと所有loop graphが残らない。
- property変更が実行影響の有無に応じた`invalidated_step_ids`を返す。
- Designerの接続／削除requestがadapter経由でstoreへ反映される。

## Verification

- Playwright workflow document command／adapter contract test
- JavaScript `node --check`
- dependency静的検査
- UI analysis
- `git diff --check`
