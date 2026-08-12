const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { withCatalogResponses } = require('../helpers/catalog-bridge-stub');
const { clickClassicStep } = require('../helpers/classic-workflow');

const EXPECTED_FLOWCHART_BG = 'rgb(255, 255, 255)'; // #ffffff
const EXPECTED_FLOW_CANVAS_BG = 'rgb(255, 255, 255)'; // --flow-canvas-bg
const EXPECTED_DATA_PANEL_BG = 'rgb(255, 254, 254)'; // --surface-page

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

async function openDataflow(page) {
  await page.goto('/static/dataflow.html?mode=dataflow&embedded=1');
  await expect(page.locator('#flowchart')).toBeVisible();
  await expect(page.locator('.zcwd-canvas')).toBeVisible();
  await clickClassicStep(page, '01');
  await expect(page.locator('#nodeDetailBottom')).toBeVisible();
}

async function captureColorEvidence(page, label) {
  const outDir = path.join(process.cwd(), 'results', 'manual');
  fs.mkdirSync(outDir, { recursive: true });
  await page.screenshot({
    path: path.join(outDir, `data-area-colors-${label}-full.png`),
    fullPage: true
  });
  await page.locator('#flowchart').screenshot({
    path: path.join(outDir, `data-area-colors-${label}-flowchart.png`)
  });
  await page.locator('.zcwd-canvas').first().screenshot({
    path: path.join(outDir, `data-area-colors-${label}-canvas.png`)
  });
}

async function readColors(page) {
  return page.evaluate(() => {
    const flowchart = document.querySelector('#flowchart');
    const canvas = document.querySelector('.zcwd-canvas');
    const dataPanel = document.querySelector('#nodeDetailBottom');
    if (!flowchart || !canvas || !dataPanel) {
      return { flowchartBg: '', canvasBg: '', dataPanelBg: '', missing: true };
    }
    const flowchartBg = window.getComputedStyle(flowchart).backgroundColor;
    const canvasBg = window.getComputedStyle(canvas).backgroundColor;
    const dataPanelBg = window.getComputedStyle(dataPanel).backgroundColor;
    return { flowchartBg, canvasBg, dataPanelBg, missing: false };
  });
}

function assertColors(colors) {
  expect(colors.missing).toBeFalsy();
  expect(colors.flowchartBg).toBe(EXPECTED_FLOWCHART_BG);
  expect(colors.canvasBg).toBe(EXPECTED_FLOW_CANVAS_BG);
  expect(colors.dataPanelBg).toBe(EXPECTED_DATA_PANEL_BG);
}

test('データエリアとフローキャンバスの背景色が指定どおりである', async ({ page }) => {
  await page.route('**/static/js/bridge.js*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: withCatalogResponses(buildBridgeStubScript())
    });
  });
  await openDataflow(page);
  await captureColorEvidence(page, 'initial');
  const colors = await readColors(page);
  assertColors(colors);
});

test('遷移・右サイドバー操作・リロード後も背景色が維持される', async ({ page }) => {
  await page.route('**/static/js/bridge.js*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: withCatalogResponses(buildBridgeStubScript())
    });
  });
  await openDataflow(page);
  assertColors(await readColors(page));

  await page.goto('/static/home.html');
  await page.goto('/static/dataflow.html?mode=dataflow&embedded=1');
  await expect(page.locator('.zcwd-canvas')).toBeVisible();
  await clickClassicStep(page, '01');
  await expect(page.locator('#nodeDetailBottom')).toBeVisible();
  await captureColorEvidence(page, 'after-navigation');
  assertColors(await readColors(page));

  const toggle = page.locator('#rightSidebarToggle');
  if (await toggle.count()) {
    await toggle.click();
    await page.waitForTimeout(120);
    await toggle.click();
    await page.waitForTimeout(120);
  }

  const resizer = page.locator('#rightSidebarResizer');
  if (await resizer.count()) {
    const box = await resizer.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x - 80, box.y + box.height / 2);
      await page.mouse.up();
      await page.waitForTimeout(120);
    }
  }

  await page.setViewportSize({ width: 1365, height: 920 });
  await page.waitForTimeout(120);
  await captureColorEvidence(page, 'after-resize');
  assertColors(await readColors(page));

  await page.reload();
  await expect(page.locator('.zcwd-canvas')).toBeVisible();
  await clickClassicStep(page, '01');
  await expect(page.locator('#nodeDetailBottom')).toBeVisible();
  await captureColorEvidence(page, 'after-reload');
  assertColors(await readColors(page));
});
