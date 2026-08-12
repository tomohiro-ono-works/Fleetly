# 202607 run / result / events Bridge Command Schema

## 対象

GUIの実行開始、cancel、summary、schema、preview、log復元、QWebChannel eventを扱う。

①ワークフロー実行のstep結果取得は`run_id + step_id`を正本にする。②ワークフロー外の単体実行はstepを作らず、terminal eventを`run_id`で識別する。

`cli-flow-run`はWebView／QWebChannelを使用しないが、同じruntime service、ID、result、log contractを直接利用する。

## 暫定ルール

この章は、実装前に固定するための暫定ルールである。

### ID

| ID | 暫定ルール |
| --- | --- |
| `run_id` | backend が実行受付時に UUIDv7 から 1 回だけ発行する opaque ID。frontend と処理ロジックは構造を解釈しない |
| `trace_id` | backendがcommand／runの追跡用に発行する。error response、summary、terminal eventに含める |
| `step_id` | flow document 内の10進文字列の安定 ID。`'01'`から発番し、結果取得、step status、単一 step 実行で使う。順序を意味しない |
| `flow_id` | flow document 内の10進文字列の安定 ID。`step_id`とは別に`'01'`から発番する |
| `document_ref` | frontend/backend 間で `.zizd` document identity として使う。結果取得の public key にはしない |
| `flow_key` | backend内部専用。public bridge commandには出さない |

`step_id` が無い、重複している、空文字、または正規化済み10進文字列でない executable step は run start 前の validation error にする。`flow_id`も同じ形式で検証する。

`step_id` は実行順を表さない。並列、合流、loop があるため、実行順序は `flows.<flow_id>.edges` と制御構造で表す。

run ID の形式は `gui_flw_{UUIDv7}`、`gui_stp_{UUIDv7}`、`gui_std_{UUIDv7}`、`cli_flw_{UUIDv7}` とする。人向け連番は持たない。実行元と実行種別は `execution_source` と `run_kind` にも保持し、`flow_id` と `session_id` は追跡用属性として保持する。これらは result の正本 key に含めない。

同じOSユーザー内でZizai GUIは単一instanceとし、2つ目のGUI processはbackendと`session_id`を作成しない。`doc_session_id`はGUI起動中に再利用せず、単一instance内では`doc_session_id + flow_id`で開いているflowを一意に識別する。app再起動後は表示用cacheを引き継がず、`run_id`は引き続きUUIDv7で全期間一意にする。

202607版は、`.zizd`を使う①ワークフロー実行と、`.zizd`を使わない②ワークフロー外の単体実行に分ける。内部run種別は`gui-flow-run`、`gui-step-run`、`gui-standalone-run`、`cli-flow-run`の4種類とし、`gui-standalone-run`は②を表す。CLIの単一step実行と②の単体実行は設けない。

### run start

