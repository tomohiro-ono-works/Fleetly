# 202607 WorkflowDesigner Public API

## 位置づけ

この文書は、202607 版の再利用フロントライブラリ `WorkflowDesigner` の public API を定義する。

現行の `static/js/ui.node.*` は参考実装であり、将来 API の正本ではない。

## 目的

- workflow editor を別アプリでも使える UI component にする。
- node、edge、viewport、selection、drag、connect、zoom、pan を app 固有処理から分離する。
- `.zizd` と同じ graph 構造を共通 document contract とし、別の editor 用 graph への変換を不要にする。
- connector、bridge、YAML の parse／serialize、実行処理を designer 内へ入れない。

## 責務

| 領域 | WorkflowDesigner の責務 |
| --- | --- |
| document 表示 | node、edge、annotation を描画する |
| editing | node 移動、接続、削除 request、node／flow複製、copy／paste、標準ID発番、共通graph参照更新 |
| loop | `node_type`、`loop_owner_id`、`loop.flows` に基づくloop枠と内部graphの描画・編集 |
| selection | node/edge/annotation の選択状態 |
| viewport | zoom、pan、fit view |
| hit test | canvas/DOM 上の選択、接続、drag 判定 |
| overlay | run status、validation error などの表示 layer |
| events | UI 操作を event として app へ通知 |

## 持たない責務

- connector/action catalog の取得と解釈
- property panel の form rendering
- QWebChannel／HTTP等のbackend transport呼び出し
- flow 保存/読込
- security policy 判定
- YAML file の parse／serialize
- connector、action、params、schema の意味解釈
- 実行順序や core workflow の制御

## 作成 API

```js
import { createWorkflowDesigner } from "@zizai/workflow-designer";

const designer = createWorkflowDesigner({
  root,
  document,
  viewport,
  nodeRenderers,
  commandLabels,
  idAllocator,
  referenceRewriter
});

designer.mount();
```

`createWorkflowDesigner(options)` は designer instance を返す。global な `window.uiNode*` は public API にしない。`document`はapp document storeが正本となるcontrolled inputであり、Designer内部に独立した正本を作らない。

bundled browser版は次のnamespaceを公開する。

```js
const {
  createWorkflowDesigner,
  applyDocumentPatch
} = window.zizPackages.workflowDesigner;
```

内部moduleは`static/js/workflow-designer/`から読み込み、entryの`workflow_designer.js`を最後に読み込む。Zizai固有rendererはentry後に`static/js/workflow-designer.zizai-renderers.js`を読み込み、`window.zizPackages.app.workflowDesignerRenderers`から取得する。

## options

| key | 必須 | 内容 |
| --- | --- | --- |
| `root` | 必須 | designer を mount する HTMLElement |
| `document` | 任意 | app document storeが正本として渡す、`.zizd`と同じgraph構造のparse済みworkflow document |
| `viewport` | 任意 | 初期 zoom/pan |
| `selection` | 任意 | 初期 selection |
| `nodeRenderers` | 任意 | node type ごとの renderer |
| `commandLabels` | 任意 | context menu 等の表示文言 |
| `idAllocator` | 任意 | step／flow／note IDの発番callback。省略時は標準10進発番器を使う |
| `referenceRewriter` | 任意 | app固有field内のID参照を複製時に更新するcallback |
| `readonly` | 任意 | 編集不可 mode |
| `graphConstraints` | 任意 | 接続可否などapp固有graph制約を判定する同期callback |
| `theme` | 任意 | 公開CSS custom propertyへ適用するtheme token |
| `status` | 任意 | 初期run／validation overlay |
| `noteColors` | 任意 | note追加時に使用する背景色候補。先頭要素を初期値にする |

## document contract

### WorkflowDocument

`WorkflowDesigner` は YAML text ではなく、loader が parse／validationした document object を受け取る。graph topology は `.zizd` と同じ構造を使用し、top-level `nodes`／`edges` を持つ別の中間 document へ変換しない。

| field | Designer の扱い |
| --- | --- |
| `metadata` | app 固有情報として保持する。意味は解釈しない |
| `steps` | canvas node の正本 |
| `flows.<flow_id>.start` / `end` | flow ごとの開始／終了 node |
| `flows.<flow_id>.edges` | main graph の edge |
| `unassigned` | flow未所属の貼付step、内部edge、編集用の仮START |
| `loop.flows.<loop_step_id>.edges` | loop 内 graph の edge |
| `notes` | sticky note／annotation の正本 |
| その他の field | 意味を解釈せず保持する |

