# 202607 QWebChannel bridge 仕様

## 位置づけ

この文書は、202607版GUIのfrontendとPython backendを接続するQWebChannel bridgeの公開境界を定義する。

commandごとのrequest／response schemaは`202607-qwebchannel-contract.md`と`qwebchannel/`配下の分類別文書を正本とする。command別のsecurity profileは`qwebchannel/security-policy-profile.md`を正本とする。

## 結論

- production GUIはPySide WebViewでbundled local frontendを表示し、QWebChannelでPython backendと通信する。
- localhost server、HTTP endpoint、SSE、WebSocket、session token、Host／Origin／CORS検証は使用しない。
- frontend componentはQWebChannel objectを直接呼ばず、共通`BridgeClient`だけを使用する。
- bridgeはapplication serviceへcommandを委譲する薄いtransport adapterとし、core／connectorを直接呼ばない。
- CLIはWebViewとQWebChannelを起動せず、同じapplication service／execution manager／coreを直接利用する。

## 実行方式ごとの構成

| 実行方式 | frontend transport | 実行経路 |
| --- | --- | --- |
| `gui-flow-run` | QWebChannel | frontend -> BridgeClient -> bridge dispatcher -> application service -> execution manager -> core -> connector |
| `gui-step-run` | QWebChannel | frontend -> BridgeClient -> bridge dispatcher -> application service -> execution manager -> core -> connector |
| `gui-standalone-run` | QWebChannel | frontend -> BridgeClient -> bridge dispatcher -> application service -> execution manager -> connector action直接実行 |
| `cli-flow-run` | なし | CLI -> application service -> execution manager -> core -> connector |

`gui-flow-run`／`gui-step-run`は①ワークフロー実行、`gui-standalone-run`は②ワークフロー外の単体実行とする。②ではworkflow core、step、edge、flow context、workflow schedulerを使用しない。CLIの単一step実行と②の単体実行は設けない。

## QWebChannel公開面

WebViewへ登録するQObjectは`backendBridge`の1個に限定する。

| public member | 方向 | 内容 |
| --- | --- | --- |
| `postMessage(json_text)` | frontend -> backend | command JSONを送信する |
| `messageToFrontend(json_text)` | backend -> frontend | responseまたはevent JSONを通知するsignal |

commandごとのslotやcore／connector objectをQWebChannelへ個別登録しない。QWebChannel公開面を増やさず、command allowlistとpayload schemaはdispatcher内で管理する。

## JSON message contract

command:

```json
{
  "v": "1",
  "kind": "cmd",
  "id": "cmd_...",
  "type": "documents.load",
  "ts": "2026-07-26T00:00:00Z",
  "payload": {}
}
```

success response:

```json
{
  "v": "1",
  "kind": "res",
  "id": "cmd_...",
  "type": "documents.load",
  "ts": "2026-07-26T00:00:00Z",
  "ok": true,
  "data": {},
  "trace_id": "trace_..."
}
```

failure response:

```json
{
  "v": "1",
  "kind": "res",
  "id": "cmd_...",
  "type": "documents.load",
  "ts": "2026-07-26T00:00:00Z",
  "ok": false,
  "error": {
    "code": "E_VALIDATION",
    "message": "ユーザー表示用メッセージ",
    "detail": {}
  },
  "trace_id": "trace_..."
}
```

event:

```json
{
  "v": "1",
  "kind": "evt",
  "type": "run.progress",
  "ts": "2026-07-26T00:00:00Z",
  "payload": {}
}
```

- `id`はcommandとresponseの相関に使う。
- `trace_id`はbackend logとの照合に使い、`run_id`とは分ける。
- responseとeventは同じsignalで受信し、`kind`で振り分ける。
- JSON parse／serializeはbridge境界で各方向1回だけ行う。
- file本体とraw DataFrameをmessageへ載せない。GUI表示にはschema、preview、row_count、logを使う。

この制限は、QWebChannelを通る回数自体よりも、大容量DataFrameのJSON化、Qt／JavaScript側へのcopy、frontend memory保持が処理時間とmemoryを増大させることを防ぐために設ける。backend内部のdispatcher、service、core、connectorは同一Python process内の論理層であり、層ごとにJSON化しない。

