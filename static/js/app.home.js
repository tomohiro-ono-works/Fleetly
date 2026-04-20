(function () {
  const packages = window.zizPackages || {};
  const corePkg = packages.core || {};
  const uiPkg = packages.ui || {};
  const bridgeApi = corePkg.bridge || null;
  const dialogApi = corePkg.dialog || null;
  const shellApi = window.zizShell || {};
  const renderer = uiPkg.renderer || {};
  const renderApp = renderer.renderApp;
  const STORAGE_KEY_PENDING_FLOW = "ziz.pendingFlow.v1";

  const flowRoot = document.getElementById("flowchart");
  const detailRoot = document.getElementById("nodeDetail");
  const bodyRoot = document.body;
  const bodyDataset = bodyRoot?.dataset || {};
  const btnReset = document.getElementById("btnReset");
  const btnRun = document.getElementById("btnRun");
  const btnSave = document.getElementById("btnSave");

  const homeViewModel = {
    visible: true,
    recentFiles: [],
    templates: [],
    refreshToken: 0,
  };

  const homeState = {
    appMode: "dataflow",
  };

  function showDialog(message, options = {}) {
    if (dialogApi?.show) {
      dialogApi.show(message, options);
      return;
    }
    window.alert(String(message ?? ""));
  }

  function showFatal(message, err) {
    console.error(message, err || "");
    const host = document.querySelector("main") || document.body;
    if (!host) return;
    const box = document.createElement("div");
    box.className = "flow-fallback";
    box.textContent = `${message}${err ? ` (${err.message || err})` : ""}`;
    host.prepend(box);
  }

  function writeSessionJson(key, value) {
    try {
      window.sessionStorage?.setItem?.(key, JSON.stringify(value));
    } catch (_) {
      // ignore storage failures
    }
  }

  function toAbsolutePageUrl(relativeUrl) {
    try {
      return new URL(String(relativeUrl || ""), window.location.href).toString();
    } catch (_) {
      return String(relativeUrl || "");
    }
  }

  function buildPageUrlForMode(mode) {
    const normalized = String(mode || "").trim();
    if (normalized === "query-builder") {
      return toAbsolutePageUrl(bodyDataset.queryBuilderUrl || "./query-builder.html");
    }
    const dataflowUrl = new URL(bodyDataset.dataflowUrl || "./dataflow.html", window.location.href);
    if (normalized === "dataflow") {
      dataflowUrl.searchParams.set("mode", "dataflow");
    } else {
      dataflowUrl.searchParams.delete("mode");
    }
    return dataflowUrl.toString();
  }

  function navigateToUrl(url) {
    const target = String(url || "").trim();
    if (!target) return;
    window.location.href = target;
  }

  function storePendingImportedFlow(payload) {
    writeSessionJson(STORAGE_KEY_PENDING_FLOW, payload);
  }

  function renderHome() {
    if (typeof renderApp !== "function") {
      showFatal("renderer が見つかりません");
      return;
    }
    renderApp({
      flowRoot,
      detailRoot,
      state: homeState,
      config: {},
      onStateChanged: renderHome,
      homeViewModel,
      onHomeAction: handleHomeAction
    });
  }

  async function refreshHomeLists() {
    const token = ++homeViewModel.refreshToken;
    if (!bridgeApi?.available?.()) {
      homeViewModel.recentFiles = [];
      homeViewModel.templates = [];
      if (token === homeViewModel.refreshToken) renderHome();
      return;
    }
    try {
      const [recentPayload, templatePayload] = await Promise.all([
        bridgeApi.call("flow.list", { scope: "local", kind: "recent" }),
        bridgeApi.call("flow.list", { scope: "local", kind: "template" })
      ]);
      if (token !== homeViewModel.refreshToken) return;
      homeViewModel.recentFiles = Array.isArray(recentPayload?.items) ? recentPayload.items.slice(0, 10) : [];
      homeViewModel.templates = Array.isArray(templatePayload?.items) ? templatePayload.items : [];
      renderHome();
    } catch (err) {
      console.error("failed to refresh home lists", err);
      if (token !== homeViewModel.refreshToken) return;
      homeViewModel.recentFiles = [];
      homeViewModel.templates = [];
      renderHome();
    }
  }

  function openLoadedFlow(payload) {
    if (!payload || payload.selected === false) return;
    const mode = String(payload.mode || "dataflow").trim() || "dataflow";
    storePendingImportedFlow({
      mode,
      file_name: String(payload.file_name || ""),
      flow: payload.flow,
      hidden_bindings: payload.hidden_bindings || {}
    });
    navigateToUrl(buildPageUrlForMode(mode));
  }

  async function handleHomeAction(action) {
    const type = String(action?.type || "");
    if (type === "dismiss-home") {
      navigateToUrl(buildPageUrlForMode("dataflow"));
      return;
    }
    if (type === "create-flow") {
      navigateToUrl(buildPageUrlForMode("dataflow"));
      return;
    }
    if (type === "create-sql") {
      navigateToUrl(buildPageUrlForMode("query-builder"));
      return;
    }
    if (type === "open-flow") {
      const token = String(action?.item?.flow_token || "");
      if (!token || !bridgeApi?.available?.()) return;
      try {
        const payload = await bridgeApi.call("flow.load", { ref: token });
        openLoadedFlow(payload);
      } catch (err) {
        showDialog(`読み込みに失敗しました。\n${err?.message || err}`, { kind: "error", title: "読込エラー" });
      }
    }
  }

  async function handleBridgeLoad() {
    if (!bridgeApi?.available?.()) {
      showDialog("この操作は WebView モードでのみ利用できます。", { kind: "info", title: "インポート" });
      return;
    }
    const payload = await bridgeApi.call("flow.load", { ref: null });
    openLoadedFlow(payload);
  }

  async function fetchBridgeStatus() {
    if (!bridgeApi?.available?.()) return null;
    return bridgeApi.call("app.getStatus", {});
  }

  function formatBridgeDiagnostics(status) {
    if (!status) return "診断情報を取得できませんでした。";
    const security = status.security || {};
    const policies = status.security_policies || {};
    return [
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
    ].join("\n");
  }

  async function handleWindowControl(action) {
    if (!bridgeApi?.available?.()) return;
    try {
      await bridgeApi.call("app.windowControl", { action });
    } catch (err) {
      console.error("[window-control] failed", action, err);
    }
  }

  if (!flowRoot || !detailRoot) {
    showFatal("ホーム画面の描画先が見つかりません");
    return;
  }

  shellApi.updateHeader?.({
    value: "トップ画面",
    readOnly: true,
    ariaLabel: "トップ画面",
    undo: { disabled: true },
    redo: { disabled: true },
    run: { disabled: true },
    save: { disabled: true },
  });

  [btnRun, btnSave].forEach((button) => {
    if (!button) return;
    button.disabled = true;
    button.setAttribute("aria-disabled", "true");
    button.classList.add("is-disabled");
  });

  shellApi.bindSidebar?.({
    onToggle: () => {
      refreshHomeLists().catch((error) => {
        console.error("failed to refresh home", error);
      });
    },
    onModeItem: ({ navUrl }) => {
      if (!navUrl) return;
      navigateToUrl(navUrl);
    },
    onActionItem: ({ navUrl }) => {
      if (!navUrl) return;
      navigateToUrl(navUrl);
    },
  });

  shellApi.bindHeader?.({
    onReset: () => {
      handleBridgeLoad().catch((error) => {
        showDialog(`インポートに失敗しました。\n${error?.message || error}`, { kind: "error", title: "インポートエラー" });
      });
    },
    onDiagnostics: async () => {
      try {
        const status = await fetchBridgeStatus();
        showDialog(formatBridgeDiagnostics(status), { kind: "info", title: "診断", format: "kv" });
      } catch (error) {
        showDialog(`診断情報の取得に失敗しました。\n${error?.message || error}`, { kind: "error", title: "診断エラー" });
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

  window.addEventListener("ziz:bridge-ready", () => {
    refreshHomeLists().catch((error) => {
      console.error("bridge ready refresh failed", error);
      renderHome();
    });
  });

  renderHome();
  if (bridgeApi?.available?.()) {
    refreshHomeLists().catch((error) => {
      console.error("initial refresh failed", error);
    });
  }
})();
