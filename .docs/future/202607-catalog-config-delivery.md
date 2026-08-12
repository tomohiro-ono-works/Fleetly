# 202607 catalog/config 配信方式

## 位置づけ

この文書は、202607 版の connector/action catalog、form schema、data area policy、security policy summary の正本と配信方式を定義する。

現行の `static/config/config.js` は UI 直読みの大きな設定 file だが、202607 版では正本にしない。

## 結論

catalog/configは**定義fileを正本にし、backend catalog serviceが正規化してQWebChannel bridge commandで配信する**。

定義ファイルはYAMLとし、記法と読込cacheは`202607-yaml-style.md`を正本とする。

frontendは`static/config/config.js`を読まず、`catalog.*` commandから必要な分類を取得する。

CLIはWebView／QWebChannelを起動せず、GUI backendと同じcatalog loader／validatorで定義fileを直接読み込む。

```text
定義ファイル
  -> catalog loader / validator
    -> GUI: catalog service -> QWebChannel bridge -> frontend app adapter -> UI component
    -> CLI: runtime / core
```

## 採用理由

- frontend JS の読込範囲を減らせる。
- connector/action 分類を UI に重複実装しなくて済む。
- data area policy と security profile を backend 側で検証できる。
- `config.js` のような巨大 object を app 初期化時に丸ごと読む必要がなくなる。
- 将来、connector 追加時の影響範囲を catalog 定義と loader に限定できる。

## connector 固有ハードコーディングの方針

- engine、bridge dispatcher、application service、frontendの共通処理では、`connector_id`／`action_id`を直接比較する条件分岐を原則として作らない。
- connector / action ごとの差異は、可能な限り catalog metadata、共通 contract、connector class の実装で表現する。
- connector 固有処理は担当 connector class 内に閉じ、他 connector や共通処理へ分散させない。
- 共通 contract で表現できない処理だけを例外とし、暗黙の特別扱いは作らない。
- 例外を設ける場合は、対象の `connector_id` / `action_id`、例外が必要な理由、適用範囲を該当する設計文書に明記する。
- 例外には対象を固定した test を用意し、汎用処理として誤って拡張されないことを確認する。
- catalog取得のためにBigQuery等の重いconnector SDKをimport／初期化しない。catalogは静的metadataと軽量なregistryだけから構築する。

## 並列実行とresource競合

- 通常actionは並列実行可能とする。
- 202607版のcatalogには、同一resourceの汎用lockを実現するためのconcurrency metadataを設けない。
- schedulerはworker上限とDAGの依存関係だけを管理し、resource keyやconnector／action固有の排他条件を判定しない。
- 同一resourceへの競合をconnectorまたは外部システムがerrorとして返した場合は、通常のstep failureとして処理する。
- errorにならない上書きや操作干渉はbackendでは検知しない。
- `WindowsConnector.mouse_click`、`input_text`、`send_keys`等にも特別なlock、並列分岐validation、強制直列化を設けない。
- desktop操作の実行中は、利用者および他の自動化toolが対象desktopを操作しないことを利用条件とする。

## ワークフロー外の単体実行metadata

- action metadataに`standalone_allowed`を持たせ、省略時は`false`とする。
- `true`のactionだけを、`.zizd`を使わない②の`gui-standalone-run`から直接実行できる。
- 202607版の②はBigQuery、DuckDB、Python等を対象とし、正確な許可actionはcatalogで明示する。
- ②の対応actionは`preview`／`excel`等の利用可能なresult modeをmetadataで明示する。
- action metadataでdry runの対応有無と方式を明示し、省略時は非対応とする。frontendとbackendはconnector／action名を比較せず、このmetadataからdry run操作とvalidation経路を解決する。
- 202607版でdry runに対応するのはBigQuery SQLのnative dry run、DuckDB SQLの`EXPLAIN`／入力検証、Pythonの静的検証とし、Export actionは非対応にする。
- `excel` modeはworkflow stepを追加せず、単体実行resultのexport policyとして定義する。
- Export actionは通常Export開始時にsource DataFrame、params、schema、出力先を必須validationし、失敗時は書込み前にerrorにする。
- ②でもparams schema、security profile、concurrency policy、result contractを通常runと同じloaderで検証する。
- ②の許可判定をconnector／action名のハードコーディングで行わない。

