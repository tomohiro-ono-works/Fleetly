# ネイティブ検証

## 目的

- `PySide6 + Qt WebEngine` の **ネイティブアプリ側でしか確認できない挙動** を手動で検証する
- browser-only の Playwright テストでは拾えない Qt / OS 依存部分の回帰を確認する

## 対象

- ネイティブウィンドウ起動
- タイトルバー / タスクバーアイコン
- `QFileDialog`
- ネイティブのパス編集ダイアログ
- `flow.save` のネイティブ保存ダイアログ
- hidden ref の file / dir 編集
- WebView ホストの起動 / 終了時ログ
- 実Qt WebEngine上のQWebChannel command / response往復
- GUI単一起動

## 対象外

- browser-only の DOM / CSS / JS レンダリング確認
- Playwright で自動化済みのトップ画面 / サイドバー / データタブの基本表示
- connector の実データ処理そのもの

## 主要ファイル

- ホスト本体: [host.py](/c:/Users/tomoh/Documents/Sandbox/zizai/app/gui/host.py)
- bridge 本体: [bridge.py](/c:/Users/tomoh/Documents/Sandbox/zizai/app/gui/bridge.py)
- フォルダ / ファイル編集 UI 呼び出し: [ui.fields.js](/c:/Users/tomoh/Documents/Sandbox/zizai/static/js/ui.fields.js)
- workflow保存要求: [workflow_session.js](/c:/Users/tomoh/Documents/Sandbox/zizai/static/js/workflow-app/workflow_session.js)
- QWebChannel自動smoke: [qwebchannel_webengine_smoke.py](/c:/Users/tomoh/Documents/Sandbox/zizai/tests/native/qwebchannel_webengine_smoke.py)
- production host自動smoke: [gui_host_smoke.py](/c:/Users/tomoh/Documents/Sandbox/zizai/tests/native/gui_host_smoke.py)
- 検証チェックリスト: [checklist.md](/c:/Users/tomoh/Documents/Sandbox/zizai/tests/docs/native/checklist.md)

## 実行前提

- `bin\ziz.bat` でネイティブアプリを起動する
- 必要に応じて `bin\ziz.bat --debug` を使い、ターミナルログも確認する
- 自動smokeは`python -m unittest tests.python.test_native_qt_integration`で実行する