- flow／step実行commandはDataFrame本体ではなくdocument参照、`run_id`、`step_id`等を使用する。
- result取得commandはbackendの表示用cacheから必要な情報だけを返す。
- previewは先頭100行、1stepあたりUTF-8 JSON換算2 MiB、1セル64 KiBの確定済み上限を適用する。
- frontendから全行DataFrameを再取得するcommandは設けない。全件が必要な場合はconnectorの出力actionでfile／databaseへ明示出力する。

## command分類

### app／host／auth／input

| command | 責務 |
| --- | --- |
| `app.getStatus` | 現在の`session_id`、app状態、capability、runtime context defaults、開いているdocumentの軽量run索引を返す |
| `app.logUiEvent` | UI eventをapp logへ記録する |
| `app.windowControl` | minimize、maximize、close、drag等をhostへ依頼する |
| `app.openExternal` |検証済みの外部URLを既定browserまたはChromeで開く |
| `app.getSuggestIndex` | connector別の候補indexを返す |
| `app.googleAuthLogin` | BigQuery向け固定gcloud login commandを起動する |
| `app.googleAuthStatus` | 固定gcloud commandでADC状態を確認する |
| `mouse.coordinateCapture.start` | mouse coordinate captureを開始する |

Google認証helperは汎用OAuth APIではない。実行commandを固定し、access tokenをfrontend、response、logへ出さない。

### catalog／config

| command | 責務 |
| --- | --- |
| `catalog.getConnectors` | connector catalogを返す |
| `catalog.getActions` | action catalogと分類を返す |
| `catalog.getForms` | 全actionのform schemaを返す |
| `catalog.getDataAreaPolicy` | data area表示policyを返す |
| `catalog.getSecurityPolicySummary` | UI表示用security summaryを返す |

catalogは定義fileを正本とし、backend loaderがapp起動時に1回だけparse／validation／正規化する。frontendは起動時に取得してmemory cacheへ保持する。

### documents

| command | 責務 |
| --- | --- |
| `documents.list` | `.zizd` document／template一覧を返す |
| `documents.load` | `.zizd` document全体を読み込む |
| `documents.save` | `.zizd` document全体を保存する |
| `documents.close` | document session closeをbackend stateへ通知する |

### run／result

| command | 責務 |
| --- | --- |
| `run.start` | flow、step、またはcatalogで許可された②の単体action実行を開始し、`run_id`を返す |
| `run.cancel` | 実行中runをcancelする |
| `result.getSummary` | run summaryを返す |
| `result.getSchema` | `run_id + step_id`のschemaを返す |
| `result.getPreview` | `run_id + step_id`のpreview／row_countを返す |
| `result.getLogs` | cursorなしでは最新500件、`before_seq`では過去、`after_seq`では未表示のrun logを最大500件ずつ返す |
| `result.invalidateSteps` | `doc_session_id + step_ids`に対応する表示cacheと単一step実行用raw contextを無効化する |

run commandは対象flow／stepから`connector_id`、`action_id`、`params`をbackendで解決し、catalog存在確認とparams schema validationを行う。

②の`gui-standalone-run`だけは、requestの`doc_session_id`、`connector_id`、`action_id`、`params`を受け付ける。`doc_session_id`はSQL／Python等の実行元document（`.zizd`を除く）を識別し、同じ実行元documentのactive runを1件に制限するために使う。backendはcatalogの`standalone_allowed`を必須検証し、許可されたBigQuery／DuckDB／Python等のconnector actionを直接呼び出す。workflow実行planと`.zizd`は生成せず、共通化するのはrun lifecycle、`run_id`、cancel、log、security validation、worker／queue制御とする。

- 保存済みflowはbackendが読み込んだdefinition snapshotを使う。
- 未保存のGUI flowはcommand payloadのdraft definitionをrun中だけimmutable snapshotとして使い、①ワークフロー実行として数える。
- draft実行時に`.zizd`を自動保存せず、draft snapshotをrun履歴へ永続保存しない。
- `.zizd`内のGUI inline SQLはflow draftとして①で実行できる。独立したSQL／Python documentは②として実行する。SQL file参照actionは保存済みかつ実在するfileを必須にする。
- ②のactive runは`run.cancel`でcancelできる。active run中は同じ実行元documentの通常実行／dry runを開始できず、異なる実行元documentの②は同時実行できる。
- DuckDBのdry runは汎用native機能として扱わない。`execute_sql`／`execute_sql_file`の`EXPLAIN`対応SQLは非実行で解析し、`EXPLAIN`対象外の作成・更新系SQLは入力検証だけを行う。`create_db_file`とExportにはdry runを設けず、通常実行／Exportの書込み前validationを必須にする。responseには実際に確認した範囲を明示する。
- CLIはdraft実行を設けず、保存済み`.zizd`と実在する参照fileだけを使う。
- connector／actionを介さず任意commandやSQLを直接実行するbridge commandは作らない。