- `run.start`はGUI実行用とし、validationとsecurity profileの検証を通過してから`run_id`を発行する。
- start commandがrejectされた場合は`ok: false`を返し、`run_id`は発行しない。
- `step_id` 指定ありは単一 step 実行、指定なしは flow 全体実行とする。
- `loop_owner_id`を持つloop内child stepを`step_id`へ指定した`run.start`はvalidation errorとして拒否し、`run_id`を発行しない。
- loop親stepを指定した`gui-step-run`は、外部run contractに通常stepと同じstatus、result、cache、error、cancel規則を適用する。loop内部は既存のloop実行規則を使用し、`gui-step-run`専用contractは追加しない。
- 1つのGUI `session_id`で、①の`gui-flow-run`または`gui-step-run`は保存済み／未保存を問わず同時に1件だけ許可する。
- 作成中／未保存のworkflowを編集しているだけでは①の実行件数に数えず、実行開始時に①として数える。
- ②の`gui-standalone-run`は、①の有無にかかわらず開始できる。②同士にはsession単位の論理的な件数上限を設けないが、②の同一実行元document（SQL／Python等、`.zizd`を除く）ではactive runを1件までとする。異なる実行元documentの②は同時実行できる。
- ②はcatalogで`standalone_allowed`のactionだけを受け付け、BigQuery、DuckDB、Python等のconnector actionを直接実行する。workflow core、step、edge、flow context、workflow scheduler、workflow実行planは作らない。
- ②も個別の`run_id`を持ち、共通のcancel、log、security validation、worker／queue制御を使用する。実行元documentはrequestの`doc_session_id`で識別する。
- DuckDBのdry runは`execute_sql`／`execute_sql_file`だけを対象とし、汎用native dry runとして扱わない。DuckDBが`EXPLAIN`を受け付けるSQLだけを非実行で解析し、`EXPLAIN`対象外の作成・更新系SQLはparams、参照先、出力先等の入力検証だけを行う。terminal resultは通常実行成功と区別し、実際の確認範囲を返す。
- BigQueryの`execute_sql`／`execute_sql_file`はnative dry runを使用し、SQLを実行せず、検証成否、推定処理bytes、エラー内容を返す。preview／row countは返さない。
- Python dry runはユーザーコードを実行せず、app同居venvで構文compile、ASTによるトップレベル`main()`定義と引数なし呼出しの確認、通常`import`文のlibrary存在確認を行う。library自体はimportせず、動的import、runtime error、戻り値は保証しない。terminal resultは「静的検証完了」と確認範囲を返す。
- `DuckConnector.create_db_file`とExport actionにはdry runを設けない。通常実行／Export開始時にparams、source DataFrame、schema、出力先を必須validationし、失敗時は書込み前にerrorにする。
- 実行開始後の失敗はcommand response errorではなく、run summaryとterminal eventで表す。
- ①がすでに実行中の場合、別flow／別`.zizd` documentを含む新しい①へ`E_RUN_CONFLICT`を返す。②の同一実行元documentにactive runがある場合も、新しい通常実行／dry runへ`E_RUN_CONFLICT`を返す。
- ①の1 runあたりの同時実行step数は標準4とし、backend設定で変更可能にする。
- 1つのGUI sessionで実際に同時稼働するconnector処理は①／②を合わせて標準4 workerとし、backend設定で変更可能にする。
- workerに空きがない未開始処理は`queued`にし、workerを取得せず待機する。queueはrun間で公平に選択する。
- ②はconnector処理開始前のrun statusを`queued`、①はrun statusを`running`のまま該当step statusを`queued`にする。画面表示名は「実行待ち」とする。
- `queued`中も`run.cancel`を受け付け、connector処理を開始せず`run.cancelled`へ遷移できる。
- backendは同一resourceの汎用lock、action固有の競合validation、強制直列化を行わない。同一resourceへの競合をconnectorまたは外部システムがerrorとして返した場合は、通常のstep failureとして処理する。
- errorにならない上書きや操作干渉はbackendでは検知しない。`WindowsConnector.mouse_click`、`input_text`、`send_keys`等のdesktop操作中は、利用者および他の自動化toolが対象desktopを操作しないことを利用条件とする。
- フロー全体実行では、完了済み step の schema/preview/log は run 完了前でも取得できる。
- ステップ単体実行では、schema/preview の途中結果は不要とし、最終 result だけを返す。
- ステップ単体実行でも log は実行中に配信する。

### cancel

- `run.cancel`は対象runが現在のGUI app contextに属する場合だけ受け付ける。
- cancel commandは「キャンセル要求を受け付けた」ことを返す。即時停止完了を保証しない。
- cancel は interrupt-first を基本にする。backend は可能な実行単位へ割り込みを送り、同時に cancel token を立てる。
- 協調キャンセルは、interrupt だけでは安全に止められない領域の checkpoint として使う。
- 強制 kill は標準にしない。将来必要になった場合は、通常 cancel とは別 contract として設計する。
- 「キャンセル完了event」とは、cancel command受付ではなく、実際にrunが止まりterminal状態になったことをfrontendへ通知するeventを指す。
- cancel 後の最終状態は `run.cancelled` event と summary の `status: "cancelled"` で通知する。
- すでに terminal 状態の run への cancel は `accepted: false` とし、現在 status を返す。
- document closeに伴うcancelでも同じcontractを使い、terminal eventとcleanup完了後にdocument sessionを閉じる。
- ②の実行元document（SQL／Python等、`.zizd`を除く）も、active run中のcloseではbackground継続を行わない。`閉じずに続行`または`run.cancel`完了後に閉じるかをfrontendで選択する。

cancel 強度:

```text
協調キャンセル < 割り込み < 強制終了
```

202607 版では、割り込みを基本にしつつ、データ破損や外部状態の不整合を避けるために協調キャンセル checkpoint を併用する。

協調キャンセル checkpoint が必要な領域:

