# TabularImportAssistant Implementation Report

## Result

Task 013を完了した。

Excel／CSVの個別modalを、共通`createTabularImportAssistant()` instance API、Excel／Delimited format adapter、Zizai app adapterへ分離した。旧`window.ExcelModal`／`window.CsvModal`、固定modal DOM、browser `FileReader`経路は撤去した。

## Library

`static/js/tabular-import/`へ次の責務を分割した。

- `tabular_import_assistant.js`: public instance API、open／close／destroy、focus管理
- `assistant_requests.js`: source／preview／schema request、sequence、stale response制御
- `assistant_view.js`: stateから各表示領域への反映
- `assistant_dom.js`: modal／panel DOM、preview table、行選択、keyboard操作
- `assistant_types.js`: Source／Preview／Selection contract正規化
- `format_excel.js`: sheet control
- `format_delimited.js`: encoding／delimiter control
- `assistant_events.js`: instance内event購読

全library JavaScript fileは300行以内とした。browser package factoryは`window.zizPackages.tabularImportAssistant`から取得する。

library内にQWebChannel、BridgeClient、path、hidden ref、document session、connector／action、Zizai schema生成は置いていない。opaque sourceはpropertyを参照せずproviderとconfirm resultへ受け渡す。

## App Adapter

- `static/js/tabular-import.adapter.js`が`file.pickFile`、`preview.readExcel`、`preview.readCsv`を呼ぶ。
- hidden ref、workspace tab、step／field、hidden binding metadataをapp adapterだけで管理する。
- preview responseを共通Preview contractへ変換する。
- 入力schemaは202607確定仕様どおり`origin_name`／`ziz_datatype`の2項目だけ生成する。
- connector formへは既存`resultFieldMap`に合わせて結果を返す。
- `ui.node.shared.js`は`zizai:tabular-import-request`／`response` eventだけを使用し、library instanceやadapter関数を直接参照しない。

## Migration

- `dataflow.html`の固定Excel／CSV modal DOMを削除した。
- `modal_core.js`、`excel_modal.js`、`csv_modal.js`、`preview_schema.js`、旧modal CSS／packageを削除した。
- CSV解析はbrowser側から撤去し、Excelと同じbackend preview provider経路へ統一した。
- fallbackは残していない。

## Verification

- JavaScript syntax check: 成功
- standalone library／app adapter／AppShell／catalog focused Playwright: 21件成功
- opaque source Proxy: property参照なし
- stale preview／close／destroy後response: state／DOM更新なし
- 複数instance、modal／panel、keyboard、focus復元: 成功
- Excel／CSV bridge payload、hidden binding、node form、2項目schema: 成功
- desktop 1440 x 960／mobile 390 x 844 screenshot確認: overlap／文字切れなし
- preview領域の縦横scroll、sticky列header／行番号列: 成功
- UI analysis再実行: 新規high-frequency render／canvas／layout hotspotなし
- tracked差分の`git diff --check`: errorなし

## Next

Task 014として`202607-workflow-designer-api.md`を正本に、現行workflow canvasとapp固有document／catalog／detail責務を分離する。
