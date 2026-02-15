(function () {
  const CONFIG = window.CONFIG || {};
  const stateOps = window.stateOps || {};
  const renderer = window.renderer || {};
  const createDefaultState = stateOps.createDefaultState;
  const renderApp = renderer.renderApp;

  function showFatal(message, err) {
    console.error(message, err || "");
    const host = document.querySelector("main") || document.body;
    if (!host) return;

    const box = document.createElement("div");
    box.className = "flow-fallback";
    box.textContent = `${message}${err ? ` (${err.message || err})` : ""}`;
    host.prepend(box);
  }

  if (typeof createDefaultState !== "function") {
    showFatal("state.js ????????????");
    return;
  }

  if (typeof renderApp !== "function") {
    showFatal("renderer ????????????");
    return;
  }

  let state;
  try {
    state = createDefaultState();
  } catch (err) {
    showFatal("??????????????", err);
    return;
  }

  const flowRoot = document.getElementById("flowchart") || document.getElementById("nodes");
  let detailRoot = document.getElementById("nodeDetail");

  if (!detailRoot && flowRoot && flowRoot.parentElement) {
    detailRoot = document.createElement("div");
    detailRoot.id = "nodeDetail";
    flowRoot.parentElement.appendChild(detailRoot);
  }

  if (!flowRoot || !detailRoot) {
    showFatal("??????(#flowchart / #nodeDetail)????????");
    return;
  }

  const btnSave = document.getElementById("btnSave");
  const btnReset = document.getElementById("btnReset");

  const CONNECTOR_EXPORT_ID = {
    BQConnector: "bigquery_connector",
    CSVConnector: "csv_connector",
    ExcelConnector: "excel_connector",
    OperationConnector: "operation_connector",
    ShellConnector: "shell_connector"
  };

  function getFormSchema(config, connector, action) {
    return (config.forms && config.forms[`${connector}.${action}`]) || [];
  }

  function buildExportSteps(nodes, config) {
    const stepNameById = new Map(
      nodes.map((node, idx) => [node.id, String(node.stepName || `step${idx + 1}`)])
    );

    return nodes.map((n, idx) => {
      const stepId = String(n.stepName || `step${idx + 1}`);
      const action = String(n.action || "");
      const connector = CONNECTOR_EXPORT_ID[n.connector] || String(n.connector || "");
      const parallelOfStep = n.parallelOf ? stepNameById.get(n.parallelOf) : null;

      const schema = getFormSchema(config, n.connector, n.action);
      const params = {};
      for (const field of schema) {
        const v = n.form?.[field.key];
        if (v !== undefined && v !== "") {
          params[field.key] = v;
        } else if (field.default !== undefined) {
          params[field.key] = field.default;
        }
      }

      if (action === "read_excel" && params.path !== undefined && params.file_path === undefined) {
        params.file_path = params.path;
        delete params.path;
      }

      if (action === "write_excel" && typeof params.input_data === "string") {
        if (params.input_data === stepId && idx > 0) {
          params.input_data = String(nodes[idx - 1].stepName || `step${idx}`);
        }
      }

      const exported = {
        step_id: stepId,
        connector,
        action,
        params,
        output_variable: stepId
      };

      if (parallelOfStep) exported.parallel_of = parallelOfStep;
      return exported;
    });
  }

  function onStateChanged() {
    try {
      renderApp({ flowRoot, detailRoot, state, config: CONFIG, onStateChanged });
    } catch (err) {
      showFatal("???????????", err);
    }
  }

  if (btnSave) {
    btnSave.addEventListener("click", () => {
      const payload = {
        workflow_metadata: {
          name: "CLI?????????"
        },
        steps: buildExportSteps(state.nodes, CONFIG)
      };

      window.utils?.downloadYaml?.("flow.yaml", payload);
    });
  }

  if (btnReset) {
    btnReset.addEventListener("click", () => {
      state = createDefaultState();
      onStateChanged();
    });
  }

  onStateChanged();
})();
