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
      selectedNodeIds: [first.id],
      pendingMergeSourceId: null,
      nextStepSeq: 2
    };
  },

  addNodeAfter(state, index, options = {}) {
    const anchor = state.nodes[index];
    if (!anchor) return;
    insertAtAnchor(state, anchor.id, options);
    refreshParallelOfForParent(state, anchor.id);
  },

  insertNodeAt(state, _index, options = {}) {
    // Insert from "開始"
    insertAtAnchor(state, null, options);
    refreshParallelOfForParent(state, null);
  },

  addParallelAfter(state, index, options = {}) {
    const source = state.nodes[index];
    if (!source) return;

    const anchorId = normalizeAnchorId(options.parentId, source.parentId);
    if (anchorId === undefined) return;
    addParallelAtAnchor(state, anchorId, options);
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
    const sourceForm = cloneStateValue(payload.form) || {};
    const hiddenRefMap = buildHiddenRefReplacements(state, sourceForm, String(newNode.stepName || "global"));
    newNode.form = applyHiddenRefReplacements(sourceForm, hiddenRefMap);
    applyHiddenBindingMetaCopies(state, hiddenRefMap);
    return true;
  },

  moveNodeToInsert(state, nodeId, options = {}) {
    const anchorId = normalizeAnchorId(options.anchorId, null);
    const rightId = options.rightId ?? null;
    if (!canMoveNodeToTarget(state, nodeId, { anchorId, rightId, kind: "insert" })) return false;

    const movingNode = extractNodeForMove(state, nodeId);
    if (!movingNode) return false;

    insertExistingNodeAtAnchor(state, movingNode, anchorId, rightId);
    setSelectedNodeIdsInternal(state, [movingNode.id]);
    return true;
  },

  moveNodeToParallel(state, nodeId, options = {}) {
    const anchorId = normalizeAnchorId(options.anchorId, null);
    const rightId = options.rightId ?? null;
    if (!canMoveNodeToTarget(state, nodeId, { anchorId, rightId, kind: "parallel" })) return false;

    const movingNode = extractNodeForMove(state, nodeId);
    if (!movingNode) return false;

    addExistingParallelAtAnchor(state, movingNode, anchorId, rightId);
    setSelectedNodeIdsInternal(state, [movingNode.id]);
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
    if (target.loopOwnerId) {
      const loopRootId = String(target.loopOwnerId || "");
      const internalCount = state.nodes.filter((node) => String(node?.loopOwnerId || "") === loopRootId).length;
      if (internalCount <= 1) return;
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
      setSelectedNodeIdsInternal(state, fallback ? [fallback.id] : []);
      return;
    }
    sanitizeSelectedNodeIdsInternal(state);
  },

  setSelectedNode(state, nodeId, options = {}) {
    setSelectedNodeIdsInternal(state, nodeId ? [nodeId] : [], options);
  },

  setSelectedNodes(state, nodeIds, options = {}) {
    setSelectedNodeIdsInternal(state, nodeIds, options);
  },

  getSelectedNodeIds(state, options = {}) {
    return sanitizeSelectedNodeIdsInternal(state, options);
  },

  removeNodesByIds(state, nodeIds) {
    const ids = new Set((Array.isArray(nodeIds) ? nodeIds : []).map((id) => String(id || "").trim()).filter(Boolean));
    if (!ids.size) return false;
    let changed = false;
    while (true) {
      const targetIndex = state.nodes.findIndex((node) => ids.has(String(node?.id || "")));
      if (targetIndex < 0) break;
      const beforeLength = state.nodes.length;
      stateOps.removeNode(state, targetIndex);
      if (state.nodes.length === beforeLength) break;
      changed = true;
    }
    sanitizeSelectedNodeIdsInternal(state);
    return changed;
  },

  duplicateNodesByIds(state, nodeIds, options = {}) {
    const selectedIds = sanitizeNodeIdsForOperation(state, nodeIds);
    if (!selectedIds.length) return [];
    const selectedSet = new Set(selectedIds);
    const orderedSources = state.nodes.filter((node) => selectedSet.has(String(node?.id || "")));
    const requestedAnchorId = String(options.anchorId || "").trim();
    const anchorNode = requestedAnchorId
      ? state.nodes.find((node) => String(node?.id || "") === requestedAnchorId)
      : null;
    const anchorId = anchorNode ? String(anchorNode.id || "") : null;
    const offsetX = Number.isFinite(Number(options.offsetX)) ? Number(options.offsetX) : 64;
    const offsetY = Number.isFinite(Number(options.offsetY)) ? Number(options.offsetY) : 64;
    const cloned = [];
    const idMap = new Map();

    const anchorLoopRootId = getLoopRootIdForNode(anchorNode);
    const containsLoopRoot = orderedSources.some((node) => isLoopRootStateNode(node));
    if (containsLoopRoot && anchorLoopRootId) return [];
    orderedSources.forEach((source) => {
      const next = cloneStateValue(source);
      const oldId = String(source.id || "");
      next.id = createId();
      next.stepName = allocateStepName(state);
      const sourceForm = cloneStateValue(source.form) || {};
      const hiddenRefMap = buildHiddenRefReplacements(state, sourceForm, String(next.stepName || "global"));
      next.form = applyHiddenRefReplacements(sourceForm, hiddenRefMap);
      applyHiddenBindingMetaCopies(state, hiddenRefMap);
      if (next.loopOwnerId) delete next.loopOwnerId;
      next.parentId = null;
      next.parallelOf = null;
      next.parallelOrder = Number(source.parallelOrder) || 1;
      next.mergeParentIds = [];
      const sourcePosition = resolveNodeCanvasPosition(source);
      if (sourcePosition) {
        applyNodeCanvasPosition(next, {
          x: sourcePosition.x + offsetX,
          y: sourcePosition.y + offsetY
        }, { snap: true });
      }
      idMap.set(oldId, next.id);
      cloned.push(next);
    });

    cloned.forEach((node, index) => {
      const source = orderedSources[index];
      const sourceId = String(source.id || "").trim();
      const sourceParentId = source.parentId ? String(source.parentId) : null;
      const mappedParentId = sourceParentId && idMap.has(sourceParentId) ? idMap.get(sourceParentId) : null;
      node.parentId = mappedParentId || anchorId || sourceId || null;
      node.mergeParentIds = getMergeParentIds(source)
        .filter((id) => idMap.has(id))
        .map((id) => idMap.get(id));
      const sourceLoopOwnerId = String(source?.loopOwnerId || "").trim();
      const sourceIsLoopRoot = isLoopRootStateNode(source);
      if (sourceIsLoopRoot) {
        delete node.loopOwnerId;
        node.nodeType = "loop";
      } else if (sourceLoopOwnerId) {
        if (idMap.has(sourceLoopOwnerId)) {
          node.loopOwnerId = idMap.get(sourceLoopOwnerId);
        } else if (anchorLoopRootId) {
          node.loopOwnerId = anchorLoopRootId;
        } else {
          delete node.loopOwnerId;
        }
      } else if (anchorLoopRootId) {
        node.loopOwnerId = anchorLoopRootId;
      } else if (node.loopOwnerId) {
        delete node.loopOwnerId;
      }
    });

    state.nodes.push(...cloned);
    const affectedParents = new Set(cloned.map((node) => node.parentId ?? null));
    affectedParents.forEach((parentId) => refreshParallelOfForParent(state, parentId));
    const newIds = cloned.map((node) => node.id);
    setSelectedNodeIdsInternal(state, newIds);
    return newIds;
  },

  hasDirectedEdge(state, sourceId, targetId) {
    const source = String(sourceId || "").trim();
    const target = String(targetId || "").trim();
    if (!source || !target) return false;
    const targetNode = state.nodes.find((node) => String(node?.id || "") === target);
    if (!targetNode) return false;
    if ((targetNode.parentId ?? null) === source) return true;
    return getMergeParentIds(targetNode).includes(source);
  },

  hasSuccessorNode(state, sourceId) {
    const source = String(sourceId || "").trim();
    if (!source) return false;
    return state.nodes.some((node) => {
      if (String(node?.id || "") === source) return false;
      if ((node.parentId ?? null) === source) return true;
      return getMergeParentIds(node).includes(source);
    });
  },

  removeDirectedEdge(state, sourceId, targetId) {
    const source = String(sourceId || "").trim();
    const target = String(targetId || "").trim();
    if (!source || !target) return { removedPrimary: false, removedMerge: false };
    const targetNode = state.nodes.find((node) => String(node?.id || "") === target);
    if (!targetNode) return { removedPrimary: false, removedMerge: false };
    let removedPrimary = false;
    let removedMerge = false;
    if ((targetNode.parentId ?? null) === source) {
      targetNode.parentId = null;
      targetNode.parallelOrder = getNextChildOrder(state, null);
      targetNode.parallelOf = null;
      refreshParallelOfForParent(state, source);
      refreshParallelOfForParent(state, null);
      removedPrimary = true;
    }
    const mergeParents = getMergeParentIds(targetNode);
    if (mergeParents.includes(source)) {
      targetNode.mergeParentIds = mergeParents.filter((id) => id !== source);
      removedMerge = true;
    }
    return { removedPrimary, removedMerge };
  },

  createNodeAtAnchor(state, anchorId, options = {}) {
    const normalizedAnchorId = normalizeAnchorId(anchorId, null);
    const created = insertAtAnchor(state, normalizedAnchorId, options);
    refreshParallelOfForParent(state, normalizedAnchorId);
    if (created?.id) setSelectedNodeIdsInternal(state, [created.id]);
    return created;
  },

  createParallelNodeAtAnchor(state, anchorId, options = {}) {
    const normalizedAnchorId = normalizeAnchorId(anchorId, null);
    const created = addParallelAtAnchor(state, normalizedAnchorId, options);
    refreshParallelOfForParent(state, normalizedAnchorId);
    if (created?.id) setSelectedNodeIdsInternal(state, [created.id]);
    return created || null;
  },

  createLoopNodeAtAnchor(state, anchorId, options = {}) {
    const normalizedAnchorId = normalizeAnchorId(anchorId, null);
    const anchorNode = normalizedAnchorId ? state.nodes.find((item) => item.id === normalizedAnchorId) : null;
    if (anchorNode && getLoopRootIdForNode(anchorNode)) return null;
    const created = insertAtAnchor(state, normalizedAnchorId, options);
    if (!created) return null;
    const loopDefaults = getLoopNodeDefaults(state.appMode);
    created.nodeType = "loop";
    created.connector = loopDefaults.connectorId;
    created.action = loopDefaults.actionId;
    created.form = {
      max_iterations: 30,
      source_step_id: ""
    };
    created.description = "";
    created.descriptionAuto = true;
    refreshParallelOfForParent(state, normalizedAnchorId);
    if (created?.id) setSelectedNodeIdsInternal(state, [created.id]);
    return created;
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
  return !!node && String(node.nodeType || "").trim() === "loop" && !node.loopOwnerId;
}

