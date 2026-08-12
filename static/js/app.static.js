(function () {
  const packages = window.zizPackages || {};
  const corePkg = packages.core || {};
  const bridgeApi = corePkg.bridge || null;
  const dialogApi = corePkg.dialog || null;
  const shellApi = packages.app?.shell || {};
  const bodyRoot = document.body;
  const bodyDataset = bodyRoot?.dataset || {};

  function showDialog(message, options = {}) {
    if (dialogApi?.show) {
      dialogApi.show(message, options);
      return;
    }
    window.alert(String(message ?? ""));
  }

  function toAbsolutePageUrl(relativeUrl) {
    try {
      return new URL(String(relativeUrl || ""), window.location.href).toString();
    } catch (_) {
      return String(relativeUrl || "");
    }
  }

  async function handleWindowControl(action) {
    if (!bridgeApi?.available?.()) return;
    try {
      await bridgeApi.call("app.windowControl", { action });
    } catch (err) {
      console.error("[window-control] failed", action, err);
    }
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

  shellApi.updateHeader?.({
    value: String(bodyDataset.pageTitle || bodyDataset.shellTitle || ""),
    readOnly: true,
    undo: { disabled: true },
    redo: { disabled: true },
  });

  shellApi.bindSidebar?.({
    onToggle: () => {
      const homeUrl = String(bodyDataset.homeUrl || "./home.html").trim();
      if (!homeUrl) return;
      window.location.href = toAbsolutePageUrl(homeUrl);
    },
    onModeItem: ({ navUrl }) => {
      if (!navUrl) return;
      window.location.href = navUrl;
    },
    onActionItem: ({ navUrl }) => {
      if (!navUrl) return;
      window.location.href = navUrl;
    },
  });

  shellApi.bindHeader?.({
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
})();
