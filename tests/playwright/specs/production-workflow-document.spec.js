const { test, expect } = require("@playwright/test");

function workflowDocument() {
  return {
    metadata: {
      mode: "dataflow",
      name: "Production document",
      default_flow_id: "01",
    },
    steps: [{
      step_id: "01",
      flow_id: "01",
      label: "Define values",
      connector_id: "WindowsConnector",
      action_id: "define_values",
      ui_position: { x: 320, y: 220 },
    }],
    flows: {
      "01": {
        label: "Main flow",
        start: {
          ui_position: { x: 80, y: 220 },
          variables: [],
        },
        end: {
          ui_position: { x: 660, y: 220 },
        },
        edges: [
          { from: "START", to: "01", order: 1 },
          { from: "01", to: "END", order: 1 },
        ],
      },
    },
    notes: [],
  };
}

function csvWorkflowDocument() {
  const document = workflowDocument();
  document.steps[0] = {
    ...document.steps[0],
    label: "CSV input",
    connector_id: "CSVConnector",
    action_id: "read_csv",
    params: { encoding: "utf-8" },
  };
  return document;
}

async function clickClassicStep(target, stepId) {
  await expect.poll(() => target.evaluate((targetStepId) => (
    window.zizEmbeddedApi.getDocument().steps.some(
      (item) => item.step_id === targetStepId
    )
  ), stepId)).toBe(true);
  await target.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  const position = await target.evaluate((targetStepId) => {
    const workflow = window.zizEmbeddedApi.getDocument();
    const step = workflow.steps.find(
      (item) => item.step_id === targetStepId
    );
    if (!step) throw new Error(`Step not found: ${targetStepId}`);
    const canvas = document.querySelector(".zcwd-canvas");
    const x = Number(canvas.dataset.viewportX || 0);
    const y = Number(canvas.dataset.viewportY || 0);
    const zoom = Number(canvas.dataset.viewportZoom || 1);
    return {
      x: x + (step.ui_position.x + 32) * zoom,
      y: y + (step.ui_position.y + 32) * zoom
    };
  }, stepId);
  await target.locator(".zcwd-canvas").click({ position });
}

