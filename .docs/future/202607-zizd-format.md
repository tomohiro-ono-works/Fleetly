# 202607 zizd ファイル形式仕様

## 位置づけ

この文書は、202607 版の `.zizd` ファイル形式を定義する。

YAMLの文字列、multiline、collection、indent、parse／cache規則は`202607-yaml-style.md`を正本とする。

現時点では、`step_id` と実行グラフの扱いを先に固定する。

## 結論

`step_id` は順序を意味しない。

`step_id` は workflow step の安定 ID であり、結果、ログ、schema、preview、UI 選択、step 間参照の紐づけに使う。

実行順序は `step_id` ではなく、`flows.<flow_id>.edges`、通常flowの並列／AND合流、loop構造で決める。

1つの `.zizd` に複数の独立 flow を保存でき、各 flow は同一 canvas 上に専用の開始 node と終了 node を持つ。

202607 版の保存形式では各 flow の `edges` を必須とし、ファイル path は hidden ref ではなく実パスで保存する。

## `step_id` の責務

| 用途 | 方針 |
| --- | --- |
| 安定 ID | 必須。空文字不可。`.zizd` 全体で一意 |
| result 取得 | `run_id + step_id` を正本にする |
| log 紐づけ | step に紐づく log は `step_id` を持つ |
| schema / preview | data area 表示対象の key にする |
| step 間参照 | `input_data`、`source_step_id` などの参照 key に使う |
| 表示名 | `label` として `step_id` から分離する |
| 実行順 | 使わない |

## `step_id` / `flow_id` の発番

- `step_id` と `flow_id` は、10進数字だけで構成する文字列として保存する。
- 発番は1始まりとし、`'01'`から`'99'`までは2桁0埋め、100以降は`'100'`、`'101'`のように桁数を増やす。2桁は固定長ではなく最小桁数である。
- `step_id` と `flow_id` は別々の連番として管理する。
- 新規IDは、各連番の既存最大値に1を加えて生成する。削除済みIDは再利用しない。
- IDは通常のGUI編集ではread-onlyとし、`label`の変更でIDを変更しない。
- GUIでは`WorkflowDesigner`の標準発番器を使用する。別アプリは同じ標準発番器をそのまま利用でき、必要な場合だけ発番callbackを差し替えられる。
- node複製では新しい`step_id`、flow複製では新しい`flow_id`と配下stepの新しい`step_id`を発番する。
- flow複製時はedge、loop graph、`loop_owner_id`など共通graph構造内の参照を新IDへ更新する。connector parameter内の参照はapp固有callbackで更新する。
- 別documentはIDのscopeが異なるため、同じ`step_id`／`flow_id`を使用できる。
- `START`と`END`は予約IDであり、この連番には含めない。

## 複数 flow

`flows` は `flow_id` を key とする mapping にする。`flow_id` は安定 ID とし、表示名は各 flow の `label` に分離する。

通常flowへ所属する各stepは`flow_id`を持ち、所属するflowを明示する。同じstepを複数flowで共有せず、flow間のedgeも作らない。部分graph貼付直後の未所属stepだけは、後述する`unassigned`に列挙したうえで`flow_id`を持たない編集途中状態を許可する。

各 flow は開始 node と終了 node を1つずつ持つ。開始／終了 node は connector step ではないため `steps` には入れず、各 flow 定義の `start`／`end` に canvas 上の位置を保存する。

開始変数は top-level の `variables.start` へ共通保存せず、`flows.<flow_id>.start.variables` に flow 単位で保存する。対象 flow の実行開始時だけ、その開始変数を runtime context へ投入する。

`START` と `END` は各 flow の edge 内だけで有効な予約 ID とする。同じ canvas 上に複数存在しても、`flow_id` の scope で区別する。

CLIの既定実行対象は`metadata.default_flow_id`で指定する。未指定時は`'01'`を既定値とし、対象IDが`flows`に存在しない場合はvalidation errorにする。

WorkflowDesignerの選択・クリック通知では、通常stepを`node_id: <step_id>`、開始／終了nodeを`node_id: START|END`と`flow_id`の組で識別する。この通知用表現は`.zizd`の保存構造を変更しない。

旧single-flow形式の`flows.edges`とtop-level `variables.start`は読み込まず、新しい複数flow形式へ自動変換しない。`flow_id`を持たないstepは正規の`unassigned.step_ids`に含まれる場合だけGUIで読み込み、その他はformat validation errorにする。CLIは`unassigned`を含むdocumentを実行しない。

