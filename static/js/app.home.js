(function () {
  const packages = window.zizPackages || {};
  const corePkg = packages.core || {};
  const bridgeApi = corePkg.bridge || null;
  const workspaceApi = packages.app?.workspace || null;
  const documentsApi = packages.app?.documents || null;
  const homeView = packages.app?.homeView || null;
  const dialogApi = corePkg.dialog || null;
  const shellApi = packages.app?.shell || {};
  const STORAGE_KEY_PENDING_FLOW = "ziz.pendingFlow.v1";
  const STORAGE_KEY_PENDING_SIDEBAR_ACTION = "ziz.workspace.pendingSidebarAction.v1";
  const RECENT_ROOTS_CONFIG_SCOPE = "config";
  const RECENT_ROOTS_CONFIG_PATH = "recent_roots.json";
  const WORKFLOWS_DIR_NAME = "workflows";

  const flowRoot = document.getElementById("flowchart");
  const detailRoot = document.getElementById("nodeDetail");
  const bodyRoot = document.body;
  const bodyDataset = bodyRoot?.dataset || {};
  const runtimeVersion = new URLSearchParams(window.location.search).get("v") || "";
  const btnReset = document.getElementById("btnReset");
  const btnRun = document.getElementById("btnRun");
  const btnSave = document.getElementById("btnSave");

  const homeViewModel = {
    visible: true,
    recentProjects: [],
    templates: [],
    refreshToken: 0,
  };

  function showDialog(message, options = {}) {
    if (dialogApi?.show) {
      dialogApi.show(message, options);
      return;
    }
    window.alert(String(message ?? ""));
  }
  function getBridgeUnavailableMessage() {
    const message = bridgeApi?.unavailableMessage?.();
    return String(message || "ブリッジ未接続です。再読み込みしてください。");
  }
  const homeDocSessionId = (() => {
    const randomPart = window.crypto?.randomUUID?.().replace(/-/g, "")
      || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    return `docsession_${randomPart}`;
  })();

  function resolveWorkspaceTabId() {
    return homeDocSessionId;
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

  if (!workspaceApi || !documentsApi) {
    showFatal("workspace／documents adapterが読み込まれていません。");
    return;
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
    const normalized = String(mode || "").trim();
    const dataflowUrl = new URL(bodyDataset.dataflowUrl || "./dataflow.html", window.location.href);
    if (runtimeVersion && !dataflowUrl.searchParams.has("v")) {
      dataflowUrl.searchParams.set("v", runtimeVersion);
    }
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

  function storePendingSidebarAction(action) {
    const normalized = String(action || "").trim();
    if (!normalized) return;
    writeSessionJson(STORAGE_KEY_PENDING_SIDEBAR_ACTION, {
      action: normalized,
      ts: Date.now(),
    });
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
      const payload = await workspaceApi.readText({
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

  async function ensureWorkflowsRoot() {
    if (!bridgeApi?.available?.()) return "";
    const rootStatus = await workspaceApi.getRoot();
    const configRoot = String(rootStatus?.config_path || "").trim();
    const baseDir = getParentDir(configRoot);
    const workflowsPath = joinPath(baseDir, WORKFLOWS_DIR_NAME);
    if (workflowsPath) {
      try {
        const applied = await workspaceApi.setRoot({ root_path: workflowsPath });
        return String(applied?.root_path || workflowsPath);
      } catch (error) {
        if (String(error?.code || "") !== "E_NOT_FOUND") {
          throw error;
        }
      }
    }
    const picked = await workspaceApi.pickRoot({
      title: "プロジェクトルートを選択",
      current_value: workflowsPath || String(rootStatus?.root_path || ""),
    });
    if (!picked?.selected) return "";
    const applied = await workspaceApi.setRoot({ root_path: String(picked.root_path || "") });
    return String(applied?.root_path || picked.root_path || "");
  }

  function renderHome() {
    if (typeof homeView?.render !== "function") {
      showFatal("home viewが見つかりません");
      return;
    }
    homeView.render({
      flowRoot,
      detailRoot,
      model: homeViewModel,
      onAction: handleHomeAction
    });
  }

  async function refreshHomeLists() {
    const token = ++homeViewModel.refreshToken;
    if (!bridgeApi?.available?.()) {
      homeViewModel.recentProjects = [];
      homeViewModel.templates = [];
      if (token === homeViewModel.refreshToken) renderHome();
      return;
    }
    try {
      const [recentProjects, templatePayload] = await Promise.all([
        loadRecentProjects(),
        documentsApi.list({ scope: "local", kind: "template" })
      ]);
      if (token !== homeViewModel.refreshToken) return;
      homeViewModel.recentProjects = Array.isArray(recentProjects) ? recentProjects.slice(0, 10) : [];
      homeViewModel.templates = Array.isArray(templatePayload?.items) ? templatePayload.items : [];
      renderHome();
    } catch (err) {
      console.error("failed to refresh home lists", err);
      if (token !== homeViewModel.refreshToken) return;
      homeViewModel.recentProjects = [];
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
      document_ref: String(payload.document_ref || ""),
      doc_session_id: String(payload.doc_session_id || resolveWorkspaceTabId()),
      document: payload.document,
      hidden_bindings: payload.hidden_bindings || {},
      mtime_ns: String(payload.mtime_ns || "")
    });
    navigateToUrl(buildPageUrlForMode(mode));
  }

  async function handleHomeAction(action) {
    const type = String(action?.type || "");
    const kind = String(action?.kind || "");
    if (type === "dismiss-home") {
      navigateToUrl(buildPageUrlForMode("dataflow"));
      return;
    }
    if (type === "create-flow") {
      return;
    }
    if (type === "create-sql") {
      navigateToUrl(buildPageUrlForMode("dataflow"));
      return;
    }
    if (type === "open-flow") {
      if (!bridgeApi?.available?.()) return;
      try {
        if (kind === "recent") {
          const rootPath = normalizeRootPath(action?.item?.root_path || action?.item?.display_hint || "");
          if (!rootPath) return;
          await workspaceApi.setRoot({ root_path: rootPath });
          storePendingSidebarAction("explorer");
          navigateToUrl(buildPageUrlForMode("dataflow"));
          return;
        }
        const token = String(action?.item?.document_token || "");
        if (!token) return;
        if (kind === "template") {
          const rootPath = await ensureWorkflowsRoot();
          if (!rootPath) return;
          const loaded = await documentsApi.load({
            document_token: token,
            doc_session_id: resolveWorkspaceTabId(),
          });
          if (!loaded || loaded.selected === false) return;
          const fileName = buildAutoSavedTemplateFileName(loaded);
          const savedTemplate = await documentsApi.save({
            mode: String(loaded.mode || "dataflow"),
            file_name: fileName,
            document_ref: loaded.document_ref,
            document: loaded.document,
            scope: "root",
            rel_path: fileName,
            doc_session_id: resolveWorkspaceTabId(),
          });
          loaded.file_name = fileName;
          loaded.document_ref = String(savedTemplate?.document_ref || loaded.document_ref || "");
          loaded.mtime_ns = String(savedTemplate?.mtime_ns || "");
          loaded.doc_session_id = resolveWorkspaceTabId();
          openLoadedFlow(loaded);
          return;
        }
        const payload = await documentsApi.load({
          document_token: token,
          doc_session_id: resolveWorkspaceTabId(),
        });
        payload.doc_session_id = resolveWorkspaceTabId();
        openLoadedFlow(payload);
      } catch (err) {
        showDialog(`読み込みに失敗しました。\n${err?.message || err}`, { kind: "error", title: "読込エラー" });
      }
    }
  }

  async function handleBridgeLoad() {
    if (!bridgeApi?.available?.()) {
      showDialog(getBridgeUnavailableMessage(), { kind: "info", title: "インポート" });
      return;
    }
    const payload = await documentsApi.load({
      doc_session_id: resolveWorkspaceTabId(),
    });
    payload.doc_session_id = resolveWorkspaceTabId();
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
    onActionItem: ({ action, navUrl }) => {
      if (navUrl) {
        navigateToUrl(navUrl);
        return;
      }
      const normalized = String(action || "").trim();
      if (normalized === "project-select" || normalized === "explorer") {
        storePendingSidebarAction(normalized);
        navigateToUrl(buildPageUrlForMode("dataflow"));
      }
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
