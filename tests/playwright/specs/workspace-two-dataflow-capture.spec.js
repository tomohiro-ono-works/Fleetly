const { test, expect } = require('@playwright/test');

function buildBridgeStubScript() {
  return `
    (function () {
      const tree = {
        "": [
          { name: "flow_a.zizd", rel_path: "flow_a.zizd", kind: "file", has_children: false, size: 10, modified_at: Date.now() },
          { name: "flow_b.zizd", rel_path: "flow_b.zizd", kind: "file", has_children: false, size: 10, modified_at: Date.now() }
        ]
      };
      const bridgeApi = {
        available() { return true; },
        call(type, payload) {
          if (type === 'workspace.getRoot') {
            return Promise.resolve({ has_root: true, root_path: 'C:/workspace', config_path: 'C:/workspace/config' });
          }
          if (type === 'workspace.list') {
            const rel = String(payload?.rel_path || '').replace(/\\\\/g, '/');
            return Promise.resolve({ scope: payload?.scope || 'root', entries: tree[rel] || [] });
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
          if (type === 'flow.load') {
            const rel = String(payload?.rel_path || '');
            const name = rel || 'flow_a.zizd';
            return Promise.resolve({
              selected: true,
              mode: 'dataflow',
              file_name: name,
              hidden_bindings: {},
              flow: {
                metadata: { mode: 'dataflow', name: name.replace(/\\.zizd$/i, '') },
                variables: { start: [] },
                steps: [
                  { step_id: 'step1', connector: 'WindowsConnector', action: 'define_values', params: {}, output_variable: 'step1' }
                ],
                flows: { edges: [{ from: 'START', to: 'step1', kind: 'primary', order: 1 }, { from: 'step1', to: 'END', kind: 'primary', order: 1 }] }
              }
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

test('workspace two dataflow single active capture', async ({ page }) => {
  await page.route('**/static/js/bridge.js*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: buildBridgeStubScript()
    });
  });

  await page.goto('/static/dataflow.html');
  await page.getByRole('button', { name: 'エクスプローラー' }).click();
  await page.locator('.workspace-tree-file', { hasText: 'flow_a.zizd' }).first().click();
  await page.locator('.workspace-tree-file', { hasText: 'flow_b.zizd' }).first().click();

  const tabFlowA = page.locator('.workspace-tab[data-tab-id="tab-flow:root:flow_a.zizd"]');
  await expect(tabFlowA).toBeVisible();
  await tabFlowA.click();
  await expect(page.locator('.workspace-pane')).toHaveCount(1);
  await expect(page.locator('.workspace-flow-view:not([hidden]) .workspace-flow-frame')).toHaveCount(1);
  await page.screenshot({ path: 'artifacts/workspace-two-dataflow-single-view.png', fullPage: true });
});
