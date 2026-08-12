# 202607 Catalog QWebChannel Result

## 結果

`static/config/config.js`を通常起動経路から外し、`config/catalog/*`をconnector／action／form／data area／security metadataの正本にした。

## 実装

| 領域 | 成果物 |
| --- | --- |
| 定義 | `config/catalog/app_modes.yaml`、`connectors.yaml`、`actions.yaml`、`data_area_policy.yaml`、`security_profiles.yaml`、`forms/*.yaml` |
| backend | `app/services/catalog_service.py`、`catalog_loader.py`、`catalog_param_validator.py`、`catalog_types.py` |
| bridge | `catalog.getConnectors`、`getActions`、`getForms`、`getDataAreaPolicy`、`getSecurityPolicySummary` |
| frontend | `static/js/catalog.adapter.js` |
| test | `tests/python/test_catalog_service.py`、`tests/playwright/specs/catalog-adapter.spec.js` |

catalogは12 connector、39 action、39 form schemaを持つ。`rpaType`は移行せず、`category`／`subcategory`、`result_contract`、`data_area_policy_id`、`security_profile_id`を全actionへ明示した。

## Loader / validation

- GUI backend起動時にYAMLを1回読み、参照整合、category/subcategory、result contract、secret defaultを検証する。
- 正規化後はimmutable `CatalogSnapshot`として保持し、dispatcherとflow security validatorが同じsnapshotを参照する。
- `connector_id`と`.zizd`用`export_id`の両方からactionを解決する。
- formのrequired、unknown parameter、number／boolean／optionを実行前に検証する。
- CLIはWebViewを起動せず、command開始時に同じloaderでcatalogを検証する。

## Frontend

- `dataflow.html`は旧`config.js`を読み込まない。
- adapterはBridgeClientから5 commandを並行して1回だけ取得し、memory cacheとmode別sliceを構築する。
- `window.CONFIG`と`window.zizPackages.core.CONFIG`は使用しない。
- connector pickerはcatalogの`category`／`subcategory`、schema editorは`data_area_policy_id`を参照し、action ID hardcodeを削除した。
- `app_modes`はcommand数を増やさず、`catalog.getConnectors` responseへ同梱する。

## 202607差分

- `PythonConnector.execute_python`の`env_path` fieldは移行しない。202607仕様どおりapp同居venvに固定し、UIから任意環境を指定させない。
- `PlotlyConnector`はworkflow、`PythonConnector`と`VectorConnector`はdataとして定義した。
- `loop_tasks`はworkflow/controlだがdata bodyを返す例外理由をcatalogへ記録した。

## Verification

- catalog inventory: 12 connector / 39 action / 39 form、action-form対応漏れ0
- `tests/python`: 80 success、2 skipped、failed 0
- catalog/security/bridge focused tests: 34 success
- Playwright:
  - `catalog-adapter.spec.js`: success
  - `project-select.spec.js`: success
  - `tmp-save-smoke.spec.js`: success
  - `node-topbar-icon.spec.js`: success
- JavaScript `node --check`: success
- catalog YAML load実測: 約117-132ms、5 response合計約55KB、JSON serialize約0.6ms

## 追加で解消した不整合

前taskのCSPでworkspace内の同一origin flow iframeまで拒否していたため、`dataflow.html`だけ`frame-src 'self'`へ修正した。外部origin frameは許可していない。

## 残す旧file

`static/config/config.js`は移行比較用の参照として残すが、HTMLから読み込まず実行時正本にはしない。削除自体はlegacy removal taskで行う。
