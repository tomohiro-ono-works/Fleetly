const { test, expect } = require('@playwright/test');

function buildBridgeStubScript() {
  return `
    (function () {
      const files = [
        { name: '__tab_test_a.py', rel_path: '__tab_test_a.py', kind: 'file', has_children: false, size: 16, modified_at: Date.now() },
        { name: '__tab_test_b.py', rel_path: '__tab_test_b.py', kind: 'file', has_children: false, size: 16, modified_at: Date.now() },
        { name: '__tab_test_c.py', rel_path: '__tab_test_c.py', kind: 'file', has_children: false, size: 16, modified_at: Date.now() },
      ];
      const contents = {
        '__tab_test_a.py': "print('A')\\n",
        '__tab_test_b.py': "print('B')\\n",
        '__tab_test_c.py': "print('C')\\n",
      };
      const bridgeApi = {
        available() { return true; },
        call(type, payload) {
          if (type === 'workspace.getRoot') {
            return Promise.resolve({
              has_root: true,
              root_path: 'C:/Users/tomoh/Documents/Sandbox/zizai/workflows',
              config_path: 'C:/Users/tomoh/Documents/Sandbox/zizai/config'
            });
          }
          if (type === 'workspace.list') {
            const rel = String(payload?.rel_path || '');
            if (rel) return Promise.resolve({ scope: payload?.scope || 'root', entries: [] });
            return Promise.resolve({ scope: payload?.scope || 'root', entries: files });
          }
          if (type === 'workspace.readText') {
            const relPath = String(payload?.rel_path || '');
            return Promise.resolve({
              scope: payload?.scope || 'root',
              rel_path: relPath,
              file_name: relPath,
              content: contents[relPath] || '',
              encoding: 'utf-8',
              mtime_ns: Date.now(),
              size: (contents[relPath] || '').length
            });
          }
          if (type === 'workspace.writeText') {
            return Promise.resolve({ saved: true, mtime_ns: Date.now(), size: 0, file_name: String(payload?.rel_path || '') });
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

test('pyタブ切替の画面キャプチャ', async ({ page }) => {
  await page.route('**/static/js/bridge.js*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: buildBridgeStubScript()
    });
  });

  await page.goto('/static/dataflow.html');
  await page.getByRole('button', { name: 'エクスプローラー' }).click();

  await page.locator('.workspace-tree-file', { hasText: '__tab_test_a.py' }).first().click();
  await page.locator('.workspace-tree-file', { hasText: '__tab_test_b.py' }).first().click();
  await page.locator('.workspace-tree-file', { hasText: '__tab_test_c.py' }).first().click();

  const editor = page.locator('.workspace-pane[data-pane="active"] .workspace-text-view:not([hidden]) .workspace-text-editor').first();

  await page.locator('.workspace-tab .workspace-tab__title', { hasText: '__tab_test_b' }).first().click();
  await expect(editor).toHaveValue("print('B')\n");
  await page.screenshot({ path: 'artifacts/py-switch-b.png', fullPage: true });

  await page.locator('.workspace-tab .workspace-tab__title', { hasText: '__tab_test_c' }).first().click();
  await expect(editor).toHaveValue("print('C')\n");
  await page.screenshot({ path: 'artifacts/py-switch-c.png', fullPage: true });
});
