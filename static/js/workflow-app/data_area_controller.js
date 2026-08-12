(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__workflowAppModules =
    packages.__workflowAppModules || {};
  const support = modules.workflowDataAreaSupport;
  const { isUnavailable, text } = support;

  function createWorkflowDataAreaController(options = {}) {
    const session = options.session;
    const propertyContext = options.propertyContext;
    const results = options.results;
    const bridge = options.bridge;
    const runtime = modules.createWorkflowDataAreaRuntime({ results });
    let selectedContext = null;
    let requestSequence = 0;
    const view = modules.createWorkflowDataAreaView({
      root: options.root,
      onSchemaCommit(columns) {
        void commitSchema(columns);
      },
      onTabChange() {
        void refreshSelected();
      },
      onLoadOlderLogs() {
        void loadOlderLogs();
      }
    });
    function reportError(error) {
      options.onError?.(error);
    }

    function selectedStepId() {
      return selectedContext?.kind === "step"
        ? text(selectedContext.step?.step_id)
        : "";
    }
    function policy() {
      const value = text(selectedContext?.data_area_policy?.schema);
      return ["no_rename", "editable"].includes(value)
        ? value
        : "readonly";
    }
    function sourceSchemaStepId() {
      return support.sourceSchemaStepId(selectedContext, policy());
    }

    function stepIdsForFlow(flowId) {
      return support.stepIdsForFlow(
        session.getSnapshot().document,
        flowId
      );
    }
    function renderSchema() {
      if (!selectedContext || selectedContext.kind !== "step") return;
      const step = selectedContext.step || {};
      view.setSchema({
        policy: policy(),
        saved_columns: step?.schema?.columns || [],
        runtime_columns: runtime.getSchema(sourceSchemaStepId())
      });
    }

    function renderLogs(runId) {
      view.setLogs(runtime.getLogs(runId), runtime.getLogPage(runId));
    }

    function renderStatus() {
      const stepId = selectedStepId();
      if (!stepId) return;
      if (runtime.isInvalidated(stepId)) {
        view.setStatus("設定変更のため再実行が必要です。", "warning");
        return;
      }
      const status = runtime.getStatus(stepId);
      if (status === "running" || status === "queued") {
        view.setStatus("実行中", "running");
        return;
      }
      if (["error", "cancelled", "skipped"].includes(status)) {
        view.setStatus(
          status === "error" ? "実行エラー" : status,
          "error"
        );
        return;
      }
      const runId = results.getRunIdForStep(stepId);
      view.setStatus(
        runId ? `run ${runId}` : "未実行",
        runId ? "ready" : ""
      );
    }

    async function fetchSchema(stepId) {
      const runId = results.getRunIdForStep(stepId);
      if (!runId) return [];
      try {
        return await runtime.fetchSchema(stepId);
      } catch (error) {
        if (!isUnavailable(error)) throw error;
        return [];
      }
    }

    async function fetchPreview(stepId) {
      const runId = results.getRunIdForStep(stepId);
      if (!runId) {
        view.setPreview({ message: "未実行のため、データはありません。" });
        return;
      }
      try {
        const payload = await runtime.fetchPreview(stepId);
        view.setPreview(payload);
      } catch (error) {
        if (!isUnavailable(error)) throw error;
        const message = text(error?.code) === "E_RESULT_NOT_READY"
          ? "実行結果を準備しています。"
          : "表示できる表データがありません。";
        view.setPreview({ message });
      }
    }

    async function fetchLogs(runId) {
      if (!runId) {
        view.setLogs([]);
        return;
      }
      try {
        await runtime.fetchLogs(runId);
        renderLogs(runId);
      } catch (error) {
        if (!isUnavailable(error)) throw error;
        view.setLogs([]);
      }
    }

    async function refreshSelected() {
      const stepId = selectedStepId();
      if (!stepId) return;
      const sequence = ++requestSequence;
      try {
        await fetchSchema(sourceSchemaStepId());
        if (sequence !== requestSequence) return;
        renderSchema();
        const runId = results.getRunIdForStep(stepId);
        if (view.getActiveTab() === "output") await fetchPreview(stepId);
        if (view.getActiveTab() === "logs") await fetchLogs(runId);
        if (sequence !== requestSequence) return;
        renderStatus();
      } catch (error) {
        if (sequence === requestSequence) reportError(error);
      }
    }

    async function commitSchema(columns) {
      const stepId = selectedStepId();
      if (!stepId || policy() === "readonly") return;
      try {
        await propertyContext.updateSchema(stepId, columns);
        selectedContext = propertyContext.getContext();
        renderSchema();
        renderStatus();
      } catch (error) {
        reportError(error);
        selectedContext = propertyContext.getContext();
        renderSchema();
      }
    }

    async function loadOlderLogs() {
      const runId = results.getRunIdForStep(selectedStepId());
      const current = runtime.getLogPage(runId);
      if (!runId || !current.has_more_before || !current.next_before_seq) return;
      try {
        await runtime.loadOlderLogs(runId);
        renderLogs(runId);
      } catch (error) {
        reportError(error);
      }
    }

    function setSelection() {
      selectedContext = propertyContext.getContext();
      const visible = selectedContext.kind === "step";
      view.setVisible(visible);
      if (!visible) return;
      renderSchema();
      const cached = runtime.getPreview(selectedStepId());
      view.setPreview(cached || {
        message: "未実行のため、データはありません。"
      });
      renderStatus();
      void refreshSelected();
    }

    function bindRun(detail) {
      const response = detail?.response || detail || {};
      const runId = text(detail?.run_id || response.run_id);
      if (!runId) return;
      const stepId = text(detail?.step_id || response.step_id);
      const invalidStepIds = new Set(
        (response.invalidated_step_ids || []).map(text)
      );
      const boundStepIds = (stepId
        ? [stepId]
        : stepIdsForFlow(detail?.flow_id || response.flow_id))
        .filter((id) => !invalidStepIds.has(id));
      if (stepId) {
        results.bindStepRun({ run_id: runId, step_id: stepId });
      } else {
        results.bindFlowRun({ run_id: runId, step_ids: boundStepIds });
      }
      runtime.markValid(boundStepIds);
      runtime.invalidateSteps(Array.from(invalidStepIds));
      boundStepIds.forEach((id) => {
        runtime.setStatus(id, text(response.status) || "running");
      });
      if (!runtime.getLogs(runId).length) runtime.resetLogs(runId);
      renderStatus();
    }

    function handleRunState(detail = {}) {
      if (detail.running) {
        bindRun(detail);
        return;
      }
      void refreshSelected();
    }

    function handleBridgeEvent(event) {
      const message = event?.detail || {};
      const type = text(message.type);
      const payload = message.payload || {};
      const runId = text(payload.run_id);
      if (type === "run.log" && runId) {
        runtime.appendLog(runId, payload);
        if (
          view.getActiveTab() === "logs" &&
          results.getRunIdForStep(selectedStepId()) === runId
        ) renderLogs(runId);
      }
      if (type === "run.stepStatus") {
        runtime.setStatus(payload.step_id, payload.status);
      }
      if (
        type === "run.stepStatus" &&
        text(payload.step_id) === selectedStepId()
      ) {
        view.setStatus(
          text(payload.status) || "running",
          text(payload.status).toLowerCase()
        );
        if (text(payload.status).toLowerCase() === "success") {
          void refreshSelected();
        }
      }
      if (["run.completed", "run.failed", "run.cancelled"].includes(type)) {
        void refreshSelected();
      }
    }

    async function restoreRuns() {
      const docSessionId = session.getSnapshot().metadata.doc_session_id;
      if (!docSessionId || !bridge?.call) return;
      try {
        const status = await bridge.call("app.getStatus", {});
        (status?.run_index?.workflows || [])
          .filter((item) => text(item.doc_session_id) === text(docSessionId))
          .forEach((item) => bindRun(item));
        await refreshSelected();
      } catch (error) {
        reportError(error);
      }
    }

    return Object.freeze({
      view,
      setSelection,
      handleRunState,
      handleBridgeEvent,
      restoreRuns,
      documentLoaded() {
        results.clearRunBindings();
        runtime.reset();
        setSelection();
        void restoreRuns();
      },
      invalidateSteps(stepIds) {
        runtime.invalidateSteps(stepIds);
        selectedContext = propertyContext.getContext();
        renderSchema();
        renderStatus();
      }
    });
  }

  modules.createWorkflowDataAreaController =
    createWorkflowDataAreaController;
})(window);
