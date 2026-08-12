# 202607 詳細設計 質問表

## 位置づけ

このファイルは、202607 詳細設計で未確定の判断事項を整理するための質問表です。

- `回答` 欄に追記してください。
- 回答後、確定した内容を各仕様書へ反映します。
- このファイル単体は最終仕様ではなく、仕様確定前の作業表です。

## 回答ルール

- `回答` に結論を記載してください。
- 判断理由や補足がある場合は `補足` に記載してください。
- 保留にする場合は `回答: 保留` とし、必要な追加調査を書いてください。

---

## A. `.zizd` 保存形式

### A-1. ファイルパスの保存方針

**質問**  
`.zizd` には、ファイルパスをどの形式で保存しますか。

**現行実装**  
UI では hidden ref を使いますが、`.zizd` 保存時には実パスへ戻しています。


**選択肢**

- A: 現行どおり `.zizd` に実パスを保存する
- B: `.zizd` には path ref / hidden ref を保存し、実パスは別管理する

**回答**  
- A: 現行どおり `.zizd` に実パスを保存する
可能なら、実パスがよいです。

**補足**  
セキュリティ懸念ですよね。
例えば、Excelなどの仕様書に実パスを書くのもよくありますが、
情報開示の意味合いでは同じだから、そこまで大きなはなしではないと思ってます。


---

### A-2. schema の保存位置

**質問**  
schema は `steps[].schema.columns` に保存する方針で確定してよいですか。

**現行実装**  
`steps[].params.schema` に JSON 配列文字列として保存しています。

**提案**  
202607 版では `steps[].schema.columns` に YAML の辞書・配列として保存します。

**回答**  
この形式です。配列を直書きするのではなく、yamlのブロック形式記法でおねがいします。
  columns:
    - origin_name: id
      ziz_datatype: INT64
    - origin_name: name
      ziz_datatype: STRING
    - origin_name: created_at
      ziz_datatype: DATETIME

**補足**  

---

### A-3. 旧 `params.schema` の扱い

**質問**  
旧 `params.schema` の読み込み互換は作らず、202607 版では読まない方針でよいですか。

**現行実装**  
schema は `params.schema` を前提にしています。

**前提**  
過去会話では「互換は作らなくてOK」という方針です。

**回答**
読み込み互換は作らず、202607 版では読まない方針でよい

**補足**  

---

### A-4. 入力 schema の保存項目

**質問**  
入力系 schema は `origin_name` / `ziz_datatype` の 2 項目のみ保存で確定してよいですか。

**現行実装**  
画面表示は主に 2 項目ですが、保存値には `new_name` / `description` も残ることがあります。

**提案**  
202607 版では入力系 schema の保存項目を 2 項目に統一します。

**回答**  
- 2項目にしたいです。
- 保存も2項目です。

**補足**
UI上でフィールド選択する際に、取込対象外になった場合はグレーアウトする。
保存からは消す。2回目以降開く場合は表示されなくてもOKで、改めて取得したい場合は、スキーマ取り込みボタンから取得する

---

### A-5. 出力 schema の保存項目

**質問**  
出力系 schema はどの項目を保存しますか。

**候補**

- `origin_name`
- `new_name`
- `ziz_datatype`
- `description`

**確認したい点**  
出力時の項目名変更があるため `new_name` は必要そうです。

**回答**  
下記３点でおねがいします。
- `origin_name`
- `new_name`
- `ziz_datatype`

`description`は消しましょう。

**補足**
別途、descriptionを設定できるアクションをBQにつくりましょう。

---

### A-6. 加工 schema の保存有無

**質問**  
加工系 schema は `.zizd` に保存しますか。それとも実行結果表示用の cache のみで扱いますか。

**現行実装**  
schema の扱いは connector / UI 経路に依存しており、保存形式としては整理されていません。

**選択肢**

- A: `.zizd` に保存する
- B: `.zizd` には保存せず、実行結果の schema / preview として扱う

**回答**  
- B: `.zizd` には保存せず、実行結果の schema / preview として扱う

**補足**


---

### A-7. `step_id` と表示名の分離

**質問**  
`step_id` は安定 ID、表示名は `label` として分離する方針でよいですか。

**現行実装**  
`step_id` は `node.stepName` 由来で、表示名と安定 ID が分離されていません。

**前提**  
`step_id` は順序を意味しない、という方針は明記済みです。

**回答**  
`step_id` は安定 ID、表示名は `label` として分離してください。

**補足**  

---

### A-8. `flows.edges` の必須化

**質問**  
202607 版では `flows.edges` を必須にし、`steps` 配列順の sequential fallback を廃止してよいですか。

**現行実装**  
runtime には `flows.edges` が無い場合に `steps` 配列順で実行する fallback があります。

**提案**  
並列実行を前提にするため、実行順は edge / dependency で表現します。

**回答**  
・guiの立ち上げ時
　flows.edges がなければ、アプリは steps 配列順で一時生成する
　生成した edge は各 step_id を参照する
　プロジェクトは未保存状態にする
　不正な step 参照や loop／merge の不整合も含め、画面は開く
　問題のあるノードや接続にエラーを表示する
・guiの実行時
　立ち上げ時にflows.edgesは生成されている。
　エラー解消まで実行を制限する。保存は許容。
・cuiの実行時
　cmd実行は変換せずエラーにする

通常flowで複数のedgeが同じstepへ入る場合はAND合流とし、合流先へ直接接続された全stepの正常完了後に合流先stepを開始する。合流だけではDataFrame等のデータを結合しない。`edge.kind: merge`は保存せず、複数のincoming edge自体を合流の正本とする。

Zizaiのloop内部graphは単一路だけを許可し、同じnodeから複数edgeを出す並列分岐と、同じnodeへ複数edgeを入れる合流を禁止する。GUIでは該当する接続操作を許可せず、file読込時とbackend実行前にもvalidationする。不正なloop graphを含むfileは画面表示と保存を許可するが、修正されるまで実行を禁止する。

---

### A-9. `edge.order` の意味

**質問**  
`edge.order` は表示順だけに使いますか。それとも runtime の tie-breaker にも使いますか。

**現行実装**  
`edge.order` は DAG runtime の ready queue tie-breaker にも影響しています。

**選択肢**

- A: 表示順のみ
- B: runtime の tie-breaker にも使う

**回答**  
- B: runtime の tie-breaker にも使う

**補足**  

複数 flow 対応後は、`flows.<flow_id>.edges[].order` に同じ方針を適用する。

---

### A-10. 1つの `.zizd` に複数 flow を保存する構造

**質問**  
1つの `.zizd` に複数の独立 flow を保存し、同一 canvas 上へ複数の開始／終了 node を表示できるようにしますか。

**回答**  

- 1つの `.zizd` に複数の独立 flow を保存できるようにする
- 複数 flow は tab で切り替えず、同一 canvas 上へ並べて表示する
- `flows` は `flow_id` を key とする mapping にする
- 各 step は `flow_id` を持ち、`step_id` は `.zizd` 全体で一意にする
- 各 flow は開始 node と終了 node を1つずつ持つ
- 開始／終了 node は移動可能とし、canvas 上の位置を `.zizd` に保存する
- flow 間の edge と、同じ step の複数 flow 共有は禁止する
- 実行時は対象 `flow_id` を指定する
- 開始変数は flow ごとに `flows.<flow_id>.start.variables` へ保存し、対象 flow の実行開始時だけ context へ投入する

**補足**  

- `START`／`END` は connector step ではなく、各 flow 内だけで有効な予約 ID とする
- A-8 の edge 必須・GUI一時生成・CLI error 方針は `flows.<flow_id>.edges` ごとに適用する
- 新規 `.zizd` 作成時と flow 追加時は、Zizai app が `START -> WindowsConnector.define_values -> END` を初期生成する
- 初期 `define_values` は必須ではなく、削除して `START -> END` にできる
- 開始 node の variables は最初のstepより前に投入し、`define_values` はその後に実行される通常stepとして区別する
- 初期 template は app／adapter 側の責務とし、`WorkflowDesigner` へ `WindowsConnector`／`define_values` をハードコードしない
- 旧single-flow形式の `flows.edges`、top-level `variables.start`、`flow_id`のないstepは読まず、自動変換もしない
- A-8のGUI一時edge生成は、新しい `flows.<flow_id>` 構造内でedgeが欠落した場合だけに適用する

---

### A-11. `schema.mode` の保存有無

**質問**  
input／output／transform の区分を `steps[].schema.mode` に保存しますか。

**回答**  

`schema.mode` は削除し、`.zizd` に保存しない。

**補足**  

- input／output／transform の判定は、connector/action catalog の正規化済み metadata を正本にする
- `.zizd` には `steps[].schema.columns` だけを保存する
- 加工 action の schema は `.zizd` に保存せず、runtime cache だけで扱う

---

### A-12. YAML記法と読込cache

**質問**  
`.zizd`とcatalog定義ファイルのYAML記法、および読込回数を共通化しますか。

**回答**  

- catalog定義ファイルはYAMLとする
- 文字列valueと動的ID keyは原則single quoteで囲む
- multilineは原則`|-`を使用し、`>`／`>-`は使用しない
- 非emptyのarray／dictionaryはYAML block sequence／mappingで記述する
- empty arrayは`[]`とする
- empty dictionaryはfield自体を省略し、`{}`は使用しない
- array／dictionaryをJSON文字列へ変換して埋め込まない
- YAMLはloader境界で1回だけparseし、以後はmemory上のsnapshotから取得する

**補足**  

- connectorにはparse済みのnative `list`／`dict`を渡し、connector側でYAMLを再parseしない
- GUIはcatalogをGUI app process起動時、`.zizd`をfile open時に1回読み込む
- CLIはcommand開始時にcatalogと`.zizd`を1回ずつ読み込む
- GUI／CLIは別processのためmemory cacheを共有しない
- run開始後は開始時のsnapshotを完了まで固定する
- 詳細は`202607-yaml-style.md`を正本とする

---

### A-13. `step_id`／`flow_id`の発番と既定flow

**質問**  
`step_id`／`flow_id`をどの形式で発番し、複数flowをCLI実行するときの既定flowをどう決めますか。

**回答**

- `step_id`と`flow_id`は10進数字の文字列とし、1始まりで発番する
- `'01'`から`'99'`までは2桁0埋め、100以降は`'100'`、`'101'`のように桁数を増やす
- `step_id`と`flow_id`は別々の連番として管理する
- 次のIDは各連番の既存最大値に1を加えて生成し、削除済みIDは再利用しない
- YAMLでは文字列としてsingle quoteで囲む
- IDは画面で確認できるが通常はread-onlyとし、利用者が編集する名称は`label`とする
- `.zizd`の`metadata.default_flow_id`で既定flowを設定できるようにする
- `default_flow_id`がない場合は`'01'`を既定flowとする
- CLIでは利用可能な`flow_id`と`label`を確認し、実行対象の`flow_id`を指定できるようにする

**補足**

- 2桁は固定長ではなく最小桁数であり、`'100'`を`'00'`へ戻さない
- IDは安定IDであり、表示順や実行順には使わない
- `START`／`END`は予約IDであり、連番には含めない
- `default_flow_id`が存在しないflowを参照する場合はvalidation errorにする
- `WorkflowDesigner`は標準発番器を内蔵し、指定がなければ上記の10進連番規則を使用する
- 別アプリが異なるID規則を必要とする場合だけ、発番callbackを差し替えられるようにする
- node複製では新しい`step_id`、flow複製では新しい`flow_id`と配下stepの新しい`step_id`を発番する
- flow複製時はedge、loop graph、`loop_owner_id`など共通graph構造内の参照を`WorkflowDesigner`が自動更新する
- connector parameter内などapp固有のstep参照は、appから渡す参照更新callbackで更新する
- 別documentではIDのscopeが異なるため、同じ`step_id`／`flow_id`を使用できる

