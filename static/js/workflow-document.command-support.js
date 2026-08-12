(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__workflowDocumentCommandModules =
    packages.__workflowDocumentCommandModules || {};

  function cloneValue(value) {
    if (typeof root.structuredClone === "function") {
      return root.structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  }

  function createError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function text(value) {
    return String(value || "").trim();
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function asMap(value) {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  }

  function stepEntries(document) {
    return asArray(document?.steps).map((step, index) => ({
      step,
      index,
      id: text(step?.step_id)
    })).filter((entry) => entry.id);
  }

  function requireStep(document, stepId) {
    const id = text(stepId);
    const entry = stepEntries(document).find((item) => item.id === id);
    if (!entry) {
      throw createError("E_STEP_NOT_FOUND", `step '${id}'が存在しません。`);
    }
    return entry;
  }

  function collectIds(document, kind) {
    if (kind === "step") {
      return stepEntries(document).map((entry) => entry.id);
    }
    if (kind === "flow") {
      return Object.keys(asMap(document?.flows));
    }
    if (kind === "note") {
      return asArray(document?.notes)
        .map((note) => text(note?.note_id))
        .filter(Boolean);
    }
    throw createError("E_ID_KIND_INVALID", `未対応のID種別です: ${kind}`);
  }

  function numericId(value) {
    const id = text(value);
    if (!/^(?:0*[1-9]\d*)$/.test(id)) return 0;
    const number = Number(id);
    return Number.isSafeInteger(number) ? number : 0;
  }

  function createIdAllocator(customAllocator, initialDocument) {
    const kinds = ["step", "flow", "note"];
    const issued = new Map(kinds.map((kind) => [kind, new Set()]));
    const highWater = new Map(kinds.map((kind) => [kind, 0]));

    function observe(document) {
      kinds.forEach((kind) => {
        collectIds(document, kind).forEach((id) => {
          issued.get(kind).add(id);
          highWater.set(kind, Math.max(highWater.get(kind), numericId(id)));
        });
      });
    }

    function allocate(request = {}) {
      const kind = text(request.idKind);
      const count = Number(request.count);
      if (!kinds.includes(kind) || !Number.isInteger(count) || count < 1) {
        throw createError("E_ID_REQUEST_INVALID", "ID発番要求が不正です。");
      }
      const document = request.document || {};
      observe(document);
      let values;
      if (typeof customAllocator === "function") {
        values = customAllocator({
          idKind: kind,
          document: cloneValue(document),
          count
        });
        if (values && typeof values.then === "function") {
          throw createError("E_ID_REQUEST_INVALID", "ID発番は同期処理が必要です。");
        }
      } else {
        values = [];
        let candidate = highWater.get(kind);
        while (values.length < count) {
          candidate += 1;
          values.push(String(candidate).padStart(2, "0"));
        }
      }
      if (!Array.isArray(values) || values.length !== count) {
        throw createError("E_ID_INVALID", `${kind} IDの発番件数が不正です。`);
      }
      const normalized = values.map(text);
      const existing = new Set([
        ...collectIds(document, kind),
        ...issued.get(kind)
      ]);
      if (
        normalized.some((id) => !numericId(id) || existing.has(id)) ||
        new Set(normalized).size !== normalized.length
      ) {
        throw createError("E_ID_INVALID", `${kind} IDが重複または不正です。`);
      }
      normalized.forEach((id) => {
        issued.get(kind).add(id);
        highWater.set(kind, Math.max(highWater.get(kind), numericId(id)));
      });
      return normalized;
    }

    observe(initialDocument || {});
    return Object.freeze({ allocate, observe });
  }

  function requireAction(catalog, connectorId, actionId) {
    const connector = text(connectorId);
    const action = text(actionId);
    const found = asArray(catalog?.actions?.[connector])
      .find((item) => text(item?.id) === action);
    if (!found) {
      throw createError(
        "E_CATALOG_ACTION_NOT_FOUND",
        `${connector}.${action}がcatalogに存在しません。`
      );
    }
    return found;
  }

  function resolveNode(document, value) {
    const nodeId = text(value?.node_id);
    if (!nodeId) {
      throw createError("E_NODE_REF_INVALID", "node_idは必須です。");
    }
    const graphScope = text(value?.graph_scope);
    const flowId = text(value?.flow_id);
    const loopOwnerId = text(value?.loop_owner_id);
    if (nodeId === "START" || nodeId === "END") {
      if (graphScope === "unassigned") {
        if (nodeId !== "START" || !document?.unassigned) {
          throw createError("E_NODE_REF_INVALID", "未所属graphのnode参照が不正です。");
        }
        return { kind: "terminal", id: nodeId, scope: { kind: "unassigned" } };
      }
      if (loopOwnerId) {
        requireStep(document, loopOwnerId);
        return {
          kind: "terminal",
          id: nodeId,
          scope: { kind: "loop", id: loopOwnerId }
        };
      }
      if (!flowId || !asMap(document?.flows)[flowId]) {
        throw createError("E_NODE_REF_INVALID", "START／ENDには有効なflow_idが必要です。");
      }
      return { kind: "terminal", id: nodeId, scope: { kind: "flow", id: flowId } };
    }

    const entry = requireStep(document, nodeId);
    const stepFlowId = text(entry.step?.flow_id);
    const ownerId = text(entry.step?.loop_owner_id);
    const unassignedIds = new Set(asArray(document?.unassigned?.step_ids).map(text));
    let scope;
    if (ownerId) scope = { kind: "loop", id: ownerId };
    else if (stepFlowId) scope = { kind: "flow", id: stepFlowId };
    else if (unassignedIds.has(nodeId)) scope = { kind: "unassigned" };
    else {
      throw createError("E_NODE_REF_INVALID", `step '${nodeId}'のgraph所属が不正です。`);
    }
    if (
      (flowId && flowId !== stepFlowId) ||
      (loopOwnerId && loopOwnerId !== ownerId) ||
      (graphScope && graphScope !== scope.kind)
    ) {
      throw createError("E_NODE_REF_INVALID", `step '${nodeId}'のscopeが一致しません。`);
    }
    return { kind: "step", id: nodeId, scope, entry };
  }

  Object.assign(modules, {
    asArray,
    asMap,
    cloneValue,
    createError,
    createIdAllocator,
    requireAction,
    requireStep,
    resolveNode,
    stepEntries,
    text
  });
})(window);
