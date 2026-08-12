# 202607 状態管理・UX 最適化仕様

## 位置づけ

この文書は、202607 版以降のフロント状態管理、再描画、イベント、UX 最適化の方針を定義する。

## 基本方針

- state 正本を最小化する。
- 派生 state を保持しない。
- 同期イベントの連鎖を減らす。
- DOM 更新範囲を局所化する。
- 動的 animation を減らし、静的な状態表示へ寄せる。

## state 正本と3分離

state に保持してよいものは、ユーザー操作や保存形式の正本になる値に限定する。

| state | 保持する正本 |
| --- | --- |
| document state | `.zizd`と同じ`steps`、`flows`、`unassigned`、`loop.flows`、`notes`等 |
| runtime state | run、step status、result参照、log cursor等 |
| UI state | active `doc_session_id`、`selection.nodes`、`selection.edges`、viewport、active panel等 |

`selectedNode`、`selectedConnector`、`availableActions`、`isDataConnector`、表示用label、一時的なDOM表示状態は正本として重複保持しない。

通常stepの選択参照は`node_id: <step_id>`、開始／終了nodeは`node_id: START|END`と`flow_id`の組にする。runtime stateやUI stateをdocument stateへ書き込まない。

各documentのapp document storeを、編集中documentの唯一の正本にする。`WorkflowDesigner`はappから受け取ったdocumentを描画し、graph編集をdocument transactionとして通知するcontrolled componentとする。property form、`flow.add`、copy／paste等のapp側操作も同じdocument storeへtransactionを発行し、Designer内部に別の正本snapshotを持たせない。

undo／redo履歴はdocumentごとにapp document storeが保持し、保存した場合に`.zizd`の内容が変わるdocument transactionだけを記録する。runtime stateとUI stateの変更は履歴へ入れない。drag中の連続座標更新、文字入力中の連続変更、flow追加、部分graph貼付等は、それぞれ操作確定時に1 transactionとして記録する。

保存操作自体は履歴を追加せず、保存成功時のhistory位置を保存済み位置として記録する。現在位置が保存済み位置と異なる場合はdirty、undo／redoで同じ位置へ戻った場合はdirtyを解除する。履歴管理のために操作ごとにYAML serializeは行わず、document patchとその逆patchを保持する。

①の`gui-flow-run`はflowごとに最新run 1件のterminal summaryと表示用result cacheだけを保持する。同じflowの新しいrun開始時に前回run分を破棄し、過去runを選択して再表示するUIは設けない。document close時は、そのdocumentに属する全flowの表示用cacheを破棄する。

GUI session全体の表示用cacheは標準128 MiBとする。上限超過でpreviewが破棄または未保存になったstepでは、terminal status、schema、row_countは表示し、preview領域にはcache上限により表示できないことを示す。runをerrorにはしない。

`gui-step-run`の実行内容に影響するconnector、action、params、schema、edge、入力参照、開始変数を変更した場合は、影響するstepと依存graph上の全下流stepのlatest result表示を無効化し、上流の再実行が必要であることを表示する。label、node位置、色、sticky note等の変更では維持する。

`loop_owner_id`を持つloop内child nodeは設定と最終resultを表示できるが、単独実行buttonを無効化する。実行確認はloop親stepの単独実行またはflow全体実行で行う。

別documentから部分graphを貼り付けた`unassigned`はdocument stateとして保持し、貼付時点でdirtyにする。未所属stepと内部edgeは保存できるがvalidation errorを表示し、`unassigned.step_ids`が残る間はworkflowを実行できない。仮START、未所属step、内部edgeの表示と選択は`WorkflowDesigner`、複数document間のclipboardと`flow.add` commandはapp／adapterが担当する。

②ワークフロー外の単体実行previewは、SQL／Python等の実行元document tabに紐づく一時UI stateとする。別tab／panelへ切り替えても保持し、次回実行で上書きする。tab close、app終了、WebView reloadでは破棄し、`.zizd`やbackend result cacheへ保存しない。

