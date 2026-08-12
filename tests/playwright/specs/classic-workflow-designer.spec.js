const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const FIXTURE_URL =
  "/static/test-fixtures/workflow-designer.html?variant=classic";

async function screenPoint(page, nodeId, port = "center") {
  return page.evaluate(({ nodeId: targetId, port: targetPort }) => {
    const fixture = window.workflowDesignerFixture;
    const workflow = fixture.getDocument();
    const step = workflow.steps.find((item) => item.step_id === targetId);
    if (!step) throw new Error(`Step not found: ${targetId}`);
    const viewport = fixture.designer.getViewport();
    const canvas = document.querySelector(".zcwd-canvas")
      .getBoundingClientRect();
    const offset = targetPort === "in" ? 0 : targetPort === "out" ? 64 : 32;
    return {
      x: canvas.left + viewport.x +
        (step.ui_position.x + offset) * viewport.zoom,
      y: canvas.top + viewport.y +
        (step.ui_position.y + 32) * viewport.zoom
    };
  }, { nodeId, port });
}

test.beforeEach(async ({ page }) => {
  await page.goto(FIXTURE_URL);
  await expect(page.locator(".zcwd")).toBeVisible();
});

test("uses the canonical document directly and paints the classic canvas", async ({ page }) => {
  const result = await page.evaluate(() => {
    const fixture = window.workflowDesignerFixture;
    const canvas = document.querySelector(".zcwd-canvas");
    const context = canvas.getContext("2d");
    const pixels = context.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    ).data;
    let nonWhite = 0;
    for (let index = 0; index < pixels.length; index += 16) {
      if (
        pixels[index] < 245 ||
        pixels[index + 1] < 245 ||
        pixels[index + 2] < 245
      ) nonWhite += 1;
    }
    const workflow = fixture.getDocument();
    return {
      variant: fixture.variant,
      nonWhite,
      flows: Object.keys(workflow.flows),
      hasLegacyNodes: Object.prototype.hasOwnProperty.call(workflow, "nodes"),
      loopOwners: Object.keys(workflow.loop.flows)
    };
  });
  expect(result.variant).toBe("classic");
  expect(result.nonWhite).toBeGreaterThan(100);
  expect(result.flows).toEqual(["01", "02"]);
  expect(result.hasLegacyNodes).toBe(false);
  expect(result.loopOwners).toEqual(["04"]);
});

test("node selection and drag emit the shared public contract", async ({ page }) => {
  await page.evaluate(() => window.workflowDesignerFixture.clearEvents());
  const start = await screenPoint(page, "01");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 64, start.y + 32, { steps: 5 });
  await page.mouse.up();

  const result = await page.evaluate(() => {
    const fixture = window.workflowDesignerFixture;
    const changes = fixture.events.filter(
      (event) => event.name === "document:change"
    );
    return {
      reason: changes[0]?.payload.reason,
      changeCount: changes.length,
      position: fixture.getDocument().steps[0].ui_position,
      selected: fixture.designer.getSelection().nodes
    };
  });
  expect(result.changeCount).toBe(1);
  expect(result.reason).toBe("node.move");
  expect(result.position.x).toBeGreaterThan(280);
  expect(result.position.y).toBeGreaterThan(120);
  expect(result.selected).toEqual([{ node_id: "01" }]);
});

test("connect gesture emits canonical node refs", async ({ page }) => {
  await page.evaluate(() => window.workflowDesignerFixture.clearEvents());
  const source = await screenPoint(page, "01", "out");
  const target = await screenPoint(page, "03", "in");
  await page.mouse.move(source.x, source.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 6 });
  await page.mouse.up();
  const request = await page.evaluate(() => (
    window.workflowDesignerFixture.events.find(
      (event) => event.name === "connect:create-request"
    )?.payload
  ));
  expect(request).toEqual({
    source_node_ref: { node_id: "01" },
    target_node_ref: { node_id: "03" },
    ports: { source: "out", target: "in" }
  });
});

test("sticky note edit remains a document transaction", async ({ page }) => {
  const notePoint = await page.evaluate(() => {
    const fixture = window.workflowDesignerFixture;
    const note = fixture.getDocument().notes[0];
    const viewport = fixture.designer.getViewport();
    const canvas = document.querySelector(".zcwd-canvas")
      .getBoundingClientRect();
    return {
      x: canvas.left + viewport.x +
        (note.ui_position.x + 40) * viewport.zoom,
      y: canvas.top + viewport.y +
        (note.ui_position.y + 40) * viewport.zoom
    };
  });
  await page.mouse.dblclick(notePoint.x, notePoint.y);
  const editor = page.locator(".zcwd-note-editor");
  await expect(editor).toBeVisible();
  await editor.fill("Updated classic note");
  await editor.blur();
  await expect.poll(() => page.evaluate(() => (
    window.workflowDesignerFixture.getDocument().notes[0].text
  ))).toBe("Updated classic note");
});

test("captures the 202606-style workflow view", async ({ page }) => {
  const artifacts = path.resolve(__dirname, "../artifacts");
  fs.mkdirSync(artifacts, { recursive: true });
  await page.evaluate(() => (
    window.workflowDesignerFixture.designer.fitView({ padding: 56 })
  ));
  await page.screenshot({
    path: path.join(artifacts, "classic-workflow-designer-desktop.png"),
    fullPage: true
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => (
    window.workflowDesignerFixture.designer.fitView({ padding: 40 })
  ));
  const bounds = await page.evaluate(() => {
    const shell = document.querySelector(".zcwd").getBoundingClientRect();
    const toolbar = document.querySelector(".zcwd-toolbar")
      .getBoundingClientRect();
    return {
      shell: {
        left: shell.left,
        top: shell.top,
        right: shell.right,
        bottom: shell.bottom
      },
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
    path: path.join(artifacts, "classic-workflow-designer-mobile.png"),
    fullPage: true
  });
});