| 領域 | 理由 |
| --- | --- |
| step 間 / loop 間 | 次の step や次の反復へ進まない制御が必要 |
| CSV/Excel 大量行処理 | chunk 間で安全に止める |
| ファイル書き込み | 中途半端なファイル破損を避ける |
| BigQuery など外部 job | job cancel API と状態確認が必要 |
| Selenium wait / DOM 操作 | 長い wait を短い polling に分けて止める |
| VectorDB embedding | batch 間で安全に止める |
| cleanup 処理 | browser/session/temp file を閉じる |
| Python 実行後処理 | interrupt 後の cleanup と結果破棄を行う |

Python 実行は Jupyter の stop に近い割り込みを優先する。ただし、割り込みが効かない処理や cleanup のために cancel token も併用する。

### step failure

- 並列実行中に1つのstepが失敗したらfail-fastとし、新しいstepを開始しない。
- 実行中の並列stepにはcancelを要求し、各stepのterminal状態とcleanup完了を待つ。
- 未開始stepは独立branchを含めて`skipped`にする。
- 最初のstep failureをprimary errorとして保持し、run全体は`error`と`run.failed`で終了する。
- failureに伴って他stepが`cancelled`になっても、run全体を`cancelled`には変更しない。

### result

- result commandは`run_id + step_id`を必須keyにする。
- 「最新実行結果」をfrontendが推測して取得するcommandは作らない。
- schema、preview、row_count は backend に保存された表示用 result cache から返す。
- `gui-flow-run`のterminal summaryと表示用result cacheはflowごとに最新run 1件だけ保持する。同じflowの新しいrun開始時に前回run分を破棄し、破棄済みの`run_id`による取得には`E_RESULT_NOT_FOUND`を返す。
- document close時は、そのdocumentに属する全flowのterminal summaryと表示用result cacheを破棄する。
- GUI session全体の表示用result cacheはUTF-8 JSON換算128 MiBを標準上限とし、backend設定で変更可能にする。
- session上限を超える場合は、完了時刻が古いflowからpreviewだけを破棄し、terminal summary、schema、row_countは残す。active runで新しいpreviewを保存できない場合もrunは継続し、preview取得時にcache上限で表示できないことを返す。
- raw DataFrame の保持、解放、data area cache の詳細は `../202607-runtime-data-lifetime.md` を正本にする。
- preview rows は先頭100行を上限とし、100行を超える場合は `truncated: true` にする。
- preview payloadは1stepあたりUTF-8 JSON換算2 MiB、1セルの表示値は64 KiBを上限とする。超過部分は表示値だけを切り詰め、`truncated: true`にする。
- preview payloadは1回のserialize処理中にbyte数を加算し、上限到達時点で停止する。全体serializeと縮小serializeを繰り返さない。
- result が存在しない step は `E_RESULT_NOT_FOUND` にする。
- `E_RESULT_NOT_READY` は「step は存在するが、まだ schema/preview/row_count として表示できる result が生成されていない」ことを表す。
- フロー全体実行では、完了済み step の result は run 全体が実行中でも返す。
- フロー全体実行で未実行または実行中の step result は `E_RESULT_NOT_READY` にする。
- ステップ単体実行では、実行中の schema/preview/row_count は `E_RESULT_NOT_READY` にする。
- `gui-step-run`の実行内容に影響するconnector、action、params、schema、edge、入力参照、開始変数を変更した場合は、影響するstepと依存graph上の全下流stepのlatest raw cacheと表示用result cacheを無効化する。label、node位置、色、sticky note等の変更では維持する。
- cache無効化後に必要な上流resultがない下流stepを実行した場合は、上流の再実行が必要なことを示すvalidation errorにする。
- `gui-flow-run`／`cli-flow-run`のSelenium browser session等は最後の既知consumer完了後にcleanupし、run終了、error、cancelを保持期限の上限とする。
- `gui-step-run`で生成したbrowser session等は`doc_session_id + 生成step_id`のlatest resourceとして保持し、同step再実行、cache無効化、document close、app終了時にcleanupする。以前のresourceへfallbackしない。
- frontendへは`web_session_id`等の識別子だけを返し、WebDriver等のresource本体は返さない。
- loop内stepは反復ごとに同じ`run_id + step_id`のresultを上書きし、最後に完了した反復の表示用resultだけを返す。全反復結果の取得contractは設けない。
- ②の`gui-standalone-run`はbackendのschema／preview result cacheを作らず、`result.getSchema`／`result.getPreview`の対象にしない。
- ②の`preview` modeは上限付きpreviewを`run.completed` eventで1回だけ返し、raw DataFrameを直後に解放する。
- ②の`excel` modeはactionの戻り値を単体実行resultのexport処理でExcelへ保存する。Excel出力をworkflow stepとして扱わず、完了情報だけを`run.completed` eventで返してraw DataFrameをexport終了時に解放する。
- `datavolume`の生成、保存、表示、bridge commandは202607版では実装しない。