②の同一実行元document（SQL／Python等、`.zizd`を除く）ではactive runを1件までとする。active run中はそのdocumentの通常実行／dry runを無効にし、cancelを有効にする。異なる②の実行元documentは同時実行できる。

GUI session全体のconnector workerは標準4件とする。worker待ちの処理は画面上で「実行待ち」と表示し、待機中もcancelを有効にする。②はrun全体、①は該当stepだけを実行待ち表示にする。

②のactive run中に実行元documentを閉じる場合は、`閉じずに続行`または`実行をキャンセルして閉じる`を選択させ、background継続は行わない。cancelして閉じる場合はterminal eventとcleanup完了を待ち、dirtyなら保存有無を確認してからcloseする。

②のclose完了時にpreview、result、画面表示用run log、frontend stateを即時破棄する。run log fileは10日間保持するが、閉じたrunを再表示するglobal実行ログ画面は設けず、同じfileを開き直しても画面表示を復元しない。

②の実行元documentで、通常実行は`Ctrl+Enter`、catalogで対応するactionのdry runは`Ctrl+Shift+Enter`とする。dry run非対応actionとExportではdry run操作を表示せず、この割当は`.zizd`のWorkflowDesigner側にも適用しない。202607版はWindows PC版のみを実装・検証対象とする。

1つのGUI `session_id`で同時に開けるdocumentは最大4件とし、保存済み／未保存の`.zizd`、SQL、Python等を合算する。作成中／未保存のworkflowも1件として数える。編集しているだけでは①ワークフロー実行中とは扱わず、draftを実行した時点で①としてruntime stateへ追加する。

同じOSユーザー内でZizai GUIは単一instanceとする。2つ目のGUI processはbackendと`session_id`を作成せず、4 document制限を別instanceで回避できないようにする。`doc_session_id`はGUI起動中に再利用せず、`doc_session_id + flow_id`で開いているflowを一意に識別する。

派生値は selector/helper で必要時に計算する。

## selector

selector は state と config から表示に必要な値を計算する。

例:

- `getSelectedNode(state)`
- `getConnectorForNode(state, config, nodeRef)`
- `getAvailableActions(config, connectorId)`
- `getDataAreaPolicy(config, node)`
- `getNodeStatus(runState, nodeRef)`

selector は副作用を持たない。

## event 方針

- state 更新 event と UI DOM event を分ける。
- 同じ操作で複数の state 更新 event を連鎖させない。
- event handler は command を発行し、state mutation は集中管理する。
- document変更commandはtransaction単位でapp document storeへ適用し、同じtransactionをundo／redoとdirty判定に使用する。
- UI 部品内 event は外部へ public event として通知する。
- QWebChannel bridgeの非同期結果は、必要なstateだけを更新する。

## 再描画方針

- 全体再描画を標準手段にしない。
- node status 更新では該当 node だけを更新する。
- data area 更新では data area だけを更新する。
- right detail 更新では right detail だけを更新する。
- canvas viewport 更新では canvas 内に閉じる。
- run status 受信で data tab DOM を全クリアしない。

## UX 最適化

- 実行中表示は静的 label/icon/class を基本にする。
- 継続的 spinner や canvas animation は必要最小限にする。
- hover、focus、active、selected、running、error は CSS class で表す。
- layout shift を起こす動的 text 変更を避ける。
- 非同期完了待ちで UI 全体を blank にしない。
- 選択中 panel の状態を不必要にリセットしない。

## ガビガビ対策

表示が不安定な場合は、次の順で原因を確認する。

1. 同じ意味の state を複数保持していないか。
2. run status など高頻度 event で全体再描画していないか。
3. 非同期 API の完了前後で DOM を作り直していないか。
4. CSS animation や transition が layout に影響していないか。
5. canvas と DOM の更新責務が混ざっていないか。

## 計測

必要に応じて、次を確認する。

- state 更新回数
- event 発火回数
- render 関数呼び出し回数
- DOM 更新対象数
- Playwright screenshot 差分
- UI 操作ごとの待ち時間
