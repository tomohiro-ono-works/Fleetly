# 202607 全体構成仕様

## 位置づけ

この文書は、202607 版以降のプログラム構成、責務境界、実行方式を定義する。

現行実装の正本ではなく、移行先仕様として扱う。

## 目的

- フロント JS の責務を整理し、読込範囲を小さくする。
- 再利用可能な UI ライブラリと zizai アプリ専用処理を分離する。
- bridge、core、connector の責務境界を明確にする。
- production GUIはWebView + QWebChannelとし、外部networkへbackend portを公開しない。

## 全体レイヤー

| レイヤー | 責務 | 主な対象 |
| --- | --- | --- |
| フロント: 独自ライブラリ化 | 再利用可能な UI 基盤 | `AppShell`、`TabularImportAssistant`、`WorkflowDesigner`、共通 UI 部品 |
| フロント: アプリ専用 | zizai 固有の画面、adapter、状態接続 | connector/action 表示、データエリア、右詳細、実行 UI |
| ブリッジ／アプリ基盤 | desktop host、WebView、QWebChannel、application service、OS連携 | PySide、bridge dispatcher、file選択 |
| 設定/定義 | フロント、core、connector の契約 | connector/action 定義、schema、UI form 定義 |
| コア | workflow 実行、保存/読込、型、security policy | `core/workflow_engine.py`、type registry |
| コネクタ | 外部 I/O、DB、ファイル、Web/Windows 操作 | `connectors/` |
| 起動 bat | 起動入口 | `bin/ziz.bat` など |

## 依存方向

依存方向は一方向を基本とする。

```text
起動bat
  -> ブリッジ/アプリ基盤
    -> フロント: アプリ専用
      -> フロント: 独自ライブラリ化

ブリッジ/アプリ基盤
  -> コア
    -> コネクタ

設定/定義
  -> フロント: アプリ専用
  -> コア
```

独自ライブラリは、アプリ専用、bridge、core、connector を直接参照しない。

## QWebChannel／WebView方針

202607版のproduction GUIはPySide WebView + QWebChannelを使用する。

localhost server、HTTP API、SSE、WebSocketは起動しない。

| 実行形態 | 用途 | 方針 |
| --- | --- | --- |
| PySide WebView + QWebChannel | 通常のdesktop実行 | 正本。bundled local frontendを表示し、bridge commandでbackendへ接続 |
| 外部browser + mock BridgeClient | frontend component開発、Playwright | backend操作を行わないmock contractとして使用 |
| 外部公開 Web サーバー | リモート利用 | 202607 の対象外 |

frontend componentはQWebChannel objectを直接参照せず、共通BridgeClientだけを使用する。これにより独自ライブラリはtransport非依存を維持する。

browser開発用mockとproduction bridgeを自動fallbackさせず、起動modeで明示的に分ける。

GUI backend構成は`202607-gui-backend-structure.md`、bridge contractは`202607-qwebchannel-bridge.md`を正本とする。

旧経路削除とcompatibilityなしの方針は`202607-legacy-path-removal.md`を正本とする。現行の巨大`bridge.py`とfrontend直読み`static/config/config.js`は維持せず、transport／service／catalogの責務へ分割する。

```text
Frontend JS
  -> BridgeClient
    -> QWebChannel bridge dispatcher
      -> application service
        -> execution manager
          -> core
            -> connectors
```

## QWebChannelの安全要件

詳細は`202607-qwebchannel-security.md`を正本とする。

- productionではbundled local frontendの固定entryだけをWebViewへ読み込む。
- remote pageへのnavigationとpopupをWebView内で許可しない。
- WebViewへ公開するQObjectは`backendBridge`だけにする。
- public memberは`postMessage` slotと`messageToFrontend` signalに限定する。
- command allowlist、payload schema、catalog、path、host capabilityをbackendで検証する。
- productionではdevtools／remote debuggingを無効にする。
- XSS、local asset改ざん、error／logへのsecret漏えいを防ぐ。
- 正規のGUI／CLI flow実行では処理内容ごとのsecurity確認dialogを表示しない。

## 起動方針

- 起動 bat は起動入口に限定する。
- Python 環境準備、app host 起動、ログ初期化程度に責務を限定する。
- UI ロジック、connector ロジック、workflow ロジックを起動 bat に持たせない。

## 設定/定義レイヤー

connector/action 定義、UI form 定義、schema 定義は、フロントと core の契約として扱う。

将来的には `static/config/config.js` の肥大化を避け、次のように分ける。

- connector/action catalog
- UI form schema
- action classification
- data area display policy
- security policy reference

## 非目標

- 202607 時点で完全な Web アプリ化は目標にしない。
- connector や core をブラウザ側へ移植しない。
- 外部公開 server としての認証/権限モデルは扱わない。
- `file://` 読込を通常導線として維持しない。
- QWebChannel、旧 bridge command、旧 config 読込の互換 layer を作らない。
