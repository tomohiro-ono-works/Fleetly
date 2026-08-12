# UI 202607以降仕様

## 位置づけ

この文書は、`.docs/areas/ui.md` の現行 UI 仕様をベースに、202607 以降の JS リファクタと UX 最適化方針を追記した将来仕様である。

現行実装の正本は `.docs/areas/ui.md` とし、この文書は移行先仕様、設計方針、リファクタ判断に使う。

## 現行 UI 仕様コピー

### アプリケーションウィンドウ

- フレームレスのGUIウィンドウの外周は、GUI host側で1pxの枠線を描画する。
- 枠線の色は左サイドバーの `--surface-sidebar` と同じ `#292941` を使用する。
- 枠線は表示専用とし、ポインターイベントを受けず、既存のウィンドウ操作・リサイズ領域を妨げない。
- ワークスペース内へ埋め込む画面（`embedded-mode`）には外周枠を描画しない。

### スティッキーノート

- データフローキャンバス上で補足情報を残すためのメモ機能。
- メモは `notes` として保存し、各メモは位置、サイズ、本文、背景色を持つ。
- 色候補の正本は `static/js/ui.node.canvas.js` の `STICKY_NOTE_COLORS` とする。
- 新規メモの背景色は、色候補の先頭値を使用する。
- 色候補を変更しても、保存済みメモの `color` は自動変換しない。

### 右サイドノード詳細

- 右サイドのノード詳細フォームは、編集領域を優先し、白い入力ペインの内側余白を小さく保つ。
- フォーム行のラベル列は、右サイド幅に対して本文列を圧迫しすぎない比率にする。

### データエリア

データエリアは、選択中ステップの schema、実行後データ、ログを確認するための下部表示領域とする。

詳細なコネクタ/アクション分類と出力仕様は `.docs/areas/connectors.md` を正本とし、UI 側では次の表示ルールを守る。

#### タブ

データエリアは次の 4 タブを持つ。

- `スキーマ定義`
- `スキーマ定義（JSON）`
- `データ出力`
- `ログ`

#### 表示タイミング

- `データ出力` は、ステップ実行後にバックエンド側の最新結果を表示する。
- `データ出力` は、フロー画面で対象ステップが選択され、かつデータ出力タブが選択されているときに表示する。
- `ログ` は共通表示とし、開始、終了、エラーメッセージを確認できる。

#### スキーマ表示と編集可否

| 対象 | スキーマ定義 | スキーマ定義（JSON） |
| --- | --- | --- |
| データフロー > 入力 | 項目選択と取り込み時のデータ型を設定できる。rename はできない | 同左 |
| データフロー > 加工 | 加工後 schema を表示する。閲覧とコピペのみ可能 | 同左 |
| データフロー > 出力 | 項目選択、出力時データ型、出力時項目名を設定できる | 同左 |
| ワークフロー | schema がある場合は表示する。閲覧とコピペのみ可能 | 同左 |

#### データ出力

| 対象 | 表示内容 |
| --- | --- |
| データフロー > 入力 | 取得したデータ本体 |
| データフロー > 加工 | 加工後のデータ本体 |
| データフロー > 出力 | 出力結果メタデータ |
| ワークフロー > 検索/取得系 | 取得結果本体 |
| ワークフロー > 動的操作 | 実行結果メタデータ |
| ワークフロー > シナリオ制御 | 実行結果メタデータ。ただし `loop_tasks` はループ対象レコード本体 |

出力結果メタデータと実行結果メタデータは、次の 4 カラムを表示する。

| カラム | 意味 |
| --- | --- |
| `job_id` | 外部ジョブ ID。該当しない場合は空文字 |
| `target` | 出力対象または操作対象 |
| `path` | URL、ファイルパス、DB パス、成果物パス。該当しない場合は空文字 |
| `executed_at` | 完了時刻。UTC ISO 形式 |

`excuted_at` は typo のため UI でも使用しない。互換用の重複カラムも表示しない。

#### ワークフロー例外

