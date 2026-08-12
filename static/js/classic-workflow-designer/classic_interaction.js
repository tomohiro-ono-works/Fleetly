(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const core = packages.workflowDesignerCore;
  const modules = packages.__classicWorkflowDesignerModules =
    packages.__classicWorkflowDesignerModules || {};

  function createClassicInteraction(shell, renderer, controller, labels = {}) {
    const cleanup = [];
    const noteEditor = modules.createClassicNoteEditor(
      shell,
      renderer,
      controller
    );
    let gesture = null;
    let contextTarget = null;
    let suppressClick = false;

    function listen(target, name, handler, options) {
      target.addEventListener(name, handler, options);
      cleanup.push(() => target.removeEventListener(name, handler, options));
    }

    function selectNode(node, additive) {
      const current = core.normalizeSelection(controller.getSelection());
      const key = core.nodeRefKey(node.ref);
      const existing = new Map(current.nodes.map((ref) => [
        core.nodeRefKey(ref),
        ref
      ]));
      if (additive && existing.has(key)) existing.delete(key);
      else {
        if (!additive) existing.clear();
        existing.set(key, core.cloneValue(node.ref));
      }
      controller.select({
        nodes: Array.from(existing.values()),
        edges: additive ? current.edges : [],
        annotation_ids: additive ? current.annotation_ids : []
      }, "canvas.node");
    }

    function selectEdge(edge, additive) {
      const current = core.normalizeSelection(controller.getSelection());
      const key = core.edgeRefKey(edge.ref);
      const existing = new Map(current.edges.map((ref) => [
        core.edgeRefKey(ref),
        ref
      ]));
      if (additive && existing.has(key)) existing.delete(key);
      else {
        if (!additive) existing.clear();
        existing.set(key, core.cloneValue(edge.ref));
      }
      controller.select({
        nodes: additive ? current.nodes : [],
        edges: Array.from(existing.values()),
        annotation_ids: additive ? current.annotation_ids : []
      }, "canvas.edge");
    }

    function selectNote(note, additive) {
      const current = core.normalizeSelection(controller.getSelection());
      const ids = new Set(current.annotation_ids);
      if (additive && ids.has(note.noteId)) ids.delete(note.noteId);
      else {
        if (!additive) ids.clear();
        ids.add(note.noteId);
      }
      controller.select({
        nodes: additive ? current.nodes : [],
        edges: additive ? current.edges : [],
        annotation_ids: Array.from(ids)
      }, "canvas.note");
    }

    function selectedNodes(model) {
      const keys = new Set(
        controller.getSelection().nodes.map(core.nodeRefKey)
      );
      return model.nodes.filter((node) => keys.has(node.key));
    }

    function beginNode(event, node, point) {
      const selected = new Set(
        controller.getSelection().nodes.map(core.nodeRefKey)
      );
      if (event.shiftKey || !selected.has(node.key)) {
        selectNode(node, event.shiftKey);
      }
      if (controller.isReadonly()) return;
      gesture = {
        kind: "node",
        pointerId: event.pointerId,
        start: point,
        nodes: selectedNodes(renderer.getModel()),
        dx: 0,
        dy: 0,
        moved: false
      };
    }

    function onPointerDown(event) {
      if (event.button !== 0) return;
      shell.canvas.focus();
      renderer.hideContextMenu();
      noteEditor.close(true);
      const model = renderer.getModel();
      const point = renderer.worldPoint(event);
      const noteHit = modules.hitClassicNote(model, point);
      const output = modules.hitClassicPort(model, point, "out");
      const node = modules.hitClassicNode(model, point);
      const edge = modules.hitClassicEdge(model, point);

      if (noteHit) {
        selectNote(noteHit.note, event.shiftKey);
        if (!controller.isReadonly()) {
          gesture = {
            kind: noteHit.resize ? "note-resize" : "note-move",
            pointerId: event.pointerId,
            start: point,
            note: noteHit.note,
            dx: 0,
            dy: 0,
            moved: false
          };
        }
      } else if (output && !controller.isReadonly()) {
        selectNode(output.node, false);
        gesture = {
          kind: "connect",
          pointerId: event.pointerId,
          source: output.node,
          start: point,
          point,
          moved: false
        };
      } else if (node) {
        beginNode(event, node, point);
      } else if (edge) {
        selectEdge(edge, event.shiftKey);
      } else if (event.shiftKey) {
        controller.select(
          { nodes: [], edges: [], annotation_ids: [] },
          "canvas.range-start"
        );
        gesture = {
          kind: "range",
          pointerId: event.pointerId,
          start: point,
          end: point,
          moved: false
        };
      } else {
        controller.select(
          { nodes: [], edges: [], annotation_ids: [] },
          "canvas"
        );
        gesture = {
          kind: "pan",
          pointerId: event.pointerId,
          startClient: { x: event.clientX, y: event.clientY },
          viewport: controller.getViewport(),
          moved: false
        };
      }
      if (gesture) {
        shell.canvas.setPointerCapture(event.pointerId);
        event.preventDefault();
      }
    }

    function onPointerMove(event) {
      const model = renderer.getModel();
      const point = renderer.worldPoint(event);
      if (!gesture || event.pointerId !== gesture.pointerId) {
        const node = modules.hitClassicNode(model, point);
        renderer.setHoverKey(node?.key || "");
        shell.canvas.style.cursor = node ? "pointer" : "default";
        return;
      }
      if (gesture.kind === "pan") {
        const dx = event.clientX - gesture.startClient.x;
        const dy = event.clientY - gesture.startClient.y;
        gesture.moved = Math.abs(dx) > 2 || Math.abs(dy) > 2;
        if (gesture.moved) suppressClick = true;
        controller.changeViewport({
          ...gesture.viewport,
          x: gesture.viewport.x + dx,
          y: gesture.viewport.y + dy
        });
        return;
      }
      const rawDx = point.x - gesture.start.x;
      const rawDy = point.y - gesture.start.y;
      gesture.moved = Math.abs(rawDx) > 2 || Math.abs(rawDy) > 2;
      if (gesture.moved) suppressClick = true;

      if (gesture.kind === "node") {
        const primary = gesture.nodes[0];
        const grid = 16;
        gesture.dx = Math.round((primary.x + rawDx) / grid) * grid - primary.x;
        gesture.dy = Math.round((primary.y + rawDy) / grid) * grid - primary.y;
        renderer.setNodePreview(
          gesture.nodes.map((node) => node.key),
          gesture.dx,
          gesture.dy
        );
      } else if (gesture.kind === "connect") {
        gesture.point = point;
        renderer.setConnection({ source: gesture.source, point });
      } else if (gesture.kind === "note-move") {
        gesture.dx = rawDx;
        gesture.dy = rawDy;
        renderer.setNotePreview({
          noteId: gesture.note.noteId,
          dx: rawDx,
          dy: rawDy
        });
      } else if (gesture.kind === "note-resize") {
        gesture.width = Math.max(160, gesture.note.width + rawDx);
        gesture.height = Math.max(96, gesture.note.height + rawDy);
        renderer.setNotePreview({
          noteId: gesture.note.noteId,
          width: gesture.width,
          height: gesture.height
        });
      } else if (gesture.kind === "range") {
        gesture.end = point;
        renderer.setRangeSelection({
          start: gesture.start,
          end: gesture.end
        });
      }
    }

    function positionOperation(path, value) {
      const current = core.getDocumentPathValue(controller.getDocument(), path);
      return {
        op: current.exists ? "replace" : "add",
        path: core.cloneValue(path),
        value
      };
    }

    function finishGesture(event, current) {
      if (current.kind === "node" && current.moved) {
        controller.commit(current.nodes.map((node) => positionOperation(
          node.documentPath,
          {
            x: Math.round(node.x + current.dx),
            y: Math.round(node.y + current.dy)
          }
        )), "node.move");
      } else if (current.kind === "connect") {
        const target = modules.hitClassicPort(
          renderer.getModel(),
          renderer.worldPoint(event),
          "in",
          12
        );
        if (target && target.node.key !== current.source.key) {
          controller.requestConnect(current.source, target.node);
        }
      } else if (current.kind === "note-move" && current.moved) {
        controller.commit([positionOperation(current.note.positionPath, {
          x: Math.round(current.note.x + current.dx),
          y: Math.round(current.note.y + current.dy)
        })], "annotation.move");
      } else if (current.kind === "note-resize" && current.moved) {
        controller.commit([positionOperation(current.note.sizePath, {
          width: Math.round(current.width),
          height: Math.round(current.height)
        })], "annotation.resize");
      } else if (current.kind === "range" && current.moved) {
        const nodes = modules.classicNodesInRect(
          renderer.getModel(),
          current
        );
        controller.select({
          nodes: nodes.map((node) => core.cloneValue(node.ref)),
          edges: [],
          annotation_ids: []
        }, "canvas.range");
      }
    }

    function onPointerUp(event) {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      const current = gesture;
      gesture = null;
      renderer.clearPreviews();
      finishGesture(event, current);
    }

    function onPointerCancel(event) {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      gesture = null;
      suppressClick = true;
      renderer.clearPreviews();
    }

    function contextItems(target) {
      if (target?.kind === "node") return [
        { command: "node.open", label: labels.open || "詳細を開く" },
        { command: "node.run", label: labels.run || "実行" },
        { command: "selection.duplicate", label: labels.duplicate || "複製" },
        {
          command: "selection.delete",
          label: labels.delete || "削除",
          danger: true
        }
      ];
      if (target?.kind === "edge") return [{
        command: "selection.delete",
        label: labels.deleteEdge || "接続を削除",
        danger: true
      }];
      if (target?.kind === "note") return [
        { command: "annotation.edit", label: labels.editNote || "メモを編集" },
        {
          command: "selection.delete",
          label: labels.delete || "削除",
          danger: true
        }
      ];
      return [
        { command: "annotation.add", label: labels.addNote || "付箋を追加" },
        { command: "selection.paste", label: labels.paste || "貼り付け" }
      ];
    }

    function onContextMenu(event) {
      event.preventDefault();
      const point = renderer.worldPoint(event);
      const model = renderer.getModel();
      const note = modules.hitClassicNote(model, point)?.note;
      const node = modules.hitClassicNode(model, point);
      const edge = modules.hitClassicEdge(model, point);
      if (note) {
        selectNote(note, false);
        contextTarget = { kind: "note", note };
      } else if (node) {
        selectNode(node, false);
        contextTarget = { kind: "node", node };
      } else if (edge) {
        selectEdge(edge, false);
        contextTarget = { kind: "edge", edge };
      } else {
        contextTarget = { kind: "canvas", point };
      }
      renderer.showContextMenu(
        contextItems(contextTarget),
        event.clientX,
        event.clientY
      );
    }

    function onClick(event) {
      const toolbarCommand = event.target.closest("[data-zcwd-command]")
        ?.dataset.zcwdCommand;
      const contextCommand = event.target.closest(
        "[data-zcwd-context-command]"
      )?.dataset.zcwdContextCommand;
      if (toolbarCommand || contextCommand) {
        renderer.hideContextMenu();
        if (contextCommand === "annotation.edit" && contextTarget?.note) {
          noteEditor.begin(contextTarget.note);
        } else {
          controller.executeCommand(
            toolbarCommand || contextCommand,
            contextCommand ? contextTarget : null,
            contextCommand ? contextTarget?.point : null
          );
        }
        return;
      }
      if (event.target !== shell.canvas) return;
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      const point = renderer.worldPoint(event);
      const link = renderer.hitNoteLink(point);
      if (link) {
        controller.emit("external-link:open-request", { url: link.url });
        return;
      }
      const node = modules.hitClassicNode(renderer.getModel(), point);
      if (node) {
        controller.emit("node:open-detail", {
          node_ref: core.cloneValue(node.ref)
        });
      }
    }

    function onDoubleClick(event) {
      if (event.target !== shell.canvas) return;
      const note = modules.hitClassicNote(
        renderer.getModel(),
        renderer.worldPoint(event)
      )?.note;
      if (note) noteEditor.begin(note);
    }

    function onWheel(event) {
      const current = controller.getViewport();
      if (event.ctrlKey || event.metaKey) {
        const rect = shell.canvas.getBoundingClientRect();
        const cursor = {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top
        };
        const world = renderer.worldPoint(event);
        const zoom = Math.min(2.5, Math.max(
          0.25,
          current.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12)
        ));
        controller.changeViewport({
          x: cursor.x - world.x * zoom,
          y: cursor.y - world.y * zoom,
          zoom
        });
      } else {
        controller.changeViewport({
          ...current,
          x: current.x - event.deltaX,
          y: current.y - event.deltaY
        });
      }
      event.preventDefault();
    }

    function onKeyDown(event) {
      if (event.target !== shell.canvas && event.target !== shell.shell) return;
      if (event.key === "Escape") {
        renderer.hideContextMenu();
        controller.select(
          { nodes: [], edges: [], annotation_ids: [] },
          "keyboard.escape"
        );
        return;
      }
      if (["Delete", "Backspace"].includes(event.key)) {
        if (!controller.isReadonly()) {
          controller.executeCommand("selection.delete");
          event.preventDefault();
        }
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = String(event.key || "").toLowerCase();
      const command = key === "c"
        ? "selection.copy"
        : key === "v"
          ? "selection.paste"
          : key === "d"
            ? "selection.duplicate"
            : "";
      if (command && !controller.isReadonly()) {
        controller.executeCommand(command);
        event.preventDefault();
      }
    }

    function onColorChange() {
      const noteId = controller.getSelection().annotation_ids[0];
      const note = renderer.getModel()?.notes.find(
        (item) => item.noteId === noteId
      );
      if (!note || controller.isReadonly()) return;
      controller.commit([positionOperation(
        note.colorPath,
        shell.noteColor.value
      )], "annotation.color");
    }

    listen(shell.canvas, "pointerdown", onPointerDown);
    listen(shell.canvas, "pointermove", onPointerMove);
    listen(shell.canvas, "pointerup", onPointerUp);
    listen(shell.canvas, "pointercancel", onPointerCancel);
    listen(shell.canvas, "contextmenu", onContextMenu);
    listen(shell.shell, "click", onClick);
    listen(shell.canvas, "dblclick", onDoubleClick);
    listen(shell.canvas, "wheel", onWheel, { passive: false });
    listen(shell.shell, "keydown", onKeyDown);
    listen(shell.noteColor, "change", onColorChange);
    return Object.freeze({
      destroy() {
        gesture = null;
        noteEditor.destroy();
        cleanup.splice(0).forEach((remove) => remove());
      }
    });
  }

  modules.createClassicInteraction = createClassicInteraction;
})(window);
