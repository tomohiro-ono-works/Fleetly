async function waitForClassicStep(target, stepId) {
  await target.waitForFunction((targetStepId) => (
    !!window.zizEmbeddedApi &&
    window.zizEmbeddedApi.getDocument().steps.some(
      (step) => step.step_id === targetStepId
    ) &&
    !!document.querySelector(".zcwd-canvas")
  ), stepId);
  await target.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function clickClassicStep(target, stepId) {
  await waitForClassicStep(target, stepId);
  const position = await target.evaluate((targetStepId) => {
    const workflow = window.zizEmbeddedApi.getDocument();
    const step = workflow.steps.find(
      (item) => item.step_id === targetStepId
    );
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

module.exports = {
  clickClassicStep,
  waitForClassicStep
};