### QWebChannel events

- eventはbackendからfrontendへ`messageToFrontend` signalで配信する。
- event 名は backend domain event とし、UI component 固有名にしない。
- eventは`v`、`kind: evt`、`type`、`ts`、`payload`を持つJSON envelopeにする。
- `run_id`を持つeventは`payload.run_id`を必須にする。
- terminal event は `run.completed`、`run.failed`、`run.cancelled` のいずれかにする。
- frontend は terminal event を受けたら summary を再取得して最終表示を確定する。
- BridgeClientはQWebChannelの初期化、response correlation、event購読を一元管理する。
- WebView reloadやchannel再初期化中もbackend processが生存していればrunを継続する。
- この復旧はbackend processが生存し、GUI frontendとのchannelだけが一時的に切れた場合を対象にする。backend停止、app終了、PC再起動からのrun復旧は対象外とする。
- 再接続時の`app.getStatus`は、開いているdocumentの`doc_session_id`、①のflowごとの`flow_id`／activeまたはlatest `run_id`／status、②のactive `run_id`／statusを軽量なrun索引として返す。
- 再接続後、frontendは最新summary／result／logsをcommandで再取得し、backendでflow／stepを再実行しない。
- 再接続中に未表示だった log は、backend の run log store から復元する。
- eventの完全replayは行わない。ただしlog復元に必要な`log_seq`は保持する。
- `gui-flow-run` で raw DataFrame が解放済みでも、`schema` / `preview` / `row_count` の表示用 result cache と log から画面を復元する。raw DataFrame の復元や全件データの再取得は行わない。
- Excel など chunk/stream 処理の進捗は `run.log` または `run.progress` で配信する。

### log

- `run.log` は UI 表示用の sanitized log とする。
- `run.log` はフロー全体実行、ステップ単体実行の両方で配信する。
- 必須項目は `run_id`、`log_seq`、`ts`、`level`、`category`、`message` とする。
- step に紐づく log は `step_id`、connector 実行に紐づく log は `connector_id` と `action_id` を必須にする。
- loop反復に紐づくlogは、1始まりの`iteration_no`を任意fieldとして持てる。
- loop開始／終了logは`iteration_total`を持ち、開始時に総反復件数を表示する。
- `trace_id` と `detail` は必要な場合だけ含める。
- `category` は `run`、`step`、`connector`、`system` を基本とする。
- log level は `DEBUG`、`INFO`、`WARNING`、`ERROR` のいずれかに正規化する。
- `detail` は許可済み項目だけを持つ構造化 object とし、params 全体を格納しない。
- connector/core の詳細 error は `trace_id` で追跡し、UI 向け message は短くする。
- UI 表示ログは `INFO` 以上を基本にする。
- `DEBUG` は `ziz --debug` など debug mode 時の詳細表示対象にする。
- token、password、API key などの秘密情報は、通常 log と debug log の両方で mask する。
- 通常の `run.log` event と通常実行ログには実 path を含めず、workspace 相対 path または mask 済み表記を使う。
- debug mode時は、local fileに保存するdebug logに限って実pathを記録してよい。debug logはfrontendへ配信しない。

保存 log は次の種類に分ける。監査 log は設けない。

| 種別 | 用途 | UI 表示 | 保存 |
| --- | --- | --- | --- |
| `run_log` | run／step／connectorの通常実行log。sanitized itemをbridge eventにも配信する | 表示する | 常時保存 |
| `gui_app_log` | bridge validation、host制御、run外のGUI backend運用log | 原則表示しない | GUI app起動時に保存 |
| `cli_app_log` | CLI の読込、引数検証、終了 code などの制御ログ | console には要約だけ表示 | CLI 実行時に保存 |
| `debug_log` | 依存解決、scheduler、cache 解放、性能、内部状態、mask 済み詳細 error | 配信しない | debug mode 時だけ保存 |

全 log file は同じ管理 directory に種別ごとの別 file 名で保存し、1 日単位、保存期間 10 日とする。全log種別を合計したdisk使用量は標準1 GiBをsoft上限とし、backend設定で変更可能にする。app起動時と日次rotation時に、10日を超えたfileを先に削除し、まだ上限を超える場合は古い日付のfileから日単位で削除する。当日fileは削除せず、当日中の一時的な上限超過は許容する。

