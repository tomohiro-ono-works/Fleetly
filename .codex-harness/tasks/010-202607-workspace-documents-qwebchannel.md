# 010 202607 Workspace / Documents QWebChannel Commands

## Objective

workspaceとdocument操作を、巨大なQWebChannel bridge handlerからapplication serviceへ分離する。

frontendの呼出しは共通`BridgeClient`へ統一し、QWebChannel transport自体は維持する。

## Scope

- 対象:
  - `app/services/workspace_service.py`
  - `app/services/document_service.py`
  - `app/services/hidden_value_service.py`
  - bridge dispatcherのworkspace／documents command登録
  - frontend `BridgeClient`／workspace／document adapter
- 主な実装:
  - workspace root／list／stat／read／write／mkdir／delete
  - document list／load／save／close
  - path正規化
  - hidden value session
- 対象外:
  - run／result／event
  - preview／file dialog／input
  - connector／coreの仕様変更

## References

- `.docs/future/qwebchannel/workspace.md`
- `.docs/future/qwebchannel/documents.md`
- `.docs/future/qwebchannel/common.md`
- `.docs/future/qwebchannel/security-policy-profile.md`
- `.docs/future/202607-qwebchannel-contract.md`
- `.docs/future/202607-legacy-path-removal.md`
- `.codex-harness/reports/areas/202607/bridge-route-service-breakdown.md`

## Required Workspace Commands

- `workspace.getRoot`
- `workspace.setRoot`
- `workspace.pickRoot`
- `workspace.list`
- `workspace.stat`
- `workspace.readText`
- `workspace.writeText`
- `workspace.mkdir`
- `workspace.delete`

## Required Documents Commands

- `documents.list`
- `documents.load`
- `documents.save`
- `documents.close`

## Implementation Tasks

1. `workspace_service`にroot／config scopeとpath正規化を集約する。
2. `rel_path`は`/`区切りに正規化し、scopeから解決した実pathをservice内部で扱う。
3. workspace commandではscope、対象存在、file／directory種別、権限、競合条件を検証する。
4. connector parameter、preview、file dialog、flowのopen／saveでworkspace外pathを許可し、workspace外であることだけを理由に拒否または追加確認しない。
5. `readText`はsize上限、encoding、text file条件を検証する。
6. `writeText`は`expected_mtime_ns`でconflictを検出する。
7. `delete`は対象種別と`recursive`を自動検証し、追加確認dialogを表示しない。
8. `document_service`にdocument list／load／save／closeを移す。
9. `document_token`、`document_ref`、hidden bindingsはsession内の補助表現とし、`.zizd`には実pathを保存する。
10. `hidden_value_service`を作り、document load／saveとfile path表示を共有する。
11. `documents.close`で対象`doc_session_id`のhidden sessionとGUI step result cacheを仕様どおり解放する。
12. frontendのworkspace／document呼出しを`BridgeClient`経由へ切り替える。

## Acceptance Criteria

- workspace root／list／stat／read／writeがQWebChannel bridge commandで動く。
- pathがbackendで正規化され、command固有条件が検証される。
- workspace外の正規ETL／RPA操作が、追加確認なしで実行できる。
- `workspace.writeText`の競合が`E_CONFLICT`になる。
- documents list／load／save／closeがQWebChannel commandで動く。
- `.zizd`保存時にhidden refではなく実pathへ解決される。
- document closeで対象hidden sessionと仕様上のcacheが削除される。
- frontend componentが`backendBridge`を直接参照しない。

## Verification

- unit:
  - path normalize
  - scope／対象種別／権限validation
  - mtime conflict
  - hidden value restore／resolve
- integration:
  - workspace root／list／stat／read／write
  - documents list／load／save／close
  - workspace外fileのopen／save／preview
  - 不正payloadと未知commandの拒否

## Notes

- pathをURLへ埋め込むHTTP設計は使用しない。
- run／result／eventは別タスクで扱う。
- 現行bridge handlerを複製せず、serviceへ責務単位で移す。
