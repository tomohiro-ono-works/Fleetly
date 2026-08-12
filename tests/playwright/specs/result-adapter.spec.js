const { test, expect } = require('@playwright/test');
const {
  buildCatalogBridgeStubScript,
  withCatalogResponses
} = require('../helpers/catalog-bridge-stub');

function buildRunBridgeStubScript() {
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
          if (type === 'run.start') {
            return Promise.resolve({
              accepted: true,
              run_id: 'run_flow_01',
              flow_id: '01',
              run_kind: 'flow',
              status: 'running'
            });
          }
          if (type === 'result.getPreview') {
            return Promise.resolve({
              run_id: payload.run_id,
              step_id: payload.step_id,
              columns: [],
              rows: [],
              row_count: 0,
              truncated: false
            });
          }
          if (type === 'app.getStatus') {
            return Promise.resolve({ gui_mode: 'webview', host: 'qt' });
          }
          if (type === 'workspace.getRoot') {
            return Promise.resolve({
              has_root: false,
              root_path: '',
              config_path: ''
            });
          }
          if (type === 'documents.list') {
            return Promise.resolve({ scope: 'local', kind: 'recent', items: [] });
          }
          return Promise.resolve({});
        }
      };
      window.zizPackages = window.zizPackages || {};
      window.zizPackages.core = window.zizPackages.core || {};
      window.zizPackages.core.bridge = bridgeApi;
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('ziz:bridge-ready'));
      }, 0);
    })();
  `;
}

test('result adapterがrun_idとstep_idを正規commandへ渡す', async ({ page }) => {
  await page.route('**/static/js/bridge.js*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: buildCatalogBridgeStubScript()
    });
  });

  await page.goto('/static/dataflow.html?mode=dataflow');
  await page.waitForFunction(() => !!window.zizPackages?.app?.results);

  const missingCode = await page.evaluate(async () => {
    const results = window.zizPackages.app.results;
    results.bindFlowRun({
      run_id: 'run_flow_01',
      step_ids: ['01', '02']
    });
    await results.getSummary({ run_id: 'run_flow_01' });
    await results.getSchema({ step_id: '01' });
    await results.getPreview({ step_id: '02' });

    results.bindStepRun({
      run_id: 'run_step_01',
      step_id: '01'
    });
    await results.getPreview({ step_id: '01' });
    await results.getLogs({
      run_id: 'run_step_01',
      after_seq: 9
    });

    results.clearRunBindings();
    try {
      await results.getSchema({ step_id: '01' });
    } catch (error) {
      return error?.code || '';
    }
    return '';
  });

  const calls = await page.evaluate(() => (
    (window.__catalogBridgeCalls || [])
      .filter((call) => String(call.type || '').startsWith('result.'))
  ));

  expect(calls).toEqual([
    {
      type: 'result.getSummary',
      payload: { run_id: 'run_flow_01' }
    },
    {
      type: 'result.getSchema',
      payload: { run_id: 'run_flow_01', step_id: '01' }
    },
    {
      type: 'result.getPreview',
      payload: { run_id: 'run_flow_01', step_id: '02' }
    },
    {
      type: 'result.getPreview',
      payload: { run_id: 'run_step_01', step_id: '01' }
    },
    {
      type: 'result.getLogs',
      payload: { run_id: 'run_step_01', after_seq: 9 }
    }
  ]);
  expect(missingCode).toBe('E_RESULT_NOT_FOUND');
});

test('flow実行受付後にappが各stepへrun_idを結び付ける', async ({ page }) => {
  await page.route('**/static/js/bridge.js*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: withCatalogResponses(buildRunBridgeStubScript())
    });
  });

  await page.goto('/static/dataflow.html?mode=dataflow&embedded=1');
  await page.waitForFunction(() => !!window.zizEmbeddedApi?.runFlow);

  const result = await page.evaluate(async () => {
    const stepId = '01';
    const accepted = await window.zizEmbeddedApi.runFlow();
    await window.zizPackages.app.results.getPreview({
      step_id: stepId
    });
    return {
      acceptedRunId: String(accepted?.run_id || ''),
      stepId,
      mappedRunId: window.zizPackages.app.results.getRunIdForStep(stepId)
    };
  });

  const calls = await page.evaluate(() => window.__bridgeCalls);
  const runStart = calls.find((call) => call.type === 'run.start');
  const preview = calls.find((call) => call.type === 'result.getPreview');

  expect(result.acceptedRunId).toBe('run_flow_01');
  expect(result.mappedRunId).toBe('run_flow_01');
  expect(runStart.payload).toEqual(expect.objectContaining({
    flow_id: '01',
    document: expect.objectContaining({
      metadata: expect.objectContaining({ mode: 'dataflow' })
    })
  }));
  expect(runStart.payload.doc_session_id).toMatch(/^docsession_/);
  expect(preview.payload).toEqual({
    run_id: 'run_flow_01',
    step_id: result.stepId
  });
});
