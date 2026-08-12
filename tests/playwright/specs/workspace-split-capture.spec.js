const { test, expect } = require('@playwright/test');

function buildBridgeStubScript() {
  return `
    (function () {
      const bridgeApi = {
        available() { return true; },
        call(type, payload) {
          if (type === 'workspace.getRoot') {
            return Promise.resolve({ has_root: false, root_path: '', config_path: 'C:/Users/tomoh/Documents/Sandbox/zizai/config' });
          }
          if (type === 'workspace.list') {
            return Promise.resolve({ scope: payload?.scope || 'root', entries: [] });
          }
          if (type === 'workspace.readText') {
            return Promise.resolve({
              scope: payload?.scope || 'config',
              rel_path: payload?.rel_path || 'dummy.sql',
              file_name: (payload?.rel_path || 'dummy.sql').split('/').pop(),
              content: 'select 1;',
              encoding: 'utf-8',
              mtime_ns: Date.now(),
              size: 9
            });
          }
          if (type === 'workspace.writeText') {
            return Promise.resolve({ saved: true, mtime_ns: Date.now(), size: 9, file_name: 'dummy.sql' });
          }
          if (type === 'flow.list') {
            return Promise.resolve({ scope: payload?.scope || 'local', kind: payload?.kind || 'recent', items: [] });
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

test('workspace single pane capture', async ({ page }) => {
  await page.route('**/static/js/bridge.js*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: buildBridgeStubScript()
    });
  });
  await page.goto('/static/dataflow.html');
  await page.evaluate(async () => {
    await window.zizWorkspace.openTextFile('config', 'a.sql');
    await window.zizWorkspace.openTextFile('config', 'b.sql');
  });

  const tabA = page.locator('.workspace-tab[data-tab-id="tab-text:config:a.sql"]');
  await expect(tabA).toBeVisible();
  await tabA.click();
  await expect(page.locator('.workspace-pane')).toHaveCount(1);
  await expect(page.locator('.workspace-text-view:not([hidden]) .workspace-text-path')).toContainText('a.sql');
  await page.screenshot({ path: 'artifacts/workspace-single-pane-view.png', fullPage: true });
});
