# Connector Classification

## 位置づけ

この文書は、connector/actionの分類とresult contractを人向けに記録する。

202606実装の棚卸し元だった`static/config/config.js`は削除済みである。
202607版の機械可読な正本はbackendが読み込む`config/catalog/*`とし、
frontend／engineはこの文書を実行時の分類判定に使用しない。

対象は UI 定義上の実行コネクタであり、基底クラスの `BaseConnector` は分類対象に含めない。

## 分類軸

### コネクタ分類

| 分類 | 意味 |
| --- | --- |
| データフロー | データの入力、加工、出力を主目的にするコネクタ |
| ワークフロー | 画面操作、ファイル操作、外部実行、可視化出力、実行制御を主目的にするコネクタ |

### アクション分類

| 大分類 | サブカテゴリ | 意味 |
| --- | --- | --- |
| データフロー | 入力 | 外部データ、ファイル、DB、検索結果などを取得する |
| データフロー | 加工 | 入力データを変換、抽出、整形、フィルタする |
| データフロー | 出力 | ファイル、DB、テーブル、永続ストアへ書き出す |
| ワークフロー | 静的操作 | 検索、取得など、対象状態を大きく変えない操作 |
| ワークフロー | 動的操作 | 入力、選択、実行、ファイル作成、画面遷移、出力など、外部状態へ影響を与える操作 |
| ワークフロー | シナリオ制御 | 変数定義、ループ、待機、条件分岐など、実行順序や制御に関わる操作 |

## コネクタ一覧

| コネクタ | 表示名 | 分類 | 理由 |
| --- | --- | --- | --- |
| `BQConnector` | BigQuery | データフロー | BigQuery からの取得と BigQuery へのロードを担当する |
| `DuckConnector` | DuckDB | データフロー | DuckDB への入出力とテーブル作成を担当する |
| `ExcelConnector` | Excel | データフロー | Excel ファイルの読み書きを担当する |
| `CSVConnector` | CSV | データフロー | CSV/TSV/TXT の読み書きを担当する |
| `PythonConnector` | Python実行 | データフロー | Python スクリプトによるデータ加工を担当する |
| `DataintegrationConnector` | データ加工 | データフロー | フィールド名変更や行フィルタなどのデータ加工を担当する |
| `VectorConnector` | VectorDB | データフロー | ベクトル DB の構築と検索結果取得を担当する |
| `ShellConnector` | Shell | ワークフロー | 外部バッチ実行により環境へ影響を与える |
| `WindowsConnector` | Windows操作 | ワークフロー | Windows 上のファイル操作、入力操作、実行制御を担当する |
| `SeleniumConnector` | Selenium | ワークフロー | Web 画面の取得、操作、待機、スクリーンショットを担当する |
| `ChromeConnector` | Chrome | ワークフロー | Chrome を開く操作を担当する |
| `PlotlyConnector` | Plotly | ワークフロー | グラフ画像や HTML などの可視化成果物を出力する |

## アクション一覧

### データフロー

| コネクタ | アクション | 表示名 | サブカテゴリ |
| --- | --- | --- | --- |
| `BQConnector` | `execute_sql` | SQL実行 | 入力 |
| `BQConnector` | `execute_sql_file` | SQL実行（ファイル） | 入力 |
| `BQConnector` | `load_data` | データロード | 出力 |
| `DuckConnector` | `execute_sql` | SQL実行 | 入力 |
| `DuckConnector` | `execute_sql_file` | SQL実行（ファイル） | 入力 |
| `DuckConnector` | `create_db_file` | DBファイル作成 | 出力 |
| `DuckConnector` | `create_table` | テーブル作成 | 出力 |
| `CSVConnector` | `read_csv` | 読み込み | 入力 |
| `CSVConnector` | `write_csv` | 書き込み | 出力 |
| `ExcelConnector` | `read_excel` | 読み込み | 入力 |
| `ExcelConnector` | `read_excel_range` | エリア指定読み込み | 入力 |
| `ExcelConnector` | `write_excel` | 書き込み | 出力 |
| `PythonConnector` | `execute_python` | Python実行 | 加工 |
| `DataintegrationConnector` | `replace_fields_forrenamelist` | フィールド名をRENAMEリストから変更 | 加工 |
| `DataintegrationConnector` | `filter_rows` | 条件指定 | 加工 |
| `VectorConnector` | `search_vector_db` | ベクトル検索 | 入力 |
| `VectorConnector` | `embedding_vector_db` | ベクトルDB構築 | 出力 |

