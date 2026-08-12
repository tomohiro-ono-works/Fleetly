# AppShell Library Implementation Report

## Result

Task 012を完了した。

現行のglobal callback objectを、再利用可能な`createAppShell()` instance APIとzizai app adapterへ分離した。`window.zizShell`は撤去し、browser package factoryは`window.zizPackages.uiShell`、zizai固有接続は`window.zizPackages.app.shell`から参照する。

## Library

`static/js/ui-shell/`へ次の責務を分割した。

- `app_shell.js`: public instance APIとlifecycle
- `shell_events.js`: instance内event購読
- `shell_types.js`: tab／activity／command／layout／statusの正規化
- `shell_regions.js`: region content lifecycle、command、status
- `shell_activitybar.js`: activity描画と選択通知
- `shell_tabs.js`: tab描画、activate、close request
- `shell_layout.js`: panel visibility、size、resize

CSSは`static/css/ui-shell.css`へ分離し、色は外部theme tokenから受け取る。library内にbridge、connector、workflow、zizai固有URL／文言は置いていない。

## App Adapter

- `static/js/app-shell.zizai-view.js`がzizai固有navigation、icon、window control、right detail DOMを作る。
- `static/js/app-shell.js`がlibrary instanceと既存app callbackを接続する。
- `workspace.shell.js`は新しい`main` regionへworkspace DOMをmountする。
- 既存frontendのshell参照先を`zizPackages.app.shell`へ変更した。
- 起動直後の非同期初期化前でもsidebar操作が失われない既定handlerをadapterに置いた。
- home／settingsのmobile幅でdataflow用`min-width`が適用されないようselectorを限定した。

## Verification

- JavaScript syntax check: 成功
- AppShell／adapter／現行shell／workspace focused Playwright: 18件成功
- 複数flow tab切替: 1件成功
- embedded flow save: 1件成功
- 合計: 20件成功
- `git diff --check`: errorなし
- desktop workspace screenshot確認: overlap／blankなし
- 390 x 844 home確認: 横overflowなし、window controlとtitleの重なりなし
- UI analysis再実行: AppShellのresize／requestAnimationFrameがtop hotspotから外れた

## Residual

既存のright sidebar系一部testは、`embedded=1`を単独で開くと既定nodeが描画される旧前提を持つ。現行は親workspaceから`ziz:workspace-flow-open`を受けてdocumentを描画するため、Task 012のacceptanceには含めていない。test fixtureの現行contract化はWorkflowDesigner／frontend test整理時に扱う。

## Next

Task 013として`202607-tabular-import-assistant-api.md`を正本に、Excel／CSV modalのpreview table、行選択、lifecycleを共通coreへ分離する。
