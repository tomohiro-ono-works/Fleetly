(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__workflowAppModules =
    packages.__workflowAppModules || {};

  function text(value) {
    return String(value || "").trim();
  }

  function isUnavailable(error) {
    return [
      "E_RUN_NOT_FOUND",
      "E_RESULT_NOT_FOUND",
      "E_RESULT_NOT_READY"
    ].includes(text(error?.code));
  }

  function sourceSchemaStepId(context, policy) {
    const step = context?.step || {};
    if (policy !== "editable") return text(step.step_id);
    const source = text(
      step?.params?.input_data || step?.params?.source_step_id
    );
    const braces = source.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
    return text(braces ? braces[1] : source) || text(step.step_id);
  }

  function stepIdsForFlow(document, flowId) {
    return (document?.steps || [])
      .filter((step) => text(step?.flow_id) === text(flowId))
      .map((step) => text(step.step_id))
      .filter(Boolean);
  }

  function createWorkflowDataAreaRuntime(options = {}) {
    const results = options.results;
    const schemas = new Map();
    const previews = new Map();
    const logs = new Map();
    const logPages = new Map();
    const invalidated = new Set();
    const statuses = new Map();

    async function fetchSchema(stepId) {
      const runId = results.getRunIdForStep(stepId);
      if (!runId) return [];
      const payload = await results.getSchema({ run_id: runId, step_id: stepId });
      const columns = Array.isArray(payload?.columns) ? payload.columns : [];
      schemas.set(stepId, columns);
      return columns;
    }

    async function fetchPreview(stepId) {
      const runId = results.getRunIdForStep(stepId);
      if (!runId) return null;
      const payload = await results.getPreview({ run_id: runId, step_id: stepId });
      previews.set(stepId, payload);
      return payload;
    }

    async function fetchLogs(runId) {
      if (!runId) return [];
      const payload = await results.getLogs({ run_id: runId });
      logs.set(runId, payload?.items || []);
      logPages.set(runId, payload || {});
      return payload;
    }

    async function loadOlderLogs(runId) {
      const current = logPages.get(runId) || {};
      if (!runId || !current.has_more_before || !current.next_before_seq) {
        return null;
      }
      const payload = await results.getLogs({
        run_id: runId,
        before_seq: current.next_before_seq
      });
      const merged = new Map(
        [...(payload?.items || []), ...(logs.get(runId) || [])]
          .map((item) => [Number(item.log_seq), item])
      );
      logs.set(
        runId,
        Array.from(merged.values()).sort(
          (left, right) => Number(left.log_seq) - Number(right.log_seq)
        )
      );
      logPages.set(runId, {
        ...payload,
        has_more_after: current.has_more_after
      });
      return payload;
    }

    function appendLog(runId, payload) {
      if (!runId) return;
      const items = logs.get(runId) || [];
      if (!items.some((item) => item.log_seq === payload.log_seq)) {
        items.push(payload);
        logs.set(runId, items);
      }
    }

    function clearSteps(stepIds) {
      (stepIds || []).forEach((value) => {
        const stepId = text(value);
        schemas.delete(stepId);
        previews.delete(stepId);
      });
    }

    return Object.freeze({
      fetchSchema,
      fetchPreview,
      fetchLogs,
      loadOlderLogs,
      appendLog,
      clearSteps,
      getSchema: (stepId) => schemas.get(stepId) || [],
      getPreview: (stepId) => previews.get(stepId) || null,
      getLogs: (runId) => logs.get(runId) || [],
      getLogPage: (runId) => logPages.get(runId) || {},
      getStatus: (stepId) => statuses.get(stepId) || "",
      isInvalidated: (stepId) => invalidated.has(stepId),
      markValid(stepIds) {
        (stepIds || []).forEach((stepId) => {
          invalidated.delete(text(stepId));
          statuses.delete(text(stepId));
        });
        clearSteps(stepIds);
      },
      invalidateSteps(stepIds) {
        (stepIds || []).forEach((stepId) => {
          invalidated.add(text(stepId));
          statuses.set(text(stepId), "invalidated");
        });
        clearSteps(stepIds);
      },
      setStatus(stepId, status) {
        const id = text(stepId);
        if (id) statuses.set(id, text(status).toLowerCase());
      },
      resetLogs(runId) {
        logs.set(runId, []);
        logPages.set(runId, {});
      },
      reset() {
        schemas.clear();
        previews.clear();
        logs.clear();
        logPages.clear();
        invalidated.clear();
        statuses.clear();
      }
    });
  }

  modules.createWorkflowDataAreaRuntime =
    createWorkflowDataAreaRuntime;
  modules.workflowDataAreaSupport = Object.freeze({
    isUnavailable,
    sourceSchemaStepId,
    stepIdsForFlow,
    text
  });
})(window);
