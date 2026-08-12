# 012 202607 AppShell Library

## Objective

現行`static/js/app-shell.js`からframe UIの汎用責務を分離し、`202607-appshell-api.md`を正本とするinstance APIへ移行する。

zizai固有のnavigation、URL、window command、既存画面との接続はapp adapterへ残し、再利用ライブラリへ持ち込まない。

## Scope

- 対象:
  - `static/js/ui-shell/`
  - `static/css/ui-shell.css`
  - `static/js/app-shell.js`
  - AppShell利用元のfrontend JavaScript
  - AppShell browser fixture／Playwright test
- public API:
  - `createAppShell(options)`
  - `mount()`／`destroy()`
  - activity／command／tab／region／status／layout操作
  - `on()`／`off()`
- 主な実装:
  - layout、event、region、activity、tabを内部moduleへ分割
  - app固有処理を持たないbrowser package
  - zizai app adapterによる現行DOM／callback接続
  - `window.zizShell`依存の撤去

## Out Of Scope

- workspace document state／保存／close policy
- WorkflowDesigner
- TabularImportAssistant
- connector／action catalogの意味解釈
- QWebChannel／BridgeClient呼出し
- workflow canvas／data areaの再実装
- 現行workspace manager全体の分割

## References

- `.docs/future/202607-appshell-api.md`
- `.docs/future/202607-frontend-library.md`
- `.docs/future/202607-frontend-app.md`
- `.docs/future/202607-implementation-sequence.md`
- `.codex-harness/reports/areas/202607/frontend-library-inventory.md`

## Implementation Tasks

1. event emitter、入力normalizer、region lifecycleを内部moduleとして作る。
2. activity、command、tab、statusをDOM APIで描画する。
3. sidebar／right panel／bottom panelのvisibilityとsizeをlayout snapshotへ集約する。
4. resize eventをframe単位でまとめ、inactive時のglobal listener処理を避ける。
5. entryから`createAppShell()`をbrowser packageとして公開する。
6. zizai固有sidebar、window action、header callbackをapp adapterへ実装する。
7. frontendの`window.zizShell`参照をapp adapter参照へ移す。
8. standalone fixtureでbackend非依存の再利用testを行う。

## Acceptance Criteria

- public APIが`202607-appshell-api.md`に沿う。
- library内部にbridge、connector、workflow、zizai固有URL／文言がない。
- 複数instanceを同一pageで独立して作成できる。
- `tab:close-request`ではtab本体を削除しない。
- `command:execute`、`activity:select`、`tab:activate`、`layout:change`、`region:focus`を購読できる。
- `destroy()`でlistener、region adapter、mount DOMが破棄される。
- `window.zizShell`が存在せず、現行home／dataflow／settingsの基本操作が維持される。

## Verification

- Playwright:
  - standalone mount／destroy
  - activity／command／tab event
  - tab close request
  - region content lifecycle
  - layout snapshot／panel visibility
  - current home navigation／diagnostics
- static:
  - `window.zizShell`参照なし
  - library内のapp固有依存なし
  - `git diff --check`