開始／終了 node、通常 step、loop、sticky note は同一 canvas 座標系に配置する。zoom／pan は `.zizd` へ保存せず、UI view state として扱う。

### 新規 flow の初期 template

Zizai app が新規 `.zizd` または flow を追加する場合は、次の初期 graph を生成する。

```text
START -> WindowsConnector.define_values -> END
```

開始 node、終了 node、`define_values` step の位置と ID は app 側が生成する。`define_values` は必須ではなく、削除して `START -> END` にできる。

開始 node の `variables` は最初のstepより前にcontextへ投入する値であり、`define_values` はその後に実行される通常stepとして区別する。

この初期 template は Zizai app／adapter の責務とし、再利用ライブラリ `WorkflowDesigner` に `WindowsConnector` や `define_values` をハードコードしない。

## 未所属 graph

別documentからflowの一部を貼り付けた場合は、貼付先の既存flowへ自動挿入せず、top-levelの`unassigned`へ未所属graphとして保存する。

```yaml
unassigned:
  start:
    ui_position:
      x: 80
      y: 720
  step_ids:
    - '04'
    - '05'
  edges:
    - from: '04'
      to: '05'
      order: 1
```

- `unassigned.start`は未所属領域を示す編集用の仮STARTであり、通常flowのSTARTではない。
- 仮STARTは`flow_id`を持たず、flow一覧、既定flow、GUI／CLIの実行対象に含めない。
- 貼り付けるstepには貼付先documentで重複しない新しい`step_id`を発番し、`flow_id`は付けない。
- コピー範囲内のedgeだけを新しい`step_id`へ更新して`unassigned.edges`へ保存し、コピー範囲外とのedgeは保存しない。
- コピー範囲内を参照するapp固有fieldは新しいIDへ更新し、コピー範囲外を参照するfieldは未設定としてvalidation errorを表示する。
- 未所属graphはGUIから`.zizd`へ保存できるが、`unassigned.step_ids`が1件以上ある間はworkflowを実行できない。CLIもvalidation errorにする。
- 利用者が通常flowから未所属graphの先頭nodeへedgeを作成した場合、その接続された未所属componentのstepへ接続元の`flow_id`を設定し、内部edgeを`flows.<flow_id>.edges`へ移す。
- 新しいflowへ所属させる場合は、AppShell headerの既存`flow追加`commandで通常flowを作成した後、同じ接続操作を行う。
- 未所属stepが0件になった時点で`unassigned`と仮STARTをdocumentから削除する。
- START／ENDを含むflow全体のcopy／pasteは未所属graphにせず、新しい`flow_id`と`step_id`を発番した通常flowとして追加する。

## loop 構造

- loop 親は通常 step と同じく `steps` に保存し、`node_type: loop` を持つ。
- loop 内 step も同じ `steps` 配列へ flat に保存し、`loop_owner_id` でloop親の `step_id`を参照する。
- loop 親とloop内 stepは同じ `flow_id` を持つ。
- loop 内の依存関係は `loop.flows.<loop_step_id>.edges` に保存する。
- mainの `flows.<flow_id>.edges` ではloop親を1つのstepとして前後へ接続し、loop内 stepをmain graphへ直接接続しない。
- Zizaiのloop内部graphは単一路だけを許可し、同じnodeから複数edgeを出す並列分岐と、同じnodeへ複数edgeを入れる合流を禁止する。
- loop actionであることは親stepの `node_type: loop`を構造上の正本とし、catalog metadataでもそのactionがloop対応であることを検証する。
- backendは`action == "loop_tasks"`のようなaction名判定ではなく、正規化済みのnode type／catalog metadataからloop実行を選択する。
- 旧 `flows.loop.flows` の読込互換と自動変換は行わない。

## WorkflowDesigner との共通 graph 構造

- YAML parse 後の document と `WorkflowDesigner` の document は、同じ graph 構造を使用する。
- `steps`、`flows.<flow_id>.edges`、`unassigned`、`loop.flows.<loop_step_id>.edges`、`node_type`、`loop_owner_id` を別の node／edge 構造へ変換しない。
- `WorkflowDesigner` 専用の `parentNodeId` を node／edge に追加する形式は採用しない。
- `WorkflowDesigner` は graph の描画・編集に必要な共通 field だけを解釈し、connector、action、params、schema などの Zizai 固有 field は意味を解釈せず保持する。
- app／adapter は YAML の parse／serialize、catalog との対応付け、保存、実行を担当するが、graph topology の相互変換は担当しない。
- 別アプリも同じ graph 構造を使用し、app 固有 field は追加 field として保持できる。

