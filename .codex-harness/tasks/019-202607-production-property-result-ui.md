# Task 019: production property and result UI

## 状態

- 完了（2026-07-29）

## 目的

production workflow document sessionへ、右側property panelと下部data areaを
接続する。property編集、save、run、result表示がTask 018で固定した同じ
`WorkflowDocumentStore`を使用し、旧`state.nodes`へ戻らないようにする。

## 対象

- 通常step、START、ENDの右側詳細表示
- catalog form schemaを使うstep parameter編集
- connector／action／label／description／開始変数のdocument command接続
- TabularImportAssistantのproduction property経路
- 下部4タブ
  - `スキーマ定義`
  - `スキーマ定義（JSON）`
  - `データ出力`
  - `ログ`
- data area policyに基づくschema編集可否
- `run.stepStatus`、`run.log`、terminal eventとresult commandの接続
- 最新500件のlogと以前のlog pagination
- channel再初期化後のrun索引からの画面復旧
- property／edge／開始変数変更時のraw／表示cache無効化

## 契約補強

1. `result.invalidateSteps`を追加する。
   - payloadは`doc_session_id + step_ids`
   - document内で`step_id`は一意なため`flow_id`は不要
   - execution managerのlatest raw contextとresult cacheを同時に無効化する
2. workflowのrun start responseと`app.getStatus.run_index.workflows[]`へ
   step runの場合だけ`step_id`を追加する。
3. 上記は既存fieldの意味を変更しない追加field／commandとする。

## schema方針

- `data.input`: `origin_name`／`ziz_datatype`だけ保存し、rename不可
- `data.output`: `origin_name`／`new_name`／`ziz_datatype`だけ保存
- `data.transform`: runtime result schemaだけをreadonly表示し、保存しない
- workflow系: schemaがある場合だけreadonly表示する
- 取込対象外columnは画面上で無効表示し、保存対象から外す
- previewはbackendの上限付き先頭100行だけを表示する

## 対象外

- ワークフロー外SQL／Python等のstandalone実行UI
- 全件DataFrameのfrontend保持／再取得
- 旧property／data area／`app.js`等の物理削除
- BQ description専用actionの新規追加
- Windows以外のGUI対応

## 実装方針

1. property panelはchild frameの公開APIを介してcommandを発行する。
2. property draftは表示中だけ保持し、document正本を複製しない。
3. schema／preview／logの正本はbackend result cache／run log storeとする。
4. eventごとにcanvas、property、data areaを全再描画しない。
5. tab headerは固定し、preview table headerもscroll中に固定する。
6. app固有分類はcatalogのaction／data area policyから取得する。

## 完了条件

- node選択で右詳細と下部data areaが切り替わる。
- property変更がdocument commandを経由し、save／runへ同じ値が渡る。
- schema policyごとの保存項目とreadonly規則がtestで固定される。
- step成功後にschema／preview、実行中にlogを表示できる。
- invalidation後は旧resultへfallbackせず再実行要求を表示する。
- channel復旧時にbackendを再実行せず最新summary／result／logsを取得する。
- focused Python／PlaywrightとUI分析が成功する。

## 検証結果

- Python全体: 116件成功、2件skip
- production／workspace／WorkflowDesigner／TabularImportAssistant:
  Playwright 37件成功
- JavaScript構文確認: 成功
- desktop／mobile screenshot: overlap、横overflowなし
- UI analysis: 新規resizerはdrag開始時にlayout境界をcacheし、
  pointermoveでは値が変わった場合だけCSSを更新