`gui-flow-run`／`gui-step-run`／`gui-standalone-run`ではrunに直接関係する情報をrun log、それ以外のbridge validation／security／host制御情報をgui app logに記録する。`cli-flow-run`ではrun logとCLI app logを使い、gui app logは作成しない。

UI のログ欄には `run_log` の sanitized item を表示し、長大な raw log をそのまま流さない。

通常 run log のルール:

- 1 log item は短く、ユーザーが次の判断をできる内容にする。
- 同じ内容の連続 log は集約する。
- chunk/batch 処理は、件数、進捗、対象 step が分かる形式にする。
- loopは開始時に総反復件数、反復中は必要に応じて1始まりの反復回数、終了時に完了件数を記録する。総反復件数が0でも開始／終了logを各1件記録する。
- 通常の backend 制御 log は run の開始 / 終了、step の開始 / 終了、warning / error / cancel に限定する。
- 依存関係、実行候補順、scheduler の選択判断、cache 解放、性能時間は debug log のみに記録する。
- stack traceはUIに直接出さず、`trace_id`と短いerror messageを出す。mask済みの詳細はGUIではgui app log、CLIではCLI app logに記録する。
- 再接続後の復元のため、`log_seq` を run 内単調増加で持つ。
- run log store は file 保存を前提にする。
- run log fileは10日間保持するが、document closeまたはapp再起動後にterminal runのlogを画面へ自動復元しない。QWebChannelだけが一時的に再初期化され、対象documentが開いたままの場合の復元とは区別する。
- 保存先 path は backend 内部管理とし、frontend response には通常含めない。

debug log には、run 開始時に解決した依存関係と実行候補順、scheduler の選択理由と実際の選択順、raw DataFrame / result cache の保持・解放判断、run / step / connector の処理時間、backend 制御 component の詳細な内部状態を記録できる。

#### connector が利用する外部 process

- stdout は通常出力、stderr は warning / 診断 / error 出力として扱い、成否は stdout / stderr の有無ではなく exit code と exception で判定する。
- stdout は通常実行 log、stderr、connector exception、Python traceback は診断情報として扱う。
- 失敗時の error 詳細には、該当する場合だけ connector / action、exit code、exception type / message、exception chain、traceback、stderr、失敗までの stdout を含める。
- secret は常に mask し、異常な大量出力には文字数または byte 数の上限を設け、上限到達時は省略を明示する。
- backend 内部共通 component `ProcessRunner` を設け、process 起動、stdout / stderr stream、exit code、timeout、cancel、process tree 終了、secret mask、出力量上限、log 転送、encoding、working directory、environment を共通化する。
- command構築、Python wrapper／戻り値parse、action result contractはconnector側の責務とする。`ProcessRunner`を直接操作するbridge commandは作らない。
- 202607版のPython実行はapp同居venvに固定し、`env_path`指定、任意Python環境の選択、実行時のlibrary install、missing libraryの自動install、package管理commandは設けない。
- package管理機能を設けないことと、利用者が記述したPythonコードのsandboxは分ける。package install検出だけを目的として、ユーザーコード内の`subprocess`等を遮断しない。
- `PythonConnector.execute_python` は `main()` の戻り値を加工結果本体、`print` を通常実行 log、exception / traceback を error 詳細として扱う。
- `ShellConnector.execute_bat` と同種の Shell / BAT / CMD action は exit code で成否を判定し、stdout を通常実行 log、stderr を診断情報として扱う。
- `ChromeConnector.open_in_chrome` は起動後に終了を待たず stdout / stderr も取得しない detached 起動であるため、`ProcessRunner` の対象外とする。起動時の即時 error だけを検知する。
- `SeleniumConnector` は WebDriver library が driver / browser process lifecycle を管理するため、`ProcessRunner` の対象外とする。connector は library exception と session cleanup を扱う。
- `PlotlyConnector` の HTML 出力は外部 renderer を使わない。静止画像出力は Plotly / Kaleido が Chrome renderer を管理するため、`ProcessRunner` の対象外とし、connector は `write_image()` の完了と exception を扱う。
- 上記は直接 process 管理だけの例外であり、共通の error 正規化、secret mask、出力量上限、`trace_id` 付与は適用する。

#### desktop / host helper

