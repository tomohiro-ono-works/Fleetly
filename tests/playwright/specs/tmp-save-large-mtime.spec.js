const { test, expect } = require('@playwright/test');

function buildBridgeStubScript() {
  return `
    (function () {
      const calls = [];
      const mtime = '1715151515151515151';
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
              entries: [{ name: 'save_test.py', rel_path: 'save_test.py', kind: 'file', has_children: false, size: 10, modified_at: Date.now() }]
            });
          }
          if (type === 'workspace.readText') {
            return Promise.resolve({
              scope: payload?.scope || 'root',
              rel_path: payload?.rel_path || 'save_test.py',
              file_name: 'save_test.py',
              content: "print('x')\\n",
              encoding: 'utf-8',
              mtime_ns: mtime,
              size: 10
            });
          }
          if (type === 'workspace.writeText') {
            const expected = String(payload?.expected_mtime_ns ?? '');
            if (!payload?.force && expected !== mtime) {
              return Promise.reject({ code: 'E_CONFLICT', message: 'conflict' });
            }
            return Promise.resolve({ saved: true, mtime_ns: mtime, size: 12, file_name: 'save_test.py' });
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

test('巨大mtime_nsでも保存できる', async ({ page }) => {
  await page.route('**/static/js/bridge.js*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: buildBridgeStubScript()
    });
  });

  await page.goto('/static/dataflow.html');
  await page.getByRole('button', { name: 'エクスプローラー' }).click();
  await page.locator('.workspace-tree-file', { hasText: 'save_test.py' }).first().click();

  const editor = page.locator('.workspace-pane[data-pane="active"] .workspace-text-view:not([hidden]) .workspace-text-editor').first();
  await editor.fill("print('saved')\n");
  await page.locator('.workspace-text-actions [data-action="save"]').click();

  await page.waitForFunction(() => {
    const calls = Array.isArray(window.__bridgeCalls) ? window.__bridgeCalls : [];
    return calls.some((entry) => entry && entry.type === 'workspace.writeText');
  });
});
