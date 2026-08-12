const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const FIXTURE_URL = "/static/test-fixtures/workflow-designer.html";

test.beforeEach(async ({ page }) => {
  await page.goto(FIXTURE_URL);
  await expect(page.locator(".zwd")).toBeVisible();
});

test("renders the direct workflow document graph without a legacy node model", async ({ page }) => {
  await expect(page.locator(".zwd-node")).toHaveCount(14);
  await expect(page.locator(".zwd-edge")).toHaveCount(13);
  await expect(page.locator(".zwd-loop-frame")).toHaveCount(1);
  await expect(page.locator(".zwd-note")).toHaveCount(1);
  await expect(page.locator("[data-zizai-node-renderer='true']")).toHaveCount(9);

  const shape = await page.evaluate(() => {
    const document = window.workflowDesignerFixture.designer.getDocument();
    return {
      hasSteps: Array.isArray(document.steps),
      flowIds: Object.keys(document.flows),
      loopIds: Object.keys(document.loop.flows),
      hasLegacyNodes: Object.prototype.hasOwnProperty.call(document, "nodes"),
      hasParentId: document.steps.some((step) => "parentId" in step),
      firstNoteId: document.notes[0].note_id
    };
  });
  expect(shape).toEqual({
    hasSteps: true,
    flowIds: ["01", "02"],
    loopIds: ["04"],
    hasLegacyNodes: false,
    hasParentId: false,
    firstNoteId: "01"
  });
});

test("selection, status and viewport updates keep document DOM nodes stable", async ({ page }) => {
  const stable = await page.evaluate(() => {
    const fixture = window.workflowDesignerFixture;
    const designer = fixture.designer;
    const before = document.querySelector("[data-node-key='step:01']");
    designer.setSelection({
      nodes: [{ node_id: "01" }],
      edges: [],
      annotation_ids: []
    });
    designer.setStatus({
      nodeStatus: { "01": "running" },
      validation: {
        "01": [{ level: "warning", message: "Check input" }]
      }
    });
    designer.setViewport({ x: 44, y: 55, zoom: 1.1 });
    return {
      sameNode: before === document.querySelector("[data-node-key='step:01']"),
      selected: before.dataset.selected,
      status: before.dataset.runStatus,
      validation: before.dataset.validationLevel,
      viewport: designer.getViewport()
    };
  });
  expect(stable).toEqual({
    sameNode: true,
    selected: "true",
    status: "running",
    validation: "warning",
    viewport: { x: 44, y: 55, zoom: 1.1 }
  });
});

test("node drag emits one reversible controlled document transaction", async ({ page }) => {
  const before = await page.evaluate(() => {
    window.workflowDesignerFixture.clearEvents();
    return window.workflowDesignerFixture.getDocument();
  });
  const node = page.locator(".zwd-node[data-node-key='step:01']");
  const box = await node.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 72,
    box.y + box.height / 2 + 40,
    { steps: 5 }
  );
  await page.mouse.up();

  const result = await page.evaluate((original) => {
    const fixture = window.workflowDesignerFixture;
    const changes = fixture.events.filter(
      (event) => event.name === "document:change"
    );
    const transaction = changes[0]?.payload;
    const current = fixture.getDocument();
    const restored = window.zizPackages.workflowDesigner.applyDocumentPatch(
      current,
      transaction.inversePatch
    );
    return {
      changeCount: changes.length,
      reason: transaction.reason,
      patchLength: transaction.patch.length,
      moved: current.steps[0].ui_position,
      restored: restored.steps[0].ui_position,
      original: original.steps[0].ui_position
    };
  }, before);
  expect(result.changeCount).toBe(1);
  expect(result.reason).toBe("node.move");
  expect(result.patchLength).toBe(1);
  expect(result.moved.x).toBeGreaterThan(result.original.x);
  expect(result.moved.y).toBeGreaterThan(result.original.y);
  expect(result.restored).toEqual(result.original);
});

test("invalid updateDocument patch is atomic", async ({ page }) => {
  const result = await page.evaluate(() => {
    const designer = window.workflowDesignerFixture.designer;
    const before = designer.getDocument();
    let error = "";
    try {
      designer.updateDocument([
        {
          op: "replace",
          path: ["steps", 99, "label"],
          value: "invalid"
        }
      ]);
    } catch (caught) {
      error = String(caught.message || caught);
    }
    return {
      error,
      unchanged: JSON.stringify(before) === JSON.stringify(designer.getDocument())
    };
  });
  expect(result.error).toContain("patch path");
  expect(result.unchanged).toBe(true);
});

