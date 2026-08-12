# gui-bridge

## 役割

この文書は、PySide WebView の GUI frontend と Python backend を QWebChannel で接続する bridge API の責務範囲仕様である。

## 責務

- WebView へ公開する QObject は `backendBridge` 1 個に限定する。
- `postMessage(json_text)` で command を受け、`messageToFrontend(json_text)` signal で response / event を返す。
- frontend component は `backendBridge` を直接参照せず、共通 `BridgeClient` を使用する。
- bridge は command を application service へ委譲し、core / connector を直接呼ばない。
- flow、workspace、preview、result、catalog などの bridge command を提供する。
- UI へ返すエラーは要約し、詳細はログへ残す。
- OS ネイティブダイアログやファイル preview の待機時間を、通常 command の応答遅延と混同しない。

## 実行方式

- GUI flow 実行と GUI step 実行は、`BridgeClient -> bridge dispatcher -> application service -> execution manager -> core -> connector` を通る。
- CLI flow 実行は WebView / QWebChannel を起動せず、catalog service / application service / execution manager / core を直接利用する。
- production GUI 用の localhost server、HTTP endpoint、SSE、WebSocket は設けない。

## タイムアウト方針

- 通常 command は、bridge 停止や応答漏れを検知するため短い既定タイムアウトを持つ。
- `file.pickFile` / `file.pickFolder` は、ユーザーが OS ダイアログで選択している時間をタイムアウト扱いしない。
- `preview.readExcel` / `preview.readCsv` は、ファイル内容を読む処理として通常 command とは別枠で扱う。
- 大きい Excel ファイルの preview は、通常 command より長い個別タイムアウト、または処理中表示を前提にする。
- タイムアウト時は、command 種別、経過時間、対象操作をログへ残す。

## 実装方針

- command 種別ごとに timeout policy を分ける。
- catalogはbackend起動時に1回だけ読み、`catalog.getConnectors` / `getActions` / `getForms` / `getDataAreaPolicy` / `getSecurityPolicySummary`から同じsnapshotを返す。
- frontendは`catalog.adapter.js`から5 commandを並行取得してmemory cacheへ保持し、componentはQWebChannel objectを直接参照しない。
- frontend 側の一律タイムアウトだけで QWebChannel 全体を判定しない。
- ユーザー操作待ち、ファイル読み込み、通常 command 応答待ちを分離する。
- `mouse.coordinateCapture.start` は全画面の一時オーバーレイを起動し、マウス座標を `mouse.coordinateCapture.preview` イベントで通知する。左クリック時は `mouse.coordinateCapture.selected`、Esc 時は `mouse.coordinateCapture.cancelled` を通知する。
- 座標取得中の preview は UI の入力欄表示だけを更新し、flow state への保存は確定クリック時だけに行う。高頻度の preview 通知は間引く。

## 実行性能ログ

- GUI 実行の遅延は、core 実行完了、bridge terminal event 到達、summary 取得、画面反映完了を分けて記録する。
- run開始／終了、step開始／終了、warning／error／cancelは`run_log`へ記録する。
- bridge validation、security、host制御、frontend UI eventは`gui_app_log`へ記録する。
- 依存解決、scheduler、cache解放、処理時間などの詳細な性能情報はdebug mode時だけ`debug_log`へ記録する。
- 旧`logs/execution.log`は作成せず、全logを日別・10日保持の共通管理対象にする。
- GUI 固有の遅延は、同一 flow の headless 実行時間との差分で判断する。