function normalizeNodeIdValue(nodeId) {
  return String(nodeId || "").trim();
}

function setSelectedNodeIdsInternal(state, nodeIds, options = {}) {
  if (!state || typeof state !== "object") return [];
  const allowEmpty = !!options.allowEmpty;
  const nodeIdSet = new Set((Array.isArray(state.nodes) ? state.nodes : []).map((node) => normalizeNodeIdValue(node?.id)));
  const selected = [];
  const seen = new Set();
  (Array.isArray(nodeIds) ? nodeIds : []).forEach((id) => {
    const normalized = normalizeNodeIdValue(id);
    if (!normalized || seen.has(normalized) || !nodeIdSet.has(normalized)) return;
    seen.add(normalized);
    selected.push(normalized);
  });
  if (!selected.length && !allowEmpty && Array.isArray(state.nodes) && state.nodes.length) {
    const fallbackId = normalizeNodeIdValue(state.nodes[0]?.id);
    if (fallbackId) selected.push(fallbackId);
  }
  state.selectedNodeIds = selected;
  state.selectedNodeId = selected[0] || null;
  return selected;
}

function sanitizeSelectedNodeIdsInternal(state, options = {}) {
  if (!state || typeof state !== "object") return [];
  const rawSelected = Array.isArray(state.selectedNodeIds)
    ? state.selectedNodeIds
    : (state.selectedNodeId ? [state.selectedNodeId] : []);
  const allowEmptyByDefault = !(Array.isArray(state.nodes) && state.nodes.length);
  const allowEmpty = options.allowEmpty === true ? true : allowEmptyByDefault;
  return setSelectedNodeIdsInternal(state, rawSelected, { allowEmpty });
}

