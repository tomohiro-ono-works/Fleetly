# Production Property and Result UI Implementation Report

## Result

Task 019を完了した。

production workflow document sessionへ、AppShell共有right sidebarの
property panelとembedded childの下部data areaを接続した。
property編集、save、run、result表示はTask 018の同じ
`WorkflowDocumentStore`を参照し、旧`state.nodes`へfallbackしない。

## Property

- STARTはflow label／開始変数、ENDはflow summaryを表示する。
- 通常stepはlabel／description／connector／action／catalog form fieldと
  step実行buttonを表示する。
- property変更はworkflow document commandを経由する。
- `ui.fields`とTabularImportAssistantを再利用し、取込schemaは
  `steps[].schema.columns`へ保存する。`params.schema`は作成しない。
- file pickerで得たhidden ref metadataはchild sessionへ明示的に同期する。

## Data Area

- `スキーマ定義`、`スキーマ定義（JSON）`、`データ出力`、`ログ`の
  4タブを実装した。
- data area policyをcatalogから取得し、input／output／transform／workflowの
  schema編集可否と保存項目を分ける。
- previewはbackendの上限付き先頭100行だけを表示し、table headerを固定する。
- logは最新500件を表示し、過去分は`before_seq` paginationで取得する。
- no result、error、invalidatedを区別し、invalidated時は再実行要求を表示する。

## Run and Restore

- `run.stepStatus`、`run.log`、terminal eventをchild sessionへ接続した。
- run start responseより先にterminal eventが届く場合も一時bufferして関連付ける。
- channel再初期化時は`app.getStatus.run_index`から最新flow runと
  各stepの最新step runを復元し、backend処理を再実行しない。
- flow resultとstep resultの関連付けを分離し、別stepの最新結果を失わない。

## Contract Additions

- `result.invalidateSteps`
  - `doc_session_id + step_ids`で表示cacheとraw contextを同時に無効化する。
- workflow run start response
  - step runの場合だけ`step_id`を返す。
- `app.getStatus.run_index.workflows[]`
  - step runの場合だけ`step_id`を返す。
  - 一部無効化済みrunは`invalidated_step_ids`を返す。

いずれも追加field／commandであり、既存fieldの意味は変更していない。

## Structure

- `static/js/workflow-app/property_context.js`
- `static/js/workflow-app/property_form.js`
- `static/js/workflow-app/property_panel.js`
- `static/js/workflow-app/data_area_*.js`
- `static/js/workflow-app/workflow_run_controller.js`
- `static/js/workflow-app/embedded_controller.js`
- `static/css/workflow-property-result.css`

共有`#rightSidebar`を非表示の旧hostから実際のworkspace AppShell layoutへ移し、
active childだけを表示対象にした。新規JavaScript moduleはすべて300行以内である。

## Verification

- Python全体: 116件成功、2件skip
- production／workspace／WorkflowDesigner／TabularImportAssistant
  Playwright: 37件成功
- data area旧E2Eをproduction契約へ移行: 4件成功
- JavaScript `node --check`: 成功
- desktop／mobile screenshot: overlap、横overflowなし
- UI analysis: node 3125、edge 3395、flow 492、state write 61、
  canvas redraw 11、layout recalc 26、高頻度render 20

新規resizerはdrag開始時だけlayout境界を取得し、pointermoveでは値が変化した
場合だけCSSを更新する。UI analysisは同じclosure内のpointerdown処理を
pointermoveから到達可能として表示するが、実コード上の高頻度layout再計算はない。

## Deferred

- workflow外のBigQuery／DuckDB／Python standalone UI
- Windows GUI host capabilityのproduction移行
- productionから外れた旧property／canvas／state／testの物理削除
- PySide hostを含む最終integration／security検証

## Next

Phase 10としてWindows GUI host capabilityをproduction経路へ移行する。
