# 013 202607 TabularImportAssistant

## Objective

現行のExcel／CSV取込modalから共通UI責務を分離し、`202607-tabular-import-assistant-api.md`を正本とする再利用可能なinstance APIへ移行する。

Zizai固有のQWebChannel command、hidden ref、document session、connector form、schema生成はapp adapterへ残す。

## Scope

- 対象:
  - `static/js/tabular-import/`
  - `static/css/tabular-import-assistant.css`
  - `static/js/tabular-import.adapter.js`
  - `static/js/ui.node.shared.js`
  - `static/dataflow.html`
  - standalone fixture／Playwright test
- public API:
  - `createTabularImportAssistant(options)`
  - `createExcelFormat(options)`
  - `createDelimitedTextFormat(options)`
  - `open()`／`close()`／`setSource()`／`setPreview()`／`setDisabled()`／`getState()`／`on()`／`destroy()`
- 主な実装:
  - modal／panel共通UI、preview table、行選択、loading／error／empty状態
  - Excel sheet controlとDelimited encoding／delimiter control
  - provider request sequenceとclose／destroy後のresponse無視
  - Zizai adapterによるfile picker、preview command、hidden binding、schema変換
  - node detailからapp command eventを介した起動とform反映

## Out Of Scope

- Excel／CSV fileの実解析
- browser `FileReader`の直接利用
- connector／action catalogの再設計
- `.zizd` schema仕様の変更
- backend preview commandの改名
- WorkflowDesigner／AppShellの追加変更

## References

- `.docs/future/202607-tabular-import-assistant-api.md`
- `.docs/future/202607-frontend-library.md`
- `.docs/future/202607-frontend-app.md`
- `.docs/future/202607-implementation-sequence.md`

## Implementation Tasks

1. event、state、preview normalizer、DOM lifecycleを共通coreへ実装する。
2. sheet選択をExcel format adapterへ分離する。
3. encoding／delimiter選択をDelimited text format adapterへ分離する。
4. browser packageとして3つのfactoryを公開する。
5. QWebChannel commandとhidden refをZizai adapterへ実装する。
6. `ui.node.shared.js`をapp command event経由へ移す。
7. 固定modal DOMと旧global modal実装を削除する。
8. standalone fixtureとapp integration testを追加する。

## Acceptance Criteria

- public APIとprovider contractが正本に沿う。
- library内部にQWebChannel、BridgeClient、Zizai schema、path、hidden ref、connector form依存がない。
- Excel／CSVが同じcoreとtable rendererを利用する。
- 同一pageに複数instanceを独立して作成できる。
- stale preview response、close後、destroy後のresponseでstate／DOMが更新されない。
- preview tableは縦横scroll可能で、列headerと行番号列が固定される。
- keyboard、focus復元、ARIA dialog、confirm／cancelが機能する。
- `window.ExcelModal`／`window.CsvModal`と固定modal DOMが残らない。
- QWebChannelなしのmock providerでExcel／CSVを利用できる。

## Verification

- Playwright:
  - standalone Excel／Delimited source・preview・selection・confirm
  - format option変更とpreview再取得
  - stale response／close／destroy
  - 複数instance分離
  - keyboard／focus／scroll／sticky header
  - Zizai command payload／hidden binding／connector form反映
- static:
  - 旧global modal参照なし
  - library内のapp固有依存なし
  - JavaScript syntax check
  - `git diff --check`
