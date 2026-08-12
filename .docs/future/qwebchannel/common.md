# 202607 QWebChannel bridge 共通 Schema

## 対象

すべてのQWebChannel bridge command／response／eventに共通するmessage envelope、共通型、ID方針、validationを定義する。

## 共通message envelope

command:

```json
{
  "v": "1",
  "kind": "cmd",
  "id": "cmd_...",
  "type": "documents.load",
  "ts": "2026-07-26T00:00:00Z",
  "payload": {}
}
```

success response:

```json
{
  "v": "1",
  "kind": "res",
  "id": "cmd_...",
  "type": "documents.load",
  "ts": "2026-07-26T00:00:00Z",
  "ok": true,
  "data": {},
  "trace_id": "trace_..."
}
```

failure response:

```json
{
  "v": "1",
  "kind": "res",
  "id": "cmd_...",
  "type": "documents.load",
  "ts": "2026-07-26T00:00:00Z",
  "ok": false,
  "error": {
    "code": "E_VALIDATION",
    "message": "ユーザー表示用メッセージ",
    "detail": {}
  },
  "trace_id": "trace_..."
}
```

event:

```json
{
  "v": "1",
  "kind": "evt",
  "type": "run.progress",
  "ts": "2026-07-26T00:00:00Z",
  "payload": {}
}
```

- `backendBridge.postMessage(json_text)`は`kind: cmd`だけを受け付ける。
- response／eventは`messageToFrontend(json_text)` signalで送る。
- `id`はcommandとresponseの相関に使用する。eventには付けない。
- `trace_id`はcommand単位でbackendが生成し、app logとの照合に使う。`run_id`とは分ける。
- `detail`はallowlist済みの構造化objectとし、不要なら省略できる。
- secret、access token、未maskの実pathはresponse／eventへ含めない。
- HTTP header、status code、session token、SSE framingは使用しない。

## 共通型

| 型 | schema | 備考 |
| --- | --- | --- |
| `Id` | `string` | 空文字不可 |
| `IsoDateTime` | `string` | ISO 8601。UTC 推奨 |
| `WorkspaceScope` | `"root" \| "workspace" \| "config"` | `root` と `workspace` は同義として扱える |
| `RelativePath` | `string` | `/` 区切り。絶対 path、`..` 脱出は禁止 |
| `AbsolutePath` | `string` | OS の絶対 path。backend で正規化し、workspace 外も許可する |
| `DocSessionId` | `string` | document を開いてから閉じるまでの一時 scope |
| `FlowMode` | `"dataflow"` | 将来拡張可 |
| `RunStatus` | `"running" \| "success" \| "error" \| "cancelled"` | run summary と event で使う |
| `StepStatus` | `"pending" \| "running" \| "success" \| "error" \| "skipped"` | step event で使う |
| `HiddenRef` | `string` | 実 path や秘密値を UI に出さない backend opaque ref |
| `MtimeNs` | `string` | file conflict 検知用。数値文字列 |

## ID 方針

| ID | 公開範囲 | 方針 |
| --- | --- | --- |
| `session_id` | frontend/backend | backendがGUI起動時またはCLI起動時に発行し、終了まで共通で使うopaque ID |
| `doc_session_id` | frontend/backend | frontendがdocumentを開くたびに発行するopaque ID。閉じたIDは再利用しない |
| `document_token` | frontend/backend | document 一覧から load するための一時 token |
| `document_ref` | frontend/backend | 保存済み／読込済み `.zizd` document の表示用 identity |
| `run_id` | frontend/backend | backend が UUIDv7 から発行する実行 ID。①workflow step結果は`run_id + step_id`、②単体実行のterminal resultは`run_id`で識別する |
| `trace_id` | frontend/backend | debug と問い合わせ用 |
| `step_id` | `.zizd` document | 10進文字列の安定 ID。`'01'`から発番し、順序を意味しない |
| `flow_id` | `.zizd` document | 10進文字列の安定 ID。`step_id`とは別に`'01'`から発番する |
| `flow_key` | backend 内部 | public API の必須 field にしない |

①ワークフロー実行のstep結果取得は`run_id + step_id`を正本にする。現行実装の`mode + flow_key + step_id`で最新結果を探す方式はbackend内部へ閉じ込める。②ワークフロー外の単体実行はstepを作らず、terminal resultを`run_id`で識別する。

`step_id` は実行順を表さない。実行順序と依存関係は `.zizd` の `flows.<flow_id>.edges`、通常flowの並列／AND合流、loop構造で表す。Zizaiのloop内部では並列／合流を許可しない。詳細は `../202607-zizd-format.md` を正本とする。

`.zizd`の`step_id`／`flow_id`はJSON bridge上でも文字列として送受信する。`'01'`から`'99'`は2桁0埋め、100以降は桁数を増やし、削除済みIDは再利用しない。

## 共通 object

### PathRef

```json
{
  "ref": "{{hidden.global.file_path_1}}",
  "display_name": "input.xlsx",
  "display_hint": "C:/.../input.xlsx"
}
```

### DataColumn

DataColumnはbridge responseの共通objectである。`.zizd`保存時はJSON文字列ではなくYAMLの辞書・配列として保存するが、保存fieldはschema用途によって異なる。入力schemaでは`origin_name`と`ziz_datatype`のみ保存する。詳細は`../202607-column-schema.md`を正本にする。

```json
{
  "origin_name": "顧客ID",
  "new_name": "customer_id",
  "description": "顧客ID",
  "ziz_datatype": "STRING"
}
```

### TablePreview

```json
{
  "columns": ["customer_id", "amount"],
  "rows": [["C001", "1200"]],
  "row_count": 1,
  "truncated": false
}
```

## validation 方針

- 未知 field は原則無視せず、開発時は validation error にする。
- `rel_path` は `/` 区切りに正規化する。
- path は backend で絶対 path に解決して正規化する。workspace root は UI navigation の基準であり、security boundary にはしない。
- workspace 外 path と symlink は、それだけを理由に拒否または確認対象にしない。対象存在、file/directory 種別、権限、上書き競合など action 固有条件は検証する。
- `run_id`、`step_id`、`flow_id`、`doc_session_id` は空文字を禁止する。
- `flow_key` は public request に必須化しない。
- command payloadのschema validationはsecurity policy判定より前に行う。
- 未知command、`kind`不一致、protocol version不一致をapplication service到達前に拒否する。
