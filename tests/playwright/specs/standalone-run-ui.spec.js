const { test, expect } = require('@playwright/test');
const { withCatalogResponses } = require('../helpers/catalog-bridge-stub');

function buildBridgeStubScript() {
  return `
    (function () {
      const calls = [];
      const activeRuns = new Map();
      let runSequence = 0;
      window.__standaloneBridgeCalls = calls;

      function emit(type, payload) {
        window.dispatchEvent(new CustomEvent('ziz:evt', {
          detail: {
            v: '1',
            kind: 'evt',
            type,
            ts: new Date().toISOString(),
            payload
          }
        }));
      }

      function completeRun(runId, request) {
        if (!activeRuns.has(runId)) return;
        activeRuns.delete(runId);
        if (request.dry_run) {
          emit('run.completed', {
            run_id: runId,
            status: 'success',
            trace_id: 'trace_' + runId,
            dry_run: {
              strategy: request.connector_id === 'PythonConnector'
                ? 'python_static_validation'
                : 'query_validation',
              executed: false
            }
          });
          return;
        }
        if (request.result_mode === 'excel') {
          emit('run.completed', {
            run_id: runId,
            status: 'success',
            trace_id: 'trace_' + runId,
            export: {
              file_name: request.result_export?.params?.file_name || '',
              sheet_name: request.result_export?.params?.sheet_name || ''
            }
          });
          return;
        }
        if (request.connector_id === 'PythonConnector') {
          emit('run.completed', {
            run_id: runId,
            status: 'success',
            trace_id: 'trace_' + runId,
            text: '{"ok":true}'
          });
          return;
        }
        emit('run.completed', {
          run_id: runId,
          status: 'success',
          trace_id: 'trace_' + runId,
          preview: {
            columns: ['value', 'label'],
            rows: [[42, 'answer'], [7, 'sample']],
            row_count: 2,
            truncated: false
          }
        });
      }

      const files = {
        'query.sql': 'SELECT 1',
        'script.py': '# HOLD\\ndef main():\\n    return {"ok": True}'
      };
      const bridgeApi = {
        available() { return true; },
        status() { return { state: 'ready', ready: true }; },
        unavailableMessage() { return ''; },
        call(type, payload) {
          calls.push({ type: String(type || ''), payload: payload || {} });
          if (type === 'workspace.getRoot') {
            return Promise.resolve({
              has_root: true,
              root_path: 'C:/workspace',
              config_path: 'C:/workspace/config'
            });
          }
          if (type === 'workspace.list') {
            if (payload?.scope === 'config') {
              return Promise.resolve({ scope: 'config', entries: [] });
            }
            return Promise.resolve({
              scope: 'root',
              entries: Object.keys(files).map((name) => ({
                name,
                rel_path: name,
                kind: 'file',
                has_children: false,
                size: files[name].length,
                modified_at: Date.now()
              }))
            });
          }
          if (type === 'workspace.readText') {
            const relPath = String(payload?.rel_path || '');
            if (payload?.scope === 'config') {
              return Promise.resolve({
                scope: 'config',
                rel_path: relPath,
                file_name: relPath.split('/').pop(),
                content: relPath.endsWith('.json') ? '{}' : '',
                mtime_ns: '1',
                size: 2
              });
            }
            return Promise.resolve({
              scope: 'root',
              rel_path: relPath,
              file_name: relPath,
              content: files[relPath] || '',
              encoding: 'utf-8',
              mtime_ns: '100',
              size: (files[relPath] || '').length
            });
          }
          if (type === 'workspace.writeText') {
            files[String(payload?.rel_path || '')] = String(payload?.content || '');
            return Promise.resolve({
              saved: true,
              file_name: String(payload?.rel_path || ''),
              mtime_ns: '101',
              size: String(payload?.content || '').length
            });
          }
          if (type === 'workspace.stat') {
            const relPath = String(payload?.rel_path || '');
            return files[relPath] !== undefined
              ? Promise.resolve({
                  exists: true,
                  rel_path: relPath,
                  file_name: relPath,
                  mtime_ns: '101',
                  size: files[relPath].length
                })
              : Promise.reject({ code: 'E_NOT_FOUND', message: 'not found' });
          }
          if (type === 'documents.list') {
            return Promise.resolve({ items: [] });
          }
          if (type === 'documents.close') {
            return Promise.resolve({
              closed: true,
              doc_session_id: payload?.doc_session_id || ''
            });
          }
          if (type === 'app.getStatus') {
            return Promise.resolve({
              gui_mode: 'webview',
              host: 'qt',
              run_index: {
                workflows: [],
                standalone: [...activeRuns.entries()].map(([runId, item]) => ({
                  doc_session_id: item.request.doc_session_id,
                  run_id: runId,
                  status: item.status
                }))
              }
            });
          }
          if (type === 'app.getSuggestIndex') {
            return Promise.resolve({ entries: [], loaded: false });
          }
          if (type === 'app.logUiEvent') {
            return Promise.resolve({ logged: true });
          }
          if (type === 'run.start') {
            const runId = 'gui_std_' + (++runSequence);
            activeRuns.set(runId, { request: payload, status: 'queued' });
            window.setTimeout(() => {
              const active = activeRuns.get(runId);
              if (!active) return;
              active.status = 'running';
              emit('run.progress', {
                run_id: runId,
                stage: 'running',
                percent: null,
                message: '実行を開始しました。'
              });
              emit('run.log', {
                run_id: runId,
                log_seq: 1,
                ts: new Date().toISOString(),
                level: 'INFO',
                category: 'connector',
                message: 'connectorを実行しました。'
              });
              const source = JSON.stringify(payload.params || {});
              if (!source.includes('HOLD')) {
                window.setTimeout(() => completeRun(runId, payload), 15);
              }
            }, 5);
            return Promise.resolve({
              accepted: true,
              run_id: runId,
              trace_id: 'trace_' + runId,
              execution_source: 'gui',
              run_kind: 'standalone',
              doc_session_id: payload.doc_session_id,
              status: 'queued',
              started_at: new Date().toISOString()
            });
          }
          if (type === 'run.cancel') {
            const item = activeRuns.get(String(payload?.run_id || ''));
            if (!item) {
              return Promise.resolve({
                accepted: false,
                run_id: payload?.run_id || '',
                status: 'cancelled'
              });
            }
            window.setTimeout(() => {
              activeRuns.delete(String(payload.run_id));
              emit('run.cancelled', {
                run_id: payload.run_id,
                status: 'cancelled',
                trace_id: 'trace_' + payload.run_id
              });
            }, 10);
            return Promise.resolve({
              accepted: true,
              run_id: payload.run_id,
              status: 'cancel_requested'
            });
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

async function openExplorerFile(page, name) {
  const explorerButton = page.getByRole('button', { name: 'エクスプローラー' });
  if (await explorerButton.getAttribute('aria-pressed') !== 'true') {
    await explorerButton.click();
  }
  const file = page.locator('.workspace-tree-file', { hasText: name }).first();
  await expect(file).toBeVisible();
  await file.click();
  await expect(page.locator('.workspace-text-view:not([hidden])')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.route('**/static/js/bridge.js*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: withCatalogResponses(buildBridgeStubScript())
    });
  });
  await page.goto('/static/dataflow.html');
});

test('SQL documentからinline、dry run、保存済みfile、Excel出力を実行する', async ({ page }, testInfo) => {
  await openExplorerFile(page, 'query.sql');
  const view = page.locator('.workspace-text-view:not([hidden])');
  const editor = view.locator('.workspace-text-editor');
  const controls = view.locator('.standalone-controls');
  await expect(controls).toBeVisible();

  await editor.fill('SELECT 42');
  await controls.locator('button[data-action="run"]').click();
  await expect(view.locator('.standalone-result-table th').first()).toHaveText('value');
  await expect(view.locator('.standalone-result-table tbody tr')).toHaveCount(2);
  await expect(view.locator('.standalone-log-table tbody tr')).toHaveCount(1);
  await expect(view.locator('.standalone-result-table th').first()).toHaveCSS('position', 'sticky');

  let starts = await page.evaluate(() => (
    window.__standaloneBridgeCalls.filter((call) => call.type === 'run.start')
  ));
  expect(starts[0].payload).toMatchObject({
    run_kind: 'standalone',
    connector_id: 'BQConnector',
    action_id: 'execute_sql',
    result_mode: 'preview',
    dry_run: false,
    params: {
      project_id: 'defult_project1',
      sql: 'SELECT 42'
    }
  });

  await editor.press('Control+Shift+Enter');
  await expect.poll(async () => (
    page.evaluate(() => (
      window.__standaloneBridgeCalls
        .filter((call) => call.type === 'run.start')
        .at(-1)?.payload?.dry_run
    ))
  )).toBe(true);
  await expect(view.locator('.standalone-result-table td', { hasText: 'executed' })).toBeVisible();

  await controls.locator('.standalone-action-select').selectOption(
    'BQConnector::execute_sql_file'
  );
  await editor.fill('SELECT 99');
  const callCountBeforeFileError = await page.evaluate(() => (
    window.__standaloneBridgeCalls.filter((call) => call.type === 'run.start').length
  ));
  await controls.locator('button[data-action="run"]').click();
  await expect(view.locator('.standalone-result-message.is-error')).toContainText('先に保存');
  await expect.poll(async () => (
    page.evaluate(() => (
      window.__standaloneBridgeCalls.filter((call) => call.type === 'run.start').length
    ))
  )).toBe(callCountBeforeFileError);

  await view.locator('.workspace-text-actions > button[data-action="save"]').click();
  await controls.locator('button[data-action="run"]').click();
  await expect.poll(async () => (
    page.evaluate(() => (
      window.__standaloneBridgeCalls
        .filter((call) => call.type === 'run.start')
        .at(-1)?.payload?.action_id
    ))
  )).toBe('execute_sql_file');
  starts = await page.evaluate(() => (
    window.__standaloneBridgeCalls.filter((call) => call.type === 'run.start')
  ));
  expect(starts.at(-1).payload.params).toMatchObject({
    sql_file: 'C:/workspace/query.sql',
    encoding: 'utf8'
  });
  expect(starts.at(-1).payload.params.sql).toBeUndefined();

  await expect(controls.locator('button[data-action="run"]')).toBeEnabled();
  await controls.locator('.standalone-action-select').selectOption(
    'BQConnector::execute_sql'
  );
  await controls.locator('.standalone-export-toggle input').check();
  const exportSection = view.locator('.standalone-params-panel > section').nth(1);
  const outputFolder = exportSection
    .locator('.standalone-param-form .row')
    .first()
    .locator('input[type="text"]');
  await outputFolder.fill('C:/exports');
  await controls.locator('button[data-action="run"]').click();
  await expect(view.locator('.standalone-result-table td', { hasText: 'output.xlsx' })).toBeVisible();
  starts = await page.evaluate(() => (
    window.__standaloneBridgeCalls.filter((call) => call.type === 'run.start')
  ));
  expect(starts.at(-1).payload.result_mode).toBe('excel');
  expect(starts.at(-1).payload.dry_run).toBe(false);
  expect(starts.at(-1).payload.result_export).toMatchObject({
    connector_id: 'ExcelConnector',
    action_id: 'write_excel',
    params: {
      output_folder: 'C:/exports',
      file_name: 'output.xlsx',
      sheet_name: 'シート1',
      mode: 'create_or_replace'
    }
  });
  expect(starts.at(-1).payload.result_export.params.input_data).toBeUndefined();

  const screenshotPath = testInfo.outputPath('standalone-desktop.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach('standalone desktop', {
    path: screenshotPath,
    contentType: 'image/png'
  });
});

test('Python documentのactive runをcancel完了後にcloseする', async ({ page }) => {
  await openExplorerFile(page, 'script.py');
  const view = page.locator('.workspace-text-view:not([hidden])');
  const controls = view.locator('.standalone-controls');
  await expect(controls.locator('.standalone-connector-select')).toBeHidden();
  await expect(controls.locator('.standalone-action-select')).toBeHidden();

  await controls.locator('button[data-action="run"]').click();
  await expect(controls.locator('button[data-action="cancel"]')).toBeVisible();
  await expect(page.locator('.workspace-tab.is-active .workspace-tab__title')).toContainText('実行中');

  await page.locator('.workspace-tab.is-active .workspace-tab__close').click();
  await expect(page.getByRole('button', {
    name: '実行をキャンセルして閉じる'
  })).toBeVisible();
  await page.getByRole('button', {
    name: '実行をキャンセルして閉じる'
  }).click();

  await expect(page.getByRole('button', { name: /script/ })).toHaveCount(0);
  const calls = await page.evaluate(() => window.__standaloneBridgeCalls);
  const start = calls.find((call) => call.type === 'run.start');
  expect(start.payload).toMatchObject({
    connector_id: 'PythonConnector',
    action_id: 'execute_python',
    result_mode: 'preview',
    params: {
      script: '# HOLD\ndef main():\n    return {"ok": True}'
    }
  });
  expect(calls.some((call) => call.type === 'run.cancel')).toBeTruthy();
  expect(calls.some((call) => (
    call.type === 'documents.close'
    && call.payload.doc_session_id === start.payload.doc_session_id
  ))).toBeTruthy();
});

test('compact Windows幅でもstandalone controlsとresultがworkspace内に収まる', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 900, height: 640 });
  await openExplorerFile(page, 'query.sql');
  await page.getByRole('button', { name: 'エクスプローラー' }).click();
  const view = page.locator('.workspace-text-view:not([hidden])');
  const controls = view.locator('.standalone-controls');
  await expect(controls).toBeVisible();

  const editor = view.locator('.workspace-text-editor');
  await editor.fill('SELECT 42');
  await controls.locator('button[data-action="run"]').click();
  await expect(view.locator('.standalone-result-table tbody tr')).toHaveCount(2);

  const geometry = await view.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const controlsRect = element.querySelector('.standalone-controls')
      ?.getBoundingClientRect();
    const resultRect = element.querySelector('.standalone-result-panel')
      ?.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      viewLeft: rect.left,
      viewRight: rect.right,
      controlsLeft: controlsRect?.left || 0,
      controlsRight: controlsRect?.right || 0,
      resultLeft: resultRect?.left || 0,
      resultRight: resultRect?.right || 0
    };
  });
  expect(geometry.viewLeft).toBeGreaterThanOrEqual(0);
  expect(geometry.viewRight).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.controlsLeft).toBeGreaterThanOrEqual(geometry.viewLeft);
  expect(geometry.controlsRight).toBeLessThanOrEqual(geometry.viewRight);
  expect(geometry.resultLeft).toBeGreaterThanOrEqual(geometry.viewLeft);
  expect(geometry.resultRight).toBeLessThanOrEqual(geometry.viewRight);

  const screenshotPath = testInfo.outputPath('standalone-compact.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach('standalone compact', {
    path: screenshotPath,
    contentType: 'image/png'
  });
});