test("partial paste creates unassigned steps and keeps only internal edges", async ({ page }) => {
  const result = await page.evaluate(() => {
    const fixture = window.workflowDesignerFixture;
    const designer = fixture.designer;
    designer.setSelection({
      nodes: [{ node_id: "01" }, { node_id: "03" }],
      edges: [],
      annotation_ids: []
    });
    const fragment = designer.copy();
    const pasted = designer.paste(fragment);
    const document = fixture.getDocument();
    const ids = pasted.selection.nodes.map((ref) => ref.node_id);
    const steps = document.steps.filter((step) => ids.includes(step.step_id));
    const internal = document.unassigned.edges.find(
      (edge) => edge.from === ids[0] && edge.to === ids[1]
    );
    return {
      kind: fragment.kind,
      ids,
      flowIds: steps.map((step) => step.flow_id || null),
      hasInternalEdge: !!internal,
      hasBoundaryEdge: document.unassigned.edges.some(
        (edge) => edge.to === ids[0] && !ids.includes(edge.from)
      )
    };
  });
  expect(result.kind).toBe("partial");
  expect(result.ids).toEqual(["12", "13"]);
  expect(result.flowIds).toEqual([null, null]);
  expect(result.hasInternalEdge).toBe(true);
  expect(result.hasBoundaryEdge).toBe(false);
});

test("full flow copy allocates a new flow and rewrites common graph references", async ({ page }) => {
  const result = await page.evaluate(() => {
    const fixture = window.workflowDesignerFixture;
    const designer = fixture.designer;
    fixture.clearEvents();
    designer.setSelection({
      nodes: [
        { node_id: "START", flow_id: "01" },
        { node_id: "END", flow_id: "01" },
        ...["01", "02", "03", "04", "06", "07"].map(
          (node_id) => ({ node_id })
        )
      ],
      edges: [],
      annotation_ids: []
    });
    const fragment = designer.copy();
    const pasted = designer.paste(fragment);
    const document = fixture.getDocument();
    const newFlowId = Object.values(pasted.flowIdMap)[0];
    const ids = Object.values(pasted.stepIdMap);
    const ownerId = pasted.stepIdMap["04"];
    const transaction = fixture.events.find(
      (event) => event.name === "document:change"
    ).payload;
    return {
      kind: fragment.kind,
      newFlowId,
      ids,
      flowStepIds: document.steps
        .filter((step) => step.flow_id === newFlowId)
        .map((step) => step.step_id),
      flowEdges: document.flows[newFlowId].edges,
      loopOwnerId: ownerId,
      loopEdges: document.loop.flows[ownerId].edges,
      hasWholeStepsReplace: transaction.patch.some(
        (operation) => (
          operation.op === "replace" &&
          operation.path.length === 1 &&
          operation.path[0] === "steps"
        )
      ),
      addedStepCount: transaction.patch.filter(
        (operation) => (
          operation.op === "add" &&
          operation.path[0] === "steps"
        )
      ).length,
      connectorPreserved: document.steps.find(
        (step) => step.step_id === pasted.stepIdMap["01"]
      ).connector_id
    };
  });
  expect(result.kind).toBe("flow");
  expect(result.newFlowId).toBe("03");
  expect(result.ids).toEqual(["12", "13", "14", "15", "16", "17"]);
  expect(result.flowStepIds).toEqual(result.ids);
  expect(result.flowEdges).toContainEqual({
    from: "START",
    to: "12",
    order: 1
  });
  expect(result.loopOwnerId).toBe("15");
  expect(result.loopEdges).toContainEqual({
    from: "17",
    to: "END",
    order: 1
  });
  expect(result.hasWholeStepsReplace).toBe(false);
  expect(result.addedStepCount).toBe(6);
  expect(result.connectorPreserved).toBe("csv_connector");
});

test("retired note ids are not reused after a confirmed document replacement", async ({ page }) => {
  const result = await page.evaluate(() => {
    const fixture = window.workflowDesignerFixture;
    const designer = fixture.designer;
    document.querySelector("[data-zwd-command='annotation.add']").click();
    const withSecond = fixture.getDocument();
    fixture.replaceDocument({
      ...withSecond,
      notes: withSecond.notes.filter((note) => note.note_id !== "02")
    });
    document.querySelector("[data-zwd-command='annotation.add']").click();
    return fixture.getDocument().notes.map((note) => note.note_id);
  });
  expect(result).toEqual(["01", "03"]);
});

