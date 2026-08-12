(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__workflowDesignerModules =
    packages.__workflowDesignerModules || {};

  function createCommandInteraction(shell, renderer, controller, selection) {
    const cleanup = [];
    let contextTarget = null;

    function listen(target, eventName, handler, options) {
      target.addEventListener(eventName, handler, options);
      cleanup.push(() => target.removeEventListener(eventName, handler, options));
    }

    function contextItems(target) {
      const labels = controller.getCommandLabels();
      if (target?.kind === "node") {
        const items = [
          { commandId: "node.open", label: labels.open || "Open" },
          { commandId: "node.run", label: labels.run || "Run" }
        ];
        if (!controller.isReadonly()) items.push(
          { commandId: "selection.duplicate", label: labels.duplicate || "Duplicate" },
          { commandId: "selection.delete", label: labels.delete || "Delete" }
        );
        return items;
      }
      if (target?.kind === "note") {
        return controller.isReadonly()
          ? []
          : [{ commandId: "selection.delete", label: labels.delete || "Delete" }];
      }
      return controller.isReadonly() ? [
        { commandId: "viewport.fit", label: labels.fitView || "Fit view" }
      ] : [
        { commandId: "annotation.add", label: labels.addNote || "Add note" },
        { commandId: "viewport.fit", label: labels.fitView || "Fit view" }
      ];
    }

    function onContextMenu(event) {
      event.preventDefault();
      const nodeElement = event.target.closest("[data-node-key]");
      const noteElement = event.target.closest("[data-note-id]");
      if (nodeElement) {
        const node = renderer.getModel()?.nodeByKey.get(nodeElement.dataset.nodeKey);
        contextTarget = node ? { kind: "node", node } : null;
        if (node) selection.selectNode(node, false);
      } else if (noteElement) {
        const noteId = noteElement.dataset.noteId;
        contextTarget = { kind: "note", noteId };
        selection.selectNote(noteId, false);
      } else {
        contextTarget = { kind: "canvas" };
      }
      const rect = shell.shell.getBoundingClientRect();
      renderer.showContextMenu(contextItems(contextTarget), {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      });
    }

    function onWheel(event) {
      event.preventDefault();
      const viewport = controller.getViewport();
      const rect = shell.viewport.getBoundingClientRect();
      const anchor = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      };
      const nextZoom = Math.min(
        2.5,
        Math.max(0.25, viewport.zoom * (event.deltaY < 0 ? 1.1 : 0.9))
      );
      const worldX = (anchor.x - viewport.x) / viewport.zoom;
      const worldY = (anchor.y - viewport.y) / viewport.zoom;
      controller.changeViewport({
        x: anchor.x - worldX * nextZoom,
        y: anchor.y - worldY * nextZoom,
        zoom: nextZoom
      });
    }

    function onKeyDown(event) {
      if (event.target.matches("textarea, input, [contenteditable='true']")) return;
      const key = event.key.toLowerCase();
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        controller.executeCommand("selection.delete");
      } else if ((event.ctrlKey || event.metaKey) && key === "d") {
        event.preventDefault();
        controller.executeCommand("selection.duplicate");
      } else if ((event.ctrlKey || event.metaKey) && key === "c") {
        controller.executeCommand("selection.copy");
      } else if ((event.ctrlKey || event.metaKey) && key === "v") {
        controller.executeCommand("selection.paste");
      } else if (event.key === "Enter") {
        controller.executeCommand("node.open");
      }
    }

    listen(shell.shell, "contextmenu", onContextMenu);
    listen(shell.viewport, "wheel", onWheel, { passive: false });
    listen(shell.shell, "keydown", onKeyDown);

    return Object.freeze({
      getContextTarget: () => contextTarget,
      destroy() {
        cleanup.splice(0).forEach((remove) => remove());
      }
    });
  }

  modules.createWorkflowCommandInteraction = createCommandInteraction;
})(window);
