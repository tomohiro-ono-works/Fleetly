(function (root) {
  "use strict";

  function createElement(tagName, className) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    return element;
  }

  function indexCatalog(catalog) {
    const connectors = new Map(
      (Array.isArray(catalog?.connectors) ? catalog.connectors : [])
        .map((connector) => [String(connector?.id || ""), connector])
        .filter(([id]) => id)
    );
    const actions = new Map();
    Object.entries(catalog?.actions || {}).forEach(([connectorId, values]) => {
      (Array.isArray(values) ? values : []).forEach((action) => {
        const actionId = String(action?.id || "");
        if (actionId) actions.set(`${connectorId}:${actionId}`, action);
      });
    });
    return { connectors, actions };
  }

  function createZizaiNodeRenderers(options = {}) {
    const catalog = options.catalog || {};
    const index = indexCatalog(catalog);
    const iconResolver = typeof options.iconResolver === "function"
      ? options.iconResolver
      : (value) => String(value || "");

    function getPresentation(step, context) {
      const connectorId = String(step?.connector_id || "");
      const actionId = String(step?.action_id || "");
      const connector = index.connectors.get(connectorId) || null;
      const action = index.actions.get(`${connectorId}:${actionId}`) || null;
      return Object.freeze({
        iconUrl: iconResolver(connector?.icon, connector, action),
        connectorLabel: String(
          connector?.label || connectorId || context.nodeType
        ),
        label: String(
          step?.label || action?.label || context.nodeRef.node_id
        ),
        detail: [
          context.nodeRef.node_id,
          action?.label || actionId
        ].filter(Boolean).join(" / ")
      });
    }

    const renderer = Object.freeze({
      type: "zizai-step",
      getPresentation,
      render(step, context) {
        const presentation = getPresentation(step, context);

        const content = createElement("div", "zwd-node__content zwd-app-node");
        content.dataset.zizaiNodeRenderer = "true";
        const meta = createElement("div", "zwd-app-node__meta");
        if (presentation.iconUrl) {
          const icon = createElement("img", "zwd-app-node__icon");
          icon.src = presentation.iconUrl;
          icon.alt = "";
          icon.setAttribute("aria-hidden", "true");
          meta.appendChild(icon);
        }
        const connectorLabel = createElement("span", "zwd-app-node__connector");
        connectorLabel.textContent = presentation.connectorLabel;
        meta.appendChild(connectorLabel);

        const label = createElement("div", "zwd-node__label");
        label.textContent = presentation.label;
        const detail = createElement("div", "zwd-app-node__detail");
        detail.textContent = presentation.detail;
        content.appendChild(meta);
        content.appendChild(label);
        content.appendChild(detail);
        return content;
      }
    });

    const nodeTypes = new Set(["task"]);
    Object.values(catalog?.actions || {}).flat().forEach((action) => {
      const nodeType = String(action?.nodeType || "").trim();
      if (nodeType) nodeTypes.add(nodeType);
    });
    return Object.freeze(Object.fromEntries(
      Array.from(nodeTypes).map((nodeType) => [nodeType, renderer])
    ));
  }

  const packages = root.zizPackages = root.zizPackages || {};
  const app = packages.app = packages.app || {};
  app.workflowDesignerRenderers = Object.freeze({
    createZizaiNodeRenderers
  });
})(window);
