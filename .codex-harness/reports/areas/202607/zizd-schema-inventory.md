# .zizd 保存形式 現行実装棚卸し

## 対象

- `.zizd` 保存形式
- schema 保存形式
- path / hidden 値
- flow graph

## 調査範囲

- 指示書で指定された次のファイルを確認した。
  - `AGENTS.md`
  - `.codex-harness/subagents/README.md`
  - `.codex-harness/subagents/01-zizd-schema.md`
  - `static/js/app.js`
  - `app/gui/bridge.py`
  - `static/modal/preview_schema.js`
  - `static/modal/csv_modal.js`
  - `static/modal/excel_modal.js`
  - `static/config/config.js`
  - `template/*.zizd`
  - `.docs/future/202607-zizd-format.md`
  - `.docs/future/202607-column-schema.md`
- schema editor / detail modal / runtime graph の事実確認に必要な範囲として、次も追加確認した。
  - `static/js/ui.fields.js`
  - `static/js/ui.node.shared.js`
  - `static/js/ui.node.detail.js`
  - `core/workflow_engine.py`
- 実装変更、`.docs/` 更新、仕様確定は行っていない。

## 現行実装の事実

### `.zizd` top-level key

- `static/js/app.js` の bridge 保存経路は `buildCompiledFlowPayload()` で次を出力する。
  - `metadata`
  - `variables`
  - `steps`
  - `flows`
  - `loop`（loop flow がある場合のみ）
  - `notes`
- bridge 非利用時のブラウザダウンロード経路は `metadata / variables / steps / flows / loop` を組み立てるが、`notes` は含めていない。
- `template/*.zizd` の実ファイルは `metadata / variables / steps / flows / notes` を持つ。
- top-level `schema` は現行テンプレートにも export 実装にも見当たらない。

### `metadata`

- `buildMetadataForMode()` は `name / mode / extension` を基本にする。
- `dataflow` では追加で `execution_model: df` と `category: etl` を保存する。
- import 時は `metadata` が必須で、`metadata.mode` が既知 mode でない場合はエラーにする。

### `variables`

- 保存時は `variables.start` に `{ name, value }` の配列を保存する。
- import 時は `variables.start` が配列でも辞書でも UI state の start parameter 配列へ正規化する。

### `steps`

- export は各 node から次を保存する。
  - 必須相当: `step_id`, `connector`, `action`, `params`, `output_variable`
  - 条件付き: `node_type`, `loop_owner_id`, `description`, `parallel_of`, `ui_position`
- `step_id` は UI state の `node.stepName` から作られる。
- `output_variable` の default は `step_id` と同じ値になる。
- `label` / `display_name` に相当する独立 field は現行 export されない。
- import は `step.step_id` を `node.stepName` に戻し、`step.params` だけを form に展開する。
- `steps[].schema` があっても、現行 import では form へ取り込む経路を確認できなかった。

### `steps[].params`

- `params` は `static/config/config.js` の form 定義を元に、`paramKey`、`exportKey`、`export_key`、`key` の順で保存 key を決める。
- 値が明示されていて空でなければ保存し、未指定でも field default がある場合は default を保存する。
- `schema_add_description` は `exportKey: "schema"` のため、`.zizd` では `params.schema` として保存される。
- form 定義にない既存 `params` は import 時に form へ残す処理がある。

### schema 保存形式

- 現行の正本保存位置は `steps[].params.schema`。
- 保存形式は JSON 配列を文字列化した値。
- `static/js/ui.fields.js` の schema editor は JSON array のみを parse 対象にする。
- `static/modal/preview_schema.js` の `buildPreviewSchema()` は各 column に次の4項目を生成する。
  - `origin_name`
  - `new_name`
  - `description`
  - `ziz_datatype`