- `WindowsConnector.search_files_by_name` は、ファイル検索結果本体を表示する。
- `WindowsConnector.search_text_in_files` は、ファイル内文字列検索結果本体を表示する。
- `SeleniumConnector.dom_get` は、DOM 取得結果本体を表示する。
- `WindowsConnector.loop_tasks` は、ループ対象レコード本体を表示する。
- `WindowsConnector.define_values` は例外にせず、実行結果メタデータを表示する。
- `ShellConnector.execute_bat` など外部コマンド実行系は、stdout/stderr をデータ本体として表示しない。成功、失敗、エラー内容はログで扱う。

## 202607以降の追加仕様

### 目的

JS 側の実装を、読みやすく、壊しにくく、改修範囲を限定しやすい構造へ移行する。

開発最適化では、独自 UI の一部をライブラリ化して改修を凍結し、読み込むべきファイルと責務を減らす。

UX 最適化では、過剰な状態変更、過剰な再描画、動的アニメーションを減らし、静的で安定した表示に寄せる。

### 開発最適化

- 独自 UI 部品は、仕様、入力、出力、イベント、禁止事項を明記したうえでライブラリ化する。
- ライブラリ化した UI 部品は public API を固定し、内部実装を通常改修対象から外す。
- 画面固有ロジック、状態計算、DOM 操作、bridge 呼び出しを混在させない。
- JS ファイルは 1 ファイル 300 行以内を目標にする。
- 300 行以内は機械的な分割基準ではなく、責務分離の結果として達成する。
- 分割前に、未使用、重複、旧互換、暫定処理を削除する。
- 過剰な wrapper、薄い alias、同じ意味の helper は統合する。
- config、state、selector、render、event、app controller、BridgeClient の責務境界を固定する。
- module 間の循環参照は禁止する。
- backend からの読込経路は、`BridgeClient -> app adapter -> state -> selector -> render` に寄せる。
- backend への操作経路は、`UI event -> app controller -> BridgeClient` に寄せる。
- QWebChannel の初期化、message envelope、response correlation、`backendBridge` 直接参照は `BridgeClient` だけに持たせる。

### 状態管理

- state に保存する値は最小限にする。
- 派生 state は保持せず、必要なタイミングで selector/helper から計算する。
- 同じ意味の状態を複数箇所に持たない。
- UI 表示のためだけの一時値は DOM local または render 内に閉じる。
- state 更新イベントは、意味のある変更単位に限定する。
- 同期イベントの連鎖で UI を更新しない。
- `selectedNodeRef` のような正本だけを保持し、`selectedNode`、`selectedConnector`、`availableActions` などは必要時に計算する。通常stepは`node_id: <step_id>`、開始／終了nodeは`node_id: START|END`と`flow_id`の組で参照する。

### UX 最適化

- 実行中や選択中などの状態表示は、静的な class / text / icon を基本にする。
- 継続的な animation、canvas 再描画、timer 更新は最小限にする。
- 状態変更のたびに全体 DOM を作り直さない。
- 更新範囲は、変更が必要な pane、row、button、status に限定する。
- データエリア、右サイド詳細、キャンバスは互いに不要な再描画を起こさない。
- hover、active、selected、running、error の視覚表現は CSS 側に寄せる。
- ガビガビする表示は、状態の二重管理、過剰再描画、非同期完了待ちのいずれが原因かを切り分けてから直す。

### ライブラリ化候補

| 候補 | 凍結する仕様 |
| --- | --- |
| schema editor | 入力 schema、JSON 表示、出力 preview、ログ tab の public API |
| connector/action picker | connector、action、分類、検索、選択イベント |
| data preview table | columns、rows、datatype formatting、empty state |
| modal/dialog | open、close、confirm、cancel、focus 制御 |
| form field renderer | field kind、value commit、validation 表示 |

### 大型ライブラリ化対象

別アプリでも再利用できる UI 基盤として、次の 2 つを独自ライブラリ化する。