## 分類とresult contract

connectorの分類は`data`／`workflow`、actionのsubcategoryは次を正本値とする。

| connector category | action subcategory |
| --- | --- |
| `data` | `input`、`transform`、`output` |
| `workflow` | `static`、`dynamic`、`control` |

全actionは分類とは別に`result_contract`を必須で持つ。共通engine／frontendはsubcategoryからresultを暗黙推測せず、正規化済みcontractを参照する。

```yaml
result_contract:
  kind: data_body | execution_metadata
  schema_id: optional_result_schema_id
  job_id_kind: none | bigquery_job_id | web_session_id
  exception_reason: optional_text
```

- `data_body`は取得結果または加工結果の本体を返す。
- `execution_metadata`は`job_id`、`target`、`path`、`executed_at`の4項目を返す。
- `schema_id`はaction固有の固定result schemaがある場合に指定する。実行時に決まるschemaでは省略できる。
- `job_id_kind`は`job_id`の意味を表し、Zizaiの`run_id`とは別物とする。
- 分類上の通常contractと異なるactionは`exception_reason`を必須にする。

### result contract matrix

| 分類 | 通常contract |
| --- | --- |
| data / input | `data_body` |
| data / transform | `data_body` |
| data / output | `execution_metadata` |
| workflow / static | `data_body` |
| workflow / dynamic | `execution_metadata` |
| workflow / control | `execution_metadata` |

### 明示するaction

| connector / action | contract | 補足 |
| --- | --- | --- |
| `WindowsConnector.search_files_by_name` | `data_body` + action固有schema | ファイル検索結果本体 |
| `WindowsConnector.search_text_in_files` | `data_body` + action固有schema | ファイル内検索結果本体 |
| `SeleniumConnector.dom_get` | `data_body` + action固有schema | schema内に`web_session_id`を持つ。共通`job_id`へ変換しない |
| `VectorConnector.search_vector_db` | `data_body` | data / inputの通常contract |
| `WindowsConnector.loop_tasks` | `data_body` | controlだがloop対象record本体を返す例外。`exception_reason`必須 |
| `WindowsConnector.define_values` | `execution_metadata` | `job_id_kind: none` |
| `WindowsConnector.wait` | `execution_metadata` | `job_id_kind: none` |
| `BQConnector.load_data` | `execution_metadata` | `job_id_kind: bigquery_job_id` |
| `SeleniumConnector.navigate` | `execution_metadata` | `job_id_kind: web_session_id` |
| `SeleniumConnector.dom_action` | `execution_metadata` | `job_id_kind: web_session_id` |
| `SeleniumConnector.wait` | `execution_metadata` | `job_id_kind: web_session_id` |
| `SeleniumConnector.screenshot` | `execution_metadata` | `job_id_kind: web_session_id` |

`loop_tasks`は202607版でも`WindowsConnector`のcontrol actionとしてcatalogに置くが、実行制御はbackendのloop controllerが担当する。catalogでは`node_type: loop`を明示し、backendはaction名の文字列比較でloopを判定しない。

## 非採用

| 方式 | 非採用理由 |
| --- | --- |
| frontend が `static/config/config.js` を直接読む | JS が重くなり、分類・policy が UI に混在する |
| 静的 JSON を frontend が直接読む | 検証、security profile 付与、connector 実体との整合確認が弱い |
| backend code に catalog を直書きする | connector 追加のたびに実装変更が大きくなる |

静的 JSON は生成物や cache としては許可できるが、正本にはしない。

## 正本ファイル構成案

```text
config/catalog/
  app_modes.yaml
  connectors.yaml
  actions.yaml
  result_contracts.yaml
  data_area_policy.yaml
  security_profiles.yaml
  forms/
    BQConnector.execute_sql.yaml
    CSVConnector.read_csv.yaml
    ExcelConnector.read_excel.yaml
```

