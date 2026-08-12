const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

function buildBridgeStubScript() {
  return `
    (function () {
      const bridgeApi = {
        available() { return true; },
        call(type, payload) {
          if (type === 'app.getStatus') return Promise.resolve({ gui_mode: 'webview', host: 'qt' });
          if (type === 'flow.list') return Promise.resolve({ scope: payload?.scope || 'local', kind: payload?.kind || 'recent', items: [] });
          if (type === 'workspace.getRoot') return Promise.resolve({ has_root: false, root_path: '', config_path: 'C:/Users/tomoh/Documents/Sandbox/zizai/config' });
          if (type === 'workspace.list') return Promise.resolve({ scope: payload?.scope || 'root', entries: [] });
          if (type === 'workspace.readText') return Promise.resolve({ scope: payload?.scope || 'root', rel_path: payload?.rel_path || '', file_name: 'dummy.md', content: '# dummy', encoding: 'utf-8', mtime_ns: 1, size: 7 });
          if (type === 'workspace.writeText') return Promise.resolve({ saved: true, mtime_ns: 2, size: 7, file_name: 'dummy.md' });
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

test('下部データエリアの左端が詰まっていることを確認する', async ({ page }) => {
  await page.route('**/static/js/bridge.js*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: buildBridgeStubScript()
    });
  });

  await page.goto('/static/dataflow.html?mode=dataflow&embedded=1');
  await expect(page.locator('.detail-panel')).toBeVisible();

  // 初期描画とレイアウト反映を待つ
  await page.waitForTimeout(600);

  const metrics = await page.evaluate(() => {
    const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect();
    const detailPanel = document.querySelector('.detail-panel')?.getBoundingClientRect();
    const nodeDetailBottom = document.querySelector('#nodeDetailBottom')?.getBoundingClientRect();
    const viewportH = window.innerHeight;
    return {
      sidebarLeft: sidebar ? Math.round(sidebar.left) : null,
      sidebarRight: sidebar ? Math.round(sidebar.right) : null,
      detailPanelLeft: detailPanel ? Math.round(detailPanel.left) : null,
      nodeDetailBottomLeft: nodeDetailBottom ? Math.round(nodeDetailBottom.left) : null,
      detailPanelBottom: detailPanel ? Math.round(detailPanel.bottom) : null,
      viewportHeight: viewportH,
      bottomGap: detailPanel ? Math.round(viewportH - detailPanel.bottom) : null
    };
  });
  console.log('layout-metrics', JSON.stringify(metrics));

  const evidenceDir = path.join(process.cwd(), 'results', 'manual');
  fs.mkdirSync(evidenceDir, { recursive: true });
  await page.screenshot({
    path: path.join(evidenceDir, 'detail-panel-left-gap-full.png'),
    fullPage: true
  });
});