- CSV / Excel preview modal は OK 時にこの配列を `JSON.stringify(..., null, 2)` して `schema` として返す。
- detail modal の `resultFieldMap` により、CSV / Excel の preview 結果は `node.form.schema` に保存される。
- export 時の `sanitizeFieldValueForExport()` は schema JSON 配列から `is_disabled` が真の行を除外してから JSON 文字列化する。
- `is_disabled` は UI 内部では保持されるが、`.zizd` export では保存対象外になる。

### schema editor の表示項目と保存項目

- schema editor には次の mode がある。
  - `スキーマ定義`
  - `スキーマ定義（JSON）`
  - `データ出力`
  - `ログ`
- form 表示の列は通常 `元フィールド名 / 新フィールド名 / データ型 / 操作`。
- field key が `schema_add_description` の場合だけ `説明` 列も表示する。
- 内部保存値は常に JSON 文字列で、正規化後の item は次を持つ。
  - `origin_name`
  - `new_name`
  - `description`
  - `ziz_datatype`
  - `is_disabled`
- 入力系として `SCHEMA_NO_RENAME_ACTIONS` に入っている `CSVConnector.read_csv`、`ExcelConnector.read_excel`、`ExcelConnector.read_excel_range` などは rename 不可になり、`new_name` は `origin_name` と同じ値に正規化される。
- rename 不可でも、保存される JSON item から `new_name` や `description` を落とす処理は確認できなかった。

### 出力 schema の保存項目

- `BQConnector.load_data` は `schema_add_description` を UI field とし、`.zizd` では `params.schema` に保存する。
- `CSVConnector.write_csv`、`ExcelConnector.write_excel` などは `schema` field を持つ。
- 出力系は `SCHEMA_NO_RENAME_ACTIONS` に含まれないため、schema editor 上で `new_name` を編集できる。
- 保存形式は入力系と同じく JSON 配列文字列で、`steps[].schema` object ではない。

### path / hidden 値

- UI の file / dir field は bridge 利用時、picker 結果として `{{hidden.<scope>.varN}}` を `node.form[field.key]` に入れる。
- hidden ref の scope は `step_name` を英数字 `_` に正規化したもの。
- hidden ref の実値は bridge の `_hidden_sessions[workspace_tab_id].values` に保存される。
- UI state の `hiddenBindings` は `display_name / display_hint` の metadata だけを持つ。
- `.zizd` 保存時と実行時は、bridge が `_restore_hidden_values()` で hidden ref を実値へ戻してから YAML 保存または runtime 実行へ渡す。
- そのため現行 bridge 保存の `.zizd` には hidden ref ではなく実 path が書かれる。
- `.zizd` load 時は bridge が `_hide_sensitive_values()` を通し、特定 key の値を hidden ref に置換して UI へ渡す。
- load 時に hidden 化される key は `file_path / folder_path / output_path / directory / output_folder / output_dir / bucket`。
- `static/config/config.js` には `db_file`、`sql_file`、`rename_list_path`、`source_file_path`、`destination_folder`、`root_folder`、`target_file_path` など、file / dir field だが上記 hidden key に含まれない key がある。
- 通常の file / dir field の text input は hidden ref 文字列をそのまま値として持つ。`getHiddenBindingMeta()` は定義されているが、表示値差し替え用途で使われている箇所は確認できなかった。
- CSV / Excel preview modal は `hiddenBindings[currentRef].display_hint` を使って表示上の path hint を出す。

### flow graph export / import

- export は `buildFlows()` が `flows.start: START`、`flows.end: END`、`flows.edges` を生成する。
- primary edge は parent-child 関係から作られ、`kind: primary` と `order` を持つ。
- merge edge は `mergeParentIds` から作られ、`kind: merge`、`order: 0` になる。
- 終端 node から `END` への edge は `order: 0` で追加されるが、`kind` は付かない。
- loop 内 edge はいったん `buildFlows()` の戻り値の `loop` に入り、`buildCompiledFlowPayload()` で top-level `loop` へ移される。
- 現行 export の loop flow path は top-level `loop.flows.<owner_step_id>.edges`。
- import は `data.loop.flows` と `data.flows.loop.flows` の両方を読み、同一 owner では top-level `data.loop.flows` を優先する。
- import は `flows.edges` がない場合にエラーにする。
- import は `flows.edges.to/from` が `steps` に存在しない場合にエラーにする。ただし `START` / `END` は特別扱い。
- import は incoming edge を `kind`、`order`、edge index で並べ、primary parent / merge parent / `parallelOrder` を復元する。
- `parallel_of` は export されるが、import の主要な復元根拠は edge 側であり、`parallel_of` を直接読む処理は確認できなかった。

