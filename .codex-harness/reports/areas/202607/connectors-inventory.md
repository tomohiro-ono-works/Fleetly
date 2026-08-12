# connector 詳細 現行実装棚卸し

## 対象

- connector 詳細
- connector/action 分類
- schema 動作
- 出力結果メタデータ
- 例外方針

## 調査範囲

- 必須確認:
  - `AGENTS.md`
  - `.codex-harness/subagents/README.md`
  - `.codex-harness/subagents/04-connectors.md`
- 指示書上の調査対象:
  - `connectors/*.py`
  - `static/config/config.js`
  - `core/workflow_engine.py`
  - `.docs/areas/connectors.md`
  - `.docs/areas/csv-connector.md`
  - `.docs/areas/excel-connector.md`
  - `.docs/areas/vector-connector.md`
  - `.docs/areas/windows-connector.md`
  - `.docs/future/202607-column-schema.md`
- 表示・保存経路確認のために追加で確認:
  - `static/js/app.js`
  - `static/js/ui.fields.js`
  - `static/js/ui.node.detail.js`
  - `static/modal/preview_schema.js`
  - `static/modal/csv_modal.js`
  - `static/modal/excel_modal.js`
  - `app/gui/bridge.py`

## 現行実装の事実

### connector/action 一覧

`static/config/config.js` では、次の 12 connector が UI 定義上の実行 connector として登録されている。

| connector | action |
| --- | --- |
| `BQConnector` | `execute_sql`, `execute_sql_file`, `load_data` |
| `DuckConnector` | `create_db_file`, `execute_sql_file`, `execute_sql`, `create_table` |
| `CSVConnector` | `read_csv`, `write_csv` |
| `ExcelConnector` | `read_excel`, `write_excel`, `read_excel_range` |
| `PlotlyConnector` | `plot_combined_bar_line`, `plot_stacked_bar`, `plot_scorecard`, `plot_funnel`, `plot_radar` |
| `WindowsConnector` | `define_values`, `loop_tasks`, `rename_and_move_file`, `search_files_by_name`, `search_text_in_files`, `create_markdown_file`, `mouse_click`, `input_text`, `send_keys`, `wait` |
| `DataintegrationConnector` | `replace_fields_forrenamelist`, `filter_rows` |
| `ShellConnector` | `execute_bat` |
| `VectorConnector` | `embedding_vector_db`, `search_vector_db` |
| `SeleniumConnector` | `navigate`, `dom_action`, `dom_get`, `wait`, `screenshot` |
| `ChromeConnector` | `open_in_chrome` |
| `PythonConnector` | `execute_python` |

`.docs/areas/connectors.md` では、`BQ` / `DuckDB` / `Excel` / `CSV` / `Python` / `Dataintegration` / `VectorDB` がデータフロー、`Shell` / `Windows` / `Selenium` / `Chrome` / `Plotly` がワークフローに分類されている。

一方、実装上の機械可読な分類は揃っていない。`static/config/config.js` には `rpaType: "Extract" | "Load" | "Transform"` が action ごとにあるが、data connector / workflow connector を全 connector に付与する属性はない。`category: "data"` は `DuckConnector` と `DataintegrationConnector` のみで、分類の完全な根拠にはならない。

`core/workflow_engine.py` は connector 分類では分岐していない。通常 action は `connector.execute(action, params, context)` へ委譲し、`loop_tasks` だけを connector 呼び出し前に特別扱いする。

### schema 使用箇所

現行の schema 実行入力は主に `steps[].params.schema` または `exportKey: "schema"` 経由の param であり、202607 方針の `steps[].schema` object ではない。

- `static/modal/preview_schema.js` は preview から `origin_name`, `new_name`, `description`, `ziz_datatype` の 4 項目を持つ配列を作る。
- `static/modal/csv_modal.js` と `static/modal/excel_modal.js` は、その配列を `JSON.stringify(..., null, 2)` した文字列としてフォームへ返す。
- `static/js/app.js` の export は、schema 系 field の `is_disabled` 行を除外した上で、JSON 配列文字列として `params` に入れる。
- `static/js/app.js` は `paramKey` / `exportKey` / `export_key` / `key` の順に param 名を決める。`BQConnector.load_data` の `schema_add_description` は `exportKey: "schema"` により `params.schema` になる。
- `BaseConnector.parse_schema_definition()` は JSON 配列文字列または配列を受ける。`{ mode, columns }` 形式は受けない。

