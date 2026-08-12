const { test, expect } = require('@playwright/test');

test('workspaceとdocuments adapterがBridgeClientへ正規commandを送る', async ({ page }) => {
  await page.route('**/static/js/bridge.js*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: `
        (function () {
          const calls = [];
          window.__bridgeCalls = calls;
          const bridgeApi = {
            available() { return true; },
            status() { return { state: 'ready', ready: true }; },
            unavailableMessage() { return ''; },
            call(type, payload) {
              calls.push({ type, payload: payload || {} });
              if (type === 'workspace.getRoot') {
                return Promise.resolve({ has_root: false, root_path: '', config_path: 'C:/app/config' });
              }
              if (type === 'workspace.readText') {
                return Promise.reject({ code: 'E_NOT_FOUND', message: 'not found' });
              }
              if (type === 'documents.list') {
                return Promise.resolve({ scope: 'local', kind: payload?.kind || 'recent', items: [] });
              }
              if (type === 'documents.load') {
                return Promise.resolve({
                  selected: true,
                  mode: 'dataflow',
                  file_name: 'sample.zizd',
                  document_ref: 'docref_01',
                  document: { metadata: { mode: 'dataflow' }, steps: [], flows: {} },
                  hidden_bindings: {}
                });
              }
              if (type === 'documents.save') {
                return Promise.resolve({
                  saved: true,
                  file_name: payload.file_name,
                  document_ref: payload.document_ref
                });
              }
              if (type === 'documents.close') {
                return Promise.resolve({ closed: true, doc_session_id: payload.doc_session_id });
              }
              return Promise.resolve(payload || {});
            }
          };
          window.zizPackages = window.zizPackages || {};
          window.zizPackages.core = window.zizPackages.core || {};
          window.zizPackages.core.bridge = bridgeApi;
        })();
      `
    });
  });

  await page.goto('/static/home.html');
  await page.waitForFunction(() => !!window.zizPackages?.app?.documents);

  await page.evaluate(async () => {
    const workspace = window.zizPackages.app.workspace;
    const documents = window.zizPackages.app.documents;
    await workspace.writeText({
      scope: 'root',
      rel_path: 'sample.sql',
      content: 'select 1',
      force: false
    });
    const loaded = await documents.load({
      doc_session_id: 'docsession_test',
      scope: 'root',
      rel_path: 'sample.zizd'
    });
    await documents.save({
      doc_session_id: 'docsession_test',
      document_ref: loaded.document_ref,
      mode: loaded.mode,
      file_name: loaded.file_name,
      scope: 'root',
      rel_path: loaded.file_name,
      document: loaded.document
    });
    await documents.close({ doc_session_id: 'docsession_test' });
  });

  const calls = await page.evaluate(() => window.__bridgeCalls);
  expect(calls).toEqual(expect.arrayContaining([
    expect.objectContaining({
      type: 'workspace.writeText',
      payload: expect.objectContaining({ rel_path: 'sample.sql' })
    }),
    expect.objectContaining({
      type: 'documents.load',
      payload: expect.objectContaining({ doc_session_id: 'docsession_test' })
    }),
    expect.objectContaining({
      type: 'documents.save',
      payload: expect.objectContaining({
        doc_session_id: 'docsession_test',
        document_ref: 'docref_01'
      })
    }),
    expect.objectContaining({
      type: 'documents.close',
      payload: { doc_session_id: 'docsession_test' }
    })
  ]));
  expect(calls.some((call) => /^flow\.(list|load|save|tabClosed)$/.test(call.type))).toBeFalsy();
});