## sticky note

sticky noteはtop-levelの`notes`へ保存する。

```yaml
notes:
  - note_id: '01'
    ui_position:
      x: 320
      y: 560
    size:
      width: 240
      height: 144
    text: '確認事項'
    color: '#fff2a8'
```

- `note_id`はdocument内で一意な識別子とし、`'01'`始まりの最小2桁10進文字列で発番する。
- `ui_position`と`size`は同一canvas座標系の数値として保存する。
- `text`は本文、`color`は背景色を表す。
- 選択、移動、resize、本文編集、色変更は`WorkflowDesigner`がdocument transactionとして通知する。
- 旧`id`／`x`／`y`／`w`／`h`形式は202607形式として読み込まず、自動変換しない。

## ファイル path

- `.zizd` の connector/action parameter には、選択されたファイルの実パスを保存する。
- UI 内部で path を hidden ref として扱う場合も、`.zizd` 保存時には実パスへ戻す。
- `.zizd` へ path ref／hidden ref を保存し、実パスを別管理する形式にはしない。
- path の masking は log や debug 情報の出力時に行い、`.zizd` の保存値自体は masking しない。
- `.zizd` を共有した場合は保存されたローカル path も共有されるため、利用者がファイル内容を確認できるようにする。

## 実行順序

ステップ単位の単一の実行順は持たない。

理由は、並列、合流、loop 内 flow、条件分岐があるため、全 step に対して 1 本の連番 order を持たせると意味が壊れるためである。

実行順序は次で表す。

| 要素 | 役割 |
| --- | --- |
| `flows.<flow_id>.edges` | flow ごとの依存関係と到達順 |
| `flows.<flow_id>.edges[].from` / `to` | その flow の `START`、`END`、または同じ `flow_id` を持つ `step_id` を参照 |
| `flows.<flow_id>.edges[].order` | 同一親から複数 edge が出る場合の branch 表示順と runtime ready queue の tie-breaker。global 実行順ではない |
| `loop.flows.<owner_step_id>.edges` | loop 内 flow の依存関係 |
| `loop_owner_id` | step がどの loop step に属するか |
| 同じstepへ入る複数edge | 合流先へ直接接続された全stepの正常完了を待つAND合流 |

`steps` 配列順は保存上の並びであり、実行順の正本にしない。

edgeに`edge_id`は保存しない。通常flowのedgeは`flow_id + from + to`、loop内edgeは`loop_owner_id + from + to`で識別し、同じgraph内で同一`from + to`を持つedgeは重複保存しない。複数documentを開くGUIでは、AppShellがこの組を`doc_session_id`のscopeに置く。

通常flowのAND合流は複数のincoming edge自体で表し、`edge.kind: merge`は保存しない。合流は実行開始条件だけを表し、DataFrame等のデータを結合しない。

`edge.order` は利用者が通常入力する項目にせず、GUI から保存する場合は backend が同一の `from` を持つ edge の表示順から自動生成する。値の小さい edge を先の tie-breaker とする。ただし、依存関係を満たした step の並列実行を直列化するものではない。

## 保存・読込時の `flows.<flow_id>.edges`

`.zizd` の正規保存形式では、各 flow の `edges` を必須とする。実行時に `steps` 配列順へ fallback する通常仕様は持たない。

### GUI 読込

- `.zizd`はfileを開いた時に1回だけparse／validationし、以後はmemory上のdocument snapshotを参照する。
- flow の `edges` が無い場合は、その `flow_id` に所属する `steps` の配列順と各 `step_id` を使って frontend document 上へ一時的な edge を生成する。
- 一時 edge を生成した workflow は未保存状態にする。保存時には生成済み edge を該当する `flows.<flow_id>.edges` へ書き出す。
- 不正な step 参照、loop、merge、graph の不整合があっても画面は開き、該当 node／edge に validation error を表示する。
- validation error が残る間は実行を禁止するが、修正途中の `.zizd` 保存は許可する。
- edgeの一時生成は新しい `flows.<flow_id>` 構造を認識できる場合だけ行い、旧single-flow形式を変換する用途には使わない。

### CLI 読込・実行

