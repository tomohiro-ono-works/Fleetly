# Workflow Document Commands Implementation Report

## Result

Task 017を完了した。

Zizai固有のflow追加、edge接続、選択削除、property変更をapp document storeへのcommandへ集約した。`WorkflowDesigner`はgraph操作requestを通知し、adapterが同じcommand判定を使ってstoreへ1 transactionで反映する。

## Commands

- `addFlow`
  - catalogのdataflow初期connector／actionから`START -> initial step -> END`を生成する。
  - flow、step、開始／終了node、edgeを1 transactionで追加する。
- `connect`
  - 通常flowのbranch／AND合流を許可し、重複、cross-flow、cycleを拒否する。
  - loop親を内部graphのSTART／ENDへ写像し、loop内部のbranch／mergeを拒否する。
  - 通常flowから未所属componentへ接続した場合、component全体の`flow_id`とedge保存先を同時に更新する。
- `deleteSelection`
  - step、edge、sticky noteを削除し、dangling edgeと所有loop graphを残さない。
  - 前後nodeの自動再接続とSTART／END削除は行わない。
- `updateStep`／`updateFlow`
  - catalogでconnector／actionの組を検証する。
  - connector、action、params、schema、edge、開始変数の変更では`invalidated_step_ids`を返す。
  - label、description、sticky note等ではresultを無効化しない。

## Adapter

- `connect:create-request`と`delete:request`をcommandへ接続した。
- `graphConstraints`はcommandの`canConnect`を使用し、事前判定とstore適用でgraph規則を重複させない。
- commandとDesignerは同じID allocatorを使用し、削除済みIDをsession中に再利用しない。
- command errorとcommand resultをapp callbackへ通知する。

## Structure

- `static/js/workflow-document.command-support.js`: 共通値、catalog、node scope、ID発番
- `static/js/workflow-document.command-graph.js`: edge、DAG、loop、result無効化範囲
- `static/js/workflow-document.command-connect.js`: 接続計画、未所属component所属確定
- `static/js/workflow-document.command-flow.js`: catalog由来のflow追加
- `static/js/workflow-document.command-edit.js`: step／flow property変更
- `static/js/workflow-document.command-delete.js`: 選択削除
- `static/js/workflow-document.commands.js`: 公開command factory
- `static/js/workflow-designer.adapter.js`: Designer event／constraint接続

各実装は215、222、297、111、253、215、129、224行で、すべて300行以内である。

## Verification

- workflow document command／adapter Playwright: 13件成功
- WorkflowDesigner回帰Playwright: 14件成功
- JavaScript `node --check`: 10対象成功
- command層のBridgeClient／QWebChannel／backend／YAML依存scan: 該当なし
- WorkflowDesigner内の`WindowsConnector`／`define_values` literal scan: 該当なし
- UI analysis: state write 55、canvas redraw 11、layout recalc 24、高頻度render 19で変更前から増加なし
- `git diff --check`: errorなし、既存LF／CRLF warningのみ

## Deferred

- production `dataflow.html`／app bootstrapの202607 document store切替
- property panelの202607 form接続
- `invalidated_step_ids`とbackend result cacheの実接続
- flow削除、node palette、flow複製、別document間clipboard
- QWebChannel flow load／save、YAML parse／serialize
- 旧`state.nodes`／旧canvas経路の削除

## Next

Phase 8のproduction document load／save経路を202607 app document storeへ接続する。旧正本との二重管理は作らず、document単位で切替可能な境界を先に固定する。
