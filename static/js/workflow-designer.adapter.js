(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const app = packages.app = packages.app || {};

  const EVENT_CALLBACKS = Object.freeze({
    "selection:change": "onSelectionChange",
    "viewport:change": "onViewportChange",
    "node:open-detail": "onOpenDetail",
    "command:execute": "onCommand",
    "connect:create-request": "onConnectRequest",
    "delete:request": "onDeleteRequest",
    "run:request": "onRunRequest",
    "external-link:open-request": "onExternalLinkRequest"
  });

  function requireFunction(value, message) {
    if (typeof value !== "function") {
      throw new TypeError(message);
    }
    return value;
  }

  function createWorkflowDesignerAdapter(options = {}) {
    const designerFactory = requireFunction(
      options.designerFactory ||
        packages.workflowDesigner?.createWorkflowDesigner,
      "WorkflowDesigner factoryが利用できません。"
    );
    const store = options.store;
    if (
      !store ||
      typeof store.getDocument !== "function" ||
      typeof store.applyTransaction !== "function" ||
      typeof store.subscribe !== "function"
    ) {
      throw new TypeError("workflow document storeが必要です。");
    }
    const commands = options.commands || null;
    if (commands && (
      typeof commands.canConnect !== "function" ||
      typeof commands.connect !== "function" ||
      typeof commands.deleteSelection !== "function"
    )) {
      throw new TypeError("workflow document commandsの契約が不正です。");
    }

    let nodeRenderers = options.nodeRenderers;
    if (!nodeRenderers && options.catalog) {
      const rendererFactory = app.workflowDesignerRenderers
        ?.createZizaiNodeRenderers;
      nodeRenderers = requireFunction(
        rendererFactory,
        "Zizai node renderer factoryが利用できません。"
      )({
        catalog: options.catalog,
        iconResolver: options.iconResolver
      });
    }

    function graphConstraints(context) {
      if (commands) {
        const result = commands.canConnect(
          context.sourceNodeRef,
          context.targetNodeRef,
          { document: context.document }
        );
        if (result?.allowed === false) return result;
      }
      if (typeof options.graphConstraints === "function") {
        return options.graphConstraints(context);
      }
      return { allowed: true };
    }

    const designer = designerFactory({
      root: options.root,
      document: store.getDocument(),
      viewport: options.viewport,
      selection: options.selection,
      nodeRenderers,
      commandLabels: options.commandLabels,
      idAllocator: typeof commands?.allocateIds === "function"
        ? commands.allocateIds
        : options.idAllocator,
      referenceRewriter: options.referenceRewriter,
      readonly: options.readonly,
      graphConstraints: commands || typeof options.graphConstraints === "function"
        ? graphConstraints
        : undefined,
      theme: options.theme,
      status: options.status,
      noteColors: options.noteColors
    });
    let mounted = false;
    let destroyed = false;
    const unsubscribers = [];

    function reportError(error) {
      if (typeof options.onError === "function") {
        options.onError(error);
      }
    }

    function reportCommandResult(command, payload, result) {
      if (typeof options.onCommandResult === "function") {
        options.onCommandResult({
          command,
          payload,
          result
        });
      }
    }

    unsubscribers.push(designer.on("document:change", (transaction) => {
      try {
        store.applyTransaction(transaction);
      } catch (error) {
        reportError(error);
        throw error;
      }
    }));

    Object.entries(EVENT_CALLBACKS).forEach(([eventName, callbackName]) => {
      if (
        commands &&
        (eventName === "connect:create-request" ||
          eventName === "delete:request")
      ) {
        return;
      }
      const callback = options[callbackName];
      if (typeof callback !== "function") return;
      unsubscribers.push(designer.on(eventName, callback));
    });

    if (commands) {
      unsubscribers.push(designer.on("connect:create-request", (payload) => {
        try {
          const result = commands.connect(
            payload.source_node_ref,
            payload.target_node_ref
          );
          if (typeof options.onConnectRequest === "function") {
            options.onConnectRequest(payload, result);
          }
          reportCommandResult("edge.connect", payload, result);
        } catch (error) {
          reportError(error);
        }
      }));
      unsubscribers.push(designer.on("delete:request", (payload) => {
        try {
          const result = commands.deleteSelection(payload.selection);
          if (result.changed) {
            designer.setSelection({
              nodes: [],
              edges: [],
              annotation_ids: []
            });
          }
          if (typeof options.onDeleteRequest === "function") {
            options.onDeleteRequest(payload, result);
          }
          reportCommandResult("selection.delete", payload, result);
        } catch (error) {
          reportError(error);
        }
      }));
    }

    unsubscribers.push(store.subscribe((change) => {
      if (destroyed) return;
      designer.setDocument(change.document);
      if (typeof options.onDocumentChange === "function") {
        options.onDocumentChange(change);
      }
    }));

    const api = Object.freeze({
      mount() {
        if (destroyed) {
          throw new Error("workflow designer adapterは破棄されています。");
        }
        if (mounted) return api;
        designer.mount();
        mounted = true;
        return api;
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        mounted = false;
        unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
        designer.destroy();
      },
      getDocument: () => store.getDocument(),
      getSnapshot: () => store.getSnapshot(),
      getSelection: () => designer.getSelection(),
      setSelection: (value) => designer.setSelection(value),
      getViewport: () => designer.getViewport(),
      setViewport: (value) => designer.setViewport(value),
      fitView: (value) => designer.fitView(value),
      setStatus: (value) => designer.setStatus(value),
      setReadonly: (value) => designer.setReadonly(value),
      setNodeRenderers: (value) => designer.setNodeRenderers(value),
      undo: () => store.undo(),
      redo: () => store.redo(),
      markSaved: (value) => store.markSaved(value),
      load: (value) => store.load(value),
      duplicate: (value) => designer.duplicate(value),
      copy: (value) => designer.copy(value),
      paste: (value) => designer.paste(value),
      designer,
      store,
      commands
    });
    return api;
  }

  app.workflowDesignerAdapter = Object.freeze({
    createWorkflowDesignerAdapter
  });
})(window);
