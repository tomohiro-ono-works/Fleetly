const { test, expect } = require('@playwright/test');
const { buildCatalogBridgeStubScript } = require('../helpers/catalog-bridge-stub');

test('catalogをBridgeClientから1回取得して旧CONFIGなしで初期化する', async ({ page }) => {
  await page.route('**/static/js/bridge.js*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: buildCatalogBridgeStubScript()
    });
  });

  await page.goto('/static/dataflow.html?embedded=1&mode=dataflow');
  await page.waitForFunction(() => {
    const config = window.zizPackages?.app?.catalog?.getConfig?.();
    const workflowDocument = window.zizEmbeddedApi?.getDocument?.();
    return config?.connectors?.length === 12
      && Object.values(config?.actions || {}).flat().length === 39
      && workflowDocument?.steps?.[0]?.connector_id === 'WindowsConnector'
      && !!document.querySelector('[data-classic-workflow-designer]');
  });

  const result = await page.evaluate(() => {
    const config = window.zizPackages.app.catalog.getConfig();
    const commandCounts = {};
    (window.__catalogBridgeCalls || []).forEach((call) => {
      if (!String(call.type).startsWith('catalog.')) return;
      commandCounts[call.type] = (commandCounts[call.type] || 0) + 1;
    });
    return {
      commandCounts,
      hasWindowConfig: Object.prototype.hasOwnProperty.call(window, 'CONFIG'),
      hasCoreConfig: Object.prototype.hasOwnProperty.call(window.zizPackages?.core || {}, 'CONFIG'),
      hasLegacyCatalogGlobal: Object.prototype.hasOwnProperty.call(window, 'zizCatalog'),
      hasLegacyBridgeGlobal: Object.prototype.hasOwnProperty.call(window, 'zizBridge'),
      hasLegacyScript: [...document.scripts].some((script) => String(script.src).includes('/config/config.js')),
      windowsCategory: config.connectors.find((item) => item.id === 'WindowsConnector')?.category,
      loopSubcategory: config.actions.WindowsConnector
        .find((item) => item.id === 'loop_tasks')?.subcategory,
      standaloneDocument: config.actions.BQConnector
        .find((item) => item.id === 'execute_sql')?.standaloneDocument,
      standaloneExportModes: config.actions.ExcelConnector
        .find((item) => item.id === 'write_excel')?.standaloneExportModes,
      transformPolicy: config.dataAreaPolicies['data.transform']?.schema
    };
  });

  expect(result.commandCounts).toEqual({
    'catalog.getConnectors': 1,
    'catalog.getActions': 1,
    'catalog.getForms': 1,
    'catalog.getDataAreaPolicy': 1,
    'catalog.getSecurityPolicySummary': 1
  });
  expect(result.hasWindowConfig).toBeFalsy();
  expect(result.hasCoreConfig).toBeFalsy();
  expect(result.hasLegacyCatalogGlobal).toBeFalsy();
  expect(result.hasLegacyBridgeGlobal).toBeFalsy();
  expect(result.hasLegacyScript).toBeFalsy();
  expect(result.windowsCategory).toBe('workflow');
  expect(result.loopSubcategory).toBe('control');
  expect(result.standaloneDocument).toEqual({
    extensions: ['sql'],
    sourceKind: 'editor_content',
    sourceParam: 'sql'
  });
  expect(result.standaloneExportModes).toEqual(['excel']);
  expect(result.transformPolicy).toBe('readonly');
});
