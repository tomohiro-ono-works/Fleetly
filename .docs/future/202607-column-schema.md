# 202607 column schema 仕様

## 位置づけ

この文書は、Excel、CSV、BigQuery、DuckDB などの tabular data connector で扱うカラム指定、型指定、rename、スキーマ読込の保存形式を定義する。

`.zizd` 上の保存形式は、文字列化した JSON ではなく YAML の辞書・配列形式を正本にする。

## 結論

カラム指定は `steps[].schema.columns` に YAML の配列として保存する。

`columns` は JSON 文字列や flow style の配列ではなく、YAML の block sequence と mapping で記述する。

保存するカラムは、ユーザーが選択したカラムだけにする。

未選択カラムは `.zizd` に保存しない。

`include: false` のような非選択カラム保存機能は作らない。

未選択カラムを復活させたい場合は、スキーマ読込で入力元から再取得し、再選択する。

入力系 schema は、現行の画面表示に合わせて `origin_name` と `ziz_datatype` の 2 項目だけを保存する。

## 保存形式

```yaml
steps:
  - step_id: '01'
    flow_id: '01'
    label: '顧客Excel読込'
    connector: 'excel_connector'
    action: 'read_excel'
    params:
      file_path: 'C:\data\customers.xlsx'
      sheet_name: '顧客'
      header_row: 1
      data_start_row: 2
    schema:
      columns:
        - origin_name: '顧客ID'
          ziz_datatype: 'STRING'
        - origin_name: '氏名'
          ziz_datatype: 'STRING'
```

## `schema` object

| field | 必須 | 内容 |
| --- | --- | --- |
| `columns` | 必須 | 選択済みカラムの配列 |

## `columns[]` object

| field | input | output | 内容 |
| --- | --- | --- | --- |
| `origin_name` | 必須 | 必須 | 入力元または直前データのカラム名 |
| `new_name` | 保存しない | 必須 | 出力時のカラム名 |
| `description` | 保存しない | 保存しない | schema の保存項目にしない |
| `ziz_datatype` | 必須 | 必須 | Zizai 標準データ型 |

## action 分類別ルール

| catalog 上の action 分類 | 対象 | カラム選択 | 型指定 | rename |
| --- | --- | --- | --- | --- |
| `input` | Excel / CSV / BigQuery など入力アクション | できる | できる | できない |
| `output` | Excel / CSV / BigQuery など出力アクション | できる | できる | できる |

`schema.mode` は `.zizd` に保存しない。input／output／transform の判定は、connector/action catalog の正規化済み metadata を正本にする。

入力系では `new_name` と `description` は保存しない。

出力系では `new_name` を出力時のカラム名として使う。

`description` は input／output のどちらでも `schema.columns` に保存しない。BigQuery の column description を設定する場合は、schema 保存項目ではなく専用 action として別途定義する。

加工系では `steps[].schema` 自体を `.zizd` に保存しない。実行後の schema／preview は runtime の data area cache としてだけ保持する。

## Excel 固有項目

Excel 固有の読込位置やシート指定は `schema` ではなく `params` に保存する。

```yaml
params:
  file_path: 'C:\data\customers.xlsx'
  sheet_name: 顧客
  header_row: 1
  data_start_row: 2
  cell_range: A1:F100
```

`sheet_name`、`header_row`、`data_start_row`、`cell_range` は、カラム定義ではなくデータ取得条件として扱う。

Excel の `A`、`B`、`C` のような列記号や列 index は preview / schema 読込の一時情報であり、`.zizd` の schema 正本にはしない。

## スキーマ読込

スキーマ読込は、入力元ファイル、テーブル、SQL 結果、直前 step result から現在取得できるカラム候補を読み直す操作である。

スキーマ読込結果は即保存しない。UI 上の候補として表示し、ユーザーが選択したカラムだけを `steps[].schema.columns` に保存する。

現在の候補から取込対象外にしたカラムは UI 上で gray out し、保存対象から除外する。

未選択カラムを後から復活させる場合も、スキーマ読込で再取得して選択し直す。

## 旧形式からの変更