schema 適用の共通処理は `BaseConnector.attach_dataframe_schema()` / `BaseConnector.apply_schema_to_dataframe()` にある。処理内容は、列存在チェック、列選択、型変換、必要なら rename、`dataframe.attrs["ziz_schema"]` の付与である。

入力系の `allow_rename` は次の通り。

| connector/action | backend の動作 | UI policy |
| --- | --- | --- |
| `BQConnector.execute_sql` | `attach_dataframe_schema(..., allow_rename=False)` | `SCHEMA_NO_RENAME_ACTIONS` 対象 |
| `BQConnector.execute_sql_file` | `execute_sql()` 経由で `allow_rename=False` | schema field がなく、UI policy には含まれない |
| `DuckConnector.execute_sql` | `allow_rename=False` | `SCHEMA_NO_RENAME_ACTIONS` 対象 |
| `DuckConnector.execute_sql_file` | `execute_sql()` 経由で `allow_rename=False` | `SCHEMA_NO_RENAME_ACTIONS` 対象 |
| `CSVConnector.read_csv` | schema の `origin_name` を `usecols` に使い、`allow_rename=False` | `SCHEMA_NO_RENAME_ACTIONS` 対象 |
| `ExcelConnector.read_excel` | `allow_rename=False` | `SCHEMA_NO_RENAME_ACTIONS` 対象 |
| `ExcelConnector.read_excel_range` | `allow_rename=False` | `SCHEMA_NO_RENAME_ACTIONS` 対象 |

出力系の schema は rename 可能な既定動作で使われている。

- `BQConnector.load_data` は schema があれば `apply_schema_to_dataframe()` を既定値 `allow_rename=True` で使い、BigQuery schema も生成する。
- `CSVConnector.write_csv` は schema があれば `apply_schema_to_dataframe()` を使って列選択・型変換・rename 後に出力する。
- `ExcelConnector.write_excel` も同様に schema 適用後に書き込む。
- `DuckConnector.create_table` は schema param を持たず、入力 DataFrame をそのまま DuckDB table に登録する。
- `DuckConnector.create_db_file` は UI form 上に `schema` field があるが、backend の `create_db_file()` は schema を受け取らず使用しない。
- `VectorConnector.embedding_vector_db` は schema param を持たず、`input_data` の `id_column` / `text_column` を直接参照する。

加工系の schema は action ごとに扱いが異なる。

- `DataintegrationConnector.replace_fields_forrenamelist` は rename list をもとに schema を作り、結果 DataFrame に `ziz_schema` を付ける。
- `DataintegrationConnector.filter_rows` は入力 DataFrame の `ziz_schema` を維持する。無ければ `attach_dataframe_schema()` で推論する。
- `PythonConnector.execute_python` は stdout 経由の main 戻り値を DataFrame/list/dict/scalar として返すが、connector 側で `ziz_schema` は付けない。

UI の schema policy は `static/js/ui.fields.js` にある。

- `SCHEMA_NO_RENAME_ACTIONS` は入力系 action の rename を UI 上で抑止する。
- `SCHEMA_READONLY_ACTIONS` は `DataintegrationConnector.replace_fields_forrenamelist` と `filter_rows` を read-only にする。
- rename 不可 policy では `new_name` を削除せず、`origin_name` と同じ値にそろえる。

### 出力結果メタデータ

4 カラムの実行結果メタデータは `BaseConnector.build_execution_metadata()` が生成する。

| カラム | 現行動作 |
| --- | --- |
| `job_id` | 未指定時は空文字 |
| `target` | 未指定時は空文字 |
| `path` | 未指定時は空文字 |
| `executed_at` | 未指定時は現在時刻の UTC ISO 文字列。`datetime` 指定時は UTC ISO に正規化 |

DataFrame 結果は `core/workflow_engine.py` で `report.steps[].result = None` とし、`ui_cache.preview` / `ui_cache.schema` / `ui_cache.row_count` に保存される。`app/gui/bridge.py` の `result.getSchema` / `result.getPreview` は、`result` が DataFrame でない場合でも `ui_cache` があればそれを返す。

データ connector 出力 action の現行メタデータは次の通り。

