(function () {
  const uiNode = window.uiNode || {};
  const normalizeSteps = uiNode.normalizeSteps;
  const renderFlowChart = uiNode.renderFlowChart;
  const renderNodeDetail = uiNode.renderNodeDetail;

  function renderApp({ flowRoot, detailRoot, state, config, onStateChanged }) {
    if (!flowRoot || !detailRoot) return;

    if (typeof normalizeSteps === "function") {
      normalizeSteps(state);
    }

    if (typeof renderFlowChart === "function") {
      renderFlowChart({ root: flowRoot, state, config, onStateChanged });
    }

    if (typeof renderNodeDetail === "function") {
      renderNodeDetail({ root: detailRoot, state, config, onStateChanged });
    }
  }

  window.renderer = { renderApp };
})();
