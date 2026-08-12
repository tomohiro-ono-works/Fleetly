# 202607 Bridge Security Policy Profile

## 対象

QWebChannel bridge command別のsecurity profileを定義する。

`../202607-qwebchannel-security.md`は全体原則、この文書はcommandごとの適用表である。

## profile種別

| profile | 用途 | 必須検査 | 追加確認 |
| --- | --- | --- | --- |
| `read` | 状態を変えない参照 | command allowlist、payload schema、result上限 | 不要 |
| `read_path` | pathやpreviewを伴う参照 | allowlist、payload schema、path正規化、size／件数上限 | 不要 |
| `write` | 保存、削除、root変更、状態更新 | allowlist、payload schema、path／競合条件 | 不要 |
| `execute` | run、外部起動、認証helper | allowlist、payload schema、catalog／固定操作validation | 不要 |
| `host` | desktop host能力に依存する操作 | allowlist、payload schema、host capability、GUI thread dispatch | 不要 |

eventはfrontendから実行するcommandではないためprofileを持たない。backendが生成したallowlist済みeventだけを`messageToFrontend` signalへ送る。

## 共通必須

- WebViewへ公開するQObjectは`backendBridge`だけにする。
- すべてのcommandはprotocol／envelope validation、command allowlist、payload schema validationを通す。
- secret、access token、認証情報をresponse、event、logへ出さない。
- 通常logのpathはmaskし、local debug logだけ実pathを許可する。
- 実行／外部操作はschema validation後、実処理前にsecurity profileを自動検証する。
- workspace外pathであることだけを理由に拒否または確認対象にしない。
- security profileは利用者へ確認dialogを表示する仕組みではない。
- frontendが送る`security_profile_id`を信用せず、commandとcatalogからbackendが決定する。

## command profile

### app／auth／input

| command | profile | 追加確認 | 主な制約 |
| --- | --- | --- | --- |
| `app.getStatus` | `read` | 不要 | security summaryはsecretを含めない |
| `app.logUiEvent` | `write` | 不要 | log payloadをsanitizeし、secretを記録しない |
| `app.windowControl` | `host` | 不要 | host capability必須。未保存close確認はdocument lifecycleとして別扱い |
| `app.openExternal` | `host` | 不要 | host capability必須。`http`／`https` schemeとURL policyを検証し、WebView内で開かない |
| `app.getSuggestIndex` | `read` | 不要 | connector名は英数字と`_`だけを許可 |
| `app.googleAuthLogin` | `execute` | 不要 | BigQuery向けgcloud commandを固定し、任意command／modeを受け付けない |
| `app.googleAuthStatus` | `read` | 不要 | access tokenを返さない |
| `mouse.coordinateCapture.start` | `host` | 不要 | host capability必須 |

### catalog／config

| command | profile | 追加確認 | 主な制約 |
| --- | --- | --- | --- |
| `catalog.getConnectors` | `read` | 不要 | 実path、secretを含めない |
| `catalog.getActions` | `read` | 不要 | security profile id以外の内部policyを過剰に返さない |
| `catalog.getForms` | `read` | 不要 | form defaultへsecretを含めない |
| `catalog.getDataAreaPolicy` | `read` | 不要 | UI表示policyだけを返す |
| `catalog.getSecurityPolicySummary` | `read` | 不要 | UI表示用summaryだけを返す |

### documents

| command | profile | 追加確認 | 主な制約 |
| --- | --- | --- | --- |
| `documents.list` | `read` | 不要 | document tokenを返し、実pathを常用しない |
| `documents.load` | `read_path` | 不要 | pathを正規化。dialog使用時はhost capability必須 |
| `documents.save` | `write` | 不要 | pathとdocumentを検証。workspace外保存、別名保存、上書きも追加確認しない |
| `documents.close` | `write` | 不要 | document sessionに属するhidden stateを破棄する |

### run／result