---

### A-14. ID参照とオブジェクト本体の命名規則

**回答**

- YAML／JSONの`*_id`キーには、定義されたscope内で一意となる識別子、またはその識別子への参照値だけを保存する
- `*_id`キーへ参照先オブジェクトの辞書・配列を保存しない
- 参照先のオブジェクト本体はcatalog、document内の正本collection、または各機能の正本storeで別管理する
- 参照側へオブジェクト本体を複製せず、`*_id`から正本を解決する
- オブジェクト本体を保存するキーには、`params`、`schema`、`flows`のように`_id`を付けない
- connector／action参照の保存キー名は`connector_id`／`action_id`とし、値はcatalog上のオブジェクトを参照するIDとする

**補足**

- IDの一意性scopeはID種別ごとに定義する。`_id`接尾辞だけでglobal uniqueを意味しない
- ID参照とオブジェクト本体を分離することで、同じ定義の重複保存と、ID値／辞書形式の表記揺れを防ぐ

---

## B. runtime / result

### B-1. result store の正本

**質問**  
実行結果は `run_id + step_id` を正本キーにして管理する方針で確定してよいですか。

**現行実装**  
`flow_key + step_id` の latest result を参照しています。

**提案**  
202607 版では同じ step でも run ごとに結果を分離します。

**回答**
run_id + step_id を実行結果の正本キーとする。
**補足**
run_id は実行受付時に backend が UUIDv7 で1回生成する。形式は `gui_flw_{UUIDv7}`、`gui_stp_{UUIDv7}`、`cli_flw_{UUIDv7}` とする。run_id は opaque ID として扱い、処理ロジックでは文字列を解析しない。実行元と実行種別は execution_source、run_kind にも保持する。flow_id と session_id は追跡用属性とし、正本キーには含めない。人向け連番は持たない。session_idはGUI起動から終了まで、CLIでは1回の起動中で共通とする。

GUIから実行の場合：gui
CLIから実行の場合：cli
フロー全体の実行の場合：flw
ステップ単位の実行の場合：stp

202607版の実行は、`.zizd`を使う「①ワークフロー実行」と、`.zizd`を使わない「②ワークフロー外の単体実行」に分ける。内部run種別は`cli-flow-run`、`gui-flow-run`、`gui-step-run`、`gui-standalone-run`の4種類とし、`gui-standalone-run`は②を表す。CLIからの単一step実行と②の単体実行は対象外とする。

---

### B-2. raw DataFrame の保持

**質問**  
`cli-flow-run`、`gui-flow-run`、`gui-step-run` で、raw DataFrame をいつまで保持しますか。

**現行実装**  
report の raw result は `None` にし、`ui_cache` に schema / preview / row_count を保存しています。

**回答**  
- `cli-flow-run` / `gui-flow-run`: run 中だけ保持し、完了後は破棄する
- `gui-step-run`: 成功したstepのraw DataFrameを、flow内のstep別latest cacheとして保持する

**補足**  
flow runでは、最後の既知consumer完了時点で早期解放し、run終了を保持期限の上限とする。

GUIの単一step実行結果は、次の同一step実行による更新、flowを閉じる、またはアプリ終了まで保持する。最新の同一step実行が失敗またはcancelledの場合は、以前の成功結果へ戻らずlatest cacheを無効化する。
---

### B-3. preview / schema / datavolume の cache

**質問**  
raw DataFrame を破棄する場合でも、schema / preview / datavolume は step 完了時に cache 化して保持しますか。

**現行実装**  
schema / preview / row_count は cache されますが、datavolume は engine の `ui_cache` に保存されていません。

**回答**  
schema / preview / row_count をstep完了時にcache化して保持する。previewは先頭100行、1stepあたりUTF-8 JSON換算2 MiB、1セルの表示値64 KiBを上限とし、いずれかを超える場合は`truncated: true`を付ける。datavolume は202607版の対象から削除する。datavolumeは実装自体削除でOKです。

**補足**  
raw DataFrame破棄後も、schemaとpreviewは run_id + step_id で参照可能にする。datavolumeの生成・保存・表示・APIは実装しない。

`gui-flow-run`の表示用cacheはflowごとに最新run 1件だけ保持する。同じflowの新しいrunを開始した時点で前回runのterminal summary、schema、preview、row_countを破棄し、以前のrunへfallbackしない。document close時は、そのdocumentに属する全flowの表示用cacheを破棄する。
関連する将来仕様から `/datavolume` API と保持・表示の記述を削除済み。
---

### B-4. 単一 step 実行の上流結果

**質問**  
GUIの単一step実行時、上流stepの結果をどこから取得し、取得できない場合はどう扱いますか。

**現行実装**  
前回の `latest_by_flow.context` を seed として利用します。

**取得元の選択肢**

- A: 各上流stepのlatest `gui-step-run` raw cacheを利用する
- B: 明示的に選択された run の result を利用する

**未解決時の選択肢**

- C: エラーにする
- D: 必要な上流stepを自動実行する

**回答**
- A: 各上流stepのlatest `gui-step-run` raw cacheを利用する
- C: latest cacheを利用できない場合はエラーにする

**補足**
latest cacheは、上流stepの最新の単一step実行がsuccessで、raw DataFrameが保持されている場合だけ利用できる。最新実行がerror / cancelledの場合、未実行の場合、または参照先が存在しない場合はエラーにする。以前の成功結果へのfallbackは行わない。`cli-flow-run` / `gui-flow-run` のraw DataFrameはrun終了後に破棄されるため、単一step実行の上流結果には利用しない。

---

### B-5. DataFrame lifetime の参照元

**質問**  
DataFrame の解放判定に使う依存関係は、どこを正本にしますか。

**現行実装**  
params 参照から consumer 数を推定していますが、plain `input_data: step1`、loop child、consumer なし producer などに漏れがあります。

**候補**

- `.zizd` の edge / params
- connector catalog の input contract
- runtime で解決した実依存

**回答**  
gui-flow / cli はruntimeの実依存を正本、gui-step はlatest cacheとして別管理
**補足**  
gui-flow：backendが .zizd のedgesとcatalogの入力参照定義から実依存を構築し、最後のconsumer完了後に解放
gui-step：consumer数では解放せず、step別latest raw cacheとして保持・更新
cli：gui-flow と同じ依存管理で早期解放し、プロセス終了時に全破棄
frontend：同じedges／catalogを使って依存関係を表示・検証するが、解放判断はしない
backend runtime：実際に解決した依存関係をDataFrame解放の正本とする

---

### B-6. loop内stepの反復結果

**質問**  
loop内の同じstepが複数回実行された場合、各反復結果を保持しますか。

**回答**  
for文と同じ上書き方式とし、全反復結果は保持しない。

**補足**  
同じ`step_id`のresultとdata area cacheを反復ごとに上書きし、loop外へ明示的に渡すresultも最終反復の値だけとする。loop内部だけで使ったraw DataFrameと一時変数は、その反復内のconsumer完了後またはloop終了時に解放する。

loop開始前に総反復件数を確定し、開始logへ`iteration_total`を記録する。反復中のlogには必要に応じて1始まりの`iteration_no`を付ける。総反復件数が0の場合はloop内stepを実行せず正常終了とし、開始logと終了logを各1件記録する。

---

### B-7. 並列step失敗時の停止範囲

**質問**  
並列実行中に1つのstepが失敗した場合、他branchを継続しますか。

**回答**  
fail-fastとする。

**補足**  
step failureを検知したら新しいstepを開始せず、実行中の並列stepへcancelを要求する。未開始stepは独立branchを含めて`skipped`とし、最初のstep failureをprimary errorとしてrun全体を`error`にする。実行中stepのterminal状態とcleanup完了を待ってから`run.failed`を通知する。

---

### B-8. 1 run内の最大並列step数

**質問**  
1 run内で同時実行するstep数に上限を設けますか。

**回答**  
標準4stepまでとし、backend設定で変更可能にする。

**補足**  
通常actionは並列実行可能とする。202607版ではbackendによる同一resourceの汎用lock、action固有の事前検証、強制直列化を設けない。

GUI session全体で実際に同時稼働するconnector処理も標準4 workerまでとし、backend設定で変更可能にする。workerに空きがない処理は実行要求を受理したまま`queued`にする。

同一resourceへの競合をconnectorまたは外部システムがerrorとして返した場合は、通常のstep failureとして処理する。errorにならない上書きや操作干渉はbackendでは検知しない。

`WindowsConnector.mouse_click`、`input_text`、`send_keys`等のdesktop操作にも特別なlock、並列分岐validation、強制直列化を設けない。desktop操作の実行中は、利用者および他の自動化toolが対象desktopを操作しないことを利用条件とする。

---

### B-9. ワークフロー実行とワークフロー外の単体実行

**質問**  
①ワークフロー実行と②ワークフロー外の単体実行を、同一GUI session内でどこまで同時実行しますか。

**回答**  

- ①ワークフロー実行は、保存済み／未保存を問わず`.zizd`のflow全体または単一stepを実行する方式とする
- 1つのGUI `session_id`で①は同時に1件だけ許可し、異なるflow／documentの①も追加実行しない
- ②はBigQuery、DuckDB、Python等を`.zizd`のflow／stepにせず直接実行する方式とする
- ①の実行中でも②を開始でき、②の実行中でも①を1件まで開始できる
- ②同士にはsession単位の論理的な件数上限を設けない。ただし、②の同一実行元document（SQL／Python等、`.zizd`を除く）ではactive runを1件までとし、異なる実行元documentの②は同時実行できる
- ②はworkflow core、step、edge、flow context、workflow schedulerを使用しない

**補足**  

- ②の内部run種別は`gui-standalone-run`とし、catalogの`standalone_allowed`が`true`のactionだけを対象にする
- ②も共通の`run_id`、cancel、log、security validation、worker／queue制御を使用するが、workflow実行planは作らない
- ②のactive runは画面からcancelできる。実行中は同じ実行元documentの通常実行／dry runを開始できない
- ②ではcatalogでdry run対応と定義されたSQL／Python actionだけにdry run操作を設ける。Exportには設けない
- ②の実行元documentで、通常実行は`Ctrl+Enter`、dry runは`Ctrl+Shift+Enter`とする。202607版はWindows PC版のみを対象とする
- ②は各runに個別の`run_id`を持つ
- 作成中／未保存のワークフローは1つのdocumentとして数えるが、編集しているだけでは①の実行件数に数えない
- 作成中／未保存のワークフローを実行した時点で①として数え、実行開始時点のdraft snapshotを使用する
- 1つのGUI `session_id`で同時に開けるdocumentは最大4件とし、保存済み／未保存の`.zizd`、SQL、Python等を合算する
- 5件目のopen要求では5件同時には開かず、既存4件のうち最も新しく開いたdocumentを通常のclose処理で閉じた後、要求されたdocumentを開く
- 5件目のopen要求時に「同時に開けるdocumentは最大4件です」という警告や、close対象を選択する専用dialogは表示しない
- close確認の中止、保存dialogのcancel、保存失敗等で対象documentを閉じられなかった場合は、要求されたdocumentを開かない
- 4 document制限は開いているdocument数の制限であり、②のrun件数上限ではない
- 同じOSユーザー内でZizai GUIは単一instanceとし、2つ目のGUI processはbackendと`session_id`を作成しない
- `doc_session_id`はGUI起動中に再利用しない。単一instance内では`doc_session_id + flow_id`で開いているflowを一意に識別する

