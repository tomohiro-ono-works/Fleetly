(function () {
  const body = document.body;
  const main = body?.querySelector("[data-shell-main]");
  if (!body) return;

  const page = body.dataset.shellPage || "home";
  const title = body.dataset.shellTitle || "トップ画面";
  const isDataflow = page === "dataflow" && new URLSearchParams(window.location.search).get("mode") === "dataflow";
  const disablePrimaryActions = page === "form-builder" || page === "settings";
  const urls = {
    dataflow: body.dataset.dataflowUrl || "./dataflow.html",
    queryBuilder: body.dataset.queryBuilderUrl || "./query-builder.html",
    formBuilder: body.dataset.formBuilderUrl || "./form-builder.html",
    settings: body.dataset.settingsUrl || "./settings.html",
  };

  function current(name) {
    const active = name === "dataflow" ? isDataflow : (page === name && !isDataflow);
    return active ? ' is-current" aria-current="page"' : '"';
  }

  function renderSidebar() {
    return `
      <aside class="sidebar" aria-label="主要ナビゲーション">
        <div class="sidebar-top">
          <button id="sidebarToggle" class="sidebar-toggle" type="button" aria-label="トップ画面へ戻る" aria-expanded="false" aria-controls="sidebarNav" title="トップ画面へ戻る">
            <span class="sidebar-toggle-icon" aria-hidden="true"><img src="./icons/icon.png" alt="" /></span>
          </button>
          <div class="sidebar-brand-submark" aria-hidden="true"><img src="./icons/icon2.png" alt="" /></div>
        </div>
        <nav id="sidebarNav" class="sidebar-nav">
          <button class="sidebar-item${current("dataflow")} data-app-mode="dataflow" data-nav-url="${urls.dataflow}" title="ワークフロー作成"><span class="sidebar-item-icon"><img src="./icons/dataflow.svg" alt="" /></span><span class="sidebar-item-label">データフロー作成</span></button>
          <button class="sidebar-item${current("query-builder")} data-app-mode="query-builder" data-nav-url="${urls.queryBuilder}" title="クエリビルダー"><span class="sidebar-item-icon"><img src="./icons/database.svg" alt="" /></span><span class="sidebar-item-label">クエリビルダー</span></button>
          <button class="sidebar-item${current("form-builder")} data-sidebar-action="form" data-nav-url="${urls.formBuilder}" title="入力フォーム作成"><span class="sidebar-item-icon"><img src="./icons/form.svg" alt="" /></span><span class="sidebar-item-label">入力フォーム作成</span></button>
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
            <input id="flowName" class="flow-name-input" type="text" value="${title}" />
          </div>
          <div class="actions">
            <button id="btnUndo" class="header-action-btn header-text-btn" type="button" aria-label="戻る" title="戻る" ${disablePrimaryActions ? "disabled" : ""}>戻る</button>
            <button id="btnRedo" class="header-action-btn header-text-btn" type="button" aria-label="進む" title="進む" ${disablePrimaryActions ? "disabled" : ""}>進む</button>
            <button id="btnRun" class="header-action-btn" type="button" aria-label="実行" title="実行" ${disablePrimaryActions ? "disabled" : ""}><img src="./icons/run.svg" alt="" /></button>
            <button id="btnReset" class="header-action-btn" type="button" aria-label="インポート" title="インポート" ${disablePrimaryActions ? "disabled" : ""}><img src="./icons/import.svg" alt="" /></button>
            <button id="btnSave" class="header-action-btn" type="button" aria-label="保存" title="保存" ${disablePrimaryActions ? "disabled" : ""}><img src="./icons/save.svg" alt="" /></button>
            <button id="btnDiagnostics" class="header-action-btn header-text-btn" type="button" aria-label="診断" title="診断">診断</button>
            <button id="btnWindowMinimize" class="header-action-btn" type="button" aria-label="最小化" title="最小化">-</button>
            <button id="btnWindowMaximize" class="header-action-btn window-control-btn" type="button" aria-label="拡大" title="拡大">□</button>
            <button id="btnWindowClose" class="header-action-btn window-control-btn is-close" type="button" aria-label="閉じる" title="閉じる">×</button>
          </div>
        </div>
      </header>
    `;
  }

  if (main && !body.querySelector(".app-shell")) {
    const shell = document.createElement("div");
    shell.className = "app-shell";
    shell.innerHTML = `${renderSidebar()}<div class="app-main">${renderHeader()}</div>`;
    const appMain = shell.querySelector(".app-main");
    if (appMain) {
      main.removeAttribute("data-shell-main");
      appMain.appendChild(main);
      body.insertBefore(shell, body.firstChild);
    }
  }

  const refs = {
    body,
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
  };

  function toAbsoluteUrl(url) {
    try {
      return new URL(String(url || ""), window.location.href).toString();
    } catch (_) {
      return String(url || "");
    }
  }

  function isSidebarExpanded() {
    return body.classList.contains("sidebar-expanded");
  }

  function setSidebarExpanded(expanded, onApplied) {
    body.classList.toggle("sidebar-expanded", Boolean(expanded));
    if (refs.sidebarToggle) {
      refs.sidebarToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    }
    if (typeof onApplied === "function") {
      window.requestAnimationFrame(onApplied);
    }
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
          // expanded: isSidebarExpanded(),
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

  window.zizShell = {
    bindSidebar,
    bindHeader,
    updateHeader,
    isSidebarExpanded,
    setSidebarExpanded,
    setActiveSidebar,
  };
})();