| ライブラリ | 責務 | 持たない責務 |
| --- | --- | --- |
| `AppShell` | VSCode ライクなフレーム UI、タブ、サイドバー、ステータス領域、リサイズ領域、基本レイアウト | workflow、connector、bridge、core 固有処理 |
| `WorkflowDesigner` | ノード、エッジ、キャンバス、選択、配置、ズーム、pan、接続、ワークフロー編集 UI | connector 実行、ファイル保存、アプリ固有 business logic |

`AppShell` と `WorkflowDesigner` は、300 行以内ルールの例外対象とする。

ただし、大きな単一ファイルを許容するという意味ではない。外部公開する entry file は大きくなってもよいが、内部実装は sub module に分割し、責務境界を維持する。

#### AppShell

- アプリ全体の見た目とレイアウトを担当する。
- タブ、左サイドバー、下部領域、ステータス表示、パネル開閉、リサイズ状態を扱う。
- 子領域に何を表示するかは slot / callback / adapter で受け取る。
- zizai 固有の connector、flow、bridge、保存形式は知らない。
- 別アプリでは、タブ定義、サイドバー項目、パネル内容だけを差し替えて再利用できる状態を目指す。

#### WorkflowDesigner

- ワークフロー編集 UI を担当する。
- ノード、エッジ、キャンバス座標、選択、ドラッグ、接続、ズーム、表示状態を扱う。
- ノード種別、詳細フォーム、実行処理、保存処理は外部 adapter から受け取る。
- connector 実行、core 呼び出し、ファイル I/O は直接行わない。
- 別アプリでは、ノード定義、プロパティ編集 UI、保存 adapter を差し替えて再利用できる状態を目指す。

#### 例外条件

- public API を文書化する。
- 入力、出力、イベント、callback、slot、adapter を明記する。
- bridge、core、connector を直接 import しない。
- `BridgeClient`、QWebChannel、`backendBridge` を直接参照しない。
- アプリ固有文言、zizai 固有 action、保存形式を内部へ入れない。
- examples または smoke test を用意する。
- 内部 module は責務単位に分ける。
- 変更頻度を低くし、通常改修では public API の範囲内で利用する。

### 難易度と進め方

この設計変更は難易度が高い。理由は、UI の見た目変更ではなく、依存方向、状態管理、イベント設計、再描画範囲を同時に整理するためである。

ただし、一括で置き換えず、既存 UI の外側から adapter 化して段階移行すれば現実的に進められる。

| リスク | 内容 | 対応 |
| --- | --- | --- |
| 高 | 既存 UI と新 UI の状態同期が二重化する | 正本 state を先に決め、派生値は selector に寄せる |
| 高 | WorkflowDesigner が zizai 固有処理を取り込みすぎる | connector 実行、保存、bridge 呼び出しを adapter に逃がす |
| 中 | AppShell が肥大化する | shell は layout と region 管理に限定する |
| 中 | 分割だけ進み、読みやすくならない | 分割前に未使用、重複、旧互換を削る |
| 中 | UI 回帰に気づきにくい | Playwright、screenshot、smoke test を先に整える |

### 移行順序

1. 現行 JS ファイルの責務、行数、依存関係、循環参照を棚卸しする。
2. 未使用、重複、旧互換、暫定処理を削除する。
3. 状態の正本と派生値を分類する。
4. selector/helper を作り、派生値を state から外す。
5. 安定した UI 部品から public API を定義し、ライブラリ化する。
6. 画面固有 render と event handler を責務単位で分割する。
7. 動的 animation や timer 更新を静的表示へ置き換える。
8. Playwright と screenshot で回帰確認する。

### 完了条件

- 主要 JS ファイルが責務単位に分かれている。
- 新規または改修対象ファイルは原則 300 行以内に収まっている。
- 共有 UI 部品の public API が文書化されている。
- 同じ意味の state が複数保持されていない。
- データエリア、右サイド詳細、キャンバスの再描画範囲が局所化されている。
- 継続的 animation や不要な timer 更新が残っていない。
- Playwright の主要 UI ケースで回帰確認できる。
