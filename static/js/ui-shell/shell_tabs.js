(function (root) {
  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__uiShellModules = packages.__uiShellModules || {};

  function renderTabs(documentRef, host, tabs, activeTabId, labels, callbacks) {
    host.replaceChildren();
    tabs.forEach((tab) => {
      const item = documentRef.createElement("div");
      item.className = "zui-shell__tab";
      item.dataset.tabId = tab.id;
      item.setAttribute("role", "tab");
      item.setAttribute("aria-selected", tab.id === activeTabId ? "true" : "false");
      if (tab.id === activeTabId) item.classList.add("is-active");

      const activate = documentRef.createElement("button");
      activate.type = "button";
      activate.className = "zui-shell__tab-activate";
      activate.title = tab.title;
      if (tab.icon) {
        const icon = documentRef.createElement("img");
        icon.className = "zui-shell__tab-icon";
        icon.src = tab.icon;
        icon.alt = "";
        icon.setAttribute("aria-hidden", "true");
        activate.appendChild(icon);
      }
      const title = documentRef.createElement("span");
      title.className = "zui-shell__tab-title";
      title.textContent = tab.title;
      activate.appendChild(title);
      if (tab.dirty) {
        const dirty = documentRef.createElement("span");
        dirty.className = "zui-shell__tab-dirty";
        dirty.textContent = "*";
        dirty.setAttribute("aria-label", labels.dirty || "Modified");
        activate.appendChild(dirty);
      }
      if (tab.badge) {
        const badge = documentRef.createElement("span");
        badge.className = "zui-shell__tab-badge";
        badge.textContent = tab.badge;
        activate.appendChild(badge);
      }
      activate.addEventListener("click", () => callbacks.onActivate(tab.id));
      item.appendChild(activate);

      if (tab.closable) {
        const close = documentRef.createElement("button");
        close.type = "button";
        close.className = "zui-shell__tab-close";
        close.textContent = "\u00d7";
        close.title = labels.closeTab || "Close";
        close.setAttribute("aria-label", `${labels.closeTab || "Close"}: ${tab.title}`);
        close.addEventListener("click", () => callbacks.onClose(tab.id));
        item.appendChild(close);
      }
      host.appendChild(item);
    });
  }

  modules.renderTabs = renderTabs;
})(window);