test("sticky note links and inline editing use public events and patches", async ({ page }) => {
  await page.evaluate(() => window.workflowDesignerFixture.clearEvents());
  await page.locator(".zwd-note__link").click();
  let external = await page.evaluate(() => (
    window.workflowDesignerFixture.events.find(
      (event) => event.name === "external-link:open-request"
    )
  ));
  expect(external.payload.url).toBe("https://example.com/docs");

  await page.locator("[data-note-body='01']").dblclick();
  const editor = page.locator(".zwd-note__editor");
  await editor.fill("Updated note");
  await editor.blur();
  await expect(page.locator("[data-note-body='01']")).toHaveText("Updated note");
  const text = await page.evaluate(() => (
    window.workflowDesignerFixture.getDocument().notes[0].text
  ));
  expect(text).toBe("Updated note");
});

test("connect gesture emits node refs and port metadata without changing the document", async ({ page }) => {
  await page.evaluate(() => window.workflowDesignerFixture.clearEvents());
  const source = page.locator("[data-node-key='step:01'] [data-zwd-port='out']");
  const target = page.locator("[data-node-key='step:03'] [data-zwd-port='in']");
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
    { steps: 5 }
  );
  await page.mouse.up();
  const event = await page.evaluate(() => (
    window.workflowDesignerFixture.events.find(
      (item) => item.name === "connect:create-request"
    )
  ));
  expect(event.payload).toEqual({
    source_node_ref: { node_id: "01" },
    target_node_ref: { node_id: "03" },
    ports: { source: "out", target: "in" }
  });
});

test("graph constraints reject a connection before the public request event", async ({ page }) => {
  await page.evaluate(() => window.workflowDesignerFixture.clearEvents());
  const source = page.locator("[data-node-key='step:02'] [data-zwd-port='out']");
  const target = page.locator("[data-node-key='step:03'] [data-zwd-port='in']");
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
    { steps: 4 }
  );
  await page.mouse.up();
  await expect(page.locator(".zwd-message")).toContainText("blocked");
  const requests = await page.evaluate(() => (
    window.workflowDesignerFixture.events.filter(
      (event) => event.name === "connect:create-request"
    ).length
  ));
  expect(requests).toBe(0);
});

test("readonly keeps selection available while blocking all editing requests", async ({ page }) => {
  const result = await page.evaluate(() => {
    const fixture = window.workflowDesignerFixture;
    const designer = fixture.designer;
    fixture.clearEvents();
    const before = fixture.getDocument();
    designer.setSelection({
      nodes: [{ node_id: "01" }],
      edges: [],
      annotation_ids: []
    });
    designer.setReadonly(true);
    document.querySelector("[data-zwd-command='annotation.add']").click();
    document.querySelector(".zwd").dispatchEvent(new KeyboardEvent("keydown", {
      key: "Delete",
      bubbles: true
    }));
    const duplicate = designer.duplicate();
    return {
      duplicate,
      unchanged: JSON.stringify(before) === JSON.stringify(designer.getDocument()),
      editEventCount: fixture.events.filter((event) => (
        event.name === "document:change" ||
        event.name === "delete:request"
      )).length,
      selected: document.querySelector(
        ".zwd-node[data-node-key='step:01']"
      ).dataset.selected,
      disabledPorts: document.querySelectorAll(".zwd-port:disabled").length,
      disabledColor: document.querySelector(".zwd-note__color").disabled
    };
  });
  expect(result).toEqual({
    duplicate: null,
    unchanged: true,
    editEventCount: 0,
    selected: "true",
    disabledPorts: 23,
    disabledColor: true
  });
});

