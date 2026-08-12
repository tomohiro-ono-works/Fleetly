const { test, expect } = require('@playwright/test');
const { withCatalogResponses } = require('../helpers/catalog-bridge-stub');

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
          if (type === 'documents.load') {
            const rel = String(payload?.rel_path || '');
            const name = rel || 'flow_a.zizd';
            return Promise.resolve({
              selected: true,
              mode: 'dataflow',
              file_name: name,
              document_ref: 'docref_' + name.replace(/[^a-z0-9]/gi, '_'),
              doc_session_id: payload?.doc_session_id || '',
              hidden_bindings: {},
              document: {
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
          if (type === 'documents.list') {
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

test('Dataflowタブは常に1件だけ表示される', async ({ page }) => {
  await page.route('**/static/js/bridge.js*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: withCatalogResponses(buildBridgeStubScript())
    });
  });

  await page.goto('/static/dataflow.html');
  await page.getByRole('button', { name: 'エクスプローラー' }).click();
  await page.locator('.workspace-tree-file', { hasText: 'flow_a.zizd' }).first().click();
  await page.locator('.workspace-tree-file', { hasText: 'flow_b.zizd' }).first().click();

  await expect(page.locator('.workspace-pane')).toHaveCount(1);
  await expect(page.locator('.workspace-splitter')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '右ペインへ移動' })).toHaveCount(0);

  const activeFrame = page.locator('.workspace-flow-view:not([hidden]) .workspace-flow-frame');
  await expect(activeFrame).toHaveCount(1);
  let activeSrc = await activeFrame.first().getAttribute('src');
  expect(activeSrc || '').toContain('open_rel_path=flow_b.zizd');

  await page.getByRole('button', { name: /flow_a/ }).click();
  await expect(activeFrame).toHaveCount(1);
  activeSrc = await activeFrame.first().getAttribute('src');
  expect(activeSrc || '').toContain('open_rel_path=flow_a.zizd');

  await page.screenshot({ path: 'artifacts/workspace-two-flow-single-tab.png', fullPage: true });
});
