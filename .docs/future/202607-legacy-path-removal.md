# 202607 旧経路削除仕様

## 位置づけ

この文書は、202607版で削除する旧bridge責務、frontend直接依存、config二重正本とcompatibility方針を定義する。

QWebChannel transport自体とbundled local frontendは正本経路として維持する。

## 結論

202607版のGUI導線は次に統一する。

```text
Frontend component
  -> BridgeClient
    -> backendBridge
      -> bridge dispatcher
        -> application service
          -> execution manager / core / connector / host capability
```

旧compatibility layerとfallbackは作らない。

## 削除対象

| 削除対象 | 理由 | 置き換え先 |
| --- | --- | --- |
| frontend componentから`window.zizBridge`／`window.pybridge`／`backendBridge`への直接依存 | componentがhost transportを知る | BridgeClient |
| `bridge.py`内のcommand dispatch、service、runtime state、core／connector直接呼出しの混在 | 責務が大きく単体testできない | dispatcher、service、execution manager |
| commandごとのQObject／slot追加 | QWebChannel公開面が増える | 1個の`postMessage` slot + command allowlist |
| 旧response／event envelope | 成功失敗や相関規則が統一されていない | common JSON bridge envelope |
| frontend直読み`static/config/config.js` | catalog、form、policyがUIに混在 | `config/catalog/*` + catalog service／command |
| `window.CONFIG`／`window.zizPackages.core.CONFIG`の正本扱い | frontend globalが定義正本になる | catalog adapter state |
| designer／shell内のapp固有bridge呼出し | 再利用libraryがZizaiへ依存する | app adapter event |

## 削除しないもの

- PySide WebView。
- QWebChannel。
- bundled local frontendのproduction読込。
- `qwebchannel.js`。
- `backendBridge`の1 QObject。
- `postMessage` slotと`messageToFrontend` signal。

## 作らないもの

- 旧command名から新command名への長期compatibility adapter。
- BridgeClientが無い場合にglobal bridgeを直接呼ぶfallback。
- production bridge失敗時にbrowser mockへ戻すfallback。
- `static/config/config.js`とcatalog serviceの二重正本。
- commandごとに別QObject／slotを登録する経路。
- typoや旧field名のcompatibility column。

## 移行中の扱い

実装途中で旧handlerやglobalが一時的に残ることは許容する。ただし削除待ちの旧実装として扱い、新機能を追加しない。

新旧経路を同じcommandで自動選択せず、移行対象単位で正本を1つに切り替える。

## 削除順序

1. application service／execution managerを現行bridgeから抽出する。
2. common bridge envelope、dispatcher、security profileを固定する。
3. BridgeClientを作り、QWebChannel初期化とmessage相関を集約する。
4. catalog service／commandとfrontend catalog adapterへ切り替える。
5. workspace／flow commandをdispatcher -> service経路へ切り替える。
6. run／result／event／log復元をexecution manager経路へ切り替える。
7. host capabilityをservice経由へ切り替える。
8. frontend componentのglobal bridge直接参照を削除する。
9. `static/config/config.js`の正本扱いを削除する。
10. `bridge.py`内の旧service／runtime実装とfallbackを削除する。

## 削除完了条件

- frontend componentがBridgeClientだけを使用する。
- WebViewへ登録されるbackend QObjectが`backendBridge`だけである。
- bridge dispatcherがapplication serviceだけを呼ぶ。
- service、core、connectorがQWebChannelをimportしない。
- app起動に`static/config/config.js`を正本として必要としない。
- catalogは`config/catalog/*`とcatalog serviceが正本である。
- 旧global、旧handler、command変換fallbackが存在しない。
- localhost listening portを作らない。

## 検証

- frontend JSにBridgeClient外のQWebChannel object参照が残っていない。
- `bridge.py`にconnector／coreのuse case実装が残っていない。
- catalog取得が`catalog.*` command経由である。
- unknown command、version不一致、不正payloadが拒否される。
- remote pageへbridgeが公開されない。
- workspace／flow／run／result／host操作がdispatcher -> service経路で動く。

## 実装結果

- 2026-07-29にbackend側をtask 021、frontend側をtask 022で削除完了した。
- BridgeClientの公開先は`zizPackages.core.bridge`だけである。
- `static/config/config.js`、旧`app.js`、旧`state.js`、旧`ui.node.*`、
  旧`ui.renderer.js`は物理削除済みである。
- QWebChannel object名`backendBridge`の参照はBridgeClient実装内だけに残す。