### ワークフロー

| コネクタ | アクション | 表示名 | サブカテゴリ |
| --- | --- | --- | --- |
| `ShellConnector` | `execute_bat` | バッチ実行 | 動的操作 |
| `WindowsConnector` | `search_files_by_name` | ファイル名検索 | 静的操作 |
| `WindowsConnector` | `search_text_in_files` | ファイル内の文字列検索 | 静的操作 |
| `WindowsConnector` | `rename_and_move_file` | ファイル名変更＆移動 | 動的操作 |
| `WindowsConnector` | `create_markdown_file` | マークダウンを作成 | 動的操作 |
| `WindowsConnector` | `mouse_click` | マウスクリック | 動的操作 |
| `WindowsConnector` | `input_text` | 文字列入力 | 動的操作 |
| `WindowsConnector` | `send_keys` | キー入力 | 動的操作 |
| `WindowsConnector` | `define_values` | 変数定義 | シナリオ制御 |
| `WindowsConnector` | `loop_tasks` | 繰り返し処理 | シナリオ制御 |
| `WindowsConnector` | `wait` | 待機 | シナリオ制御 |
| `SeleniumConnector` | `dom_get` | DOM取得 | 静的操作 |
| `SeleniumConnector` | `navigate` | ページを開く/遷移 | 動的操作 |
| `SeleniumConnector` | `dom_action` | DOM操作 | 動的操作 |
| `SeleniumConnector` | `screenshot` | スクリーンショット | 動的操作 |
| `SeleniumConnector` | `wait` | 待機 | シナリオ制御 |
| `ChromeConnector` | `open_in_chrome` | Chrome でページを開く | 動的操作 |
| `PlotlyConnector` | `plot_combined_bar_line` | 棒＋折れ線グラフ | 動的操作 |
| `PlotlyConnector` | `plot_stacked_bar` | 積み上げ棒グラフ | 動的操作 |
| `PlotlyConnector` | `plot_scorecard` | スコアカード | 動的操作 |
| `PlotlyConnector` | `plot_funnel` | ファネルチャート | 動的操作 |
| `PlotlyConnector` | `plot_radar` | レーダーチャート | 動的操作 |

## ワークフロー外単体実行

機械可読な許可判定は`config/catalog/actions.yaml`の
`standalone_allowed`／`standalone_result_modes`／`standalone_document`を正本とする。
`standalone_document`は対象`extensions`、`source_kind`、`source_param`を持ち、
frontendはconnector／action固有のsource分岐を持たない。

| Connector.action | document | source kind | source parameter |
| --- | --- | --- | --- |
| `BQConnector.execute_sql` | `.sql` | `editor_content` | `sql` |
| `BQConnector.execute_sql_file` | `.sql` | `saved_file` | `sql_file` |
| `DuckConnector.execute_sql` | `.sql` | `editor_content` | `sql` |
| `DuckConnector.execute_sql_file` | `.sql` | `saved_file` | `sql_file` |
| `DuckConnector.create_db_file` | `.sql` | `none` | なし |
| `PythonConnector.execute_python` | `.py` | `editor_content` | `script` |

DataFrame結果のExcel出力は`standalone_export_modes`に`excel`を持つ
`ExcelConnector.write_excel`を使用する。source actionとexport actionは
`run.start`の1回の単体実行として扱い、workflow step／edgeは生成しない。

## データエリア表示仕様

この節は、会話で定義した `データエリア` の表示仕様を記録する。

対象タブは次の 4 つとする。

- `データエリア > スキーマ定義`
- `データエリア > スキーマ定義（JSON）`
- `データエリア > データ出力`
- `データエリア > ログ`

### 共通仕様