function sanitizeNodeIdsForOperation(state, nodeIds) {
  const nodeSet = new Set((Array.isArray(nodeIds) ? nodeIds : []).map((id) => normalizeNodeIdValue(id)).filter(Boolean));
  const baseSelected = (Array.isArray(state?.nodes) ? state.nodes : [])
    .filter((node) => nodeSet.has(normalizeNodeIdValue(node?.id)))
    .map((node) => normalizeNodeIdValue(node.id));
  const expanded = new Set(baseSelected);
  baseSelected.forEach((nodeId) => {
    const node = (Array.isArray(state?.nodes) ? state.nodes : []).find((item) => normalizeNodeIdValue(item?.id) === nodeId);
    if (!isLoopRootStateNode(node)) return;
    (Array.isArray(state?.nodes) ? state.nodes : []).forEach((candidate) => {
      if (normalizeNodeIdValue(candidate?.loopOwnerId) === nodeId) {
        expanded.add(normalizeNodeIdValue(candidate?.id));
      }
    });
  });
  return Array.from(expanded).filter(Boolean);
}

const CANVAS_COORD_RULES = {
  START_X: 44,
  START_Y: 40,
  GRID_SIZE: 32,
  MIN_COORD: 8,
  INSERT_DX: 96,
  INSERT_DY: 0,
  PARALLEL_DX: 64,
  PARALLEL_DY: 60,
  PARALLEL_COLLISION_DY: 64
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
  const size = Math.max(1, Number(CANVAS_COORD_RULES.GRID_SIZE) || 32);
  const base = Number.isFinite(Number(origin)) ? Number(origin) : 0;
  const raw = Number(value);
  if (!Number.isFinite(raw)) return base;
  return base + Math.round((raw - base) / size) * size;
}