test("custom id allocation and reference rewriting are synchronous and atomic", async ({ page }) => {
  const result = await page.evaluate(() => {
    const factory = window.zizPackages.workflowDesigner.createWorkflowDesigner;
    const host = document.createElement("div");
    host.style.width = "600px";
    host.style.height = "400px";
    document.body.appendChild(host);
    let state = {
      metadata: {},
      steps: [
        {
          step_id: "01",
          flow_id: "01",
          label: "Source",
          ui_position: { x: 200, y: 100 },
          params: { source_step_id: "01" }
        }
      ],
      flows: {
        "01": {
          start: { ui_position: { x: 40, y: 100 }, variables: [] },
          end: { ui_position: { x: 440, y: 100 } },
          edges: [
            { from: "START", to: "01", order: 1 },
            { from: "01", to: "END", order: 1 }
          ]
        }
      },
      notes: []
    };
    const calls = [];
    const designer = factory({
      root: host,
      document: state,
      idAllocator({ idKind, count }) {
        calls.push({ idKind, count });
        return idKind === "step" ? ["custom-step"] : ["custom-id"];
      },
      referenceRewriter({ clonedStep, stepIdMap, sourceDocument }) {
        return {
          ...clonedStep,
          params: {
            ...clonedStep.params,
            source_step_id: stepIdMap["01"],
            source_name: sourceDocument.steps[0].label
          }
        };
      }
    });
    designer.on("document:change", (event) => {
      state = window.zizPackages.workflowDesigner.applyDocumentPatch(
        state,
        event.patch
      );
      designer.updateDocument(event.patch);
    });
    designer.mount();
    designer.setSelection({
      nodes: [{ node_id: "01" }],
      edges: [],
      annotation_ids: []
    });
    const cloned = designer.duplicate();
    const step = state.steps.find((item) => item.step_id === "custom-step");

    const badHost = document.createElement("div");
    document.body.appendChild(badHost);
    const bad = factory({
      root: badHost,
      document: state,
      idAllocator: () => ["01"]
    });
    bad.mount();
    bad.setSelection({
      nodes: [{ node_id: "01" }],
      edges: [],
      annotation_ids: []
    });
    const beforeBad = JSON.stringify(bad.getDocument());
    let error = "";
    try {
      bad.duplicate();
    } catch (caught) {
      error = String(caught.message || caught);
    }
    const badUnchanged = beforeBad === JSON.stringify(bad.getDocument());
    bad.destroy();
    designer.destroy();
    host.remove();
    badHost.remove();
    return {
      calls,
      clonedId: cloned.stepIdMap["01"],
      rewrittenReference: step.params.source_step_id,
      sourceName: step.params.source_name,
      error,
      badUnchanged
    };
  });
  expect(result.calls).toEqual([{ idKind: "step", count: 1 }]);
  expect(result.clonedId).toBe("custom-step");
  expect(result.rewrittenReference).toBe("custom-step");
  expect(result.sourceName).toBe("Source");
  expect(result.error).toContain("existing");
  expect(result.badUnchanged).toBe(true);
});

test("library source does not import Zizai app or transport responsibilities", async () => {
  const directory = path.resolve(
    __dirname,
    "../../../static/js/workflow-designer"
  );
  const files = fs.readdirSync(directory)
    .filter((name) => name.endsWith(".js"));
  const source = files
    .map((name) => fs.readFileSync(path.join(directory, name), "utf8"))
    .join("\n");
  [
    "BridgeClient",
    "QWebChannel",
    "connector_id ===",
    "action_id ===",
    "yaml.",
    "window.uiNode"
  ].forEach((forbidden) => {
    expect(source).not.toContain(forbidden);
  });
});

test("captures fitted desktop and mobile layouts without shell overflow", async ({ page }) => {
  const artifacts = path.resolve(__dirname, "../artifacts");
  fs.mkdirSync(artifacts, { recursive: true });
  await page.evaluate(() => window.workflowDesignerFixture.designer.fitView());
  await page.screenshot({
    path: path.join(artifacts, "workflow-designer-desktop.png"),
    fullPage: true
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.workflowDesignerFixture.designer.fitView());
  const bounds = await page.evaluate(() => {
    const shell = document.querySelector(".zwd").getBoundingClientRect();
    const toolbar = document.querySelector(".zwd-toolbar").getBoundingClientRect();
    return {
      shell: { left: shell.left, top: shell.top, right: shell.right, bottom: shell.bottom },
      toolbar: {
        left: toolbar.left,
        top: toolbar.top,
        right: toolbar.right,
        bottom: toolbar.bottom
      }
    };
  });
  expect(bounds.toolbar.left).toBeGreaterThanOrEqual(bounds.shell.left);
  expect(bounds.toolbar.top).toBeGreaterThanOrEqual(bounds.shell.top);
  expect(bounds.toolbar.right).toBeLessThanOrEqual(bounds.shell.right);
  expect(bounds.toolbar.bottom).toBeLessThanOrEqual(bounds.shell.bottom);
  await page.screenshot({
    path: path.join(artifacts, "workflow-designer-mobile.png"),
    fullPage: true
  });
});
