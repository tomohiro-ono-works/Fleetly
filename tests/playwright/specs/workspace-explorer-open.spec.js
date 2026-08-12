const { test, expect } = require('@playwright/test');
const { withCatalogResponses } = require('../helpers/catalog-bridge-stub');

function buildBridgeStubScript() {
  return `
    (function () {
      const tree = {
        "": [
          { name: "sample.py", rel_path: "sample.py", kind: "file", has_children: false, size: 10, modified_at: Date.now() },
          { name: "settings.json", rel_path: "settings.json", kind: "file", has_children: false, size: 10, modified_at: Date.now() },
          { name: "flow.zizd", rel_path: "flow.zizd", kind: "file", has_children: false, size: 10, modified_at: Date.now() },
          { name: "memo.txt", rel_path: "memo.txt", kind: "file", has_children: false, size: 10, modified_at: Date.now() }
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
              entries: tree[rel] || []
            });
          }
          if (type === 'workspace.readText') {
            const relPath = String(payload?.rel_path || '');
            return Promise.resolve({
              scope: payload?.scope || 'root',
              rel_path: relPath,
              file_name: relPath.split('/').pop(),
              content: relPath.endsWith('.json') ? '{\\n  "enabled": true,\\n  "count": 3\\n}' : '# content',
              encoding: 'utf-8',
              mtime_ns: Date.now(),
              size: 9
            });
          }
          if (type === 'documents.load') {
            if (String(payload?.rel_path || '') === 'flow.zizd') {
              return Promise.resolve({
                selected: true,
                mode: 'dataflow',
                file_name: 'flow.zizd',
                document_ref: 'docref_flow',
                hidden_bindings: {},
                document: {
                  metadata: { mode: 'dataflow', name: 'FlowFromZizd' },
                  variables: { start: [] },
                  steps: [
                    {
                      step_id: 'step1',
                      connector: 'WindowsConnector',
                      action: 'define_values',
                      params: {},
                      output_variable: 'step1'
                    }
                  ],
                  flows: {
                    edges: [
                      { from: 'START', to: 'step1', kind: 'primary', order: 1 },
                      { from: 'step1', to: 'END', kind: 'primary', order: 1 }
                    ]
                  }
                }
              });
            }
            return Promise.resolve({ selected: false });
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

test('エクスプローラーでファイルを1クリックすると対応拡張子が開く', async ({ page }) => {
  await page.route('**/static/js/bridge.js*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: withCatalogResponses(buildBridgeStubScript())
    });
  });

  await page.goto('/static/dataflow.html');

  await page.getByRole('button', { name: 'エクスプローラー' }).click();
  await expect(page.locator('.workspace-tree-file', { hasText: 'sample.py' }).first()).toBeVisible();

  await page.locator('.workspace-tree-file', { hasText: 'sample.py' }).first().click();
  await expect(page.getByRole('button', { name: /sample/ })).toBeVisible();

  await page.locator('.workspace-tree-file', { hasText: 'settings.json' }).first().click();
  await expect(page.getByRole('button', { name: /settings/ })).toBeVisible();
  await expect(page.locator('.workspace-text-view:not([hidden]) .workspace-text-editor-host.code-editor')).toBeVisible();
  await expect(page.locator('.workspace-text-view:not([hidden]) .code-editor-highlight .cm-token.cm-string')).toHaveCount(2);
  await expect(page.locator('.workspace-text-view:not([hidden]) .code-editor-highlight .cm-token.cm-keyword')).toHaveText('true');
  await expect(page.locator('.workspace-text-view:not([hidden]) .code-editor-highlight .cm-token.cm-number')).toHaveText('3');

  await page.locator('.workspace-tree-file', { hasText: 'flow.zizd' }).first().click();
  await expect(page.getByRole('button', { name: /flow/ })).toHaveClass(/is-active/);
  await expect(page.locator('.workspace-flow-view:not([hidden]) .workspace-flow-frame')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /flow/ })).toHaveCount(1);

  await page.locator('.workspace-tree-file', { hasText: 'memo.txt' }).first().click();
  await expect(page.getByRole('button', { name: /memo/ })).toHaveCount(0);
});