---

### B-10. run実行中のdocument close

**質問**  
`.zizd`に紐づくrunの実行中にdocumentを閉じようとした場合、どう扱いますか。

**回答**  
`閉じずに続行`と`実行をキャンセルして閉じる`の二択を表示する。

**補足**  
既定選択は`閉じずに続行`とする。cancelして閉じる場合は通常の`run.cancel`を使用し、terminal eventとcleanup完了を待つ。その後documentがdirtyなら`保存して閉じる`と`保存せず閉じる`を確認し、保存処理または保存しない選択の完了後に`documents.close`を呼ぶ。保存dialogのcancel、保存失敗、保存競合時はdocumentを閉じないが、runのcancelは完了済みとする。close完了時にdocument state、UI state、hidden state、step latest raw cacheを破棄する。`documents.close`自体には暗黙のcancelを持たせない。

---

### B-11. ワークフロー外の単体実行resultの保持

**質問**  
②の単体実行のraw resultとpreviewをどこまで保持しますか。

**回答**  
DataFrameを返す②では実行前にExcel出力checkboxでresult modeを決め、backendに単体実行result cacheを残さない。

**補足**  

- checkboxなし: 上限付きpreviewを完了eventでfrontendへ渡し、raw DataFrameを即時解放する。
- checkboxあり: 保存先と上書き可否を実行前に確定し、actionの戻り値を単体実行のresult export処理でExcelへ出力する。Excel出力をworkflow stepまたはflowとして扱わない。
- 成功／失敗にかかわらずpreview生成またはresult export完了時にraw DataFrameを解放する。
- ②のschema、preview、raw resultをbackend cacheへ保存せず、後続runからも参照させない。
- previewは実行元documentのtabを開いている間だけfrontend stateに保持する。別tab／panelへの切替では保持し、次回実行で上書きする。tab close、app終了、WebView reloadで破棄する。
- ②もerror確認に必要な通常run logは共通の保存方針に従う。

---

## C. cancel / log / event

### C-1. cancel の基本方針

**質問**  
cancel は「割り込み優先 + 必要箇所は協調キャンセル」で設計してよいですか。

**現行実装**  
実行中 connector への interrupt / terminate はなく、engine checkpoint による協調停止が中心です。

**提案**  
長時間処理は interrupt を基本とし、Excel / CSV 大量処理、loop、Selenium wait などは cancel check も併用します。

**回答**  
cancel は「割り込み優先 + 必要箇所は協調キャンセル」で設計

**補足**  

---

### C-2. cancel terminal event

**質問**  
cancel 完了時の terminal event は `run.cancelled` に変更してよいですか。

**現行実装**  
`run.failed` payload `status: "cancelled"` です。

**回答**  
run.cancelledでOKです。
**補足**  

---

### C-3. log の保存先

**質問**  
run log はどこに保存しますか。

**確定済みの前提**

- ファイル保存する
- 保存期間は 10 日
- 1 日単位でファイル保持する
- debug log は debug mode のときのみ作成する

**確認したい点**  
通常実行ログ、監査ログ、debug log を分離しますか。

**回答**  
保存場所は同じでファイル名を変えてください。
通常実行ログ、debug logのみ対象。 
監査ログは不要です。

**補足** 
202607版はローカル・単一利用者を前提とする。確認・security判定の結果はサーバー運用ログへ含める。通常実行ログとサーバー運用ログは10日間、日単位のファイルで保持する。debugログはdebug mode時のみ作成し、同じく10日間保持する。

全log種別を合計したdisk使用量は標準1 GiBをsoft上限とし、backend設定で変更可能にする。app起動時と日次rotation時に、10日を超えたfileを先に削除し、まだ上限を超える場合は古い日付のfileから日単位で削除する。当日fileは削除せず、当日中の一時的な上限超過は許容する。

---

### C-4. log event の項目

**質問**  
`run.log` event にはどの項目を含めますか。

**現行実装**  
`run_id`、`ts`、`level`、`message` を持ちます。

**追加候補**
- `log_seq`
- `step_id`
- `connector_id`
- `action_id`
- `category`
- `detail`

**回答**  
`run.log` event の必須項目は次のとおりとする。

- `run_id`
- `log_seq`
- `ts`
- `level`
- `category`
- `message`

step に紐づく場合は `step_id` を必須とする。connector 実行に紐づく場合は `connector_id` と `action_id` を必須とする。`trace_id` と `detail` は必要な場合だけ含める。

**補足**
`log_seq` は run 内で単調増加させ、切断後のログ復元位置に使う。`category` は `run` / `step` / `connector` / `system` を基本とする。`detail` は定義済みの許可項目だけを持つ構造化 object とし、params 全体、認証情報、秘密値を含めない。

通常の`run.log` eventと通常実行logには実pathを含めず、workspace相対pathまたはmask済み表記を使う。debug mode時は、localに保存するdebug logに限って実pathを記録してよい。ただし、debug logをfrontendへ配信せず、password、API key、access token等のsecretはdebug modeでも記録しない。

---

### C-5. log復元command

**質問**  
log復元は`result.getLogs` commandへ`run_id`と`after_seq`を渡す方針でよいですか。

**前提**  
再接続後に未表示ログを復元する必要があります。

**回答**  
log復元は`result.getLogs` commandを使用し、1回の取得上限を500件とする。
**補足**  

- cursorなしでは最新500件を返す。
- `before_seq`指定では、そのlogより前を最大500件返し、画面を上へscrollしたときの過去log追加に使う。
- `after_seq`指定では、そのlogより後を最大500件返し、実行中またはchannel再接続後の未表示log取得に使う。
- `before_seq`と`after_seq`は同時指定不可とし、backendは常に`log_seq`昇順で返す。
- responseは追加取得の有無を判断できるcursorと`has_more_before`／`has_more_after`を返す。
---

### C-6. event replay

**前提条件**
- backend processは生存しており、WebView reloadまたはQWebChannel再初期化でfrontendのevent購読だけが一時的に切れている
- channel切断中もbackendはrunを通常どおり継続する
- backend の停止、アプリ終了、PC 再起動からの run 復旧は対象外とする

**質問**  
QWebChannel event購読が切れた場合、eventの完全replayは行わず、summary／result／logs commandで復旧する方針でよいですか。

**確認したい点**  
画面復元に必要な情報はbridge commandによる再取得で揃える設計にします。

**回答**  
eventの完全replayは行わない。BridgeClientはchannel再初期化後、backendが保持しているsummary、表示用result cache、logsをbridge commandで再取得し、event購読を再開する。backendでflow／stepを再実行しない。

**補足**
`gui-flow`と`gui-step`の両方を対象とする。`cli`はfrontend／QWebChannelを使わないため対象外とする。

`gui-flow` では raw DataFrame が最後の consumer 完了後に解放されていても、step 完了時に作成した `schema / preview / row_count` の表示用 result cache と logs を backend が保持するため、画面を復元できる。`gui-step` でも frontend へ raw DataFrame は返さず、表示には同じ result cache を使う。

この復旧は画面表示とログの復元だけを対象とし、raw DataFrame の復元や全件データの再取得は行わない。

---

## D. QWebChannel bridge / security

### D-1. QWebChannelを正本transportにする

**質問**  
202607版GUIはlocalhost HTTP APIを使用せず、PySide WebView + QWebChannelを正本transportにする方針でよいですか。

**現行実装**  
`file://` + QWebChannelだが、`bridge.py`にcommand dispatch、service、runtime stateが混在している。

**回答**  

- `gui-flow-run`: bundled local frontendをWebViewへ表示し、frontendはQWebChannel bridge経由でflowを実行する。
- `gui-step-run`: 同じQWebChannel bridge経由でstepを実行する。
- `gui-standalone-run`: ②ワークフロー外の単体実行として、catalogで許可されたBigQuery／DuckDB／Python等のactionを同じQWebChannel bridge経由で直接実行する。workflow coreは経由しない。
- `cli-flow-run`: WebView／QWebChannelを起動せず、保存済み`.zizd`を読み込んでapplication service／core／connectorを利用する。
- CLIの単一step実行と②の単体実行は設けない。


**補足**

- WebViewへ登録するQObjectは`backendBridge`だけとし、`postMessage` slotと`messageToFrontend` signalだけを公開する。
- frontend componentはQObjectを直接呼ばず、共通`BridgeClient`を使用する。
- bridge dispatcherはJSON message、command allowlist、payload schema、security profile、error mappingを担当し、application serviceへ処理を委譲する。
- application serviceはflow、catalog、workspace、preview、host capability等のuse caseを担当する。
- 実行管理層はrun lifecycle、background実行、cancel、event、result cacheを担当する。
- coreはflow解決、依存関係、実行順序、step実行制御を担当する。
- connectorはconnector／action固有の外部I/Oとdata processingを担当する。
- bridge、service、core、connectorは同じPython process内に置くが、module／classの責務として分離する。
- localhost server、HTTP endpoint、SSE、WebSocket、session token、Host／Origin／CORSは使用しない。

Zizaiは大容量DataFrameを扱うため、この責務分離はnetwork hopや別processを増やす構成にはしない。同一Python process内ではraw DataFrameをnative objectの参照として渡し、dispatcher、service、coreの各境界でJSON化、dictionary／list化、deep copyを繰り返さない。QWebChannel境界だけで表示用のschema、row_count、上限付きpreview、logをJSON化し、raw DataFrameはfrontendへ渡さない。DataFrameのcopyはaction処理上必要な場合だけ明示的に行う。

現行の「Google認証」は、ZizaiがGoogle OAuthやtoken管理を実装する認証基盤ではない。BigQuery利用時のデスクトップ補助機能として、backendが固定したCloud SDKコマンドを実行・確認している。

- login: `gcloud auth application-default login`
- status: `gcloud config get-value account` と `gcloud auth application-default print-access-token` による確認

202607版でも汎用auth bridgeや任意command実行bridgeとはせず、BigQuery向けの固定desktop capabilityとして扱う。access tokenはfrontendへ返さず、responseやlogにも記録しない。

---

### D-2. 必須security policy

**質問**  
QWebChannel方式の必須policyは以下で確定してよいですか。

**候補**

- productionではbundled local frontendの固定entryだけを読み込む
- remote pageをWebView内へ遷移させない
- WebViewへ公開するQObjectを`backendBridge`の1個に限定する
- command allowlistとpayload schema validationを必須にする
- connector／action catalog、params、path、host capabilityをbackendで再検証する
- productionではdevtools／remote debuggingを無効にする
- XSS、asset改ざん、secret漏えいを防ぐ

**回答**
外部networkへbackendの待受portを作らず、WebView trust boundaryとbridge入口を次のように保護する。

- bundled local frontend以外へ`backendBridge`を公開しない
- remote navigation、popup、新規window要求はhostで捕捉し、外部browserへ分離する
- QWebChannelへapplication service、core、connectorのQObjectを個別登録しない
- command type、protocol version、payload schemaをapplication service到達前に検証する
- connector／action／params／path／host capabilityをbackendで再検証する
- local contentからremote URLへの直接accessを原則無効にする
- productionのdevtools／remote debuggingを無効にする
- frontendのHTML挿入、inline script、`eval`を制限し、CSPとsanitizeを適用する

**補足**
各commandの検証はbridge dispatcherで一括適用する。backend内部のservice呼出しにはtransport検証を重複適用しない。利用者へ確認dialogを表示する処理ではなく、backendが自動で行う入口検証である。

