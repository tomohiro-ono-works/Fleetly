# 007 202607 QWebChannel Bridge Skeleton

## Status

完了（2026-07-29）。

## Objective

202607版GUIのQWebChannel transportとbridge dispatcherを、application serviceから分離した最小骨格へ整理する。

既存のPySide WebView／QWebChannelを維持し、localhost serverは追加しない。

## Scope

- 対象:
  - `app/gui/host.py`
  - `app/gui/bridge.py`
  - `app/gui/`配下のQWebChannel transport／dispatcher／contract／event分割
- 主な実装:
  - `backendBridge` 1 objectの登録
  - `postMessage(json_text)` slot
  - `messageToFrontend(json_text)` signal
  - JSON envelope parse／validation
  - command allowlistとdispatcher
  - application service呼出し境界
  - app終了時のchannel／worker停止
- 対象外:
  - connector／coreの仕様変更
  - localhost server、HTTP endpoint、SSE、WebSocket
  - frontend各画面の全面移行

## References

- `.docs/future/202607-qwebchannel-bridge.md`
- `.docs/future/202607-qwebchannel-contract.md`
- `.docs/future/202607-gui-backend-structure.md`
- `.docs/future/202607-implementation-sequence.md`
- `.docs/future/202607-legacy-path-removal.md`
- `.docs/future/qwebchannel/common.md`

## Required Design

```text
PySide WebView
  -> QWebChannel transport
    -> bridge dispatcher
      -> application service
```

CLIはWebView／QWebChannelを起動せず、application service／execution manager／coreを直接利用する。

## Implementation Tasks

1. QWebChannel object登録とJSON送受信をtransportへ分離する。
2. protocol version、message envelope、command id、typeのvalidationをcontractへ分離する。
3. command allowlistとapplication service dispatchをdispatcherへ分離する。
4. response／eventをGUI threadへ安全に渡すevent queueを作る。
5. frontend componentからの直接`backendBridge`参照を禁止し、`BridgeClient`経由へ移す準備を行う。
6. long-running処理をGUI threadで実行しない。
7. app終了時に新規command受付を止め、worker、channel、WebViewを終了する。

## Acceptance Criteria

- WebViewへ登録するbackend QObjectが`backendBridge`だけである。
- public memberが`postMessage` slotと`messageToFrontend` signalに限定される。
- bridge dispatcherがcore／connectorを直接呼ばない。
- application service、core、connectorがQWebChannelをimportしない。
- responseとeventが共通JSON contractに適合する。
- GUI起動中にlocalhost listening portを作らない。
- CLI実行でWebView／QWebChannelを起動しない。

## Verification

- unit:
  - envelope parse／validation
  - command allowlist
  - response correlation
  - error mapping
- integration:
  - PySide WebViewからcommandを送信し、同じ`id`のresponseを受信できる。
  - background run eventをGUI thread経由で受信できる。
  - app終了後にworkerとQWebChannel objectが残らない。

## Notes

- 現行`app/gui/bridge.py`の挙動を一括で書き直さず、transport境界から段階的に分離する。
- commandごとのQObject／slotは追加しない。
- 巨大な`BridgeRuntime`相当classへ責務を再集約しない。
- 現行command handlerのapplication serviceへの完全移行と`documents.*`への改名はtask 009／010以降で行う。
- app終了時は新規commandを拒否し、runへcancelを通知してworkerを一定時間待つ。応答しない外部処理をthread単位で強制終了はしない。
