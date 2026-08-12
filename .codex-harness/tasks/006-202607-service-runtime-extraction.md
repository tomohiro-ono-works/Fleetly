# 006 202607 Service / Runtime Extraction

## Status

完了（2026-07-29）。

## Objective

`app/gui/bridge.py`から、QWebChannel非依存のworkflow実行serviceとrun state管理を最初の小さい単位で分離する。

GUIとCLIが同じworkflow実行serviceを利用し、既存のGUI command contractと実行結果を変更しない。

## Scope

- 対象:
  - `app/services/`
  - `app/runtime/`
  - `app/gui/bridge.py`
  - `app/main.py`
  - `tests/python/`
- 主な実装:
  - 1回のworkflow実行を担う`WorkflowExecutionService`
  - run session、active run、latest step resultを管理する`ExecutionManager`
  - GUI bridgeから上記への委譲
  - CLIから`WorkflowExecutionService`への委譲
- 対象外:
  - QWebChannel command名の移行
  - worker queue／最大worker数の202607化
  - result cache形式の202607化
  - connector／coreの仕様変更
  - frontend変更

## References

- `.docs/architecture.md`
- `.docs/future/202607-gui-backend-structure.md`
- `.docs/future/202607-service-runtime-interface.md`
- `.docs/future/202607-runtime-data-lifetime.md`
- `.docs/future/202607-implementation-sequence.md`

## Implementation Tasks

1. `WorkflowEngine`生成とconfig／file実行をtransport非依存serviceへ移す。
2. run session、flow単位のactive run、latest context／step resultをruntime managerへ移す。
3. `BridgeRuntime`の既存公開メソッドは薄い委譲として維持する。
4. `app/main.py`はWebView／QWebChannelを経由せず同じserviceを利用する。
5. service／runtimeがPySide6と`app.gui`をimportしないことをtestで確認する。

## Acceptance Criteria

- GUIとCLIのworkflow実行が`WorkflowExecutionService`を共有する。
- service／runtimeがQWebChannel、QObject、WebViewへ依存しない。
- 同一flowのactive run競合、cancel、latest step resultの既存挙動を維持する。
- 既存bridge／step run testと新規unit testが成功する。

## Verification

- `py_compile`
- service／runtime unit test
- bridge latest context／step run／save／file picker／workspace delete test
