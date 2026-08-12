# 202607 実装順序

## 位置づけ

この文書は、202607版仕様を実装へ移す詳細順序を定義する。

対象はJavaScript、PySide WebView、QWebChannel bridge、application service、catalog、検証、旧責務混在の削除である。

## 基本方針

- 一括置換せず、責務境界ごとに切り替える。
- QWebChannel transport自体は維持し、現行巨大bridgeの責務混在を解消する。
- application serviceをtransport非依存にし、GUIとCLIから共有する。
- frontend componentはBridgeClientだけを使い、QWebChannel objectを直接参照しない。
- 旧compatibility adapter、fallback、二重正本は作らない。
- 先にbaselineとcontract testを固定し、既知失敗と新規回帰を分ける。

## 実装フェーズ

| 順番 | フェーズ | 主な対象 | 完了条件 |
| --- | --- | --- | --- |
| 0 | baseline固定 | tests、行数、既知失敗、主要画面 | 現行挙動とtest状態が記録されている |
| 1 | service／runtime抽出 | `app/gui/bridge.py`、`app/services/`、`app/runtime/` | serviceがQWebChannelをimportせず単体test可能 |
| 2 | QWebChannel transport／security | host、transport、dispatcher、contract | 1 QObject／1 slot／1 signalとcommand validationが固定 |
| 3 | catalog／config移行 | `config/catalog/`、catalog service／command | frontendが`static/config/config.js`を正本として読まない |
| 4 | frontend BridgeClient | QWebChannel初期化、response相関、event購読 | componentが`backendBridge`を直接参照しない |
| 5 | AppShell切り出し | shell UI、tab、sidebar、panel | app固有処理なしでshell smoke testが通る |
| 6 | TabularImportAssistant切り出し | Excel／CSV preview、取込行選択、format adapter | QWebChannelなしのprovider smoke testが通る |
| 7 | WorkflowDesigner切り出し | canvas、selection、viewport、loop、notes | `.zizd`と同じgraph contractでdesigner smoke testが通る |
| 8 | workspace／flow command移行 | workspace、flow load／save | dispatcher -> service経由で動く |
| 9 | run／result／event移行 | execution manager、cache、event、log | run、cancel、result、画面復旧がbridge contractで動く |
| 10 | host capability移行 | dialog、preview、window、coordinate、external open、auth | GUI thread dispatchとprofile testが通る |
| 11 | 旧責務混在削除 | bridge内handler、global、config直参照 | 正本経路以外のfallbackがない |
| 12 | 検証固定 | unit、contract、PySide integration、Playwright | 主要smoke／security／lifecycle testが固定 |

task 010／011でphase 8のworkspace／documentとphase 9のresult read／log restoreを
先行実装し、task 012から017で`AppShell`、`TabularImportAssistant`、
`WorkflowDesigner`、run lifecycle、document store／commandを実装した。
task 018でproduction `dataflow.html`のload／save／runを202607 document storeへ
切り替え、phase 8を完了した。task 019でphase 9のproperty form、data area、
result／event表示、task 020でphase 10のWindows GUI host capabilityを完了した。
task 021でphase 11の旧backend `flow.run`／Bridge内worker重複を削除した。
task 022でBridgeClientとfrontend APIを`zizPackages`正本へ統一し、
旧frontend global、`static/config/config.js`、旧app／state／canvas assetを
物理削除してphase 11を完了した。task 023でproductionのworkflow外単体実行UI、
catalog source binding、cancel／close lifecycle、result／log表示を接続した。
task 024でProcessRunner、managed resource、GUI単一起動、log分離を実装し、
実Qt WebEngine／QWebChannel、Python、Playwrightの回帰検証を固定してphase 12を完了した。

## フェーズ0: baseline固定

- `static/js`、`app/gui/bridge.py`、`app/gui/host.py`の行数を記録する。
- Playwrightの既知失敗を分ける。
- 主要操作のscreenshotを保存する。
- 現行QWebChannel command／event一覧を記録する。

この段階では実装修正しない。

## フェーズ1: service／runtime抽出

現行`BridgeRuntime`から次を先に分ける。

```text
bridge dispatcher
  -> application service
    -> execution manager
      -> core
        -> connector
```

- catalog、flow、workspace、preview、host capabilityをserviceへ分ける。
- run lifecycle、cancel、result cache、event生成をexecution manager／run storeへ分ける。
- service input／resultはPython objectとし、JSON／QWebChannelを持ち込まない。
- CLIから同じservice／execution managerを呼べることをunit testで確認する。

## フェーズ2: QWebChannel transport／security