Designer が graph 操作で解釈する step field は、`step_id`、`flow_id`、`label`、`node_type`、`loop_owner_id`、`ui_position` に限定する。connector、action、params、schema などの app 固有 field は更新で欠落させず、そのまま保持する。

loop 親は `steps[].node_type: loop`、loop 内 step は `steps[].loop_owner_id`、loop 内 edge は `loop.flows.<loop_step_id>.edges` で表す。node／edge に `parentNodeId` を追加する WorkflowDesigner 専用形式は採用しない。

### WorkflowAnnotation

`notes`は次の構造を正本とする。`note_id`はdocument内で一意な識別子とし、note本体を格納しない。

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

`note_id`、`ui_position`、`size`、`text`、`color`をDesignerが解釈する。その他のfieldは未解釈のまま保持する。本文中の`https://` linkはクリック可能に描画するが、実際に開く処理は`external-link:open-request`を受けたappが行う。

### DocumentPatch

document transactionはpathを文字列化しない、次のoperation配列とする。

```js
[
  {
    op: "replace",
    path: ["steps", 0, "ui_position"],
    value: { x: 320, y: 180 }
  }
]
```

```ts
type DocumentPath = Array<string | number>;
type DocumentPatchOperation =
  | { op: "add"; path: DocumentPath; value: unknown }
  | { op: "replace"; path: DocumentPath; value: unknown }
  | { op: "remove"; path: DocumentPath };
type DocumentPatch = DocumentPatchOperation[];
```

- `path`はparse済みdocumentのkey／array indexをrootから順に指定する。
- `add`のarray indexは挿入位置とし、array末尾へ追加する場合は現在のlengthを指定する。
- `replace`／`remove`は既存pathだけを対象にする。
- Designerが通知する`inversePatch`は、通知時点のdocumentへ`patch`を適用した直後に適用すると元へ戻るoperation列とする。
- `setDocument()`と`updateDocument()`はappからの確定入力であり、`document:change`を再通知しない。
- 不正pathまたはoperationを受けた`updateDocument()`はdocumentを変更せず例外にする。

### ID発番と複製

Designerは標準ID発番器を内蔵する。`idAllocator`を指定しない場合は、`step_id`、`flow_id`、`note_id`を別々に集計し、既存最大値+1を`'01'`始まり、最小2桁の10進文字列として生成する。削除済みIDは再利用しない。

- node複製では新しい`step_id`を発番する。
- flow複製では新しい`flow_id`と、配下にある全stepの新しい`step_id`を発番する。
- edgeの`from`／`to`、loop graphのkey、`loop_owner_id`など、共通document contractで定義された参照はDesignerがID対応表から自動更新する。
- connector parameterなどDesignerが意味を解釈しないapp固有fieldの参照は、`referenceRewriter`へID対応表を渡して更新する。
- `idAllocator`／`referenceRewriter`を差し替えない利用者は、追加の発番処理を実装せず作成・複製機能を利用できる。
- 別documentではIDのscopeが異なるため、同じ`step_id`／`flow_id`を使用できる。
- 複製はdocumentを一括更新し、途中状態を外部へ通知せず、完了後に`document:change`を1回通知する。

別documentへのcopy／pasteでは、appがcopy元Designerの`copy(selection)`からfragmentを受け取り、貼付先Designerの`paste(fragment)`へ渡す。

- flow全体のfragmentは新しい`flow_id`と配下stepの新しい`step_id`を発番し、通常flowとして追加する。
- flowの一部であるfragmentは新しい`step_id`を発番し、`flow_id`を付けず`unassigned`へ追加する。
- fragment内のedgeだけを保持してIDを更新し、fragment外との境界edgeは追加しない。
- 共通graph参照はDesignerが更新し、app固有fieldの参照は`referenceRewriter`へ委譲する。
- appは複数document間のclipboard保持と貼付先documentの選択だけを担当し、graph構造の変換は行わない。

flow全体のfragmentと判定するには、同じ`flow_id`の`START`、`END`、およびそのflowに属する全stepをselectionへ含める。それ以外は部分graphとする。

```js
{
  fragment_version: 1,
  kind: "flow" | "partial",
  source_document: { /* copy時点のsource document snapshot */ },
  source_flow_id: "01", // flow fragmentだけ
  flow: {},             // flow fragmentだけ
  steps: [],
  edges: [],            // partial fragmentだけ
  loop_flows: {},
  notes: []
}
```

fragmentはapp内clipboard用のJSON互換objectであり、`.zizd`へ保存しない。`source_document`は`referenceRewriter`へ安定したcopy時点のsourceを渡すために保持する。

