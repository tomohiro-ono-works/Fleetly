const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

function buildBridgeStubScript() {
  return `
    (function () {
      const bridgeApi = {
        available() { return true; },
        call(type, payload) {
          if (type === 'flow.list') {
            return Promise.resolve({ scope: payload?.scope || 'local', kind: payload?.kind || 'recent', items: [] });
          }
          if (type === 'workspace.getRoot') {
            return Promise.resolve({ has_root: false, root_path: '', config_path: 'C:/Users/tomoh/Documents/Sandbox/zizai/config' });
          }
          if (type === 'workspace.pickRoot') {
            return Promise.resolve({ selected: true, root_path: 'H:/マイドライブ/ETL', config_path: 'C:/Users/tomoh/Documents/Sandbox/zizai/config' });
          }
          if (type === 'workspace.list') {
            return Promise.resolve({ scope: payload?.scope || 'root', entries: [] });
          }
          return Promise.resolve({});
        }
      };
      window.zizPackages = window.zizPackages || {};
      window.zizPackages.core = window.zizPackages.core || {};
      window.zizPackages.core.bridge = bridgeApi;
      setTimeout(() => window.dispatchEvent(new CustomEvent('ziz:bridge-ready')), 0);
    })();
  `;
}

test('プロジェクト選択後の表示をキャプチャ', async ({ page }) => {
  await page.route('**/static/js/bridge.js*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: buildBridgeStubScript()
    });
  });

  await page.goto('/static/home.html');
  await page.getByRole('button', { name: 'プロジェクト選択' }).click();
  await expect(page).toHaveURL(/\/static\/dataflow\.html/);
  await page.getByRole('button', { name: 'ルートフォルダを選択' }).click();
  await expect(page.locator('#workspaceLeftAreaBody')).toContainText('H:/マイドライブ/ETL');

  const outDir = path.join(process.cwd(), 'results', 'manual');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'project-select-after-visible.png');
  await page.screenshot({ path: outPath, fullPage: true });
  console.log('SCREENSHOT_PATH=' + outPath);
});