| command | profile | 追加確認 | 主な制約 |
| --- | --- | --- | --- |
| `run.start` | `execute` | 不要 | flow snapshot、connector／action catalog、params schemaをbackendで検証。standaloneは`standalone_allowed`必須 |
| `run.cancel` | `write` | 不要 | 対象runが現在のGUI app contextに属すること |
| `result.getSummary` | `read` | 不要 | runの存在と参照可能性を検証 |
| `result.getSchema` | `read` | 不要 | `run_id + step_id`を正本keyにする |
| `result.getPreview` | `read` | 不要 | preview row数とcell sizeに上限を設ける |
| `result.getLogs` | `read` | 不要 | `after_seq`を検証し、対象run logだけを返す |
| `result.invalidateSteps` | `write` | 不要 | `doc_session_id`と1件以上の`step_ids`を検証し、対象documentのcacheだけを無効化する |

### workspace

| command | profile | 追加確認 | 主な制約 |
| --- | --- | --- | --- |
| `workspace.getRoot` | `read` | 不要 | UI表示用pathを通常logへ出さない |
| `workspace.setRoot` | `write` | 不要 | pathを正規化し、利用者指定directoryをrootにできる |
| `workspace.pickRoot` | `host` | 不要 | host folder dialog capability必須 |
| `workspace.list` | `read_path` | 不要 | path正規化と件数上限 |
| `workspace.stat` | `read_path` | 不要 | pathを正規化 |
| `workspace.readText` | `read_path` | 不要 | path正規化とsize上限 |
| `workspace.writeText` | `write` | 不要 | `expected_mtime_ns`不一致は`E_CONFLICT` |
| `workspace.mkdir` | `write` | 不要 | pathを正規化 |
| `workspace.delete` | `write` | 不要 | folderは`recursive: true`を必須にする |

### file dialog／preview

| command | profile | 追加確認 | 主な制約 |
| --- | --- | --- | --- |
| `file.pickFile` | `host` | 不要 | host capability必須。実pathまたはsession内`PathRef`を返す |
| `file.pickFolder` | `host` | 不要 | host capability必須。実pathまたはsession内`PathRef`を返す |
| `preview.readExcel` | `read_path` | 不要 | workspace内外のpath／`PathRef`とpreview optionを検証 |
| `preview.readCsv` | `read_path` | 不要 | path／`PathRef`、encoding、delimiterを検証 |

## 追加確認を行わない範囲

- 正規のGUI／CLI flowに定義されたconnector action。
- workspace内外のfile read／write／deleteとdirectory操作。
- Shell／Python、Selenium、外部DB write。
- `app.openExternal`、BigQuery向けgcloud認証helper、desktop host操作。

入口検証とaction固有validationは省略しない。未保存documentのclose等、data loss防止のUI確認はsecurity confirmationとは別に扱う。

Python実行はapp同居venvに固定し、zizaiからpackage管理UI／actionやmissing libraryの自動installを提供しない。一方、package install検出だけを目的として利用者記述Python内の`subprocess`等をsandbox遮断する仕様にはしない。

## browser開発方針

外部browser単体へproduction QWebChannel bridgeを公開しない。browserでのcomponent開発／Playwrightはmock BridgeClientを使用する。

host操作を含む結合testはPySide WebView内で行い、production bridgeとbrowser mockを自動fallbackさせない。

## bridge operation log

監査logは設けない。bridge commandのvalidation失敗とhost制御失敗はapp operation logへ記録する。

記録項目は`trace_id`、command type、profile、decision、reason、必要な場合だけ`run_id`とする。secret、認証情報、未maskの実pathは記録しない。

## 実装時の注意

- profile判定はfrontendではなくbridge dispatcherで行う。
- application serviceを呼ぶ前にprofileを決定する。
- connector／action別profileはbackendがcatalogから解決する。
- profile差異をQWebChannel slot追加で表現せず、同じdispatcher経路で扱う。
