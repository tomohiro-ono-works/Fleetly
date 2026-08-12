(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__workflowDesignerModules =
    packages.__workflowDesignerModules || {};

  function createInteraction(shell, renderer, controller) {
    const noteEditor = modules.createWorkflowNoteEditor(renderer, controller);
    const selection = modules.createWorkflowSelectionController(controller);
    const commandInteraction = modules.createWorkflowCommandInteraction(
      shell,
      renderer,
      controller,
      selection
    );
    const cleanup = [];
    let gesture = null;
    let suppressClick = false;

    function listen(target, eventName, handler, options) {
      target.addEventListener(eventName, handler, options);
      cleanup.push(() => target.removeEventListener(eventName, handler, options));
    }

    function worldPoint(event) {
      const rect = shell.viewport.getBoundingClientRect();
      const viewport = controller.getViewport();
      return {
        x: (event.clientX - rect.left - viewport.x) / viewport.zoom,
        y: (event.clientY - rect.top - viewport.y) / viewport.zoom
      };
    }

    function beginNodeDrag(event, node) {
      selection.selectNode(node, event.shiftKey);
      if (controller.isReadonly()) return;
      const selectedKeys = new Set(
        controller.getSelection().nodes.map(modules.nodeRefKey)
      );
      const nodes = renderer.getModel().nodes
        .filter((item) => selectedKeys.has(modules.nodeRefKey(item.ref)));
      gesture = {
        kind: "node",
        pointerId: event.pointerId,
        start: worldPoint(event),
        nodes,
        dx: 0,
        dy: 0
      };
    }

    function beginNoteGesture(event, note, kind) {
      selection.selectNote(note.noteId, event.shiftKey);
      if (controller.isReadonly()) return;
      gesture = {
        kind,
        pointerId: event.pointerId,
        start: worldPoint(event),
        note,
        dx: 0,
        dy: 0,
        width: note.width,
        height: note.height
      };
    }

    function onPointerDown(event) {
      if (event.button !== 0) return;
      renderer.hideContextMenu();
      const port = event.target.closest("[data-zwd-port]");
      const nodeElement = event.target.closest("[data-node-key]");
      const noteElement = event.target.closest("[data-note-id]");
      const edgeElement = event.target.closest("[data-edge-key]");
      const model = renderer.getModel();

      if (port && port.dataset.zwdPort === "out" && !controller.isReadonly()) {
        const node = model?.nodeByKey.get(port.dataset.nodeKey);
        if (!node) return;
        selection.selectNode(node, false);
        gesture = {
          kind: "connect",
          pointerId: event.pointerId,
          source: node,
          start: worldPoint(event),
          point: worldPoint(event)
        };
      } else if (noteElement) {
        const note = model?.notes.find(
          (item) => item.noteId === noteElement.dataset.noteId
        );
        if (!note) return;
        if (event.target.closest("[data-note-resize]")) {
          beginNoteGesture(event, note, "note-resize");
        } else if (event.target.closest("[data-note-drag-handle]")) {
          beginNoteGesture(event, note, "note-drag");
        } else {
          selection.selectNote(note.noteId, event.shiftKey);
        }
      } else if (nodeElement) {
        const node = model?.nodeByKey.get(nodeElement.dataset.nodeKey);
        if (node) beginNodeDrag(event, node);
      } else if (edgeElement) {
        const edge = model?.edges.find(
          (item) => item.key === edgeElement.dataset.edgeKey
        );
        if (edge) selection.selectEdge(edge, event.shiftKey);
      } else {
        controller.select({ nodes: [], edges: [], annotation_ids: [] }, "canvas");
        gesture = {
          kind: "pan",
          pointerId: event.pointerId,
          startClient: { x: event.clientX, y: event.clientY },
          viewport: controller.getViewport()
        };
      }
      if (gesture) {
        shell.viewport.setPointerCapture(event.pointerId);
        event.preventDefault();
      }
    }

    function onPointerMove(event) {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      if (gesture.kind === "pan") {
        controller.changeViewport({
          ...gesture.viewport,
          x: gesture.viewport.x + event.clientX - gesture.startClient.x,
          y: gesture.viewport.y + event.clientY - gesture.startClient.y
        });
        return;
      }
      const point = worldPoint(event);
      gesture.dx = point.x - gesture.start.x;
      gesture.dy = point.y - gesture.start.y;
      if (Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2) {
        suppressClick = true;
      }
      if (gesture.kind === "node") {
        renderer.setPreviewTransform(
          gesture.nodes.map((node) => node.key),
          gesture.dx,
          gesture.dy
        );
      } else if (gesture.kind === "connect") {
        gesture.point = point;
        renderer.showConnection(gesture.source.key, point);
      } else if (gesture.kind === "note-drag") {
        renderer.setNotePreview(gesture.note.noteId, {
          dx: gesture.dx,
          dy: gesture.dy
        });
      } else if (gesture.kind === "note-resize") {
        gesture.width = Math.max(160, gesture.note.width + gesture.dx);
        gesture.height = Math.max(96, gesture.note.height + gesture.dy);
        renderer.setNotePreview(gesture.note.noteId, {
          width: gesture.width,
          height: gesture.height
        });
      }
    }

    function positionOperation(path, value) {
      const current = modules.getDocumentPathValue(controller.getDocument(), path);
      return {
        op: current.exists ? "replace" : "add",
        path: modules.cloneValue(path),
        value
      };
    }

    function finishConnect(event, current) {
      const targetElement = document.elementFromPoint(event.clientX, event.clientY)
        ?.closest?.("[data-zwd-port='in']");
      const target = targetElement
        ? renderer.getModel()?.nodeByKey.get(targetElement.dataset.nodeKey)
        : null;
      if (target && target.key !== current.source.key) {
        controller.requestConnect(current.source, target);
      }
    }

    function onPointerUp(event) {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      const current = gesture;
      gesture = null;
      renderer.clearPreviews();
      if (current.kind === "node" && (current.dx || current.dy)) {
        controller.commit(current.nodes.map((node) => positionOperation(
          node.documentPath,
          {
            x: Math.round(node.x + current.dx),
            y: Math.round(node.y + current.dy)
          }
        )), "node.move");
      } else if (current.kind === "note-drag" && (current.dx || current.dy)) {
        controller.commit([positionOperation(current.note.positionPath, {
          x: Math.round(current.note.x + current.dx),
          y: Math.round(current.note.y + current.dy)
        })], "annotation.move");
      } else if (current.kind === "note-resize" && (current.dx || current.dy)) {
        controller.commit([positionOperation(current.note.sizePath, {
          width: Math.round(current.width),
          height: Math.round(current.height)
        })], "annotation.resize");
      } else if (current.kind === "connect") {
        finishConnect(event, current);
      }
    }

    function onPointerCancel(event) {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      gesture = null;
      renderer.clearPreviews();
      suppressClick = true;
    }

    function onClick(event) {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      const command = event.target.closest("[data-zwd-command]")?.dataset.zwdCommand;
      if (command) {
        controller.executeCommand(command, null, worldPoint(event));
        return;
      }
      const contextCommand = event.target.closest("[data-context-command]")
        ?.dataset.contextCommand;
      if (contextCommand) {
        renderer.hideContextMenu();
        controller.executeCommand(
          contextCommand,
          commandInteraction.getContextTarget(),
          worldPoint(event)
        );
        return;
      }
      const external = event.target.closest("[data-external-url]")?.dataset.externalUrl;
      if (external) {
        event.preventDefault();
        controller.emit("external-link:open-request", { url: external });
        return;
      }
      const nodeElement = event.target.closest("[data-node-key]");
      const node = nodeElement
        ? renderer.getModel()?.nodeByKey.get(nodeElement.dataset.nodeKey)
        : null;
      if (node && !event.target.closest("[data-zwd-port]")) {
        controller.emit("node:open-detail", {
          node_ref: modules.cloneValue(node.ref)
        });
      }
    }

    function onDoubleClick(event) {
      const body = event.target.closest("[data-note-body]");
      if (body) noteEditor.begin(body.dataset.noteBody, body);
    }

    function onChange(event) {
      const input = event.target.closest("[data-note-color]");
      if (input) noteEditor.setColor(input.dataset.noteColor, input.value);
    }

    listen(shell.viewport, "pointerdown", onPointerDown);
    listen(shell.viewport, "pointermove", onPointerMove);
    listen(shell.viewport, "pointerup", onPointerUp);
    listen(shell.viewport, "pointercancel", onPointerCancel);
    listen(shell.shell, "click", onClick);
    listen(shell.shell, "dblclick", onDoubleClick);
    listen(shell.shell, "change", onChange);
    return Object.freeze({
      destroy() {
        gesture = null;
        noteEditor.close();
        commandInteraction.destroy();
        cleanup.splice(0).forEach((remove) => remove());
      }
    });
  }

  modules.createWorkflowInteraction = createInteraction;
})(window);
