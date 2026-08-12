(function () {
  const body = document.body;
  const main = body?.querySelector("[data-shell-main]");
  const packages = window.zizPackages = window.zizPackages || {};
  const shellFactory = packages.uiShell?.createAppShell;
  const view = packages.__zizaiShellAdapter || {};
  if (!body || !main || typeof shellFactory !== "function") return;
  if (body.querySelector(".zui-shell")) return;

  const page = body.dataset.shellPage || "home";
  const isFlowLayoutPage = page === "dataflow";
  const embeddedMode = new URLSearchParams(window.location.search).get("embedded") === "1";
  const runtimeVersion = new URLSearchParams(window.location.search).get("v") || "";
  const urls = {
    home: body.dataset.homeUrl || "./home.html",
    dataflow: body.dataset.dataflowUrl || "./dataflow.html",
    settings: body.dataset.settingsUrl || "./settings.html"
  };
  const scriptLoadPromises = new Map();
  const metricsCallbacks = [];
  let metricsFrameId = 0;
  let lastContentHeight = -1;

  main.removeAttribute("data-shell-main");
  const mountRoot = document.createElement("div");
  mountRoot.className = "ziz-app-shell-mount";
  body.insertBefore(mountRoot, body.firstChild);

  const appContent = view.createAppContent(main, isFlowLayoutPage);
  const instance = shellFactory({
    root: mountRoot,
    layout: {
      sidebarVisible: false,
      rightPanelVisible: false,
      bottomPanelVisible: false
    },
    regions: { main: appContent }
  });
  instance.mount();

  const shellRoot = mountRoot.querySelector(".zui-shell");
  shellRoot?.classList.add("ziz-app-shell");
  if (embeddedMode) {
    body.classList.add("embedded-mode");
  } else {
    instance.setRegion("activitybar", view.createNavigation({ page, urls }));
    shellRoot?.appendChild(view.createWindowActions());
  }
  if (isFlowLayoutPage) body.classList.add("flow-layout-page");
  delete packages.__zizaiShellAdapter;

  const refs = {
    body,
    appShell: shellRoot,
    appMain: shellRoot?.querySelector(".zui-shell__main"),
    sidebarToggle: document.getElementById("sidebarToggle"),
    sidebarModeItems: Array.from(document.querySelectorAll("[data-app-mode]")),
    sidebarActionItems: Array.from(document.querySelectorAll("[data-sidebar-action]")),
    flowNameInput: document.getElementById("flowName"),
    btnUndo: document.getElementById("btnUndo"),
    btnRedo: document.getElementById("btnRedo"),
    btnRun: document.getElementById("btnRun"),
    btnReset: document.getElementById("btnReset"),
    btnSave: document.getElementById("btnSave"),
    btnDiagnostics: document.getElementById("btnDiagnostics"),
    btnWindowMinimize: document.getElementById("btnWindowMinimize"),
    btnWindowMaximize: document.getElementById("btnWindowMaximize"),
    btnWindowClose: document.getElementById("btnWindowClose"),
    rightSidebar: document.getElementById("rightSidebar"),
    rightSidebarToggle: document.getElementById("rightSidebarToggle"),
    rightPanelItems: Array.from(document.querySelectorAll("[data-right-panel]")),
    rightSidebarResizer: document.getElementById("rightSidebarResizer"),
    rightSidebarContent: document.getElementById("rightSidebarContent")
  };

  function syncShellMetrics() {
    const headerHeight = 0;
    const contentHeight = Math.max(0, window.innerHeight - headerHeight);
    if (contentHeight === lastContentHeight) return;
    lastContentHeight = contentHeight;
    body.style.setProperty("--shell-header-height", `${headerHeight}px`);
    body.style.setProperty("--shell-content-height", `${contentHeight}px`);
  }

  function scheduleShellMetrics(callback) {
    if (typeof callback === "function") metricsCallbacks.push(callback);
    if (metricsFrameId) return;
    metricsFrameId = window.requestAnimationFrame(() => {
      metricsFrameId = 0;
      syncShellMetrics();
      metricsCallbacks.splice(0).forEach((onApplied) => onApplied());
    });
  }

  function toAbsoluteUrl(url) {
    const raw = String(url || "").trim();
    if (!raw) return "";
    try {
      const target = new URL(raw, window.location.href);
      if (runtimeVersion && !target.searchParams.has("v")) {
        target.searchParams.set("v", runtimeVersion);
      }
      return target.toString();
    } catch (_) {
      return raw;
    }
  }

  function normalizeScriptSrc(url) {
    const target = new URL(String(url || ""), window.location.href);
    if (runtimeVersion && !target.searchParams.has("v")) {
      target.searchParams.set("v", runtimeVersion);
    }
    return target.toString();
  }

  function loadScriptOnce(url) {
    const src = normalizeScriptSrc(url);
    if (scriptLoadPromises.has(src)) return scriptLoadPromises.get(src);
    const existing = Array.from(document.scripts || []).find((script) => script.src === src);
    if (existing) {
      const resolved = Promise.resolve(existing);
      scriptLoadPromises.set(src, resolved);
      return resolved;
    }
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = false;
      script.onload = () => resolve(script);
      script.onerror = () => {
        scriptLoadPromises.delete(src);
        reject(new Error(`Script load failed: ${src}`));
      };
      document.head.appendChild(script);
    });
    scriptLoadPromises.set(src, promise);
    return promise;
  }

  function isSidebarExpanded() {
    return body.classList.contains("sidebar-expanded");
  }

  function setSidebarExpanded(expanded, onApplied) {
    body.classList.toggle("sidebar-expanded", Boolean(expanded));
    refs.sidebarToggle?.setAttribute("aria-expanded", expanded ? "true" : "false");
    scheduleShellMetrics(onApplied);
  }

  function isRightSidebarCollapsed() {
    return body.classList.contains("right-sidebar-collapsed");
  }

  function setRightSidebarCollapsed(collapsed, onApplied) {
    if (!isFlowLayoutPage) return;
    body.classList.toggle("right-sidebar-collapsed", Boolean(collapsed));
    refs.rightSidebarToggle?.setAttribute("aria-expanded", collapsed ? "false" : "true");
    scheduleShellMetrics(onApplied);
  }

  function setRightSidebarWidth(px, onApplied) {
    if (!isFlowLayoutPage) return;
    const width = Math.max(1, Math.floor(Number(px) || 0));
    body.style.setProperty("--right-sidebar-width", `${width}px`);
    scheduleShellMetrics(onApplied);
  }

  function setActiveRightPanel(panelKey) {
    const current = String(panelKey || "").trim();
    refs.rightPanelItems.forEach((item) => {
      const active = String(item.dataset.rightPanel || "").trim() === current;
      item.classList.toggle("is-current", active);
      if (active) item.setAttribute("aria-current", "true");
      else item.removeAttribute("aria-current");
    });
  }

  function setActiveSidebar(targetMode) {
    refs.sidebarModeItems.forEach((item) => {
      const active = String(item.dataset.appMode || "") === String(targetMode || "");
      item.classList.toggle("is-current", active);
      if (active) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
    refs.sidebarActionItems.forEach((item) => {
      item.classList.remove("is-current");
      item.removeAttribute("aria-current");
    });
  }

  function updateButton(button, config) {
    if (!button || !config) return;
    if (Object.prototype.hasOwnProperty.call(config, "title")) {
      button.setAttribute("title", String(config.title || ""));
    }
    if (Object.prototype.hasOwnProperty.call(config, "ariaLabel")) {
      button.setAttribute("aria-label", String(config.ariaLabel || ""));
    }
    if (Object.prototype.hasOwnProperty.call(config, "disabled")) {
      button.disabled = !!config.disabled;
      button.setAttribute("aria-disabled", config.disabled ? "true" : "false");
    }
  }

  function updateHeader(options = {}) {
    if (refs.flowNameInput) {
      if (Object.prototype.hasOwnProperty.call(options, "value")
        && document.activeElement !== refs.flowNameInput) {
        refs.flowNameInput.value = String(options.value || "");
      }
      if (Object.prototype.hasOwnProperty.call(options, "placeholder")) {
        refs.flowNameInput.placeholder = String(options.placeholder || "");
      }
      if (Object.prototype.hasOwnProperty.call(options, "ariaLabel")) {
        refs.flowNameInput.setAttribute("aria-label", String(options.ariaLabel || ""));
      }
      if (Object.prototype.hasOwnProperty.call(options, "readOnly")) {
        refs.flowNameInput.readOnly = !!options.readOnly;
      }
    }
    [
      [refs.btnUndo, options.undo],
      [refs.btnRedo, options.redo],
      [refs.btnRun, options.run],
      [refs.btnReset, options.reset],
      [refs.btnSave, options.save],
      [refs.btnDiagnostics, options.diagnostics]
    ].forEach(([button, config]) => updateButton(button, config));
    scheduleShellMetrics();
  }

  function bindSidebar(callbacks = {}) {
    if (refs.sidebarToggle) {
      refs.sidebarToggle.onclick = (event) => {
        callbacks.onToggle?.({ event, item: refs.sidebarToggle, expanded: isSidebarExpanded() });
      };
    }
    refs.sidebarModeItems.forEach((item) => {
      item.onclick = (event) => callbacks.onModeItem?.({
        event,
        item,
        mode: String(item.dataset.appMode || ""),
        navUrl: toAbsoluteUrl(item.dataset.navUrl || ""),
        expanded: isSidebarExpanded()
      });
    });
    refs.sidebarActionItems.forEach((item) => {
      item.onclick = (event) => callbacks.onActionItem?.({
        event,
        item,
        action: String(item.dataset.sidebarAction || ""),
        navUrl: toAbsoluteUrl(item.dataset.navUrl || ""),
        expanded: isSidebarExpanded()
      });
    });
  }

  function bindHeader(callbacks = {}) {
    const bindings = [
      [refs.btnUndo, "onUndo"],
      [refs.btnRedo, "onRedo"],
      [refs.btnRun, "onRun"],
      [refs.btnReset, "onReset"],
      [refs.btnSave, "onSave"],
      [refs.btnDiagnostics, "onDiagnostics"]
    ];
    bindings.forEach(([button, callback]) => {
      if (button) button.onclick = (event) => callbacks[callback]?.({ event, item: button });
    });
    const windowBindings = [
      [refs.btnWindowMinimize, "minimize"],
      [refs.btnWindowMaximize, "maximize"],
      [refs.btnWindowClose, "close"]
    ];
    windowBindings.forEach(([button, action]) => {
      if (button) {
        button.onclick = (event) => callbacks.onWindowControl?.({ event, item: button, action });
      }
    });
    const dragRegion = document.getElementById("workspaceTabHeader");
    if (dragRegion) {
      dragRegion.onmousedown = (event) => callbacks.onHeaderDrag?.({
        event,
        item: dragRegion,
        isInteractiveTarget: !!event.target.closest("button, input, select, textarea, a, label")
      });
    }
    if (refs.flowNameInput) {
      refs.flowNameInput.oninput = (event) => callbacks.onTitleInput?.({
        event,
        item: refs.flowNameInput,
        value: String(event.target.value || "")
      });
      refs.flowNameInput.onchange = (event) => callbacks.onTitleChange?.({
        event,
        item: refs.flowNameInput,
        value: String(event.target.value || "")
      });
    }
  }

  function getRightSidebarRefs() {
    return {
      enabled: isFlowLayoutPage,
      container: refs.rightSidebar,
      rail: null,
      toggle: refs.rightSidebarToggle,
      resizer: refs.rightSidebarResizer,
      content: refs.rightSidebarContent
    };
  }

  bindSidebar({
    onToggle() {
      window.location.href = toAbsoluteUrl(urls.home);
    },
    onActionItem({ action, navUrl }) {
      if (navUrl) {
        window.location.href = navUrl;
        return;
      }
      const selectedAction = String(action || "").trim();
      if (!selectedAction) return;
      window.dispatchEvent(new CustomEvent("ziz:sidebar-action", {
        detail: { action: selectedAction }
      }));
    }
  });

  const app = packages.app = packages.app || {};
  app.shell = Object.freeze({
    instance,
    bindSidebar,
    bindHeader,
    updateHeader,
    isSidebarExpanded,
    setSidebarExpanded,
    setActiveSidebar,
    isRightSidebarCollapsed,
    setRightSidebarCollapsed,
    setRightSidebarWidth,
    setActiveRightPanel,
    getRightSidebarRefs,
    loadScriptOnce
  });

  window.addEventListener("resize", scheduleShellMetrics);
  scheduleShellMetrics();
})();
