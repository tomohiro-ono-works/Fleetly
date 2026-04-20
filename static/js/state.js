const stateOps = {
  createDefaultState(options = {}) {
    const appMode = normalizeAppMode(typeof options === "string" ? options : options?.appMode);
    const first = createDefaultNode(appMode);
    first.stepName = "step1";
    first.parentId = null; // child of "開始"
    first.parallelOf = null;
    first.parallelOrder = 1;
    return {
      version: 3,
      appMode,
      flowName: getDefaultFlowName(appMode),
      nodes: [first],
      stickyNotes: [],
      startParameters: [],
      selectedNodeId: first.id,
      pendingMergeSourceId: null,
      nextStepSeq: 2
    };
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

  duplicateNodeAfter(state, nodeId, payload) {
    const targetIndex = state.nodes.findIndex((node) => node.id === nodeId);
    if (targetIndex < 0 || !payload || typeof payload !== "object") return false;
    const target = state.nodes[targetIndex];
    if (!target || isLoopRootStateNode(target) || target.loopOwnerId) return false;

    const beforeIds = new Set(state.nodes.map((node) => node.id));
    const anchor = state.nodes[targetIndex];
    if (!anchor) return false;
    insertAtAnchor(state, anchor.id);
    refreshParallelOfForParent(state, anchor.id);
    const newNode = state.nodes.find((node) => !beforeIds.has(node.id));
    if (!newNode) return false;

    newNode.connector = String(payload.connector || newNode.connector || "");
    newNode.action = String(payload.action || newNode.action || "");
    newNode.description = typeof payload.description === "string" ? payload.description : "";
    newNode.descriptionAuto = payload.descriptionAuto !== undefined ? !!payload.descriptionAuto : true;
    newNode.form = cloneStateValue(payload.form) || {};
    return true;
  },

  moveNodeToInsert(state, nodeId, options = {}) {
    const anchorId = normalizeAnchorId(options.anchorId, null);
    const rightId = options.rightId ?? null;
    if (!canMoveNodeToTarget(state, nodeId, { anchorId, rightId, kind: "insert" })) return false;

    const movingNode = extractNodeForMove(state, nodeId);
    if (!movingNode) return false;

    insertExistingNodeAtAnchor(state, movingNode, anchorId, rightId);
    state.selectedNodeId = movingNode.id;
    return true;
  },

  moveNodeToParallel(state, nodeId, options = {}) {
    const anchorId = normalizeAnchorId(options.anchorId, null);
    const rightId = options.rightId ?? null;
    if (!canMoveNodeToTarget(state, nodeId, { anchorId, rightId, kind: "parallel" })) return false;

    const movingNode = extractNodeForMove(state, nodeId);
    if (!movingNode) return false;

    addExistingParallelAtAnchor(state, movingNode, anchorId, rightId);
    state.selectedNodeId = movingNode.id;
    return true;
  },

  removeNode(state, index) {
    if (state.nodes.length <= 1) return;
    const target = state.nodes[index];
    if (!target) return;
    if (isLoopRootStateNode(target)) {
      removeLoopRootNode(state, target, index);
      return;
    }

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
      n.mergeParentIds = getValidMergeParentIds(n, idSet);
    });
    if (state.pendingMergeSourceId && !idSet.has(state.pendingMergeSourceId)) {
      state.pendingMergeSourceId = null;
    }

    refreshParallelOfForParent(state, parentId);
    children.forEach((child) => refreshParallelOfForParent(state, child.id));

    if (state.selectedNodeId === target.id) {
      const fallback = state.nodes[Math.min(index, state.nodes.length - 1)];
      state.selectedNodeId = fallback ? fallback.id : null;
    }
  },

  setSelectedNode(state, nodeId) {
    state.selectedNodeId = nodeId;
  },

  setPendingMergeSource(state, nodeId) {
    const node = state.nodes.find((item) => item.id === nodeId);
    if (!node || isLoopRootStateNode(node) || node.loopOwnerId) {
      state.pendingMergeSourceId = null;
      return false;
    }
    state.pendingMergeSourceId = nodeId;
    return true;
  },

  clearPendingMergeSource(state) {
    state.pendingMergeSourceId = null;
  },

  addMergeParent(state, sourceId, targetId) {
    const source = state.nodes.find((item) => item.id === sourceId);
    const target = state.nodes.find((item) => item.id === targetId);
    if (!source || !target) return { ok: false, reason: "not_found" };
    if (source.id === target.id) return { ok: false, reason: "self" };
    if (isLoopRootStateNode(source) || isLoopRootStateNode(target)) return { ok: false, reason: "loop_root" };
    if (source.loopOwnerId || target.loopOwnerId) return { ok: false, reason: "loop_internal" };
    if ((target.parentId ?? null) === source.id) return { ok: false, reason: "already_primary" };
    const mergeParentIds = getMergeParentIds(target);
    if (mergeParentIds.includes(source.id)) return { ok: false, reason: "already_merge" };
    if (hasReachablePath(state, source.id, target.id) || hasReachablePath(state, target.id, source.id)) {
      return { ok: false, reason: "connected" };
    }
    target.mergeParentIds = [...mergeParentIds, source.id];
    return { ok: true };
  },

  removeMergeParent(state, sourceId, targetId) {
    const target = state.nodes.find((item) => item.id === targetId);
    if (!target) return false;
    const currentIds = getMergeParentIds(target);
    const nextIds = currentIds.filter((id) => id !== sourceId);
    if (nextIds.length === currentIds.length) return false;
    target.mergeParentIds = nextIds;
    return true;
  }
};