- `データエリア > データ出力` は、ステップ実行後にバックエンド側の実行結果を表示する。
- `データエリア > データ出力` は、フロー画面で対象ステップが選択され、かつデータ出力が選択されているときに表示する。
- `データエリア > ログ` は共通表示とし、開始、終了、エラーメッセージを確認できる。
- `executed_at` は完了時刻を表す正式カラム名とする。
- `excuted_at` は typo のため使用しない。互換用の重複カラムも作らない。

### データフロー

#### 取得

`データエリア > スキーマ定義` では、インポートする対象データに対して、項目の選択と取り込み時のデータ型を設定できる。取り込み時の rename はできない。

`データエリア > スキーマ定義（JSON）` でも、項目の選択と取り込み時のデータ型を設定できる。インポートする対象データを指す。

`データエリア > データ出力` には、取得したデータ本体を表示する。

`データエリア > ログ` には、開始、終了、エラーメッセージを表示する。

#### 加工

`データエリア > スキーマ定義` では、加工後データのスキーマを表示する。閲覧はできるが、修正・更新はできない。コピペはできる。

`データエリア > スキーマ定義（JSON）` でも、加工後データのスキーマを表示する。閲覧はできるが、修正・更新はできない。コピペはできる。

`データエリア > データ出力` には、加工後のデータ本体を表示する。

`データエリア > ログ` には、開始、終了、エラーメッセージを表示する。

#### 出力

`データエリア > スキーマ定義` では、出力時の対象データに対して、項目の選択、出力時のデータ型、出力時の項目名を設定できる。

`データエリア > スキーマ定義（JSON）` でも、項目の選択、出力時のデータ型、出力時の項目名を設定できる。

`データエリア > データ出力` には、ログではなく出力結果メタデータを表示する。

`データエリア > ログ` には、開始、終了、エラーメッセージを表示する。

### データコネクタの出力結果メタデータ

データコネクタの出力アクションは、実行後の `データエリア > データ出力` に表示する結果として、次の 4 カラムを返す。

| カラム | 意味 |
| --- | --- |
| `job_id` | 外部ジョブ ID。該当しない場合は空文字 |
| `target` | 出力対象の論理名 |
| `path` | 出力先 URL またはファイル/DB パス |
| `executed_at` | 完了時刻。UTC ISO 形式 |

#### 対象アクション

| コネクタ | アクション | `job_id` | `target` | `path` |
| --- | --- | --- | --- | --- |
| `BQConnector` | `load_data` | BigQuery Job ID | `project.dataset.table` | BigQuery Console URL |
| `DuckConnector` | `create_db_file` | 空文字 | `db_file` | `db_file` |
| `DuckConnector` | `create_table` | 空文字 | `db_file/table_name` | `db_file` |
| `CSVConnector` | `write_csv` | 空文字 | `file_name` | 出力 CSV パス |
| `ExcelConnector` | `write_excel` | 空文字 | `sheet_name` | 出力 Excel パス |
| `VectorConnector` | `embedding_vector_db` | 空文字 | `collection_name` | `db_folder` |

この仕様はデータコネクタの出力アクションだけに適用する。`PlotlyConnector` はワークフロー側の成果物出力であり、このデータコネクタ仕様の対象外とする。

### ワークフロー

#### 静的操作

`データエリア > スキーマ定義` では、項目の選択、データ型、出力時の項目名を表示する。閲覧はできるが、修正・更新はできない。コピペはできる。

`データエリア > スキーマ定義（JSON）` でも、項目の選択、データ型、出力時の項目名を表示する。閲覧はできるが、修正・更新はできない。コピペはできる。

検索/取得系の静的操作では、`データエリア > データ出力` に取得結果本体を表示する。4 カラムの実行結果メタデータは不要とする。

`データエリア > ログ` には、開始、終了、エラーメッセージを表示する。

#### 動的操作

`データエリア > スキーマ定義` では、項目の選択、データ型、出力時の項目名を表示する。閲覧はできるが、修正・更新はできない。コピペはできる。

`データエリア > スキーマ定義（JSON）` でも、項目の選択、データ型、出力時の項目名を表示する。閲覧はできるが、修正・更新はできない。コピペはできる。

