# 008 202607 QWebChannel Security

## Status

共通security境界は完了（2026-07-29）。backend catalog実データとの照合はtask 009で接続する。

## Objective

PySide WebView／QWebChannelの公開面、navigation、command validationを共通境界で検証できる状態にする。

localhost向けtoken、Origin／Referer、CORS、HTTP content-type middlewareは作らない。

## Scope

- 対象:
  - WebView navigation／popup policy
  - QWebChannel transport
  - bridge contract／dispatcher
  - command security profile
  - log／error sanitizer
- 主な実装:
  - bundled local frontendの固定entry
  - remote navigation遮断とexternal browser委譲
  - QObject／public memberの最小化
  - command allowlist
  - payload schema validation
  - catalog／path／host capabilityのbackend再検証
  - secret／実pathのmask
- 対象外:
  - connector/action固有security policyの全面変更
  - localhost server、session token、Origin／Referer、CORS
  - 正規flow操作に対する追加確認dialog

## References

- `.docs/future/202607-qwebchannel-security.md`
- `.docs/future/202607-qwebchannel-contract.md`
- `.docs/future/qwebchannel/security-policy-profile.md`
- `.docs/future/qwebchannel/common.md`
- `.docs/future/202607-gui-backend-structure.md`

## Required Profiles

| profile | 用途 |
| --- | --- |
| `read` | pathを伴わない参照 |
| `read_path` | path、hidden ref、previewを伴う参照 |
| `write` | 保存、root変更、file／directory変更 |
| `execute` | flow／step実行、cancel、外部操作、固定認証helper |
| `host` | window、dialog、coordinate、external open |

## Implementation Tasks

1. productionでbundled local frontendの固定entryだけをWebViewへ読み込む。
2. remote navigation、popup、新規window要求をhostで遮断し、許可済みURLだけ外部browserへ委譲する。
3. WebViewへ登録するQObjectとpublic memberを検査する。
4. protocol version、command type、payloadをapplication service到達前に検証する。
5. connector／action、params、path、host capabilityをbackendで再検証する。
6. frontendが送るsecurity profileを信用せず、command typeからbackendで解決する。
7. productionのdevtoolsとremote debuggingを無効にする。
8. response、event、通常logからsecretと未mask実pathを除く。
9. user inputのHTML挿入を避け、CSPとsanitizeを適用する。

## Acceptance Criteria

- remote pageへ`backendBridge`が公開されない。
- 未知command、version不一致、不正payloadがservice到達前に拒否される。
- catalogにないconnector／actionとschema不適合paramsが拒否される。
- productionでdevtools／remote debuggingが無効である。
- localhost listening port、session token、CORS処理が追加されていない。
- 正規flow実行でworkspace外pathやconnector種別を理由とする追加確認dialogが出ない。
- secret、access token、未mask実pathが通常response／event／logへ出ない。

## Verification

- unit:
  - command profile resolver
  - payload schema validation
  - catalog／path／capability validation
  - log／error sanitizer
- integration:
  - remote URLがWebView内へ遷移しない。
  - workspace内の任意HTMLへbridgeが公開されない。
  - 不正commandがapplication serviceを呼ばない。
  - 正規のGUI flow実行とCLI flow実行が追加確認なしで動作する。

## Notes

- portを開かないことは防御の一部であり、XSS、asset改ざん、過剰なQObject公開への対策は別途必要である。
- BigQuery向けgcloud認証helperは、実行commandを固定し、tokenをfrontend／response／logへ出さない。
- task 008ではflow内のconnector／action／params構造検証とcatalog validator hookまで実装する。connector／action一覧をbridgeへ重複hard codingせず、catalogにないactionとform schema不適合paramsの実判定はtask 009のcatalog serviceから同hookへ接続する。
- workspace root自体は任意の絶対pathを選択できる。workspace commandの`rel_path`による選択済みroot外への脱出とは区別する。
