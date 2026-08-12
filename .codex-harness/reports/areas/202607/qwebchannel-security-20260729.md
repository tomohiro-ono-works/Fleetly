# 202607 QWebChannel Security Result

## 結果

QWebChannelのcommand profile、payload validation、host navigation、secret／path maskを共通境界へ追加した。localhost server、session token、Origin／CORS処理は追加していない。

## 追加した責務

| ファイル | 責務 |
| --- | --- |
| `app/gui/bridge_security.py` | `read`／`read_path`／`write`／`execute`／`host` profile、command別payload schema、path／URL／host capability検証 |
| `app/gui/host_navigation.py` | bundled asset、main-frame page、qrc resource、remote URLの許可判定 |
| `shared/security_sanitizer.py` | secret、credential query、通常log pathの共通mask |

dispatcherはhandler実行前にbackend定義のprofileとpayload schemaを検証する。frontendから`security_profile_id`を送っても未知fieldとして拒否する。

## WebView境界

- production entryをinstallation配下の`static/home.html`へ固定した。
- main frameは`home.html`、`dataflow.html`、`settings.html`だけを許可する。
- asset requestはbundled static配下、Qt同梱`qwebchannel.js`、必要な`data`／`blob`だけを許可する。
- `http`／`https` main-frame navigationとpopupはWebView内で開かず、hostの外部browserへ委譲する。
- remote debugging環境変数／flagを除去し、DevToolsは既存どおり`--debug`時だけ生成する。
- 3つのproduction HTMLへCSPを追加し、inline script、remote connect、object、外部frameを禁止した。workspaceが埋め込む`dataflow.html`だけは同一origin frameを許可する。

## Bridge validation

- envelope size、command id／type形式、ISO 8601 timestampを検証する。
- 現行の全31 commandにbackend profileとfield allowlistを定義した。
- unknown field、型不一致、path traversal、危険URL、host capability不足をhandler到達前に拒否する。
- `flow.run`はstep、connector、action、params構造を検証し、catalog validator hookを呼ぶ。
- directory削除は`recursive: true`を必須にした。

backend catalog定義はtask 009の範囲である。catalogにないconnector／actionとform schema不適合paramsの実データ照合は、bridgeへ一覧を重複実装せず、task 009のcatalog serviceから既存hookへ接続する。

## Mask／XSS

- success responseは`access_token`等のsecret fieldをmaskする。
- errorとeventはsecretに加えて偶発的な実pathをmaskする。
- 通常app logと`execution.log`はpathをmaskする。debug modeのlocal app logだけpathを許可できる。
- UI表示契約で明示したworkspace root／`PathRef.display_hint`はsuccess responseで保持する。
- workspace error messageのHTML文字列挿入を`textContent`へ変更し、汎用`utils.el`の`html`属性を禁止した。

## Verification

- security unit test: 13 tests success
- QWebChannel skeleton test: 11 tests success
- `tests/python`全体: 76 tests success、2 skipped、failed 0
- Playwright:
  - `project-select.spec.js`: success
  - `tmp-save-smoke.spec.js`: success
  - `data-panel-visibility.spec.js`: 2 success、1既存前提不成立
- `py_compile`／変更JavaScriptの`node --check`: success
- `git diff --check`: errorなし

`data-panel-visibility`の失敗ケースは初期nodeが生成されない既存状態で、CSPを除いた比較でも同じだったため今回のsecurity変更による回帰ではない。

## 変更していない既存差分

作業開始前から変更されていたconnector、`core/workflow_engine.py`、`static/js/ui.fields.js`、`static/js/ui.node.detail.js`、`static/js/ui.node.shared.js`には変更を加えていない。

## 次の境界

task 009でbackend catalog定義とcatalog serviceを作り、connector／action／form schema照合をsecurity validator hookへ接続する。
