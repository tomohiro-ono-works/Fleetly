# Task 023: workflow外単体実行UI

## 状態

完了

## 目的

`.zizd`を使用しないSQL／Python等のtext documentから、catalogで許可された
connector actionを`run.start`の`standalone` contractへ接続する。
workflow plan、step、edge、workflow result cacheは作成しない。

## 対象

- `.sql`／`.py` documentへ単体実行toolbarとparameter formを表示
- catalogによる対象拡張子、editor内容／保存済みfile pathのsource binding
- catalogの`standalone_allowed`、result mode、dry run、export定義だけを使用
- 同一documentでactive runを1件に制限し、実行中は再実行を無効化
- `Ctrl+Enter`の通常実行と`Ctrl+Shift+Enter`のdry run
- queued／running／completed／failed／cancelled表示とcancel
- `run.completed` eventだけを正本にしたpreview／text／metadata／Excel出力結果表示
- DataFrame previewの固定headerとscroll
- document表示中だけのresult／sanitized log保持
- active run中のclose確認、cancel完了後のdocument close

## Catalog IF

actionの`standalone_document`をfrontend source bindingの正本とする。

- `extensions`: actionを表示できるtext document拡張子
- `source_kind`: `editor_content`、`saved_file`、`none`
- `source_param`: sourceを設定するparameter key。`none`では指定しない

frontendはconnector ID／action IDによるsource分岐を持たない。
source field以外のparameterはactionのform schemaから描画する。
Excel出力actionも`standalone_export_modes`とform schemaから選択・描画する。

## UIルール

- SQL documentはcatalogに一致するconnector／actionを選択できる。
- Python documentはcatalogに一致するactionを使用する。
- `editor_content`は未保存の現在内容を実行できる。
- `saved_file`はdirty documentを拒否し、保存済みの実在fileを使用する。
- Excel出力はcheckboxで選択し、選択時だけExcel parameterを表示する。
- Exportではdry runを表示・実行しない。
- preview以外のraw resultはfrontendへ保持せず、previewもdocument closeで破棄する。
- list／dict等のtext resultはbackendが生成したJSON文字列をそのまま表示する。
- 完了順を理由に別documentの表示へ切り替えない。

## 責務境界

- `workspace.manager.js`: text tab lifecycle、document source provider、shell command委譲
- `standalone-app/`: catalog選択、form state、run lifecycle、event routing、result view
- `run.adapter.js`: QWebChannel commandの薄いadapter
- backend service／runtime: catalog validation、実行、worker、cancel、terminal event

## 対象外

- connector処理本体とdry run実装の変更
- workflow実行UI／result cache contractの変更
- standalone result API／event replayの追加
- CLI単体実行
- localhost server

## 完了条件

- `.sql`／`.py`のproduction text tabから通常実行と対応actionのdry runが開始できる。
- source bindingとparameter UIにconnector固有分岐がない。
- 同一document再実行、cancel、active run中closeが仕様どおり制御される。
- preview／text／metadata／Excel出力結果とrun logがdocument単位で表示される。
- document close後に表示用stateとbackend document runtime stateが破棄される。
- focused Playwright、JavaScript構文確認、Python testが成功する。

## 完了記録

- catalogに`standalone_document`を追加し、source bindingを機械可読化した。
- production text tabへparameter form、通常実行、dry run、cancel、Excel出力、
  result／log表示を接続した。
- active run中の編集・再実行・closeをdocument単位で制御した。
- `run.failed` eventへsanitized `error` payloadを追加した。
- production JavaScript構文確認、`git diff --check`、CSS token確認に成功した。
- Python unit testは128件成功、2件skip。
- Playwright Chromiumは93件成功。
- 1440x960と900x640のWindows想定viewportで重なりがないことを確認した。
