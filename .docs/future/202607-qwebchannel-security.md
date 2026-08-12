# 202607 QWebChannel security 仕様

## 位置づけ

この文書は、202607版のPySide WebView／QWebChannel境界におけるsecurity方針を定義する。

command別の適用profileは`qwebchannel/security-policy-profile.md`を正本とする。

## 基本方針

QWebChannel方式ではlocalhost portを開かないため、外部networkや外部Web pageからbackendへ直接HTTP requestを送る経路を持たない。

主な防御対象は、WebViewへの不正navigation、remote contentへのbridge公開、XSS、改ざんされたlocal asset、過剰なQObject公開、不正command／payload、secret／pathの漏えいである。

## 必須要件

| 項目 | 要件 |
| --- | --- |
| page source | productionではbundled local frontendの固定entryだけを読み込む |
| navigation | app内navigationをallowlistし、remote pageへの遷移をWebView内で許可しない |
| external link | `http`／`https` URLは検証後にhost側の外部browserで開く |
| bridge object | WebViewへ登録するQObjectは`backendBridge`だけにする |
| public member | `postMessage` slotと`messageToFrontend` signalに限定する |
| command | command typeをallowlistし、未知commandを拒否する |
| payload | commandごとのschema validationを必須にする |
| backend validation | connector／action catalog、params、path、host capabilityをbackendで再検証する |
| WebEngine setting | local contentからremote URLへの直接accessを原則無効にする |
| developer tools | productionではdevtoolsとremote debuggingを無効にする |
| logging | secretを記録しない。通常logではpathをmaskし、local debug logだけ実pathを許可する |

localhost用のbind、random port、session token、Host、Origin／Referer、CORS、cookie、HTTP content-type検証は不要であり、実装しない。

## WebView trust boundary

- `backendBridge`はbundled app pageだけに公開する。
- remote pageを同じWebViewへ読み込まない。
- link click、popup、新規window要求はhostで捕捉し、URL policy検証後に外部browserへ委譲する。
- frontend assetの読込rootを固定し、任意local HTMLをapp pageとして開かない。
- Pythonから任意JavaScript textを組み立てて実行する方式を通常通信に使わない。
- `qwebchannel.js`は配布物として固定したversionを使用し、licenseと更新元を管理する。

## Bridge validation

bridge dispatcherはapplication serviceを呼ぶ前に次を検証する。

1. messageが有効なJSON objectであること。
2. protocol version、`kind`、`id`、`type`が有効であること。
3. command typeがallowlistに存在すること。
4. payloadがcommand schemaに適合すること。
5. connector／actionがcatalogに存在し、paramsがform schemaに適合すること。
6. path、対象存在、file／directory種別、権限、競合条件がcommand要件に適合すること。
7. window／dialog／coordinate等で必要なhost capabilityが存在すること。

frontendが送るconnector、action、security profile、pathを無条件に信用しない。

`bridge_security`はcommand別payloadとflow内のconnector／action／params構造を検証し、backend catalog validatorを呼ぶ。catalog定義とform schemaの実データはcatalog serviceが所有し、security境界へvalidatorとして注入する。bridge側にconnector／action一覧を重複hard codingしない。

workspace commandの`rel_path`は選択済みroot／config内の相対pathとして検証する。一方、利用者は任意の絶対pathをworkspace rootとして選択でき、file dialog／previewもworkspace内外の対象を扱える。workspace外であること自体を拒否理由にしない。

## 実行・外部操作

正規のGUI／CLIから開始したflowに定義されているETL／RPA処理は、workspace外path、file write／delete、Shell／Python、Selenium、外部DB writeを含めて追加確認なしで実行する。

workspace外pathであることだけを理由に拒否または確認対象にしない。

connector／actionを介さず任意OS commandや任意処理を受け付けるbridge commandは作らない。BigQuery向けgcloud認証helperだけは、実行commandを固定したdesktop helperとして扱う。

## XSS対策

QWebChannelはportを開かなくても、XSSがあると正規pageからbridge commandを送信できるため、XSS対策を必須にする。

- user inputをHTMLとして直接挿入せず、`textContent`を優先する。
- HTMLを扱う場合はsanitizeする。
- inline script、`eval`、文字列からのfunction生成を禁止する。
- CSPでscript／style／connect先を必要最小限にする。
- public DOM classやdata属性へsecretを埋め込まない。
- error detailはallowlist済みfieldだけfrontendへ返す。

`workspace.getRoot`／`workspace.setRoot`／`workspace.pickRoot`の明示pathと、file dialog／previewの`PathRef.display_hint`は各command contractで定義したUI表示用dataとして返せる。汎用error、event、operation logへ偶発的に混入した実pathはmaskする。

## Local asset対策

- 配布物のfrontend assetはinstallation directory配下の固定pathから読み込む。
- project／workspace内のHTMLをapp shellとして読み込まない。
- app assetとuser-created fileを同じtrust levelで扱わない。
- asset改ざん対策としてinstaller／package署名または配布物hash検証を検討対象にする。

## 残リスク

- bundled frontend自体のXSS。
- local installation assetの改ざん。
- productionでdevtools／remote debuggingを誤って有効にする実装ミス。
- remote pageへnavigationした状態でbridgeを残す実装ミス。
- command allowlistまたはpayload validationの漏れ。
- error／logへのsecretや実pathの混入。

通常logはpathをmaskする。debug modeで実pathを許可するのはlocal app logだけとし、QWebChannel response／eventのerrorやrun log eventには適用しない。

## 検証項目

- GUI起動中にlocalhost listening portが作られないこと。
- `backendBridge`以外のbackend QObjectがWebViewへ登録されないこと。
- 未知command、version不一致、不正payloadがapplication service到達前に拒否されること。
- remote URLがWebView内に遷移せず、外部browser open requestへ分離されること。
- user-selected HTMLやworkspace内HTMLへbridgeが公開されないこと。
- productionでdevtools／remote debuggingが無効であること。
- run commandがcatalogにないconnector／actionとschema不適合paramsを拒否すること。
- 正規flow実行でworkspace外pathやconnector種別を理由とする追加確認dialogが出ないこと。
- secret、access token、未maskのpathが通常response／event／logへ出ないこと。
