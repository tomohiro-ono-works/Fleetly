const { test, expect } = require('@playwright/test');

function buildBridgeStubScript() {
  return `
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
}

test('workspace paneは常に単一でタブだけ切り替わる', async ({ page }) => {
  await page.route('**/static/js/bridge.js*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: buildBridgeStubScript()
    });
  });

  await page.goto('/static/dataflow.html');
  await expect(page.locator('.workspace-pane')).toHaveCount(1);
  await expect(page.locator('.workspace-splitter')).toHaveCount(0);
  await expect(page.locator('.workspace-pane-empty__logo')).toBeVisible();
  await expect(page.locator('.workspace-pane-empty__logo')).toHaveAttribute('src', /ziz_one\.svg$/);
  await expect(page.getByText('ファイルがありません')).toHaveCount(0);
  await expect(page.locator('.workspace-pane-empty__message')).toContainText('左のサイドバーからファイルを選択できます');
  await expect(page.locator('.workspace-pane-empty__message')).toContainText('左のサイドバーで右クリックすると、メニューがでます。');
  await expect(page.locator('.workspace-pane-empty')).not.toHaveCSS('transform', 'none');

  const emptyLogoWidth = await page.locator('.workspace-pane-empty__logo').evaluate((logo) => {
    return logo.getBoundingClientRect().width;
  });
  expect(emptyLogoWidth).toBeGreaterThanOrEqual(160);
  await expect(page.locator('.workspace-pane-empty__logo')).toHaveCSS('opacity', '0.05');
  await expect(page.locator('.workspace-pane-empty__message')).toHaveCSS('font-size', '14px');
  await expect(page.locator('.workspace-pane-empty__message')).toHaveCSS('text-align', 'left');

  await page.evaluate(async () => {
    await window.zizWorkspace.openTextFile('config', 'a.sql');
    await window.zizWorkspace.openTextFile('config', 'b.sql');
  });

  const tabA = page.getByRole('button', { name: /a/ });
  const tabB = page.getByRole('button', { name: /b/ });
  await expect(tabA).toBeVisible();
  await expect(tabB).toBeVisible();
  await expect(page.getByRole('button', { name: '右ペインへ移動' })).toHaveCount(0);

  await tabA.click();
  await expect(page.locator('.workspace-text-view:not([hidden]) .workspace-text-path')).toContainText('a.sql');
  await expect(page.locator('.workspace-text-view:not([hidden])')).toHaveCount(1);

  await tabB.click();
  await expect(page.locator('.workspace-text-view:not([hidden]) .workspace-text-path')).toContainText('b.sql');
  await expect(page.locator('.workspace-text-view:not([hidden])')).toHaveCount(1);
});
