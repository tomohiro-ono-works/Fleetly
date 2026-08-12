const { test, expect } = require("@playwright/test");

const FIXTURE_URL = "/static/test-fixtures/workflow-document-store.html";

test.beforeEach(async ({ page }) => {
  await page.goto(FIXTURE_URL);
  await expect(page.locator(".zwd")).toBeVisible();
});

test("Designer transactionを唯一のdocument storeへ反映する", async ({ page }) => {
  const before = await page.evaluate(() => {
    const fixture = window.workflowDocumentStoreFixture;
    fixture.clearChanges();
    return fixture.getSnapshot();
  });
  const node = page.locator(".zwd-node[data-node-key='step:01']");
  const box = await node.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 64,
    box.y + box.height / 2 + 36,
    { steps: 4 }
  );
  await page.mouse.up();

  const result = await page.evaluate(() => {
    const fixture = window.workflowDocumentStoreFixture;
    const storeDocument = fixture.getDocument();
    const designerDocument = fixture.adapter.designer.getDocument();
    const snapshot = fixture.getSnapshot();
    return {
      changeCount: fixture.changes.length,
      changeType: fixture.changes[0]?.type || "",
      storePosition: storeDocument.steps[0].ui_position,
      designerPosition: designerDocument.steps[0].ui_position,
      hasLegacyNodes: Object.prototype.hasOwnProperty.call(
        storeDocument,
        "nodes"
      ),
      dirty: snapshot.dirty,
      canUndo: snapshot.can_undo
    };
  });

  expect(result.changeCount).toBe(1);
  expect(result.changeType).toBe("transaction");
  expect(result.storePosition).toEqual(result.designerPosition);
  expect(result.storePosition.x).toBeGreaterThan(
    before.document.steps[0].ui_position.x
  );
  expect(result.hasLegacyNodes).toBe(false);
  expect(result.dirty).toBe(true);
  expect(result.canUndo).toBe(true);
});

test("undo、redo、保存済みrevisionでdirtyを判定する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const fixture = window.workflowDocumentStoreFixture;
    const store = fixture.store;
    const initial = store.getSnapshot();
    store.applyPatch([
      {
        op: "replace",
        path: ["steps", 0, "label"],
        value: "Changed"
      }
    ], {
      reason: "property.label",
      transactionId: "tx_label_01"
    });
    const changed = store.getSnapshot();
    store.undo();
    const undone = store.getSnapshot();
    store.redo();
    const redone = store.getSnapshot();
    store.markSaved({
      document_ref: "docref_saved",
      file_name: "saved.zizd"
    });
    const saved = store.getSnapshot();
    store.undo();
    const awayFromSaved = store.getSnapshot();
    store.redo();
    const backToSaved = store.getSnapshot();
    return {
      initialDirty: initial.dirty,
      changedDirty: changed.dirty,
      undoneDirty: undone.dirty,
      undoneLabel: undone.document.steps[0].label,
      redoneDirty: redone.dirty,
      savedDirty: saved.dirty,
      savedRef: saved.metadata.document_ref,
      awayFromSavedDirty: awayFromSaved.dirty,
      backToSavedDirty: backToSaved.dirty,
      designerLabel: fixture.adapter.designer
        .getDocument().steps[0].label
    };
  });

  expect(result).toEqual({
    initialDirty: false,
    changedDirty: true,
    undoneDirty: false,
    undoneLabel: "Define values",
    redoneDirty: true,
    savedDirty: false,
    savedRef: "docref_saved",
    awayFromSavedDirty: true,
    backToSavedDirty: false,
    designerLabel: "Changed"
  });
});

