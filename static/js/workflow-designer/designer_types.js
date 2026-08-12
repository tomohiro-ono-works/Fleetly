(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__workflowDesignerModules =
    packages.__workflowDesignerModules || {};

  const EMPTY_SELECTION = Object.freeze({
    nodes: Object.freeze([]),
    edges: Object.freeze([]),
    annotation_ids: Object.freeze([])
  });

  function cloneValue(value, seen = new WeakMap()) {
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) return seen.get(value);
    if (Array.isArray(value)) {
      const copy = [];
      seen.set(value, copy);
      value.forEach((item) => copy.push(cloneValue(item, seen)));
      return copy;
    }
    const copy = {};
    seen.set(value, copy);
    Object.keys(value).forEach((key) => {
      copy[key] = cloneValue(value[key], seen);
    });
    return copy;
  }

  function asFiniteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function normalizePosition(value, fallback = { x: 0, y: 0 }) {
    return {
      x: asFiniteNumber(value?.x, fallback.x),
      y: asFiniteNumber(value?.y, fallback.y)
    };
  }

  function normalizeViewport(value) {
    const zoom = asFiniteNumber(value?.zoom, 1);
    return {
      x: asFiniteNumber(value?.x, 0),
      y: asFiniteNumber(value?.y, 0),
      zoom: Math.min(2.5, Math.max(0.25, zoom))
    };
  }

  function normalizeNodeRef(value) {
    if (!value || typeof value !== "object") return null;
    const nodeId = String(value.node_id || "").trim();
    if (!nodeId) return null;
    const ref = { node_id: nodeId };
    const flowId = String(value.flow_id || "").trim();
    const loopOwnerId = String(value.loop_owner_id || "").trim();
    const graphScope = String(value.graph_scope || "").trim();
    if (flowId) ref.flow_id = flowId;
    if (loopOwnerId) ref.loop_owner_id = loopOwnerId;
    if (graphScope) ref.graph_scope = graphScope;
    return ref;
  }

  function normalizeEdgeRef(value) {
    if (!value || typeof value !== "object") return null;
    const from = String(value.from || "").trim();
    const to = String(value.to || "").trim();
    if (!from || !to) return null;
    const ref = { from, to };
    const flowId = String(value.flow_id || "").trim();
    const loopOwnerId = String(value.loop_owner_id || "").trim();
    const graphScope = String(value.graph_scope || "").trim();
    if (flowId) ref.flow_id = flowId;
    if (loopOwnerId) ref.loop_owner_id = loopOwnerId;
    if (graphScope) ref.graph_scope = graphScope;
    if (!flowId && !loopOwnerId && !graphScope) return null;
    return ref;
  }

  function nodeRefKey(value) {
    const ref = normalizeNodeRef(value);
    if (!ref) return "";
    if (ref.graph_scope) return `${ref.graph_scope}:node:${ref.node_id}`;
    if (ref.loop_owner_id) {
      return `loop:${ref.loop_owner_id}:node:${ref.node_id}`;
    }
    if (ref.flow_id) return `flow:${ref.flow_id}:node:${ref.node_id}`;
    return `step:${ref.node_id}`;
  }

  function edgeRefKey(value) {
    const ref = normalizeEdgeRef(value);
    if (!ref) return "";
    if (ref.graph_scope) {
      return `${ref.graph_scope}:edge:${ref.from}:${ref.to}`;
    }
    if (ref.loop_owner_id) {
      return `loop:${ref.loop_owner_id}:edge:${ref.from}:${ref.to}`;
    }
    return `flow:${ref.flow_id}:edge:${ref.from}:${ref.to}`;
  }

  function uniqueBy(items, keySelector) {
    const seen = new Set();
    return items.filter((item) => {
      const key = keySelector(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function normalizeSelection(value) {
    if (!value || typeof value !== "object") {
      return cloneValue(EMPTY_SELECTION);
    }
    const nodes = uniqueBy(
      (Array.isArray(value.nodes) ? value.nodes : [])
        .map(normalizeNodeRef)
        .filter(Boolean),
      nodeRefKey
    );
    const edges = uniqueBy(
      (Array.isArray(value.edges) ? value.edges : [])
        .map(normalizeEdgeRef)
        .filter(Boolean),
      edgeRefKey
    );
    const annotationIds = uniqueBy(
      (Array.isArray(value.annotation_ids) ? value.annotation_ids : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean),
      (item) => item
    );
    return {
      nodes,
      edges,
      annotation_ids: annotationIds
    };
  }

  function normalizeStatus(value) {
    const status = value && typeof value === "object" ? value : {};
    const nodeStatus = {};
    const allowed = new Set([
      "idle",
      "running",
      "success",
      "error",
      "skipped"
    ]);
    Object.entries(status.nodeStatus || {}).forEach(([key, raw]) => {
      const normalized = String(raw || "").trim().toLowerCase();
      if (allowed.has(normalized)) nodeStatus[String(key)] = normalized;
    });

    const validation = {};
    Object.entries(status.validation || {}).forEach(([key, entries]) => {
      const normalized = (Array.isArray(entries) ? entries : [])
        .map((entry) => {
          const level = String(entry?.level || "").trim().toLowerCase();
          const message = String(entry?.message || "").trim();
          if (!message || !["warning", "error"].includes(level)) return null;
          return { level, message };
        })
        .filter(Boolean);
      if (normalized.length) validation[String(key)] = normalized;
    });
    return { nodeStatus, validation };
  }

  function sameValue(left, right) {
    if (left === right) return true;
    if (!left || !right || typeof left !== "object" || typeof right !== "object") {
      return false;
    }
    if (Array.isArray(left) !== Array.isArray(right)) return false;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key) => (
      Object.prototype.hasOwnProperty.call(right, key) &&
      sameValue(left[key], right[key])
    ));
  }

  modules.cloneValue = cloneValue;
  modules.asFiniteNumber = asFiniteNumber;
  modules.normalizePosition = normalizePosition;
  modules.normalizeViewport = normalizeViewport;
  modules.normalizeNodeRef = normalizeNodeRef;
  modules.normalizeEdgeRef = normalizeEdgeRef;
  modules.nodeRefKey = nodeRefKey;
  modules.edgeRefKey = edgeRefKey;
  modules.normalizeSelection = normalizeSelection;
  modules.normalizeStatus = normalizeStatus;
  modules.sameValue = sameValue;
})(window);