### runtime の flow graph 取扱い

- `core/workflow_engine.py` は `flows.edges` がない、空、または有効 adjacency がない場合、`steps` 配列順の sequential runtime へ fallback する。
- `flows.edges` がある場合は `START` 到達可能 step を DAG として扱う。
- adjacency は `edge.order` と step id で sort され、visit rank / ready queue の順序に影響する。
- loop child は main DAG から除外され、`loop_tasks` 側で実行される。
- runtime も loop flow として `loop.flows` と `flows.loop.flows` の両方を読む。

## 202607 方針との乖離

- 202607 方針は schema を `steps[].schema.columns` の YAML 配列に置くが、現行実装は `steps[].params.schema` の JSON 文字列に置く。
- 202607 方針は schema を structured object とするが、現行 editor / modal / export は JSON 文字列を正本として扱う。
- 202607 方針は入力 schema を `origin_name / ziz_datatype` の2項目保存にするが、現行 preview / editor / export は入力系でも `new_name / description` を含む JSON item を保存し得る。
- 202607 方針は `schema.mode` で `input / transform / output` を分けるが、現行 `.zizd` には `schema.mode` がない。
- 202607 方針は Excel の `sheet_name / header_row / data_start_row / cell_range` を `params` に置く点では現行と概ね一致する。
- 202607 方針の例は `params.file_path: "{{hidden...}}"` のように hidden ref を `.zizd` に保存しているが、現行 bridge 保存は hidden ref を実 path に復元してから `.zizd` へ書く。
- path hidden 対象 key が picker 利用時と load 時で一致していない。file / dir picker では任意 key が hidden ref になるが、load 時に再 hidden 化されるのは固定 key のみ。
- 202607 方針は通常形式で `flows.edges` 必須だが、runtime は `flows.edges` なしを sequential fallback として実行できる。
- 202607 方針は loop flow の正本 path を1つに絞る方向だが、現行 UI / runtime は `loop.flows` と `flows.loop.flows` の両方を読む。
- 202607 方針は `edge.order` を branch 表示/優先順として扱うが、runtime では DAG traversal / ready queue の tie-breaker として実行スケジューリングにも影響する。
- 202607 方針は `step_id` と表示名の分離を示しているが、現行 UI は `node.stepName` を `step_id` と表示上の名前として兼用している。
- bridge 保存とブラウザダウンロード保存で top-level `notes` の有無が異なる。

## 相談事項

- 202607 形式では `.zizd` に hidden ref を保存するのか、現行どおり実 path を保存するのかを決める必要がある。
  - 推奨: `.zizd` に実 path を残さない方針なら、save/run の hidden 復元タイミングを分け、保存時は hidden ref 維持、実行時だけ復元にする。
- `steps[].schema` 導入時に、既存 `params.schema` をどう扱うか決める必要がある。
  - 推奨: import は旧 `params.schema` も読める互換を持ち、export は 202607 正本へ寄せる。
- 入力 schema から `new_name / description` を落とすタイミングを決める必要がある。
  - 推奨: export 直前ではなく editor state / form value の段階で mode 別正規化する。
- 出力 schema の必須項目と validation を UI 保存前に行うか、runtime 側で行うか決める必要がある。
  - 推奨: UI export 前に `new_name` 空文字と重複を検出し、runtime でも防御的に検証する。