正規のGUI / CLIから開始したflowに定義されているETL / RPA処理は、workspace外path、ファイル書き込み・削除、Shell / Python、Selenium、外部DB書き込みを含め、原則として追加確認なしで実行する。workspace外操作であることだけを理由に拒否または確認対象にしない。

---

### D-3. 実行可能処理の入口

**質問**  
Shell／Python／Selenium／SQL／file操作／外部DB書き込み等はconnector／actionとして定義し、共通`run.start` commandから実行する方針でよいですか。

**回答**  

- 上記の処理はconnector／actionとして定義し、共通`run.start` commandから実行する。
- flow／step実行では、`run.start`が対象定義に含まれる`connector_id`、`action_id`、`params`をbackendで解決する。
- ②の単体実行では、`run.start`が`connector_id`、`action_id`、`params`を受け取るが、catalogの`standalone_allowed`が`true`のactionだけを直接実行できる。
- バックエンドは `connector_id` / `action_id` が catalog に存在すること、および `params` が定義された schema に適合することを検証する。
- GUI / CLI からの正規の run では、処理内容ごとの追加確認ダイアログを表示しない。
- workspace 外 path へのアクセスも通常の ETL / RPA 操作として許可する。
- connector／actionを介さず、任意OS commandや任意処理を直接受け付ける汎用bridge commandは作らない。

**補足**  

- 保存済みflowではbackendがflow定義から`connector_id`、`action_id`、`params`を取得する。未保存のGUI flowでは実行対象のdraft定義を`run.start`へ渡す。
- GUI の draft 実行では `.zizd` を自動保存せず、実行時点の flow 定義 snapshot も run 履歴へ保存しない。
- `.zizd`内のGUIインラインSQLは、未保存のflow draft定義として①で実行できる。
- SQL／Python等の独立documentは、`.zizd`を作らず②として実行する。
- SQL ファイル実行では、参照先の SQL ファイルが保存済みかつ実在することを必須とする。SQL ファイルが保存済みでも `.zizd` に未保存の変更があれば、flow は draft 実行として扱う。
- CLI には draft 実行を設けず、保存済みの `.zizd` のみ実行できる。`.zizd` が参照する SQL ファイル等も実在を必須とする。
- BigQueryのSQL実行もBigQuery connector／actionとして同じrun経路を使用し、専用SQL実行commandは作らない。
- 保存済みSQL fileは、catalogで許可されたBigQuery／DuckDB actionの②として`.zizd`非依存で実行できる。
- `gcloud` を用いる Google 認証 helper は、実行コマンドを固定した BigQuery 向けの専用機能として例外扱いにする。任意コマンドは受け付けない。

---

### D-4. bridge responseの共通形

**質問**  
bridge responseは成功／失敗で共通envelopeを持たせますか。

**候補**

- 成功: `{ ok, data, trace_id }`
- 失敗: `{ ok, error: { code, message, detail }, trace_id }`

**回答**  

- JSON bridge responseは成功／失敗で共通envelopeを使用する。
- 成功時は `{ ok: true, data, trace_id }` とする。
- 失敗時は `{ ok: false, error: { code, message, detail }, trace_id }` とする。
- command／responseは`v`、`kind`、`id`、`type`、`ts`を持ち、`id`で相関させる。
- `trace_id`はcommand単位でbackendが生成し、GUI app logとの照合に使用する。

**補足**  

- eventは`kind: evt`、`type`、`ts`、`payload`を持つ別envelopeとする。
- file本体とraw DataFrameはQWebChannel messageへ載せない。
- `trace_id` は run 単位の `run_id` とは別の識別子とする。
- 大量行を処理するrunでも、frontendからの`run.start`は1回とし、backend内で処理を継続する。
- eventには行data本体や行単位eventを流さず、処理件数または経過時間で間引いたprogressとstep完了eventを送る。

---

### D-5. QWebChannel eventと画面復旧

**前提**

- responseとeventは`messageToFrontend` signalで受け取る。
- backend processはWebView reload中もrunを継続できる。
- eventは完全replayしない。

**質問**

BridgeClientがQWebChannel初期化、response correlation、event購読、再初期化後の画面復旧を管理する方針でよいですか。

**提案**

- `backendBridge.postMessage`へcommand JSONを送り、`messageToFrontend`からresponse／event JSONを受け取る。
- BridgeClientがcommand `id`とresponseを対応付ける。
- channel再初期化後は`app.getStatus`とsummary／result／logs commandで画面を復旧する。
- eventの完全replayとbackend再実行は行わない。
- 外部browser単体でproduction bridgeを利用せず、browser開発／Playwrightはmock BridgeClientを使用する。

**回答**

- 提案どおり、BridgeClientがQWebChannel transportを一元管理する。
- frontend componentは`backendBridge`を直接参照しない。
- channel再初期化後はsummary／result／logs commandで画面を復旧する。
- 外部browser単体でのproduction起動は対象外とする。

**補足**

- localhost server、HTTP、SSE、WebSocket、session tokenは使用しない。
- eventの完全replayとbackendの再実行は行わない。

---

## E. connector

### E-1. connector 分類の正本

**質問**  
data connector / workflow connector / action subcategory の分類は、どこを正本にしますか。

**現行実装**  
分類は文書にはありますが、実装上の完全な source はありません。

**候補**

- backend catalog
- connector class metadata
- `.zizd` step definition
- frontend config

**回答**  

- data connector / workflow connector / action subcategory、および action の parameter schema は、backend が読み込む catalog 定義ファイルを正本とする。
- connector class は実際の処理を担当する。
- `.zizd` の step definition は `connector_id` / `action_id` を保存し、catalog の定義を複製しない。
- backendはcatalog定義fileを検証・正規化し、`catalog.*` bridge commandから配信する。frontendはBridgeClient経由で取得して表示し、独自の分類定義を持たない。

**補足**  

- frontend は app 起動時に catalog を 1 回取得して cache し、画面操作ごとには取得しない。
- catalog は静的 metadata から構築し、catalog 取得のために BigQuery 等の重い connector SDK を読み込まない。
- QWebChannelで同一process内から取得するため通信遅延は小さい想定だが、実測値はbridge実装後に確認する。

---

### E-2. 出力結果メタデータの適用範囲

**質問**  
`job_id` / `target` / `path` / `executed_at` は、結果本体を返さない action の共通実行結果 metadata として、次の範囲に適用してよいですか。

**適用対象**

- data connector の出力 action
- workflow の動的操作
- workflow のシナリオ制御
- workflow の成果物出力

**適用対象外**

- 検索 / 取得結果本体を独自 schema で返す action
- ループ対象レコード本体を返す `loop_tasks`

**workflow で結果本体を返す通常 action**

- `WindowsConnector.search_files_by_name`: ファイル検索結果本体を返す。
- `WindowsConnector.search_text_in_files`: ファイル内検索結果本体を返す。
- `SeleniumConnector.dom_get`: DOM 取得結果本体を返す。

**シナリオ制御の明示的な例外**

- `WindowsConnector.loop_tasks`: シナリオ制御だが、後続処理へ渡すループ対象レコード本体を返す例外とする。

**`job_id` の割り当て**

| connector / action | `job_id` |
| --- | --- |
| `BQConnector.load_data` | BigQuery Job ID |
| `SeleniumConnector.navigate` | `web_session_id` |
| `SeleniumConnector.dom_action` | `web_session_id` |
| `SeleniumConnector.wait` | `web_session_id` |
| `SeleniumConnector.screenshot` | `web_session_id` |
| 上記以外の共通実行結果 metadata 対象 action | 空文字 |

**確認したい点**

- connector 分類ではなく「結果本体を返すか」で共通 metadata の適用を判断する。
- このcontractは`cli-flow-run`／`gui-flow-run`／`gui-step-run`／②の`gui-standalone-run`で共通とする。ただし②はworkflow stepを作らない。

**回答**  

- 上記の適用範囲で確定する。
- `job_id` / `target` / `path` / `executed_at` は、結果本体を返さない action の共通実行結果 metadata とする。
- 対象外 action は暗黙に判定せず、catalog metadata で result contract と schema を明示する。

| connector / action 分類 | result contract |
| --- | --- |
| data connector / 入力 | 取得したデータ本体 |
| data connector / 加工 | 加工後のデータ本体 |
| data connector / 出力 | 4 項目の共通実行結果 metadata |
| workflow connector / 静的操作 | 検索・取得結果本体 |
| workflow connector / 動的操作 | 4 項目の共通実行結果 metadata |
| workflow connector / シナリオ制御 | 原則として 4 項目の共通実行結果 metadata |

**補足**  

- 新しい対象外 action を追加する場合は、`connector_id` / `action_id`、返す結果本体、共通 metadata を適用しない理由を catalog と該当設計文書に記録する。
- engine / frontend の共通処理に、対象外 action ID の条件分岐を直接ハードコードしない。
- `job_id` は外部 job / session の識別子であり、Zizai の `run_id` とは別物とする。
- `job_id` の値種別も catalog metadata に明示し、connector 固有判定を frontend に持たせない。
- `VectorConnector.search_vector_db` は data connector の入力 action として検索結果本体を返す通常 contract であり、workflow 側または共通 metadata の例外には含めない。

---

### E-3. workflow 検索/取得系の扱い

**質問**  
workflow の検索/取得系は、実行結果メタデータを返さず、取得結果本体を独自 schema で返す方針でよいですか。

**現行例**

- `Windows.search_files_by_name`
- `Windows.search_text_in_files`
- `Selenium.dom_get`

**回答**  

- workflow の検索 / 取得系は、4 項目の共通実行結果 metadata ではなく、action 独自 schema の取得結果本体を返す。
- 対象 action は `WindowsConnector.search_files_by_name`、`WindowsConnector.search_text_in_files`、`SeleniumConnector.dom_get` とする。
- `cli-flow-run` では後続 step へ渡し、最後の consumer 完了後に raw DataFrame を解放する。
- `gui-flow-run` では後続 step へ渡し、schema / preview / row_count を cache 化したうえで、最後の consumer 完了後に raw DataFrame を解放する。
- `gui-step-run` では結果本体を latest raw cache として保持し、schema / preview / row_count も表示用 cache に保持する。

**補足**  

- `VectorConnector.search_vector_db` は data connector の入力 action であり、この workflow 検索 / 取得系には含めない。

---

### E-4. 外部 process の stdout / stderr

**検討区分**

外部 process の出力は、次の出力元ごとに分けて検討する。

1. connector 由来のメイン処理
2. backend の制御処理
3. それ以外の desktop / host 補助処理

#### E-4-1. connector 由来のメイン処理

**対象**

- flow / step の connector action が、メイン処理として起動・利用する外部 process
- 現時点で個別仕様を確定した対象は `ShellConnector.execute_bat` と `PythonConnector.execute_python`
- BAT / CMD 等、今後 connector action が起動する同種の外部 process にも共通規則を適用する

**回答**

- stdout は process の通常出力、stderr は警告・診断・error 出力として扱う。
- stdout / stderr の有無ではなく、exit code と exception により action の成功 / 失敗を判定する。
- stdout は通常実行 log として扱う。
- stderr、connector exception、Python traceback は診断情報として扱い、失敗時の error 詳細から確認できるようにする。
- error 詳細には、該当する場合は connector / action、exit code、exception type / message、exception chain、traceback、stderr、失敗までの stdout を含める。
- secret は常に mask し、異常な大量出力には文字数または byte 数の上限を設ける。上限到達時は省略されたことを明示する。