| connector/action | `job_id` | `target` | `path` |
| --- | --- | --- | --- |
| `BQConnector.load_data` | BigQuery job id | `project.dataset.table` | BigQuery Console URL |
| `DuckConnector.create_db_file` | 空文字 | 正規化済み DB ファイルパス | 正規化済み DB ファイルパス |
| `DuckConnector.create_table` | 空文字 | `正規化済み DB ファイルパス/table_name` | 正規化済み DB ファイルパス |
| `CSVConnector.write_csv` | 空文字 | 出力ファイル名 | 出力 CSV パス |
| `ExcelConnector.write_excel` | 空文字 | sheet 名 | 出力 Excel パス |
| `VectorConnector.embedding_vector_db` | 空文字 | collection 名 | db folder |

上記以外に、入力分類の SQL action でも表結果が無い場合にメタデータを返す実装がある。

- `BQConnector.execute_sql` は non-tabular statement かつ schema/results なしの場合、BigQuery job id / 推定 table / Console URL のメタデータを返す。
- `DuckConnector.execute_sql` は `cursor.description is None` の場合、DB ファイルパスを `target` / `path` にしたメタデータを返す。

ワークフロー connector の現行メタデータは次の通り。

| connector/action | 現行結果 |
| --- | --- |
| `ShellConnector.execute_bat` | 成功時は `target=path=file_path` のメタデータ |
| `ChromeConnector.open_in_chrome` | `target=path=url` のメタデータ |
| `PlotlyConnector.*` | `target=file_name`, `path=成果物ファイルパス` のメタデータ |
| `WindowsConnector.define_values` | `target=変数名のカンマ区切り`, `path=""` のメタデータ。attrs に `ziz_define_values` を持つ |
| `WindowsConnector.rename_and_move_file` | `target/path=移動後パス`。missing source を許可した場合は元パス |
| `WindowsConnector.create_markdown_file` | `target/path=作成ファイルパス` |
| `WindowsConnector.mouse_click` | `target=screen:(x, y)`, `path=""` |
| `WindowsConnector.input_text` / `send_keys` / `wait` | `target=active_window`, `path=""` |
| `SeleniumConnector.navigate` | `job_id=session_key`, `target/path=current_url` |
| `SeleniumConnector.dom_action` | `job_id=current_session_id`, `target=selector または operation`, `path=""` |
| `SeleniumConnector.wait` | `job_id=current_session_id`, `target=selector/value/until`, `path=""` |
| `SeleniumConnector.screenshot` | `job_id=current_session_id`, `target=page または element`, `path=保存先` |

検索/取得系の結果本体は DataFrame として返る。

- `WindowsConnector.search_files_by_name`: `folder_path`, `file_name`
- `WindowsConnector.search_text_in_files`: `folder_path`, `file_name`, `line_number`, `matched_line`, `context_excerpt`
- `SeleniumConnector.dom_get`: `selector`, `get_type`, `index`, `value`, `web_session_id`
- `VectorConnector.search_vector_db`: `id`, `text`, `score`, `metadata`, `collection_name`, 任意で `vector`

`SeleniumConnector` の session 解決は次の実装である。

- 動的操作のメタデータでは `job_id` に session key を入れる。
- `dom_get` の結果本体には `web_session_id` 列を含める。
- `source_step_id` がある場合、参照先の DataFrame に `web_session_id` があればそれを使い、なければ `job_id` を使う。
- `source_step_id` がない場合は `context` 内の Selenium runtime/session key を使う。

### `loop_tasks` と `define_values`

`WindowsConnector.define_values` は connector 側で 4 カラムメタデータを返し、同じ DataFrame の attrs に `ziz_define_values` を入れる。`WorkflowEngine._apply_define_values_result()` は attrs または DataFrame/list/dict から変数定義行を読み、`context` を更新する。表示側には 4 カラムメタデータの `ui_cache` が渡る。

`WindowsConnector.loop_tasks` は connector ではなく `WorkflowEngine._execute_step()` で処理される。`source_step_id` / `input_data` からレコード配列を作り、必要なら loop 子ステップを実行し、戻り値として `loop_records` の list を返す。list は DataFrame ではないため `WorkflowEngine` は `ui_cache` を作らない。`app/gui/bridge.py` の `result.getPreview` は DataFrame または `ui_cache` が無いとエラーにするため、現状のままでは `loop_tasks` のレコード本体はデータ出力テーブルとして表示できないと読める。

### stdout/stderr の扱い

