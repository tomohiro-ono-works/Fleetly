const { test, expect } = require('@playwright/test');
const { withCatalogResponses } = require('../helpers/catalog-bridge-stub');
const { clickClassicStep } = require('../helpers/classic-workflow');

function buildBridgeStubScript() {
  return `
    (function () {
      const calls = [];
      window.__bridgeCalls = calls;
      const bridgeApi = {
        available() { return true; },
        status() { return { state: 'ready', ready: true }; },
        unavailableMessage() { return ''; },
        call(type, payload) {
          calls.push({ type: String(type || ''), payload: payload || {} });
          if (type === 'app.getStatus') return Promise.resolve({ gui_mode: 'webview', host: 'qt', capabilities: ['app.getStatus','file.pickFile','preview.readExcel'], run_index: { workflows: [], standalone: [] } });
          if (type === 'app.logUiEvent') return Promise.resolve({ ok: true });
          if (type === 'workspace.getRoot') return Promise.resolve({ has_root: false, root_path: '', config_path: 'C:/Users/tomoh/Documents/Sandbox/zizai/config' });
          if (type === 'workspace.list') return Promise.resolve({ scope: payload?.scope || 'root', entries: [] });
          if (type === 'workspace.readText') return Promise.resolve({ scope: payload?.scope || 'config', rel_path: payload?.rel_path || 'recent_roots.json', file_name: 'recent_roots.json', content: '[]', encoding: 'utf-8', mtime_ns: String(Date.now()), size: 2 });
          if (type === 'workspace.writeText') return Promise.resolve({ saved: true, mtime_ns: String(Date.now()), size: 2 });
          if (type === 'file.pickFile') {
            return Promise.resolve({
              selected: true,
              ref: '{{hidden.01.var1}}',
              display_name: 'sample.xlsx',
              display_hint: 'C:/tmp/sample.xlsx'
            });
          }
          if (type === 'preview.readExcel') {
            const sheet = String(payload?.sheet_name || 'Sheet1');
            return Promise.resolve({
              ref: '{{hidden.01.var1}}',
              display_name: 'sample.xlsx',
              display_hint: 'C:/tmp/sample.xlsx',
              file_name: 'sample.xlsx',
              sheet_names: ['Sheet1', 'Sheet2'],
              sheet_name: sheet,
              columns: ['A', 'B'],
              rows2d: sheet === 'Sheet2' ? [[11, 22], [33, 44]] : [[1, 2], [3, 4]],
              base_row: 0,
              col_count: 2
            });
          }
          if (type === 'result.invalidateSteps') {
            return Promise.resolve({ invalidated_step_ids: payload?.step_ids || [] });
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

function workflowDocument({ name, connectorId, actionId, params }) {
  return {
    metadata: { mode: 'dataflow', name, default_flow_id: '01' },
    steps: [{
      step_id: '01',
      flow_id: '01',
      label: name,
      connector_id: connectorId,
      action_id: actionId,
      params,
      ui_position: { x: 320, y: 220 }
    }],
    flows: {
      '01': {
        label: 'Main flow',
        start: { ui_position: { x: 80, y: 220 }, variables: [] },
        end: { ui_position: { x: 660, y: 220 } },
        edges: [
          { from: 'START', to: '01', order: 1 },
          { from: '01', to: 'END', order: 1 }
        ]
      }
    },
    notes: []
  };
}

async function openWorkflow(page, documentState, fileName) {
  await page.addInitScript(({ documentState: document, fileName: name }) => {
    if (window.top !== window) return;
    window.sessionStorage.setItem('ziz.pendingFlow.v1', JSON.stringify({
      selected: true,
      mode: 'dataflow',
      file_name: name,
      document_ref: `docref_${name}`,
      doc_session_id: `docsession_${name}`,
      document,
      hidden_bindings: {},
      mtime_ns: '1'
    }));
  }, { documentState, fileName });
  await page.goto('/static/dataflow.html');
  await expect(page.locator('.workspace-flow-frame')).toBeVisible();
  const frame = page.frames().find((item) => (
    item !== page.mainFrame() && item.url().includes('/static/dataflow.html')
  ));
  await expect.poll(async () => frame?.evaluate(
    () => !!window.zizEmbeddedApi
  )).toBe(true);
  await clickClassicStep(frame, '01');
  await expect(page.locator('.workflow-property-heading')).toBeVisible();
  return frame;
}

test('Excel取込assistantがbridge previewをnode formへ反映する', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));

  await page.route('**/static/js/bridge.js*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: withCatalogResponses(buildBridgeStubScript())
    });
  });

  const flow = workflowDocument({
    name: 'Excel input',
    connectorId: 'ExcelConnector',
    actionId: 'read_excel',
    params: { file_path: '', sheet_name: 'Sheet1', header_row: 1, data_start_row: 2 }
  });
  const frame = await openWorkflow(page, flow, 'preview_probe.zizd');
  const previewBtn = page.locator(
    '.workflow-property-icon-button[aria-label="ファイルを開く"]'
  );
  await expect(previewBtn).toBeVisible();
  await previewBtn.click();

  const dialog = page.getByRole('dialog', { name: 'Excel 取込設定' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'ファイルを選択' }).click();
  await expect(dialog.getByLabel('シート').locator('option')).toHaveCount(2);
  await dialog.getByLabel('シート').selectOption({ label: 'Sheet2' });
  await dialog.getByRole('button', { name: '確定' }).click();

  const result = await frame.evaluate(() => {
    const documentState = window.zizEmbeddedApi.getDocument();
    return {
      step: documentState.steps[0],
      hiddenBindings: window.zizEmbeddedApi.getPropertyContext().hidden_bindings
    };
  });
  const calls = await page.evaluate(() => window.__bridgeCalls || []);
  expect(calls.some((c) => c.type === 'file.pickFile')).toBeTruthy();
  expect(calls.some((c) => c.type === 'preview.readExcel')).toBeTruthy();
  expect(result.step.params.file_path).toBe('{{hidden.01.var1}}');
  expect(result.step.params.sheet_name).toBe('Sheet2');
  expect(result.step.params.schema).toBeUndefined();
  expect(result.step.schema.columns).toEqual([
    { origin_name: '11', ziz_datatype: 'INT64' },
    { origin_name: '22', ziz_datatype: 'INT64' }
  ]);
  expect(result.hiddenBindings['{{hidden.01.var1}}']).toEqual({
    display_name: 'sample.xlsx',
    display_hint: 'C:/tmp/sample.xlsx'
  });
  expect(pageErrors).toEqual([]);
});

test('CSV取込assistantがbridge previewをnode formへ反映する', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));

  await page.route('**/static/js/bridge.js*', async (route) => {
    const body = withCatalogResponses(buildBridgeStubScript().replace(
      "if (type === 'preview.readExcel') {",
       "if (type === 'preview.readCsv') { return Promise.resolve({ ref:'{{hidden.01.var1}}', display_name:'sample.csv', display_hint:'C:/tmp/sample.csv', file_name:'sample.csv', encoding:String(payload?.encoding || 'utf-8'), delimiter:String(payload?.delimiter || ','), columns:['A','B'], rows2d:[[1,2],[3,4]], schema_rows2d:[[1,2],[3,4]], base_row:0, col_count:2 }); } if (type === 'preview.readExcel') {"
    ).replace(
      "display_name: 'sample.xlsx'",
      "display_name: 'sample.csv'"
    ).replace(
      "display_hint: 'C:/tmp/sample.xlsx'",
      "display_hint: 'C:/tmp/sample.csv'"
    ));
    await route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body });
  });

  const flow = workflowDocument({
    name: 'CSV input',
    connectorId: 'CSVConnector',
    actionId: 'read_csv',
    params: { file_path: '', encoding: 'utf8', delimiter: ',', header_row: 1, data_start_row: 2 }
  });
  const frame = await openWorkflow(page, flow, 'preview_probe_csv.zizd');
  const previewBtn = page.locator(
    '.workflow-property-icon-button[aria-label="ファイルを開く"]'
  );
  await expect(previewBtn).toBeVisible();
  await previewBtn.click();

  const dialog = page.getByRole('dialog', { name: 'CSV 取込設定' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'ファイルを選択' }).click();
  await dialog.getByLabel('区切り文字').selectOption('\t');
  await dialog.getByRole('button', { name: '確定' }).click();

  const result = await frame.evaluate(() => {
    const documentState = window.zizEmbeddedApi.getDocument();
    return {
      step: documentState.steps[0],
      hiddenBindings: window.zizEmbeddedApi.getPropertyContext().hidden_bindings
    };
  });
  const calls = await page.evaluate(() => window.__bridgeCalls || []);
  expect(calls.some((c) => c.type === 'file.pickFile')).toBeTruthy();
  expect(calls.some((c) => c.type === 'preview.readCsv')).toBeTruthy();
  expect(result.step.params.file_path).toBe('{{hidden.01.var1}}');
  expect(result.step.params.encoding).toBe('utf-8');
  expect(result.step.params.delimiter).toBe('\\t');
  expect(result.step.params.schema).toBeUndefined();
  expect(result.step.schema.columns).toEqual([
    { origin_name: '1', ziz_datatype: 'INT64' },
    { origin_name: '2', ziz_datatype: 'INT64' }
  ]);
  expect(result.hiddenBindings['{{hidden.01.var1}}']).toEqual({
    display_name: 'sample.csv',
    display_hint: 'C:/tmp/sample.csv'
  });
  expect(pageErrors).toEqual([]);
});
