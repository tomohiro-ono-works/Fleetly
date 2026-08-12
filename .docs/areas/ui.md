# UI

## ワークフローデザイナー

- 202607のproduction GUIでは、202606版のCanvas描画と操作感を引き継ぐ
  `ClassicWorkflowDesigner`を使用する。
- `ClassicWorkflowDesigner`は独立した再利用可能UI libraryとし、
  202607の`.zizd`と同じparse済みdocumentをcontrolled inputとして直接扱う。
- 旧`state.nodes`、`parentId`、旧保存形式への変換は行わない。
- 現行`WorkflowDesigner`は別libraryとして残し、両者は同じ公開APIとevent契約を持つ。
- document state、ID発番、validation、history、graph commandはapp側の
  `WorkflowDocumentStore`／`WorkflowDocumentCommands`を共有し、view内へ複製しない。
- 202606版から引き継ぐ対象は、白いCanvas、コンパクトなicon node、
  step ID badge、滑らかなedge、Canvas hit test、node／noteのdrag、
  範囲選択、context command、sticky noteの表示と編集である。
- 複数flowのSTART／END、loop frame、unassigned graph、status、
  validation、connect操作は202607 document契約に合わせて表示する。
- catalog、property form、保存、実行、QWebChannelはapp adapterの責務とし、
  `ClassicWorkflowDesigner`へ含めない。

## アプリケーションウィンドウ

- WindowsのAppUserModelIDは、個人名を含まない固定値 `zizai.desktop` を使用する。
- フレームレスのGUIウィンドウの外周は、GUI host側で1pxの枠線を描画する。
- 枠線の色は左サイドバーの `--surface-sidebar` と同じ `#292941` を使用する。
- 枠線は表示専用とし、ポインターイベントを受けず、既存のウィンドウ操作・リサイズ領域を妨げない。
- ワークスペース内へ埋め込む画面（`embedded-mode`）には外周枠を描画しない。

## ワークフロー外単体実行

- `.sql`／`.py` text documentでは、catalogに対応するconnector／action、
  parameter、通常実行、dry run、cancel、Excel出力をdocument内toolbarへ表示する。
- `Ctrl+Enter`は通常実行、`Ctrl+Shift+Enter`はdry runとする。
- `editor_content` actionは未保存の現在内容を実行できる。
  `saved_file` actionはdirty documentを拒否し、保存済みの実在fileを使用する。
- 同じtext documentのactive runは1件までとし、実行中は再実行と編集を無効化する。
  異なるdocumentの単体実行、およびworkflow実行との同時実行は許可する。
- Excel出力はcheckboxで選択し、選択時だけcatalog由来の出力parameterを表示する。
  Exportのdry runは行わない。
- DataFrameは上限付きpreview、metadataは項目表、scalar／textは文字列、
  list／dictはbackendが生成したJSON文字列として表示する。表headerはscroll中も固定する。
- resultと画面logはQWebChannel eventで受信した範囲だけを表示し、document closeで破棄する。
  standaloneの完了resultをresult APIやevent replayから復元しない。
- active run中にdocumentを閉じる場合は、確認後にcancel完了を待ち、
  dirtyなら既存の保存確認を行ってから閉じる。

## スティッキーノート

- データフローキャンバス上で補足情報を残すためのメモ機能。
- メモは `notes` として保存し、各メモは位置、サイズ、本文、背景色を持つ。
- 色候補は`WorkflowDesigner`生成時の`noteColors` optionでapp adapterから渡す。
- 新規メモの背景色は`noteColors`の先頭値を使用し、未指定時は
  AppShellの`--surface-hover`を使用する。
- 色候補を変更しても、保存済みメモの `color` は自動変換しない。

## 右サイドノード詳細

- 右サイドのノード詳細フォームは、編集領域を優先し、白い入力ペインの内側余白を小さく保つ。
- フォーム行のラベル列は、右サイド幅に対して本文列を圧迫しすぎない比率にする。
- 通常stepは表示名、説明、connector、action、catalog form fieldと
  単一step実行buttonを表示する。