- BigQuery 向け `gcloud` 認証 helper、`app.openExternal`、window 操作 helper、mouse 座標取得 helper は connector result、run log、data area に含めない。
- frontend には必要な structured response だけを返し、raw stdout / stderr は返さない。
- 成功時の要約はdebug log、失敗時の詳細はsecretをmaskしてgui app／host logに記録し、frontendには短いerrorと`trace_id`を返す。
- `gcloud` login 用外部 console の stdout / stderr は取り込まず、未検出、command 起動失敗、account 確認失敗、認証状態確認失敗だけを通常 log に記録する。account 名と access token は log / response に含めない。
- `app.openExternal` は URL の query / fragment を mask する。flow / step の `ChromeConnector.open_in_chrome` は desktop helper ではなく connector action として扱う。

log復元には`result.getLogs` commandを採用する。

- 1回の取得上限は500件とし、frontendから上限を拡張できない。
- cursorなしでは最新500件を返す。
- `before_seq`指定では、そのlogより前を最大500件返す。
- `after_seq`指定では、そのlogより後を最大500件返す。
- `before_seq`と`after_seq`は同時指定不可とし、itemsは常に`log_seq`昇順で返す。
- responseは`has_more_before`、`has_more_after`と、追加取得に使うcursorを返す。

```json
{
  "run_id": "gui_flw_019...",
  "after_seq": 123
}
```

Response `data`:

```json
{
  "run_id": "gui_flw_019...",
  "items": [
    {
      "log_seq": 124,
      "ts": "2026-07-14T00:00:00Z",
      "level": "INFO",
      "category": "step",
      "step_id": "01",
      "message": "10000 rows processed"
    }
  ],
  "next_after_seq": 124
}
```

### 失敗時 response

- command validation、security、権限、run conflictはresponseの`ok: false`で返す。
- run開始後のstep failureは開始command responseではなく、`run.failed` eventとsummaryで返す。
- error code は機械判定用、message はユーザー表示用、detail は allowlist 済みの構造化診断情報とする。
- error detail に token、実 path、秘密情報を含めない。

暫定 error code:

| code | 用途 |
| --- | --- |
| `E_VALIDATION` | request schema、必須項目、step_id 不正 |
| `E_SECURITY_POLICY` | dangerous/security policy で拒否 |
| `E_RUN_CONFLICT` | 同一GUI sessionですでに①が実行中、または②の同一実行元documentにactive runが存在 |
| `E_RUN_NOT_FOUND` | `run_id` が存在しない |
| `E_RUN_NOT_ACTIVE` | cancel 対象が実行中ではない |
| `E_RESULT_NOT_READY` | result がまだ生成されていない |
| `E_RESULT_NOT_FOUND` | 指定 step の result が存在しない |
| `E_INTERNAL` | 予期しない backend error |

## 確定事項

- 同一GUI sessionの①ワークフロー実行は、flow／step、保存済み／未保存、documentの違いを問わず同時に1件だけ許可する。
- ②ワークフロー外の単体実行は①と同時実行できる。②同士にはsession単位の論理的な件数上限を設けないが、②の同一実行元document（SQL／Python等、`.zizd`を除く）ではactive runを1件までとする。
- ①の1 runあたりの同時実行step数は標準4とし、backend設定で変更可能にする。
- step failure時はfail-fastとし、実行中stepへcancel要求、未開始stepを`skipped`、run全体を`error`にする。
- 既存 flow 互換は気にしない。
- フロー全体実行では、完了済み step の途中 result/log を data area に表示できるようにする。
- ステップ単体実行では、途中 schema/preview/row_count は不要だが、log は実行中に表示する。
- cancel は interrupt-first とし、協調キャンセル checkpoint を併用する。
- 強制 kill は標準にしない。
- QWebChannel eventはBridgeClientで購読し、channel再初期化後はsummary／result／logs再取得で状態を復旧する。
- 再接続中に未表示だった log は run log store から復元する。
- log設計は`run_log`、`gui_app_log`、`cli_app_log`、`debug_log`を分け、監査logは設けない。
- UI 表示ログは `INFO` 以上を基本にし、`DEBUG` は debug mode 時の詳細表示対象にする。
- log file は同じ管理 directory に別 file 名で保存し、1 日単位、保存期間 10 日とする。
- 全log種別を合計したdisk使用量は標準1 GiBをsoft上限とし、app起動時と日次rotation時に古い日付のfileから削除する。当日fileは削除しない。
- `debug_log` は debug mode 時のみ作成し、local file に限って実 path を記録してよい。
- `run.log` は `category` を含む共通項目と、step / connector に応じた識別子を持つ。
- log復元command`result.getLogs`を採用する。
- raw DataFrame の寿命管理は `../202607-runtime-data-lifetime.md` に分離する。
- `datavolume`は生成、保存、表示、bridge commandの全てを202607版から削除する。

