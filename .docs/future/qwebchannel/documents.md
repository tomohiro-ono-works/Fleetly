# 202607 documents Bridge Command Schema

## 対象

`.zizd` document の一覧、読込、保存、document session close を扱う。document 内の個別 flow は `flow_id` で識別する。

## command `documents.list`

Payload:

| name | 必須 | 内容 |
| --- | --- | --- |
| `scope` | 任意 | `local` または `workspace`。省略時 `local` |
| `kind` | 任意 | `recent` または `template`。省略時 `recent` |

Response `data`:

```json
{
  "scope": "local",
  "kind": "recent",
  "items": [
    {
      "document_token": "doctok_...",
      "display_name": "sample.zizd",
      "display_hint": "workflows",
      "modified_at": "2026-07-14T00:00:00Z"
    }
  ]
}
```

## command `documents.load`

Payload:

```json
{
  "doc_session_id": "docsession_...",
  "document_token": "doctok_...",
  "scope": "root",
  "rel_path": "flows/sample.zizd"
}
```

`document_token` または `scope + rel_path` のどちらかを指定する。どちらも無い場合は host の open dialog を使う。

`document_token` と `hidden_bindings` は frontend session 内だけの補助表現とする。`.zizd` の読込結果と保存内容では path を実値へ解決し、hidden ref を正本形式へ持ち込まない。

Response `data`:

```json
{
  "selected": true,
  "mode": "dataflow",
  "file_name": "sample.zizd",
  "document_ref": "docref_...",
  "document": {},
  "hidden_bindings": {
    "{{hidden.step.file_path_1}}": {
      "display_name": "input.xlsx",
      "display_hint": "C:/.../input.xlsx"
    }
  }
}
```

キャンセル時:

```json
{
  "selected": false
}
```

## command `documents.save`

Payload:

```json
{
  "doc_session_id": "docsession_...",
  "mode": "dataflow",
  "document_ref": "docref_...",
  "file_name": "sample.zizd",
  "scope": "root",
  "rel_path": "flows/sample.zizd",
  "document": {}
}
```

`scope + rel_path` が無い場合は host の save dialog を使える。

Response `data`:

```json
{
  "saved": true,
  "file_name": "sample.zizd",
  "document_ref": "docref_..."
}
```

キャンセル時:

```json
{
  "saved": false,
  "file_name": "sample.zizd"
}
```

## command `documents.close`

`documents.close`自体はrunをcancelしない。対象documentに紐づくrunが実行中の場合、frontend appは先に二択のclose確認を表示する。

- `閉じずに続行`: close要求を取り消し、runを継続する。
- `実行をキャンセルして閉じる`: `run.cancel`を呼び、terminal eventとcleanup完了を待つ。その後、documentがdirtyなら保存確認を行い、保存処理または保存しない選択の完了後に`documents.close`を呼ぶ。

確認dialogの既定選択は`閉じずに続行`とする。

未保存確認では`保存して閉じる`と`保存せず閉じる`を表示する。保存dialogのcancel、保存失敗、保存競合時はdocumentを閉じない。この時点ではrunのcancelは完了済みとする。

Payload:

```json
{
  "doc_session_id": "docsession_..."
}
```

Response `data`:

```json
{
  "closed": true,
  "doc_session_id": "docsession_..."
}
```