- `ShellConnector.execute_bat` は `subprocess.run(..., capture_output=True)` で stdout/stderr を取得するが、成功時の DataFrame には入れずメタデータのみ返す。失敗時は `RuntimeError` メッセージに stdout/stderr を含める。
- `ChromeConnector.open_in_chrome` は `stdout=subprocess.DEVNULL`, `stderr=subprocess.DEVNULL` で破棄する。
- `PythonConnector.execute_python` は wrapper process の stdout を読み、`__ZIZ_RESULT__` marker の JSON を main 戻り値として解釈する。marker 以外の stdout 行は実行ログへ流す。stderr は `STDOUT` にマージされる。戻り値が list/dict/DataFrame 相当なら DataFrame 化されるが、scalar/文字列/None は表データではない。

### 例外方針

connector ごとの例外型は統一されていない。主に `ValueError`, `FileNotFoundError`, `ImportError`, `RuntimeError`, `OSError` などが使われる。

`WorkflowEngine._run_step_sequential()` / `_run_ready_queue()` は connector 例外を `Exception` として捕捉し、`str(e)` を `report.steps[].error` と `report.error` に入れてステップを error にする。例外分類や error code は付与しない。キャンセルは文字列 sentinel `__FLOW_CANCELLED__` で特別扱いする。

## 202607 方針との乖離

- 202607 方針は `steps[].schema: { mode, columns }` を正本にするが、現行実装は `steps[].params.schema` の JSON 配列文字列を中心に動く。`BaseConnector.parse_schema_definition()` も object 形式を受けない。
- 202607 方針では input schema は `origin_name` / `ziz_datatype` の 2 項目だけを保存するが、現行 preview/schema UI は `new_name` / `description` も作る。rename 不可 action でも `new_name` を削らず `origin_name` と同値にする。
- data connector / workflow connector の分類は `.docs/areas/connectors.md` にあるが、`static/config/config.js` や runtime に完全な分類 source はない。現行 runtime は分類に基づく制御をしていない。
- `BQConnector.execute_sql` と `DuckConnector.execute_sql` は入力分類だが、非表結果では 4 カラムメタデータを返す。202607 の「データコネクタ出力アクションだけが出力結果メタデータ対象」という整理と境界が曖昧。
- `WindowsConnector.loop_tasks` は方針上「ループ対象レコード本体を返す」例外だが、現行表示経路では list result から `ui_cache` が作られず、データ出力に表として表示できない可能性が高い。
- `ShellConnector.execute_bat` は stdout/stderr を結果本体として返さない方針に合うが、失敗時の error message には stdout/stderr を含める。ログ扱いとして許容するか確認が必要。
- `PythonConnector.execute_python` はデータフロー加工として main 戻り値を stdout transport で取得し、結果にする。外部コマンドの stdout を結果として取得しない方針の対象外とみなすか、Python だけの例外として明記が必要。
- `DuckConnector.create_db_file` の UI form には `schema` field があるが、backend は使用しない。
- Selenium は動的操作の session id を `job_id` に入れ、`dom_get` の結果本体には `web_session_id` 列を含める。方針と大きくは矛盾しないが、表示用 DataFrame の列を session 引き継ぎにも使う点は境界確認が必要。

## 相談事項

- schema の移行単位を確認したい。実行時 parser を先に `{ mode, columns }` 対応にするのか、保存/export/import/UI まで同時に切り替えるのかを分ける必要がある。
- data/workflow/action 分類の正本をどこに置くか確認したい。現状の `.docs/areas/connectors.md` を実装へ反映するなら、`static/config/config.js` に分類属性を追加するのが自然に見える。
- `execute_sql` 系の非表結果をどう扱うか確認したい。現行のまま「SQL は入力 action だが非表結果だけメタデータ」とするか、DDL/DML 系を出力/動的 action に分けるか判断が必要。
- `loop_tasks` のデータ出力表示をどうするか確認したい。202607 方針どおり本体表示するなら、`loop_records` を DataFrame/ui_cache 化する実装方針が必要。
- `PythonConnector.execute_python` の結果扱いを確認したい。main 戻り値はデータフロー加工結果として維持し、通常 stdout はログ扱いに限定する方針を明文化するのがよさそう。
- 失敗時 stdout/stderr を error message に含めることをログ扱いとして許容するか確認したい。秘密情報が出る可能性があるため、例外方針として扱いを決める余地がある。
- `DuckConnector.create_db_file` の schema field は未使用として削除候補にするか、将来使用予定として残すか確認したい。
- Selenium の `web_session_id` は `dom_get` 本体表示にも必要か確認したい。表示上不要なら hidden/meta に寄せる案もあるが、参照復元との兼ね合いがある。