function toCanvasFromGrid(gridValue, origin) {
  const size = Math.max(1, Number(CANVAS_COORD_RULES.GRID_SIZE) || 32);
  const base = Number.isFinite(Number(origin)) ? Number(origin) : 0;
  const raw = Number(gridValue);
  if (!Number.isFinite(raw)) return base;
  return base + raw * size;
}

function toGridFromCanvas(canvasValue, origin) {
  const size = Math.max(1, Number(CANVAS_COORD_RULES.GRID_SIZE) || 32);
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
  const stepY = Math.max(1, Number(CANVAS_COORD_RULES.PARALLEL_COLLISION_DY) || 64);
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
    setSelectedNodeIdsInternal(state, fallback ? [fallback.id] : []);
    return;
  }
  sanitizeSelectedNodeIdsInternal(state);
}

function getLoopRootIdForNode(node) {
  if (!node) return null;
  if (node.loopOwnerId) return String(node.loopOwnerId);
  if (isLoopRootStateNode(node)) return String(node.id || "");
  return null;
}

function insertAtAnchor(state, anchorId, options = {}) {
  const right = resolveRightNode(state, anchorId, options.rightId ?? null);
  const newNode = createNewNode(allocateStepName(state), state.appMode);
  const anchorNode = anchorId ? state.nodes.find((item) => item.id === anchorId) : null;
  const anchorLoopRootId = getLoopRootIdForNode(anchorNode);
  newNode.parentId = anchorId;
  if (anchorNode?.loopOwnerId) {
    newNode.loopOwnerId = anchorLoopRootId;
  } else {
    delete newNode.loopOwnerId;
  }
  const requestedPosition = normalizeCanvasPositionValue(options.position);
  if (requestedPosition) {
    applyNodeCanvasPosition(newNode, requestedPosition, { snap: true });
  } else {
    const anchorPosition = getAnchorBasePosition(state, anchorId);
    const insertPosition = {
      x: anchorPosition.x + CANVAS_COORD_RULES.INSERT_DX,
      y: anchorPosition.y + CANVAS_COORD_RULES.INSERT_DY
    };
    applyNodeCanvasPosition(newNode, insertPosition, { snap: true });
  }

  if (!right) {
    const nextOrder = getNextChildOrder(state, anchorId);
    newNode.parallelOrder = nextOrder;
    newNode.parallelOf = null;
    state.nodes.push(newNode);
    setSelectedNodeIdsInternal(state, [newNode.id]);
    return newNode;
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
  setSelectedNodeIdsInternal(state, [newNode.id]);
  refreshParallelOfForParent(state, anchorId);
  refreshParallelOfForParent(state, newNode.id);
  return newNode;
}

function addParallelAtAnchor(state, anchorId, options = {}) {
  const right = getFirstChild(state, anchorId);
  if (!right) return null;

  const newNode = createNewNode(allocateStepName(state), state.appMode);
  const anchorNode = anchorId ? state.nodes.find((item) => item.id === anchorId) : null;
  const anchorLoopRootId = getLoopRootIdForNode(anchorNode);
  newNode.parentId = anchorId;
  if (anchorNode?.loopOwnerId) {
    newNode.loopOwnerId = anchorLoopRootId;
  } else {
    delete newNode.loopOwnerId;
  }
  newNode.parallelOrder = getNextChildOrder(state, anchorId);
  newNode.parallelOf = right.id;
  const requestedPosition = normalizeCanvasPositionValue(options.position);
  const insertPosition = requestedPosition || resolveParallelInsertPosition(state, anchorId);
  applyNodeCanvasPosition(
    newNode,
    {
      x: insertPosition.x,
      y: insertPosition.y
    },
    { snap: true }
  );

  state.nodes.push(newNode);
  setSelectedNodeIdsInternal(state, [newNode.id]);
  refreshParallelOfForParent(state, anchorId);
  return newNode;
}

function insertExistingNodeAtAnchor(state, movingNode, anchorId, rightId) {
  const right = resolveRightNode(state, anchorId, rightId);
  const anchorNode = anchorId ? state.nodes.find((item) => item.id === anchorId) : null;
  const anchorLoopRootId = getLoopRootIdForNode(anchorNode);

  movingNode.parentId = anchorId;
  movingNode.parallelOf = null;
  if (anchorNode?.loopOwnerId) {
    movingNode.loopOwnerId = anchorLoopRootId;
  } else {
    delete movingNode.loopOwnerId;
  }

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
  const anchorNode = anchorId ? state.nodes.find((item) => item.id === anchorId) : null;
  const anchorLoopRootId = getLoopRootIdForNode(anchorNode);

  movingNode.parentId = anchorId;
  movingNode.parallelOrder = getNextChildOrder(state, anchorId);
  movingNode.parallelOf = right.id;
  if (anchorNode?.loopOwnerId) {
    movingNode.loopOwnerId = anchorLoopRootId;
  } else {
    delete movingNode.loopOwnerId;
  }

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
  const movingLoopRootId = getLoopRootIdForNode(node);

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

  const anchorNode = target.anchorId ? state.nodes.find((item) => item.id === target.anchorId) : null;
  const targetLoopRootId = getLoopRootIdForNode(anchorNode);
  if (node.loopOwnerId) {
    return targetLoopRootId === movingLoopRootId;
  }
  if (isLoopRootStateNode(node)) {
    return !targetLoopRootId;
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

function getModeNodeDefaults(appMode) {
  const cfg = getConfigObject();
  const mode = cfg.modes?.[normalizeAppMode(appMode)] || null;
  const defaults = (mode && typeof mode.nodeDefaults === "object") ? mode.nodeDefaults : {};
  return {
    initialConnectorId: String(defaults.initialConnectorId || "").trim(),
    initialActionId: String(defaults.initialActionId || "").trim(),
    preferredConnectorId: String(defaults.preferredConnectorId || "").trim(),
    preferredActionId: String(defaults.preferredActionId || "").trim(),
    loopConnectorId: String(defaults.loopConnectorId || "").trim(),
    loopActionId: String(defaults.loopActionId || "").trim(),
  };
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

function getPreferredConnectorId(appMode, preferredConnectorId) {
  const preferred = String(preferredConnectorId || "").trim();
  if (!preferred) return getDefaultConnectorId(appMode);
  const cfg = getConfigObject();
  const connectors = Array.isArray(cfg.connectors) ? cfg.connectors : [];
  const connectorExists = connectors.some((connector) => String(connector?.id || "") === preferred);
  if (!connectorExists) return getDefaultConnectorId(appMode);
  const allowedConnectorIds = getModeConnectorIds(appMode);
  if (allowedConnectorIds.length && !allowedConnectorIds.includes(preferred)) {
    return getDefaultConnectorId(appMode);
  }
  return preferred;
}

function getDefaultActionId(connectorId) {
  const cfg = getConfigObject();
  const byConnector = (cfg.actions && connectorId) ? cfg.actions[connectorId] : null;
  const actions = Array.isArray(byConnector) ? byConnector : [];
  return actions[0]?.id || "";
}

function getPreferredActionId(connectorId, preferredActionId) {
  const preferred = String(preferredActionId || "").trim();
  if (!preferred) return getDefaultActionId(connectorId);
  const cfg = getConfigObject();
  const byConnector = (cfg.actions && connectorId) ? cfg.actions[connectorId] : null;
  const actions = Array.isArray(byConnector) ? byConnector : [];
  const matched = actions.find((action) => String(action?.id || "") === preferred);
  return matched?.id || getDefaultActionId(connectorId);
}

function createDefaultNode(appMode) {
  const defaults = getModeNodeDefaults(appMode);
  const connectorId = getPreferredConnectorId(appMode, defaults.initialConnectorId);
  const actionId = getPreferredActionId(connectorId, defaults.initialActionId);
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
    outputs: ["step1"],
    nodeType: "task"
  };
}

function createNewNode(stepName, appMode) {
  const defaults = getModeNodeDefaults(appMode);
  const connectorId = getPreferredConnectorId(appMode, defaults.preferredConnectorId);
  const actionId = getPreferredActionId(connectorId, defaults.preferredActionId);
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
    outputs: [],
    nodeType: "task"
  };
}

function getLoopNodeDefaults(appMode) {
  const defaults = getModeNodeDefaults(appMode);
  const connectorId = getPreferredConnectorId(appMode, defaults.loopConnectorId || "WindowsConnector");
  const actionId = getPreferredActionId(connectorId, defaults.loopActionId || "loop_tasks");
  return { connectorId, actionId };
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

const HIDDEN_REF_PATTERN = /^\{\{hidden\.([a-zA-Z0-9_]+)\.var(\d+)\}\}$/;

function sanitizeHiddenScope(scope) {
  const normalized = String(scope || "").trim().replace(/[^a-zA-Z0-9_]/g, "_");
  return normalized || "global";
}

function collectHiddenRefs(value, outSet) {
  if (typeof value === "string") {
    if (HIDDEN_REF_PATTERN.test(value)) outSet.add(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectHiddenRefs(item, outSet));
    return;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectHiddenRefs(item, outSet));
  }
}

function getHiddenBindingsObject(state) {
  if (!state || typeof state !== "object") return {};
  if (!state.hiddenBindings || typeof state.hiddenBindings !== "object" || Array.isArray(state.hiddenBindings)) {
    state.hiddenBindings = {};
  }
  return state.hiddenBindings;
}

function getNextHiddenVarIndex(hiddenBindings, scope) {
  const targetScope = sanitizeHiddenScope(scope);
  let maxIndex = 0;
  Object.keys(hiddenBindings || {}).forEach((key) => {
    const match = String(key || "").match(HIDDEN_REF_PATTERN);
    if (!match) return;
    if (match[1] !== targetScope) return;
    const index = Number(match[2]);
    if (Number.isFinite(index) && index > maxIndex) maxIndex = index;
  });
  return maxIndex + 1;
}

function buildHiddenRefReplacements(state, formValue, stepName) {
  const refs = new Set();
  collectHiddenRefs(formValue, refs);
  if (!refs.size) return new Map();

  const hiddenBindings = getHiddenBindingsObject(state);
  const scope = sanitizeHiddenScope(stepName);
  let nextIndex = getNextHiddenVarIndex(hiddenBindings, scope);
  const replacements = new Map();

  refs.forEach((ref) => {
    if (replacements.has(ref)) return;
    const nextRef = `{{hidden.${scope}.var${nextIndex}}}`;
    nextIndex += 1;
    replacements.set(ref, nextRef);
  });
  return replacements;
}

function applyHiddenRefReplacements(value, replacements) {
  if (!replacements || !replacements.size) return value;
  if (typeof value === "string") {
    return replacements.get(value) || value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => applyHiddenRefReplacements(item, replacements));
  }
  if (value && typeof value === "object") {
    const out = {};
    Object.entries(value).forEach(([key, item]) => {
      out[key] = applyHiddenRefReplacements(item, replacements);
    });
    return out;
  }
  return value;
}

function applyHiddenBindingMetaCopies(state, replacements) {
  if (!replacements || !replacements.size) return;
  const hiddenBindings = getHiddenBindingsObject(state);
  replacements.forEach((newRef, oldRef) => {
    if (hiddenBindings[newRef]) return;
    if (!Object.prototype.hasOwnProperty.call(hiddenBindings, oldRef)) return;
    hiddenBindings[newRef] = cloneStateValue(hiddenBindings[oldRef]) || {};
  });
}
