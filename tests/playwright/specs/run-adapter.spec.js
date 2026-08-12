const { test, expect } = require('@playwright/test');
const {
  buildCatalogBridgeStubScript
} = require('../helpers/catalog-bridge-stub');

test('run adapterがworkflow、step、standaloneを正規commandへ渡す', async ({ page }) => {
  await page.route('**/static/js/bridge.js*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: buildCatalogBridgeStubScript()
    });
  });

  await page.goto('/static/dataflow.html?mode=dataflow');
  await page.waitForFunction(() => !!window.zizPackages?.app?.runs);
  await page.evaluate(() => {
    window.__catalogBridgeCalls.length = 0;
  });

  const document = {
    version: 1,
    metadata: { name: 'adapter-test' },
    flows: {}
  };
  const validationCode = await page.evaluate(async (sampleDocument) => {
    const runs = window.zizPackages.app.runs;
    await runs.startWorkflow({
      doc_session_id: 'doc_01',
      mode: 'dataflow',
      document_ref: 'docref_01',
      flow_id: '01',
      document: sampleDocument
    });
    await runs.startStep({
      doc_session_id: 'doc_01',
      flow_id: '01',
      step_id: '02',
      document: sampleDocument
    });
    await runs.startStandalone({
      doc_session_id: 'sql_01',
      connector_id: 'BQConnector',
      action_id: 'execute_sql',
      result_mode: 'preview',
      dry_run: true,
      params: { sql: 'SELECT 1' }
    });
    await runs.startStandalone({
      doc_session_id: 'sql_02',
      connector_id: 'PythonConnector',
      action_id: 'execute_python',
      result_mode: 'excel',
      params: { script: 'def main(): return []' },
      result_export: {
        connector_id: 'ExcelConnector',
        action_id: 'write_excel',
        params: { output_path: 'result.xlsx' }
      }
    });
    await runs.cancel({ run_id: 'gui_flw_01' });
    await runs.getStatus();

    try {
      await runs.startStep({
        doc_session_id: 'doc_01',
        flow_id: '01',
        document: sampleDocument
      });
    } catch (error) {
      return String(error?.code || '');
    }
    return '';
  }, document);

  const calls = await page.evaluate(() => (
    (window.__catalogBridgeCalls || [])
      .filter((call) => (
        call.type === 'run.start'
        || call.type === 'run.cancel'
        || call.type === 'app.getStatus'
      ))
  ));

  expect(calls).toEqual([
    {
      type: 'run.start',
      payload: {
        doc_session_id: 'doc_01',
        flow_id: '01',
        document,
        mode: 'dataflow',
        document_ref: 'docref_01'
      }
    },
    {
      type: 'run.start',
      payload: {
        doc_session_id: 'doc_01',
        flow_id: '01',
        document,
        step_id: '02'
      }
    },
    {
      type: 'run.start',
      payload: {
        doc_session_id: 'sql_01',
        run_kind: 'standalone',
        connector_id: 'BQConnector',
        action_id: 'execute_sql',
        result_mode: 'preview',
        dry_run: true,
        params: { sql: 'SELECT 1' }
      }
    },
    {
      type: 'run.start',
      payload: {
        doc_session_id: 'sql_02',
        run_kind: 'standalone',
        connector_id: 'PythonConnector',
        action_id: 'execute_python',
        result_mode: 'excel',
        dry_run: false,
        params: { script: 'def main(): return []' },
        result_export: {
          connector_id: 'ExcelConnector',
          action_id: 'write_excel',
          params: { output_path: 'result.xlsx' }
        }
      }
    },
    {
      type: 'run.cancel',
      payload: { run_id: 'gui_flw_01' }
    },
    {
      type: 'app.getStatus',
      payload: {}
    }
  ]);
  expect(validationCode).toBe('E_VALIDATION');
});
