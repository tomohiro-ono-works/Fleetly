const { test, expect } = require('@playwright/test');

function buildBridgeStubScript() {
  return `
    (function () {
      const calls = [];
      window.__bridgeCalls = calls;
      const now = () => Date.now();
      const textStore = {
        'dirty.py': "print('x')\\n"
      };
      const bridgeApi = {
        available() { return true; },
        call(type, payload) {
          calls.push({ type: String(type || ''), payload: payload || {} });
          if (type === 'workspace.getRoot') {
            return Promise.resolve({ has_root: true, root_path: 'C:/workspace-a', config_path: 'C:/workspace-a/config' });
          }
          if (type === 'workspace.list') {
            return Promise.resolve({
              scope: payload?.scope || 'root',
              entries: [
                { name: 'dirty.py', rel_path: 'dirty.py', kind: 'file', has_children: false, size: 10, modified_at: now() },
              ]
            });
          }
          if (type === 'workspace.readText') {
            const relPath = String(payload?.rel_path || 'dirty.py');
            const content = textStore[relPath] || '';
            return Promise.resolve({
              scope: payload?.scope || 'root',
              rel_path: relPath,
              file_name: relPath.split('/').pop() || relPath,
              content,
              encoding: 'utf-8',
              mtime_ns: String(now()),
              size: content.length
            });
          }
          if (type === 'workspace.writeText') {
            const relPath = String(payload?.rel_path || 'dirty.py');
            textStore[relPath] = String(payload?.content || '');
            return Promise.resolve({ saved: true, file_name: relPath.split('/').pop() || relPath, mtime_ns: String(now()), size: textStore[relPath].length });
          }
          if (type === 'workspace.pickRoot') {
            return Promise.resolve({ selected: true, root_path: 'C:/workspace-b', config_path: 'C:/workspace-b/config' });
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

test('ルート変更時: text未保存で保存を押すとwriteText後にpickRootが呼ばれる', async ({ page }) => {
  await page.route('**/static/js/bridge.js*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: buildBridgeStubScript() });
  });
  await page.goto('/static/dataflow.html');
  await page.getByRole('button', { name: 'エクスプローラー' }).click();
  await page.locator('.workspace-tree-file', { hasText: 'dirty.py' }).first().click();
  const editor = page.locator('.workspace-pane[data-pane="active"] .workspace-text-view:not([hidden]) .workspace-text-editor').first();
  await editor.fill("print('dirty')\n");

  await page.getByRole('button', { name: 'プロジェクト選択' }).click();
  await page.locator('#workspacePickRootBtn').click();
  await page.locator('#appDialog').getByRole('button', { name: '保存', exact: true }).click();

  await page.waitForFunction(() => {
    const calls = Array.isArray(window.__bridgeCalls) ? window.__bridgeCalls : [];
    return calls.some((entry) => entry && entry.type === 'workspace.writeText')
      && calls.some((entry) => entry && entry.type === 'workspace.pickRoot');
  });
  const calls = await page.evaluate(() => Array.isArray(window.__bridgeCalls) ? window.__bridgeCalls : []);
  const writeIdx = calls.findIndex((c) => c && c.type === 'workspace.writeText');
  const pickIdx = calls.findIndex((c) => c && c.type === 'workspace.pickRoot');
  expect(writeIdx).toBeGreaterThanOrEqual(0);
  expect(pickIdx).toBeGreaterThanOrEqual(0);
  expect(writeIdx).toBeLessThan(pickIdx);
});
