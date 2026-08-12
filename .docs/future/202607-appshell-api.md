# 202607 AppShell Public API

## 位置づけ

この文書は、202607 版の再利用フロントライブラリ `AppShell` の public API を定義する。

現行の `static/js/app-shell.js` は参考実装であり、将来 API の正本ではない。

## 目的

- VSCode ライクな frame UI を別アプリでも再利用できるようにする。
- topbar、activity bar、sidebar、tab、panel、status bar を app 固有処理から分離する。
- app 固有の connector、workflow、bridge、保存/読込を shell 内へ入れない。

## 責務

| 領域 | AppShell の責務 |
| --- | --- |
| layout | topbar、activity bar、sidebar、main、right panel、bottom panel、status bar の配置 |
| tabs | tab の表示、active、dirty、close request |
| navigation | activity item 選択、sidebar 開閉、panel 開閉 |
| resize | sidebar/right panel/bottom panel の resize |
| focus | region 単位の focus 移動 |
| events | UI 操作を event として app へ通知 |

## 持たない責務

- QWebChannel／HTTP等のbackend transport呼び出し
- connector/action catalog の解釈
- workflow document の意味解釈
- flow 保存/読込
- security policy 判定
- app 固有文言、app 固有 route、app 固有 icon の固定

## 作成 API

```js
import { createAppShell } from "@zizai/ui-shell";

const shell = createAppShell({
  root,
  layout,
  activities,
  commands,
  regions
});

shell.mount();
```

`createAppShell(options)` は shell instance を返す。global な `window.zizShell` は public API にしない。

bundled local frontendでbundle toolを使わずclassic scriptとして読み込む場合は、内部moduleを順番に読み込んだ後、次のbrowser package namespaceから同じfactoryを取得する。

```js
const { createAppShell } = window.zizPackages.uiShell;
```

これはfactoryを配布するbrowser package namespaceであり、shell instanceやapp固有callbackを`window`直下へ置くものではない。zizai固有の接続は`window.zizPackages.app.shell`のapp adapterへ分離する。

## options

| key | 必須 | 内容 |
| --- | --- | --- |
| `root` | 必須 | shell を mount する HTMLElement |
| `layout` | 任意 | 初期 layout snapshot |
| `activities` | 任意 | activity bar item |
| `commands` | 任意 | topbar や toolbar に出す command |
| `regions` | 任意 | 初期 region content |
| `labels` | 任意 | shell 表示文言。app 側から注入する |

## data types

### ShellTab

```ts
type ShellTab = {
  id: string;
  title: string;
  kind?: string;
  icon?: string;
  dirty?: boolean;
  closable?: boolean;
  contentKey?: string;
};
```

### ActivityItem

```ts
type ActivityItem = {
  id: string;
  label: string;
  icon?: string;
  badge?: string | number;
  disabled?: boolean;
};
```

### ShellCommand

```ts
type ShellCommand = {
  id: string;
  label: string;
  icon?: string;
  region?: "topbar" | "tabbar" | "panel" | "status";
  disabled?: boolean;
};
```

### LayoutSnapshot

```ts
type LayoutSnapshot = {
  sidebarVisible: boolean;
  rightPanelVisible: boolean;
  bottomPanelVisible: boolean;
  sidebarWidth?: number;
  rightPanelWidth?: number;
  bottomPanelHeight?: number;
  activeActivityId?: string;
};
```

## instance API

| API | 内容 |
| --- | --- |
| `mount()` | DOM を描画し、event listener を登録する |
| `destroy()` | event listener と shell DOM を破棄する |
| `setActivities(items)` | activity bar item を差し替える |
| `setCommands(commands)` | command 定義を差し替える |
| `setTabs(tabs, activeTabId?)` | tab 一覧と active tab を差し替える |
| `openTab(tab)` | tab を追加または更新して active にする |
| `updateTab(tabId, patch)` | tab の title、dirty、badge などを更新する |
| `closeTab(tabId)` | close request を発火する。実際に閉じる判断は app 側 |
| `activateTab(tabId)` | active tab を変更する |
| `setRegion(region, content)` | region content を差し替える |
| `setStatus(statusItems)` | status bar 表示を更新する |
| `setLayout(layout)` | layout snapshot を反映する |
| `getLayout()` | 現在の layout snapshot を返す |
| `focusRegion(region)` | 指定 region へ focus を移す |
| `on(event, handler)` | event を購読する |
| `off(event, handler)` | event 購読を解除する |

