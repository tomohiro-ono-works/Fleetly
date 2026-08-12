(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__workflowAppModules =
    packages.__workflowAppModules || {};

  function cloneValue(value) {
    if (typeof root.structuredClone === "function") {
      return root.structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value ?? null));
  }

  function createError(code, message) {
    const error = new Error(String(message || ""));
    error.code = String(code || "E_WORKFLOW_DOCUMENT");
    return error;
  }

  function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function createEmptyDocument(catalog, modeId = "dataflow") {
    const mode = catalog?.modes?.[modeId] || {};
    return {
      metadata: {
        mode: modeId,
        name: String(mode.defaultFlowName || "データフロー")
      },
      steps: [],
      flows: {},
      loop: { flows: {} },
      notes: []
    };
  }

  function assertCanonicalDocument(document) {
    if (!isObject(document)) {
      throw createError(
        "E_DOCUMENT_FORMAT",
        "documentはオブジェクトで指定してください。"
      );
    }
    if (!isObject(document.metadata)) {
      throw createError(
        "E_DOCUMENT_FORMAT",
        "metadataはオブジェクトで指定してください。"
      );
    }
    if (String(document.metadata.mode || "") !== "dataflow") {
      throw createError(
        "E_DOCUMENT_MODE",
        "202607 workflow documentのmodeはdataflowである必要があります。"
      );
    }
    if (!Array.isArray(document.steps)) {
      throw createError(
        "E_DOCUMENT_FORMAT",
        "stepsは配列で指定してください。"
      );
    }
    if (!isObject(document.flows)) {
      throw createError(
        "E_DOCUMENT_FORMAT",
        "flowsはflow_idをkeyとするオブジェクトで指定してください。"
      );
    }
    if (Object.prototype.hasOwnProperty.call(document.flows, "edges")) {
      throw createError(
        "E_LEGACY_DOCUMENT",
        "旧single-flow形式のflows.edgesは読み込めません。"
      );
    }
    document.steps.forEach((step, index) => {
      if (!isObject(step)) {
        throw createError(
          "E_DOCUMENT_FORMAT",
          `steps[${index}]はオブジェクトで指定してください。`
        );
      }
      if (
        Object.prototype.hasOwnProperty.call(step, "connector") ||
        Object.prototype.hasOwnProperty.call(step, "action") ||
        Object.prototype.hasOwnProperty.call(step, "output_variable") ||
        isObject(step.params) &&
          Object.prototype.hasOwnProperty.call(step.params, "schema")
      ) {
        throw createError(
          "E_LEGACY_DOCUMENT",
          `steps[${index}]に旧形式fieldが含まれています。`
        );
      }
    });
    Object.entries(document.flows).forEach(([flowId, flow]) => {
      if (
        !flowId ||
        !isObject(flow) ||
        !isObject(flow.start) ||
        !isObject(flow.end) ||
        !Array.isArray(flow.edges)
      ) {
        throw createError(
          "E_DOCUMENT_FORMAT",
          `flows.${flowId || "<empty>"}の構造が不正です。`
        );
      }
    });
    return cloneValue(document);
  }

  function nodeKey(nodeId, flowId = "") {
    const id = String(nodeId || "").trim();
    if (id === "START" || id === "END") {
      return `flow:${String(flowId || "")}:node:${id}`;
    }
    return `step:${id}`;
  }

  function addValidation(validation, key, message) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) return;
    validation[normalizedKey] = validation[normalizedKey] || [];
    validation[normalizedKey].push({
      level: "error",
      message: String(message || "")
    });
  }

  function collectValidation(document) {
    const validation = {};
    const stepById = new Map();
    (document.steps || []).forEach((step, index) => {
      const stepId = String(step?.step_id || "").trim();
      const flowId = String(step?.flow_id || "").trim();
      const key = nodeKey(stepId || `missing-${index}`);
      if (!stepId) {
        addValidation(validation, key, "step_idが未設定です。");
        return;
      }
      if (stepById.has(stepId)) {
        addValidation(validation, key, `step_id '${stepId}'が重複しています。`);
      }
      stepById.set(stepId, step);
      if (!flowId && !String(step?.loop_owner_id || "").trim()) {
        addValidation(validation, key, "flow_idが未設定です。");
      } else if (flowId && !document.flows[flowId]) {
        addValidation(
          validation,
          key,
          `flow_id '${flowId}'の参照先がありません。`
        );
      }
      if (!String(step?.connector_id || "").trim()) {
        addValidation(validation, key, "connector_idが未設定です。");
      }
      if (!String(step?.action_id || "").trim()) {
        addValidation(validation, key, "action_idが未設定です。");
      }
    });

    Object.entries(document.flows || {}).forEach(([flowId, flow]) => {
      const allowed = new Set(["START", "END"]);
      stepById.forEach((step, stepId) => {
        if (
          String(step?.flow_id || "") === flowId &&
          !String(step?.loop_owner_id || "").trim()
        ) {
          allowed.add(stepId);
        }
      });
      (flow.edges || []).forEach((edge) => {
        const from = String(edge?.from || "").trim();
        const to = String(edge?.to || "").trim();
        if (!allowed.has(from)) {
          addValidation(
            validation,
            nodeKey("START", flowId),
            `edge.from '${from}'の参照先がありません。`
          );
        }
        if (!allowed.has(to)) {
          addValidation(
            validation,
            nodeKey("END", flowId),
            `edge.to '${to}'の参照先がありません。`
          );
        }
      });
    });
    return validation;
  }

  function resolveFlowId(document, requestedFlowId = "", stepId = "") {
    const requested = String(requestedFlowId || "").trim();
    if (requested && document.flows?.[requested]) return requested;
    const step = (document.steps || []).find(
      (item) => String(item?.step_id || "") === String(stepId || "")
    );
    const stepFlowId = String(step?.flow_id || "").trim();
    if (stepFlowId && document.flows?.[stepFlowId]) return stepFlowId;
    const defaultFlowId = String(
      document.metadata?.default_flow_id || ""
    ).trim();
    if (defaultFlowId && document.flows?.[defaultFlowId]) {
      return defaultFlowId;
    }
    return Object.keys(document.flows || {})[0] || "";
  }

  function documentName(document) {
    return String(document?.metadata?.name || "").trim() || "データフロー";
  }

  function safeFileName(document) {
    const name = documentName(document)
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/[. ]+$/g, "")
      .trim();
    return `${name || "データフロー"}.zizd`;
  }

  Object.assign(modules, {
    assertCanonicalDocument,
    cloneValue,
    collectDocumentValidation: collectValidation,
    createEmptyWorkflowDocument: createEmptyDocument,
    createWorkflowAppError: createError,
    workflowDocumentName: documentName,
    workflowFileName: safeFileName,
    workflowNodeKey: nodeKey,
    resolveWorkflowFlowId: resolveFlowId
  });
})(window);