配置は実装時に調整してよい。ただし、責務は分ける。

| ファイル | 責務 |
| --- | --- |
| `app_modes.yaml` | mode、初期 connector/action、表示対象 connector |
| `connectors.yaml` | connector id、label、icon、分類、export id |
| `actions.yaml` | action id、label、分類、form/schema/policy 参照 |
| `result_contracts.yaml` | result本体／共通実行metadata、schema、job id種別 |
| `forms/*.yaml` | property panel 用 field schema |
| `data_area_policy.yaml` | data area 表示 policy、出力メタデータ列 |
| `security_profiles.yaml` | action／bridge commandに紐づくsecurity profile |

## Bridge配信

QWebChannel commandは`202607-qwebchannel-bridge.md`と`qwebchannel/catalog-config.md`に従う。

| command | 返す内容 | 取得タイミング |
| --- | --- | --- |
| `catalog.getConnectors` | app mode + connector catalog | app起動時 |
| `catalog.getActions` | action catalog | app起動時 |
| `catalog.getForms` | 全actionのform schema | app起動時 |
| `catalog.getDataAreaPolicy` | data area policy | app起動時 |
| `catalog.getSecurityPolicySummary` | UI表示用security summary | app起動時 |

frontendはapp起動時に全form schemaを取得してmemory cacheへ保持し、action選択時に個別取得しない。将来、実測でcatalog sizeが問題になった場合だけ、互換性を保った追加経路として`form_schema_id`指定の個別取得を検討する。

`app_modes.yaml`の内容は専用commandを追加せず、`catalog.getConnectors` responseの`app_modes`として同じsnapshotから配信する。

## 正規化 loader の責務

backend catalog loaderは次を行う。

- YAML/JSON 定義を読み込む。
- connector id、action id、form schema id の参照整合を検証する。
- action に category、subcategory、data_area_policy_id、security_profile_id を必ず付与する。
- actionにresult_contract、node_typeを必ず付与し、result schema／job id種別／例外理由の整合を検証する。
- `schema.mode`は生成せず、schemaのinput／output／transform判定にはactionのsubcategoryを使う。
- UI 表示用 label/icon と実行用 id を分ける。
- secret/default 値が catalog response に混入していないか検査する。
- frontendへ返すobjectをbridge response schemaに正規化する。
- GUI app起動時に1回だけ読み込み、validation／正規化／ID索引作成済みのimmutableな`CatalogSnapshot`として保持する。
- dispatcher、service、connectorは定義fileを再読込せず、同じsnapshotを参照する。

## validation error時の扱い

- catalog validationはdevelopment／production、GUI／CLIのすべてで起動時必須とする。
- 不正なconnector/action/form/result contract参照を含むcatalogは部分的に採用しない。
- GUIはapp初期化を失敗扱いにし、catalog errorを表示してworkflow実行を開始しない。
- CLIはerror詳細を出力してnon-zero statusで終了し、flow実行を開始しない。
- 通常errorには定義file、field path、理由を含め、debug modeではvalidator detailも記録する。

## frontend の責務

frontend app layer は次だけを担当する。

- catalog commandをBridgeClient経由で呼ぶ。
- 取得結果を adapter state に保持する。
- UI component へ必要な slice だけ渡す。
- command profileの決定主体にならない。

frontend component は connector/action 分類、data area policy、security profile を自前で判断しない。

frontendはapp起動時にconnector/action/form schema/data area policyを全件取得してcacheし、画面操作ごとに再取得しない。

## 移行方針

1. `static/config/config.js` の内容を `app_modes`、`connectors`、`actions`、`forms`、`data_area_policy`、`security_profiles` に棚卸しする。
2. catalog loader の schema validation を先に作る。
3. `catalog.*` bridge commandを実装する。
4. frontend の config 参照を catalog adapter 経由に置き換える。
5. `static/config/config.js` を通常導線から外す。

旧compatibility layerは作らない。移行後はcatalog service + QWebChannel bridgeをGUIの正規経路にする。

## 次タスク

次は `AppShell public API` を定義する。