## regions

| region | 用途 |
| --- | --- |
| `topbar` | app title、global command |
| `activitybar` | 左端 navigation |
| `sidebar` | project tree、catalog など |
| `main` | editor/workflow canvas |
| `rightPanel` | property/data area など |
| `bottomPanel` | log、terminal、problems など |
| `statusbar` | status、run state、connection state |

content は HTMLElement、render function、または adapter object を許可する。文字列 HTML の直接注入は避ける。

## events

| event | payload | 用途 |
| --- | --- | --- |
| `activity:select` | `{ activityId }` | activity 選択 |
| `tab:activate` | `{ tabId }` | active tab 変更 |
| `tab:close-request` | `{ tabId }` | tab close 要求 |
| `command:execute` | `{ commandId, source }` | command 実行 |
| `layout:change` | `{ layout }` | resize、panel 開閉 |
| `region:focus` | `{ region }` | focus 移動 |

AppShell は `tab:close-request` を発火するだけで、未保存確認、実行中runの確認、cancel、保存、実際に閉じる処理は app 側へ委譲する。Zizai appは①の`.zizd`と②の実行元document（SQL／Python等、`.zizd`を除く）のどちらでも、run実行中のclose要求に対し、`閉じずに続行`と`実行をキャンセルして閉じる`を表示する。documentを閉じてrunだけをbackground継続する選択肢は設けない。cancel完了後もdocumentがdirtyなら、`保存して閉じる`と`保存せず閉じる`を確認してから実際に閉じる。

AppShellは共通command buttonの描画、icon、tooltip、disabled状態、`command:execute`通知を担当する。Zizai appのHTML／JavaScriptは、`.zizd` documentを表示中だけ`flow.add` commandをtopbarへ登録する。AppShellは`flow.add`の意味を解釈せず、Zizai app／adapterが新しい`flow_id`と`START -> WindowsConnector.define_values -> END`の初期documentを生成して`WorkflowDesigner`へ渡す。

Zizai appでは、1つのGUI `session_id`で同時に開けるdocumentを最大4件にする。保存済み／未保存の`.zizd`、SQL、Python等のdocument tabを合算し、sidebarやtool panelは数えない。4件制限はZizai app／adapterのpolicyとし、再利用ライブラリAppShell自体には固定上限をハードコードしない。

Zizai appは同じOSユーザー内で単一instanceとし、2つ目のGUI processはbackendと`session_id`を作成しない。この制限はZizai app／hostの責務とし、再利用ライブラリAppShellには実装しない。

## state 方針

- AppShell が持つ state は layout、active tab、visible region に限定する。
- document、workflow、connector、run status は app 側の state を正本にする。
- 派生表示は selector または app adapter から渡す。
- layout persistence は app 側の責務にする。AppShell は `layout:change` を発火するだけにする。

## styling 方針

- AppShell は layout 用 class と CSS custom property を提供する。
- app 固有色、connector 色、workflow 状態色は theme token として外から渡す。
- text が container からはみ出さないよう、固定領域には min/max と overflow policy を持たせる。
- animation は pane 開閉など最小限にする。

## 300 行ルール

`AppShell` の entry file は 300 行以内ルールの例外にできる。

ただし、内部 module は次のように分け、通常は 300 行以内を目指す。

```text
ui-shell/
  app_shell.js
  shell_layout.js
  shell_tabs.js
  shell_activitybar.js
  shell_regions.js
  shell_events.js
  shell_types.js
```

## 受け入れ条件

- public API がこの文書に沿っている。
- app 固有 import がない。
- `window.zizShell` のような global public API に依存しない。
- tab close、layout change、command execute が event として app へ渡る。
- WebView と Chrome の両方で同じ API を使える。

## 次タスク

次は`TabularImportAssistant public API`と`WorkflowDesigner public API`を定義する。
