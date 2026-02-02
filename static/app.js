(function () {
  const CONFIG = window.CONFIG;
  const { createDefaultState } = window.stateOps;
  const { renderApp } = window.renderer;
  const { downloadText } = window.utils;

  let state = createDefaultState();

  const nodesRoot = document.getElementById("nodes");
  const btnSave = document.getElementById("btnSave");
  const btnReset = document.getElementById("btnReset");

  function onStateChanged() {
    renderApp({ root: nodesRoot, state, config: CONFIG, onStateChanged });
  }

  btnSave.addEventListener("click", () => {
    const payload = {
      configVersion: CONFIG.version,
      savedAt: new Date().toISOString(),
      flow: state
    };
    downloadText("flow.json", JSON.stringify(payload, null, 2));
  });

  btnReset.addEventListener("click", () => {
    state = createDefaultState();
    onStateChanged();
  });

  onStateChanged();
})();