`データエリア > データ出力` には、実行結果メタデータを表示する。標準出力やエラー出力など、外部コマンドの出力結果本体は取得しない。

`データエリア > ログ` には、開始、終了、エラーメッセージを表示する。

#### シナリオ制御

シナリオ制御は、ループ、変数定義、条件分岐など、実行順序や制御に関わる操作を指す。

`データエリア > スキーマ定義` では、項目の選択、データ型、出力時の項目名を表示する。閲覧はできるが、修正・更新はできない。コピペはできる。

`データエリア > スキーマ定義（JSON）` でも、項目の選択、データ型、出力時の項目名を表示する。閲覧はできるが、修正・更新はできない。コピペはできる。

`データエリア > データ出力` には、実行結果メタデータを表示する。

`データエリア > ログ` には、開始、終了、エラーメッセージを表示する。

### ワークフローの取得結果本体

ワークフローの検索/取得系は、操作結果そのものが利用価値を持つため、`データエリア > データ出力` に取得結果本体を表示する。

この場合、`job_id`、`target`、`path`、`executed_at` の 4 カラムメタデータは表示しない。

対象アクションは次の通り。

| コネクタ | アクション | データ出力 |
| --- | --- | --- |
| `WindowsConnector` | `search_files_by_name` | ファイル検索結果本体 |
| `WindowsConnector` | `search_text_in_files` | ファイル内文字列検索結果本体 |
| `SeleniumConnector` | `dom_get` | DOM 取得結果本体 |

検索/取得系はアクション独自の既定スキーマを持つ。ユーザーが編集するための汎用 4 カラムメタデータには変換しない。

### ワークフローの実行結果メタデータ

ワークフローの動的操作、シナリオ制御、成果物出力では、`データエリア > データ出力` に次の 4 カラムの実行結果メタデータを表示する。

| カラム | 意味 |
| --- | --- |
| `job_id` | 外部ジョブ ID。該当しない場合は空文字 |
| `target` | 操作対象。例: URL、selector、ファイルパス、変数名、loop 対象、成果物名 |
| `path` | ファイル、URL、成果物パス。該当しない場合は空文字 |
| `executed_at` | 完了時刻。UTC ISO 形式 |

`ShellConnector.execute_bat` など外部コマンド実行系は、出力結果本体をデータとして取得しない。成功・失敗やエラーはログで扱い、`データエリア > データ出力` は実行結果メタデータのみとする。

#### Selenium のセッション ID

`SeleniumConnector` の動的操作、シナリオ制御、成果物出力では、実行結果メタデータの `job_id` に `web_session_id` を入れる。

内部の Selenium セッション連携は `context` と Selenium ランタイム管理で保持し、表示用 DataFrame の独自列には依存しない。過去出力や取得結果本体を参照する場合は、`web_session_id` または `job_id` からセッション ID を解決できるようにする。

#### シナリオ制御の例外

`WindowsConnector.loop_tasks` は例外として、ループ対象レコード本体を返す。これはループ制御の入力データそのものを後続処理で扱うためであり、4 カラムの実行結果メタデータへ変換しない。

`WindowsConnector.define_values` は例外にしない。内部では `context` を更新し、`データエリア > データ出力` には `job_id`、`target`、`path`、`executed_at` の実行結果メタデータを表示する。

## 外部 process の共通実行

connectorが終了を待つ外部processは`shared/process_runner.py`の`ProcessRunner`を使用する。process起動、stdout／stderrの分離取得、exit code、timeout、cancel、Windows process tree終了、encoding、cwd、environment、secret mask、出力量上限を共通責務とする。

- `PythonConnector.execute_python`: app同居venvの`sys.executable`に固定し、`main()`戻り値を加工結果、`print`を通常run log、exception／tracebackをerror詳細として扱う。
- `ShellConnector.execute_bat`: exit codeで成否を判定し、stdoutを通常run log、stderrをwarning／診断logとして扱う。
- `ChromeConnector.open_in_chrome`: detached起動後に終了を待たないため対象外。
- `SeleniumConnector`: WebDriver libraryがdriver／browser processを管理するため対象外。resourceはmanaged resource registryへ登録して終了境界で`quit()`する。
- `PlotlyConnector`: Plotly／Kaleidoがrendererを管理するため対象外。

