(function (root) {
  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__uiShellModules = packages.__uiShellModules || {};

  function isNode(host, value) {
    const NodeType = host?.ownerDocument?.defaultView?.Node;
    return !!NodeType && value instanceof NodeType;
  }

  function createRegionController(hosts) {
    const cleanups = new Map();

    function cleanup(region) {
      const dispose = cleanups.get(region);
      cleanups.delete(region);
      if (typeof dispose === "function") dispose();
    }

    function set(region, content) {
      const host = hosts[region];
      if (!host) throw new RangeError(`unknown shell region: ${region}`);
      cleanup(region);
      host.replaceChildren();
      if (content === undefined || content === null) return;

      let result = content;
      let adapter = null;
      if (typeof content === "function") {
        result = content(host);
      } else if (content && typeof content.mount === "function") {
        adapter = content;
        result = content.mount(host);
      }

      if (isNode(host, result)) {
        host.appendChild(result);
      }

      const dispose = typeof result === "function"
        ? result
        : (adapter && typeof adapter.destroy === "function"
          ? () => adapter.destroy()
          : null);
      if (dispose) cleanups.set(region, dispose);
    }

    function destroy() {
      Array.from(cleanups.keys()).forEach(cleanup);
      Object.values(hosts).forEach((host) => host?.replaceChildren());
    }

    return Object.freeze({ set, destroy });
  }

  function appendIcon(documentRef, parent, icon, className) {
    if (!icon) return;
    const image = documentRef.createElement("img");
    image.className = className;
    image.src = icon;
    image.alt = "";
    image.setAttribute("aria-hidden", "true");
    parent.appendChild(image);
  }

  function renderCommands(documentRef, hosts, commands, onExecute) {
    Object.values(hosts).forEach((host) => host?.replaceChildren());
    commands.forEach((command) => {
      const host = hosts[command.region];
      if (!host) return;
      const button = documentRef.createElement("button");
      button.type = "button";
      button.className = "zui-shell__command";
      button.dataset.commandId = command.id;
      button.disabled = command.disabled;
      button.title = command.label;
      button.setAttribute("aria-label", command.label);
      appendIcon(documentRef, button, command.icon, "zui-shell__command-icon");
      if (!command.icon) {
        const label = documentRef.createElement("span");
        label.textContent = command.label;
        button.appendChild(label);
      }
      button.addEventListener("click", () => {
        onExecute({ commandId: command.id, source: command.region });
      });
      host.appendChild(button);
    });
  }

  function renderStatus(documentRef, host, items) {
    host.replaceChildren();
    items.forEach((item) => {
      const status = documentRef.createElement("span");
      status.className = "zui-shell__status-item";
      status.dataset.statusId = item.id;
      status.textContent = item.value ? `${item.label}: ${item.value}` : item.label;
      host.appendChild(status);
    });
  }

  modules.shellRegions = Object.freeze({
    createRegionController,
    renderCommands,
    renderStatus
  });
})(window);
