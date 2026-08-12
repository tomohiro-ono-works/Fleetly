# Production Workflow Document Implementation Report

## Result

Task 018を完了した。

production `dataflow.html`を202607 `WorkflowDocumentStore`へ切り替えた。
load、編集、save、flow／step runは同じparse済みdocumentを参照し、
旧`state.nodes`への変換と二重正本は作成していない。

## Production Route

- top-levelはAppShellとworkspace tabを管理し、embedded dataflowは公開API／messageで連携する。
- embedded dataflowはcatalogを1回取得し、`WorkflowDocumentStore`、
  document command、`WorkflowDesigner`を初期化する。
- flow追加、undo／redo、document名変更、save、flow／step run、cancelを
  store snapshotへ接続した。
- `static/dataflow.html`から旧`state.js`、旧canvas renderer、旧`app.js`の
  読込を外した。物理fileはPhase 11まで残す。
- 旧single-flow `flows.edges`、旧step field、`params.schema`は変換せず
  load validation errorにする。

## Persistence

- 新規`.zizd`は複数flow canonical構造で
  `START -> WindowsConnector.define_values -> END`を生成する。
- 保存時は固定keyをplain、文字列valueと動的ID keyをsingle quote、
  multilineをliteral block、collectionをblock styleで出力する。
- 空mappingを`{}`として出力しない。
- load時の`mtime_ns`をdocument sessionへ保持し、同一pathが外部更新された
  場合は`E_CONFLICT`で保存を止める。正常保存後は基準mtimeを更新する。

## Running Close

- 実行中documentのcloseは`閉じずに続行`を既定選択にする。
- `実行をキャンセルして閉じる`では`run.cancel`後のterminal eventを待つ。
- terminal／cleanup後にdirtyなら保存確認を行い、その後
  `documents.close`を呼ぶ。
- `documents.close`へ暗黙のcancelは追加していない。

## Structure

- `app/services/yaml_document_serializer.py`: canonical YAML serializer
- `static/js/workflow-app/document_contract.js`: production document contract
- `static/js/workflow-app/workflow_session.js`: store／Designer／run session
- `static/js/workflow-app/workspace_shell.js`: AppShell command構成
- `static/js/app.workflow.js`: production bootstrap／embedded API
- `static/css/workflow-app.css`: production canvas layout

新規の主要実装は93、235、299、96、257行で、すべて300行以内である。

## Verification

- Python全体: 112件成功、2件skip
- AppShell／catalog／run／documents／WorkflowDesigner／store／production
  Playwright: 43件成功
- production load／save／run／close Playwright: 3件成功
- JavaScript `node --check`: 9対象成功
- UI analysis: node 2767、edge 3070、flow 435、state write 56、
  canvas redraw 11、layout recalc 24、高頻度render 19

UI analysisは未削除の旧fileも静的走査するため、旧`app.js`と旧canvasを
引き続きhotspotとして表示する。production resource testでは、それらを
読み込んでいないことを確認済みである。

## Deferred

- property form、data area、result preview／restoreのproduction接続
- `invalidated_step_ids`とbackend result cache無効化の実接続
- 旧canvas、旧`app.js`、旧stateと旧E2Eの物理削除／整理
- PySide hostを含む最終integration／security検証

## Next

Phase 9としてproperty form、data area、result／event表示をproduction
document sessionへ接続する。旧UI stateへのfallbackは作成しない。