| 旧形式 / 現行実装 | 202607 方針 |
| --- | --- |
| `params.schema` に JSON 文字列として保存 | `steps[].schema.columns` に YAML 配列として保存 |
| schema editor が JSON 文字列を編集 | UI は structured schema object を編集 |
| 入力/出力/加工の schema ルールが混在 | catalog の action 分類で分け、`schema.mode` は保存しない |
| 入力 schema は通常 UI 経由で `origin_name` / `new_name` / `description` / `ziz_datatype` の 4 項目を保存 | 入力 schema は表示に合わせて `origin_name` / `ziz_datatype` の 2 項目だけ保存 |
| 未選択カラムの扱いが曖昧 | 未選択カラムは保存しない |
| `include: false` などで全列保存する余地 | 作らない |

旧 `steps[].params.schema` の読込互換と自動変換は作らない。loader が検出した場合は、非対応の旧形式として validation error にする。

## 現行実装の確認結果

| 項目 | 現行 |
| --- | --- |
| ファイル形式 | `.zizd` は YAML |
| schema 保存位置 | `steps[].params.schema` |
| schema 保存形式 | JSON 配列文字列 |
| プレビュー読込 | `origin_name` / `new_name` / `description` / `ziz_datatype` を生成 |
| 通常表示 | 入力系では主に `origin_name` / `ziz_datatype` を表示 |
| 入力実行 | CSV/Excel/BigQuery/DuckDB の入力系は `allow_rename=False` で rename しない |
| 入力列選択 | CSV/Excel は `origin_name` を usecols として使う |
| 出力実行 | 出力系は schema による列選択、型変換、rename を使う |

## validation 方針

- `schema.columns` は配列でなければならない。
- `schema.columns` には選択済みカラムだけを入れる。
- `origin_name` は空文字不可。
- `ziz_datatype` は Zizai 標準データ型に正規化する。
- catalog 上の input action では、`new_name` と `description` を保存しない。
- catalog 上の output action では、`new_name` は空文字不可とし、重複を禁止する。
- catalog 上の output action でも、`description` は保存しない。
- 加工 action に `steps[].schema` を保存しない。加工結果の schema は runtime cache として検証・表示する。
- 旧 `steps[].params.schema` は受け付けない。

## `ziz_datatype`正規表記

`ziz_datatype`は`core/type_registry.py`のZizai標準型を正本とし、`.zizd`、bridge、runtime cacheのすべてで型tokenを大文字に正規化する。

- scalar型は`INT64`、`FLOAT64`、`NUMERIC`、`STRING`、`BYTES`、`DATE`、`DATETIME`、`TIMESTAMP`、`TIME`、`INTERVAL`、`BOOL`とする。
- container型は`ARRAY`、`STRUCT`とし、具体型を持つ場合は`ARRAY<STRING>`、`STRUCT<id:INT64,name:STRING>`のように再帰的に記述する。
- container名と内部の型tokenは大文字、STRUCTのfield名は元の大文字／小文字を維持する。
- 入力時は型tokenの大文字／小文字差を許容して正規化するが、`INTEGER`、`BOOLEAN`等の別名は保存せず、`INT64`、`BOOL`へ正規化できない値はvalidation errorにする。
- GUIの型選択肢は正規表記を返し、`.zizd`保存時とbridge response生成時にも正規表記を再検証する。
- bareの`ARRAY`／`STRUCT`は要素型／field型が不明なruntime schemaで使用できる。具体型を要求する出力actionでは実行前validation errorにする。

## 確定事項

- schema は JSON 文字列ではなく YAML の辞書・配列形式で保存する。
- `schema.mode` は保存せず、schema の用途は catalog の action 分類から判定する。
- 保存対象は選択カラムのみとする。
- 未選択カラムは保存しない。
- `include: false` は作らない。
- カラム復活はスキーマ読込で再取得してから再選択する。
- 入力系は rename 不可、出力系は rename 可とする。
- 入力系は `origin_name` と `ziz_datatype` だけを保存する。
- 出力系は `origin_name`、`new_name`、`ziz_datatype` の 3 項目だけを保存する。
- 加工系 schema は `.zizd` に保存しない。
- 旧 `params.schema` の読込互換は作らない。