**connector / action 固有仕様**

- `PythonConnector.execute_python` は data connector の加工 action とする。
- 202607版のPython実行はapp同居venvに固定し、`env_path`の指定項目や任意Python環境の選択機能は設けない。
- zizaiは実行時のlibrary install、missing libraryの自動install、package管理UI／actionを提供しない。利用できるのはapp同居venvへ配布時点で導入済みのlibraryだけとする。
- 上記はzizaiが提供する機能の制限とし、利用者が記述したPythonコード内の`subprocess`等をpackage install検出のためだけにsandbox遮断する仕様にはしない。
- Python の `main()` の戻り値は加工結果本体として扱い、`print` は通常実行 log として扱う。
- Python exception / traceback は error 詳細として確認できるようにする。
- `ShellConnector.execute_bat` は workflow connector の動的操作 action とする。
- Shell / BAT / CMD は exit code で成否を判定し、action result は 4 項目の共通実行結果 metadata とする。
- Shell / BAT / CMD の stdout は通常実行 log、stderr は診断情報として扱う。

**内部共通 component**

- connector が外部 process を扱うための backend 内部共通 component（仮称 `ProcessRunner`）を設ける。
- process 起動、stdout / stderr の stream 取得、exit code、timeout、cancel、process tree 終了を共通化する。
- secret mask、出力量上限、`run_id` / `step_id` 付き log 転送、encoding、作業 directory、環境変数の指定を共通化する。
- command 構築、Python wrapper / 戻り値 parse、action result contract は connector 側に残す。
- `ProcessRunner`はbackend内部componentとし、任意commandを直接受け付けるbridge commandは作らない。
- 外部 process を直接管理しない connector へは無理に適用せず、対象外であることと理由を明示する。

**`ProcessRunner` の明示的な例外**

- `ChromeConnector.open_in_chrome`: Chrome を起動後は待機せず、stdout / stderr を破棄する detached 起動であるため対象外とする。起動時の即時 error だけを検知する。
- `SeleniumConnector`: WebDriver library が driver / browser process の lifecycle を管理するため対象外とする。connector は library の exception と session cleanup を扱う。
- `PlotlyConnector`: HTML 出力は外部 renderer を使わない。静止画像出力は Plotly / Kaleido が Chrome renderer を管理するため対象外とし、connector は `write_image()` の完了と exception を扱う。
- 上記は `ProcessRunner` による直接 process 管理だけの例外であり、共通の error 正規化、secret mask、出力量上限、`trace_id` 付与は適用する。
- Kaleido は MIT License の無償 library として利用する。Kaleido を再配布する場合は著作権表示と license 文を同梱し、Chrome を同梱する場合は Chrome 側の配布条件を別途確認する。

#### E-4-2. backend の制御処理

**対象**

- QWebChannel bridgeのcommand／response／event制御
- 実行管理層の run lifecycle、cancel、event、result cache 制御
- core の flow / step 実行制御
- background worker の開始、終了、異常終了
- CLI 制御層の `.zizd` 読み込み、引数検証、終了 code

**回答**

- 通常 run log は冗長にせず、run の開始 / 終了、step の開始 / 終了、warning / error / cancel に限定する。
- 依存関係、実行候補順、scheduler の選択判断、cache 解放、性能時間は通常 run log へ出さず、debug log のみに記録する。
- GUIのerror表示には簡潔なerror messageと`trace_id`を返し、mask済みのbackend traceback全体はgui app logに記録する。
- CLI の error 表示にも簡潔な error message と `trace_id` を出し、mask 済みの backend traceback 全体は CLI app log に記録する。
- secret は通常 / debug の両方で mask する。

**実行方法ごとの保存先**

- `gui-flow-run`／`gui-step-run`／`gui-standalone-run`: runに直接関係する制御情報はrun log、それ以外のbridge validation／security／host制御情報はgui app logに記録する。
- `cli-flow-run`: runに直接関係する制御情報はrun log、CLI制御情報はCLI app logに記録する。WebView／QWebChannelを起動しないためgui app logは作成しない。

**debug log の対象**

- run 開始時に解決した依存関係と実行候補順
- 実行中に scheduler が step を選択した理由と実際の選択順
- raw DataFrame / result cache の保持・解放判断
- run / step / connector の処理時間と性能情報
- backend 制御 component の詳細な内部状態

#### E-4-3. それ以外の desktop / host 補助処理

**対象**

- BigQuery 向け `gcloud` 認証 helper
- `app.openExternal`
- window 操作 helper
- mouse 座標取得 helper

**共通方針**

- connector action の result、run log、データエリアには含めない。
- frontend には処理に必要な structured response だけを返し、外部 process の raw stdout / stderr は返さない。
- 成功時の処理要約はdebug logのみに記録し、失敗時だけ通常のgui app／host logに記録する。
- frontendには簡潔なerrorと`trace_id`を返し、詳細はsecretをmaskしてgui app／host logに記録する。
- これらはGUIのdesktop／host helperとし、`cli-flow-run`では利用しない。

**`gcloud` 認証 helper**

- Zizai 独自の Google 認証ではなく、固定した Cloud SDK command を起動・確認する補助機能とする。
- login command の起動成否と、後続の account / access token 発行可否により認証状態を確認する。
- login 用外部 console の stdout / stderr は Zizai へ取り込まない。
- 通常 log は、gcloud 未検出、login command 起動失敗、account 確認失敗、認証状態確認失敗に限定する。
- helper 起動と認証状態確認の成功は debug log のみに記録する。
- account 名と access token は log に記録しない。access token 本体は frontend / response にも返さない。

**`app.openExternal`**

- 成功は debug log、起動失敗は通常の GUI app / host log に記録する。
- URL の query / fragment は log へ出す前に mask する。
- flow / step から実行する `ChromeConnector.open_in_chrome` は connector action であり、E-4-3 には含めない。

**window / mouse 座標 helper**

- window 操作と座標取得の成功は debug log、失敗は通常の GUI app / host log に記録する。
- 取得座標や window 情報は通常 log に記録しない。
- mouse 座標取得 helper は、GUI 編集中に `WindowsConnector.mouse_click` の `x` / `y` を入力する補助機能であり、connector action そのものではない。

**回答**  

- E-4-1 の connector 由来のメイン処理は確定済み。
- E-4-2 の backend 制御処理は確定済み。
- E-4-3 の desktop / host 補助処理は確定済み。

**補足**  

---

### E-5. `loop_tasks` の扱い

**質問**  
`loop_tasks` は data area 表示 / 出力メタデータの対象外にする例外で確定してよいですか。

**前提**  
会話上は例外化で合意済みです。

**回答**  

- `loop_tasks` は、4 項目の共通実行結果 metadata を返さない明示的な例外とする。
- ループ対象レコード本体を保持し、各レコードを子 step の反復実行へ渡す。
- data area / result contract では、ループ対象レコード本体を扱う。

**補足**  

- `loop_tasks` は通常 action と実行構造が異なるシナリオ制御であるため、例外理由を catalog と設計文書に明記する。
- 202607 版でも `WindowsConnector` の control action として配置し、connector の再配置は行わない。
- catalog の `node_type: loop` で識別し、backend の loop controller が実行制御を担当する。action 名の文字列比較では判定しない。

---

### E-6. `define_values` の扱い

**質問**  
`define_values` は例外にせず、通常のワークフロー action として扱う方針でよいですか。

**前提**  
会話上は例外にしない方針で合意済みです。

**回答**  

- `define_values` は例外にせず、`WindowsConnector` のシナリオ制御 action として扱う。
- result contract は 4 項目の共通実行結果 metadata とし、`job_id` は空文字とする。
- `WindowsConnector.wait` も Windows 所属のシナリオ制御 action のままとする。

**補足**  

- `define_values` / `wait` は Windows 固有処理でなくても、202607 版では connector の再配置を行わない。

---

### E-7. Selenium metadata

**質問**  
Selenium の動的操作およびシナリオ制御で共通実行結果 metadata を返す場合、`job_id` に `web_session_id` を入れる方針でよいですか。

**前提**  
会話上はこの方針で合意済みです。

**回答**  

- 次の action では、4 項目の共通実行結果 metadata の `job_id` に `web_session_id` を入れる。
  - `SeleniumConnector.navigate`
  - `SeleniumConnector.dom_action`
  - `SeleniumConnector.wait`
  - `SeleniumConnector.screenshot`
- `SeleniumConnector.dom_get` は対象外とする。DOM 取得結果本体を独自 schema で返し、Selenium session の識別子は独自 schema の `web_session_id` に保持する。

**補足**  

- `dom_get` の `web_session_id` を共通 metadata の `job_id` へ変換しない。
- この result contract は `cli-flow-run` / `gui-flow-run` / `gui-step-run` / `gui-standalone-run` で共通とする。

---

## F. frontend app / library

### F-1. data area の 4 領域

**質問**  
data area は以下 4 領域を正式な表示単位として定義してよいですか。

**候補**

- スキーマ定義
- スキーマ定義 JSON
- データ出力
- ログ

**現行実装**  
4 領域は独立 tab ではなく、schema editor 内 mode として実装されています。

**回答**  

- data area は次の 4 view を正式な表示単位とする。
  - スキーマ定義
  - スキーマ定義（JSON）
  - データ出力
  - ログ
- スキーマ定義とスキーマ定義（JSON）は、同じ schema state の異なる表示 / 編集形式とし、別データとして管理しない。
- data areaは`gui-flow-run`／`gui-step-run`／②の`gui-standalone-run`で使用する。②では実行元documentの単体実行resultを表示し、workflow nodeへ紐付けない。`cli-flow-run`にはdata areaを設けない。

**補足**  

- 4 view の UI 実装は tab 等で切り替えるが、表示 component と state の責務は分離する。

---

### F-2. data area log の正本

**質問**  
data area のログは backend run log を正本にする方針でよいですか。

**現行実装**  
`node.runtimeLogs` を表示しており、backend `run.log` event とはつながっていません。

**回答**  

- GUI の data area log は backend run log を唯一の正本とする。
- 実行中はQWebChannelの`run.log` eventで追加表示し、channel再初期化／再表示時は`result.getLogs` commandから再取得する。
- frontend は run log の表示 / filter だけを担当し、独立した log state を正本として持たない。
- `node.runtimeLogs` は独立した log 正本として廃止する。
- `cli-flow-run` には data area を設けないが、GUI と同じ run log contract を使用する。

**補足**  

- `gui-flow-run` / `cli-flow-run` の raw DataFrame は、最後の consumer 完了後に解放する。参照 consumer がない raw DataFrame は、表示 cache と status / log の生成後に解放する。
- raw DataFrame 解放後も、schema / preview / row_count の表示 cache と run log は保持する。
- GUI で flow 実行結果を再表示する場合は表示 cache を使用し、解放済み raw DataFrame や全データを復元しない。
- `gui-step-run` の raw DataFrame は、別途確定した latest raw cache の保持規則に従う。

---

### F-3. catalog / config の正本

**質問**  
connector catalog / action catalog / schema policy は catalog 定義ファイルを正本とし、backend が検証・正規化して API 配信する方針でよいですか。

**現行実装**  
`static/config/config.js` の global `CONFIG` を frontend が直接参照しています。

**回答**  

