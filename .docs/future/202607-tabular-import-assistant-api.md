# 202607 TabularImportAssistant Public API

## 位置づけ

この文書は、Excel／CSV等の表形式file取込設定UIを別アプリでも再利用するための`TabularImportAssistant` public APIを定義する。

対象はfile解析libraryではなく、previewと取込範囲選択を行うUI libraryである。

## 構成

```text
利用app
  -> source provider
  -> preview provider
  -> schema adapter（任意）
  -> TabularImportAssistant
       -> Excel format adapter
       -> Delimited text format adapter
```

ExcelとCSVを別々の完全なlibraryにはしない。共通UIを1つのlibraryへ置き、形式固有controlだけをformat adapterへ分離する。

## 責務

### library core

- modal／panelとしてmountできる取込設定UI
- file表示名、preview table、loading／error／empty状態
- header行、data開始行の選択
- 縦横scrollと固定header
- format adapterのcontrol領域
- confirm／cancel／change event
- keyboard操作、focus管理、ARIA
- instance単位のstateとlifecycle

### Excel format adapter

- sheet選択control
- preview metadataからsheet候補を表示
- preview再取得に必要な`sheet_name` optionを生成

### Delimited text format adapter

- encoding選択control
- delimiter選択control
- preview再取得に必要な`encoding`／`delimiter` optionを生成

## 持たない責務

- Excel／CSV fileの実解析
- browser `FileReader`の直接利用
- file dialogの起動
- path／hidden ref／document sessionの管理
- QWebChannel／BridgeClient呼出し
- connector／action IDの解釈
- Zizai schema／`ziz_datatype`の生成
- app固有の保存、実行、security判定

純粋なWebアプリでbrowser fileを読む場合も、利用appがsource／preview providerとして実装する。

## 初期化

```js
import {
  createTabularImportAssistant,
  createExcelFormat,
  createDelimitedTextFormat
} from "@zizai/tabular-import-assistant";

const assistant = createTabularImportAssistant({
  root: document.querySelector("#import-assistant"),
  formats: [
    createExcelFormat(),
    createDelimitedTextFormat()
  ],
  requestSource: async (request) => appSourceProvider.pick(request),
  requestPreview: async (request) => appPreviewProvider.load(request),
  deriveSchema: async (request) => appSchemaAdapter.derive(request)
});
```

globalな`window.ExcelModal`、`window.CsvModal`、固定DOM IDはpublic APIにしない。

### Browser package

bundled local frontendでbundle toolを使わずclassic scriptとして読み込む場合は、内部moduleを順番に読み込んだ後、次のbrowser package namespaceから同じfactoryを取得する。

```js
const {
  createTabularImportAssistant,
  createExcelFormat,
  createDelimitedTextFormat
} = window.zizPackages.tabularImportAssistant;
```

これはfactoryのnamespaceであり、assistant instanceやapp固有callbackを`window`直下へ置くものではない。

## Source contract

sourceの実体は利用appだけが解釈するopaque valueとする。libraryはpathやtokenの内部構造を参照しない。

```js
{
  source: opaqueSource,
  display_name: "sales.xlsx",
  display_hint: "sales.xlsx"
}
```

`requestSource(request)`には次を渡す。

```js
{
  format_id: "excel",
  accept: [".xlsx", ".xlsm", ".xls"],
  current_source: opaqueSourceOrNull
}
```

cancel時は`null`を返す。

`open()`ではopaque valueと表示情報をstateのfieldとして渡す。

```js
assistant.open({
  format_id: "excel",
  source: opaqueSource,
  display_name: "sales.xlsx",
  display_hint: "sales.xlsx"
});
```

`setSource()`と`requestSource()`のresponseはSource contract全体を渡す。libraryは`source` field内のobjectについてproperty列挙やfield参照を行わず、そのままproviderとconfirm resultへ受け渡す。

## Preview contract

`requestPreview(request)`:

```js
{
  format_id: "excel",
  source: opaqueSource,
  options: {
    sheet_name: "Sheet1"
  },
  limit: {
    max_rows: 100
  }
}
```

response:

```js
{
  columns: ["A", "B"],
  rows: [
    ["顧客ID", "金額"],
    ["C001", 1000]
  ],
  base_row: 0,
  row_count: 2,
  truncated: false,
  metadata: {
    sheet_names: ["Sheet1", "Sheet2"],
    sheet_name: "Sheet1"
  }
}
```

- `rows`は2次元配列とする。
- `base_row`はpreview先頭行の0始まりsource offsetとする。
- `row_count`は取得可能な場合だけ全体件数を入れる。
- `metadata`はformat adapterだけが解釈し、library coreは保持と受渡しだけを行う。
- preview上限は利用appが指定し、libraryは受信済みpreviewを無制限に複製しない。

## Confirm contract

header行とdata開始行は、source file上の1始まり行番号で返す。

