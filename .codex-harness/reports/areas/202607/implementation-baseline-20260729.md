# 202607 Implementation Baseline

## 位置づけ

2026-07-29時点で、202607版の実装を開始する直前の現行状態を固定する。

過去のlocalhost案を含む棚卸しとは分け、PySide WebView／QWebChannel方針の実装baselineとして扱う。

## 対象

- `app/gui/bridge.py`
- `app/gui/host.py`
- `app/main.py`
- `core/workflow_engine.py`
- GUI bridge／step run関連のPython test

## ファイル規模

| ファイル | 物理行数 |
| --- | ---: |
| `app/gui/bridge.py` | 2254 |
| `app/gui/host.py` | 795 |
| `app/main.py` | 52 |
| `core/workflow_engine.py` | 1139 |
| `static/js/app.js` | 3401 |
| `static/js/ui.fields.js` | 2393 |
| `static/js/workspace.manager.js` | 2244 |
| `static/js/ui.node.canvas.js` | 1824 |
| `static/js/state.js` | 1239 |
| `static/js/ui.node.shared.js` | 1156 |
| `static/js/ui.node.detail.js` | 1098 |
| `static/config/config.js` | 529 |

## 現行command

現行`BridgeRuntime.handle_message`は31 commandを直接分岐する。

- app／host: `app.getStatus`、`app.getSuggestIndex`、`app.googleAuthLogin`、`app.googleAuthStatus`、`app.logUiEvent`、`app.openExternal`、`app.windowControl`、`mouse.coordinateCapture.start`
- file／preview: `file.pickFile`、`file.pickFolder`、`preview.readCsv`、`preview.readExcel`
- flow: `flow.list`、`flow.load`、`flow.run`、`flow.save`、`flow.tabClosed`
- run／result: `run.cancel`、`result.getDatavolume`、`result.getPreview`、`result.getSchema`、`result.getSummary`
- workspace: `workspace.delete`、`workspace.getRoot`、`workspace.list`、`workspace.mkdir`、`workspace.pickRoot`、`workspace.readText`、`workspace.setRoot`、`workspace.stat`、`workspace.writeText`

`flow.*`は現行実装のbaselineであり、202607の正本commandは`documents.*`とする。

## 現行event

- `run.log`
- `run.progress`
- `run.completed`
- `run.failed`
- `run.stepStatus`

## test baseline

実行command:

```text
python -m unittest tests.python.test_bridge_latest_context tests.python.test_step_run_bridge tests.python.test_gui_bridge_save tests.python.test_gui_bridge_file_picker tests.python.test_gui_bridge_workspace_delete
```

結果:

- 12 tests実行
- success
- skipped 2
- failed 0

## 作業ツリー境界

実装開始時点でconnector、`core/workflow_engine.py`、`static/js/ui.fields.js`、`static/js/ui.node.detail.js`、`static/js/ui.node.shared.js`に既存変更がある。

最初のservice／runtime分離ではこれらを変更せず、`app/services`、`app/runtime`、`app/gui/bridge.py`、`app/main.py`、関連testだけを対象にする。