## 確認事項

現時点ではなし。

## command `run.start`

Payload:

```json
{
  "doc_session_id": "docsession_...",
  "mode": "dataflow",
  "document_ref": "docref_...",
  "flow_id": "01",
  "document": {},
  "step_id": "01"
}
```

`flow_id` は `.zizd` 内で実行対象 flow を選択する必須項目とする。`step_id` は任意で、指定時は `gui-step-run`、未指定時は `gui-flow-run` とする。

②ワークフロー外の単体実行である`gui-standalone-run`のPayload:

```json
{
  "doc_session_id": "docsession_...",
  "run_kind": "standalone",
  "connector_id": "BQConnector",
  "action_id": "execute_sql_file",
  "result_mode": "preview",
  "dry_run": false,
  "params": {}
}
```

②のrequestは、SQL／Python等の実行元documentを識別する`doc_session_id`を必須とする。一方で、`.zizd`の`document_ref`、`flow_id`、`step_id`は持たない。`result_mode`はactionのcatalog定義に従う。backendはcatalogとparams schemaを検証し、`standalone_allowed`でないactionと、そのactionが対応しないresult modeを拒否する。

`result_mode: "excel"`では、source actionとは別にcatalogで`export_allowed`と定義されたactionを`result_export`へ指定する。

```json
{
  "doc_session_id": "docsession_...",
  "run_kind": "standalone",
  "connector_id": "BQConnector",
  "action_id": "execute_sql",
  "result_mode": "excel",
  "dry_run": false,
  "params": {},
  "result_export": {
    "connector_id": "ExcelConnector",
    "action_id": "write_excel",
    "params": {}
  }
}
```

`result_export`は`result_mode: "excel"`の通常実行で必須とし、それ以外のmodeとdry runでは指定しない。backendはsource resultを予約済みruntime keyへ一時的に置き、export actionのinput refへ投影する。予約keyは保存形式、event、frontend responseへ出さない。

## `app.getStatus` run index

`app.getStatus`はsummary／preview／logs本体を含めず、次の軽量索引を返す。

```json
{
  "session_id": "session_...",
  "run_index": {
    "workflows": [
      {
        "doc_session_id": "docsession_...",
        "flow_id": "01",
        "run_id": "gui_flw_019...",
        "run_kind": "flow",
        "status": "success",
        "invalidated_step_ids": ["01"]
      },
      {
        "doc_session_id": "docsession_...",
        "flow_id": "01",
        "run_id": "gui_stp_019...",
        "run_kind": "step",
        "step_id": "02",
        "status": "success"
      }
    ],
    "standalone": [
      {
        "doc_session_id": "docsession_sql_...",
        "run_id": "gui_std_019...",
        "status": "running"
      }
    ]
  }
}
```

`workflows`は、開いているdocumentについて、flowごとの最新flow runと
stepごとの最新step runを返す。step runだけ`step_id`を持つ。
設定変更で一部の表示結果を無効化したrunは`invalidated_step_ids`を持ち、
frontendは該当stepの旧resultへfallbackしない。`standalone`はevent
replay／result API復元を行わないためactive runだけを返す。

`.zizd`を使うflow／step実行のResponse `data`:

```json
{
  "accepted": true,
  "run_id": "gui_stp_019...",
  "trace_id": "trace_...",
  "execution_source": "gui",
  "run_kind": "step",
  "flow_id": "01",
  "step_id": "02",
  "session_id": "session_...",
  "status": "running",
  "started_at": "2026-07-14T00:00:00Z"
}
```

`step_id`はstep実行時だけ返し、flow実行時は省略する。

②の単体実行のResponse `data`:

```json
{
  "accepted": true,
  "run_id": "gui_std_019...",
  "trace_id": "trace_...",
  "execution_source": "gui",
  "run_kind": "standalone",
  "session_id": "session_...",
  "doc_session_id": "docsession_...",
  "status": "running",
  "started_at": "2026-07-14T00:00:00Z"
}
```

## command `run.cancel`

Payload:

```json
{
  "run_id": "gui_flw_019..."
}
```

Response `data`:

```json
{
  "accepted": true,
  "run_id": "gui_flw_019..."
}
```

## command `result.getSummary`

Payload:

