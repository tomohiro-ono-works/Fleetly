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
  const getSelectedNodeIds = stateOps.getSelectedNodeIds;
  const setSelectedNodes = stateOps.setSelectedNodes;
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
  const rightSidebarResizer = rightSidebarRefs.resizer || document.getElementById("rightSidebarResizer");
  const detailPanelResizer = document.getElementById("detailPanelResizer");
  const splitDetailLayout = !!detailRoot && !!detailBottomRoot && detailBottomRoot !== detailRoot;
  const bodyDataset = bodyRoot?.dataset || {};
  const urlParams = new URLSearchParams(window.location.search);
  const runtimeVersion = urlParams.get("v") || "";
  const embeddedMode = urlParams.get("embedded") === "1";
  const embeddedOpenScope = String(urlParams.get("open_scope") || "").trim();
  const embeddedOpenRelPath = String(urlParams.get("open_rel_path") || "").trim();
  let importInput = null;
  const APP_MODES = CONFIG.modes || {};
  const DEFAULT_APP_MODE = APP_MODES.dataflow ? "dataflow" : (Object.keys(APP_MODES)[0] || "dataflow");
  const STORAGE_KEYS = {
    modeStates: "ziz.modeStates.v1",
    pendingFlow: "ziz.pendingFlow.v1",
  };
  const RECENT_ROOTS_CONFIG_SCOPE = "config";
  const RECENT_ROOTS_CONFIG_PATH = "recent_roots.json";
  const WORKFLOWS_DIR_NAME = "workflows";
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
  function resolveBridgeApi() {
    const localBridge = window.zizBridge || (window.zizPackages || {})?.core?.bridge || bridgeApi || null;
    if (localBridge?.available?.()) return localBridge;
    if (!embeddedMode) return localBridge;
    const parentBridge = window.parent?.zizBridge || (window.parent?.zizPackages || {})?.core?.bridge || null;
    if (parentBridge?.available?.()) return parentBridge;
    return localBridge || parentBridge;
  }
  function getBridgeUnavailableMessage(activeBridge) {
    const message = activeBridge?.unavailableMessage?.();
    return String(message || "ブリッジ未接続です。再読み込みしてください。");
  }
  function toDebugJson(value) {
    try {
      return JSON.stringify(value);
    } catch (_) {
      return String(value);
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
  function describeButtonId(button) {
    if (!button) return "";
    return String(
      button.id
      || button.getAttribute("data-pane-action")
      || button.getAttribute("data-action")
      || button.getAttribute("aria-label")
      || button.getAttribute("name")
      || ""
    ).replace(/\s+/g, " ").trim();
  }
  let activeMode = DEFAULT_APP_MODE;
  let state;
  const RIGHT_PANEL_KEYS = ["detail", "yaml", "variables"];
  let activeRightPanel = "detail";
  let rightSidebarVisibleBySelection = false;
  let rightSidebarCollapsed = false;
  let currentRunId = "";
  const runKindById = Object.create(null);
  const runMetaById = Object.create(null);
  const ownedRunIds = new Set();
  const handledTerminalRunIds = new Set();
  let activeFlowRunId = "";
  let lastRunTerminalDialogKey = "";
  const runLogsById = Object.create(null);
  let workspaceActiveFlowTabId = "";
  let embeddedLastDirtySignature = "";
  let lastRunSummary = null;
  let stateChangeFrameId = 0;
  let pendingStateChangeOptions = null;
  let stepStatusFlushTimer = 0;
  const pendingStepStatuses = {};
  let lastHeaderSyncSignature = "";
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
    recentProjects: [],
    templates: [],
    refreshToken: 0,
  };

  function refreshFlowStatusOnly() {
    const uiNode = ((window.zizPackages || {}).ui || {}).node || window.uiNode || {};
    if (typeof uiNode.refreshFlowStatus === "function") {
      uiNode.refreshFlowStatus({ root: flowRoot, state });
    }
  }

  function roundPerfMs(value) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return null;
    return Math.round(Math.max(0, numberValue) * 10) / 10;
  }

  function getBridgeEventLatencyMs(message) {
    const eventTime = Date.parse(String(message?.ts || ""));
    if (!Number.isFinite(eventTime)) return null;
    return roundPerfMs(Date.now() - eventTime);
  }

  function scheduleRunRenderTimelineLog({
    runId,
    status,
    eventTs,
    receivedAt,
    summaryFetchMs,
    summaryFetchedAt,
    terminalEventLatencyMs,
  }) {
    const logAfterPaint = () => {
      const paintedAt = getPerfNow();
      void logUiEvent("run.gui.timeline", {
        run_id: String(runId || ""),
        status: String(status || ""),
        event_ts: String(eventTs || ""),
        terminal_event_latency_ms: terminalEventLatencyMs,
        summary_fetch_ms: summaryFetchMs,
        event_to_paint_ms: roundPerfMs(paintedAt - receivedAt),
        summary_to_paint_ms: roundPerfMs(paintedAt - summaryFetchedAt),
        render_last_ms: roundPerfMs(renderPerf.lastMs),
      }, { source: "bridge-event", elapsedMs: paintedAt - receivedAt });
    };
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(logAfterPaint);
      });
      return;
    }
    window.setTimeout(logAfterPaint, 0);
  }

  function findNodeByStepId(stepId) {
    const key = String(stepId || "").trim();
    if (!key || !Array.isArray(state?.nodes)) return null;
    return state.nodes.find((node) => String(node?.stepName || "").trim() === key) || null;
  }

  function setSchemaEditorModeByStep(stepId, mode = "output") {
    const node = findNodeByStepId(stepId);
    if (!node) return false;
    const nextMode = String(mode || "").trim();
    if (!["input", "json", "output"].includes(nextMode)) return false;
    if (String(node.__schemaEditorMode || "") === nextMode) return false;
    node.__schemaEditorMode = nextMode;
    return true;
  }

  function getSelectedNode() {
    const selectedNodeId = String(state?.selectedNodeId || "").trim();
    if (!selectedNodeId || !Array.isArray(state?.nodes)) return null;
    return state.nodes.find((node) => String(node?.id || "").trim() === selectedNodeId) || null;
  }

  function getCurrentSelectedNodeIds() {
    if (!state || typeof state !== "object") return [];
    if (typeof getSelectedNodeIds === "function") {
      return getSelectedNodeIds(state, { allowEmpty: true });
    }
    return Array.isArray(state.selectedNodeIds)
      ? state.selectedNodeIds.map((nodeId) => String(nodeId || "").trim()).filter(Boolean)
      : [];
  }

  function shouldShowRightSidebar() {
    if (!splitDetailLayout || !rightSidebar) return false;
    if (homeViewModel.visible) return false;
    if (!rightSidebarVisibleBySelection) return false;
    const selectedIds = getCurrentSelectedNodeIds();
    if (selectedIds.length !== 1) return false;
    if (selectedIds[0] === "__start__") return false;
    return true;
  }

  function applyRightSidebarVisibility(visible) {
    if (!splitDetailLayout || !rightSidebar) return;
    const nextCollapsed = !visible;
    if (rightSidebarCollapsed === nextCollapsed) return;
    rightSidebarCollapsed = nextCollapsed;
    shellApi.setRightSidebarCollapsed?.(nextCollapsed, () => {
      applyFlowViewportHeight();
    });
  }

  function setRunAllEditLock(locked) {
    if (!state || typeof state !== "object") return false;
    const next = !!locked;
    if (!!state.__runAllRunning === next) return false;
    state.__runAllRunning = next;
    return true;
  }

  function setRunButtonLocked(locked) {
    if (!btnRun) return;
    btnRun.disabled = !!locked;
    btnRun.setAttribute("aria-disabled", locked ? "true" : "false");
  }

  function notifyWorkspaceRunState(running, runId = "", source = "app") {
    window.dispatchEvent(new CustomEvent("ziz:workspace-run-state", {
      detail: {
        running: !!running,
        run_id: String(runId || ""),
        tab_id: String(workspaceActiveFlowTabId || ""),
        source: String(source || "app"),
      }
    }));
  }

  function postEmbeddedEvent(type, detail = {}) {
    if (!embeddedMode) return;
    try {
      window.parent?.postMessage({
        source: "ziz-embedded",
        type: String(type || ""),
        detail: (detail && typeof detail === "object") ? detail : {},
      }, window.location.origin);
    } catch (_) {
      // ignore
    }
  }

  function getEmbeddedDirtyState() {
    const store = getActiveHistoryStore();
    return !!(store && store.undoStack && store.undoStack.length);
  }

  function publishEmbeddedStateIfNeeded(force = false) {
    if (!embeddedMode) return;
    const dirty = getEmbeddedDirtyState();
    const signature = `${state?.flowName || ""}|${dirty ? "1" : "0"}|${state?.appMode || ""}`;
    if (!force && signature === embeddedLastDirtySignature) return;
    embeddedLastDirtySignature = signature;
    postEmbeddedEvent("state", {
      flow_name: String(state?.flowName || ""),
      dirty: !!dirty,
      mode: String(state?.appMode || ""),
    });
  }

  function clearStepStatusesForVisuals() {
    if (!state || !state.stepStatuses || typeof state.stepStatuses !== "object") return;
    if (!Object.keys(state.stepStatuses).length) return;
    state.stepStatuses = {};
    refreshFlowStatusOnly();
  }

  function resolveWorkspaceTabId() {
    const explicit = String(workspaceActiveFlowTabId || "").trim();
    if (explicit) return explicit;
    if (!embeddedMode) return "__standalone__";
    const rel = String(embeddedOpenRelPath || "").trim().replace(/\\/g, "/").toLowerCase();
    const scope = embeddedOpenScope === "config" ? "config" : "root";
    if (rel) return `embedded:${scope}:${rel}`;
    return "__embedded__";
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
    showFlowRunLogDialog(runId, {
      flowName,
      success: true,
      errorMessage: "",
    });
    console.info(`[run:${runId || "-"}] 実行ログダイアログを表示(success)`);
  }

  function showRunFailedDialog(summary, payload, runId) {
    const flowName = String(summary?.flow_name || state?.flowName || "フロー");
    const status = String(payload?.status || summary?.status || "").trim().toLowerCase();
    const errorMessage = String(
      summary?.error?.message
      || payload?.message
      || (status === "cancelled" ? "実行がキャンセルされました。" : "実行に失敗しました。")
    ).trim();
    const isCancelled = status === "cancelled";
    showFlowRunLogDialog(runId, {
      flowName,
      success: false,
      errorMessage: isCancelled ? "実行がキャンセルされました。" : errorMessage,
    });
    console.info(`[run:${runId || "-"}] 実行ログダイアログを表示(failed) status=${status || "-"}`);
  }

  function formatRunLogTimestamp(date = new Date()) {
    const d = date instanceof Date ? date : new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
  }

  function normalizeRunLogStatus(status) {
    const text = String(status || "").trim().toLowerCase();
    if (text === "success" || text === "ok") return "成功";
    return "失敗";
  }

  function getOrCreateRunLog(runId) {
    const key = String(runId || "").trim();
    if (!key) return null;
    if (!runLogsById[key]) {
      runLogsById[key] = {
        rows: [],
        started: false,
        finalized: false,
      };
    }
    return runLogsById[key];
  }

  function appendRunLogRow(runId, status, message, at = new Date()) {
    const entry = getOrCreateRunLog(runId);
    if (!entry) return;
    entry.rows.push({
      at: formatRunLogTimestamp(at),
      status: normalizeRunLogStatus(status),
      message: String(message || ""),
    });
  }

  function resolveStepLogMessage(stepId, fallbackMessage) {
    const key = String(stepId || "").trim();
    if (!key) return String(fallbackMessage || "ステップ");
    const node = findNodeByStepId(key);
    const desc = String(node?.description || "").trim();
    if (desc) return `[${key}] ${desc}`;
    const connector = String(node?.connector || "").trim();
    const action = String(node?.action || "").trim();
    if (connector || action) return `[${key}] ${connector}${connector && action ? " / " : ""}${action}`.trim();
    return `[${key}] ステップ`;
  }

  function ensureFlowRunLogStarted(runId, flowName) {
    const entry = getOrCreateRunLog(runId);
    if (!entry || entry.started) return;
    entry.started = true;
    appendRunLogRow(runId, "success", "ワークフロー開始");
  }

  function showFlowRunLogDialog(runId, options = {}) {
    const entry = getOrCreateRunLog(runId);
    const flowName = String(options?.flowName || state?.flowName || "ワークフロー");
    const success = !!options?.success;
    const errorMessage = String(options?.errorMessage || "").trim();
    if (entry && !entry.finalized) {
      if (errorMessage) {
        appendRunLogRow(runId, "failed", errorMessage);
      }
      appendRunLogRow(runId, success ? "success" : "failed", "ワークフロー完了");
      entry.finalized = true;
    }
    armSuccessStatusResetOnDialogClose();
    const rows = Array.isArray(entry?.rows) ? entry.rows : [];
    showDialog("", {
      kind: success ? "success" : "error",
      title: `${flowName} 実行ログ`,
      format: "runlog",
      logRows: rows,
    });
  }

  function mergeStateChangeOptions(base, incoming) {
    const baseHistory = base ? base.history !== false : false;
    const incomingHistory = incoming ? incoming.history !== false : true;
    return {
      history: baseHistory || incomingHistory
    };
  }

  function getBottomSchemaEditorWrap() {
    if (!splitDetailLayout || !detailBottomRoot || detailBottomRoot === detailRoot) return null;
    return detailBottomRoot.querySelector(".node-data-wrap.node-data-wrap--schema-editor");
  }

  function captureBottomSchemaEditorViewState() {
    const wrap = getBottomSchemaEditorWrap();
    if (!wrap) return null;
    const snapshot = {
      selectedNodeId: String(state?.selectedNodeId || "").trim(),
      scrollTop: Number(wrap.scrollTop) || 0,
      scrollLeft: Number(wrap.scrollLeft) || 0
    };
    const activeEl = document.activeElement;
    if (!(activeEl instanceof HTMLElement) || !wrap.contains(activeEl)) return snapshot;
    const fieldKey = String(activeEl.getAttribute("data-schema-key") || "").trim();
    if (!fieldKey) return snapshot;
    const rowEl = activeEl.closest(".schema-form-row");
    if (!rowEl) return snapshot;
    const rowEls = Array.from(wrap.querySelectorAll(".schema-form-row"));
    const rowIndex = rowEls.indexOf(rowEl);
    if (rowIndex < 0) return snapshot;
    snapshot.focus = {
      rowIndex,
      fieldKey
    };
    if (typeof activeEl.selectionStart === "number" && typeof activeEl.selectionEnd === "number") {
      snapshot.focus.selectionStart = activeEl.selectionStart;
      snapshot.focus.selectionEnd = activeEl.selectionEnd;
    }
    return snapshot;
  }

  function restoreBottomSchemaEditorViewState(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return;
    const selectedNodeId = String(state?.selectedNodeId || "").trim();
    if (selectedNodeId !== String(snapshot.selectedNodeId || "").trim()) return;
    const wrap = getBottomSchemaEditorWrap();
    if (!wrap) return;
    wrap.scrollTop = Number(snapshot.scrollTop) || 0;
    wrap.scrollLeft = Number(snapshot.scrollLeft) || 0;
    const focus = snapshot.focus;
    if (!focus || typeof focus !== "object") return;
    const rowIndex = Number(focus.rowIndex);
    const fieldKey = String(focus.fieldKey || "").trim();
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || !fieldKey) return;
    const rowEls = wrap.querySelectorAll(".schema-form-row");
    const rowEl = rowEls[rowIndex];
    if (!rowEl) return;
    const target = rowEl.querySelector(`[data-schema-key='${fieldKey}']`);
    if (!(target instanceof HTMLElement)) return;
    try {
      target.focus({ preventScroll: true });
    } catch (_) {
      target.focus();
    }
    if (
      typeof focus.selectionStart === "number" &&
      typeof focus.selectionEnd === "number" &&
      typeof target.setSelectionRange === "function"
    ) {
      try {
        target.setSelectionRange(focus.selectionStart, focus.selectionEnd);
      } catch (_) {}
    }
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
      if (typeof getSelectedNodeIds === "function") {
        getSelectedNodeIds(state, { allowEmpty: true });
      } else {
        const selectedNodeIds = Array.isArray(state.selectedNodeIds)
          ? state.selectedNodeIds.map((nodeId) => String(nodeId || "").trim()).filter(Boolean)
          : [];
        const normalizedSelectedNodeIds = selectedNodeIds
          .filter((nodeId, index, arr) => nodeIds.has(nodeId) && arr.indexOf(nodeId) === index);
        if (typeof setSelectedNodes === "function") {
          setSelectedNodes(state, normalizedSelectedNodeIds, { allowEmpty: true });
        } else {
          state.selectedNodeIds = normalizedSelectedNodeIds;
          state.selectedNodeId = normalizedSelectedNodeIds[0] || null;
        }
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
      if (homeViewModel.visible) {
        rightSidebarVisibleBySelection = false;
      }
      if (detailPanel) {
        detailPanel.hidden = !!homeViewModel.visible;
      }
      if (rightSidebar) {
        rightSidebar.hidden = !!homeViewModel.visible;
      }
      applyRightSidebarVisibility(shouldShowRightSidebar());
      if (mainRoot) {
        if (splitDetailLayout) {
          mainRoot.style.paddingBottom = homeViewModel.visible ? "0px" : "";
        } else {
          mainRoot.style.paddingBottom = homeViewModel.visible ? "0px" : (detailPanel ? `${(detailPanel.getBoundingClientRect().height || 300) + 20}px` : "0px");
        }
      }
      const schemaEditorViewState = captureBottomSchemaEditorViewState();
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
      restoreBottomSchemaEditorViewState(schemaEditorViewState);
      schedulePersistModeStates();
      publishEmbeddedStateIfNeeded(false);
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
    const normalizedStatus = String(status || "").trim().toLowerCase();
    if (normalizedStatus === "error") {
      const changed = setSchemaEditorModeByStep(key, "output");
      const selectedNode = getSelectedNode();
      if (changed && selectedNode && String(selectedNode.stepName || "").trim() === key) {
        onStateChanged({ history: false });
      }
    }
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

  function clearAppSessionCaches() {
    removeSessionValue(STORAGE_KEYS.modeStates);
    removeSessionValue(STORAGE_KEYS.pendingFlow);
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
    const restoredNodeIdSet = new Set(restoredNodes.map((node) => String(node?.id || "")));
    const selectedNodeIds = (Array.isArray(savedState.selectedNodeIds) ? savedState.selectedNodeIds : [])
      .map((nodeId) => String(nodeId || "").trim())
      .filter((nodeId, index, arr) => nodeId && restoredNodeIdSet.has(nodeId) && arr.indexOf(nodeId) === index);
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
      selectedNodeId: selectedNodeIds[0] || (hasSelectedNode ? selectedNodeId : (restoredNodes[0]?.id || baseState.selectedNodeId || null)),
      selectedNodeIds: selectedNodeIds.length
        ? selectedNodeIds
        : [hasSelectedNode ? selectedNodeId : (restoredNodes[0]?.id || baseState.selectedNodeId || null)].filter(Boolean),
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

  function normalizeRootPath(pathValue) {
    const text = String(pathValue || "").trim();
    if (!text) return "";
    return text.replace(/[\\/]+/g, "\\").replace(/[\\]+$/, "");
  }

  function getRootFolderName(pathValue) {
    const normalized = normalizeRootPath(pathValue);
    if (!normalized) return "(未選択)";
    const parts = normalized.split(/[\\/]/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : normalized;
  }

  function normalizeRecentProjectEntries(entries) {
    const list = Array.isArray(entries) ? entries : [];
    const dedup = new Map();
    list.forEach((entry) => {
      let path = "";
      let lastAccessedAt = "";
      if (typeof entry === "string") {
        path = normalizeRootPath(entry);
      } else if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        path = normalizeRootPath(entry.path);
        lastAccessedAt = String(entry.last_accessed_at || "").trim();
      }
      if (!path) return;
      const key = path.toLowerCase();
      if (!dedup.has(key)) {
        dedup.set(key, { path, last_accessed_at: lastAccessedAt });
      }
    });
    return Array.from(dedup.values())
      .sort((a, b) => {
        const av = Date.parse(String(a.last_accessed_at || "")) || 0;
        const bv = Date.parse(String(b.last_accessed_at || "")) || 0;
        return bv - av;
      })
      .slice(0, 10)
      .map((entry) => ({
        root_path: entry.path,
        display_name: getRootFolderName(entry.path),
        display_hint: entry.path,
        opened_at: entry.last_accessed_at || "",
      }));
  }

  async function loadRecentProjects() {
    if (!bridgeApi?.available?.()) return [];
    try {
      const payload = await bridgeApi.call("workspace.readText", {
        scope: RECENT_ROOTS_CONFIG_SCOPE,
        rel_path: RECENT_ROOTS_CONFIG_PATH,
      });
      const raw = String(payload?.content || "").trim();
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return normalizeRecentProjectEntries(parsed);
    } catch (error) {
      if (String(error?.code || "") !== "E_NOT_FOUND") {
        console.error("failed to load recent projects", error);
      }
      return [];
    }
  }

  function getParentDir(pathValue) {
    const text = String(pathValue || "").trim();
    if (!text) return "";
    const normalized = text.replace(/[\\/]+$/, "");
    const slash = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
    if (slash <= 0) return "";
    return normalized.slice(0, slash);
  }

  function joinPath(baseDir, childName) {
    const base = String(baseDir || "").trim().replace(/[\\/]+$/, "");
    const child = String(childName || "").trim().replace(/^[\\/]+/, "");
    if (!base) return child;
    const sep = base.includes("\\") ? "\\" : "/";
    return `${base}${sep}${child}`;
  }

  async function ensureWorkflowsRoot() {
    if (!bridgeApi?.available?.()) return "";
    const rootStatus = await bridgeApi.call("workspace.getRoot", {});
    const configRoot = String(rootStatus?.config_path || "").trim();
    const baseDir = getParentDir(configRoot);
    const workflowsPath = joinPath(baseDir, WORKFLOWS_DIR_NAME);
    if (workflowsPath) {
      try {
        const applied = await bridgeApi.call("workspace.setRoot", { root_path: workflowsPath });
        return String(applied?.root_path || workflowsPath);
      } catch (error) {
        if (String(error?.code || "") !== "E_NOT_FOUND") {
          throw error;
        }
      }
    }
    const picked = await bridgeApi.call("workspace.pickRoot", {
      title: "プロジェクトルートを選択",
      current_value: workflowsPath || String(rootStatus?.root_path || ""),
    });
    if (!picked?.selected) return "";
    const applied = await bridgeApi.call("workspace.setRoot", { root_path: String(picked.root_path || "") });
    return String(applied?.root_path || picked.root_path || "");
  }

  function toTemplateFileExtension(payload) {
    const sourceName = String(payload?.file_name || "").trim();
    const dot = sourceName.lastIndexOf(".");
    if (dot >= 0) {
      const ext = sourceName.slice(dot);
      if (/^\.[a-z0-9]+$/i.test(ext)) return ext;
    }
    const mode = String(payload?.mode || "").trim().toLowerCase();
    if (mode === "dataflow") return ".zizd";
    return ".ziz";
  }

  function buildAutoSavedTemplateFileName(payload) {
    const now = new Date();
    const pad = (value, width = 2) => String(value).padStart(width, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}_${pad(now.getMilliseconds(), 3)}`;
    return `new_flow_${stamp}${toTemplateFileExtension(payload)}`;
  }

  function toAbsolutePageUrl(relativeUrl) {
    try {
      const target = new URL(String(relativeUrl || ""), window.location.href);
      if (runtimeVersion && !target.searchParams.has("v")) {
        target.searchParams.set("v", runtimeVersion);
      }
      return target.toString();
    } catch (_) {
      return String(relativeUrl || "");
    }
  }

  function buildPageUrlForMode(mode) {
    const normalized = normalizeAppMode(mode);
    if (normalized === "dataflow" || normalized === "dataflow") {
      const dataflowUrl = bodyDataset.dataflowUrl || "./dataflow.html";
      const target = new URL(dataflowUrl, window.location.href);
      if (runtimeVersion && !target.searchParams.has("v")) {
        target.searchParams.set("v", runtimeVersion);
      }
      if (normalized === "dataflow") {
        target.searchParams.set("mode", "dataflow");
      } else {
        target.searchParams.delete("mode");
      }
      return target.toString();
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

  async function ensureYamlParserLoaded() {
    const existing = window.jsyaml;
    if (existing && typeof existing.load === "function") return existing;
    if (typeof shellApi?.loadScriptOnce === "function") {
      await shellApi.loadScriptOnce("./vendor/js-yaml/js-yaml.min.js");
    }
    return window.jsyaml || null;
  }

  async function parseYamlText(text) {
    const parser = await ensureYamlParserLoaded();
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
      color: String(value.color || "#ebebf2"),
      anchorNodeId: value.anchorNodeId ? String(value.anchorNodeId) : null
    };
  }

  function normalizeStickyNotes(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => normalizeStickyNote(item))
      .filter(Boolean);
  }

  function getFormFieldParamKey(field) {
    const raw = field?.paramKey ?? field?.exportKey ?? field?.export_key ?? field?.key;
    const key = String(raw || "").trim();
    return key || String(field?.key || "").trim();
  }

  function sanitizeFieldValueForExport(field, value) {
    const fieldKey = String(field?.key || "").trim();
    if (!fieldKey.startsWith("schema")) return value;
    const raw = value;
    let items = null;
    if (Array.isArray(raw)) {
      items = raw;
    } else if (typeof raw === "string") {
      const text = raw.trim();
      if (!text) return raw;
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) items = parsed;
      } catch (_) {
        return raw;
      }
    } else {
      return raw;
    }
    if (!Array.isArray(items)) return raw;
    const filtered = items.filter((item) => !(item && typeof item === "object" && item.is_disabled));
    return JSON.stringify(filtered, null, 2);
  }

  function mapStepParamsToForm(params, schema) {
    const rawParams = (params && typeof params === "object") ? params : {};
    const fields = Array.isArray(schema) ? schema : [];
    const mapped = {};
    const usedParamKeys = new Set();
    fields.forEach((field) => {
      const formKey = String(field?.key || "").trim();
      const paramKey = getFormFieldParamKey(field);
      if (!formKey || !paramKey) return;
      if (!Object.prototype.hasOwnProperty.call(rawParams, paramKey)) return;
      mapped[formKey] = rawParams[paramKey];
      usedParamKeys.add(paramKey);
    });
    Object.entries(rawParams).forEach(([key, value]) => {
      if (usedParamKeys.has(key)) return;
      if (Object.prototype.hasOwnProperty.call(mapped, key)) return;
      mapped[key] = value;
    });
    return mapped;
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
        ? mapStepParamsToForm(step.params, getFormSchema(config, connector, action))
        : {};
      const hasDescription = Object.prototype.hasOwnProperty.call(step, "description");
      const canvasPosition = normalizeCanvasPosition(step.ui_position);
      const nodeType = String(step.node_type || "task").trim() || "task";
      const importedLoopOwnerStep = String(step.loop_owner_id || "").trim();

      const node = {
        id: createLocalNodeId(),
        stepName,
        connector,
        action,
        nodeType,
        description: hasDescription ? String(step.description ?? "") : "",
        descriptionAuto: !hasDescription,
        form,
        parentId: null,
        mergeParentIds: [],
        parallelOf: null,
        parallelOrder: 1,
        outputs: [stepName]
      };
      if (importedLoopOwnerStep) {
        node._importLoopOwnerStep = importedLoopOwnerStep;
      }
      if (canvasPosition) node.canvasPosition = canvasPosition;

      nodeByStep.set(stepName, node);
      nodes.push(node);
    });

    const incomingByStep = new Map();
    const topLevelLoopFlows = (data.loop && typeof data.loop === "object" && data.loop.flows && typeof data.loop.flows === "object")
      ? data.loop.flows
      : {};
    const legacyFlowsLoop = (data.flows && typeof data.flows === "object" && data.flows.loop && typeof data.flows.loop === "object")
      ? data.flows.loop
      : {};
    const nestedLoopFlows = (legacyFlowsLoop.flows && typeof legacyFlowsLoop.flows === "object")
      ? legacyFlowsLoop.flows
      : {};
    const loopFlows = { ...nestedLoopFlows, ...topLevelLoopFlows };
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
    Object.entries(loopFlows).forEach(([ownerStepId, ownerFlow]) => {
      const ownerStep = String(ownerStepId || "").trim();
      if (!ownerStep) return;
      const loopEdges = Array.isArray(ownerFlow?.edges) ? ownerFlow.edges : [];
      loopEdges.forEach((edge, edgeIndex) => {
        const from = String(edge?.from || "").trim();
        const to = String(edge?.to || "").trim();
        if (!to || to === "END") return;
        if (!nodeByStep.has(to)) {
          throw new Error(`loop.flows.${ownerStep}.edges.to が steps に存在しません: ${to}`);
        }
        const parentStep = from === "START" ? ownerStep : from;
        if (parentStep && !nodeByStep.has(parentStep)) {
          throw new Error(`loop.flows.${ownerStep}.edges.from が steps に存在しません: ${from}`);
        }
        if (!incomingByStep.has(to)) incomingByStep.set(to, []);
        incomingByStep.get(to).push({
          parentStep,
          order: Number(edge?.order),
          kind: String(edge?.kind || "").trim().toLowerCase(),
          edgeIndex: Number(edgeIndex) + 100000
        });
      });
    });

    const missingParents = nodes
      .map((n) => n.stepName)
      .filter((stepName) => {
        if (incomingByStep.has(stepName)) return false;
        const node = nodeByStep.get(stepName);
        const loopOwnerStep = String(node?._importLoopOwnerStep || "").trim();
        return !loopOwnerStep;
      });
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
      const importedLoopOwnerStep = String(node?._importLoopOwnerStep || "").trim();
      const effectiveParentStep = parentStep || importedLoopOwnerStep || null;
      node.parentId = effectiveParentStep ? nodeByStep.get(effectiveParentStep).id : null;
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

    nodes.forEach((node) => {
      const loopOwnerStep = String(node?._importLoopOwnerStep || "").trim();
      if (!loopOwnerStep) return;
      const ownerNode = nodeByStep.get(loopOwnerStep);
      if (!ownerNode) return;
      node.loopOwnerId = ownerNode.id;
    });
    nodes.forEach((node) => {
      if (Object.prototype.hasOwnProperty.call(node, "_importLoopOwnerStep")) {
        delete node._importLoopOwnerStep;
      }
      if (!String(node.nodeType || "").trim()) {
        node.nodeType = "task";
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
        selectedNodeIds: nodes[0]?.id ? [nodes[0].id] : [],
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
        const paramKey = getFormFieldParamKey(field);
        if (!paramKey) continue;
        if (v !== undefined && v !== "") {
          params[paramKey] = sanitizeFieldValueForExport(field, v);
        } else if (field.default !== undefined) {
          params[paramKey] = sanitizeFieldValueForExport(field, field.default);
        }
      }

      const exported = {
        step_id: stepId,
        connector,
        action,
        params,
        output_variable: stepId
      };
      const nodeType = String(n?.nodeType || "").trim();
      if (nodeType && nodeType !== "task") {
        exported.node_type = nodeType;
      }
      if (n?.loopOwnerId) {
        const loopOwnerStep = stepNameById.get(String(n.loopOwnerId || ""));
        if (loopOwnerStep) exported.loop_owner_id = loopOwnerStep;
      }
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
      importInput.accept = ".zizd";
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
    const nodeById = new Map(nodes.map((node) => [String(node.id || ""), node]));

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
    const loopEdgesByOwnerStep = {};
    function pushLoopEdge(ownerStep, edge) {
      const ownerKey = String(ownerStep || "").trim();
      if (!ownerKey) return;
      if (!Array.isArray(loopEdgesByOwnerStep[ownerKey])) loopEdgesByOwnerStep[ownerKey] = [];
      loopEdgesByOwnerStep[ownerKey].push(edge);
    }
    childrenByParent.forEach((children, key) => {
      const fromStep = key === "__START__" ? "START" : (stepNameById.get(key) || "START");
      const parentNode = key === "__START__" ? null : nodeById.get(String(key || ""));
      const parentId = parentNode ? String(parentNode.id || "") : "";
      let mainOrder = 0;
      let loopOrderByOwner = {};
      children.forEach((child) => {
        const toStep = stepNameById.get(child.id) || "";
        if (!toStep) return;
        const childLoopOwnerId = String(child.loopOwnerId || "").trim();
        if (parentId && childLoopOwnerId && childLoopOwnerId === parentId) {
          const ownerStep = stepNameById.get(parentId) || "";
          if (!ownerStep) return;
          const nextOrder = Number(loopOrderByOwner[ownerStep] || 0) + 1;
          loopOrderByOwner[ownerStep] = nextOrder;
          pushLoopEdge(ownerStep, {
            from: fromStep,
            to: toStep,
            order: nextOrder,
            kind: "primary"
          });
          return;
        }
        mainOrder += 1;
        edges.push({
          from: fromStep,
          to: toStep,
          order: mainOrder,
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
        const targetLoopOwnerId = String(node.loopOwnerId || "").trim();
        if (targetLoopOwnerId) {
          const sourceNode = nodeById.get(String(parentId || ""));
          const sourceLoopOwnerId = String(sourceNode?.loopOwnerId || "").trim();
          if (String(parentId || "") === targetLoopOwnerId || sourceLoopOwnerId === targetLoopOwnerId) {
            const ownerStep = stepNameById.get(targetLoopOwnerId) || "";
            if (!ownerStep) return;
            pushLoopEdge(ownerStep, {
              from: fromStep,
              to: targetStep,
              order: 0,
              kind: "merge"
            });
            return;
          }
        }
        edges.push({
          from: fromStep,
          to: targetStep,
          order: 0,
          kind: "merge"
        });
      });
    });

    const mainOutgoing = new Set(
      edges
        .map((edge) => String(edge?.from || "").trim())
        .filter((from) => from && from !== "START" && from !== "END")
    );
    nodes
      .filter((n) => !String(n?.loopOwnerId || "").trim())
      .forEach((node) => {
        const stepId = stepNameById.get(node.id) || "";
        if (!stepId || mainOutgoing.has(stepId)) return;
        edges.push({
          from: stepId,
          to: "END",
          order: 0
        });
      });

    const loopFlows = {};
    Object.entries(loopEdgesByOwnerStep).forEach(([ownerStep, ownerEdges]) => {
      const outgoing = new Set(
        (ownerEdges || [])
          .map((edge) => String(edge?.from || "").trim())
          .filter((from) => from && from !== "START" && from !== "END")
      );
      const ownerNodeId = [...stepNameById.entries()].find(([, step]) => step === ownerStep)?.[0] || null;
      nodes
        .filter((n) => String(n?.loopOwnerId || "").trim() === String(ownerNodeId || ""))
        .forEach((node) => {
          const stepId = stepNameById.get(node.id) || "";
          if (!stepId || outgoing.has(stepId)) return;
          ownerEdges.push({
            from: stepId,
            to: "END",
            order: 0
          });
        });
      loopFlows[ownerStep] = {
        start: "START",
        end: "END",
        edges: ownerEdges
      };
    });

    const output = {
      start: "START",
      end: "END",
      edges
    };
    if (Object.keys(loopFlows).length) {
      output.loop = { flows: loopFlows };
    }
    return output;
  }

  function validateRequiredFields(nodes, config) {
    const errors = [];
    nodes.forEach((node, idx) => {
      const schema = getFormSchema(config, node.connector, node.action);
      const stepId = String(node.stepName || `step${idx + 1}`);
      schema.forEach((field) => {
        if (!isFieldVisibleForNode(node, field)) return;
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

  function normalizeInputDataReference(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    const doubleBraceMatch = text.match(/^\{\{\s*([a-zA-Z0-9_]+)\s*\}\}$/);
    if (doubleBraceMatch) return doubleBraceMatch[1];
    const braceMatch = text.match(/^\$?\{([a-zA-Z0-9_]+)(?:[^}]*)\}$/);
    if (braceMatch) return braceMatch[1];
    return text;
  }

  function isFieldVisibleForNode(node, field) {
    const uiFieldsApi = ((window.zizPackages || {}).ui || {}).fields || window.uiFields || {};
    if (typeof uiFieldsApi.isFieldVisibleForNode === "function") {
      return !!uiFieldsApi.isFieldVisibleForNode(node, field);
    }
    const rule = field?.visible_if;
    if (!rule || typeof rule !== "object") return true;
    const targetKey = String(rule.key || "").trim();
    if (!targetKey) return true;
    const rawValue = (node && node.form && Object.prototype.hasOwnProperty.call(node.form, targetKey))
      ? node.form[targetKey]
      : undefined;
    const current = rawValue === undefined || rawValue === null ? "" : String(rawValue).trim();
    if (Object.prototype.hasOwnProperty.call(rule, "equals")) {
      return current === String(rule.equals ?? "").trim();
    }
    if (Array.isArray(rule.in)) {
      const candidates = rule.in.map((item) => String(item ?? "").trim());
      return candidates.includes(current);
    }
    return true;
  }

  function validateInputDataSelfReference(nodes, config) {
    const errors = [];
    (Array.isArray(nodes) ? nodes : []).forEach((node, idx) => {
      const stepId = String(node?.stepName || `step${idx + 1}`).trim();
      if (!stepId) return;
      const schema = getFormSchema(config, node.connector, node.action);
      const inputField = schema.find((field) => String(field?.key || "") === "input_data");
      if (!inputField) return;
      const hasExplicit = node.form && Object.prototype.hasOwnProperty.call(node.form, inputField.key);
      const rawValue = hasExplicit ? node.form[inputField.key] : inputField.default;
      const ref = normalizeInputDataReference(rawValue);
      if (!ref) return;
      if (ref === stepId) {
        errors.push(`${stepId}: input_data に自分自身は指定できません。`);
      }
    });
    return errors;
  }

  function validateRequiredFieldsForNode(node, config) {
    if (!node) return [];
    const errors = [];
    const schema = getFormSchema(config, node.connector, node.action);
    const stepId = String(node.stepName || "step");
    schema.forEach((field) => {
      if (!isFieldVisibleForNode(node, field)) return;
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
    const builtFlows = buildFlows(targetState.nodes);
    const loopPayload = builtFlows && typeof builtFlows === "object" ? builtFlows.loop : null;
    if (loopPayload && typeof loopPayload === "object") {
      delete builtFlows.loop;
    }
    return {
      metadata: buildMetadataForMode(targetState.appMode, getFlowName()),
      variables: buildVariablesPayload(targetState.startParameters),
      steps: buildExportSteps(targetState.nodes, activeConfig),
      flows: builtFlows,
      ...(loopPayload ? { loop: loopPayload } : {}),
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

  function resetEmbeddedFlowStateOnLoadError(modeHint = "dataflow") {
    const fallbackMode = normalizeAppMode(modeHint || state?.appMode || "dataflow");
    const blankState = createStateForMode(fallbackMode);
    blankState.fileName = "";
    blankState.hiddenBindings = {};
    blankState.stepStatuses = {};
    modeStates[fallbackMode] = blankState;
    activeMode = fallbackMode;
    state = blankState;
    resetHistoryStoreForMode(fallbackMode, blankState);
    hideHomeScreen();
    shellApi.setActiveSidebar?.(fallbackMode);
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
      homeViewModel.recentProjects = [];
      homeViewModel.templates = [];
      await logUiEvent("home.refresh.skipped", {}, { source: "startup", elapsedMs: getPerfNow() - startedAt });
      return;
    }
    try {
      await logUiEvent("home.refresh.start", {}, { source: "startup" });
      const [recentProjects, templatePayload] = await Promise.all([
        loadRecentProjects(),
        bridgeApi.call("flow.list", { scope: "local", kind: "template" })
      ]);
      homeViewModel.recentProjects = Array.isArray(recentProjects) ? recentProjects.slice(0, 10) : [];
      homeViewModel.templates = Array.isArray(templatePayload?.items) ? templatePayload.items : [];
      await logUiEvent("home.refresh.done", {
        recent_count: homeViewModel.recentProjects.length,
        template_count: homeViewModel.templates.length,
      }, { source: "startup", elapsedMs: getPerfNow() - startedAt });
    } catch (err) {
      console.error("failed to refresh home lists", err);
      homeViewModel.recentProjects = [];
      homeViewModel.templates = [];
      await logUiEvent("home.refresh.failed", {
        message: err?.message || String(err || ""),
      }, { source: "startup", elapsedMs: getPerfNow() - startedAt });
    }
  }

  async function handleHomeAction(action) {
    const type = String(action?.type || "");
    const kind = String(action?.kind || "");
    if (type === "dismiss-home") {
      if (!setActiveMode("dataflow")) {
        hideHomeScreen();
        onStateChanged({ history: false });
      }
      return;
    }
    if (type === "create-flow") {
      return;
    }
    if (type === "create-sql") {
      if (!setActiveMode("dataflow")) {
        hideHomeScreen();
        onStateChanged({ history: false });
      }
      return;
    }
    if (type === "open-flow") {
      if (!bridgeApi?.available?.()) return;
      try {
        if (kind === "recent") {
          const rootPath = normalizeRootPath(action?.item?.root_path || action?.item?.display_hint || "");
          if (!rootPath) return;
          await bridgeApi.call("workspace.setRoot", { root_path: rootPath });
          if (!setActiveMode("dataflow")) {
            hideHomeScreen();
            onStateChanged({ history: false });
          }
          window.dispatchEvent(new CustomEvent("ziz:sidebar-action", {
            detail: { action: "explorer" }
          }));
          return;
        }
        const token = String(action?.item?.flow_token || "");
        if (!token) return;
        if (kind === "template") {
          const rootPath = await ensureWorkflowsRoot();
          if (!rootPath) return;
          const loaded = await bridgeApi.call("flow.load", {
            ref: token,
            workspace_tab_id: resolveWorkspaceTabId()
          });
          if (!loaded || loaded.selected === false) return;
          const fileName = buildAutoSavedTemplateFileName(loaded);
          await bridgeApi.call("flow.save", {
            mode: String(loaded.mode || "dataflow"),
            file_name: fileName,
            flow: loaded.flow,
            scope: "root",
            rel_path: fileName,
            workspace_tab_id: resolveWorkspaceTabId(),
          });
          loaded.file_name = fileName;
          const appliedTemplate = applyLoadedFlowPayload(loaded);
          if (appliedTemplate) {
            await refreshHomeLists();
          }
          return;
        }
        const payload = await bridgeApi.call("flow.load", {
          ref: token,
          workspace_tab_id: resolveWorkspaceTabId()
        });
        const applied = applyLoadedFlowPayload(payload);
        if (applied) await refreshHomeLists();
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
    const payload = await bridgeApi.call("flow.load", {
      ref: null,
      workspace_tab_id: resolveWorkspaceTabId()
    });
    const applied = applyLoadedFlowPayload(payload);
    if (!applied) return;
    await refreshHomeLists();
    await logUiEvent("flow.load", {
      file_name: payload.file_name || "",
      mode: payload.mode || "",
    }, { source: "button", elapsedMs: getPerfNow() - startedAt });
  }

  async function loadEmbeddedFlowByPath() {
    if (!embeddedMode) return false;
    if (!bridgeApi?.available?.()) return false;
    if (!embeddedOpenRelPath) return false;
    const scope = embeddedOpenScope === "config" ? "config" : "root";
    const payload = await bridgeApi.call("flow.load", {
      scope,
      rel_path: embeddedOpenRelPath.replace(/\\/g, "/"),
      workspace_tab_id: resolveWorkspaceTabId()
    });
    const applied = applyLoadedFlowPayload(payload);
    if (!applied) return false;
    postEmbeddedEvent("loaded", {
      flow_name: String(state?.flowName || ""),
      mode: String(state?.appMode || ""),
      rel_path: embeddedOpenRelPath.replace(/\\/g, "/"),
      scope,
    });
    return true;
  }

  async function handleBridgeSave() {
    const startedAt = getPerfNow();
    try {
      const activeBridge = resolveBridgeApi();
      if (!activeBridge?.call) {
        throw { code: "E_NOT_READY", message: "保存ブリッジを解決できません。" };
      }
      ensureBridgeState(state);
      const flowName = getFlowName();
      const derivedName = `${toSafeFilename(flowName)}${getModeMeta(state.appMode).fileExtension || ".ziz"}`;
      const fileName = derivedName || state.fileName || `フロー${getModeMeta(state.appMode).fileExtension || ".ziz"}`;
      console.info("[save] bridge.request", {
        mode: state.appMode,
        file_name: fileName,
        step_count: Array.isArray(state.nodes) ? state.nodes.length : 0
      });
      const saveRequest = {
        mode: state.appMode,
        file_name: fileName,
        flow: buildCompiledFlowPayload(state),
        workspace_tab_id: resolveWorkspaceTabId()
      };
      if (embeddedMode && embeddedOpenRelPath) {
        saveRequest.scope = embeddedOpenScope === "config" ? "config" : "root";
        saveRequest.rel_path = embeddedOpenRelPath.replace(/\\/g, "/");
      }
      console.info(`[save-trace][app] flow.save.request ${toDebugJson({
        mode: saveRequest.mode,
        file_name: saveRequest.file_name,
        scope: saveRequest.scope || "",
        rel_path: saveRequest.rel_path || "",
        step_count: Array.isArray(state?.nodes) ? state.nodes.length : 0,
      })}`);
      const payload = await activeBridge.call("flow.save", saveRequest);
      console.info(`[save-trace][app] flow.save.response ${toDebugJson({
        saved: payload?.saved,
        file_name: payload?.file_name || "",
        message: payload?.message || "",
      })}`);
      console.info("[save] bridge.response", payload || null);
      if (payload && payload.saved === false) {
        showDialog("保存はキャンセルされました。", { kind: "info", title: "保存" });
        return payload;
      }
      if (payload && payload.saved) {
        state.fileName = String(payload.file_name || fileName);
        resetHistoryStoreForMode(state.appMode, state);
        syncHistoryBaseline(state);
        // Ctrl+S 経路では onStateChanged を経由しないため、dirty解除を即時通知する。
        publishEmbeddedStateIfNeeded(true);
      }
      await refreshHomeLists();
      await logUiEvent("flow.save", {
        file_name: payload?.file_name || fileName,
        mode: state.appMode,
      }, { source: "button", elapsedMs: getPerfNow() - startedAt });
      return payload;
    } catch (error) {
      const message = String(error?.message || error || "保存に失敗しました。");
      console.error(`[save-trace][app] flow.save.error ${toDebugJson({
        code: String(error?.code || ""),
        message,
      })}`);
      showDialog(`保存に失敗しました。\n${message}`, { kind: "error", title: "保存エラー" });
      console.error("[save] bridge.error", error);
      return { saved: false, error: true, message };
    }
  }

  async function fetchRunSummary(runId) {
    if (!runId) return null;
    const activeBridge = resolveBridgeApi();
    if (!activeBridge?.call) return null;
    const summary = await activeBridge.call("result.getSummary", { run_id: runId });
    currentRunId = runId;
    lastRunSummary = summary || null;
    window.__zizLastRunSummary = lastRunSummary;
    return lastRunSummary;
  }

  async function fetchBridgeStatus() {
    const startedAt = getPerfNow();
    const activeBridge = resolveBridgeApi();
    if (!activeBridge?.call) return null;
    const status = await activeBridge.call("app.getStatus", {});
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
    const activeBridge = resolveBridgeApi();
    if (!activeBridge?.available?.()) {
      showDialog(getBridgeUnavailableMessage(activeBridge), { kind: "info", title: "実行" });
      return null;
    }
    if (activeFlowRunId) {
      showDialog("実行中のタブがあります。完了まで新規実行はできません。", { kind: "warning", title: "実行中" });
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
    const selfRefErrors = targetNode
      ? validateInputDataSelfReference([targetNode], activeConfig)
      : validateInputDataSelfReference(state.nodes, activeConfig);
    if (selfRefErrors.length) {
      showDialog(`入力データの参照設定が不正です。\n\n${selfRefErrors.join("\n")}`, { kind: "warning", title: "入力確認" });
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
      setSchemaEditorModeByStep(targetNode.stepName, "output");
      onStateChanged({ history: false });
    }
    refreshFlowStatusOnly();
    const request = {
      mode: state.appMode,
      flow: buildCompiledFlowPayload(state),
      workspace_tab_id: resolveWorkspaceTabId()
    };
    if (targetNode) {
      request.step_id = String(targetNode.stepName || "");
    }
    const payload = await activeBridge.call("flow.run", request);
    currentRunId = String(payload?.run_id || "");
    if (currentRunId) {
      runKindById[currentRunId] = targetNode ? "single" : "flow";
      runMetaById[currentRunId] = {
        kind: targetNode ? "single" : "flow",
        stepId: String(targetNode?.stepName || "")
      };
      if (!targetNode) {
        ensureFlowRunLogStarted(currentRunId, state?.flowName || "ワークフロー");
      }
      ownedRunIds.add(currentRunId);
      handledTerminalRunIds.delete(currentRunId);
      activeFlowRunId = currentRunId;
      setRunButtonLocked(true);
      notifyWorkspaceRunState(true, currentRunId, "run.accepted");
      postEmbeddedEvent("run-state", { running: true, run_id: currentRunId });
      const lockChanged = setRunAllEditLock(true);
      if (lockChanged) onStateChanged({ history: false });
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
      const runId = String(payload.run_id || "");
      const runMeta = runMetaById[runId] || null;
      const runKind = runMeta?.kind || runKindById[runId] || "";
      const stepStatus = String(payload.status || "").trim().toLowerCase();
      if (runKind === "flow" && (stepStatus === "success" || stepStatus === "error" || stepStatus === "failed")) {
        const lineStatus = stepStatus === "success" ? "success" : "failed";
        const lineMessage = resolveStepLogMessage(payload.step_id, payload.message || "");
        appendRunLogRow(runId, lineStatus, lineMessage);
      }
      return;
    }
    if (message.type === "run.completed") {
      const terminalReceivedAt = getPerfNow();
      const terminalEventLatencyMs = getBridgeEventLatencyMs(message);
      const completedRunId = String(payload.run_id || "");
      if (!completedRunId) return;
      if (!ownedRunIds.has(completedRunId) && activeFlowRunId !== completedRunId) {
        return;
      }
      if (handledTerminalRunIds.has(completedRunId)) {
        return;
      }
      handledTerminalRunIds.add(completedRunId);
      ownedRunIds.delete(completedRunId);
      flushStepStatusUpdates();
      const summaryFetchStartedAt = getPerfNow();
      const summary = await fetchRunSummary(payload.run_id);
      const summaryFetchedAt = getPerfNow();
      const summaryFetchMs = roundPerfMs(summaryFetchedAt - summaryFetchStartedAt);
      if (summary) {
        console.info(`[run:${payload.run_id || "-"}] 完了: ${summary.flow_name || ""}`);
      }
      const runMeta = runMetaById[completedRunId] || null;
      const runKind = runMeta?.kind || runKindById[completedRunId] || "flow";
      delete runKindById[completedRunId];
      delete runMetaById[completedRunId];
      if (activeFlowRunId && activeFlowRunId === completedRunId) {
        activeFlowRunId = "";
        setRunButtonLocked(false);
        notifyWorkspaceRunState(false, completedRunId, "run.completed");
        postEmbeddedEvent("run-state", { running: false, run_id: completedRunId });
      }
      const lockChanged = setRunAllEditLock(false);
      if (lockChanged) onStateChanged({ history: false });
      if (runKind === "flow") {
        const dialogKey = `completed:${completedRunId}`;
        if (lastRunTerminalDialogKey !== dialogKey) {
          lastRunTerminalDialogKey = dialogKey;
          showRunCompletedDialog(summary, payload.run_id);
        }
      }
      if (runKind === "single" && runMeta?.stepId) {
        const changed = setSchemaEditorModeByStep(runMeta.stepId, "output");
        if (changed) onStateChanged({ history: false });
      }
      refreshFlowStatusOnly();
      scheduleRunRenderTimelineLog({
        runId: completedRunId,
        status: "success",
        eventTs: message.ts,
        receivedAt: terminalReceivedAt,
        summaryFetchMs,
        summaryFetchedAt,
        terminalEventLatencyMs,
      });
      return;
    }
    if (message.type === "run.failed") {
      const terminalReceivedAt = getPerfNow();
      const terminalEventLatencyMs = getBridgeEventLatencyMs(message);
      const failedRunId = String(payload.run_id || "");
      if (!failedRunId) return;
      if (!ownedRunIds.has(failedRunId) && activeFlowRunId !== failedRunId) {
        return;
      }
      if (handledTerminalRunIds.has(failedRunId)) {
        return;
      }
      handledTerminalRunIds.add(failedRunId);
      ownedRunIds.delete(failedRunId);
      flushStepStatusUpdates();
      const summaryFetchStartedAt = getPerfNow();
      const summary = await fetchRunSummary(payload.run_id);
      const summaryFetchedAt = getPerfNow();
      const summaryFetchMs = roundPerfMs(summaryFetchedAt - summaryFetchStartedAt);
      const runMeta = runMetaById[failedRunId] || null;
      const runKind = runMeta?.kind || runKindById[failedRunId] || "flow";
      if (activeFlowRunId && activeFlowRunId === failedRunId) {
        activeFlowRunId = "";
        setRunButtonLocked(false);
        notifyWorkspaceRunState(false, failedRunId, "run.failed");
        postEmbeddedEvent("run-state", { running: false, run_id: failedRunId });
      }
      const lockChanged = setRunAllEditLock(false);
      if (lockChanged) onStateChanged({ history: false });
      delete runKindById[failedRunId];
      delete runMetaById[failedRunId];
      if (runKind === "flow") {
        const status = String(payload?.status || summary?.status || "").trim().toLowerCase() || "failed";
        const dialogKey = `failed:${failedRunId}:${status}`;
        if (lastRunTerminalDialogKey !== dialogKey) {
          lastRunTerminalDialogKey = dialogKey;
          showRunFailedDialog(summary, payload, failedRunId);
        }
      }
      if (runKind === "single" && runMeta?.stepId) {
        const changed = setSchemaEditorModeByStep(runMeta.stepId, "output");
        if (changed) onStateChanged({ history: false });
      }
      refreshFlowStatusOnly();
      scheduleRunRenderTimelineLog({
        runId: failedRunId,
        status: String(payload?.status || summary?.status || "failed"),
        eventTs: message.ts,
        receivedAt: terminalReceivedAt,
        summaryFetchMs,
        summaryFetchedAt,
        terminalEventLatencyMs,
      });
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
      onActionItem: ({ item, action, navUrl, expanded }) => {
        if (navUrl) {
          navigateToUrl(navUrl);
          return;
        }
        const selectedAction = String(action || "").trim();
        if (selectedAction) {
          document.querySelectorAll(".sidebar [data-sidebar-action]").forEach((button) => {
            const isCurrent = button === item;
            button.classList.toggle("is-current", isCurrent);
            if (isCurrent) button.setAttribute("aria-current", "page");
            else button.removeAttribute("aria-current");
          });
          window.dispatchEvent(new CustomEvent("ziz:sidebar-action", {
            detail: { action: selectedAction }
          }));
        } else {
          item.classList.remove("is-current");
          item.removeAttribute("aria-current");
        }
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
    let dragFrameId = 0;
    let pendingHeight = null;
    let resizeTimer = 0;

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

    const flushDragHeight = () => {
      dragFrameId = 0;
      if (!dragging || pendingHeight === null) return;
      applyDetailPanelHeight(pendingHeight);
      pendingHeight = null;
    };

    detailPanel.addEventListener("mousedown", beginDrag);
    if (detailPanelResizer) {
      detailPanelResizer.addEventListener("mousedown", beginDrag);
    }

    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const delta = startY - e.clientY;
      pendingHeight = startH + delta;
      if (dragFrameId) return;
      dragFrameId = window.requestAnimationFrame(flushDragHeight);
    });

    window.addEventListener("mouseup", () => {
      if (!dragging) return;
      if (dragFrameId) {
        window.cancelAnimationFrame(dragFrameId);
        dragFrameId = 0;
      }
      if (pendingHeight !== null) {
        applyDetailPanelHeight(pendingHeight);
        pendingHeight = null;
      }
      dragging = false;
      document.body.style.userSelect = "";
    });

    window.addEventListener("resize", () => {
      if (resizeTimer) {
        window.clearTimeout(resizeTimer);
      }
      resizeTimer = window.setTimeout(() => {
        resizeTimer = 0;
        const current = detailPanel.getBoundingClientRect().height || 300;
        applyDetailPanelHeight(current);
        applyFlowViewportHeight();
      }, 120);
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
    const shellWidth = Math.floor(appShell?.getBoundingClientRect().width || window.innerWidth);
    const leftWidth = Math.floor(leftSidebar?.getBoundingClientRect().width || 0);
    const available = Math.max(240, shellWidth - leftWidth);
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
    if (!splitDetailLayout || !rightSidebar) return;

    let currentWidth = getRightSidebarWidthBounds().initial;
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

    window.addEventListener("ziz:flow-selection-gesture", (event) => {
      const kind = String(event?.detail?.kind || "").trim();
      if (kind === "single") {
        rightSidebarVisibleBySelection = true;
      } else if (kind === "multi" || kind === "clear") {
        rightSidebarVisibleBySelection = false;
      } else {
        return;
      }
      onStateChanged({ history: false });
    });

    window.addEventListener("ziz:node-detail-tab-change", (event) => {
      const key = String(event?.detail?.tab || "").trim();
      if (!RIGHT_PANEL_KEYS.includes(key)) return;
      if (activeRightPanel === key) return;
      activeRightPanel = key;
      onStateChanged({ history: false });
    });

    if (rightSidebarResizer) {
      let dragging = false;
      let startX = 0;
      let startWidth = 0;
      let dragFrameId = 0;
      let pendingWidth = null;
      let resizeTimer = 0;

      rightSidebarResizer.addEventListener("mousedown", (event) => {
        if (rightSidebarCollapsed) {
          rightSidebarVisibleBySelection = true;
          applyRightSidebarVisibility(true);
        }
        dragging = true;
        startX = event.clientX;
        startWidth = rightSidebar.getBoundingClientRect().width || currentWidth;
        document.body.style.userSelect = "none";
        event.preventDefault();
      });

      const flushRightSidebarDrag = () => {
        dragFrameId = 0;
        if (!dragging || pendingWidth === null) return;
        const nextWidth = pendingWidth;
        pendingWidth = null;
        applyRightSidebarWidth(nextWidth);
      };

      window.addEventListener("mousemove", (event) => {
        if (!dragging) return;
        const delta = startX - event.clientX;
        pendingWidth = startWidth + delta;
        if (dragFrameId) return;
        dragFrameId = window.requestAnimationFrame(flushRightSidebarDrag);
      });

      window.addEventListener("mouseup", () => {
        if (!dragging) return;
        if (dragFrameId) {
          window.cancelAnimationFrame(dragFrameId);
          dragFrameId = 0;
        }
        if (pendingWidth !== null) {
          const { bounds } = applyRightSidebarWidth(pendingWidth);
          const shouldClose = pendingWidth < bounds.min;
          pendingWidth = null;
          if (shouldClose) {
            dragging = false;
            document.body.style.userSelect = "";
            closeRightSidebar();
            return;
          }
        }
        dragging = false;
        document.body.style.userSelect = "";
      });

      window.addEventListener("resize", () => {
        if (resizeTimer) {
          window.clearTimeout(resizeTimer);
        }
        resizeTimer = window.setTimeout(() => {
          resizeTimer = 0;
          if (rightSidebarCollapsed) return;
          applyRightSidebarWidth(currentWidth || getRightSidebarWidthBounds().initial);
        }, 120);
      });
    }

    applyRightSidebarVisibility(false);
    applyRightSidebarWidth(currentWidth);
  }

  setupSidebar();
  restorePendingImportedFlow();
  shellApi.setActiveSidebar?.(activeMode);
  setupDetailPanelResizer();
  setupRightSidebar();
  applyFlowViewportHeight();
  window.addEventListener("beforeunload", clearAppSessionCaches);
  window.addEventListener("pagehide", clearAppSessionCaches);

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
        const selfRefErrors = validateInputDataSelfReference(state.nodes, activeConfig);
        if (selfRefErrors.length) {
          showDialog(
            `入力データの参照設定が不正です。\n\n${selfRefErrors.join("\n")}`,
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
        const builtFlows = buildFlows(state.nodes);
        const loopPayload = builtFlows && typeof builtFlows === "object" ? builtFlows.loop : null;
        if (loopPayload && typeof loopPayload === "object") {
          delete builtFlows.loop;
        }

        const payload = {
          metadata: buildMetadataForMode(state.appMode, flowName),
          variables,
          steps: buildExportSteps(state.nodes, buildConfigForMode(state.appMode)),
          flows: builtFlows,
          ...(loopPayload ? { loop: loopPayload } : {})
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
    importInput.accept = ".zizd";
    importInput.style.display = "none";
    document.body.appendChild(importInput);

    importInput.addEventListener("change", async () => {
      const file = importInput.files && importInput.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const yaml = await parseYamlText(text);
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

  function exposeEmbeddedApi() {
    window.zizEmbeddedApi = {
      runFlow: async () => handleBridgeRun("embedded"),
      saveFlow: async () => handleBridgeSave(),
      importFlow: async () => handleBridgeLoad(),
      undo: async () => handleUndoAction(),
      redo: async () => handleRedoAction(),
      setFlowName: (name) => {
        if (!state) return false;
        state.flowName = String(name || "").trim() || state.flowName || "";
        onStateChanged({ history: false });
        return true;
      },
      getFlowName: () => String(state?.flowName || ""),
      isRunning: () => !!activeFlowRunId,
      isDirty: () => getEmbeddedDirtyState(),
      getWorkspaceTabId: () => resolveWorkspaceTabId(),
    };
    window.__zizWorkspaceTabId = resolveWorkspaceTabId;
  }

  const bridgeEventTarget = (() => {
    if (!embeddedMode) return window;
    if (bridgeApi?.available?.()) return window;
    const parentWindow = window.parent;
    if (!parentWindow || parentWindow === window) return window;
    return parentWindow;
  })();
  bridgeEventTarget.addEventListener("ziz:evt", (event) => {
    handleBridgeEvent(event).catch((error) => {
      console.error("bridge event handling failed", error);
    });
  });

  window.addEventListener("ziz:workspace-flow-open", (event) => {
    const payload = event?.detail || null;
    workspaceActiveFlowTabId = String(payload?.__workspace_tab_id || workspaceActiveFlowTabId || "");
    const requestId = String(payload?.__workspace_request_id || "").trim();
    const notifyLoadResult = (type, detail = {}) => {
      postEmbeddedEvent(type, {
        ...(detail && typeof detail === "object" ? detail : {}),
        request_id: requestId,
        __workspace_request_id: requestId
      });
    };
    try {
      const applied = applyLoadedFlowPayload(payload);
      if (!applied) {
        resetEmbeddedFlowStateOnLoadError(payload?.mode || "dataflow");
        notifyLoadResult("load-error", {
          code: "E_FLOW_NOT_APPLIED",
          message: "フロー状態を適用できませんでした。"
        });
        return;
      }
      notifyLoadResult("loaded", {
        flow_name: String(state?.flowName || ""),
        mode: String(state?.appMode || ""),
      });
    } catch (error) {
      resetEmbeddedFlowStateOnLoadError(payload?.mode || "dataflow");
      notifyLoadResult("load-error", {
        code: "E_FLOW_IMPORT",
        message: error?.message || String(error || "読込エラー")
      });
      showDialog(`フローの読み込みに失敗しました。\n${error?.message || error}`, { kind: "error", title: "読込エラー" });
    }
  });

  window.addEventListener("ziz:workspace-flow-tab-activated", (event) => {
    const detail = event?.detail || {};
    workspaceActiveFlowTabId = String(detail?.tab_id || workspaceActiveFlowTabId || "");
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
      id: describeButtonId(button),
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
      if (embeddedMode) {
        postEmbeddedEvent("shortcut", { action: "save" });
      } else {
        btnSave?.click?.();
      }
      return;
    }
    if (key === "enter") {
      event.preventDefault();
      if (embeddedMode) {
        postEmbeddedEvent("shortcut", { action: "run" });
      } else {
        btnRun?.click?.();
      }
    }
  });

  exposeEmbeddedApi();

  if (bridgeApi?.available?.()) {
    refreshHomeLists().then(() => onStateChanged({ history: false })).catch(() => onStateChanged({ history: false }));
  }

  setRunButtonLocked(false);
  onStateChanged({ history: false });
  if (embeddedMode) {
    loadEmbeddedFlowByPath().catch((error) => {
      console.error("[embedded] initial load failed", error);
      postEmbeddedEvent("load-error", { message: error?.message || String(error || "") });
    });
  }
})();

