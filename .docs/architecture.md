# architecture

## 役割

この文書は、zizai の設計思想と主要な責務境界の正本である。
調査履歴や作業メモは `.codex-harness/reports/` に置き、この文書とは分ける。

## 設計思想

### 責務分離

GUI フロントエンド、GUI アプリ基盤、CLI アプリ、バックエンド core、connector を分ける。
GUI bridge は画面と application service を接続する transport adapter に限定する。
application service、core、connector は GUI transport に依存させず、CLI からも利用できる構造にする。

### 再利用性

ユーザーが作成した処理は、一度限りの画面操作ではなく、保存・共有・再実行できる設定データとして扱う。
フロー定義ファイルを開けば、同じ処理意図を別のタイミングや別の環境でも再利用できることを重視する。

### 安全性

外部アクセス、ファイル削除、認証、実行環境に影響する操作は、policy、確認、権限で制御する。
便利でも、危険操作を暗黙に実行する機能は避ける。

### 明示性

保存形式、型、入出力 schema、validation、error は明示的に扱う。
暗黙の変換や失敗理由が見えない挙動を減らし、実装者と利用者が同じ前提を持てる状態を目指す。

### 運用性

ログ、検証、トラブルシュート、E2E 結果保存を標準化する。
問題発生時に、画面上の状態だけでなく、ログや保存済み結果から原因を追えることを重視する。

### デザイン一貫性

UI/UX、配色、状態表現、操作導線はルールに沿って統一する。
新規/変更箇所から design rules に準拠し、画面ごとの独自判断を増やさない。

## 主要仕様

### 実装上の基本方針

- 202607版の製品実装、配布、動作保証、検証対象はWindows PC版に限定する。
- macOS／Linux向けのhost、process、path、shortcut、installer分岐は実装対象外とする。
- 起動導線は `zizai.py` に統一する。
- GUI は PySide WebView で bundled local frontend を表示し、QWebChannel で Python backend と接続する。
- GUI frontend は共通 BridgeClient を介して backend command を呼び、QWebChannel object を画面部品から直接参照しない。
- frontend moduleの公開先は`window.zizPackages`だけを正本とし、BridgeClientは
  `zizPackages.core.bridge`、app adapterは`zizPackages.app.*`に公開する。
  `window.zizBridge`等の同一APIを指すglobal aliasやfallbackは作らない。
- GUI frontendは`.zizd`と同じparse済みdocumentをapp document storeの正本とし、WorkflowDesignerをcontrolled componentとして接続する。
- SQL／Python等のtext documentはworkflow外単体実行として扱い、workflow plan、
  step、edge、workflow result cacheを生成しない。対象拡張子、document内容と
  connector parameterの対応はcatalogの`standalone_document`を正本とする。
- CLI は WebView と QWebChannel を起動せず、catalog service、application service、execution manager、core を直接利用する。
- GUI は同一Windows userにつき1processだけ起動し、2つ目はbackend／sessionを作る前に終了する。CLI実行はこの制限に含めない。
- production GUI 用の localhost server、HTTP endpoint、SSE、WebSocket は設けない。
- 保存形式は `.zizd` を正本とし、旧 `.zizw` 互換は持たない。
- flow 定義は `metadata / variables / steps / flows` をトップレベルに持つ。
- 型の意味論は `ziz_datatype` を正本にする。
- コネクタは外部 I/O と変換を担当し、実行順序制御は `core/workflow_engine.py` が担当する。
- connectorが終了を待つ外部processは`shared/process_runner.py`へ集約し、stdout／stderr、exit code、timeout、cancel、Windows process tree終了、secret mask、出力量上限を共通化する。
- driver等の生存resourceは`app/runtime/managed_resources.py`でrun／document／stepに紐付け、flow終了、step再実行、結果無効化、document close、app終了の各境界で解放する。

### 主要入口

| 領域 | 正本 |
| --- | --- |
| 起動 | `zizai.py` |
| ヘッドレス実行 | `app/main.py` |
| GUI host | `app/gui/host.py` |
| GUI bridge | `app/gui/bridge.py` |
| GUI単一起動 | `app/gui/single_instance.py` |
| 外部process実行 | `shared/process_runner.py` |
| managed resource | `app/runtime/managed_resources.py` |
| 実行エンジン | `core/workflow_engine.py` |
| flow 解決 | `core/flow_locator.py` |
| 型変換 | `core/type_registry.py` |
| security policy | `core/security_policies.py` / `config/security_policies.yml` |
| connector/action/form/policy catalog | `config/catalog/*` / `app/services/catalog_service.py` |
| frontend catalog adapter | `static/js/catalog.adapter.js` |

