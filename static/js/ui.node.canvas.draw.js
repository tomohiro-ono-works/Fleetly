(function () {
  const packages = window.zizPackages = window.zizPackages || {};
  const uiPkg = packages.ui = packages.ui || {};
  const shared = uiPkg.nodeShared || window.uiNodeShared || {};
  const {
    hasMissingRequiredField,
    hasInvalidUpstreamReference,
    getConnectorImageSrc,
    NOIMAGE_SRC
  } = shared;

  const nodeCanvasParts = uiPkg.nodeCanvasParts = uiPkg.nodeCanvasParts || window.uiNodeCanvasParts || {};
  window.uiNodeCanvasParts = nodeCanvasParts;
  const constants = nodeCanvasParts.constants || {};
  const { NODE_W, NODE_H } = constants;
  const ICON_CACHE = new Map();

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

  function getRoundedRectPerimeter(width, height, radius) {
    return ((width - radius * 2) * 2) + ((height - radius * 2) * 2) + (Math.PI * 2 * radius);
  }

  function getRoundedRectPoint(x, y, width, height, radius, distance) {
    const straightW = width - radius * 2;
    const straightH = height - radius * 2;
    const arcLen = (Math.PI * radius) / 2;
    const perimeter = getRoundedRectPerimeter(width, height, radius) || 1;
    let d = distance % perimeter;
    if (d < 0) d += perimeter;

    const segments = [
      { len: straightW, point: (t) => ({ x: x + radius + t, y, angle: 0 }) },
      {
        len: arcLen,
        point: (t) => {
          const a = (-Math.PI / 2) + (t / arcLen) * (Math.PI / 2);
          return {
            x: x + width - radius + Math.cos(a) * radius,
            y: y + radius + Math.sin(a) * radius,
            angle: a + Math.PI / 2
          };
        }
      },
      { len: straightH, point: (t) => ({ x: x + width, y: y + radius + t, angle: Math.PI / 2 }) },
      {
        len: arcLen,
        point: (t) => {
          const a = (t / arcLen) * (Math.PI / 2);
          return {
            x: x + width - radius + Math.cos(a) * radius,
            y: y + height - radius + Math.sin(a) * radius,
            angle: a + Math.PI / 2
          };
        }
      },
      { len: straightW, point: (t) => ({ x: x + width - radius - t, y: y + height, angle: Math.PI }) },
      {
        len: arcLen,
        point: (t) => {
          const a = (Math.PI / 2) + (t / arcLen) * (Math.PI / 2);
          return {
            x: x + radius + Math.cos(a) * radius,
            y: y + height - radius + Math.sin(a) * radius,
            angle: a + Math.PI / 2
          };
        }
      },
      { len: straightH, point: (t) => ({ x, y: y + height - radius - t, angle: -Math.PI / 2 }) },
      {
        len: arcLen,
        point: (t) => {
          const a = Math.PI + (t / arcLen) * (Math.PI / 2);
          return {
            x: x + radius + Math.cos(a) * radius,
            y: y + radius + Math.sin(a) * radius,
            angle: a + Math.PI / 2
          };
        }
      }
    ];

    for (const segment of segments) {
      if (d <= segment.len) return segment.point(d);
      d -= segment.len;
    }
    return segments[0].point(0);
  }

  function drawRunningOrbit(ctx, node, color, animationNow) {
    const orbitPadding = 6;
    const orbitX = node.x - orbitPadding;
    const orbitY = node.y - orbitPadding;
    const orbitW = NODE_W + orbitPadding * 2;
    const orbitH = NODE_H + orbitPadding * 2;
    const orbitR = 12;
    const perimeter = getRoundedRectPerimeter(orbitW, orbitH, orbitR);
    const segmentLength = Math.max(48, Math.min(96, perimeter * 0.32));
    const progress = ((animationNow % 1400) / 1400) * perimeter;
    const headPoint = getRoundedRectPoint(orbitX, orbitY, orbitW, orbitH, orbitR, progress + segmentLength);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash([segmentLength, perimeter]);
    ctx.lineDashOffset = -progress;
    drawRoundedRect(ctx, orbitX, orbitY, orbitW, orbitH, orbitR);
    ctx.stroke();
    ctx.setLineDash([]);
    drawArrowHead(ctx, headPoint.x, headPoint.y, headPoint.angle, 6, color);
    ctx.restore();
  }

  function getConnectorIconSrc(nodeRef) {
    const explicitConnectorId = String(nodeRef?.form?.selected_connector_icon || "").trim();
    if (explicitConnectorId) return getConnectorImageSrc(explicitConnectorId);
    return getConnectorImageSrc(nodeRef?.connector);
  }

  function ensureConnectorIcon(view, src) {
    if (!src) return null;
    if (ICON_CACHE.has(src)) return ICON_CACHE.get(src);

    const img = new Image();
    img.__failed = false;
    img.onload = () => {
      if (typeof view.requestDraw === "function") view.requestDraw();
      else drawFlowCanvas(view);
    };
    img.onerror = () => {
      if (!img.__fallbackTried && src !== NOIMAGE_SRC) {
        img.__fallbackTried = true;
        img.src = NOIMAGE_SRC;
        return;
      }
      img.__failed = true;
      if (typeof view.requestDraw === "function") view.requestDraw();
      else drawFlowCanvas(view);
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
    const points = [{ x: sx, y: sy }, { x: routeX, y: sy }];

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
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
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
    const center = style.sigmoidBias || 0.82;
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
    const flowNodeShadow = rootStyles.getPropertyValue("--alpha-shadow-10").trim() || "rgba(79, 67, 67, 0.68)";
    const flowLoopFrameFill = rootStyles.getPropertyValue("--flow-loop-frame-fill").trim() || "#eef8ee";
    const flowLoopFrameStroke = rootStyles.getPropertyValue("--flow-loop-frame-stroke").trim() || "#1a7259";
    const flowControlFillActive = rootStyles.getPropertyValue("--flow-control-fill-active").trim() || "#4b4e63";
    const flowControlStroke = rootStyles.getPropertyValue("--flow-control-stroke").trim() || "#bdbdbd";
    const flowControlStrokeActive = rootStyles.getPropertyValue("--flow-control-stroke-active").trim() || "#4b4e63";
    const flowControlText = rootStyles.getPropertyValue("--flow-control-text").trim() || "#4b4e63";
    const flowControlTextActive = rootStyles.getPropertyValue("--flow-control-text-active").trim() || "#fffefe";
    const surfaceStrong = rootStyles.getPropertyValue("--surface-strong").trim() || "#4b4e63";
    const surfacePage = rootStyles.getPropertyValue("--surface-page").trim() || "#fffefe";
    const surfacePseudo = rootStyles.getPropertyValue("--border-grid-flow").trim() || "#e8eaf2";
    const textMuted = rootStyles.getPropertyValue("--text-muted").trim() || "#767b93";
    const textPrimary = rootStyles.getPropertyValue("--text-primary").trim() || "#4b4e63";
    const pseudoNodeBorder = rootStyles.getPropertyValue("--border-grid").trim() || "#e1e3ec";
    const flowStepBadgeBorder = rootStyles.getPropertyValue("--flow-step-badge-border").trim() || "#c8cad8";

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

    if (view.mergeDragState?.sourceId) {
      const sourceNode = model.nodeMap.get(view.mergeDragState.sourceId);
      if (sourceNode) {
        const targetNode = view.mergeDragState.targetNodeId ? model.nodeMap.get(view.mergeDragState.targetNodeId) : null;
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
    let hasRunningAnimation = false;
    nodesToDraw.forEach((node) => {
      const isStart = node.kind === "start";
      const isEnd = node.kind === "end";
      const isTask = node.kind === "task";
      const isLoopEnd = node.kind === "loop-end";
      const isSelected = (isTask || isStart) && state.selectedNodeId === node.id;
      const isParallel = isTask && !!node.nodeRef.parallelOf;
      const isDraggingNode = !!(view.dragState && view.dragState.started && view.dragState.nodeId === node.id);
      const hasAlert = isTask && alertNodeIds.has(node.id);
      const stepStatus = isTask ? String((state.stepStatuses && state.stepStatuses[node.nodeRef.stepName]) || "") : "";
      if (stepStatus === "running") hasRunningAnimation = true;
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
      const animationNow = typeof view.animationNow === "number" ? view.animationNow : performance.now();

      if (isTask && stepStatus === "running") {
        drawRunningOrbit(ctx, node, flowNodeStatusRunning, animationNow);
      }

      ctx.setLineDash(isParallel ? [4, 2] : []);
      ctx.fillStyle = isStart || isEnd ? surfacePseudo : surfacePage;
      ctx.globalAlpha = isDraggingNode ? 0.28 : 1;
      ctx.shadowColor = flowNodeShadow;
      ctx.shadowBlur = isStart || isEnd ? 2 : isSelected ? 7 : 5;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = isStart || isEnd ? 1 : 2;
      ctx.strokeStyle = isStart || isEnd
        ? (isSelected ? flowNodeBorderSelected : pseudoNodeBorder)
        : statusStrokeColor || (isSelected ? flowNodeBorderSelected : flowNodeBorder);
      ctx.lineWidth = isStart || isEnd ? (isSelected ? 2 : 1) : Math.max(statusStrokeWidth, isSelected ? 2 : 1);
      if (isStart) drawOneSideRoundedRect(ctx, drawX, drawY, drawW, drawH, "left");
      else if (isEnd) drawOneSideRoundedRect(ctx, drawX, drawY, drawW, drawH, "right");
      else drawRoundedRect(ctx, node.x, node.y, NODE_W, NODE_H, 8);
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
        const markerX = node.x + NODE_W - 2;
        const markerY = node.y + 4;
        ctx.fillStyle = warningAccent;
        ctx.beginPath();
        ctx.arc(markerX, markerY, 8, 0, Math.PI * 2);
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
        ctx.strokeStyle = surfaceStrong;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = surfaceStrong;
        ctx.beginPath();
        ctx.moveTo(cx - 3, cy - 5);
        ctx.lineTo(cx - 3, cy + 5);
        ctx.lineTo(cx + 5, cy);
        ctx.closePath();
        ctx.fill();
      } else if (isLoopEnd) {
        ctx.font = "700 10px 'Segoe UI', 'Yu Gothic UI', sans-serif";
        ctx.textBaseline = "middle";
        ctx.fillText(node.text, node.x + NODE_W / 2, node.y + NODE_H / 2);
        ctx.textBaseline = "alphabetic";
      } else if (isTask && !hasIcon) {
        ctx.fillText(node.nodeRef.stepName, node.x + NODE_W / 2, node.y + 32);
      }

      if (isTask && hasIcon) {
        const ratio = Math.min((NODE_W - 28) / icon.naturalWidth, (NODE_H - 28) / icon.naturalHeight) * 1.15;
        const w = Math.max(1, Math.floor(icon.naturalWidth * ratio));
        const h = Math.max(1, Math.floor(icon.naturalHeight * ratio));
        const x = Math.round(node.x + (NODE_W - w) / 2);
        const y = Math.round(node.y + (NODE_H - h) / 2);
        ctx.drawImage(icon, x, y, w, h);
      } else if (isTask) {
        ctx.font = "14px 'Segoe UI', 'Yu Gothic UI', sans-serif";
        const lines = [...wrapText(ctx, node.title, NODE_W - 16), ...wrapText(ctx, node.subtitle, NODE_W - 16)].slice(0, 2);
        lines.forEach((line, idx) => ctx.fillText(line, node.x + NODE_W / 2, node.y + 56 + idx * 18));
      }

      if (isTask && String(node.description || "").trim()) {
        ctx.fillStyle = textPrimary;
        ctx.font = "11px 'Segoe UI', 'Yu Gothic UI', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        wrapText(ctx, node.description, NODE_W + 40).forEach((line, idx) => {
          ctx.fillText(line, node.x + NODE_W / 2, node.y + NODE_H + 6 + idx * 13);
        });
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

    view.hasRunningAnimation = hasRunningAnimation;
  }

  nodeCanvasParts.drawFlowCanvas = drawFlowCanvas;
})();
