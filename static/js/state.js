window.stateOps = {
  createDefaultState() {
    const first = createDefaultNode();
    first.stepName = "step1";
    first.parentId = null; // child of "開始"
    first.parallelOf = null;
    first.parallelOrder = 1;
    return { version: 3, nodes: [first], selectedNodeId: first.id, nextStepSeq: 2 };
  },

  addNodeAfter(state, index) {
    const anchor = state.nodes[index];
    if (!anchor) return;
    insertAtAnchor(state, anchor.id);
    refreshParallelOfForParent(state, anchor.id);
  },

  insertNodeAt(state) {
    // Insert from "開始"
    insertAtAnchor(state, null);
    refreshParallelOfForParent(state, null);
  },

  addParallelAfter(state, index, options = {}) {
    const source = state.nodes[index];
    if (!source) return;

    const anchorId = normalizeAnchorId(options.parentId, source.parentId);
    if (anchorId === undefined) return;
    addParallelAtAnchor(state, anchorId);
    refreshParallelOfForParent(state, anchorId);
  },

  removeNode(state, index) {
    if (state.nodes.length <= 1) return;
    const target = state.nodes[index];
    if (!target) return;

    const parentId = target.parentId ?? null;
    const children = getChildren(state, target.id);
    const targetOrder = Number(target.parallelOrder) || 1;

    // Promote direct children under removed node's parent.
    children.forEach((child, idx) => {
      child.parentId = parentId;
      child.parallelOrder = targetOrder + idx;
      child.parallelOf = null;
    });

    // Shift remaining sibling orders down by one.
    state.nodes.forEach((n) => {
      if ((n.parentId ?? null) !== parentId) return;
      const order = Number(n.parallelOrder) || 1;
      if (n.id !== target.id && order > targetOrder) n.parallelOrder = order - 1;
    });

    // Remove target itself.
    state.nodes = state.nodes.filter((n) => n.id !== target.id);

    // Normalize stale relation refs.
    const idSet = new Set(state.nodes.map((n) => n.id));
    state.nodes.forEach((n) => {
      if (n.parentId && !idSet.has(n.parentId)) n.parentId = null;
      if (n.parallelOf && !idSet.has(n.parallelOf)) n.parallelOf = null;
    });

    refreshParallelOfForParent(state, parentId);
    children.forEach((child) => refreshParallelOfForParent(state, child.id));

    if (state.selectedNodeId === target.id) {
      const fallback = state.nodes[Math.min(index, state.nodes.length - 1)];
      state.selectedNodeId = fallback ? fallback.id : null;
    }
  },

  setSelectedNode(state, nodeId) {
    state.selectedNodeId = nodeId;
  }
};

function insertAtAnchor(state, anchorId) {
  const right = getFirstChild(state, anchorId);
  const newNode = createNewNode(allocateStepName(state));
  newNode.parentId = anchorId;

  if (!right) {
    const nextOrder = getNextChildOrder(state, anchorId);
    newNode.parallelOrder = nextOrder;
    newNode.parallelOf = null;
    state.nodes.push(newNode);
    state.selectedNodeId = newNode.id;
    return;
  }

  // Insert between anchor -> right  => anchor -> new -> right
  const rightOrder = Number(right.parallelOrder) || 1;
  newNode.parallelOrder = rightOrder;
  newNode.parallelOf = null;

  // Shift right-side siblings at anchor down one order.
  state.nodes.forEach((n) => {
    if ((n.parentId ?? null) !== (anchorId ?? null)) return;
    const order = Number(n.parallelOrder) || 1;
    if (order > rightOrder) n.parallelOrder = order + 1;
  });

  // Re-parent right subtree root under new node.
  right.parentId = newNode.id;
  right.parallelOrder = 1;
  right.parallelOf = null;

  // Other former siblings remain under anchor.
  const anchorChildren = getChildren(state, anchorId).filter((n) => n.id !== right.id);
  anchorChildren.forEach((child, idx) => {
    const order = Number(child.parallelOrder) || idx + 1;
    child.parallelOrder = order >= rightOrder ? order + 1 : order;
  });

  state.nodes.push(newNode);
  state.selectedNodeId = newNode.id;
  refreshParallelOfForParent(state, anchorId);
  refreshParallelOfForParent(state, newNode.id);
}

