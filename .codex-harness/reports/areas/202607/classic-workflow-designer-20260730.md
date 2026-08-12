# ClassicWorkflowDesigner 実施報告

## 結果

202606版のworkflow Canvasを基に、202607 canonical documentを直接扱う
独立UI library `ClassicWorkflowDesigner`を実装し、production GUIへ接続した。

## 責務範囲

- 対象は中央のworkflow Canvasだけである。
- AppShell、header、sidebar、property panel、data area、code editor、
  QWebChannel、backendはこのlibraryへ含めていない。
- 旧`state.nodes`、`parentId`、旧保存形式への変換は作成していない。
- document state、history、validation、ID発番、graph commandは既存app層を共有する。

## 主な成果物

- `static/js/classic-workflow-designer/`
- `static/css/classic-workflow-designer.css`
- `static/js/workflow-designer/designer_core_api.js`
- `static/js/workflow-designer.adapter.js`
- `tests/playwright/specs/classic-workflow-designer.spec.js`

## 確認結果

- production GUIでclassic factoryが選択される。
- node／edge／noteの選択、drag、接続要求、削除要求、複製、
  copy／paste、sticky note編集が共通公開契約で動作する。
- 複数flow、START／END、loop、unassigned、status、validationを描画する。
- desktop／compact viewportのCanvasが非blankで、toolbarが領域内に収まる。
- Playwright全98件成功。
- JavaScript構文確認成功。
- `git diff --check`成功。改行コードに関する既存warningだけを確認した。
- UI静的解析ではCanvas描画が`requestAnimationFrame`で集約されていることを確認した。
