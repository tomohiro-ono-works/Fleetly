const { test, expect } = require('@playwright/test');
const { withCatalogResponses } = require('../helpers/catalog-bridge-stub');

function buildBridgeStubScript() {
  return `
    (function () {
      const calls = [];
      window.__bridgeCalls = calls;
      const bridgeApi = {
        available() { return true; },
        call(type, payload) {
          calls.push({ type: String(type || ''), payload: payload || {} });
          if (type === 'workspace.getRoot') {
            return Promise.resolve({ has_root: true, root_path: 'C:/workspace', config_path: 'C:/workspace/config' });
          }
          if (type === 'workspace.list') {
            return Promise.resolve({
              scope: payload?.scope || 'root',
              entries: [{ name: 'dirty.py', rel_path: 'dirty.py', kind: 'file', has_children: false, size: 10, modified_at: Date.now() }]
            });
          }
          if (type === 'workspace.readText') {
            return Promise.resolve({
              scope: payload?.scope || 'root',
              rel_path: payload?.rel_path || 'dirty.py',
              file_name: 'dirty.py',
              content: "print('x')\\n",
              encoding: 'utf-8',
              mtime_ns: 1,
              size: 10
            });
          }
          if (type === 'workspace.writeText') {
            return Promise.resolve({ saved: true, mtime_ns: Date.now(), size: 11, file_name: 'dirty.py' });
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

test('未保存タブを閉じる時に保存ボタンで保存される', async ({ page }) => {
  await page.route('**/static/js/bridge.js*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: withCatalogResponses(buildBridgeStubScript())
    });
  });
  await page.goto('/static/dataflow.html');
  await page.getByRole('button', { name: 'エクスプローラー' }).click();
  await page.locator('.workspace-tree-file', { hasText: 'dirty.py' }).first().click();
  const editor = page.locator('.workspace-pane[data-pane="active"] .workspace-text-view:not([hidden]) .workspace-text-editor').first();
  await editor.fill("print('dirty')\n");
  await page.locator('.workspace-tab .workspace-tab__close').first().click();
  await page.locator('#appDialog').getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(() => {
    const calls = Array.isArray(window.__bridgeCalls) ? window.__bridgeCalls : [];
    return calls.some((entry) => entry && entry.type === 'workspace.writeText');
  });
});