- connector / action / form schema / data area policy の catalog 定義ファイルを正本とする。
- backend の catalog loader が定義ファイルを読み込み、参照整合と schema を検証して正規化する。
- `catalog.*` bridge commandはruntimeの正規配信経路とするが、定義の正本そのものではない。
- frontendは`static/config/config.js`のglobal `CONFIG`を正本として参照せず、catalog commandのresponseをapp起動時に取得してcacheする。
- `gui-flow-run`／`gui-step-run`／②の`gui-standalone-run`はGUI appが取得したcatalogを使用する。
- `cli-flow-run`はWebView／QWebChannelを起動せず、同じcatalog loader／定義fileをbackend内で直接使用する。

**補足**  

- connector / action 固有の分類や policy を frontend / engine に重複ハードコードしない。
- bridge responseは定義fileから生成されるruntime projectionとして扱う。
- catalog validationはGUI／CLI、development／productionのすべてで起動時必須とする
- 不正なcatalogは部分採用せず、GUIは初期化error、CLIはnon-zero終了として実行を開始しない
- frontendはapp起動時に全actionのform schemaを取得してmemory cacheへ保持し、action選択時に個別取得しない

---

### F-4. AppShell ライブラリの責務

**質問**  
AppShell ライブラリはどこまでを責務にしますか。

**候補**

- layout
- tab
- sidebar
- header
- command event
- app 固有 sidebar
- app 固有 dataflow pane

**確認したい点**  
再利用可能にするため、app 固有要素は adapter 側へ出す想定です。

**回答**  

AppShell は、app 固有処理を持たないフロント側の再利用ライブラリとする。

- topbar、activity bar、sidebar、main、right panel、bottom panel、status bar の配置を担当する
- tab の表示、active、dirty、close request を担当する
- sidebar／panel の開閉、resize、region 単位の focus を担当する
- command を含む UI 操作は event として app 側へ通知し、実処理は app 側が担当する
- app 固有 sidebar、dataflow pane、connector/action catalog、API 通信、保存／読込は app／adapter 側が担当する

**補足**  

- AppShell は SPA や動的 Web サイトを前提としない
- `AppShell`、`TabularImportAssistant`、`WorkflowDesigner`はZizai専用部品ではなく、別アプリからも利用する独自フロントライブラリとして設計する
- Zizai 固有の catalog、保存／実行処理、文言、route、画面構成はライブラリへ固定せず、options や adapter から注入する
- AppShellは共通command buttonの見た目、icon、tooltip、disabled状態、click通知を提供し、ZizaiのHTML／JavaScriptが`.zizd`表示中だけ`flow.add`をheaderへ登録する
- `flow.add`の初期graph生成はZizai app／adapter、生成済みgraphの描画・編集は`WorkflowDesigner`が担当する
- sidebar の枠は AppShell が担当するが、sidebar の内容は静的 HTML/CSS/JavaScript でもよい
- ワークフロー画面は独自の再利用フロントライブラリ `WorkflowDesigner` で構築し、AppShell はその表示領域を提供するだけで、ワークフロー UI 自体は描画しない
- 静的なフロントから AppShell を初期化し、catalog や run 状態など必要な箇所だけを app 側で動的に更新する構成を許容する
- OS の shell やコマンド実行機能とは無関係である

---

### F-5. WorkflowDesigner ライブラリの責務

**質問**  
WorkflowDesigner ライブラリはどこまでを責務にしますか。

**候補**

- canvas
- node / edge 操作
- selection
- drag / context menu
- property panel の枠
- data area の枠
- connector catalog 読み込み
- QWebChannel bridge呼び出し

**確認したい点**  
再利用可能にするため、connector catalogとQWebChannel bridge呼び出しはadapter側へ出す想定です。

**回答**  

`WorkflowDesigner` は、別アプリでも利用できる独自フロントライブラリとして、workflow editor の汎用 UI と操作を担当する。

- canvas、node、edge、annotation の描画を担当する
- node／edge／annotation の選択、drag、移動、接続、hit test、context menu、zoom、pan、fit view を担当する
- node の見た目は renderer として外部から注入できるようにする
- run status と validation error は、document へ混ぜず overlay として表示する
- UI 操作は意味のある event として app 側へ通知する
- node 選択時は `node_id` を含む selection event を通知し、右側のノード詳細と下部のデータエリアの切替は app／adapter 側が行う
- property panel と data area の領域配置、開閉、resize は `AppShell` が担当する
- connector／action catalogの取得と解釈、QWebChannel bridge、YAMLのparse／serialize、保存／読込、実行制御は担当しない
- parse 済み document は `.zizd` と同じ graph 構造を使用し、`steps`、`flows.<flow_id>.edges`、`loop.flows.<loop_step_id>.edges`、`loop_owner_id` を別構造へ変換せず扱う
- connector、action、params、schema などの Zizai 固有 field は意味を解釈せず、document 更新時にも保持する
- Zizai では `AppShell` の中央 editor 領域へ mount する
- zoom、fit view、スティッキーノートなど canvas 内で完結する local tool UI は `WorkflowDesigner` が担当する
- header などの app 全体 command は `AppShell` に表示し、実処理は app／adapter 側が担当する
- 別documentへの部分graph貼付では貼付先flowとのedgeを自動生成せず、コピー範囲内のedgeだけを新しいIDへ更新して未所属graphへ追加する
- 未所属graphには既存`flow_id`を付けず、編集用の仮STARTとともに表示する。保存は許可するがvalidation errorとし、解消まで実行を禁止する
- flow全体の貼付では新しい`flow_id`と配下stepの新しい`step_id`を発番し、内部edgeを保持した通常flowとして追加する
- 未所属graphを新しいflowへ所属させる場合は、AppShell headerの既存`flow.add`でflowを追加してから手動接続する
- app／adapterは複数document間のclipboardを管理し、`WorkflowDesigner`はfragment抽出、ID発番、内部edgeと共通graph参照の更新、未所属graphの描画を担当する

**補足**  

- `WorkflowDesigner` 自体は `AppShell` に依存せず、別アプリの任意の root element へ単独で mount できるようにする

#### ループ UI

- 現行のループ枠、ループ内 node、一周して戻る経路の表現を踏襲する
- ループ内外への追加、drag、選択、接続、削除など、ループ構造に関する描画と編集操作は `WorkflowDesigner` が担当する
- ループ用の JavaScript／CSS は `WorkflowDesigner` に含める
- ライブラリ内では再利用可能なループ構造として扱い、`WindowsConnector.loop_tasks` という connector/action 固有の意味は持たない
- `loop_tasks` との対応付け、反復条件、入力項目は app／adapter 側、行ごとの反復実行は backend 側が担当する
- graph の public data model は `.zizd` と同じ構造を共通契約とし、loop 親の `node_type: loop`、loop 内 step の `loop_owner_id`、内部 edge の `loop.flows.<loop_step_id>.edges` をそのまま使う
- `parentNodeId` などの WorkflowDesigner 専用 graph 構造は追加せず、app／adapter に graph topology の相互変換を持たせない
- Zizai app／adapterはloop内部で並列分岐と合流を作成できないgraph制約を`WorkflowDesigner`へ渡す
- loop内部の単一路制約はZizai固有のvalidationとし、再利用ライブラリへ固定の業務規則としてハードコードしない

#### スティッキーノート

- 現行のスティッキーノート仕様を踏襲する
- 位置、サイズ、本文、背景色を保持する
- 作成、選択、移動、resize、本文の inline 編集、色変更、削除を `WorkflowDesigner` が担当する
- 本文中の HTTPS link は link として表示し、クリック時は外部 link open request event を app 側へ通知する
- link を実際に開く処理と、YAML への serialize は app／adapter 側が担当する。sticky note の document 構造は別形式へ変換しない
- `WorkflowAnnotation` の型と annotation の変更 event は public API に明記する

#### style 拡張

- node、edge、loop、annotation、選択状態、実行状態ごとに、別アプリから変更できる正式な style 拡張点を提供する
- DOM renderer は、公開 `class` と `data-*` 属性を付与でき、app 側の CSS から見た目を変更できるようにする
- Canvas renderer は CSS class が描画済み pixel へ直接適用されないため、CSS custom properties、theme token、`CanvasRenderSpec` の style 指定を通して色や線を変更できるようにする
- node renderer は node type などに応じて公開 class／style を設定できるようにする
- スティッキーノートは保存データの `color` を使用し、選択可能な色候補は library default または app 側の options から指定できるようにする
- app 側は `WorkflowDesigner` の非公開 DOM class や内部構造へ依存しない
- 公開 class、CSS custom properties、theme options は public API として文書化する

---

### F-5A. TabularImportAssistant ライブラリの責務

**質問**  
Excel／CSV取込アシスタントを別アプリでも利用できる独自ライブラリにしますか。

**回答**  

`TabularImportAssistant`として独立した再利用ライブラリにする。

- Excel用／CSV用を別々の完全なlibraryにせず、preview表、header行／data開始行選択、confirm／cancelを共通coreにする
- sheet、encoding、delimiter等の形式差分はformat adapterにする
- file picker、file解析、preview取得、hidden ref、QWebChannel、Zizai schema生成は利用app／adapter側の責務とする
- sourceはopaque valueとして受け取り、libraryはpath／tokenの内部構造を解釈しない
- global `window.ExcelModal`／`window.CsvModal`や固定DOM IDをpublic APIにしない
- AppShellに依存せず任意のrootへ単独mountできるようにする

**補足**  

- Zizai appでは`file.pickFile`、`preview.readExcel`、`preview.readCsv`をapp adapterが呼ぶ
- 純粋なWebアプリではbrowser file parser等をprovider callbackとして差し替えられる
- public APIの正本は`202607-tabular-import-assistant-api.md`とする

---

### F-6. frontend state の分離

**質問**  
frontend state は document state / runtime state / UI view state に分離する方針でよいですか。

**現行実装**  
保存対象、実行状態、表示状態が混在しています。

**回答**  

frontend state は、次の 3 種類へ分離する。

1. `document state`
   - 現在編集中の workflow 本体
   - node／step の ID、表示名、位置、connector、action、parameter、edge、loop、sticky note、保存対象 schema などを保持する
   - parse 済み `.zizd` と同じ document 構造を使用し、保存時は app adapter が graph topology を変換せず YAML へ serialize する
2. `runtime state`
   - `run_id`、step の実行中／成功／失敗、進捗、result／log の参照などを保持する
   - frontend では backend が持つ実行状態の表示用 projection／cache として扱い、`.zizd` には保存しない
3. `UI view state`
   - 選択 node、active tab、sidebar／panel の開閉とサイズ、zoom、pan など、現在の画面表示だけに必要な情報を保持する
   - `.zizd` には保存せず、変更しても workflow を未保存状態にしない

**補足**  

- 保存して再読込したときに workflow として再現すべき情報は `document state` とする
- node の位置や sticky note は視覚情報でも workflow の構成として再現するため `document state` に含める
- node の選択、zoom、pan、panel 幅はその時点の画面操作なので `UI view state` とする
- dirty 判定は `document state` の変更だけを対象とする
- `selectedNode` など ID から取得できる派生 state は重複保持せず、selector で求める
- appのdocument storeを編集中documentの唯一の正本とし、`WorkflowDesigner`はdocument transactionを通知するcontrolled componentとする
- undo／redo履歴はdocument単位でapp document storeが保持し、保存時に`.zizd`の内容が変わるtransactionだけを履歴へ入れる
- runtime stateとUI view stateはundo／redo対象にしない
- drag、文字入力等の連続変更は操作確定時に1 transactionへまとめる
- 保存操作自体は履歴を追加せず、保存成功時のhistory位置を保存済み位置として記録する。現在位置との差でdirtyを判定する
- 履歴はYAML全文ではなくdocument patchと逆patchで保持する

---

## G. 実装順序

### G-1. 最初に確定する章

