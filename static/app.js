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
  const flowNameInput = document.getElementById("flowName");

  const CONNECTOR_EXPORT_ID = {
    BQConnector: "bigquery_connector",
    CSVConnector: "csv_connector",
    ExcelConnector: "excel_connector",
    OperationConnector: "operation_connector",
    ShellConnector: "shell_connector"
  };
  const IMPORT_CONNECTOR_ID = Object.fromEntries(
    Object.entries(CONNECTOR_EXPORT_ID).map(([uiId, exportId]) => [exportId, uiId])
  );

  function getFormSchema(config, connector, action) {
    return (config.forms && config.forms[`${connector}.${action}`]) || [];
  }

  function createLocalNodeId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return `node_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function inferNextStepSeq(nodes) {
    let max = 0;
    nodes.forEach((node) => {
      const m = String(node.stepName || "").match(/^step(\d+)$/);
      if (!m) return;
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > max) max = n;
    });
    return max + 1;
  }

  function parseYamlText(text) {
    const parser = window.jsyaml;
    if (!parser || typeof parser.load !== "function") {
      throw new Error("YAMLパーサーが見つかりません");
    }
    const data = parser.load(text);
    if (!data || typeof data !== "object") {
      throw new Error("YAMLの内容が不正です");
    }
    return data;
  }

  function buildStateFromYaml(data, config) {
    if (!Array.isArray(data.steps)) {
      throw new Error("steps が見つかりません");
    }
    if (!data.flows || !Array.isArray(data.flows.edges)) {
      throw new Error("flows.edges がない形式はインポートできません");
    }

    const nodes = [];
    const nodeByStep = new Map();
    data.steps.forEach((step, idx) => {
      const stepName = String(step.step_id || `step${idx + 1}`);
      if (nodeByStep.has(stepName)) {
        throw new Error(`step_id が重複しています: ${stepName}`);
      }

      const rawConnector = String(step.connector || "");
      const connector = IMPORT_CONNECTOR_ID[rawConnector] || rawConnector;
      const action = String(step.action || "");
      const actionSchema = (config.actions && config.actions[connector]) || [];
      const actionKnown = actionSchema.some((a) => a.id === action);
      const form = actionKnown && step.params && typeof step.params === "object"
        ? { ...step.params }
        : {};

      const node = {
        id: createLocalNodeId(),
        stepName,
        connector,
        action,
        form,
        parentId: null,
        parallelOf: null,
        parallelOrder: 1,
        outputs: [stepName]
      };

      nodeByStep.set(stepName, node);
      nodes.push(node);
    });

    const parentByStep = new Map();
    const orderByStep = new Map();
    const edges = data.flows.edges || [];
    edges.forEach((edge) => {
      const from = String(edge?.from || "");
      const to = String(edge?.to || "");
      if (!to || to === "END") return;
      if (!nodeByStep.has(to)) {
        throw new Error(`flows.edges.to が steps に存在しません: ${to}`);
      }

      const parentStep = from === "START" ? null : from;
      if (parentStep && !nodeByStep.has(parentStep)) {
        throw new Error(`flows.edges.from が steps に存在しません: ${from}`);
      }

      if (parentByStep.has(to) && parentByStep.get(to) !== parentStep) {
        throw new Error(`親が複数あるノードがあります: ${to}`);
      }
      parentByStep.set(to, parentStep);

      const order = Number(edge?.order);
      if (Number.isFinite(order) && order > 0) {
        orderByStep.set(to, order);
      }
    });

    const missingParents = nodes
      .map((n) => n.stepName)
      .filter((stepName) => !parentByStep.has(stepName));
    if (missingParents.length) {
      throw new Error(`flows.edges に接続が不足しています: ${missingParents.join(", ")}`);
    }

    nodes.forEach((node) => {
      const parentStep = parentByStep.get(node.stepName);
      node.parentId = parentStep ? nodeByStep.get(parentStep).id : null;
      node.parallelOrder = orderByStep.get(node.stepName) || 1;
    });

    const childrenByParentId = new Map();
    nodes.forEach((node) => {
      const key = node.parentId || "__START__";
      if (!childrenByParentId.has(key)) childrenByParentId.set(key, []);
      childrenByParentId.get(key).push(node);
    });
    childrenByParentId.forEach((children) => {
      children.sort((a, b) => a.parallelOrder - b.parallelOrder);
      const first = children[0];
      if (!first) return;
      first.parallelOf = null;
      first.parallelOrder = 1;
      for (let i = 1; i < children.length; i += 1) {
        children[i].parallelOf = first.id;
        children[i].parallelOrder = i + 1;
      }
    });

    return {
      state: {
        version: 3,
        nodes,
        selectedNodeId: nodes[0]?.id || null,
        nextStepSeq: inferNextStepSeq(nodes)
      },
      flowName: String(data.workflow_metadata?.name || "").trim()
    };
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

  function buildFlows(nodes) {
    const stepNameById = new Map(
      nodes.map((node, idx) => [node.id, String(node.stepName || `step${idx + 1}`)])
    );

    const childrenByParent = new Map();
    const parentKey = (id) => id || "__START__";
    nodes.forEach((node) => {
      const key = parentKey(node.parentId || null);
      if (!childrenByParent.has(key)) childrenByParent.set(key, []);
      childrenByParent.get(key).push(node);
    });
    childrenByParent.forEach((arr) => {
      arr.sort((a, b) => (Number(a.parallelOrder) || 0) - (Number(b.parallelOrder) || 0));
    });

    const edges = [];
    childrenByParent.forEach((children, key) => {
      const fromStep = key === "__START__" ? "START" : (stepNameById.get(key) || "START");
      children.forEach((child, idx) => {
        edges.push({
          from: fromStep,
          to: stepNameById.get(child.id) || "",
          order: idx + 1
        });
      });
    });

    const parentSet = new Set(nodes.map((n) => n.parentId).filter(Boolean));
    nodes
      .filter((n) => !parentSet.has(n.id))
      .forEach((leaf) => {
        edges.push({
          from: stepNameById.get(leaf.id) || "",
          to: "END",
          order: 0
        });
      });

    return {
      start: "START",
      end: "END",
      edges
    };
  }

  function validateRequiredFields(nodes, config) {
    const errors = [];
    nodes.forEach((node, idx) => {
      const schema = getFormSchema(config, node.connector, node.action);
      const stepId = String(node.stepName || `step${idx + 1}`);
      schema.forEach((field) => {
        if (!field.required) return;
        const hasExplicit = node.form && Object.prototype.hasOwnProperty.call(node.form, field.key);
        const v = hasExplicit ? node.form[field.key] : field.default;
        const empty = v === undefined || v === null || String(v).trim() === "";
        if (empty) {
          errors.push(`${stepId}: ${field.label || field.key}`);
        }
      });
    });
    return errors;
  }

  function getFlowName() {
    const name = String(flowNameInput?.value || "").trim();
    return name || "フロー１";
  }

  function toSafeFilename(name) {
    const safe = String(name || "")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, " ")
      .trim();
    return safe || "フロー１";
  }

  if (btnSave) {
    btnSave.addEventListener("click", () => {
      const requiredErrors = validateRequiredFields(state.nodes, CONFIG);
      if (requiredErrors.length) {
        window.alert(
          `必須パラメータが未入力です。\n\n${requiredErrors.join("\n")}`
        );
        return;
      }

      const payload = {
        workflow_metadata: {
          name: getFlowName()
        },
        steps: buildExportSteps(state.nodes, CONFIG),
        flows: buildFlows(state.nodes)
      };

      const fileName = `${toSafeFilename(getFlowName())}.yaml`;
      window.utils?.downloadYaml?.(fileName, payload);
    });
  }

  if (btnReset) {
    const importInput = document.createElement("input");
    importInput.type = "file";
    importInput.accept = ".yaml,.yml,text/yaml,text/x-yaml";
    importInput.style.display = "none";
    document.body.appendChild(importInput);

    btnReset.addEventListener("click", () => {
      importInput.value = "";
      importInput.click();
    });

    importInput.addEventListener("change", async () => {
      const file = importInput.files && importInput.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const yaml = parseYamlText(text);
        const imported = buildStateFromYaml(yaml, CONFIG);
        state = imported.state;
        if (flowNameInput && imported.flowName) {
          flowNameInput.value = imported.flowName;
        }
        onStateChanged();
      } catch (err) {
        window.alert(`インポートに失敗しました。\n${err?.message || err}`);
      }
    });
  }

  onStateChanged();
})();
