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
  const detailPanel = document.querySelector(".detail-panel");
  const mainRoot = document.querySelector("main");
  const bodyRoot = document.body;
  let importInput = null;
  const sidebarToggle = document.getElementById("sidebarToggle");
  const sidebarModeItems = Array.from(document.querySelectorAll("[data-app-mode]"));
  const sidebarActionItems = Array.from(document.querySelectorAll("[data-sidebar-action]"));
  const SIDEBAR_EXPANDED_CLASS = "sidebar-expanded";
  const APP_MODES = CONFIG.modes || {};
  const DEFAULT_APP_MODE = APP_MODES.workflow ? "workflow" : (Object.keys(APP_MODES)[0] || "workflow");
  const modeStates = {};
  let activeMode = DEFAULT_APP_MODE;
  let state;

  function normalizeAppMode(mode) {
    return APP_MODES[mode] ? mode : DEFAULT_APP_MODE;
  }

  function getModeMeta(mode) {
    const normalized = normalizeAppMode(mode);
    return APP_MODES[normalized] || {
      id: normalized,
      label: "フロー",
      defaultFlowName: "フロー１",
      fileExtension: ".ziz"
    };
  }

  function buildConfigForMode(mode) {
    const meta = getModeMeta(mode);
    const connectorIds = Array.isArray(meta.connectorIds) ? meta.connectorIds : [];
    const connectors = (CONFIG.connectors || []).filter((connector) => {
      return !connectorIds.length || connectorIds.includes(connector.id);
    });
    const actions = {};
    const forms = {};

    connectors.forEach((connector) => {
      if (CONFIG.actions?.[connector.id]) {
        actions[connector.id] = [...CONFIG.actions[connector.id]];
      }
    });

    Object.entries(CONFIG.forms || {}).forEach(([key, schema]) => {
      const connectorId = String(key).split(".")[0] || "";
      if (!connectorIds.length || connectorIds.includes(connectorId)) {
        forms[key] = schema;
      }
    });

    return {
      ...CONFIG,
      appMode: meta.id,
      connectors,
      actions,
      forms
    };
  }

  function createStateForMode(mode) {
    const normalized = normalizeAppMode(mode);
    const nextState = createDefaultState({ appMode: normalized });
    if (typeof nextState.flowName !== "string" || !nextState.flowName.trim()) {
      nextState.flowName = getModeMeta(normalized).defaultFlowName;
    }
    nextState.appMode = normalized;
    return nextState;
  }

  try {
    state = createStateForMode(activeMode);
    modeStates[activeMode] = state;
  } catch (err) {
    showFatal("??????????????", err);
    return;
  }

  function toConnectorExportId(connectorId) {
    return String(connectorId || "")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .toLowerCase();
  }

  function buildConnectorExportIdMap(config) {
    const out = {};
    const connectors = Array.isArray(config?.connectors) ? config.connectors : [];

    connectors.forEach((connector) => {
      const uiId = String(connector?.id || "").trim();
      if (!uiId) return;

      const exportId = String(connector?.exportId || toConnectorExportId(uiId)).trim();
      if (!exportId) return;

      out[uiId] = exportId;
    });

    return out;
  }

  const CONNECTOR_EXPORT_ID = buildConnectorExportIdMap(CONFIG);
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

  function normalizeStartParameters(raw) {
    if (Array.isArray(raw)) {
      return raw.map((item) => ({
        id: createLocalNodeId(),
        name: String(item?.name ?? item?.key ?? ""),
        value: String(item?.value ?? "")
      }));
    }
    if (raw && typeof raw === "object") {
      return Object.entries(raw).map(([name, value]) => ({
        id: createLocalNodeId(),
        name: String(name || ""),
        value: String(value ?? "")
      }));
    }
    return [];
  }

  function serializeStartParameters(items) {
    if (!Array.isArray(items)) return [];
    return items
      .map((item) => ({
        name: String(item?.name ?? "").trim(),
        value: String(item?.value ?? "")
      }))
      .filter((item) => item.name || item.value);
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
    if (!data || typeof data !== "object") {
      throw new Error("YAMLのルート構造が不正です");
    }
    if (!data.metadata || typeof data.metadata !== "object") {
      throw new Error("metadata が見つかりません");
    }
    if (!Array.isArray(data.steps)) {
      throw new Error("steps が見つかりません");
    }
    if (!data.flows || !Array.isArray(data.flows.edges)) {
      throw new Error("flows.edges がない形式はインポートできません");
    }

    const nodes = [];
    const nodeByStep = new Map();
    const startParameters = normalizeStartParameters(
      data.variables?.start
    );
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
      const hasDescription = Object.prototype.hasOwnProperty.call(step, "description");

      const node = {
        id: createLocalNodeId(),
        stepName,
        connector,
        action,
        description: hasDescription ? String(step.description ?? "") : "",
        descriptionAuto: !hasDescription,
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

    const rawMode = String(data.metadata?.mode || "").trim();
    if (!APP_MODES[rawMode]) {
      throw new Error(`metadata.mode が不正です: ${data.metadata?.mode || ""}`);
    }
    const importedMode = normalizeAppMode(rawMode);

    return {
      state: {
        version: 3,
        appMode: importedMode,
        flowName: String(data.metadata?.name || "").trim() || getModeMeta(importedMode).defaultFlowName,
        nodes,
        startParameters,
        selectedNodeId: nodes[0]?.id || null,
        nextStepSeq: inferNextStepSeq(nodes)
      }
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
        const hasExplicit = n.form && Object.prototype.hasOwnProperty.call(n.form, field.key);
        const v = hasExplicit ? n.form[field.key] : undefined;
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
      const description = typeof n.description === "string" ? n.description : "";

      if (description || n.descriptionAuto === false) exported.description = description;
      if (parallelOfStep) exported.parallel_of = parallelOfStep;
      return exported;
    });
  }

  function syncHeaderForMode() {
    if (!state) return;
    const meta = getModeMeta(state.appMode);
    bodyRoot.dataset.appMode = meta.id;
    if (flowNameInput && document.activeElement !== flowNameInput) {
      flowNameInput.value = state.flowName || meta.defaultFlowName;
    }
    if (flowNameInput) {
      flowNameInput.placeholder = meta.defaultFlowName;
      flowNameInput.setAttribute("aria-label", `${meta.label}名`);
    }
    if (btnSave) {
      btnSave.setAttribute("title", `${meta.label}を保存`);
      btnSave.setAttribute("aria-label", `${meta.label}を保存`);
    }
    if (btnReset) {
      btnReset.setAttribute("title", `${meta.label}をインポート`);
      btnReset.setAttribute("aria-label", `${meta.label}をインポート`);
    }
    if (importInput) {
      importInput.accept = ".zizw,.zizd,.zizq";
    }
  }

  function buildMetadataForMode(mode, name) {
    const meta = getModeMeta(mode);
    const base = {
      name,
      mode: meta.id,
      extension: meta.fileExtension || ".ziz"
    };

    if (meta.id === "workflow") {
      return {
        ...base,
        execution_model: "json",
        category: "automation"
      };
    }

    if (meta.id === "dataflow") {
      return {
        ...base,
        execution_model: "df",
        category: "etl"
      };
    }

    if (meta.id === "query-builder") {
      return {
        ...base,
        goal: "single_sql",
        step_unit: "cte"
      };
    }

    return base;
  }

  function buildVariablesPayload(startParameters) {
    return {
      start: serializeStartParameters(startParameters)
    };
  }

  function onStateChanged() {
    try {
      if (!state) return;
      state.appMode = normalizeAppMode(state.appMode);
      if (typeof state.flowName !== "string" || !state.flowName.trim()) {
        state.flowName = getModeMeta(state.appMode).defaultFlowName;
      }
      syncHeaderForMode();
      renderApp({ flowRoot, detailRoot, state, config: buildConfigForMode(state.appMode), onStateChanged });
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
        const useDefaultWhenUnset = field.key !== "input_data";
        const v = hasExplicit ? node.form[field.key] : (useDefaultWhenUnset ? field.default : "");
        const empty = v === undefined || v === null || String(v).trim() === "";
        if (empty) {
          errors.push(`${stepId}: ${field.label || field.key}`);
        }
      });
    });
    return errors;
  }

  function getFlowName() {
    const meta = getModeMeta(state?.appMode);
    const name = String(flowNameInput?.value || state?.flowName || "").trim();
    return name || meta.defaultFlowName || "フロー１";
  }

  function toSafeFilename(name) {
    const safe = String(name || "")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, " ")
      .trim();
    return safe || "フロー１";
  }

  function getDetailPanelHeightBounds() {
    const header = document.querySelector("header");
    const headerBox = header ? header.getBoundingClientRect() : null;
    const headerBottom = headerBox ? Math.max(0, Math.floor(headerBox.bottom)) : 76;
    const minH = 88;
    const maxH = Math.max(minH, Math.floor(window.innerHeight - headerBottom - 20));
    const midH = Math.max(minH, Math.floor((minH + maxH) / 2));
    return { minH, maxH, midH };
  }

  function applyDetailPanelHeight(px) {
    if (!detailPanel) return;
    const { minH, maxH } = getDetailPanelHeightBounds();
    const h = Math.max(minH, Math.min(maxH, Math.floor(px)));
    detailPanel.style.height = `${h}px`;
    if (mainRoot) mainRoot.style.paddingBottom = `${h + 20}px`;
    applyFlowViewportHeight();
  }

  function applyFlowViewportHeight() {
    if (!flowRoot || !detailPanel) return;
    const header = document.querySelector("header");
    const headerBox = header ? header.getBoundingClientRect() : null;
    const headerBottom = headerBox ? Math.max(0, Math.floor(headerBox.bottom)) : 76;
    const detailH = detailPanel.getBoundingClientRect().height || 300;
    const available = Math.floor(window.innerHeight - headerBottom - detailH - 24);
    flowRoot.style.height = `${Math.max(180, available)}px`;
  }

  function isSidebarExpanded() {
    return bodyRoot.classList.contains(SIDEBAR_EXPANDED_CLASS);
  }

  function applySidebarState(expanded) {
    bodyRoot.classList.toggle(SIDEBAR_EXPANDED_CLASS, Boolean(expanded));
    if (sidebarToggle) {
      sidebarToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    }

    window.requestAnimationFrame(() => {
      const current = detailPanel?.getBoundingClientRect().height || 300;
      applyDetailPanelHeight(current);
      applyFlowViewportHeight();
    });
  }

  function activateSidebarItem(targetMode = state?.appMode) {
    sidebarModeItems.forEach((item) => {
      const itemMode = String(item.dataset.appMode || "");
      const current = itemMode === targetMode;
      item.classList.toggle("is-current", current);
      if (current) {
        item.setAttribute("aria-current", "page");
      } else {
        item.removeAttribute("aria-current");
      }
    });

    sidebarActionItems.forEach((item) => {
      item.classList.remove("is-current");
      item.removeAttribute("aria-current");
    });
  }

  function setActiveMode(nextMode) {
    const normalized = normalizeAppMode(nextMode);
    if (state) {
      state.flowName = getFlowName();
      modeStates[state.appMode] = state;
    }
    activeMode = normalized;
    state = modeStates[normalized] || createStateForMode(normalized);
    state.appMode = normalized;
    modeStates[normalized] = state;
    activateSidebarItem(normalized);
    onStateChanged();
  }

  function setupSidebar() {
    if (sidebarToggle) {
      sidebarToggle.addEventListener("click", () => {
        applySidebarState(!isSidebarExpanded());
      });
    }

    sidebarModeItems.forEach((item) => {
      item.addEventListener("click", () => {
        const itemMode = String(item.dataset.appMode || "");
        if (APP_MODES[itemMode]) {
          setActiveMode(itemMode);
        }
        if (!isSidebarExpanded()) {
          applySidebarState(true);
        }
      });
    });

    sidebarActionItems.forEach((item) => {
      item.addEventListener("click", () => {
        item.classList.remove("is-current");
        item.removeAttribute("aria-current");
        item.blur?.();
        if (!isSidebarExpanded()) {
          applySidebarState(true);
        }
      });
    });
  }

  function toggleDetailPanelHeight() {
    if (!detailPanel) return;
    const { minH, midH } = getDetailPanelHeightBounds();
    const current = detailPanel.getBoundingClientRect().height || midH;
    const toMid = Math.abs(current - minH) <= 10;
    applyDetailPanelHeight(toMid ? midH : minH);
  }

  function setupDetailPanelResizer() {
    if (!detailPanel) return;

    applyDetailPanelHeight(detailPanel.getBoundingClientRect().height || 300);

    let dragging = false;
    let startY = 0;
    let startH = 0;

    detailPanel.addEventListener("mousedown", (e) => {
      const head = e.target.closest(".node-detail-meta");
      if (!head) return;
      if (e.target.closest("button, input, select, textarea, a, label")) return;
      dragging = true;
      startY = e.clientY;
      startH = detailPanel.getBoundingClientRect().height;
      document.body.style.userSelect = "none";
      e.preventDefault();
    });

    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const delta = startY - e.clientY;
      applyDetailPanelHeight(startH + delta);
    });

    window.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      document.body.style.userSelect = "";
    });

    window.addEventListener("resize", () => {
      const current = detailPanel.getBoundingClientRect().height || 300;
      applyDetailPanelHeight(current);
      applyFlowViewportHeight();
    });

    detailPanel.addEventListener("dblclick", (e) => {
      const hitNodeHead = e.target.closest(".node-detail-meta");
      if (!hitNodeHead) return;
      if (e.target.closest("button, input, select, textarea, a, label, .connector-flyout, .combo-field, .CodeMirror")) {
        return;
      }
      e.preventDefault();
      window.getSelection?.()?.removeAllRanges?.();
      toggleDetailPanelHeight();
    });
  }

  setupSidebar();
  activateSidebarItem(activeMode);
  setupDetailPanelResizer();
  applyFlowViewportHeight();

  if (flowNameInput) {
    flowNameInput.addEventListener("input", (e) => {
      if (!state) return;
      state.flowName = String(e.target.value || "");
    });
    flowNameInput.addEventListener("change", (e) => {
      if (!state) return;
      state.flowName = String(e.target.value || "").trim() || getModeMeta(state.appMode).defaultFlowName;
      syncHeaderForMode();
    });
  }

  if (btnSave) {
    btnSave.addEventListener("click", () => {
      const activeConfig = buildConfigForMode(state.appMode);
      const requiredErrors = validateRequiredFields(state.nodes, activeConfig);
      if (requiredErrors.length) {
        window.alert(
          `必須パラメータが未入力です。\n\n${requiredErrors.join("\n")}`
        );
        return;
      }

      const flowName = getFlowName();
      const variables = buildVariablesPayload(state.startParameters);

      const payload = {
        metadata: buildMetadataForMode(state.appMode, flowName),
        variables,
        steps: buildExportSteps(state.nodes, activeConfig),
        flows: buildFlows(state.nodes)
      };

      const fileName = `${toSafeFilename(flowName)}${getModeMeta(state.appMode).fileExtension || ".ziz"}`;
      window.utils?.downloadYaml?.(fileName, payload);
    });
  }

  if (btnReset) {
    importInput = document.createElement("input");
    importInput.type = "file";
    importInput.accept = ".zizw,.zizd,.zizq";
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
        const importedMode = normalizeAppMode(imported.state?.appMode);
        imported.state.appMode = importedMode;
        modeStates[importedMode] = imported.state;
        activeMode = importedMode;
        state = imported.state;
        activateSidebarItem(importedMode);
        onStateChanged();
      } catch (err) {
        window.alert(`インポートに失敗しました。\n${err?.message || err}`);
      }
    });
  }

  onStateChanged();
})();