## 参照ファイル

- `connectors/base_connector.py`
  - `build_execution_metadata()`
  - `attach_dataframe_schema()`
  - `apply_schema_to_dataframe()`
  - `parse_schema_definition()`
- `connectors/bigquery_connector.py`
  - `execute()`
  - `execute_sql()`
  - `load_data()`
  - `_build_table_update_result()`
  - `_resolve_schema_definition()`
- `connectors/duckdb_connector.py`
  - `create_db_file()`
  - `execute_sql()`
  - `execute_sql_file()`
  - `create_table()`
- `connectors/csv_connector.py`
  - `read_csv()`
  - `write_csv()`
  - `_resolve_usecols_from_schema_origin()`
- `connectors/excel_connector.py`
  - `read_excel()`
  - `read_excel_range()`
  - `write_excel()`
  - `_build_dataframe_from_worksheet_rows()`
- `connectors/dataintegration_connector.py`
  - `replace_fields_forrenamelist()`
  - `filter_rows()`
  - `_build_schema_after_rename()`
- `connectors/vector_connector.py`
  - `embedding_vector_db()`
  - `search_vector_db()`
- `connectors/windows_connector.py`
  - `define_values()`
  - `search_files_by_name()`
  - `search_text_in_files()`
  - `_complete_action()`
- `connectors/selenium_connector.py`
  - `navigate()`
  - `dom_action()`
  - `dom_get()`
  - `wait()`
  - `screenshot()`
  - `_resolve_source_session_key()`
  - `_current_session_id()`
- `connectors/shell_connector.py`
  - `execute_bat()`
- `connectors/python_connector.py`
  - `execute_python()`
  - `_parse_stdout()`
- `connectors/chrome_connector.py`
  - `open_in_chrome()`
- `connectors/plotly_connector.py`
  - `_build_plot_result()`
  - `plot_combined_bar_line()`
  - `plot_stacked_bar()`
  - `plot_scorecard()`
  - `plot_funnel()`
  - `plot_radar()`
- `core/workflow_engine.py`
  - `_execute_step()`
  - `_run_step_sequential()`
  - `_run_ready_queue()`
  - `_build_dataframe_ui_cache()`
  - `_apply_define_values_result()`
- `app/gui/bridge.py`
  - `_handle_result_get_schema()`
  - `_handle_result_get_preview()`
  - `_store_run_result()`
  - `_get_latest_step_payload()`
- `static/config/config.js`
  - `CONFIG.connectors`
  - `CONFIG.actions`
  - `CONFIG.forms`
- `static/js/app.js`
  - `getFormFieldParamKey()`
  - `sanitizeFieldValueForExport()`
  - export 時の `steps[].params` 生成処理
- `static/js/ui.fields.js`
  - `SCHEMA_NO_RENAME_ACTIONS`
  - `SCHEMA_READONLY_ACTIONS`
  - `normalizeSchemaItemsForPolicy()`
  - `syncSchemaAutoextractFromResult()`
  - `syncOutputPreview()`
- `static/js/ui.node.detail.js`
  - `refreshDataPanel()`
- `static/modal/preview_schema.js`
  - `buildPreviewSchema()`
- `.docs/areas/connectors.md`
- `.docs/areas/csv-connector.md`
- `.docs/areas/excel-connector.md`
- `.docs/areas/vector-connector.md`
- `.docs/areas/windows-connector.md`
- `.docs/future/202607-column-schema.md`

## 未確認事項

- `.zizd` import/export の全経路は `static/js/app.js` の export/import 周辺に限定して確認した。既存 `.zizd` サンプルを使った round-trip 実行は未確認。
- GUI 上での実表示は実行していない。`loop_tasks` が表示できない可能性は `WorkflowEngine` と `bridge` のコードからの推定である。
- BigQuery / Selenium / Chrome / Windows 画面操作 / Plotly 出力は実行していない。値の内容はコード上の戻り値確認である。
- connector 例外時の UI 表示文言は `WorkflowEngine` と `bridge` の処理まで確認したが、画面での最終表示は未確認。
- 202607 方針の最終確定は本レポートでは行っていない。判断が必要な内容は相談事項に残した。
