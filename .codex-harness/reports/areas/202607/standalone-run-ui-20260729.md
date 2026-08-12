# Task 023 workflow外単体実行UI

## 結果

productionの`.sql`／`.py` text documentから、catalogで許可されたactionを
`run.start`の`standalone` contractへ接続した。workflow plan、step、edge、
workflow result cacheは生成しない。

## 実装

- `config/catalog/actions.yaml`へ`standalone_document`を追加した。
- catalog loaderとfrontend adapterでsource bindingとexport modeを検証・配信する。
- `static/js/standalone-app/`へform、run lifecycle、result viewを分離した。
- workspace managerはtext tab lifecycleとdocument sourceの提供だけを担当する。
- 通常実行、dry run、cancel、Excel出力、active run中closeを接続した。
- result／画面logはdocument表示中だけ保持し、close時に破棄する。
- `run.failed` eventへsanitized `error` payloadを追加した。

## 検証

- production JavaScript構文確認: 成功
- `git diff --check`: 成功
- 新規CSSのcolor token確認: 成功
- Python unit test: 128件成功、2件skip
- Playwright Chromium: 93件成功
- 画面確認: 1440x960、900x640のWindows想定viewportで重なりなし

## 次

Task 024でPySide／QWebChannel実環境の起動、security、lifecycleを含む
Phase 12最終検証を固定する。
