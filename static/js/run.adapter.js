(function () {
  const COMMANDS = Object.freeze({
    start: "run.start",
    cancel: "run.cancel",
    status: "app.getStatus"
  });

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
      const error = new Error("run操作に必要なBridgeClientが初期化されていません。");
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

  function requireObject(value, fieldName) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value;
    }
    const error = new Error(`${fieldName} はオブジェクトで指定してください。`);
    error.code = "E_VALIDATION";
    throw error;
  }

  function assignOptionalText(target, fieldName, value) {
    const text = String(value || "").trim();
    if (text) target[fieldName] = text;
  }

  function startWorkflow(payload = {}) {
    const request = {
      doc_session_id: requireText(payload.doc_session_id, "doc_session_id"),
      flow_id: requireText(payload.flow_id, "flow_id"),
      document: requireObject(payload.document, "document")
    };
    assignOptionalText(request, "mode", payload.mode);
    assignOptionalText(request, "document_ref", payload.document_ref);
    assignOptionalText(request, "step_id", payload.step_id);
    return call(COMMANDS.start, request);
  }

  function startStep(payload = {}) {
    requireText(payload.step_id, "step_id");
    return startWorkflow(payload);
  }

  function startStandalone(payload = {}) {
    const request = {
      doc_session_id: requireText(payload.doc_session_id, "doc_session_id"),
      run_kind: "standalone",
      connector_id: requireText(payload.connector_id, "connector_id"),
      action_id: requireText(payload.action_id, "action_id"),
      result_mode: requireText(payload.result_mode, "result_mode"),
      dry_run: payload.dry_run === true,
      params: requireObject(payload.params, "params")
    };
    if (payload.result_export !== undefined && payload.result_export !== null) {
      request.result_export = requireObject(
        payload.result_export,
        "result_export"
      );
    }
    return call(COMMANDS.start, request);
  }

  function cancel(payload = {}) {
    return call(COMMANDS.cancel, {
      run_id: requireText(payload.run_id, "run_id")
    });
  }

  function getStatus() {
    return call(COMMANDS.status, {});
  }

  window.zizPackages = window.zizPackages || {};
  window.zizPackages.app = window.zizPackages.app || {};
  window.zizPackages.app.runs = Object.freeze({
    startWorkflow,
    startStep,
    startStandalone,
    cancel,
    getStatus
  });
})();
