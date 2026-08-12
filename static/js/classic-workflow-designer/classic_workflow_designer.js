(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const core = packages.workflowDesignerCore;
  const modules = packages.__classicWorkflowDesignerModules =
    packages.__classicWorkflowDesignerModules || {};

  function normalizeRenderers(value) {
    if (!value) return {};
    if (Array.isArray(value)) {
      return Object.fromEntries(value
        .filter((item) => item && typeof item === "object")
        .map((item) => [String(item.type || "default"), item]));
    }
    if (typeof value !== "object") {
      throw new TypeError("nodeRenderers must be an object or array");
    }
    return { ...value };
  }

  function normalizeTheme(value) {
    const theme = value && typeof value === "object" ? value : {};
    return Object.fromEntries(Object.entries(theme)
      .filter(([key, item]) => (
        String(key).startsWith("--zcwd-") &&
        ["string", "number"].includes(typeof item)
      )));
  }

  function createClassicWorkflowDesigner(options = {}) {
    const rootElement = options.root;
    if (!(rootElement instanceof HTMLElement)) {
      throw new TypeError(
        "createClassicWorkflowDesigner requires an HTMLElement root"
      );
    }
    let documentSnapshot = core.cloneValue(options.document || {
      metadata: {},
      steps: [],
      flows: {},
      notes: []
    });
    core.assertWorkflowDocument(documentSnapshot);
    let selection = core.normalizeSelection(options.selection);
    let viewport = core.normalizeViewport(options.viewport);
    let status = core.normalizeStatus(options.status);
    let readonly = !!options.readonly;
    let nodeRenderers = normalizeRenderers(options.nodeRenderers);
    let mounted = false;
    let shell = null;
    let renderer = null;
    let interaction = null;
    let sequence = 0;
    let clipboardFragment = null;
    const emitter = core.createEmitter();
    const idManager = core.createWorkflowIdManager(
      options.idAllocator,
      documentSnapshot
    );
    const graphConstraints = typeof options.graphConstraints === "function"
      ? options.graphConstraints
      : null;

    function renderDocument() {
      if (!mounted) return;
      renderer.renderDocument(
        modules.buildClassicGraphModel(documentSnapshot),
        {
          nodeRenderers,
          readonly,
          selection,
          status
        }
      );
      renderer.applyViewport(viewport);
    }

    function transactionId() {
      sequence += 1;
      return `zcwdtx_${Date.now()}_${sequence}`;
    }

    function commit(patch, reason) {
      if (readonly || !Array.isArray(patch) || !patch.length) return null;
      const checked = core.applyDocumentPatchWithInverse(
        documentSnapshot,
        patch
      );
      const payload = {
        patch: core.cloneValue(patch),
        inversePatch: checked.inversePatch,
        reason: String(reason || "document.edit"),
        transactionId: transactionId()
      };
      emitter.emit("document:change", payload);
      return core.cloneValue(payload);
    }

    function select(value, reason) {
      const next = core.normalizeSelection(value);
      if (core.sameValue(selection, next)) return;
      selection = next;
      renderer?.applySelection(selection);
      emitter.emit("selection:change", {
        selection: core.cloneValue(selection),
        reason: String(reason || "ui")
      });
    }

    function changeViewport(value) {
      const next = core.normalizeViewport(value);
      if (core.sameValue(viewport, next)) return;
      viewport = next;
      renderer?.applyViewport(viewport);
      emitter.emit("viewport:change", {
        viewport: core.cloneValue(viewport)
      });
    }

    function fitView(fitOptions = {}) {
      if (!mounted) return core.cloneValue(viewport);
      const model = renderer.getModel();
      const rect = shell.shell.getBoundingClientRect();
      const padding = Math.max(16, Number(fitOptions.padding) || 64);
      if (!model || rect.width <= 0 || rect.height <= 0) return viewport;
      const zoom = Math.min(1.35, Math.max(0.25, Math.min(
        (rect.width - padding * 2) / model.bounds.width,
        (rect.height - padding * 2) / model.bounds.height
      )));
      changeViewport({
        x: (rect.width - model.bounds.width * zoom) / 2 -
          model.bounds.x * zoom,
        y: (rect.height - model.bounds.height * zoom) / 2 -
          model.bounds.y * zoom,
        zoom
      });
      return core.cloneValue(viewport);
    }

    function zoomBy(factor) {
      if (!mounted) return;
      const rect = shell.shell.getBoundingClientRect();
      const zoom = Math.min(2.5, Math.max(0.25, viewport.zoom * factor));
      const center = { x: rect.width / 2, y: rect.height / 2 };
      const world = {
        x: (center.x - viewport.x) / viewport.zoom,
        y: (center.y - viewport.y) / viewport.zoom
      };
      changeViewport({
        x: center.x - world.x * zoom,
        y: center.y - world.y * zoom,
        zoom
      });
    }

    function addNote(point) {
      if (readonly) return null;
      const rect = shell?.shell.getBoundingClientRect() || {
        width: 800,
        height: 600
      };
      const fallback = {
        x: (rect.width / 2 - viewport.x) / viewport.zoom - 120,
        y: (rect.height / 2 - viewport.y) / viewport.zoom - 72
      };
      const location = core.normalizePosition(point, fallback);
      const noteId = idManager.allocate("note", 1, documentSnapshot)[0];
      const tokenColor = root.getComputedStyle(rootElement)
        .getPropertyValue("--surface-hover")
        .trim();
      const note = {
        note_id: noteId,
        ui_position: {
          x: Math.round(location.x),
          y: Math.round(location.y)
        },
        size: { width: 240, height: 144 },
        text: "",
        color: String(options.noteColors?.[0] || tokenColor || "#fff4bf")
      };
      const notes = Array.isArray(documentSnapshot.notes)
        ? documentSnapshot.notes
        : null;
      const patch = notes
        ? [{ op: "add", path: ["notes", notes.length], value: note }]
        : [{ op: "add", path: ["notes"], value: [note] }];
      const transaction = commit(patch, "annotation.add");
      select({
        nodes: [],
        edges: [],
        annotation_ids: [noteId]
      }, "annotation.add");
      return transaction;
    }

    function copy(value = selection) {
      return core.copyWorkflowSelection(documentSnapshot, value);
    }

    function cloneFromFragment(fragment, mode) {
      if (readonly) return null;
      const result = core.cloneWorkflowFragment(
        documentSnapshot,
        core.cloneValue(fragment),
        {
          mode,
          sourceDocument: fragment.source_document || documentSnapshot,
          idManager,
          referenceRewriter: options.referenceRewriter,
          offset: { x: 48, y: 48 }
        }
      );
      const transaction = commit(
        core.diffWorkflowDocuments(documentSnapshot, result.document),
        mode === "duplicate" ? "graph.duplicate" : "graph.paste"
      );
      select(result.selection, mode);
      return {
        transaction,
        stepIdMap: Object.fromEntries(result.stepIdMap.entries()),
        flowIdMap: Object.fromEntries(result.flowIdMap.entries()),
        selection: core.cloneValue(result.selection)
      };
    }

    function duplicate(value = selection) {
      const fragment = copy(value);
      if (
        !fragment.steps.length &&
        !fragment.notes.length &&
        fragment.kind !== "flow"
      ) return null;
      return cloneFromFragment(fragment, "duplicate");
    }

    function paste(fragment) {
      if (!fragment) return null;
      return cloneFromFragment(fragment, "paste");
    }

    function requestConnect(source, target) {
      const payload = {
        source_node_ref: core.cloneValue(source.ref),
        target_node_ref: core.cloneValue(target.ref),
        ports: { source: "out", target: "in" }
      };
      if (graphConstraints) {
        const result = graphConstraints({
          operation: "connect",
          document: core.cloneValue(documentSnapshot),
          sourceNodeRef: payload.source_node_ref,
          targetNodeRef: payload.target_node_ref
        });
        if (result && typeof result.then === "function") {
          throw new Error("graphConstraints must be synchronous");
        }
        if (result === false || result?.allowed === false) {
          renderer?.showMessage(
            String(result?.message || "This connection is not allowed."),
            "error"
          );
          return false;
        }
      }
      emitter.emit("connect:create-request", payload);
      return true;
    }

    function currentNode(target) {
      if (target?.kind === "node") return target.node;
      const ref = selection.nodes[0];
      if (!ref) return null;
      return renderer?.getModel()?.nodeByKey.get(core.nodeRefKey(ref)) || null;
    }

    function executeCommand(commandId, target, point) {
      const command = String(commandId || "").trim();
      const editCommands = new Set([
        "annotation.add",
        "selection.delete",
        "selection.duplicate",
        "selection.paste"
      ]);
      if (readonly && editCommands.has(command)) return null;
      let result = null;
      if (command === "viewport.zoom-in") zoomBy(1.15);
      else if (command === "viewport.zoom-out") zoomBy(1 / 1.15);
      else if (command === "viewport.fit") result = fitView();
      else if (command === "annotation.add") result = addNote(point);
      else if (command === "selection.copy") {
        clipboardFragment = copy();
        result = clipboardFragment;
      } else if (command === "selection.paste") {
        result = paste(clipboardFragment);
      } else if (command === "selection.duplicate") {
        result = duplicate();
      } else if (command === "selection.delete") {
        emitter.emit("delete:request", {
          selection: core.cloneValue(selection)
        });
      } else if (command === "node.open") {
        const node = currentNode(target);
        if (node) emitter.emit("node:open-detail", {
          node_ref: core.cloneValue(node.ref)
        });
      } else if (command === "node.run") {
        const node = currentNode(target);
        if (node) emitter.emit("run:request", {
          node_ref: core.cloneValue(node.ref),
          mode: node.ref.flow_id ? "flow" : "step"
        });
      }
      emitter.emit("command:execute", {
        commandId: command,
        target: target?.kind || null
      });
      return result;
    }

    const controller = Object.freeze({
      getDocument: () => documentSnapshot,
      getSelection: () => selection,
      getViewport: () => viewport,
      isReadonly: () => readonly,
      select,
      changeViewport,
      commit,
      emit: emitter.emit,
      executeCommand,
      requestConnect
    });

    function mount() {
      if (mounted) return api;
      shell = modules.createClassicShell(
        rootElement,
        options.commandLabels || {}
      );
      Object.entries(normalizeTheme(options.theme)).forEach(([key, value]) => {
        shell.shell.style.setProperty(key, String(value));
      });
      renderer = modules.createClassicRenderer(shell);
      mounted = true;
      renderDocument();
      interaction = modules.createClassicInteraction(
        shell,
        renderer,
        controller,
        options.commandLabels || {}
      );
      return api;
    }

    function destroy() {
      if (!mounted) return;
      interaction?.destroy();
      renderer?.destroy();
      emitter.clear();
      interaction = null;
      renderer = null;
      shell = null;
      mounted = false;
    }

    const api = Object.freeze({
      mount,
      destroy,
      setDocument(value) {
        core.assertWorkflowDocument(value);
        documentSnapshot = core.cloneValue(value);
        idManager.observe(documentSnapshot);
        renderDocument();
      },
      getDocument: () => core.cloneValue(documentSnapshot),
      updateDocument(patch) {
        documentSnapshot = core.applyDocumentPatch(documentSnapshot, patch);
        idManager.observe(documentSnapshot);
        renderDocument();
        return core.cloneValue(documentSnapshot);
      },
      setSelection(value) {
        selection = core.normalizeSelection(value);
        renderer?.applySelection(selection);
      },
      getSelection: () => core.cloneValue(selection),
      setViewport(value) {
        viewport = core.normalizeViewport(value);
        renderer?.applyViewport(viewport);
      },
      getViewport: () => core.cloneValue(viewport),
      fitView,
      setStatus(value) {
        status = core.normalizeStatus(value);
        renderer?.applyStatus(status);
      },
      setReadonly(value) {
        readonly = !!value;
        renderer?.setReadonly(readonly);
      },
      setNodeRenderers(value) {
        nodeRenderers = normalizeRenderers(value);
        renderer?.setRenderers(nodeRenderers);
      },
      duplicate,
      copy,
      paste,
      on: emitter.on,
      off: emitter.off
    });
    return api;
  }

  packages.classicWorkflowDesigner = Object.freeze({
    createWorkflowDesigner: createClassicWorkflowDesigner,
    applyDocumentPatch: core.applyDocumentPatch
  });
})(window);