```js
{
  format_id: "excel",
  source: opaqueSource,
  display_name: "sales.xlsx",
  options: {
    sheet_name: "Sheet1"
  },
  selection: {
    header_row: 1,
    data_start_row: 2
  },
  schema: optionalSchema
}
```

`schema`は`deriveSchema` callbackが設定された場合だけ含める。library coreはZizai固有schemaを生成しない。

## Instance API

| API | 意味 |
| --- | --- |
| `open(state)` | 指定format／sourceで開く |
| `close(reason)` | UIを閉じる |
| `setSource(source)` | opaque sourceと表示情報を更新する |
| `setPreview(preview)` | providerを介さずpreviewを設定する |
| `setDisabled(disabled)` | 操作可否を更新する |
| `getState()` |公開stateのsnapshotを返す |
| `on(event, handler)` | eventを購読する |
| `destroy()` | listener、非同期処理、DOMを破棄する |

同じpageに複数instanceをmountできるようにし、stateとrequest sequenceを共有しない。

## Event

| event | payload |
| --- | --- |
| `source:request` | formatと現在source |
| `source:change` | 新しいsource |
| `preview:request` | sourceとformat options |
| `preview:change` | 正規化済みpreview |
| `selection:change` | header／data開始行 |
| `confirm` | Confirm contract |
| `cancel` | close reason |
| `error` | library内UI error。provider errorの内容はsanitized済みを受け取る |

callbackを直接指定する方法と`on()`は同じevent contractを使用する。

## State

- document stateを持たない。
- source、preview、format options、selection、open／loading状態だけをinstance stateとして持つ。
- provider requestにはsequenceを付け、古いresponseで新しいpreviewを上書きしない。
- close／destroy時に未完了requestを無視できるようにする。
- sourceの永続化は利用appの責務とする。

## Style

- CSS classはlibrary prefix配下に限定する。
- color、spacing、row heightはCSS custom propertyで変更可能にする。
- tableの列数や長い値でmodal全体のlayoutを押し広げず、preview領域内でscrollする。
- headerを固定し、表示行の追加でtoolbarやconfirm buttonを移動させない。
- libraryはAppShellに依存せず任意のrootへmountできる。

## Zizai adapter

Zizai appは次を担当する。

- `file.pickFile`を呼び、hidden refをopaque sourceとして保持する。
- `preview.readExcel`／`preview.readCsv`を呼んで共通Preview contractへ変換する。
- `doc_session_id`、step、fieldとの対応を管理する。
- Confirm contractをconnector formへ反映する。
- 202607入力schema（`origin_name`／`ziz_datatype`）生成を`deriveSchema` callbackとして提供する。

`TabularImportAssistant`はこれらのcommand名、hidden ref形式、connector form fieldを知らない。

### Zizai app command event

node detailはapp adapterの関数やinstanceを直接参照せず、次のeventで取込画面を要求する。

```js
window.dispatchEvent(new CustomEvent("zizai:tabular-import-request", {
  detail: {
    requestId,
    formatId: "excel",
    stepName,
    fieldKey,
    currentValue,
    hiddenBindings,
    handled: false
  }
}));
```

Zizai adapterは同期的に`handled = true`へ変更し、画面終了後に`zizai:tabular-import-response`を通知する。

```js
{
  requestId,
  status: "confirmed" | "cancelled" | "error",
  result: optionalConnectorFormResult,
  reason: optionalCancelReason,
  message: optionalErrorMessage
}
```

`hiddenBindings`はZizai document stateの参照であり、libraryには渡さない。request/response eventはapp内部IFであり、再利用libraryのpublic APIには含めない。

## 現行からの移行

1. `excel_modal.js`／`csv_modal.js`のtable描画、選択、lifecycleをlibrary coreへ移す。
2. sheet／encoding／delimiterをformat adapterへ移す。
3. bridge解決、file picker、preview command、hidden bindingをZizai adapterへ移す。
4. `dataflow.html`の固定modal DOMをlibraryのmount先へ置き換える。
5. `ui.node.shared.js`はglobal modalを直接loadせず、app command eventだけを通知する。
6. library／adapter切替後に`window.ExcelModal`／`window.CsvModal`経路を削除し、fallbackは残さない。

## 検証

- core unit: source／preview／selection／stale response／destroy
- format adapter unit: sheet、encoding、delimiter
- DOM test: scroll、fixed header、row selection、keyboard、focus
- contract test: opaque sourceをlibraryが解釈しない
- app integration: file picker／preview command／form反映
- reuse smoke: QWebChannelなしのmock providerでExcel／CSVの両形式を利用できる

## 凍結条件

- public APIとcallback contractが固定されている。
- QWebChannel、Zizai global、固定DOM IDへの依存がない。
- Excel／CSVで共通coreを使用し、table描画を重複実装していない。
- mock providerによる単独smoke testが通る。
