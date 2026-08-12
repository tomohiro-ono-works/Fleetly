const { test, expect } = require('@playwright/test');

function buildBridgeStubScript() {
  return `
    (function () {
      const bridgeApi = {
        available() { return true; },
        call(type, payload) {
          if (type === 'workspace.getRoot') {
            return Promise.resolve({ has_root: true, root_path: 'C:/workspace', config_path: 'C:/workspace/config' });
          }
          if (type === 'workspace.list') {
            return Promise.resolve({ scope: payload?.scope || 'root', entries: [] });
          }
          if (type === 'workspace.readText') {
            const relPath = String(payload?.rel_path || 'sample.py');
            return Promise.resolve({
              scope: payload?.scope || 'root',
              rel_path: relPath,
              file_name: relPath.split('/').pop(),
              content: 'print("ok")',
              encoding: 'utf-8',
              mtime_ns: Date.now(),
              size: 11
            });
          }
          if (type === 'workspace.writeText') {
            return Promise.resolve({ saved: true, mtime_ns: Date.now(), size: 11, file_name: 'sample.py' });
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

test('pyタブクリックで単一active tabが切り替わる', async ({ page }) => {
  await page.route('**/static/js/bridge.js*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: buildBridgeStubScript()
    });
  });

  await page.goto('/static/dataflow.html');

  await page.evaluate(async () => {
    await window.zizWorkspace.openTextFile('root', 'left.py', { pane: 'left' });
    await window.zizWorkspace.openTextFile('root', 'right.py', { pane: 'right' });
  });

  await expect(page.locator('.workspace-pane')).toHaveCount(1);
  await expect(page.locator('.workspace-tab[data-pane]')).toHaveCount(0);

  await page.getByRole('button', { name: /left/ }).click();
  await expect(page.locator('.workspace-text-view:not([hidden]) .workspace-text-path')).toContainText('left.py');
  await expect(page.locator('.workspace-text-view:not([hidden])')).toHaveCount(1);

  await page.getByRole('button', { name: /right/ }).click();
  await expect(page.locator('.workspace-text-view:not([hidden]) .workspace-text-path')).toContainText('right.py');
  await expect(page.locator('.workspace-text-view:not([hidden])')).toHaveCount(1);
});
