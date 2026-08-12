(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const core = packages.workflowDesignerCore;
  const modules = packages.__classicWorkflowDesignerModules =
    packages.__classicWorkflowDesignerModules || {};

  function createClassicRenderer(shell) {
    const context = shell.canvas.getContext("2d");
    let model = null;
    let selection = core.normalizeSelection();
    let viewport = core.normalizeViewport();
    let status = core.normalizeStatus();
    let readonly = false;
    let renderers = {};
    let frameId = 0;
    let messageTimer = 0;
    let hoverKey = "";
    let nodePreview = new Map();
    let notePreview = null;
    let connection = null;
    let rangeSelection = null;
    let noteLinks = [];
    let palette = modules.resolveClassicPalette(shell.shell);
    let resizeObserver = null;

    function resizeCanvas() {
      const rect = shell.shell.getBoundingClientRect();
      const dpr = Math.max(1, Math.ceil(root.devicePixelRatio || 1));
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const pixelWidth = Math.round(width * dpr);
      const pixelHeight = Math.round(height * dpr);
      if (shell.canvas.width !== pixelWidth) shell.canvas.width = pixelWidth;
      if (shell.canvas.height !== pixelHeight) shell.canvas.height = pixelHeight;
      shell.canvas.style.width = `${width}px`;
      shell.canvas.style.height = `${height}px`;
      return { width, height, dpr };
    }

    function drawConnection() {
      if (!connection?.source || !connection?.point) return;
      const start = {
        x: connection.source.x + connection.source.width,
        y: connection.source.y + connection.source.height / 2
      };
      context.save();
      context.strokeStyle = palette.selected;
      context.lineWidth = 2;
      context.setLineDash([6, 4]);
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(connection.point.x, connection.point.y);
      context.stroke();
      context.restore();
    }

    function drawRangeSelection() {
      if (!rangeSelection) return;
      const x = Math.min(rangeSelection.start.x, rangeSelection.end.x);
      const y = Math.min(rangeSelection.start.y, rangeSelection.end.y);
      const width = Math.abs(rangeSelection.end.x - rangeSelection.start.x);
      const height = Math.abs(rangeSelection.end.y - rangeSelection.start.y);
      context.save();
      context.fillStyle = "rgba(83, 50, 247, 0.1)";
      context.strokeStyle = palette.selected;
      context.lineWidth = 1.5;
      context.setLineDash([6, 4]);
      context.fillRect(x, y, width, height);
      context.strokeRect(x, y, width, height);
      context.restore();
    }

    function draw() {
      frameId = 0;
      const size = resizeCanvas();
      palette = modules.resolveClassicPalette(shell.shell);
      context.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
      context.clearRect(0, 0, size.width, size.height);
      context.fillStyle = palette.canvas;
      context.fillRect(0, 0, size.width, size.height);
      if (!model) return;

      context.save();
      context.translate(viewport.x, viewport.y);
      context.scale(viewport.zoom, viewport.zoom);
      context.lineCap = "round";
      context.lineJoin = "round";
      modules.drawClassicLoopFrames(context, model.loopFrames, palette);
      noteLinks = modules.drawClassicNotes(context, model.notes, {
        selection,
        notePreview,
        palette,
        readonly
      });
      modules.drawClassicEdges(context, model, {
        selection,
        palette,
        core
      });
      model.nodes.forEach((node) => {
        modules.drawClassicNode(context, node, {
          selectedKeys: new Set(selection.nodes.map(core.nodeRefKey)),
          nodePreview,
          status,
          renderers,
          hoverKey,
          connecting: !!connection,
          palette,
          requestDraw,
          readonly
        });
      });
      drawConnection();
      drawRangeSelection();
      context.restore();
    }

    function requestDraw() {
      if (frameId) return;
      frameId = root.requestAnimationFrame(draw);
    }

    function applySelection(value) {
      selection = core.normalizeSelection(value);
      const selectedNote = model?.notes.find(
        (note) => note.noteId === selection.annotation_ids[0]
      );
      shell.noteColor.hidden = !selectedNote || readonly;
      if (selectedNote && /^#[0-9a-f]{6}$/i.test(
        String(selectedNote.note?.color || "")
      )) {
        shell.noteColor.value = selectedNote.note.color;
      }
      requestDraw();
    }

    function renderDocument(nextModel, options = {}) {
      model = nextModel;
      renderers = options.nodeRenderers || {};
      readonly = !!options.readonly;
      selection = core.normalizeSelection(options.selection);
      status = core.normalizeStatus(options.status);
      applySelection(selection);
      requestDraw();
    }

    function applyViewport(value) {
      viewport = core.normalizeViewport(value);
      shell.canvas.dataset.viewportX = String(viewport.x);
      shell.canvas.dataset.viewportY = String(viewport.y);
      shell.canvas.dataset.viewportZoom = String(viewport.zoom);
      requestDraw();
    }

    function worldPoint(event) {
      const rect = shell.canvas.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left - viewport.x) / viewport.zoom,
        y: (event.clientY - rect.top - viewport.y) / viewport.zoom
      };
    }

    function showMessage(text, kind = "info") {
      root.clearTimeout(messageTimer);
      shell.message.textContent = String(text || "");
      shell.message.dataset.kind = String(kind || "info");
      shell.message.hidden = !shell.message.textContent;
      if (!shell.message.hidden) {
        messageTimer = root.setTimeout(() => {
          shell.message.hidden = true;
        }, 3600);
      }
    }

    function showContextMenu(items, clientX, clientY) {
      shell.contextMenu.innerHTML = "";
      items.forEach((item) => {
        const button = modules.classicElement(
          "button",
          `zcwd-context-menu__item${item.danger ? " is-danger" : ""}`,
          {
            type: "button",
            role: "menuitem",
            "data-zcwd-context-command": item.command
          }
        );
        button.textContent = item.label;
        shell.contextMenu.appendChild(button);
      });
      const shellRect = shell.shell.getBoundingClientRect();
      shell.contextMenu.style.left =
        `${Math.max(8, clientX - shellRect.left)}px`;
      shell.contextMenu.style.top =
        `${Math.max(8, clientY - shellRect.top)}px`;
      shell.contextMenu.hidden = !items.length;
    }

    function hideContextMenu() {
      shell.contextMenu.hidden = true;
    }

    function getNoteScreenRect(noteId) {
      const note = model?.notes.find(
        (item) => item.noteId === String(noteId || "")
      );
      if (!note) return null;
      return {
        left: viewport.x + note.x * viewport.zoom,
        top: viewport.y + note.y * viewport.zoom,
        width: note.width * viewport.zoom,
        height: note.height * viewport.zoom
      };
    }

    function hitNoteLink(point) {
      return noteLinks.find((link) => (
        point.x >= link.x &&
        point.x <= link.x + link.width &&
        point.y >= link.y &&
        point.y <= link.y + link.height
      )) || null;
    }

    if (typeof root.ResizeObserver === "function") {
      resizeObserver = new root.ResizeObserver(requestDraw);
      resizeObserver.observe(shell.shell);
    }

    return Object.freeze({
      renderDocument,
      applySelection,
      applyStatus(value) {
        status = core.normalizeStatus(value);
        requestDraw();
      },
      applyViewport,
      setReadonly(value) {
        readonly = !!value;
        applySelection(selection);
      },
      setRenderers(value) {
        renderers = value || {};
        requestDraw();
      },
      setHoverKey(value) {
        const next = String(value || "");
        if (hoverKey === next) return;
        hoverKey = next;
        requestDraw();
      },
      setNodePreview(keys, dx, dy) {
        nodePreview = new Map(
          (keys || []).map((key) => [key, { dx, dy }])
        );
        requestDraw();
      },
      setNotePreview(value) {
        notePreview = value;
        requestDraw();
      },
      setConnection(value) {
        connection = value;
        requestDraw();
      },
      setRangeSelection(value) {
        rangeSelection = value;
        requestDraw();
      },
      clearPreviews() {
        nodePreview = new Map();
        notePreview = null;
        connection = null;
        rangeSelection = null;
        requestDraw();
      },
      showMessage,
      showContextMenu,
      hideContextMenu,
      worldPoint,
      hitNoteLink,
      getNoteScreenRect,
      getModel: () => model,
      getViewport: () => viewport,
      requestDraw,
      destroy() {
        if (frameId) root.cancelAnimationFrame(frameId);
        root.clearTimeout(messageTimer);
        resizeObserver?.disconnect();
        shell.rootElement.innerHTML = "";
        model = null;
      }
    });
  }

  modules.createClassicRenderer = createClassicRenderer;
})(window);
