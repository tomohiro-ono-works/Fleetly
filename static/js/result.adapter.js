(function () {
  const COMMANDS = Object.freeze({
    getSummary: "result.getSummary",
    getSchema: "result.getSchema",
    getPreview: "result.getPreview",
    getLogs: "result.getLogs",
    invalidateSteps: "result.invalidateSteps"
  });
  const runIdByStep = new Map();

  function resolveBridge() {
    const local = window.zizPackages?.core?.bridge || null;
    const parent = window.parent && window.parent !== window
      ? (window.parent.zizPackages?.core?.bridge || null)
      : null;
    if (local?.available?.()) return local;
    if (parent?.available?.()) return parent;
    return local || parent;
  }

  function call(command, payload = {}) {
    const bridge = resolveBridge();
    if (!bridge || typeof bridge.call !== "function") {
      const error = new Error("result bridgeが利用できません。");
      error.code = "E_NOT_READY";
      return Promise.reject(error);
    }
    return bridge.call(command, payload);
  }

  function requireText(value, fieldName) {
    const text = String(value || "").trim();
    if (text) return text;
    const error = new Error(`${fieldName} は必須です。`);
    error.code = "E_VALIDATION";
    throw error;
  }

  function resolveRunId(payload = {}) {
    const explicit = String(payload.run_id || "").trim();
    if (explicit) return explicit;
    const stepId = String(payload.step_id || "").trim();
    const mapped = stepId ? String(runIdByStep.get(stepId) || "") : "";
    if (mapped) return mapped;
    const error = new Error("指定ステップの実行結果がありません。");
    error.code = "E_RESULT_NOT_FOUND";
    throw error;
  }

  function bindFlowRun({ run_id, step_ids } = {}) {
    const runId = requireText(run_id, "run_id");
    (Array.isArray(step_ids) ? step_ids : []).forEach((rawStepId) => {
      const stepId = String(rawStepId || "").trim();
      if (stepId) runIdByStep.set(stepId, runId);
    });
    return runId;
  }

  function bindStepRun({ run_id, step_id } = {}) {
    const runId = requireText(run_id, "run_id");
    const stepId = requireText(step_id, "step_id");
    runIdByStep.set(stepId, runId);
    return runId;
  }

  function getSummary(payload = {}) {
    return call(COMMANDS.getSummary, {
      run_id: requireText(payload.run_id, "run_id")
    });
  }

  function getSchema(payload = {}) {
    const stepId = requireText(payload.step_id, "step_id");
    return call(COMMANDS.getSchema, {
      run_id: resolveRunId({ ...payload, step_id: stepId }),
      step_id: stepId
    });
  }

  function getPreview(payload = {}) {
    const stepId = requireText(payload.step_id, "step_id");
    return call(COMMANDS.getPreview, {
      run_id: resolveRunId({ ...payload, step_id: stepId }),
      step_id: stepId
    });
  }

  function getLogs(payload = {}) {
    const request = {
      run_id: requireText(payload.run_id, "run_id")
    };
    if (payload.before_seq !== undefined) {
      request.before_seq = payload.before_seq;
    }
    if (payload.after_seq !== undefined) {
      request.after_seq = payload.after_seq;
    }
    return call(COMMANDS.getLogs, request);
  }

  function invalidateSteps(payload = {}) {
    const stepIds = Array.from(new Set(
      (Array.isArray(payload.step_ids) ? payload.step_ids : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    ));
    if (!stepIds.length) {
      return Promise.resolve({
        doc_session_id: String(payload.doc_session_id || ""),
        invalidated_step_ids: []
      });
    }
    stepIds.forEach((stepId) => runIdByStep.delete(stepId));
    return call(COMMANDS.invalidateSteps, {
      doc_session_id: requireText(payload.doc_session_id, "doc_session_id"),
      step_ids: stepIds
    });
  }

  function clearRunBindings() {
    runIdByStep.clear();
  }

  function getRunIdForStep(stepId) {
    return String(runIdByStep.get(String(stepId || "").trim()) || "");
  }

  window.zizPackages = window.zizPackages || {};
  window.zizPackages.app = window.zizPackages.app || {};
  window.zizPackages.app.results = Object.freeze({
    bindFlowRun,
    bindStepRun,
    clearRunBindings,
    getRunIdForStep,
    getSummary,
    getSchema,
    getPreview,
    getLogs,
    invalidateSteps
  });
})();
