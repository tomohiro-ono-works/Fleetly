(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const app = packages.app = packages.app || {};
  const modules = packages.__workflowAppModules =
    packages.__workflowAppModules || {};
  function requireFunction(value, message) {
    if (typeof value !== "function") throw new Error(message);
    return value;
  }

  function normalizeError(error) {
    return {
      code: String(error?.code || "E_WORKFLOW_APP"),
      message: String(error?.message || error || "エラーが発生しました。")
    };
  }

  function createWorkflowAppSession(options = {}) {
    const storeFactory = requireFunction(
      app.workflowDocumentStore?.createWorkflowDocumentStore,
      "workflow document storeが利用できません。"
    );
    const commandFactory = requireFunction(
      app.workflowDocumentCommands?.createWorkflowDocumentCommands,
      "workflow document commandが利用できません。"
    );
    const adapterFactory = requireFunction(
      app.workflowDesignerAdapter?.createWorkflowDesignerAdapter,
      "workflow designer adapterが利用できません。"
    );
    const assertDocument = requireFunction(
      modules.assertCanonicalDocument,
      "workflow document contractが利用できません。"
    );
    const rootElement = options.root;
    if (!(rootElement instanceof HTMLElement)) {
      throw new TypeError("workflow app sessionにはrootが必要です。");
    }
    const catalog = options.catalog;
    const documents = options.documents;
    const runs = options.runs;
    let mtimeNs = "";
    let destroyed = false;
    const initialDocument = modules.createEmptyWorkflowDocument(
      catalog,
      options.mode || "dataflow"
    );
    const store = storeFactory({
      document: initialDocument,
      doc_session_id: options.doc_session_id,
      mode: options.mode || "dataflow"
    });
    const commands = commandFactory({ store, catalog });
    if (options.createInitialFlow !== false) commands.addFlow();
    function reportError(error) {
      const normalized = normalizeError(error);
      options.onError?.(normalized, error);
      return normalized;
    }
    function syncDesignerStatus(nodeStatus = runController?.getNodeStatus() || {}) {
      if (destroyed) return;
      adapter.setStatus({
        nodeStatus,
        validation: modules.collectDocumentValidation(store.getDocument())
      });
    }
    function publishState(changeType = "state") {
      if (destroyed) return;
      const snapshot = store.getSnapshot();
      options.onStateChange?.({
        type: changeType,
        flow_name: modules.workflowDocumentName(snapshot.document),
        dirty: snapshot.dirty,
        can_undo: snapshot.can_undo,
        can_redo: snapshot.can_redo,
        running: runController?.isRunning() || false,
        run_id: runController?.getRunId() || "",
        mtime_ns: mtimeNs,
        metadata: snapshot.metadata
      });
    }
    const runController = modules.createWorkflowRunController({
      store,
      runs,
      onStatusChange: syncDesignerStatus,
      onRunState: options.onRunState,
      onStateChange: publishState,
      onError: reportError
    });
    const startRun = runController.startRun;
    const cancelRun = runController.cancelRun;
    const handleBridgeEvent = runController.handleBridgeEvent;

    const adapter = adapterFactory({
      root: rootElement,
      store,
      commands,
      catalog,
      designerFactory: options.designerFactory,
      commandLabels: {
        designer: "ワークフローデザイナー",
        canvasTools: "キャンバス操作",
        zoomOut: "縮小",
        zoomIn: "拡大",
        fitView: "全体表示",
        addNote: "付箋を追加",
        open: "詳細を開く",
        run: "実行",
        duplicate: "複製",
        delete: "削除"
      },
      onSelectionChange(payload) {
        options.onSelectionChange?.(payload);
      },
      onOpenDetail(payload) {
        options.onOpenDetail?.(payload);
      },
      onRunRequest(payload) {
        const nodeRef = payload?.node_ref || {};
        const nodeId = String(nodeRef.node_id || "");
        const request = nodeId && !["START", "END"].includes(nodeId)
          ? { step_id: nodeId }
          : { flow_id: String(nodeRef.flow_id || "") };
        startRun(request).catch(() => {});
      },
      onError(error) {
        reportError(error);
      },
      onCommandResult: options.onCommandResult
    });
    adapter.mount();

    const unsubscribe = store.subscribe((change) => {
      syncDesignerStatus();
      publishState(change.type);
    });
    syncDesignerStatus();
    publishState("initialized");

    function load(payload = {}) {
      const document = assertDocument(payload.document);
      runController.reset();
      mtimeNs = String(payload.mtime_ns || "");
      const change = adapter.load({
        document,
        doc_session_id: payload.doc_session_id ||
          payload.__doc_session_id,
        document_ref: payload.document_ref,
        file_name: payload.file_name,
        mode: payload.mode || document.metadata.mode
      });
      adapter.setSelection({ nodes: [], edges: [], annotation_ids: [] });
      root.requestAnimationFrame(() => adapter.fitView({ padding: 72 }));
      return change;
    }

    async function save(value = {}) {
      const snapshot = store.getSnapshot();
      const request = {
        doc_session_id: snapshot.metadata.doc_session_id,
        document_ref: snapshot.metadata.document_ref,
        mode: snapshot.metadata.mode,
        file_name: snapshot.metadata.file_name ||
          modules.workflowFileName(snapshot.document),
        document: snapshot.document
      };
      if (value.scope && value.rel_path) {
        request.scope = value.scope;
        request.rel_path = value.rel_path;
      }
      const response = await documents.save(request);
      if (response?.saved) {
        mtimeNs = String(response.mtime_ns || mtimeNs);
        adapter.markSaved({
          document_ref: response.document_ref,
          file_name: response.file_name
        });
      }
      return response;
    }

    return Object.freeze({
      adapter,
      commands,
      store,
      load,
      save,
      startRun,
      cancelRun,
      handleBridgeEvent,
      addFlow: (value) => commands.addFlow(value),
      undo() {
        const change = adapter.undo();
        if (change && /^(property\.|edge\.|selection\.delete)/.test(
          String(change.transaction?.reason || "")
        )) options.onHistoryChange?.(
          (store.getDocument().steps || []).map((step) => step.step_id)
        );
        return change;
      },
      redo() {
        const change = adapter.redo();
        if (change && /^(property\.|edge\.|selection\.delete)/.test(
          String(change.transaction?.reason || "")
        )) options.onHistoryChange?.(
          (store.getDocument().steps || []).map((step) => step.step_id)
        );
        return change;
      },
      setDocumentName(name) {
        return commands.updateMetadata({ name: String(name || "").trim() });
      },
      getDocumentName: () => modules.workflowDocumentName(store.getDocument()),
      getSnapshot: () => store.getSnapshot(),
      isRunning: runController.isRunning,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        unsubscribe();
        adapter.destroy();
        store.destroy();
      }
    });
  }

  app.workflowAppSession = Object.freeze({
    createWorkflowAppSession
  });
})(window);
