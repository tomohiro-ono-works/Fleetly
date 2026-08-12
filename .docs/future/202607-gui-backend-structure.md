# 202607 GUI backend 実装構成

## 位置づけ

この文書は、202607版のPySide WebView、QWebChannel bridge、application service、runtime stateのPython側責務分離を定義する。

現行`app/gui/bridge.py`は参考実装であり、202607版ではtransport dispatcher、service、runtime stateへ分割する。

## 結論

GUI backendは同じPython process内で次の責務に分ける。

```text
desktop host
  -> QWebChannel transport
    -> bridge dispatcher
      -> application services
        -> execution manager
          -> core
            -> connectors
```

CLIはdesktop hostとQWebChannelを起動せず、application service／execution manager／coreを直接利用する。

application service／runtime managerの内部IFは、意味的契約を`202607-service-runtime-interface.md`、正確なシグネチャをPython実装、適合確認をunit testの正本分担で管理する。

## 責務分離と大容量データの背景

Zizaiは大容量DataFrameを扱うETL toolである。上記の各層はnetwork hopや別processを増やす構成ではなく、同じPython process内で責務と依存方向を分けるための論理層である。

層を通過するたびにDataFrameをJSON、dictionary、list等へ変換したり、defensive deep copyしたりすると、データ量に比例したCPU時間とmemory使用量が各層で重複する。このため、層分割をデータ変換境界として扱わない。

- connector、core、execution manager間のraw DataFrameはPython native objectとして受け渡し、処理上必要な変換を除いて同一objectへの参照を使用する。
- dispatcherとapplication serviceはraw DataFrameをrequest／response objectへ載せず、`run_id`、`step_id`、status等の軽量値を受け渡す。
- frontendへ必要な情報はresult cacheからschema、row_count、上限付きpreview、logとして取得する。
- QWebChannel用JSONへのserializeはbridge境界で各方向1回だけ行う。
- CLIはQWebChannel／dispatcherを通らずapplication serviceを直接呼ぶが、core／connectorの同じ実行contractを使用する。
- DataFrameのcopyがactionの処理内容として必要な場合はconnector／coreで明示的に行い、責務層をまたぐだけの理由ではcopyしない。

## 推奨module構成

```text
app/
  gui/
    host.py
    host_external.py
    host_navigation.py
    host_dialogs.py
    host_window.py
    host_coordinate.py
    qwebchannel_transport.py
    bridge_dispatcher.py
    bridge_contract.py
    bridge_events.py
    bridge_security.py
  services/
    app_status_service.py
    catalog_service.py
    document_service.py
    run_service.py
    result_service.py
    workspace_service.py
    preview_service.py
    hidden_value_service.py
    host_capability_service.py
    google_auth_service.py
  runtime/
    execution_manager.py
    run_store.py
    result_cache.py
shared/
  security_sanitizer.py
```

file名は実装時に調整してよいが、責務境界は維持する。

## desktop host

| module | 責務 |
| --- | --- |
| `host.py` | app起動、WebView container、QWebChannel lifecycle、終了処理 |
| `host_external.py` | WindowsのChrome／既定browser起動 |
| `host_navigation.py` | local entry allowlist、remote navigation／popup遮断、external open委譲 |
| `host_dialogs.py` | file／folder／open／save dialog |
| `host_window.py` | minimize、maximize、close、drag |
| `host_coordinate.py` | coordinate capture overlay |

desktop hostはcommand payload validationやflow実行を担当しない。host依存操作は`host_capability_service`経由でGUI threadへdispatchする。service生成threadをhost所有threadとし、別threadからのhost callback呼出しは`E_NOT_READY`で拒否する。

## QWebChannel transport

| module | 責務 |
| --- | --- |
| `qwebchannel_transport.py` | `backendBridge`登録、`postMessage`受信、`messageToFrontend` signal送信 |
| `bridge_contract.py` | JSON parse／serialize、protocol version、message envelope |
| `bridge_events.py` | response／eventのthread-safe queueとsignal dispatch |
| `bridge_security.py` | command別profile、payload schema、path／host capability事前検証 |
| `shared/security_sanitizer.py` | GUI／CLI共通のsecret、URL credential、通常log path mask |

transportはcommand内容を処理せず、bridge dispatcherへ渡す。

## bridge dispatcher

`bridge_dispatcher.py`は次だけを担当する。

- command allowlist。
- commandごとのpayload schema validation。
- security profile／host capabilityの事前検証。
- application serviceへのdispatch。
- exceptionから共通error envelopeへの変換。
- `id`、`type`、`trace_id`を保持したresponse生成。

dispatcherはcore／connectorを直接呼ばず、run lifecycleやDataFrameを保持しない。

## application services