function addParallelAtAnchor(state, anchorId) {
  const right = getFirstChild(state, anchorId);
  if (!right) return;

  const newNode = createNewNode(allocateStepName(state));
  newNode.parentId = anchorId;
  newNode.parallelOrder = getNextChildOrder(state, anchorId);
  newNode.parallelOf = right.id;

  state.nodes.push(newNode);
  state.selectedNodeId = newNode.id;
  refreshParallelOfForParent(state, anchorId);
}

function getFirstChild(state, parentId) {
  const children = getChildren(state, parentId);
  return children.length ? children[0] : null;
}

function getFirstChildId(state, parentId, excludeId) {
  const children = getChildren(state, parentId).filter((n) => n.id !== excludeId);
  return children.length ? children[0].id : null;
}

function getChildren(state, parentId) {
  return state.nodes
    .filter((n) => (n.parentId ?? null) === (parentId ?? null))
    .sort((a, b) => {
      const ao = Number(a.parallelOrder) || 1;
      const bo = Number(b.parallelOrder) || 1;
      if (ao !== bo) return ao - bo;
      return 0;
    });
}

function getNextChildOrder(state, parentId) {
  const children = getChildren(state, parentId);
  if (!children.length) return 1;
  return (Number(children[children.length - 1].parallelOrder) || 1) + 1;
}

function refreshParallelOfForParent(state, parentId) {
  const children = getChildren(state, parentId);
  if (!children.length) return;
  const first = children[0];
  first.parallelOf = null;
  first.parallelOrder = 1;
  for (let i = 1; i < children.length; i += 1) {
    children[i].parallelOf = first.id;
    children[i].parallelOrder = i + 1;
  }
}

function normalizeAnchorId(parentId, fallbackParentId) {
  if (parentId === "__start__") return null;
  if (parentId === undefined || parentId === null || parentId === "") return fallbackParentId ?? null;
  return parentId;
}

function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `node_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function getConfigObject() {
  return window.CONFIG || {};
}

function getDefaultConnectorId() {
  const cfg = getConfigObject();
  const connectors = Array.isArray(cfg.connectors) ? cfg.connectors : [];
  return connectors[0]?.id || "";
}

function getDefaultActionId(connectorId) {
  const cfg = getConfigObject();
  const byConnector = (cfg.actions && connectorId) ? cfg.actions[connectorId] : null;
  const actions = Array.isArray(byConnector) ? byConnector : [];
  return actions[0]?.id || "";
}

function createDefaultNode() {
  const connectorId = getDefaultConnectorId();
  const actionId = getDefaultActionId(connectorId);
  return {
    id: createId(),
    connector: connectorId,
    action: actionId,
    form: {},
    parentId: null,
    parallelOf: null,
    parallelOrder: 1,
    outputs: ["step1"]
  };
}

function createNewNode(stepName) {
  const connectorId = getDefaultConnectorId();
  const actionId = getDefaultActionId(connectorId);
  return {
    id: createId(),
    stepName: stepName || "",
    connector: connectorId,
    action: actionId,
    form: {},
    parentId: null,
    parallelOf: null,
    parallelOrder: 1,
    outputs: []
  };
}

function allocateStepName(state) {
  const current = Number(state.nextStepSeq) || inferNextStepSeq(state);
  state.nextStepSeq = current + 1;
  return `step${current}`;
}

function inferNextStepSeq(state) {
  let max = 0;
  state.nodes.forEach((node) => {
    const m = String(node.stepName || "").match(/^step(\d+)$/);
    if (!m) return;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  });
  return max + 1;
}