同一documentの`duplicate(selection)`では、flow全体は新flowとして複製する。部分graphは元のgraph scopeを保ち、選択範囲内edgeだけを複製し、範囲外との境界edgeは作らない。別documentの`paste(fragment)`では部分graphの`flow_id`を外し、`unassigned`へ追加する。

callback contract:

```js
const idAllocator = ({ idKind, document, count }) => {
  // idKind: "step" | "flow" | "note"
  // count件の重複しないIDを返す
  return ["01"];
};

const referenceRewriter = ({
  clonedStep,
  stepIdMap,
  flowIdMap,
  sourceDocument
}) => {
  // app固有field内の参照を更新したclonedStepを返す
  return clonedStep;
};
```

両callbackは同期処理とする。返却IDの形式不正、件数不足、document内重複、callback errorがあった場合は複製全体を中止し、documentを変更せず、`document:change`も通知しない。

### Selection

通常stepの`node_id`には`.zizd`の`step_id`をそのまま使用する。`step_id`はdocument全体で一意なため、`flow_id`を重ねて持たない。

`START`／`END`はflowごとに存在するため、`node_id`と`flow_id`の組で識別する。

未所属graphの仮STARTは`node_id: "START"`と`graph_scope: "unassigned"`の組で識別する。loop graphの`START`／`END`はloop親stepを入出力境界として描画し、独立した選択対象nodeを追加しない。

edgeは`.zizd`へ`edge_id`を保存せず、通常flowでは`flow_id + from + to`、loop内では`loop_owner_id + from + to`、未所属graphでは`graph_scope: "unassigned" + from + to`で識別する。AppShellはこれらを現在の`doc_session_id`と結び付ける。

```json
{
  "nodes": [
    {
      "node_id": "01"
    },
    {
      "node_id": "START",
      "flow_id": "01"
    },
    {
      "node_id": "START",
      "graph_scope": "unassigned"
    }
  ],
  "edges": [
    {
      "flow_id": "01",
      "from": "01",
      "to": "03"
    },
    {
      "loop_owner_id": "06",
      "from": "07",
      "to": "END"
    },
    {
      "graph_scope": "unassigned",
      "from": "10",
      "to": "11"
    }
  ],
  "annotation_ids": ["01"]
}
```

### Viewport

```ts
type Viewport = {
  x: number;
  y: number;
  zoom: number;
};
```

### DesignerStatus

```ts
type DesignerStatus = {
  nodeStatus?: Record<string, "idle" | "running" | "success" | "error" | "skipped">;
  validation?: Record<string, { level: "warning" | "error"; message: string }[]>;
};
```

run status と validation は document へ混ぜず、overlay state として渡す。

## instance API

| API | 内容 |
| --- | --- |
| `mount()` | DOM/canvas を描画し、event listener を登録する |
| `destroy()` | event listener、observer、animation frame を破棄する |
| `setDocument(document)` | document 全体を差し替える |
| `getDocument()` | 現在の document snapshot を返す |
| `updateDocument(patch)` | node/edge 単位の差分を反映する |
| `setSelection(selection)` | selection を設定する |
| `getSelection()` | 現在の selection を返す |
| `setViewport(viewport)` | zoom/pan を設定する |
| `getViewport()` | 現在の viewport を返す |
| `fitView(options?)` | document が収まる viewport にする |
| `setStatus(status)` | run/validation overlay を更新する |
| `setReadonly(readonly)` | 編集可否を切り替える |
| `setNodeRenderers(renderers)` | renderer を差し替える |
| `duplicate(selection)` | nodeまたはflowを複製し、標準発番・参照更新を適用する |
| `copy(selection)` | 選択範囲と範囲内edgeを再利用可能なgraph fragmentとして返す |
| `paste(fragment)` | flow全体を通常flow、部分graphを`unassigned`として貼り付ける |
| `on(event, handler)` | event を購読する |
| `off(event, handler)` | event 購読を解除する |

## events

| event | payload | 用途 |
| --- | --- | --- |
| `document:change` | `{ patch, inversePatch, reason, transactionId }` | app document storeへ適用を要求する1操作分のdocument transaction |
| `selection:change` | `{ selection, reason }` | 選択変更 |
| `viewport:change` | `{ viewport }` | zoom/pan |
| `node:open-detail` | `{ node_ref }` | property panel 表示要求 |
| `command:execute` | `{ commandId, target }` | context menu/shortcut |
| `connect:create-request` | `{ source_node_ref, target_node_ref, ports }` | 接続作成要求 |
| `delete:request` | `{ selection }` | 削除確認を app 側へ委譲 |
| `run:request` | `{ node_ref?, mode }` | step/flow 実行要求 |
| `external-link:open-request` | `{ url }` | sticky note 等の link open |