| service | 責務 |
| --- | --- |
| `catalog_service` | catalog定義のload、validation、正規化、snapshot取得 |
| `document_service` | document list／load／save／close、document token、hidden value復元 |
| `run_service` | run start／cancel、execution manager呼出し |
| `result_service` | summary、schema、preview、row_count、run log取得 |
| `workspace_service` | root／list／stat／read／write／mkdir／delete、path正規化 |
| `preview_service` | Excel／CSV preview |
| `hidden_value_service` | frontend session内だけのpath／secret ref管理 |
| `host_capability_service` | dialog、window、coordinate、external openのhost callback境界 |
| `google_auth_service` | BigQuery向け固定gcloud login、account／ADC状態確認 |

serviceはfrontend、QWebChannel、JSON messageを知らない。bridge dispatcherがpayloadをservice inputへ渡し、service resultをresponse dataへ整える。

service input／resultはPython native objectとし、service境界ごとのJSON化やraw DataFrameのdictionary化を行わない。run開始serviceは実行受付情報、result serviceは上限付き表示cacheを返し、raw DataFrame実体はexecution manager／coreの所有範囲から外へ出さない。

`preview.readExcel`、`preview.readCsv`、`app.googleAuthStatus`はbackground workerで実行する。dialog、window、coordinate、external open、document open／saveはGUI threadに残す。Google認証状態確認ではaccess tokenの標準出力を破棄し、成否だけをresultへ反映する。

Windowsのgcloud helperはPATHから`gcloud.cmd`を明示解決する。
PowerShell execution policyや拡張子なしcommandの解決へ依存せず、
実行fileの実pathはfrontendへ返さない。

## runtime state

| state | 所有者 |
| --- | --- |
| `workspace_root`、`config_root` | workspace serviceまたはapp context |
| document token | document service |
| hidden session | hidden value service |
| runs、active run | execution manager／run store |
| flow run表示cache | result cache。`run_id + step_id`を正本keyにする |
| GUI step runのlatest raw cache | execution manager。flow close／app終了まで管理する |
| frontend event sink | bridge events |
| host callback | host capability service |

global variableではなく、GUI app processのapp contextへ閉じ込める。

hidden refはfrontend session内部の表現に限定する。`.zizd`には実pathを保存し、run serviceへも正規化した実値を渡す。

## command処理順

```text
postMessage(json_text)
  -> JSON parse
  -> protocol / envelope validation
  -> command allowlist
  -> payload schema validation
  -> security profile / capability validation
  -> application service
  -> response envelope
  -> messageToFrontend(json_text)
```

正規のGUI操作に処理内容ごとの確認dialogは表示しない。

## event処理

```text
core / execution manager event
  -> bridge event queue
  -> GUI thread
  -> messageToFrontend(json_text)
  -> frontend BridgeClient
```

- worker threadからQWebChannel signalを直接操作せず、thread-safe queueまたはQt queued connectionを使う。
- progressは件数／時間で間引き、行単位eventを送らない。
- terminal eventより前にresult cacheとrun summaryを確定する。

## GUI thread方針

- WebView、QWebChannel object、file dialog、window control、coordinate captureはGUI threadで操作する。
- long-running preview、flow実行、外部process待機をGUI threadで行わない。
- host capabilityはGUI threadへdispatchし、完了responseを元のcommand `id`へ対応付ける。
- `postMessage` slotは受付とvalidation後、長時間処理をbackgroundへ委譲する。

## 起動／停止

1. GUI entrypointがWindows user単位のinstance lockを取得する。取得できない2つ目のGUIはbackend／sessionを作らず終了する。
2. app hostがservice／runtime contextを構築する。
3. hostがbundled local frontendの固定entryをWebViewへ読み込む。
4. hostが`backendBridge`をQWebChannelへ登録する。
5. frontendが`qwebchannel.js`からchannelを初期化し、BridgeClientをreadyにする。
6. frontendが`app.getStatus`とcatalog commandを実行して初期stateを構築する。
7. app終了時に新規command受付を止め、run／workerを停止し、managed resource、channel、WebViewを破棄してinstance lockを解放する。

localhost server、random port、session token、SSE connectionの起動／停止処理は持たない。
CLIはGUI instance lock、WebView、QWebChannelを起動せず、GUI実行中でも独立して起動できる。

## browser開発／test

- 外部browser単体にproduction bridgeを公開しない。
- frontend component単体testはmock BridgeClientを使用する。
- Playwrightではstatic UIとmock contract testを行い、QWebChannel結合はPySide WebViewを含むintegration testで確認する。
- browser開発用mockとproduction bridgeを同時にfallbackさせず、起動modeで明示的に分ける。

## 受け入れ条件

- frontend componentが`backendBridge`を直接参照しない。
- WebViewへ登録するbackend QObjectが`backendBridge`だけである。
- bridge dispatcherがapplication serviceだけを呼び、core／connectorを直接呼ばない。
- serviceとcore／connectorがQWebChannelをimportしない。
- long-running処理でGUI threadをblockしない。
- responseとeventがcommand `id`／event `type`で正しく振り分けられる。
- app終了時にworker、channel、WebViewが適切に終了する。
