# 202607 現行仕様写像と変更点

## 位置づけ

この文書は、202607 版で採用する構成軸に対して、現行仕様を写像し、変更が必要な部分と不整合を整理する。

現行仕様の正本は `.docs/architecture.md`、`.docs/areas/`、実コードとする。202607 版の移行先仕様は `.docs/future/` 配下を参照する。

## 202607 軸で見た現行仕様

| 軸 | 現行仕様 | 現行の主な実体 | 202607 版での扱い |
| --- | --- | --- | --- |
| 起動bat／起動入口 | `zizai.py`を起動導線にする。flow path指定時はheadless実行、未指定時はGUI起動 | `bin/ziz.bat`、`zizai.py`、`app/main.py` | 維持。GUIはWebView／QWebChannel、CLIはbridgeなしで起動する |
| フロント: 独自ライブラリ化 | 明確な独立ライブラリは未定義。UI helper / modal / app shell 的なファイルは存在する | `static/js/app-shell.js`、`static/modal/*`、`static/js/ui.*` | `AppShell`、`TabularImportAssistant`、`WorkflowDesigner`、共通 UI 部品として再定義する |
| フロント: アプリ専用 | zizai 固有 UI、state、node 詳細、data area、workspace UI が JS 側に混在している | `static/js/app.js`、`state.js`、`ui.node.*`、`ui.fields.js`、`workspace.*` | app layer として整理し、library とは adapter で接続する |
| ブリッジ／アプリ基盤 | PySide WebViewがlocal HTMLを表示し、QWebChannelでPython bridgeと通信する | `app/gui/host.py`、`app/gui/bridge.py`、`static/js/bridge.js` | transportは維持し、巨大bridgeをdispatcher／service／runtimeへ分割する |
| QWebChannel bridge contract | command envelopeと一部commandが存在するが、公開責務が`bridge.py`へ集中 | 同上 | 1 QObject／1 slot／1 signal、command allowlist、分類別schemaを正式な正本にする |
| 設定/定義 | UI 宣言は `static/config/config.js` に集約されている | `static/config/config.js` | connector/action catalog、form schema、分類、data area policy に分割する |
| コア | workflow実行、flow解決、型、security policyを担当する | `core/workflow_engine.py`、`core/flow_locator.py`、`core/type_registry.py`、`core/security_policies.py` | 維持。application service／execution managerから呼ばれる |
| コネクタ | 外部 I/O、DB、ファイル、Web/Windows 操作を担当する | `connectors/` | 維持。core 経由で実行する |
| データエリア | schema、データ出力、ログの仕様を持つ | `.docs/areas/ui.md`、`.docs/areas/connectors.md`、`static/js/ui.fields.js` | 表示仕様は維持。app layer は policy を重複保持しない |

## 変更が必要な部分

### ブリッジ/アプリ基盤

- bundled local frontend + QWebChannelをproduction主経路として維持する。
- WebViewへ登録するQObjectを`backendBridge`だけにし、`postMessage`／`messageToFrontend`へ公開面を限定する。
- `app/gui/host.py`はlocal entry allowlist、remote navigation／popup遮断、QWebChannel lifecycleを担当する。
- `app/gui/bridge.py`のcommand dispatch、service、runtime stateを別moduleへ分離する。
- 外部browserはproduction backendへ接続せず、frontend testではmock BridgeClientを使う。

### QWebChannel bridge

- command namespaceと責務は`202607-qwebchannel-bridge.md`を正本にする。
- command／response／event JSON schemaは`202607-qwebchannel-contract.md`と`qwebchannel/`配下を正本にする。
- command別security profileは`qwebchannel/security-policy-profile.md`を正本にする。
- commandはapp／auth／catalog／flow／run／result／workspace／file／preview／inputへ分類する。
- command allowlist、payload schema、catalog、path、host capability validationを必須にする。
- 正規GUI／CLI操作に処理内容ごとのsecurity確認dialogは表示しない。
- errorはユーザー表示用messageとdebug detailを分ける。

### フロント

- `static/js/bridge.js`は共通BridgeClientとして再構成する。
- frontend componentは`window.pybridge`やQWebChannel objectを直接参照しない。
- `AppShell`、`TabularImportAssistant`、`WorkflowDesigner`を独自ライブラリとして切り出す。
- zizai 固有処理は `frontend-app` の adapter に寄せる。
- state 正本と selector を分け、派生 state を保持しない。

### 設定/定義

- `static/config/config.js` の肥大化を解消する。
- connector/action catalog、UI form schema、分類、data area policy を分ける。
- フロントと core が同じ分類・schema 前提を重複実装しないようにする。
- catalog/config の正本と配信方式は `202607-catalog-config-delivery.md` に従う。

### テスト

- Playwrightはmock BridgeClientを使うfrontend testを基本にする。
- PySide WebViewを含むQWebChannel integration testを追加する。
- remote navigation遮断、QObject公開面、command allowlist、payload schemaをtestする。
- 既知失敗と新規回帰を分ける。

## 不整合・要調整

| 不整合 | 内容 | 対応方針 |
| --- | --- | --- |
| 現行architectureと202607方針 | 現行のPySide WebView／QWebChannel自体は維持するが、巨大bridgeの責務混在が残る | architectureへBridgeClient／dispatcher／service境界を追記する |
| WebViewという言葉の意味 | 表示container、QWebChannel transport、backend serviceが混同されやすい | 3責務を文書とmoduleで分ける |
| `app-shell.js` と将来 `AppShell` | 現行の `static/js/app-shell.js` は将来の再利用ライブラリ `AppShell` と同一とは限らない | 既存名に引きずられず、public API を定義してから移行する |
| `WorkflowDesigner` の現行実体 | 現行は `ui.node.*` や canvas 系に分散しており、独立 component ではない | adapter 境界を先に決め、canvas/editor 低レベル処理を切り出す |
| `TabularImportAssistant` の現行実体 | Excel／CSV modalにtable描画、bridge、固定DOM依存が重複している | 共通core、format adapter、app providerへ分離する |
| `static/config/config.js` の責務 | UI 宣言、action 定義、form schema が一体化している | 設定/定義レイヤーとして段階分割する |
| security policyの適用境界 | core側policyはあるが、bridge command／payload／QObject公開面の正式な共通検査が不足 | `202607-qwebchannel-security.md`を正本にしてhost／dispatcherで検査する |
| local page制限 | 現行WebView hostはfile schemeを許可し、http／httpsをblockする | bundled app entryだけをallowlistし、任意local HTMLへbridgeを公開しない |
| 300 行ルール | `AppShell` / `WorkflowDesigner` は例外だが、一般 JS は 300 行以内を目指す | 例外は entry/API 層に限定し、内部 module は責務単位に分ける |
| CLI/headless | headless実行はGUI bridgeと別経路で動く | `zizai.py flow_path`と`app/main.py`の挙動を維持し、application service以下を共有する |

## 次に詰める項目

主要仕様タスクは `202607-task-plan.md` に沿って完了。

次は `202607-implementation-sequence.md` のフェーズ 0 に従い、現行棚卸しと baseline 固定を行う。
