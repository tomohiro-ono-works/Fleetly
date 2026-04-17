(function () {
  const packages = window.zizPackages = window.zizPackages || {};
  const uiPkg = packages.ui = packages.ui || {};
  const shared = uiPkg.nodeShared || window.uiNodeShared || {};
  const {
    getMergeParentIds,
    ensureNodeDefaults,
    isLoopRootNode,
    getActionLabel,
    getConnectorLabel
  } = shared;

  const nodeCanvasParts = uiPkg.nodeCanvasParts = uiPkg.nodeCanvasParts || window.uiNodeCanvasParts || {};
  window.uiNodeCanvasParts = nodeCanvasParts;

  const constants = nodeCanvasParts.constants || {
    NODE_W: 60,
    NODE_H: 60,
    LEVEL_MARGIN: 128,
    MIN_SIBLING_GAP: 56,
    START_X: 44,
    START_Y: 40,
    BTN_X_OFFSET: 12,
    BTN_GAP: 20,
    BTN_R: 8,
    BTN_HIT_SLOP: 32,
    BTN_HIT_BIAS_Y: 32,
    EDGE_CURVE: 42
  };
  nodeCanvasParts.constants = constants;

  const {
    NODE_W,
    NODE_H,
    LEVEL_MARGIN,
    MIN_SIBLING_GAP,
    START_X,
    START_Y,
    BTN_X_OFFSET,
    BTN_GAP,
    BTN_R
  } = constants;

  function createPseudoNode(id, text, kind) {
    return {
      id,
      text,
      kind,
      x: 0,
      y: 0,
      subtreeHeight: NODE_H,
      children: []
    };
  }

  function createTaskView(node, config) {
    const connectorLabel = getConnectorLabel(config, node.connector);
    const actionLabel = getActionLabel(config, node.connector, node.action);
    return {
      id: node.id,
      kind: "task",
      nodeRef: node,
      x: 0,
      y: 0,
      subtreeHeight: NODE_H,
      children: [],
      title: connectorLabel,
      subtitle: actionLabel,
      description: String(node.description || "")
    };
  }

  function buildFlowModel(state, config) {
    const start = createPseudoNode("__start__", "START", "start");
    const end = createPseudoNode("__end__", "END", "end");
    const rawById = new Map();
    state.nodes.forEach((node) => {
      ensureNodeDefaults(config, node);
      rawById.set(node.id, node);
    });

    const normalizedNodes = state.nodes.map((node, idx) => {
      let parentId = node.parentId || null;
      if (parentId && !rawById.has(parentId)) parentId = null;
      const parallelOrder = Number(node.parallelOrder) || idx + 1;
      const mergeParentIds = getMergeParentIds(node).filter((id) => rawById.has(id) && id !== parentId);
      return { ...node, parentId, mergeParentIds, parallelOrder };
    });

    const parentKey = (parentId) => parentId || start.id;
    const childrenByParent = new Map();
    function pushChild(parentId, node) {
      const key = parentKey(parentId);
      if (!childrenByParent.has(key)) childrenByParent.set(key, []);
      childrenByParent.get(key).push(node);
    }
    normalizedNodes.forEach((node) => pushChild(node.parentId, node));
    childrenByParent.forEach((arr) => {
      arr.sort((a, b) => {
        const ao = Number(a.parallelOrder) || 1;
        const bo = Number(b.parallelOrder) || 1;
        if (ao !== bo) return ao - bo;
        return 0;
      });
    });
    function getChildren(parentId) {
      return childrenByParent.get(parentKey(parentId)) || [];
    }

    const viewById = new Map();
    normalizedNodes.forEach((node) => viewById.set(node.id, createTaskView(node, config)));

    const loopMetaByRootId = new Map();
    const loopOwnerByNodeId = new Map();
    const loopRootIdByLoopEndId = new Map();

    normalizedNodes.filter((n) => isLoopRootNode(n)).forEach((rootNode) => {
      const chainIds = [];
      const seen = new Set([rootNode.id]);
      let currentId = rootNode.id;
      while (true) {
        const next = getChildren(currentId).find((c) => c.loopOwnerId === rootNode.id);
        if (!next || seen.has(next.id)) break;
        chainIds.push(next.id);
        loopOwnerByNodeId.set(next.id, rootNode.id);
        seen.add(next.id);
        currentId = next.id;
      }

      const outsideIds = getChildren(rootNode.id)
        .filter((c) => c.loopOwnerId !== rootNode.id)
        .map((c) => c.id);
      const loopEndId = `__loop_end__${rootNode.id}`;
      const meta = {
        rootId: rootNode.id,
        loopEndId,
        chainIds,
        chainSet: new Set(chainIds),
        outsideIds
      };
      loopMetaByRootId.set(rootNode.id, meta);
      loopRootIdByLoopEndId.set(loopEndId, rootNode.id);
      viewById.set(loopEndId, createPseudoNode(loopEndId, "繰り返し終了", "loop-end"));
    });

    const displayChildren = new Map();
    const setDisplayChildren = (id, ids) => displayChildren.set(id, (ids || []).filter(Boolean));

    setDisplayChildren(start.id, getChildren(null).map((n) => n.id));

    normalizedNodes.forEach((node) => {
      if (isLoopRootNode(node) && loopMetaByRootId.has(node.id)) {
        const meta = loopMetaByRootId.get(node.id);
        const firstInner = meta.chainIds[0] || null;
        setDisplayChildren(node.id, [firstInner || meta.loopEndId]);
        setDisplayChildren(meta.loopEndId, meta.outsideIds.slice());
        return;
      }

      const ownerRootId = loopOwnerByNodeId.get(node.id);
      if (ownerRootId) {
        const meta = loopMetaByRootId.get(ownerRootId);
        const chain = meta?.chainIds || [];
        const idx = chain.indexOf(node.id);
        const nextInChain = idx >= 0 ? chain[idx + 1] : null;
        const realChildren = getChildren(node.id).map((c) => c.id);
        const extraChildren = realChildren.filter((id) => id !== nextInChain);
        setDisplayChildren(node.id, [nextInChain || meta.loopEndId, ...extraChildren]);
        return;
      }

      setDisplayChildren(node.id, getChildren(node.id).map((n) => n.id));
    });

    loopMetaByRootId.forEach((meta) => {
      if (!displayChildren.has(meta.loopEndId)) {
        setDisplayChildren(meta.loopEndId, meta.outsideIds.slice());
      }
    });

    start.x = START_X;
    start.y = START_Y;

    const depthById = new Map([[start.id, 0]]);
    const nodeMap = new Map([[start.id, start], ...Array.from(viewById.entries()), [end.id, end]]);

    function layoutNode(nodeId, depth, y, visiting) {
      const view = nodeMap.get(nodeId);
      if (!view) return y + NODE_H;
      if (visiting.has(nodeId)) return y + NODE_H;

      visiting.add(nodeId);
      view.x = START_X + LEVEL_MARGIN * depth;
      view.y = y;
      depthById.set(nodeId, depth);

      const children = displayChildren.get(nodeId) || [];
      let bottom = y + NODE_H;
      let childY = y;
      children.forEach((childId) => {
        const childBottom = layoutNode(childId, depth + 1, childY, visiting);
        bottom = Math.max(bottom, childBottom);
        childY = childBottom + MIN_SIBLING_GAP;
      });
      visiting.delete(nodeId);
      return bottom;
    }

    const rootChildren = displayChildren.get(start.id) || [];
    let yCursor = START_Y;
    rootChildren.forEach((childId) => {
      const subtreeBottom = layoutNode(childId, 1, yCursor, new Set([start.id]));
      yCursor = subtreeBottom + MIN_SIBLING_GAP;
    });

    const taskViews = normalizedNodes.map((node) => viewById.get(node.id)).filter(Boolean);
    const loopEndViews = Array.from(loopMetaByRootId.values())
      .map((meta) => viewById.get(meta.loopEndId))
      .filter(Boolean);

    const edges = [];
    const edgeKeys = new Set();
    const pushEdge = (from, to, kind) => {
      if (!from || !to) return;
      const key = `${from}->${to}:${kind}`;
      if (edgeKeys.has(key)) return;
      edgeKeys.add(key);
      edges.push({ from, to, kind });
    };

    displayChildren.forEach((children, parentId) => {
      children.forEach((childId, idx) => {
        const edgeKind = idx === 0 ? "tree" : "parallel";
        pushEdge(parentId, childId, edgeKind);
      });
    });

    normalizedNodes.forEach((node) => {
      (node.mergeParentIds || []).forEach((mergeParentId) => {
        pushEdge(mergeParentId, node.id, "merge");
      });
    });

    const outgoingIds = new Set(edges.map((edge) => edge.from));
    const leaves = [...taskViews, ...loopEndViews].filter((view) => !outgoingIds.has(view.id));
    leaves.forEach((leaf) => {
      const edgeKind = leaf.kind === "loop-end" ? "to-end-main" : "to-end";
      pushEdge(leaf.id, end.id, edgeKind);
    });
    if (!leaves.length) pushEdge(start.id, end.id, "to-end-main");

    const maxDepth = Math.max(1, ...Array.from(depthById.values()));
    end.x = START_X + LEVEL_MARGIN * (maxDepth + 1);
    end.y = START_Y;

    const controls = [];
    function pushInsertControl({ anchorId, rightId, x, y, mode, loopRootId }) {
      controls.push({
        kind: "insert",
        anchorId,
        rightId: rightId || null,
        x,
        y,
        r: BTN_R,
        label: "I",
        mode: mode || "normal",
        loopRootId: loopRootId || null
      });
    }
    function pushParallelControl({ anchorId, rightId, x, y, mode, loopRootId }) {
      controls.push({
        kind: "parallel",
        anchorId,
        rightId: rightId || null,
        x,
        y,
        r: BTN_R,
        label: "P",
        mode: mode || "normal",
        loopRootId: loopRootId || null
      });
    }

    function addNormalControls(anchorId, anchorView) {
      const children = displayChildren.get(anchorId) || [];
      const rightId = children[0] || null;
      const centerY = anchorView.y + NODE_H / 2;
      const cx = anchorView.x + NODE_W + BTN_X_OFFSET;

      if (rightId) {
        pushInsertControl({ anchorId, rightId, x: cx, y: centerY - BTN_GAP / 2 });
        pushParallelControl({ anchorId, rightId, x: cx, y: centerY + BTN_GAP / 2 });
      } else {
        pushInsertControl({ anchorId, rightId: null, x: cx, y: centerY });
      }
    }

    addNormalControls(start.id, start);
    taskViews.forEach((view) => {
      const node = view.nodeRef;
      const cx = view.x + NODE_W + BTN_X_OFFSET;
      const centerY = view.y + NODE_H / 2;
      if (isLoopRootNode(node)) {
        const meta = loopMetaByRootId.get(node.id);
        const rightId = meta?.chainIds?.[0] || meta?.loopEndId || null;
        pushInsertControl({
          anchorId: node.id,
          rightId,
          x: cx,
          y: centerY,
          mode: "loop-root",
          loopRootId: node.id
        });
        return;
      }

      const ownerRootId = loopOwnerByNodeId.get(node.id);
      if (ownerRootId) {
        const meta = loopMetaByRootId.get(ownerRootId);
        const idx = meta?.chainIds?.indexOf(node.id) ?? -1;
        const nextId = idx >= 0 ? (meta.chainIds[idx + 1] || meta.loopEndId) : meta?.loopEndId;
        pushInsertControl({
          anchorId: node.id,
          rightId: nextId || null,
          x: cx,
          y: centerY,
          mode: "loop-internal",
          loopRootId: ownerRootId
        });
        return;
      }

      addNormalControls(node.id, view);
    });

    loopEndViews.forEach((view) => {
      const loopRootId = loopRootIdByLoopEndId.get(view.id) || null;
      const children = displayChildren.get(view.id) || [];
      const rightId = children[0] || null;
      const centerY = view.y + NODE_H / 2;
      const cx = view.x + NODE_W + BTN_X_OFFSET;

      if (rightId) {
        pushInsertControl({
          anchorId: view.id,
          rightId,
          x: cx,
          y: centerY - BTN_GAP / 2,
          mode: "loop-end",
          loopRootId
        });
        pushParallelControl({
          anchorId: view.id,
          rightId,
          x: cx,
          y: centerY + BTN_GAP / 2,
          mode: "loop-end",
          loopRootId
        });
      } else {
        pushInsertControl({
          anchorId: view.id,
          rightId: null,
          x: cx,
          y: centerY,
          mode: "loop-end",
          loopRootId
        });
      }
    });

    const loopFrames = [];
    loopMetaByRootId.forEach((meta) => {
      const ids = [meta.rootId, ...meta.chainIds, meta.loopEndId];
      const views = ids.map((id) => nodeMap.get(id)).filter(Boolean);
      if (!views.length) return;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      views.forEach((v) => {
        minX = Math.min(minX, v.x);
        minY = Math.min(minY, v.y);
        maxX = Math.max(maxX, v.x + NODE_W);
        maxY = Math.max(maxY, v.y + NODE_H);
      });
      const padX = 24;
      const padY = 20;
      loopFrames.push({
        loopRootId: meta.rootId,
        x: minX - padX,
        y: minY - padY,
        w: (maxX - minX) + padX * 2,
        h: (maxY - minY) + padY * 2
      });
    });

    const drawableNodes = [start, ...taskViews, ...loopEndViews, end];
    const maxNodeX = Math.max(START_X, ...drawableNodes.map((n) => n.x));
    const maxNodeY = Math.max(START_Y, ...drawableNodes.map((n) => n.y));
    const maxFrameX = loopFrames.length ? Math.max(...loopFrames.map((f) => f.x + f.w)) : 0;
    const maxFrameY = loopFrames.length ? Math.max(...loopFrames.map((f) => f.y + f.h)) : 0;
    const width = Math.max(end.x + NODE_W + 220, maxNodeX + NODE_W + 220, maxFrameX + 220);
    const height = Math.max(220, maxNodeY + NODE_H + 48, maxFrameY + 48);

    return {
      start,
      end,
      taskViews,
      loopEndViews,
      nodeMap,
      edges,
      controls,
      loopFrames,
      width,
      height
    };
  }

  nodeCanvasParts.buildFlowModel = buildFlowModel;
})();