- hidden 化対象 key を固定名で判定するか、`kind: file/dir` など config 由来で判定するか決める必要がある。
  - 推奨: load 時 hidden 化も form config を参照し、picker と同じ対象にそろえる。
- `loop.flows` と `flows.loop.flows` のどちらを 202607 正本にするか決める必要がある。
  - 推奨: top-level `loop.flows` を正本にし、旧 `flows.loop.flows` は import 互換だけにする。
- `edge.order` を runtime tie-breaker として使い続けるか、表示順だけに限定するか確認が必要。
  - 推奨: global 実行順ではないが、同時 ready edge の deterministic tie-breaker として使うなら仕様に明記する。
- `step_id` と表示名を分ける場合、既存 `stepName`、`description`、将来の `label` の移行ルールが必要。
  - 推奨: `step_id` は安定 ID、`label` は表示名、既存ファイルは `label` 未指定時に `description` または `step_id` fallback とする。
- bridge 非利用時の browser download 経路で `notes` を出すかどうかをそろえる必要がある。

## 参照ファイル

- `AGENTS.md`
- `.codex-harness/subagents/README.md`
- `.codex-harness/subagents/01-zizd-schema.md`
- `.docs/future/202607-zizd-format.md`
- `.docs/future/202607-column-schema.md`
- `static/js/app.js`
  - `parseYamlText`
  - `normalizeStartParameters`
  - `serializeStartParameters`
  - `buildStateFromYaml`
  - `sanitizeFieldValueForExport`
  - `buildExportSteps`
  - `buildMetadataForMode`
  - `buildFlows`
  - `buildCompiledFlowPayload`
  - `handleBridgeSave`
- `app/gui/bridge.py`
  - `_handle_flow_load`
  - `_handle_flow_save`
  - `_handle_flow_run`
  - `_handle_file_pick_file`
  - `_handle_file_pick_folder`
  - `_handle_preview_read_excel`
  - `_handle_preview_read_csv`
  - `_hide_sensitive_values`
  - `_restore_hidden_values`
  - `_store_hidden_value`
  - `_build_hidden_meta`
- `static/modal/preview_schema.js`
  - `buildPreviewSchema`
- `static/modal/csv_modal.js`
  - `applyBridgePreview`
  - `loadBridgePreview`
  - `pickBridgeFile`
  - OK result assembly
- `static/modal/excel_modal.js`
  - `applyBridgePreview`
  - `loadBridgePreview`
  - `pickBridgeFile`
  - OK result assembly
- `static/config/config.js`
  - `CONFIG.modes.dataflow`
  - `CONFIG.connectors`
  - `CONFIG.actions`
  - `CONFIG.forms`
- `static/js/ui.fields.js`
  - `parseSchemaText`
  - `normalizeSimpleSchemaItems`
  - `stringifySchemaItems`
  - `getSchemaEditorPolicy`
  - `normalizeSchemaItemsForPolicy`
  - `renderSchemaEditor`
  - file / dir field renderer
- `static/js/ui.node.shared.js`
  - `applyModalResultToNodeForm`
  - `openConfiguredDetailModal`
- `static/js/ui.node.detail.js`
  - schema field selection / bottom schema editor mount
- `core/workflow_engine.py`
  - `_build_execution_runtime`
  - `_index_loop_children`
- `template/ExcelからBigQueryテーブルを作る.zizd`
- `template/BigQueryの抽出結果をExcelに出力する.zizd`

## 未確認事項

- connector 実行時の schema 解釈は、この担当範囲では全 connector まで横断確認していない。
- GUI 表示はコード確認のみで、ブラウザ上の実表示確認はしていない。
- loop を含む実 `.zizd` サンプルは今回確認範囲では見つけていない。
- `steps[].schema` を含む 202607 形式ファイルを現行 UI に読み込ませた実動作確認はしていない。
- schema 旧形式から新形式への移行処理は未実装前提のため、変換仕様は確定していない。
