(function (root) {
  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__uiShellModules = packages.__uiShellModules || {};

  function renderActivitybar(documentRef, host, items, activeId, onSelect) {
    host.replaceChildren();
    items.forEach((item) => {
      const button = documentRef.createElement("button");
      button.type = "button";
      button.className = "zui-shell__activity";
      button.dataset.activityId = item.id;
      button.disabled = item.disabled;
      button.title = item.label;
      button.setAttribute("aria-label", item.label);
      if (item.id === activeId) {
        button.classList.add("is-active");
        button.setAttribute("aria-current", "page");
      }

      if (item.icon) {
        const icon = documentRef.createElement("img");
        icon.className = "zui-shell__activity-icon";
        icon.src = item.icon;
        icon.alt = "";
        icon.setAttribute("aria-hidden", "true");
        button.appendChild(icon);
      } else {
        const fallback = documentRef.createElement("span");
        fallback.className = "zui-shell__activity-fallback";
        fallback.textContent = item.label.slice(0, 1).toUpperCase();
        fallback.setAttribute("aria-hidden", "true");
        button.appendChild(fallback);
      }

      if (item.badge) {
        const badge = documentRef.createElement("span");
        badge.className = "zui-shell__activity-badge";
        badge.textContent = item.badge;
        button.appendChild(badge);
      }
      button.addEventListener("click", () => onSelect(item.id));
      host.appendChild(button);
    });
  }

  modules.renderActivitybar = renderActivitybar;
})(window);
