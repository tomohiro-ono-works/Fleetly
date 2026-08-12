# 202607 catalog 移行タスク分解

## 位置づけ

この文書は、現行 `static/config/config.js` を 202607 版の backend catalog へ移すための作業分解である。

正本仕様は `.docs/future/202607-catalog-config-delivery.md` と `.docs/future/api/catalog-config.md` を参照する。

## 結論

`static/config/config.js` は frontend の正本から外し、backend 側の `config/catalog/*` を正本にする。

frontend は `CONFIG` を直接参照せず、localhost API の `/api/catalog/*` と catalog adapter 経由で使う。

旧互換 layer は作らない。

## 現行棚卸し

| 項目 | 現状 |
| --- | ---: |
| 対象ファイル | `static/config/config.js` |
| 行数 | 529 |
| connector 数 | 12 |
| action 数 | 39 |
| form schema 数 | 39 |
| action と form の対応漏れ | 0 |
| orphan form | 0 |

## 現行 `config.js` の中身

| 区分 | 現行位置 | 移行先 |
| --- | --- | --- |
| option 値 | `project_options`、`dataset_options`、`pyenv_options` など | `config/catalog/forms/*.yaml` または app 固有 option 定義 |
| mode 定義 | `CONFIG.modes` | `config/catalog/app_modes.yaml` |
| connector 定義 | `CONFIG.connectors` | `config/catalog/connectors.yaml` |
| action 定義 | `CONFIG.actions` | `config/catalog/actions.yaml` |
| form schema | `CONFIG.forms` | `config/catalog/forms/*.yaml` |
| schema 表示 policy | `ui.fields.js` の hardcode | `config/catalog/data_area_policy.yaml` |
| security profile | 現行なし | `config/catalog/security_profiles.yaml` |
| browser global 公開 | `window.CONFIG`、`window.zizPackages.core.CONFIG` | 廃止 |

## 現行参照箇所

| ファイル | 参照内容 | 移行方針 |
| --- | --- | --- |
| `static/js/app.js` | `CONFIG` 読込、mode filtering、exportId map、form schema、import/export | catalog adapter と mode service に分離 |
| `static/js/ui.node.shared.js` | connector/action picker、`rpaType` tab、connector icon、action label | catalog の connector/action view model を受け取る |
| `static/js/ui.node.detail.js` | form schema 取得、detail/data area 表示 | form schema と data area policy を props/API 経由にする |
| `static/js/ui.fields.js` | form field rendering、schema editor policy、preview/file picker/auth 連携 | field renderer は frontend library、policy は catalog から受け取る |
| `static/js/utils.js` | `getFormSchema(config, connector, action)` | catalog adapter の `getFormSchema(form_schema_id)` に置換 |
| `static/js/state.js` | `window.zizPackages.core.CONFIG` fallback、loop default | mode defaults と node template を catalog から受け取る |

## connector / action 分類の注意

現行の `rpaType` は新分類の正本にしない。

| 現行 | 問題 | 202607 方針 |
| --- | --- | --- |
| `Extract` | データ取得とワークフロー検索/取得が混ざる | catalog で `category` / `subcategory` を明示 |
| `Transform` | データ加工、動的操作、シナリオ制御が混ざる | catalog で明示 |
| `Load` | データ出力とワークフロー出力が混ざる | catalog で明示 |
| `PlotlyConnector` | 現行は dataflow mode に含まれる | ワークフロー側として定義する |
| `PythonConnector` | 現行 `Transform` 扱い | データフロー側として定義する |

## 分解タスク

### 1. catalog inventory 固定

現行 `config.js` の 12 connector、39 action、39 form を一覧化し、移行対象を固定する。

完了条件:

- action と form schema の対応表がある。
- connector ごとの action 数が固定されている。
- 移行しない項目があれば理由が記録されている。

### 2. `app_modes.yaml` 作成

移す内容:

- `dataflow` mode
- `defaultFlowName`
- `fileExtension`
- `nodeDefaults`
- mode ごとの connector 表示対象

注意:

- `PlotlyConnector` を現行の `dataflow.connectorIds` に残すかは、新分類と矛盾するため見直す。
- mode が増える前提で、frontend 側で mode ごとの `CONFIG` clone を作らない。

### 3. `connectors.yaml` 作成

移す内容:

- `connector_id`
- `label`
- `export_id`
- `icon`
- `category`
- `subcategory`

注意:

- 現行 `category` は一部 connector にしかないため使わない。
- `PlotlyConnector` はワークフロー側、`PythonConnector` はデータフロー側として明示する。
- icon path はそのまま移すか、asset id に正規化するかを実装時に決める。

### 4. `actions.yaml` 作成

移す内容:

- `action_id`
- `connector_id`
- `label`
- `category`
- `subcategory`
- `form_schema_id`
- `data_area_policy_id`
- `security_profile_id`
- `node_type`

注意:

- `rpaType` は UI tab 用の旧属性なので、正本にしない。
- `WindowsConnector.loop_tasks` はシナリオ制御の例外動作を明示する。
- `WindowsConnector.define_values` は例外にせず、通常の実行結果メタデータ対象として扱う。
- 検索/取得系は結果本体を独自取得するため、実行結果メタデータ不要の action として明示する。

