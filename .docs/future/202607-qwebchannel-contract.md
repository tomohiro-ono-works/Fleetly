# 202607 QWebChannel contract 索引

## 位置づけ

この文書は、202607版QWebChannel bridgeのJSON command／response／event schemaの入口である。

詳細schemaはcommand分類ごとの文書へ分ける。`qwebchannel/`はHTTP endpointやnetwork APIではなく、QWebChannel command／response／event contractを表す。

## 分類

| 分類 | 対象 | 詳細 |
| --- | --- | --- |
| 共通 | message envelope、共通型、ID、validation | `qwebchannel/common.md` |
| app／auth／input | app状態、UI event、window、external open、Google auth、座標取得 | `qwebchannel/session-app-auth-input.md` |
| catalog／config | connector／action catalog、form schema、data area policy | `qwebchannel/catalog-config.md` |
| documents | `.zizd` document一覧、読込、保存、document session close | `qwebchannel/documents.md` |
| run／result／event | run start、cancel、summary、schema、preview、logs、event | `qwebchannel/run-result-events.md` |
| workspace | root、list、stat、read、write、delete | `qwebchannel/workspace.md` |
| file dialog／preview | file dialog、Excel／CSV preview | `qwebchannel/file-dialog-preview.md` |
| security profile | command別validation／capability profile | `qwebchannel/security-policy-profile.md` |

## 読む順番

1. `qwebchannel/common.md`
2. 対象commandの分類文書
3. `qwebchannel/security-policy-profile.md`
4. `202607-qwebchannel-bridge.md`
5. `202607-qwebchannel-security.md`

## 重要な決定

- command／response／eventはJSON messageとする。
- commandは`backendBridge.postMessage`、response／eventは`messageToFrontend` signalを使う。
- commandとresponseは`id`で対応付ける。
- responseは成功／失敗の共通envelopeを持つ。
- HTTP method、status、header、port、token、CORS、Origin、SSEはcontractに含めない。
- 結果取得は`run_id + step_id`を正本にする。
- `flow_key`はpublic bridge contractではなくbackend内部扱いにする。
- command payloadはschema validation後にsecurity profileの自動検証を通す。
- 正規のGUI／CLI操作に処理内容ごとの追加確認dialogは表示しない。
