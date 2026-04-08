(function () {
  const packages = window.zizPackages || {};
  const corePkg = packages.core || {};
  const uiPkg = packages.ui || {};
  const CONFIG = corePkg.CONFIG || {};
  const stateOps = corePkg.stateOps || {};
  const renderer = uiPkg.renderer || {};
  const utils = corePkg.utils || {};
  const bridgeApi = corePkg.bridge || null;
  const dialogApi = corePkg.dialog || null;
  const createDefaultState = stateOps.createDefaultState;
  const renderApp = renderer.renderApp;
  const getFormSchema = utils.getFormSchema || ((config, connector, action) => (config.forms && config.forms[`${connector}.${action}`]) || []);

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
  const btnRun = document.getElementById("btnRun");
  const btnDiagnostics = document.getElementById("btnDiagnostics");
  const btnWindowMinimize = document.getElementById("btnWindowMinimize");
  const btnWindowMaximize = document.getElementById("btnWindowMaximize");
  const btnWindowClose = document.getElementById("btnWindowClose");
  const headerInner = document.querySelector(".header-inner");
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
  function showDialog(message, options = {}) {
    if (dialogApi?.show) {
      dialogApi.show(message, options);
      return;
    }
    window.alert(String(message ?? ""));
  }
  function getPerfNow() {
    return (window.performance && typeof window.performance.now === "function")
      ? window.performance.now()
      : Date.now();
  }
  async function logUiEvent(action, detail = {}, options = {}) {
    const source = options.source || "ui";
    const elapsedMs = Number.isFinite(options.elapsedMs) ? Number(options.elapsedMs) : null;
    const payload = {
      action: String(action || "unknown"),
      source: String(source || "ui"),
      detail: (detail && typeof detail === "object") ? detail : {},
    };
    if (elapsedMs !== null) {
      payload.elapsed_ms = Math.round(elapsedMs * 10) / 10;
    }
    console.info(`[ui-event] source=${payload.source} action=${payload.action}`, payload.detail || {});
    if (!bridgeApi?.available?.()) return;
    try {
      await bridgeApi.call("app.logUiEvent", payload);
    } catch (_) {
      // UI 操作ログ送信失敗で操作本体を止めない
    }
  }
  function describeButton(button) {
    if (!button) return "";
    return String(
      button.getAttribute("aria-label")
      || button.getAttribute("title")
      || button.textContent
      || button.id
      || button.className
      || "button"
    ).replace(/\s+/g, " ").trim();
  }
  let activeMode = DEFAULT_APP_MODE;
  let state;
  let currentRunId = "";
  let lastRunSummary = null;
  const homeViewModel = {
    visible: true,
    recentFiles: [],
    templates: [],
    refreshToken: 0,
  };

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
    nextState.hiddenBindings = {};
    nextState.fileName = "";
    nextState.stepStatuses = {};
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
        mergeParentIds: [],
        parallelOf: null,
        parallelOrder: 1,
        outputs: [stepName]
      };

      nodeByStep.set(stepName, node);
      nodes.push(node);
    });

    const incomingByStep = new Map();
    const edges = data.flows.edges || [];
    edges.forEach((edge, edgeIndex) => {
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
      if (!incomingByStep.has(to)) incomingByStep.set(to, []);
      incomingByStep.get(to).push({
        parentStep,
        order: Number(edge?.order),
        kind: String(edge?.kind || "").trim().toLowerCase(),
        edgeIndex
      });
    });

    const missingParents = nodes
      .map((n) => n.stepName)
      .filter((stepName) => !incomingByStep.has(stepName));
    if (missingParents.length) {
      throw new Error(`flows.edges に接続が不足しています: ${missingParents.join(", ")}`);
    }

    const orderByStep = new Map();
    nodes.forEach((node) => {
      const incoming = (incomingByStep.get(node.stepName) || []).slice().sort((a, b) => {
        const aPrimary = a.kind === "primary" ? 0 : a.kind === "merge" ? 1 : 0;
        const bPrimary = b.kind === "primary" ? 0 : b.kind === "merge" ? 1 : 0;
        if (aPrimary !== bPrimary) return aPrimary - bPrimary;
        const aOrder = Number.isFinite(a.order) && a.order > 0 ? a.order : Number.MAX_SAFE_INTEGER;
        const bOrder = Number.isFinite(b.order) && b.order > 0 ? b.order : Number.MAX_SAFE_INTEGER;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.edgeIndex - b.edgeIndex;
      });
      const primaryIncoming = incoming.find((edge) => edge.kind !== "merge") || incoming[0] || null;
      const mergeParents = incoming
        .filter((edge) => edge !== primaryIncoming)
        .map((edge) => edge.parentStep)
        .filter((parentStep) => !!parentStep);
      const parentStep = primaryIncoming ? primaryIncoming.parentStep : null;
      node.parentId = parentStep ? nodeByStep.get(parentStep).id : null;
      node.mergeParentIds = mergeParents
        .map((parentStep) => nodeByStep.get(parentStep)?.id || null)
        .filter(Boolean);
      if (primaryIncoming && Number.isFinite(primaryIncoming.order) && primaryIncoming.order > 0) {
        orderByStep.set(node.stepName, primaryIncoming.order);
      }
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
        pendingMergeSourceId: null,
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
    ensureBridgeState(state);
    bodyRoot.dataset.appMode = meta.id;
    bodyRoot.dataset.nativeFrame = bridgeApi?.available?.() ? "false" : "true";
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
    if (btnRun) {
      btnRun.setAttribute("title", `${meta.label}を実行`);
      btnRun.setAttribute("aria-label", `${meta.label}を実行`);
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
      ensureBridgeState(state);
      if (typeof state.flowName !== "string" || !state.flowName.trim()) {
        state.flowName = getModeMeta(state.appMode).defaultFlowName;
      }
      syncHeaderForMode();
      if (bodyRoot) {
        bodyRoot.dataset.homeVisible = homeViewModel.visible ? "true" : "false";
      }
      if (detailPanel) {
        detailPanel.hidden = !!homeViewModel.visible;
      }
      if (mainRoot) {
        mainRoot.style.paddingBottom = homeViewModel.visible ? "0px" : (detailPanel ? `${(detailPanel.getBoundingClientRect().height || 300) + 20}px` : "0px");
      }
      renderApp({
        flowRoot,
        detailRoot,
        state,
        config: buildConfigForMode(state.appMode),
        onStateChanged,
        homeViewModel,
        onHomeAction: handleHomeAction
      });
      applyFlowViewportHeight();
    } catch (err) {
      showFatal("???????????", err);
    }
  }

  function invalidateHomeRefresh() {
    homeViewModel.refreshToken += 1;
  }

  function hideHomeScreen() {
    homeViewModel.visible = false;
    invalidateHomeRefresh();
  }

  function showHomeFlag() {
    homeViewModel.visible = true;
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
          order: idx + 1,
          kind: "primary"
        });
      });
    });

    nodes.forEach((node) => {
      const targetStep = stepNameById.get(node.id) || "";
      const mergeParentIds = Array.isArray(node.mergeParentIds) ? node.mergeParentIds : [];
      mergeParentIds.forEach((parentId) => {
        const fromStep = stepNameById.get(parentId);
        if (!fromStep || !targetStep) return;
        edges.push({
          from: fromStep,
          to: targetStep,
          order: 0,
          kind: "merge"
        });
      });
    });

    const parentSet = new Set(nodes.map((n) => n.parentId).filter(Boolean));
    nodes.forEach((node) => {
      const mergeParentIds = Array.isArray(node.mergeParentIds) ? node.mergeParentIds : [];
      mergeParentIds.forEach((parentId) => {
        if (parentId) parentSet.add(parentId);
      });
    });
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

  function validateRequiredFieldsForNode(node, config) {
    if (!node) return [];
    const errors = [];
    const schema = getFormSchema(config, node.connector, node.action);
    const stepId = String(node.stepName || "step");
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

  function ensureBridgeState(targetState = state) {
    if (!targetState) return {};
    if (!targetState.hiddenBindings || typeof targetState.hiddenBindings !== "object" || Array.isArray(targetState.hiddenBindings)) {
      targetState.hiddenBindings = {};
    }
    if (typeof targetState.fileName !== "string") {
      targetState.fileName = "";
    }
    return targetState.hiddenBindings;
  }

  function buildCompiledFlowPayload(targetState = state) {
    const activeConfig = buildConfigForMode(targetState.appMode);
    return {
      metadata: buildMetadataForMode(targetState.appMode, getFlowName()),
      variables: buildVariablesPayload(targetState.startParameters),
      steps: buildExportSteps(targetState.nodes, activeConfig),
      flows: buildFlows(targetState.nodes)
    };
  }

  function applyImportedFlowState(importedState, options = {}) {
    const importedMode = normalizeAppMode(options.mode || importedState?.appMode);
    importedState.appMode = importedMode;
    importedState.hiddenBindings = (options.hiddenBindings && typeof options.hiddenBindings === "object") ? options.hiddenBindings : {};
    importedState.fileName = String(options.fileName || "");
    importedState.stepStatuses = {};
      modeStates[importedMode] = importedState;
      activeMode = importedMode;
      state = importedState;
      hideHomeScreen();
      activateSidebarItem(importedMode);
      onStateChanged();
    }

  async function refreshHomeLists() {
    const startedAt = getPerfNow();
    if (!bridgeApi?.available?.()) {
      homeViewModel.recentFiles = [];
      homeViewModel.templates = [];
      await logUiEvent("home.refresh.skipped", {}, { source: "startup", elapsedMs: getPerfNow() - startedAt });
      return;
    }
    try {
      await logUiEvent("home.refresh.start", {}, { source: "startup" });
      const [recentPayload, templatePayload] = await Promise.all([
        bridgeApi.call("flow.list", { scope: "local", kind: "recent" }),
        bridgeApi.call("flow.list", { scope: "local", kind: "template" })
      ]);
      homeViewModel.recentFiles = Array.isArray(recentPayload?.items) ? recentPayload.items.slice(0, 10) : [];
      homeViewModel.templates = Array.isArray(templatePayload?.items) ? templatePayload.items : [];
      await logUiEvent("home.refresh.done", {
        recent_count: homeViewModel.recentFiles.length,
        template_count: homeViewModel.templates.length,
      }, { source: "startup", elapsedMs: getPerfNow() - startedAt });
    } catch (err) {
      console.error("failed to refresh home lists", err);
      homeViewModel.recentFiles = [];
      homeViewModel.templates = [];
      await logUiEvent("home.refresh.failed", {
        message: err?.message || String(err || ""),
      }, { source: "startup", elapsedMs: getPerfNow() - startedAt });
    }
  }

  async function handleHomeAction(action) {
    const type = String(action?.type || "");
    if (type === "dismiss-home") {
      hideHomeScreen();
      onStateChanged();
      return;
    }
    if (type === "open-flow") {
      const token = String(action?.item?.flow_token || "");
      if (!token || !bridgeApi?.available?.()) return;
      try {
        const payload = await bridgeApi.call("flow.load", { ref: token });
        if (!payload || payload.selected === false) return;
        const imported = buildStateFromYaml(payload.flow, CONFIG);
        applyImportedFlowState(imported.state, {
          mode: payload.mode,
          fileName: payload.file_name,
          hiddenBindings: payload.hidden_bindings || {}
        });
        await refreshHomeLists();
      } catch (err) {
        showDialog(`読み込みに失敗しました。\n${err?.message || err}`, { kind: "error", title: "読込エラー" });
      }
    }
  }

  async function showHomeScreen() {
    const startedAt = getPerfNow();
    showHomeFlag();
    const token = ++homeViewModel.refreshToken;
    await refreshHomeLists();
    if (homeViewModel.visible && token === homeViewModel.refreshToken) {
      onStateChanged();
    }
    await logUiEvent("home.show", {}, { source: "navigation", elapsedMs: getPerfNow() - startedAt });
  }

  async function handleBridgeLoad() {
    const startedAt = getPerfNow();
    const payload = await bridgeApi.call("flow.load", { ref: null });
    if (!payload || payload.selected === false) return;
    const imported = buildStateFromYaml(payload.flow, CONFIG);
    applyImportedFlowState(imported.state, {
      mode: payload.mode,
      fileName: payload.file_name,
      hiddenBindings: payload.hidden_bindings || {}
    });
    await refreshHomeLists();
    await logUiEvent("flow.load", {
      file_name: payload.file_name || "",
      mode: payload.mode || "",
    }, { source: "button", elapsedMs: getPerfNow() - startedAt });
  }

  async function handleBridgeSave() {
    const startedAt = getPerfNow();
    ensureBridgeState(state);
    const flowName = getFlowName();
    const derivedName = `${toSafeFilename(flowName)}${getModeMeta(state.appMode).fileExtension || ".ziz"}`;
    const fileName = derivedName || state.fileName || `フロー${getModeMeta(state.appMode).fileExtension || ".ziz"}`;
    console.info("[save] bridge.request", {
      mode: state.appMode,
      file_name: fileName,
      step_count: Array.isArray(state.nodes) ? state.nodes.length : 0
    });
    const payload = await bridgeApi.call("flow.save", {
      mode: state.appMode,
      file_name: fileName,
      flow: buildCompiledFlowPayload(state)
    });
    console.info("[save] bridge.response", payload || null);
    if (payload && payload.saved === false) {
      showDialog("保存はキャンセルされました。", { kind: "info", title: "保存" });
      return payload;
    }
    if (payload && payload.saved) {
      state.fileName = String(payload.file_name || fileName);
    }
    await refreshHomeLists();
    await logUiEvent("flow.save", {
      file_name: payload?.file_name || fileName,
      mode: state.appMode,
    }, { source: "button", elapsedMs: getPerfNow() - startedAt });
    return payload;
  }

  async function fetchRunSummary(runId) {
    if (!runId || !bridgeApi?.available?.()) return null;
    const summary = await bridgeApi.call("result.getSummary", { run_id: runId });
    currentRunId = runId;
    lastRunSummary = summary || null;
    window.__zizLastRunSummary = lastRunSummary;
    return lastRunSummary;
  }

  async function fetchBridgeStatus() {
    const startedAt = getPerfNow();
    if (!bridgeApi?.available?.()) return null;
    const status = await bridgeApi.call("app.getStatus", {});
    window.__zizBridgeStatus = status || null;
    await logUiEvent("diagnostics.fetch", {}, { source: "button", elapsedMs: getPerfNow() - startedAt });
    return status || null;
  }

  function formatBridgeDiagnostics(status) {
    if (!status) return "診断情報を取得できませんでした。";
    const security = status.security || {};
    const policies = status.security_policies || {};
    const lines = [
      `host: ${status.host || "-"}`,
      `gui_mode: ${status.gui_mode || "-"}`,
      `external_requests_blocked: ${security.external_requests_blocked ? "ON" : "OFF"}`,
      `navigation_locked: ${security.navigation_locked ? "ON" : "OFF"}`,
      `devtools_context_menu_disabled: ${security.devtools_context_menu_disabled ? "ON" : "OFF"}`,
      `devtools_enabled: ${security.devtools_enabled ? "ON" : "OFF"}`,
      `remote_debugging_disabled: ${security.remote_debugging_disabled ? "ON" : "OFF"}`,
      `security_policies_loaded: ${policies.loaded ? "ON" : "OFF"}`,
      `api_profile_count: ${Number(policies.api_profile_count || 0)}`,
      `web_allowlist_count: ${Number(policies.web_allowlist_count || 0)}`
    ];
    return lines.join("\n");
  }

  async function handleBridgeRun(source = "header", options = {}) {
    const startedAt = getPerfNow();
    if (!bridgeApi?.available?.()) {
      showDialog("この実行操作は WebView モードでのみ利用できます。", { kind: "info", title: "実行" });
      return null;
    }
    const activeConfig = buildConfigForMode(state.appMode);
    const targetNodeId = String(options.nodeId || "");
    const targetNode = targetNodeId
      ? state.nodes.find((node) => String(node?.id || "") === targetNodeId) || null
      : null;
    if (targetNode) {
      const inputRef = String(targetNode?.form?.input_data || "").trim();
      if (inputRef && !String(window.__zizCurrentRunId || "").trim()) {
        showDialog("入力データを使うステップを単体実行するには、先にフロー全体を一度実行してください。", { kind: "info", title: "ステップ実行" });
        return null;
      }
    }
    const requiredErrors = targetNode
      ? validateRequiredFieldsForNode(targetNode, activeConfig)
      : validateRequiredFields(state.nodes, activeConfig);
    if (requiredErrors.length) {
      showDialog(`必須パラメータが未入力です。\n\n${requiredErrors.join("\n")}`, { kind: "warning", title: "入力確認" });
      return null;
    }
    if (!targetNode) {
      state.stepStatuses = {};
    } else {
      if (!state.stepStatuses || typeof state.stepStatuses !== "object") {
        state.stepStatuses = {};
      }
      state.stepStatuses[String(targetNode.stepName || "")] = "running";
    }
    const request = {
      mode: state.appMode,
      flow: buildCompiledFlowPayload(state)
    };
    if (targetNode) {
      request.step_id = String(targetNode.stepName || "");
      request.source_run_id = String(window.__zizCurrentRunId || "");
    }
    const payload = await bridgeApi.call("flow.run", request);
    currentRunId = String(payload?.run_id || "");
    window.__zizCurrentRunId = currentRunId;
    console.info(`[webview-run] accepted source=${source} run_id=${currentRunId}`);
    await logUiEvent("flow.run", {
      source,
      run_id: currentRunId,
      step_id: request.step_id || "",
    }, { source: "button", elapsedMs: getPerfNow() - startedAt });
    return payload;
  }

  function logBridgeEvent(message) {
    const payload = message?.payload || {};
    if (message?.type === "run.log") {
      const level = String(payload.level || "INFO").toLowerCase();
      const writer = console[level] || console.info;
      writer.call(console, `[run:${payload.run_id || "-"}] ${payload.message || ""}`);
      return;
    }
    if (message?.type === "run.progress") {
      console.info(`[run:${payload.run_id || "-"}] ${payload.message || payload.stage || "progress"}`);
    }
  }

  async function handleBridgeEvent(event) {
    const message = event?.detail;
    if (!message || message.kind !== "evt") return;
    logBridgeEvent(message);
    const payload = message.payload || {};
    if (message.type === "run.stepStatus") {
      if (!state.stepStatuses || typeof state.stepStatuses !== "object") {
        state.stepStatuses = {};
      }
      state.stepStatuses[String(payload.step_id || "")] = String(payload.status || "");
      onStateChanged();
      return;
    }
    if (message.type === "run.completed") {
      const summary = await fetchRunSummary(payload.run_id);
      if (summary) {
        console.info(`[run:${payload.run_id || "-"}] 完了: ${summary.flow_name || ""}`);
      }
      onStateChanged();
      return;
    }
    if (message.type === "run.failed") {
      await fetchRunSummary(payload.run_id);
      onStateChanged();
    }
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
    if (homeViewModel.visible) {
      const available = Math.floor(window.innerHeight - headerBottom - 24);
      flowRoot.style.height = `${Math.max(320, available)}px`;
      return;
    }
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
    hideHomeScreen();
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
        showHomeScreen().catch((error) => {
          console.error("failed to show home screen", error);
          showHomeFlag();
          onStateChanged();
        });
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
    btnSave.addEventListener("click", async () => {
      console.info("[save] click", {
        appMode: state?.appMode || "",
        bridge: !!bridgeApi?.available?.(),
        flowName: state?.flowName || ""
      });
      try {
        const activeConfig = buildConfigForMode(state.appMode);
        const requiredErrors = validateRequiredFields(state.nodes, activeConfig);
        console.info("[save] validate", { errorCount: requiredErrors.length });
        if (requiredErrors.length) {
          showDialog(
            `必須パラメータが未入力です。\n\n${requiredErrors.join("\n")}`,
            { kind: "warning", title: "入力確認" }
          );
          return;
        }

        if (bridgeApi?.available?.()) {
          console.info("[save] bridge.begin");
          await handleBridgeSave();
          console.info("[save] bridge.done");
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
        console.info("[save] browser.download", { fileName });
        utils?.downloadYaml?.(fileName, payload);
      } catch (err) {
        console.error("[save] failed", err);
        showDialog(`保存に失敗しました。\n${err?.message || err}`, { kind: "error", title: "保存エラー" });
      }
    });
  }

  if (btnReset) {
    importInput = document.createElement("input");
    importInput.type = "file";
    importInput.accept = ".zizw,.zizd,.zizq";
    importInput.style.display = "none";
    document.body.appendChild(importInput);

    btnReset.addEventListener("click", async () => {
      if (bridgeApi?.available?.()) {
        try {
          await handleBridgeLoad();
        } catch (err) {
          showDialog(`インポートに失敗しました。\n${err?.message || err}`, { kind: "error", title: "インポートエラー" });
        }
        return;
      }
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
        applyImportedFlowState(imported.state, {
          mode: imported.state?.appMode,
          hiddenBindings: {},
          fileName: file.name
        });
      } catch (err) {
        showDialog(`インポートに失敗しました。\n${err?.message || err}`, { kind: "error", title: "インポートエラー" });
      }
    });
  }

  if (btnRun) {
    btnRun.addEventListener("click", async () => {
      try {
        await handleBridgeRun("header");
      } catch (err) {
        showDialog(`実行に失敗しました。\n${err?.message || err}`, { kind: "error", title: "実行エラー" });
      }
    });
  }

  if (btnDiagnostics) {
    btnDiagnostics.addEventListener("click", async () => {
      try {
        const status = await fetchBridgeStatus();
        showDialog(formatBridgeDiagnostics(status), { kind: "info", title: "診断", format: "kv" });
      } catch (err) {
        showDialog(`診断情報の取得に失敗しました。\n${err?.message || err}`, { kind: "error", title: "診断エラー" });
      }
    });
  }

  async function handleWindowControl(action) {
    if (!bridgeApi?.available?.()) return;
    try {
      await bridgeApi.call("app.windowControl", { action });
    } catch (err) {
      console.error("[window-control] failed", action, err);
    }
  }

  if (btnWindowMinimize) {
    btnWindowMinimize.addEventListener("click", () => {
      void handleWindowControl("minimize");
    });
  }

  if (btnWindowMaximize) {
    btnWindowMaximize.addEventListener("click", () => {
      void handleWindowControl("maximize");
    });
  }

  if (btnWindowClose) {
    btnWindowClose.addEventListener("click", () => {
      void handleWindowControl("close");
    });
  }

  if (headerInner) {
    headerInner.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      if (!bridgeApi?.available?.()) return;
      if (event.target.closest("button, input, select, textarea, a, label")) return;
      void handleWindowControl("drag");
    });
  }

  window.addEventListener("ziz:evt", (event) => {
    handleBridgeEvent(event).catch((error) => {
      console.error("bridge event handling failed", error);
    });
  });

  window.addEventListener("zizai:node-run-request", (event) => {
    const detail = event?.detail || {};
    const options = detail.mode === "through" ? {} : { nodeId: detail.nodeId };
    handleBridgeRun("node", options).catch((error) => {
      showDialog(`実行に失敗しました。\n${error?.message || error}`, { kind: "error", title: "実行エラー" });
    });
  });

  window.addEventListener("ziz:bridge-ready", () => {
    logUiEvent("bridge.ready", {}, { source: "startup" });
    refreshHomeLists().then(() => onStateChanged()).catch(() => onStateChanged());
  });

  document.addEventListener("click", (event) => {
    const button = event.target?.closest?.("button");
    if (!button) return;
    logUiEvent("button.click", {
      id: button.id || "",
      label: describeButton(button),
    }, { source: "button" });
  }, true);

  document.addEventListener("keydown", (event) => {
    const ctrlOrMeta = !!(event.ctrlKey || event.metaKey);
    if (!ctrlOrMeta) return;
    if (event.defaultPrevented) return;

    const key = String(event.key || "").toLowerCase();
    if (key === "s") {
      event.preventDefault();
      btnSave?.click?.();
      return;
    }
    if (key === "enter") {
      event.preventDefault();
      btnRun?.click?.();
    }
  });

  if (bridgeApi?.available?.()) {
    refreshHomeLists().then(() => onStateChanged()).catch(() => onStateChanged());
  }

  onStateChanged();
})();