### GUI 境界

- WebView へ公開する QObject は `backendBridge` 1 個に限定する。
- 公開 member は command JSON を受ける `postMessage` と、response / event JSON を送る `messageToFrontend` とする。
- bridge は envelope、command allowlist、payload validation、error mapping、service dispatch を担当する。
- application service は flow、catalog、workspace、preview、run、result、host capability の use case を担当する。
- dialog、window、coordinate、external openはhost capability serviceからWindows GUI hostへ委譲し、host生成thread以外では実行しない。
- Excel／CSV previewとGoogle認証状態確認はGUI thread外で実行し、Google access token本体はresponse、log、service stateへ保持しない。
- catalog定義はGUI backend起動時に1回だけ検証・正規化してimmutable snapshotにし、frontendは`catalog.*` commandで起動時に1回取得する。
- core は依存関係と実行順序、connector は固有の外部 I/O と加工を担当する。
- AppShell、TabularImportAssistant、WorkflowDesigner、ClassicWorkflowDesignerは
  QWebChannel、BridgeClient、core、connectorを知らない。
- WorkflowDesignerとClassicWorkflowDesignerは同じcanonical document、
  selection、viewport、status、document transaction、request event契約を実装する。
  描画方式と操作UIだけを差し替え、document store、command、保存形式は共有する。
- Zizai GUIで使用するdesignerはapp adapterで選択し、UI種別を`.zizd`へ保存しない。
- 外部 browser 単体で production backend を利用する構成は対象外とする。

### Flow 形式

- 対象拡張子は `.zizd`。
- `metadata.mode` は `dataflow` を使用する。
- `metadata.default_flow_id` はCLIの既定flowを示す。
- `steps[].step_id` はdocument全体で一意の安定IDとし、実行順を表さない。
- `steps[].flow_id` は通常stepの所属flowを示す。
- `steps[].params` はconnector入力、`steps[].schema.columns`はschemaを持つ。
- `flows.<flow_id>.start.variables` はflow単位の開始変数を持つ。
- `flows.<flow_id>.edges` はflow単位のDAGを表す。
- `loop.flows.<loop_step_id>.edges` はloop内部graphを表す。
- 旧`flows.edges`、top-level `variables.start`、`params.schema`、`output_variable`は202607形式として読み込まない。

### 型

`ziz_datatype` を型の正本とし、`pandas_type` と `bigquery_type` は派生値として扱う。

主な型:

- `INT64`
- `FLOAT64`
- `NUMERIC`
- `STRING`
- `BYTES`
- `DATE`
- `DATETIME`
- `TIMESTAMP`
- `TIME`
- `INTERVAL`
- `BOOL`
- `ARRAY<T>`
- `STRUCT<name:T>`

schema の最小正本:

```json
[
  {
    "origin_name": "元フィールド名",
    "new_name": "新フィールド名",
    "description": "説明・日本語名",
    "ziz_datatype": "DATE"
  }
]
```

### Connector と Security Policy

- connector は外部 I/O、外部サービス操作、形式変換を担当する。
- core は connector の実行順序を制御するが、外部サービス固有の操作詳細は持たない。
- 外部アクセス、削除、認証など危険操作は、connector 内の実装判断だけに閉じず、security policy や確認処理で制御する。
- SeleniumConnector は、Selenium を使った URL 遷移・DOM 操作時に `config/security_policies.yml` の `web.allowlist` を確認する。許可外 URL への redirect も危険操作として扱い、停止や退避を試みて失敗にする。
- ChromeConnector は、許可済みの初期 URL を既存または新規起動した Chrome で開く。外部 Chrome 内で発生する redirect は追跡できないため、DOM 操作や遷移後 URL の検査には使用しない。
- 詳細な action 契約は `.codex-harness/reports/reference/standards/selenium_connector_definition.md` と `.codex-harness/reports/reference/standards/chrome_connector_definition.md` を参照する。

### ログ

- アプリログは `logs/app_YYYYMMDD.log` に出力する。
- 通常ログレベルは `INFO`。
- 障害調査時のみ一時的に `DEBUG` を使う。
- 秘密情報や実パスは backend 境界でマスクし、hidden 値の管理は専用 service に分離する。
