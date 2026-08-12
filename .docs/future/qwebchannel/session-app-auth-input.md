# 202607 app / auth / input Bridge Command Schema

## 対象

app 状態、UI event、window control、外部 open、Google auth、座標取得を扱う。

## command `app.getStatus`

Response `data`:

```json
{
  "app": "zizai",
  "session_id": "session_...",
  "host": "pyside-webview",
  "bridge_version": "202607.1",
  "gui_mode": "webview",
  "capabilities": ["documents.load", "documents.save", "documents.close", "run.start"],
  "security": {
    "transport": "qwebchannel",
    "backend_object": "backendBridge",
    "remote_navigation": "blocked",
    "devtools": false
  },
  "security_policies": {
    "loaded": true,
    "command_profile_count": 1,
    "web_allowlist_count": 1
  },
  "runtime_context_defaults": {
    "current_date": "2026-07-14",
    "user_name": "user"
  }
}
```

## command `app.logUiEvent`

Request:

```json
{
  "action": "run.completed.rendered",
  "source": "ui",
  "elapsed_ms": 123.4,
  "detail": {
    "run_id": "run_...",
    "status": "success"
  }
}
```

Response `data`:

```json
{
  "logged": true
}
```

## command `app.windowControl`

Request:

```json
{
  "action": "minimize"
}
```

`action` は `minimize`、`maximize`、`close`、`drag` のいずれか。

Response `data`:

```json
{
  "accepted": true,
  "action": "minimize",
  "state": "normal"
}
```

## command `app.openExternal`

Request:

```json
{
  "url": "https://example.com",
  "prefer": "chrome"
}
```

Response `data`:

```json
{
  "accepted": true,
  "url": "https://example.com",
  "opened_via": "chrome"
}
```

`url` は `http` / `https` のみにする。allowlist は security policy で判定する。

## command `app.getSuggestIndex`

Query:

| name | 必須 | 内容 |
| --- | --- | --- |
| `connector` | 必須 | connector 名。英数字と `_` のみ |

Response `data`:

```json
{
  "connector": "BigQueryConnector",
  "loaded": true,
  "entries": [
    {
      "index": "project_id",
      "suggest_word": ["sample-project"]
    }
  ]
}
```

設定 file の実 path は response に含めない。

## command `app.googleAuthLogin`

Request:

```json
{
  "mode": "application-default"
}
```

`mode` は `application-default` 固定とし、任意 command や任意 provider を受け付けない。backend が起動する command は `gcloud auth application-default login` に固定する。

WindowsではPATHから`gcloud.cmd`の実体をbackend内部で解決して実行する。
PowerShellの`gcloud.ps1` aliasや拡張子なしcommandの暗黙解決には依存しない。
解決した実pathはresponse／logへ含めない。

Response `data`:

```json
{
  "launched": true,
  "provider": "google",
  "mode": "application-default"
}
```

## command `app.googleAuthStatus`

Query:

| name | 必須 | 内容 |
| --- | --- | --- |
| `mode` | 任意 | 省略時 `application-default` |

status 確認では `gcloud config get-value account` と `gcloud auth application-default print-access-token` の成否だけを使用する。access token 本体は保持・返却・log 記録しない。

status確認はQWebChannelのbackground workerで実行し、GUI threadをblockしない。`print-access-token`の標準出力は読まずに破棄する。

Response `data`:

```json
{
  "mode": "application-default",
  "authenticated": true,
  "account": "user@example.com",
  "error": ""
}
```

access token は返さない。

## command `mouse.coordinateCapture.start`

Request:

```json
{
  "capture_id": "coordinate_..."
}
```

Response `data`:

```json
{
  "started": true,
  "capture_id": "coordinate_..."
}
```

結果は`messageToFrontend` signalの`mouse.coordinateCapture.*` eventで受け取る。
