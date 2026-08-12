# 202607 catalog / config Bridge Command Schema

## 対象

connector/action catalog、form schema、data area policy、security policy summary を扱う。

UI 側へ分類や data area policy を重複実装しないための境界である。

catalog/config の正本と配信方式は `../202607-catalog-config-delivery.md` を正本とする。

## command `catalog.getConnectors`

Response `data`:

```json
{
  "version": 3,
  "app_modes": [
    {
      "mode_id": "dataflow",
      "label": "データフロー",
      "default_flow_name": "データフロー１",
      "file_extension": ".zizd",
      "node_defaults": {
        "initial_connector_id": "WindowsConnector",
        "initial_action_id": "define_values"
      },
      "connector_ids": ["BQConnector", "DuckConnector"]
    }
  ],
  "connectors": [
    {
      "connector_id": "BQConnector",
      "label": "BigQuery",
      "export_id": "bigquery_connector",
      "category": "data",
      "icon": "./img/BQConnector.jpg",
      "actions": ["execute_sql", "execute_sql_file", "load_data"]
    }
  ]
}
```

## command `catalog.getActions`

Response `data`:

```json
{
  "actions": [
    {
      "action_id": "load_data",
      "connector_id": "BQConnector",
      "label": "データロード",
      "category": "data",
      "subcategory": "output",
      "node_type": "task",
      "form_schema_id": "BQConnector.load_data",
      "data_area_policy_id": "data.output",
      "security_profile_id": "connector.write",
      "result_contract": {
        "kind": "execution_metadata",
        "job_id_kind": "bigquery_job_id"
      }
    }
  ]
}
```

## command `catalog.getForms`

Response `data`:

```json
{
  "forms": [
    {
      "form_schema_id": "BQConnector.load_data",
      "fields": [
        {
          "key": "project_id",
          "label": "Project",
          "kind": "combo",
          "required": true
        }
      ]
    }
  ]
}
```

## command `catalog.getDataAreaPolicy`

Response `data`:

```json
{
  "policies": [
    {
      "data_area_policy_id": "data.output",
      "schema": "editable",
      "schema_json": "editable",
      "data_output": "execution_metadata",
      "log": "common"
    }
  ],
  "execution_metadata_columns": ["job_id", "target", "path", "executed_at"]
}
```

## command `catalog.getSecurityPolicySummary`

Response `data`:

```json
{
  "profiles": [
    {
      "security_profile_id": "connector.write",
      "risk": "write",
      "validation": "automatic",
      "requires_confirmation": false
    }
  ]
}
```

## 配信方式

定義ファイルを正本にし、backend catalog serviceが正規化してbridge command経由で配信する。

`security_profile_id` は backend の自動 validation に使用し、正規の GUI / CLI flow 実行で追加確認 dialog を表示するためには使用しない。

frontend は `static/config/config.js` を直接読まない。

`app_modes`は初期画面構築に必要だが専用commandを増やさず、`catalog.getConnectors`の同一snapshot情報として配信する。
