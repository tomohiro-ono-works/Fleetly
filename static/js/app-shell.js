(function () {
  const body = document.body;
  const main = body?.querySelector("[data-shell-main]");
  if (!body) return;

  const page = body.dataset.shellPage || "home";
  const title = body.dataset.shellTitle || "トップ画面";
  const isDataflow = page === "dataflow" && new URLSearchParams(window.location.search).get("mode") === "dataflow";
  const isFlowLayoutPage = page === "workflow" || page === "dataflow";
  const disablePrimaryActions = page === "settings";
  const embeddedMode = new URLSearchParams(window.location.search).get("embedded") === "1";
  const urls = {
    dataflow: body.dataset.dataflowUrl || "./dataflow.html",
    settings: body.dataset.settingsUrl || "./settings.html",
  };
  const runtimeVersion = new URLSearchParams(window.location.search).get("v") || "";
  const scriptLoadPromises = new Map();

  function current(name) {
    const active = name === "dataflow" ? isDataflow : (page === name && !isDataflow);
    return active ? ' is-current" aria-current="page"' : '"';
  }

  function renderSidebar() {
    return `
      <aside class="sidebar" aria-label="主要ナビゲーション">
        <nav id="sidebarNav" class="sidebar-nav">
          <button class="sidebar-item" data-sidebar-action="project-select" title="プロジェクト選択"><span class="sidebar-item-icon"><img src="./icons/launch_project.svg" alt="" /></span><span class="sidebar-item-label">プロジェクト選択</span></button>
          <button class="sidebar-item" data-sidebar-action="explorer" title="エクスプローラー"><span class="sidebar-item-icon"><img src="./icons/folder_open.svg" alt="" /></span><span class="sidebar-item-label">エクスプローラー</span></button>
        </nav>
        <div class="sidebar-bottom">
          <button class="sidebar-item sidebar-item-settings${current("settings")} data-sidebar-action="settings" data-nav-url="${urls.settings}" title="設定"><span class="sidebar-item-icon"><img src="./icons/settings.svg" alt="" /></span><span class="sidebar-item-label">設定</span></button>
        </div>
      </aside>
    `;
  }

  function renderHeader() {
    return `
      <header>
        <div class="header-inner">
          <div class="header-left">
            <button id="sidebarToggle" class="header-action-btn header-icon-btn header-home-btn" type="button" aria-label="トップ画面へ戻る" aria-expanded="false" aria-controls="sidebarNav" title="トップ画面へ戻る">
              <img src="./icons/ziz_one.svg" alt="" />
            </button>
          </div>
          <div class="actions">
            <button id="btnDiagnostics" class="header-action-btn header-icon-btn" type="button" aria-label="診断" title="診断"><img src="./icons/healthcheck.svg" alt="" /></button>
            <button id="btnWindowMinimize" class="header-action-btn header-icon-btn" type="button" aria-label="最小化" title="最小化"><img src="./icons/small.svg" alt="" /></button>
            <button id="btnWindowMaximize" class="header-action-btn header-icon-btn window-control-btn" type="button" aria-label="拡大" title="拡大"><img src="./icons/middle.svg" alt="" /></button>
            <button id="btnWindowClose" class="header-action-btn header-icon-btn window-control-btn is-close" type="button" aria-label="閉じる" title="閉じる"><img src="./icons/closel.svg" alt="" /></button>
          </div>
        </div>
      </header>
    `;
  }

  function renderRightSidebar() {
    if (!isFlowLayoutPage) return "";
    return `
      <aside id="rightSidebar" class="right-sidebar" aria-label="ノード詳細">
        <div id="rightSidebarResizer" class="right-sidebar-resizer" role="separator" aria-orientation="vertical" aria-label="右サイドバー幅"></div>
        <div id="rightSidebarContent" class="right-sidebar-content">
          <div id="nodeDetail"></div>
        </div>
      </aside>
    `;
  }

  if (main && !body.querySelector(".app-shell")) {
    const shell = document.createElement("div");
    shell.className = `app-shell${isFlowLayoutPage ? " app-shell--with-right-sidebar" : ""}`;
    if (embeddedMode) {
      body.classList.add("embedded-mode");
      shell.innerHTML = `<div class="app-main"></div>${renderRightSidebar()}`;
    } else {
      shell.innerHTML = `${renderHeader()}${renderSidebar()}<div class="app-main"></div>${renderRightSidebar()}`;
    }
    const appMain = shell.querySelector(".app-main");
    if (appMain) {
      main.removeAttribute("data-shell-main");
      appMain.appendChild(main);
      body.insertBefore(shell, body.firstChild);
      if (isFlowLayoutPage) {
        body.classList.add("flow-layout-page");
      }
    }
  }

  const refs = {
    body,
    appShell: document.querySelector(".app-shell"),
    appMain: document.querySelector(".app-shell > .app-main"),
    header: document.querySelector(".app-shell > header"),
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
    headerInner: document.querySelector(".header-inner"),
    rightSidebar: document.getElementById("rightSidebar"),
    rightSidebarToggle: document.getElementById("rightSidebarToggle"),
    rightSidebarNav: document.getElementById("rightSidebarNav"),
    rightPanelItems: Array.from(document.querySelectorAll("[data-right-panel]")),
    rightSidebarResizer: document.getElementById("rightSidebarResizer"),
    rightSidebarContent: document.getElementById("rightSidebarContent"),
  };

  function syncShellMetrics() {
    const headerHeight = Math.max(0, Math.round(refs.header?.offsetHeight || 0));
    body.style.setProperty("--shell-header-height", `${headerHeight}px`);
    body.style.setProperty("--shell-content-height", `${Math.max(0, window.innerHeight - headerHeight)}px`);
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
      return String(url || "");
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
    if (scriptLoadPromises.has(src)) {
      return scriptLoadPromises.get(src);
    }
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
    if (refs.sidebarToggle) {
      refs.sidebarToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    }
    window.requestAnimationFrame(() => {
      syncShellMetrics();
      if (typeof onApplied === "function") onApplied();
    });
  }

  function isRightSidebarCollapsed() {
    return body.classList.contains("right-sidebar-collapsed");
  }

  function setRightSidebarCollapsed(collapsed, onApplied) {
    if (!isFlowLayoutPage) return;
    body.classList.toggle("right-sidebar-collapsed", Boolean(collapsed));
    if (refs.rightSidebarToggle) {
      refs.rightSidebarToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }
    window.requestAnimationFrame(() => {
      syncShellMetrics();
      if (typeof onApplied === "function") onApplied();
    });
  }

  function setRightSidebarWidth(px, onApplied) {
    if (!isFlowLayoutPage) return;
    const width = Math.max(1, Math.floor(Number(px) || 0));
    body.style.setProperty("--right-sidebar-width", `${width}px`);
    window.requestAnimationFrame(() => {
      syncShellMetrics();
      if (typeof onApplied === "function") onApplied();
    });
  }

  function setActiveRightPanel(panelKey) {
    const current = String(panelKey || "").trim();
    refs.rightPanelItems.forEach((item) => {
      const key = String(item.dataset.rightPanel || "").trim();
      const active = key === current;
      item.classList.toggle("is-current", active);
      if (active) {
        item.setAttribute("aria-current", "true");
      } else {
        item.removeAttribute("aria-current");
      }
    });
  }

  function setActiveSidebar(targetMode) {
    refs.sidebarModeItems.forEach((item) => {
      const currentMode = String(item.dataset.appMode || "");
      const active = currentMode === String(targetMode || "");
      item.classList.toggle("is-current", active);
      if (active) {
        item.setAttribute("aria-current", "page");
      } else {
        item.removeAttribute("aria-current");
      }
    });
    refs.sidebarActionItems.forEach((item) => {
      item.classList.remove("is-current");
      item.removeAttribute("aria-current");
    });
  }

  function updateHeader(options = {}) {
    if (refs.flowNameInput) {
      if (Object.prototype.hasOwnProperty.call(options, "value") && document.activeElement !== refs.flowNameInput) {
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
    [["btnUndo", options.undo], ["btnRedo", options.redo], ["btnRun", options.run], ["btnReset", options.reset], ["btnSave", options.save], ["btnDiagnostics", options.diagnostics]].forEach(([key, config]) => {
      const button = refs[key];
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
    });
    window.requestAnimationFrame(syncShellMetrics);
  }

  function bindSidebar(callbacks = {}) {
    if (refs.sidebarToggle) {
      refs.sidebarToggle.onclick = (event) => {
        callbacks.onToggle?.({ event, item: refs.sidebarToggle, expanded: isSidebarExpanded() });
      };
    }
    refs.sidebarModeItems.forEach((item) => {
      item.onclick = (event) => {
        callbacks.onModeItem?.({
          event,
          item,
          mode: String(item.dataset.appMode || ""),
          navUrl: toAbsoluteUrl(item.dataset.navUrl || ""),
          expanded: isSidebarExpanded(),
        });
      };
    });
    refs.sidebarActionItems.forEach((item) => {
      item.onclick = (event) => {
        callbacks.onActionItem?.({
          event,
          item,
          action: String(item.dataset.sidebarAction || ""),
          navUrl: toAbsoluteUrl(item.dataset.navUrl || ""),
          expanded: isSidebarExpanded(),
        });
      };
    });
  }

  function bindHeader(callbacks = {}) {
    if (refs.btnUndo) refs.btnUndo.onclick = (event) => callbacks.onUndo?.({ event, item: refs.btnUndo });
    if (refs.btnRedo) refs.btnRedo.onclick = (event) => callbacks.onRedo?.({ event, item: refs.btnRedo });
    if (refs.btnRun) refs.btnRun.onclick = (event) => callbacks.onRun?.({ event, item: refs.btnRun });
    if (refs.btnReset) refs.btnReset.onclick = (event) => callbacks.onReset?.({ event, item: refs.btnReset });
    if (refs.btnSave) refs.btnSave.onclick = (event) => callbacks.onSave?.({ event, item: refs.btnSave });
    if (refs.btnDiagnostics) refs.btnDiagnostics.onclick = (event) => callbacks.onDiagnostics?.({ event, item: refs.btnDiagnostics });
    if (refs.btnWindowMinimize) refs.btnWindowMinimize.onclick = (event) => callbacks.onWindowControl?.({ event, item: refs.btnWindowMinimize, action: "minimize" });
    if (refs.btnWindowMaximize) refs.btnWindowMaximize.onclick = (event) => callbacks.onWindowControl?.({ event, item: refs.btnWindowMaximize, action: "maximize" });
    if (refs.btnWindowClose) refs.btnWindowClose.onclick = (event) => callbacks.onWindowControl?.({ event, item: refs.btnWindowClose, action: "close" });
    if (refs.headerInner) {
      refs.headerInner.onmousedown = (event) => {
        callbacks.onHeaderDrag?.({
          event,
          item: refs.headerInner,
          isInteractiveTarget: !!event.target.closest("button, input, select, textarea, a, label"),
        });
      };
    }
    if (refs.flowNameInput) {
      refs.flowNameInput.oninput = (event) => callbacks.onTitleInput?.({ event, item: refs.flowNameInput, value: String(event.target.value || "") });
      refs.flowNameInput.onchange = (event) => callbacks.onTitleChange?.({ event, item: refs.flowNameInput, value: String(event.target.value || "") });
    }
  }

  function bindRightSidebar(callbacks = {}) {
    if (refs.rightSidebarToggle) {
      refs.rightSidebarToggle.onclick = (event) => {
        callbacks.onToggle?.({
          event,
          item: refs.rightSidebarToggle,
          collapsed: isRightSidebarCollapsed()
        });
      };
    }
    refs.rightPanelItems.forEach((item) => {
      item.onclick = (event) => {
        callbacks.onPanelItem?.({
          event,
          item,
          panel: String(item.dataset.rightPanel || ""),
          collapsed: isRightSidebarCollapsed()
        });
      };
    });
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

  window.zizShell = {
    bindSidebar,
    bindHeader,
    bindRightSidebar,
    updateHeader,
    isSidebarExpanded,
    setSidebarExpanded,
    setActiveSidebar,
    isRightSidebarCollapsed,
    setRightSidebarCollapsed,
    setRightSidebarWidth,
    setActiveRightPanel,
    getRightSidebarRefs,
    loadScriptOnce,
  };

  window.addEventListener("resize", () => {
    syncShellMetrics();
  });
  window.requestAnimationFrame(syncShellMetrics);
})();
