(function (root) {
  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__uiShellModules || {};
  const types = modules.shellTypes;

  function element(documentRef, tagName, className, region) {
    const node = documentRef.createElement(tagName);
    node.className = className;
    if (region) node.dataset.shellRegion = region;
    return node;
  }

  function buildShell(documentRef) {
    const shell = element(documentRef, "div", "zui-shell");
    const topbar = element(documentRef, "header", "zui-shell__topbar", "topbar");
    const topbarContent = element(documentRef, "div", "zui-shell__region-content");
    const topbarCommands = element(documentRef, "div", "zui-shell__commands");
    topbar.append(topbarContent, topbarCommands);

    const activitybar = element(documentRef, "aside", "sidebar zui-shell__activitybar", "activitybar");
    const activityContent = element(documentRef, "div", "zui-shell__region-content");
    const activityItems = element(documentRef, "nav", "zui-shell__activities");
    activitybar.append(activityContent, activityItems);

    const sidebar = element(documentRef, "aside", "zui-shell__sidebar", "sidebar");
    const sidebarContent = element(documentRef, "div", "zui-shell__region-content");
    const sidebarResizer = element(documentRef, "div", "zui-shell__resizer zui-shell__resizer--sidebar");
    sidebarResizer.setAttribute("role", "separator");
    sidebarResizer.setAttribute("aria-orientation", "vertical");
    sidebar.append(sidebarContent, sidebarResizer);

    const main = element(documentRef, "section", "zui-shell__main");
    const tabbar = element(documentRef, "div", "zui-shell__tabbar");
    const tabs = element(documentRef, "div", "zui-shell__tabs");
    tabs.setAttribute("role", "tablist");
    const tabbarCommands = element(documentRef, "div", "zui-shell__commands");
    tabbar.append(tabs, tabbarCommands);
    const mainContent = element(documentRef, "div", "zui-shell__main-content", "main");
    const bottomPanel = element(documentRef, "section", "zui-shell__bottom-panel", "bottomPanel");
    const bottomPanelResizer = element(documentRef, "div", "zui-shell__resizer zui-shell__resizer--bottom");
    bottomPanelResizer.setAttribute("role", "separator");
    bottomPanelResizer.setAttribute("aria-orientation", "horizontal");
    const bottomContent = element(documentRef, "div", "zui-shell__region-content");
    bottomPanel.append(bottomPanelResizer, bottomContent);
    main.append(tabbar, mainContent, bottomPanel);

    const rightPanel = element(documentRef, "aside", "right-sidebar zui-shell__right-panel", "rightPanel");
    const rightPanelResizer = element(documentRef, "div", "zui-shell__resizer zui-shell__resizer--right");
    rightPanelResizer.setAttribute("role", "separator");
    rightPanelResizer.setAttribute("aria-orientation", "vertical");
    const panelCommands = element(documentRef, "div", "zui-shell__commands");
    const rightContent = element(documentRef, "div", "zui-shell__region-content");
    rightPanel.append(rightPanelResizer, panelCommands, rightContent);

    const statusbar = element(documentRef, "footer", "zui-shell__statusbar", "statusbar");
    const statusContent = element(documentRef, "div", "zui-shell__region-content");
    const statusItems = element(documentRef, "div", "zui-shell__status-items");
    const statusCommands = element(documentRef, "div", "zui-shell__commands");
    statusbar.append(statusContent, statusItems, statusCommands);
    shell.append(topbar, activitybar, sidebar, main, rightPanel, statusbar);

    return {
      root: shell,
      topbar,
      activitybar,
      sidebar,
      main,
      rightPanel,
      bottomPanel,
      statusbar,
      tabbar,
      tabs,
      activityItems,
      statusItems,
      sidebarResizer,
      rightPanelResizer,
      bottomPanelResizer,
      regionHosts: {
        topbar: topbarContent,
        activitybar: activityContent,
        sidebar: sidebarContent,
        main: mainContent,
        rightPanel: rightContent,
        bottomPanel: bottomContent,
        statusbar: statusContent
      },
      commandHosts: {
        topbar: topbarCommands,
        tabbar: tabbarCommands,
        panel: panelCommands,
        status: statusCommands
      }
    };
  }

  function createAppShell(options = {}) {
    const mountRoot = options.root;
    if (!mountRoot || mountRoot.nodeType !== 1) {
      throw new TypeError("createAppShell requires an HTMLElement root");
    }
    const documentRef = mountRoot.ownerDocument;
    const emitter = modules.createEmitter();
    const labels = { closeTab: "Close", dirty: "Modified", ...(options.labels || {}) };
    let activities = types.normalizeActivities(options.activities);
    let commands = types.normalizeCommands(options.commands);
    let tabs = [];
    let activeTabId = "";
    let status = [];
    let layout = types.normalizeLayout(options.layout);
    let mounted = false;
    let destroyed = false;
    let refs = null;
    let regionController = null;
    let layoutController = null;
    const regionContent = { ...(options.regions || {}) };

    function ensureActive() {
      if (destroyed) throw new Error("AppShell instance has been destroyed");
    }

    function syncVisibility() {
      if (!mounted) return;
      const hasTopbar = !!refs.regionHosts.topbar.childNodes.length
        || !!refs.commandHosts.topbar.childNodes.length;
      const hasActivitybar = !!refs.regionHosts.activitybar.childNodes.length
        || !!refs.activityItems.childNodes.length;
      const hasStatusbar = !!refs.regionHosts.statusbar.childNodes.length
        || !!refs.statusItems.childNodes.length
        || !!refs.commandHosts.status.childNodes.length;
      refs.topbar.hidden = !hasTopbar;
      refs.activitybar.hidden = !hasActivitybar;
      refs.tabbar.hidden = !refs.tabs.childNodes.length
        && !refs.commandHosts.tabbar.childNodes.length;
      refs.statusbar.hidden = !hasStatusbar;
      refs.root.classList.toggle("has-topbar", hasTopbar);
      refs.root.classList.toggle("has-activitybar", hasActivitybar);
      refs.root.classList.toggle("has-statusbar", hasStatusbar);
    }

    function renderActivities() {
      if (!mounted) return;
      modules.renderActivitybar(
        documentRef,
        refs.activityItems,
        activities,
        layout.activeActivityId,
        (activityId) => {
          layout = layoutController.set({ activeActivityId: activityId });
          renderActivities();
          emitter.emit("activity:select", { activityId });
        }
      );
      syncVisibility();
    }

    function renderCommands() {
      if (!mounted) return;
      modules.shellRegions.renderCommands(
        documentRef,
        refs.commandHosts,
        commands,
        (payload) => emitter.emit("command:execute", payload)
      );
      syncVisibility();
    }

    function renderTabs() {
      if (!mounted) return;
      modules.renderTabs(documentRef, refs.tabs, tabs, activeTabId, labels, {
        onActivate(tabId) {
          activeTabId = tabId;
          renderTabs();
          emitter.emit("tab:activate", { tabId });
        },
        onClose(tabId) {
          emitter.emit("tab:close-request", { tabId });
        }
      });
      syncVisibility();
    }

    function renderStatus() {
      if (!mounted) return;
      modules.shellRegions.renderStatus(documentRef, refs.statusItems, status);
      syncVisibility();
    }

    function mount() {
      ensureActive();
      if (mounted) return api;
      refs = buildShell(documentRef);
      mountRoot.replaceChildren(refs.root);
      regionController = modules.shellRegions.createRegionController(refs.regionHosts);
      layoutController = modules.createLayoutController({
        refs,
        initialLayout: layout,
        onChange(nextLayout) {
          layout = nextLayout;
          emitter.emit("layout:change", { layout: { ...layout } });
        }
      });
      types.REGION_NAMES.forEach((region) => {
        if (Object.prototype.hasOwnProperty.call(regionContent, region)) {
          regionController.set(region, regionContent[region]);
        }
      });
      mounted = true;
      renderActivities();
      renderCommands();
      renderTabs();
      renderStatus();
      syncVisibility();
      return api;
    }

    function destroy() {
      if (destroyed) return;
      layoutController?.destroy();
      regionController?.destroy();
      refs?.root.remove();
      emitter.clear();
      refs = null;
      mounted = false;
      destroyed = true;
    }

    function setActivities(items) {
      ensureActive();
      activities = types.normalizeActivities(items);
      renderActivities();
      return api;
    }

    function setCommands(items) {
      ensureActive();
      commands = types.normalizeCommands(items);
      renderCommands();
      return api;
    }

    function setTabs(items, requestedActiveTabId) {
      ensureActive();
      tabs = types.normalizeTabs(items);
      const requested = String(requestedActiveTabId || "").trim();
      const preserved = tabs.some((tab) => tab.id === activeTabId) ? activeTabId : "";
      activeTabId = tabs.some((tab) => tab.id === requested)
        ? requested
        : (preserved || tabs[0]?.id || "");
      renderTabs();
      return api;
    }

    function openTab(tab) {
      ensureActive();
      const normalized = types.normalizeTabs([tab])[0];
      if (!normalized) throw new TypeError("tab.id is required");
      const index = tabs.findIndex((item) => item.id === normalized.id);
      if (index >= 0) tabs[index] = normalized;
      else tabs.push(normalized);
      activeTabId = normalized.id;
      renderTabs();
      return api;
    }

    function updateTab(tabId, patch = {}) {
      ensureActive();
      const id = String(tabId || "").trim();
      const index = tabs.findIndex((tab) => tab.id === id);
      if (index < 0) return false;
      const normalized = types.normalizeTabs([{ ...tabs[index], ...patch, id }])[0];
      tabs[index] = normalized;
      renderTabs();
      return true;
    }

    function closeTab(tabId) {
      ensureActive();
      const id = String(tabId || "").trim();
      if (!tabs.some((tab) => tab.id === id)) return false;
      emitter.emit("tab:close-request", { tabId: id });
      return true;
    }

    function activateTab(tabId) {
      ensureActive();
      const id = String(tabId || "").trim();
      if (!tabs.some((tab) => tab.id === id)) return false;
      activeTabId = id;
      renderTabs();
      return true;
    }

    function setRegion(region, content) {
      ensureActive();
      if (!types.REGION_NAMES.includes(region)) {
        throw new RangeError(`unknown shell region: ${region}`);
      }
      regionContent[region] = content;
      if (mounted) {
        regionController.set(region, content);
        syncVisibility();
      }
      return api;
    }

    function setStatus(items) {
      ensureActive();
      status = types.normalizeStatus(items);
      renderStatus();
      return api;
    }

    function setLayout(nextLayout) {
      ensureActive();
      layout = mounted
        ? layoutController.set(nextLayout)
        : types.normalizeLayout(nextLayout, layout);
      renderActivities();
      return api;
    }

    function getLayout() {
      return mounted ? layoutController.get() : { ...layout };
    }

    function focusRegion(region) {
      ensureActive();
      const host = refs?.regionHosts?.[region];
      if (!host) return false;
      if (!host.hasAttribute("tabindex")) host.tabIndex = -1;
      host.focus({ preventScroll: true });
      emitter.emit("region:focus", { region });
      return true;
    }

    const api = Object.freeze({
      mount,
      destroy,
      setActivities,
      setCommands,
      setTabs,
      openTab,
      updateTab,
      closeTab,
      activateTab,
      setRegion,
      setStatus,
      setLayout,
      getLayout,
      focusRegion,
      on: emitter.on,
      off: emitter.off
    });
    return api;
  }

  packages.uiShell = Object.freeze({ createAppShell });
  delete packages.__uiShellModules;
})(window);