test("不正inverseと重複transactionをatomicに拒否する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const store = window.workflowDocumentStoreFixture.store;
    const before = store.getSnapshot();
    let invalidCode = "";
    let duplicateCode = "";
    try {
      store.applyTransaction({
        patch: [{
          op: "replace",
          path: ["steps", 0, "label"],
          value: "Invalid"
        }],
        inversePatch: [{
          op: "replace",
          path: ["steps", 0, "label"],
          value: "Wrong original"
        }],
        reason: "invalid",
        transactionId: "tx_invalid"
      });
    } catch (error) {
      invalidCode = String(error?.code || "");
    }
    const afterInvalid = store.getSnapshot();
    const transaction = {
      patch: [{
        op: "replace",
        path: ["steps", 0, "label"],
        value: "Valid"
      }],
      inversePatch: [{
        op: "replace",
        path: ["steps", 0, "label"],
        value: "Define values"
      }],
      reason: "valid",
      transactionId: "tx_duplicate"
    };
    store.applyTransaction(transaction);
    const afterValid = store.getSnapshot();
    try {
      store.applyTransaction(transaction);
    } catch (error) {
      duplicateCode = String(error?.code || "");
    }
    const afterDuplicate = store.getSnapshot();
    return {
      invalidCode,
      duplicateCode,
      invalidUnchanged: (
        before.revision_id === afterInvalid.revision_id &&
        afterInvalid.document.steps[0].label === "Define values"
      ),
      validLabel: afterValid.document.steps[0].label,
      duplicateUnchanged: (
        afterValid.revision_id === afterDuplicate.revision_id &&
        afterDuplicate.document.steps[0].label === "Valid"
      )
    };
  });

  expect(result).toEqual({
    invalidCode: "E_TRANSACTION_INVALID",
    duplicateCode: "E_TRANSACTION_DUPLICATE",
    invalidUnchanged: true,
    validLabel: "Valid",
    duplicateUnchanged: true
  });
});

test("undo後の新規transactionはredo branchを破棄する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const fixture = window.workflowDocumentStoreFixture;
    const store = fixture.store;
    store.applyPatch([{
      op: "replace",
      path: ["steps", 0, "label"],
      value: "First"
    }], {
      transactionId: "tx_first"
    });
    store.undo();
    store.applyPatch([{
      op: "replace",
      path: ["steps", 0, "label"],
      value: "Branch"
    }], {
      transactionId: "tx_branch"
    });
    const snapshot = store.getSnapshot();
    const redoResult = store.redo();
    return {
      label: snapshot.document.steps[0].label,
      canRedo: snapshot.can_redo,
      redoResult,
      designerLabel: fixture.adapter.designer
        .getDocument().steps[0].label
    };
  });

  expect(result).toEqual({
    label: "Branch",
    canRedo: false,
    redoResult: null,
    designerLabel: "Branch"
  });
});

test("flow追加はcatalog初期値と新IDを1 transactionで保存する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const fixture = window.workflowDocumentStoreFixture;
    fixture.clearChanges();
    const command = fixture.commands.addFlow({ label: "Second flow" });
    const document = fixture.getDocument();
    return {
      command,
      changeCount: fixture.changes.length,
      reason: fixture.changes[0]?.transaction?.reason,
      step: document.steps.find((item) => item.step_id === "02"),
      flow: document.flows["02"],
      defaultFlowId: document.metadata.default_flow_id
    };
  });

  expect(result.command.changed).toBe(true);
  expect(result.command.created).toEqual({
    flow_id: "02",
    step_id: "02"
  });
  expect(result.changeCount).toBe(1);
  expect(result.reason).toBe("flow.add");
  expect(result.step).toMatchObject({
    step_id: "02",
    flow_id: "02",
    label: "変数定義",
    connector_id: "WindowsConnector",
    action_id: "define_values"
  });
  expect(result.step).not.toHaveProperty("node_type");
  expect(result.flow.label).toBe("Second flow");
  expect(result.flow.edges).toEqual([
    { from: "START", to: "02", order: 1 },
    { from: "02", to: "END", order: 1 }
  ]);
  expect(result.defaultFlowId).toBe("01");
});

test("Designerとapp commandは同じID high-water markを共有する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const fixture = window.workflowDocumentStoreFixture;
    const duplicated = fixture.adapter.duplicate({
      nodes: [{ node_id: "01" }],
      edges: [],
      annotation_ids: []
    });
    fixture.commands.deleteSelection({
      nodes: [{ node_id: duplicated.stepIdMap["01"] }],
      edges: [],
      annotation_ids: []
    });
    const added = fixture.commands.addFlow();
    return {
      duplicatedStepId: duplicated.stepIdMap["01"],
      created: added.created,
      stepIds: fixture.getDocument().steps.map((step) => step.step_id)
    };
  });

  expect(result.duplicatedStepId).toBe("02");
  expect(result.created).toEqual({ flow_id: "02", step_id: "03" });
  expect(result.stepIds).toEqual(["01", "03"]);
});

