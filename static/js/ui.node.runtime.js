(function () {
  const packages = window.zizPackages || {};
  const uiPkg = packages.ui || {};
  const shared = uiPkg.nodeShared || window.uiNodeShared || {};
  const canvas = uiPkg.nodeCanvas || window.uiNodeCanvas || {};
  const detail = uiPkg.nodeDetail || window.uiNodeDetail || {};
  const uiNode = {
    normalizeSteps: shared.normalizeSteps,
    renderFlowChart: canvas.renderFlowChart,
    renderNodeDetail: detail.renderNodeDetail,
    destroyFlowCanvas: canvas.destroyFlowCanvas
  };
  window.uiNode = uiNode;
  const packagesOut = window.zizPackages = window.zizPackages || {};
  const uiOut = packagesOut.ui = packagesOut.ui || {};
  uiOut.node = uiNode;
})();