- command開始時にcatalogと`.zizd`をそれぞれ1回だけ読み込み、そのcommand中は同じsnapshotを使う。
- 利用者がflowを選択できるよう、CLIは`flow_id`と`label`の一覧を表示できるようにする。
- flow指定がある場合はその`flow_id`、指定がない場合は`metadata.default_flow_id`、それもない場合は`'01'`を実行対象にする。
- 指定または既定の`flow_id`が存在しない場合は、利用可能な`flow_id`と`label`を示してvalidation errorにする。
- 対象 flow の `edges` が無い場合も一時生成や sequential fallback は行わず、validation error として実行を終了する。
- 不正な step 参照、loop、merge、graph の不整合がある場合も実行しない。

DataFrame 実体の保持、解放、data area cache は `.zizd` の保存形式ではなく runtime の責務とする。詳細は `202607-runtime-data-lifetime.md` を正本にする。

Excel / CSV / BigQuery などのカラム指定、型指定、rename、スキーマ読込は `steps[].schema` に YAML の辞書・配列として保存する。詳細は `202607-column-schema.md` を正本にする。

## 現行仕様・実装の確認結果

| 項目 | 現行 |
| --- | --- |
| 正本形式 | `.docs/architecture.md` では `.zizd` が `metadata / variables / steps / flows` を持つ |
| 実行制御 | `core/workflow_engine.py` が実行順序制御を担当 |
| 実行グラフ | `flows.edges` がある場合、core は DAG として実行 runtime を作る |
| fallback | `flows.edges` が無い場合、core は `steps` 配列順の sequential 実行へ fallback する |
| UI export | `static/js/app.js` は `node.stepName` から `step_id` を出力する |
| edge export | `static/js/app.js` は parent/merge/loop 関係から `flows.edges` を出力する |
| parallel UI | `parallelOf` / `parallelOrder` は UI/editing 構造として存在する |

## 現行の問題点

| 問題 | 内容 | 202607 方針 |
| --- | --- | --- |
| `stepName` が ID と表示名を兼ねる | 名前から `step_id` を作っており、表示名変更と ID 変更が混ざりやすい | `step_id` と `label` を分ける |
| `steps` 配列順 fallback | `flows.edges` が無い場合だけ配列順が実行順になり、通常仕様と混ざる | 各 flow の正規保存形式では `edges` を必須とし、GUI 読込時の一時生成だけを例外とする |
| `edge.order` の誤解 | global 実行順のように見える | branch 表示順 / runtime tie-breaker として明記し、通常は backend が自動生成する |
| `parallelOrder` の誤解 | UI 上の並びを実行順と誤解しやすい | UI/layout order として扱う |
| loop flow の互換 path | 現行 core は `loop.flows` と `flows.loop.flows` の両方を読む | `loop.flows.<loop_step_id>.edges` だけを正本とし、旧 `flows.loop.flows` は読まない |
| step result identityの重複 | 現行は`output_variable`を持ち、通常は`step_id`をdefaultにする | `output_variable`を廃止し、`step_id`だけを参照keyにする |

## 202607 validation 方針

