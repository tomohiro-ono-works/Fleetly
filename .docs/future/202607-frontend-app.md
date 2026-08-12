# 202607 フロントアプリ専用仕様

## 位置づけ

この文書は、zizai 固有のフロント実装範囲を定義する。

再利用ライブラリではなく、zizai の connector、workflow、data area、bridge と接続する app layer を対象にする。

## 目的

- `AppShell`、`TabularImportAssistant`、`WorkflowDesigner`を利用し、zizai固有処理をadapterとして接続する。
- フロント app layer の読込範囲を限定する。
- connector/action 表示、データエリア、右詳細、実行 UI を整理する。

## 責務

| 領域 | 責務 |
| --- | --- |
| app bootstrap | config 読込、bridge 接続、state 初期化、AppShell mount |
| workflow adapter | 共通 graph document を WorkflowDesigner へ渡し、Zizai 固有 field と UI event を接続する。graph topology は変換しない |
| tabular import adapter | file picker、preview command、hidden ref、connector formとTabularImportAssistantを接続する |
| connector/action adapter | connector/action 定義、分類、表示名、icon |
| property panel | 選択 node の詳細フォーム、schema editor 接続 |
| data area | schema、データ出力、ログ表示 |
| run UI | 実行、停止、状態表示、結果反映 |
| bridge client | QWebChannel初期化、command／response相関、event購読 |

## 持たない責務

- 汎用 shell UI の内部実装
- workflow canvas の低レベル drag/connect 実装
- connector の外部 I/O 処理
- core の実行順序制御
- backend security policy 判定

## QWebChannel bridge

202607版ではPySide WebView + QWebChannelを前提にBridgeClientを整理する。

bridge command一覧と責務は`202607-qwebchannel-bridge.md`を正本とする。

command／response／eventのJSON schemaは`202607-qwebchannel-contract.md`と`qwebchannel/`配下の分類別文書を正本とする。

command別のsecurity policy profileは`qwebchannel/security-policy-profile.md`を正本とする。frontendはprofile判定結果を表示できるが、profileの決定主体にはならない。

| 項目 | 方針 |
| --- | --- |
| 公開object | `backendBridge`の1個だけ |
| frontend入口 | 共通`BridgeClient` |
| command | app、catalog、flow、run、result、workspace、file、preview等に分類 |
| response | command `id`で相関し、成功／失敗envelopeをunwrapする |
| event | `messageToFrontend` signalを購読し、runtime stateへ反映する |
| 外部browser | production bridgeは公開せず、開発／Playwrightではmock BridgeClientを使う |

frontend componentはQWebChannel objectを直接呼ばない。QWebChannel固有処理はBridgeClientへ集約し、componentはtransportを認識しない。

### QWebChannel security

詳細は`202607-qwebchannel-security.md`を正本とする。

- production WebViewはbundled local frontendの固定entryだけを読み込む。
- remote navigationとpopupはhostで捕捉し、外部browserへ分離する。
- command typeとpayloadはbackend bridge dispatcherで検証する。
- frontendが送るconnector／action／security profileを信用しない。
- errorはユーザー表示用messageとdebug detailを分け、secretや未maskの実pathを表示しない。
- localhost port、session token、Origin／CORS／SSEは使用しない。

## データエリア

データエリアの表示仕様は `.docs/areas/ui.md` と `.docs/areas/connectors.md` を正本とする。

app layer は、backend から取得した schema、preview、log を UI 部品へ渡すだけにする。
下部data areaはembedded workflow sessionが所有し、選択中stepに対応する
4タブだけを差分更新する。previewはbackendが返す上限付き先頭100行を使い、
frontendでraw DataFrameを保持しない。

app layer は、データフロー/ワークフロー分類や出力メタデータの列定義を重複保持しない。分類と表示 policy は設定/定義レイヤーから取得する。

## connector/action 表示

- connector/action 定義は config/catalog から取得する。
- app layer は選択状態と表示順だけを管理する。
- connector/action の分類ロジックを UI component 内へ入れない。
- 表示用 label/icon と実行用 id を分ける。

catalog/config の正本と配信方式は `202607-catalog-config-delivery.md` に従う。frontend は `static/config/config.js` を直接読まない。

## 右詳細フォーム

- form schema から renderer を選択する。
- field renderer は共通 UI 部品を利用する。
- 値の正本は同じ`WorkflowDocumentStore`の`steps[].params`とし、
  property専用のnode form stateを作らない。
- 表示用の派生値は selector で計算する。
- commit と preview update を分ける。
- AppShell側の共有right sidebarはactive child frameの公開APIを呼び、
  START、END、通常stepの選択に応じて内容を切り替える。
- file picker／TabularImportAssistantが追加したhidden ref metadataは
  child sessionへ明示的に同期し、property再描画後も表示名を維持する。

## workflow document command

Zizai固有のgraph編集はapp側のworkflow document commandへ集約し、`WorkflowDesigner`やproperty panelからapp document storeへ直接fieldを書き込まない。

| command | 責務 |
| --- | --- |
| `addFlow` | catalogのdataflow初期値から新しいflow、開始／終了node、初期stepを1 transactionで追加する |
| `connect` | 通常flow／loop／未所属graphのscope、DAG、loopの分岐／合流制約を検証してedgeを追加する |
| `deleteSelection` | 選択step／edge／sticky noteとdangling edgeを1 transactionで削除する |
| `updateStep` | connector、action、params、schema、label等のstep propertyを更新する |
| `updateFlow` | flow labelと開始変数を更新する |

commandと`WorkflowDesigner`は同じsession内ID high-water markを共有し、削除済みIDを再利用しない。commandは実行内容へ影響する変更について`invalidated_step_ids`を返すが、backend result cacheの実削除はruntime adapterが担当する。

`connect:create-request`と`delete:request`はworkflow adapterがcommandへ接続する。接続可否は同じcommand判定を`WorkflowDesigner.graphConstraints`から同期確認し、UI requestとstore適用で別のgraph規則を重複実装しない。

## 実行状態 UI

- 実行中、成功、失敗は静的な class/text/icon で表す。
- 実行中 animation は最小限にする。
- run status 更新で canvas、data area、detail panel を全再描画しない。
- 更新対象は、該当 node の status、ログ、データ出力に限定する。
- `run.stepStatus`、`run.log`、terminal eventをchild sessionで購読する。
- QWebChannel再初期化時は`app.getStatus.run_index`からrunを再関連付けし、
  backendを再実行せずsummary／schema／preview／logを再取得する。
- document変更で返された`invalidated_step_ids`は
  `result.invalidateSteps`へ渡し、該当stepへ再実行要求を表示する。

## production ownership

| 所有者 | 状態／責務 |
| --- | --- |
| AppShell top-level | workspace tab、active child、共有right sidebar |
| embedded workflow session | 唯一の`WorkflowDocumentStore`、選択、run関連付け、下部data area |
| backend | result cache、latest flow／step run索引、log pagination、raw context |

top-levelとembedded frameの間でdocumentを複製しない。property編集はchildの
公開APIからdocument commandを発行し、data areaも同じstoreの選択状態を参照する。

## ファイル構成案

```text
static/js/app/
  bootstrap.js
  app_state.js
  app_selectors.js
    qwebchannel_client.js
  adapters/
    connector_catalog_adapter.js
    tabular_import_adapter.js
    workflow_designer_adapter.js
    property_editor_adapter.js
    run_adapter.js
  views/
    data_area_view.js
    property_panel_view.js
    run_status_view.js
```

ファイル名と配置は実装時に調整してよい。ただし、責務境界は維持する。
