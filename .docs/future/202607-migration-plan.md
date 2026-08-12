# 202607 移行計画

## 位置づけ

この文書は、202607版のJS refactor、QWebChannel責務分離、UI library分離を段階的に進める計画を定義する。

詳細順序は`202607-implementation-sequence.md`を正本とする。

## 前提

- 一括置換しない。
- 現行挙動を確認しながら責務単位で移行する。
- QWebChannel transportは維持するが、現行巨大bridgeの内部構造は維持しない。
- 旧compatibility layer、fallback、二重正本は作らない。
- Playwright、PySide integration、screenshotで主要UIを確認する。

## フェーズ

| フェーズ | 内容 | 完了条件 |
| --- | --- | --- |
| 0 | 現行棚卸し | JS、bridge、host、依存関係、既知失敗を記録 |
| 1 | service／runtime抽出 | QWebChannel非依存のapplication serviceを作る |
| 2 | bridge contract固定 | 1 QObject／1 slot／1 signal、allowlist、schemaを固定 |
| 3 | state正本化 | document／runtime／UI view stateを分離 |
| 4 | catalog／BridgeClient移行 | config直読とcomponentのbridge直接参照を外す |
| 5 | AppShell切り出し | shell UIをapp固有処理から分離 |
| 6 | TabularImportAssistant切り出し | 表形式file取込UIを共通core＋format adapterでlibrary化 |
| 7 | WorkflowDesigner切り出し | canvas/editorを同じgraph contractでlibrary化 |
| 8 | command群移行 | flow、workspace、run、result、hostをservice経由へ移す |
| 9 | UX静的化 | animation、timer、全体再描画を削減 |
| 10 | 旧責務削除／検証固定 | fallbackを削除し、unit／integration／E2Eを固定 |

## 最初に行うこと

1. `static/js`、`app/gui/bridge.py`、`app/gui/host.py`の行数と責務を記録する。
2. command／event一覧とfrontend呼出箇所を確認する。
3. unit／Playwrightの既知失敗を整理する。
4. application serviceへ抽出するuse caseとruntime stateを確定する。
5. QWebChannel public contractとsecurity testを先に固定する。

## リスク

| リスク | 影響 | 対策 |
| --- | --- | --- |
| state同期の二重化 | UIが古い状態を表示する | state正本を先に決める |
| adapter境界の曖昧化 | libraryがZizai固有になる | public APIと禁止importを定義する |
| bridge分割だけ進む | service責務が別fileへ移るだけになる | serviceをQWebChannel非依存でunit testする |
| remote contentへのbridge公開 | backend commandを不正利用される | navigation allowlist、1 QObject、command validation |
| browser mockのproduction混入 | security境界が曖昧になる | 起動modeを分け、自動fallbackを禁止する |
| Playwright失敗の混在 | 回帰判断ができない | 既知失敗と新規失敗を分ける |

## QWebChannel移行

移行先は`202607-qwebchannel-bridge.md`、`202607-qwebchannel-contract.md`、`202607-qwebchannel-security.md`、`202607-gui-backend-structure.md`を正本とする。

1. 現行bridgeからapplication service／execution managerを抽出する。
2. `backendBridge`の公開面を`postMessage`／`messageToFrontend`へ限定する。
3. command allowlist、payload schema、security profileをdispatcherへ集約する。
4. frontend BridgeClientへQWebChannel初期化、response相関、event購読を集約する。
5. catalog、workspace、flow、run、result、host capabilityを順にservice経路へ切り替える。
6. frontend componentのglobal bridge直接参照とbridge内の旧service実装を削除する。

## 検証

- JavaScript構文とunit test。
- application serviceのtransport非依存unit test。
- bridge envelope／command schema contract test。
- unknown command、version不一致、不正payload拒否。
- remote navigation／popup遮断、production devtools無効。
- PySide WebView + QWebChannel integration test。
- mock BridgeClientを使うPlaywright UI test。
- AppShell／TabularImportAssistant／WorkflowDesigner smoke test。

## 完了条件

- frontend componentがBridgeClientだけを使う。
- `AppShell`、`TabularImportAssistant`、`WorkflowDesigner`のpublic APIが文書化され、backend transportへ依存しない。
- bridge dispatcherがapplication serviceだけを呼ぶ。
- service、core、connectorがQWebChannelをimportしない。
- catalogは定義file正本 + catalog service／bridge配信になっている。
- localhost listening portを作らない。
- 旧global、config直読、bridge責務混在、compatibility fallbackがない。
- unit／PySide integration／Playwright testが整備されている。
