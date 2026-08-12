# 202607 YAML 記法・読込仕様

## 位置づけ

この文書は、202607版の`.zizd`とcatalog定義ファイルに共通するYAML記法、parse境界、cache方針を定義する。

## 文字列

- 固定schemaのkeyはquoteしない。
- 文字列valueは原則としてsingle quoteで囲む。
- 動的IDをmapping keyにする場合もsingle quoteで囲む。
- empty stringは`''`とする。
- single quoteを文字列内に含める場合は`''`と2個重ねる。
- double quoteはescape sequenceが必要な場合だけ許可する。
- numberとbooleanはquoteせず、schema上の型どおりに記述する。

## multiline

- multiline stringは原則として`|-`を使い、改行を保持しつつ末尾改行を除去する。
- `>`／`>-`は改行をspaceへ変換するため使用しない。
- 末尾改行自体に意味があるfieldだけ`|`を許可する。

## collection

- 非emptyのarrayはYAML block sequenceで記述する。
- 非emptyのdictionaryはYAML block mappingで記述する。
- empty arrayは`[]`とする。
- empty dictionaryは保存field自体を省略し、`{}`は使用しない。省略可能なmappingのempty defaultはloaderのschemaで補う。
- array／dictionaryをJSON文字列へ変換して埋め込まない。
- 外部APIへ送るJSON本文など、値そのものがJSON textであるparameterだけを例外とする。

## indentation

- indentはhalf-width space 2個とする。
- tabは使用しない。

## parseとcache

- YAMLはloader境界で1回だけparseする。
- loaderはparse後にschema validation、参照整合validation、正規化、ID索引作成を行う。
- connector、engine、frontend componentはYAML fileを直接再読込・再parseしない。
- connector parameterのarray／dictionaryは、parse済みのnative `list`／`dict`として渡す。
- QWebChannel bridgeではparse済みobjectをJSONへserializeして返す。
- 1回とはprocess／document session単位であり、GUI processとCLI processのmemoryは共有しない。

### GUI

- catalogはGUI backend起動時に1回読み込み、immutableな`CatalogSnapshot`として保持する。
- `.zizd`はfileを開いた時に1回読み込み、validation済みのdocument snapshotからfrontend documentを構築する。
- frontendはcatalog bridge responseをapp起動時に取得してcacheし、画面操作ごとに再取得しない。

### CLI

- catalogと対象`.zizd`をcommand開始時にそれぞれ1回読み込み、そのcommandの終了まで同じsnapshotを使う。
- CLIはWebView／QWebChannelを起動しない。

### reload

- productionではfile変更監視による自動reloadを前提にしない。
- app再起動、file再読込、または明示的なreload操作でsnapshotを差し替える。
- 実行開始後は、そのrunが開始時に取得したsnapshotを完了まで固定して使う。

## 例

```yaml
connector_id: 'BQConnector'
action_id: 'load_data'
enabled: true
retry_count: 3
description: |-
  BigQueryへdataを出力する。
  完了後にjob IDを返す。
columns:
  - origin_name: 'customer_id'
    ziz_datatype: 'STRING'
options:
  labels:
    environment: 'production'
```
