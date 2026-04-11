(function () {
  const packages = window.zizPackages || {};
  const corePkg = packages.core || {};
  const dialogApi = corePkg.dialog || null;
  const { el } = (corePkg.utils || {});
  const {
    addNodeAfter,
    addParallelAfter,
    duplicateNodeAfter,
    insertNodeAt,
    addMergeParent,
    clearPendingMergeSource,
    removeMergeParent,
    setPendingMergeSource,
    setSelectedNode
  } = (corePkg.stateOps || {});
  const shared = (packages.ui && packages.ui.nodeShared) || window.uiNodeShared || {};
  const {
    buildNodeClipboardSnapshot,
    isEditingShortcutTarget,
    getMergeParentIds,
    ensureNodeDefaults,
    isMergeableNode,
    getMergeErrorMessage,
    hasMissingRequiredField,
    isLoopRootNode,
    isDraggableNode,
    canDropDraggedNodeOnControl,
    applyDraggedNodeDrop,
    insertLoopInternalAtAnchor,
    insertAfterLoopEnd,
    addParallelAfterLoopEnd,
    getActionLabel,
    getConnectorLabel,
    requestNodeRunById,
    removeNodeById,
    hasInvalidUpstreamReference,
    getConnectorImageSrc,
    NOIMAGE_SRC
  } = shared;
  const NODE_W = 60;
  const NODE_H = 60;
  const LEVEL_MARGIN = 128;
  const MIN_SIBLING_GAP = 56;
  const START_X = 44;
  const START_Y = 40;
  const BTN_X_OFFSET = 12;
  const BTN_GAP = 20;
  const BTN_R = 8;
  const BTN_HIT_SLOP = 32;
  const BTN_HIT_BIAS_Y = 32;
  const EDGE_CURVE = 42;
  const ICON_CACHE = new Map();
  let copiedNodeSnapshot = null;
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
    const subtitle = actionLabel;
    return {
      id: node.id,
      kind: "task",
      nodeRef: node,
      x: 0,
      y: 0,
      subtreeHeight: NODE_H,
      children: [],
      title: connectorLabel,
      subtitle,
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
    const leaves = [...taskViews, ...loopEndViews]
      .filter((view) => !outgoingIds.has(view.id));
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
    const maxFrameX = loopFrames.length
      ? Math.max(...loopFrames.map((f) => f.x + f.w))
      : 0;
    const maxFrameY = loopFrames.length
      ? Math.max(...loopFrames.map((f) => f.y + f.h))
      : 0;
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

  function wrapText(ctx, text, maxWidth) {
    const chars = String(text || "").split("");
    let line = "";
    let lines = [];
    for (let i = 0; i < chars.length; i++) {
      const testLine = line + chars[i];
      if (ctx.measureText(testLine).width > maxWidth && i > 0) {
        lines.push(line);
        line = chars[i];
      } else {
        line = testLine;
      }
    }
    lines.push(line);
    if (lines.length > 2) {
      lines = [lines[0], `${lines[1].slice(0, Math.max(0, lines[1].length - 1))}…`];
    }
    return lines;
  }

  function drawRoundedRect(ctx, x, y, w, h, r) {
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      return;
    }

    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
  }

  function drawOneSideRoundedRect(ctx, x, y, w, h, side) {
    const r = Math.min(h / 2, w / 2);
    const cy = y + h / 2;

    ctx.beginPath();
    if (side === "left") {
      const cx = x + r;
      ctx.moveTo(x + w, y);
      ctx.lineTo(x + r, y);
      ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, true);
      ctx.lineTo(x + w, y + h);
    } else {
      const cx = x + w - r;
      ctx.moveTo(x, y);
      ctx.lineTo(x + w - r, y);
      ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, false);
      ctx.lineTo(x, y + h);
    }
    ctx.closePath();
  }

  function drawArrowHead(ctx, x, y, angle, size, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - size * Math.cos(angle - Math.PI / 6), y - size * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x - size * Math.cos(angle + Math.PI / 6), y - size * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  }

  function getConnectorIconSrc(nodeRef) {
    const explicitConnectorId = String(nodeRef?.form?.selected_connector_icon || "").trim();
    if (explicitConnectorId) {
      return getConnectorImageSrc(explicitConnectorId);
    }
    return getConnectorImageSrc(nodeRef?.connector);
  }

  function ensureConnectorIcon(view, src) {
    if (!src) return null;
    if (ICON_CACHE.has(src)) return ICON_CACHE.get(src);

    const img = new Image();
    img.__failed = false;
    img.onload = () => drawFlowCanvas(view);
    img.onerror = () => {
      if (!img.__fallbackTried && src !== NOIMAGE_SRC) {
        img.__fallbackTried = true;
        img.src = NOIMAGE_SRC;
        return;
      }
      img.__failed = true;
      drawFlowCanvas(view);
    };
    img.src = src;
    ICON_CACHE.set(src, img);
    return img;
  }

  function normalizedSigmoid(t, k, center) {
    const s = (x) => 1 / (1 + Math.exp(-x));
    const min = s((0 - center) * k);
    const max = s((1 - center) * k);
    const cur = s((t - center) * k);
    const denom = max - min || 1;
    return (cur - min) / denom;
  }

  function buildMergeOrthogonalPoints(from, to, style) {
    const sx = from.x + NODE_W;
    const sy = from.y + NODE_H / 2;
    const tx = to.x;
    const ty = to.y + NODE_H / 2;
    const sourceStub = Math.max(18, Math.min(Number(style.turnOffset) || 32, 32));
    const targetInset = Number(style.targetInset) || 18;
    const routeX = sx + sourceStub;
    const entryX = Math.min(tx - targetInset, tx - 12);
    const points = [
      { x: sx, y: sy },
      { x: routeX, y: sy }
    ];

    if (ty < sy) {
      points.push({ x: routeX, y: ty });
      points.push({ x: entryX, y: ty });
    } else {
      const detourDepth = Number(style.detourDepth) || 32;
      const detourY = sy + detourDepth;
      points.push({ x: routeX, y: detourY });
      points.push({ x: entryX, y: detourY });
      points.push({ x: entryX, y: ty });
    }

    points.push({ x: tx, y: ty });
    return points;
  }

  function getNodeMergeMenuState(state, nodeId) {
    const node = state.nodes.find((item) => item.id === nodeId);
    const incomingSources = node ? getMergeParentIds(node) : [];
    const outgoingTargets = state.nodes
      .filter((item) => getMergeParentIds(item).includes(nodeId))
      .map((item) => item.id);
    return {
      incomingSources,
      outgoingTargets
    };
  }

  function drawEdge(ctx, from, to, style) {
    const sx = from.x + NODE_W;
    const sy = from.y + NODE_H / 2;
    const tx = to.x;
    const ty = to.y + NODE_H / 2;

    if (style.mode === "merge_orthogonal") {
      const points = buildMergeOrthogonalPoints(from, to, style);
      const prev = points[points.length - 2];

      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }

      ctx.strokeStyle = style.color;
      ctx.lineWidth = style.width;
      ctx.setLineDash(style.dash || []);
      ctx.stroke();
      ctx.setLineDash([]);

      if (style.arrow) {
        const angle = Math.atan2(ty - prev.y, tx - prev.x);
        drawArrowHead(ctx, tx, ty, angle, style.arrowSize || 6, style.color);
      }
      return;
    }

    const k = style.sigmoidK || 12;
    const center = style.sigmoidBias || 0.82; // right-biased bend
    const steps = Math.max(18, Math.min(64, Math.floor(Math.abs(tx - sx) / 8)));
    let prevX = sx;
    let prevY = sy;

    ctx.beginPath();
    ctx.moveTo(sx, sy);
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const x = sx + (tx - sx) * t;
      const eased = normalizedSigmoid(t, k, center);
      const y = sy + (ty - sy) * eased;
      ctx.lineTo(x, y);
      if (i === steps - 1) {
        prevX = x;
        prevY = y;
      }
    }

    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.setLineDash(style.dash || []);
    ctx.stroke();
    ctx.setLineDash([]);

    if (style.arrow) {
      const angle = Math.atan2(ty - prevY, tx - prevX);
      drawArrowHead(ctx, tx, ty, angle, style.arrowSize || 6, style.color);
    }
  }

  function drawDraggedNodePreview(ctx, view, model) {
    const dragState = view.dragState;
    if (!dragState || !dragState.started) return;

    const draggedView = model.nodeMap.get(dragState.nodeId);
    if (!draggedView || !draggedView.nodeRef) return;
    const rootStyles = getComputedStyle(document.documentElement);
    const surfacePage = rootStyles.getPropertyValue("--surface-page").trim() || "#fffefe";
    const surfaceStrong = rootStyles.getPropertyValue("--surface-strong").trim() || "#4b4e63";
    const dragPreviewStroke = rootStyles.getPropertyValue("--flow-drag-preview-stroke").trim() || "#4b4e63";
    const shadowSoft = rootStyles.getPropertyValue("--alpha-shadow-12").trim() || "rgba(0, 0, 0, 0.12)";

    const x = Math.round(dragState.canvasX - NODE_W / 2);
    const y = Math.round(dragState.canvasY - NODE_H / 2);

    ctx.save();
    ctx.globalAlpha = 0.88;
    ctx.fillStyle = surfacePage;
    ctx.strokeStyle = dragPreviewStroke;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.shadowColor = shadowSoft;
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 3;
    drawRoundedRect(ctx, x, y, NODE_W, NODE_H, 8);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = surfaceStrong;
    ctx.font = "700 10px 'Segoe UI', 'Yu Gothic UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(draggedView.nodeRef.stepName || ""), x + NODE_W / 2, y + NODE_H / 2);
    ctx.restore();
  }

  function drawFlowCanvas(view) {
    const runtime = view.root.__flowRuntime;
    if (!runtime) return;

    const { model, state, config } = runtime;
    const { canvas, ctx } = view;
    const rawDpr = window.devicePixelRatio || 1;
    const dpr = Math.max(1, Math.ceil(rawDpr));
    canvas.width = Math.floor(model.width * dpr);
    canvas.height = Math.floor(model.height * dpr);
    canvas.style.width = `${model.width}px`;
    canvas.style.height = `${model.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.clearRect(0, 0, model.width, model.height);

    const rootStyles = getComputedStyle(document.documentElement);
    const warningNodeFill = rootStyles.getPropertyValue("--brand-200").trim() || "#f9c4df";
    const warningAccent = rootStyles.getPropertyValue("--semantic-error-fg").trim() || "#9e1f5f";
    const warningText = rootStyles.getPropertyValue("--surface-page").trim() || "#fffefe";
    const flowEdgeMain = rootStyles.getPropertyValue("--flow-edge-main").trim() || "#5c6f88";
    const flowEdgeSecondary = rootStyles.getPropertyValue("--flow-edge-secondary").trim() || "#74859d";
    const flowEdgeParallel = rootStyles.getPropertyValue("--flow-edge-parallel").trim() || "#6e829c";
    const flowEdgeMerge = rootStyles.getPropertyValue("--flow-edge-merge").trim() || "#129d7a";
    const flowNodeBorder = rootStyles.getPropertyValue("--flow-node-border").trim() || "#9aa5b6";
    const flowNodeBorderSelected = rootStyles.getPropertyValue("--flow-node-border-selected").trim() || "#4b4e63";
    const flowNodeStatusRunning = rootStyles.getPropertyValue("--flow-node-status-running").trim() || "#3b82f6";
    const flowNodeStatusSuccess = rootStyles.getPropertyValue("--flow-node-status-success").trim() || "#16a34a";
    const flowNodeStatusError = rootStyles.getPropertyValue("--flow-node-status-error").trim() || "#dc2626";
    const flowNodeSubtext = rootStyles.getPropertyValue("--flow-node-subtext").trim() || "#626b7b";
    const flowNodeShadow = rootStyles.getPropertyValue("--alpha-shadow-10").trim() || "rgba(79, 67, 67, 0.68)";
    const flowLoopFrameFill = rootStyles.getPropertyValue("--flow-loop-frame-fill").trim() || "#eef8ee";
    const flowLoopFrameStroke = rootStyles.getPropertyValue("--flow-loop-frame-stroke").trim() || "#1a7259";
    const flowStepBadgeBorder = rootStyles.getPropertyValue("--flow-step-badge-border").trim() || "#c8cad8";
    const flowControlFillActive = rootStyles.getPropertyValue("--flow-control-fill-active").trim() || "#4b4e63";
    const flowControlStroke = rootStyles.getPropertyValue("--flow-control-stroke").trim() || "#bdbdbd";
    const flowControlStrokeActive = rootStyles.getPropertyValue("--flow-control-stroke-active").trim() || "#4b4e63";
    const flowControlText = rootStyles.getPropertyValue("--flow-control-text").trim() || "#4b4e63";
    const flowControlTextActive = rootStyles.getPropertyValue("--flow-control-text-active").trim() || "#fffefe";
    const surfaceStrong = rootStyles.getPropertyValue("--surface-strong").trim() || "#4b4e63";
    const surfacePage = rootStyles.getPropertyValue("--surface-page").trim() || "#fffefe";
    const surfaceHover = rootStyles.getPropertyValue("--surface-hover").trim() || "#ececf4";
    const surfacePseudo = rootStyles.getPropertyValue("--border-grid-flow").trim() || "#e8eaf2";
    const textMuted = rootStyles.getPropertyValue("--text-muted").trim() || "#767b93";
    const textPrimary = rootStyles.getPropertyValue("--text-primary").trim() || "#4b4e63";
    const pseudoNodeBorder = rootStyles.getPropertyValue("--border-grid").trim() || "#e1e3ec";

    (model.loopFrames || []).forEach((frame) => {
      ctx.fillStyle = flowLoopFrameFill;
      drawRoundedRect(ctx, frame.x, frame.y, frame.w, frame.h, 12);
      ctx.fill();
      ctx.strokeStyle = flowLoopFrameStroke;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      drawRoundedRect(ctx, frame.x, frame.y, frame.w, frame.h, 12);
      ctx.stroke();
    });

    model.edges.forEach((edge) => {
      const from = model.nodeMap.get(edge.from);
      const to = model.nodeMap.get(edge.to);
      if (!from || !to) return;
      drawEdge(ctx, from, to, {
        color:
          edge.kind === "to-end-main" ? flowEdgeMain :
          edge.kind === "to-end" ? flowEdgeSecondary :
          edge.kind === "merge" ? flowEdgeMerge :
          edge.kind === "parallel" ? flowEdgeParallel : flowEdgeMain,
        width:
          edge.kind === "to-end-main" ? 2.2 :
          edge.kind === "to-end" ? 1.3 :
          edge.kind === "merge" ? 1.8 :
          edge.kind === "parallel" ? 1.3 : 2.2,
        dash:
          edge.kind === "to-end-main" ? [] :
          edge.kind === "to-end" ? [4, 3] :
          edge.kind === "merge" ? [8, 4] :
          edge.kind === "parallel" ? [3, 3] : [],
        mode: edge.kind === "merge" ? "merge_orthogonal" : edge.kind === "parallel" ? "parallel_branch" : "horizontal",
        sigmoidBias: edge.kind === "parallel" ? 0.88 : edge.kind === "merge" ? 0.84 : 0.92,
        sigmoidK: edge.kind === "parallel" ? 10 : edge.kind === "merge" ? 9 : 12,
        arrow: true,
        arrowSize: edge.kind === "parallel" || edge.kind === "merge" ? 5 : edge.kind === "to-end" ? 5 : 6,
        turnOffset: edge.kind === "merge" ? 28 : 56,
        targetInset: edge.kind === "merge" ? 18 : 0,
        detourDepth: edge.kind === "merge" ? 64 : 0
      });
    });

    if (view.mergeDragState && view.mergeDragState.sourceId) {
      const sourceNode = model.nodeMap.get(view.mergeDragState.sourceId);
      if (sourceNode) {
        const targetNode = view.mergeDragState.targetNodeId
          ? model.nodeMap.get(view.mergeDragState.targetNodeId)
          : null;
        const previewTo = targetNode || {
          x: Math.max(sourceNode.x + NODE_W + 18, view.mergeDragState.canvasX || sourceNode.x + NODE_W + 18),
          y: (view.mergeDragState.canvasY || (sourceNode.y + NODE_H / 2)) - NODE_H / 2
        };
        drawEdge(ctx, sourceNode, previewTo, {
          color: flowEdgeMerge,
          width: 1.4,
          dash: [6, 4],
          mode: "merge_orthogonal",
          arrow: false,
          turnOffset: 28,
          targetInset: 18,
          detourDepth: 64
        });
      }
    }

    const alertNodeIds = new Set(
      model.taskViews
        .filter((taskView) =>
          hasMissingRequiredField(config, taskView.nodeRef) ||
          hasInvalidUpstreamReference(config, state, taskView.nodeRef)
        )
        .map((taskView) => taskView.id)
    );

    const nodesToDraw = [model.start, ...model.taskViews, ...(model.loopEndViews || []), model.end];
    nodesToDraw.forEach((node) => {
      const isStart = node.kind === "start";
      const isEnd = node.kind === "end";
      const isTask = node.kind === "task";
      const isLoopEnd = node.kind === "loop-end";
      const isSelected = (isTask || isStart) && state.selectedNodeId === node.id;
      const isParallel = isTask && !!node.nodeRef.parallelOf;
      const isDraggingNode = !!(view.dragState && view.dragState.started && view.dragState.nodeId === node.id);
      const hasAlert = isTask && alertNodeIds.has(node.id);
      const hasInvalidReference = isTask && hasInvalidUpstreamReference(config, state, node.nodeRef);
      const stepStatus = isTask ? String((state.stepStatuses && state.stepStatuses[node.nodeRef.stepName]) || "") : "";
      const statusStrokeColor =
        stepStatus === "running" ? flowNodeStatusRunning :
        stepStatus === "success" ? flowNodeStatusSuccess :
        stepStatus === "error" ? flowNodeStatusError : "";
      const statusStrokeWidth =
        stepStatus === "running" || stepStatus === "error" ? 3 :
        stepStatus === "success" ? 2 : 0;
      const pseudoNodeInset = isStart || isEnd ? 9 : 0;
      const drawX = node.x + pseudoNodeInset;
      const drawY = node.y + pseudoNodeInset;
      const drawW = NODE_W - pseudoNodeInset * 2;
      const drawH = NODE_H - pseudoNodeInset * 2;

      if (isParallel) ctx.setLineDash([4, 2]);
      else ctx.setLineDash([]);

      if (isStart) ctx.fillStyle = surfacePseudo;
      else if (isEnd) ctx.fillStyle = surfacePseudo;
      // else if (isTask && hasAlert) ctx.fillStyle = warningNodeFill;
      else ctx.fillStyle = surfacePage;

      ctx.globalAlpha = isDraggingNode ? 0.28 : 1;
      ctx.shadowColor = flowNodeShadow;
      ctx.shadowBlur = isStart || isEnd ? 2 : isSelected ? 7 : 5;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = isStart || isEnd ? 1 : 2;
      ctx.strokeStyle = isStart || isEnd
        ? (isSelected ? flowNodeBorderSelected : pseudoNodeBorder)
        : statusStrokeColor || (isSelected ? flowNodeBorderSelected : flowNodeBorder);
      ctx.lineWidth = isStart || isEnd ? (isSelected ? 2 : 1) : Math.max(statusStrokeWidth, isSelected ? 2 : 1);
      if (isStart) {
        drawOneSideRoundedRect(ctx, drawX, drawY, drawW, drawH, "left");
      } else if (isEnd) {
        drawOneSideRoundedRect(ctx, drawX, drawY, drawW, drawH, "right");
      } else {
        drawRoundedRect(ctx, node.x, node.y, NODE_W, NODE_H, 8);
      }
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.globalAlpha = 1;

      if (isTask) {
        const badgeText = String(node.nodeRef.stepName || "");
        ctx.font = "700 10px 'Segoe UI', 'Yu Gothic UI', sans-serif";
        const tw = Math.ceil(ctx.measureText(badgeText).width);
        const bw = Math.max(36, tw + 12);
        const bh = 16;
        const bx = Math.round(node.x + (NODE_W - bw) / 2);
        const by = Math.round(node.y - Math.floor(bh / 2));
        ctx.fillStyle = surfacePage;
        ctx.strokeStyle = flowStepBadgeBorder;
        ctx.lineWidth = 1;
        drawRoundedRect(ctx, bx, by, bw, bh, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = textMuted;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(badgeText, bx + bw / 2, by + bh / 2);
        ctx.textBaseline = "alphabetic";
      }

      if (hasAlert) {
        const markerR = 8;
        const markerX = node.x + NODE_W - 2;
        const markerY = node.y + 4;
        ctx.fillStyle = warningAccent;
        ctx.beginPath();
        ctx.arc(markerX, markerY, markerR, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = warningText;
        ctx.font = "700 11px 'Segoe UI', 'Yu Gothic UI', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("!", markerX, markerY + 0.5);
        ctx.textBaseline = "alphabetic";
      }

      const iconSrc = isTask ? getConnectorIconSrc(node.nodeRef) : null;
      const icon = iconSrc ? ensureConnectorIcon(view, iconSrc) : null;
      const hasIcon = !!(icon && !icon.__failed && icon.complete && icon.naturalWidth > 0);

      ctx.fillStyle = isStart || isEnd ? surfacePage : surfaceStrong;
      ctx.font = isStart || isEnd
        ? "700 12px 'Segoe UI', 'Yu Gothic UI', sans-serif"
        : "700 15px 'Segoe UI', 'Yu Gothic UI', sans-serif";
      ctx.textAlign = "center";
      if (isStart) {
        const cx = drawX + drawW / 2;
        const cy = drawY + drawH / 2;
        const radius = 10;
        ctx.strokeStyle = surfaceStrong;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = surfaceStrong;
        ctx.beginPath();
        ctx.moveTo(cx - 3, cy - 5);
        ctx.lineTo(cx - 3, cy + 5);
        ctx.lineTo(cx + 5, cy);
        ctx.closePath();
        ctx.fill();
      } else if (isEnd) {
        ctx.textBaseline = "middle";
        ctx.textBaseline = "alphabetic";
      } else if (isLoopEnd) {
        ctx.font = "700 10px 'Segoe UI', 'Yu Gothic UI', sans-serif";
        ctx.textBaseline = "middle";
        ctx.fillText(node.text, node.x + NODE_W / 2, node.y + NODE_H / 2);
        ctx.textBaseline = "alphabetic";
      } else if (!hasIcon) {
        ctx.fillText(node.nodeRef.stepName, node.x + NODE_W / 2, node.y + 32);
      }

      if (isTask && hasIcon) {
        const pad = 14;
        const maxW = NODE_W - pad * 2;
        const maxH = NODE_H - pad * 2;
        const ratio = Math.min(maxW / icon.naturalWidth, maxH / icon.naturalHeight) * 1.15;
        const w = Math.max(1, Math.floor(icon.naturalWidth * ratio));
        const h = Math.max(1, Math.floor(icon.naturalHeight * ratio));
        const x = Math.round(node.x + (NODE_W - w) / 2);
        const y = Math.round(node.y + (NODE_H - h) / 2);
        ctx.drawImage(icon, x, y, w, h);
      } else if (isTask) {
        ctx.font = "14px 'Segoe UI', 'Yu Gothic UI', sans-serif";
        const titleLines = wrapText(ctx, node.title, NODE_W - 16);
        const subtitleLines = wrapText(ctx, node.subtitle, NODE_W - 16);
        const lines = [...titleLines, ...subtitleLines].slice(0, 2);
        lines.forEach((line, idx) => {
          ctx.fillText(line, node.x + NODE_W / 2, node.y + 56 + idx * 18);
        });
      }

      if (isTask) {
        ctx.fillStyle = textPrimary;
        ctx.font = "11px 'Segoe UI', 'Yu Gothic UI', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        if (String(node.description || "").trim()) {
          const descriptionLines = wrapText(ctx, node.description, NODE_W + 40);
          descriptionLines.forEach((line, idx) => {
            ctx.fillText(line, node.x + NODE_W / 2, node.y + NODE_H + 6 + idx * 13);
          });
        }
        ctx.textBaseline = "alphabetic";
      }
    });

    drawDraggedNodePreview(ctx, view, model);

    model.controls.forEach((ctrl) => {
      const isDropTarget = view.dropControl === ctrl;
      const isHover = view.hoverControl === ctrl || isDropTarget;
      ctx.fillStyle = isDropTarget ? flowControlFillActive : surfacePage;
      ctx.strokeStyle = isHover ? flowControlStrokeActive : flowControlStroke;
      ctx.lineWidth = isHover ? 2 : 1;
      ctx.beginPath();
      ctx.arc(ctrl.x, ctrl.y, ctrl.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = isDropTarget ? flowControlTextActive : (isHover ? flowControlStrokeActive : flowControlText);
      ctx.font = "700 10px 'Segoe UI', 'Yu Gothic UI', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(ctrl.label, ctrl.x, ctrl.y + 3);
    });
  }

  function hitTask(model, x, y) {
    for (let i = model.taskViews.length - 1; i >= 0; i--) {
      const n = model.taskViews[i];
      if (x >= n.x && x <= n.x + NODE_W && y >= n.y && y <= n.y + NODE_H) return n;
    }
    return null;
  }

  function hitSelectableNode(model, x, y) {
    const task = hitTask(model, x, y);
    if (task) return task;
    const start = model.start;
    if (start && x >= start.x && x <= start.x + NODE_W && y >= start.y && y <= start.y + NODE_H) {
      return start;
    }
    return null;
  }

  function hasSiblingControlPair(model, control) {
    return model.controls.some((candidate) =>
      candidate !== control &&
      candidate.anchorId === control.anchorId &&
      candidate.rightId === control.rightId &&
      candidate.mode === control.mode &&
      candidate.loopRootId === control.loopRootId &&
      candidate.kind !== control.kind
    );
  }

  function hitControl(model, x, y, options = {}) {
    const expanded = !!options.expanded;
    for (let i = model.controls.length - 1; i >= 0; i--) {
      const c = model.controls[i];
      const hasPair = hasSiblingControlPair(model, c);
      const hitCenterY = hasPair
        ? c.y + (c.kind === "insert" ? -BTN_HIT_BIAS_Y : BTN_HIT_BIAS_Y)
        : c.y;
      if (expanded) {
        const halfW = c.r + BTN_HIT_SLOP;
        const halfH = c.r + BTN_HIT_SLOP;
        const insideX = x >= c.x - halfW && x <= c.x + halfW;
        const insideY = y >= hitCenterY - halfH && y <= hitCenterY + halfH;
        if (insideX && insideY) return c;
        continue;
      }
      if (Math.hypot(x - c.x, y - c.y) <= c.r + 2) return c;
    }
    return null;
  }

  function getControlTooltip(ctrl, dragState) {
    if (!ctrl) return "";
    if (dragState && dragState.started) {
      if (ctrl.kind === "insert") return "挿入する";
      if (ctrl.kind === "parallel") return "並行フローを挿入する";
    }
    if (ctrl.label === "I" || ctrl.kind === "insert") return "ステップを挿入";
    if (ctrl.label === "P" || ctrl.kind === "parallel") return "ステップを並列で挿入";
    return "";
  }

  function createImmediateTooltip() {
    const rootStyles = getComputedStyle(document.documentElement);
    const tip = document.createElement("div");
    tip.style.position = "fixed";
    tip.style.left = "-9999px";
    tip.style.top = "-9999px";
    tip.style.pointerEvents = "none";
    tip.style.zIndex = "9999";
    tip.style.padding = "4px 8px";
    tip.style.borderRadius = "6px";
    tip.style.background = rootStyles.getPropertyValue("--surface-strong").trim() || "#4b4e63";
    tip.style.color = rootStyles.getPropertyValue("--surface-page").trim() || "#fffefe";
    tip.style.font = "12px 'Segoe UI', 'Yu Gothic UI', sans-serif";
    tip.style.whiteSpace = "nowrap";
    tip.style.opacity = "0";
    tip.style.transition = "opacity 80ms linear";
    document.body.appendChild(tip);
    return tip;
  }

  function destroyFlowCanvas(root) {
    const view = root?.__flowView;
    if (!view) return;
    try { view.menuEl?.remove?.(); } catch (_) {}
    try { view.tooltipEl?.remove?.(); } catch (_) {}
    try { view.canvas?.remove?.(); } catch (_) {}
    delete root.__flowView;
    delete root.__flowRuntime;
  }

  function ensureFlowCanvas(root) {
    if (root.__flowView) {
      const existingView = root.__flowView;
      if (existingView.canvas?.parentElement === root) {
        return existingView;
      }
      destroyFlowCanvas(root);
    }

    root.innerHTML = "";
    root.style.overflowX = "auto";
    root.style.overflowY = "auto";
    const canvas = document.createElement("canvas");
    canvas.className = "flow-canvas";
    canvas.title = "";
    root.appendChild(canvas);
    const menuEl = document.createElement("div");
    menuEl.className = "flow-context-menu";
    menuEl.setAttribute("role", "menu");
    menuEl.setAttribute("aria-hidden", "true");
    document.body.appendChild(menuEl);
    const ctx = canvas.getContext("2d");
    const tooltipEl = createImmediateTooltip();
    const view = {
      root,
      canvas,
      ctx,
      hoverControl: null,
      dropControl: null,
      dragState: null,
      pendingMergeDrag: null,
      mergeDragState: null,
      suppressContextMenuOnce: false,
      tooltipEl,
      menuEl,
      menuNodeId: null
    };
    root.__flowView = view;

    function hideTooltip() {
      tooltipEl.style.opacity = "0";
      tooltipEl.style.left = "-9999px";
      tooltipEl.style.top = "-9999px";
      tooltipEl.textContent = "";
    }

    function showTooltip(ctrl, clientX, clientY) {
      const text = getControlTooltip(ctrl, view.dragState);
      if (!text) {
        hideTooltip();
        return;
      }
      tooltipEl.textContent = text;
      tooltipEl.style.left = `${clientX + 12}px`;
      tooltipEl.style.top = `${clientY + 12}px`;
      tooltipEl.style.opacity = "1";
    }

    function hideContextMenu() {
      view.menuNodeId = null;
      menuEl.classList.remove("is-open");
      menuEl.style.left = "-9999px";
      menuEl.style.top = "-9999px";
      menuEl.setAttribute("aria-hidden", "true");
    }

    function showContextMenu(target, clientX, clientY) {
      view.menuNodeId = target?.nodeId || null;
      const runtime = root.__flowRuntime;
      const items = [];
      if (runtime && view.menuNodeId) {
        const mergeMenuState = getNodeMergeMenuState(runtime.state, view.menuNodeId);
        if (mergeMenuState.incomingSources.length) {
          items.push('<button class="flow-context-menu__item is-danger" type="button" data-action="remove-merge-incoming" role="menuitem">合流を解除</button>');
        }
        if (mergeMenuState.outgoingTargets.length) {
          items.push('<button class="flow-context-menu__item is-danger" type="button" data-action="remove-merge-outgoing" role="menuitem">合流を解除</button>');
        }
      }
      items.push('<button class="flow-context-menu__item" type="button" data-action="run" role="menuitem">実行</button>');
      items.push('<button class="flow-context-menu__item is-danger" type="button" data-action="delete" role="menuitem">削除</button>');
      menuEl.innerHTML = items.join("");
      menuEl.style.left = `${clientX}px`;
      menuEl.style.top = `${clientY}px`;
      menuEl.classList.add("is-open");
      menuEl.setAttribute("aria-hidden", "false");
    }

    let pendingDrag = null;

    canvas.addEventListener("mousemove", (e) => {
      if (view.dragState || pendingDrag || isPanning) return;
      const runtime = root.__flowRuntime;
      if (!runtime) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      view.hoverControl = hitControl(runtime.model, x, y);
      view.dropControl = null;
      showTooltip(view.hoverControl, e.clientX, e.clientY);
      const hoverNode = hitSelectableNode(runtime.model, x, y);
      canvas.style.cursor = view.hoverControl || hoverNode ? "pointer" : "default";
      drawFlowCanvas(view);
    });

    canvas.addEventListener("mouseleave", () => {
      if (view.dragState || pendingDrag) return;
      view.hoverControl = null;
      view.dropControl = null;
      hideTooltip();
      canvas.style.cursor = "default";
      drawFlowCanvas(view);
    });

    root.addEventListener("wheel", (e) => {
      // Horizontal wheel/Shift+wheel pans left-right.
      // Normal vertical wheel is kept as-is for up/down scrolling.
      const horizontalIntent = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (!horizontalIntent) return;
      const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
      if (delta === 0) return;
      root.scrollLeft += delta;
      e.preventDefault();
    }, { passive: false });

    canvas.addEventListener("contextmenu", (e) => {
      const runtime = root.__flowRuntime;
      if (!runtime) return;
      if (view.suppressContextMenuOnce) {
        view.suppressContextMenuOnce = false;
        e.preventDefault();
        hideContextMenu();
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const task = hitTask(runtime.model, x, y);
      if (!task) {
        hideContextMenu();
        return;
      }
      e.preventDefault();
      hideTooltip();
      setSelectedNode(runtime.state, task.id);
      runtime.onStateChanged();
      showContextMenu({ nodeId: task.id }, e.clientX, e.clientY);
    });

    let isPanning = false;
    let panMoved = false;
    let panStartX = 0;
    let panStartY = 0;
    let panStartScrollLeft = 0;
    let panStartScrollTop = 0;
    let lastPanAt = 0;
    canvas.addEventListener("mousedown", (e) => {
      hideContextMenu();
      const runtime = root.__flowRuntime;
      if (!runtime) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const task = hitTask(runtime.model, x, y);
      if (e.button === 2) {
        if (!task || !isMergeableNode(task.nodeRef)) return;
        view.pendingMergeDrag = {
          sourceId: task.id,
          startClientX: e.clientX,
          startClientY: e.clientY,
          canvasX: x,
          canvasY: y,
          started: false
        };
        return;
      }
      if (e.button !== 0) return;
      if (task && isDraggableNode(task.nodeRef)) {
        pendingDrag = {
          nodeId: task.id,
          startClientX: e.clientX,
          startClientY: e.clientY
        };
        view.hoverControl = null;
        view.dropControl = null;
        hideTooltip();
        document.body.style.userSelect = "none";
        e.preventDefault();
        return;
      }
      isPanning = true;
      panMoved = false;
      hideTooltip();
      panStartX = e.clientX;
      panStartY = e.clientY;
      panStartScrollLeft = root.scrollLeft;
      panStartScrollTop = root.scrollTop;
      canvas.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (view.pendingMergeDrag && !view.mergeDragState) {
        const moveDx = e.clientX - view.pendingMergeDrag.startClientX;
        const moveDy = e.clientY - view.pendingMergeDrag.startClientY;
        if (Math.hypot(moveDx, moveDy) >= 5) {
          const runtime = root.__flowRuntime;
          if (!runtime) return;
          setSelectedNode(runtime.state, view.pendingMergeDrag.sourceId);
          setPendingMergeSource(runtime.state, view.pendingMergeDrag.sourceId);
          view.mergeDragState = {
            sourceId: view.pendingMergeDrag.sourceId,
            targetNodeId: null,
            canvasX: view.pendingMergeDrag.canvasX,
            canvasY: view.pendingMergeDrag.canvasY
          };
          view.pendingMergeDrag = null;
          view.suppressContextMenuOnce = true;
          canvas.style.cursor = "crosshair";
          document.body.style.userSelect = "none";
          runtime.onStateChanged();
        }
      }
      if (view.mergeDragState) {
        const runtime = root.__flowRuntime;
        if (!runtime) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const hoveredTask = hitTask(runtime.model, x, y);
        view.mergeDragState.canvasX = x;
        view.mergeDragState.canvasY = y;
        view.mergeDragState.targetNodeId = hoveredTask && isMergeableNode(hoveredTask.nodeRef) && hoveredTask.id !== view.mergeDragState.sourceId
          ? hoveredTask.id
          : null;
        canvas.style.cursor = view.mergeDragState.targetNodeId ? "copy" : "crosshair";
        drawFlowCanvas(view);
        return;
      }
      if (pendingDrag) {
        const moveDx = e.clientX - pendingDrag.startClientX;
        const moveDy = e.clientY - pendingDrag.startClientY;
        if (!view.dragState && Math.hypot(moveDx, moveDy) < 5) return;

        const runtime = root.__flowRuntime;
        if (!runtime) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const hoveredControl = hitControl(runtime.model, x, y, { expanded: true });
        const dropControl = canDropDraggedNodeOnControl(runtime.state, pendingDrag.nodeId, hoveredControl)
          ? hoveredControl
          : null;

        view.dragState = {
          nodeId: pendingDrag.nodeId,
          started: true,
          canvasX: x,
          canvasY: y
        };
        view.hoverControl = dropControl;
        view.dropControl = dropControl;
        canvas.style.cursor = dropControl ? "copy" : "grabbing";
        if (dropControl) showTooltip(dropControl, e.clientX, e.clientY);
        else hideTooltip();
        drawFlowCanvas(view);
        return;
      }
      if (!isPanning) return;
      const dx = e.clientX - panStartX;
      const dy = e.clientY - panStartY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) panMoved = true;
      root.scrollLeft = panStartScrollLeft - dx;
      root.scrollTop = panStartScrollTop - dy;
    });
    window.addEventListener("mouseup", () => {
      if (view.pendingMergeDrag) {
        view.pendingMergeDrag = null;
        return;
      }
      if (view.mergeDragState) {
        const runtime = root.__flowRuntime;
        const sourceId = view.mergeDragState.sourceId;
        const targetNodeId = view.mergeDragState.targetNodeId;
        view.mergeDragState = null;
        canvas.style.cursor = "default";
        document.body.style.userSelect = "";
        if (runtime) {
          if (sourceId && targetNodeId) {
            const result = addMergeParent(runtime.state, sourceId, targetNodeId);
            if (!result?.ok) {
              if (dialogApi?.show) dialogApi.show(getMergeErrorMessage(result), { kind: "warning", title: "合流" });
              else alert(getMergeErrorMessage(result));
            }
          }
          clearPendingMergeSource(runtime.state);
          runtime.onStateChanged();
        } else {
          drawFlowCanvas(view);
        }
        return;
      }
      if (pendingDrag) {
        const runtime = root.__flowRuntime;
        const draggingNodeId = pendingDrag.nodeId;
        const dropControl = view.dropControl;
        const didDrag = !!view.dragState;

        pendingDrag = null;
        document.body.style.userSelect = "";
        hideTooltip();
        canvas.style.cursor = "default";
        view.dragState = null;
        view.hoverControl = null;
        view.dropControl = null;

        if (didDrag) {
          lastPanAt = Date.now();
          const moved = runtime ? applyDraggedNodeDrop(runtime.state, draggingNodeId, dropControl) : false;
          if (moved && runtime) {
            runtime.onStateChanged();
            return;
          }
          drawFlowCanvas(view);
        }
        return;
      }
      if (!isPanning) return;
      if (panMoved) lastPanAt = Date.now();
      isPanning = false;
      panMoved = false;
      canvas.style.cursor = "default";
      document.body.style.userSelect = "";
    });

    menuEl.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const runtime = root.__flowRuntime;
      const nodeId = view.menuNodeId;
      hideContextMenu();
      if (!runtime) return;
      if (!nodeId) return;
      if (btn.dataset.action === "remove-merge-incoming") {
        const node = runtime.state.nodes.find((item) => item.id === nodeId);
        const incomingSources = node ? getMergeParentIds(node) : [];
        const changed = incomingSources.some((sourceId) => removeMergeParent(runtime.state, sourceId, nodeId));
        if (changed) runtime.onStateChanged();
        return;
      }
      if (btn.dataset.action === "remove-merge-outgoing") {
        const changed = runtime.state.nodes.some((item) =>
          getMergeParentIds(item).includes(nodeId) && removeMergeParent(runtime.state, nodeId, item.id)
        );
        if (changed) runtime.onStateChanged();
        return;
      }
      if (btn.dataset.action === "run") {
        requestNodeRunById(runtime.state, nodeId, "single", runtime.onStateChanged);
        return;
      }
      if (btn.dataset.action === "delete") {
        removeNodeById(runtime.state, nodeId, runtime.onStateChanged);
      }
    });

    canvas.addEventListener("click", (e) => {
      hideContextMenu();
      if (Date.now() - lastPanAt < 180) return;
      hideTooltip();
      const runtime = root.__flowRuntime;
      if (!runtime) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const control = hitControl(runtime.model, x, y);
      if (control) {
        if (control.mode === "loop-root" || control.mode === "loop-internal") {
          if (control.kind === "insert") {
            const created = insertLoopInternalAtAnchor(
              runtime.state,
              control.loopRootId || control.anchorId,
              control.anchorId
            );
            if (created) runtime.onStateChanged();
          }
          return;
        }

        if (control.mode === "loop-end") {
          if (control.kind === "insert") {
            const created = insertAfterLoopEnd(
              runtime.state,
              control.loopRootId,
              control.rightId || null
            );
            if (created) runtime.onStateChanged();
            return;
          }
          if (control.kind === "parallel") {
            const created = addParallelAfterLoopEnd(
              runtime.state,
              control.loopRootId,
              control.rightId || null
            );
            if (created) runtime.onStateChanged();
            return;
          }
        }

        const rightIndex = control.rightId
          ? runtime.state.nodes.findIndex((n) => n.id === control.rightId)
          : -1;
        const anchorIndex = control.anchorId && control.anchorId !== "__start__"
          ? runtime.state.nodes.findIndex((n) => n.id === control.anchorId)
          : -1;

        if (control.kind === "insert") {
          if (control.rightId === null) {
            if (anchorIndex >= 0) addNodeAfter(runtime.state, anchorIndex);
            else insertNodeAt(runtime.state, 0);
          } else if (anchorIndex >= 0) {
            addNodeAfter(runtime.state, anchorIndex);
          } else if (rightIndex >= 0) {
            insertNodeAt(runtime.state, rightIndex);
          }
          runtime.onStateChanged();
          return;
        }

        if (control.kind === "parallel" && rightIndex >= 0) {
          addParallelAfter(runtime.state, rightIndex, { parentId: control.anchorId });
          runtime.onStateChanged();
          return;
        }
      }

      const targetNode = hitSelectableNode(runtime.model, x, y);
      if (targetNode) {
        setSelectedNode(runtime.state, targetNode.id);
        runtime.onStateChanged();
      }
    });

    window.addEventListener("pointerdown", (e) => {
      if (!menuEl.classList.contains("is-open")) return;
      if (menuEl.contains(e.target)) return;
      hideContextMenu();
    });

    window.addEventListener("keydown", (e) => {
      console.debug("[flow-shortcut] keydown", {
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        targetTag: e.target?.tagName || null
      });
      if (e.key === "Escape") hideContextMenu();
      const runtime = root.__flowRuntime;
      if (!runtime) {
        console.debug("[flow-shortcut] runtime missing");
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (isEditingShortcutTarget(e.target)) {
        console.debug("[flow-shortcut] ignored because editing target");
        return;
      }

      const key = String(e.key || "").toLowerCase();
      if (key === "c") {
        const selectedNode = runtime.state.nodes.find((node) => node.id === runtime.state.selectedNodeId);
        console.debug("[flow-shortcut] copy requested", {
          selectedNodeId: runtime.state.selectedNodeId,
          selectedStepName: selectedNode?.stepName || null
        });
        copiedNodeSnapshot = buildNodeClipboardSnapshot(selectedNode);
        if (copiedNodeSnapshot) {
          console.debug("[flow-shortcut] copied", copiedNodeSnapshot);
          e.preventDefault();
        } else {
          console.debug("[flow-shortcut] copy skipped");
        }
        return;
      }
      if (key === "v") {
        if (!copiedNodeSnapshot) {
          console.debug("[flow-shortcut] paste skipped because clipboard empty");
          return;
        }
        const selectedNode = runtime.state.nodes.find((node) => node.id === runtime.state.selectedNodeId);
        console.debug("[flow-shortcut] paste requested", {
          selectedNodeId: runtime.state.selectedNodeId,
          selectedStepName: selectedNode?.stepName || null
        });
        if (!selectedNode || isLoopRootNode(selectedNode) || selectedNode.loopOwnerId) {
          console.debug("[flow-shortcut] paste skipped because selected node is invalid");
          return;
        }
        const duplicated = duplicateNodeAfter?.(runtime.state, selectedNode.id, copiedNodeSnapshot);
        if (duplicated) {
          console.debug("[flow-shortcut] paste succeeded");
          e.preventDefault();
          runtime.onStateChanged();
        } else {
          console.debug("[flow-shortcut] paste failed");
        }
      }
    });

    window.addEventListener("resize", () => {
      hideContextMenu();
      drawFlowCanvas(view);
    });

    return view;
  }

  function renderFlowChart({ root, state, config, onStateChanged }) {
    try {
      state.nodes.forEach((node) => ensureNodeDefaults(config, node));
      const model = buildFlowModel(state, config);
      const view = ensureFlowCanvas(root);
      root.__flowRuntime = { state, config, model, onStateChanged };
      drawFlowCanvas(view);
    } catch (err) {
      console.error("flowchart render failed", err);
      root.innerHTML = "";
      const msg = el("div", { class: "flow-fallback" }, [
        document.createTextNode("フローチャート描画に失敗しました。状態を確認してください。")
      ]);
      root.appendChild(msg);
    }
  }
  const nodeCanvas = { renderFlowChart, destroyFlowCanvas };
  window.uiNodeCanvas = nodeCanvas;
  const packagesOut = window.zizPackages = window.zizPackages || {};
  const uiOut = packagesOut.ui = packagesOut.ui || {};
  uiOut.nodeCanvas = nodeCanvas;
})();