async function installQWebChannelMock(page, documentState, options = {}) {
  await page.addInitScript((setup) => {
    const initialDocument = setup.initialDocument;
    const runDelayMs = Number(setup.runDelayMs || 20);
    const signalListeners = [];
    const requests = [];
    let activeRunId = "";
    let runTimer = 0;
    const clone = (value) => JSON.parse(JSON.stringify(value));
    const catalog = {
      "catalog.getConnectors": {
        version: 1,
        app_modes: [{
          mode_id: "dataflow",
          label: "データフロー",
          default_flow_name: "データフロー１",
          file_extension: ".zizd",
          node_defaults: {
            initial_connector_id: "WindowsConnector",
            initial_action_id: "define_values",
          },
          connector_ids: ["WindowsConnector", "CSVConnector"],
        }],
        connectors: [{
          connector_id: "WindowsConnector",
          label: "Windows",
          export_id: "",
          category: "workflow",
          icon: "",
          actions: ["define_values"],
        }, {
          connector_id: "CSVConnector",
          label: "CSV",
          export_id: "",
          category: "data",
          icon: "",
          actions: ["read_csv"],
        }],
      },
      "catalog.getActions": {
        actions: [{
          connector_id: "WindowsConnector",
          action_id: "define_values",
          label: "変数定義",
          category: "workflow",
          subcategory: "control",
          node_type: "task",
          form_schema_id: "WindowsConnector.define_values",
          data_area_policy_id: "workflow.control",
          security_profile_id: "connector.execute",
          result_contract: { kind: "execution_metadata" },
        }, {
          connector_id: "CSVConnector",
          action_id: "read_csv",
          label: "読み込み",
          category: "data",
          subcategory: "input",
          node_type: "task",
          form_schema_id: "CSVConnector.read_csv",
          data_area_policy_id: "data.input",
          security_profile_id: "connector.read_path",
          result_contract: { kind: "data_body" },
        }],
      },
      "catalog.getForms": {
        forms: [{
          form_schema_id: "WindowsConnector.define_values",
          fields: [],
        }, {
          form_schema_id: "CSVConnector.read_csv",
          fields: [{
            key: "encoding",
            label: "文字コード",
            kind: "combo",
            required: true,
            options: ["utf-8", "shift_jis"],
          }],
        }],
      },
      "catalog.getDataAreaPolicy": {
        policies: [{
          data_area_policy_id: "workflow.control",
          schema: "readonly",
          schema_json: "readonly",
          data_output: "execution_metadata",
          log: "common",
        }, {
          data_area_policy_id: "data.input",
          schema: "no_rename",
          schema_json: "no_rename",
          data_output: "data_body",
          log: "common",
        }],
        execution_metadata_columns: ["job_id", "target", "path", "executed_at"],
      },
      "catalog.getSecurityPolicySummary": {
        profiles: [],
      },
    };

    function emit(message) {
      const raw = JSON.stringify(message);
      signalListeners.forEach((listener) => listener(raw));
    }

    function respond(envelope, data) {
      queueMicrotask(() => emit({
        v: "1",
        kind: "res",
        id: envelope.id,
        ts: new Date().toISOString(),
        ok: true,
        data,
        trace_id: `trace_${envelope.id}`,
      }));
    }

    const backendBridge = {
      messageToFrontend: {
        connect(listener) {
          signalListeners.push(listener);
        },
      },
      postMessage(raw) {
        const envelope = JSON.parse(raw);
        requests.push(clone(envelope));
        if (catalog[envelope.type]) {
          respond(envelope, clone(catalog[envelope.type]));
          return;
        }
        if (envelope.type === "documents.load") {
          respond(envelope, {
            selected: true,
            mode: "dataflow",
            file_name: "production.zizd",
            document_ref: "docref_01",
            document: clone(initialDocument),
            hidden_bindings: {},
            mtime_ns: "100",
          });
          return;
        }
        if (envelope.type === "documents.save") {
          respond(envelope, {
            saved: true,
            file_name: "production.zizd",
            document_ref: "docref_01",
            mtime_ns: "200",
          });
          return;
        }
        if (envelope.type === "run.start") {
          const stepId = String(envelope.payload.step_id || "");
          const runId = stepId ? "gui_stp_test" : "gui_flw_test";
          activeRunId = runId;
          respond(envelope, {
            accepted: true,
            run_id: runId,
            trace_id: "trace_run",
            execution_source: "gui",
            run_kind: stepId ? "step" : "flow",
            doc_session_id: envelope.payload.doc_session_id,
            flow_id: envelope.payload.flow_id,
            ...(stepId ? { step_id: stepId } : {}),
            status: "running",
            started_at: new Date().toISOString(),
          });
          runTimer = setTimeout(() => {
            emit({
              v: "1",
              kind: "evt",
              type: "run.log",
              ts: new Date().toISOString(),
              payload: {
                run_id: runId,
                log_seq: 1,
                level: "INFO",
                category: "step",
                step_id: stepId || "01",
                message: "step completed",
              },
            });
            emit({
              v: "1",
              kind: "evt",
              type: "run.stepStatus",
              ts: new Date().toISOString(),
              payload: {
                run_id: runId,
                step_id: stepId || "01",
                status: "success",
              },
            });
            emit({
              v: "1",
              kind: "evt",
              type: "run.completed",
              ts: new Date().toISOString(),
              payload: { run_id: runId, status: "success" },
            });
          }, runDelayMs);
          return;
        }
        if (envelope.type === "result.getSchema") {
          respond(envelope, {
            run_id: envelope.payload.run_id,
            step_id: envelope.payload.step_id,
            columns: [
              { origin_name: "id", ziz_datatype: "INT64" },
              { origin_name: "name", ziz_datatype: "STRING" },
            ],
          });
          return;
        }
        if (envelope.type === "result.getPreview") {
          respond(envelope, {
            run_id: envelope.payload.run_id,
            step_id: envelope.payload.step_id,
            columns: ["id", "name"],
            rows: [[1, "alpha"], [2, "beta"]],
            row_count: 2,
            truncated: false,
          });
          return;
        }
        if (envelope.type === "result.getLogs") {
          respond(envelope, {
            run_id: envelope.payload.run_id,
            items: [{
              run_id: envelope.payload.run_id,
              log_seq: 1,
              ts: "2026-07-29T10:00:00Z",
              level: "INFO",
              category: "step",
              step_id: "01",
              message: "step completed",
            }],
            has_more_before: false,
          });
          return;
        }
        if (envelope.type === "result.invalidateSteps") {
          respond(envelope, {
            doc_session_id: envelope.payload.doc_session_id,
            invalidated_step_ids: clone(envelope.payload.step_ids),
            removed_run_ids: [],
          });
          return;
        }
        if (envelope.type === "app.getStatus") {
          respond(envelope, {
            run_index: { workflows: [], standalone: [] },
          });
          return;
        }
        if (envelope.type === "run.cancel") {
          if (runTimer) clearTimeout(runTimer);
          respond(envelope, {
            accepted: true,
            run_id: activeRunId,
            status: "cancel_requested",
          });
          setTimeout(() => emit({
            v: "1",
            kind: "evt",
            type: "run.cancelled",
            ts: new Date().toISOString(),
            payload: { run_id: activeRunId, status: "cancelled" },
          }), 20);
          return;
        }
        respond(envelope, {});
      },
    };
    window.qt = { webChannelTransport: {} };
    window.QWebChannel = function QWebChannel(_transport, callback) {
      callback({ objects: { backendBridge } });
    };
    window.__workflowBridgeMock = {
      requests,
      emit,
    };
  }, {
    initialDocument: documentState,
    runDelayMs: options.runDelayMs,
  });
}

