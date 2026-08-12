(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__workflowDesignerModules =
    packages.__workflowDesignerModules || {};
  const SVG_NS = "http://www.w3.org/2000/svg";

  function element(tagName, className, attributes = {}) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    Object.entries(attributes).forEach(([name, value]) => {
      if (value === undefined || value === null) return;
      node.setAttribute(name, String(value));
    });
    return node;
  }

  function svgElement(tagName, className, attributes = {}) {
    const node = document.createElementNS(SVG_NS, tagName);
    if (className) node.setAttribute("class", className);
    Object.entries(attributes).forEach(([name, value]) => {
      if (value === undefined || value === null) return;
      node.setAttribute(name, String(value));
    });
    return node;
  }

  function toolbarButton(command, text, label) {
    const button = element("button", "zwd-tool", {
      type: "button",
      "data-zwd-command": command,
      "aria-label": label,
      title: label
    });
    button.textContent = text;
    return button;
  }

  function createShell(rootElement, commandLabels = {}) {
    if (!(rootElement instanceof HTMLElement)) {
      throw new TypeError("WorkflowDesigner root must be an HTMLElement");
    }
    rootElement.innerHTML = "";

    const shell = element("div", "zwd", {
      tabindex: "0",
      "data-workflow-designer": "",
      role: "application",
      "aria-label": commandLabels.designer || "Workflow designer"
    });
    const toolbar = element("div", "zwd-toolbar", {
      role: "toolbar",
      "aria-label": commandLabels.canvasTools || "Canvas tools"
    });
    toolbar.appendChild(toolbarButton(
      "viewport.zoom-out",
      "-",
      commandLabels.zoomOut || "Zoom out"
    ));
    toolbar.appendChild(toolbarButton(
      "viewport.zoom-in",
      "+",
      commandLabels.zoomIn || "Zoom in"
    ));
    toolbar.appendChild(toolbarButton(
      "viewport.fit",
      "[]",
      commandLabels.fitView || "Fit view"
    ));
    toolbar.appendChild(toolbarButton(
      "annotation.add",
      "N",
      commandLabels.addNote || "Add note"
    ));

    const viewport = element("div", "zwd-viewport", {
      tabindex: "0",
      "data-zwd-viewport": ""
    });
    const world = element("div", "zwd-world", { "data-zwd-world": "" });
    const frameLayer = element("div", "zwd-layer zwd-layer--frames");
    const edges = svgElement("svg", "zwd-layer zwd-layer--edges", {
      "aria-hidden": "true",
      overflow: "visible"
    });
    const defs = svgElement("defs");
    const marker = svgElement("marker", "", {
      id: `zwd-arrow-${Math.random().toString(36).slice(2)}`,
      markerWidth: "8",
      markerHeight: "8",
      refX: "7",
      refY: "4",
      orient: "auto",
      markerUnits: "strokeWidth"
    });
    marker.appendChild(svgElement("path", "zwd-arrow", { d: "M0,0 L8,4 L0,8 Z" }));
    defs.appendChild(marker);
    edges.appendChild(defs);
    edges.dataset.markerId = marker.id;
    const edgeGroup = svgElement("g", "zwd-edge-group");
    const connectionPreview = svgElement("path", "zwd-connection-preview", {
      hidden: "hidden"
    });
    edges.appendChild(edgeGroup);
    edges.appendChild(connectionPreview);

    const nodeLayer = element("div", "zwd-layer zwd-layer--nodes");
    const noteLayer = element("div", "zwd-layer zwd-layer--notes");
    world.appendChild(frameLayer);
    world.appendChild(edges);
    world.appendChild(nodeLayer);
    world.appendChild(noteLayer);
    viewport.appendChild(world);

    const menu = element("div", "zwd-context-menu", {
      role: "menu",
      hidden: "hidden"
    });
    const message = element("div", "zwd-message", {
      role: "status",
      "aria-live": "polite",
      hidden: "hidden"
    });

    shell.appendChild(toolbar);
    shell.appendChild(viewport);
    shell.appendChild(menu);
    shell.appendChild(message);
    rootElement.appendChild(shell);
    return {
      rootElement,
      shell,
      toolbar,
      viewport,
      world,
      frameLayer,
      edges,
      edgeGroup,
      connectionPreview,
      nodeLayer,
      noteLayer,
      menu,
      message
    };
  }

  function createDefaultNodeContent(node) {
    const content = element("div", "zwd-node__content");
    const kind = element("div", "zwd-node__kind");
    kind.textContent = node.kind === "step"
      ? String(node.nodeType || "step")
      : String(node.label || "");
    const label = element("div", "zwd-node__label");
    label.textContent = String(node.label || node.ref?.node_id || "");
    content.appendChild(kind);
    content.appendChild(label);
    if (node.kind === "step") {
      const id = element("div", "zwd-node__id");
      id.textContent = String(node.ref.node_id);
      content.appendChild(id);
    }
    return content;
  }

  function createPort(direction, nodeKey, readonly) {
    const attributes = {
      type: "button",
      tabindex: "-1",
      "data-zwd-port": direction,
      "data-node-key": nodeKey,
      "aria-label": direction === "in" ? "Input port" : "Output port"
    };
    if (readonly) attributes.disabled = "";
    return element("button", `zwd-port zwd-port--${direction}`, attributes);
  }

  function createNodeElement(node, renderer, context) {
    const wrapper = element("div", `zwd-node zwd-node--${node.kind}`, {
      tabindex: "0",
      role: "button",
      "data-node-key": node.key,
      "data-node-id": node.ref.node_id,
      "data-node-type": node.nodeType,
      "data-readonly": context.readonly ? "true" : "false",
      "aria-label": String(node.label || node.ref.node_id)
    });
    wrapper.style.left = `${node.x}px`;
    wrapper.style.top = `${node.y}px`;
    wrapper.style.width = `${node.width}px`;
    wrapper.style.height = `${node.height}px`;

    if (!["start", "unassigned-start"].includes(node.kind)) {
      wrapper.appendChild(createPort("in", node.key, context.readonly));
    }
    let rendered = null;
    if (renderer && typeof renderer.render === "function") {
      rendered = renderer.render(node.step || node, context);
      if (!(rendered instanceof HTMLElement)) {
        throw new TypeError("node renderer must return an HTMLElement");
      }
    }
    wrapper.appendChild(rendered || createDefaultNodeContent(node));
    if (node.kind !== "end") {
      wrapper.appendChild(createPort("out", node.key, context.readonly));
    }

    const status = element("span", "zwd-node__status", {
      hidden: "hidden",
      "aria-live": "polite"
    });
    const validation = element("span", "zwd-node__validation", {
      hidden: "hidden",
      "aria-label": "Validation"
    });
    validation.textContent = "!";
    wrapper.appendChild(status);
    wrapper.appendChild(validation);
    return wrapper;
  }

  function createLoopFrame(frame) {
    const wrapper = element("div", "zwd-loop-frame", {
      "data-loop-owner-id": frame.ownerId
    });
    wrapper.style.left = `${frame.x}px`;
    wrapper.style.top = `${frame.y}px`;
    wrapper.style.width = `${frame.width}px`;
    wrapper.style.height = `${frame.height}px`;
    const label = element("div", "zwd-loop-frame__label");
    label.textContent = String(frame.label || frame.ownerId);
    wrapper.appendChild(label);
    return wrapper;
  }

  modules.createWorkflowDesignerShell = createShell;
  modules.createWorkflowNodeElement = createNodeElement;
  modules.createWorkflowLoopFrame = createLoopFrame;
  modules.createWorkflowSvgElement = svgElement;
  modules.createWorkflowElement = element;
})(window);