- `step_id` は必須、一意、空文字不可。
- `step_id` は `.zizd` 全体で一意にする。
- `flows`のkeyである`flow_id`は必須、一意、空文字不可とし、表示名`label`から分離する。
- `step_id`と`flow_id`は、`'01'`から始まる正規化済みの10進文字列とする。`'01'`から`'99'`は2桁、100以降は不要な先頭0を付けない。
- 新規`step_id`／`flow_id`は、それぞれの既存最大値に1を加えて発番し、削除済みIDを再利用しない。
- `metadata.default_flow_id`を保存する場合は、存在する`flows`のkeyを参照しなければならない。
- 通常stepの`flow_id`は`flows`に存在しなければならない。`unassigned.step_ids`に含まれるstepだけは編集途中の例外として`flow_id`を持たない。
- `flow_id`を持たないstepは`unassigned.step_ids`へ重複なく列挙し、`unassigned.edges`は列挙されたstep間のedgeだけを保存する。
- 各 flow は開始 node と終了 node を1つずつ持ち、両方の `ui_position` を保存する。
- 開始変数は `flows.<flow_id>.start.variables` に配列で保存し、別 flow の開始変数を参照・投入しない。
- `step_id` と表示名 `label` を別 field として扱う。
- step resultは`step_id`をkeyとして参照し、`output_variable` fieldは保存しない。
- `input_data`、`source_step_id`などcatalogでinput refに指定されたfieldには、参照元の`step_id`を保存する。
- `step_id` の文字列、数値 suffix、`step1` などから実行順を推測しない。
- `flows.<flow_id>.edges` は各 flow の通常形式で必須にする。
- `flows.<flow_id>.edges[].from` / `to` は、その flow の `START`、`END`、または同じ `flow_id` を持つ `step_id` のみ許可する。
- 同じ`flows.<flow_id>.edges`内で同一`from + to`を持つedgeを重複させない。
- flow 間の edge と、同じ step の複数 flow 共有は禁止する。
- flow ごとに DAG として検証する。
- 通常flowで同じstepへ複数edgeが入る場合はAND合流とし、そのstepへ直接接続された全stepが正常完了するまで開始しない。
- loop 内 flow は owner ごとの graph として検証する。
- loop 内 flow は `loop.flows.<loop_step_id>.edges` だけを受け付け、旧 `flows.loop.flows` の読込互換と自動変換は行わない。
- `loop_owner_id` は同じ `flow_id` に存在する `node_type: loop` のstepだけを参照できる。
- `loop.flows` のkeyは、存在する `node_type: loop` の `step_id` と一致しなければならない。
- loop内 stepをmainの `flows.<flow_id>.edges`へ直接接続してはならない。
- 同じ`loop.flows.<loop_step_id>.edges`内で同一`from + to`を持つedgeを重複させない。
- loop内部では各nodeのincoming edgeとoutgoing edgeをそれぞれ最大1本とし、並列分岐と合流を禁止する。
- `edge.order` は同一親からの branch 表示順 / runtime tie-breaker であり、global 実行順ではない。
- `steps` 配列順を実行順として扱わない。
- 旧 `steps[].params.schema` は読み込まず、自動変換もしない。検出した場合は非対応の旧形式として validation error にする。
- 旧`steps[].output_variable`は読み込まず、自動変換もしない。検出した場合は非対応の旧形式としてvalidation errorにする。
- 旧single-flow形式の `flows.edges`とtop-level `variables.start`は非対応の旧形式としてvalidation errorにする。`flow_id`のないstepは正規の`unassigned.step_ids`に含まれる場合だけ読込み、その他はvalidation errorにする。

## サンプル

```yaml
metadata:
  mode: 'dataflow'
  name: 'multi_flow_sample'
  default_flow_id: '01'
steps:
  - step_id: '01'
    flow_id: '01'
    label: '顧客データ読込'
    connector_id: 'csv_connector'
    action_id: 'read_csv'
    schema:
      columns:
        - origin_name: 'customer_id'
          ziz_datatype: 'STRING'
  - step_id: '02'
    flow_id: '01'
    label: '注文データ読込'
    connector_id: 'csv_connector'
    action_id: 'read_csv'
    schema:
      columns:
        - origin_name: 'order_id'
          ziz_datatype: 'STRING'
        - origin_name: 'customer_id'
          ziz_datatype: 'STRING'
  - step_id: '03'
    flow_id: '01'
    label: '売上結合'
    connector_id: 'dataintegration_connector'
    action_id: 'filter_rows'
  - step_id: '04'
    flow_id: '02'
    label: '変数定義'
    connector_id: 'WindowsConnector'
    action_id: 'define_values'
flows:
  '01':
    label: '売上データ作成'
    start:
      ui_position:
        x: 80
        y: 120
      variables: []
    end:
      ui_position:
        x: 880
        y: 120
    edges:
      - from: 'START'
        to: '01'
        order: 1
      - from: 'START'
        to: '02'
        order: 2
      - from: '01'
        to: '03'
        order: 0
      - from: '02'
        to: '03'
        order: 0
      - from: '03'
        to: 'END'
        order: 1
  '02':
    label: '自動化処理'
    start:
      ui_position:
        x: 80
        y: 480
      variables: []
    end:
      ui_position:
        x: 520
        y: 480
    edges:
      - from: 'START'
        to: '04'
        order: 1
      - from: '04'
        to: 'END'
        order: 1
```

この例ではflow`'01'`と`'02'`は同一canvas上の独立したflowである。既定実行対象は`metadata.default_flow_id: '01'`であり、step`'01'`と`'02'`は並列実行可能である。`order: 1` / `2`はbranch表示順／tie-breakerであり、全体の実行順ではない。
