# Frontend legacy cleanup

## 結果

Task 022を完了し、Phase 11の旧責務混在削除を完了した。

## 変更

- BridgeClientの公開先を`zizPackages.core.bridge`へ一本化した。
- catalog、dialog、utils、code editor、field／suggest APIを
  `zizPackages`配下だけに公開した。
- embedded documentはparentの`zizPackages.core.bridge`を参照する。
- home描画を`home.view.js`へ分離した。
- `static/config/config.js`、旧`app.js`、旧`state.js`、旧renderer、
  旧node／canvas群、未参照`vars.js`の計13 assetを削除した。
- 旧実装だけを検証していたPlaywright spec 16本を削除し、
  有効な保存／field testは現行package APIへ移行した。

## 正本

- host transport: `static/js/bridge.js`
- BridgeClient公開先: `zizPackages.core.bridge`
- app adapter: `zizPackages.app.*`
- reusable UI helper: `zizPackages.ui.*`
- workflow document: `WorkflowDocumentStore`

`backendBridge`はBridgeClient内部のQWebChannel object解決にだけ使用する。
global alias、旧config、旧flow UIへのfallbackは残していない。

## 検証

- JavaScript全体`node --check`: 成功
- Playwright全体: 90件成功
- Python全体: 126件成功、2件skip
- legacy global／削除asset参照検査: 成功
- `git diff --check`: 成功