test("通常flowはbranch orderを生成し重複／cycle／cross-flowを拒否する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const fixture = window.workflowDocumentStoreFixture;
    fixture.store.load({
      document: {
        metadata: { mode: "dataflow", default_flow_id: "01" },
        steps: [
          { step_id: "01", flow_id: "01", label: "A", ui_position: { x: 240, y: 120 } },
          { step_id: "02", flow_id: "01", label: "B", ui_position: { x: 480, y: 120 } },
          { step_id: "03", flow_id: "01", label: "C", ui_position: { x: 480, y: 260 } },
          { step_id: "04", flow_id: "02", label: "D", ui_position: { x: 480, y: 520 } }
        ],
        flows: {
          "01": {
            label: "One",
            start: { ui_position: { x: 60, y: 120 }, variables: [] },
            end: { ui_position: { x: 760, y: 120 } },
            edges: [
              { from: "START", to: "01", order: 1 },
              { from: "01", to: "02", order: 1 },
              { from: "02", to: "END", order: 1 }
            ]
          },
          "02": {
            label: "Two",
            start: { ui_position: { x: 60, y: 520 }, variables: [] },
            end: { ui_position: { x: 760, y: 520 } },
            edges: [
              { from: "START", to: "04", order: 1 },
              { from: "04", to: "END", order: 1 }
            ]
          }
        },
        loop: { flows: {} },
        notes: []
      }
    });
    const added = fixture.commands.connect(
      { node_id: "01" },
      { node_id: "03" }
    );
    const duplicate = fixture.commands.canConnect(
      { node_id: "01" },
      { node_id: "03" }
    );
    const cycle = fixture.commands.canConnect(
      { node_id: "03" },
      { node_id: "01" }
    );
    const crossFlow = fixture.commands.canConnect(
      { node_id: "01" },
      { node_id: "04" }
    );
    return {
      added,
      duplicate,
      cycle,
      crossFlow,
      edges: fixture.getDocument().flows["01"].edges
    };
  });

  expect(result.added.invalidated_step_ids).toEqual(["03"]);
  expect(result.edges).toContainEqual({ from: "01", to: "03", order: 2 });
  expect(result.duplicate.code).toBe("E_CONNECT_DUPLICATE");
  expect(result.cycle.code).toBe("E_CONNECT_CYCLE");
  expect(result.crossFlow.code).toBe("E_CONNECT_CROSS_SCOPE");
});

test("loop内部接続は親をSTART／ENDへ写像しbranchとmergeを拒否する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const fixture = window.workflowDocumentStoreFixture;
    fixture.store.load({
      document: {
        metadata: { mode: "dataflow", default_flow_id: "01" },
        steps: [
          {
            step_id: "01",
            flow_id: "01",
            label: "Loop",
            node_type: "loop",
            ui_position: { x: 300, y: 160 }
          },
          {
            step_id: "02",
            flow_id: "01",
            loop_owner_id: "01",
            label: "A",
            ui_position: { x: 300, y: 300 }
          },
          {
            step_id: "03",
            flow_id: "01",
            loop_owner_id: "01",
            label: "B",
            ui_position: { x: 520, y: 300 }
          }
        ],
        flows: {
          "01": {
            label: "Main",
            start: { ui_position: { x: 60, y: 160 }, variables: [] },
            end: { ui_position: { x: 760, y: 160 } },
            edges: [
              { from: "START", to: "01", order: 1 },
              { from: "01", to: "END", order: 1 }
            ]
          }
        },
        loop: { flows: { "01": { edges: [] } } },
        notes: []
      }
    });
    fixture.commands.connect({ node_id: "01" }, { node_id: "02" });
    fixture.commands.connect({ node_id: "02" }, { node_id: "03" });
    fixture.commands.connect({ node_id: "03" }, { node_id: "01" });
    const branch = fixture.commands.canConnect(
      { node_id: "01" },
      { node_id: "03" }
    );
    const merge = fixture.commands.canConnect(
      { node_id: "02" },
      { node_id: "01" }
    );
    return {
      edges: fixture.getDocument().loop.flows["01"].edges,
      branch,
      merge
    };
  });

  expect(result.edges).toEqual([
    { from: "START", to: "02", order: 1 },
    { from: "02", to: "03", order: 1 },
    { from: "03", to: "END", order: 1 }
  ]);
  expect(result.branch.code).toBe("E_LOOP_BRANCH_MERGE");
  expect(result.merge.code).toBe("E_LOOP_BRANCH_MERGE");
});

