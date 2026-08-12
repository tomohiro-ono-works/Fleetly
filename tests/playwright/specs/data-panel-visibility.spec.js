const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { clickClassicStep, waitForClassicStep } = require('../helpers/classic-workflow');

function buildBridgeStubScript() {
  return `
    (function () {
      const bridgeApi = {
        available() { return true; },
        call(type, payload) {
          if (type === 'app.getStatus') return Promise.resolve({
            gui_mode: 'webview',
            host: 'qt',
            run_index: { workflows: [], standalone: [] }
          });
          if (type === 'catalog.getConnectors') return Promise.resolve({
            version: 1,
            app_modes: [{
              mode_id: 'dataflow',
              label: 'データフロー',
              default_flow_name: 'データフロー１',
              file_extension: '.zizd',
              node_defaults: {
                initial_connector_id: 'ExcelConnector',
                initial_action_id: 'read_excel'
              },
              connector_ids: ['ExcelConnector', 'BQConnector']
            }],
            connectors: [{
              connector_id: 'ExcelConnector',
              label: 'Excel',
              category: 'data',
              icon: '',
              actions: ['read_excel', 'write_excel']
            }, {
              connector_id: 'BQConnector',
              label: 'BigQuery',
              category: 'data',
              icon: '',
              actions: ['load_data']
            }]
          });
          if (type === 'catalog.getActions') return Promise.resolve({
            actions: [{
              connector_id: 'ExcelConnector',
              action_id: 'read_excel',
              label: '読み込み',
              category: 'data',
              subcategory: 'input',
              node_type: 'task',
              form_schema_id: 'ExcelConnector.read_excel',
              data_area_policy_id: 'data.input',
              security_profile_id: 'connector.read_path',
              result_contract: { kind: 'data_body' }
            }, {
              connector_id: 'ExcelConnector',
              action_id: 'write_excel',
              label: '書き込み',
              category: 'data',
              subcategory: 'output',
              node_type: 'task',
              form_schema_id: 'ExcelConnector.write_excel',
              data_area_policy_id: 'data.output',
              security_profile_id: 'connector.write',
              result_contract: { kind: 'execution_metadata' }
            }, {
              connector_id: 'BQConnector',
              action_id: 'load_data',
              label: 'データロード',
              category: 'data',
              subcategory: 'output',
              node_type: 'task',
              form_schema_id: 'BQConnector.load_data',
              data_area_policy_id: 'data.output',
              security_profile_id: 'connector.write',
              result_contract: { kind: 'execution_metadata' }
            }]
          });
          if (type === 'catalog.getForms') return Promise.resolve({
            forms: [
              { form_schema_id: 'ExcelConnector.read_excel', fields: [] },
              { form_schema_id: 'ExcelConnector.write_excel', fields: [] },
              { form_schema_id: 'BQConnector.load_data', fields: [] }
            ]
          });
          if (type === 'catalog.getDataAreaPolicy') return Promise.resolve({
            policies: [{
              data_area_policy_id: 'data.input',
              schema: 'no_rename',
              schema_json: 'no_rename',
              data_output: 'data_body',
              log: 'common'
            }, {
              data_area_policy_id: 'data.output',
              schema: 'editable',
              schema_json: 'editable',
              data_output: 'execution_metadata',
              log: 'common'
            }],
            execution_metadata_columns: ['job_id', 'target', 'path', 'executed_at']
          });
          if (type === 'catalog.getSecurityPolicySummary') {
            return Promise.resolve({ profiles: [] });
          }
          if (type === 'result.invalidateSteps') {
            return Promise.resolve({
              doc_session_id: payload?.doc_session_id || '',
              invalidated_step_ids: payload?.step_ids || []
            });
          }
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

async function setupBridgeStub(page) {
  await page.route('**/static/js/bridge.js*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: buildBridgeStubScript()
    });
  });
}

async function openDataflow(page) {
  await page.goto('/static/dataflow.html?mode=dataflow&embedded=1');
  await waitForClassicStep(page, '01');
}

async function selectFirstNode(page) {
  await clickClassicStep(page, '01');
  await expect(page.locator('.workflow-data-area')).toBeVisible();
}

async function collectDataPanelMetrics(page) {
  return await page.evaluate(() => {
    const bottomRoot = document.querySelector('#nodeDetailBottom');
    const activePane = bottomRoot?.querySelector('.workflow-data-pane:not([hidden])') || null;
    const schemaEditor = bottomRoot?.querySelector('.workflow-schema-table') || null;
    const schemaFormPane = bottomRoot?.querySelector('[data-pane="schema"]') || null;
    const schemaJsonPane = bottomRoot?.querySelector('[data-pane="schema-json"]') || null;
    const schemaOutputPane = bottomRoot?.querySelector('[data-pane="output"]') || null;
    const statusNote = bottomRoot?.querySelector('.workflow-data-status') || null;
    const rowCount = bottomRoot?.querySelectorAll('.workflow-schema-table tbody tr')?.length || 0;
    return {
      hasActivePane: !!activePane,
      hasSchemaEditor: !!schemaEditor,
      schemaFormVisible: !!schemaFormPane && !schemaFormPane.classList.contains('is-hidden'),
      schemaJsonVisible: !!schemaJsonPane && !schemaJsonPane.classList.contains('is-hidden'),
      schemaOutputVisible: !!schemaOutputPane && !schemaOutputPane.classList.contains('is-hidden'),
      schemaRowCount: rowCount,
      statusText: String(statusNote?.textContent || '').trim(),
      schemaHeadings: Array.from(
        bottomRoot?.querySelectorAll('.workflow-schema-table th') || []
      ).map((cell) => String(cell.textContent || '').trim())
    };
  });
}

async function captureEvidence(page, suffix) {
  const evidenceDir = path.join(process.cwd(), 'results', 'manual');
  fs.mkdirSync(evidenceDir, { recursive: true });
  await page.screenshot({
    path: path.join(evidenceDir, `data-panel-${suffix}-full.png`),
    fullPage: true
  });
  await page.locator('.workflow-data-area').screenshot({
    path: path.join(evidenceDir, `data-panel-${suffix}-panel.png`)
  });
}

test('中央下部データエリアの表示状態を採取する', async ({ page }) => {
  await setupBridgeStub(page);
  await openDataflow(page);
  await selectFirstNode(page);
  const metrics = await collectDataPanelMetrics(page);

  console.log('data-panel-visibility', JSON.stringify(metrics));
  expect(metrics.hasActivePane).toBeTruthy();
  expect(metrics.hasSchemaEditor).toBeTruthy();
  expect(metrics.schemaFormVisible).toBeTruthy();

  const evidenceDir = path.join(process.cwd(), 'results', 'manual');
  fs.mkdirSync(evidenceDir, { recursive: true });
  await page.screenshot({
    path: path.join(evidenceDir, 'data-panel-visibility-full.png'),
    fullPage: true
  });
  await page.locator('.workflow-data-area').screenshot({
    path: path.join(evidenceDir, 'data-panel-visibility-panel.png')
  });
});

test('Excel読み込み/Excel書き込み/BigQueryテーブル出力で下部データエリア表示を確認する', async ({ page }) => {
  await setupBridgeStub(page);
  await openDataflow(page);

  const scenarios = [
    {
      key: 'excel-read',
      connector: 'ExcelConnector',
      action: 'read_excel',
      headingCount: 4
    },
    {
      key: 'excel-write',
      connector: 'ExcelConnector',
      action: 'write_excel',
      headingCount: 5
    },
    {
      key: 'bigquery-table-output',
      connector: 'BQConnector',
      action: 'load_data',
      headingCount: 5
    }
  ];

  await page.waitForFunction(() => !!window.zizEmbeddedApi);
  await selectFirstNode(page);
  for (const scenario of scenarios) {
    await page.evaluate(({ connector, action }) => (
      window.zizEmbeddedApi.updateStep({
        step_id: '01',
        changes: {
          connector_id: connector,
          action_id: action,
          params: null
        }
      })
    ), scenario);
    const metrics = await collectDataPanelMetrics(page);
    console.log(`data-panel-${scenario.key}`, JSON.stringify(metrics));
    await captureEvidence(page, scenario.key);

    expect(metrics.hasActivePane).toBeTruthy();
    expect(metrics.hasSchemaEditor).toBeTruthy();
    expect(metrics.schemaFormVisible).toBeTruthy();
    expect(metrics.schemaHeadings).toHaveLength(scenario.headingCount);
  }
});
