(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__workflowDesignerModules =
    packages.__workflowDesignerModules || {};

  function edgePath(edge, source, target) {
    const sourceX = source.x + source.width;
    const sourceY = source.y + source.height / 2;
    const targetX = target.x;
    const targetY = target.y + target.height / 2;
    if (edge.kind === "loop-back") {
      const routeY = Math.max(sourceY, targetY) + 112;
      return [
        `M ${sourceX} ${sourceY}`,
        `C ${sourceX + 72} ${routeY},`,
        `${targetX - 72} ${routeY},`,
        `${targetX} ${targetY}`
      ].join(" ");
    }
    const distance = Math.max(72, Math.abs(targetX - sourceX) * 0.5);
    const sourceControl = sourceX + distance;
    const targetControl = targetX - distance;
    return [
      `M ${sourceX} ${sourceY}`,
      `C ${sourceControl} ${sourceY},`,
      `${targetControl} ${targetY},`,
      `${targetX} ${targetY}`
    ].join(" ");
  }

  function rendererFor(node, renderers) {
    if (!renderers || typeof renderers !== "object") return null;
    return renderers[node.nodeType] || renderers.default || null;
  }

  function statusText(value) {
    return {
      running: "Running",
      success: "Success",
      error: "ERROR",
      skipped: "Skipped",
      idle: ""
    }[value] || "";
  }

  function createRenderer(shell) {
    let model = null;
    let nodeElements = new Map();
    let edgeElements = new Map();
    let noteElements = new Map();
    const feedback = modules.createWorkflowFeedback(shell);

    function clearLayer(layer) {
      while (layer.firstChild) layer.firstChild.remove();
    }

    function renderFrames() {
      clearLayer(shell.frameLayer);
      model.loopFrames.forEach((frame) => {
        shell.frameLayer.appendChild(modules.createWorkflowLoopFrame(frame));
      });
    }

    function renderEdges() {
      clearLayer(shell.edgeGroup);
      edgeElements = new Map();
      const markerId = shell.edges.dataset.markerId;
      model.edges.forEach((edge) => {
        const source = model.nodeByKey.get(edge.sourceKey);
        const target = model.nodeByKey.get(edge.targetKey);
        if (!source || !target) return;
        const group = modules.createWorkflowSvgElement("g", "zwd-edge", {
          "data-edge-key": edge.key,
          "data-edge-scope": edge.ref.flow_id
            ? "flow"
            : (edge.ref.loop_owner_id ? "loop" : "unassigned")
        });
        const visible = modules.createWorkflowSvgElement("path", "zwd-edge__line", {
          d: edgePath(edge, source, target),
          "marker-end": `url(#${markerId})`
        });
        const hit = modules.createWorkflowSvgElement("path", "zwd-edge__hit", {
          d: edgePath(edge, source, target)
        });
        group.appendChild(visible);
        group.appendChild(hit);
        shell.edgeGroup.appendChild(group);
        edgeElements.set(edge.key, group);
      });
    }

    function renderNodes(renderers, readonly) {
      clearLayer(shell.nodeLayer);
      nodeElements = new Map();
      model.nodes.forEach((node) => {
        const context = Object.freeze({
          nodeRef: modules.cloneValue(node.ref),
          nodeType: node.nodeType,
          kind: node.kind,
          readonly: !!readonly
        });
        const wrapper = modules.createWorkflowNodeElement(
          node,
          rendererFor(node, renderers),
          context
        );
        shell.nodeLayer.appendChild(wrapper);
        nodeElements.set(node.key, wrapper);
      });
    }

    function renderNotes(readonly) {
      clearLayer(shell.noteLayer);
      noteElements = new Map();
      model.notes.forEach((note) => {
        const wrapper = modules.createWorkflowNoteElement(note, readonly);
        shell.noteLayer.appendChild(wrapper);
        noteElements.set(note.noteId, wrapper);
      });
    }

    function renderDocument(nextModel, options = {}) {
      model = nextModel;
      const width = Math.max(2400, model.bounds.x + model.bounds.width + 480);
      const height = Math.max(1600, model.bounds.y + model.bounds.height + 360);
      shell.world.style.width = `${width}px`;
      shell.world.style.height = `${height}px`;
      shell.edges.setAttribute("width", String(width));
      shell.edges.setAttribute("height", String(height));
      renderFrames();
      renderEdges();
      renderNodes(options.nodeRenderers, options.readonly);
      renderNotes(options.readonly);
      applySelection(options.selection);
      applyStatus(options.status);
    }

    function applySelection(selection) {
      const normalized = modules.normalizeSelection(selection);
      const selectedNodes = new Set(normalized.nodes.map(modules.nodeRefKey));
      const selectedEdges = new Set(normalized.edges.map(modules.edgeRefKey));
      const selectedNotes = new Set(normalized.annotation_ids);
      nodeElements.forEach((element, key) => {
        element.dataset.selected = selectedNodes.has(key) ? "true" : "false";
      });
      edgeElements.forEach((element, key) => {
        element.dataset.selected = selectedEdges.has(key) ? "true" : "false";
      });
      noteElements.forEach((element, key) => {
        element.dataset.selected = selectedNotes.has(key) ? "true" : "false";
      });
    }

    function applyStatus(status) {
      const normalized = modules.normalizeStatus(status);
      if (!model) return;
      model.nodes.forEach((node) => {
        const wrapper = nodeElements.get(node.key);
        if (!wrapper) return;
        const nodeId = String(node.ref.node_id || "");
        const value = normalized.nodeStatus[node.key] ||
          normalized.nodeStatus[nodeId] ||
          "idle";
        wrapper.dataset.runStatus = value;
        const label = wrapper.querySelector(".zwd-node__status");
        if (label) {
          label.textContent = statusText(value);
          label.hidden = !label.textContent;
        }
        const entries = normalized.validation[node.key] ||
          normalized.validation[nodeId] ||
          [];
        const validation = wrapper.querySelector(".zwd-node__validation");
        const level = entries.some((entry) => entry.level === "error")
          ? "error"
          : (entries.length ? "warning" : "");
        if (level) wrapper.dataset.validationLevel = level;
        else delete wrapper.dataset.validationLevel;
        if (validation) {
          validation.hidden = !entries.length;
          validation.title = entries.map((entry) => entry.message).join("\n");
        }
      });
    }

    function applyViewport(viewport) {
      const value = modules.normalizeViewport(viewport);
      shell.world.style.transform =
        `translate(${value.x}px, ${value.y}px) scale(${value.zoom})`;
    }

    function nodeCenter(nodeKey, port = "out") {
      const node = model?.nodeByKey.get(nodeKey);
      if (!node) return null;
      return {
        x: port === "in" ? node.x : node.x + node.width,
        y: node.y + node.height / 2
      };
    }

    function showConnection(sourceKey, targetPoint) {
      const source = nodeCenter(sourceKey, "out");
      if (!source || !targetPoint) return;
      const distance = Math.max(64, Math.abs(targetPoint.x - source.x) * 0.5);
      const path = [
        `M ${source.x} ${source.y}`,
        `C ${source.x + distance} ${source.y},`,
        `${targetPoint.x - distance} ${targetPoint.y},`,
        `${targetPoint.x} ${targetPoint.y}`
      ].join(" ");
      shell.connectionPreview.setAttribute("d", path);
      shell.connectionPreview.hidden = false;
    }

    function hideConnection() {
      shell.connectionPreview.hidden = true;
      shell.connectionPreview.removeAttribute("d");
    }

    function setPreviewTransform(keys, dx, dy) {
      const keySet = new Set(keys || []);
      nodeElements.forEach((element, key) => {
        element.style.transform = keySet.has(key)
          ? `translate(${dx}px, ${dy}px)`
          : "";
      });
    }

    function setNotePreview(noteId, values = {}) {
      const note = noteElements.get(String(noteId || ""));
      if (!note) return;
      if (Number.isFinite(values.dx) || Number.isFinite(values.dy)) {
        note.style.transform =
          `translate(${Number(values.dx) || 0}px, ${Number(values.dy) || 0}px)`;
      }
      if (Number.isFinite(values.width)) note.style.width = `${values.width}px`;
      if (Number.isFinite(values.height)) note.style.height = `${values.height}px`;
    }

    function clearPreviews() {
      setPreviewTransform([], 0, 0);
      noteElements.forEach((element) => {
        element.style.transform = "";
      });
      hideConnection();
    }

    function destroy() {
      feedback.destroy();
      shell.rootElement.innerHTML = "";
      model = null;
      nodeElements.clear();
      edgeElements.clear();
      noteElements.clear();
    }

    return Object.freeze({
      renderDocument,
      applySelection,
      applyStatus,
      applyViewport,
      showConnection,
      hideConnection,
      setPreviewTransform,
      setNotePreview,
      clearPreviews,
      showMessage: feedback.showMessage,
      showContextMenu: feedback.showContextMenu,
      hideContextMenu: feedback.hideContextMenu,
      getNodeElement: (key) => nodeElements.get(key) || null,
      getNoteElement: (id) => noteElements.get(id) || null,
      getModel: () => model,
      destroy
    });
  }

  modules.createWorkflowRenderer = createRenderer;
})(window);