### workspace／file dialog／preview

| command | 責務 |
| --- | --- |
| `workspace.getRoot` | workspace rootを返す |
| `workspace.setRoot` | workspace rootを設定する |
| `workspace.pickRoot` | hostのfolder dialogでrootを選択する |
| `workspace.list` | file／folder一覧を返す |
| `workspace.stat` | pathのstatを返す |
| `workspace.readText` | text fileを読む |
| `workspace.writeText` | text fileを保存する |
| `workspace.mkdir` | folderを作成する |
| `workspace.delete` | file／folderを削除する |
| `file.pickFile` | hostのfile dialogを開く |
| `file.pickFolder` | hostのfolder dialogを開く |
| `preview.readExcel` | Excelのsheet／column／previewを返す |
| `preview.readCsv` | CSVのcolumn／previewを返す |

workspace外pathも通常のETL／RPA操作として許可する。pathはbackendで正規化し、対象存在、種別、権限、上書き競合などcommand固有条件を検証する。

## event

run、log、coordinate captureのeventは`messageToFrontend` signalで配信する。

- `run.progress`
- `run.log`
- `run.stepStatus`
- `run.completed`
- `run.failed`
- `run.cancelled`
- `mouse.coordinateCapture.preview`
- `mouse.coordinateCapture.selected`
- `mouse.coordinateCapture.cancelled`

5万行loop等でも行本体や行単位eventを送らない。処理件数または経過時間で間引いたprogressと、step／runの状態eventだけを送る。

## event切断／画面復旧

- 同じOSユーザー内でZizai GUIは単一instanceとし、2つ目のGUI processはbackendと`session_id`を作成しない。
- `doc_session_id`はGUI起動中に再利用せず、単一instance内では`doc_session_id + flow_id`で開いているflowを一意に識別する。
- bridge signalの完全replayは行わない。
- WebView reloadや一時的なchannel再初期化の間も、backend processが生存していればrunを継続する。
- `app.getStatus`は、開いているdocumentの`doc_session_id`、①のflowごとの
  最新flow run、stepごとの最新step run、②のactive runを軽量なrun索引として返す。
  step runは`step_id`、一部無効化済みrunは`invalidated_step_ids`を持つ。
- BridgeClientは再接続後にrun索引を取得し、`result.getSummary`、`result.getSchema`、`result.getPreview`、`result.getLogs`を画面で必要な分だけ呼び、画面を復旧する。索引にsummary、preview、logs本体を一括格納しない。
- 復旧時にbackendでflow／stepを再実行しない。
- flow runのraw DataFrameが解放済みでも、backendのschema／preview／row_count／logs cacheから表示を復旧する。
- raw DataFrameの復元や全件dataのfrontend再取得は行わない。
- この復旧は対象documentが開いたままQWebChannelだけが一時的に再初期化された場合に限る。document close済みの②について、preview／result／画面表示用run logを復元するglobal画面は設けない。

## backend責務

- bridge dispatcherはmessage envelope、version、command allowlist、payload schema、security profile、error mappingを担当する。
- application serviceはdocument、catalog、workspace、preview、host capability等のuse caseを担当する。
- execution managerはrun lifecycle、background execution、cancel、event、result cacheを担当する。
- coreはflow解決、依存関係、実行順序、step実行制御を担当する。
- connectorはconnector／action固有の外部I/Oとdata processingを担当する。

## frontend責務

- QWebChannelの初期化と`backendBridge`直接参照を`BridgeClient`へ集約する。
- UI componentへcommand名、JSON framing、response correlationを持ち込まない。
- response envelopeをunwrapし、UI表示用errorへ変換する。
- eventをruntime stateへ反映し、document stateへ混ぜない。
- catalog／result／logを表示componentへ渡す。

## 非目標

- localhost／外部networkへbackend APIを公開しない。
- 外部browser単体でproduction GUIを起動しない。
- browser JSからcore／connectorを直接呼ばない。
- QWebChannelへapplication service、core、connectorのQObjectを個別公開しない。
- 任意command実行用の汎用bridge commandを作らない。
