(function () {
  const packages = window.zizPackages = window.zizPackages || {};
  const uiPkg = packages.ui = packages.ui || {};
  let loadPromise = null;
  const scriptSpecs = [
    {
      key: "shared",
      src: "./js/ui.node.shared.js?v=20260411-1",
      isReady: () => typeof ((uiPkg.nodeShared || window.uiNodeShared || {}).normalizeSteps) === "function"
    },
    {
      key: "canvas-layout",
      src: "./js/ui.node.canvas.layout.js?v=20260426-2",
      isReady: () => typeof ((uiPkg.nodeCanvasParts || window.uiNodeCanvasParts || {}).buildFlowModel) === "function"
    },
    {
      key: "canvas-draw",
      src: "./js/ui.node.canvas.draw.js?v=20260426-1",
      isReady: () => typeof ((uiPkg.nodeCanvasParts || window.uiNodeCanvasParts || {}).drawFlowCanvas) === "function"
    },
    {
      key: "canvas-hit",
      src: "./js/ui.node.canvas.hit.js?v=20260426-1",
      isReady: () => typeof ((uiPkg.nodeCanvasParts || window.uiNodeCanvasParts || {}).hitControl) === "function"
    },
    {
      key: "canvas",
      src: "./js/ui.node.canvas.js?v=20260426-3",
      isReady: () => typeof ((uiPkg.nodeCanvas || window.uiNodeCanvas || {}).renderFlowChart) === "function"
    },
    {
      key: "detail",
      src: "./js/ui.node.detail.js?v=20260419-5",
      isReady: () => typeof ((uiPkg.nodeDetail || window.uiNodeDetail || {}).renderNodeDetail) === "function"
    },
    {
      key: "runtime",
      src: "./js/ui.node.runtime.js?v=20260411-2",
      isReady: () => typeof ((uiPkg.node || window.uiNode || {}).renderFlowChart) === "function"
    }
  ];

  function loadScript(spec) {
    const selector = `script[data-ziz-ui-node-part="${spec.key}"]`;
    const existing = document.querySelector(selector);
    if (existing?.dataset.loaded === "true" || spec.isReady()) {
      if (existing) existing.dataset.loaded = "true";
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const script = existing || document.createElement("script");
      const handleReady = () => {
        if (!spec.isReady()) return;
        script.dataset.loaded = "true";
        resolve();
      };
      const handleLoad = () => {
        window.requestAnimationFrame(() => {
          if (spec.isReady()) {
            handleReady();
            return;
          }
          reject(new Error(`ui.node ${spec.key} loaded but API is not ready`));
        });
      };
      const handleError = () => reject(new Error(`ui.node ${spec.key} failed to load`));

      script.addEventListener("load", handleLoad, { once: true });
      script.addEventListener("error", handleError, { once: true });

      if (!existing) {
        script.src = spec.src;
        script.async = false;
        script.dataset.zizUiNodePart = spec.key;
        document.head.appendChild(script);
      }
    });
  }

  function ensureLoaded() {
    if (uiPkg.node && typeof uiPkg.node.renderFlowChart === "function") {
      return Promise.resolve(uiPkg.node);
    }
    if (loadPromise) return loadPromise;

    loadPromise = scriptSpecs
      .reduce((promise, spec) => promise.then(() => loadScript(spec)), Promise.resolve())
      .then(() => uiPkg.node || {})
      .catch((error) => {
        loadPromise = null;
        throw error;
      });

    return loadPromise;
  }

  uiPkg.nodeLoader = { ensureLoaded };
})();