- `backendBridge`以外のQObjectを登録しない。
- public memberを`postMessage`と`messageToFrontend`に限定する。
- JSON parse／serialize、protocol version、command allowlist、payload schema、error envelopeをdispatcherへ集約する。
- bundled local entry allowlist、remote navigation／popup遮断、production devtools無効化をhostへ実装する。
- long-running commandをGUI threadからbackgroundへ委譲する。

```text
postMessage
  -> envelope validation
  -> command allowlist
  -> payload schema
  -> security profile / capability
  -> service
  -> response signal
```

## フェーズ3-4: catalogとBridgeClient

1. `config/catalog/`へ定義を分割する。
2. catalog loader／validatorを作る。
3. `catalog.*` commandを実装する。
4. frontend BridgeClientへQWebChannel初期化とresponse correlationを集約する。
5. catalog adapterが起動時に全catalog／form schemaを取得してcacheする。
6. UI componentから`static/config/config.js`と`backendBridge`の直接参照を外す。

## フェーズ5: AppShell

1. shell layoutのDOM／CSSを独立させる。
2. tab／activity／sidebar／panel／statusをinstance API化する。
3. app固有commandをeventとして外へ出す。
4. `window.zizShell`依存を外す。

workflow canvasやdata areaはこの時点ではapp layerに残してよい。

## フェーズ6: TabularImportAssistant

1. Excel／CSV modalに重複するpreview table、行選択、lifecycleを共通coreへ移す。
2. sheet、encoding、delimiterをformat adapterへ分ける。
3. sourceとpreview取得をcallbackへ出し、QWebChannel／hidden ref依存をapp adapterへ残す。
4. fixed DOM IDと`window.ExcelModal`／`window.CsvModal`をpublic経路から外す。
5. QWebChannelなしのmock providerでreuse smoke testを通す。

public APIは`202607-tabular-import-assistant-api.md`を正本とする。

## フェーズ7: WorkflowDesigner

1. `.zizd`と同じ`steps`、`flows`、`loop.flows`をdocument contractにする。
2. canvas render、hit test、selection、viewportをdesigner内へ閉じる。
3. loop、sticky note、style拡張をpublic APIへ含める。
4. connector／action表示をrenderer adapterへ出す。
5. run statusとvalidationをdocumentへ混ぜずoverlayにする。
6. property panelとBridgeClient呼出しをdesignerから外す。

## フェーズ8-10: command移行

| 順番 | command群 | 理由 |
| --- | --- | --- |
| 1 | catalog | 読取中心で低risk |
| 2 | workspace read／list／stat | path validationの確認に向く |
| 3 | flow load／save | hidden valueと保存境界を確認できる |
| 4 | result read／log restore | data area表示確認に向く |
| 5 | run／event | worker、cancel、cache、logが絡む |
| 6 | dialog／preview／input | GUI thread dispatchが必要 |
| 7 | delete／openExternal／auth | write／host／execute profile確認が必要 |

## フェーズ11: 旧責務混在削除

削除対象は次の通り。

- `bridge.py`内のservice実装、runtime state、connector／core直接呼出し。
- frontendの`window.pybridge`／`window.zizBridge`／`backendBridge`直接参照。
- frontend直読みの`static/config/config.js`正本扱い。
- app固有処理を含むAppShell／TabularImportAssistant／WorkflowDesigner内部関数。
- `window.ExcelModal`／`window.CsvModal`と固定modal DOMへの依存。
- command名やpayloadを変換する旧compatibility adapter。

QWebChannel、bundled local frontend、`qwebchannel.js`は正本経路として削除しない。

## フェーズ12: 検証固定

- GUI起動／終了とQWebChannel lifecycle。
- 1 QObject／1 slot／1 signal。
- unknown command、version不一致、不正payload拒否。
- remote navigation／popup遮断。
- production devtools／remote debugging無効。
- catalog取得とcache。
- workspace read／write conflict。
- flow load／save。
- run start／cancel／result／event／log復旧。
- Python／BATのProcessRunner、Windows process tree cancel、出力量上限、secret mask。
- Selenium managed resourceのflow／step／document／app終了時解放。
- GUI単一起動、GUI／CLI／debug log分離、10日保持。
- AppShell／TabularImportAssistant／WorkflowDesigner smoke。
- browser mock BridgeClientとproduction bridgeの分離。
- 実Qt WebEngine上のproduction entry起動とQWebChannel command／response往復。

## 完了条件

- frontend componentはBridgeClientだけを使用する。
- AppShell、TabularImportAssistant、WorkflowDesignerがbackend transportやapp固有importを持たない。
- bridge dispatcherはapplication serviceだけを呼ぶ。
- service、core、connectorがQWebChannelをimportしない。
- catalogは定義file正本 + catalog service／bridge配信になっている。
- localhost listening portを作らない。
- 旧bridge責務、config直参照、fallbackが残っていない。
- unit／contract／PySide integration／Playwright testが固定されている。
