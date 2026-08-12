const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

  const stub = `
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

  await page.route('**/static/js/bridge.js*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: stub });
  });

  await page.goto('http://127.0.0.1:8000/static/dataflow.html');
  await page.evaluate(async () => {
    await window.zizWorkspace.openTextFile('config', 'a.sql');
    await window.zizWorkspace.openTextFile('config', 'b.sql');
  });

  const tabA = page.getByRole('button', { name: /a\.sql/ });
  await tabA.click({ button: 'right' });
  await page.getByRole('button', { name: '右ペインへ移動' }).click();

  const outDir = path.resolve('artifacts');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'workspace-split-view.png');
  await page.screenshot({ path: outPath, fullPage: true });

  console.log(outPath);
  await browser.close();
})();