test("production dataflow uses the 202607 document store for load save and run", async ({ page }) => {
  await installQWebChannelMock(page, workflowDocument());
  await page.goto(
    "/static/dataflow.html?embedded=1&open_scope=root&open_rel_path=production.zizd"
  );
  await page.waitForFunction(() => !!window.zizEmbeddedApi);

  await expect(page.locator("[data-classic-workflow-designer]")).toBeVisible();
  await expect(page.locator(".zcwd-canvas")).toBeVisible();
  const loaded = await page.evaluate(() => window.zizEmbeddedApi.getDocument());
  expect(loaded).toEqual(workflowDocument());

  await page.evaluate(() => window.zizEmbeddedApi.addFlow());
  await expect.poll(async () => page.evaluate(
    () => Object.keys(window.zizEmbeddedApi.getDocument().flows)
  )).toEqual(["01", "02"]);
  expect(await page.evaluate(() => window.zizEmbeddedApi.isDirty())).toBe(true);

  await page.evaluate(() => window.zizEmbeddedApi.undo());
  expect(await page.evaluate(
    () => Object.keys(window.zizEmbeddedApi.getDocument().flows)
  )).toEqual(["01"]);

  await page.evaluate(() => window.zizEmbeddedApi.setFlowName("Updated"));
  await page.evaluate(() => window.zizEmbeddedApi.saveFlow());
  expect(await page.evaluate(() => window.zizEmbeddedApi.isDirty())).toBe(false);
  await page.evaluate(() => window.zizEmbeddedApi.runFlow());
  await expect.poll(async () => page.evaluate(
    () => window.zizEmbeddedApi.isRunning()
  )).toBe(false);

  const requests = await page.evaluate(() => window.__workflowBridgeMock.requests);
  const save = requests.find((request) => request.type === "documents.save");
  const run = requests.find((request) => request.type === "run.start");
  expect(save.payload.document.metadata.name).toBe("Updated");
  expect(save.payload.document.flows["01"].edges).toHaveLength(2);
  expect(save.payload.document.steps[0].connector).toBeUndefined();
  expect(run.payload.document).toEqual(save.payload.document);
  expect(run.payload.flow_id).toBe("01");

  const resources = await page.evaluate(() => performance
    .getEntriesByType("resource")
    .map((entry) => entry.name));
  expect(resources.some((url) => url.endsWith("/js/state.js"))).toBe(false);
  expect(resources.some((url) => url.includes("/js/ui.node.canvas"))).toBe(false);
  expect(resources.some((url) => url.includes("/js/app.js"))).toBe(false);
});

