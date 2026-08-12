# 009 202607 Catalog QWebChannel Commands

## Objective

`static/config/config.js`をfrontendの正本から外し、backend catalog定義、catalog service、QWebChannel bridge commandへ移行する。

frontendは共通`BridgeClient`からcatalogを起動時に取得し、memory cacheへ保持する。

## Scope

- 対象:
  - `config/catalog/`
  - `app/services/catalog_service.py`
  - bridge dispatcherのcatalog command登録
  - frontend catalog adapter
- 主な実装:
  - catalog定義file
  - loader／validator／normalizer
  - `catalog.*` command
  - frontend adapterの最小導入
- 対象外:
  - AppShell／WorkflowDesignerの本格切り出し
  - workspace／flow／run command
  - 旧`static/config/config.js`の削除完了

## References

- `.docs/future/202607-catalog-config-delivery.md`
- `.docs/future/qwebchannel/catalog-config.md`
- `.docs/future/202607-qwebchannel-contract.md`
- `.docs/future/202607-legacy-path-removal.md`
- `.codex-harness/reports/areas/202607/catalog-config-migration-breakdown.md`

## Required Files

```text
config/catalog/
  app_modes.yaml
  connectors.yaml
  actions.yaml
  data_area_policy.yaml
  security_profiles.yaml
  forms/
```

## Required Commands

- `catalog.getConnectors`
- `catalog.getActions`
- `catalog.getForms`
- `catalog.getDataAreaPolicy`
- `catalog.getSecurityPolicySummary`

## Implementation Tasks

1. 現行`static/config/config.js`のconnector、action、formをcatalog定義へ移す。
2. `rpaType`を正本にせず、`category`／`subcategory`を明示する。
3. connector／action分類は確定済み仕様に従い、個別hard codingの例外を明示する。
4. `data_area_policy.yaml`に出力結果metadata列とaction例外を定義する。
5. `executed_at`に統一し、`excuted_at`は使わない。
6. catalog loaderでconnector／action／form／policy／profileの参照整合を検証する。
7. form defaultにsecretが混入していないか検査する。
8. catalogをGUI app起動時に1回読み、immutable snapshotとして保持する。
9. dispatcherへrequired commandを登録し、正規化済みdataを共通response envelopeで返す。
10. frontendにcatalog adapterを作り、`BridgeClient`経由で起動時に1回取得する。
11. `window.CONFIG`／`window.zizPackages.core.CONFIG`の新規依存を増やさない。

## Acceptance Criteria

- catalog loaderが起動時にvalidationできる。
- actionとform schemaの対応漏れがない。
- catalog commandが共通response envelopeで返る。
- frontendが`BridgeClient`からconnector／action／form／policyを取得できる。
- UI側でconnector／action分類やdata area policyを重複判定しない。
- frontend componentが`backendBridge`を直接参照しない。
- 旧compatibility layerと二重正本を作らない。

## Verification

- unit:
  - catalog loader
  - reference validator
  - secret／default leak check
  - category／subcategory validation
- integration:
  - `catalog.getConnectors`
  - `catalog.getActions`
  - `catalog.getForms`
  - `catalog.getDataAreaPolicy`
  - `catalog.getSecurityPolicySummary`

## Notes

- `static/config/config.js`は移行中の参照元として残してよいが、202607版の正本にはしない。
- 最終的には通常導線から旧configを削除する。
- catalog taskはAppShell／WorkflowDesignerのapp adapter実装前に行う。