Designerはgraph編集、複製、貼付からdocument transactionを作成し、`document:change`でappへ通知する。app document storeがtransactionを正本へ適用し、`updateDocument`または`setDocument`で確定snapshotをDesignerへ返す。保存、undo／redo履歴、dirty判定、削除確認、実行、backend API呼び出しはapp側が行う。

`graphConstraints`を指定した場合、接続requestを通知する前に`graphConstraints({ operation, document, sourceNodeRef, targetNodeRef })`を同期実行する。`false`または`{ allowed: false, message }`を返した操作は通知せず、validation messageをUIへ表示する。Zizaiのloop内単一路制約などはこのcallbackから与え、再利用libraryへ固定しない。

## renderer adapter

node rendering は adapter で差し替える。

```ts
type NodeRenderer = {
  type: string;
  render(node, context): HTMLElement;
  hitTest?(node, point, context): HitTestResult;
};
```

renderer contextにはcatalog由来のlabel／iconを渡せるが、designer自体はcatalog commandやbackend transportを呼ばない。

DOM rendererは次の公開classと属性を付与する。

- root: `.zwd`, `[data-workflow-designer]`
- node: `.zwd-node`, `[data-node-id]`, `[data-node-type]`
- edge: `.zwd-edge`, `[data-edge-scope]`
- loop: `.zwd-loop-frame`, `[data-loop-owner-id]`
- annotation: `.zwd-note`, `[data-note-id]`
- state: `[data-selected]`, `[data-run-status]`, `[data-validation-level]`

色、寸法、線、背景は`--zwd-*` CSS custom propertyで上書きできる。appは非公開classやDOM階層へ依存しない。

## document 入出力境界

app layer は YAML／file と parse 済み document の入出力を担当する。graph topology の変換は行わない。

```text
.zizd YAML
  -> backend loader: parse / validation
    -> 同じ graph 構造の document object
      -> frontend app state
        -> WorkflowDesigner
```

別アプリも同じ graph contract を使用できる。再利用性は、connector／action 名や app 固有 field の意味を Designer 内へ固定しないことで確保する。

## state 方針

- documentはapp document storeを唯一の正本とし、Designerはcontrolled inputとして受け取る。selectionとviewportはDesignerのUI stateとして扱う。
- connector catalog、property form、run result、data area は app state を正本にする。
- Excel／CSV取込UIはappが`node:open-detail`等を受けて`TabularImportAssistant`を開き、WorkflowDesignerから直接参照しない。
- selected node object は保持せず、`selection.nodes` の`node_ref`からselectorで得る。
- run status は document に書き込まず、`setStatus` で overlay 表示する。
- document patch は未解釈の app 固有 field を欠落させない。
- 標準発番器とgraph参照更新はDesigner内で完結させ、app固有参照だけcallbackへ委譲する。
- Designerはundo／redo履歴と保存済みhistory位置を保持しない。drag等の連続操作はpointer up時に1つのdocument transactionとして通知する。

## 300 行ルール

`WorkflowDesigner` の entry file は 300 行以内ルールの例外にできる。

ただし、内部 module は次のように分け、通常は 300 行以内を目指す。

```text
workflow-designer/
  workflow_designer.js
  designer_document.js
  designer_events.js
  designer_types.js
  designer_ids.js
  designer_graph.js
  designer_fragments.js
  designer_clone.js
  designer_dom.js
  designer_note_dom.js
  designer_feedback.js
  designer_render.js
  designer_note_edit.js
  designer_selection.js
  designer_commands.js
  designer_interaction.js
```

## 受け入れ条件

- public API がこの文書に沿っている。
- `.zizd` と同じ graph topology を使用し、別の node／edge document への変換を要求しない。
- connector/action、bridge、YAML parser／serializer を直接 import しない。
- selection、viewport、status 更新で全体再描画しない。
- `run:request`、`delete:request`、`external-link:open-request` が app 側へ委譲される。
- node／flow複製が標準発番器だけで完結し、flow内の共通graph参照が新IDへ更新される。
- `idAllocator`と`referenceRewriter`を差し替えられる。
- sticky note や annotation は document の optional feature として扱える。

## 次タスク

次は`GUI backend実装構成`を定義する。
