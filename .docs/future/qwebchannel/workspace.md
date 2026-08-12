# 202607 workspace Bridge Command Schema

## 対象

workspace root/list/stat/read/write/delete を扱う。

pathを含むcommandも、他のcommandと同じJSON payloadで指定する。pathをURLやlogへ埋め込むHTTP設計は使用しない。

## command `workspace.getRoot`

Response `data`:

```json
{
  "has_root": true,
  "root_path": "C:/path/to/workspace",
  "config_path": "C:/path/to/config"
}
```

`root_path` と `config_path` は UI 表示用に返せるが、log へは出さない。

## command `workspace.setRoot`

Request:

```json
{
  "root_path": "C:/path/to/workspace"
}
```

root 解除時は `root_path` を空文字にする。

Response `data`:

```json
{
  "has_root": true,
  "root_path": "C:/path/to/workspace",
  "config_path": "C:/path/to/config"
}
```

## command `workspace.pickRoot`

Request:

```json
{
  "title": "プロジェクトルートを選択",
  "current_value": "C:/path/to/workspace"
}
```

Response `data`:

```json
{
  "selected": true,
  "root_path": "C:/path/to/workspace"
}
```

キャンセル時は `{ "selected": false }` を返す。

## command `workspace.list`

Request:

```json
{
  "scope": "root",
  "rel_path": "flows"
}
```

Response `data`:

```json
{
  "scope": "root",
  "rel_path": "flows",
  "entries": [
    {
      "name": "sample.zizd",
      "rel_path": "flows/sample.zizd",
      "kind": "file",
      "has_children": false,
      "size": 1000,
      "mtime_ns": "1760000000000000000",
      "modified_at": "2026-07-14T00:00:00Z"
    }
  ]
}
```

`base_path` や絶対 `path` は通常 response に含めない。

## command `workspace.stat`

Request:

```json
{
  "scope": "root",
  "rel_path": "flows/sample.zizd"
}
```

Response `data`:

```json
{
  "scope": "root",
  "rel_path": "flows/sample.zizd",
  "file_name": "sample.zizd",
  "mtime_ns": "1760000000000000000",
  "size": 1000,
  "exists": true
}
```

## command `workspace.readText`

Request:

```json
{
  "scope": "root",
  "rel_path": "flows/sample.zizd"
}
```

Response `data`:

```json
{
  "scope": "root",
  "rel_path": "flows/sample.zizd",
  "file_name": "sample.zizd",
  "content": "metadata:\n  name: sample\n",
  "encoding": "utf-8",
  "mtime_ns": "1760000000000000000",
  "size": 1000
}
```

## command `workspace.writeText`

Request:

```json
{
  "scope": "root",
  "rel_path": "flows/sample.zizd",
  "content": "metadata:\n  name: sample\n",
  "expected_mtime_ns": "1760000000000000000",
  "force": false
}
```

Response `data`:

```json
{
  "scope": "root",
  "rel_path": "flows/sample.zizd",
  "file_name": "sample.zizd",
  "mtime_ns": "1760000000000000001",
  "size": 1001,
  "saved": true
}
```

`expected_mtime_ns` が一致しない場合は `E_CONFLICT` を返す。

## command `workspace.mkdir`

Request:

```json
{
  "scope": "root",
  "rel_path": "flows/new-folder"
}
```

Response `data`:

```json
{
  "scope": "root",
  "rel_path": "flows/new-folder",
  "name": "new-folder",
  "created": true,
  "kind": "dir"
}
```

## command `workspace.delete`

Request:

```json
{
  "scope": "root",
  "rel_path": "flows/old.zizd",
  "recursive": false
}
```

Response `data`:

```json
{
  "scope": "root",
  "rel_path": "flows/old.zizd",
  "deleted": true,
  "kind": "file"
}
```

folder 削除時は request 意図を明示するため `recursive: true` を必須にする。path、対象種別、request schema は backend で自動検証し、security の追加確認 dialog は表示しない。