**質問**  
最初に確定する章は `.zizd` 保存形式でよいですか。

**提案理由**  
path、schema、flow、step_id が `.zizd` に依存するためです。

**回答**  

最初に確定する設計章は、`.zizd` 保存形式とする。

**補足**  

- `step_id`、flow edge、schema、path など、後続章の契約が `.zizd` 保存形式へ依存するためである
- これは設計を確定する順番であり、実装順序は G-2 で別に定める
- 202607 詳細設計では、A 章の `.zizd` 保存形式から確認を開始済みである

---

### G-2. 仕様確定後の実装順序

**質問**  
実装順序は以下でよいですか。

1. `.zizd` 保存形式
2. backend catalog / connector metadata
3. runtime / result store
4. QWebChannel bridge / security
5. frontend app data area
6. frontend library 分離
7. Playwright / E2E

**回答**  

仕様確定後は、次の順序で実装する。

1. `.zizd` 保存・読込・validation
2. backend catalog／connector metadata
3. runtime／result・log store／CLI flow 実行
4. QWebChannel bridge／security／GUI backend
5. `AppShell`／`TabularImportAssistant`／`WorkflowDesigner`
6. frontend app／adapter／data area
7. 結合・Playwright／E2E

**補足**  

- `AppShell`、`TabularImportAssistant`、`WorkflowDesigner`は別アプリでも利用する独自ライブラリであるため、Zizaiのfrontend app統合より先にpublic APIと実装を確定する
- CLI flow実行はWebView／QWebChannelを起動せず、runtime／core／connectorを直接利用する
- 単体 test と契約 test は各段階で実施し、最後の段階では結合 test と E2E を実施する

---

## H. 固定残件表

この表は2026-07-26時点の未確定事項を固定した管理表である。回答後は項目を削除せず`回答済み`または`一部回答済み`へ変更し、各詳細欄の未解決論点を減らす。新しい未確定事項を発見した場合は、既存項目へ紛れ込ませず、追加理由と影響範囲を明示して新しいIDを付ける。

| ID | 状態 | 未確定事項 |
| --- | --- | --- |
| `R-01` | 回答済み | ②ワークフロー外単体実行で許可するBigQuery／DuckDB／Pythonの具体的action、inline／file／未保存documentの扱い、DataFrame／metadata／その他resultの表示、②の実行元document単位のrun制御、およびdry runの確認範囲 |
| `R-02` | 回答済み | ②の実行中に実行元documentを閉じる場合のcancel／background継続、結果表示とlog参照の扱い |
| `R-03` | 回答済み | ①／②を合わせて実際に同時稼働させるworker上限、queue表示、同一resourceの競合をどう扱うか |
| `R-04` | 回答済み | ①のterminal summary／schema／preview cacheの保持件数・memory上限・tab close時の扱い、channel再初期化後のrun再発見、run log pagination／disk総量上限 |
| `R-05` | 回答済み | `gui-step-run`のlatest raw cache無効化と、Selenium等DataFrame以外のresource scope |
| `R-06` | 回答済み | loop親をmain flow上の1stepとして扱い、loop内childを含む内部処理全体を実行する |
| `R-07` | 回答済み | 最大4document、5件目の入替動作、同一fileの再open、外部更新とのsave conflict、atomic save、単一GUI instance、2つ目のprocessから既存windowへの要求転送 |
| `R-08` | 回答済み | `.zizd`の保存キー名、通常flowのAND合流、loop内部の並列／合流禁止、`ziz_datatype`の正規表記 |
| `R-09` | 回答済み | state／責務分離、複製、copy／paste、flow追加、undo／redo、編集中documentの正本と責務分担 |

未解決の大項目: **0**

未解決の個別論点: **0**

### R-01. ワークフロー外単体実行のactionとresult

**確定済み**

- 単独で開始できる`BQConnector`、`DuckConnector`、`PythonConnector`のactionは②の通常実行として許可する
- 現行actionでは、`BQConnector.execute_sql`／`execute_sql_file`、`DuckConnector.create_db_file`／`execute_sql`／`execute_sql_file`、`PythonConnector.execute_python`を通常実行対象とする
- 入力DataFrameを必要とする`BQConnector.load_data`、`DuckConnector.create_table`、`ExcelConnector.write_excel`は通常実行として単独開始せず、選択した②run resultのExport先としてだけ使用する
- Exportでもworkflow／step／edgeは作らず、実行元runのresultを選択したconnector actionへ直接渡す
- 複数処理を接続する汎用的なdata pipeline機能は②へ含めず、別機能として将来設計する
- inline SQL／Pythonは未保存でも現在のeditor内容を実行できる
- SQL／Pythonのfile実行は、対象fileが保存済みかつ実在することを必須にする
- DataFrame resultは上限付きpreview表とExport操作を表示する
- execution metadataは項目表、scalar／textは文字列、list／dictionaryはJSONへserializeした文字列として表示する
- result表はheaderを固定し、行方向／列方向にscrollできるようにする
- ②の同一実行元document（SQL／Python等、`.zizd`を除く）ではactive runを1件までとする
- active run中は、その実行元documentの通常実行／dry runを無効にし、cancelを可能にする
- 異なる②の実行元documentは同時実行できる。この規則は`.zizd`を使う①の実行制御を変更しない
- ②のdry runは`BQConnector.execute_sql`／`execute_sql_file`、`DuckConnector.execute_sql`／`execute_sql_file`、`PythonConnector.execute_python`だけに設ける
- DuckDBにはBigQueryのような汎用native dry runはない。`DuckConnector.execute_sql`／`execute_sql_file`は、DuckDBが`EXPLAIN`を受け付けるSQLだけを非実行で解析する
- `EXPLAIN`対象外の作成・更新系SQLは実行せず、params、参照先、出力先等の入力検証だけを行う。実行時の成功までは保証しない
- `DuckConnector.create_db_file`にはdry runを設けず、通常実行の書込み前validationを必須にする
- DuckDBのdry run結果は、通常実行の成功ではなく、`EXPLAIN`による解析完了または入力検証完了として確認範囲を明示する
- `BQConnector.execute_sql`／`execute_sql_file`はBigQueryのnative dry runを使用し、SQLを実行せず、検証成否、推定処理bytes、エラー内容を表示する
- BigQuery dry runではデータを取得しないため、preview／row countは表示しない
- Pythonの通常実行／dry runはapp同居venvを使用し、実行元documentからPython環境を指定させない
- Python実行時にlibraryをinstallせず、不足libraryも自動installしない。package管理UI／actionは設けない
- 利用者が記述したPythonコード内の`subprocess`等は、package install検出のためだけにsandbox遮断しない
- Python dry runはユーザーコードを実行せず、app同居venvで構文をcompileし、ASTでトップレベルの`main()`定義と引数なしで呼べる形を確認する
- 通常の`import`文はapp同居venvに対象libraryが存在するか静的確認する。library自体はimport／実行せず、動的import、runtime error、戻り値は保証しない
- Python dry run結果は通常実行成功ではなく「静的検証完了」と表示する
- Exportにはdry runを設けない。`BQConnector.load_data`、`DuckConnector.create_table`、`ExcelConnector.write_excel`は通常Export開始時にsource DataFrame、params、schema、出力先を自動validationし、失敗時は書込み前にerrorにする
- ②の実行元documentで、通常実行は`Ctrl+Enter`、dry runは`Ctrl+Shift+Enter`とする。202607版はWindows PC版のみを対象とする
- このショートカット規則はSQL／Python等の②の実行元document向けとし、`.zizd`のWorkflowDesigner側の実行規則を変更しない

