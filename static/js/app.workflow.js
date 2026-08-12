(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const app = packages.app = packages.app || {};
  const core = packages.core = packages.core || {};
  const modules = packages.__workflowAppModules || {};
  const params = new URLSearchParams(root.location.search);
  const embedded = params.get("embedded") === "1";
  const openScope = params.get("open_scope") === "config" ? "config" : "root";
  const openRelPath = String(params.get("open_rel_path") || "")
    .replace(/\\/g, "/")
    .trim();
  let session = null;
  let embeddedController = null;
  let hiddenBindings = {};
  let workspaceTabId = "";
  let eventTarget = root;
  let fitFrameId = 0;

  document.body.classList.add("workflow-production");

  function createDocSessionId() {
    const randomPart = root.crypto?.randomUUID?.().replace(/-/g, "") ||
      `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    return `docsession_${randomPart}`;
  }

  function postEmbedded(type, detail = {}) {
    if (!embedded) return;
    root.parent?.postMessage({
      source: "ziz-embedded",
      type: String(type || ""),
      detail: detail && typeof detail === "object" ? detail : {}
    }, root.location.origin);
  }

  function scheduleFitView() {
    if (!session || fitFrameId) return;
    fitFrameId = root.requestAnimationFrame(() => {
      fitFrameId = 0;
      session.adapter.fitView({ padding: 48 });
    });
  }

  function showError(error, title = "エラー") {
    const message = String(error?.message || error || "エラーが発生しました。");
    core.dialog?.show?.(message, { kind: "error", title });
    console.error("[workflow-app]", error);
  }

  function resolveBridgeClient() {
    const localBridge = core.bridge || null;
    if (localBridge?.available?.()) return localBridge;
    if (!embedded || !root.parent || root.parent === root) {
      return localBridge;
    }
    try {
      const parentBridge = root.parent.zizPackages?.core?.bridge || null;
      if (parentBridge?.available?.()) return parentBridge;
      return localBridge || parentBridge;
    } catch (_) {
      return localBridge;
    }
  }

  function resolveEventTarget() {
    const localBridge = core.bridge || null;
    if (
      embedded &&
      !localBridge?.available?.() &&
      root.parent &&
      root.parent !== root
    ) {
      return root.parent;
    }
    return root;
  }

  function loadPayload(payload = {}, requestId = "") {
    if (!payload?.selected && payload?.selected !== undefined) {
      throw modules.createWorkflowAppError(
        "E_DOCUMENT_NOT_SELECTED",
        "documentが選択されていません。"
      );
    }
    workspaceTabId = String(
      payload.__workspace_tab_id || workspaceTabId || ""
    );
    hiddenBindings = payload.hidden_bindings &&
      typeof payload.hidden_bindings === "object"
      ? payload.hidden_bindings
      : {};
    session.load({
      ...payload,
      doc_session_id: payload.__doc_session_id ||
        payload.doc_session_id ||
        session.getSnapshot().metadata.doc_session_id
    });
    const detail = {
      request_id: requestId,
      __workspace_request_id: requestId,
      flow_name: session.getDocumentName(),
      mode: "dataflow",
      mtime_ns: String(payload.mtime_ns || "")
    };
    embeddedController?.documentLoaded();
    postEmbedded("loaded", detail);
    return detail;
  }

  async function loadFromLocation() {
    if (!openRelPath) return false;
    const payload = await app.documents.load({
      doc_session_id: session.getSnapshot().metadata.doc_session_id,
      scope: openScope,
      rel_path: openRelPath
    });
    loadPayload(payload);
    return true;
  }

  async function saveDocument() {
    try {
      return await session.save(
        openRelPath ? { scope: openScope, rel_path: openRelPath } : {}
      );
    } catch (error) {
      showError(error, "保存エラー");
      throw error;
    }
  }

  async function importDocument() {
    const payload = await app.documents.load({
      doc_session_id: session.getSnapshot().metadata.doc_session_id
    });
    if (payload?.selected) loadPayload(payload);
    return payload;
  }

  function bindWorkspaceEvents() {
    root.addEventListener("ziz:workspace-flow-open", (event) => {
      const payload = event?.detail || {};
      const requestId = String(payload.__workspace_request_id || "");
      try {
        loadPayload(payload, requestId);
      } catch (error) {
        postEmbedded("load-error", {
          request_id: requestId,
          __workspace_request_id: requestId,
          code: String(error?.code || "E_DOCUMENT_LOAD"),
          message: String(error?.message || error)
        });
        showError(error, "読込エラー");
      }
    });
    root.addEventListener("ziz:workspace-flow-tab-activated", (event) => {
      workspaceTabId = String(
        event?.detail?.tab_id || workspaceTabId || ""
      );
    });
  }

  function bindShortcuts() {
    document.addEventListener("keydown", (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.defaultPrevented) return;
      const key = String(event.key || "").toLowerCase();
      const action = key === "s"
        ? "save"
        : key === "enter"
          ? "run"
          : "";
      if (action) {
        event.preventDefault();
        if (embedded) postEmbedded("shortcut", { action });
        else if (action === "save") saveDocument().catch(() => {});
        else session.startRun().catch(() => {});
        return;
      }
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        session.undo();
      } else if (key === "y" || key === "z" && event.shiftKey) {
        event.preventDefault();
        session.redo();
      }
    });
  }

  async function initializeEmbedded() {
    const catalog = await app.catalog.initialize();
    const docSessionId = createDocSessionId();
    session = app.workflowAppSession.createWorkflowAppSession({
      root: document.getElementById("flowchart"),
      catalog,
      documents: app.documents,
      runs: app.runs,
      designerFactory:
        packages.classicWorkflowDesigner?.createWorkflowDesigner,
      doc_session_id: docSessionId,
      onSelectionChange(payload) {
        embeddedController?.selectionChanged(payload);
      },
      onOpenDetail(payload) {
        root.dispatchEvent(new CustomEvent("ziz:workflow-open-detail", {
          detail: payload
        }));
      },
      onError(error) {
        showError(error);
      },
      onRunState(detail) {
        embeddedController?.runStateChanged(detail);
      },
      onCommandResult(payload) {
        embeddedController?.commandCompleted(payload);
      },
      onHistoryChange(stepIds) {
        embeddedController?.historyChanged(stepIds);
      },
      onStateChange(detail) {
        postEmbedded("state", detail);
      }
    });
    embeddedController = modules.createWorkflowEmbeddedController({
      session,
      catalog,
      results: app.results,
      bridge: resolveBridgeClient(),
      dataRoot: document.getElementById("nodeDetailBottom"),
      getHiddenBindings: () => hiddenBindings,
      postEmbedded,
      onError: showError
    });
    app.shell?.setRightSidebarCollapsed?.(true);
    root.zizEmbeddedApi = modules.createWorkflowEmbeddedApi({
      session,
      controller: embeddedController,
      saveDocument,
      importDocument,
      scheduleFitView,
      getWorkspaceTabId: () => workspaceTabId,
      getHiddenBindings: () => hiddenBindings
    });
    bindWorkspaceEvents();
    bindShortcuts();
    root.addEventListener("resize", scheduleFitView);
    eventTarget = resolveEventTarget();
    eventTarget.addEventListener("ziz:evt", embeddedController.bridgeEvent);
    try {
      await loadFromLocation();
    } catch (error) {
      postEmbedded("load-error", {
        code: String(error?.code || "E_DOCUMENT_LOAD"),
        message: String(error?.message || error)
      });
      showError(error, "読込エラー");
    }
  }

  if (!embedded) {
    root.zizWorkflowWorkspaceShell =
      modules.configureWorkflowWorkspaceShell?.() || null;
    const propertyRoot = document.getElementById("nodeDetail");
    if (propertyRoot) {
      root.zizWorkflowPropertyPanel =
        modules.createWorkflowPropertyPanel({
          root: propertyRoot,
          getActiveApi: () => root.zizWorkspace?.getActiveFlowApi?.(),
          setCollapsed: (collapsed) => {
            app.shell?.setRightSidebarCollapsed?.(collapsed);
          },
          onError: showError
        });
      [
        "ziz:workflow-selection",
        "ziz:workspace-active-tab-change",
        "ziz:workflow-property-refresh"
      ].forEach((eventName) => {
        root.addEventListener(
          eventName,
          root.zizWorkflowPropertyPanel.refresh
        );
      });
      root.setTimeout(root.zizWorkflowPropertyPanel.refresh, 0);
    }
    return;
  }

  initializeEmbedded().catch((error) => {
    postEmbedded("load-error", {
      code: String(error?.code || "E_WORKFLOW_APP_INIT"),
      message: String(error?.message || error)
    });
    showError(error, "初期化エラー");
  });
})(window);