test("workspace opens a pending document and routes AppShell commands to its frame", async ({ page }, testInfo) => {
  const documentState = workflowDocument();
  await page.addInitScript((pendingDocument) => {
    if (window.top !== window) return;
    window.sessionStorage.setItem("ziz.pendingFlow.v1", JSON.stringify({
      selected: true,
      mode: "dataflow",
      file_name: "pending.zizd",
      document_ref: "docref_pending",
      doc_session_id: "docsession_pending",
      document: pendingDocument,
      hidden_bindings: {},
      mtime_ns: "300",
    }));
  }, documentState);
  await installQWebChannelMock(page, documentState);
  await page.goto("/static/dataflow.html");

  const frameElement = page.locator(".workspace-flow-frame");
  await expect(frameElement).toBeVisible();
  const frame = page.frames().find(
    (item) => item !== page.mainFrame() &&
      item.url().includes("/static/dataflow.html")
  );
  await expect.poll(async () => frame?.evaluate(
    () => !!window.zizEmbeddedApi
  )).toBe(true);
  await expect(frame.locator(".zcwd-canvas")).toBeVisible();

  await page.locator('[data-command-id="flow.add"]').click();
  await expect.poll(async () => frame.evaluate(
    () => Object.keys(window.zizEmbeddedApi.getDocument().flows)
  )).toEqual(["01", "02"]);

  await expect(page.locator("#flowName")).toBeVisible();
  await expect(page.locator("#flowName")).toHaveValue("Production document");
  await page.screenshot({
    path: testInfo.outputPath("production-workflow-desktop.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(frameElement).toBeVisible();
  expect(await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1
  )).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("production-workflow-mobile.png"),
    fullPage: true,
  });
});

