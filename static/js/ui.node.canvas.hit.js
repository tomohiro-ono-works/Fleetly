(function () {
  const packages = window.zizPackages = window.zizPackages || {};
  const uiPkg = packages.ui = packages.ui || {};
  const nodeCanvasParts = uiPkg.nodeCanvasParts = uiPkg.nodeCanvasParts || window.uiNodeCanvasParts || {};
  window.uiNodeCanvasParts = nodeCanvasParts;
  const constants = nodeCanvasParts.constants || {};
  const { NODE_W, NODE_H, BTN_HIT_SLOP, BTN_HIT_BIAS_Y } = constants;

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
    if (start && x >= start.x && x <= start.x + NODE_W && y >= start.y && y <= start.y + NODE_H) return start;
    return null;
  }

  function hitStickyNote(model, x, y, options = {}) {
    const notes = Array.isArray(model?.stickyNotes) ? model.stickyNotes : [];
    const handleSize = Math.max(8, Number(options.handleSize) || 14);
    for (let i = notes.length - 1; i >= 0; i -= 1) {
      const note = notes[i];
      if (!note) continue;
      const withinX = x >= note.x && x <= note.x + note.w;
      const withinY = y >= note.y && y <= note.y + note.h;
      if (!withinX || !withinY) continue;
      const onResizeHandle = x >= (note.x + note.w - handleSize) && y >= (note.y + note.h - handleSize);
      return { note, onResizeHandle };
    }
    return null;
  }

  function distanceToSegment(px, py, ax, ay, bx, by) {
    const abx = bx - ax;
    const aby = by - ay;
    const apx = px - ax;
    const apy = py - ay;
    const abLenSq = (abx * abx) + (aby * aby);
    if (abLenSq <= 0.000001) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((apx * abx) + (apy * aby)) / abLenSq));
    const cx = ax + abx * t;
    const cy = ay + aby * t;
    return Math.hypot(px - cx, py - cy);
  }

  function cubicBezier(p0, p1, p2, p3, t) {
    const mt = 1 - t;
    const mt2 = mt * mt;
    const t2 = t * t;
    const a = mt2 * mt;
    const b = 3 * mt2 * t;
    const c = 3 * mt * t2;
    const d = t * t2;
    return {
      x: (a * p0.x) + (b * p1.x) + (c * p2.x) + (d * p3.x),
      y: (a * p0.y) + (b * p1.y) + (c * p2.y) + (d * p3.y)
    };
  }

  function buildMergeOrthogonalPoints(from, to) {
    const sx = from.x + NODE_W;
    const sy = from.y + NODE_H / 2;
    const tx = to.x;
    const ty = to.y + NODE_H / 2;
    const sourceStub = 28;
    const targetInset = 18;
    const routeX = sx + sourceStub;
    const entryX = Math.min(tx - targetInset, tx - 12);
    const points = [{ x: sx, y: sy }, { x: routeX, y: sy }];
    if (ty < sy) {
      points.push({ x: routeX, y: ty });
      points.push({ x: entryX, y: ty });
    } else {
      const detourDepth = 64;
      const detourY = sy + detourDepth;
      points.push({ x: routeX, y: detourY });
      points.push({ x: entryX, y: detourY });
      points.push({ x: entryX, y: ty });
    }
    points.push({ x: tx, y: ty });
    return points;
  }

  function buildBackwardOrthogonalPoints(from, to) {
    const sx = from.x + NODE_W;
    const sy = from.y + NODE_H / 2;
    const tx = to.x;
    const ty = to.y + NODE_H / 2;
    const sourceStub = 56;
    const outerMargin = 72;
    const targetInset = 18;
    const detourDepth = 64;
    const routeX = Math.max(sx + sourceStub, Math.max(from.x + NODE_W, to.x + NODE_W) + outerMargin);
    const entryX = Math.min(tx - targetInset, tx - 12);
    const dy = ty - sy;
    const minVerticalClearance = Math.max(18, Math.floor(NODE_H * 0.35));
    let laneY;
    if (Math.abs(dy) <= detourDepth) {
      laneY = dy >= 0 ? ty + detourDepth : ty - detourDepth;
    } else if (dy > 0) {
      const middleLane = ty - detourDepth;
      laneY = (middleLane - sy >= minVerticalClearance) ? middleLane : (ty + detourDepth);
    } else {
      const middleLane = ty + detourDepth;
      laneY = (sy - middleLane >= minVerticalClearance) ? middleLane : (ty - detourDepth);
    }
    laneY = Math.round(laneY);
    return [
      { x: sx, y: sy },
      { x: routeX, y: sy },
      { x: routeX, y: laneY },
      { x: entryX, y: laneY },
      { x: entryX, y: ty },
      { x: tx, y: ty }
    ];
  }

  function buildHorizontalPathPoints(from, to) {
    const sx = from.x + NODE_W;
    const sy = from.y + NODE_H / 2;
    const tx = to.x;
    const ty = to.y + NODE_H / 2;
    const totalDx = Math.max(1, tx - sx);
    const preferredStub = 11;
    const maxStub = Math.max(2, Math.floor((totalDx - 2) / 2));
    const stub = Math.min(preferredStub, maxStub);
    const startStubX = sx + stub;
    const endStubX = tx - stub;
    const middleSpan = Math.max(0, endStubX - startStubX);
    const points = [{ x: sx, y: sy }, { x: startStubX, y: sy }];
    if (middleSpan > 0.5) {
      const midX = (startStubX + endStubX) / 2;
      const midY = (sy + ty) / 2;
      const a = Math.max(2, Math.min(8, middleSpan * 0.25));
      const b = Math.max(2, Math.min(10, middleSpan * 0.18));
      const c1p0 = { x: startStubX, y: sy };
      const c1p1 = { x: startStubX + a, y: sy };
      const c1p2 = { x: midX - b, y: sy };
      const c1p3 = { x: midX, y: midY };
      const c2p0 = { x: midX, y: midY };
      const c2p1 = { x: midX + b, y: ty };
      const c2p2 = { x: endStubX - a, y: ty };
      const c2p3 = { x: endStubX, y: ty };
      for (let i = 1; i <= 10; i += 1) {
        points.push(cubicBezier(c1p0, c1p1, c1p2, c1p3, i / 10));
      }
      for (let i = 1; i <= 10; i += 1) {
        points.push(cubicBezier(c2p0, c2p1, c2p2, c2p3, i / 10));
      }
    } else {
      points.push({ x: endStubX, y: ty });
    }
    points.push({ x: tx, y: ty });
    return points;
  }

  function getEdgePathPoints(from, to, kind) {
    const sx = from.x + NODE_W;
    const tx = to.x;
    if (tx <= sx + 1) return buildBackwardOrthogonalPoints(from, to);
    return buildHorizontalPathPoints(from, to);
  }

  function hitEdge(model, x, y, options = {}) {
    const threshold = Math.max(4, Number(options.threshold) || 8);
    const edges = Array.isArray(model?.edges) ? model.edges : [];
    const nodeMap = model?.nodeMap;
    if (!nodeMap) return null;
    for (let i = edges.length - 1; i >= 0; i -= 1) {
      const edge = edges[i];
      if (!edge) continue;
      if (edge.kind === "to-end" || edge.kind === "to-end-main") continue;
      if (String(edge.from || "").startsWith("__") || String(edge.to || "").startsWith("__")) continue;
      const from = nodeMap.get(edge.from);
      const to = nodeMap.get(edge.to);
      if (!from || !to) continue;
      const points = getEdgePathPoints(from, to, edge.kind);
      for (let j = 1; j < points.length; j += 1) {
        const p0 = points[j - 1];
        const p1 = points[j];
        if (distanceToSegment(x, y, p0.x, p0.y, p1.x, p1.y) <= threshold) {
          return edge;
        }
      }
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
    if (dragState?.started) {
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

  nodeCanvasParts.hitTask = hitTask;
  nodeCanvasParts.hitSelectableNode = hitSelectableNode;
  nodeCanvasParts.hitStickyNote = hitStickyNote;
  nodeCanvasParts.hitEdge = hitEdge;
  nodeCanvasParts.hitControl = hitControl;
  nodeCanvasParts.getControlTooltip = getControlTooltip;
  nodeCanvasParts.createImmediateTooltip = createImmediateTooltip;
})();
