const { test, expect } = require('@playwright/test');

const { withCatalogResponses } = require('../helpers/catalog-bridge-stub');

function buildBridgeStubScript() {
  return `
    (function () {
      const calls = [];
      window.__workspaceBridgeCalls = calls;
      const bridgeApi = {
        available() { return true; },
        call(type, payload) {
          calls.push({ type: String(type || ''), payload: payload || {} });
          if (type === 'workspace.getRoot') {
            return Promise.resolve({ has_root: false, root_path: '', config_path: 'C:/Users/tomoh/Documents/Sandbox/zizai/config' });
          }
          if (type === 'workspace.pickRoot') {
            return Promise.resolve({ selected: true, root_path: 'C:/tmp/workspace-project', config_path: 'C:/Users/tomoh/Documents/Sandbox/zizai/config' });
          }
          if (type === 'workspace.list') {
            return Promise.resolve({ scope: payload?.scope || 'root', entries: [] });
          }
          if (type === 'workspace.readText') {
            return Promise.resolve({ scope: payload?.scope || 'root', rel_path: payload?.rel_path || '', file_name: 'dummy.md', content: '# dummy', encoding: 'utf-8', mtime_ns: 1, size: 7 });
          }
          if (type === 'workspace.writeText') {
            return Promise.resolve({ saved: true, mtime_ns: 2, size: 7, file_name: 'dummy.md' });
          }
          return Promise.resolve({});
        }
      };
      window.zizPackages = window.zizPackages || {};
      window.zizPackages.core = window.zizPackages.core || {};
      window.zizPackages.core.bridge = bridgeApi;
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('ziz:bridge-ready'));
      }, 0);
    })();
  `;
}

test('プロジェクト選択パネルのボタン押下で workspace.pickRoot が呼ばれ、ルート表示が更新される', async ({ page }) => {
  await page.route('**/static/js/bridge.js*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: withCatalogResponses(buildBridgeStubScript())
    });
  });

  await page.goto('/static/dataflow.html');
  await expect(page.locator('.ziz-app-shell')).toBeVisible();

  await page.getByRole('button', { name: 'プロジェクト選択' }).click();
  await expect(page.locator('#workspaceLeftAreaBody')).toContainText('最近使ったプロジェクト（最大10件）');
  await page.getByRole('button', { name: 'ルートフォルダを選択' }).click();

  await page.waitForFunction(() => {
    const calls = Array.isArray(window.__workspaceBridgeCalls) ? window.__workspaceBridgeCalls : [];
    return calls.some((entry) => entry && entry.type === 'workspace.pickRoot');
  });

  await expect(page.locator('#workspaceLeftAreaBody')).toContainText('C:/tmp/workspace-project');
});