test("property editing and result tabs share the active workflow document", async ({ page }, testInfo) => {
  const documentState = csvWorkflowDocument();
  await page.addInitScript((pendingDocument) => {
    if (window.top !== window) return;
    window.sessionStorage.setItem("ziz.pendingFlow.v1", JSON.stringify({
      selected: true,
      mode: "dataflow",
      file_name: "csv-input.zizd",
      document_ref: "docref_csv",
      doc_session_id: "docsession_csv",
      document: pendingDocument,
      hidden_bindings: {},
      mtime_ns: "400",
    }));
  }, documentState);
  await installQWebChannelMock(page, documentState);
  await page.goto("/static/dataflow.html");
  const frame = page.frames().find(
    (item) => item !== page.mainFrame() &&
      item.url().includes("/static/dataflow.html")
  );
  await expect.poll(async () => frame?.evaluate(
    () => !!window.zizEmbeddedApi
  )).toBe(true);

  await clickClassicStep(frame, "01");
  await expect(page.locator(".workflow-property-heading"))
    .toContainText("CSV input");
  const encoding = page.locator(
    '#nodeDetail .workflow-property-fields input.combo-input'
  );
  await encoding.fill("shift_jis");
  await encoding.press("Tab");
  await expect.poll(async () => frame.evaluate(
    () => window.zizEmbeddedApi.getDocument().steps[0].params.encoding
  )).toBe("shift_jis");
  await expect.poll(async () => frame.evaluate(
    () => window.__workflowBridgeMock.requests
      .some((request) => request.type === "result.invalidateSteps")
  )).toBe(true);

  await page.locator(
    '.workflow-property-icon-button[aria-label="このステップを実行"]'
  ).click();
  await expect.poll(async () => frame.evaluate(
    () => window.zizEmbeddedApi.isRunning()
  )).toBe(false);

  await frame.locator('.workflow-data-tab[data-tab="output"]').click();
  const outputPane = frame.locator(
    '.workflow-data-pane[data-pane="output"]'
  );
  await expect(outputPane.locator(".workflow-data-table th")).toHaveText([
    "id",
    "name",
  ]);
  await expect(outputPane.locator(".workflow-data-table tbody tr"))
    .toHaveCount(2);
  expect(await outputPane.locator(".workflow-data-table th").first().evaluate(
    (element) => getComputedStyle(element).position
  )).toBe("sticky");

  await frame.locator('.workflow-data-tab[data-tab="logs"]').click();
  await expect(frame.locator(".workflow-log-list"))
    .toContainText("step completed");
  await frame.locator('.workflow-data-tab[data-tab="schema"]').click();
  await expect(frame.locator(".workflow-schema-command", {
    hasText: "スキーマ取り込み",
  })).toBeVisible();
  await frame.locator(".workflow-schema-command", {
    hasText: "スキーマ取り込み",
  }).click();
  await expect.poll(async () => frame.evaluate(
    () => window.zizEmbeddedApi.getDocument().steps[0].schema?.columns
  )).toEqual([
    { origin_name: "id", ziz_datatype: "INT64" },
    { origin_name: "name", ziz_datatype: "STRING" },
  ]);

  await page.screenshot({
    path: testInfo.outputPath("production-property-result-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".workflow-property-heading")).toBeVisible();
  expect(await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1
  )).toBe(true);
  expect(await frame.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1
  )).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("production-property-result-mobile.png"),
    fullPage: true,
  });
});

test("closing a running workflow cancels it before closing the document", async ({ page }) => {
  const documentState = workflowDocument();
  await page.addInitScript((pendingDocument) => {
    if (window.top !== window) return;
    window.sessionStorage.setItem("ziz.pendingFlow.v1", JSON.stringify({
      selected: true,
      mode: "dataflow",
      file_name: "pending.zizd",
      document_ref: "docref_pending",
      doc_session_id: "docsession_pending",
      document: pendingDocument,
      hidden_bindings: {},
      mtime_ns: "300",
    }));
  }, documentState);
  await installQWebChannelMock(page, documentState, { runDelayMs: 60000 });
  await page.goto("/static/dataflow.html");

  const frame = page.frames().find(
    (item) => item !== page.mainFrame() &&
      item.url().includes("/static/dataflow.html")
  );
  await expect.poll(async () => frame?.evaluate(
    () => !!window.zizEmbeddedApi
  )).toBe(true);
  await frame.evaluate(() => window.zizEmbeddedApi.runFlow());
  await expect(page.locator(".workspace-tab__title")).toContainText("実行中");

  await page.locator(".workspace-tab__close").click();
  await expect(page.locator("#appDialog")).toHaveClass(/is-open/);
  await expect(page.locator("#appDialogCancel")).toBeFocused();
  await expect(page.locator("#appDialogOk"))
    .toHaveText("実行をキャンセルして閉じる");
  await page.locator("#appDialogOk").click();

  await expect(page.locator(".workspace-flow-frame")).toHaveCount(0);
  const parentRequests = await page.evaluate(
    () => window.__workflowBridgeMock.requests
  );
  expect(parentRequests.some((request) => request.type === "documents.close")).toBe(true);
});