DuckDB `EXPLAIN`の根拠: [DuckDB公式 EXPLAIN](https://duckdb.org/docs/current/guides/meta/explain)
BigQuery native dry runの根拠: [BigQuery公式 Dry run query](https://cloud.google.com/bigquery/docs/samples/bigquery-query-dry-run)

**回答状況**

- `R-01`は回答済み。残りの確認事項はない

### R-02. ②実行中の実行元document close

**確定済み**

- 対象は②の実行元document（SQL／Python等、`.zizd`を除く）とする
- active run中のclose要求では、`閉じずに続行`と`実行をキャンセルして閉じる`の二択を表示する
- 既定選択は`閉じずに続行`とし、documentを閉じてrunだけをbackground継続する選択肢は設けない
- cancelして閉じる場合は`run.cancel`のterminal eventとcleanup完了を待つ
- cancel完了後もdocumentがdirtyなら、保存して閉じるか保存せず閉じるかを確認する
- 保存dialogのcancel、保存失敗、保存競合時はdocumentを閉じないが、runのcancelは完了済みとする
- close完了時に②のpreview、result、画面表示用run log、frontend stateを即時破棄する
- run log fileだけは共通log方針に従って10日間保持する
- 閉じた②のrunを一覧・再表示するglobal実行ログ画面は設けず、同じfileを開き直してもpreview／result／画面表示用run logを復元しない
- documentを閉じず、QWebChannelだけが一時的に再初期化された場合のlog復元とは区別する

**回答状況**

- `R-02`は回答済み。残りの確認事項はない

### R-03. worker上限、queue、resource競合

**確定済み**

- 1つのGUI sessionで実際に同時稼働するconnector処理は標準4 workerまでとし、backend設定で変更可能にする
- workerに空きがない場合もrun要求は受理し、未開始処理を`queued`にする
- ②ではconnector処理開始前のrun全体を`queued`、①ではrunを`running`のまま未開始stepだけを`queued`にする
- `queued`はerrorではなく実行待ちを表し、workerが空き次第自動的に開始する
- queueは特定runがworkerを占有し続けないようrun間で公平に選択する
- `queued`中も通常の`run.cancel`でcancelできる
- 202607版では、backendによる同一resourceの汎用lock、action固有の競合validation、強制直列化を設けない
- 同一file、database、table等への競合をconnectorまたは外部システムがerrorとして返した場合は、通常のstep failureとして処理する
- errorにならない上書きや操作干渉はbackendでは検知しない
- `WindowsConnector.mouse_click`、`input_text`、`send_keys`等にも特別なlock、並列分岐validation、強制直列化を設けない
- desktop操作の実行中は、利用者および他の自動化toolが対象desktopを操作しないことを利用条件とする

**回答状況**

- `R-03`は回答済み。残りの確認事項はない

### R-04. terminal表示cache、channel復旧、run log上限

**確定済み**

- `gui-flow-run`のterminal summary、schema、preview、row_countはflowごとに最新run 1件だけ保持する
- 同じflowの新しいrunを開始した時点で前回runの表示用cacheを破棄し、以前のrunへfallbackしない
- document close時は、そのdocumentに属する全flowの表示用cacheを破棄する
- `gui-step-run`のlatest raw cacheと表示用cacheのstale化は`R-05`で定義する
- 各stepのpreviewは先頭100行を上限とし、100行を超える場合は`truncated: true`を付ける
- 1stepのpreview全体はUTF-8 JSON換算2 MiB、1セルの表示値は64 KiBを上限とし、超過部分は表示用previewだけを切り詰めて`truncated: true`を付ける
- byte数はQWebChannel送信用payloadを構築する1回のserialize処理中に加算し、上限到達時点で停止する。全体serializeと縮小serializeを繰り返さない
- 上限処理はraw DataFrameと後続stepへ渡すデータに影響させず、実装後にpreview生成時間をbenchmarkで確認する
- GUI session全体の表示用cacheはUTF-8 JSON換算128 MiBを標準上限とし、backend設定で変更可能にする
- session上限を超える場合は、完了時刻が古いflowからpreviewだけを破棄し、terminal summary、schema、row_countは残す
- active runのcacheだけで上限へ達し、破棄可能なterminal previewがない場合は新しいpreviewを保存せず、画面へcache上限で表示できないことを返す。raw DataFrameとrun自体は停止しない
- 同じOSユーザー内でZizai GUIは単一instanceとし、`app.getStatus`は現在の1つの`session_id`だけを対象にする
- `doc_session_id`はGUI起動中に再利用せず、`doc_session_id + flow_id`で開いているflowを一意に識別する
- `app.getStatus`は、開いているdocumentの`doc_session_id`、①のflowごとの`flow_id`／activeまたはlatest `run_id`／status、②のactive `run_id`／statusを軽量なrun索引として返す
- summary、preview、logs本体は索引へ含めず、frontendが画面で必要になった分だけ個別取得する
- document close済みのrunは索引へ含めず、channel復旧時にbackendでrunを再実行しない
- run logの初回表示は最新500件とし、上scrollでは`before_seq`より前、実行中／再接続では`after_seq`より後を、それぞれ最大500件ずつ取得する
- `before_seq`と`after_seq`は同時指定不可とし、backendは常に`log_seq`昇順で返す
- 全log種別を合計したdisk使用量は標準1 GiBをsoft上限とし、backend設定で変更可能にする
- app起動時と日次rotation時に、10日を超えたfileを先に削除し、まだ上限を超える場合は古い日付のfileから日単位で削除する
- 当日fileは削除せず、当日中の一時的な上限超過は許容する

**回答状況**

- `R-04`は回答済み。残りの確認事項はない

### R-05. `gui-step-run` latest raw cacheとresource寿命

**回答済み**

- `gui-step-run`が成功したDataFrameは、flow内のstep別latest raw cacheとして保持する
- 保持期限は、次の同一step実行による更新、flow close、app終了までとする
- 最新の同一step実行がerrorまたはcancelledの場合は以前の成功結果へfallbackせず、そのstepのlatest raw cacheを無効化する
- 上流入力には成功状態のlatest `gui-step-run` raw cacheだけを使用し、未実行、error、cancelled、参照先不存在、cache利用不能は実行前errorにする
- `cli-flow-run`／`gui-flow-run`のraw DataFrameは`gui-step-run`の上流入力へ流用しない
- connector／action／params／schemaを変更した場合は、変更stepと依存graph上の全下流stepのlatest raw cacheと表示用cacheを無効化する
- edge／入力参照／開始変数を変更した場合は、その変更の影響を受けるstepと依存graph上の全下流stepのcacheを無効化する
- stepを削除した場合はそのstepのcacheを削除し、参照関係の変更により影響する下流cacheも無効化する
- label／node位置／色／sticky note等、実行内容へ影響しない変更ではcacheを維持する
- 無効化したraw DataFrameはmemoryから解放し、以前の成功結果へfallbackしない。必要な上流cacheがなくなった下流step実行は、上流の再実行が必要なことを示す実行前errorにする
- `.zizd`、明示的に出力済みのfile、保存済みrun logはcache無効化の対象にしない
- `gui-flow-run`／`cli-flow-run`のSelenium browser session等のmanaged resourceは、最後の既知consumer完了後に解放し、run終了、error、cancelを保持期限の上限とする
- `gui-step-run`で生成したbrowser session等は、後続stepを利用者が後から単独実行できるよう、`doc_session_id + 生成step_id`のlatest resourceとして保持する
- `gui-step-run`のlatest resourceは、同じ生成stepの再実行、生成stepまたは依存関係のcache無効化、document close、app終了時にcleanupする
- 同じ生成stepの再実行がerrorまたはcancelledになった場合は、以前のresourceへfallbackしない
- frontendへは`web_session_id`等の識別子だけを返し、WebDriver等のresource本体はbackendだけで保持する

**回答状況**

- `R-05`は回答済み。残りの確認事項はない

### R-06. loopの単独実行とresult表示

**回答済み**

- loop内の同じstep resultは反復ごとに同じ`run_id + step_id`へ上書きし、全反復結果を保持しない
- loop外へ明示的に渡すresultは最終反復の値だけとし、loop内部だけで使ったraw DataFrameと一時変数は反復内の最後のconsumer完了後またはloop終了時に解放する
- data areaは最後に完了した反復のschema、preview、row_countだけを表示し、反復ごとのresult選択UIは設けない
- loop開始logへ`iteration_total`、反復中のlogへ必要に応じて1始まりの`iteration_no`を記録する
- 総反復件数が0の場合はloop内stepを実行せず正常終了し、開始logと終了logを各1件記録する
- `loop_owner_id`を持つloop内child stepは単独の`gui-step-run`対象にしない
- loop child nodeの設定と最終result表示は可能だが、単独実行buttonは無効化する
- frontendを経由せずloop childの`run.start`が要求された場合も、backend validation errorとして実行しない
- loop親の`gui-step-run`は、外部から見た入力、status、result、cache、error、cancelのcontractに通常stepと同じルールを適用する
- loop内部では既に確定した反復context、child graph実行、反復ごとの上書き／解放、loop error／cancel規則を使用する。`gui-step-run`のための別ルールは追加しない
- Zizaiのloop内部graphは単一路だけを許可し、並列分岐と合流を禁止する

**回答状況**

- `R-06`は回答済み。残りの確認事項はない

### R-07. document open／save

**回答済み**

- 1つのGUI `session_id`で同時に開けるdocumentは、保存済み／未保存の`.zizd`、SQL、Python等を合算して最大4件とする
- 同じOSユーザー内でZizai GUIは単一instanceとし、2つ目のprocessはbackendと`session_id`を作成しない
- `doc_session_id`はGUI起動中に再利用しない
- active run中のcloseは`閉じずに続行`または`実行をキャンセルして閉じる`の二択とし、cancel／cleanup後にdirtyなら保存有無を確認する
- 保存dialogのcancel、保存失敗、保存競合時はdocumentを閉じない
- 5件目のopen要求では5件同時には開かず、既存4件のうち最も新しく開いたdocumentを通常のclose処理で閉じた後、要求されたdocumentを開く
- 5件目のopen要求時に上限警告やclose対象選択dialogは表示しない
- 通常のclose処理が中止または失敗した場合は、要求されたdocumentを開かない
- 既に開いているfileを再度openした場合は新しいdocumentを作らず、既存documentを前面表示する
- 同一fileの再openでは未保存の編集内容を維持し、fileの再読込、`doc_session_id`の再発番、4件上限によるdocument入替を行わない
- file読込時と保存成功時に、対象fileの最終更新時刻をdocument stateへ保持する
- 上書き保存の直前に現在の最終更新時刻と保持値を比較し、異なる場合は外部更新として自動上書きしない
- 外部更新を検知した場合は`上書き保存`、`名前を付けて保存`、`キャンセル`を提示し、diff／mergeは提供しない
- 外部更新検知のために修正前全文や全文hashは保持しない
- Zizaiによる保存成功後は保存後の最終更新時刻を再取得し、保持値を更新してdocumentを`dirty=false`にする
- 未保存documentは初回保存成功まで最終更新時刻を持たない
- 保存時は対象fileと同じfolderの一時fileへ内容を最後まで書き込み、書込み成功後に元fileと一括置換する
- 一時fileへの書込みまたは元fileとの置換に失敗した場合は元fileを維持し、一時fileを削除して保存失敗を表示する
- 常設の`.bak` fileは作成しない
- 既存GUIの起動中に2つ目のprocessが起動された場合は、新しいGUI、backend、`session_id`を作成せず、既存windowを前面表示して終了する
- 2つ目のprocessがfile指定を伴う場合は、そのopen要求を既存GUIへ転送してから終了する
- 転送されたopen要求にも、同一fileの再openおよび最大4documentの確定済みルールを適用する

**回答状況**

- `R-07`は回答済み。残りの確認事項はない

### R-08. `.zizd`最終schema

**回答済み**

- `.zizd`はYAMLを正本とし、parse後のdocumentと`WorkflowDesigner`は同じgraph構造を使用する
- stepはcatalogを複製せず、connector／actionの参照だけを保存する
- `schema.columns`はYAMLの辞書・配列として保存し、`schema.mode`は保存しない
- connector／actionを参照するYAMLの保存キー名は`connector_id`／`action_id`へ統一し、`connector`／`action`は使用しない
- `.zizd`、bridge、logで同じ`connector_id`／`action_id`の名称を使用する
- `*_id`は識別子／参照値、参照先オブジェクト本体は別の正本で管理する共通命名規則をA-14に定義する
- 通常flowで同じstepへ複数のedgeが入る場合はAND合流とし、直接接続された全stepの正常完了後に合流先stepを開始する
- 合流によるデータ結合は行わず、`edge.kind: merge`も保存しない
- loop内部では並列分岐と合流を許可しない
- `ziz_datatype`のscalar正規値は`INT64`、`FLOAT64`、`NUMERIC`、`STRING`、`BYTES`、`DATE`、`DATETIME`、`TIMESTAMP`、`TIME`、`INTERVAL`、`BOOL`とする
- container型は`ARRAY`、`STRUCT`とし、具体型は`ARRAY<STRING>`、`STRUCT<id:INT64>`のように型tokenを大文字で保存する
- 入力時の大文字／小文字差は正規化するが、`.zizd`、bridge、runtime cacheには正規表記だけを保持する
- 詳細は`202607-column-schema.md`を正本とする

**回答状況**

- `R-08`は回答済み。残りの確認事項はない

### R-09. `WorkflowDesigner`の編集責務

**回答済み**

- frontend stateはdocument state、runtime state、UI view stateへ分離し、dirty判定はdocument stateの変更だけを対象にする
- app／adapterはYAML parse／serialize、保存／読込、catalog、実行を担当し、`WorkflowDesigner`は同じgraph構造の描画と編集を担当する
- node複製では新しい`step_id`、flow複製では新しい`flow_id`と配下stepの新しい`step_id`を発番する
- 同一document内の複製では、edge、loop graph、`loop_owner_id`等の共通参照を`WorkflowDesigner`が更新し、app固有fieldの参照は`referenceRewriter` callbackで更新する
- 複製はdocumentを一括更新し、完了後に`document:change`を1回だけ通知する
- 別documentへの部分graph貼付は新しい`step_id`を発番し、貼付先flowとのedgeを作らず、内部edgeだけを更新して`unassigned`へ保存する
- `unassigned`には既存`flow_id`を付けず、編集用の仮STARTを表示する。保存可能だがvalidation errorとし、解消までworkflowを実行できない
- flow全体の貼付は新しい`flow_id`と配下stepの新しい`step_id`を発番し、通常flowとして追加する
- 複数document間のclipboardはapp／adapter、fragment抽出、ID発番、内部edgeと共通参照の更新、未所属graphの描画は`WorkflowDesigner`が担当する
- `flow.add`はAppShellの共通command buttonをZizaiのHTML／JavaScriptからheaderへ登録し、初期graph生成はZizai app／adapterが担当する
- app document storeを編集中documentの唯一の正本とし、`WorkflowDesigner`はdocument transactionを通知するcontrolled componentとする
- undo／redo履歴はapp document storeがdocumentごとに保持し、保存時に`.zizd`の内容が変わるtransactionだけを対象にする
- dragや文字入力等の連続変更は操作確定時に1 transactionへまとめ、runtime／UI state変更は履歴に含めない
- 保存成功時のhistory位置を保存済み位置として記録し、現在位置との差でdirtyを判定する

**回答状況**

- `R-09`は回答済み。残りの確認事項はない