command構築、Python wrapper、戻り値parse、action result contractはconnector側に残す。bridgeから`ProcessRunner`を直接呼ぶcommandは作らない。

`BQConnector`のGoogle ADC認証fallbackは、GUIのGoogle認証helperと同じ
`shared/google_cloud_cli.py`でWindowsの`gcloud.cmd`を解決する。
PowerShell aliasや拡張子なしの`gcloud`起動には依存しない。

## 未使用ロジック・整理対応結果

この節は、出力結果メタデータ統一後に確認した未使用ロジック、重複ロジック、整理結果を記録する。

### 削除済み・整理済み

| ファイル | 対象 | 理由 |
| --- | --- | --- |
| `connectors/selenium_connector.py` | `dom_action()` 冒頭の `runtime = context.get(self.RUNTIME_KEY)` | 変数を取得しているが後続で参照していない |
| `connectors/shell_connector.py` | `execute_bat()` の `result = subprocess.run(...)` | stdout/stderr をデータ出力しない仕様になったため、戻り値を保持する必要がない |
| `connectors/windows_connector.py` | `_complete_action(action=...)` の `action` 引数 | 実行結果メタデータは `target` / `path` 中心であり、`action` は使用していない |
| `static/js/ui.node.shared.js` | `isDataConnector()` | 現状は定義と export のみで、呼び出しが残っていない |
| `static/js/ui.fields.js` | `SCHEMA_NO_RENAME_ACTIONS` 内の `BQConnector.execute_sql_file` | 対象フォームに `schema` フィールドがないため、現状は効いていない |
| `static/js/ui.fields.js` | `SCHEMA_NO_RENAME_ACTIONS` 内の `VectorConnector.search_vector_db` | 対象フォームに `schema` フィールドがないため、現状は効いていない |
| `static/js/ui.fields.js` | `SCHEMA_READONLY_ACTIONS` 内の `PythonConnector.execute_python` | 対象フォームに `schema` フィールドがないため、現状は効いていない |
| `static/js/ui.fields.js` | `WORKFLOW_SCHEMA_READONLY_CONNECTORS` | 現状のワークフロー各フォームに `schema` フィールドがないため、現時点では効いていない |
| `connectors/bigquery_connector.py` | `_to_utc_iso()` | `BaseConnector._to_utc_iso()` と役割が重複している。BigQuery 固有実装を削り、共通 helper に寄せられる |
| `static/js/ui.node.detail.js` | `canShowResultPreviewForNode()` | connector が設定されているかだけを返す薄いラッパーになっている |
| `static/js/ui.node.detail.js` | `currentDataConnector` | 実態は「データコネクタか」ではなく「プレビュー表示可能か」を表すため、命名が仕様とずれている |
| `connectors/plotly_connector.py` | トップレベルの `plot_*` 関数群 | 現行 workflow 内部では直接使っていない。外部互換を残さない方針に合わせて削除する |

### 削除不可

| 対象 | 理由 |
| --- | --- |
| `BaseConnector.build_execution_metadata()` | データコネクタ出力、ワークフロー動的操作、シナリオ制御で共通利用している |
| `BaseConnector._schema_items_without_rename()` | 入力系 schema の rename 無効化で利用している |
| `allow_rename` | BigQuery、CSV、Excel、DuckDB の入力系 schema 制御で利用している |
| `ziz_define_values` | `WindowsConnector.define_values` の内部更新結果を `WorkflowEngine` が attrs から取得している |
| Selenium の `web_session_id` / `SESSION_ID_COLUMN` | `dom_get` の取得結果本体と既存参照結果から Selenium セッションを解決するために利用している |

## 補足

- `PlotlyConnector` は、データ処理ではなく可視化成果物の出力を主目的とするため、ワークフローに分類する。
- `PythonConnector` は、スクリプト実行の結果をデータフロー内の加工結果として扱うため、データフローに分類する。
- `WindowsConnector.loop_tasks` は UI 定義上は `WindowsConnector` 所属だが、実行時は `core/workflow_engine.py` のシナリオ制御として特別扱いされる。
