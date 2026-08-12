# 202607 Workspace / Documents QWebChannel Result

## 結果

workspace／document操作を`BridgeRuntime`内の個別実装からapplication serviceへ分離し、frontendの呼出しを`BridgeClient`配下のadapterへ統一した。

## 実装

| 領域 | 成果物 |
| --- | --- |
| workspace | `app/services/workspace_service.py` |
| document | `app/services/document_service.py` |
| hidden value | `app/services/hidden_value_service.py` |
| runtime cleanup | `app/runtime/execution_manager.py` |
| bridge / security | `app/gui/bridge.py`、`app/gui/bridge_security.py` |
| frontend | `static/js/workspace.adapter.js`、`static/js/documents.adapter.js` |
| test | `tests/python/test_workspace_document_services.py`、`tests/playwright/specs/workspace-documents-adapter.spec.js` |

## Contract

- workspace commandはroot／config scope、相対path正規化、対象種別、text size、mtime競合をbackendで検証する。
- document commandは`documents.list/load/save/close`へ統一し、旧`flow.list/load/save/tabClosed`を登録しない。
- `document_token`、`document_ref`、hidden refはsession内だけで扱い、`.zizd`保存時は実値へ戻す。
- GUIの表示tab IDと`doc_session_id`を分離し、document close時にhidden sessionと対象run cacheを解放する。
- frontend componentはworkspace／document command文字列を持たず、各adapterから`BridgeClient`を呼ぶ。

## Verification

- Python: 90 success、2 skipped、failed 0
- Playwright関連spec: 7 success、failed 0
- Python `py_compile`: success
- JavaScript `node --check`: success
- 旧document command検索: production残存0

## 後続task

Task 010ではrun／result／preview／file dialogのcontract変更を対象外とした。このため`flow.run`等には移行途中の`workspace_tab_id`表記が残り、値として`doc_session_id`を渡している。

また、runの`flow_key`解決には`BridgeRuntime.current_flow_path`が残る。複数documentを開いた状態で正しいdocument sessionから実行pathを解決する変更は、run／result taskで行う。
