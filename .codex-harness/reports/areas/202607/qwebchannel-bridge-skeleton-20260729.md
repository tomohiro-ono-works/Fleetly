# 202607 QWebChannel Bridge Skeleton Result

## 結果

QWebChannelのtransport、JSON contract、dispatcher、GUI threadへのmessage dispatchを分離した。

WebViewへ登録する独自QObjectは`backendBridge` 1個、独自public memberは`postMessage(str)` slotと`messageToFrontend(str)` signalだけとした。localhost serverは追加していない。

## 追加した責務

| ファイル | 責務 |
| --- | --- |
| `app/gui/bridge_contract.py` | protocol v1 envelopeのparse／validation、response／event生成 |
| `app/gui/bridge_dispatcher.py` | command allowlist、handler dispatch、共通error mapping |
| `app/gui/bridge_events.py` | workerからGUI owner threadへのqueued message dispatch |
| `app/gui/qwebchannel_transport.py` | QObject公開面、JSON送受信、非同期preview worker、終了時受付停止 |

`bridge_contract`と`bridge_dispatcher`はPySide6、core、connectorをimportしない。

## 既存経路への接続

- `host.py`は`QWebChannelTransport`だけを`backendBridge`として登録する。
- `BridgeRuntime.handle_message`は`BridgeCommandDispatcher`へ委譲する。
- responseは`ok／data`または`ok／error`の共通contractへ統一した。
- eventと非同期responseは`BridgeMessageQueue`を通してQObject owner threadからsignal送信する。
- frontendは引き続き`BridgeClient`相当の`static/js/bridge.js`だけが`backendBridge`を参照する。
- app終了時はchannel登録解除、transport受付停止、preview worker待機、run cancel通知、run worker待機を行う。

## 段階移行として残す範囲

- 現行`flow.*` command名はtask 010で`documents.*`へ移行する。
- dispatcherはhandler map以外を知らないが、handler本体の一部はまだ`BridgeRuntime`に残る。
- catalog、documents、workspace、run／resultのapplication service分離はtask 009以降で行う。
- 外部処理がcancelへ応答しない場合、Python threadを強制終了せずapp process終了へ委ねる。

## Verification

- `py_compile`: success
- `static/js/bridge.js`の`node --check`: success
- QWebChannel contract／dispatcher／transport test: 11 tests success
- `tests/python`全体: 63 tests success、2 skipped、failed 0
- `git diff --check`: errorなし

実QWebChannel登録、public member、同期response、非同期response／eventのowner thread配送、shutdown拒否をPython integration testで確認した。既存Playwright testは高水準の`zizBridge` mockを使い、生のQWebChannel envelopeには依存していない。

## 変更していない既存差分

作業開始前から変更されていたconnector、`core/workflow_engine.py`、`static/js/ui.fields.js`、`static/js/ui.node.detail.js`、`static/js/ui.node.shared.js`には変更を加えていない。

## 次の境界

task 008でnavigation、command security profile、payload validation、mask／sanitizeを共通境界へ追加する。
