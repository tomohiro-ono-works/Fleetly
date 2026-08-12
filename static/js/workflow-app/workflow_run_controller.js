(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__workflowAppModules =
    packages.__workflowAppModules || {};

  function createWorkflowRunController(options = {}) {
    let activeRunId = "";
    let starting = false;
    let pendingEvents = [];
    let nodeStatus = {};

    function publishStatus() {
      options.onStatusChange?.({ ...nodeStatus });
    }

    function finish(type, payload) {
      if (String(payload?.run_id || "") !== activeRunId) return;
      const completedRunId = activeRunId;
      activeRunId = "";
      options.onRunState?.({
        running: false,
        run_id: completedRunId,
        terminal_type: type,
        payload
      });
      options.onStateChange?.(type);
    }

    function handleBridgeEvent(event) {
      const message = event?.detail || {};
      const type = String(message.type || "");
      const payload = message.payload || {};
      if (!activeRunId) {
        if (starting && pendingEvents.length < 200) pendingEvents.push(event);
        return;
      }
      if (String(payload.run_id || "") !== activeRunId) return;
      if (type === "run.stepStatus") {
        const stepId = String(payload.step_id || "");
        const incoming = String(payload.status || "").toLowerCase();
        nodeStatus = {
          ...nodeStatus,
          [modules.workflowNodeKey(stepId)]:
            incoming === "cancelled" ? "skipped" : incoming
        };
        publishStatus();
        return;
      }
      if (["run.completed", "run.failed", "run.cancelled"].includes(type)) {
        finish(type, payload);
      }
    }

    async function startRun(value = {}) {
      if (activeRunId || starting) {
        throw modules.createWorkflowAppError(
          "E_RUN_ACTIVE",
          "このdocumentは実行中です。"
        );
      }
      const snapshot = options.store.getSnapshot();
      const document = snapshot.document;
      const stepId = String(value.step_id || "").trim();
      const flowId = modules.resolveWorkflowFlowId(
        document,
        value.flow_id,
        stepId
      );
      if (!flowId) {
        throw modules.createWorkflowAppError(
          "E_FLOW_NOT_FOUND",
          "実行対象flowがありません。"
        );
      }
      const request = {
        doc_session_id: snapshot.metadata.doc_session_id,
        document_ref: snapshot.metadata.document_ref,
        mode: snapshot.metadata.mode,
        flow_id: flowId,
        document
      };
      starting = true;
      pendingEvents = [];
      try {
        const response = stepId
          ? await options.runs.startStep({ ...request, step_id: stepId })
          : await options.runs.startWorkflow(request);
        activeRunId = String(response?.run_id || "");
        nodeStatus = {};
        (document.steps || []).forEach((step) => {
          if (
            String(step?.flow_id || "") === flowId &&
            (!stepId || String(step?.step_id || "") === stepId)
          ) {
            nodeStatus[modules.workflowNodeKey(step.step_id)] = "running";
          }
        });
        publishStatus();
        options.onRunState?.({
          running: true,
          run_id: activeRunId,
          response
        });
        options.onStateChange?.("run-started");
        starting = false;
        pendingEvents.splice(0).forEach(handleBridgeEvent);
        return response;
      } catch (error) {
        starting = false;
        pendingEvents = [];
        options.onError?.(error);
        throw error;
      }
    }

    function cancelRun() {
      if (!activeRunId) return Promise.resolve({ cancelled: false });
      return options.runs.cancel({ run_id: activeRunId });
    }

    return Object.freeze({
      startRun,
      cancelRun,
      handleBridgeEvent,
      getNodeStatus: () => ({ ...nodeStatus }),
      getRunId: () => activeRunId,
      isRunning: () => !!activeRunId || starting,
      reset() {
        activeRunId = "";
        starting = false;
        pendingEvents = [];
        nodeStatus = {};
        publishStatus();
      }
    });
  }

  modules.createWorkflowRunController =
    createWorkflowRunController;
})(window);