test("通常flowへの接続で未所属component全体を所属確定する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const fixture = window.workflowDocumentStoreFixture;
    fixture.store.load({
      document: {
        metadata: { mode: "dataflow", default_flow_id: "01" },
        steps: [
          { step_id: "01", flow_id: "01", label: "A", ui_position: { x: 260, y: 120 } },
          { step_id: "10", label: "Pasted A", ui_position: { x: 500, y: 320 } },
          { step_id: "11", label: "Pasted B", ui_position: { x: 720, y: 320 } }
        ],
        flows: {
          "01": {
            label: "Main",
            start: { ui_position: { x: 60, y: 120 }, variables: [] },
            end: { ui_position: { x: 940, y: 120 } },
            edges: [
              { from: "START", to: "01", order: 1 },
              { from: "01", to: "END", order: 1 }
            ]
          }
        },
        unassigned: {
          start: { ui_position: { x: 60, y: 320 } },
          step_ids: ["10", "11"],
          edges: [
            { from: "START", to: "10", order: 1 },
            { from: "10", to: "11", order: 1 }
          ]
        },
        loop: { flows: {} },
        notes: []
      }
    });
    const command = fixture.commands.connect(
      { node_id: "01" },
      { node_id: "10" }
    );
    return {
      command,
      document: fixture.getDocument()
    };
  });

  expect(result.command.assigned_step_ids).toEqual(["10", "11"]);
  expect(result.command.invalidated_step_ids).toEqual(["10", "11"]);
  expect(result.document.steps.map((step) => step.flow_id)).toEqual([
    "01",
    "01",
    "01"
  ]);
  expect(result.document).not.toHaveProperty("unassigned");
  expect(result.document.flows["01"].edges).toContainEqual({
    from: "10",
    to: "11",
    order: 1
  });
  expect(result.document.flows["01"].edges).toContainEqual({
    from: "01",
    to: "10",
    order: 2
  });
});

test("loop親削除はchild、dangling edge、所有loop graphを同時に削除する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const fixture = window.workflowDocumentStoreFixture;
    fixture.store.load({
      document: {
        metadata: { mode: "dataflow", default_flow_id: "01" },
        steps: [
          { step_id: "01", flow_id: "01", label: "A", ui_position: { x: 220, y: 120 } },
          {
            step_id: "02",
            flow_id: "01",
            label: "Loop",
            node_type: "loop",
            ui_position: { x: 440, y: 120 }
          },
          { step_id: "03", flow_id: "01", label: "C", ui_position: { x: 680, y: 120 } },
          {
            step_id: "04",
            flow_id: "01",
            loop_owner_id: "02",
            label: "Child",
            ui_position: { x: 440, y: 280 }
          }
        ],
        flows: {
          "01": {
            label: "Main",
            start: { ui_position: { x: 60, y: 120 }, variables: [] },
            end: { ui_position: { x: 900, y: 120 } },
            edges: [
              { from: "START", to: "01", order: 1 },
              { from: "01", to: "02", order: 1 },
              { from: "02", to: "03", order: 1 },
              { from: "03", to: "END", order: 1 }
            ]
          }
        },
        loop: {
          flows: {
            "02": {
              edges: [
                { from: "START", to: "04", order: 1 },
                { from: "04", to: "END", order: 1 }
              ]
            }
          }
        },
        notes: []
      }
    });
    const command = fixture.commands.deleteSelection({
      nodes: [{ node_id: "02" }],
      edges: [],
      annotation_ids: []
    });
    return { command, document: fixture.getDocument() };
  });

  expect(result.command.deleted_step_ids).toEqual(["02", "04"]);
  expect(result.command.invalidated_step_ids).toEqual(["02", "03", "04"]);
  expect(result.document.steps.map((step) => step.step_id)).toEqual(["01", "03"]);
  expect(result.document.flows["01"].edges).toEqual([
    { from: "START", to: "01", order: 1 },
    { from: "03", to: "END", order: 1 }
  ]);
  expect(result.document.loop.flows).not.toHaveProperty("02");
});

test("選択edgeとsticky noteを1 transactionで削除する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const fixture = window.workflowDocumentStoreFixture;
    fixture.store.applyPatch([{
      op: "add",
      path: ["notes", 0],
      value: {
        note_id: "01",
        ui_position: { x: 480, y: 420 },
        size: { width: 240, height: 144 },
        text: "memo",
        color: "#fff2a8"
      }
    }], { reason: "fixture.prepare" });
    fixture.clearChanges();
    const command = fixture.commands.deleteSelection({
      nodes: [],
      edges: [{ flow_id: "01", from: "START", to: "01" }],
      annotation_ids: ["01"]
    });
    return {
      command,
      document: fixture.getDocument(),
      changeCount: fixture.changes.length
    };
  });

  expect(result.command.changed).toBe(true);
  expect(result.command.invalidated_step_ids).toEqual(["01"]);
  expect(result.changeCount).toBe(1);
  expect(result.document.flows["01"].edges).toEqual([
    { from: "01", to: "END", order: 1 }
  ]);
  expect(result.document.notes).toEqual([]);
});

