const { test, expect } = require('@playwright/test');

function buildBridgeStubScript() {
  return `
    (function () {
      const now = () => Date.now();
      const entries = {
        "": [
          { name: "sample.py", rel_path: "sample.py", kind: "file", has_children: false, size: 10, modified_at: now() }
        ]
      };
      const bridgeApi = {
        available() { return true; },
        call(type, payload) {
          if (type === 'workspace.getRoot') {
            return Promise.resolve({
              has_root: true,
              root_path: 'C:/workspace',
              config_path: 'C:/workspace/config'
            });
          }
          if (type === 'workspace.list') {
            const rel = String(payload?.rel_path || '').replace(/\\\\/g, '/');
            return Promise.resolve({
              scope: payload?.scope || 'root',
              entries: entries[rel] || []
            });
          }
          if (type === 'workspace.mkdir') {
            const relPath = String(payload?.rel_path || '').replace(/\\\\/g, '/');
            const name = relPath.split('/').pop() || 'new_folder';
            entries[""].push({ name, rel_path: relPath, kind: "dir", has_children: false, size: 0, modified_at: now() });
            return Promise.resolve({ scope: payload?.scope || 'root', rel_path: relPath, name, created: true, kind: 'dir' });
          }
          if (type === 'workspace.readText') {
            const relPath = String(payload?.rel_path || '');
            return Promise.resolve({
              scope: payload?.scope || 'root',
              rel_path: relPath,
              file_name: relPath.split('/').pop(),
              content: '# content',
              encoding: 'utf-8',
              mtime_ns: Date.now(),
              size: 9
            });
          }
          if (type === 'workspace.writeText') {
            return Promise.resolve({ saved: true, mtime_ns: Date.now(), size: 9, file_name: 'dummy.txt' });
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

test('エクスプローラ右クリックでフォルダ作成できる', async ({ page }) => {
  await page.route('**/static/js/bridge.js*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: buildBridgeStubScript()
    });
  });

  await page.goto('/static/dataflow.html');
  await page.getByRole('button', { name: 'エクスプローラー' }).click();
  const row = page.locator('.workspace-tree-file', { hasText: 'sample.py' }).first();
  await expect(row).toBeVisible();

  await row.click({ button: 'right' });
  await page.getByRole('button', { name: 'フォルダを作成' }).click();

  await expect(page.locator('.workspace-tree-dir > summary', { hasText: 'new_folder' }).first()).toBeVisible();
});