- STARTはflow名と開始変数、ENDはflow summaryを表示する。
- right sidebarはAppShellの共有領域とし、active documentの選択nodeだけを
  child frame公開APIから取得する。document正本はright sidebar側へ複製しない。

## データエリア

データエリアは、選択中ステップの schema、実行後データ、ログを確認するための下部表示領域とする。

詳細なコネクタ/アクション分類と出力仕様は `.docs/areas/connectors.md` を正本とし、UI 側では次の表示ルールを守る。

### タブ

データエリアは次の 4 タブを持つ。

- `スキーマ定義`
- `スキーマ定義（JSON）`
- `データ出力`
- `ログ`

### 表示タイミング

- `データ出力` は、ステップ実行後にバックエンド側の最新結果を表示する。
- `データ出力` は、フロー画面で対象ステップが選択され、かつデータ出力タブが選択されているときに表示する。
- `ログ` は共通表示とし、開始、終了、エラーメッセージを確認できる。
- node未選択時は下部data areaを閉じる。step選択時は前回選択していた
  タブを維持し、対象stepの表示内容だけを更新する。
- 設定変更でresultが無効になったstepは旧結果を表示せず、
  `設定変更のため再実行が必要です。`と表示する。
- logは画面上の最新500件を初期表示し、それ以前はpaginationで取得する。

### スキーマ表示と編集可否

| 対象 | スキーマ定義 | スキーマ定義（JSON） |
| --- | --- | --- |
| データフロー > 入力 | 項目選択と取り込み時のデータ型を設定できる。rename はできない | 同左 |
| データフロー > 加工 | 加工後 schema を表示する。閲覧とコピペのみ可能 | 同左 |
| データフロー > 出力 | 項目選択、出力時データ型、出力時項目名を設定できる | 同左 |
| ワークフロー | schema がある場合は表示する。閲覧とコピペのみ可能 | 同左 |

入力schemaは`origin_name`／`ziz_datatype`、出力schemaは
`origin_name`／`new_name`／`ziz_datatype`だけを保存する。
加工schemaはruntime結果をreadonly表示し、`.zizd`へ保存しない。
表previewのheaderとschema tableのheaderは領域内scroll中も固定する。

### データ出力

| 対象 | 表示内容 |
| --- | --- |
| データフロー > 入力 | 取得したデータ本体 |
| データフロー > 加工 | 加工後のデータ本体 |
| データフロー > 出力 | 出力結果メタデータ |
| ワークフロー > 検索/取得系 | 取得結果本体 |
| ワークフロー > 動的操作 | 実行結果メタデータ |
| ワークフロー > シナリオ制御 | 実行結果メタデータ。ただし `loop_tasks` はループ対象レコード本体 |

出力結果メタデータと実行結果メタデータは、次の 4 カラムを表示する。

| カラム | 意味 |
| --- | --- |
| `job_id` | 外部ジョブ ID。該当しない場合は空文字 |
| `target` | 出力対象または操作対象 |
| `path` | URL、ファイルパス、DB パス、成果物パス。該当しない場合は空文字 |
| `executed_at` | 完了時刻。UTC ISO 形式 |

`excuted_at` は typo のため UI でも使用しない。互換用の重複カラムも表示しない。

### ワークフロー例外

- `WindowsConnector.search_files_by_name` は、ファイル検索結果本体を表示する。
- `WindowsConnector.search_text_in_files` は、ファイル内文字列検索結果本体を表示する。
- `SeleniumConnector.dom_get` は、DOM 取得結果本体を表示する。
- `WindowsConnector.loop_tasks` は、ループ対象レコード本体を表示する。
- `WindowsConnector.define_values` は例外にせず、実行結果メタデータを表示する。
- `ShellConnector.execute_bat` など外部コマンド実行系は、stdout/stderr をデータ本体として表示しない。成功、失敗、エラー内容はログで扱う。