```json
{
  "run_id": "gui_flw_019..."
}
```

Response `data`:

```json
{
  "run_id": "gui_flw_019...",
  "trace_id": "trace_...",
  "execution_source": "gui",
  "run_kind": "flow",
  "flow_id": "01",
  "session_id": "session_...",
  "flow_name": "売上データ作成",
  "status": "success",
  "started_at": "2026-07-14T00:00:00Z",
  "finished_at": "2026-07-14T00:00:05Z",
  "duration_ms": 5000,
  "step_count": 3,
  "success_count": 3,
  "error_count": 0,
  "error": null
}
```

## command `result.getSchema`

Payload:

```json
{
  "run_id": "gui_flw_019...",
  "step_id": "01"
}
```

Response `data`:

```json
{
  "run_id": "gui_flw_019...",
  "step_id": "01",
  "columns": [
    {
      "origin_name": "顧客ID",
      "new_name": "customer_id",
      "description": "顧客ID",
      "ziz_datatype": "STRING"
    }
  ]
}
```

## command `result.getPreview`

Payload:

```json
{
  "run_id": "gui_flw_019...",
  "step_id": "01"
}
```

Response `data`:

```json
{
  "run_id": "gui_flw_019...",
  "step_id": "01",
  "columns": ["customer_id"],
  "rows": [["C001"]],
  "row_count": 1,
  "truncated": false
}
```

## command `result.invalidateSteps`

stepの実行内容へ影響するproperty、schema、edge、開始変数等を変更した場合、
frontendは旧resultを表示せず、次のcommandでbackendの表示cacheと
単一step実行用raw contextを同時に無効化する。

Payload:

```json
{
  "doc_session_id": "docsession_...",
  "step_ids": ["01", "02"]
}
```

Response `data`:

```json
{
  "doc_session_id": "docsession_...",
  "invalidated_step_ids": ["01", "02"],
  "removed_run_ids": ["gui_stp_019..."]
}
```

`step_ids`は1件以上必須とする。document内で`step_id`は一意なため
`flow_id`は送らない。無効化後の`result.getSchema`／`result.getPreview`は
旧cacheを返さず、表示可能な結果がなければ`E_RESULT_NOT_FOUND`とする。

## event envelope

responseとeventは`messageToFrontend` signalから受け取り、`kind`で振り分ける。

```json
{
  "v": "1",
  "kind": "evt",
  "type": "run.progress",
  "ts": "2026-07-14T00:00:00Z",
  "payload": {}
}
```

## event payload

### `run.progress`

```json
{
  "run_id": "gui_flw_019...",
  "stage": "running",
  "percent": null,
  "message": "実行を開始しました。"
}
```

### `run.log`

```json
{
  "run_id": "gui_flw_019...",
  "log_seq": 124,
  "step_id": "01",
  "connector_id": "BQConnector",
  "action_id": "load_data",
  "ts": "2026-07-14T00:00:00Z",
  "level": "INFO",
  "category": "connector",
  "message": "..."
}
```

`step_id` は step log、`connector_id` / `action_id` は connector log の場合に必須とする。loop反復中は1始まりの`iteration_no`を追加できる。`trace_id` と allowlist 済みの `detail` は必要な場合だけ追加する。

### `run.stepStatus`

```json
{
  "run_id": "gui_flw_019...",
  "step_id": "01",
  "status": "success",
  "message": ""
}
```

### `run.completed` / `run.failed` / `run.cancelled`

```json
{
  "run_id": "gui_flw_019...",
  "status": "success",
  "trace_id": "trace_..."
}
```

`run.failed`は、開始後の失敗理由を画面表示できるように、sanitized済みの
`error`を追加で持つ。

```json
{
  "run_id": "gui_std_019...",
  "status": "error",
  "trace_id": "trace_...",
  "error": {
    "code": "E_INTERNAL",
    "message": "実行に失敗しました。",
    "detail": {},
    "retryable": false,
    "trace_id": "trace_..."
  }
}
```

②の`gui-standalone-run`の`run.completed`は、actionと選択modeに応じて上限付き`preview`、Excel出力完了情報、または実行結果metadataを任意fieldとして持てる。この単体実行resultはevent replay／result API復元の対象外とする。

### `mouse.coordinateCapture.preview` / `mouse.coordinateCapture.selected` / `mouse.coordinateCapture.cancelled`

```json
{
  "capture_id": "coordinate_...",
  "x": 100,
  "y": 200
}
```

`cancelled` の場合、`x` と `y` は省略できる。