test("property変更は実行影響のあるfieldだけ下流resultを無効化する", async ({ page }) => {
  const result = await page.evaluate(() => {
    const fixture = window.workflowDocumentStoreFixture;
    fixture.store.applyPatch([
      {
        op: "add",
        path: ["steps", 1],
        value: {
          step_id: "02",
          flow_id: "01",
          label: "Next",
          connector_id: "PythonConnector",
          action_id: "execute_python",
          ui_position: { x: 540, y: 220 }
        }
      },
      {
        op: "replace",
        path: ["flows", "01", "edges"],
        value: [
          { from: "START", to: "01", order: 1 },
          { from: "01", to: "02", order: 1 },
          { from: "02", to: "END", order: 1 }
        ]
      }
    ], { reason: "fixture.prepare" });
    const label = fixture.commands.updateStep("01", { label: "Renamed" });
    const params = fixture.commands.updateStep("01", {
      params: { values: [{ name: "limit", value: 10 }] }
    });
    const flowLabel = fixture.commands.updateFlow("01", { label: "Flow renamed" });
    const variables = fixture.commands.updateFlow("01", {
      start_variables: [{ name: "date", value: "2026-07-29" }]
    });
    return {
      label,
      params,
      flowLabel,
      variables,
      document: fixture.getDocument()
    };
  });

  expect(result.label.invalidated_step_ids).toEqual([]);
  expect(result.params.invalidated_step_ids).toEqual(["01", "02"]);
  expect(result.flowLabel.invalidated_step_ids).toEqual([]);
  expect(result.variables.invalidated_step_ids).toEqual(["01", "02"]);
  expect(result.document.steps[0].label).toBe("Renamed");
  expect(result.document.flows["01"].start.variables).toEqual([
    { name: "date", value: "2026-07-29" }
  ]);
});

test("Designerのconnect／delete requestをadapterがcommandへ反映する", async ({ page }) => {
  await page.evaluate(() => {
    const fixture = window.workflowDocumentStoreFixture;
    fixture.store.applyPatch([
      {
        op: "add",
        path: ["steps", 1],
        value: {
          step_id: "02",
          flow_id: "01",
          label: "Next",
          connector_id: "PythonConnector",
          action_id: "execute_python",
          ui_position: { x: 560, y: 220 }
        }
      },
      {
        op: "replace",
        path: ["flows", "01", "edges"],
        value: [
          { from: "START", to: "01", order: 1 },
          { from: "02", to: "END", order: 1 }
        ]
      }
    ], { reason: "fixture.prepare" });
    fixture.clearChanges();
  });
  const source = page.locator("[data-node-key='step:01'] [data-zwd-port='out']");
  const target = page.locator("[data-node-key='step:02'] [data-zwd-port='in']");
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

  let result = await page.evaluate(() => {
    const fixture = window.workflowDocumentStoreFixture;
    return {
      edges: fixture.getDocument().flows["01"].edges,
      commands: fixture.commandResults.map((item) => item.command)
    };
  });
  expect(result.edges).toContainEqual({ from: "01", to: "02", order: 1 });
  expect(result.commands).toContain("edge.connect");

  await page.evaluate(() => {
    const fixture = window.workflowDocumentStoreFixture;
    fixture.adapter.setSelection({
      nodes: [{ node_id: "02" }],
      edges: [],
      annotation_ids: []
    });
    document.querySelector(".zwd").dispatchEvent(new KeyboardEvent("keydown", {
      key: "Delete",
      bubbles: true
    }));
  });
  result = await page.evaluate(() => {
    const fixture = window.workflowDocumentStoreFixture;
    return {
      stepIds: fixture.getDocument().steps.map((step) => step.step_id),
      selection: fixture.adapter.getSelection(),
      commands: fixture.commandResults.map((item) => item.command),
      errors: fixture.errors
    };
  });
  expect(result.stepIds).toEqual(["01"]);
  expect(result.selection).toEqual({
    nodes: [],
    edges: [],
    annotation_ids: []
  });
  expect(result.commands).toContain("selection.delete");
  expect(result.errors).toEqual([]);
});