window.stateOps = stateOps;
const __zizPackagesState = window.zizPackages = window.zizPackages || {};
const __zizCoreState = __zizPackagesState.core = __zizPackagesState.core || {};
__zizCoreState.stateOps = stateOps;

function isLoopRootStateNode(node) {
  return !!node && node.action === "loop_tasks" && !node.loopOwnerId;
}

const CANVAS_COORD_RULES = {
  START_X: 44,
  START_Y: 40,
  GRID_SIZE: 64,
  MIN_COORD: 8,
  INSERT_DX: 128,
  INSERT_DY: 0,
  PARALLEL_DX: 128,
  PARALLEL_DY: 120,
  PARALLEL_COLLISION_DY: 128
};

function normalizeCanvasPositionValue(value) {
  if (!value || typeof value !== "object") return null;
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: Math.max(CANVAS_COORD_RULES.MIN_COORD, Math.round(x)),
    y: Math.max(CANVAS_COORD_RULES.MIN_COORD, Math.round(y))
  };
}

function normalizeCanvasGridPositionValue(value) {
  if (!value || typeof value !== "object") return null;
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function roundGridUnit(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function snapToCanvasGrid(value, origin) {
  const size = Math.max(1, Number(CANVAS_COORD_RULES.GRID_SIZE) || 64);
  const base = Number.isFinite(Number(origin)) ? Number(origin) : 0;
  const raw = Number(value);
  if (!Number.isFinite(raw)) return base;
  return base + Math.round((raw - base) / size) * size;
}

function toCanvasFromGrid(gridValue, origin) {
  const size = Math.max(1, Number(CANVAS_COORD_RULES.GRID_SIZE) || 64);
  const base = Number.isFinite(Number(origin)) ? Number(origin) : 0;
  const raw = Number(gridValue);
  if (!Number.isFinite(raw)) return base;
  return base + raw * size;
}

function toGridFromCanvas(canvasValue, origin) {
  const size = Math.max(1, Number(CANVAS_COORD_RULES.GRID_SIZE) || 64);
  const base = Number.isFinite(Number(origin)) ? Number(origin) : 0;
  const raw = Number(canvasValue);
  if (!Number.isFinite(raw)) return 0;
  return roundGridUnit((raw - base) / size);
}

function resolveNodeCanvasPosition(nodeLike) {
  const gridPos = normalizeCanvasGridPositionValue(nodeLike?.canvasGridPosition);
  if (gridPos) {
    return normalizeCanvasPositionValue({
      x: toCanvasFromGrid(gridPos.x, CANVAS_COORD_RULES.START_X),
      y: toCanvasFromGrid(gridPos.y, CANVAS_COORD_RULES.START_Y)
    });
  }
  return normalizeCanvasPositionValue(nodeLike?.canvasPosition);
}

function applyNodeCanvasPosition(node, position, options = {}) {
  if (!node || !position) return null;
  const snap = options.snap !== false;
  const raw = normalizeCanvasPositionValue(position);
  if (!raw) return null;
  const nextX = snap ? snapToCanvasGrid(raw.x, CANVAS_COORD_RULES.START_X) : raw.x;
  const nextY = snap ? snapToCanvasGrid(raw.y, CANVAS_COORD_RULES.START_Y) : raw.y;
  const next = normalizeCanvasPositionValue({ x: nextX, y: nextY });
  if (!next) return null;
  node.canvasPosition = next;
  node.canvasGridPosition = {
    x: toGridFromCanvas(next.x, CANVAS_COORD_RULES.START_X),
    y: toGridFromCanvas(next.y, CANVAS_COORD_RULES.START_Y)
  };
  return next;
}

function getAnchorBasePosition(state, anchorId) {
  if (anchorId === null || anchorId === undefined) {
    return { x: CANVAS_COORD_RULES.START_X, y: CANVAS_COORD_RULES.START_Y };
  }
  const anchorNode = state.nodes.find((node) => node.id === anchorId) || null;
  const anchorPosition = resolveNodeCanvasPosition(anchorNode);
  if (anchorPosition) return anchorPosition;
  return { x: CANVAS_COORD_RULES.START_X, y: CANVAS_COORD_RULES.START_Y };
}

function hasNodeAtCanvasPosition(state, position) {
  const target = normalizeCanvasPositionValue(position);
  if (!target) return false;
  return state.nodes.some((node) => {
    const pos = resolveNodeCanvasPosition(node);
    return !!pos && pos.x === target.x && pos.y === target.y;
  });
}

function resolveParallelInsertPosition(state, anchorId) {
  const basePos = getAnchorBasePosition(state, anchorId);
  const stepY = Math.max(1, Number(CANVAS_COORD_RULES.PARALLEL_COLLISION_DY) || 128);
  let candidate = {
    x: snapToCanvasGrid(basePos.x + CANVAS_COORD_RULES.PARALLEL_DX, CANVAS_COORD_RULES.START_X),
    y: snapToCanvasGrid(basePos.y + CANVAS_COORD_RULES.PARALLEL_DY, CANVAS_COORD_RULES.START_Y)
  };
  let guard = 0;
  while (hasNodeAtCanvasPosition(state, candidate) && guard < 256) {
    candidate = {
      x: candidate.x,
      y: snapToCanvasGrid(candidate.y + stepY, CANVAS_COORD_RULES.START_Y)
    };
    guard += 1;
  }
  return candidate;
}

function shiftSubtreeCanvasPositions(state, rootNodeId, deltaX, deltaY) {
  if (!rootNodeId) return;
  const queue = [rootNodeId];
  const visited = new Set();
  while (queue.length) {
    const currentId = queue.shift();
    if (!currentId || visited.has(currentId)) continue;
    visited.add(currentId);
    const currentNode = state.nodes.find((node) => node.id === currentId);
    if (currentNode) {
      const currentPos = resolveNodeCanvasPosition(currentNode);
      if (currentPos) {
        applyNodeCanvasPosition(
          currentNode,
          {
            x: currentPos.x + (Number(deltaX) || 0),
            y: currentPos.y + (Number(deltaY) || 0)
          },
          { snap: true }
        );
      }
      getChildren(state, currentNode.id).forEach((child) => queue.push(child.id));
    }
  }
}

function collectLoopRemovalIds(state, loopRootId) {
  const removeIds = new Set([loopRootId]);
  const queue = getChildren(state, loopRootId)
    .filter((child) => child.loopOwnerId === loopRootId)
    .map((child) => child.id);

  while (queue.length) {
    const currentId = queue.shift();
    if (!currentId || removeIds.has(currentId)) continue;
    removeIds.add(currentId);
    getChildren(state, currentId).forEach((child) => {
      if (!removeIds.has(child.id)) queue.push(child.id);
    });
  }

  return removeIds;
}

function removeLoopRootNode(state, target, index) {
  const parentId = target.parentId ?? null;
  const targetOrder = Number(target.parallelOrder) || 1;
  const directChildren = getChildren(state, target.id);
  const outsideChildren = directChildren.filter((child) => child.loopOwnerId !== target.id);
  const removeIds = collectLoopRemovalIds(state, target.id);
  const remainingCount = state.nodes.filter((node) => !removeIds.has(node.id)).length;
  if (remainingCount <= 0) return;

  outsideChildren.forEach((child, idx) => {
    child.parentId = parentId;
    child.parallelOrder = targetOrder + idx;
    child.parallelOf = null;
  });

  state.nodes.forEach((node) => {
    if ((node.parentId ?? null) !== parentId) return;
    const order = Number(node.parallelOrder) || 1;
    if (node.id !== target.id && order > targetOrder) {
      node.parallelOrder = order - 1 + outsideChildren.length;
    }
  });

  state.nodes = state.nodes.filter((node) => !removeIds.has(node.id));

  const idSet = new Set(state.nodes.map((node) => node.id));
  state.nodes.forEach((node) => {
    if (node.parentId && !idSet.has(node.parentId)) node.parentId = null;
    if (node.parallelOf && !idSet.has(node.parallelOf)) node.parallelOf = null;
    node.mergeParentIds = getValidMergeParentIds(node, idSet);
  });
  if (state.pendingMergeSourceId && !idSet.has(state.pendingMergeSourceId)) {
    state.pendingMergeSourceId = null;
  }

  refreshParallelOfForParent(state, parentId);
  outsideChildren.forEach((child) => refreshParallelOfForParent(state, child.id));

  if (!state.selectedNodeId || !state.nodes.some((node) => node.id === state.selectedNodeId)) {
    const fallback = state.nodes[Math.min(index, state.nodes.length - 1)] || state.nodes[0] || null;
    state.selectedNodeId = fallback ? fallback.id : null;
  }
}

function insertAtAnchor(state, anchorId) {
  const right = getFirstChild(state, anchorId);
  const newNode = createNewNode(allocateStepName(state), state.appMode);
  newNode.parentId = anchorId;
  const anchorPosition = getAnchorBasePosition(state, anchorId);
  const insertPosition = {
    x: anchorPosition.x + CANVAS_COORD_RULES.INSERT_DX,
    y: anchorPosition.y + CANVAS_COORD_RULES.INSERT_DY
  };
  applyNodeCanvasPosition(newNode, insertPosition, { snap: true });

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

  // Keep inserted chain spacing by shifting existing right subtree to the right.
  shiftSubtreeCanvasPositions(state, right.id, CANVAS_COORD_RULES.INSERT_DX, 0);

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

  const newNode = createNewNode(allocateStepName(state), state.appMode);
  newNode.parentId = anchorId;
  newNode.parallelOrder = getNextChildOrder(state, anchorId);
  newNode.parallelOf = right.id;
  const insertPosition = resolveParallelInsertPosition(state, anchorId);
  applyNodeCanvasPosition(
    newNode,
    {
      x: insertPosition.x,
      y: insertPosition.y
    },
    { snap: true }
  );

  state.nodes.push(newNode);
  state.selectedNodeId = newNode.id;
  refreshParallelOfForParent(state, anchorId);
}

function insertExistingNodeAtAnchor(state, movingNode, anchorId, rightId) {
  const right = resolveRightNode(state, anchorId, rightId);

  movingNode.parentId = anchorId;
  movingNode.parallelOf = null;

  if (!right) {
    movingNode.parallelOrder = getNextChildOrder(state, anchorId);
    state.nodes.push(movingNode);
    refreshParallelOfForParent(state, anchorId);
    return;
  }

  const rightOrder = Number(right.parallelOrder) || 1;
  movingNode.parallelOrder = rightOrder;

  state.nodes.forEach((n) => {
    if ((n.parentId ?? null) !== (anchorId ?? null)) return;
    if (n.id === right.id) return;
    const order = Number(n.parallelOrder) || 1;
    if (order > rightOrder) n.parallelOrder = order + 1;
  });

  right.parentId = movingNode.id;
  right.parallelOrder = 1;
  right.parallelOf = null;

  state.nodes.push(movingNode);
  refreshParallelOfForParent(state, anchorId);
  refreshParallelOfForParent(state, movingNode.id);
}

function addExistingParallelAtAnchor(state, movingNode, anchorId, rightId) {
  const right = resolveRightNode(state, anchorId, rightId);
  if (!right) return false;

  movingNode.parentId = anchorId;
  movingNode.parallelOrder = getNextChildOrder(state, anchorId);
  movingNode.parallelOf = right.id;

  state.nodes.push(movingNode);
  refreshParallelOfForParent(state, anchorId);
  return true;
}

function resolveRightNode(state, anchorId, rightId) {
  if (!rightId) return getFirstChild(state, anchorId);
  const right = state.nodes.find((n) => n.id === rightId) || null;
  if (!right) return getFirstChild(state, anchorId);
  if ((right.parentId ?? null) !== (anchorId ?? null)) return getFirstChild(state, anchorId);
  return right;
}

function extractNodeForMove(state, nodeId) {
  const target = state.nodes.find((n) => n.id === nodeId);
  if (!target) return null;

  const parentId = target.parentId ?? null;
  const children = getChildren(state, target.id);
  const targetOrder = Number(target.parallelOrder) || 1;

  children.forEach((child, idx) => {
    child.parentId = parentId;
    child.parallelOrder = targetOrder + idx;
    child.parallelOf = null;
  });

  state.nodes.forEach((n) => {
    if ((n.parentId ?? null) !== parentId) return;
    const order = Number(n.parallelOrder) || 1;
    if (n.id !== target.id && order > targetOrder) n.parallelOrder = order - 1;
  });

  state.nodes = state.nodes.filter((n) => n.id !== target.id);
  refreshParallelOfForParent(state, parentId);
  children.forEach((child) => refreshParallelOfForParent(state, child.id));

  target.parentId = null;
  target.parallelOf = null;
  target.parallelOrder = 1;
  return target;
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

function getMergeParentIds(node) {
  if (!Array.isArray(node?.mergeParentIds)) return [];
  return node.mergeParentIds
    .map((id) => String(id || "").trim())
    .filter(Boolean);
}

function getValidMergeParentIds(node, idSet) {
  const primaryParentId = node?.parentId ?? null;
  return Array.from(new Set(
    getMergeParentIds(node).filter((id) => id !== primaryParentId && idSet.has(id))
  ));
}

function getOutgoingNodeIds(state, sourceId) {
  return state.nodes
    .filter((node) => (node.parentId ?? null) === sourceId || getMergeParentIds(node).includes(sourceId))
    .map((node) => node.id);
}

function hasReachablePath(state, sourceId, targetId) {
  if (!sourceId || !targetId) return false;
  if (sourceId === targetId) return true;
  const visited = new Set();
  const queue = [sourceId];
  while (queue.length) {
    const currentId = queue.shift();
    if (!currentId || visited.has(currentId)) continue;
    visited.add(currentId);
    if (currentId === targetId) return true;
    getOutgoingNodeIds(state, currentId).forEach((childId) => {
      if (!visited.has(childId)) queue.push(childId);
    });
  }
  return false;
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

function collectRelatedNodeIds(state, nodeId) {
  const seen = new Set();
  const queue = [nodeId];
  while (queue.length) {
    const currentId = queue.shift();
    if (!currentId || seen.has(currentId)) continue;
    seen.add(currentId);
    getOutgoingNodeIds(state, currentId).forEach((childId) => {
      if (!seen.has(childId)) queue.push(childId);
    });
  }
  return seen;
}

function canMoveNodeToTarget(state, nodeId, target) {
  const node = state.nodes.find((item) => item.id === nodeId);
  if (!node) return false;

  const relatedIds = collectRelatedNodeIds(state, nodeId);
  if (target.anchorId && relatedIds.has(target.anchorId)) return false;
  if (target.rightId && relatedIds.has(target.rightId)) return false;
  if (target.kind === "parallel" && !target.rightId) return false;

  if (target.anchorId !== null) {
    const anchorExists = state.nodes.some((item) => item.id === target.anchorId);
    if (!anchorExists) return false;
  }

  if (target.rightId) {
    const rightExists = state.nodes.some((item) => item.id === target.rightId);
    if (!rightExists) return false;
  }

  return true;
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
  return (window.zizPackages && window.zizPackages.core && window.zizPackages.core.CONFIG) || {};
}

function normalizeAppMode(appMode) {
  const cfg = getConfigObject();
  const modes = cfg.modes || {};
  return modes[appMode] ? appMode : "dataflow";
}

function getModeConnectorIds(appMode) {
  const cfg = getConfigObject();
  const mode = cfg.modes?.[normalizeAppMode(appMode)] || null;
  return Array.isArray(mode?.connectorIds) ? mode.connectorIds : [];
}

function getDefaultFlowName(appMode) {
  const cfg = getConfigObject();
  const mode = cfg.modes?.[normalizeAppMode(appMode)] || null;
  return String(mode?.defaultFlowName || "フロー１");
}

function getDefaultConnectorId(appMode) {
  const cfg = getConfigObject();
  const connectors = Array.isArray(cfg.connectors) ? cfg.connectors : [];
  const allowedConnectorIds = getModeConnectorIds(appMode);
  if (allowedConnectorIds.length) {
    const allowed = connectors.find((connector) => allowedConnectorIds.includes(connector.id));
    if (allowed?.id) return allowed.id;
  }
  return connectors[0]?.id || "";
}

function getDefaultActionId(connectorId) {
  const cfg = getConfigObject();
  const byConnector = (cfg.actions && connectorId) ? cfg.actions[connectorId] : null;
  const actions = Array.isArray(byConnector) ? byConnector : [];
  return actions[0]?.id || "";
}

function createDefaultNode(appMode) {
  const connectorId = getDefaultConnectorId(appMode);
  const actionId = getDefaultActionId(connectorId);
  return {
    id: createId(),
    connector: connectorId,
    action: actionId,
    description: "",
    descriptionAuto: true,
    form: {},
    parentId: null,
    mergeParentIds: [],
    parallelOf: null,
    parallelOrder: 1,
    outputs: ["step1"]
  };
}

function createNewNode(stepName, appMode) {
  const connectorId = getDefaultConnectorId(appMode);
  const actionId = getDefaultActionId(connectorId);
  return {
    id: createId(),
    stepName: stepName || "",
    connector: connectorId,
    action: actionId,
    description: "",
    descriptionAuto: true,
    form: {},
    parentId: null,
    mergeParentIds: [],
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

function cloneStateValue(value) {
  if (typeof window.structuredClone === "function") {
    try {
      return window.structuredClone(value);
    } catch (error) {
      // fallback below
    }
  }
  return JSON.parse(JSON.stringify(value ?? null));
}