### 5. `forms/*.yaml` 作成

移す内容:

- 39 個の form schema
- `kind`
- `required`
- `default`
- `options`
- `visible_if`
- `allowVars`
- `exportKey`
- `detailModal`
- `schema_autoload`

注意:

- backend は form 定義を検証、正規化、配信する。
- 実際の field rendering は frontend library の責務として残す。
- `google-auth-login`、`mouse-coordinate-picker`、`define-values-editor`、`filter-builder` などの特殊 `kind` は、frontend library 側の component registry と対応させる。

### 6. `data_area_policy.yaml` 作成

移す内容:

- データフロー: 取得、加工、出力
- ワークフロー: 静的操作、動的操作、シナリオ制御
- schema 表示可否
- schema rename 可否
- schema readonly 可否
- data output の扱い
- log の扱い
- 出力結果メタデータ列

出力結果メタデータ列:

| column | 内容 |
| --- | --- |
| `job_id` | 外部 job id。Selenium は `web_session_id` を入れる |
| `target` | 出力対象または操作対象 |
| `path` | BigQuery は URL、それ以外は file path |
| `executed_at` | 実行完了時刻 |

注意:

- `excuted_at` は使わず、`executed_at` に統一する。
- 現行 `ui.fields.js` の `SCHEMA_NO_RENAME_ACTIONS` と `SCHEMA_READONLY_ACTIONS` はここへ移す。
- 検索/取得系はメタデータではなく取得結果そのものを返す仕様として扱う。

### 7. `security_profiles.yaml` 作成

移す内容:

- read
- read_path
- write
- dangerous
- host
- event

注意:

- frontend が送る `security_profile_id` は信用しない。
- backend の catalog loader が action と security profile の整合を検証する。
- 危険 API は security policy と確認を通す。

### 8. backend catalog loader 実装

作るもの:

- catalog file loader
- schema validator
- reference validator
- normalizer
- secret/default leak check
- API response builder

検証する参照:

- connector id
- action id
- form schema id
- data area policy id
- security profile id
- mode connector ids

### 9. `/api/catalog/*` 実装

対象 API:

- `GET /api/catalog/connectors`
- `GET /api/catalog/actions`
- `GET /api/catalog/forms`
- `GET /api/catalog/data-area-policy`
- `GET /api/catalog/security-policy-summary`

注意:

- `forms` は初期は全件でもよいが、量が増えるため個別取得余地を残す。
- response は `.docs/future/api/catalog-config.md` に合わせる。

### 10. frontend catalog adapter 実装

作るもの:

- catalog API client
- catalog store
- connector/action selector 用 view model
- form schema resolver
- data area policy resolver
- icon resolver

置換するもの:

- `CONFIG.connectors`
- `CONFIG.actions`
- `CONFIG.forms`
- `CONFIG.modes`
- `getFormSchema(config, connector, action)`
- `window.zizPackages.core.CONFIG`

### 11. 旧 config 経路削除

削除対象:

- `window.CONFIG`
- `window.zizPackages.core.CONFIG`
- frontend の `static/config/config.js` 通常読込
- mode ごとの `CONFIG` clone
- `rpaType` 前提の分類ロジック
- `ui.fields.js` の schema policy hardcode

注意:

- 旧互換 layer は作らない。
- 移行中だけの一時 adapter を作る場合も、最終成果物には残さない。

## 実装順序

1. `config.js` から catalog 定義ファイルを生成せず、手で棚卸しして正本 YAML を作る。
2. backend loader/validator を作る。
3. `/api/catalog/*` を作る。
4. frontend catalog adapter を作る。
5. `app.js` の mode/config clone を撤去する。
6. `ui.node.shared.js` の connector/action picker を adapter 入力に変える。
7. `ui.node.detail.js` と `ui.fields.js` を data area policy / form schema 入力に変える。
8. `state.js` の CONFIG fallback を撤去する。
9. `static/config/config.js` を通常導線から外す。

## 不整合・注意点

- `PlotlyConnector` は現行 `dataflow.connectorIds` に含まれるが、202607 ではワークフロー側である。
- `PythonConnector.execute_python` は現行 `rpaType: Transform` だが、202607 ではデータフロー側である。
- 現行 `rpaType` だけでは「データフロー/ワークフロー」と「サブカテゴリ」を決められない。
- schema rename/readonly policy が config ではなく `ui.fields.js` に散っている。
- security profile が現行 config に存在しない。
- connector `category` は一部だけに設定されており、分類の正本として使えない。
- form schema に UI component 依存の `kind` が含まれるため、backend catalog と frontend field registry の境界を明確にする必要がある。
- `detailModal` は catalog に残すか、file preview / import helper API の別 policy に分けるか実装時に決める。

## 完了条件

- `static/config/config.js` を読まなくても app 起動に必要な catalog が API から取得できる。
- connector/action/form/data area/security の参照整合を backend 起動時に検証できる。
- frontend は分類や policy を自前で判定しない。
- `CONFIG` global なしで node 作成、action 選択、form 表示、flow import/export が動く。
