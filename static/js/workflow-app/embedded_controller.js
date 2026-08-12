(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__workflowAppModules =
    packages.__workflowAppModules || {};

  function text(value) {
    return String(value || "").trim();
  }

  function uniqueStepIds(values) {
    return Array.from(new Set(
      (values || []).map(text).filter(Boolean)
    ));
  }

  function mergeHiddenBindings(target, value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    Object.entries(value).forEach(([ref, metadata]) => {
      const key = text(ref);
      if (!key || !metadata || typeof metadata !== "object") return;
      target[key] = {
        display_name: String(metadata.display_name || ""),
        display_hint: String(metadata.display_hint || "")
      };
    });
    return true;
  }

  function createWorkflowEmbeddedController(options = {}) {
    const session = options.session;
    const results = options.results;
    let dataArea = null;

    async function invalidateSteps(values) {
      const stepIds = uniqueStepIds(values);
      if (!stepIds.length) return;
      dataArea?.invalidateSteps(stepIds);
      try {
        await results.invalidateSteps({
          doc_session_id: session.getSnapshot().metadata.doc_session_id,
          step_ids: stepIds
        });
      } catch (error) {
        options.onError?.(error);
      }
    }

    const propertyContext = modules.createWorkflowPropertyContext({
      session,
      catalog: options.catalog,
      getHiddenBindings: options.getHiddenBindings,
      onInvalidation: invalidateSteps
    });
    dataArea = modules.createWorkflowDataAreaController({
      root: options.dataRoot,
      session,
      propertyContext,
      results,
      bridge: options.bridge,
      onError: options.onError
    });
    dataArea.setSelection();

    function selectionChanged(payload) {
      dataArea.setSelection();
      options.postEmbedded?.("selection", payload);
    }

    function commandCompleted(payload = {}) {
      const result = payload.result || {};
      void invalidateSteps([
        ...(result.invalidated_step_ids || []),
        ...(result.deleted_step_ids || [])
      ]);
    }

    function runStateChanged(detail) {
      dataArea.handleRunState(detail);
      options.postEmbedded?.("run-state", detail);
    }

    function bridgeEvent(event) {
      dataArea.handleBridgeEvent(event);
      session.handleBridgeEvent(event);
    }

    return Object.freeze({
      selectionChanged,
      commandCompleted,
      historyChanged: invalidateSteps,
      runStateChanged,
      bridgeEvent,
      documentLoaded: () => dataArea.documentLoaded(),
      getPropertyContext: () => propertyContext.getContext(),
      updateStep: (value) => propertyContext.updateStep(value),
      updateFlow: (value) => propertyContext.updateFlow(value),
      updateSchema: (value) => propertyContext.updateSchema(
        value?.step_id,
        value?.columns || []
      ),
      runStep: (stepId) => propertyContext.runStep(stepId)
    });
  }

  function createWorkflowEmbeddedApi(options = {}) {
    const session = options.session;
    const controller = options.controller;
    return Object.freeze({
      runFlow: () => session.startRun(),
      runStep: (stepId) => session.startRun({ step_id: stepId }),
      cancelRun: () => session.cancelRun(),
      saveFlow: options.saveDocument,
      importFlow: options.importDocument,
      addFlow(value) {
        const result = session.addFlow(value);
        options.scheduleFitView?.();
        return result;
      },
      undo: () => session.undo(),
      redo: () => session.redo(),
      setFlowName(name) {
        const normalized = text(name);
        if (!normalized) return false;
        session.setDocumentName(normalized);
        return true;
      },
      getFlowName: () => session.getDocumentName(),
      isRunning: () => session.isRunning(),
      isDirty: () => session.getSnapshot().dirty,
      getWorkspaceTabId: options.getWorkspaceTabId,
      getDocument: () => session.getSnapshot().document,
      getPropertyContext: () => controller.getPropertyContext(),
      mergeHiddenBindings: (value) => mergeHiddenBindings(
        options.getHiddenBindings(),
        value
      ),
      updateStep: (value) => controller.updateStep(value),
      updateFlow: (value) => controller.updateFlow(value),
      updateSchema: (value) => controller.updateSchema(value)
    });
  }

  modules.createWorkflowEmbeddedController =
    createWorkflowEmbeddedController;
  modules.createWorkflowEmbeddedApi = createWorkflowEmbeddedApi;
})(window);
