# 202607 フロント独自ライブラリ仕様

## 位置づけ

この文書は、別アプリでも再利用できるフロント UI ライブラリの仕様を定義する。

対象は app 固有処理を持たない UI 基盤である。

## 目的

- VSCode ライクな app shell を再利用可能にする。
- 表形式fileの取込設定UIを再利用可能にする。
- workflow editor を別アプリでも使える部品にする。
- 独自 UI の仕様を固定し、通常改修の読込範囲から外す。
- アプリ固有処理を adapter として外側から注入する。

## ライブラリ単位

| ライブラリ | 概要 | 300行ルール |
| --- | --- | --- |
| `AppShell` | フレーム UI、タブ、サイドバー、パネル、ステータス領域 | 例外 |
| `TabularImportAssistant` | Excel／CSV等のpreview、header行／data開始行選択 | 原則 300 行以内 |
| `WorkflowDesigner` | ノード、エッジ、キャンバス、選択、配置、ズーム、接続 | 例外 |
| 共通 UI 部品 | dialog、table、form renderer、picker、schema editor | 原則 300 行以内 |

`AppShell` と `WorkflowDesigner` は 300 行以内ルールの例外とする。ただし、entry file の例外であり、内部 module は責務単位に分割する。

## 共通禁止事項

- bridge、core、connector を直接 import しない。
- zizai 固有 action、connector 名、YAML の parse／serializeを内部に持たない。
- app 固有文言を内部に持たない。
- global state に依存しない。
- DOM 全体再生成を前提にしない。
- public API 外の内部構造に app 側が依存しない。

`WorkflowDesigner` が扱う parse 済み document は `.zizd` と同じ graph 構造を使用する。構造の共有は Zizai 固有 action の意味解釈を要求するものではなく、別アプリは同じ graph 構造へ app 固有 field を追加できる。

## AppShell

public API は `202607-appshell-api.md` を正本とする。

### 責務

- VSCode ライクな app frame を提供する。
- top bar、activity bar、side bar、editor tabs、panel、status bar を管理する。
- pane の開閉、resize、active tab、layout persistence を扱う。
- child content は slot、callback、adapter で受け取る。

### 持たない責務

- workflow の意味解釈
- connector/action の実行
- flow 保存/読込
- QWebChannel bridge呼び出し
- core 呼び出し

### public API 案

| API | 意味 |
| --- | --- |
| `mount(root, options)` | shell を root へ描画する |
| `setTabs(tabs)` | tab 定義を差し替える |
| `setSidebarItems(items)` | sidebar 定義を差し替える |
| `setPanelContent(region, content)` | region に content を差し込む |
| `setStatus(status)` | status bar を更新する |
| `on(event, handler)` | tab/select/resize などのイベント購読 |
| `destroy()` | event listener と DOM を破棄する |

## TabularImportAssistant

public API は `202607-tabular-import-assistant-api.md` を正本とする。

### 責務

- Excel／CSV等の表形式fileに共通する取込設定UIを提供する。
- preview table、header行／data開始行選択、loading／error、confirm／cancelを扱う。
- sheet、encoding、delimiter等の形式差分をformat adapterとして受け取る。
- file選択とpreview取得はcallbackとして利用appへ委譲する。

### 持たない責務

- file解析
- QWebChannel／BridgeClient呼出し
- path／hidden ref／document session管理
- connector／action／Zizai schemaの解釈

Excel／CSVを別々の完全なlibraryにはせず、共通coreとformat adapterで構成する。opaque sourceと共通preview contractを使用し、別アプリはbrowser file、HTTP API、desktop bridge等のproviderを自由に実装できる。

## WorkflowDesigner

public API は `202607-workflow-designer-api.md` を正本とする。

### 責務

- workflow editor の UI を提供する。
- node、edge、viewport、selection、drag、connect、zoom、pan を扱う。
- `.zizd` と共通の `steps`、`flows`、`loop.flows` 構造を別形式へ変換せず扱う。
- canvas と detail panel の連携に必要な selection event を発行する。
- node rendering は renderer adapter で差し替えられるようにする。

### 持たない責務

- connector 実行
- bridge 呼び出し
- file I/O
- security policy 判定
- YAML file の parse／serialize
- connector、action、params、schema の意味解釈

### public API 案

| API | 意味 |
| --- | --- |
| `mount(root, options)` | designer を root へ描画する |
| `setDocument(document)` | workflow document を設定する |
| `getDocument()` | 現在の workflow document を取得する |
| `setSelection(selection)` | 選択状態を設定する |
| `setViewport(viewport)` | zoom/pan を設定する |
| `setNodeRenderers(renderers)` | node renderer を差し替える |
| `on(event, handler)` | select/change/connect/delete などのイベント購読 |
| `destroy()` | event listener と DOM を破棄する |

## adapter 方針

アプリ固有処理は adapter として外から渡す。

| adapter | 用途 |
| --- | --- |
| node catalog adapter | node 種別、表示名、icon、分類 |
| property editor adapter | 選択 node の詳細 UI |
| command adapter | add/delete/duplicate/run などの command 実行 |
| persistence adapter | YAML／file の保存・読込。graph topology は変換しない |
| validation adapter | node/edge/document validation |

## 凍結条件

- public API が文書化されている。
- examples または smoke test がある。
- app 固有処理が adapter へ分離されている。
- 外部依存が明示されている。
- 変更時は public API 互換性を確認する。
