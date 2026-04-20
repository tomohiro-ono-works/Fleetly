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
  const shellApi = window.zizShell || {};
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
  let detailBottomRoot = document.getElementById("nodeDetailBottom") || detailRoot;

  if (!detailRoot && flowRoot && flowRoot.parentElement) {
    detailRoot = document.createElement("div");
    detailRoot.id = "nodeDetail";
    flowRoot.parentElement.appendChild(detailRoot);
  }

  if (!detailBottomRoot) detailBottomRoot = detailRoot;
  if (!detailRoot) detailRoot = detailBottomRoot;

  if (!flowRoot || (!detailRoot && !detailBottomRoot)) {
    showFatal("描画先(#flowchart / #nodeDetail)が見つかりません");
    return;
  }

  const btnSave = document.getElementById("btnSave");
  const btnReset = document.getElementById("btnReset");
  const btnRun = document.getElementById("btnRun");
  const btnDiagnostics = document.getElementById("btnDiagnostics");
  const flowNameInput = document.getElementById("flowName");
  const detailPanel = document.querySelector(".detail-panel");
  const mainRoot = document.querySelector("main");
  const bodyRoot = document.body;
  const rightSidebarRefs = shellApi.getRightSidebarRefs?.() || {};
  const rightSidebar = rightSidebarRefs.container || document.getElementById("rightSidebar");
  const rightSidebarRail = rightSidebarRefs.rail || document.getElementById("rightSidebarRail");
  const rightSidebarToggle = rightSidebarRefs.toggle || document.getElementById("rightSidebarToggle");
  const rightSidebarResizer = rightSidebarRefs.resizer || document.getElementById("rightSidebarResizer");
  const detailPanelResizer = document.getElementById("detailPanelResizer");
  const splitDetailLayout = !!detailRoot && !!detailBottomRoot && detailBottomRoot !== detailRoot;
  const bodyDataset = bodyRoot?.dataset || {};
  const urlParams = new URLSearchParams(window.location.search);
  let importInput = null;
  const APP_MODES = CONFIG.modes || {};
  const DEFAULT_APP_MODE = APP_MODES.dataflow ? "dataflow" : (Object.keys(APP_MODES)[0] || "dataflow");
  const STORAGE_KEYS = {
    modeStates: "ziz.modeStates.v1",
    pendingFlow: "ziz.pendingFlow.v1",
  };
  const modeStates = {};
  let persistTimer = 0;
  const HISTORY_MAX_DIFFS_PER_SNAPSHOT = 30;
  const historyByMode = {};
  let historyApplying = false;

  function cloneValue(value) {
    if (typeof window.structuredClone === "function") {
      try {
        return window.structuredClone(value);
      } catch (_) {
        // fallback below
      }
    }
    return JSON.parse(JSON.stringify(value ?? null));
  }

  function isPlainObject(value) {
    return !!value && Object.prototype.toString.call(value) === "[object Object]";
  }

  function toHistoryComparableState(targetState) {
    const source = targetState && typeof targetState === "object" ? targetState : {};
    return {
      version: Number(source.version) || 3,
      appMode: String(source.appMode || ""),
      flowName: String(source.flowName || ""),
      nodes: cloneValue(Array.isArray(source.nodes) ? source.nodes : []),
      stickyNotes: cloneValue(Array.isArray(source.stickyNotes) ? source.stickyNotes : []),
      startParameters: cloneValue(Array.isArray(source.startParameters) ? source.startParameters : []),
      nextStepSeq: Number(source.nextStepSeq) || 1,
      hiddenBindings: cloneValue(source.hiddenBindings && typeof source.hiddenBindings === "object" ? source.hiddenBindings : {}),
      fileName: String(source.fileName || "")
    };
  }

  function buildHistoryStore(targetState) {
    const baseline = toHistoryComparableState(targetState);
    return {
      baseSnapshot: cloneValue(baseline),
      lastState: cloneValue(baseline),
      undoStack: [],
      redoStack: []
    };
  }

  function getActiveHistoryStore() {
    const mode = normalizeAppMode(state?.appMode || activeMode);
    if (!historyByMode[mode]) {
      historyByMode[mode] = buildHistoryStore(state);
    }
    return historyByMode[mode];
  }

  function resetHistoryStoreForMode(mode, targetState) {
    const normalized = normalizeAppMode(mode || activeMode);
    historyByMode[normalized] = buildHistoryStore(targetState);
  }

  function syncHistoryBaseline(targetState = state) {
    const store = getActiveHistoryStore();
    const current = toHistoryComparableState(targetState);
    store.lastState = cloneValue(current);
    if (!store.baseSnapshot) {
      store.baseSnapshot = cloneValue(current);
    }
  }

  function buildForwardBackwardDiff(beforeValue, afterValue) {
    const forward = [];
    const backward = [];

    function pushSet(path, value) {
      return { kind: "set", path: [...path], value: cloneValue(value) };
    }

    function pushDelete(path) {
      return { kind: "delete", path: [...path] };
    }

    function walk(beforeItem, afterItem, path) {
      if (Object.is(beforeItem, afterItem)) return;

      if (Array.isArray(beforeItem) && Array.isArray(afterItem)) {
        if (beforeItem.length !== afterItem.length) {
          forward.push(pushSet(path, afterItem));
          backward.push(pushSet(path, beforeItem));
          return;
        }
        for (let i = 0; i < beforeItem.length; i += 1) {
          walk(beforeItem[i], afterItem[i], [...path, i]);
        }
        return;
      }

      if (isPlainObject(beforeItem) && isPlainObject(afterItem)) {
        const keys = new Set([...Object.keys(beforeItem), ...Object.keys(afterItem)]);
        keys.forEach((key) => {
          const hasBefore = Object.prototype.hasOwnProperty.call(beforeItem, key);
          const hasAfter = Object.prototype.hasOwnProperty.call(afterItem, key);
          const childPath = [...path, key];
          if (hasBefore && !hasAfter) {
            forward.push(pushDelete(childPath));
            backward.push(pushSet(childPath, beforeItem[key]));
            return;
          }
          if (!hasBefore && hasAfter) {
            forward.push(pushSet(childPath, afterItem[key]));
            backward.push(pushDelete(childPath));
            return;
          }
          if (hasBefore && hasAfter) {
            walk(beforeItem[key], afterItem[key], childPath);
          }
        });
        return;
      }

      forward.push(pushSet(path, afterItem));
      backward.push(pushSet(path, beforeItem));
    }

    walk(beforeValue, afterValue, []);
    if (!forward.length) return null;
    return { forward, backward };
  }

  function resolveOpParent(target, path, createMissing) {
    let node = target;
    for (let i = 0; i < path.length; i += 1) {
      const segment = path[i];
      if (!node || (typeof node !== "object" && !Array.isArray(node))) return null;
      if (Object.prototype.hasOwnProperty.call(node, segment)) {
        node = node[segment];
        continue;
      }
      if (!createMissing) return null;
      const nextSegment = path[i + 1];
      const placeholder = typeof nextSegment === "number" ? [] : {};
      node[segment] = placeholder;
      node = placeholder;
    }
    return node;
  }

  function applyOp(target, op) {
    const path = Array.isArray(op?.path) ? op.path : [];
    if (!path.length) {
      if (op?.kind !== "set") return;
      const nextRoot = cloneValue(op.value);
      if (!isPlainObject(nextRoot)) return;
      Object.keys(target).forEach((key) => {
        delete target[key];
      });
      Object.entries(nextRoot).forEach(([key, value]) => {
        target[key] = value;
      });
      return;
    }

    const parent = resolveOpParent(target, path.slice(0, -1), op?.kind === "set");
    if (!parent || (typeof parent !== "object" && !Array.isArray(parent))) return;
    const key = path[path.length - 1];
    if (op?.kind === "set") {
      parent[key] = cloneValue(op.value);
      return;
    }
    if (Array.isArray(parent) && typeof key === "number") {
      if (key >= 0 && key < parent.length) {
        parent.splice(key, 1);
      }
      return;
    }
    delete parent[key];
  }

  function applyOps(target, operations) {
    (operations || []).forEach((operation) => applyOp(target, operation));
  }

  function trimHistoryDiffs(store) {
    if (!store) return;
    while (store.undoStack.length > HISTORY_MAX_DIFFS_PER_SNAPSHOT) {
      const dropped = store.undoStack.shift();
      applyOps(store.baseSnapshot, dropped?.forward || []);
    }
  }

  function recordHistoryDiff(targetState = state) {
    const store = getActiveHistoryStore();
    const current = toHistoryComparableState(targetState);
    const previous = store.lastState || current;
    const diff = buildForwardBackwardDiff(previous, current);
    store.lastState = cloneValue(current);
    if (!diff) return false;
    store.undoStack.push(diff);
    store.redoStack = [];
    trimHistoryDiffs(store);
    return true;
  }

  function canUndo() {
    const store = getActiveHistoryStore();
    return !!(store && store.undoStack.length);
  }

  function canRedo() {
    const store = getActiveHistoryStore();
    return !!(store && store.redoStack.length);
  }

  function applyUndo() {
    const store = getActiveHistoryStore();
    if (!store || !store.undoStack.length || !state) return false;
    const diff = store.undoStack.pop();
    if (!diff) return false;
    historyApplying = true;
    try {
      applyOps(state, diff.backward);
      store.redoStack.push(diff);
      syncHistoryBaseline(state);
    } finally {
      historyApplying = false;
    }
    return true;
  }

  function applyRedo() {
    const store = getActiveHistoryStore();
    if (!store || !store.redoStack.length || !state) return false;
    const diff = store.redoStack.pop();
    if (!diff) return false;
    historyApplying = true;
    try {
      applyOps(state, diff.forward);
      store.undoStack.push(diff);
      syncHistoryBaseline(state);
    } finally {
      historyApplying = false;
    }
    return true;
  }

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
  const RIGHT_PANEL_KEYS = ["detail", "yaml", "variables", "log"];
  let activeRightPanel = "detail";
  let currentRunId = "";
  const runKindById = Object.create(null);
  let lastRunSummary = null;
  let stateChangeFrameId = 0;
  let pendingStateChangeOptions = null;
  let stepStatusFlushTimer = 0;
  const pendingStepStatuses = {};
  let lastHeaderSyncSignature = "";
  let lastRightPanelSyncKey = "";
  let successStatusResetObserver = null;
  const renderPerf = {
    count: 0,
    totalMs: 0,
    lastMs: 0,
    maxMs: 0,
    lastAt: ""
  };
  window.__zizRenderPerf = renderPerf;
  const homeViewModel = {
    visible: String(bodyDataset.homeVisible || "false").toLowerCase() === "true",
    recentFiles: [],
    templates: [],
    refreshToken: 0,
  };

  function refreshFlowStatusOnly() {
    const uiNode = ((window.zizPackages || {}).ui || {}).node || window.uiNode || {};
    if (typeof uiNode.refreshFlowStatus === "function") {
      uiNode.refreshFlowStatus({ root: flowRoot, state });
    }
  }

  function clearStepStatusesForVisuals() {
    if (!state || !state.stepStatuses || typeof state.stepStatuses !== "object") return;
    if (!Object.keys(state.stepStatuses).length) return;
    state.stepStatuses = {};
    refreshFlowStatusOnly();
  }

  function armSuccessStatusResetOnDialogClose() {
    const dialogRoot = document.getElementById("appDialog");
    if (!dialogRoot) {
      clearStepStatusesForVisuals();
      return;
    }
    if (successStatusResetObserver) {
      successStatusResetObserver.disconnect();
      successStatusResetObserver = null;
    }
    successStatusResetObserver = new MutationObserver(() => {
      if (dialogRoot.classList.contains("is-open")) return;
      if (successStatusResetObserver) {
        successStatusResetObserver.disconnect();
        successStatusResetObserver = null;
      }
      clearStepStatusesForVisuals();
    });
    successStatusResetObserver.observe(dialogRoot, {
      attributes: true,
      attributeFilter: ["class", "aria-hidden"],
    });
  }

  function showRunCompletedDialog(summary, runId) {
    const flowName = String(summary?.flow_name || state?.flowName || "フロー");
    armSuccessStatusResetOnDialogClose();
    showDialog(`${flowName} の実行が完了しました。`, { kind: "success", title: "実行完了" });
    console.info(`[run:${runId || "-"}] 実行完了ダイアログを表示`);
  }

  function mergeStateChangeOptions(base, incoming) {
    const baseHistory = base ? base.history !== false : false;
    const incomingHistory = incoming ? incoming.history !== false : true;
    return {
      history: baseHistory || incomingHistory
    };
  }

  function runOnStateChanged(options = {}) {
    const startedAt = getPerfNow();
    try {
      if (!state) return;
      state.appMode = normalizeAppMode(state.appMode);
      ensureBridgeState(state);
      if (typeof state.flowName !== "string" || !state.flowName.trim()) {
        state.flowName = getModeMeta(state.appMode).defaultFlowName;
      }
      const nodeIds = new Set((Array.isArray(state.nodes) ? state.nodes : []).map((node) => String(node?.id || "")));
      const selectedNodeId = String(state.selectedNodeId || "");
      if (!selectedNodeId || !nodeIds.has(selectedNodeId)) {
        state.selectedNodeId = state.nodes?.[0]?.id || null;
      }
      const pendingMergeSourceId = String(state.pendingMergeSourceId || "");
      if (pendingMergeSourceId && !nodeIds.has(pendingMergeSourceId)) {
        state.pendingMergeSourceId = null;
      }
      const shouldRecordHistory = options.history !== false;
      if (shouldRecordHistory && !historyApplying) {
        recordHistoryDiff(state);
      } else {
        syncHistoryBaseline(state);
      }
      syncHeaderForMode();
      if (bodyRoot) {
        bodyRoot.dataset.homeVisible = homeViewModel.visible ? "true" : "false";
      }
      if (detailPanel) {
        detailPanel.hidden = !!homeViewModel.visible;
      }
      if (rightSidebar) {
        rightSidebar.hidden = !!homeViewModel.visible;
      }
      if (rightSidebarRail) {
        rightSidebarRail.hidden = !!homeViewModel.visible;
      }
      if (mainRoot) {
        if (splitDetailLayout) {
          mainRoot.style.paddingBottom = homeViewModel.visible ? "0px" : "";
        } else {
          mainRoot.style.paddingBottom = homeViewModel.visible ? "0px" : (detailPanel ? `${(detailPanel.getBoundingClientRect().height || 300) + 20}px` : "0px");
        }
      }
      if (lastRightPanelSyncKey !== activeRightPanel) {
        lastRightPanelSyncKey = activeRightPanel;
        shellApi.setActiveRightPanel?.(activeRightPanel);
      }
      renderApp({
        flowRoot,
        detailRoot,
        detailBottomRoot,
        rightPanelTab: activeRightPanel,
        state,
        config: buildConfigForMode(state.appMode),
        onStateChanged,
        homeViewModel,
        onHomeAction: handleHomeAction
      });
      applyFlowViewportHeight();
      schedulePersistModeStates();
    } catch (err) {
      showFatal("???????????", err);
    } finally {
      const elapsed = Math.max(0, Number(getPerfNow() - startedAt) || 0);
      renderPerf.count += 1;
      renderPerf.totalMs += elapsed;
      renderPerf.lastMs = elapsed;
      renderPerf.maxMs = Math.max(renderPerf.maxMs, elapsed);
      renderPerf.lastAt = new Date().toISOString();
      renderPerf.avgMs = renderPerf.count > 0 ? (renderPerf.totalMs / renderPerf.count) : 0;
    }
  }

  function onStateChanged(options = {}) {
    pendingStateChangeOptions = mergeStateChangeOptions(pendingStateChangeOptions, options);
    if (stateChangeFrameId) return;
    stateChangeFrameId = window.requestAnimationFrame(() => {
      stateChangeFrameId = 0;
      const nextOptions = pendingStateChangeOptions || { history: true };
      pendingStateChangeOptions = null;
      runOnStateChanged(nextOptions);
    });
  }

  function flushStepStatusUpdates(options = {}) {
    if (stepStatusFlushTimer) {
      window.clearTimeout(stepStatusFlushTimer);
      stepStatusFlushTimer = 0;
    }
    const entries = Object.entries(pendingStepStatuses);
    if (!entries.length) return false;
    if (!state.stepStatuses || typeof state.stepStatuses !== "object") {
      state.stepStatuses = {};
    }
    entries.forEach(([stepId, status]) => {
      state.stepStatuses[stepId] = status;
      delete pendingStepStatuses[stepId];
    });
    const needsFullRender = !!options.forceRender;
    if (needsFullRender) {
      onStateChanged({ history: false });
    } else {
      const uiNode = ((window.zizPackages || {}).ui || {}).node || window.uiNode || {};
      if (typeof uiNode.refreshFlowStatus === "function") {
        uiNode.refreshFlowStatus({ root: flowRoot, state });
      }
    }
    return true;
  }

  function queueStepStatus(stepId, status) {
    const key = String(stepId || "").trim();
    if (!key) return;
    pendingStepStatuses[key] = String(status || "");
    if (stepStatusFlushTimer) return;
    stepStatusFlushTimer = window.setTimeout(() => {
      stepStatusFlushTimer = 0;
      flushStepStatusUpdates();
    }, 120);
  }

  function normalizeAppMode(mode) {
    return APP_MODES[mode] ? mode : DEFAULT_APP_MODE;
  }

  function parseSupportedModes(value) {
    const seen = new Set();
    const items = String(value || "")
      .split(",")
      .map((item) => normalizeAppMode(String(item || "").trim()))
      .filter((item) => APP_MODES[item]);
    return items.filter((item) => {
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    });
  }

  const PAGE_SUPPORTED_MODES = (() => {
    const fromBody = parseSupportedModes(bodyDataset.supportedModes);
    return fromBody.length ? fromBody : [DEFAULT_APP_MODE];
  })();

  function pageSupportsMode(mode) {
    return PAGE_SUPPORTED_MODES.includes(normalizeAppMode(mode));
  }

  function getInitialMode() {
    const requested = String(urlParams.get("mode") || bodyDataset.initialMode || DEFAULT_APP_MODE).trim();
    const normalized = normalizeAppMode(requested);
    return pageSupportsMode(normalized) ? normalized : (PAGE_SUPPORTED_MODES[0] || DEFAULT_APP_MODE);
  }

  activeMode = getInitialMode();

  function readSessionJson(key) {
    try {
      const raw = window.sessionStorage?.getItem?.(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function writeSessionJson(key, value) {
    try {
      if (value === undefined) return;
      window.sessionStorage?.setItem?.(key, JSON.stringify(value));
    } catch (_) {
      // ignore storage failures
    }
  }

  function removeSessionValue(key) {
    try {
      window.sessionStorage?.removeItem?.(key);
    } catch (_) {
      // ignore storage failures
    }
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
    nextState.stickyNotes = normalizeStickyNotes(nextState.stickyNotes);
    nextState.hiddenBindings = {};
    nextState.fileName = "";
    nextState.stepStatuses = {};
    return nextState;
  }

  function normalizePersistedState(mode, savedState) {
    if (!savedState || typeof savedState !== "object" || Array.isArray(savedState)) {
      return null;
    }

    const normalized = normalizeAppMode(mode);
    const baseState = createStateForMode(normalized);
    const restoredNodes = Array.isArray(savedState.nodes) && savedState.nodes.length
      ? savedState.nodes
      : baseState.nodes;
    const selectedNodeId = String(savedState.selectedNodeId || "").trim();
    const hasSelectedNode = restoredNodes.some((node) => String(node?.id || "") === selectedNodeId);
    const pendingMergeSourceId = String(savedState.pendingMergeSourceId || "").trim();
    const hasPendingMergeNode = restoredNodes.some((node) => String(node?.id || "") === pendingMergeSourceId);

    return {
      ...baseState,
      ...savedState,
      version: Number(savedState.version) || baseState.version,
      appMode: normalized,
      flowName: String(savedState.flowName || "").trim() || baseState.flowName,
      nodes: restoredNodes,
      stickyNotes: normalizeStickyNotes(savedState.stickyNotes),
      startParameters: Array.isArray(savedState.startParameters) ? savedState.startParameters : baseState.startParameters,
      selectedNodeId: hasSelectedNode ? selectedNodeId : (restoredNodes[0]?.id || baseState.selectedNodeId || null),
      pendingMergeSourceId: hasPendingMergeNode ? pendingMergeSourceId : null,
      nextStepSeq: Number.isFinite(Number(savedState.nextStepSeq)) && Number(savedState.nextStepSeq) > 0
        ? Number(savedState.nextStepSeq)
        : baseState.nextStepSeq,
      hiddenBindings: (savedState.hiddenBindings && typeof savedState.hiddenBindings === "object" && !Array.isArray(savedState.hiddenBindings))
        ? savedState.hiddenBindings
        : {},
      fileName: String(savedState.fileName || ""),
      stepStatuses: (savedState.stepStatuses && typeof savedState.stepStatuses === "object" && !Array.isArray(savedState.stepStatuses))
        ? savedState.stepStatuses
        : {}
    };
  }

  function restoreModeStates() {
    const saved = readSessionJson(STORAGE_KEYS.modeStates);
    if (!saved || typeof saved !== "object") return;
    Object.entries(saved).forEach(([mode, savedState]) => {
      const normalized = normalizeAppMode(mode);
      if (!APP_MODES[normalized] || !savedState || typeof savedState !== "object") return;
      const restored = normalizePersistedState(normalized, savedState);
      if (restored) {
        modeStates[normalized] = restored;
      }
    });
  }

  function persistModeStates() {
    if (state) {
      state.flowName = getFlowName();
      modeStates[state.appMode] = state;
    }
    writeSessionJson(STORAGE_KEYS.modeStates, modeStates);
  }

  function schedulePersistModeStates() {
    window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => {
      persistTimer = 0;
      persistModeStates();
    }, 180);
  }

  function storePendingImportedFlow(payload) {
    writeSessionJson(STORAGE_KEYS.pendingFlow, payload);
  }

  function consumePendingImportedFlow() {
    const payload = readSessionJson(STORAGE_KEYS.pendingFlow);
    removeSessionValue(STORAGE_KEYS.pendingFlow);
    return payload;
  }

  function toAbsolutePageUrl(relativeUrl) {
    try {
      return new URL(String(relativeUrl || ""), window.location.href).toString();
    } catch (_) {
      return String(relativeUrl || "");
    }
  }

  function buildPageUrlForMode(mode) {
    const normalized = normalizeAppMode(mode);
    if (normalized === "dataflow" || normalized === "dataflow") {
      const dataflowUrl = bodyDataset.dataflowUrl || "./dataflow.html";
      const target = new URL(dataflowUrl, window.location.href);
      if (normalized === "dataflow") {
        target.searchParams.set("mode", "dataflow");
      } else {
        target.searchParams.delete("mode");
      }
      return target.toString();
    }
    if (normalized === "query-builder") {
      return toAbsolutePageUrl(bodyDataset.queryBuilderUrl || "./query-builder.html");
    }
    return "";
  }

  function navigateToUrl(url) {
    const target = String(url || "").trim();
    if (!target) return false;
    persistModeStates();
    window.location.href = target;
    return true;
  }

  function navigateToMode(mode, options = {}) {
    const targetUrl = buildPageUrlForMode(mode);
    if (!targetUrl) return false;
    if (options.pendingFlow) {
      storePendingImportedFlow(options.pendingFlow);
    }
    return navigateToUrl(targetUrl);
  }

  try {
    restoreModeStates();
    state = createStateForMode(activeMode);
    state = modeStates[activeMode] || state;
    state.appMode = activeMode;
    modeStates[activeMode] = state;
    resetHistoryStoreForMode(activeMode, state);
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

  function normalizeCanvasPosition(value) {
    if (!value || typeof value !== "object") return null;
    const x = Number(value.x);
    const y = Number(value.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return {
      x: Math.max(8, Math.round(x)),
      y: Math.max(8, Math.round(y))
    };
  }

  function normalizeStickyNote(value) {
    if (!value || typeof value !== "object") return null;
    const id = String(value.id || "").trim();
    const x = Number(value.x);
    const y = Number(value.y);
    const w = Number(value.w);
    const h = Number(value.h);
    if (!id) return null;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) return null;
    return {
      id,
      x: Math.max(8, Math.round(x)),
      y: Math.max(8, Math.round(y)),
      w: Math.max(120, Math.round(w)),
      h: Math.max(72, Math.round(h)),
      text: String(value.text || ""),
      color: String(value.color || "#fff2a8"),
      anchorNodeId: value.anchorNodeId ? String(value.anchorNodeId) : null
    };
  }

  function normalizeStickyNotes(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => normalizeStickyNote(item))
      .filter(Boolean);
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
      const canvasPosition = normalizeCanvasPosition(step.ui_position);

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
      if (canvasPosition) node.canvasPosition = canvasPosition;

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
    const stickyNotes = normalizeStickyNotes(data.notes);

    return {
      state: {
        version: 3,
        appMode: importedMode,
        flowName: String(data.metadata?.name || "").trim() || getModeMeta(importedMode).defaultFlowName,
        nodes,
        stickyNotes,
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
      const canvasPosition = normalizeCanvasPosition(n.canvasPosition);
      const description = typeof n.description === "string" ? n.description : "";

      if (description || n.descriptionAuto === false) exported.description = description;
      if (parallelOfStep) exported.parallel_of = parallelOfStep;
      if (canvasPosition) exported.ui_position = canvasPosition;
      return exported;
    });
  }

  function buildExportNotes(stickyNotes) {
    return normalizeStickyNotes(stickyNotes).map((note) => ({
      id: note.id,
      x: note.x,
      y: note.y,
      w: note.w,
      h: note.h,
      text: note.text,
      color: note.color,
      anchorNodeId: note.anchorNodeId || null
    }));
  }

  function syncHeaderForMode() {
    if (!state) return;
    const meta = getModeMeta(state.appMode);
    ensureBridgeState(state);
    bodyRoot.dataset.appMode = meta.id;
    bodyRoot.dataset.nativeFrame = bridgeApi?.available?.() ? "false" : "true";
    const undoEnabled = canUndo();
    const redoEnabled = canRedo();
    const nextHeaderPayload = {
      value: state.flowName || meta.defaultFlowName,
      placeholder: meta.defaultFlowName,
      ariaLabel: `${meta.label}名`,
      readOnly: false,
      undo: {
        title: "戻る",
        ariaLabel: "戻る",
        disabled: !undoEnabled,
      },
      redo: {
        title: "進む",
        ariaLabel: "進む",
        disabled: !redoEnabled,
      },
      save: {
        title: `${meta.label}を保存`,
        ariaLabel: `${meta.label}を保存`,
      },
      run: {
        title: `${meta.label}を実行`,
        ariaLabel: `${meta.label}を実行`,
      },
      reset: {
        title: `${meta.label}をインポート`,
        ariaLabel: `${meta.label}をインポート`,
      },
    };
    const nextHeaderSignature = JSON.stringify(nextHeaderPayload);
    if (nextHeaderSignature !== lastHeaderSyncSignature) {
      lastHeaderSyncSignature = nextHeaderSignature;
      shellApi.updateHeader?.(nextHeaderPayload);
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

    // if (meta.id === "dataflow") {
    //   return {
    //     ...base,
    //     execution_model: "json",
    //     category: "automation"
    //   };
    // }

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
    if (!Array.isArray(targetState.stickyNotes)) {
      targetState.stickyNotes = [];
    } else {
      targetState.stickyNotes = normalizeStickyNotes(targetState.stickyNotes);
    }
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
      flows: buildFlows(targetState.nodes),
      notes: buildExportNotes(targetState.stickyNotes)
    };
  }

  function applyImportedFlowState(importedState, options = {}) {
    const importedMode = normalizeAppMode(options.mode || importedState?.appMode);
    importedState.appMode = importedMode;
    importedState.stickyNotes = normalizeStickyNotes(importedState.stickyNotes);
    importedState.hiddenBindings = (options.hiddenBindings && typeof options.hiddenBindings === "object") ? options.hiddenBindings : {};
    importedState.fileName = String(options.fileName || "");
    importedState.stepStatuses = {};
    modeStates[importedMode] = importedState;
    activeMode = importedMode;
    state = importedState;
    resetHistoryStoreForMode(importedMode, importedState);
    hideHomeScreen();
    shellApi.setActiveSidebar?.(importedMode);
    onStateChanged({ history: false });
  }

  function applyLoadedFlowPayload(payload) {
    if (!payload || payload.selected === false) return false;
    const imported = buildStateFromYaml(payload.flow, CONFIG);
    const importedMode = normalizeAppMode(payload.mode || imported.state?.appMode);
    const pendingPayload = {
      mode: importedMode,
      file_name: String(payload.file_name || ""),
      flow: payload.flow,
      hidden_bindings: payload.hidden_bindings || {}
    };

    if (!pageSupportsMode(importedMode)) {
      navigateToMode(importedMode, { pendingFlow: pendingPayload });
      return false;
    }

    applyImportedFlowState(imported.state, {
      mode: importedMode,
      fileName: payload.file_name,
      hiddenBindings: payload.hidden_bindings || {}
    });
    return true;
  }

  function restorePendingImportedFlow() {
    const pending = consumePendingImportedFlow();
    if (!pending || typeof pending !== "object") return;
    const pendingMode = normalizeAppMode(pending.mode);
    if (!pageSupportsMode(pendingMode)) {
      storePendingImportedFlow(pending);
      navigateToMode(pendingMode);
      return;
    }
    applyLoadedFlowPayload({
      ...pending,
      selected: true
    });
  }

  async function refreshHomeLists() {
    const startedAt = getPerfNow();
    if (!bridgeApi?.available?.() || !homeViewModel.visible) {
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
      if (!setActiveMode("dataflow")) {
        hideHomeScreen();
        onStateChanged({ history: false });
      }
      return;
    }
    if (type === "create-flow") {
      if (!setActiveMode("dataflow")) {
        hideHomeScreen();
        onStateChanged({ history: false });
      }
      return;
    }
    if (type === "create-sql") {
      if (!setActiveMode("query-builder")) {
        navigateToUrl(toAbsolutePageUrl(bodyDataset.queryBuilderUrl || "./query-builder.html"));
      }
      return;
    }
    if (type === "open-flow") {
      const token = String(action?.item?.flow_token || "");
      if (!token || !bridgeApi?.available?.()) return;
      try {
        const payload = await bridgeApi.call("flow.load", { ref: token });
        const applied = applyLoadedFlowPayload(payload);
        if (applied) {
          await refreshHomeLists();
        }
      } catch (err) {
        showDialog(`読み込みに失敗しました。\n${err?.message || err}`, { kind: "error", title: "読込エラー" });
      }
    }
  }

  async function showHomeScreen() {
    if (!homeViewModel.visible && bodyDataset.homeUrl) {
      navigateToUrl(toAbsolutePageUrl(bodyDataset.homeUrl));
      return;
    }
    const startedAt = getPerfNow();
    showHomeFlag();
    const token = ++homeViewModel.refreshToken;
    await refreshHomeLists();
    if (homeViewModel.visible && token === homeViewModel.refreshToken) {
      onStateChanged({ history: false });
    }
    await logUiEvent("home.show", {}, { source: "navigation", elapsedMs: getPerfNow() - startedAt });
  }

  async function handleBridgeLoad() {
    const startedAt = getPerfNow();
    const payload = await bridgeApi.call("flow.load", { ref: null });
    const applied = applyLoadedFlowPayload(payload);
    if (!applied) return;
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
    const requiredErrors = targetNode
      ? validateRequiredFieldsForNode(targetNode, activeConfig)
      : validateRequiredFields(state.nodes, activeConfig);
    if (requiredErrors.length) {
      showDialog(`必須パラメータが未入力です。\n\n${requiredErrors.join("\n")}`, { kind: "warning", title: "入力確認" });
      return null;
    }
    if (stepStatusFlushTimer) {
      window.clearTimeout(stepStatusFlushTimer);
      stepStatusFlushTimer = 0;
    }
    Object.keys(pendingStepStatuses).forEach((stepId) => {
      delete pendingStepStatuses[stepId];
    });
    state.stepStatuses = {};
    if (targetNode) {
      state.stepStatuses[String(targetNode.stepName || "")] = "running";
    }
    refreshFlowStatusOnly();
    const request = {
      mode: state.appMode,
      flow: buildCompiledFlowPayload(state)
    };
    if (targetNode) {
      request.step_id = String(targetNode.stepName || "");
    }
    const payload = await bridgeApi.call("flow.run", request);
    currentRunId = String(payload?.run_id || "");
    if (currentRunId) {
      runKindById[currentRunId] = targetNode ? "single" : "flow";
    }
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
      queueStepStatus(payload.step_id, payload.status);
      return;
    }
    if (message.type === "run.completed") {
      flushStepStatusUpdates();
      const summary = await fetchRunSummary(payload.run_id);
      if (summary) {
        console.info(`[run:${payload.run_id || "-"}] 完了: ${summary.flow_name || ""}`);
      }
      const completedRunId = String(payload.run_id || "");
      const runKind = runKindById[completedRunId] || "flow";
      delete runKindById[completedRunId];
      if (runKind === "flow") {
        showRunCompletedDialog(summary, payload.run_id);
      }
      refreshFlowStatusOnly();
      return;
    }
    if (message.type === "run.failed") {
      flushStepStatusUpdates();
      await fetchRunSummary(payload.run_id);
      const failedRunId = String(payload.run_id || "");
      delete runKindById[failedRunId];
      refreshFlowStatusOnly();
    }
  }

  function getDetailPanelHeightBounds() {
    const minH = 88;
    if (splitDetailLayout && mainRoot) {
      const rootHeight = Math.max(240, Math.floor(mainRoot.getBoundingClientRect().height || 0));
      const maxH = Math.max(minH, Math.floor(rootHeight * 0.75));
      const midH = Math.max(minH, Math.floor((minH + maxH) / 2));
      return { minH, maxH, midH };
    }
    const header = document.querySelector("header");
    const headerBox = header ? header.getBoundingClientRect() : null;
    const headerBottom = headerBox ? Math.max(0, Math.floor(headerBox.bottom)) : 76;
    const maxH = Math.max(minH, Math.floor(window.innerHeight - headerBottom - 20));
    const midH = Math.max(minH, Math.floor((minH + maxH) / 2));
    return { minH, maxH, midH };
  }

  function applyDetailPanelHeight(px) {
    if (!detailPanel) return;
    const { minH, maxH } = getDetailPanelHeightBounds();
    const h = Math.max(minH, Math.min(maxH, Math.floor(px)));
    detailPanel.style.height = `${h}px`;
    if (!splitDetailLayout && mainRoot) mainRoot.style.paddingBottom = `${h + 20}px`;
    applyFlowViewportHeight();
  }

  function applyFlowViewportHeight() {
    if (!flowRoot || !detailPanel) return;
    if (splitDetailLayout && mainRoot) {
      const mainHeight = Math.floor(mainRoot.getBoundingClientRect().height || 0);
      if (homeViewModel.visible) {
        flowRoot.style.height = `${Math.max(320, mainHeight - 8)}px`;
        return;
      }
      const detailH = detailPanel.hidden ? 0 : (detailPanel.getBoundingClientRect().height || 300);
      const available = Math.floor(mainHeight - detailH - 10);
      flowRoot.style.height = `${Math.max(180, available)}px`;
      return;
    }
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

  function setActiveMode(nextMode) {
    const normalized = normalizeAppMode(nextMode);
    if (!pageSupportsMode(normalized)) {
      return navigateToMode(normalized);
    }
    hideHomeScreen();
    if (state) {
      state.flowName = getFlowName();
      modeStates[state.appMode] = state;
    }
    activeMode = normalized;
    state = modeStates[normalized] || createStateForMode(normalized);
    state.appMode = normalized;
    modeStates[normalized] = state;
    if (!historyByMode[normalized]) {
      resetHistoryStoreForMode(normalized, state);
    } else {
      syncHistoryBaseline(state);
    }
    shellApi.setActiveSidebar?.(normalized);
    onStateChanged({ history: false });
    return true;
  }

  function handleUndoAction() {
    if (!applyUndo()) return false;
    onStateChanged({ history: false });
    return true;
  }

  function handleRedoAction() {
    if (!applyRedo()) return false;
    onStateChanged({ history: false });
    return true;
  }

  function setupSidebar() {
    shellApi.bindSidebar?.({
      onToggle: () => {
        showHomeScreen().catch((error) => {
          console.error("failed to show home screen", error);
          showHomeFlag();
          onStateChanged({ history: false });
        });
      },
      onModeItem: ({ mode: itemMode, navUrl, expanded }) => {
        if (navUrl) {
          navigateToUrl(navUrl);
        } else if (APP_MODES[itemMode]) {
          setActiveMode(itemMode);
        }
        if (!expanded) {
          shellApi.setSidebarExpanded?.(true, () => {
            const current = detailPanel?.getBoundingClientRect().height || 300;
            applyDetailPanelHeight(current);
            applyFlowViewportHeight();
          });
        }
      },
      onActionItem: ({ item, navUrl, expanded }) => {
        if (navUrl) {
          navigateToUrl(navUrl);
          return;
        }
        item.classList.remove("is-current");
        item.removeAttribute("aria-current");
        item.blur?.();
        if (!expanded) {
          shellApi.setSidebarExpanded?.(true, () => {
            const current = detailPanel?.getBoundingClientRect().height || 300;
            applyDetailPanelHeight(current);
            applyFlowViewportHeight();
          });
        }
      },
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

    const beginDrag = (e) => {
      if (detailPanelResizer) {
        if (e.target !== detailPanelResizer && !e.target.closest("#detailPanelResizer")) return;
      } else {
        const head = e.target.closest(".node-detail-meta");
        if (!head) return;
      }
      if (e.target.closest("button, input, select, textarea, a, label")) return;
      dragging = true;
      startY = e.clientY;
      startH = detailPanel.getBoundingClientRect().height;
      document.body.style.userSelect = "none";
      e.preventDefault();
    };

    detailPanel.addEventListener("mousedown", beginDrag);
    if (detailPanelResizer) {
      detailPanelResizer.addEventListener("mousedown", beginDrag);
    }

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

    const dblclickTarget = detailPanelResizer || detailPanel;
    dblclickTarget.addEventListener("dblclick", (e) => {
      if (!detailPanelResizer) {
        const hitNodeHead = e.target.closest(".node-detail-meta");
        if (!hitNodeHead) return;
      }
      if (e.target.closest("button, input, select, textarea, a, label, .connector-flyout, .combo-field")) {
        return;
      }
      e.preventDefault();
      window.getSelection?.()?.removeAllRanges?.();
      toggleDetailPanelHeight();
    });
  }

  function getRightSidebarWidthBounds() {
    const FIXED_RIGHT_SIDEBAR = {
      initial: 400,
      min: 300,
      maxViewportRatio: 0.5
    };
    const appShell = document.querySelector(".app-shell");
    const leftSidebar = document.querySelector(".sidebar");
    const rightRail = rightSidebarRail || document.querySelector(".right-sidebar-rail");
    const shellWidth = Math.floor(appShell?.getBoundingClientRect().width || window.innerWidth);
    const leftWidth = Math.floor(leftSidebar?.getBoundingClientRect().width || 0);
    const rightRailWidth = Math.floor(rightRail?.getBoundingClientRect().width || 0);
    const available = Math.max(240, shellWidth - leftWidth - rightRailWidth);
    const viewportMax = Math.max(1, Math.floor(window.innerWidth * FIXED_RIGHT_SIDEBAR.maxViewportRatio));
    const max = Math.min(viewportMax, available);
    const min = Math.min(FIXED_RIGHT_SIDEBAR.min, max);
    const initial = Math.max(min, Math.min(FIXED_RIGHT_SIDEBAR.initial, max));
    return {
      min,
      max,
      initial
    };
  }

  function setupRightSidebar() {
    if (!splitDetailLayout || !rightSidebar || !rightSidebarToggle || !rightSidebarRail) return;

    let currentWidth = getRightSidebarWidthBounds().initial;
    shellApi.setRightSidebarCollapsed?.(false);
    shellApi.setRightSidebarWidth?.(currentWidth);

    function applyRightSidebarWidth(nextWidthPx) {
      const bounds = getRightSidebarWidthBounds();
      const width = Math.max(bounds.min, Math.min(bounds.max, Math.floor(nextWidthPx)));
      currentWidth = width;
      shellApi.setRightSidebarWidth?.(width, () => {
        applyFlowViewportHeight();
      });
      return { bounds, width };
    }

    function openRightSidebar(widthPx) {
      const bounds = getRightSidebarWidthBounds();
      const requested = Number(widthPx);
      const target = Number.isFinite(requested) ? requested : (currentWidth || bounds.initial);
      shellApi.setRightSidebarCollapsed?.(false, () => {
        applyRightSidebarWidth(target);
      });
    }

    function closeRightSidebar() {
      shellApi.setRightSidebarCollapsed?.(true, () => {
        applyFlowViewportHeight();
      });
    }

    shellApi.bindRightSidebar?.({
      onToggle: ({ event }) => {
        event.preventDefault();
        if (shellApi.isRightSidebarCollapsed?.()) {
          openRightSidebar();
        } else {
          closeRightSidebar();
        }
      },
      onPanelItem: ({ panel }) => {
        const key = String(panel || "").trim();
        if (!RIGHT_PANEL_KEYS.includes(key)) return;
        activeRightPanel = key;
        shellApi.setActiveRightPanel?.(activeRightPanel);
        if (shellApi.isRightSidebarCollapsed?.()) {
          openRightSidebar();
        }
        onStateChanged({ history: false });
      }
    });
    shellApi.setActiveRightPanel?.(activeRightPanel);

    if (rightSidebarResizer) {
      let dragging = false;
      let startX = 0;
      let startWidth = 0;

      rightSidebarResizer.addEventListener("mousedown", (event) => {
        if (shellApi.isRightSidebarCollapsed?.()) {
          openRightSidebar();
        }
        dragging = true;
        startX = event.clientX;
        startWidth = rightSidebar.getBoundingClientRect().width || currentWidth;
        document.body.style.userSelect = "none";
        event.preventDefault();
      });

      window.addEventListener("mousemove", (event) => {
        if (!dragging) return;
        const delta = startX - event.clientX;
        const nextWidth = startWidth + delta;
        const { bounds } = applyRightSidebarWidth(nextWidth);
        if (nextWidth < bounds.min) {
          dragging = false;
          document.body.style.userSelect = "";
          closeRightSidebar();
        }
      });

      window.addEventListener("mouseup", () => {
        if (!dragging) return;
        dragging = false;
        document.body.style.userSelect = "";
      });

      window.addEventListener("resize", () => {
        if (shellApi.isRightSidebarCollapsed?.()) return;
        applyRightSidebarWidth(currentWidth || getRightSidebarWidthBounds().initial);
      });
    }

    applyRightSidebarWidth(currentWidth);
  }

  setupSidebar();
  restorePendingImportedFlow();
  shellApi.setActiveSidebar?.(activeMode);
  setupDetailPanelResizer();
  setupRightSidebar();
  applyFlowViewportHeight();
  window.addEventListener("beforeunload", persistModeStates);

  shellApi.bindHeader?.({
    onUndo: () => {
      handleUndoAction();
    },
    onRedo: () => {
      handleRedoAction();
    },
    onTitleInput: ({ value }) => {
      if (!state) return;
      state.flowName = String(value || "");
    },
    onTitleChange: ({ value }) => {
      if (!state) return;
      state.flowName = String(value || "").trim() || getModeMeta(state.appMode).defaultFlowName;
      syncHeaderForMode();
    },
    onSave: async () => {
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
          steps: buildExportSteps(state.nodes, buildConfigForMode(state.appMode)),
          flows: buildFlows(state.nodes)
        };

        const fileName = `${toSafeFilename(flowName)}${getModeMeta(state.appMode).fileExtension || ".ziz"}`;
        console.info("[save] browser.download", { fileName });
        utils?.downloadYaml?.(fileName, payload);
      } catch (err) {
        console.error("[save] failed", err);
        showDialog(`保存に失敗しました。\n${err?.message || err}`, { kind: "error", title: "保存エラー" });
      }
    },
    onReset: async () => {
      if (bridgeApi?.available?.()) {
        try {
          await handleBridgeLoad();
        } catch (err) {
          showDialog(`インポートに失敗しました。\n${err?.message || err}`, { kind: "error", title: "インポートエラー" });
        }
        return;
      }
      if (!importInput) return;
      importInput.value = "";
      importInput.click();
    },
    onRun: async () => {
      try {
        await handleBridgeRun("header");
      } catch (err) {
        showDialog(`実行に失敗しました。\n${err?.message || err}`, { kind: "error", title: "実行エラー" });
      }
    },
    onDiagnostics: async () => {
      try {
        const status = await fetchBridgeStatus();
        showDialog(formatBridgeDiagnostics(status), { kind: "info", title: "診断", format: "kv" });
      } catch (err) {
        showDialog(`診断情報の取得に失敗しました。\n${err?.message || err}`, { kind: "error", title: "診断エラー" });
      }
    },
    onWindowControl: ({ action }) => {
      void handleWindowControl(action);
    },
    onHeaderDrag: ({ event, isInteractiveTarget }) => {
      if (event.button !== 0) return;
      if (!bridgeApi?.available?.()) return;
      if (isInteractiveTarget) return;
      void handleWindowControl("drag");
    },
  });

  if (btnReset) {
    importInput = document.createElement("input");
    importInput.type = "file";
    importInput.accept = ".zizw,.zizd,.zizq";
    importInput.style.display = "none";
    document.body.appendChild(importInput);

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

  async function handleWindowControl(action) {
    if (!bridgeApi?.available?.()) return;
    try {
      await bridgeApi.call("app.windowControl", { action });
    } catch (err) {
      console.error("[window-control] failed", action, err);
    }
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
    refreshHomeLists().then(() => onStateChanged({ history: false })).catch(() => onStateChanged({ history: false }));
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
    refreshHomeLists().then(() => onStateChanged({ history: false })).catch(() => onStateChanged({ history: false }));
  }

  onStateChanged({ history: false });
})();
